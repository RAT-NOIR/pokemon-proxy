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

// ⚠️ 2026-09-29 : VOULU — l'indonésien (TCGdex `id`, sets idth) ne s'enfile PAS tout seul : enfiler-tcgdex.js --langue=id --sets=…,
// à la main, set par set (décision du testeur, trois sets mesurés). Un set idth reste ici « sans source légale » pour l'alimentateur.
const TIRAGES_SOURCES = { jp: 'artofpkm', intl: 'tcgdex+bulbapedia' };
const { manqueTcgdex, choisirManqueReel } = require('./manque-reel');
// 🔑 LE MANQUE RÉEL (2026-09-26, soir, collecte-cartes/manque-reel.js) : quand la règle par SET ne remplit pas la file, on
// demande à la SOURCE ce qu'elle sert et que nous n'avons jamais tenté, carte par carte. La mesure lit les cartes de chaque
// set occidental (grappe bridée : quelques minutes) — elle ne se refait donc qu'après ce délai quand la précédente n'a rien
// eu à enfiler, et elle ne tourne que si le worker a de quoi la payer (`M`).
// 6 h et non 1 h (troisième relecture) : une mesure lit ~10 min la grappe que le site lit aussi ; au repos, un manque ne naît que
// d'un texte recollecté ou d'un code neuf — et un code neuf (autre `version`) remesure tout de suite.
const INTERVALLE_MANQUE_MS = 6 * 60 * 60 * 1000;
const tirageDe = L => L.bulba?.tirage || (L.region === 'japonais' ? 'jp' : 'intl');

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
        const tirage = tirageDe(L);
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
// `unitePermise(code)` (outil à la main seulement) : null si le worker exécutera l'unité avec la même ligne, sinon la raison
// (collecte-cartes/tables-du-commit.js). Le worker n'en a pas besoin : il lit les tables de SON commit.
// `version` : le commit du code qui EXÉCUTERA les unités — il entre dans la clé du manque (manque-reel.js). Le worker passe le
// sien (version-code.js) ; l'outil à la main passe celui du worker lu dans sa balise, jamais le sien.
// `plan` (outil à la main) : le résultat d'une simulation — il est ÉCRIT tel quel, sans seconde mesure (§31 : ce qui est écrit est ce
// qui a été imprimé). Les écritures restent conditionnelles : insertion `$setOnInsert`, reprise filtrée sur l'état lu.
async function alimenter(db, { seuil = 3, max = 10, journal = console, simuler = false, M = null, maintenant = new Date(), forcerManque = false, unitePermise = null, version = require('../version-code').VERSION, plan = null } = {}) {
    const refusees = [];
    // une unité refusée par la règle par set peut être rechoisie par le manque réel : elle ne se liste qu'une fois
    const permise = u => { if (!unitePermise) return true; const r = unitePermise(u.code || String(u._id).replace(/^tcgdex\//, '')); if (r && !refusees.some(x => x._id === u._id)) refusees.push({ _id: u._id, slug: u.slug, raison: r }); return !r; };
    const F = db.collection('file_images');
    const E = db.collection('collecte_images_etat');
    // les unités PRENABLES, comme le worker les prend (collecteur-images.js : `attente` sans `pasAvant` futur) plus celle en cours —
    // une unité différée (surcharge, source inconnue de ce worker) n'est pas du travail : trois suffisaient à affamer la file sans
    // alerte (revue du 2026-09-27)
    const pretes = async () => (await F.countDocuments({ etat: 'en-cours' }))
        + (await F.countDocuments({ etat: 'attente', $or: [{ pasAvant: { $exists: false } }, { pasAvant: { $lte: maintenant } }] }));
    const enAttente = await pretes();
    if (enAttente >= seuil && !simuler) return { enAttente, rien: true };
    let R, RM = { inserer: [], reprendre: [], ecartes: [] }, mesure = null, erreurManque = null, manques;
    if (plan) {
        if (simuler) throw new Error('alimenter : `plan` et `simuler` ensemble — un plan se simule une fois, puis s\'écrit');
        R = { inserer: plan.inserer, reprendre: plan.reprendre, ecartes: plan.ecartes }; RM = plan.choixManqueReel; mesure = plan.manqueReel; manques = plan.manques; erreurManque = plan.erreurManque ?? null;
        refusees.push(...(plan.refusees || []));
    } else {
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
    manques = await manquesParSet(db);
    R = choisirUnites({
        manques, unites, max,
        ligneDe: slug => parSlug.get(slug) || null,
        sourceArtofpkm: code => !!sourceDe(code),
        setTcgdex: L => { if (!apparier) return null; const d = setDeLaLigne(L, apparier); return d.set ? { id: d.set.id, name: d.set.name } : null; },
        texteFini: slug => texte.get(slug) || null
    });
    R.inserer = R.inserer.filter(permise); R.reprendre = R.reprendre.filter(permise);
    // ── le manque réel, quand la règle par set laisse de la place
    const place = max - R.inserer.length - R.reprendre.length;
    if (M && place > 0) {
        // 🔴 revue du 2026-09-26 : la mesure lit le cache TCGdex et les cartes de chaque set — une exception ici (cache absent,
        // grappe lente) ne doit pas faire perdre ce que la règle par set vient de choisir, ni l'alerte « file vide ». Elle se DIT.
        try {
            const dernier = await E.findOne({ _id: 'alimentateur/manque-reel' });
            // une mesure vide ne se refait qu'après une heure — sauf sous un code NEUF, qui sait peut-être lire ce que l'ancien ne lisait pas
            const recente = dernier?.le && !dernier.enfilees && dernier.version === version && maintenant - new Date(dernier.le) < INTERVALLE_MANQUE_MS;
            // une mesure en ÉCHEC attend elle aussi (revue du 2026-09-26) : sans cela elle se refait à chaque tour, ~11 min de lecture
            // sur une grappe bridée, pour la même exception — sous le même code seulement
            const echecRecent = dernier?.erreurLe && dernier.erreurVersion === version && maintenant - new Date(dernier.erreurLe) < INTERVALLE_MANQUE_MS;
            if ((!recente && !echecRecent) || forcerManque) {
                // une ligne par slug (la préséance de `parSlug`), tirage occidental seulement : TCGdex ne sert que l'anglais
                mesure = await manqueTcgdex(M, db, { lignes: [...parSlug.values()].filter(L => tirageDe(L) === 'intl'), liste, version });
                const dejaChoisies = new Set([...R.inserer, ...R.reprendre].map(u => String(u._id)));
                const choix = choisirManqueReel({ manques: mesure.manques, unites, max: place });
                RM = { inserer: choix.inserer.filter(u => !dejaChoisies.has(u._id)).filter(permise), reprendre: choix.reprendre.filter(u => !dejaChoisies.has(u._id)).filter(permise), ecartes: choix.ecartes };
            }
        } catch (e) {
            erreurManque = e.message; mesure = null; RM = { inserer: [], reprendre: [], ecartes: [] };
            journal.error(`🔴 alimentateur : le manque réel n'a pas pu se mesurer — ${e.message}`);
        }
    }
    }
    if (simuler) return { enAttente, ...R, manques, manqueReel: mesure, choixManqueReel: RM, refusees, erreurManque };
    let ordre = ((await F.find({}).sort({ ordre: -1 }).limit(1).toArray())[0]?.ordre ?? 0) + 1;
    let inseres = 0, repris = 0, enfileesManque = 0;
    for (const u of R.inserer) {
        const { _id, slug, sans, ...champs } = u;
        const r = await F.updateOne({ _id }, { $setOnInsert: { ...champs, ordre: ordre++, etat: 'attente', ajouteLe: new Date(), ajouteMotif: `alimentateur : ${sans} carte(s) sans visuel pour ${slug}` } }, { upsert: true });
        inseres += r.upsertedCount;
    }
    for (const u of RM.inserer) {
        const { _id, slug, sans, ajouteMotif, ...champs } = u;
        const r = await F.updateOne({ _id }, { $setOnInsert: { ...champs, ordre: ordre++, etat: 'attente', ajouteLe: new Date(), ajouteMotif } }, { upsert: true });
        inseres += r.upsertedCount; enfileesManque += r.upsertedCount;
    }
    const reprisesManque = new Set(RM.reprendre.map(u => String(u._id)));
    for (const u of [...R.reprendre, ...RM.reprendre]) {
        // une reprise est un PASSAGE NEUF : les compteurs d'une surcharge passée (issue-unite.js) ne la suivent pas — sans
        // cela, une unité refusée au 3e passage reviendrait avec `tentatives: 3` et serait refusée au premier incident
        // l'HISTORIQUE des clés (`alimCauses`) : une clé déjà reprise ne se reprend plus, même si une autre l'a remplacée entre-temps
        const r = await F.updateOne({ _id: u._id, etat: u.etatAvant }, { $set: { etat: 'attente', source: u.source, ordre: ordre++, alimCause: u.causeCle, remisEnFileLe: new Date(), remisEnFileMotif: `alimentateur : ${u.sans} carte(s) sans visuel pour ${u.slug} — ${u.cause}`,
            ...(u.tcgdexSet ? { tcgdexSet: u.tcgdexSet, tcgdexNom: u.tcgdexNom } : {}) }, $addToSet: { alimCauses: { $each: [...(u.causesAvant || []), u.causeCle] } }, $unset: { pris: 1, resultat: 1, fini: 1, tentatives: 1, pasAvant: 1 } });
        repris += r.modifiedCount;
        if (reprisesManque.has(String(u._id))) enfileesManque += r.modifiedCount;
    }
    // l'état de la mesure s'écrit APRÈS les écritures, avec ce qui a été RÉELLEMENT enfilé : `enfilees` décide si la prochaine
    // mesure attend une heure (0) ou se refait tout de suite — un choix qui n'a rien écrit ne doit pas compter comme un succès
    if (mesure) await E.updateOne({ _id: 'alimentateur/manque-reel' }, { $set: { le: maintenant, version, lignes: mesure.examinees, avecSetTcgdex: mesure.avecSet, setsLus: mesure.lues, setsAvecManque: mesure.manques.length, impressionsJamaisTentees: mesure.manques.reduce((s, m) => s + m.n, 0), enfilees: enfileesManque }, $unset: { erreur: 1, erreurLe: 1, erreurVersion: 1 } }, { upsert: true });
    else if (erreurManque) await E.updateOne({ _id: 'alimentateur/manque-reel' }, { $set: { erreur: erreurManque, erreurLe: maintenant, erreurVersion: version } }, { upsert: true });
    const apres = await pretes();
    const raisons = {}; for (const e of [...R.ecartes, ...RM.ecartes, ...refusees]) { const k = e.raison.replace(/\(.*\)/, '(…)'); raisons[k] = (raisons[k] || 0) + 1; }
    if (mesure) raisons[`manque réel TCGdex : ${mesure.manques.length} set(s), ${mesure.manques.reduce((s, m) => s + m.n, 0)} impression(s) jamais tentée(s) sur ${mesure.lues} set(s) lu(s)`] = enfileesManque;
    if (erreurManque) raisons[`manque réel NON MESURÉ : ${erreurManque}`] = 0;
    await ecrireAlerte(E, { vide: !apres, setsSans: manques.length, cartesSans: manques.reduce((s, m) => s + m.sans, 0), raisons });
    if (!apres) journal.error(`🔴 FILE VIDE — l'alimentateur n'a rien pu enfiler : ${manques.length} sets, ${manques.reduce((s, m) => s + m.sans, 0)} cartes sans visuel, toutes écartées avec leur raison : ${JSON.stringify(raisons)}`);
    else if (inseres || repris) journal.log(`🍽️ alimentateur : ${inseres} unité(s) insérée(s), ${repris} reprise(s) sur cause neuve — file : ${apres} (seuil ${seuil}) · écartés : ${JSON.stringify(raisons)}`);
    return { enAttente: apres, inseres, repris, ecartes: R.ecartes.length + RM.ecartes.length, raisons, manqueReel: mesure };
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

module.exports = { choisirUnites, manquesParSet, alimenter, ecrireAlerte, tirageDe };
