'use strict';
// La garde de démarrage (pret) : « un seul index manquant => TOUTES les routes v2 répondent 503 », prouvée sur des routes
// de lots FACTICES qui n'appellent JAMAIS deps.pret (la garde ne doit pas dépendre de la bonne volonté de chaque lot).
// Ce banc n'ouvre pas la base : verif est un faux.
const express = require('express');
const H = require('./_harnais');
const pret = require('../pret');
const { assembler, aiguilleur } = require('../index');

const ok = async () => ({ manquants: [] });
const manque = async () => ({ manquants: ['comptes.comptes_emailCle'] });
const leve = async () => { throw new Error('base injoignable'); };

// aucun lot n'utilise deps.pret. lot A : routes directes ; lot B : CHAÎNAGE, méthode hors liste (search), router.route()
const h = nom => (req, res) => res.json({ ok: nom });
const lotA = { routes(router) { router.get('/api/compte/x', h('x')); router.post('/api/compte/y', h('y')); } };
const lotB = { routes(router) {
    router.get('/api/banc/a', h('a')).get('/api/banc/b', h('b'));          // chaînage : la 2e route rend le routeur BRUT dans une garde par méthodes
    router.search('/api/banc/s', h('s'));                                   // méthode hors de toute liste écrite à la main
    router.route('/api/banc/r').get(h('r')).post(h('rp'));                  // route() chaîné, plusieurs méthodes
} };
// lot C : garde un objet Route et lui AJOUTE un handler APRÈS l'assemblage (sonde de la relecture)
let routeTardive = null;
const lotC = { routes(router) { routeTardive = router.route('/api/tard'); routeTardive.get(h('t')); } };
// lot D : routes qui RECOUVRENT un chemin hérité, derrière un aiguilleur (contrat 2 / Bearer) — la requête 1.0.x doit retomber sur l'héritée
const lotD = { routes(router) {
    router.post('/api/identifier', aiguilleur(req => req.body?.contrat === 2), h('v2-identifier'));
    router.post('/api/solde', aiguilleur(req => /^Bearer /.test(req.headers.authorization || '')), h('v2-solde'));
    router.get('/ping', aiguilleur(req => req.headers['x-v2'] === '1'), h('v2-ping'));       // HEAD /ping passe par cette route GET
} };
// lot E : prédicats défaillants et aiguilleurs multiples
let appelsLeve = 0;
const lotE = { routes(router) {
    router.post('/api/retour-live', aiguilleur(() => { appelsLeve++; throw new Error('boum'); }), h('v2-rl'));   // lève
    router.post('/api/creer-recharge', aiguilleur(async () => true), h('v2-cr'));                                // asynchrone (Promise)
    router.post('/api/repondre-question', aiguilleur(() => 'oui'), h('v2-rq'));                                  // non booléen
    router.post('/api/apprendre', aiguilleur(() => true), aiguilleur(() => false), h('v2-ap'));                  // le SECOND aiguilleur dit non
} };
const refuse = lot => { let m = null; try { assembler([lot], {}, {}); } catch (e) { m = e.message; } return /refus/.test(m || ''); };

(async () => {
    const app = express();
    app.get('/ancien', (req, res) => res.json({ ancien: true }));        // route HÉRITÉE : la garde ne doit jamais la toucher
    app.use(express.json());
    app.use(assembler([lotA, lotB, lotC, lotD, lotE], {}, {}));
    for (const p of ['/api/retour-live', '/api/creer-recharge', '/api/repondre-question', '/api/apprendre']) app.post(p, (req, res) => res.json({ legacy: p }));
    app.get('/ping', (req, res) => res.json({ legacy: 'ping' }));
    routeTardive.post(h('tp'));                                              // déclaration TARDIVE sur la Route retenue
    app.post('/api/identifier', (req, res) => res.json({ legacy: 'identifier' }));   // routes HÉRITÉES de même chemin, déclarées après
    app.post('/api/solde', (req, res) => res.json({ legacy: 'solde' }));
    app.get('/ancien-apres', (req, res) => res.json({ ancien: 'apres' })); // route HÉRITÉE déclarée APRÈS le montage v2
    const s = await H.serveur(app);
    const sur = async (m, chemin) => { const r = await H.appel(s.url, chemin, { methode: m, corps: ['POST', 'SEARCH'].includes(m) ? {} : undefined }); return [r.statut, r.json && (r.json.erreur ? r.json.erreur.code : Object.keys(r.json)[0])]; };
    const CHEMINS = [['GET', '/api/compte/x'], ['POST', '/api/compte/y'], ['GET', '/api/banc/a'], ['GET', '/api/banc/b'], ['SEARCH', '/api/banc/s'], ['GET', '/api/banc/r'], ['POST', '/api/banc/r'], ['GET', '/api/tard'], ['POST', '/api/tard']];
    const toutes = async () => { const o = []; for (const [m, c] of CHEMINS) o.push(await sur(m, c)); return o; };
    const tous = (statut, code) => CHEMINS.map(() => [statut, code]);
    const journal = []; const ce = console.error; console.error = (...a) => { journal.push(a.join(' ')); };

    pret.armer(manque);
    H.v(`index manquant : les ${CHEMINS.length} routes v2 (chaînage, search, route()) répondent 503 INDISPONIBLE`, await toutes(), tous(503, 'INDISPONIBLE'));
    H.v('   et les routes héritées (avant ET après le montage) ne sont pas touchées', [await sur('GET', '/ancien'), await sur('GET', '/ancien-apres')], [[200, 'ancien'], [200, 'ancien']]);
    H.vrai('   et le journal nomme l\'index manquant', journal.some(l => /index manquants : comptes\.comptes_emailCle/.test(l)));

    pret.armer(ok);
    H.v('tous les index présents : les routes passent', await toutes(), tous(200, 'ok'));

    pret.armer(leve);
    H.v('la vérification LÈVE : 503 (une garde qui ne peut pas conclure bloque)', await toutes(), tous(503, 'INDISPONIBLE'));

    pret.desarmer();
    H.v('garde jamais armée : 503', await toutes(), tous(503, 'INDISPONIBLE'));

    pret.armer(async () => ({}));
    H.v('réponse de vérification sans « manquants » : 503', await sur('GET', '/api/compte/x'), [503, 'INDISPONIBLE']);

    // R1 : un aiguilleur passe AVANT la garde. 1.0.x (sans contrat 2 / sans Bearer) => route HÉRITÉE, même index manquant.
    const poster = async (chemin, corps, entetes) => { const r = await H.appel(s.url, chemin, { methode: 'POST', corps, entetes }); return [r.statut, r.json && (r.json.erreur ? r.json.erreur.code : Object.keys(r.json)[0])]; };
    const BEARER = { Authorization: 'Bearer abc' };
    pret.armer(manque);
    H.v('index manquant, /api/identifier sans contrat 2 : la route héritée répond (200)', await poster('/api/identifier', {}), [200, 'legacy']);
    H.v('index manquant, /api/solde sans Bearer : la route héritée répond (200)', await poster('/api/solde', {}), [200, 'legacy']);
    H.v('index manquant, /api/identifier contrat 2 : 503 INDISPONIBLE', await poster('/api/identifier', { contrat: 2 }), [503, 'INDISPONIBLE']);
    H.v('index manquant, /api/solde avec Bearer : 503 INDISPONIBLE', await poster('/api/solde', {}, BEARER), [503, 'INDISPONIBLE']);
    pret.armer(ok);
    H.v('index présents, contrat 2 : le handler v2', await poster('/api/identifier', { contrat: 2 }), [200, 'ok']);
    H.v('index présents, Bearer : le handler v2', await poster('/api/solde', {}, BEARER), [200, 'ok']);
    H.v('index présents, 1.0.x : toujours l\'héritée', await poster('/api/identifier', {}), [200, 'legacy']);
    pret.armer(leve);
    H.v('vérification qui lève, 1.0.x : l\'héritée répond', await poster('/api/solde', {}), [200, 'legacy']);
    // I-2 : HEAD est servi par les routes GET : l'aiguilleur de la route GET s'applique
    pret.armer(manque);
    const tete = async (chemin, entetes) => (await H.appel(s.url, chemin, { methode: 'HEAD', entetes })).statut;
    H.v('index manquant, HEAD /ping sans x-v2 : la route héritée répond (200)', await tete('/ping'), 200);
    H.v('index manquant, HEAD /ping avec x-v2 : 503', await tete('/ping', { 'x-v2': '1' }), 503);
    H.v('index manquant, GET /ping sans x-v2 : héritée', (await H.appel(s.url, '/ping')).json, { legacy: 'ping' });
    // M-1 : prédicat qui lève / asynchrone / non booléen => route héritée (jamais v2) + journal BORNÉ ; plusieurs aiguilleurs : tous consultés
    const avantJournal = journal.length;
    for (const p of ['/api/retour-live', '/api/creer-recharge', '/api/repondre-question', '/api/apprendre'])
        H.v(`${p} : prédicat défaillant => héritée`, await poster(p, {}), [200, 'legacy']);
    H.vrai('   le journal nomme les prédicats défaillants', journal.slice(avantJournal).filter(l => /aiguilleur/.test(l)).length >= 3);
    for (let i = 0; i < 30; i++) await poster('/api/retour-live', {});
    H.vrai(`   journal BORNÉ : ${journal.filter(l => /aiguilleur/.test(l)).length} lignes pour ${appelsLeve} appels défaillants`, journal.filter(l => /aiguilleur/.test(l)).length <= 12);
    // I-1 : la casse ne contourne rien (Express ignore la casse des chemins)
    H.vrai('/api/Solde (majuscule) est refusé', refuse({ routes(r) { r.post('/api/Solde', h('x')); } }));
    H.vrai('/API/solde est refusé', refuse({ routes(r) { r.post('/API/solde', h('x')); } }));
    H.vrai('/api/compte/Z (majuscule) est refusé', refuse({ routes(r) { r.post('/api/compte/Z', h('x')); } }));
    // une route v2 sur un chemin hérité SANS aiguilleur en tête est refusée au montage
    H.vrai('/api/identifier sans aiguilleur est refusé', refuse({ routes(r) { r.post('/api/identifier', h('x')); } }));
    H.vrai('/api/solde, aiguilleur NON premier, est refusé', refuse({ routes(r) { r.post('/api/solde', h('x'), aiguilleur(() => true), h('y')); } }));
    H.vrai('/ping sans aiguilleur est refusé', refuse({ routes(r) { r.get('/ping', h('x')); } }));
    H.vrai('route.route() : deux méthodes dont une sans aiguilleur => refusé', refuse({ routes(r) { r.route('/api/retour-live').post(aiguilleur(() => true), h('a')).get(h('b')); } }));
    H.vrai('/ping AVEC aiguilleur est accepté', !refuse({ routes(r) { r.get('/ping', aiguilleur(() => false), h('x')); } }));
    H.vrai('un chemin non hérité n\'exige pas d\'aiguilleur', !refuse({ routes(r) { r.post('/api/compte/z', h('x')); } }));
    H.vrai('aiguilleur(non-fonction) lève', (() => { try { aiguilleur('oui'); return false; } catch { return true; } })());

    // un lot v2 ne pose AUCUN use(), quelle qu'en soit la forme : la pile du routeur ne doit contenir que des couches `route`
    const mw = (req, res, next) => next();
    H.vrai('use(fn) sans chemin est refusé', refuse({ routes(r) { r.use(mw); } }));
    H.vrai('use(\'/\', fn) est refusé', refuse({ routes(r) { r.use('/', mw); } }));
    H.vrai('use([fn]) est refusé', refuse({ routes(r) { r.use([mw]); } }));
    H.vrai('use(chemin, sous-routeur) est refusé', refuse({ routes(r) { r.use('/api/banc', express.Router()); } }));
    H.vrai('un lot qui ne déclare que des routes est accepté', !refuse(lotB));
    H.vrai('router.param est refusé (ignoré en silence sinon)', refuse({ routes(r) { r.param('id', (req, res, next) => next()); r.get('/api/x/:id', h('p')); } }));
    // chemins : LISTE BLANCHE (chaîne littérale sous /api/<segment littéral> ou /ping) ; tout le reste est refusé
    for (const mauvais of ['*', '/*', '/api/*', '/api/:x', '/autre', '/api', '/api/', /^\/api\/.*/, ['/api/a', '/api/b'], '/api/a(.*)', '/api/a?', '/ping*', '/apix/a'])
        H.vrai(`chemin de lot ${String(mauvais)} est refusé`, refuse({ routes(r) { r.get(mauvais, h('m')); } }));
    for (const bon of ['/api/compte/x', '/api/compte/:id', '/api/scanner', '/ping/v2'])
        H.vrai(`chemin de lot ${bon} est accepté`, !refuse({ routes(r) { r.get(bon, h('b')); } }));

    console.error = ce;
    await s.fermer();
    H.bilan();
})().catch(e => { console.error('❌', e); process.exit(1); });
