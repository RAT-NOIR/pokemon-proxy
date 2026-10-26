'use strict';
// Banc SOLDE-INSTALLATION (demande de l'extension, DEMANDE-SERVEUR-EXTENSION.md, « EXTENSION — 26/10 (nuit) », point 2) — POST /api/solde sert `installationId` (32 hex), l'identifiant TECHNIQUE de l'installation
// qui porte le jeton, aussi pour une installation créée AVANT le build qui le garde. Jamais celui d'une autre installation ; jamais le jeton. Base EN MÉMOIRE du banc ; aucun réseau.
const H = require('./_harnais');
const mongoose = require('mongoose');
const db = require('../db'); const M = require('../modeles'); const J = require('../comptes/jetons'); const QA = require('./_aide-quota');
const { lireConfig } = require('../config');
const cfg = lireConfig({ MONGODB_BASE: 'test_scratch' });
const ORIGINE = cfg.origines.extension;
let nIp = 0; const ip = () => { nIp++; return { 'x-forwarded-for': `10.11.${Math.floor(nIp / 250)}.${nIp % 250 + 1}` }; };
async function inst() { const jeton = J.genererJeton(); const i = M.nouvelleInstallation({ jetonEmpreinte: J.empreinte(jeton), essais: 3, libelle: 'banc' }); await db.col('installations').insertOne(i); return { i, jeton }; }
const solde = (url, jeton) => H.appel(url, '/api/solde', { methode: 'POST', corps: {}, entetes: { origin: ORIGINE, ...ip(), authorization: `Bearer ${jeton}` } });

(async () => {
    await H.ouvrirBancV2();
    await QA.eviterMinuit();
    process.env.MONGODB_BASE = 'test_scratch';
    const { connecterMongo } = require('../../mongo-connexion');
    await connecterMongo({ script: 'test-solde-installation.js', ecrit: true });
    db.brancher(mongoose.connection.db);
    await M.creerIndex();
    const express = require('express'); const pret = require('../pret'); const { assembler } = require('../index');
    const app = express(); app.set('trust proxy', true); app.use(express.json());
    pret.armer(require('../modeles').verifierIndex);
    app.use(assembler([require('../argent/monter'), require('../identifier/monter')], cfg, { jumeaux: () => ({ conclu: true, ids: [] }), gererIdentifier: async (q, s) => s.json({ success: false }) }));
    const sv = await H.serveur(app);

    const a = await inst(), b = await inst();
    const ra = await solde(sv.url, a.jeton), rb = await solde(sv.url, b.jeton);
    H.v('1. une installation (même créée avant le build) reçoit SON identifiant technique : 32 hex minuscules, celui de son document', [ra.statut, ra.json && ra.json.installationId, /^[0-9a-f]{32}$/.test((ra.json && ra.json.installationId) || '')], [200, a.i._id, true]);
    H.v('2. une autre installation reçoit le SIEN, jamais celui d\'une autre', [rb.json && rb.json.installationId, rb.json && rb.json.installationId !== a.i._id], [b.i._id, true]);
    H.vrai('3. la réponse ne porte jamais le jeton ni son empreinte', !JSON.stringify(ra.json).includes(a.jeton) && !JSON.stringify(ra.json).includes(J.empreinte(a.jeton)));
    H.v('4. le reste de la réponse est inchangé (success, solde, offre)', Object.keys(ra.json).sort(), ['installationId', 'offre', 'solde', 'success']);
    H.v('5. un jeton inconnu : 401, aucun identifiant', [(await solde(sv.url, 'b'.repeat(32))).statut], [401]);

    await sv.fermer();
    const monter = require('../identifier/monter'); monter.arreterBalayage(); monter.arreterPurge(); require('../argent/marque-scan').arreterRattrapage();
    await mongoose.disconnect();
    await H.arreterBanc();
    H.bilan();
})().catch(async e => { console.error('❌', e); try { await H.arreterBanc(); } catch (_) { } process.exit(1); });
