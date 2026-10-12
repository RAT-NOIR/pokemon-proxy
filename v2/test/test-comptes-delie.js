'use strict';
// O3 tour 2 (I-C) — décision du testeur : « DÉLIER au lieu de révoquer est ACCEPTÉ » à trois conditions prouvées par des tests :
//   1. après la réinitialisation, toutes les sessions et tous les jetons liés au compte sont invalides ;
//   2. une installation déliée n'a plus AUCUN accès au compte : ni solde, ni crédits, ni mouvements, ni Ma collection, ni courriel, ni rattachement possible sans une nouvelle connexion ;
//   3. elle retombe exactement sur les droits d'une installation anonyme, sans rien hériter du compte.
// Ce banc rejoue TOUTES les surfaces avec le jeton de l'installation déliée, sur le VRAI module d'argent (aucun faux : la fusion réelle a eu lieu à la liaison). Issu de la sonde du relecteur
// (test-rel-delie.js, r1), attentes recalculées APRÈS la correction de la couture liaison/fusion : la liaison réelle a fusionné, l'installation est à 0 essai / 0 acheté.
const express = require('express');
const H = require('./_harnais'); const A = require('./_b2-aide'); const { col } = require('../db'); const M = require('../modeles'); const J = require('../comptes/jetons'); const P = require('../comptes/mots-de-passe');
const pret = require('../pret'); const { lireConfig } = require('../config'); const { creerCourrierMemoire } = require('../comptes/courrier'); const { resoudrePorteur } = require('../porteur');
(async () => {
    await H.ouvrirBac('test-comptes-delie.js'); await M.creerIndex();
    const cfg = lireConfig({ MONGODB_BASE: 'test_scratch' });
    const courrier = creerCourrierMemoire(); A.registre.fournir('courrier', courrier); A.registre.fournir('turnstile', { verifier: async () => true });
    const cors = require('../transport/cors'); const { dansUnScan } = require('../../sources'); const { assembler } = require('../index');
    let appelsChaine = 0; const chaine = async () => { appelsChaine++; throw new Error('chaîne atteinte'); };
    const app = express(); app.set('trust proxy', true); app.use(cors.middlewareV2(cfg)); app.use(express.json()); app.use((q, s, n) => dansUnScan(n));
    pret.armer(M.verifierIndex);
    app.use(assembler([require('../argent/monter'), require('../installations/monter'), require('../comptes/monter'), require('../identifier/monter'), require('../scanner/monter'), require('../collection/monter')], cfg, { gererIdentifier: chaine }));
    const srv = await H.serveur(app); let n = 0; const ip = () => ({ 'x-forwarded-for': `10.7.${Math.floor(++n / 250)}.${n % 250 + 1}` });
    const SITE = { origin: cfg.origines.site, 'x-rat-market': '1' }, EXT = { origin: cfg.origines.extension };
    const post = (ch, corps, entetes = {}) => H.appel(srv.url, ch, { methode: 'POST', corps, entetes: { ...SITE, ...ip(), ...entetes } });
    const resoudre = async entetes => { const q = { headers: entetes, ip: '1.1.1.1', get(k) { return this.headers[k.toLowerCase()]; } }; await resoudrePorteur(cfg)(q, { status() { return this; }, json() { return this; }, setHeader() { } }, () => { }); return q.v2; };
    const MDP = 'mot-de-passe-du-tiers', MDP2 = 'mot-de-passe-de-la-victime';
    const SID = '6acbcf5bf4099eb7eb620869';
    const mois = new Date().toISOString().slice(0, 7);
    const c = Object.assign(M.nouveauCompte({ email: 'cible@exemple.fr', emailCle: 'cible@exemple.fr', motDePasse: await P.hacher(MDP) }), { verifie: true, offertesAccordeesLe: new Date(), solde: { accueil: 25, achete: 5 }, abonnement: { actif: true, quotaMensuel: 100, moisCle: mois, restant: 40, jusquAu: new Date(Date.now() + 40 * 864e5) } });
    await col('comptes').insertOne(c);
    const conn = await post('/api/compte/connexion', { email: 'cible@exemple.fr', motDePasse: MDP }); const cookie = String(conn.entetes['set-cookie']).split(';')[0];
    // préparation : depuis COLLECTION-COMPACTE, une clé hors registre sans catalogue chargé rend 503 INDISPONIBLE (voulu). Le banc charge donc un catalogue qui connaît la clé posée, et VÉRIFIE le statut.
    const VB = require('./_visuels-banc'); VB.installer([VB.doc(1)], [['Set-A', '1|001', [1]]]);
    const prep = await H.appel(srv.url, '/api/collection/sets/Set-A/fiches/' + encodeURIComponent('1|001'), { methode: 'PUT', corps: { possedee: true }, entetes: { ...SITE, ...ip(), cookie } });
    H.v('A00. préparation : la fiche de départ est écrite (200)', prep.statut, 200); if (prep.statut !== 200) throw new Error('préparation échouée (' + prep.statut + ') : le banc s\'arrête ici');
    await col('mouvements').insertOne({ compteId: c._id, le: new Date(), type: 'octroi', delta: 25, poche: 'accueil', motif: 'octroi-accueil', etat: 'debite', cleIdempotence: `octroi-accueil|${c._id}` });
    // l'installation du tiers : 3 essais (naissance) et 2 « achetés » avant la liaison ; la VRAIE fusion les passe au compte
    const cr = await post('/api/installation', { libelle: 'tiers' }, EXT);
    const tokAnon = cr.json.jetonInstallation; await col('installations').updateOne({ _id: cr.json.installationId }, { $set: { achete: 2 } });
    const code = await H.appel(srv.url, '/api/compte/code', { methode: 'POST', corps: {}, entetes: { ...SITE, ...ip(), cookie } });
    const code2 = await H.appel(srv.url, '/api/compte/code', { methode: 'POST', corps: {}, entetes: { ...SITE, ...ip(), cookie } });
    const lier = await post('/api/compte/lier', { code: code.json.code }, { authorization: `Bearer ${tokAnon}`, ...EXT });
    const tok = lier.json.jetonInstallation;
    const bearer = { authorization: `Bearer ${tok}`, ...EXT };
    const soldeAvant = await post('/api/solde', {}, bearer);
    H.v('A0. (avant) liée : le jeton lit le solde du COMPTE (accueil 25, acheté 5 + 2 fusionnés)', [lier.statut, soldeAvant.json && soldeAvant.json.solde && soldeAvant.json.solde.accueil, soldeAvant.json && soldeAvant.json.solde && soldeAvant.json.solde.achete], [200, 25, 7]);
    const instLiee0 = await col('installations').findOne({ jetonEmpreinte: J.empreinte(tok) });
    H.v('A0b. (avant) la liaison réelle a fusionné : l\'installation est à 0 essai et 0 acheté', [instLiee0.essais, instLiee0.achete], [0, 0]);
    // une question en attente du compte
    await col('questions').insertOne({ _id: SID + ':0', scanId: SID, carte: 0, porteur: { type: 'compte', id: c._id }, surface: 'extension', credit: { poche: 'accueil' }, raison: null, choix: [], candidats: [], poseeLe: new Date(), etat: 'en-attente', reponse: null, priseLe: null, regleeLe: null, rembourse: null, raisonNonRembourse: null, lot: false });
    await col('mouvements').insertOne({ compteId: c._id, le: new Date(), type: 'debit', delta: -1, poche: 'accueil', credit: { poche: 'accueil' }, scanId: SID, etat: 'reserve', cleIdempotence: 'scan|compte|' + SID, surface: 'extension' });
    // la victime réinitialise (lien posé directement)
    const mvAvantReinit = await col('mouvements').countDocuments({}), cAvantReinit = await col('comptes').findOne({ _id: c._id });
    const jr = J.genererJeton(); await col('liens_email').insertOne({ empreinte: J.empreinte(jr), type: 'reinit', compteId: c._id, creeLe: new Date(), expireLe: new Date(Date.now() + 864e5), utiliseLe: null });
    const rr = await post('/api/compte/reinitialiser', { jeton: jr, motDePasse: MDP2 });
    H.v('A1. réinitialisation 200', rr.statut, 200);
    // ── condition 1 : toutes les sessions et tous les jetons liés au compte sont invalides
    const rs = await resoudre({ cookie }), ri = await resoudre({ authorization: `Bearer ${tok}` });
    H.v('K1. condition 1 : l\'ancienne session ne résout aucun porteur (401) ; le jeton de l\'installation ne résout plus de porteur COMPTE ; aucune session, aucun code vivant, aucune installation liée', [rs.porteur, ri.porteur && ri.porteur.type, ri.porteur && ri.porteur.compte,
        await col('sessions').countDocuments({ compteId: c._id }), await col('codes_liaison').countDocuments({ compteId: c._id }), await col('installations').countDocuments({ compteId: c._id })], [null, 'installation', null, 0, 0, 0]);
    H.v('K1b. la réinitialisation n\'a écrit AUCUN mouvement ni touché aux soldes (aucun essai neuf, aucune poche déplacée)', [(await col('mouvements').countDocuments({})) - mvAvantReinit, (await col('comptes').findOne({ _id: c._id })).solde], [0, cAvantReinit.solde]);
    // ── condition 2 : aucun accès au compte, surface par surface
    const cAvant = await col('comptes').findOne({ _id: c._id }); const mv0 = await col('mouvements').countDocuments({});
    const toutes = [];
    const jouer = async (nom, p) => { const r = await p; toutes.push(JSON.stringify(r.json) + (r.texte || '')); return r; };
    const gc = await jouer('GET /api/compte', H.appel(srv.url, '/api/compte', { entetes: { ...ip(), ...bearer } }));
    const gcCookie = await jouer('GET /api/compte (ancienne session)', H.appel(srv.url, '/api/compte', { entetes: { ...ip(), cookie } }));
    H.v('B1. compte, solde du compte, historique, mouvements, installations, adresse : le jeton délié et l\'ancienne session reçoivent 401', [gc.statut, gcCookie.statut], [401, 401]);
    const sl = await jouer('POST /api/solde', post('/api/solde', {}, bearer));
    const s = sl.json && sl.json.solde;
    H.v('B2. POST /api/solde : la poche de l\'INSTALLATION seule (0 essai, 0 acheté), rien du compte (accueil 0, hebdo 0, pas d\'abonnement, pas de compte lié)', [sl.statut, s && s.essai, s && s.accueil, s && s.achete, s && s.hebdo, s && s.abonnement, s && s.compte], [200, 0, 0, 0, 0, null, { lie: false, emailMasque: null, verifie: false }]);
    const g1 = await jouer('GET /api/collection', H.appel(srv.url, '/api/collection', { entetes: { ...SITE, ...ip(), ...bearer } }));
    const g2 = await jouer('GET set', H.appel(srv.url, '/api/collection/sets/Set-A', { entetes: { ...SITE, ...ip(), ...bearer } }));
    const g3 = await jouer('PUT fiche', H.appel(srv.url, '/api/collection/sets/Set-A/fiches/' + encodeURIComponent('1|002'), { methode: 'PUT', corps: { possedee: true }, entetes: { ...SITE, ...ip(), ...bearer } }));
    H.v('B3. les trois routes de Ma collection avec le jeton délié : 401 SESSION', [g1.statut, g2.statut, g3.statut], [401, 401, 401]);
    H.v('B3b. … et aucune fiche écrite', await col('collection_fiches').countDocuments({ compteId: c._id }), 1);
    const cc = await jouer('POST /api/compte/code', post('/api/compte/code', {}, { authorization: 'Bearer ' + tok }));
    H.v('B4. créer un code de liaison avec le jeton délié : 401', cc.statut, 401);
    const ancien = await jouer('lier ancien code', post('/api/compte/lier', { code: code2.json.code }, bearer));
    H.v('B5. le code resté vivant ne lie plus (404), l\'installation reste sans compte : pas de rattachement possible sans une nouvelle connexion', [ancien.statut, (await col('installations').findOne({ jetonEmpreinte: J.empreinte(tok) })).compteId], [404, null]);
    const ident = await jouer('POST /api/identifier', post('/api/identifier', { contrat: 2, imageUrls: [require('../../verrou/charges.json').charges.find(x => x.cellule === 'occidentale').imageUrl], title: null, description: null, prixVinted: null, devise: null, marche: 'vinted.fr', versionExtension: '2.0.0', langueInterface: 'fr' }, { ...bearer, 'idempotency-key': `rel-${Date.now()}` }));
    H.v('B6. identification avec le jeton délié : 429 QUOTA (aucune poche : ni la sienne, vidée par la fusion, ni celle du compte), chaîne non appelée, aucun mouvement', [ident.statut, ident.json && ident.json.erreur && ident.json.erreur.code, appelsChaine, (await col('mouvements').countDocuments({})) - mv0], [429, 'QUOTA', 0, 0]);
    const rep = await jouer('POST /api/identifier/reponse', post('/api/identifier/reponse', { scanId: SID, carte: 0, choix: 'aucune' }, { ...bearer, 'idempotency-key': `rel2-${Date.now()}` }));
    const qv = await col('questions').findOne({ _id: SID + ':0' });
    H.v('B7. répondre à la question en attente du compte avec le jeton délié : refusé (≥ 400), question intacte', [rep.statut >= 400, qv.etat], [true, 'en-attente']);
    await jouer('POST /api/retour-live', post('/api/retour-live', { scanId: SID, idProduct: 1 }, bearer));
    const cApres = await col('comptes').findOne({ _id: c._id });
    H.v('B8. soldes et abonnement du compte inchangés par toutes ces requêtes', [cApres.solde, cApres.abonnement.restant], [cAvant.solde, cAvant.abonnement.restant]);
    H.vrai('B9. aucune réponse ne contient l\'adresse du compte (ni masquée)', !toutes.join('').includes('cible') && !toutes.join('').includes('c•••'));
    H.v('B10. aucun courriel envoyé par ces requêtes (un seul : la confirmation éventuelle, jamais pour le jeton délié)', courrier.envoyes.filter(e => e.type === 'reinit').length, 0);
    // ── condition 3 : exactement les droits d'une installation anonyme, rien hérité
    const inst = await col('installations').findOne({ jetonEmpreinte: J.empreinte(tok) });
    H.v('C1. l\'installation déliée : sans compte, 0 essai, 0 acheté (sa poche telle qu\'elle est après la fusion), aucun essai neuf', [inst.compteId, inst.essais, inst.achete], [null, 0, 0]);
    const anon = await post('/api/installation', { libelle: 'anonyme neuve' }, EXT);
    const soldeAnon = await post('/api/solde', {}, { authorization: `Bearer ${anon.json.jetonInstallation}`, ...EXT });
    H.v('C1b. ses droits sont ceux d\'une installation anonyme : même forme de solde (compte non lié, rien du compte) ; seule diffère la poche d\'essai (3 à la naissance, une fois)', [Object.keys(s).sort(), Object.keys(soldeAnon.json.solde).sort(), soldeAnon.json.solde.essai, soldeAnon.json.solde.compte], [Object.keys(soldeAnon.json.solde).sort(), Object.keys(s).sort(), 3, { lie: false, emailMasque: null, verifie: false }]);
    // seconde réinitialisation : rien de neuf
    const jr2 = J.genererJeton(); await col('liens_email').insertOne({ empreinte: J.empreinte(jr2), type: 'reinit', compteId: c._id, creeLe: new Date(), expireLe: new Date(Date.now() + 864e5), utiliseLe: null });
    await post('/api/compte/reinitialiser', { jeton: jr2, motDePasse: 'encore-un-mot-de-passe-9' });
    const inst2 = await col('installations').findOne({ jetonEmpreinte: J.empreinte(tok) });
    H.v('C2. après une seconde réinitialisation : toujours 0 essai / 0 acheté, sans compte (la déliaison ne fabrique aucun essai)', [inst2.compteId, inst2.essais, inst2.achete, (await col('mouvements').countDocuments({})) - mv0], [null, 0, 0, 0]);
    await srv.fermer(); await H.fermerBac(); H.bilan();
})().catch(e => { console.error('❌', e); process.exit(1); });
