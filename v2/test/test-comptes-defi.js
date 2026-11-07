'use strict';
// Lot L1 (comptes <-> site) : Turnstile EXIGÉ sur connexion, mot-de-passe-oublie et renvoyer-verification (même module, même code d'erreur
// `defi-anti-robot` que l'inscription), `www.rat-market.fr` admis comme l'apex (CORS avec cookies, origine d'écriture, hostname Turnstile) et RIEN d'autre.
// Aucun appel réseau : le vérificateur est simulé (registre) ou `fetch` injecté.
const H = require('./_harnais'); const A = require('./_b2-aide'); const db = require('../db'); const M = require('../modeles');
const { lireConfig } = require('../config'); const P = require('../comptes/mots-de-passe'); const { creerCourrierMemoire } = require('../comptes/courrier');
const { verifierTurnstile } = require('../comptes/turnstile');
const express = require('express'); const pret = require('../pret'); const cors = require('../transport/cors');
// Le vrai montage : CORS v2 d'abord, puis les routes RÉELLES des comptes (comme test-installation-banc-cors.js).
async function demarrerAvecCors(cfg) {
    const app = express(); app.set('trust proxy', true); app.use(cors.middlewareV2(cfg)); app.use(express.json());
    const { assembler } = require('../index'); pret.armer(M.verifierIndex);
    app.use(assembler([require('../installations/monter'), require('../comptes/monter')], cfg, {}));
    return H.serveur(app);
}
(async () => {
    await H.ouvrirBac('test-comptes-defi.js'); await M.creerIndex();
    H.fixerHorlogeMilieu();
    const cfg = lireConfig({ MONGODB_BASE: 'test_scratch' });
    const MDP = 'un-mot-de-passe-solide';
    const courrier = creerCourrierMemoire(); const vus = [];
    const turnstile = { verifier: async (jeton, ip) => { vus.push([jeton, ip]); return jeton === 'ok'; } };
    A.registre.fournir('courrier', courrier); A.registre.fournir('turnstile', turnstile);
    const srv = await demarrerAvecCors(cfg); let n = 0;
    const post = (chemin, corps, entetes = {}) => H.appel(srv.url, chemin, { methode: 'POST', corps, sansDefi: true, entetes: { ...A.SITE, ...A.ip(++n), ...entetes } });
    const creer = async (email, verifie) => { const c = M.nouveauCompte({ email, emailCle: email.toLowerCase(), motDePasse: await P.hacher(MDP) }); c.verifie = verifie; await db.col('comptes').insertOne(c); return c; };
    await creer('bob@exemple.fr', true); await creer('attente@exemple.fr', false);
    const detail = r => [r.statut, r.json && r.json.erreur && r.json.erreur.code, r.json && r.json.erreur && r.json.erreur.detail];
    const DEFI = [422, 'ENTREE', 'defi-anti-robot'];
    const CHEMINS = { connexion: { chemin: '/api/compte/connexion', corps: e => ({ email: e, motDePasse: MDP }), bon: 200 },
                      oubli: { chemin: '/api/compte/mot-de-passe-oublie', corps: e => ({ email: e }), bon: 202 },
                      renvoi: { chemin: '/api/compte/renvoyer-verification', corps: e => ({ email: e }), bon: 202 } };

    for (const [nom, R] of Object.entries(CHEMINS)) {
        const avant = vus.length;
        const sans = await post(R.chemin, R.corps('bob@exemple.fr'));
        H.v(`${nom} : sans jeton Turnstile => 422 ENTREE defi-anti-robot`, detail(sans), DEFI);
        const vide = await post(R.chemin, { ...R.corps('bob@exemple.fr'), turnstile: '' });
        H.v(`${nom} : jeton vide => refusé comme absent`, detail(vide), DEFI);
        const nontxt = await post(R.chemin, { ...R.corps('bob@exemple.fr'), turnstile: 42 });
        H.v(`${nom} : jeton non texte => refusé, vérificateur non appelé`, [detail(nontxt), vus.length - avant], [DEFI, 0]);
        const faux = await post(R.chemin, { ...R.corps('bob@exemple.fr'), turnstile: 'mauvais' });
        H.v(`${nom} : jeton invalide => 422 defi-anti-robot`, detail(faux), DEFI);
        H.vrai(`${nom} : pas de cookie sur un refus de défi`, !faux.entetes['set-cookie']);
        const bon = await post(R.chemin, { ...R.corps('bob@exemple.fr'), turnstile: 'ok' });
        H.v(`${nom} : jeton valide => ${R.bon}`, bon.statut, R.bon);
        const ip = await post(R.chemin, { ...R.corps('bob@exemple.fr'), turnstile: 'ok' }, { 'x-forwarded-for': '203.0.113.9' });
        H.v(`${nom} : l'IP du client est transmise au vérificateur`, vus[vus.length - 1], ['ok', '203.0.113.9']);
        // ordre : l'origine passe avant le défi
        const orig = await post(R.chemin, R.corps('bob@exemple.fr'), { origin: 'https://evil.fr' });
        H.v(`${nom} : mauvaise origine sans jeton => 403 ORIGINE (l'origine précède le défi)`, [orig.statut, orig.json.erreur.code], [403, 'ORIGINE']);
    }
    await A.attendre();

    // ordre : le défi précède le budget par adresse (un robot sans jeton ne brûle pas les 10 essais d'un compte tiers)
    const refus = []; for (let i = 0; i < 12; i++) refus.push((await post('/api/compte/connexion', { email: 'bob@exemple.fr', motDePasse: 'faux' })).statut);
    H.v('connexion : 12 essais sans jeton (IP différentes) => 12 refus 422, jamais un 429 par adresse', refus.filter(s => s === 422).length, 12);
    const connecte = await post('/api/compte/connexion', { email: 'bob@exemple.fr', motDePasse: MDP, turnstile: 'ok' });
    H.v('connexion : le vrai titulaire se connecte encore (son budget n\'a pas été consommé par les refus de défi)', connecte.statut, 200);
    // ordre : le défi précède la vérification du mot de passe
    const espion = []; const factice0 = P.verifierFactice; P.verifierFactice = async m => { espion.push(m); return factice0(m); };
    await post('/api/compte/connexion', { email: 'inconnu@exemple.fr', motDePasse: MDP });
    H.v('connexion : un refus de défi ne touche ni le compte ni le hachage', espion.length, 0);
    P.verifierFactice = factice0;

    // réponses indistinguables conservées (avec jeton valide)
    const ok = (chemin, corps) => post(chemin, { ...corps, turnstile: 'ok' });
    const mauvais = await ok('/api/compte/connexion', { email: 'bob@exemple.fr', motDePasse: MDP + 'x' });
    const inconnu = await ok('/api/compte/connexion', { email: 'personne@exemple.fr', motDePasse: MDP });
    const attente = await ok('/api/compte/connexion', { email: 'attente@exemple.fr', motDePasse: MDP });
    H.v('connexion : mauvais mot de passe / compte inconnu / non confirmé => 401 identiques à l\'octet', [mauvais.statut, inconnu.texte === mauvais.texte, attente.texte === mauvais.texte], [401, true, true]);
    const envoyesAvant = courrier.envoyes.length;
    const o1 = await ok('/api/compte/mot-de-passe-oublie', { email: 'bob@exemple.fr' }), o2 = await ok('/api/compte/mot-de-passe-oublie', { email: 'personne@exemple.fr' }), o3 = await ok('/api/compte/mot-de-passe-oublie', { email: 'attente@exemple.fr' });
    H.v('oubli : compte connu / inconnu / non confirmé => 202 identiques à l\'octet', [o1.statut, o2.texte === o1.texte, o3.texte === o1.texte], [202, true, true]);
    const r1 = await ok('/api/compte/renvoyer-verification', { email: 'attente@exemple.fr' }), r2 = await ok('/api/compte/renvoyer-verification', { email: 'personne@exemple.fr' }), r3 = await ok('/api/compte/renvoyer-verification', { email: 'bob@exemple.fr' });
    H.v('renvoi : en attente / inconnu / confirmé => 202 identiques à l\'octet', [r1.statut, r2.texte === r1.texte, r3.texte === r1.texte], [202, true, true]);
    await A.attendre();
    // un refus de défi n'envoie aucun courriel
    const avantMail = courrier.envoyes.length;
    await post('/api/compte/mot-de-passe-oublie', { email: 'bob@exemple.fr' }); await post('/api/compte/renvoyer-verification', { email: 'attente@exemple.fr' }); await A.attendre();
    H.v('oubli / renvoi refusés par le défi : aucun courriel', courrier.envoyes.length - avantMail, 0);
    H.vrai('(témoin) les demandes à jeton valide, elles, ont envoyé un courriel', avantMail - envoyesAvant > 0);

    // origine d'écriture : www admis, rien d'autre
    const WWW = 'https://www.rat-market.fr';
    const w = await post('/api/compte/connexion', { email: 'bob@exemple.fr', motDePasse: MDP, turnstile: 'ok' }, { origin: WWW });
    H.v('écriture depuis https://www.rat-market.fr : admise (200 + cookie)', [w.statut, /^rm_session=/.test(w.entetes['set-cookie'] || '')], [200, true]);
    for (const o of ['https://api-v2.rat-market.fr', 'https://evil.rat-market.fr', 'http://www.rat-market.fr', 'https://www.rat-market.fr:8443', 'https://www.rat-market.fr.evil.fr', 'https://WWW.RAT-MARKET.FR', 'https://www.www.rat-market.fr', 'null']) {
        const r = await post('/api/compte/connexion', { email: 'bob@exemple.fr', motDePasse: MDP, turnstile: 'ok' }, { origin: o });
        H.v(`écriture depuis ${o} : 403 ORIGINE`, [r.statut, r.json.erreur.code], [403, 'ORIGINE']);
    }
    const sansEntete = await post('/api/compte/connexion', { email: 'bob@exemple.fr', motDePasse: MDP, turnstile: 'ok' }, { origin: WWW, 'x-rat-market': '0' });
    H.v('www sans X-Rat-Market=1 : 403', sansEntete.statut, 403);

    // CORS www (cookies) : exact, liste fermée
    const pre = await H.appel(srv.url, '/api/compte/connexion', { methode: 'OPTIONS', entetes: { origin: WWW, 'access-control-request-method': 'POST' } });
    H.v('CORS www : préflight 204, origine exacte, cookies permis', [pre.statut, pre.entetes['access-control-allow-origin'], pre.entetes['access-control-allow-credentials']], [204, WWW, 'true']);
    const reel = await post('/api/compte/connexion', {}, { origin: WWW });
    H.v('CORS www : la réponse réelle porte aussi origine + credentials', [reel.entetes['access-control-allow-origin'], reel.entetes['access-control-allow-credentials']], [WWW, 'true']);
    for (const o of ['https://api-v2.rat-market.fr', 'https://evil.rat-market.fr', 'http://www.rat-market.fr', 'https://www.rat-market.fr:8443', 'https://www.rat-market.fr.evil.fr', 'https://www.www.rat-market.fr']) {
        const r = await H.appel(srv.url, '/api/compte/connexion', { methode: 'OPTIONS', entetes: { origin: o, 'access-control-request-method': 'POST' } });
        H.vrai(`CORS : ${o} refusé (aucun Access-Control-Allow-Origin v2)`, r.entetes['access-control-allow-origin'] !== o);
    }
    H.v('configuration : origines.siteWww', [cfg.origines.site, cfg.origines.siteWww], ['https://rat-market.fr', WWW]);

    // fail-closed
    A.registre.vider(); A.registre.fournir('courrier', courrier);
    const f = []; for (const [nom, R] of Object.entries(CHEMINS)) f.push(detail(await post(R.chemin, { ...R.corps('bob@exemple.fr'), turnstile: 'ok' })).slice(0, 2));
    H.v('pilote Turnstile absent : 503 INDISPONIBLE sur les trois routes (fail-closed)', f, [[503, 'INDISPONIBLE'], [503, 'INDISPONIBLE'], [503, 'INDISPONIBLE']]);
    A.registre.fournir('turnstile', { verifier: async () => { throw new Error('boom'); } });
    const g = await post('/api/compte/connexion', { email: 'bob@exemple.fr', motDePasse: MDP, turnstile: 'ok' });
    H.v('vérificateur en panne : 503, pas de session', [g.statut, !!g.entetes['set-cookie']], [503, false]);
    await srv.fermer();

    // V2_TURNSTILE=off (banc) : passe sans appel
    A.registre.vider(); A.registre.fournir('courrier', courrier); A.registre.fournir('turnstile', turnstile);
    const srvOff = await A.demarrer(lireConfig({ MONGODB_BASE: 'test_scratch', V2_TURNSTILE: 'off' })); const avantOff = vus.length;
    const off = await H.appel(srvOff.url, '/api/compte/mot-de-passe-oublie', { methode: 'POST', corps: { email: 'bob@exemple.fr' }, entetes: { ...A.SITE, ...A.ip(901) } });
    H.v('V2_TURNSTILE=off (banc) : passe sans appeler le vérificateur', [off.statut, vus.length - avantOff], [202, 0]);
    await srvOff.fermer();

    // hostname du jeton : liste fermée (rat-market.fr, www.rat-market.fr)
    const hote = h => async () => ({ ok: true, json: async () => ({ success: true, ...(h === undefined ? {} : { hostname: h }) }) });
    const juge = async h => verifierTurnstile('tok', '1.2.3.4', { fetch: hote(h), secret: 'S' });
    H.v('hostname rat-market.fr : accepté', await juge('rat-market.fr'), true);
    H.v('hostname www.rat-market.fr : accepté', await juge('www.rat-market.fr'), true);
    for (const h of ['api-v2.rat-market.fr', 'evil.fr', 'www.rat-market.fr.evil.fr', 'xrat-market.fr', 'localhost', 'WWW.RAT-MARKET.FR', '', 'www.rat-market.fr:443'])
        H.v(`hostname « ${h} » : refusé`, await juge(h), false);
    H.v('hostname absent de la réponse : refusé (une garde s\'écrit par ce qu\'elle autorise)', await juge(undefined), false);
    H.v('hostname non texte : refusé', await verifierTurnstile('tok', null, { fetch: async () => ({ ok: true, json: async () => ({ success: true, hostname: 42 }) }), secret: 'S' }), false);
    H.v('success false avec bon hostname : refusé', await verifierTurnstile('tok', null, { fetch: async () => ({ ok: true, json: async () => ({ success: false, hostname: 'rat-market.fr' }) }), secret: 'S' }), false);

    await H.fermerBac(); H.bilan();
})().catch(e => { console.error('❌', e); process.exit(1); });
