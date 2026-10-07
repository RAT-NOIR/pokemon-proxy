// ============================================================
// LES LOGOS DE DECKS APPORTÉS À LA MAIN — apport-manuel/Deck JP, apport-manuel/DECK ZH (testeur, 2026-10-07 : « les vrais logos que je
// suis allé chercher pour REMPLACER les logos composés des decks japonais et asiatiques »)
// ============================================================
//   node rattacher-logos-apport.js --table=collecte-cartes/logos-apport-manuel-lus.json            (plan : rien d'écrit)
//   node lot-additif.js --quoi="logos apport-manuel" --collections=sets -- node rattacher-logos-apport.js --table=… --ecrire
// 🔑 LA TABLE EST LUE À L'ŒIL (286 fichiers, planches de 24) : chaque fichier y a UNE décision — rattache, doublon (même fichier qu'une
// ligne rattachée), ambigu (question au testeur), sans-set, variante (sous-produit d'un set dont le logo est un autre fichier),
// garde-logo-propre. Les codes des fichiers ne sont PAS ceux de Cardmarket (absents de codes_set pour la plupart) : 144 se
// rattachent par le code de nos sets, les autres par le TITRE LU sur le logo.
// LA GARDE S'ÉCRIT PAR CE QU'ELLE AUTORISE. Une ligne « rattache » s'écrit seulement si : le fichier est celui qui a été lu (sha1) ;
// ce n'est pas une copie de Pokécardex ; le set existe, son tirage est celui du dossier (Deck JP → jp ; DECK ZH → zh-hans/zh-hant) ;
// un seul fichier par set ; le set n'a PAS de logo propre (absent ou générique) ; et — LA RÈGLE DU SITE, IMPORTÉE de
// rat-market-site/lib/visuelSet.ts (pas recopiée) — sur l'état simulé APRÈS écriture, `logoDuSet` affiche CE fichier (langue admise
// pour le tirage, preuve sans contradiction, empreinte non générique). Tout le reste refuse, et rien n'est écrit.
// L'écriture, par set : le fichier sur R2 (`logos/apport-manuel/<dossier>/<fichier>-<sha1>.png`, jamais réécrit) et sa VIGNETTE dans le
// même geste (collecte-cartes/vignette.js, 400 px) ; `sets.logo` = { …, source: 'apport-manuel', langue, langueLue } ; le logo composé
// RETIRÉ (le site le lit AVANT `logo`) et gardé tel quel sous `logoComposeRetire` ; `logoRefus` retiré. Le filtre relit l'état du plan.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pathToFileURL } = require('url');
const AUTORISES = [/^--table=.+\.json$/, /^--ecrire$/];
const T = process.argv.find(a => a.startsWith('--table='))?.slice(8);
const ECRIRE = process.argv.includes('--ecrire');
const { ouvrirConnexions } = require('./collecte-cartes/garde');
const { refusCopie } = require('./collecte-cartes/langue-logo');
const SITE = process.env.RAT_MARKET_SITE || path.join(__dirname, '..', 'rat-market-site');

const RACINE = path.join(__dirname, 'apport-manuel');
const DOSSIERS = { 'Deck JP': { tirages: ['jp'], cle: 'deck-jp' }, 'DECK ZH': { tirages: ['zh-hans', 'zh-hant'], cle: 'deck-zh' } };
const DECISIONS = ['rattache', 'doublon', 'ambigu', 'sans-set', 'variante', 'garde-logo-propre'];
const sha1 = buf => crypto.createHash('sha1').update(buf).digest('hex');
const aUneImage = im => !!im && typeof im.cleR2 === 'string' && im.cleR2.length > 0;
const cleDe = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9.-]+/g, '-').replace(/-+/g, '-');
const cleR2De = l => `logos/apport-manuel/${DOSSIERS[l.dossier].cle}/${cleDe(l.fichier).replace(/\.png$/i, '')}-${l.sha1.slice(0, 10)}.png`;
const preuveDe = (l, lu) => `apporté à la main par le testeur (apport-manuel/${l.dossier}/${l.fichier}, 2026-10-07 : « les vrais logos ») ; lu à l'œil le ${lu} : « ${l.lu} » ; rattaché par ${l.parQuoi}`;

/**
 * Le plan (pur) : une ligne par fichier de la table — `ecrire`, `deja` (ce fichier est déjà le logo du set : un lot interrompu se
 * reprend), `garde`, `refus`, ou la décision reportée (doublon, variante, ambigu, sans-set), chacune contrôlée.
 * `vignettes` (facultatif) : Map « dossier/fichier » → { cleR2, w, h }, la vignette que l'écriture posera — la simulation du site la lit.
 */
function planifier(table, { parFichier, sets, site, vignettes = new Map() }) {
    const parSlug = new Map(sets.map(s => [s._id, s]));
    const generiquesAvant = site.empreintesGeneriques(sets);
    const plan = [];
    const vus = new Map();
    for (const l of table.lignes) {
        const base = { ...l };
        if (!DECISIONS.includes(l.decision)) { plan.push({ ...base, action: 'refus', raison: `décision « ${l.decision} » inconnue` }); continue; }
        if (!DOSSIERS[l.dossier]) { plan.push({ ...base, action: 'refus', raison: `dossier « ${l.dossier} » inconnu` }); continue; }
        const f = parFichier.get(`${l.dossier}/${l.fichier}`);
        if (!f) { plan.push({ ...base, action: 'refus', raison: 'fichier absent du dossier' }); continue; }
        if (sha1(f.buf) !== l.sha1) { plan.push({ ...base, action: 'refus', raison: 'le fichier a changé depuis la lecture (sha1)' }); continue; }
        if (l.decision === 'garde-logo-propre') {
            const s = parSlug.get(l.slug);
            if (!s || !aUneImage(s.logo) || s.logoGenerique === true) { plan.push({ ...base, action: 'refus', raison: `« garde-logo-propre », mais ${l.slug} n'a pas (ou plus) de logo propre` }); continue; }
            // (relecture) un logo composé encore posé passerait DEVANT le logo propre gardé
            if (aUneImage(s.logoCompose)) { plan.push({ ...base, action: 'refus', raison: `« garde-logo-propre », mais ${l.slug} porte aussi un logoCompose, que le site affiche avant` }); continue; }
            plan.push({ ...base, action: 'garde', raison: `logo actuel ${s.logo.source} (${s.logo.cleR2})` }); continue;
        }
        if (l.decision !== 'rattache') { plan.push({ ...base, action: l.decision }); continue; }
        const copie = refusCopie(l.sha1, null);
        if (copie) { plan.push({ ...base, action: 'refus', raison: copie }); continue; }
        const s = parSlug.get(l.slug);
        if (!s) { plan.push({ ...base, action: 'refus', raison: `set « ${l.slug} » absent de la base` }); continue; }
        const tirage = s.tirage ?? s.region;
        if (!DOSSIERS[l.dossier].tirages.includes(tirage)) { plan.push({ ...base, action: 'refus', raison: `set de tirage ${tirage}, dossier ${l.dossier}` }); continue; }
        if (vus.has(l.slug)) { plan.push({ ...base, action: 'refus', raison: `deux fichiers pour ${l.slug} (${vus.get(l.slug)} et ${l.fichier})` }); continue; }
        vus.set(l.slug, l.fichier);
        // (relecture) un lot interrompu se reprend : le fichier déjà posé par cet outil, composé déjà retiré, n'est ni réécrit ni refusé
        if (s.logo?.sha1 === l.sha1 && s.logo?.source === 'apport-manuel' && !aUneImage(s.logoCompose)) { plan.push({ ...base, action: 'deja', set: s, cleR2: s.logo.cleR2 }); continue; }
        if (aUneImage(s.logo) && s.logoGenerique !== true && !generiquesAvant.has(String(s.logo.sha1 ?? '').toLowerCase())) { plan.push({ ...base, action: 'refus', raison: `le set porte déjà un logo propre (${s.logo.source}, ${s.logo.cleR2}) : la table doit dire « garde-logo-propre »` }); continue; }
        plan.push({ ...base, action: 'ecrire', tirage, set: s, cleR2: cleR2De(l), buf: f.buf });
    }
    // (relecture) un doublon ou une variante ne disparaît pas en silence : sa ligne jumelle doit être posée (ou déjà posée)
    const poses = new Map(plan.filter(p => ['ecrire', 'deja'].includes(p.action)).map(p => [`${p.dossier}/${p.fichier}`, p]));
    const slugsPoses = new Set([...poses.values()].map(p => p.slug));
    for (const p of plan) {
        if (p.action === 'doublon') { const j = poses.get(`${p.dossier}/${p.meme}`); if (!j || j.sha1 !== p.sha1) { p.action = 'refus'; p.raison = `doublon de « ${p.meme} », qui n'est pas posé ou n'a pas la même empreinte`; } }
        if (p.action === 'variante' && !slugsPoses.has(p.setDuLogoPrincipal)) { p.action = 'refus'; p.raison = `variante de ${p.setDuLogoPrincipal}, dont le logo principal n'est pas posé`; }
    }
    // LA RÈGLE DU SITE sur l'état APRÈS écriture : le logo composé retiré, le nouveau posé (avec sa vignette). Chaque set écrit doit
    // afficher CE fichier ; et (relecture) AUCUN autre set ne doit changer d'affichage — un fichier générique qui ne serait plus porté
    // que par un set redeviendrait « propre » et s'afficherait.
    const ecrits = new Map(plan.filter(p => p.action === 'ecrire').map(p => [p.slug, p]));
    const apres = sets.map(s => {
        const p = ecrits.get(s._id); if (!p) return s;
        const { logoCompose, ...reste } = s;
        const vg = vignettes.get(`${p.dossier}/${p.fichier}`);
        return { ...reste, logo: { cleR2: p.cleR2, w: p.w, h: p.h, sha1: p.sha1, langue: p.langue, preuve: preuveDe(p, table.lu), ...(vg ? { vignette: vg } : {}) }, logoGenerique: false };
    });
    const [genAvant, genApres] = [generiquesAvant, site.empreintesGeneriques(apres)];
    const parSlugApres = new Map(apres.map(s => [s._id, s]));
    for (const p of plan.filter(p => p.action === 'ecrire')) {
        const s = parSlugApres.get(p.slug);
        const vg = vignettes.get(`${p.dossier}/${p.fichier}`);
        const attendu = `https://r2.test/${vg ? vg.cleR2 : p.cleR2}`;
        const refus = site.refusDuVisuelSet(s.logo, s, true, genApres);
        const v = site.logoDuSet(s, 'https://r2.test', genApres);
        if (refus !== null || v?.url !== attendu) { p.action = 'refus'; p.raison = `le site ne l'afficherait pas (${refus ?? `il afficherait ${v?.url ?? 'rien'} au lieu de ${attendu}`})`; }
    }
    for (const s of sets) {
        if (ecrits.has(s._id)) continue;
        const [a, b] = [site.logoDuSet(s, 'https://r2.test', genAvant)?.url ?? null, site.logoDuSet(parSlugApres.get(s._id), 'https://r2.test', genApres)?.url ?? null];
        if (a !== b) plan.push({ dossier: '—', fichier: '—', slug: s._id, action: 'refus', raison: `effet de bord : ${s._id} (non visé) afficherait ${b ?? 'rien'} au lieu de ${a ?? 'rien'}` });
    }
    return plan;
}

if (require.main === module) (async () => {
    const inconnus = process.argv.slice(2).filter(a => !AUTORISES.some(r => r.test(a)));
    if (inconnus.length) { console.error(`❌ argument inconnu : ${inconnus.join(' ')} — autorisés : --table=<json>, --ecrire`); process.exit(2); }
    if (!T) { console.error('❌ --table=<collecte-cartes/logos-apport-manuel-lus.json> requis'); process.exit(2); }
    const table = JSON.parse(fs.readFileSync(path.resolve(__dirname, T), 'utf8'));
    if (!Array.isArray(table.lignes) || !table.lignes.length || !table.lu) throw new Error('table illisible : `lignes` ou `lu` absent');
    // chaque fichier des dossiers a UNE ligne, et chaque ligne un fichier
    const parFichier = new Map();
    for (const d of Object.keys(DOSSIERS)) {
        if (!fs.existsSync(path.join(RACINE, d))) throw new Error(`dossier ${d} absent de apport-manuel/`);
        for (const f of fs.readdirSync(path.join(RACINE, d))) parFichier.set(`${d}/${f}`, { buf: fs.readFileSync(path.join(RACINE, d, f)) });
    }
    const cles = table.lignes.map(l => `${l.dossier}/${l.fichier}`);
    const sansLigne = [...parFichier.keys()].filter(k => !cles.includes(k));
    const enDouble = cles.filter((k, i) => cles.indexOf(k) !== i);
    if (sansLigne.length || enDouble.length) throw new Error(`table incomplète : ${sansLigne.length} fichier(s) sans ligne (${sansLigne.slice(0, 5).join(', ')}), ${enDouble.length} ligne(s) en double`);
    const site = await import(pathToFileURL(path.join(SITE, 'lib', 'visuelSet.ts')).href);
    const { cartes: cx, fermer } = await ouvrirConnexions({ production: false, buckets: ECRIRE ? ['R2_BUCKET_IMAGES'] : [] });
    const S = cx.db.collection('sets');
    const sets = await S.find({}, { projection: { code: 1, tirage: 1, region: 1, logo: 1, logoFr: 1, logoCompose: 1, logoGenerique: 1, 'bulba.pageid': 1 } }).toArray();
    if (!sets.length) throw new Error('collection sets vide : base fausse');
    // la vignette que l'écriture posera, fabriquée ici (rien n'est déposé) : la simulation du site la lit (relecture)
    const { fabriquerVignette, cleVignette, LARGEUR_VIGNETTE_LOGO } = require('./collecte-cartes/vignette');
    const vignettesFaites = new Map(), vignettes = new Map();
    for (const l of table.lignes.filter(l => l.decision === 'rattache')) {
        const k = `${l.dossier}/${l.fichier}`;
        const vg = await fabriquerVignette(parFichier.get(k).buf, { largeur: LARGEUR_VIGNETTE_LOGO, qualite: 85 });
        vignettesFaites.set(k, vg);
        vignettes.set(k, { cleR2: cleVignette(cleR2De(l)), w: vg.w, h: vg.h });
    }
    const plan = planifier(table, { parFichier, sets, site, vignettes });
    const compte = {}; for (const p of plan) compte[p.action] = (compte[p.action] || 0) + 1;
    console.log(`DÉNOMINATEUR : ${parFichier.size} fichiers · ${table.lignes.length} lignes (table lue le ${table.lu}) · ${sets.length} sets en base`);
    console.log(`PLAN : ${Object.entries(compte).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
    for (const p of plan.filter(p => p.action === 'refus').slice(0, 40)) console.log(`   🔴 REFUS ${p.dossier}/${p.fichier} → ${p.slug ?? '—'} : ${p.raison}`);
    const ecrire = plan.filter(p => p.action === 'ecrire');
    console.log(`   à écrire : ${ecrire.filter(p => aUneImage(p.set.logoCompose)).length} remplacent un logo composé · ${ecrire.filter(p => !aUneImage(p.set.logoCompose)).length} sans logo composé · ${ecrire.filter(p => aUneImage(p.set.logo)).length} remplacent un logo générique`);
    if (plan.some(p => p.action === 'refus')) { console.error('❌ des lignes sont refusées : rien n\'est écrit'); await fermer(); process.exit(1); }
    if (!ECRIRE) { console.log('(plan seul — --ecrire sous lot-additif.js)'); await fermer(); return; }

    const r2 = require('./collecte-cartes/r2');
    const bucket = process.env.R2_BUCKET_IMAGES;
    await r2.verifierBucket(bucket);
    let ecrits = 0;
    const touches = [];
    for (const p of ecrire) {
        await r2.deposerBinaire(bucket, p.cleR2, p.buf, 'image/png');
        const k = `${p.dossier}/${p.fichier}`, vg = vignettesFaites.get(k), cv = vignettes.get(k).cleR2;
        await r2.deposerBinaire(bucket, cv, vg.buffer, 'image/webp');
        const le = new Date();
        const logo = { cleR2: p.cleR2, w: p.w, h: p.h, octets: p.buf.length, sha1: p.sha1, fichier: `apport-manuel/${k}`, source: 'apport-manuel',
            langue: p.langue, langueLue: { le: table.lu, lu: p.lu }, preuve: preuveDe(p, table.lu), le, vignette: { cleR2: cv, w: vg.w, h: vg.h } };
        const ancienCompose = aUneImage(p.set.logoCompose) ? p.set.logoCompose : null;
        const ancienLogo = aUneImage(p.set.logo) ? p.set.logo : null;   // un logo GÉNÉRIQUE (seul cas admis par le plan)
        const pourquoi = `remplacé par le logo officiel apporté par le testeur (${logo.fichier})`;
        // le filtre relit l'état du PLAN — logo, composé ET logoFr (relecture : un logoFr apparu passerait devant) : rien d'apparu ou de
        // changé depuis n'est écrasé ni masqué
        const etat = (champ, v) => v ? { [`${champ}.cleR2`]: v.cleR2 } : { [`${champ}.cleR2`]: { $exists: false } };
        const filtre = { _id: p.slug, ...etat('logo', ancienLogo), ...etat('logoCompose', ancienCompose), ...etat('logoFr', aUneImage(p.set.logoFr) ? p.set.logoFr : null) };
        const maj = { $set: { logo, logoGenerique: false,
            ...(ancienCompose ? { logoComposeRetire: { ...ancienCompose, retireLe: le, pourquoi } } : {}),
            ...(ancienLogo ? { logoRemplace: { ...ancienLogo, remplaceLe: le, pourquoi } } : {}) },
            $unset: { logoCompose: '', logoRefus: '' } };
        const u = await S.updateOne(filtre, maj);
        if (u.modifiedCount === 1) { ecrits++; touches.push(p.slug); } else console.log(`   ⚠️ ${p.slug} : non écrit — le logo ou le composé a changé depuis le plan (fichiers déposés : ${p.cleR2})`);
    }
    // RELU : chaque set écrit, relu en base et passé à la règle du site
    const relus = await S.find({}, { projection: { code: 1, tirage: 1, region: 1, logo: 1, logoFr: 1, logoCompose: 1, logoGenerique: 1, 'bulba.pageid': 1 } }).toArray();
    const gen = site.empreintesGeneriques(relus);
    const parId = new Map(relus.map(s => [s._id, s]));
    const affiches = touches.filter(slug => { const s = parId.get(slug); return site.logoDuSet(s, 'https://r2.test', gen)?.url === `https://r2.test/${s.logo.vignette.cleR2}`; });
    console.log(`\n${ecrits === ecrire.length && affiches.length === ecrits ? '✅' : '🔴'} écrits ${ecrits} / ${ecrire.length} · RELU : ${affiches.length} affichent leur nouveau logo (vignette) selon la règle du site · ${await S.countDocuments({ 'logo.source': 'apport-manuel' })} sets portent un logo « apport-manuel » · ${await S.countDocuments({ 'logoCompose.cleR2': { $type: 'string' } })} logos composés restent`);
    console.log(`SETS : ${touches.join(',')}`);
    if (ecrits !== ecrire.length || affiches.length !== ecrits) process.exitCode = 1;
    await fermer();
})().catch(e => { console.error(e); process.exit(1); });

module.exports = { planifier };
