'use strict';
// L5 (B3a) — AJOUT À LA COLLECTION PAR PRODUIT : PUT /api/collection/produits/{idProduct}, et l'index inverse produit → fiche du catalogue chargé (v2/chargeur/version.js, `fichesDuProduit`).
// Le verdict du scanner porte un idProduct, pas la clé `idInterne|numero` de la collection : le serveur résout, il ne devine jamais. Un produit inconnu = 404 ; un produit qui désigne PLUSIEURS fiches = refus
// explicite (409 CONFLIT, detail « ambigu », les fiches candidates nommées) ; le catalogue non chargé = 503 `catalogue` ; idempotent ; mêmes gardes que le PUT par fiche.
// Et l'ISOLEMENT : les données d'un autre compte ne sont jamais lues, les COTES (prix) ne sortent que sur la session du propriétaire. Base EN MÉMOIRE (INT2), aucun réseau.
const H = require('./_harnais');
const mongoose = require('mongoose');
const express = require('express');
const db = require('../db'); const M = require('../modeles');
const { lireConfig } = require('../config');
const cfg = lireConfig({ MONGODB_BASE: 'test_scratch' });
const SITE = cfg.origines.site;
const raw = n => mongoose.connection.db.collection(n);
let nCompte = 0, nIp = 0;
const IP = () => { nIp++; return `10.77.${Math.floor(nIp / 250)}.${nIp % 250 + 1}`; };
const attendre = ms => new Promise(r => setTimeout(r, ms));

(async () => {
    await H.ouvrirBancV2();
    process.env.MONGODB_BASE = 'test_scratch';
    const { connecterMongo } = require('../../mongo-connexion');
    await connecterMongo({ script: 'test-collection-produits.js', ecrit: true });
    db.brancher(mongoose.connection.db);
    await M.creerIndex();
    H.fixerHorlogeMilieu();
    const pret = require('../pret'); const v2 = require('../index'); const { assembler } = v2; const transport = require('../transport/monter');
    const routes = require('../collection/routes'); const E = require('../chargeur/etat'); const VB = require('./_visuels-banc');

    async function compte(o = {}) {
        const adresse = `prod${++nCompte}.${Date.now().toString(36)}@exemple.fr`;
        const c = Object.assign(M.nouveauCompte({ email: adresse, emailCle: adresse, motDePasse: {} }), { verifie: true }, o);
        await raw('comptes').insertOne(c);
        const s = await require('../comptes/sessions').creerSession(c._id);
        return { c, adresse, token: s.token, cookie: `rm_session=${s.token}` };
    }
    const siteH = (cookie, plus = {}) => ({ origin: SITE, 'x-rat-market': '1', ...(cookie ? { cookie } : {}), 'x-forwarded-for': IP(), ...plus });
    const gestionnaireFinal = (err, req, res, next) => { if (res.headersSent) return next(err); return res.status(500).json({ success: false, error: 'Erreur serveur interne' }); };
    const lot = { enTete() { }, routes(r, c, d) { routes.routesCollection(r, c, d); } };
    const app = express(); app.set('trust proxy', true); transport.enTete(app, cfg); app.use(express.json()); pret.armer(M.verifierIndex);
    app.use(assembler([lot], cfg, {})); app.use(gestionnaireFinal);
    const sv = await H.serveur(app);

    const putP = (c, id, corps, entetes) => H.appel(sv.url, `/api/collection/produits/${id}`, { methode: 'PUT', corps, entetes: entetes || siteH(c && c.cookie) });
    const lireSet = (c, slug, entetes) => H.appel(sv.url, `/api/collection/sets/${encodeURIComponent(slug)}`, { entetes: entetes || siteH(c && c.cookie) });
    const code = r => r.json && r.json.erreur && r.json.erreur.code;
    const detail = r => r.json && r.json.erreur && r.json.erreur.detail;
    const nDocs = () => raw('collection_fiches').countDocuments({});

    // ── le catalogue : produits 1 (fiche A1), 2 et 3 (la MÊME fiche A2), 4 (fiche B1), 5 (DEUX fiches : A3 et B2), 6 (aucune fiche : produit connu, sans fiche), 999 inconnu
    const doc = VB.doc;
    const v = VB.installer([doc(1), doc(2), doc(3), doc(4), doc(5), doc(6)], [['Set-A', '100|001', [1]], ['Set-A', '101|002', [2, 3]], ['Set-B', '200|001', [4]], ['Set-A', '102|003', [5]], ['Set-B', '201|010', [5]]]);

    // ═══════════════ 1. L'INDEX INVERSE (chargeur/version.js) ═══════════════
    H.v('1. fichesDuProduit existe sur la version (construit au chargement)', typeof v.fichesDuProduit, 'function');
    H.v('   un produit à une fiche : cette fiche, avec son set', v.fichesDuProduit(1), [{ set: 'Set-A', cle: '100|001' }]);
    H.v('   deux produits de la MÊME fiche : la même fiche (pas une ambiguïté)', [v.fichesDuProduit(2), v.fichesDuProduit(3)], [[{ set: 'Set-A', cle: '101|002' }], [{ set: 'Set-A', cle: '101|002' }]]);
    H.v('   un produit de DEUX fiches : les deux, triées (set, clé)', v.fichesDuProduit(5), [{ set: 'Set-A', cle: '102|003' }, { set: 'Set-B', cle: '201|010' }]);
    H.v('   un produit sans fiche, un produit inconnu : []', [v.fichesDuProduit(6), v.fichesDuProduit(999)], [[], []]);
    H.v('   un identifiant qui n\'est pas un entier : null (« je ne sais pas », jamais « aucune fiche »)', [v.fichesDuProduit('1'), v.fichesDuProduit(1.5), v.fichesDuProduit(null)], [null, null, null]);
    H.vrai('   l\'index est cohérent avec fichesDuSet : chaque (set, clé, produit) de fichesDuSet est rendu par fichesDuProduit (et rien d\'autre)', (() => {
        const lus = new Set(); for (const s of ['Set-A', 'Set-B']) for (const f of v.fichesDuSet(s)) for (const p of f.produits) lus.add(`${p}|${s}|${f.cle}`);
        const rendus = new Set(); for (const p of [1, 2, 3, 4, 5, 6, 999]) for (const f of v.fichesDuProduit(p)) rendus.add(`${p}|${f.set}|${f.cle}`);
        return lus.size === rendus.size && [...lus].every(x => rendus.has(x));
    })());

    // ═══════════════ 2. LE CHEMIN NOMINAL ═══════════════
    const A = await compte();
    const p1 = await putP(A, 1, { possedee: true });
    H.v('2. PUT produit 1 : 200, la fiche résolue est nommée (set, cle), possedees du set', [p1.statut, p1.json], [200, { success: true, possedees: 1, set: 'Set-A', cle: '100|001' }]);
    H.v('   Cache-Control: no-store', p1.entetes['cache-control'], 'no-store');
    const g1 = await lireSet(A, 'Set-A');
    H.v('   la fiche est cochée dans le set (lecture par le PUT par fiche : même stockage)', g1.json.possedees, ['100|001']);
    const d1 = (await raw('collection_fiches').find({ compteId: A.c._id }).toArray())[0]; await attendre(15);
    const p1b = await putP(A, 1, { possedee: true });
    const d1b = (await raw('collection_fiches').find({ compteId: A.c._id }).toArray())[0];
    H.v('   idempotent : le même PUT rend la même réponse et ne change RIEN (majLe inchangé, aucun document de plus)', [p1b.json, d1b.majLe.getTime() === d1.majLe.getTime(), await nDocs()], [p1.json, true, 1]);
    const p2 = await putP(A, 3, { possedee: true });
    H.v('   deux produits d\'une même fiche : la fiche est la même (une seule coche)', [p2.statut, p2.json.cle, p2.json.possedees], [200, '101|002', 2]);
    const p2b = await putP(A, 2, { possedee: true });
    H.v('   ... l\'autre produit de cette fiche : idempotent (2)', [p2b.statut, p2b.json.possedees], [200, 2]);
    const pq = await putP(A, 4, { possedee: true, quantite: 3 });
    const gq = await lireSet(A, 'Set-B');
    H.v('   la quantité facultative passe : 200, `quantites` rendu par le GET du set', [pq.statut, gq.json.quantites], [200, { '200|001': 3 }]);
    const pf = await putP(A, 4, { possedee: false });
    H.v('   possedee:false par le produit : décoche (le set se vide)', [pf.statut, pf.json.possedees, (await lireSet(A, 'Set-B')).json.possedees], [200, 0, []]);
    const pf2 = await putP(A, 4, { possedee: false });
    H.v('   ... et décocher deux fois est idempotent', [pf2.statut, pf2.json.possedees], [200, 0]);

    // ═══════════════ 3. LES REFUS DE RÉSOLUTION ═══════════════
    {
        const n0 = await nDocs();
        const amb = await putP(A, 5, { possedee: true });
        H.v('3. produit à PLUSIEURS fiches : 409 CONFLIT, detail « ambigu », les fiches candidates nommées, RIEN d\'écrit (jamais de devinette)', [amb.statut, code(amb), detail(amb), amb.json.erreur.fiches, await nDocs() - n0], [409, 'CONFLIT', 'ambigu', [{ set: 'Set-A', cle: '102|003' }, { set: 'Set-B', cle: '201|010' }], 0]);
        const ambF = await putP(A, 5, { possedee: false });
        H.v('   ... même refus pour un retrait (on ne décoche pas une fiche au hasard)', [ambF.statut, detail(ambF)], [409, 'ambigu']);
        const inc = await putP(A, 999, { possedee: true }), sans = await putP(A, 6, { possedee: true });
        H.v('   produit inconnu du catalogue : 404 INTROUVABLE ; produit connu sans fiche : 404 aussi (rien à cocher)', [inc.statut, code(inc), sans.statut, code(sans), await nDocs() - n0], [404, 'INTROUVABLE', 404, 'INTROUVABLE', 0]);
        // aucun catalogue chargé, ou un catalogue qui ne sait pas résoudre : « je ne sais pas » n'est jamais « inconnu »
        VB.vider();
        const nonCharge = await putP(A, 1, { possedee: true });
        H.v('   catalogue NON chargé : 503 INDISPONIBLE, detail catalogue, reessayerDans et Retry-After, rien d\'écrit (pas un 404)', [nonCharge.statut, code(nonCharge), detail(nonCharge), nonCharge.json.erreur.reessayerDans > 0 && Number(nonCharge.entetes['retry-after']) === nonCharge.json.erreur.reessayerDans, await nDocs() - n0], [503, 'INDISPONIBLE', 'catalogue', true, 0]);
        E.installer(Object.freeze({ comptes: Object.freeze({}), fichesDuSet: () => [], produitsDeMetacarte: () => [], entree: () => null }));
        const ancien = await putP(A, 1, { possedee: true });
        H.v('   une version sans index inverse (archive d\'avant) : 503 catalogue aussi', [ancien.statut, detail(ancien)], [503, 'catalogue']);
        const casse = Object.freeze({ comptes: Object.freeze({}), fichesDuSet: () => [], fichesDuProduit() { throw new Error('panne'); }, produitsDeMetacarte: () => [], entree: () => null });
        E.installer(casse);
        const panne = await putP(A, 1, { possedee: true });
        H.v('   un index qui lève : 503 catalogue (jamais un 500, jamais un 404)', [panne.statut, detail(panne)], [503, 'catalogue']);
        VB.installer([doc(1), doc(2), doc(3), doc(4), doc(5), doc(6)], [['Set-A', '100|001', [1]], ['Set-A', '101|002', [2, 3]], ['Set-B', '200|001', [4]], ['Set-A', '102|003', [5]], ['Set-B', '201|010', [5]]]);
        H.v('   le catalogue revient : le même PUT passe', (await putP(A, 1, { possedee: true })).statut, 200);
    }

    // ═══════════════ 4. LES GARDES (les mêmes que le PUT par fiche, dans le même ordre) ═══════════════
    {
        const B = await compte();
        const sans = await putP(null, 1, { possedee: true }, { origin: SITE, 'x-rat-market': '1', 'x-forwarded-for': IP() });
        H.v('4. sans session : 401 SESSION', [sans.statut, code(sans)], [401, 'SESSION']);
        const ori = await putP(B, 1, { possedee: true }, siteH(B.cookie, { origin: 'https://autre.exemple' }));
        H.v('   mauvaise Origin : 403 ORIGINE', [ori.statut, code(ori)], [403, 'ORIGINE']);
        const NV = await compte({ verifie: false });
        const nv = await putP(NV, 1, { possedee: true });
        H.vrai('   compte non vérifié : refusé (401 SESSION ou 403 VERIFICATION), rien d\'écrit', (nv.statut === 401 || nv.statut === 403) && (await raw('collection_fiches').countDocuments({ compteId: NV.c._id })) === 0);
        for (const id of ['0', 'abc', '-1', '1.5', '01', '99999999999', '1e3', '%20']) {
            const r = await H.appel(sv.url, `/api/collection/produits/${id}`, { methode: 'PUT', corps: { possedee: true }, entetes: siteH(B.cookie) });
            H.v(`   idProduct « ${id} » : 400 ENTREE, detail idProduct`, [r.statut, code(r), detail(r)], [400, 'ENTREE', 'idProduct']);
        }
        for (const [corps, d] of [[undefined, 'possedee'], [{}, 'possedee'], [{ possedee: 'oui' }, 'possedee'], [{ possedee: true, autre: 1 }, 'possedee'], [{ possedee: true, quantite: 0 }, 'quantite'], [{ possedee: true, quantite: 100 }, 'quantite'], [{ possedee: false, quantite: 2 }, 'quantite']]) {
            const r = await putP(B, 1, corps);
            H.v(`   corps ${JSON.stringify(corps)} : 400 ENTREE, detail ${d}`, [r.statut, code(r), detail(r)], [400, 'ENTREE', d]);
        }
        // un refus de forme est un refus compté, jamais une écriture
        H.v('   aucun refus ci-dessus n\'a écrit quoi que ce soit pour ce compte', await raw('collection_fiches').countDocuments({ compteId: B.c._id }), 0);
        for (const m of ['GET', 'POST', 'DELETE']) {
            const r = await H.appel(sv.url, '/api/collection/produits/1', { methode: m, entetes: siteH(B.cookie), ...(m === 'POST' ? { corps: { possedee: true } } : {}) });
            H.v(`   ${m} sur la route produit : pas de route (404), le PUT est le seul verbe`, r.statut, 404);
        }
        const pre = await H.appel(sv.url, '/api/collection/produits/1', { methode: 'OPTIONS', entetes: { origin: SITE, 'access-control-request-method': 'PUT', 'access-control-request-headers': 'content-type,x-rat-market' } });
        H.v('   préflight CORS du PUT produit : accepté pour le site, Allow-Credentials', [pre.statut < 300, pre.entetes['access-control-allow-origin'], pre.entetes['access-control-allow-credentials']], [true, SITE, 'true']);
        H.vrai('   ... et jamais DELETE ni POST dans les méthodes admises', !/DELETE|POST/.test(pre.entetes['access-control-allow-methods'] || ''));
    }

    // ═══════════════ 5. ISOLEMENT ET COTES RÉSERVÉES AU PROPRIÉTAIRE ═══════════════
    {
        await raw('guide_prix').insertMany([{ idProduct: 1, trend: 4.5, guideDu: '2026-10-01' }, { idProduct: 2, trend: 2, guideDu: '2026-10-01' }, { idProduct: 3, trend: 2, guideDu: '2026-10-01' }]);
        const X = await compte(), Y = await compte();
        await putP(X, 1, { possedee: true });
        const docsX = JSON.stringify(await raw('collection_fiches').find({ compteId: X.c._id }).toArray());
        const gY = await lireSet(Y, 'Set-A');
        H.v('5. un autre compte (Y) lit le même set : AUCUNE coche de X, majLe null', [gY.statut, gY.json.possedees, gY.json.majLe], [200, [], null]);
        const lY = await H.appel(sv.url, '/api/collection', { entetes: siteH(Y.cookie) });
        H.v('   ... et la liste de ses sets est vide', lY.json.sets, []);
        const yP = await putP(Y, 1, { possedee: true });
        H.v('   Y coche le même produit : ses propres données seulement (possedees 1)', [yP.statut, yP.json.possedees], [200, 1]);
        const yD = await putP(Y, 1, { possedee: false });
        H.v('   Y décoche : les données de X sont INTACTES à l\'octet (document de X identique)', [yD.json.possedees, JSON.stringify(await raw('collection_fiches').find({ compteId: X.c._id }).toArray()) === docsX], [0, true]);
        H.v('   la réponse du PUT produit ne porte aucune cote ni aucun prix', Object.keys(yP.json).sort(), ['cle', 'possedees', 'set', 'success']);
        // les cotes : session obligatoire (cookie), jamais le jeton d'installation, jamais sans identité
        const gX = await lireSet(X, 'Set-A');
        H.v('   le propriétaire, sur sa session : les cotes du set sont rendues (prix du guide)', gX.json.cotes['100|001'], { tendance: 4.5, date: '2026-10-01' });
        const nue = await H.appel(sv.url, '/api/collection/sets/Set-A', { entetes: { origin: SITE, 'x-forwarded-for': IP() } });
        H.v('   sans session : 401 SESSION, et le corps ne contient AUCUN prix ni cote', [nue.statut, code(nue), /cotes|tendance|4\.5/.test(nue.texte)], [401, 'SESSION', false]);
        const bearer = await H.appel(sv.url, '/api/collection/sets/Set-A', { entetes: { origin: SITE, 'x-forwarded-for': IP(), authorization: 'Bearer jeton-inexistant' } });
        H.v('   avec un jeton d\'installation quelconque (pas un cookie de session) : 401 SESSION, aucun prix', [bearer.statut, code(bearer), /cotes|tendance/.test(bearer.texte)], [401, 'SESSION', false]);
        const listeNue = await H.appel(sv.url, '/api/collection', { entetes: { origin: SITE, 'x-forwarded-for': IP() } });
        H.v('   la liste des sets sans session : 401 aussi', [listeNue.statut, /cotes|tendance/.test(listeNue.texte)], [401, false]);
        const parProduit = await H.appel(sv.url, '/api/collection/produits/1', { methode: 'PUT', corps: { possedee: true }, entetes: { origin: SITE, 'x-rat-market': '1', 'x-forwarded-for': IP() } });
        H.v('   le PUT produit sans session : 401, aucun prix', [parProduit.statut, /cotes|tendance/.test(parProduit.texte)], [401, false]);
        // aucune route de lecture ne prend un identifiant de compte : on ne peut pas demander la collection d'un autre
        const autre = await H.appel(sv.url, `/api/collection/comptes/${X.c._id}`, { entetes: siteH(Y.cookie) });
        const autre2 = await H.appel(sv.url, `/api/collection/sets/Set-A?compte=${X.c._id}`, { entetes: siteH(Y.cookie) });
        H.v('   ni route par identifiant de compte (404), ni paramètre `compte` honoré (Y ne voit toujours rien de X)', [autre.statut, autre2.json.possedees], [404, []]);
    }
    await sv.fermer();
    await mongoose.disconnect();
    await H.arreterBanc();
    H.bilan();
})().catch(async e => { console.error('❌ banc en échec :', e); try { await H.arreterBanc(); } catch (_) { } process.exit(1); });
