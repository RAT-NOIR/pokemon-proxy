'use strict';
// GALERIE — BANC D'INERTIE COMPLET (tour 1, M10) : l'application v2 ENTIÈRE (tous les lots, `index.js` LOTS), montée SANS `V2_GALERIE`, ne sait RIEN de la Communauté :
//   · chaque route de la galerie, des classeurs et des illustrations répond le 404 natif d'Express, OCTET POUR OCTET le corps d'une route qui n'a jamais existé (application nue de référence) ;
//   · `GET /api/compte` ne porte NI `pseudo` NI `role` ;
//   · aucun chemin de la Communauté dans le CORS (une préflight d'origine du site ne reçoit aucun en-tête CORS).
// Et le banc SAIT DIRE NON : un lot monté malgré le drapeau absent, et un CORS qui ajoute les chemins sans drapeau, le font échouer.
const A = require('./_aide-galerie');
const H = A.H;

(async () => {
    await H.ouvrirBac('test-galerie-inertie.js');
    const express = require('express'), db = require('../db'), M = require('../modeles');
    await M.creerIndex(); H.fixerHorlogeMilieu();
    const { lireConfig } = require('../config'), { lireGalerie } = require('../galerie/config'), F = require('../galerie/forme');
    const pret = require('../pret'), { assembler, LOTS } = require('../index'), transport = require('../transport/monter'), sessions = require('../comptes/sessions');
    const OPENAPI = require('../openapi/openapi.v2.json');
    const cfg = { ...lireConfig({ MONGODB_BASE: 'test_scratch' }), galerie: lireGalerie({}) };
    const SITE = cfg.origines.site;
    H.v('instrument : sans V2_GALERIE, la configuration de la Communauté est éteinte', [cfg.galerie.actif, cfg.galerie.pret], [false, false]);

    const montee = async (cfgX, lots, deps = {}) => { const app = express(); app.set('trust proxy', true); transport.enTete(app, cfgX); app.use(express.json()); pret.armer(M.verifierIndex); app.use(assembler(lots, cfgX, deps)); return H.serveur(app); };
    const entiere = await montee(cfg, LOTS);
    const nue = await (async () => { const app = express(); app.use(express.json()); return H.serveur(app); })();

    // un compte avec session, pour les routes à cookie et pour GET /api/compte
    const adresse = `inertie.${Date.now().toString(36)}@exemple.fr`, c = Object.assign(M.nouveauCompte({ email: adresse, emailCle: adresse, motDePasse: {} }), { verifie: true });
    await db.col('comptes').insertOne(c); const s = await sessions.creerSession(c._id), cookie = `rm_session=${s.token}`;

    // TOUTES les opérations que le contrat range sous « galerie » (les 34), avec un chemin concret
    const id = F.nouvelId();
    const ops = Object.entries(OPENAPI.paths).flatMap(([chemin, o]) => Object.entries(o).filter(([, op]) => op && op.tags && op.tags.includes('galerie')).map(([m]) => ({ m: m.toUpperCase(), chemin: chemin.replace(/\{(id|depot)\}/g, id).replace('{n}', '1') })));
    H.v('instrument : 34 opérations de la Communauté à éprouver', ops.length, 34);
    const lecons = [];
    for (const { m, chemin } of ops) {
        const entetes = { origin: SITE, 'x-rat-market': '1', cookie, 'content-type': 'application/json' };
        const a = await H.appel(entiere.url, chemin, { methode: m, corps: m === 'GET' || m === 'DELETE' ? undefined : {}, entetes }), b = await H.appel(nue.url, chemin, { methode: m, corps: m === 'GET' || m === 'DELETE' ? undefined : {}, entetes });
        if (a.statut !== 404 || b.statut !== 404 || a.texte !== b.texte) lecons.push(`${m} ${chemin} : ${a.statut} ${JSON.stringify(a.texte).slice(0, 60)}`);
    }
    H.v('M10 — SANS V2_GALERIE, les 34 opérations répondent 404 natif, octet pour octet le corps d\'une route qui n\'existe pas', lecons, []);

    const compte = await H.appel(entiere.url, '/api/compte', { entetes: { cookie, origin: SITE } });
    H.v('   GET /api/compte (session valide) : 200, aucune clé `pseudo` ni `role` dans `compte`', [compte.statut, Object.keys((compte.json && compte.json.compte) || {}).filter(k => ['pseudo', 'role'].includes(k))], [200, []]);

    // CORS : la préflight d'une origine du site sur les chemins de la Communauté ne reçoit AUCUN en-tête CORS (hors `/api/compte/pseudo`, déjà sous le profil des comptes avant ce lot)
    const chemins = [...new Set(ops.map(o => o.chemin))].filter(p => !p.startsWith('/api/compte'));
    const cors = [];
    for (const p of chemins) { const r = await H.appel(entiere.url, p, { methode: 'OPTIONS', entetes: { origin: SITE, 'access-control-request-method': 'PUT' } }); if (r.entetes['access-control-allow-origin'] || r.entetes['access-control-allow-credentials'] || r.entetes['access-control-allow-methods']) cors.push(p); }
    H.v('   CORS : aucun chemin de la Communauté n\'y figure (aucun en-tête CORS sur la préflight du site)', cors, []);

    // ═══ le banc sait dire NON ═══
    {
        const { profils } = require('../transport/cors'), mc = A.charger('../transport/cors.js', [["if (cfg.galerie && cfg.galerie.actif === true)", "if (true)"]]);
        const siteGalerie = P => P.profils(cfg).find(x => x.nom === 'site').chemins.some(re => re.test('/api/classeurs/abc'));
        H.v('MUTANT « les chemins de la Communauté entrent dans le CORS sans le drapeau » : le réel n\'y est pas, le mutant si', [siteGalerie({ profils }), siteGalerie(mc)], [false, true]);
        const cfgPret = { ...cfg, galerie: { ...lireGalerie(A.ENV_VALIDE), actif: false } };          // configuration « prête » mais drapeau éteint : le lot réel ne se monte pas
        const deps = { stockage: A.fauxStockage(), ouvrirBase: async () => { throw new Error('banc : aucune base'); }, balayage: false };
        const monter = require('../galerie/monter'), lotMut = A.charger('monter.js', [["if (!g || !g.actif) { etat = 'eteint'; return; }", "if (false) { return; }"], ["if (!g.pret) {", "if (false) {"]]);
        const sReel = await montee(cfgPret, [monter], deps), sMut = await montee(cfgPret, [lotMut], deps);
        const appelle = sv => H.appel(sv.url, '/api/classeurs', { entetes: { origin: SITE, cookie } });
        H.v('MUTANT « lot monté malgré le drapeau absent » : GET /api/classeurs — le lot réel : 404 natif ; la copie mutée monte la route (jamais un 404)', [(await appelle(sReel)).statut, (await appelle(sMut)).statut !== 404], [404, true]);
        await monter.arreter();
        for (const x of [sReel, sMut]) await x.fermer();
    }

    for (const x of [entiere, nue]) await x.fermer();
    require('../index').arreter();          // l'application entière a posé ses minuteurs : on les arrête (sinon le banc ne sort pas)
    await H.fermerBac();
    H.bilan();
})();
