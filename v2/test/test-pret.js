'use strict';
// La garde de démarrage (pret) : « un seul index manquant => TOUTES les routes v2 répondent 503 », prouvée sur des routes
// de lots FACTICES qui n'appellent JAMAIS deps.pret (la garde ne doit pas dépendre de la bonne volonté de chaque lot).
// Ce banc n'ouvre pas la base : verif est un faux.
const express = require('express');
const H = require('./_harnais');
const pret = require('../pret');
const { assembler } = require('../index');

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
const refuse = lot => { let m = null; try { assembler([lot], {}, {}); } catch (e) { m = e.message; } return /refus/.test(m || ''); };

(async () => {
    const app = express();
    app.get('/ancien', (req, res) => res.json({ ancien: true }));        // route HÉRITÉE : la garde ne doit jamais la toucher
    app.use(assembler([lotA, lotB], {}, {}));
    app.get('/ancien-apres', (req, res) => res.json({ ancien: 'apres' })); // route HÉRITÉE déclarée APRÈS le montage v2
    const s = await H.serveur(app);
    const sur = async (m, chemin) => { const r = await H.appel(s.url, chemin, { methode: m, corps: ['POST', 'SEARCH'].includes(m) ? {} : undefined }); return [r.statut, r.json && (r.json.erreur ? r.json.erreur.code : Object.keys(r.json)[0])]; };
    const CHEMINS = [['GET', '/api/compte/x'], ['POST', '/api/compte/y'], ['GET', '/api/banc/a'], ['GET', '/api/banc/b'], ['SEARCH', '/api/banc/s'], ['GET', '/api/banc/r'], ['POST', '/api/banc/r']];
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

    // un lot v2 ne pose AUCUN use(), quelle qu'en soit la forme : la pile du routeur ne doit contenir que des couches `route`
    const mw = (req, res, next) => next();
    H.vrai('use(fn) sans chemin est refusé', refuse({ routes(r) { r.use(mw); } }));
    H.vrai('use(\'/\', fn) est refusé', refuse({ routes(r) { r.use('/', mw); } }));
    H.vrai('use([fn]) est refusé', refuse({ routes(r) { r.use([mw]); } }));
    H.vrai('use(chemin, sous-routeur) est refusé', refuse({ routes(r) { r.use('/api/banc', express.Router()); } }));
    H.vrai('un lot qui ne déclare que des routes est accepté', !refuse(lotB));

    console.error = ce;
    await s.fermer();
    H.bilan();
})().catch(e => { console.error('❌', e); process.exit(1); });
