'use strict';
// Banc G-GROUPE (3) — DE BOUT EN BOUT : POST /api/identifier (la question P/A, le complément de mesures), POST /api/identifier/mesures (la tête du groupe), le niveau « probable » débité UNE fois, le rejeu idempotent.
// La tête posée par g-groupe.js (règle inchangée) devient le probable de PROBABLE SEULEMENT si V2_PROBABLE ET V2_G_GROUPE sont allumés ET que toutes les gardes de PROBABLE passent (version de l'extension, I3 groupes,
// vecteur exigé et cosinus minimal, I2 prix de guide servi) ; le débit passe par argent.passerEnProbable (I1, atomique). Un seul drapeau : la réponse est celle d'avant, octet pour octet (comparée à la référence « aucun drapeau »).
// Base : la base EN MÉMOIRE du banc ; chaîne héritée FABRIQUÉE ; index fabriqué (_empreinte-aide.js) ; zones FAUSSES (le serveur ne mesure aucun pixel). Aucun réseau, aucun modèle, aucune dépense.
const H = require('./_harnais');
const path = require('path');
const mongoose = require('mongoose');
const db = require('../db'); const M = require('../modeles'); const J = require('../comptes/jetons'); const QA = require('./_aide-quota');
const { lireConfig } = require('../config'); const { valider } = require('../openapi/valider'); const SCHEMA = require('../openapi/openapi.v2.json');
const A = require('./_empreinte-aide');
const registre = require('../registre');
const R = path.join(__dirname, '..', '..');
const IMAGE = require(path.join(R, 'verrou', 'charges.json')).charges.find(c => c.cellule === 'occidentale').imageUrl;
const ref = n => ({ $ref: `#/components/schemas/${n}` });
const BASE = { ...A.ENV_EMPREINTE, V2_ORB_SERVEUR: '0', V2_MESURES_CLIENT: '1' };
const cfgDe = o => lireConfig({ ...BASE, ...o });
const cfgRien = cfgDe({}), cfgProbable = cfgDe({ V2_PROBABLE: '1' }), cfgGroupe = cfgDe({ V2_G_GROUPE: '1' }), cfgDeux = cfgDe({ V2_PROBABLE: '1', V2_G_GROUPE: '1' });
const ORIGINE = cfgRien.origines.extension;
let nIp = 0; const ip = () => { nIp++; return { 'x-forwarded-for': `10.19.${Math.floor(nIp / 250)}.${nIp % 250 + 1}` }; };
let nCle = 0; const cle = () => `banc-gp-${Date.now().toString(36)}-${++nCle}`;
const raw = n => mongoose.connection.db.collection(n);
const attendre = ms => new Promise(r => setTimeout(r, ms));
const corps = (o = {}) => ({ contrat: 2, imageUrls: [IMAGE], title: null, description: null, prixVinted: null, devise: null, marche: 'vinted.fr', versionExtension: '2.0.1', langueInterface: 'fr', ...o });
async function inst(essais = 30) {
    const jeton = J.genererJeton(); const i = M.nouvelleInstallation({ jetonEmpreinte: J.empreinte(jeton), essais, libelle: 'banc' });
    await db.col('installations').insertOne(i); return { i, jeton };
}
const entetes = jeton => ({ origin: ORIGINE, ...ip(), authorization: `Bearer ${jeton}`, 'idempotency-key': cle() });
const poster = (url, jeton, c) => H.appel(url, '/api/identifier', { methode: 'POST', corps: c, entetes: entetes(jeton) });
const envoyer = (url, jeton, c) => H.appel(url, '/api/identifier/mesures', { methode: 'POST', corps: c, entetes: entetes(jeton) });
const repondre = (url, jeton, c) => H.appel(url, '/api/identifier/reponse', { methode: 'POST', corps: c, entetes: entetes(jeton) });
async function livre(x) {
    const mv = await raw('mouvements').find({ installationId: x.i._id }).toArray();
    return { net: mv.reduce((s, m) => s + m.delta, 0), ouverts: mv.filter(m => m.type === 'debit' && m.etat !== 'rembourse').map(m => m.etat), remboursements: mv.filter(m => m.type === 'remboursement').length, debits: mv.filter(m => m.type === 'debit' && m.delta === -1).length };
}
const PAYE = { net: -1, ouverts: ['debite'], remboursements: 0, debits: 1 }, RESERVE = { net: -1, ouverts: ['reserve'], remboursements: 0, debits: 1 }, RENDU = { net: 0, ouverts: [], remboursements: 1, debits: 1 };
const VB = require('./_visuels-banc'); const VIS = [];
const CLE_DE = { [A.ID_P]: 'banc/jeu-12.webp', [A.ID_A]: 'banc/jeu-13.webp' };
const semer = async (id, numero, meta) => {
    await raw('catalogue_produits').insertOne({ idProduct: id, name: `Tropius (PBL ${numero})`, idExpansion: 990001, idMetacard: meta });
    await raw('numeros_cartes').insertOne({ idProduct: id, idExpansion: 990001, numero, numeroUrl: 'PBL' + numero, codeSet: 'PBL', nomFr: 'Tropius', slug: `Tropius-PBL${numero}-${id}`, slugSet: 'Banc-Set', source: 'cardmarket', certitude: 'exacte' });
    await raw('guide_prix').insertOne({ idProduct: id, avg: 1.1, low: 0.5, trend: 1.0, avg1: 1.0, avg7: 1.0, avg30: 1.1, guideDu: new Date('2026-10-04') });
    VIS.push(VB.doc(id, { numero, idMetacard: meta, grande: { cle: CLE_DE[id], w: 600, h: 840 } }));      // un visuel PROPRE par produit (la clé de l'index d'empreintes)
};
// les résultats d'un client honnête : AUCUNE paire ne départage (écart 0), et les zones disent que la photo s'aligne sur jeu-12 (250 inliers) et à peine sur jeu-13 (20)
const resultats = (mesures, inl12 = 250, inl13 = 20) => mesures.map(m => (m.type === 'paire' ? { type: 'paire', a: m.a, b: m.b, ecart: 0, couverture: 0.2 }
    : { type: 'zones', ref: m.ref, haut: 0.8, illustration: 0.8, bandeau: 0.8, texte: 0.8, bas: 0.8, inliers: m.ref === 'banc/jeu-12.webp' ? inl12 : inl13 }));
const norm = j => JSON.stringify(j).replace(/[0-9a-f]{24}/g, '<id>').replace(/"jeton":"[^"]*"/g, '"jeton":"<j>"').replace(/\d{13}\.[A-Za-z0-9_-]+/g, '<j>');
let ecartsContrat = 0;

(async () => {
    await H.ouvrirBancV2();
    await QA.eviterMinuit();
    process.env.MONGODB_BASE = 'test_scratch';
    const { connecterMongo } = require('../../mongo-connexion');
    await connecterMongo({ script: 'test-g-groupe-probable.js', ecrit: true });
    db.brancher(mongoose.connection.db);
    await M.creerIndex();
    for (const c of ['catalogue_produits', 'numeros_cartes', 'guide_prix', 'codes_set']) await raw(c).deleteMany({});
    await raw('codes_set').insertOne({ idExpansion: 990001, codeSet: 'PBL', apprisLe: new Date() });
    await semer(A.ID_P, '001', 990101); await semer(A.ID_A, '001', 990102);
    VB.installer(VIS, [], { emprunts: true });

    const express = require('express'); const pret = require('../pret');
    const { assembler } = require('../index');
    const lecture = id => ({ success: true, question: null, carte: { idProduct: id, nomProduit: 'Tropius', nom: 'Tropius', numero: '001', total: '064', setCode: 'PBL', rarete: null, langue: 'FR', ambigu: false },
        etat: { estimeIA: null, confianceIA: null, defautsVus: [], declareVendeur: null, declareCardmarket: null, retenu: null },
        candidats: [{ idProduct: id, nom: 'Tropius', numero: '001', set: 'Banc Set', prix: 1, photoUrl: null }], classement: [], guidePrix: {}, reverse: { attendue: false, motif: null, etat: 'aucun-motif', strategie: null }, codeLangue: 2 });
    const IDS = [A.ID_P, A.ID_A];
    let numeroLu = '001';          // la lecture de la photo (lectureGarde) : '001' concorde avec P et A ; autre chose les CONTREDIT tous les deux
    const chaine = async (req, res) => {
        await req.credit.v2.poserQuestion(req, { scanId: req.scanIdImpose, raison: 'egalite-sans-enjeu', candidats: IDS });
        const l = lecture(IDS[0]);
        return res.json({ ...l, scanId: String(req.scanIdImpose), lectureGarde: { numero: numeroLu, total: '064', setCode: 'PBL', symboleSet: null, langue: 'FR', attaque: null, attaqueConfiance: null, carteTcgdexId: null, totalHorsTailleDeSet: false, vivierIds: IDS },
            question: { etat: 'en-attente', delaiHeures: 24 }, carte: { ...l.carte, numero: numeroLu, ambigu: true }, candidats: IDS.map(id => ({ idProduct: id, nom: 'Tropius', numero: '001', set: 'Banc Set', prix: 1, photoUrl: null })) });
    };
    const appFabrique = async cfgApp => {
        const app = express(); app.set('trust proxy', true); app.use(express.json({ limit: '2400kb' }));
        pret.armer(require('../modeles').verifierIndex);
        app.use(assembler([require('../argent/monter'), require('../identifier/monter')], cfgApp, { jumeaux: () => ({ conclu: true, ids: [] }), gererIdentifier: chaine, zonesEmpreinte: A.fausseZones(), scanEmpreinte: A.scanBanc }));
        return H.serveur(app);
    };
    const crochet = require('../banc/crochet'); const origRep = crochet.apresReponse; crochet.apresReponse = () => { };
    await A.preparer(); A.installerIndex();
    const AVEC = { capacitesClient: ['mesures-1'] };
    const requete = (o = {}) => ({ empreintes: [A.entree(0, 12, true)], modeleEmpreinte: A.modeleAnnonce(), ...AVEC, ...o });
    const analyseDe = scanId => raw('analyses').findOne({ _id: new mongoose.Types.ObjectId(scanId) });
    const questionDe = scanId => raw('questions_v2').findOne({ _id: `${scanId}:0` });
    /** un scan complet : identifier puis (si un complément est servi) le second envoi. */
    async function jouer(sv, { corpsReq = {}, res = resultats, envoi = true, accepte = true } = {}) {
        const x = await inst(); const r = await poster(sv.url, x.jeton, corps(requete(corpsReq))); await attendre(30);
        const j = r.json || {}; const c = j.complement || null;
        let m = null;
        // `accepteProbable: true` : le client DÉCLARE qu'il sait lire une carte a-trancher dans un `change: true` (sans lui, un probable n'est jamais servi au second envoi)
        if (envoi && c) m = await envoyer(sv.url, x.jeton, { scanId: j.scanId, jeton: c.jeton, opencv: '5.0.0-banc', resultats: res(c.mesures), ...(accepte === true ? { accepteProbable: true } : accepte !== false ? { accepteProbable: accepte } : {}) });
        return { ...x, r, j, c, m, mj: m && m.json, c0: j.analyse && j.analyse.cartes[0] };
    }
    const sv = {}; for (const [k, cfgK] of [['rien', cfgRien], ['probable', cfgProbable], ['groupe', cfgGroupe], ['deux', cfgDeux]]) sv[k] = await appFabrique(cfgK);

    // ── 1. LA RÉFÉRENCE ET LES DRAPEAUX ISOLÉS : un seul drapeau (ou aucun) = la même réponse, octet pour octet
    const ref0 = await jouer(sv.rien), refP = await jouer(sv.probable), refG = await jouer(sv.groupe);
    H.v('1a. (référence) aucun drapeau : la question P/A réservée, un complément de 4 mesures, le second envoi ne change rien', [ref0.c0.statut, ref0.c0.niveau, ref0.c.mesures.length, ref0.mj.change, await livre(ref0)], ['a-trancher', undefined, 4, false, RESERVE]);
    H.v('1b. V2_PROBABLE SEUL = la référence : /identifier puis /mesures, octet pour octet (le niveau « question » est servi en plus, c\'est PROBABLE seul d\'aujourd\'hui)',
        [norm({ ...refP.mj }), refP.c.mesures.length, refP.c0.niveau, refP.c0.probable, await livre(refP)], [norm(ref0.mj), 4, 'question', null, RESERVE]);
    H.v('1c. V2_G_GROUPE SEUL = la référence : la réponse HTTP du second envoi et de l\'identification sont identiques, la crédit reste réservé ; seul le journal garde la tête',
        [norm(refG.j) === norm(ref0.j), norm(refG.mj) === norm(ref0.mj), await livre(refG), (await analyseDe(refG.j.scanId)).complementMesures.ordreGroupe.tete, (await analyseDe(refG.j.scanId)).cartes[0].probable ?? null], [true, true, RESERVE, A.ID_P, null]);
    H.v('1d. … et V2_PROBABLE seul n\'écrit rien de G-GROUPE (ni groupe, ni probableG, ni ordre)', [(await analyseDe(refP.j.scanId)).complementMesures.groupe ?? null, (await analyseDe(refP.j.scanId)).complementMesures.probableG ?? null, (await analyseDe(refP.j.scanId)).complementMesures.ordreGroupe ?? null], [null, null, null]);

    // ── 2. LES DEUX DRAPEAUX : identifier, mesures, probable débité UNE fois
    const on = await jouer(sv.deux);
    H.v('2a. avant les mesures : la question est réservée et sans probable (PROBABLE ne désignait rien)', [on.c0.statut, on.c0.niveau, on.c0.probable, on.c.mesures.length], ['a-trancher', 'question', null, 4]);
    H.v('2b. le second envoi : change true, la carte est la QUESTION (a-trancher) avec niveau probable et le probable P, les deux candidats gardés', [on.m.statut, on.mj.change, on.mj.carte.statut, on.mj.carte.niveau, on.mj.carte.probable, on.mj.carte.candidats.map(x => x.idProduct).sort()], [200, true, 'a-trancher', 'probable', { idProduct: A.ID_P, aConfirmer: true }, [...IDS].sort()]);
    H.v('2c. un SEUL débit : la réserve devient un débit (le grand livre « debite »), la facturation annonce debite 1 reserve 0', [await livre(on), on.mj.facturation.debite, on.mj.facturation.reserve, on.mj.facturation.motif], [PAYE, 1, 0, 'question']);
    const anOn = await analyseDe(on.j.scanId), qOn = await questionDe(on.j.scanId);
    H.v('2d. la surveillance : analyses.cartes[0].probable = { P, signal G }, la question est marquée probable et reste en attente', [anOn.cartes[0].probable, qOn.probable, qOn.etat], [{ idProduct: A.ID_P, signal: 'G' }, true, 'en-attente']);
    H.v('2e. le journal : issue probable-groupe, la tête et l\'avance gardées', [anOn.complementMesures.issue, anOn.complementMesures.ordreGroupe.tete, anOn.complementMesures.ordreGroupe.ecart, anOn.complementMesures.ordreGroupe.probable], ['probable-groupe', A.ID_P, 230, 'servi']);
    const v = valider(on.mj, ref('ReponseMesures'), SCHEMA); if (!v.ok) { ecartsContrat++; console.log(`   écart de contrat : ${v.erreurs.slice(0, 3).map(e => `${e.chemin} ${e.message}`).join(' ; ')}`); }
    H.v('2f. la réponse valide le schéma publié (ReponseMesures : aucun champ nouveau)', ecartsContrat, 0);
    // rejeu : le second envoi est refusé, rien ne bouge
    const rej = await envoyer(sv.deux.url, on.jeton, { scanId: on.j.scanId, jeton: on.c.jeton, resultats: resultats(on.c.mesures) });
    H.v('2g. REJEU du second envoi : 409 CONFLIT, toujours UN débit', [rej.statut, rej.json && rej.json.erreur && rej.json.erreur.code, await livre(on)], [409, 'CONFLIT', PAYE]);
    // la personne confirme : un seul débit, probableConfirme
    const lettre = id => on.mj.carte.question.choix.find(x => x.idProduct === id).id;
    const conf = await repondre(sv.deux.url, on.jeton, { scanId: on.j.scanId, carte: 0, choix: lettre(A.ID_P) });
    H.v('2h. confirmer le probable : identifiee P, toujours un seul débit ; probableConfirme = true', [conf.json.carte.statut, conf.json.carte.carte.idProduct, await livre(on), (await analyseDe(on.j.scanId)).cartes[0].probableConfirme], ['identifiee', A.ID_P, PAYE, true]);
    const conf2 = await repondre(sv.deux.url, on.jeton, { scanId: on.j.scanId, carte: 0, choix: lettre(A.ID_P) });
    H.v('2i. rejeu de la réponse : 200, idempotent, un seul débit', [conf2.statut, await livre(on)], [200, PAYE]);
    // « aucune » sur un probable de G-GROUPE : rendu par le compteur propre
    const on2 = await jouer(sv.deux);
    const aucune = await repondre(sv.deux.url, on2.jeton, { scanId: on2.j.scanId, carte: 0, choix: 'aucune' });
    H.v('2j. « aucune » sur ce probable : introuvable, REMBOURSÉ (compteur propre « probable-aucune »), un débit et un remboursement', [aucune.json.carte.statut, aucune.json.facturation.rembourse, await livre(on2), (await analyseDe(on2.j.scanId)).cartes[0].probableConfirme], ['introuvable', true, RENDU, false]);
    const on3 = await jouer(sv.deux);
    const nsp = await repondre(sv.deux.url, on3.jeton, { scanId: on3.j.scanId, carte: 0, choix: 'ne-sait-pas' });
    H.v('2k. « ne-sait-pas » : le débit reste acquis (PROBABLE d\'aujourd\'hui)', [nsp.json.facturation.debite, nsp.json.facturation.rembourse, await livre(on3)], [1, false, PAYE]);

    // ── 3. CHAQUE GARDE : si une seule ne passe pas, le niveau reste une question (crédit RÉSERVÉ, rien d'écrit en probable)
    const refus = async (nom, x, motif) => {
        const an = await analyseDe(x.j.scanId);
        H.v(`3. ${nom} : la question reste (change false), crédit RÉSERVÉ, aucun marqueur probable`, [x.mj && x.mj.change, await livre(x), an.cartes[0].probable ?? null, (await questionDe(x.j.scanId)).probable ?? false, an.complementMesures.ordreGroupe && an.complementMesures.ordreGroupe.probable], [false, RESERVE, null, false, `refus:${motif}`]);
    };
    const vieux = await (async () => { const x = await inst(); const r = await poster(sv.deux.url, x.jeton, corps({ ...requete(), versionExtension: '2.0.0' })); const j = r.json, c = j.complement; const m = await envoyer(sv.deux.url, x.jeton, { scanId: j.scanId, jeton: c.jeton, resultats: resultats(c.mesures), accepteProbable: true }); return { ...x, j, m, mj: m.json }; })();
    await refus('extension 2.0.0 (< 2.0.1)', vieux, 'version-extension');
    // I2 : P sans ligne de guide de prix
    const gP = await raw('guide_prix').findOne({ idProduct: A.ID_P }); await raw('guide_prix').deleteOne({ idProduct: A.ID_P });
    const sp = await jouer(sv.deux);
    await raw('guide_prix').insertOne(gP);
    await refus('I2 : P sans prix de guide servi', sp, 'sans-prix');
    // PROBABLE avait DÉJÀ désigné un candidat (autre que la tête) : G-GROUPE ne le remplace jamais
    {
        const x = await inst(); const r = await poster(sv.deux.url, x.jeton, corps(requete())); const j = r.json, c = j.complement;
        await raw('analyses').updateOne({ _id: new mongoose.Types.ObjectId(j.scanId) }, { $set: { 'cartes.0.probable': { idProduct: A.ID_A, signal: 'A' } } });
        const m = await envoyer(sv.deux.url, x.jeton, { scanId: j.scanId, jeton: c.jeton, resultats: resultats(c.mesures), accepteProbable: true });
        const an = await analyseDe(j.scanId);
        H.v('3. PROBABLE avait déjà désigné A : la tête P ne le remplace pas (change false, crédit RÉSERVÉ, le probable de PROBABLE est intact)', [m.json.change, await livre(x), an.cartes[0].probable, an.complementMesures.ordreGroupe.probable], [false, RESERVE, { idProduct: A.ID_A, signal: 'A' }, 'refus:deja-designe-ou-repondu']);
    }
    // la tête ne se détache pas : aucune tête, aucun probable
    const egal = await jouer(sv.deux, { res: ms => resultats(ms, 120, 120) });
    H.v('3. les zones ne séparent pas (120 contre 120) : pas de tête, la question reste, RÉSERVÉ', [egal.mj.change, await livre(egal), (await analyseDe(egal.j.scanId)).complementMesures.ordreGroupe.change], [false, RESERVE, false]);
    // I1 : le débit atomique échoue => le marqueur est retiré, la question reste réservée
    const argent = registre.obtenir('argent'); const vraie = argent.passerEnProbable; argent.passerEnProbable = async () => ({ ok: false });
    let echec; try { echec = await jouer(sv.deux); } finally { argent.passerEnProbable = vraie; }
    await refus('I1 : le passage en probable (débit atomique) refuse', echec, 'debit');
    // le cosinus : un seuil que le cosinus mesuré du désigné ne peut pas atteindre
    const svCos = await appFabrique(cfgDe({ V2_PROBABLE: '1', V2_G_GROUPE: '1', V2_PROBABLE_COSINUS_MIN: '1' }));
    const cosx = await jouer(svCos); await svCos.fermer();
    H.v('3. cosinus minimal 1 (le cosinus mesuré de P est sous 1) ou égal : si refusé, la question reste ; sinon c\'est un probable — le banc dit lequel', [cosx.mj.change, (await analyseDe(cosx.j.scanId)).complementMesures.ordreGroupe.probable], [false, 'refus:cosinus']);

    // ── TOUR 1, réserve 1 : LA LECTURE DE LA PHOTO peut REFUSER la tête (la garde de la promotion de G, une seule fonction)
    numeroLu = '002';
    const contredite = await jouer(sv.deux);
    numeroLu = '001';
    await refus('LECTURE : la tête aux zones gagnantes est CONTREDITE par le numéro lu (002 contre 001)', contredite, 'lecture');
    H.v('3. … et les zones étaient bien gagnantes (la tête était posée) : l\'ordre journalisé garde P, seule la lecture a refusé', [(await analyseDe(contredite.j.scanId)).complementMesures.ordreGroupe.tete], [A.ID_P]);

    // ── TOUR 1, réserve 2 : UN CLIENT DÉBITÉ VOIT TOUJOURS CE QU'IL A PAYÉ
    const argent2 = registre.obtenir('argent'); const routesMod = require('../identifier/routes');
    {
        const vraieF = routesMod.facturationDe; routesMod.facturationDe = () => { throw new Error('panne de facturation'); };
        let x; try { x = await jouer(sv.deux); } finally { routesMod.facturationDe = vraieF; }
        H.v('3. APRÈS le débit, la facturation lève : la carte probable est quand même servie avec la facturation du débit (debite 1), jamais change false sur un crédit débité', [x.mj.change, x.mj.carte && x.mj.carte.niveau, x.mj.facturation && x.mj.facturation.debite, await livre(x)], [true, 'probable', 1, PAYE]);
    }
    {
        const vraieS = argent2.solde; argent2.solde = async () => { throw new Error('panne du solde'); };
        let x; try { x = await jouer(sv.deux); } finally { argent2.solde = vraieS; }
        H.v('3. APRÈS le débit, la lecture du solde lève : la carte et la facturation sont servies, sans solde', [x.mj.change, x.mj.carte && x.mj.carte.niveau, x.mj.facturation.debite, 'solde' in x.mj, await livre(x)], [true, 'probable', 1, false, PAYE]);
    }
    {
        // le retrait du marqueur échoue APRÈS un débit refusé : la question reste (change false), le crédit RÉSERVÉ — jamais débité sans carte ; le marqueur résiduel est journalisé
        const vraieP = argent2.passerEnProbable; argent2.passerEnProbable = async () => ({ ok: false });
        const dbr = mongoose.connection.db, vraieCol = dbr.collection.bind(dbr);
        dbr.collection = nom => { const c = vraieCol(nom); return /analyses$/.test(nom) ? new Proxy(c, { get(t, p) { if (p === 'updateOne') return async (f, ...r) => { if (f && f['cartes.0.probable.signal']) throw new Error('retrait en échec'); return t.updateOne(f, ...r); }; const v2 = t[p]; return typeof v2 === 'function' ? v2.bind(t) : v2; } }) : c; };
        let x; try { x = await jouer(sv.deux); } finally { argent2.passerEnProbable = vraieP; dbr.collection = vraieCol; }
        H.v('3. le RETRAIT du marqueur échoue après un débit refusé : change false, crédit RÉSERVÉ (jamais débité sans carte)', [x.mj.change, await livre(x), (await questionDe(x.j.scanId)).probable ?? false], [false, RESERVE, false]);
    }

    // ── TOUR 1, réserve 3 : un probable n'est servi au second envoi QUE si le client le DÉCLARE (`accepteProbable: true`)
    for (const [nom, val] of [['absent', false], ['« true » en texte', 'true'], ['1', 1], ['« faux »', 'faux']]) {
        const x = await jouer(sv.deux, { accepte: val });
        const an = await analyseDe(x.j.scanId);
        H.v(`3. accepteProbable ${nom} : le comportement d'avant, octet pour octet comme la référence (question, change false), aucun débit, aucune carte probable`, [norm(x.mj) === norm(ref0.mj), await livre(x), an.cartes[0].probable ?? null, (await questionDe(x.j.scanId)).probable ?? false, an.complementMesures.ordreGroupe.tete], [true, RESERVE, null, false, A.ID_P]);
    }
    const accepte = await jouer(sv.deux, { accepte: true });
    H.v('3. accepteProbable true (avec la version >= 2.0.1) : le chemin actuel, un probable débité une fois', [accepte.mj.change, accepte.mj.carte.niveau, await livre(accepte)], [true, 'probable', PAYE]);

    // ── 4. le contrat d'ensemble
    H.v('4. toutes les réponses valident leur schéma', ecartsContrat, 0);

    crochet.apresReponse = origRep;
    for (const k of Object.keys(sv)) await sv[k].fermer();
    const monter = require('../identifier/monter'); monter.arreterBalayage(); monter.arreterPurge(); require('../argent/marque-scan').arreterRattrapage();
    A.etat.vider();
    await mongoose.disconnect();
    await H.arreterBanc();
    H.bilan();
})().catch(async e => { console.error('❌', e); try { await H.arreterBanc(); } catch (_) { } process.exit(1); });
