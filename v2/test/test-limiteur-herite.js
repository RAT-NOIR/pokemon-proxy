'use strict';
// Banc LIMITEUR-HERITE — le limiteur hérité (60 requêtes/h/IP sur /api/identifier* et /api/analyser*) ne compte plus les requêtes que la v2 traite ELLE-MÊME
// et dont elle garantit qu'elles ne parviennent pas au gestionnaire hérité sans un porteur v2 authentifié ; tout le reste reste limité comme avant.
// Base : la base EN MÉMOIRE du banc. Deux serveurs ENFANTS (index.js réel, faux réseau — le modèle payant est factice) : v2 allumée / éteinte. Aucune requête hors boucle locale.
const H = require('./_harnais');
const path = require('path');
const mongoose = require('mongoose');
const db = require('../db'); const M = require('../modeles'); const J = require('../comptes/jetons');
const R = path.join(__dirname, '..', '..');
const CHARGES = path.join(R, 'verrou', 'charges.json');
const ORIGINE = require('../config').lireConfig({ MONGODB_BASE: 'test_scratch', RENDER_GIT_COMMIT: '0123456789abcdef0123456789abcdef01234567', V2_VERSION_MODELE: 'modele-test.1' }).origines.extension;
let nIp = 0, nCle = 0;
const ipUnique = () => `10.9.${Math.floor(++nIp / 250)}.${nIp % 250 + 1}`;
const cle = () => `banc-lh-${Date.now().toString(36)}-${++nCle}`;
const appelsIA = srv => (srv.lire().match(/lecture rejouée/g) || []).length;
const LEGACY_429 = '{"success":false,"error":"Trop de requêtes, réessaie plus tard."}';

async function inst() {
    const jeton = J.genererJeton(); const i = M.nouvelleInstallation({ jetonEmpreinte: J.empreinte(jeton), essais: 3, libelle: 'banc-lh' });
    await db.col('installations').insertOne(i); return jeton;
}
const faux = () => J.genererJeton();   // un Bearer de bonne forme, qu'aucune installation ne porte

// N requêtes POST de la même IP, séquentielles ; rend les réponses.
async function serie(url, chemin, n, { ip, jeton, corps, cleIdem = false }) {
    const rs = [];
    for (let k = 0; k < n; k++)
        rs.push(await H.appel(url, chemin, { methode: 'POST', corps, entetes: { origin: ORIGINE, 'x-forwarded-for': ip, 'x-jeton': 'jeton-verrou', ...(jeton ? { authorization: `Bearer ${jeton}` } : {}), ...(cleIdem ? { 'idempotency-key': cle() } : {}) } }));
    return rs;
}
const nb429 = rs => rs.filter(r => r.statut === 429).length;

(async () => {
    // ── 0. unitaire : sans configuration valide / route non montée, rien n'est exempté, et le refus garde la forme héritée
    const LH = require('../limiteur-heritage');
    const requete = (o = {}) => ({ method: 'POST', originalUrl: '/api/identifier', body: { contrat: 2 }, get: () => 'Bearer x', ...o });
    const resolvantInstallation = () => async (req, res, next) => { req.v2 = { porteur: { installation: { _id: 1 } } }; next(); };
    const sansCfg = LH.fabrique(() => null, { resoudre: resolvantInstallation });
    H.v('0a. sans configuration v2 valide : jamais exempté, même pour une requête de contrat 2 dont le porteur serait reconnu', await sansCfg.sauter(requete()), false);
    const avecCfg = (resoudre) => LH.fabrique(() => ({}), { resoudre });
    H.v('0c. configuration valide + porteur avec installation + route de la v2 : exempté', await avecCfg(resolvantInstallation).sauter(requete()), true);
    H.v('0d. porteur sans installation (anonyme) : compté', await avecCfg(() => async (req, res, next) => { req.v2 = { porteur: null }; next(); }).sauter(requete()), false);
    H.v('0e. la lecture du porteur lève : compté (échec fermé)', await avecCfg(() => async () => { throw new Error('mongo'); }).sauter(requete()), false);
    H.v('0f. la lecture du porteur répond elle-même une erreur : compté', await avecCfg(() => async (req, res) => { res.status(503).json({}); }).sauter(requete()), false);
    H.v('0g. contrat 2 sur /api/analyser, GET, ou corps sans contrat : compté', [await avecCfg(resolvantInstallation).sauter(requete({ originalUrl: '/api/analyser' })), await avecCfg(resolvantInstallation).sauter(requete({ method: 'GET' })), await avecCfg(resolvantInstallation).sauter(requete({ body: {} }))], [false, false, false]);
    const reponseFausse = () => { const r = { entetes: {}, statut: null, corps: null, setHeader(k, v) { this.entetes[k] = v; }, status(s) { this.statut = s; return this; }, json(c) { this.corps = c; return this; }, send(c) { this.corps = c; return this; } }; return r; };
    const r0 = reponseFausse(); sansCfg.refuser(requete(), r0, () => { }, { statusCode: 429, message: { success: false, error: 'Trop de requêtes, réessaie plus tard.' } });
    H.v('0b. sans configuration : le refus garde la forme héritée', [r0.statut, JSON.stringify(r0.corps)], [429, LEGACY_429]);

    await H.ouvrirBancV2();
    process.env.MONGODB_BASE = 'test_scratch';
    const { connecterMongo } = require('../../mongo-connexion');
    await connecterMongo({ script: 'test-limiteur-herite.js', ecrit: true });
    db.brancher(mongoose.connection.db);
    await M.creerIndex();
    const { demarrer } = require('../../verrou/serveur');
    const FAUX = path.join(__dirname, 'faux-reseau-v2.js');
    const base = { VERROU_CHARGES: CHARGES, JETON_API: 'jeton-verrou', MONGODB_BASE: 'test_scratch', OPENROUTER_API_KEY: '' };
    const srvOn = await demarrer(FAUX, { ...base, RM_API_V2: '1', RENDER_GIT_COMMIT: '0123456789abcdef0123456789abcdef01234567', V2_VERSION_MODELE: 'modele-test.1' });
    const srvOff = await demarrer(FAUX, { ...base, RM_API_V2: '' });
    if (!await srvOn.attendreMongo() || !await srvOff.attendreMongo()) throw new Error('Mongo non connecté');
    const on = `http://127.0.0.1:${srvOn.port}`, off = `http://127.0.0.1:${srvOff.port}`;
    const IMG = require(CHARGES).charges.find(c => c.cellule === 'occidentale').imageUrl;
    const corps2 = { contrat: 2, imageUrls: [], title: null, description: null, prixVinted: null, devise: null, marche: 'vinted.fr', versionExtension: '2.0.0', langueInterface: 'fr' };   // refusée par la v2 (entrée) AVANT tout débit : bon marché, aucun modèle
    const corpsHerite = { userId: 'banc-lh', imageUrls: [IMG], title: null, vintedEtat: null };

    // ── 1. 61 requêtes v2 AUTHENTIFIÉES (contrat 2) de la même IP : aucune refusée par le limiteur hérité
    {
        const jeton = await inst(), ia0 = appelsIA(srvOn);
        const rs = await serie(on, '/api/identifier', 61, { ip: ipUnique(), jeton, corps: corps2, cleIdem: true });
        H.v('1a. 61 requêtes contrat 2 authentifiées, même IP : aucune refusée par le limiteur hérité (aucun 429)', nb429(rs), 0);
        H.v('   toutes répondues par la v2 (enveloppe v2, jamais l\'enveloppe héritée)', rs.filter(r => r.json && r.json.erreur && r.json.success === false).length, 61);
        H.v('   aucun appel au modèle', appelsIA(srvOn) - ia0, 0);
        const jeton2 = await inst();
        const rr = await serie(on, '/api/identifier/reponse', 61, { ip: ipUnique(), jeton: jeton2, corps: {} });
        H.v('1b. 61 requêtes /api/identifier/reponse authentifiées, même IP : aucun 429', nb429(rr), 0);
        H.v('   toutes en enveloppe v2', rr.filter(r => r.json && r.json.erreur).length, 61);
    }

    // ── 2. 61 requêtes HÉRITÉES : la 61e est refusée, comme avant (v2 allumée ET v2 éteinte, même corps exact)
    {
        const a = await serie(on, '/api/identifier', 61, { ip: ipUnique(), corps: corpsHerite });
        H.v('2a. v2 allumée, 61 héritées : 60 non limitées puis la 61e refusée', [a.slice(0, 60).some(r => r.texte === LEGACY_429), a[60].statut, a[60].texte], [false, 429, LEGACY_429]);
        const b = await serie(off, '/api/identifier', 61, { ip: ipUnique(), corps: corpsHerite });
        H.v('2b. v2 éteinte (RM_API_V2 absente), 61 héritées : identique à aujourd\'hui', [b.slice(0, 60).some(r => r.texte === LEGACY_429), b[60].statut, b[60].texte], [false, 429, LEGACY_429]);
        const c = await serie(off, '/api/identifier', 61, { ip: ipUnique(), corps: { ...corpsHerite, contrat: 2 } });
        H.v('2c. v2 éteinte, « contrat: 2 » : limité comme une héritée (la 61e refusée, forme héritée)', [c[60].statut, c[60].texte], [429, LEGACY_429]);
    }

    // ── 3. 61 requêtes « contrat 2 » avec un FAUX Bearer : jamais le gestionnaire hérité, jamais le modèle ; refus v2 ; la 61e en 429 v2 (DEBIT + Retry-After)
    {
        const ia0 = appelsIA(srvOn), ip = ipUnique(), f = faux();
        const rs = await serie(on, '/api/identifier', 61, { ip, jeton: f, corps: { ...corps2, imageUrls: [IMG] }, cleIdem: true });
        H.v('3a. 60 premières : refus v2 JETON (401), enveloppe v2', [rs.slice(0, 60).every(r => r.statut === 401 && r.json && r.json.erreur && r.json.erreur.code === 'JETON')], [true]);
        H.v('3b. la 61e : 429 en enveloppe v2 (erreur.code DEBIT), Retry-After présent et entier', [rs[60].statut, rs[60].json && rs[60].json.erreur && rs[60].json.erreur.code, rs[60].json && rs[60].json.success, /^\d+$/.test(String(rs[60].entetes['retry-after'])) && Number(rs[60].entetes['retry-after']) === (rs[60].json.erreur || {}).reessayerDans && Number.isInteger((rs[60].json.erreur || {}).reessayerDans) && (rs[60].json.erreur || {}).reessayerDans >= 1], [429, 'DEBIT', false, true]);
        H.v('3c. aucun appel au modèle, aucune réponse héritée', [appelsIA(srvOn) - ia0, rs.filter(r => r.texte === LEGACY_429 || (r.json && typeof r.json.error === 'string')).length], [0, 0]);
    }

    // ── 4. un Bearer VALIDE ne suffit pas à exempter une requête qui n'est pas de contrat 2 ; un faux contrat 2 sur /api/analyser reste limité
    {
        const jeton = await inst();
        const a = await serie(on, '/api/identifier', 61, { ip: ipUnique(), jeton, corps: corpsHerite });
        H.v('4a. Bearer valide + corps héritée (sans contrat 2) sur /api/identifier : la 61e refusée, forme héritée', [a[60].statut, a[60].texte], [429, LEGACY_429]);
        const b = await serie(on, '/api/analyser', 61, { ip: ipUnique(), jeton, corps: { ...corpsHerite, contrat: 2 } });
        H.v('4b. faux « contrat: 2 » sur /api/analyser, Bearer valide : la 61e refusée, forme héritée', [b[60].statut, b[60].texte], [429, LEGACY_429]);
        const c = await serie(on, '/api/identifier', 61, { ip: ipUnique(), jeton, corps: { ...corps2, contrat: '2' } });
        H.v('4c. contrat: "2" (chaîne) : pas de contrat 2, donc limité (61e en 429)', c[60].statut, 429);
        const d = await serie(on, '/api/identifier/', 61, { ip: ipUnique(), jeton, corps: corps2, cleIdem: true });
        H.v('4d. chemin avec barre finale : jamais exempté (la 61e en 429)', d[60].statut, 429);
    }

    srvOn.enfant.kill(); srvOff.enfant.kill();
    H.bilan();
    await new Promise(r => setTimeout(r, 200));
    process.exit(process.exitCode || 0);
})().catch(e => { console.error('❌', e); process.exit(1); });
