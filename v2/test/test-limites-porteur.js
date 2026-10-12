'use strict';
// MOYENS-B1 (O4) — un limiteur PAR PORTEUR sur GET /api/compte, POST /api/solde, POST /api/identifier/reponse et POST /api/retour-live.
// Les défauts (600 / 1 200 / 600 / 600 par heure) sont posés SANS mesure d'usage réelle : le banc fige leur existence et leur réglage, pas leur justesse.
// Les variables sont réglées à 3 / 4 / 5 / 6 ici (distinctes) ; la N+1e requête d'un même porteur rend 429 DEBIT avec Retry-After, le porteur voisin n'est pas touché,
// et les compteurs des quatre routes sont indépendants.
const express = require('express');
const H = require('./_harnais'); const A = require('./_b2-aide'); const { col } = require('../db'); const M = require('../modeles'); const P = require('../comptes/mots-de-passe');
const pret = require('../pret'); const { lireConfig } = require('../config'); const { creerCourrierMemoire } = require('../comptes/courrier');
(async () => {
    // Tour 2 (I-1) : les limiteurs comptent par FENÊTRE FIXE (l'heure UTC, limites.js). Un banc qui franchirait la frontière en pleine série verrait son compteur repartir à zéro (la N+1e requête rendrait 200).
    // Même garde que test-contrat-reel.js : si la frontière d'heure est à moins de 60 s, on l'attend (le banc dure ~4 s ; 60 s couvrent aussi une machine chargée) avant de rien jouer.
    { const FEN = 3600e3, reste = FEN - (Date.now() % FEN); if (reste < 60e3) { console.log(`   frontière de fenêtre (1 h) dans ${Math.round(reste / 1000)} s : attente avant de jouer`); await new Promise(r => setTimeout(r, reste + 2000)); } }
    // ── la configuration : défauts, réglage, valeur mal formée
    const def = lireConfig({ MONGODB_BASE: 'test_scratch' }).limites;
    H.v('défauts : compte 600, solde 1 200, réponse 600, retour-live 600 par heure', [def.compteParPorteurHeure, def.soldeParPorteurHeure, def.reponseParPorteurHeure, def.retourLiveParPorteurHeure], [600, 1200, 600, 600]);
    const NOMS = { V2_COMPTE_HEURE: 'compteParPorteurHeure', V2_SOLDE_HEURE: 'soldeParPorteurHeure', V2_REPONSE_HEURE: 'reponseParPorteurHeure', V2_RETOUR_LIVE_HEURE: 'retourLiveParPorteurHeure' };
    for (const [nom, champ] of Object.entries(NOMS)) {
        H.v(`${nom}=7 s'applique`, lireConfig({ MONGODB_BASE: 'test_scratch', [nom]: '7' }).limites[champ], 7);
        for (const mal of ['abc', '0', '-1', '1.5']) { let e = null; try { lireConfig({ MONGODB_BASE: 'test_scratch', [nom]: mal }); } catch (x) { e = x.message; } H.vrai(`${nom}="${mal}" rend la configuration invalide`, /configuration invalide/.test(e || '')); }
    }

    await H.ouvrirBac('test-limites-porteur.js'); await M.creerIndex();
    // Tour 1 (I-1) : QUATRE valeurs DISTINCTES. Avec une valeur commune, brancher une route sur la variable d'une autre laissait le banc vert (mutations M9, M10).
    const N = { 'GET /api/compte': 3, 'POST /api/solde': 4, 'POST /api/identifier/reponse': 5, 'POST /api/retour-live': 6 };
    const cfg = lireConfig({ MONGODB_BASE: 'test_scratch', V2_COMPTE_HEURE: '3', V2_SOLDE_HEURE: '4', V2_REPONSE_HEURE: '5', V2_RETOUR_LIVE_HEURE: '6' });
    A.registre.fournir('courrier', creerCourrierMemoire()); A.registre.fournir('turnstile', { verifier: async () => true });
    const cors = require('../transport/cors'); const { dansUnScan } = require('../../sources'); const { assembler } = require('../index');
    const app = express(); app.set('trust proxy', true); app.use(cors.middlewareV2(cfg)); app.use(express.json()); app.use((q, s, n) => dansUnScan(n));
    pret.armer(M.verifierIndex);
    app.use(assembler([require('../argent/monter'), require('../installations/monter'), require('../comptes/monter'), require('../identifier/monter'), require('../scanner/monter'), require('../collection/monter')], cfg, { gererIdentifier: async () => { throw new Error('chaîne atteinte'); }, gererRetourLive: async (q, s) => s.json({ success: true }) }));   // M-3 : le montage est complet, une requête admise ATTEINT la route
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
    // M-3 : ce que rend une requête ADMISE, par route — chacun de ces statuts ne peut venir que du traitement de la route (après le limiteur) : le compte et le solde lisent (200) ;
    // la réponse et le retour live, sans question ni prix, refusent l'entrée (400 ENTREE) depuis leur propre code.
    const ADMIS = { 'GET /api/compte': [200, undefined], 'POST /api/solde': [200, undefined], 'POST /api/identifier/reponse': [400, 'ENTREE'], 'POST /api/retour-live': [400, 'ENTREE'] };
    for (const [route, appeler] of Object.entries(ROUTES)) {
        const [hA, hB] = entetesPour[route], max = N[route];
        const vus = []; for (let i = 0; i < max; i++) { const r = await appeler(hA); vus.push([r.statut, code(r)]); }
        const rN1 = await appeler(hA);
        H.v(`${route} : ${max} requêtes passent ET atteignent la route (${ADMIS[route][0]}${ADMIS[route][1] ? ' ' + ADMIS[route][1] : ''}), la ${max + 1}e du MÊME porteur rend 429 DEBIT`,
            [vus.every(v => v[0] === ADMIS[route][0] && v[1] === ADMIS[route][1]), rN1.statut, code(rN1)], [true, 429, 'DEBIT']);
        H.vrai(`${route} : Retry-After présent, ≥ 1 et égal à reessayerDans`, Number(rN1.entetes['retry-after']) >= 1 && rN1.json.erreur.reessayerDans === Number(rN1.entetes['retry-after']));
        const rB = await appeler(hB);
        H.v(`${route} : un AUTRE porteur n'est pas touché`, rB.statut === 429, false);
    }
    // M-2 : le limiteur de /api/identifier/reponse passe AVANT l'idempotence. La MÊME Idempotency-Key rejouée N+1 fois (N = 5) rend 429 à la N+1e : si le limiteur venait après
    // `idempotente`, un rejeu servi par la clé échapperait au plafond (M12).
    {
        // Une réponse n'est mise de côté par la clé que si elle est un succès (< 300) : la scène doit donc rendre un VRAI 200. Un administrateur n'a rien débité (aucune question réservée) :
        // la réponse se résout sur la ligne `analyses` seule (choix « aucune »). La ligne est semée à la main, au nom de l'installation D.
        const D = await installation(), cleRejeu = { 'idempotency-key': 'cle-de-rejeu-0001' }, nR = N['POST /api/identifier/reponse'];
        const jeton = D.authorization.replace(/^Bearer /, ''); const inst = await col('installations').findOne({ jetonEmpreinte: require('../comptes/jetons').empreinte(jeton) });
        const sid = new (require('mongoose').Types.ObjectId)();
        await col('analyses').insertOne({ _id: sid, porteur: `installation:${inst._id}`, facturation: { motif: 'administrateur' }, statut: 'a-trancher', cartes: [{ statut: 'a-trancher', question: { choix: [{ id: 'a', idProduct: 1 }, { id: 'b', idProduct: 2 }] } }], produits: [] });
        const corps = { scanId: String(sid), carte: 0, choix: 'aucune' };
        const vus = []; for (let i = 0; i < nR; i++) vus.push(await post('/api/identifier/reponse', corps, { ...D, ...cleRejeu }));
        const dernier = await post('/api/identifier/reponse', corps, { ...D, ...cleRejeu });
        H.v('M-2 : la scène rend un vrai succès : la 1re réponse est 200, les rejeux de la même clé aussi', vus.map(r => r.statut), Array(nR).fill(200));
        H.v(`M-2 : la même Idempotency-Key rejouée ${nR} fois ne dépasse pas le plafond, la ${nR + 1}e rend 429 DEBIT (le limiteur précède l'idempotence)`, [dernier.statut, code(dernier)], [429, 'DEBIT']);
    }
    // les compteurs sont propres à chaque route : le porteur A de /api/solde est à 4, mais /api/retour-live de A a son compte (épuisé aussi), et un TROISIÈME porteur est libre partout
    const C1 = await installation();
    const libres = []; for (const route of ['POST /api/solde', 'POST /api/identifier/reponse', 'POST /api/retour-live']) libres.push((await ROUTES[route](C1)).statut === 429);
    H.v('un porteur neuf n\'est limité sur aucune route (compteurs par porteur ET par route)', libres, [false, false, false]);
    await srv.fermer(); await H.fermerBac(); H.bilan();
})().catch(e => { console.error(e); process.exit(1); });
