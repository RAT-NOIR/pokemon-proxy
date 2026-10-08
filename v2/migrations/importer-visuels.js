'use strict';
// USAGE : node v2/migrations/importer-visuels.js --depuis=<fichier JSON> --base=test_scratch
//         node v2/migrations/importer-visuels.js --depuis=<fichier JSON> --base=test --confirmer-production   (PRODUCTION : jamais lancé par un lot)
// ADDITIF : upsert par idProduct, rien n'est effacé. Imprime ses dénominateurs. Un fichier dont les champs attendus manquent ARRÊTE le script.
// Format attendu (tableau, ou objet { "<idProduct>": entrée }) : { idProduct, vignette:{cle,w,h}, grande:{cle,w,h}|null, visuel?, mention? }.
const db = require('../db');
const { lireEntree } = require('../identifier/visuels');

/** @param entrees tableau d'entrées -> { lus, importes, refuses, motifs } */
async function importerVisuels(entrees) {
    const motifs = {}, parId = new Map();
    let refuses = 0;
    for (const e of entrees) {
        const r = lireEntree(e);
        if (!r.ok) { refuses++; motifs[r.motif] = (motifs[r.motif] || 0) + 1; continue; }
        parId.set(r.doc.idProduct, r.doc);                                    // un doublon dans le lot : le dernier gagne
    }
    const ops = [...parId.values()].map(doc => ({ updateOne: { filter: { idProduct: doc.idProduct }, update: { $set: doc }, upsert: true } }));
    if (ops.length) await db.col('visuels').bulkWrite(ops, { ordered: false });
    return { lus: entrees.length, importes: parId.size, refuses, motifs };
}
const resume = r => `${r.lus} lus, ${r.importes} importés, ${r.refuses} refusés${r.refuses ? ` (${Object.entries(r.motifs).map(([m, n]) => `${m} : ${n}`).join(' ; ')})` : ''}`;

/** Le fichier doit porter les champs attendus : sinon on s'arrête (on n'invente ni clé ni dimension). */
function entreesDuFichier(json) {
    const liste = Array.isArray(json) ? json : (json && typeof json === 'object' ? Object.entries(json).map(([k, v]) => (v && typeof v === 'object' && !Array.isArray(v) ? { idProduct: Number(k), ...v } : null)) : null);
    if (!liste || !liste.length) throw new Error('fichier vide ou de forme inconnue (tableau ou objet idProduct -> entrée attendu)');
    const manque = c => !liste.some(e => e && typeof e === 'object' && e[c] !== undefined);
    for (const c of ['idProduct', 'vignette']) if (manque(c)) throw new Error(`champ "${c}" introuvable dans le fichier : rien n'est importé`);
    return liste.map(e => e || {});
}

module.exports = { importerVisuels, resume, entreesDuFichier };

if (require.main === module) {
    (async () => {
        const arg = n => { const a = process.argv.find(x => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : null; };
        const depuis = arg('depuis'), base = arg('base');
        if (!depuis) { console.error('❌ ARRÊT : --depuis=<fichier JSON> est requis'); process.exit(1); }
        // refus AVANT toute connexion : la production ne s'écrit que sur confirmation explicite
        if (base === 'test' && !process.argv.includes('--confirmer-production')) {
            console.error('❌ ARRÊT : --base=test est la PRODUCTION ; relance avec --confirmer-production (un lot ne le fait jamais)'); process.exit(1);
        }
        let entrees;
        try { entrees = entreesDuFichier(JSON.parse(require('fs').readFileSync(depuis, 'utf8'))); }
        catch (e) { console.error(`❌ ARRÊT : ${e.message}`); process.exit(1); }
        const { connecterMongo } = require('../../mongo-connexion');
        const mongoose = require('mongoose');
        const nom = await connecterMongo({ script: 'v2/migrations/importer-visuels.js', ecrit: true, confirmationProduction: true });
        db.brancher(mongoose.connection.db);
        const r = await importerVisuels(entrees);
        console.log(`import dans "${nom}" : ${resume(r)}`);
        await mongoose.disconnect();
        process.exit(0);
    })().catch(e => { console.error('❌', e.message); process.exit(1); });
}
