// node test-relire-lot-metacarte.js — la relecture finale de poser-par-metacarte.js compte ce que CE lancement a écrit, pas le total de la preuve.
// SUR LA BASE EN MÉMOIRE (base-banc.js), jamais sur la production. Cas réel du 2026-10-08 : 131 écrites + 39 du 2026-10-06 = 170 relues « pour 131 ».
// Lancer : MONGOMS_DOWNLOAD_DIR=<dépôt principal>/.banc-local/cache-mongod node test-relire-lot-metacarte.js
require('dotenv').config();
const mongoose = require('mongoose');
const { ouvrirBanc } = require('./collecte-cartes/base-banc');
const { relireLot } = require('./collecte-cartes/relire-lot-metacarte');

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); }
};
const PREUVE = 'metacarte+nom+attaques';
const ligne = (carteId, idProduct, route, verifieLe, preuve = PREUVE) => ({ _id: `${carteId}|${idProduct}`, carteId, idProduct, preuve, route, verifieLe });

async function main() {
    const banc = await ouvrirBanc(); banc.appliquer();
    const cx = await mongoose.createConnection(banc.uri, { dbName: 'banc_relire_lot' }).asPromise();
    try {
        const col = cx.db.collection('cartes_produits');
        const ancien = new Date('2026-10-06T10:00:00Z'), le = new Date('2026-10-08T21:21:00Z');
        // 39 lignes de MÊME preuve et MÊMES codes, écrites le 2026-10-06 ; 131 du lot de ce lancement ; 1 ligne de même preuve dans un AUTRE code ; 1 d'une autre preuve
        await col.insertMany(Array.from({ length: 39 }, (_, i) => ligne(1000 + i, 5000 + i, 'CBB3C', ancien)));
        await col.insertMany(Array.from({ length: 131 }, (_, i) => ligne(2000 + i, 6000 + i, i % 2 ? 'CBB3C' : 'CBB4C', le)));
        await col.insertOne(ligne(3000, 7000, 'CSVL2C', le));
        await col.insertOne(ligne(3001, 7001, 'CBB3C', le, 'set+numero'));
        const idsDuLot = Array.from({ length: 131 }, (_, i) => `${2000 + i}|${6000 + i}`);

        const total = await col.countDocuments({ preuve: PREUVE, route: { $in: ['CBB3C', 'CBB4C'] } });
        verifier('prémisse : l\'ancienne relecture (le total de la preuve dans ces codes) rend 170, pas 131', total, 170);

        const r = await relireLot(col, { codes: ['CBB3C', 'CBB4C'], ids: idsDuLot, le });
        verifier('la relecture compte les 131 écrites par CE lancement (attendu 131)', r.ecrites, 131);
        verifier('elle nomme les 39 déjà présentes avant, de même preuve et mêmes codes', r.dejaAvant, 39);
        verifier('et le total relu (170) reste imprimable', r.total, 170);

        // une ligne du lot dont l'insertion a échoué : la relecture doit le voir (131 attendu, 130 relues)
        await col.deleteOne({ _id: idsDuLot[0] });
        const r2 = await relireLot(col, { codes: ['CBB3C', 'CBB4C'], ids: idsDuLot, le });
        verifier('une ligne du lot manquante fait tomber le compte à 130 (la relecture peut échouer dans le cas redouté)', r2.ecrites, 130);

        // une ligne du lot déjà là AVANT (même _id, verifieLe ancien : $setOnInsert ne l'a pas réécrite) n'est pas comptée comme écrite par ce lancement
        await col.updateOne({ _id: idsDuLot[1] }, { $set: { verifieLe: ancien } });
        const r3 = await relireLot(col, { codes: ['CBB3C', 'CBB4C'], ids: idsDuLot, le });
        verifier('une ligne du lot à verifieLe antérieur n\'est pas comptée comme écrite par ce lancement', r3.ecrites, 129);
    } finally {
        await cx.close().catch(() => { });
        await banc.arreter().catch(() => { });
    }
    console.log(`\n${ok} passés, ${ko} en échec (dénominateur : ${ok + ko})`);
    process.exit(ko ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
