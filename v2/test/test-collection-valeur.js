'use strict';
// L6 — `doublons` par set (GET /api/collection, calcul SANS écriture) et la VALEUR TOTALE (GET /api/collection/valeur) : servie au propriétaire connecté SEULEMENT (ordre explicite de l'utilisateur, 07/11).
// Sous session (cookie), `Cache-Control: no-store`, jamais dans une réponse sans session, d'un jeton d'installation ou pour un autre compte. Base EN MÉMOIRE (INT2).
const H = require('./_harnais');
const mongoose = require('mongoose');
const express = require('express');
const db = require('../db'); const M = require('../modeles');
const { lireConfig } = require('../config');
const cfg = lireConfig({ MONGODB_BASE: 'test_scratch', V2_COLLECTION_COTES: '1' });   // drapeau ALLUMÉ (banc seulement) : ce banc éprouve le code de la valeur totale ; éteint (le défaut), la route n'existe pas : test-collection-sans-cotes.js
const SITE = cfg.origines.site;
const raw = n => mongoose.connection.db.collection(n);
let nCompte = 0, nIp = 0;
const IP = () => { nIp++; return `10.80.${Math.floor(nIp / 250)}.${nIp % 250 + 1}`; };

(async () => {
    await H.ouvrirBancV2();
    process.env.MONGODB_BASE = 'test_scratch';
    const { connecterMongo } = require('../../mongo-connexion');
    await connecterMongo({ script: 'test-collection-valeur.js', ecrit: true });
    db.brancher(mongoose.connection.db);
    await M.creerIndex();
    H.fixerHorlogeMilieu();
    const pret = require('../pret'); const v2 = require('../index'); const { assembler } = v2; const transport = require('../transport/monter');
    const routes = require('../collection/routes'); const VB = require('./_visuels-banc');
    async function compte() {
        const adresse = `val${++nCompte}.${Date.now().toString(36)}@exemple.fr`;
        const c = Object.assign(M.nouveauCompte({ email: adresse, emailCle: adresse, motDePasse: {} }), { verifie: true });
        await raw('comptes').insertOne(c);
        const s = await require('../comptes/sessions').creerSession(c._id);
        return { c, cookie: `rm_session=${s.token}` };
    }
    const siteH = cookie => ({ origin: SITE, 'x-rat-market': '1', ...(cookie ? { cookie } : {}), 'x-forwarded-for': IP() });
    const lot = { enTete() { }, routes(r, c, d) { routes.routesCollection(r, c, d); } };
    const app = express(); app.set('trust proxy', true); transport.enTete(app, cfg); app.use(express.json()); pret.armer(M.verifierIndex);
    app.use(assembler([lot], cfg, {})); app.use((err, req, res, next) => res.status(500).json({ success: false }));
    const sv = await H.serveur(app);
    const put = (c, slug, cle, corps) => H.appel(sv.url, `/api/collection/sets/${slug}/fiches/${encodeURIComponent(cle)}`, { methode: 'PUT', corps, entetes: siteH(c.cookie) });
    const get = (c, chemin, entetes) => H.appel(sv.url, chemin, { entetes: entetes || siteH(c && c.cookie) });

    VB.installer([VB.doc(1), VB.doc(2), VB.doc(3)], [['Set-V', '10|001', [1]], ['Set-V', '11|002', [2]], ['Set-W', '12|003', [3]]]);
    await raw('guide_prix').insertMany([{ idProduct: 1, trend: 4.5, guideDu: '2026-10-01' }, { idProduct: 2, trend: 2, guideDu: '2026-10-01' }]);   // le produit 3 n'a pas de guide

    const A = await compte();
    await put(A, 'Set-V', '10|001', { possedee: true, quantite: 3 });      // +2 doubles, cote 4,5
    await put(A, 'Set-V', '11|002', { possedee: true });                   // 1 exemplaire, cote 2
    await put(A, 'Set-W', '12|003', { possedee: true, quantite: 2 });      // +1 double, aucune cote
    await put(A, 'Hors-Set', '99|001', { possedee: true, quantite: 4 });   // hors catalogue : +3 doubles, aucune cote

    // ═══════════════ 1. doublons ═══════════════
    const liste = await get(A, '/api/collection');
    H.v('1. GET /api/collection : `doublons` = Σ(quantité − 1) par set, et le champ est ABSENT d\'un set sans double', liste.json.sets.map(s => [s.slug, s.possedees, s.doublons]), [['Hors-Set', 1, 3], ['Set-V', 2, 2], ['Set-W', 1, 1]]);
    const B = await compte();
    await put(B, 'Set-V', '11|002', { possedee: true });
    const lb = await get(B, '/api/collection');
    H.v('   un set sans aucun double : la réponse d\'avant, à l\'octet', lb.texte.includes('doublons') ? 'doublons présent' : lb.json.sets.map(s => Object.keys(s)), [['slug', 'possedees', 'majLe']]);

    // ═══════════════ 2. la valeur totale ═══════════════
    const v = await get(A, '/api/collection/valeur');
    H.v('2. GET /api/collection/valeur (session du propriétaire) : 3 × 4,5 + 1 × 2 = 15,5 ; 6 exemplaires sans cote (2 + 4) ; complète', [v.statut, v.json], [200, { success: true, valeurTotale: 15.5, devise: 'EUR', nbExemplaires: 10, sansCote: 6, partielle: false }]);
    H.v('   Cache-Control: no-store', v.entetes['cache-control'], 'no-store');
    const vb = await get(B, '/api/collection/valeur');
    H.v('   un AUTRE compte reçoit SA valeur (2), jamais celle de A', [vb.statut, vb.json.valeurTotale, vb.json.nbExemplaires], [200, 2, 1]);
    const C = await compte();
    H.v('   un compte sans rien : 0, 0 exemplaire', (await get(C, '/api/collection/valeur')).json, { success: true, valeurTotale: 0, devise: 'EUR', nbExemplaires: 0, sansCote: 0, partielle: false });
    const sans = await get(null, '/api/collection/valeur', { origin: SITE, 'x-forwarded-for': IP() });
    H.v('   SANS session : 401 SESSION et le corps ne porte ni valeur ni prix', [sans.statut, sans.json.erreur.code, /valeurTotale|tendance|"EUR"/.test(sans.texte)], [401, 'SESSION', false]);
    const bearer = await get(null, '/api/collection/valeur', { origin: SITE, 'x-forwarded-for': IP(), authorization: 'Bearer jeton-inexistant' });
    H.v('   avec un jeton d\'installation (pas un cookie de session) : 401, aucune valeur', [bearer.statut, /valeurTotale/.test(bearer.texte)], [401, false]);
    for (const m of ['PUT', 'POST', 'DELETE']) H.v(`   ${m} /api/collection/valeur : pas de route (404)`, (await H.appel(sv.url, '/api/collection/valeur', { methode: m, corps: {}, entetes: siteH(A.cookie) })).statut, 404);
    H.v('   la liste des sets et le GET d\'un set ne portent PAS la valeur totale', [/valeurTotale/.test(liste.texte), /valeurTotale/.test((await get(A, '/api/collection/sets/Set-V')).texte)], [false, false]);

    // ═══════════════ 3. LE CACHE PAR COMPTE, invalidé à chaque écriture de la collection de CE compte (relecture 2 : amplification) ═══════════════
    {
        await raw('guide_prix').updateOne({ idProduct: 1 }, { $set: { trend: 10 } });
        const encore = await get(A, '/api/collection/valeur');
        H.v('3. le guide change, la valeur du compte est servie du CACHE (15,5 : la grappe n\'est pas relue)', encore.json.valeurTotale, 15.5);
        const autreCompte = await compte(); await put(autreCompte, 'Set-V', '11|002', { possedee: true });
        H.v('   l\'écriture d\'un AUTRE compte n\'invalide pas le cache de A', (await get(A, '/api/collection/valeur')).json.valeurTotale, 15.5);
        await put(A, 'Set-V', '10|001', { possedee: true, quantite: 3 });       // une écriture de A (même idempotente) invalide son cache
        H.v('   une écriture de A invalide SON cache : la valeur est recalculée sur le guide du jour (3 × 10 + 2 = 32)', (await get(A, '/api/collection/valeur')).json.valeurTotale, 32);
        const dernier = await get(A, '/api/collection/valeur');
        H.v('   le cache est par compte : B, qui a écrit, ne reçoit pas la valeur de A', (await get(B, '/api/collection/valeur')).json.valeurTotale === dernier.json.valeurTotale, false);
        await raw('guide_prix').updateOne({ idProduct: 1 }, { $set: { trend: 4.5 } });
    }

    // ═══════════════ 4. LE LIMITEUR DE LECTURE (30 par heure et par compte, constante écrite) ═══════════════
    {
        H.v('4. le plafond est une CONSTANTE écrite dans routes.js', routes.VALEUR_LECTURES_PAR_HEURE, 30);
        const L1 = await compte(); const statuts = [];
        for (let i = 0; i < routes.VALEUR_LECTURES_PAR_HEURE + 1; i++) statuts.push((await get(L1, '/api/collection/valeur')).statut);
        const dernier = await get(L1, '/api/collection/valeur');
        H.v('   30 lectures passent, la 31e est refusée 429 DEBIT avec reessayerDans et Retry-After', [statuts.slice(0, 30).every(s => s === 200), statuts[30], dernier.json.erreur.code, dernier.json.erreur.reessayerDans > 0 && Number(dernier.entetes['retry-after']) === dernier.json.erreur.reessayerDans, /valeurTotale/.test(dernier.texte)], [true, 429, 'DEBIT', true, false]);
        H.v('   le limiteur est PAR COMPTE : un autre compte lit encore', (await get(A, '/api/collection/valeur')).statut, 200);
        H.v('   le limiteur de lecture ne touche pas les écritures du compte', (await put(L1, 'Set-V', '11|002', { possedee: true })).statut, 200);
    }

    await sv.fermer();
    await mongoose.disconnect();
    await H.arreterBanc();
    H.bilan();
})().catch(async e => { console.error('❌ banc en échec :', e); try { await H.arreterBanc(); } catch (_) { } process.exit(1); });
