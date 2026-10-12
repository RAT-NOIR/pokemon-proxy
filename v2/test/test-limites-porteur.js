'use strict';
// MOYENS-B1 (O4) — un limiteur PAR PORTEUR sur GET /api/compte, POST /api/solde, POST /api/identifier/reponse et POST /api/retour-live.
// Les défauts (600 / 1 200 / 600 / 600 par heure) sont posés SANS mesure d'usage réelle : le banc fige leur existence et leur réglage, pas leur justesse.
// Chaque variable est réglée à 3 ici ; la 4e requête d'un même porteur rend 429 DEBIT avec Retry-After, le porteur voisin n'est pas touché,
// et les compteurs des quatre routes sont indépendants.
const express = require('express');
const H = require('./_harnais'); const A = require('./_b2-aide'); const { col } = require('../db'); const M = require('../modeles'); const P = require('../comptes/mots-de-passe');
const pret = require('../pret'); const { lireConfig } = require('../config'); const { creerCourrierMemoire } = require('../comptes/courrier');
(async () => {
    // ── la configuration : défauts, réglage, valeur mal formée
    const def = lireConfig({ MONGODB_BASE: 'test_scratch' }).limites;
    H.v('défauts : compte 600, solde 1 200, réponse 600, retour-live 600 par heure', [def.compteParPorteurHeure, def.soldeParPorteurHeure, def.reponseParPorteurHeure, def.retourLiveParPorteurHeure], [600, 1200, 600, 600]);
    const NOMS = { V2_COMPTE_HEURE: 'compteParPorteurHeure', V2_SOLDE_HEURE: 'soldeParPorteurHeure', V2_REPONSE_HEURE: 'reponseParPorteurHeure', V2_RETOUR_LIVE_HEURE: 'retourLiveParPorteurHeure' };
    for (const [nom, champ] of Object.entries(NOMS)) {
        H.v(`${nom}=7 s'applique`, lireConfig({ MONGODB_BASE: 'test_scratch', [nom]: '7' }).limites[champ], 7);
        for (const mal of ['abc', '0', '-1', '1.5']) { let e = null; try { lireConfig({ MONGODB_BASE: 'test_scratch', [nom]: mal }); } catch (x) { e = x.message; } H.vrai(`${nom}="${mal}" rend la configuration invalide`, /configuration invalide/.test(e || '')); }
    }

    await H.ouvrirBac('test-limites-porteur.js'); await M.creerIndex();
    const cfg = lireConfig({ MONGODB_BASE: 'test_scratch', V2_COMPTE_HEURE: '3', V2_SOLDE_HEURE: '3', V2_REPONSE_HEURE: '3', V2_RETOUR_LIVE_HEURE: '3' });
    A.registre.fournir('courrier', creerCourrierMemoire()); A.registre.fournir('turnstile', { verifier: async () => true });
    const cors = require('../transport/cors'); const { dansUnScan } = require('../../sources'); const { assembler } = require('../index');
    const app = express(); app.set('trust proxy', true); app.use(cors.middlewareV2(cfg)); app.use(express.json()); app.use((q, s, n) => dansUnScan(n));
    pret.armer(M.verifierIndex);
    app.use(assembler([require('../argent/monter'), require('../installations/monter'), require('../comptes/monter'), require('../identifier/monter'), require('../scanner/monter'), require('../collection/monter')], cfg, { gererIdentifier: async () => { throw new Error('chaîne atteinte'); } }));
    const srv = await H.serveur(app); let n = 0; const ip = () => ({ 'x-forwarded-for': `10.8.${Math.floor(++n / 250)}.${n % 250 + 1}` });
    const SITE = { origin: cfg.origines.site, 'x-rat-market': '1' }, EXT = { origin: cfg.origines.extension };
    const post = (ch, corps, entetes = {}) => H.appel(srv.url, ch, { methode: 'POST', corps, entetes: { ...ip(), ...entetes } });
    const installation = async () => { const r = await post('/api/installation', { libelle: 'banc' }, EXT); return { authorization: `Bearer ${r.json.jetonInstallation}`, ...EXT }; };
    const code = r => r.json && r.json.erreur && r.json.erreur.code;
    const comptes = [];
    for (const email of ['a@exemple.fr', 'b@exemple.fr']) {
        await col('comptes').insertOne(Object.assign(M.nouveauCompte({ email, emailCle: email, motDePasse: await P.hacher('mot-de-passe-du-banc') }), { verifie: true }));
        const conn = await post('/api/compte/connexion', { email, motDePasse: 'mot-de-passe-du-banc' }, SITE);
        comptes.push({ cookie: String(conn.entetes['set-cookie']).split(';')[0] });
    }
    const CORPS_REP = { scanId: '6acbcf5bf4099eb7eb620869', carte: 0, choix: null };
    const ROUTES = {
        'GET /api/compte': (h) => H.appel(srv.url, '/api/compte', { entetes: { ...ip(), ...h } }),
        'POST /api/solde': (h) => post('/api/solde', {}, h),
        'POST /api/identifier/reponse': (h) => post('/api/identifier/reponse', CORPS_REP, h),
        'POST /api/retour-live': (h) => post('/api/retour-live', { scanId: CORPS_REP.scanId, carte: 0 }, h)
    };
    const A1 = await installation(), B1 = await installation();
    const entetesPour = { 'GET /api/compte': [{ cookie: comptes[0].cookie }, { cookie: comptes[1].cookie }], 'POST /api/solde': [A1, B1], 'POST /api/identifier/reponse': [A1, B1], 'POST /api/retour-live': [A1, B1] };
    const ordre = [];
    for (const [route, appeler] of Object.entries(ROUTES)) {
        const [hA, hB] = entetresDe(route);
        const vus = []; for (let i = 0; i < 3; i++) vus.push((await appeler(hA)).statut);
        const r4 = await appeler(hA);
        H.v(`${route} : 3 requêtes passent (pas de 429), la 4e du MÊME porteur rend 429 DEBIT`, [vus.filter(s => s === 429).length, r4.statut, code(r4)], [0, 429, 'DEBIT']);
        H.vrai(`${route} : Retry-After présent, ≥ 1 et égal à reessayerDans`, Number(r4.entetes['retry-after']) >= 1 && r4.json.erreur.reessayerDans === Number(r4.entetes['retry-after']));
        const rB = await appeler(hB);
        H.v(`${route} : un AUTRE porteur n'est pas touché`, rB.statut === 429, false);
        ordre.push(route);
    }
    // les compteurs sont propres à chaque route : le porteur A de /api/solde est à 4, mais /api/retour-live de A a son compte (épuisé aussi), et un TROISIÈME porteur est libre partout
    const C1 = await installation();
    const libres = []; for (const route of ['POST /api/solde', 'POST /api/identifier/reponse', 'POST /api/retour-live']) libres.push((await ROUTES[route](C1)).statut === 429);
    H.v('un porteur neuf n\'est limité sur aucune route (compteurs par porteur ET par route)', libres, [false, false, false]);
    function entetresDe(route) { return entetesPour[route]; }
    await srv.fermer(); await H.fermerBac(); H.bilan();
})().catch(e => { console.error(e); process.exit(1); });
