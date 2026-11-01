'use strict';
// OUTIL D'EXPLOITATION — INITIALISER LA BASE DÉDIÉE DE LA COMMUNAUTÉ (lancé UNE fois, à la main, par un administrateur ; jamais par le serveur).
//   node v2/galerie/outils/initialiser-base.js --confirmer-initialisation
// Il pose, sur la base `rm_galerie_essai` de la grappe déclarée (MONGO_URI_GALERIE + V2_GALERIE_GRAPPE, jugées par la même garde que le serveur : grappes connues exclues), les index puis le document MARQUEUR
// `galerie_meta` / `marqueur`. C'est le SEUL fichier qui écrit ce marqueur ; sans lui le serveur refuse de brancher la Communauté (cause « marqueur-absent »).
// Écrit par ce qu'il AUTORISE : il REFUSE une base qui porte une collection hors de la liste fermée (c'est peut-être une base de production qu'un alias DNS désigne : on ne la marque pas).
// Idempotent : un marqueur déjà posé n'est pas réécrit. Il ne crée ni projet Atlas, ni grappe, ni utilisateur : il n'écrit que dans la base dédiée DÉJÀ déclarée.
const { BASE_GALERIE } = require('../grappe');
const { COLLECTIONS, creerIndex } = require('../base');

/** @param {import('mongodb').Db} db la base dédiée. @returns {Promise<{ok:boolean, cause?:string, detail?:string[], deja?:boolean}>} */
async function initialiserBase(db) {
    if (!db || db.databaseName !== BASE_GALERIE) return { ok: false, cause: 'grappe-differente' };
    const noms = (await db.listCollections({}, { nameOnly: true }).toArray()).map(c => c.name).filter(n => !n.startsWith('system.'));
    const etrangeres = noms.filter(n => !COLLECTIONS.includes(n));
    if (etrangeres.length) return { ok: false, cause: 'collection-inconnue', detail: etrangeres };
    await creerIndex(db);
    const existant = await db.collection('galerie_meta').findOne({ _id: 'marqueur' });
    if (existant) return { ok: true, deja: true };
    await db.collection('galerie_meta').insertOne({ _id: 'marqueur', galerie: true, base: BASE_GALERIE, version: 1, poseLe: new Date() });
    return { ok: true };
}

async function main(argv, env = process.env) {
    if (!argv.includes('--confirmer-initialisation') || argv.some(a => a !== '--confirmer-initialisation')) { console.error('❌ usage : node v2/galerie/outils/initialiser-base.js --confirmer-initialisation (aucun autre argument)'); return 1; }
    const { ouvrir } = require('../grappe');
    let o;
    try { o = await ouvrir({ env, verifierLaBase: false }); } catch (e) { console.error(`❌ base dédiée refusée — cause : ${(e && e.cause) || 'inconnue'}`); return 1; }
    try {
        const r = await initialiserBase(o.db);
        if (!r.ok) { console.error(`❌ initialisation refusée — cause : ${r.cause}${r.detail ? ` (${r.detail.join(', ')})` : ''}`); return 1; }
        console.log(r.deja ? '✅ la base dédiée porte déjà son marqueur (rien réécrit)' : '✅ marqueur posé sur la base dédiée');
        return 0;
    } finally { await o.fermer(); }
}
if (require.main === module) {
    require('dotenv').config();
    main(process.argv.slice(2)).then(c => process.exit(c)).catch(() => { console.error('❌ échec de l\'initialisation'); process.exit(1); });
}
module.exports = { initialiserBase, main };
