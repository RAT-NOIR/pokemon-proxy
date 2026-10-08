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
    armerNettoyage();
    return p;
}
let ferme = false, armee = false;
async function fermerBac() { if (ferme) return; ferme = true; try { await db.viderPrefixe(); } finally { await mongoose.disconnect(); } }
// Un banc qui sort par process.exit(), par une exception ou un Ctrl-C ne passe pas par fermerBac : ses collections restaient dans
// test_scratch (mesuré : 16 collections par banc, 80 rm_t… restantes). Une fois le bac ouvert, TOUTE sortie vide d'abord le préfixe.
// (Un kill dur du processus reste hors de portée de tout code : seule la balayeuse du lanceur le rattrape, hors de ce lot.)
function armerNettoyage() {
    if (armee) return; armee = true;
    const sortirReel = process.exit.bind(process);
    let sortie = false, retenu = 0;
    // Le PREMIER code non nul gagne, et un 0 ultérieur (le code d'un banc continue après un process.exit(1) : bilan(), exit(0)…)
    // ne l'efface jamais : un banc rouge ne sort pas vert.
    const retenir = (code) => { const c = Number(code === undefined || code === null ? process.exitCode : code) || 0; if (!retenu && c) retenu = c; if (retenu) process.exitCode = retenu; return retenu; };
    const finir = (code, immediat = false) => {
        retenir(code);
        if (immediat) return sortirReel(retenu || 1);      // second SIGINT : on ne rattend pas un nettoyage qui ne répond pas
        if (sortie) return; sortie = true;
        // Mongo muet : le nettoyage ne bloque jamais la sortie au-delà du délai (unref : il ne retient pas le processus à lui seul).
        setTimeout(() => { console.error('❌ nettoyage du préfixe : délai dépassé, sortie forcée (collections possiblement restantes)'); sortirReel(retenu || 1); },
            Number(process.env.RM_DELAI_NETTOYAGE_MS) || 20000).unref();
        fermerBac().catch(e => { console.error('❌ nettoyage du préfixe :', e.message); retenir(1); }).finally(() => sortirReel(retenu || Number(process.exitCode) || 0));
    };
    process.exit = (code) => finir(code);                  // le code qui suit un process.exit() ne doit plus compter : on rend la main
    process.on('uncaughtException', e => { console.error('❌', e); finir(1); });
    process.on('unhandledRejection', e => { console.error('❌', e); finir(1); });
    for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => finir(1, sortie));
}

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
