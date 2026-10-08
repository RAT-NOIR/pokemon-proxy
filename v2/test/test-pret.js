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

// lot A : routes directes ; lot B : un sous-routeur monté sur un préfixe ; aucun n'utilise deps.pret
const lotA = { routes(router) { router.get('/api/compte/x', (req, res) => res.json({ ok: 'x' })); router.post('/api/compte/y', (req, res) => res.json({ ok: 'y' })); } };
const lotB = { routes(router) { const sous = express.Router(); sous.get('/z', (req, res) => res.json({ ok: 'z' })); router.use('/api/banc', sous); } };

(async () => {
    const app = express();
    app.get('/ancien', (req, res) => res.json({ ancien: true }));        // route HÉRITÉE : la garde ne doit jamais la toucher
    app.use(assembler([lotA, lotB], {}, {}));
    const s = await H.serveur(app);
    const sur = async (m, chemin) => { const r = await H.appel(s.url, chemin, { methode: m, corps: m === 'POST' ? {} : undefined }); return [r.statut, r.json && (r.json.erreur ? r.json.erreur.code : Object.keys(r.json)[0])]; };
    const toutes = async () => [await sur('GET', '/api/compte/x'), await sur('POST', '/api/compte/y'), await sur('GET', '/api/banc/z')];
    const journal = []; const ce = console.error; console.error = (...a) => { journal.push(a.join(' ')); };

    pret.armer(manque);
    H.v('index manquant : les 3 routes v2 répondent 503 INDISPONIBLE', await toutes(), [[503, 'INDISPONIBLE'], [503, 'INDISPONIBLE'], [503, 'INDISPONIBLE']]);
    H.v('   et la route héritée n\'est pas touchée', await sur('GET', '/ancien'), [200, 'ancien']);
    H.vrai('   et le journal nomme l\'index manquant', journal.some(l => /index manquants : comptes\.comptes_emailCle/.test(l)));

    pret.armer(ok);
    H.v('tous les index présents : les routes passent', await toutes(), [[200, 'ok'], [200, 'ok'], [200, 'ok']]);

    pret.armer(leve);
    H.v('la vérification LÈVE : 503 (une garde qui ne peut pas conclure bloque)', await toutes(), [[503, 'INDISPONIBLE'], [503, 'INDISPONIBLE'], [503, 'INDISPONIBLE']]);

    pret.desarmer();
    H.v('garde jamais armée : 503', await toutes(), [[503, 'INDISPONIBLE'], [503, 'INDISPONIBLE'], [503, 'INDISPONIBLE']]);

    pret.armer(async () => ({}));
    H.v('réponse de vérification sans « manquants » : 503', await sur('GET', '/api/compte/x'), [503, 'INDISPONIBLE']);

    // un middleware GLOBAL posé par un lot (router.use(fn)) s'appliquerait aux routes héritées : refusé à l'assemblage
    let refus = null; try { assembler([{ routes(r) { r.use((req, res, next) => next()); } }], {}, {}); } catch (e) { refus = e.message; }
    H.vrai('router.use(middleware) sans chemin est refusé à l\'assemblage', /refus/.test(refus || ''));

    console.error = ce;
    await s.fermer();
    H.bilan();
})().catch(e => { console.error('❌', e); process.exit(1); });
