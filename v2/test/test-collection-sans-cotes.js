'use strict';
// DÉCISION DE L'UTILISATEUR (31/10, maintenue le 07/11) : AUCUNE valeur issue de Cardmarket dans les routes de la collection — ni `cotes` par fiche, ni valeur totale, même pour les cartes possédées — tant que l'accord de
// Cardmarket n'existe pas. Ce banc éprouve le réglage PAR DÉFAUT (drapeau V2_COLLECTION_COTES éteint) : le guide de prix est PLEIN de prix, et pourtant aucun corps de la collection n'en porte un (balayage de TOUTES les
// routes, succès et erreurs), `/api/collection/valeur` n'existe pas (404 natif, le même qu'un chemin inexistant), le guide n'est pas lu, et le drapeau est refusé hors banc. Base EN MÉMOIRE (INT2), aucun réseau.
const H = require('./_harnais');
const mongoose = require('mongoose');
const express = require('express');
const db = require('../db'); const M = require('../modeles');
const { lireConfig } = require('../config');
const cfg = lireConfig({ MONGODB_BASE: 'test_scratch' });
const SITE = cfg.origines.site;
const raw = n => mongoose.connection.db.collection(n);
let nCompte = 0, nIp = 0;
const IP = () => { nIp++; return `10.81.${Math.floor(nIp / 250)}.${nIp % 250 + 1}`; };

(async () => {
    await H.ouvrirBancV2();
    process.env.MONGODB_BASE = 'test_scratch';
    const { connecterMongo } = require('../../mongo-connexion');
    await connecterMongo({ script: 'test-collection-sans-cotes.js', ecrit: true });
    db.brancher(mongoose.connection.db);
    await M.creerIndex();
    H.fixerHorlogeMilieu();
    const pret = require('../pret'); const v2 = require('../index'); const { assembler } = v2; const transport = require('../transport/monter');
    const routes = require('../collection/routes'); const VB = require('./_visuels-banc');

    // ── 1. le drapeau : éteint par défaut, refusé hors banc
    H.v('1. le drapeau est ÉTEINT par défaut', cfg.collection.cotes, false);
    H.v('   allumé sur une base de banc : admis (les bancs des cotes en ont besoin)', lireConfig({ MONGODB_BASE: 'test_scratch', V2_COLLECTION_COTES: '1' }).collection.cotes, true);
    let refus = null; try { lireConfig({ MONGODB_BASE: 'rm_essai', V2_COLLECTION_COTES: '1' }); } catch (e) { refus = e.message; }
    H.vrai('   allumé hors d\'une base de banc : configuration INVALIDE (aucun accord de Cardmarket n\'existe)', Boolean(refus) && /V2_COLLECTION_COTES/.test(refus) && /Cardmarket/.test(refus));
    let refus2 = null; try { lireConfig({ V2_COLLECTION_COTES: '1' }); } catch (e) { refus2 = e.message; }
    H.vrai('   ... et sans base nommée non plus', Boolean(refus2));
    let refus3 = null; try { lireConfig({ MONGODB_BASE: 'test_scratch', V2_COLLECTION_COTES: 'oui' }); } catch (e) { refus3 = e.message; }
    H.vrai('   une valeur mal formée est refusée (0 ou 1 seulement)', Boolean(refus3));

    async function compte() {
        const adresse = `sc${++nCompte}.${Date.now().toString(36)}@exemple.fr`;
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
    const appel = (c, methode, chemin, corps, entetes) => H.appel(sv.url, chemin, { methode, corps, entetes: entetes || siteH(c && c.cookie) });

    VB.installer([VB.doc(1), VB.doc(2), VB.doc(3)], [['Set-S', '10|001', [1]], ['Set-S', '11|002', [2]], ['Set-T', '12|003', [3]], ['Set-T', '13|004', [3]]]);
    await raw('guide_prix').insertMany([{ idProduct: 1, trend: 4.5, guideDu: '2026-10-01' }, { idProduct: 2, trend: 2, guideDu: '2026-10-01' }, { idProduct: 3, trend: 7.25, guideDu: '2026-10-01' }]);   // des prix PRÉSENTS dans le guide

    // ── 2. le balayage : les corps de TOUTES les routes de la collection (succès et refus) ne portent aucun prix
    const A = await compte();
    const corps = [];
    const noter = (nom, r) => { corps.push({ nom, statut: r.statut, texte: r.texte, json: r.json }); return r; };
    noter('PUT fiche', await appel(A, 'PUT', '/api/collection/sets/Set-S/fiches/' + encodeURIComponent('10|001'), { possedee: true, quantite: 3 }));
    noter('PUT fiche (2)', await appel(A, 'PUT', '/api/collection/sets/Set-S/fiches/' + encodeURIComponent('11|002'), { possedee: true }));
    noter('PUT exemplaires', await appel(A, 'PUT', '/api/collection/sets/Set-S/fiches/' + encodeURIComponent('10|001') + '/exemplaires', { exemplaires: [{ etat: 'NM', langue: 'fr' }] }));
    noter('PUT exemplaires 409', await appel(A, 'PUT', '/api/collection/sets/Set-S/fiches/' + encodeURIComponent('11|002') + '/exemplaires', { exemplaires: [{ etat: 'NM', langue: 'fr' }, { etat: 'EX', langue: 'fr' }] }));
    noter('PUT produit', await appel(A, 'PUT', '/api/collection/produits/1', { possedee: true, quantite: 3 }));
    noter('PUT produit ambigu', await appel(A, 'PUT', '/api/collection/produits/3', { possedee: true }));
    noter('PUT produit introuvable', await appel(A, 'PUT', '/api/collection/produits/999', { possedee: true }));
    noter('PUT 400', await appel(A, 'PUT', '/api/collection/produits/abc', { possedee: true }));
    noter('GET liste', await appel(A, 'GET', '/api/collection'));
    const set = noter('GET set (possédé)', await appel(A, 'GET', '/api/collection/sets/Set-S'));
    noter('GET set (rien de possédé)', await appel(A, 'GET', '/api/collection/sets/Set-T'));
    noter('GET set (slug illisible)', await appel(A, 'GET', '/api/collection/sets/a%20b'));
    noter('GET sans session', await appel(null, 'GET', '/api/collection/sets/Set-S', undefined, { origin: SITE, 'x-forwarded-for': IP() }));
    noter('PUT sans session', await appel(null, 'PUT', '/api/collection/produits/1', { possedee: true }, { origin: SITE, 'x-rat-market': '1', 'x-forwarded-for': IP() }));
    const val = noter('GET /valeur', await appel(A, 'GET', '/api/collection/valeur'));
    const cles = (x, out = []) => { if (Array.isArray(x)) x.forEach(y => cles(y, out)); else if (x && typeof x === 'object') for (const [k, v] of Object.entries(x)) { out.push(k); cles(v, out); } return out; };
    const interdit = /cote|valeur|tendance|prix|price|devise|montant|sanscote/i;
    const fautifs = corps.filter(c => cles(c.json).some(k => interdit.test(k))).map(c => c.nom);
    H.v(`2. ${corps.length} corps de la collection balayés (succès et refus, guide plein de prix) : AUCUNE clé « cote », « valeur », « tendance », « prix », « devise » ni « montant »`, fautifs, []);
    const montants = corps.filter(c => /\b\d+[.,]\d{2}\b|€|\bEUR\b|"4\.5"|4\.5|7\.25|"2"\s*:\s*2/.test((c.texte || '').replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, '').replace(/"(possedees|quantite)":\d+/g, ''))).map(c => c.nom);
    H.v('   ... ni un montant (4,5 · 7,25 · EUR · €) dans aucun texte', montants, []);
    H.v('   GET d\'un set : les clés d\'avant, SANS `cotes`', Object.keys(set.json), ['success', 'set', 'possedees', 'quantites', 'exemplaires', 'majLe']);
    // ── 3. /valeur n'existe pas : 404 natif, indiscernable d'un chemin inexistant
    const inexistant = await appel(A, 'GET', '/api/collection/zzz-inexistant');
    H.v('3. GET /api/collection/valeur : 404 natif (la route n\'est pas montée)', val.statut, 404);
    H.v('   ... le MÊME corps qu\'un chemin inexistant (au chemin près)', val.texte.split('/api/collection/valeur').join('<chemin>'), inexistant.texte.split('/api/collection/zzz-inexistant').join('<chemin>'));
    const sansSession = await appel(null, 'GET', '/api/collection/valeur', undefined, { origin: SITE, 'x-forwarded-for': IP() });
    H.v('   ... sans session non plus : 404 (la route est absente, pas protégée)', sansSession.statut, 404);
    // ── 4. le guide n'est pas lu
    const lectures = [];
    const dbReelle = mongoose.connection.db, faux = Object.create(dbReelle);
    faux.collection = (n, o) => { if (n === 'guide_prix') lectures.push(n); return dbReelle.collection(n, o); };
    db.brancher(faux);
    try { await appel(A, 'GET', '/api/collection/sets/Set-S'); await appel(A, 'GET', '/api/collection'); } finally { db.brancher(dbReelle); }
    H.v('4. la collection ne lit JAMAIS le guide de prix (drapeau éteint)', lectures.length, 0);
    await sv.fermer();
    await mongoose.disconnect();
    await H.arreterBanc();
    H.bilan();
})().catch(async e => { console.error('❌ banc en échec :', e); try { await H.arreterBanc(); } catch (_) { } process.exit(1); });
