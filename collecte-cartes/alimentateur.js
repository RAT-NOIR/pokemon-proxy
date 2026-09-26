// ============================================================
// L'ALIMENTATEUR DE LA FILE D'IMAGES — le worker se nourrit lui-même
// ============================================================
// 🔴 LA DEMANDE (testeur, 2026-09-25) : « je ne veux plus jamais constater moi-même qu'il dort ». Deux fois en deux jours,
// la file s'est vidée et le worker a dormi des heures en « repos », pendant que des milliers de cartes attendaient un visuel.
// Personne ne remplissait : la file ne se remplissait qu'à la main, par remettre-en-file.js et enfiler-tcgdex.js.
//
// 🔑 IL VIT DANS LE WORKER, et c'est ce qui le rend sûr : il lit les tables et les sources de SON commit — celles-là mêmes
// qui exécuteront l'unité. La garde du commit de remettre-en-file.js (« le worker porte-t-il la règle ? ») est satisfaite
// par construction : une unité qu'il enfile est lue par le code qui l'a choisie.
//
// LA RÈGLE, écrite par ce qu'elle AUTORISE (§51) :
//   · un set dont des cartes n'ont pas de visuel pour CE set, du plus gros manque au plus petit ;
//   · japonais → artofpkm si une source est déclarée ; occidental → TCGdex si la ligne nomme un set TCGdex, puis
//     Bulbapedia ; tout autre tirage (chinois, indonésien, thaï) → « sans source légale », jamais enfilé (§42, §44, §56) ;
//   · une unité ABSENTE s'insère ; une unité en attente couvre son set ; une unité déjà passée ne revient QUE sur une
//     CAUSE NEUVE — le texte du set recollecté après elle — et une seule fois par cause (`alimCause`). Sans cela, une
//     reprise à l'aveugle re-échouerait à chaque réveil : une boucle, pas une file.
// Tout set qu'il n'enfile pas sort avec sa RAISON : « rien à faire » est une réponse nommée, jamais un silence.
// Et une file qui reste VIDE après son passage est une ALERTE écrite en base (`collecte_images_etat` « alerte/file-vide »),
// relue par file-a-l-arret.js et la table maîtresse.

const TIRAGES_SOURCES = { jp: 'artofpkm', intl: 'tcgdex+bulbapedia' };

/**
 * La décision, pure. `manques` : [{ slug, n, sans }] ; `unites` : Map _id → unité de file_images.
 * @returns {{ inserer: object[], reprendre: object[], ecartes: Array<{slug, raison}> }}
 */
function choisirUnites({ manques, ligneDe, sourceArtofpkm, setTcgdex, unites, texteFini, max = 10 }) {
    const inserer = [], reprendre = [], ecartes = [];
    const date = u => u.fini || u.pris || u.ajouteLe || null;
    for (const m of [...manques].sort((a, b) => b.sans - a.sans || b.n - a.n)) {
        if (inserer.length + reprendre.length >= max) break;
        const L = ligneDe(m.slug);
        if (!L) { ecartes.push({ slug: m.slug, raison: 'aucune ligne de table' }); continue; }
        const tirage = L.bulba?.tirage || (L.region === 'japonais' ? 'jp' : 'intl');
        if (!TIRAGES_SOURCES[tirage]) { ecartes.push({ slug: m.slug, raison: `sans source légale (tirage ${tirage})` }); continue; }
        const candidats = [];
        if (tirage === 'jp') {
            if (!sourceArtofpkm(L.code)) { ecartes.push({ slug: m.slug, raison: 'japonais : aucune source artofpkm déclarée' }); continue; }
            candidats.push({ _id: L.code, source: 'artofpkm', slug: m.slug, sans: m.sans });
        } else {
            const t = setTcgdex(L);
            if (t) candidats.push({ _id: `tcgdex/${L.code}`, code: L.code, source: 'tcgdex', tcgdexSet: t.id, tcgdexNom: t.name, slug: m.slug, sans: m.sans });
            candidats.push({ _id: L.code, source: 'bulbapedia', slug: m.slug, sans: m.sans });
        }
        const passees = [];
        let decide = false;
        for (const c of candidats) {
            const u = unites.get(c._id);
            if (!u) { inserer.push(c); decide = true; break; }
            if (u.etat === 'attente' || u.etat === 'en-cours') { decide = true; break; }
            const fin = texteFini(m.slug), avant = date(u);
            if (fin && avant && fin > avant && u.alimCause !== fin.toISOString()) {
                reprendre.push({ _id: c._id, source: c.source, slug: m.slug, sans: m.sans, etatAvant: u.etat, causeCle: fin.toISOString(), cause: `texte du set recollecté le ${fin.toISOString()}, après l'unité (${avant.toISOString()})` });
                decide = true; break;
            }
            passees.push(`${c._id} ${u.etat}`);
        }
        if (!decide) ecartes.push({ slug: m.slug, raison: `toutes les sources légales ont tourné (${passees.join(', ')}) : aucune cause neuve` });
    }
    return { inserer, reprendre, ecartes };
}

/** Les sets dont des cartes n'ont pas de visuel pour CE set — la même définition que remettre-en-file.js (`images.set`). */
async function manquesParSet(db) {
    return db.collection('cartes').aggregate([
        { $match: { 'sets.0': { $exists: true } } },
        { $project: { sets: 1, imgSets: { $ifNull: ['$images.set', []] } } },
        { $unwind: '$sets' },
        { $group: { _id: '$sets', n: { $sum: 1 }, avec: { $sum: { $cond: [{ $in: ['$sets', '$imgSets'] }, 1, 0] } } } },
        { $project: { _id: 0, slug: '$_id', n: 1, sans: { $subtract: ['$n', '$avec'] } } },
        { $match: { sans: { $gt: 0 } } }
    ], { allowDiskUse: true }).toArray();
}

/**
 * Le geste : sous le seuil, remplir ; puis, si la file est ENCORE vide, écrire l'alerte. Rend un bilan imprimable.
 * `SEUIL` : on remplit AVANT que la file soit vide — le worker ne doit jamais constater le vide en se réveillant.
 */
async function alimenter(db, { seuil = 3, max = 10, journal = console, simuler = false } = {}) {
    const F = db.collection('file_images');
    const enAttente = await F.countDocuments({ etat: { $in: ['attente', 'en-cours'] } });
    if (enAttente >= seuil && !simuler) return { enAttente, rien: true };
    const { TABLE, TABLE_AUTO, TABLE_SANS_PAGE } = require('./table-sets');
    const { sourceDe } = require('./sources-sets');
    const { fabriquerAppariement, setDeLaLigne } = require('./tcgdex-cache');
    // Une ligne ADMISE d'abord pour un slug, puis les autres : la même préséance que `ligne(code)`.
    const parSlug = new Map();
    for (const l of [...TABLE, ...TABLE_AUTO, ...TABLE_SANS_PAGE]) if (l.slugSet && !parSlug.has(l.slugSet)) parSlug.set(l.slugSet, l);
    const liste = (await db.collection('tcgdex_sets').findOne({ _id: 'en/__liste__' }))?.sets || [];
    const apparier = liste.length ? fabriquerAppariement(liste) : null;
    const texte = new Map((await db.collection('collecte_etat').find({}, { projection: { fin: 1 } }).toArray()).filter(e => e.fin).map(e => [String(e._id), new Date(e.fin)]));
    const unites = new Map((await F.find({}).toArray()).map(u => [String(u._id), u]));
    const manques = await manquesParSet(db);
    const R = choisirUnites({
        manques, unites, max,
        ligneDe: slug => parSlug.get(slug) || null,
        sourceArtofpkm: code => !!sourceDe(code),
        setTcgdex: L => { if (!apparier) return null; const d = setDeLaLigne(L, apparier); return d.set ? { id: d.set.id, name: d.set.name } : null; },
        texteFini: slug => texte.get(slug) || null
    });
    if (simuler) return { enAttente, ...R, manques };
    let ordre = ((await F.find({}).sort({ ordre: -1 }).limit(1).toArray())[0]?.ordre ?? 0) + 1;
    let inseres = 0, repris = 0;
    for (const u of R.inserer) {
        const { _id, slug, sans, ...champs } = u;
        const r = await F.updateOne({ _id }, { $setOnInsert: { ...champs, ordre: ordre++, etat: 'attente', ajouteLe: new Date(), ajouteMotif: `alimentateur : ${sans} carte(s) sans visuel pour ${slug}` } }, { upsert: true });
        inseres += r.upsertedCount;
    }
    for (const u of R.reprendre) {
        const r = await F.updateOne({ _id: u._id, etat: u.etatAvant }, { $set: { etat: 'attente', source: u.source, ordre: ordre++, alimCause: u.causeCle, remisEnFileLe: new Date(), remisEnFileMotif: `alimentateur : ${u.sans} carte(s) sans visuel pour ${u.slug} — ${u.cause}` }, $unset: { pris: 1, resultat: 1, fini: 1 } });
        repris += r.modifiedCount;
    }
    const apres = await F.countDocuments({ etat: { $in: ['attente', 'en-cours'] } });
    const raisons = {}; for (const e of R.ecartes) { const k = e.raison.replace(/\(.*\)/, '(…)'); raisons[k] = (raisons[k] || 0) + 1; }
    const E = db.collection('collecte_images_etat');
    await ecrireAlerte(E, { vide: !apres, setsSans: manques.length, cartesSans: manques.reduce((s, m) => s + m.sans, 0), raisons });
    if (!apres) journal.error(`🔴 FILE VIDE — l'alimentateur n'a rien pu enfiler : ${manques.length} sets, ${manques.reduce((s, m) => s + m.sans, 0)} cartes sans visuel, toutes écartées avec leur raison : ${JSON.stringify(raisons)}`);
    else if (inseres || repris) journal.log(`🍽️ alimentateur : ${inseres} unité(s) insérée(s), ${repris} reprise(s) sur cause neuve — file : ${apres} (seuil ${seuil}) · écartés : ${JSON.stringify(raisons)}`);
    return { enAttente: apres, inseres, repris, ecartes: R.ecartes.length, raisons };
}

/**
 * L'ALERTE « file vide » : ouverte tant que la file reste vide après le passage de l'alimentateur, fermée dès qu'elle se remplit.
 * 🔴 `depuis` DATE L'ÉPISODE EN COURS (2026-09-26). Posé par `$setOnInsert` seul, il gardait la PREMIÈRE panne (25/09 05:02) après
 * sa résolution (19:03) : le second épisode, file vide vers 21:26, s'affichait « depuis 05:02 » — une durée fausse de 16 heures.
 * Une alerte absente ou fermée qui s'ouvre repart donc de maintenant ; ouverte, elle garde son début.
 */
async function ecrireAlerte(E, { vide, setsSans = null, cartesSans = null, raisons = null, maintenant = new Date() }) {
    if (!vide) { await E.updateOne({ _id: 'alerte/file-vide', active: true }, { $set: { active: false, resolueLe: maintenant } }); return; }
    await E.updateOne({ _id: 'alerte/file-vide', active: { $ne: true } }, { $set: { depuis: maintenant } });
    await E.updateOne({ _id: 'alerte/file-vide' }, { $set: { active: true, constateLe: maintenant, setsSansVisuelComplet: setsSans, cartesSansVisuel: cartesSans, raisons }, $setOnInsert: { depuis: maintenant } }, { upsert: true });
}

module.exports = { choisirUnites, manquesParSet, alimenter, ecrireAlerte };
