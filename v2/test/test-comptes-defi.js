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

    // C2 (mutants survivants de la relecture 1)
    {
        // (1) l'ordre « limite par IP, PUIS défi » : un client SANS jeton atteint quand même le 429 par IP (le défi n'est pas placé avant la limite)
        const maxIp = cfg.limites.connexionIpHeure, mem = { 'x-forwarded-for': '198.51.100.77' }, codes = [];
        for (let i = 0; i < maxIp + 1; i++) codes.push((await post('/api/compte/connexion', { email: `ip${i}@exemple.fr`, motDePasse: MDP }, mem)).statut);
        H.v(`C2.1 ordre : ${maxIp} requêtes sans jeton d'une même IP => 422, la suivante => 429 (limite IP AVANT le défi)`, [codes.slice(0, maxIp).every(s => s === 422), codes[maxIp]], [true, 429]);
        // (2) le courrier est contrôlé AVANT le défi : sans courrier et sans jeton, 503 (jamais 422)
        A.registre.vider(); A.registre.fournir('turnstile', turnstile);
        const sc = [await post('/api/compte/mot-de-passe-oublie', { email: 'bob@exemple.fr' }), await post('/api/compte/renvoyer-verification', { email: 'bob@exemple.fr' })];
        H.v('C2.2 courrier absent ET jeton absent : 503 INDISPONIBLE sur oubli et renvoi (le courrier précède le défi)', sc.map(r => [r.statut, r.json.erreur.code]), [[503, 'INDISPONIBLE'], [503, 'INDISPONIBLE']]);
        A.registre.fournir('courrier', courrier);
        // (3) un 503 du vérificateur ne débite PAS le budget par adresse : après 12 pannes, les 10 essais de l'adresse passent encore (401), le 11e est 429
        A.registre.fournir('turnstile', { verifier: async () => { throw new Error('panne'); } });
        const pannes = []; for (let i = 0; i < 12; i++) pannes.push((await post('/api/compte/connexion', { email: 'budget@exemple.fr', motDePasse: MDP, turnstile: 'ok' })).statut);
        A.registre.fournir('turnstile', turnstile);
        const apres = []; for (let i = 0; i < 11; i++) apres.push((await post('/api/compte/connexion', { email: 'budget@exemple.fr', motDePasse: MDP, turnstile: 'ok' })).statut);
        H.v('C2.3 budget par adresse intact après 12 réponses 503 : 10 essais => 401 puis 429', [pannes.every(s => s === 503), apres.slice(0, 10).every(s => s === 401), apres[10]], [true, true, 429]);
    }

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

    // Exemption ÉTROITE des outils de mesure : essai seulement + secret >= 32 + en-tête égal ; dispense du DÉFI et de rien d'autre
    {
        const SEC = 'secret-de-mesure-' + 'x'.repeat(20);   // 37 caractères
        const cas = async (env, entetes, route = '/api/compte/connexion', corps = { email: 'bob@exemple.fr', motDePasse: MDP }) => {
            A.registre.vider(); A.registre.fournir('courrier', courrier); A.registre.fournir('turnstile', turnstile);
            const s = await A.demarrer(lireConfig({ MONGODB_BASE: 'test_scratch', ...env }));
            const r = await H.appel(s.url, route, { methode: 'POST', corps, sansDefi: true, entetes: { ...A.SITE, ...A.ip(++n + 3000), ...entetes } });
            await s.fermer(); return r;
        };
        const SERVICE_ESSAI = 'srv-db7ticgm7kps73crjibg';
        const ESSAI = { V2_CIBLE: 'essai', V2_SECRET_MESURE: SEC, RENDER_SERVICE_ID: SERVICE_ESSAI }, EN = { 'x-rat-market-mesure': SEC };
        const st = r => [r.statut, r.json && r.json.erreur && r.json.erreur.detail];
        H.v('mesure : sans en-tête => 422 defi-anti-robot', st(await cas(ESSAI, {})), [422, 'defi-anti-robot']);
        H.v('mesure : en-tête faux => 422', st(await cas(ESSAI, { 'x-rat-market-mesure': SEC + 'z' })), [422, 'defi-anti-robot']);
        H.v('mesure : en-tête vide => 422', st(await cas(ESSAI, { 'x-rat-market-mesure': '' })), [422, 'defi-anti-robot']);
        H.v('mesure : secret trop court (31) => inerte, 422 même avec le bon en-tête', st(await cas({ V2_CIBLE: 'essai', V2_SECRET_MESURE: 'y'.repeat(31) }, { 'x-rat-market-mesure': 'y'.repeat(31) })), [422, 'defi-anti-robot']);
        H.v('mesure : secret absent, en-tête vide ou absent => 422', [st(await cas({ V2_CIBLE: 'essai' }, EN))[0], st(await cas({ V2_CIBLE: 'essai' }, { 'x-rat-market-mesure': 'undefined' }))[0]], [422, 422]);
        H.v('mesure : cible prod (V2_CIBLE=prod) => 422 même avec le bon en-tête', st(await cas({ V2_CIBLE: 'prod', V2_SECRET_MESURE: SEC }, EN)), [422, 'defi-anti-robot']);
        H.v('mesure : V2_CIBLE absente => 422 même avec le bon en-tête', st(await cas({ V2_SECRET_MESURE: SEC }, EN)), [422, 'defi-anti-robot']);
        H.v('mesure : V2_CIBLE « Essai » (casse) => 422', st(await cas({ V2_CIBLE: 'Essai', V2_SECRET_MESURE: SEC }, EN)), [422, 'defi-anti-robot']);
        const bon = await cas(ESSAI, EN);
        H.v('mesure : bon en-tête sur l\'essai => défi sauté, connexion 200 + cookie', [bon.statut, /^rm_session=/.test(bon.entetes['set-cookie'] || '')], [200, true]);
        H.v('mesure : le mot de passe reste vérifié (401, même corps qu\'ailleurs)', (await cas(ESSAI, EN, '/api/compte/connexion', { email: 'bob@exemple.fr', motDePasse: 'faux-faux-faux' })).statut, 401);
        H.v('mesure : l\'origine reste vérifiée (403 sans l\'Origin du site)', (await cas(ESSAI, { ...EN, origin: 'https://evil.fr' })).statut, 403);
        H.v('mesure : oubli et renvoi dispensés aussi (202)', [(await cas(ESSAI, EN, '/api/compte/mot-de-passe-oublie', { email: 'bob@exemple.fr' })).statut, (await cas(ESSAI, EN, '/api/compte/renvoyer-verification', { email: 'bob@exemple.fr' })).statut], [202, 202]);
        const prod = await cas({ V2_CIBLE: 'prod', V2_SECRET_MESURE: SEC }, EN, '/api/compte/mot-de-passe-oublie', { email: 'bob@exemple.fr' });
        H.v('mesure : oubli en prod avec le bon en-tête => 422', prod.statut, 422);
        H.v('mesure : l\'inscription n\'est PAS dispensée (essai, bon en-tête, sans jeton) => 422', st(await cas(ESSAI, EN, '/api/compte/inscription', { email: 'nouveau@exemple.fr' })), [422, 'defi-anti-robot']);
        const L = env => lireConfig({ MONGODB_BASE: 'test_scratch', ...env });
        H.v('configuration : dispense inactive hors essai / sans service de l\'essai, active sur l\'essai', [L({ V2_CIBLE: 'prod', V2_SECRET_MESURE: SEC, RENDER_SERVICE_ID: SERVICE_ESSAI }).mesure.actif, L(ESSAI).mesure.actif], [false, true]);
        // M1 : les variables de l'essai copiées sur un AUTRE service (ou hors Render) n'allument rien
        H.v('M1 : variables de l\'essai copiées sur un autre service Render => 422 même avec le bon en-tête', st(await cas({ ...ESSAI, RENDER_SERVICE_ID: 'srv-autre-service-prod' }, EN)), [422, 'defi-anti-robot']);
        H.v('M1 : RENDER_SERVICE_ID absent (hors Render) => 422', st(await cas({ V2_CIBLE: 'essai', V2_SECRET_MESURE: SEC }, EN)), [422, 'defi-anti-robot']);
        H.v('M1 : identifiant de service de casse différente => 422', st(await cas({ ...ESSAI, RENDER_SERVICE_ID: SERVICE_ESSAI.toUpperCase() }, EN)), [422, 'defi-anti-robot']);
        H.v('M1 : la raison d\'inactivité nomme la cause', [L({ V2_CIBLE: 'essai', V2_SECRET_MESURE: SEC, RENDER_SERVICE_ID: 'srv-x' }).mesure.raison, L({ V2_CIBLE: 'prod', V2_SECRET_MESURE: SEC }).mesure.raison, L({}).mesure.raison, L({ V2_CIBLE: 'essai', V2_SECRET_MESURE: 'court', RENDER_SERVICE_ID: SERVICE_ESSAI }).mesure.raison].map(x => typeof x === 'string' && x.length > 5 && !x.includes(SEC)), [true, true, true, true]);
        // F1 : le secret n'est nulle part dans la configuration énumérable, ni dans sa sérialisation
        const cfgE = L(ESSAI);
        H.vrai('F1 : ni JSON.stringify(cfg) ni util.inspect(cfg) ne contiennent le secret ni son condensé', ![JSON.stringify(cfgE), require('util').inspect(cfgE, { depth: 6, showHidden: false }), JSON.stringify(cfgE.mesure)].some(s => s.includes(SEC) || s.includes(require('crypto').createHash('sha256').update(SEC).digest('hex'))));
        H.vrai('F1 : cfg.secretMesure n\'existe plus (en clair)', !('secretMesure' in cfgE));
        // la ligne de démarrage dit active / inactive (raison), sans le secret
        const lignes = []; const lg = console.log; console.log = (...a) => lignes.push(a.join(' '));
        try { for (const env of [ESSAI, { ...ESSAI, RENDER_SERVICE_ID: 'srv-autre' }]) { A.registre.vider(); A.registre.fournir('courrier', courrier); A.registre.fournir('turnstile', turnstile); const s = await A.demarrer(L(env)); await s.fermer(); } } finally { console.log = lg; }
        const dm = lignes.filter(l => l.includes('dispense de mesure'));
        H.v('démarrage : une ligne « dispense de mesure : active » puis « inactive (raison) », sans le secret', [dm.length, /active/.test(dm[0]) && !/inactive/.test(dm[0]), /inactive \(.+\)/.test(dm[1]), dm.some(l => l.includes(SEC))], [2, true, true, false]);
    }

    // Les outils de mesure portent l'en-tête (secret lu par NOM, jamais imprimé) quand le secret existe, et rien sinon
    {
        const CE = require('../mesures/connexion-essai'); const PT = require('../admin/abonnements/parcours-test');
        const SEC = 'secret-de-mesure-' + 'x'.repeat(20);
        const ids0 = CE.lireIdentifiants({ V2_ESSAI_BANC_IDENTIFIANT: 'a@b.fr', V2_ESSAI_BANC_MOT_DE_PASSE: 'mdp' }, null);
        const ids1 = CE.lireIdentifiants({ V2_ESSAI_BANC_IDENTIFIANT: 'a@b.fr', V2_ESSAI_BANC_MOT_DE_PASSE: 'mdp', V2_SECRET_MESURE: SEC }, null);
        H.v('outil : sans V2_SECRET_MESURE les identifiants gardent leur forme', ids0, { identifiant: 'a@b.fr', motDePasse: 'mdp' });
        H.v('outil : avec V2_SECRET_MESURE, le secret accompagne les identifiants', ids1.secretMesure, SEC);
        const vusEntetes = []; const appeler = async (chemin, init) => { vusEntetes.push(init.headers); return { statut: 200, cookie: 'rm_session=abc' }; };
        await CE.ouvrirSession({ appeler, ids: ids1 }); await CE.ouvrirSession({ appeler, ids: ids0 });
        H.v('outil connexion-essai : l\'en-tête X-Rat-Market-Mesure n\'est posé qu\'avec le secret', [vusEntetes[0]['X-Rat-Market-Mesure'], vusEntetes[1]['X-Rat-Market-Mesure']], [SEC, undefined]);
        const enteteParcours = []; const fetchF = async (u, o) => { enteteParcours.push(o.headers); return { status: 200, headers: { get: () => 'rm_session=zz', getSetCookie: () => ['rm_session=zz'] } }; };
        const ESSAI_URL = 'https://rat-market-api-essai.onrender.com', cpt = { role: 'r', email: 'a@b.fr', motDePasse: 'm' };
        await PT.connecter(ESSAI_URL, cpt, fetchF, SEC); await PT.connecter(ESSAI_URL, cpt, fetchF);
        H.v('outil parcours-test : l\'en-tête n\'est posé qu\'avec le secret', [enteteParcours[0]['x-rat-market-mesure'], enteteParcours[1]['x-rat-market-mesure']], [SEC, undefined]);
        // F2 : le secret ne part QU'À l'hôte exact de l'essai ; ailleurs, refus local sans aucune requête
        const avantF2 = enteteParcours.length; const refus = [];
        for (const u of ['https://rat-market-api.onrender.com', 'https://api-v2.rat-market.fr', 'https://rat-market-api-essai.onrender.com.evil.fr', 'http://rat-market-api-essai.onrender.com', 'https://x']) {
            let m = null; try { await PT.connecter(u, cpt, fetchF, SEC); } catch (e) { m = String(e.message); }
            refus.push([m !== null && m.includes('V2_SECRET_MESURE') && !m.includes(SEC)]);
        }
        H.v('F2 parcours-test : hôte autre que l\'essai + secret => refus local nommant la variable, aucune requête', [refus.every(r => r[0]), enteteParcours.length - avantF2], [true, 0]);
        let ouvre = null; try { await CE.ouvrirSession({ appeler, ids: ids1, base: 'https://rat-market-api.onrender.com' }); } catch (e) { ouvre = e.message; }
        H.vrai('F2 connexion-essai : la base de l\'outil est déjà bornée à l\'essai (baseAutorisee)', CE.baseAutorisee('https://rat-market-api-essai.onrender.com') !== undefined);
        // message clair : 422 defi-anti-robot => la variable est NOMMÉE, le secret jamais imprimé
        const a422 = async () => ({ statut: 422, corps: { success: false, erreur: { code: 'ENTREE', detail: 'defi-anti-robot' } }, cookie: null });
        for (const [nom, ids] of [['sans secret', ids0], ['avec secret', ids1]]) {
            let m = null; try { await CE.ouvrirSession({ appeler: a422, ids }); } catch (e) { m = e.message; }
            H.v(`outil connexion-essai (${nom}) : 422 defi-anti-robot => message qui nomme V2_SECRET_MESURE, sans le secret`, [m !== null && m.includes('V2_SECRET_MESURE'), m !== null && m.includes(SEC)], [true, false]);
        }
        const f422 = async () => ({ status: 422, headers: { get: () => null, getSetCookie: () => [] }, json: async () => ({ erreur: { code: 'ENTREE', detail: 'defi-anti-robot' } }) });
        for (const sec of [null, SEC]) {
            let m = null; try { await PT.connecter(ESSAI_URL, cpt, f422, sec); } catch (e) { m = e.message; }
            H.v(`outil parcours-test (${sec ? 'avec' : 'sans'} secret) : 422 defi-anti-robot => message qui nomme V2_SECRET_MESURE, sans le secret`, [m !== null && m.includes('V2_SECRET_MESURE'), m !== null && m.includes(SEC)], [true, false]);
        }
    }

    // hostname du jeton : liste fermée (rat-market.fr, www.rat-market.fr)
    const hote = h => async () => ({ ok: true, json: async () => ({ success: true, ...(h === undefined ? {} : { hostname: h }) }) });
    const juge = async h => verifierTurnstile('tok', '1.2.3.4', { fetch: hote(h), secret: 'S' });
    H.v('hostname rat-market.fr : accepté', await juge('rat-market.fr'), true);
    H.v('hostname www.rat-market.fr : accepté', await juge('www.rat-market.fr'), true);
    for (const h of ['api-v2.rat-market.fr', 'evil.fr', 'www.rat-market.fr.evil.fr', 'xrat-market.fr', 'localhost', 'WWW.RAT-MARKET.FR', '', 'www.rat-market.fr:443'])
        H.v(`hostname « ${h} » : refusé`, await juge(h), false);
    // F3 : un 5xx / un non-2xx / une panne réseau de siteverify LÈVE (=> 503), jamais un refus (422) ; l'action est vérifiée (liste fermée par route)
    for (const [nom, f] of [['500', async () => ({ ok: false, status: 500, json: async () => ({}) })], ['503', async () => ({ ok: false, status: 503, json: async () => ({}) })], ['400', async () => ({ ok: false, status: 400, json: async () => ({}) })], ['réseau', async () => { throw new Error('ECONNRESET'); }]]) {
        let leve = null; try { await verifierTurnstile('tok', null, { fetch: f, secret: 'S' }); } catch (e) { leve = e.message; }
        H.vrai(`F3 : siteverify « ${nom} » => le vérificateur LÈVE (503 côté route)`, leve !== null);
    }
    {
        A.registre.vider(); A.registre.fournir('courrier', courrier);
        A.registre.fournir('turnstile', { verifier: async () => verifierTurnstile('tok', null, { fetch: async () => ({ ok: false, status: 502, json: async () => ({}) }), secret: 'S' }) });
        const s5 = await demarrerAvecCors(cfg); const r5 = await H.appel(s5.url, '/api/compte/connexion', { methode: 'POST', corps: { email: 'bob@exemple.fr', motDePasse: MDP, turnstile: 'ok' }, entetes: { ...A.SITE, ...A.ip(7001) } }); await s5.fermer();
        H.v('F3 : siteverify en 502 => la route répond 503 INDISPONIBLE (pas 422 defi-anti-robot)', [r5.statut, r5.json.erreur.code], [503, 'INDISPONIBLE']);
        const ACT = (a, h = 'rat-market.fr') => async () => ({ ok: true, json: async () => ({ success: true, hostname: h, ...(a === undefined ? {} : { action: a }) }) });
        const avecAction = (a, attendue) => verifierTurnstile('tok', null, { fetch: ACT(a), secret: 'S', action: attendue });
        H.v('F3 action : celle de la route => accepté', [await avecAction('connexion', 'connexion'), await avecAction('inscription', 'inscription'), await avecAction('oubli', 'oubli'), await avecAction('renvoi', 'renvoi')], [true, true, true, true]);
        H.v('F3 action : celle d\'une autre route, absente, vide, casse ou non texte => refusé', [await avecAction('inscription', 'connexion'), await avecAction(undefined, 'connexion'), await avecAction('', 'connexion'), await avecAction('Connexion', 'connexion'), await avecAction(42, 'connexion')], [false, false, false, false, false]);
        const vusAction = []; A.registre.vider(); A.registre.fournir('courrier', courrier);
        A.registre.fournir('turnstile', { verifier: async (j, ip, action) => { vusAction.push(action); return true; } });
        const s6 = await demarrerAvecCors(cfg);
        for (const [chemin, corps] of [['/api/compte/connexion', { email: 'bob@exemple.fr', motDePasse: MDP }], ['/api/compte/mot-de-passe-oublie', { email: 'bob@exemple.fr' }], ['/api/compte/renvoyer-verification', { email: 'bob@exemple.fr' }], ['/api/compte/inscription', { email: 'action@exemple.fr' }]])
            await H.appel(s6.url, chemin, { methode: 'POST', corps: { ...corps, turnstile: 'ok' }, entetes: { ...A.SITE, ...A.ip(7100 + vusAction.length) } });
        await s6.fermer(); await A.attendre();
        H.v('F3 action : chaque route demande SON action (connexion, oubli, renvoi, inscription)', vusAction, ['connexion', 'oubli', 'renvoi', 'inscription']);
    }
    H.v('hostname absent de la réponse : refusé (une garde s\'écrit par ce qu\'elle autorise)', await juge(undefined), false);
    H.v('hostname non texte : refusé', await verifierTurnstile('tok', null, { fetch: async () => ({ ok: true, json: async () => ({ success: true, hostname: 42 }) }), secret: 'S' }), false);
    H.v('success false avec bon hostname : refusé', await verifierTurnstile('tok', null, { fetch: async () => ({ ok: true, json: async () => ({ success: false, hostname: 'rat-market.fr' }) }), secret: 'S' }), false);

    await H.fermerBac(); H.bilan();
})().catch(e => { console.error('❌', e); process.exit(1); });
