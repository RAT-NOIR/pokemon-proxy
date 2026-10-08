'use strict';
// Harnais commun des bancs v2. Se connecte à test_scratch par mongo-connexion.js (qui refuse toute autre base et toute grappe fausse).
require('dotenv').config();
const http = require('http');
const mongoose = require('mongoose');
mongoose.set('strictQuery', false);
const { connecterMongo } = require('../../mongo-connexion');
const db = require('../db');

let ok = 0, ko = 0;
function v(nom, obtenu, attendu) {
    const bon = JSON.stringify(obtenu) === JSON.stringify(attendu);
    console.log(`${bon ? '✅' : '❌'} ${nom} : ${JSON.stringify(obtenu)}${bon ? '' : ` (attendu ${JSON.stringify(attendu)})`}`);
    bon ? ok++ : ko++;
}
const vrai = (nom, cond) => v(nom, Boolean(cond), true);
function bilan() { console.log(`\n${ok} réussis, ${ko} échoués`); process.exitCode = ko ? 1 : 0; return ko === 0; }

async function ouvrirBac(script) {
    // `--base=` en argument l'emporterait sur MONGODB_BASE dans mongo-connexion.js : refus AVANT toute connexion.
    if (process.argv.some(a => /^--base\b/.test(a))) { console.error('❌ ARRÊT : un banc v2 refuse tout argument --base (il impose test_scratch lui-même)'); process.exit(1); }
    process.env.MONGODB_BASE = 'test_scratch';           // un banc IMPOSE sa base, il ne la négocie pas
    const reelle = await connecterMongo({ script, ecrit: true });
    if (reelle !== 'test_scratch') { console.error(`❌ ARRÊT : base "${reelle}"`); process.exit(1); }
    const p = `rm_t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}_`;
    db.definirPrefixe(p);
    db.brancher(mongoose.connection.db);
    return p;
}
async function fermerBac() { try { await db.viderPrefixe(); } finally { await mongoose.disconnect(); } }

function serveur(app) {
    return new Promise(resolve => {
        const s = http.createServer(app).listen(0, '127.0.0.1', () =>
            resolve({ url: `http://127.0.0.1:${s.address().port}`, fermer: () => new Promise(r => s.close(r)) }));
    });
}
async function appel(url, chemin, { methode = 'GET', corps, entetes = {} } = {}) {
    const r = await fetch(url + chemin, {
        method: methode, redirect: 'manual',
        headers: { ...(corps !== undefined ? { 'content-type': 'application/json' } : {}), ...entetes },
        body: corps !== undefined ? JSON.stringify(corps) : undefined
    });
    const texte = await r.text();
    let json = null; try { json = JSON.parse(texte); } catch { /* corps non JSON */ }
    return { statut: r.status, entetes: Object.fromEntries(r.headers), json, texte };
}
module.exports = { v, vrai, bilan, ouvrirBac, fermerBac, serveur, appel };
