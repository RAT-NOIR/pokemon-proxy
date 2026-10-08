'use strict';
// USAGE : node v2/migrations/importer-visuels.js --depuis=<fichier JSON>                                   SIMULATION : valide, compte, estime la taille ; n'ouvre aucune connexion
//         node v2/migrations/importer-visuels.js --depuis=<fichier JSON> --base=test_scratch --ecrire
//         node v2/migrations/importer-visuels.js --depuis=<fichier JSON> --base=test --ecrire --confirmer-production   (PRODUCTION : jamais lancé par un lot)
// ADDITIF : upsert par idProduct, rien n'est effacé. Imprime ses dénominateurs (lus, importés, refusés avec motifs, doublons).
// --base : `test` ou `test_scratch` SEULEMENT (la base `cartes` est une autre grappe que l'API ne lit ni n'écrit jamais).
// --ecrire REFUSE si la grappe passerait au-dessus de 470 Mo (arrêt dur à 480) ; --plafond-mo=N peut l'ABAISSER, jamais le relever.
//
// ── CONTRAT DU FICHIER ATTENDU ────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Un tableau, ou un objet { "<idProduct>": entrée }. L'EXPORTER qui le produit est la tâche B1b.4b (non écrite : aucune source actuelle
// n'émet ce format ; exporter-donnees-logos-site.js émet `image:{cleR2, vignette:<chaîne>}` sans `grande` ni w/h, et
// table-maitresse-produits.json ne porte que { idProduct: [idExpansion, cause] }). Chaque champ, son type, d'où il viendra :
//   idProduct   entier > 0        le produit Cardmarket (cartes_produits.idProduct)
//   vignette    { cle, w, h }     OBLIGATOIRE. cle = chemin R2 relatif (sans "://", "..", "cardmarket", segment vide ou ".") ; w,h entiers > 0
//                                 <- cartes.images[].vignette.cleR2 + ses dimensions mesurées (cartes.images[].w/h = dimensions de l'ORIGINAL,
//                                 pas de la vignette : à lire sur la vignette elle-même)
//   grande      { cle, w, h }|null  <- cartes.images[].cleR2, w, h (l'original) ; null si le visuel n'a pas de grande version
//   visuel      'du-set'|'substitut'|'autre-tirage'   (défaut 'du-set') <- logique du site (visuelDuProduit / visuelSubstitut / visuelAutreTirage)
//   mention     texte|null        <- cartes_produits.visuelSubstitut.mention ; OBLIGATOIRE et non vide si visuel != 'du-set'
//   idMetacard  entier|null       PRÉSENT (null admis) <- catalogue Cardmarket (catalogue_produits.idMetacard)
//   numero      texte|null        PRÉSENT <- numéro de la FICHE (cartes_produits.numeroFiche)
//   rarete      texte|null        PRÉSENT <- cartes.impressions[].rarete de la carte, au numéro de la fiche ; null si non lue, JAMAIS devinée
//   total       texte|null        PRÉSENT <- cartes.impressions[].total si connu, sinon null
//   variante    texte|null        optionnel <- une valeur de la liste du contrat (premiere-edition, holo…), sinon null (V1/V2 n'a pas de sémantique)
//   setNom      texte|null        optionnel <- sets.nomAffichage du set de la fiche
//   lien        https://www.cardmarket.com/…|null   optionnel <- construit à l'export depuis slugSet/slug ; servi seulement si numero ET rarete sont connus
// Un champ PRÉSENT-obligatoire absent de TOUT le fichier arrête le script ; absent d'une entrée, il la refuse (« absent » n'est pas « non lu »).
const { lireEntree, CHAMPS_IMPRESSION } = require('../identifier/visuels');

const PLAFOND_OCTETS = 470e6;                 // arrêt dur de la grappe : 480 Mo
const OCTETS_INDEX_PAR_DOCUMENT = 120;        // ESTIMATION : _id + idProduct (unique) + idMetacard, ~40 o d'entrée chacun (à confirmer par mesure réelle)

/** @param entrees tableau d'entrées -> { lus, importes, refuses, doublons, motifs, docs } ; n'écrit rien. */
function preparer(entrees) {
    const motifs = {}, parId = new Map();
    let refuses = 0, doublons = 0;
    for (const e of entrees) {
        const r = lireEntree(e);
        if (!r.ok) { refuses++; motifs[r.motif] = (motifs[r.motif] || 0) + 1; continue; }
        if (parId.has(r.doc.idProduct)) doublons++;
        parId.set(r.doc.idProduct, r.doc);                                    // un doublon dans le lot : le dernier gagne
    }
    return { lus: entrees.length, importes: parId.size, refuses, doublons, motifs, docs: [...parId.values()] };
}
async function importerVisuels(entrees) {
    const { docs, ...r } = preparer(entrees);
    const db = require('../db');
    const ops = docs.map(doc => ({ updateOne: { filter: { idProduct: doc.idProduct }, update: { $set: doc }, upsert: true } }));
    if (ops.length) await db.col('visuels').bulkWrite(ops, { ordered: false });
    return r;
}
const resume = r => `${r.lus} lus, ${r.importes} importés, ${r.refuses} refusés${r.refuses ? ` (${Object.entries(r.motifs).map(([m, n]) => `${m} : ${n}`).join(' ; ')})` : ''}`
    + (r.doublons ? `, ${r.doublons} doublon${r.doublons > 1 ? 's' : ''} d'idProduct dans le lot (le dernier gagne)` : '');

/** ESTIMATION de ce que l'import ajoute : taille moyenne mesurée sur les documents (BSON) × N, plus une provision d'index. */
function estimerAjout(docs) {
    const { BSON } = require('mongodb');
    const n = docs.length;
    const octetsDocs = docs.reduce((s, d) => s + BSON.calculateObjectSize({ _id: new BSON.ObjectId(), ...d }), 0);
    const octetsIndex = n * OCTETS_INDEX_PAR_DOCUMENT;
    return { n, moyenne: n ? Math.round(octetsDocs / n) : 0, octetsDocs, octetsIndex, total: octetsDocs + octetsIndex };
}
/** Écrite par ce qu'elle AUTORISE : { ok:true } seulement si la taille actuelle ET l'ajout sont des nombres finis et que la somme tient sous le plafond. */
function garderTaille({ actuel, ajout, plafond = PLAFOND_OCTETS } = {}) {
    const nombre = x => typeof x === 'number' && Number.isFinite(x) && x >= 0;
    if (!nombre(actuel)) return { ok: false, raison: 'taille actuelle de la grappe illisible : je ne peux pas conclure, donc je refuse' };
    if (!nombre(ajout)) return { ok: false, raison: 'estimation de l\'ajout illisible : je refuse' };
    const limite = nombre(plafond) ? Math.min(plafond, PLAFOND_OCTETS) : PLAFOND_OCTETS;
    if (actuel + ajout > limite) return { ok: false, raison: `plafond dépassé : ${mo(actuel)} Mo + ${mo(ajout)} Mo > ${mo(limite)} Mo` };
    return { ok: true, limite };
}
const mo = o => (o / 1e6).toFixed(2);
/** Taille de la grappe de l'API (bases test + test_scratch) : données + index, comme mesurer-taille-bases.js. NaN si illisible. */
async function tailleGrappe(mongoose) {
    try {
        const client = mongoose.connection.getClient();
        let total = 0;
        for (const nom of ['test', 'test_scratch']) { const s = await client.db(nom).command({ dbStats: 1 }); total += s.dataSize + s.indexSize; }
        return total;
    } catch { return NaN; }
}

/** Le fichier doit porter les champs attendus : sinon on s'arrête (on n'invente ni clé ni dimension). */
function entreesDuFichier(json) {
    const liste = Array.isArray(json) ? json : (json && typeof json === 'object' ? Object.entries(json).map(([k, v]) => (v && typeof v === 'object' && !Array.isArray(v) ? { idProduct: Number(k), ...v } : null)) : null);
    if (!liste || !liste.length) throw new Error('fichier vide ou de forme inconnue (tableau ou objet idProduct -> entrée attendu)');
    const manque = c => !liste.some(e => e && typeof e === 'object' && e[c] !== undefined);
    for (const c of ['idProduct', 'vignette', ...CHAMPS_IMPRESSION]) if (manque(c)) throw new Error(`champ "${c}" introuvable dans le fichier : rien n'est importé`);
    return liste.map(e => e || {});
}

module.exports = { importerVisuels, preparer, resume, entreesDuFichier, estimerAjout, garderTaille, PLAFOND_OCTETS };

if (require.main === module) {
    (async () => {
        const arg = n => { const a = process.argv.find(x => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : null; };
        const stop = m => { console.error(`❌ ARRÊT : ${m}`); process.exit(1); };
        const depuis = arg('depuis'), base = arg('base'), ecrire = process.argv.includes('--ecrire');
        if (!depuis) stop('--depuis=<fichier JSON> est requis');
        if (ecrire) {
            // refus AVANT toute connexion, écrit par ce qu'il AUTORISE : deux bases, la production seulement sur confirmation explicite
            if (base !== 'test' && base !== 'test_scratch') stop('--base doit valoir test_scratch ou test (la base cartes est une autre grappe, que l\'API n\'écrit jamais)');
            if (base === 'test' && !process.argv.includes('--confirmer-production')) stop('--base=test est la PRODUCTION ; relance avec --confirmer-production (un lot ne le fait jamais)');
        }
        let plafond = PLAFOND_OCTETS;
        if (arg('plafond-mo') !== null) { const p = Number(arg('plafond-mo')) * 1e6; if (!Number.isFinite(p) || p <= 0) stop('--plafond-mo illisible'); plafond = Math.min(p, PLAFOND_OCTETS); }
        let entrees;
        try { entrees = entreesDuFichier(JSON.parse(require('fs').readFileSync(depuis, 'utf8'))); } catch (e) { stop(e.message); }
        const p = preparer(entrees), est = estimerAjout(p.docs);
        console.log(`${ecrire ? 'import' : 'simulation'} : ${resume(p)}`);
        console.log(`estimation de l'ajout à la grappe : ${est.n} documents × ${est.moyenne} o (moyenne mesurée) = ${mo(est.octetsDocs)} Mo + index ~${mo(est.octetsIndex)} Mo (provision de ${OCTETS_INDEX_PAR_DOCUMENT} o/document, à confirmer) = ~${mo(est.total)} Mo ; plafond ${mo(plafond)} Mo`);
        if (!ecrire) { console.log('(simulation : rien n\'est écrit ; ajoute --base=… --ecrire pour importer)'); process.exit(0); }
        const { connecterMongo } = require('../../mongo-connexion');
        const mongoose = require('mongoose');
        const db = require('../db'), { creerIndex } = require('../modeles');
        const nom = await connecterMongo({ script: 'v2/migrations/importer-visuels.js', ecrit: true, confirmationProduction: true });
        db.brancher(mongoose.connection.db);
        const actuel = await tailleGrappe(mongoose);
        console.log(`taille actuelle de la grappe (test + test_scratch, données + index) : ${Number.isFinite(actuel) ? mo(actuel) + ' Mo' : 'illisible'}`);
        const g = garderTaille({ actuel, ajout: est.total, plafond });
        if (!g.ok) { await mongoose.disconnect(); stop(`${g.raison} (plafond ${mo(plafond)} Mo) — rien n'est écrit`); }
        await creerIndex();
        const r = await importerVisuels(entrees);
        console.log(`import dans "${nom}" : ${resume(r)}`);
        await mongoose.disconnect();
        process.exit(0);
    })().catch(e => { console.error('❌', e.message); process.exit(1); });
}
