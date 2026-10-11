'use strict';
// Enfant de test-coupure-processus.js (son nom ne commence pas par "test-" : le lanceur ne le joue pas seul).
// Il monte l'application v2 (argent + identification) sur la base EN MÉMOIRE du banc (héritée du parent), écoute sur un port libre, imprime PORT=<n>, et — selon COUPURE_MODE —
// S'ARRÊTE NET (process.kill SIGKILL) à l'un de trois instants. L'arrêt est fabriqué ICI, dans l'enfant du banc, par ses propres moyens (le crochet de lot qu'il fournit, db.col
// remplacé comme le ledger l'autorise, une enveloppe de res.send posée avant l'idempotence) : AUCUN interrupteur dans le code de production, aucune variable d'environnement qu'il lirait.
//   COUPURE_MODE=a       pendant la LECTURE des photos : le crochet de lot meurt, après le débit initial ;
//   COUPURE_MODE=b       après le supplément du lot, avant la réponse : la première écriture de la ligne `analyses` meurt ;
//   COUPURE_MODE=c       juste avant la remise de la réponse, une fois la réponse finale STOCKÉE par l'idempotence (et la marque déjà close) : res.send meurt ;
//   COUPURE_MODE=c2      juste après l'écriture de la ligne `analyses`, avant la clôture de la marque : le résultat est persisté, la réponse n'est pas stockée ;
//   COUPURE_MODE=r       la PASSE meurt entre la prise d'une unité (posée `rembourse`) et le rendu de son crédit ;
//   COUPURE_MODE=p       la PASSE de rattrapage meurt en route (après le claim `rb|scanId`, avant la prise de la 1re unité) ;
//   COUPURE_MODE=normal  aucun arrêt (sert les rejeux et la passe de rattrapage) ;
//   COUPURE_DIFFERE_MS   délai de la passe de démarrage (défaut : 600000, c'est-à-dire pas de passe pendant le banc).
const H = require('./_harnais');
// L'arrêt : un marqueur écrit en SYNCHRONE (le parent y reconnaît une coupure voulue, pas une exception), puis SIGKILL — aucun gestionnaire, aucun nettoyage, aucune réponse.
const mort = () => { try { require('fs').writeSync(1, `COUPURE=${process.env.COUPURE_MODE}\n`); } catch { /* le marqueur est un témoin */ } try { process.kill(process.pid, 'SIGKILL'); } catch { /* repli */ } process.exit(137); };
(async () => {
    const mode = process.env.COUPURE_MODE || 'normal';
    await H.ouvrirBancV2();
    process.env.MONGODB_BASE = 'test_scratch';
    const mongoose = require('mongoose');
    const { connecterMongo } = require('../../mongo-connexion');
    await connecterMongo({ script: 'enfant-coupure.js', ecrit: true });
    const db = require('../db');
    db.brancher(mongoose.connection.db);
    const orig = db.col;
    if (mode === 'b') db.col = nom => (nom === 'analyses' ? new Proxy(orig(nom), { get: (t, k) => (k === 'insertOne' ? async () => mort() : t[k]) }) : orig(nom));
    // c2 : la ligne `analyses` est ÉCRITE pour de bon, puis le processus meurt (avant la clôture de la marque et avant la réponse)
    if (mode === 'c2') db.col = nom => (nom === 'analyses' ? new Proxy(orig(nom), { get: (t, k) => (k === 'insertOne' ? async (...a) => { await t.insertOne(...a); mort(); } : t[k]) }) : orig(nom));
    // p : la PASSE de rattrapage elle-même meurt, entre le claim `rb|scanId` (déjà inséré) et le rendu de la 1re unité (sa prise atomique)
    if (mode === 'p') db.col = nom => (nom === 'mouvements' ? new Proxy(orig(nom), { get: (t, k) => (k === 'findOneAndUpdate' ? async () => mort() : t[k]) }) : orig(nom));
    // r : la PASSE meurt entre la prise d'une unité (le ledger la pose `rembourse`) et le rendu de son crédit (le $inc de la poche) — l'ordre du ledger, R4
    if (mode === 'r') db.col = nom => (nom === 'installations' ? new Proxy(orig(nom), { get: (t, k) => (k === 'updateOne' ? async () => mort() : t[k]) }) : orig(nom));
    const express = require('express');
    const { dansUnScan } = require('../../sources'); const { assembler } = require('../index'); const pret = require('../pret'); const M = require('../modeles');
    const { lireConfig } = require('../config');
    const cfg = lireConfig({ MONGODB_BASE: 'test_scratch', V2_HEBDO: '0', V2_LOT_CARTES_MAX: '100' });   // comme test-coupure-processus.js : lots de 25 cartes
    const PID = Number(process.env.COUPURE_PID);
    const carteCorps = { idProduct: PID, nomProduit: 'Tropius', nom: 'Tropius', numero: '001', total: '064', setCode: 'PBL', rarete: null, langue: 'FR', ambigu: false };
    const aff = { statutHttp: 200, corps: { success: true, question: null, carte: carteCorps, etat: { estimeIA: null, confianceIA: null, defautsVus: [], declareVendeur: null, declareCardmarket: null, retenu: null },
        candidats: [{ idProduct: PID, nom: 'Tropius', numero: '001', set: 'Banc O5', prix: 1, photoUrl: null }], classement: [], guidePrix: {}, reverse: { attendue: false, motif: null, etat: 'aucun-motif', strategie: null }, codeLangue: 2 } };
    const identifierLot = async () => { if (mode === 'a') mort(); return Array.from({ length: Number(process.env.COUPURE_CARTES || 25) }, () => aff); };
    const app = express(); app.set('trust proxy', true);
    if (mode === 'c') app.use((req, res, next) => { const o = res.send; res.send = function (b) { if (req.path === '/api/identifier' && res.statusCode === 200) mort(); return o.call(this, b); }; next(); });
    app.use(express.json()); app.use((q, s, n) => dansUnScan(n));
    pret.armer(M.verifierIndex);
    app.use(assembler([require('../argent/monter'), require('../identifier/monter')], cfg,
        { identifierLot, gererIdentifier: async (req, res) => res.json({ ...aff.corps, scanId: String(req.scanIdImpose) }), gererRetourLive: async (q, s) => s.json({ success: true }),
          rattrapage: { differeMs: Number(process.env.COUPURE_DIFFERE_MS ?? 600000), intervalleMs: 60000 } }));
    const s = app.listen(0, '127.0.0.1', () => console.log(`PORT=${s.address().port}`));
})().catch(e => { console.error('❌ enfant-coupure :', (e && e.code) || (e && e.name)); process.exit(1); });
