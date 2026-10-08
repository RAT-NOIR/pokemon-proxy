'use strict';
// Harnais commun des bancs v2. Se connecte à test_scratch par mongo-connexion.js (qui refuse toute autre base et toute grappe fausse).
require('dotenv').config();
// .env vient de charger l'URI de PRODUCTION dans process.env : elle en est retirée AVANT tout autre require (voir _env-banc.js), BANC_ISOLE=1 posé.
// Seule l'URI d'un banc (ouvrirBancV2) y reviendra ; un code qui ouvre Mongo hors ouvrirBancV2 ne trouve aucune adresse.
require('./_env-banc').purgerEnv();
const http = require('http');
const mongoose = require('mongoose');
mongoose.set('strictQuery', false);
const { connecterMongo } = require('../../mongo-connexion');
const { ouvrirBanc, installerGardeEcriture } = require('../../collecte-cartes/base-banc');
const { verifierHoteBanc, hotesDe } = require('../../collecte-cartes/garde-banc');
const db = require('../db');

let ok = 0, ko = 0;
function v(nom, obtenu, attendu) {
    const bon = JSON.stringify(obtenu) === JSON.stringify(attendu);
    console.log(`${bon ? '✅' : '❌'} ${nom} : ${JSON.stringify(obtenu)}${bon ? '' : ` (attendu ${JSON.stringify(attendu)})`}`);
    bon ? ok++ : ko++;
}
const vrai = (nom, cond) => v(nom, Boolean(cond), true);
function bilan() { console.log(`\n${ok} réussis, ${ko} échoués`); process.exitCode = ko ? 1 : 0; return ko === 0; }

// 🔑 INT2 (décision du testeur, 2026-10-08) : un banc v2 n'ouvre JAMAIS la grappe de production. Il ouvre la base de banc de
// collecte-cartes/base-banc.js (mémoire, ou MONGODB_TEST_URI hors production) ou il REFUSE, avant toute connexion. `appliquer()` REMPLACE chaque
// MONGODB_*URI (donc aussi celles que verront les serveurs enfants lancés par verrou/serveur.js) et pose BANC_ISOLE=1.
// Chaque banc démarre SA base (une par processus) : un banc qui échoue ou se tue n'en laisse aucune à un autre, et un banc lancé seul se comporte
// comme dans lancer-tout.js. Tout banc qui touche Mongo (directement ou par un serveur enfant) l'appelle AVANT son premier require qui lit MONGODB_*.
let bancOuvert = null;
async function ouvrirBancV2(options = {}) {
    if (process.argv.some(a => /^--base\b/.test(a))) { console.error('❌ ARRÊT : un banc v2 refuse tout argument --base (il impose test_scratch lui-même)'); process.exit(1); }
    const env = options.env || process.env;
    // Un ENFANT d'un banc isolé (serveur ou banc lancé par un autre banc : test-fuite, test-montage) hérite de l'environnement que le parent a posé par
    // appliquer(). Il tombe sur la MÊME base : en démarrer une seconde laisserait le parent compter les collections d'une base que son enfant n'a jamais vue
    // (un vert vide). Écrit par ce qu'on AUTORISE : BANC_ISOLE=1, et MONGODB_URI dont TOUS les hôtes sont ceux du banc ET en loopback. Tout le reste : base neuve.
    if (env.BANC_ISOLE === '1' && verifierHoteBanc(env.MONGODB_URI, env).ok && hotesDe(env.MONGODB_URI).every(h => /^127(\.\d{1,3}){3}$/.test(h) || h === 'localhost' || h === '[::1]')) {
        installerGardeEcriture(mongoose.Collection, env);
        return { origine: 'herite', uri: env.MONGODB_URI, arreter: async () => { }, appliquer() { } };
    }
    const banc = await ouvrirBanc(options);
    banc.appliquer();
    bancOuvert = banc;
    return banc;
}
async function arreterBanc() { const b = bancOuvert; bancOuvert = null; if (b) await b.arreter(); }
async function ouvrirBac(script) {
    // `--base=` en argument l'emporterait sur MONGODB_BASE dans mongo-connexion.js : refus AVANT toute connexion (ouvrirBancV2 le fait en premier).
    await ouvrirBancV2();
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
// la base de banc (mémoire) s'arrête APRÈS le vidage et la déconnexion, quoi qu'il arrive
async function fermerBac() { if (ferme) return; ferme = true; try { await db.viderPrefixe(); } finally { try { await mongoose.disconnect(); } finally { await arreterBanc(); } } }
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

// Lance `node <args>` dans un processus ENFANT et rend { status, stdout, stderr } (contrat de spawnSync, mais ASYNCHRONE). Jamais spawnSync pour un enfant
// qui écrit sur la base de banc : mongod (en mémoire) journalise dans un tube LU par ce processus ; un parent bloqué ne le vide plus, mongod se bloque,
// l'enfant attend mongod — interblocage (mesuré : test-argent-fusion et son rejeu de migration, 90 s sans fin). L'enfant hérite de l'environnement du banc.
function lancerNode(args, delaiMs = 60000) {
    return new Promise(resolve => {
        const e = require('child_process').spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
        let stdout = '', stderr = '';
        e.stdout.on('data', d => { stdout += d; }); e.stderr.on('data', d => { stderr += d; });
        const k = setTimeout(() => e.kill(), delaiMs);
        e.on('close', status => { clearTimeout(k); resolve({ status, stdout, stderr }); });
    });
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
module.exports = { v, vrai, bilan, ouvrirBancV2, arreterBanc, ouvrirBac, fermerBac, lancerNode, serveur, appel };
