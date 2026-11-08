'use strict';
// L5/L6 — la COURSE RÉELLE (relecture 1, G1/M1/M2) : N écritures SIMULTANÉES d'un même compte sur la même fiche, par HTTP, sur une vraie base (mongod en mémoire du harnais).
// L'invariant « somme du détail ≤ total de la fiche » ne peut plus se casser ; un décochage simultané ne laisse aucun détail orphelin ; le compteur d'octets revient EXACTEMENT à sa valeur de départ.
// Le banc sait dire NON : une copie de service.js dont le filtre atomique (la somme du détail ≤ la quantité écrite) est retiré doit le faire échouer (section 5).
const H = require('./_harnais');
const fs = require('fs'), path = require('path'), Module = require('module');
const mongoose = require('mongoose');
const express = require('express');
const db = require('../db'); const M = require('../modeles');
const { lireConfig } = require('../config');
const cfg = lireConfig({ MONGODB_BASE: 'test_scratch' });
const SITE = cfg.origines.site;
const raw = n => mongoose.connection.db.collection(n);
let nCompte = 0, nIp = 0;
const IP = () => { nIp++; return `10.79.${Math.floor(nIp / 250)}.${nIp % 250 + 1}`; };
const ROUNDS = 25;

function charger(rel, remplacements) {
    const f = path.join(__dirname, '..', 'collection', rel); let src = fs.readFileSync(f, 'utf8');
    for (const [a, b] of remplacements) { if (!src.includes(a)) throw new Error(`mutant : fragment absent de ${rel} : ${a}`); src = src.split(a).join(b); }
    const m = new Module(f, module); m.filename = f; m.paths = Module._nodeModulePaths(path.dirname(f)); m._compile(src, f); return m.exports;
}

(async () => {
    await H.ouvrirBancV2();
    process.env.MONGODB_BASE = 'test_scratch';
    const { connecterMongo } = require('../../mongo-connexion');
    await connecterMongo({ script: 'test-collection-course.js', ecrit: true });
    db.brancher(mongoose.connection.db);
    await M.creerIndex();
    const pret = require('../pret'); const v2 = require('../index'); const { assembler } = v2; const transport = require('../transport/monter');
    const routes = require('../collection/routes'); const VB = require('./_visuels-banc'); const C = require('../collection/couts');
    const cfgL = { ...cfg, limites: { ...cfg.limites, collectionEcrituresParCompteHeure: 100000 } };

    async function compte() {
        const adresse = `crs${++nCompte}.${Date.now().toString(36)}@exemple.fr`;
        const c = Object.assign(M.nouveauCompte({ email: adresse, emailCle: adresse, motDePasse: {} }), { verifie: true });
        await raw('comptes').insertOne(c);
        const s = await require('../comptes/sessions').creerSession(c._id);
        return { c, cookie: `rm_session=${s.token}` };
    }
    const siteH = cookie => ({ origin: SITE, 'x-rat-market': '1', cookie, 'x-forwarded-for': IP() });
    const gestionnaireFinal = (err, req, res, next) => { if (res.headersSent) return next(err); return res.status(500).json({ success: false, error: 'Erreur serveur interne' }); };
    async function serveur(routesMod = routes) {
        const lot = { enTete() { }, routes(r, c, d) { routesMod.routesCollection(r, c, d); } };
        const app = express(); app.set('trust proxy', true); transport.enTete(app, cfgL); app.use(express.json()); pret.armer(M.verifierIndex);
        app.use(assembler([lot], cfgL, {})); app.use(gestionnaireFinal);
        return H.serveur(app);
    }
    const ch = (slug, cle) => `/api/collection/sets/${slug}/fiches/${encodeURIComponent(cle)}`;
    const K3 = (sv, c, cle, corps) => H.appel(sv.url, ch('Set-C', cle), { methode: 'PUT', corps, entetes: siteH(c.cookie) });
    const K5 = (sv, c, cle, liste) => H.appel(sv.url, ch('Set-C', cle) + '/exemplaires', { methode: 'PUT', corps: { exemplaires: liste }, entetes: siteH(c.cookie) });
    const PP = (sv, c, id, corps) => H.appel(sv.url, `/api/collection/produits/${id}`, { methode: 'PUT', corps, entetes: siteH(c.cookie) });
    const el = (etat, langue) => ({ etat, langue });
    const octets = async () => (await raw('compteurs').findOne({ cle: 'collection-octets' })).n;
    // l'état STOCKÉ d'une fiche : { total, somme, detail } lu directement dans la base
    async function etatStocke(c, cle) {
        const d = await raw('collection_fiches').findOne({ compteId: c.c._id, set: 'Set-C' }, { promoteLongs: false });
        const ex = (d && d.ex ? d.ex : []).map(C.lireElementEx).filter(x => x.cle === cle);
        const somme = ex.reduce((n, x) => n + x.q, 0);
        let total = 0;
        if (d) {
            const hors = (d.hors || []).map(C.lireElementHors).find(x => x.cle === cle);
            if (hors) total = hors.q;
            else {
                const reg = await raw('collection_registre').findOne({ _id: 'Set-C' }); const p = reg ? reg.cles.indexOf(cle) : -1;
                if (p >= 0 && d.mots && d.mots[Math.floor(p / 64)] !== undefined) { const w = BigInt.asUintN(64, d.mots[Math.floor(p / 64)].toBigInt()); if ((w >> BigInt(p % 64)) & 1n) total = d.qte && d.qte[p] >= 2 ? d.qte[p] : 1; }
            }
        }
        return { total, somme, ex: d && d.ex ? d.ex : [], doc: d };
    }

    VB.installer([VB.doc(1), VB.doc(2), VB.doc(3), VB.doc(4)], [['Set-C', '1|001', [1]], ['Set-C', '2|002', [2]], ['Set-C', '3|003', [3]], ['Set-C', '4|004', [4]]]);
    const sv = await serveur();
    const X = '1|001', Y = '2|002';
    await require('../collection/service').recompter(cfg);                   // le compteur d'octets existe avant la première course
    {   // le registre d'un set est PARTAGÉ et ne se rend jamais : on le remplit AVANT toute valeur de départ
        const W = await compte();
        for (const k of ['1|001', '2|002', '3|003', '4|004']) { await K3(sv, W, k, { possedee: true }); await K3(sv, W, k, { possedee: false }); }
    }

    // ═══════════════ 1. K3 ET K5 SIMULTANÉS SUR LA MÊME FICHE : jamais somme > total ═══════════════
    {
        const A = await compte(); const base = await octets();
        let violations = 0, serveur5xx = 0, ok409 = 0, essais = 0;
        for (let i = 0; i < ROUNDS; i++) {
            await K3(sv, A, X, { possedee: false });
            await K3(sv, A, X, { possedee: true, quantite: 4 });
            const rs = await Promise.all([
                K5(sv, A, X, [el('NM', 'fr'), el('NM', 'fr'), el('NM', 'fr'), el('NM', 'fr')]),
                K3(sv, A, X, { possedee: true, quantite: 2 }),
                K3(sv, A, X, { possedee: true, quantite: 1 }),
                K5(sv, A, X, [el('EX', 'en'), el('EX', 'en')]),
                K3(sv, A, X, { possedee: true, quantite: 3 }),
                K5(sv, A, X, [el('PL', null)])]);
            for (const r of rs) { essais++; if (r.statut >= 500) serveur5xx++; if (r.statut === 409) ok409++; }
            const e = await etatStocke(A, X);
            if (e.somme > e.total) { violations++; console.log(`   violation tour ${i} : total ${e.total}, somme du détail ${e.somme}, détail ${JSON.stringify(e.ex)}`); }
        }
        H.v(`1. ${ROUNDS} tours de 6 écritures simultanées (3 quantités, 3 détails) sur UNE fiche : somme du détail ≤ total à la fin de CHAQUE tour`, violations, 0);
        H.v('   ... et aucune réponse 5xx', serveur5xx, 0);
        console.log(`   ${essais} écritures jouées, ${ok409} refusées en 409 (la quantité ou le détail l'interdisait à cet instant)`);
        await K3(sv, A, X, { possedee: false });
        H.v('   tout décoché ensuite : le compteur d\'octets revient EXACTEMENT à sa valeur de départ (M1)', [await octets(), (await raw('collection_fiches').countDocuments({ compteId: A.c._id }))], [base, 0]);
    }

    // ═══════════════ 2. UN DÉCOCHAGE SIMULTANÉ NE LAISSE AUCUN DÉTAIL ORPHELIN (M2) ═══════════════
    {
        const B = await compte(); const base = await octets();
        let orphelins = 0, divergents = 0;
        for (let i = 0; i < ROUNDS; i++) {
            await K3(sv, B, X, { possedee: true, quantite: 3 });
            await Promise.all([K5(sv, B, X, [el('NM', 'fr'), el('NM', 'fr')]), K3(sv, B, X, { possedee: false }), K5(sv, B, X, [el('EX', 'de')])]);
            const e = await etatStocke(B, X);
            if (e.total === 0 && e.ex.length) { orphelins++; console.log(`   orphelin tour ${i} : ${JSON.stringify(e.ex)}`); }
            if (e.somme > e.total) divergents++;
            if (e.total > 0) await K3(sv, B, X, { possedee: false });
        }
        H.v(`2. ${ROUNDS} tours { détail, décochage, détail } simultanés : aucun détail ne survit à une fiche décochée`, [orphelins, divergents], [0, 0]);
        H.v('   le document est supprimé (rien d\'orphelin, VIDE tient compte de `ex`) et le compteur d\'octets revient à sa valeur de départ', [await raw('collection_fiches').countDocuments({ compteId: B.c._id }), await octets()], [0, base]);
    }

    // ═══════════════ 3. AJOUTS PAR PRODUIT + DÉTAILS SIMULTANÉS SUR PLUSIEURS FICHES ═══════════════
    {
        const D = await compte(); const base = await octets();
        for (let i = 0; i < 10; i++) {
            const rs = await Promise.all([PP(sv, D, 1, { possedee: true, quantite: 2 }), PP(sv, D, 2, { possedee: true, quantite: 2 }), PP(sv, D, 3, { possedee: true, quantite: 2 }), PP(sv, D, 4, { possedee: true, quantite: 2 }),
                K5(sv, D, X, [el('NM', 'fr')]), K5(sv, D, Y, [el('EX', 'fr'), el('GD', 'fr')]), K3(sv, D, X, { possedee: true, quantite: 1 }), K3(sv, D, Y, { possedee: true, quantite: 1 })]);
            H.vrai(`   tour ${i} : aucune 5xx`, rs.every(r => r.statut < 500));
            for (const k of [X, Y]) { const e = await etatStocke(D, k); if (e.somme > e.total) H.vrai(`   INVARIANT cassé tour ${i} ${k} : total ${e.total} somme ${e.somme}`, false); }
            const d = await raw('collection_fiches').findOne({ compteId: D.c._id, set: 'Set-C' });
            H.v(`   tour ${i} : un seul document pour le compte et le set (la création simultanée n'en fait pas deux)`, await raw('collection_fiches').countDocuments({ compteId: D.c._id, set: 'Set-C' }), 1);
            void d;
            for (const id of [1, 2, 3, 4]) await PP(sv, D, id, { possedee: false });
        }
        H.v('3. dix tours d\'ajouts par produit et de détails simultanés puis tout décoché : plus de document, compteur d\'octets revenu EXACTEMENT', [await raw('collection_fiches').countDocuments({ compteId: D.c._id }), await octets()], [0, base]);
    }

    // ═══════════════ 4. LES FICHES DE COMPTES DIFFÉRENTS NE SE TOUCHENT PAS ═══════════════
    {
        const E1 = await compte(), E2 = await compte();
        await Promise.all([K3(sv, E1, X, { possedee: true, quantite: 3 }), K3(sv, E2, X, { possedee: true, quantite: 3 })]);
        await Promise.all([K5(sv, E1, X, [el('NM', 'fr'), el('NM', 'fr')]), K5(sv, E2, X, [el('PO', 'ja')]), K3(sv, E1, X, { possedee: true, quantite: 3 })]);
        const a = await etatStocke(E1, X), b = await etatStocke(E2, X);
        H.v('4. deux comptes écrivent en même temps la même fiche : chacun garde son détail', [a.ex.map(C.lireElementEx).map(x => `${x.etat}/${x.langue}×${x.q}`), b.ex.map(C.lireElementEx).map(x => `${x.etat}/${x.langue}×${x.q}`)], [['NM/fr×2'], ['PO/ja×1']]);
        await K3(sv, E1, X, { possedee: false }); await K3(sv, E2, X, { possedee: false });
    }
    await sv.fermer();

    // ═══════════════ 5. L'ENTRELACEMENT FORCÉ (déterministe) : une écriture de QUANTITÉ lit, un détail s'écrit, puis la quantité écrit ═══════════════
    // La course des sections 1 à 3 est probabiliste ; celle-ci est FABRIQUÉE : un crochet suspend la mise à jour gardée de `cocher` (quantité 1 sur une fiche à 4) juste avant qu'elle n'écrive, le temps qu'un détail de
    // 4 exemplaires s'écrive. Le service réel doit tenir l'invariant ; la COPIE MUTÉE (en mémoire, jamais le fichier) dont le filtre atomique est retiré doit le casser — le banc sait dire NON.
    {
        const garde = '$expr: { $lte: [sommeExpr(cle), q] }';
        const src = fs.readFileSync(path.join(__dirname, '..', 'collection', 'service.js'), 'utf8');
        H.vrai('5. le fragment du filtre atomique existe dans service.js (un mutant qui ne mord sur rien ne prouve rien)', src.includes(garde));
        const reel = require('../collection/service');
        const mut = charger('service.js', [[garde, '$expr: { $lte: [1, 2] }']]);
        const dbReelle = mongoose.connection.db;
        const injecter = hook => {
            const faux = Object.create(dbReelle);
            faux.collection = (n, o) => {
                const c = dbReelle.collection(n, o);
                if (n !== 'collection_fiches') return c;
                return new Proxy(c, { get(t, k) {
                    if (k === 'findOneAndUpdate') return async (...a) => { if (hook.attente && a[0] && a[0].$expr) { const h = hook.attente; hook.attente = null; await h(); } return t.findOneAndUpdate(...a); };
                    const v = t[k]; return typeof v === 'function' ? v.bind(t) : v;
                } });
            };
            db.brancher(faux);
        };
        const entrelacer = async service => {
            const G = await compte(), arg = { compteId: G.c._id, slug: 'Set-C', cle: X, cfg: cfgL };
            await reel.cocher({ ...arg, possedee: true, quantite: 4 });
            const hook = { attente: async () => { await reel.remplacerExemplaires({ ...arg, elements: [el('NM', 'fr'), el('NM', 'fr'), el('NM', 'fr'), el('NM', 'fr')] }); } };
            injecter(hook);
            let r;
            try { r = await service.cocher({ ...arg, possedee: true, quantite: 1 }); } finally { db.brancher(dbReelle); }
            const e = await etatStocke(G, X);
            await reel.cocher({ ...arg, possedee: false });
            return { r, e };
        };
        const sain = await entrelacer(reel);
        H.v('   le service RÉEL : la quantité qui perd la course est REFUSÉE (« exemplaires »), le total reste 4, le détail 4', [sain.r.refus, sain.e.total, sain.e.somme], ['exemplaires', 4, 4]);
        const casse = await entrelacer(mut);
        H.vrai(`   ↳ SANS le filtre atomique (total ${casse.e.total}, somme du détail ${casse.e.somme}) : l'invariant est CASSÉ — le banc sait dire NON`, casse.e.somme > casse.e.total);
        // et le sens inverse : un détail qui perd la course contre une baisse de quantité est refusé par sa propre condition (la fiche n'a plus assez d'exemplaires)
        const G2 = await compte(), arg2 = { compteId: G2.c._id, slug: 'Set-C', cle: Y, cfg: cfgL };
        await reel.cocher({ ...arg2, possedee: true, quantite: 4 });
        const hook2 = { attente: async () => { await reel.cocher({ ...arg2, possedee: true, quantite: 1 }); } };
        injecter(hook2);
        let r2; try { r2 = await reel.remplacerExemplaires({ ...arg2, elements: [el('NM', 'fr'), el('NM', 'fr'), el('NM', 'fr')] }); } finally { db.brancher(dbReelle); }
        const e2 = await etatStocke(G2, Y);
        H.v('   un détail de 3 écrit PENDANT que la quantité passe à 1 : refusé (la condition atomique du détail), total 1, aucun détail', [r2.refus, e2.total, e2.somme], ['exemplaires', 1, 0]);
        await reel.cocher({ ...arg2, possedee: false });
    }
    await mongoose.disconnect();
    await H.arreterBanc();
    H.bilan();
})().catch(async e => { console.error('❌ banc en échec :', e); try { await H.arreterBanc(); } catch (_) { } process.exit(1); });
