'use strict';
// Accès aux collections v2. En production le préfixe est '' (collections neuves, noms nus). En test il vaut
// "rm_t<aléa>_", posé UNIQUEMENT par le harnais, et col() REFUSE de l'utiliser hors de la base test_scratch :
// un préfixe oublié ne peut pas viser la production, et deux bancs lancés en même temps ne se voient pas.
const mongoose = require('mongoose');
const FORME_PREFIXE = /^rm_t[0-9a-z]{6,}_$/;
let prefixe = '';
let dbInjectee = null;

function definirPrefixe(p) {
    if (p !== '' && !FORME_PREFIXE.test(p)) throw new Error(`préfixe refusé : "${p}"`);
    prefixe = p;
}
function brancher(db) { dbInjectee = db; }
function base() {
    const db = dbInjectee || mongoose.connection.db;
    if (!db) throw new Error('v2/db : aucune connexion Mongo');
    return db;
}
function col(nom) {
    const db = base();
    if (prefixe && db.databaseName !== 'test_scratch') throw new Error(`préfixe de test refusé sur la base "${db.databaseName}"`);
    return db.collection(prefixe + nom);
}
async function viderPrefixe() {
    const db = base();
    if (!prefixe) throw new Error('viderPrefixe : aucun préfixe de test posé (refus : on ne vide jamais des collections nues)');
    if (db.databaseName !== 'test_scratch') throw new Error(`viderPrefixe refusé sur la base "${db.databaseName}"`);
    // Une écriture ou un createIndex lancé sans attente peut se poser APRÈS un passage et recréer la collection : on repasse
    // (après une courte pose) jusqu'à ce qu'un passage ne trouve plus rien, et on LÈVE si le préfixe ne se vide pas.
    let total = 0;
    for (let passe = 0; passe < 10; passe++) {
        const noms = (await db.listCollections({}, { nameOnly: true }).toArray()).map(c => c.name).filter(n => n.startsWith(prefixe));
        if (!noms.length && passe > 0) return total;
        for (const n of noms) { try { await db.collection(n).drop(); total++; } catch (e) { if (e.codeName !== 'NamespaceNotFound' && e.code !== 26) throw e; } }
        await new Promise(r => setTimeout(r, 200));
    }
    throw new Error(`viderPrefixe : le préfixe ${prefixe} ne se vide pas (écritures tardives qui recréent des collections)`);
}
module.exports = { col, base, brancher, definirPrefixe, viderPrefixe, prefixeCourant: () => prefixe };
