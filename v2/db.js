'use strict';
// Accès aux collections v2. En production le préfixe est '' (collections neuves, noms nus). En test il vaut
// "rm_t<aléa>_", posé UNIQUEMENT par le harnais, et col() REFUSE de l'utiliser hors de la base test_scratch :
// un préfixe oublié ne peut pas viser la production, et deux bancs lancés en même temps ne se voient pas.
const mongoose = require('mongoose');
const { verifierHoteBanc } = require('../collecte-cartes/garde-banc');   // sans dépendance : la production peut le charger
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
// 🔑 Écrit par ce qu'elle AUTORISE (INT2, décision du testeur 2026-10-08 : aucun banc n'écrit dans la grappe de production) : un préfixe de test
// n'est servi que si BANC_ISOLE=1 ET si TOUS les hôtes de la connexion de la base sont des hôtes du banc (BANC_HOTES). Le nom `test_scratch` ne suffit
// pas : il existe aussi sur la production. Hôte illisible, variable absente, exception : refus.
function exigerBaseDeBanc(db) {
    const hs = db?.client?.options?.hosts;
    const hotes = Array.isArray(hs) ? hs.map(h => h && typeof h.host === 'string' ? h.host : null) : [];
    const garde = !hotes.length || hotes.includes(null) ? { ok: false, raison: 'hôte de la base inconnu (aucun client lisible)' }
        : process.env.BANC_ISOLE !== '1' ? { ok: false, raison: 'BANC_ISOLE n\'est pas posé : ce n\'est pas une base de banc' }
            : verifierHoteBanc(`mongodb://${hotes.join(',')}/`);
    if (!garde.ok) throw new Error(`base de banc refusée : ${garde.raison} — un banc v2 n'écrit jamais ailleurs que sur la base de banc (refus)`);
}
function col(nom) {
    const db = base();
    if (prefixe && db.databaseName !== 'test_scratch') throw new Error(`préfixe de test refusé sur la base "${db.databaseName}"`);
    if (prefixe) exigerBaseDeBanc(db);
    return db.collection(prefixe + nom);
}
async function viderPrefixe() {
    const db = base();
    if (!prefixe) throw new Error('viderPrefixe : aucun préfixe de test posé (refus : on ne vide jamais des collections nues)');
    if (db.databaseName !== 'test_scratch') throw new Error(`viderPrefixe refusé sur la base "${db.databaseName}"`);
    exigerBaseDeBanc(db);
    // Une écriture ou un createIndex lancé sans attente peut se poser APRÈS un passage et recréer la collection : on repasse
    // (après une courte pose) jusqu'à ce qu'un passage ne trouve plus rien, et on LÈVE si le préfixe ne se vide pas.
    let total = 0;
    const lister = async () => (await db.listCollections({}, { nameOnly: true }).toArray()).map(c => c.name).filter(n => n.startsWith(prefixe));
    for (let passe = 0; passe < 10; passe++) {
        const noms = await lister();
        if (!noms.length) return total;                     // déjà vide (ou vidé et reconfirmé vide après la pose) : rien à attendre
        for (const n of noms) { try { await db.collection(n).drop(); total++; } catch (e) { if (e.codeName !== 'NamespaceNotFound' && e.code !== 26) throw e; } }
        await new Promise(r => setTimeout(r, 200));
    }
    if (!(await lister()).length) return total;             // la dernière pose a pu suffire : relire avant de lever
    throw new Error(`viderPrefixe : le préfixe ${prefixe} ne se vide pas (écritures tardives qui recréent des collections)`);
}
module.exports = { col, base, brancher, definirPrefixe, viderPrefixe, prefixeCourant: () => prefixe };
