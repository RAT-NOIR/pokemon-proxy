'use strict';
// Banc CALCUL-CLIENT (2) — de bout en bout : POST /api/identifier avec le vecteur de l'extension, le serveur ne mesurant AUCUN pixel (V2_ORB_SERVEUR=0) ; le `complement` (les mesures que le client doit calculer) ;
// POST /api/identifier/mesures (le second envoi) : jeton, un seul envoi, forme, cohérence, promotion d'un candidat de la question, règlement de la question réservée (un seul débit), rien d'écrit comme une vérité.
// Base : la base EN MÉMOIRE du banc ; chaîne héritée FABRIQUÉE ; index fabriqué (_empreinte-aide.js) ; zones FAUSSES (elles ne doivent JAMAIS être appelées quand l'ORB serveur est éteint).
// Aucun réseau, aucun fichier du testeur, aucun modèle, aucune dépense. L'assertion du drapeau ÉTEINT est écrite en PREMIER.
const H = require('./_harnais');
const path = require('path');
const mongoose = require('mongoose');
const db = require('../db'); const M = require('../modeles'); const J = require('../comptes/jetons'); const QA = require('./_aide-quota');
const { lireConfig } = require('../config');
const A = require('./_empreinte-aide');
const R = path.join(__dirname, '..', '..');
const IMAGE = require(path.join(R, 'verrou', 'charges.json')).charges.find(c => c.cellule === 'occidentale').imageUrl;
const cfgOff = lireConfig({ ...A.ENV_EMPREINTE, V2_ORB_SERVEUR: '0' });                                   // V2_MESURES_CLIENT non posé
const cfgCC = lireConfig({ ...A.ENV_EMPREINTE, V2_MESURES_CLIENT: '1', V2_ORB_SERVEUR: '0' });
const cfgOrb = lireConfig({ ...A.ENV_EMPREINTE, V2_MESURES_CLIENT: '1' });                                 // l'ORB serveur reste allumé (défaut)
const ORIGINE = cfgCC.origines.extension;
let nIp = 0; const ip = () => { nIp++; return { 'x-forwarded-for': `10.9.${Math.floor(nIp / 250)}.${nIp % 250 + 1}` }; };
let nCle = 0; const cle = () => `banc-cc-${Date.now().toString(36)}-${++nCle}`;
const raw = n => mongoose.connection.db.collection(n);
const attendre = ms => new Promise(r => setTimeout(r, ms));
const corps = (o = {}) => ({ contrat: 2, imageUrls: [IMAGE], title: null, description: null, prixVinted: null, devise: null, marche: 'vinted.fr', versionExtension: '2.0.0', langueInterface: 'fr', ...o });
async function inst(essais = 3) {
    const jeton = J.genererJeton(); const i = M.nouvelleInstallation({ jetonEmpreinte: J.empreinte(jeton), essais, libelle: 'banc' });
    await db.col('installations').insertOne(i); return { i, jeton };
}
const entetes = jeton => ({ origin: ORIGINE, ...ip(), authorization: `Bearer ${jeton}`, 'idempotency-key': cle() });
const poster = (url, jeton, c) => H.appel(url, '/api/identifier', { methode: 'POST', corps: c, entetes: entetes(jeton) });
const envoyer = (url, jeton, c) => H.appel(url, '/api/identifier/mesures', { methode: 'POST', corps: c, entetes: entetes(jeton) });
const repondre = (url, jeton, c) => H.appel(url, '/api/identifier/reponse', { methode: 'POST', corps: c, entetes: entetes(jeton) });
const essaisDe = id => QA.restantDe({ type: 'installation', id }, cfgCC);
const VB = require('./_visuels-banc'); const VIS = [];
const semer = async (id, numero = '001') => {
    await raw('catalogue_produits').insertOne({ idProduct: id, name: `Tropius (PBL ${numero})`, idExpansion: 990001, idMetacard: 990100 + (id % 100) });
    await raw('numeros_cartes').insertOne({ idProduct: id, idExpansion: 990001, numero, numeroUrl: 'PBL' + numero, codeSet: 'PBL', nomFr: 'Tropius', slug: `Tropius-PBL${numero}-${id}`, slugSet: 'Banc-Set', source: 'cardmarket', certitude: 'exacte' });
    await raw('guide_prix').insertOne({ idProduct: id, avg: 1.1, low: 0.5, trend: 1.0, avg1: 1.0, avg7: 1.0, avg30: 1.1, guideDu: new Date('2026-10-04') });
    VIS.push(VB.doc(id, { numero, idMetacard: 990100 + (id % 100) }));
};
// les résultats qu'un client HONNÊTE calcule sur la carte honnête (mêmes valeurs que les fausses zones de _empreinte-aide.js : la photo ressemble à jeu-12), et ceux d'une carte FORGÉE (elle ressemble à jeu-13)
const zonesHautes = ref => ({ type: 'zones', ref, haut: 0.9, illustration: 0.9, bandeau: 0.9, texte: 0.9, bas: 0.9, inliers: 120 });
const resultatsPour = (mesures, gagne) => mesures.map(m => (m.type === 'paire' ? { type: 'paire', a: m.a, b: m.b, ecart: m.a === gagne ? 0.4 : -0.4, couverture: 0.2 } : zonesHautes(m.ref)));

(async () => {
    await H.ouvrirBancV2();
    await QA.eviterMinuit();
    process.env.MONGODB_BASE = 'test_scratch';
    const { connecterMongo } = require('../../mongo-connexion');
    await connecterMongo({ script: 'test-calcul-client-route.js', ecrit: true });
    db.brancher(mongoose.connection.db);
    await M.creerIndex();
    for (const c of ['catalogue_produits', 'numeros_cartes', 'guide_prix', 'codes_set']) await raw(c).deleteMany({});
    await raw('codes_set').insertOne({ idExpansion: 990001, codeSet: 'PBL', apprisLe: new Date() });
    for (const id of [A.ID_A, A.ID_B, A.ID_P]) await semer(id, '001');
    await semer(A.ID_X, '002');
    VB.installer(VIS, [], { emprunts: true });

    const express = require('express'); const pret = require('../pret');
    const { assembler } = require('../index');
    const lecture = (id, o = {}) => ({ success: true, question: null, carte: { idProduct: id, nomProduit: 'Tropius', nom: 'Tropius', numero: '001', total: '064', setCode: 'PBL', rarete: null, langue: 'FR', ambigu: false, ...o },
        etat: { estimeIA: null, confianceIA: null, defautsVus: [], declareVendeur: null, declareCardmarket: null, retenu: null },
        candidats: [{ idProduct: id, nom: 'Tropius', numero: '001', set: 'Banc Set', prix: 1, photoUrl: null }], classement: [], guidePrix: {}, reverse: { attendue: false, motif: null, etat: 'aucun-motif', strategie: null }, codeLangue: 2 });
    let chaine = null;
    const chaineFabriquee = async (req, res) => {
        const { mode, ids } = chaine;
        if (mode === 'affirmee') return res.json({ ...lecture(ids[0]), scanId: String(req.scanIdImpose) });
        if (mode === 'ambigue') {
            await req.credit.v2.poserQuestion(req, { scanId: req.scanIdImpose, raison: 'egalite-sans-enjeu', candidats: ids });
            const l = lecture(ids[0]);
            return res.json({ ...l, scanId: String(req.scanIdImpose), question: { etat: 'en-attente', delaiHeures: 24 }, carte: { ...l.carte, ambigu: true }, candidats: ids.map(id => ({ idProduct: id, nom: 'Tropius', numero: '001', set: 'Banc Set', prix: 1, photoUrl: null })) });
        }
        throw new Error(`mode inconnu ${mode}`);
    };
    let horloge = null;                                                                 // null : l'heure réelle
    const appFabrique = async (cfgApp, deps = {}) => {
        const app = express(); app.set('trust proxy', true); app.use(express.json({ limit: '2400kb' }));
        pret.armer(require('../modeles').verifierIndex);
        app.use(assembler([require('../argent/monter'), require('../identifier/monter')], cfgApp, { jumeaux: () => ({ conclu: true, ids: [] }), gererIdentifier: chaineFabriquee, maintenant: () => (horloge === null ? Date.now() : horloge), ...deps }));
        return H.serveur(app);
    };
    const requete = (i, o = {}) => ({ empreintes: [A.entree(0, i, true)], modeleEmpreinte: A.modeleAnnonce(), ...o });
    const AVEC = { capacitesClient: ['mesures-1'] };
    const jouer = async (sv, c, req) => { chaine = c; const x = await inst(3); const r = await poster(sv.url, x.jeton, corps(req)); await attendre(50); return { ...x, r, j: r.json || {} }; };
    const analyseDe = j => raw('analyses').findOne({ _id: new mongoose.Types.ObjectId(j.scanId) });
    const questionDe = j => raw('questions_v2').findOne({ _id: `${j.scanId}:0` });
    const carte0 = j => j.analyse.cartes[0];
    const crochet = require('../banc/crochet'); const origRep = crochet.apresReponse; let appelsRep = 0;
    crochet.apresReponse = () => { appelsRep++; };
    await A.preparer();
    A.installerIndex();
    const CH = { mode: 'ambigue', ids: [A.ID_P, A.ID_A] };                                    // la question de la chaîne : P et A, les produits de jeu-12 et jeu-13 (jumeaux, tous deux concordants)

    // ── (1) EN PREMIER : V2_MESURES_CLIENT ÉTEINT — ni complément ni route, même si le client l'annonce
    {
        const zones = A.fausseZones();
        const sv = await appFabrique(cfgOff, { zonesEmpreinte: zones, scanEmpreinte: A.scanBanc });
        const o = await jouer(sv, CH, requete(12, AVEC));
        H.v('1a. drapeau éteint : la question reste, AUCUN `complement`, G se tait (« muette » : l\'ORB serveur est éteint)', [o.r.statut, carte0(o.j).statut, 'complement' in o.j, o.j.empreinte], [200, 'a-trancher', false, { utilisee: false, code: 'muette' }]);
        H.v('1b. … et la route du second envoi N\'EXISTE PAS (404)', (await envoyer(sv.url, o.jeton, { scanId: o.j.scanId, jeton: 'x', resultats: [] })).statut, 404);
        H.v('1c. … l\'ORB serveur éteint ne regarde AUCUN pixel : les zones ne sont jamais appelées', zones.appels.length, 0);
        H.vrai('1d. … la ligne `analyses` ne porte pas `complementMesures`', !(await analyseDe(o.j)).complementMesures);
        await sv.fermer();
    }

    const zones = A.fausseZones();
    const sv = await appFabrique(cfgCC, { zonesEmpreinte: zones, scanEmpreinte: A.scanBanc });
    // ── (2) allumé, ORB serveur éteint, client qui l'annonce : le premier verdict, puis le complément
    let o2;
    {
        o2 = await jouer(sv, CH, requete(12, AVEC));
        const c = o2.j.complement || {};
        H.v('2a. le premier verdict est la question de la chaîne (P, A), réservée (3 → 2)', [o2.r.statut, carte0(o2.j).statut, carte0(o2.j).candidats.map(x => x.idProduct).sort(), await essaisDe(o2.i._id)], [200, 'a-trancher', [A.ID_P, A.ID_A].sort(), 2]);
        H.v('2b. le complément : les 4 mesures de l\'ensemble fermé (deux paires ordonnées, deux zones), 120 s', [(c.mesures || []).map(m => (m.type === 'paire' ? `p:${m.a}|${m.b}` : `z:${m.ref}`)), c.expireDans],
            [['p:banc/jeu-12.webp|banc/jeu-13.webp', 'p:banc/jeu-13.webp|banc/jeu-12.webp', 'z:banc/jeu-12.webp', 'z:banc/jeu-13.webp'], 120]);
        H.v('2c. les références : les visuels PUBLICS de l\'archive (hôte public de la configuration), sha256 et octets inconnus', c.references, ['banc/jeu-12.webp', 'banc/jeu-13.webp'].map(ref => ({ ref, url: `https://${cfgCC.images.hotesPublics[0]}/${ref.split('/').map(encodeURIComponent).join('/')}`, sha256: null, octets: null })));
        H.v('2d. un jeton opaque (échéance + signature), sans le scan en clair', [typeof c.jeton, /^[0-9]+\.[A-Za-z0-9_-]+$/.test(c.jeton || ''), (c.jeton || '').includes(o2.j.scanId)], ['string', true, false]);
        H.v('2e. AUCUN pixel regardé par le serveur (zones jamais appelées)', zones.appels.length, 0);
        const an = await analyseDe(o2.j);
        H.v('2f. la ligne `analyses` garde ce que le second envoi relira (mesures, ligne, références, candidats, non consommé)', [an.complementMesures && an.complementMesures.mesures.length, an.complementMesures && an.complementMesures.ids.sort(), an.complementMesures && an.complementMesures.consomme, an.complementMesures && an.complementMesures.ligne.top.length > 0], [4, [A.ID_P, A.ID_A].sort(), false, true]);
        const sans = await jouer(sv, CH, requete(12));
        H.v('2g. le MÊME scan sans `capacitesClient` : aucun complément (le client qui ne mesure pas reçoit la réponse d\'avant)', ['complement' in sans.j, carte0(sans.j).statut], [false, 'a-trancher']);
        const autreValeur = await jouer(sv, CH, requete(12, { capacitesClient: ['mesures-2', 'autre'] }));
        H.v('2h. une capacité inconnue : aucun complément, la requête n\'est pas refusée', [autreValeur.r.statut, 'complement' in autreValeur.j], [200, false]);
        const affirmee = await jouer(sv, { mode: 'affirmee', ids: [A.ID_P] }, requete(12, AVEC));
        H.v('2i. une affirmation de la chaîne : jamais de complément (le second envoi ne fait que PROMOUVOIR une question)', [carte0(affirmee.j).statut, 'complement' in affirmee.j], ['identifiee', false]);
        const seul = await jouer(sv, CH, requete(3, AVEC));
        H.v('2j. un vecteur sans jumeau (jeu-3) : aucune mesure à demander, aucun complément', 'complement' in seul.j, false);
    }

    // ── (3) le second envoi honnête : P est promu, la question réservée est RÉGLÉE comme une réponse (un seul débit)
    {
        const c = o2.j.complement;
        const r = await envoyer(sv.url, o2.jeton, { scanId: o2.j.scanId, jeton: c.jeton, opencv: '5.0.0-banc', resultats: resultatsPour(c.mesures, 'banc/jeu-12.webp') });
        H.v('3a. 200, change: true, la carte identifiee P', [r.statut, r.json && r.json.change, r.json && r.json.carte && r.json.carte.statut, r.json && r.json.carte && r.json.carte.carte && r.json.carte.carte.idProduct], [200, true, 'identifiee', A.ID_P]);
        H.v('3b. un seul débit : la réserve est devenue un débit (essais toujours 2), la question est répondue par P', [await essaisDe(o2.i._id), (await questionDe(o2.j)).etat, (await questionDe(o2.j)).reponse && (await questionDe(o2.j)).reponse.idProduct], [2, 'repondue', A.ID_P]);
        const an = await analyseDe(o2.j);
        H.v('3c. le journal : complément consommé, issue « promotion », produit P — et RIEN dans `cartes.0.reponse` (la vérité d\'une personne)', [an.complementMesures.consomme, an.complementMesures.issue, an.complementMesures.produit, an.complementMesures.opencv, 'reponse' in an.cartes[0], an.cartes[0].promotionMesures && an.cartes[0].promotionMesures.idProduct], [true, 'promotion', A.ID_P, '5.0.0-banc', false, A.ID_P]);
        H.v('3d. rien de partagé : le crochet du banc réel (réponse) n\'est pas appelé', appelsRep, 0);
        const encore = await envoyer(sv.url, o2.jeton, { scanId: o2.j.scanId, jeton: c.jeton, resultats: resultatsPour(c.mesures, 'banc/jeu-12.webp') });
        H.v('3e. un second envoi : 409 CONFLIT', [encore.statut, encore.json && encore.json.erreur && encore.json.erreur.code], [409, 'CONFLIT']);
        const lettreDe = id => carte0(o2.j).question.choix.find(x => x.idProduct === id).id;
        const tard = await repondre(sv.url, o2.jeton, { scanId: o2.j.scanId, choix: lettreDe(A.ID_A) });
        H.v('3f. la personne répond ensuite AUTRE CHOSE (A) : 409 (la question est réglée par P)', tard.statut, 409);
        const meme = await repondre(sv.url, o2.jeton, { scanId: o2.j.scanId, choix: lettreDe(A.ID_P) });
        H.v('3g. … la même réponse (P) : 200, idempotente, sans second débit (essais toujours 2)', [meme.statut, await essaisDe(o2.i._id)], [200, 2]);
    }

    // ── (4) ce qu'un client ne peut PAS faire
    {
        const o = await jouer(sv, CH, requete(12, AVEC)); const c = o.j.complement;
        const mauvais = await envoyer(sv.url, o.jeton, { scanId: o.j.scanId, jeton: c.jeton.replace(/.$/, ch => (ch === 'A' ? 'B' : 'A')), resultats: resultatsPour(c.mesures, 'banc/jeu-12.webp') });
        H.v('4a. un jeton falsifié : 410 CODE_EXPIRE, rien n\'est consommé', [mauvais.statut, (await analyseDe(o.j)).complementMesures.consomme], [410, false]);
        const autre = await inst(3);
        const etranger = await envoyer(sv.url, autre.jeton, { scanId: o.j.scanId, jeton: c.jeton, resultats: resultatsPour(c.mesures, 'banc/jeu-12.webp') });
        H.v('4b. le scan d\'un AUTRE porteur : 404 (il n\'existe pas pour lui)', etranger.statut, 404);
        const incoherent = await envoyer(sv.url, o.jeton, { scanId: o.j.scanId, jeton: c.jeton, resultats: resultatsPour(c.mesures, 'banc/jeu-12.webp').map(x => (x.type === 'paire' ? { ...x, couverture: 0 } : x)) });
        H.v('4c. des résultats INCOHÉRENTS (couverture nulle, écart non nul) : 200 change: false — le premier verdict reste, la question reste ouverte', [incoherent.statut, incoherent.json && incoherent.json.change, (await questionDe(o.j)).etat, (await analyseDe(o.j)).complementMesures.issue], [200, false, 'en-attente', 'rejetees-coherence']);
        const apres = await repondre(sv.url, o.jeton, { scanId: o.j.scanId, choix: 'a' });
        H.v('4d. … et la personne peut toujours répondre elle-même (200)', apres.statut, 200);
        const o5 = await jouer(sv, CH, requete(12, AVEC)); const c5 = o5.j.complement;
        const court = await envoyer(sv.url, o5.jeton, { scanId: o5.j.scanId, jeton: c5.jeton, resultats: resultatsPour(c5.mesures, 'banc/jeu-12.webp').slice(1) });
        H.v('4e. une mesure manquante : 200 change: false (forme), question ouverte', [court.json && court.json.change, (await analyseDe(o5.j)).complementMesures.issue, (await questionDe(o5.j)).etat], [false, 'rejetees-forme', 'en-attente']);
        H.v('4f. des corps mal formés : 400 ENTREE (scanId, jeton, résultats)', [(await envoyer(sv.url, o5.jeton, { scanId: 'x', jeton: 'a', resultats: [] })).statut, (await envoyer(sv.url, o5.jeton, { scanId: o5.j.scanId, resultats: [] })).statut, (await envoyer(sv.url, o5.jeton, { scanId: o5.j.scanId, jeton: 'a', resultats: Array(13).fill({}) })).statut], [400, 400, 400]);
        // la carte FORGÉE : le client désigne le jumeau A — un candidat de la question, concordant avec la lecture. Il obtient A : la limite connue (8bis-m de la route d'empreinte), pour lui seul
        const o6 = await jouer(sv, CH, requete(12, AVEC)); const c6 = o6.j.complement;
        const forge = await envoyer(sv.url, o6.jeton, { scanId: o6.j.scanId, jeton: c6.jeton, resultats: resultatsPour(c6.mesures, 'banc/jeu-13.webp') });
        H.v('4g. résultats d\'une carte forgée (jeu-13 gagne) : A, un candidat de la question — comme la voie serveur sur la même carte forgée', [forge.json && forge.json.change, forge.json && forge.json.carte && forge.json.carte.carte && forge.json.carte.carte.idProduct], [true, A.ID_A]);
        // un candidat HORS de la question : la chaîne demande (B, A), le client désigne P (jeu-12) — refusé
        const o7 = await jouer(sv, { mode: 'ambigue', ids: [A.ID_B, A.ID_A] }, requete(12, AVEC)); const c7 = o7.j.complement;
        const hors = await envoyer(sv.url, o7.jeton, { scanId: o7.j.scanId, jeton: c7.jeton, resultats: resultatsPour(c7.mesures, 'banc/jeu-12.webp') });
        H.v('4h. 🔑 le produit désigné n\'est PAS un candidat de la question : change: false (« hors-question »), la question reste', [hors.json && hors.json.change, (await analyseDe(o7.j)).complementMesures.issue, (await questionDe(o7.j)).etat], [false, 'hors-question', 'en-attente']);
        // l'échéance : 120 s
        const o8 = await jouer(sv, CH, requete(12, AVEC)); const c8 = o8.j.complement;
        horloge = Date.now() + 121e3;
        const expire = await envoyer(sv.url, o8.jeton, { scanId: o8.j.scanId, jeton: c8.jeton, resultats: resultatsPour(c8.mesures, 'banc/jeu-12.webp') });
        horloge = null;
        H.v('4i. après 120 s : 410, rien n\'est consommé, la question reste', [expire.statut, (await analyseDe(o8.j)).complementMesures.consomme, (await questionDe(o8.j)).etat], [410, false, 'en-attente']);
    }
    await sv.fermer();

    // ── (5) ORB serveur ALLUMÉ : le serveur mesure lui-même, il ne demande rien au client (comportement d'avant)
    {
        const zonesOrb = A.fausseZones();
        const svOrb = await appFabrique(cfgOrb, { zonesEmpreinte: zonesOrb, scanEmpreinte: A.scanBanc });
        const o = await jouer(svOrb, CH, requete(12, AVEC));
        H.v('5. ORB serveur allumé : la garde des zones tranche côté serveur (identifiee P), aucun complément', [carte0(o.j).statut, carte0(o.j).carte && carte0(o.j).carte.idProduct, 'complement' in o.j, zonesOrb.appels.length > 0], ['identifiee', A.ID_P, false, true]);
        await svOrb.fermer();
    }

    // ── (6) /ping : le jeton `mesures-client` suit les quatre conditions
    {
        const C = require('../capacites');
        const etat = require('../identifier/etat-empreintes');
        const avecObjet = { ...A.ENV_EMPREINTE, V2_MODELE_EMPREINTE_OBJET: 'objets/fictif-modele' };
        const servi = env => C.capacitesServies(lireConfig(env), undefined, () => null, etat.courante).includes('mesures-client');
        H.v('6. `mesures-client` : seulement drapeau + ORB serveur éteint + jeton `empreinte` (modèle complet, index chargé)', [servi({ ...avecObjet, V2_MESURES_CLIENT: '1', V2_ORB_SERVEUR: '0' }), servi({ ...avecObjet, V2_MESURES_CLIENT: '1' }), servi({ ...avecObjet, V2_ORB_SERVEUR: '0' }), servi({ ...A.ENV_EMPREINTE, V2_MESURES_CLIENT: '1', V2_ORB_SERVEUR: '0' })], [true, false, false, false]);
    }

    crochet.apresReponse = origRep;
    const monter = require('../identifier/monter'); monter.arreterBalayage(); monter.arreterPurge(); require('../argent/marque-scan').arreterRattrapage();
    A.etat.vider();
    await mongoose.disconnect();
    await H.arreterBanc();
    H.bilan();
})().catch(async e => { console.error('❌', e); try { await H.arreterBanc(); } catch (_) { } process.exit(1); });
