// node mesurer-atlas.js — LECTURE SEULE : le pourcentage des DEUX grappes Atlas (production : MONGODB_URI ; collecte : MONGODB_CARTES_URI),
// leurs 5 plus grosses collections, et un code de sortie NON NUL à 90 % de 512 Mo ou plus (ou si une mesure est impossible).
// Aucune écriture (listDatabases, dbStats, collStats), aucune URI ni secret imprimé (les erreurs passent par un masque).
require('dotenv').config();
const T = require('./collecte-cartes/garde-taille-atlas');
const MO = 1048576;
const f = x => (x / MO).toFixed(1).replace('.', ',');
const masquer = m => String(m).replace(/mongodb(\+srv)?:\/\/\S+/g, '<uri masquée>').slice(0, 200);

/** Les n plus grosses collections (données + index), toutes bases de la grappe. client : un MongoClient ouvert. */
async function plusGrosses(client, n = 5) {
    const lignes = [];
    for (const b of (await T.mesurerGrappe(client)).detail.bases) {
        const d = client.db(b.nom);
        for (const c of await d.listCollections({}, { nameOnly: true }).toArray()) {
            try { const s = await d.command({ collStats: c.name }); lignes.push({ base: b.nom, coll: c.name, docs: s.count, octets: (s.size || 0) + (s.totalIndexSize || 0), index: s.totalIndexSize || 0 }); }
            catch { lignes.push({ base: b.nom, coll: c.name, docs: -1, octets: 0, index: 0 }); }
        }
    }
    return lignes.sort((a, b) => b.octets - a.octets).slice(0, n);
}

/** Imprime une grappe ; rend le code de sortie (0 sous 90 %, 1 sinon ou si la mesure est impossible). */
async function rapporter(nom, client, ecrire = console.log) {
    let m;
    try { m = await T.mesurerGrappe(client); } catch (e) { ecrire(`🔴 grappe ${nom} : mesure impossible (${masquer(e.message)})`); return 1; }
    const j = T.juger({ mesure: m });
    ecrire(`${j.autorise ? (j.niveau === 'alerte' ? '⚠️ ' : '✅') : '🔴'} grappe ${nom} : ${m.pourcent.toFixed(1)} % de ${T.LIMITE_MO} Mo (données+index ${f(m.detail.donneesIndexMo * MO)} Mo ; stockage+index ${f(m.detail.stockageIndexMo * MO)} Mo ; retenu ${f(m.mo * MO)} Mo) — ${j.niveau}`);
    for (const b of m.detail.bases) ecrire(`   base ${b.nom} : données+index ${f(b.donneesIndexMo * MO)} Mo`);
    try { for (const l of await plusGrosses(client)) ecrire(`   ${l.base}.${l.coll} : ${f(l.octets)} Mo (${l.docs} docs, dont index ${f(l.index)} Mo)`); }
    catch (e) { ecrire(`   plus grosses collections illisibles (${masquer(e.message)})`); }
    return j.autorise ? 0 : 1;
}

async function principal() {
    const { MongoClient } = require('mongodb');
    let code = 0;
    for (const [nom, variable] of [['production', 'MONGODB_URI'], ['cartes', 'MONGODB_CARTES_URI']]) {
        if (!process.env[variable]) { console.log(`🔴 grappe ${nom} : ${variable} absente de l'environnement`); code = 1; continue; }
        let client;
        try { client = await new MongoClient(process.env[variable], { serverSelectionTimeoutMS: 20000 }).connect(); }
        catch (e) { console.log(`🔴 grappe ${nom} : connexion impossible (${masquer(e.message)})`); code = 1; continue; }
        try { code = Math.max(code, await rapporter(nom, client)); } finally { await client.close().catch(() => {}); }
    }
    console.log(code ? '🔴 au moins une grappe à 90 % ou plus, ou non mesurable : code de sortie 1' : '✅ les deux grappes sont sous 90 %');
    return code;
}

module.exports = { plusGrosses, rapporter };
if (require.main === module) principal().then(c => process.exit(c), e => { console.error(`🔴 ${masquer(e.message)}`); process.exit(1); });
