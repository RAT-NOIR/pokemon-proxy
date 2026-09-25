// ============================================================
// LES SETS DE RÉIMPRESSIONS — WCD et Prize Packs : le set en base, et l'appartenance des cartes déjà jointes
// ============================================================
//   node creer-sets-reimpressions.js            (mesure seule)
//   node creer-sets-reimpressions.js --ecrire   (par lot-additif.js ; puis rapatrier-noms-sets.js les nomme)
//
// 🔑 POURQUOI (2026-09-25) : 1 769 produits WCD sont joints à leur carte d'origine depuis le 23/09 (poser-wcd.js), 1 132 Prize
// Packs le sont par la même clé (poser-pps.js) — et le site n'en sert AUCUN : leur `slugSet` n'existe pas dans `sets` (demande
// du site, « PRIORITÉ 1 bis »). La règle du site, IMPORTÉE et testée : un document SANS impression de l'expansion du set reçoit
// UNE fiche sans numéro (`fichesDuDocument([])`), et une fiche sans numéro garde TOUS les produits de la carte dans ce set
// (`produitsDeLaFiche(…, [null])`). Il suffit donc : (1) du set, (2) du slug dans `cartes.sets` des cartes jointes. La fiche dit
// la bonne carte, sans numéro affiché — le numéro imprimé est celui du tirage d'origine, et le code du slug (« PPS1BST-096 »)
// n'est pas celui du set : le site ne saurait pas le lire, et on ne l'invente pas.
// ⚠️ `bulba.expansion` reste NULL : une expansion déclarée par la carte y ferait naître les fiches du tirage d'ORIGINE sous ce set.
// ⚠️ Aucune image : le visuel d'une réimpression (bordure WCD, tampon Prize Pack) n'est pas celui du tirage d'origine (§19).
// ⚠️ `poser-wcd.js` refusait d'écrire `cartes.sets` « sans document sets » — c'était la bonne décision SANS set ; ce geste crée
// le set dans le même lot, et un set sans ligne de table n'entre dans aucune file (l'alimentateur l'écarte : « aucune ligne »).
require('dotenv').config();
const { ouvrirConnexions } = require('./collecte-cartes/garde');
const { lireMongo } = require('./collecte-cartes/lecture-sure');

const ROUTES = { 'wcd+origine+numero': 'wcd', 'wcd+nom+numero': 'wcd', 'pps+origine+numero': 'pps' };

(async () => {
    const ecrire = process.argv.includes('--ecrire');
    const { cartes: cx, prod, fermer } = await ouvrirConnexions({ production: true, buckets: [] });
    const lignes = await lireMongo(cx.db.collection('cartes_produits'), { preuve: { $in: Object.keys(ROUTES) } }, { nom: 'cartes_produits (réimpressions)', projection: { carteId: 1, idProduct: 1, idExpansion: 1, slugSet: 1, preuve: 1 } });
    // L'expansion d'un produit est celle du CATALOGUE : 21 produits WCD-2018 portent encore 1645 dans nos lignes, le catalogue dit 2396.
    const expCat = new Map((await prod.db.collection('catalogue_produits').find({ idProduct: { $in: lignes.map(l => l.idProduct) } }, { projection: { idProduct: 1, idExpansion: 1 } }).toArray()).map(p => [p.idProduct, p.idExpansion]));
    const parSet = new Map();
    for (const l of lignes) {
        if (!l.slugSet) continue;
        const e = parSet.get(l.slugSet) || parSet.set(l.slugSet, { slug: l.slugSet, exps: new Set(), cartes: new Set(), route: ROUTES[l.preuve], lignes: 0 }).get(l.slugSet);
        e.exps.add(expCat.get(l.idProduct) ?? l.idExpansion); e.cartes.add(l.carteId); e.lignes++;
    }
    const existants = new Set((await cx.db.collection('sets').find({ _id: { $in: [...parSet.keys()] } }, { projection: { _id: 1 } }).toArray()).map(s => s._id));
    const codeDe = new Map();
    for (const x of await prod.db.collection('numeros_cartes').aggregate([{ $match: { slugSet: { $in: [...parSet.keys()] }, codeSet: { $nin: [null, ''] } } }, { $group: { _id: { s: '$slugSet', c: '$codeSet' }, n: { $sum: 1 } } }, { $sort: { n: -1 } }]).toArray())
        if (!codeDe.has(x._id.s)) codeDe.set(x._id.s, x._id.c);
    console.log(`\n════ DÉNOMINATEUR : ${lignes.length} lignes de réimpression · ${parSet.size} sets · déjà en base ${existants.size} ════`);
    const multi = [...parSet.values()].filter(e => e.exps.size !== 1);
    if (multi.length) throw new Error(`ARRÊT : ${multi.length} slugSet portent plusieurs idExpansion (${multi.map(e => e.slug).join(', ')}) — on ne devine pas`);
    const aCreer = [...parSet.values()].filter(e => !existants.has(e.slug));
    for (const e of [...parSet.values()].sort((a, b) => a.slug.localeCompare(b.slug))) console.log(`   ${existants.has(e.slug) ? '·' : '+'} ${e.slug.padEnd(40)} ${e.route} · exp ${[...e.exps][0]} · code ${codeDe.get(e.slug) ?? '—'} · ${e.lignes} lignes · ${e.cartes.size} cartes`);
    const nCartes = [...parSet.values()].reduce((s, e) => s + e.cartes.size, 0);
    if (!ecrire) { console.log(`\n   ${aCreer.length} sets à créer · ${nCartes} appartenances cartes.sets à poser (additif) — (mesure seule, relancer avec --ecrire)`); await fermer(); return; }
    let crees = 0, poses = 0;
    for (const e of aCreer) {
        const r = await cx.db.collection('sets').updateOne({ _id: e.slug }, { $setOnInsert: {
            code: codeDe.get(e.slug) ?? e.slug, idExpansion: [...e.exps], nomEn: null, nomJa: null, nomJaTraduit: null, region: 'intl', tirage: 'intl', totalImprime: null,
            reimpressions: e.route, bulba: { titre: null, expansion: null, motifTitres: `réimpressions (${e.route}) : produits joints à leur carte d'origine par le slug Cardmarket — fiche sans numéro, sans visuel` },
            collecteLe: new Date(), version: 1 } }, { upsert: true });
        crees += r.upsertedCount;
    }
    for (const e of parSet.values()) {
        const r = await cx.db.collection('cartes').updateMany({ _id: { $in: [...e.cartes] } }, { $addToSet: { sets: e.slug } });
        poses += r.modifiedCount;
    }
    const relus = await cx.db.collection('sets').countDocuments({ reimpressions: { $in: ['wcd', 'pps'] } });
    console.log(`\n   ✅ sets créés ${crees} (relus avec \`reimpressions\` : ${relus}) · cartes modifiées ${poses} (appartenances ajoutées, jamais retirées)`);
    await fermer();
})().catch(e => { console.error(e); process.exit(1); });
