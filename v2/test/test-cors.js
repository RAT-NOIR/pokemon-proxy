'use strict';
// B4.1 — le CORS à origines exactes. Une garde se prouve en refusant les origines VOISINES.
const express = require('express');
const H = require('./_harnais');
const M = require('../modeles');
const L = require('../transport/limites');
const { lireConfig } = require('../config');
const cors = require('../transport/cors');

const EXT = 'chrome-extension://fgibgdgmadfejkaapeohbhaoolhgpkhb';
const SITE = 'https://rat-market.fr';
const ACAO = 'access-control-allow-origin';

function fabriquerApp(cfg) {
    const app = express();
    app.use(cors.middlewareV2(cfg));
    app.use(express.json());
    app.get('/ping', (req, res) => res.json({ ok: true, origineV2: req.origineV2 === true, definie: 'origineV2' in req }));
    app.get('/api/solde', (req, res) => res.status(500).json({ erreur: 'x' }));
    app.post('/api/identifier', L.limiteur({ nom: 'cors-essai', max: 1, fenetreMs: 3600e3, cle: () => 'unique' }), (req, res) => res.json({ ok: true }));
    app.get('/api/inconnu', (req, res) => res.status(404).json({ erreur: 'x' }));
    app.post('/api/compte/connexion', (req, res) => res.json({ ok: true }));
    app.post('/api/compte/code', (req, res) => res.json({ ok: true }));
    app.get('/api/vinted-herite', (req, res) => res.json({ ok: true, origineV2: req.origineV2 }));
    return app;
}

(async () => {
    await H.ouvrirBac('test-cors.js'); await M.creerIndex();
    const cfg = lireConfig({ MONGODB_BASE: 'test_scratch' });
    const srv = await H.serveur(fabriquerApp(cfg));
    const u = srv.url;
    const o = (origine, extra = {}) => ({ ...(origine === undefined ? {} : { origin: origine }), ...extra });

    // 1. extension, préflight
    let r = await H.appel(u, '/api/identifier', { methode: 'OPTIONS', entetes: o(EXT, { 'access-control-request-method': 'POST' }) });
    H.v('1. extension, OPTIONS /api/identifier => 204', r.statut, 204);
    H.v('   Allow-Origin = origine exacte', r.entetes[ACAO], EXT);
    H.v('   Allow-Methods', r.entetes['access-control-allow-methods'], 'GET, POST');
    H.v('   Allow-Headers', r.entetes['access-control-allow-headers'], 'Authorization, Content-Type, Idempotency-Key');
    H.v('   Max-Age', r.entetes['access-control-max-age'], '600');
    H.v('   Allow-Credentials ABSENT', 'access-control-allow-credentials' in r.entetes, false);
    H.vrai('   Vary: Origin', /origin/i.test(r.entetes.vary || ''));
    H.v('   Expose-Headers', r.entetes['access-control-expose-headers'], 'Retry-After, Idempotency-Replayed');

    // 2. en-têtes aussi sur les erreurs
    r = await H.appel(u, '/ping', { entetes: o(EXT) });
    H.v('2. extension, GET /ping : en-tête posé', r.entetes[ACAO], EXT);
    r = await H.appel(u, '/api/solde', { entetes: o(EXT) });
    H.v('   GET /api/solde qui répond 500 : statut', r.statut, 500);
    H.v('   ... les en-têtes CORS sont là', r.entetes[ACAO], EXT);
    await H.appel(u, '/api/identifier', { methode: 'POST', corps: {}, entetes: o(EXT) });
    r = await H.appel(u, '/api/identifier', { methode: 'POST', corps: {}, entetes: o(EXT) });
    H.v('   POST /api/identifier limité : 429', r.statut, 429);
    H.v('   ... les en-têtes CORS sont là sur le 429', r.entetes[ACAO], EXT);
    H.v('   ... Retry-After exposé', r.entetes['access-control-expose-headers'], 'Retry-After, Idempotency-Replayed');
    r = await H.appel(u, '/api/inconnu', { entetes: o(EXT) });
    H.v('   GET /api/inconnu (404) : pas d\'en-tête (chemin hors profil)', r.entetes[ACAO], undefined);

    // 3. site
    r = await H.appel(u, '/api/compte/connexion', { methode: 'OPTIONS', entetes: o(SITE, { 'access-control-request-method': 'POST' }) });
    H.v('3. site, OPTIONS /api/compte/connexion => 204', r.statut, 204);
    H.v('   Allow-Origin', r.entetes[ACAO], SITE);
    H.v('   Allow-Credentials', r.entetes['access-control-allow-credentials'], 'true');
    H.v('   Allow-Methods', r.entetes['access-control-allow-methods'], 'GET, POST, DELETE');
    H.v('   Allow-Headers', r.entetes['access-control-allow-headers'], 'Content-Type, X-Rat-Market, Idempotency-Key');
    H.v('   Max-Age', r.entetes['access-control-max-age'], '600');
    r = await H.appel(u, '/api/compte/connexion', { methode: 'POST', corps: {}, entetes: o(SITE) });
    H.v('   POST réel : Allow-Origin + Credentials', [r.entetes[ACAO], r.entetes['access-control-allow-credentials']], [SITE, 'true']);

    // 4. croisements et voisines refusés
    const refus = [
        ['site sur /api/identifier', SITE, '/api/identifier'],
        ['extension sur /api/compte/code', EXT, '/api/compte/code'],
        ['site sur /api/vinted-herite (hors profil)', SITE, '/api/vinted-herite'],
        ['rat-market.fr.evil.fr', 'https://rat-market.fr.evil.fr', '/ping'],
        ['rat-market.fr.evil.com', 'https://rat-market.fr.evil.com', '/api/compte/connexion'],
        ['evil.com', 'https://evil.com', '/api/solde'],
        ['autre extension', 'chrome-extension://abcdefghijklmnopabcdefghijklmnop', '/api/solde'],
        ['extension + suffixe', EXT + 'x', '/ping'],
        ['http://rat-market.fr', 'http://rat-market.fr', '/api/compte/connexion'],
        ['https://www.rat-market.fr', 'https://www.rat-market.fr', '/ping'],
        ['https://rat-market.fr:8443', 'https://rat-market.fr:8443', '/ping'],
        ['*.onrender.com', 'https://pokemon-proxy.onrender.com', '/ping'],
        ['Origin: null', 'null', '/ping'],
        ['majuscules', 'HTTPS://RAT-MARKET.FR', '/ping'],
        ['vinted (hérité)', 'https://www.vinted.fr', '/api/solde']
    ];
    for (const [nom, origine, chemin] of refus) {
        for (const methode of ['GET', 'OPTIONS']) {
            r = await H.appel(u, chemin, { methode, entetes: o(origine, methode === 'OPTIONS' ? { 'access-control-request-method': 'GET' } : {}) });
            H.vrai(`4. refusé (${methode}) ${nom} : aucun en-tête Access-Control-*`, !Object.keys(r.entetes).some(k => k.startsWith('access-control-')));
        }
    }

    // 5. jamais '*'
    const combos = [];
    for (const origine of [EXT, SITE, 'null', 'https://evil.com', undefined]) for (const chemin of ['/ping', '/api/solde', '/api/identifier']) for (const methode of ['GET', 'OPTIONS']) combos.push([origine, chemin, methode]);
    let etoiles = 0;
    for (const [origine, chemin, methode] of combos) {
        r = await H.appel(u, chemin, { methode, entetes: o(origine, { 'access-control-request-method': 'GET' }) });
        if (r.entetes[ACAO] === '*') etoiles++;
    }
    H.v(`5. jamais '*' (${combos.length} combinaisons)`, etoiles, 0);

    // 6. sans Origin
    r = await H.appel(u, '/ping');
    H.v('6. sans Origin : passe (200) sans en-tête', [r.statut, r.entetes[ACAO]], [200, undefined]);
    H.vrai('   ... mais Vary: Origin quand même (un cache ne doit pas confondre les origines)', /origin/i.test(r.entetes.vary || ''));
    r = await H.appel(u, '/api/solde', { entetes: o('https://evil.com') });
    H.vrai('   origine refusée sur un chemin v2 : Vary: Origin aussi, mais aucun Access-Control-*', /origin/i.test(r.entetes.vary || '') && !(ACAO in r.entetes));
    r = await H.appel(u, '/api/vinted-herite', { entetes: o('https://www.vinted.fr') });
    H.vrai('   chemin hérité : aucun Vary ajouté par la v2', !/origin/i.test(r.entetes.vary || ''));
    H.v('   extension non empaquetée : ignorée hors test_scratch', lireConfig({ MONGODB_BASE: 'test', V2_ORIGINE_EXTENSION_DEV: 'chrome-extension://dev' }).origines.extensionDev, null);
    H.v('   ... ignorée sans base nommée', lireConfig({ V2_ORIGINE_EXTENSION_DEV: 'chrome-extension://dev' }).origines.extensionDev, null);
    const DEV = 'chrome-extension://devdevdevdevdevdevdevdevdevdevde';
    const cfgDev = lireConfig({ MONGODB_BASE: 'test_scratch', V2_ORIGINE_EXTENSION_DEV: DEV });
    const srvDev = await H.serveur(fabriquerApp(cfgDev));
    r = await H.appel(srvDev.url, '/api/solde', { entetes: o(DEV) });
    H.v('   test_scratch : l\'extension dev est reconnue', r.entetes[ACAO], DEV);
    r = await H.appel(srvDev.url, '/api/compte/connexion', { methode: 'OPTIONS', entetes: o(DEV, { 'access-control-request-method': 'POST' }) });
    H.vrai('   ... mais seulement sur les chemins du profil extension', !('access-control-allow-origin' in r.entetes));
    await srvDev.fermer();
    // sans cfg dev : l'origine dev est refusée
    r = await H.appel(u, '/api/solde', { entetes: o(DEV) });
    H.v('   sans configuration dev, cette origine est refusée', r.entetes[ACAO], undefined);

    // 7. req.origineV2
    r = await H.appel(u, '/ping', { entetes: o(EXT) });
    H.v('7. origine v2 sur chemin du profil : req.origineV2 === true', r.json.origineV2, true);
    r = await H.appel(u, '/ping', { entetes: o('https://www.vinted.fr') });
    H.v('   origine héritée : req.origineV2 indéfini (le cors() hérité décide)', [r.json.origineV2, r.json.definie], [false, false]);
    r = await H.appel(u, '/ping');
    H.v('   sans Origin : req.origineV2 indéfini', [r.json.origineV2, r.json.definie], [false, false]);
    r = await H.appel(u, '/ping', { entetes: o('https://rat-market.fr.evil.fr') });
    H.v('   origine voisine : req.origineV2 indéfini', r.json.definie, false);

    await srv.fermer(); await H.fermerBac(); H.bilan();
})().catch(e => { console.error('❌', e); process.exit(1); });
