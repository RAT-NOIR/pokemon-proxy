'use strict';
// PRO-PRIX-RESERVE sur POST /api/identifier/mesures (le second envoi des mesures du client : la PROMOTION d'un candidat de la question en carte identifiée). Le banc principal (test-offre-prix-reserve-pro.js) ne monte pas cette route
// (V2_MESURES_CLIENT et V2_EMPREINTE_EXTENSION l'exigent) : ce banc la monte, sur le harnais de test-calcul-client-route.js (chaîne héritée fabriquée, index fabriqué _empreinte-aide.js, zones fausses, aucun réseau).
// Drapeau V2_PRO_PRIX_RESERVE allumé, un porteur gratuit et un Pro : (a) la carte promue COMPLÈTE porte un prix par état (garde de scénario) ; (b) Pro reçoit la carte complète ; (c) le gratuit reçoit l'ORACLE du gratuit (écrit dans
// _prix-reserve-aide.js) ; (d) `etat` identique à l'octet ; (e) Pro à drapeau éteint = Pro à drapeau allumé ; (f) rejeu après expiration : rien ne fuit.
// Fixtures : le GUIDE des produits est le guide RÉEL de Tauros (fixtures/prix-repli-reels.json, voir _prix-reserve-aide.js) ; les produits P et A, leurs noms, leur numéro et leur index d'empreintes sont ceux, existants, de
// _empreinte-aide.js / test-calcul-client-route.js (aucun prix n'y est inventé : leur ancien guide 1,0 est remplacé).
const H = require('./_harnais');
const path = require('path');
const mongoose = require('mongoose');
const express = require('express');
const db = require('../db'); const M = require('../modeles'); const QA = require('./_aide-quota'); const VB = require('./_visuels-banc');
const registre = require('../registre');
const { lireConfig } = require('../config');
const A = require('./_empreinte-aide'); const X = require('./_prix-reserve-aide');
const R = path.join(__dirname, '..', '..');
const IMAGE = require(path.join(R, 'verrou', 'charges.json')).charges.find(c => c.cellule === 'occidentale').imageUrl;
const cfgOff = lireConfig({ ...A.ENV_EMPREINTE, V2_MESURES_CLIENT: '1', V2_ORB_SERVEUR: '0' });
const cfgOn = lireConfig({ ...A.ENV_EMPREINTE, V2_MESURES_CLIENT: '1', V2_ORB_SERVEUR: '0', V2_PRO_PRIX_RESERVE: '1' });
const ORIGINE = cfgOn.origines.extension;
let nIp = 0; const ip = () => { nIp++; return { 'x-forwarded-for': `10.32.${Math.floor(nIp / 250)}.${nIp % 250 + 1}` }; };
let nCle = 0; const cle = () => `banc-prm-${Date.now().toString(36)}-${++nCle}`;
const raw = n => mongoose.connection.db.collection(n);
const attendre = ms => new Promise(r => setTimeout(r, ms));
const j = x => JSON.stringify(x);
const corps = (o = {}) => ({ contrat: 2, imageUrls: [IMAGE], title: null, description: null, prixVinted: null, devise: null, marche: 'vinted.fr', versionExtension: '2.0.0', langueInterface: 'fr', ...o });
const zonesHautes = ref => ({ type: 'zones', ref, haut: 0.9, illustration: 0.9, bandeau: 0.9, texte: 0.9, bas: 0.9, inliers: 120 });
const resultatsPour = (mesures, gagne) => mesures.map(m => (m.type === 'paire' ? { type: 'paire', a: m.a, b: m.b, ecart: m.a === gagne ? 0.4 : -0.4, couverture: 0.2 } : zonesHautes(m.ref)));
const VIS = [];
const semer = async id => {
    await raw('catalogue_produits').insertOne({ idProduct: id, name: 'Tropius (PBL 001)', idExpansion: 990001, idMetacard: 990100 + (id % 100) });
    await raw('numeros_cartes').insertOne({ idProduct: id, idExpansion: 990001, numero: '001', numeroUrl: 'PBL001', codeSet: 'PBL', nomFr: 'Tropius', slug: `Tropius-PBL001-${id}`, slugSet: 'Banc-Set', source: 'cardmarket', certitude: 'exacte' });
    const g = X.REEL.tauros.guide;
    await raw('guide_prix').insertOne({ idProduct: id, trend: g.trend, low: g.low, avg: g.avg30, avg1: g.trend, avg7: g.avg7, avg30: g.avg30, guideDu: new Date(g.guideDu) });      // le guide RÉEL de Tauros (avg et avg1 : les champs que la fiche ne lit pas, repris de avg30 et trend)
    VIS.push(VB.doc(id, { numero: '001', idMetacard: 990100 + (id % 100) }));
};

(async () => {
    await H.ouvrirBancV2();
    await QA.eviterMinuit();
    process.env.MONGODB_BASE = 'test_scratch';
    const { connecterMongo } = require('../../mongo-connexion');
    await connecterMongo({ script: 'test-offre-prix-reserve-pro-mesures.js', ecrit: true });
    db.brancher(mongoose.connection.db);
    await M.creerIndex();
    for (const c of ['catalogue_produits', 'numeros_cartes', 'guide_prix', 'codes_set']) await raw(c).deleteMany({});
    await raw('codes_set').insertOne({ idExpansion: 990001, codeSet: 'PBL', apprisLe: new Date() });
    for (const id of [A.ID_A, A.ID_B, A.ID_P]) await semer(id);
    VB.installer(VIS, [], { emprunts: true });

    const pret = require('../pret'); const { assembler } = require('../index');
    const lecture = id => ({ success: true, question: null, carte: { idProduct: id, nomProduit: 'Tropius', nom: 'Tropius', numero: '001', total: '064', setCode: 'PBL', rarete: null, langue: 'FR', ambigu: false },
        etat: { estimeIA: null, confianceIA: null, defautsVus: [], declareVendeur: null, declareCardmarket: null, retenu: null },
        candidats: [{ idProduct: id, nom: 'Tropius', numero: '001', set: 'Banc Set', prix: null, photoUrl: null }], classement: [], guidePrix: {}, reverse: { attendue: false, motif: null, etat: 'aucun-motif', strategie: null }, codeLangue: 2 });
    const IDS = [A.ID_P, A.ID_A];
    const chaine = async (req, res) => {
        await req.credit.v2.poserQuestion(req, { scanId: req.scanIdImpose, raison: 'egalite-sans-enjeu', candidats: IDS });
        const l = lecture(IDS[0]);
        return res.json({ ...l, scanId: String(req.scanIdImpose), question: { etat: 'en-attente', delaiHeures: 24 }, carte: { ...l.carte, ambigu: true }, candidats: IDS.map(id => ({ idProduct: id, nom: 'Tropius', numero: '001', set: 'Banc Set', prix: null, photoUrl: null })) });
    };
    const monter = async cfg => {
        const app = express(); app.set('trust proxy', true); app.use(express.json({ limit: '2400kb' }));
        pret.armer(M.verifierIndex);
        app.use(assembler([require('../argent/monter'), require('../identifier/monter')], cfg, { jumeaux: () => ({ conclu: true, ids: [] }), gererIdentifier: chaine, zonesEmpreinte: A.fausseZones(), scanEmpreinte: A.scanBanc }));
        return H.serveur(app);
    };
    const crochet = require('../banc/crochet'); crochet.apresReponse = () => { };
    await A.preparer(); A.installerIndex();
    const svOff = await monter(cfgOff), svOn = await monter(cfgOn);
    X.armerOffres(registre.obtenir('argent'));
    const AVEC = { capacitesClient: ['mesures-1'] };
    const requete = () => ({ empreintes: [A.entree(0, 12, true)], modeleEmpreinte: A.modeleAnnonce(), ...AVEC });
    const entetes = (x, k) => ({ origin: ORIGINE, ...ip(), authorization: `Bearer ${x.jeton}`, 'idempotency-key': k || cle() });
    // un scan complet : la question P/A, le complément, le second envoi honnête (P promu)
    async function promouvoir(sv, genre, kMesures) {
        const x = await X.porteurDe(raw, genre);
        const r = await H.appel(sv.url, '/api/identifier', { methode: 'POST', corps: corps(requete()), entetes: entetes(x) }); await attendre(50);
        const c = r.json && r.json.complement;
        if (!c) throw new Error(`pas de complément (${r.statut})`);
        const envoi = { scanId: r.json.scanId, jeton: c.jeton, opencv: '5.0.0-banc', resultats: resultatsPour(c.mesures, 'banc/jeu-12.webp') };
        const m = await H.appel(sv.url, '/api/identifier/mesures', { methode: 'POST', corps: envoi, entetes: entetes(x, kMesures) });
        return { x, envoi, m, carte: m.json && m.json.carte };
    }

    const off = await promouvoir(svOff, 'pro'), offGratuit = await promouvoir(svOff, 'gratuit');
    const pro = await promouvoir(svOn, 'pro'), gratuit = await promouvoir(svOn, 'gratuit'), expire = await promouvoir(svOn, 'expire'), sans = await promouvoir(svOn, 'sans'), inconnue = await promouvoir(svOn, 'inconnue');
    H.v('M0. les promotions sont 200, change: true, carte identifiée P (toutes offres, drapeau éteint et allumé)', [off, offGratuit, pro, gratuit, expire, sans, inconnue].map(o => [o.m.statut, o.m.json && o.m.json.change, o.carte && o.carte.statut, o.carte && o.carte.carte && o.carte.carte.idProduct]), [off, offGratuit, pro, gratuit, expire, sans, inconnue].map(() => [200, true, 'identifiee', A.ID_P]));
    H.vrai('M1. (garde de scénario) la carte promue COMPLÈTE (Pro, drapeau éteint) porte un prixLive objet ET un prixRepli à fourchette (état nul, langue lue, guide réel)', Boolean(off.carte && off.carte.prixLive && typeof off.carte.prixLive === 'object' && off.carte.prixRepli && 'fourchette' in off.carte.prixRepli));
    H.v('M2. drapeau éteint : le gratuit et Pro reçoivent la MÊME carte (la réponse d\'avant)', j(offGratuit.carte), j(off.carte));
    H.v('M3. (3) Pro, allumé : la carte complète, à l\'octet', j(pro.carte), j(off.carte));
    H.v('M4. (2)(4) gratuit, sans compte, expiré, offre inconnue, allumé : l\'oracle du gratuit (prixLive null, fourchette dégradée en repli général)', [gratuit, sans, expire, inconnue].map(o => j(o.carte) === j(X.gratuitDe(off.carte))), [true, true, true, true]);
    H.v('M5. (2) aucune de ces cartes ne porte de prix par état ou par langue', [gratuit, sans, expire, inconnue].map(o => X.aDuPrixParEtat(o.carte)), [false, false, false, false]);
    H.vrai('M6. (1) `etat` identique à l\'octet pour toutes les offres, drapeau allumé comme éteint', [off, offGratuit, pro, gratuit, expire, sans, inconnue].every(o => j(o.carte.etat) === j(off.carte.etat)) && j(off.carte.etat).includes('"retenu"'));
    // (f) le REJEU du second envoi (même clé d'idempotence, même corps) suit l'offre ACTUELLE
    {
        const K = cle();
        const p = await promouvoir(svOn, 'pro', K);
        const rejeuPro = await H.appel(svOn.url, '/api/identifier/mesures', { methode: 'POST', corps: p.envoi, entetes: entetes(p.x, K) });
        H.v('M7a. rejeu sous Pro (rien n\'a changé) : Idempotency-Replayed, la même réponse à l\'octet', [rejeuPro.entetes['idempotency-replayed'], rejeuPro.texte === p.m.texte], ['true', true]);
        await raw('comptes').updateOne({ _id: p.x.compte._id }, { $set: { 'abonnement.jusquAu': X.passe } });
        const rejeuExp = await H.appel(svOn.url, '/api/identifier/mesures', { methode: 'POST', corps: p.envoi, entetes: entetes(p.x, K) });
        H.v('M7b. rejeu APRÈS expiration : rien ne fuit (l\'oracle du gratuit), `etat` identique à l\'octet', [rejeuExp.entetes['idempotency-replayed'], j(rejeuExp.json.carte) === j(X.gratuitDe(p.carte)), X.aDuPrixParEtat(rejeuExp.json.carte), j(rejeuExp.json.carte.etat) === j(p.carte.etat)], ['true', true, false, true]);
        // l'inverse : première réponse d'un gratuit, rejeu après passage à Pro : le prix n'est pas retiré à tort
        const K2 = cle(), g = await promouvoir(svOn, 'gratuit', K2);
        await raw('comptes').updateOne({ _id: g.x.compte._id }, { $set: { abonnement: X.abo(X.futur) } });
        const rejeuPasse = await H.appel(svOn.url, '/api/identifier/mesures', { methode: 'POST', corps: g.envoi, entetes: entetes(g.x, K2) });
        H.v('M7c. rejeu APRÈS passage à Pro : la réponse conservée est complète : le prix par état est servi, égal à la carte complète', [rejeuPasse.entetes['idempotency-replayed'], j(rejeuPasse.json.carte) === j(off.carte)], ['true', true]);
    }

    await svOff.fermer(); await svOn.fermer();
    await mongoose.disconnect(); await H.arreterBanc();
    H.bilan();
})().catch(async e => { console.error('❌', e); try { await H.arreterBanc(); } catch (_) { } process.exit(1); });
