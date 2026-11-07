'use strict';
// L5/L6 — ÉTAT et LANGUE par exemplaire dans « Ma collection », sous la forme K5 ÉCRITE PAR LE SITE (DEMANDE-SERVEUR-SITE.md, O13) :
//   PUT /api/collection/sets/{slug}/fiches/{cle}/exemplaires   { exemplaires: [{ etat: "MT"|"NM"|"EX"|"GD"|"LP"|"PL"|"PO"|null, langue: <code>|null }] }  (au plus `quantite` éléments)  →  { success, exemplaires }
//   lecture : `exemplaires?: { [cle]: [{ etat, langue }, …] }` dans GET /sets/{slug} — UN élément par exemplaire détaillé, champ ABSENT quand il est vide.
// MODÈLE : la quantité de la fiche (K3, bit + `qte`, inchangés) reste le TOTAL ; le détail `ex` donne l'état et la langue de certains exemplaires (somme ≤ total), le reste est non précisé.
//   L'écriture K5 REMPLACE tout le détail de la fiche ; un élément { null, null } est un exemplaire non précisé (il n'est pas stocké : c'est le reste du total).
// Base EN MÉMOIRE (INT2), aucun réseau. Les données d'un autre compte ne sont jamais lues.
const H = require('./_harnais');
const mongoose = require('mongoose');
const express = require('express');
const db = require('../db'); const M = require('../modeles');
const { lireConfig } = require('../config');
const cfg = lireConfig({ MONGODB_BASE: 'test_scratch' });
const SITE = cfg.origines.site;
const raw = n => mongoose.connection.db.collection(n);
let nCompte = 0, nIp = 0;
const IP = () => { nIp++; return `10.78.${Math.floor(nIp / 250)}.${nIp % 250 + 1}`; };
const attendre = ms => new Promise(r => setTimeout(r, ms));

(async () => {
    await H.ouvrirBancV2();
    process.env.MONGODB_BASE = 'test_scratch';
    const { connecterMongo } = require('../../mongo-connexion');
    await connecterMongo({ script: 'test-collection-exemplaires.js', ecrit: true });
    db.brancher(mongoose.connection.db);
    await M.creerIndex();
    H.fixerHorlogeMilieu();
    const pret = require('../pret'); const v2 = require('../index'); const { assembler } = v2; const transport = require('../transport/monter');
    const routes = require('../collection/routes'); const F = require('../collection/forme'); const svc = require('../collection/service'); const VB = require('./_visuels-banc');

    async function compte(o = {}) {
        const adresse = `exe${++nCompte}.${Date.now().toString(36)}@exemple.fr`;
        const c = Object.assign(M.nouveauCompte({ email: adresse, emailCle: adresse, motDePasse: {} }), { verifie: true }, o);
        await raw('comptes').insertOne(c);
        const s = await require('../comptes/sessions').creerSession(c._id);
        return { c, adresse, token: s.token, cookie: `rm_session=${s.token}` };
    }
    const siteH = (cookie, plus = {}) => ({ origin: SITE, 'x-rat-market': '1', ...(cookie ? { cookie } : {}), 'x-forwarded-for': IP(), ...plus });
    const gestionnaireFinal = (err, req, res, next) => { if (res.headersSent) return next(err); return res.status(500).json({ success: false, error: 'Erreur serveur interne' }); };
    async function serveur(cfgX = cfg) {
        const lot = { enTete() { }, routes(r, c, d) { routes.routesCollection(r, c, d); } };
        const app = express(); app.set('trust proxy', true); transport.enTete(app, cfgX); app.use(express.json()); pret.armer(M.verifierIndex);
        app.use(assembler([lot], cfgX, {})); app.use(gestionnaireFinal);
        return H.serveur(app);
    }
    const sv = await serveur();
    const chemin = (slug, cle) => `/api/collection/sets/${encodeURIComponent(slug)}/fiches/${encodeURIComponent(cle)}`;
    const put = (c, slug, cle, corps, sx = sv) => H.appel(sx.url, chemin(slug, cle), { methode: 'PUT', corps, entetes: siteH(c && c.cookie) });
    const putEx = (c, slug, cle, corps, sx = sv, entetes) => H.appel(sx.url, chemin(slug, cle) + '/exemplaires', { methode: 'PUT', corps, entetes: entetes || siteH(c && c.cookie) });
    const putP = (c, id, corps) => H.appel(sv.url, `/api/collection/produits/${id}`, { methode: 'PUT', corps, entetes: siteH(c && c.cookie) });
    const lire = (c, slug) => H.appel(sv.url, `/api/collection/sets/${encodeURIComponent(slug)}`, { entetes: siteH(c && c.cookie) });
    const code = r => r.json && r.json.erreur && r.json.erreur.code;
    const detail = r => r.json && r.json.erreur && r.json.erreur.detail;
    const octets = async () => (await raw('compteurs').findOne({ cle: 'collection-octets' })).n;
    const docs = c => raw('collection_fiches').find({ compteId: c.c._id }).toArray();
    const el = (etat, langue) => ({ etat, langue });

    VB.installer([VB.doc(1), VB.doc(2), VB.doc(3)], [['Set-E', '10|001', [1]], ['Set-E', '11|002', [2]], ['Set-E', '12|003', [3]]]);

    // ═══════════════ 1. LES LISTES ET LA FORME DU CORPS ═══════════════
    H.v('1. les états : l\'échelle de Cardmarket, MT compris', F.ETATS, ['MT', 'NM', 'EX', 'GD', 'LP', 'PL', 'PO']);
    H.vrai('   les langues : celles du catalogue (identifier/produit.js) plus id et th, sans doublon', (() => { const P = require('../identifier/produit').LANGUES; return P.every(l => F.LANGUES.includes(l)) && F.LANGUES.includes('id') && F.LANGUES.includes('th') && new Set(F.LANGUES).size === F.LANGUES.length; })());
    H.v('   le corps du PUT par fiche est celui d\'AVANT : etat et langue n\'y sont plus admis (400 possedee)', [routes.lireCorps({ possedee: true, etat: 'NM' }, 99).detail, routes.lireCorps({ possedee: true }, 99)], ['possedee', { possedee: true, quantite: undefined }]);
    const le = b => routes.lireExemplaires(b, 99);
    H.v('   un corps K5 valide : { exemplaires } rendu, null admis', le({ exemplaires: [el('NM', 'fr'), el(null, null), el('MT', null), el(null, 'ja')] }), { exemplaires: [el('NM', 'fr'), el(null, null), el('MT', null), el(null, 'ja')] });
    H.v('   un tableau vide est valide (il efface le détail)', le({ exemplaires: [] }), { exemplaires: [] });
    for (const [b, d] of [[undefined, 'exemplaires'], [{}, 'exemplaires'], [{ exemplaires: 'NM' }, 'exemplaires'], [{ exemplaires: {} }, 'exemplaires'], [{ exemplaires: [], autre: 1 }, 'exemplaires'],
        [{ exemplaires: [1] }, 'exemplaires'], [{ exemplaires: [null] }, 'exemplaires'], [{ exemplaires: [[]] }, 'exemplaires'], [{ exemplaires: [{ etat: 'NM' }] }, 'exemplaires'], [{ exemplaires: [{ langue: 'fr' }] }, 'exemplaires'],
        [{ exemplaires: [{ etat: 'NM', langue: 'fr', quantite: 2 }] }, 'exemplaires'], [{ exemplaires: Array(100).fill(el(null, null)) }, 'exemplaires'],
        [{ exemplaires: [el('XX', null)] }, 'etat'], [{ exemplaires: [el('nm', null)] }, 'etat'], [{ exemplaires: [el('', null)] }, 'etat'], [{ exemplaires: [el(3, null)] }, 'etat'],
        [{ exemplaires: [el(null, 'xx')] }, 'langue'], [{ exemplaires: [el(null, 'FR')] }, 'langue'], [{ exemplaires: [el(null, '__proto__')] }, 'langue'], [{ exemplaires: [el(null, ['fr'])] }, 'langue']]) {
        H.v(`   ${JSON.stringify(b)} → refus, detail ${d}`, le(b).detail, d);
    }

    // ═══════════════ 2. RIEN N'A BOUGÉ SANS LE DÉTAIL (octet pour octet) ═══════════════
    const A = await compte();
    const base0 = await put(A, 'Set-E', '10|001', { possedee: true, quantite: 3 });
    H.v('2. le PUT par fiche sans détail : la réponse d\'avant, à l\'octet', base0.texte, JSON.stringify({ success: true, possedees: 1 }));
    const sansEx = await lire(A, 'Set-E');
    H.v('   un set sans détail : PAS de champ `exemplaires`, clés et ordre d\'avant', Object.keys(sansEx.json), ['success', 'set', 'possedees', 'quantites', 'majLe']);
    H.v('   ... et le texte est celui d\'avant, à l\'octet', sansEx.texte, JSON.stringify({ success: true, set: 'Set-E', possedees: ['10|001'], quantites: { '10|001': 3 }, majLe: sansEx.json.majLe }));
    H.vrai('   le document stocké ne porte pas de champ `ex`', !('ex' in (await docs(A))[0]));
    const liste0 = await H.appel(sv.url, '/api/collection', { entetes: siteH(A.cookie) });
    H.v('   GET /api/collection : `doublons` = 2 pour la fiche à 3 exemplaires (champ additif, calculé sans écriture)', liste0.json.sets.map(s => [s.slug, s.doublons]), [['Set-E', 2]]);

    // ═══════════════ 3. ÉCRIRE LE DÉTAIL (K5) ═══════════════
    {
        const o0 = await octets();
        const non = await putEx(A, 'Set-E', '11|002', { exemplaires: [el('NM', 'fr')] });
        H.v('3. une fiche NON cochée : un détail non vide = 409 CONFLIT detail « exemplaires », rien d\'écrit', [non.statut, code(non), detail(non), (await docs(A)).filter(d => d.set === 'Set-E').length, await octets()], [409, 'CONFLIT', 'exemplaires', 1, o0]);
        const vide = await putEx(A, 'Set-E', '11|002', { exemplaires: [] });
        H.v('   ... un tableau vide sur une fiche non cochée : 200, { success, exemplaires: [] }, rien d\'écrit', [vide.statut, vide.json, await octets()], [200, { success: true, exemplaires: [] }, o0]);
        const o1 = await octets();
        const w = await putEx(A, 'Set-E', '10|001', { exemplaires: [el('NM', 'fr'), el('EX', 'en'), el('NM', 'fr')] });
        H.v('   3 exemplaires détaillés sur une fiche à 3 : 200, { success, exemplaires } — exactement ces deux clés, triés (état, langue)', [w.statut, Object.keys(w.json), w.json.exemplaires], [200, ['success', 'exemplaires'], [el('EX', 'en'), el('NM', 'fr'), el('NM', 'fr')]]);
        const g = await lire(A, 'Set-E');
        H.v('   GET : `exemplaires` APRÈS quantites et avant cotes, UN élément par exemplaire { etat, langue }', [Object.keys(g.json), g.json.quantites, g.json.exemplaires], [['success', 'set', 'possedees', 'quantites', 'exemplaires', 'majLe'], { '10|001': 3 }, { '10|001': [el('EX', 'en'), el('NM', 'fr'), el('NM', 'fr')] }]);
        const o2 = await octets();
        H.vrai('   l\'octet : les deux entrées de détail (NM/fr ×2 et EX/en) ont été RÉSERVÉES', o2 > o1);
        const m1 = (await docs(A)).find(d => d.set === 'Set-E').majLe; await attendre(15);
        const w2 = await putEx(A, 'Set-E', '10|001', { exemplaires: [el('NM', 'fr'), el('NM', 'fr'), el('EX', 'en')] });
        H.v('   idempotent (même détail dans un autre ordre) : même réponse, majLe INCHANGÉ, octets inchangés', [w2.json, (await docs(A)).find(d => d.set === 'Set-E').majLe.getTime() === m1.getTime(), await octets()], [w.json, true, o2]);
        const r = await putEx(A, 'Set-E', '10|001', { exemplaires: [el(null, null), el('PL', null), el(null, 'ja')] });
        H.v('   REMPLACE tout : { null, null } n\'est pas STOCKÉ (c\'est le reste du total) mais la réponse et la lecture sont COMPLÉTÉES par des { null, null } jusqu\'à la quantité (3), après les précisés ; état seul et langue seule sont admis', [r.json.exemplaires, (await lire(A, 'Set-E')).json.exemplaires['10|001']], [[el(null, 'ja'), el('PL', null), el(null, null)], [el(null, 'ja'), el('PL', null), el(null, null)]]);
        H.v('   ... le stockage, lui, ne porte que les 2 exemplaires précisés (le complément est calculé)', (await docs(A)).find(d => d.set === 'Set-E').ex.length, 2);
        const trop = await putEx(A, 'Set-E', '10|001', { exemplaires: [el('NM', 'fr'), el('NM', 'fr'), el('NM', 'fr'), el('NM', 'fr')] });
        H.v('   plus d\'éléments que la quantité (4 > 3) : 409 « exemplaires », le détail d\'avant est INTACT', [trop.statut, detail(trop), (await lire(A, 'Set-E')).json.exemplaires['10|001']], [409, 'exemplaires', [el(null, 'ja'), el('PL', null), el(null, null)]]);
        const kk = await put(A, 'Set-E', '10|001', { possedee: true, quantite: 1 });
        H.v('   le PUT par fiche avec une quantité INFÉRIEURE au détail (1 < 2) : 409 « exemplaires », rien n\'a bougé', [kk.statut, code(kk), detail(kk), (await lire(A, 'Set-E')).json.quantites['10|001']], [409, 'CONFLIT', 'exemplaires', 3]);
        const k2 = await put(A, 'Set-E', '10|001', { possedee: true, quantite: 2 });
        H.v('   ... à la somme exacte (2) : passe ; la réponse porte alors la fiche à jour (quantite, exemplaires), champs additifs', [k2.statut, k2.json], [200, { success: true, possedees: 1, quantite: 2, exemplaires: [el(null, 'ja'), el('PL', null)] }]);
        const clr = await putEx(A, 'Set-E', '10|001', { exemplaires: [] });
        const dclr = (await docs(A)).find(d => d.set === 'Set-E');
        H.v('   un tableau vide EFFACE le détail : le champ `ex` disparaît, les octets reviennent à ceux d\'avant le détail', [clr.json, 'ex' in dclr, await octets()], [{ success: true, exemplaires: [] }, false, o1]);
        H.vrai('   ... et le GET n\'a plus de champ `exemplaires`', !('exemplaires' in (await lire(A, 'Set-E')).json));
    }

    // ═══════════════ 4. LA RÉPONSE DES ÉCRITURES K3 ET PRODUIT, LE DÉCOCHAGE, LES OCTETS ═══════════════
    {
        const B = await compte();
        const W = await compte();                                                         // le registre d'un set est PARTAGÉ et ne se rend jamais : on le remplit avant de prendre la valeur de départ
        for (const k of ['11|002', '12|003']) { await put(W, 'Set-E', k, { possedee: true }); await put(W, 'Set-E', k, { possedee: false }); }
        const base = await octets();
        await put(B, 'Set-E', '11|002', { possedee: true, quantite: 2 });
        await putEx(B, 'Set-E', '11|002', { exemplaires: [el('GD', 'es'), el('LP', 'it')] });
        await put(B, 'Set-E', '12|003', { possedee: true, quantite: 1 });
        await putEx(B, 'Set-E', '12|003', { exemplaires: [el('MT', 'de')] });
        const plein = await octets();
        H.vrai('4. trois entrées de détail sur deux fiches : le compteur a monté', plein > base);
        const pp = await putP(B, 2, { possedee: true });
        H.v('   le PUT par PRODUIT d\'une fiche qui a un détail : { possedees, set, cle } PLUS quantite et exemplaires', [pp.statut, pp.json], [200, { success: true, possedees: 2, set: 'Set-E', cle: '11|002', quantite: 2, exemplaires: [el('GD', 'es'), el('LP', 'it')] }]);
        const pq = await putP(B, 1, { possedee: true });
        H.v('   ... d\'une fiche SANS détail : la réponse d\'avant (set, cle, sans quantite ni exemplaires)', Object.keys(pq.json).sort(), ['cle', 'possedees', 'set', 'success']);
        await put(B, 'Set-E', '10|001', { possedee: false });
        const dec = await put(B, 'Set-E', '11|002', { possedee: false });
        const g = (await lire(B, 'Set-E')).json;
        H.v('   PUT { possedee:false } : la fiche et SON détail partent, l\'autre fiche garde le sien', [dec.statut, g.possedees, g.exemplaires], [200, ['12|003'], { '12|003': [el('MT', 'de')] }]);
        await put(B, 'Set-E', '12|003', { possedee: false });
        H.v('   tout décoché : plus aucun document, compteur d\'octets REVENU exactement à sa valeur d\'avant', [(await docs(B)).length, await octets()], [0, base]);
        const C = await compte(); const b0 = await octets();
        await put(C, 'Set-E', '10|001', { possedee: true, quantite: 3 });
        await putEx(C, 'Set-E', '10|001', { exemplaires: [el('NM', 'fr'), el('NM', 'en')] });
        await svc.supprimerDuCompte(C.c._id, cfg);
        H.v('   la suppression du compte rend le détail : compteur revenu à sa valeur d\'avant', [(await docs(C)).length, await octets()], [0, b0]);
        const VD = await compte();
        await put(VD, 'Set-Hors', '99|001', { possedee: true, quantite: 2 });
        const h = await putEx(VD, 'Set-Hors', '99|001', { exemplaires: [el('EX', 'en'), el(null, null)] });
        H.v('   une fiche HORS catalogue (clé dans `hors`) porte aussi son détail', [h.statut, h.json.exemplaires, (await lire(VD, 'Set-Hors')).json.exemplaires], [200, [el('EX', 'en'), el(null, null)], { '99|001': [el('EX', 'en'), el(null, null)] }]);
    }

    // ═══════════════ 5. BORNES ═══════════════
    {
        const svp = await serveur({ ...cfg, collection: { ...cfg.collection, exemplairesParCompte: 2 } });
        const E2 = await compte();
        for (const k of ['10|001', '11|002', '12|003']) await put(E2, 'Set-E', k, { possedee: true, quantite: 2 }, svp);
        const a = await putEx(E2, 'Set-E', '10|001', { exemplaires: [el('NM', 'fr'), el('EX', 'fr')] }, svp), c = await putEx(E2, 'Set-E', '11|002', { exemplaires: [el('GD', 'fr')] }, svp);
        H.v('5. exemplairesParCompte = 2 (entrées DISTINCTES de détail) : la troisième est refusée (409 « borne-exemplaires »), rien d\'écrit pour cette fiche', [a.statut, c.statut, detail(c), (await lire(E2, 'Set-E')).json.exemplaires['11|002']], [200, 409, 'borne-exemplaires', undefined]);
        const rep = await putEx(E2, 'Set-E', '10|001', { exemplaires: [el('NM', 'fr'), el('NM', 'fr')] }, svp);
        H.v('   ... remplacer le détail d\'une fiche par MOINS d\'entrées passe au plafond', rep.statut, 200);
        await svp.fermer();
    }

    // ═══════════════ 6. GARDES, ISOLEMENT ═══════════════
    {
        const P = await compte(), Q = await compte();
        await put(P, 'Set-E', '10|001', { possedee: true, quantite: 2 });
        await putEx(P, 'Set-E', '10|001', { exemplaires: [el('NM', 'fr')] });
        const gq = await lire(Q, 'Set-E');
        H.v('6. un AUTRE compte ne voit ni le détail ni le total de P', [gq.json.possedees, 'exemplaires' in gq.json, 'quantites' in gq.json], [[], false, false]);
        const qw = await putEx(Q, 'Set-E', '10|001', { exemplaires: [el('PO', 'fr')] });
        H.v('   ... Q écrit un détail sur la même clé non cochée chez lui : 409, et le détail de P est INTACT', [qw.statut, (await lire(P, 'Set-E')).json.exemplaires['10|001']], [409, [el('NM', 'fr'), el(null, null)]]);
        H.v('   sans session : 401 SESSION', (await putEx(null, 'Set-E', '10|001', { exemplaires: [] }, sv, { origin: SITE, 'x-rat-market': '1', 'x-forwarded-for': IP() })).statut, 401);
        const ori = await putEx(P, 'Set-E', '10|001', { exemplaires: [] }, sv, siteH(P.cookie, { origin: 'https://autre.exemple' }));
        H.v('   mauvaise Origin : 403 ORIGINE', [ori.statut, code(ori)], [403, 'ORIGINE']);
        const bad = await putEx(P, 'Set-E', 'abc', { exemplaires: [] });
        H.v('   clé mal formée : 400 ENTREE cle', [bad.statut, detail(bad)], [400, 'cle']);
        const bad2 = await putEx(P, 'Set-E', '10|001', { exemplaires: [el('XX', null)] });
        H.v('   état hors liste : 400 ENTREE etat, détail intact', [bad2.statut, detail(bad2), (await lire(P, 'Set-E')).json.exemplaires['10|001']], [400, 'etat', [el('NM', 'fr'), el(null, null)]]);
        for (const m of ['GET', 'POST', 'DELETE']) H.v(`   ${m} sur /exemplaires : pas de route (404)`, (await H.appel(sv.url, chemin('Set-E', '10|001') + '/exemplaires', { methode: m, entetes: siteH(P.cookie) })).statut, 404);
    }

    // ═══════════════ 7. r1, r2, r3 (relecture 1, tour 1) ═══════════════
    {
        const CT = require('../collection/couts');
        const dbReelle = mongoose.connection.db;
        const injecter = f => { const faux = Object.create(dbReelle); faux.collection = (n, o) => { const c = dbReelle.collection(n, o); return n === 'collection_fiches' ? f(c) : c; }; db.brancher(faux); };
        const lier = (t, k) => { const v = t[k]; return typeof v === 'function' ? v.bind(t) : v; };
        // r1 : trois essais perdus contre des écritures simultanées = 503 INDISPONIBLE « réessayer » (pas un 409 qui dit une fausse raison), rien d'écrit à moitié, octets intacts
        const R = await compte(); await put(R, 'Set-E', '10|001', { possedee: true, quantite: 2 });
        const o = await octets();
        injecter(c => new Proxy(c, { get(t, k) { if (k === 'findOneAndUpdate') return async (...a) => (Array.isArray(a[1]) && a[0] && a[0].$expr ? null : t.findOneAndUpdate(...a)); return lier(t, k); } }));
        let rr; try { rr = await putEx(R, 'Set-E', '10|001', { exemplaires: [el('NM', 'fr')] }); } finally { db.brancher(dbReelle); }
        H.v('7. r1 : l\'écriture du détail perd trois essais : 503 INDISPONIBLE, detail « reessayer », reessayerDans et Retry-After', [rr.statut, code(rr), detail(rr), rr.json.erreur.reessayerDans > 0 && Number(rr.entetes['retry-after']) === rr.json.erreur.reessayerDans], [503, 'INDISPONIBLE', 'reessayer', true]);
        H.v('   ... rien n\'est écrit à moitié : pas de détail, octets REVENUS', [(await docs(R))[0].ex, await octets()], [undefined, o]);
        const apresR1 = await putEx(R, 'Set-E', '10|001', { exemplaires: [el('NM', 'fr')] });
        H.v('   ... et le même appel, la base revenue, passe', apresR1.statut, 200);
        // r2 : un détail orphelin (fiche non cochée) s'efface avec un tableau vide, sans 503
        const O = await compte();
        await raw('collection_fiches').insertOne({ compteId: O.c._id, set: 'Set-E', mots: {}, hors: [], ex: [CT.elementEx('10|001', 'NM', 'fr', 1)], majLe: new Date() });
        const ro = await putEx(O, 'Set-E', '10|001', { exemplaires: [] });
        H.v('   r2 : un tableau vide sur une fiche non cochée qui porte un détail orphelin : 200, le détail est effacé (pas de 503)', [ro.statut, ro.json, 'ex' in ((await docs(O))[0] || {})], [200, { success: true, exemplaires: [] }, false]);
        // r3 : une erreur de lecture APRÈS une écriture réussie ne fait pas croire à un échec
        const T = await compte(); await put(T, 'Set-E', '10|001', { possedee: true, quantite: 2 });
        await putEx(T, 'Set-E', '10|001', { exemplaires: [el('NM', 'fr')] });
        injecter(c => new Proxy(c, { get(t, k) { if (k === 'findOne') return async (...a) => { if (a[1] && JSON.stringify(a[1].projection) === '{"ex":1}') throw new Error('lecture en panne'); return t.findOne(...a); }; return lier(t, k); } }));
        let r3; try { r3 = await put(T, 'Set-E', '10|001', { possedee: true, quantite: 3 }); } finally { db.brancher(dbReelle); }
        H.v('   r3 : la lecture du détail lève APRÈS une écriture réussie : 200 de succès minimal { success, possedees } (jamais un 503 qui ferait croire à un échec)', [r3.statut, r3.json], [200, { success: true, possedees: 1 }]);
        H.v('   ... et l\'écriture a bien eu lieu (quantité 3)', (await lire(T, 'Set-E')).json.quantites['10|001'], 3);
    }
    await sv.fermer();
    await mongoose.disconnect();
    await H.arreterBanc();
    H.bilan();
})().catch(async e => { console.error('❌ banc en échec :', e); try { await H.arreterBanc(); } catch (_) { } process.exit(1); });
