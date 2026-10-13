'use strict';
// Banc UN-CANDIDAT (D1, 2026-10-13) — la route et l'ARGENT : une question « est-ce cette carte ? » à UN candidat, du débit à la réponse.
// Base : la base EN MÉMOIRE du banc — jamais la production, ni la grappe, ni R2. Aucun réseau. La chaîne héritée est FABRIQUÉE (deps.gererIdentifier), l'argent est le vrai ledger.
// Règle écrite d'avance (ruling du coordinateur) : la question est RÉSERVÉE comme toute question ; OUI = débitée ; NON (`aucune`) = rendue, UNE fois ; abandon = rendu ;
// aucun double remboursement ; un lot suit la règle des questions de lot (répondre ne coûte ni ne rend rien).
const H = require('./_harnais');
const mongoose = require('mongoose');
const db = require('../db'); const M = require('../modeles'); const J = require('../comptes/jetons');
const { lireConfig } = require('../config'); const { valider } = require('../openapi/valider'); const SCHEMA = require('../openapi/openapi.v2.json');
const { choixPour } = require('../choix');
const path = require('path');
const CHARGES = path.join(__dirname, '..', '..', 'verrou', 'charges.json');
const IMAGE = require(CHARGES).charges.find(c => c.cellule === 'occidentale').imageUrl;
const ref = n => ({ $ref: `#/components/schemas/${n}` });
const cfg = lireConfig({ MONGODB_BASE: 'test_scratch', V2_HEBDO: '0' });
const ORIGINE = cfg.origines.extension;
let nIp = 0; const ip = () => { nIp++; return { 'x-forwarded-for': `10.12.${Math.floor(nIp / 250)}.${nIp % 250 + 1}` }; };
let nCle = 0; const cle = () => `banc-un-candidat-${Date.now().toString(36)}-${++nCle}`;
const raw = n => mongoose.connection.db.collection(n);
const VB = require('./_visuels-banc'); const VIS = [];
const ID_A = 895801, ID_B = 895802, ID_C = 895803, ID_D = 895804, ID_X = 777777777, EXP = 990011;
let ecartsContrat = 0, reponsesValidees = 0;

async function inst(essais = 3, o = {}) {
    const jeton = J.genererJeton(); const i = Object.assign(M.nouvelleInstallation({ jetonEmpreinte: J.empreinte(jeton), essais, libelle: 'banc' }), o);
    await db.col('installations').insertOne(i); return { i, jeton };
}
async function compteAdmin() {
    const c = Object.assign(M.nouveauCompte({ email: `uc${++nCle}@x.fr`, emailCle: `uc${nCle}@x.fr`, motDePasse: {} }), { verifie: true, role: 'administrateur', solde: { accueil: 25, achete: 0 } });
    await db.col('comptes').insertOne(c);
    const jeton = J.genererJeton(); const i = Object.assign(M.nouvelleInstallation({ jetonEmpreinte: J.empreinte(jeton), essais: 0, libelle: 'banc' }), { compteId: c._id });
    await db.col('installations').insertOne(i); return { i, c, jeton };
}
const corps = (o = {}) => ({ contrat: 2, imageUrls: [IMAGE], title: null, description: null, prixVinted: null, devise: null, marche: 'vinted.fr', versionExtension: '2.0.0', langueInterface: 'fr', ...o });
const entetes = (jeton, plus = {}) => ({ origin: ORIGINE, ...ip(), authorization: `Bearer ${jeton}`, ...plus });
async function poster(url, jeton) {
    const r = await H.appel(url, '/api/identifier', { methode: 'POST', corps: corps(), entetes: entetes(jeton, { 'idempotency-key': cle() }) });
    if (r.json && r.json.success === true && r.json.contrat === 2) { reponsesValidees++; const v = valider(r.json, ref('ReponseAnalyse'), SCHEMA); if (!v.ok) { ecartsContrat++; console.log(`   écart de contrat : ${v.erreurs.slice(0, 3).map(e => `${e.chemin} ${e.message}`).join(' ; ')}`); } }
    return r;
}
async function repondre(url, jeton, b) {
    const r = await H.appel(url, '/api/identifier/reponse', { methode: 'POST', corps: b, entetes: entetes(jeton) });
    if (r.json && r.json.success === true) { reponsesValidees++; const v = valider(r.json, ref('ReponseQuestion'), SCHEMA); if (!v.ok) { ecartsContrat++; console.log(`   écart de contrat : ${v.erreurs.slice(0, 3).map(e => `${e.chemin} ${e.message}`).join(' ; ')}`); } }
    return r;
}
// l'ÉTAT D'ARGENT d'un porteur : le solde, la somme nette des mouvements, les débits encore ouverts, le nombre de remboursements (le grand livre)
async function livre(x) {
    const mv = await raw('mouvements').find({ installationId: x.i._id }).toArray();
    const ins = await raw('installations').findOne({ _id: x.i._id });
    return { essais: ins.essais, net: mv.reduce((s, m) => s + m.delta, 0), mouvements: mv.length, ouverts: mv.filter(m => m.type === 'debit' && m.etat !== 'rembourse').map(m => m.etat), remboursements: mv.filter(m => m.type === 'remboursement').length };
}
const compteurDe = async (x, type) => (await raw('plafonds').findOne({ porteur: `installation:${x.i._id}`, type }) || {}).count ?? 0;
const ligneQ = async scanId => raw('questions_v2').findOne({ _id: `${scanId}:0` });

(async () => {
    await H.ouvrirBancV2();
    process.env.MONGODB_BASE = 'test_scratch';
    const { connecterMongo } = require('../../mongo-connexion');
    await connecterMongo({ script: 'test-un-candidat-route.js', ecrit: true });
    db.brancher(mongoose.connection.db);
    await M.creerIndex();
    for (const c of ['catalogue_produits', 'numeros_cartes', 'guide_prix', 'codes_set']) await raw(c).deleteMany({});
    await raw('codes_set').insertOne({ idExpansion: EXP, codeSet: 'PBL', apprisLe: new Date() });
    for (const id of [ID_A, ID_B, ID_C, ID_D]) {
        await raw('catalogue_produits').insertOne({ idProduct: id, name: 'Tropius (PBL 001)', idExpansion: EXP, idMetacard: 990111 });
        await raw('numeros_cartes').insertOne({ idProduct: id, idExpansion: EXP, numero: '001', numeroUrl: 'PBL001', codeSet: 'PBL', nomFr: 'Tropius', slug: 'Tropius-PBL001', slugSet: 'Banc-Set', source: 'cardmarket', certitude: 'exacte' });
        await raw('guide_prix').insertOne({ idProduct: id, avg: 1.1, low: 0.5, trend: 1.0, avg1: 1.0, avg7: 1.0, avg30: 1.1, guideDu: new Date('2026-10-04') });
        VIS.push(VB.doc(id, { variante: 'normale', idMetacard: 990111 }));
    }
    VB.installer(VIS);

    const express = require('express'); const pret = require('../pret'); const registre = require('../registre');
    const { dansUnScan } = require('../../sources'); const { assembler } = require('../index');
    let mode = null, lotImpl = null;
    const ETAT = { estimeIA: null, confianceIA: null, defautsVus: [], declareVendeur: null, declareCardmarket: null, retenu: null };
    const cand = id => ({ idProduct: id, nom: 'Tropius', numero: '001', set: 'Banc Set', prix: 1, photoUrl: null });
    const carteCorps = (id, ambigu) => ({ idProduct: id, nomProduit: 'Tropius', nom: 'Tropius', numero: '001', total: '064', setCode: 'PBL', rarete: null, langue: 'FR', ambigu });
    const qst = ids => ({ success: true, question: { etat: 'en-attente', delaiHeures: 24 }, carte: carteCorps(ids[0], true), etat: ETAT, candidats: ids.map(cand), classement: [], guidePrix: {}, reverse: { attendue: false, motif: null, etat: 'aucun-motif', strategie: null }, codeLangue: 2 });
    const chaine = async (req, res) => {
        const scanId = String(req.scanIdImpose);
        if (mode === 'ambigue-seul' || mode === 'ambigue-seul-absent' || mode === 'ambigue-zero') {       // le chemin ambigu de la chaîne : elle POSE la question (réserve le crédit)
            const ids = mode === 'ambigue-seul' ? [ID_A] : mode === 'ambigue-seul-absent' ? [ID_X] : [];
            await req.credit.v2.poserQuestion(req, { scanId: req.scanIdImpose, raison: 'egalite-sans-enjeu', candidats: ids });
            return res.json({ ...qst(ids.length ? ids : [ID_A]), candidats: ids.map(cand), scanId });
        }
        if (mode === 'refus-egalite-seul' || mode === 'sans-repli') {                // le chemin REFUS : elle tente de rembourser, puis rend 1 candidat
            const motif = mode === 'sans-repli' ? 'nom-contredit-sans-repli' : 'egalite-parfaite';
            await req.credit.v2.rembourser(req, motif);
            return res.json({ success: false, natureRefus: 'refus-delibere', motifRefus: motif, candidats: [{ idProduct: ID_A }] });
        }
        throw new Error(`mode inconnu ${mode}`);
    };
    const monter = async (deps = {}, cfgApp = cfg) => {
        const app = express(); app.set('trust proxy', true); app.use(express.json()); app.use((q, s, n) => dansUnScan(n));
        pret.armer(require('../modeles').verifierIndex);
        app.use(assembler([require('../argent/monter'), require('../identifier/monter')], cfgApp, { jumeaux: () => ({ conclu: true, ids: [] }), gererIdentifier: chaine, gererRetourLive: async (q, s) => s.json({ success: true }), ...deps }));
        return H.serveur(app);
    };
    const argentReg = () => registre.obtenir('argent');
    const sv = await monter();
    const scan = async (m, essais = 3, s = sv) => { mode = m; const x = await inst(essais); const r = await poster(s.url, x.jeton); const j = r.json || {}; return { ...x, r, j, scanId: j.scanId, c0: j.analyse && j.analyse.cartes[0] }; };

    // ── 1. LE SCAN : une question à un choix, le crédit RÉSERVÉ
    const s1 = await scan('ambigue-seul');
    H.v('1. un candidat sans jumeau : 200, a-trancher, UN candidat, question `confirmation` à un choix `a`',
        [s1.r.statut, s1.j.analyse.statut, s1.c0.statut, s1.c0.candidats.map(c => c.idProduct), s1.c0.question.code, s1.c0.question.choix.map(c => [c.id, c.idProduct])], [200, 'a-trancher', 'a-trancher', [ID_A], 'confirmation', [['a', ID_A]]]);
    H.v('   facturation RÉSERVÉE { debite:0, reserve:1, rembourse:false, motif:question }, solde.essai 3 -> 2',
        [s1.j.facturation, s1.j.solde.essai], [{ debite: 0, reserve: 1, rembourse: false, motif: 'question', raisonNonRembourse: null }, 2]);
    const q1 = await ligneQ(s1.scanId);
    H.v('   la question est écrite en attente, avec les choix du contrat (choixPour), le crédit réservé', [q1 && q1.etat, q1 && q1.choix, q1 && q1.lot], ['en-attente', choixPour([ID_A]), false]);
    H.v('   grand livre après le scan : essai 2, net -1, un débit « reserve », aucun remboursement', await livre(s1), { essais: 2, net: -1, mouvements: 1, ouverts: ['reserve'], remboursements: 0 });

    // ── 2. OUI : facturée comme une question répondue, UNE fois
    {
        const k = await repondre(sv.url, s1.jeton, { scanId: s1.scanId, carte: 0, choix: 'a' }), j = k.json || {};
        H.v('2. OUI (a) : 200, carte identifiee désignant le candidat, facturation { debite:1, reserve:0, rembourse:false, motif:question }',
            [k.statut, j.carte && j.carte.statut, j.carte && j.carte.carte && j.carte.carte.idProduct, j.facturation], [200, 'identifiee', ID_A, { debite: 1, reserve: 0, rembourse: false, motif: 'question', raisonNonRembourse: null }]);
        H.v('   grand livre : essai 2, net -1, un débit « debite », aucun remboursement', await livre(s1), { essais: 2, net: -1, mouvements: 1, ouverts: ['debite'], remboursements: 0 });
        const k2 = await repondre(sv.url, s1.jeton, { scanId: s1.scanId, carte: 0, choix: 'a' });
        H.v('   rejeu de OUI : même corps, rien de plus (net -1, un seul mouvement)', [k2.texte === k.texte, (await livre(s1)).net, (await livre(s1)).mouvements], [true, -1, 1]);
        const k3 = await repondre(sv.url, s1.jeton, { scanId: s1.scanId, carte: 0, choix: 'aucune' });
        H.v('   NON après OUI : 409 CONFLIT, rien ne bouge (net -1, aucun remboursement)', [k3.statut, k3.json && k3.json.erreur && k3.json.erreur.code, (await livre(s1)).net, (await livre(s1)).remboursements], [409, 'CONFLIT', -1, 0]);
    }
    // ── 3. NON (`aucune`) : rembourse, UNE seule fois
    const s3 = await scan('ambigue-seul');
    {
        const k = await repondre(sv.url, s3.jeton, { scanId: s3.scanId, carte: 0, choix: 'aucune' }), j = k.json || {};
        H.v('3. NON (aucune) : 200, carte introuvable / hors-catalogue, facturation { debite:0, rembourse:true, motif:question }, solde.essai 3',
            [k.statut, j.carte && j.carte.statut, j.carte && j.carte.raison, j.facturation && j.facturation.debite, j.facturation && j.facturation.rembourse, j.facturation && j.facturation.motif, j.solde && j.solde.essai], [200, 'introuvable', 'hors-catalogue', 0, true, 'question', 3]);
        H.v('   grand livre : essai 3, net 0, EXACTEMENT un remboursement', await livre(s3), { essais: 3, net: 0, mouvements: 2, ouverts: [], remboursements: 1 });
        const k2 = await repondre(sv.url, s3.jeton, { scanId: s3.scanId, carte: 0, choix: 'aucune' });
        H.v('   rejeu de NON : même corps, toujours UN remboursement (pas de double remboursement)', [k2.texte === k.texte, (await livre(s3)).remboursements, (await livre(s3)).net], [true, 1, 0]);
        const k3 = await repondre(sv.url, s3.jeton, { scanId: s3.scanId, carte: 0, choix: 'a' });
        H.v('   OUI après NON : 409 CONFLIT, rien ne bouge', [k3.statut, (await livre(s3)).net, (await livre(s3)).remboursements], [409, 0, 1]);
    }
    // ── 4. CONCURRENCE : six réponses en même temps (3 OUI, 3 NON) => un seul gagnant, l'argent est celui du gagnant
    {
        const s = await scan('ambigue-seul');
        const rs = await Promise.all(['a', 'aucune', 'a', 'aucune', 'a', 'aucune'].map(choix => repondre(sv.url, s.jeton, { scanId: s.scanId, carte: 0, choix })));
        const l = await livre(s), gagnant = (await ligneQ(s.scanId)).reponse.choix;
        H.v('4. six réponses simultanées : seulement des 200 (le gagnant, rejoué) et des 409 (l\'autre réponse)', rs.map(r => r.statut).filter(x => x !== 200 && x !== 409), []);
        H.vrai(`   l'argent est celui du gagnant « ${gagnant} » : OUI => net -1 sans remboursement ; NON => net 0 avec UN remboursement (livre : ${JSON.stringify(l)})`,
            gagnant === 'a' ? (l.net === -1 && l.remboursements === 0) : (l.net === 0 && l.remboursements === 1));
    }
    // ── 5. ABANDON : `ne-sait-pas` rend le crédit, la carte reste à trancher (même candidat)
    {
        const s = await scan('ambigue-seul'); const k = await repondre(sv.url, s.jeton, { scanId: s.scanId, choix: 'ne-sait-pas' }), j = k.json || {};
        H.v('5. ne-sait-pas : 200, la carte reste a-trancher avec le MÊME candidat et sa question, crédit rendu',
            [k.statut, j.carte && j.carte.statut, j.carte && j.carte.candidats.map(c => c.idProduct), j.carte && j.carte.question && j.carte.question.code, j.facturation && j.facturation.rembourse, j.facturation && j.facturation.debite], [200, 'a-trancher', [ID_A], 'confirmation', true, 0]);
        H.v('   grand livre : essai 3, net 0, un remboursement', await livre(s), { essais: 3, net: 0, mouvements: 2, ouverts: [], remboursements: 1 });
        const k2 = await repondre(sv.url, s.jeton, { scanId: s.scanId, choix: 'ne-sait-pas' });
        H.v('   rejeu : même corps, toujours un seul remboursement', [k2.texte === k.texte, (await livre(s)).remboursements], [true, 1]);
    }
    // ── 6. SANS RÉPONSE SOUS 24 h : le balayage rend le crédit une fois ; une réponse tardive est expirée (410) et ne rend rien de plus
    {
        const s = await scan('ambigue-seul');
        const bilan = await argentReg().balayerQuestions({ maintenant: new Date(Date.now() + 25 * 3600e3), max: 500 });
        H.vrai(`6. le balayage à +25 h règle la question (bilan : ${JSON.stringify({ reglees: bilan.reglees, remboursees: bilan.remboursees })})`, bilan.reglees >= 1 && bilan.remboursees >= 1);
        H.v('   grand livre : essai 3, net 0, un remboursement', await livre(s), { essais: 3, net: 0, mouvements: 2, ouverts: [], remboursements: 1 });
        const bilan2 = await argentReg().balayerQuestions({ maintenant: new Date(Date.now() + 26 * 3600e3), max: 500 });
        H.v('   un second balayage ne rend rien de plus', [bilan2.reglees, (await livre(s)).remboursements, (await livre(s)).net], [0, 1, 0]);
        const k = await repondre(sv.url, s.jeton, { scanId: s.scanId, carte: 0, choix: 'a' });
        H.v('   OUI tardif : refusé (la question est réglée), aucun débit de plus (net 0)', [k.statut >= 400, (await livre(s)).net, (await livre(s)).remboursements], [true, 0, 1]);
    }
    // ── 7. LE PLAFOND (règle existante d'une question répondue « aucune ») : 30 par jour ; plein, le NON ne rend rien et le dit
    {
        const s = await scan('ambigue-seul');
        await raw('plafonds').insertOne({ porteur: `installation:${s.i._id}`, jour: new Date().toISOString().slice(0, 10), type: 'question', count: cfg.plafonds.question, expireLe: new Date(Date.now() + 3 * 86400e3) });
        const k = await repondre(sv.url, s.jeton, { scanId: s.scanId, choix: 'aucune' }), j = k.json || {};
        H.v('7. compteur des abandons de questions PLEIN : NON répond 200 mais ne rend rien, et le dit { debite:1, rembourse:false, raisonNonRembourse:plafond-jour }',
            [k.statut, j.facturation && j.facturation.debite, j.facturation && j.facturation.rembourse, j.facturation && j.facturation.raisonNonRembourse, (await livre(s)).essais, await compteurDe(s, 'question')], [200, 1, false, 'plafond-jour', 2, cfg.plafonds.question]);
        // pour mémoire : avant D1 ce scan était un introuvable remboursé sous le plafond de PANNES (5/jour) — jamais plus généreux que les 30 d'ici
        H.vrai(`   (mémoire) plafond des questions ${cfg.plafonds.question} >= plafond des pannes ${cfg.plafonds.panne} : un NON n'est jamais moins bien rendu qu'un introuvable d'avant`, cfg.plafonds.question >= cfg.plafonds.panne);
    }
    // ── 8. LE REFUS PAR ÉGALITÉ à UN candidat : MÊME argent que l'ambiguë à un candidat, à chaque étape
    {
        const A = s1, R = await scan('refus-egalite-seul');
        H.v('8. refus egalite-parfaite à 1 candidat : a-trancher, 1 candidat, confirmation, facturation de l\'ambiguë { debite:0, reserve:1 }',
            [R.c0.statut, R.c0.candidats.map(c => c.idProduct), R.c0.question.code, R.j.facturation], [ 'a-trancher', [ID_A], 'confirmation', { debite: 0, reserve: 1, rembourse: false, motif: 'question', raisonNonRembourse: null }]);
        H.v('   grand livre après le scan : identique à celui de l\'ambiguë (essai 2, net -1, un débit réservé)', await livre(R), { essais: 2, net: -1, mouvements: 1, ouverts: ['reserve'], remboursements: 0 });
        H.vrai('   (le grand livre de l\'ambiguë, lu avant sa réponse, avait cette même forme : voir 1.)', A !== null);
        const rep = await repondre(sv.url, R.jeton, { scanId: R.scanId, choix: 'aucune' });
        H.v('   NON : introuvable, crédit rendu une fois (essai 3, net 0, un remboursement)', [rep.json.carte.statut, await livre(R)], ['introuvable', { essais: 3, net: 0, mouvements: 2, ouverts: [], remboursements: 1 }]);
        const R2 = await scan('refus-egalite-seul'); await repondre(sv.url, R2.jeton, { scanId: R2.scanId, choix: 'a' });
        H.v('   OUI : débitée une fois (essai 2, net -1, un débit « debite »)', await livre(R2), { essais: 2, net: -1, mouvements: 1, ouverts: ['debite'], remboursements: 0 });
    }
    // ── 9. LA GARDE DES JUMEAUX est consultée AVANT la question
    {
        const svJ1 = await monter({ jumeaux: id => ({ conclu: true, ids: id === ID_A ? [ID_B] : [] }) });
        const a = await scan('ambigue-seul', 3, svJ1);
        H.v('9a. un jumeau : question de DÉPARTAGE à 2 (A et B), pas une confirmation ; réservée', [a.c0.candidats.map(c => c.idProduct), a.c0.question.code !== 'confirmation', a.j.facturation.reserve, (await ligneQ(a.scanId)).choix], [[ID_A, ID_B], true, 1, choixPour([ID_A, ID_B])]);
        const k = await repondre(svJ1.url, a.jeton, { scanId: a.scanId, choix: 'aucune' });
        H.v('   NON sur la question de départage : rendu une fois (essai 3)', [k.json.carte.statut, await livre(a)], ['introuvable', { essais: 3, net: 0, mouvements: 2, ouverts: [], remboursements: 1 }]);
        await svJ1.fermer();
        const svJ3 = await monter({ jumeaux: id => ({ conclu: true, ids: id === ID_A ? [ID_B, ID_C, ID_D] : [] }) });
        const b = await scan('ambigue-seul', 3, svJ3);
        H.v('9b. trois jumeaux (4 produits) : introuvable impression-indeterminee, REMBOURSÉ (compteur dédié jumeaux), aucune question en attente',
            [b.j.analyse.statut, b.c0.raison, b.j.facturation.rembourse, (await livre(b)).essais, await compteurDe(b, 'jumeaux'), await raw('questions_v2').countDocuments({ 'porteur.id': b.i._id, etat: 'en-attente' })], ['introuvable', 'impression-indeterminee', true, 3, 1, 0]);
        H.v('   le motif interne jumeaux-trop-nombreux est écrit dans analyses, jamais servi', [(await raw('analyses').findOne({ _id: new mongoose.Types.ObjectId(b.scanId) })).motifJumeaux, JSON.stringify(b.j).includes('jumeaux-')], ['jumeaux-trop-nombreux', false]);
        await svJ3.fermer();
        const svP = await monter({ jumeaux: () => ({ conclu: false, ids: [], motif: 'jumeaux-perimes' }) });
        const c = await scan('ambigue-seul', 3, svP);
        H.v('9c. la garde ne conclut pas : 503 INDISPONIBLE (jamais une question ni une affirmation), remboursé, la question que la chaîne avait posée est ANNULÉE',
            [c.r.statut, c.j.erreur && c.j.erreur.code, c.j.analyse, c.j.facturation && c.j.facturation.rembourse, await livre(c), await raw('questions_v2').countDocuments({ 'porteur.id': c.i._id, etat: 'en-attente' })],
            [503, 'INDISPONIBLE', undefined, true, { essais: 3, net: 0, mouvements: 2, ouverts: [], remboursements: 1 }, 0]);
        await svP.fermer();
    }
    // ── 10. LES CAS QUI RESTENT UN INTROUVABLE / UNE PANNE : rendus, jamais une question
    {
        const sr = await scan('sans-repli');
        H.v('10a. nom-contredit-sans-repli (même à 1 candidat) : introuvable photo-illisible, remboursé, aucune question', [sr.c0.statut, sr.c0.raison, sr.j.facturation.rembourse, await livre(sr), await ligneQ(sr.scanId)], ['introuvable', 'photo-illisible', true, { essais: 3, net: 0, mouvements: 2, ouverts: [], remboursements: 1 }, null]);
        const z = await scan('ambigue-zero');
        H.v('10b. aucun candidat : introuvable photo-illisible, remboursé, la question de la chaîne annulée', [z.c0.statut, z.c0.raison, z.j.facturation.rembourse, await livre(z), await raw('questions_v2').countDocuments({ 'porteur.id': z.i._id, etat: 'en-attente' })], ['introuvable', 'photo-illisible', true, { essais: 3, net: 0, mouvements: 2, ouverts: [], remboursements: 1 }, 0]);
        const ab = await scan('ambigue-seul-absent');
        H.v('10c. le candidat n\'est pas au catalogue de l\'API : 500 SERVEUR (on n\'invente pas), remboursé, la question annulée', [ab.r.statut, ab.j.erreur && ab.j.erreur.code, ab.j.facturation && ab.j.facturation.rembourse, await livre(ab), await raw('questions_v2').countDocuments({ 'porteur.id': ab.i._id, etat: 'en-attente' })], [500, 'SERVEUR', true, { essais: 3, net: 0, mouvements: 2, ouverts: [], remboursements: 1 }, 0]);
    }
    // ── 11. ADMINISTRATEUR : rien débité, rien réservé ; OUI, NON, ne-sait-pas répondent sans erreur
    {
        mode = 'ambigue-seul'; const adm = await compteAdmin();
        const r = await poster(sv.url, adm.jeton), j = r.json || {};
        H.v('11. administrateur : a-trancher à 1 candidat, motif administrateur, aucune ligne de question', [j.analyse && j.analyse.cartes[0].question.code, j.facturation && j.facturation.motif, j.facturation && j.facturation.debite, j.facturation && j.facturation.reserve, await ligneQ(j.scanId)], ['confirmation', 'administrateur', 0, 0, null]);
        const oui = await repondre(sv.url, adm.jeton, { scanId: j.scanId, choix: 'a' });
        H.v('   OUI : identifiee, rien débité', [oui.statut, oui.json.carte.statut, oui.json.carte.carte.idProduct, oui.json.facturation.motif, (await raw('comptes').findOne({ _id: adm.c._id })).solde.accueil], [200, 'identifiee', ID_A, 'administrateur', 25]);
        const r2 = await poster(sv.url, adm.jeton), j2 = r2.json || {};
        const non = await repondre(sv.url, adm.jeton, { scanId: j2.scanId, choix: 'aucune' });
        H.v('   NON : introuvable, rien débité ni rendu', [non.statut, non.json.carte.statut, (await raw('comptes').findOne({ _id: adm.c._id })).solde.accueil], [200, 'introuvable', 25]);
        const r3 = await poster(sv.url, adm.jeton), j3 = r3.json || {};
        const ns = await repondre(sv.url, adm.jeton, { scanId: j3.scanId, choix: 'ne-sait-pas' });
        H.v('   ne-sait-pas : la carte reste à trancher (un candidat), aucune erreur', [ns.statut, ns.json.carte && ns.json.carte.statut, ns.json.carte && ns.json.carte.candidats.length], [200, 'a-trancher', 1]);
    }
    // ── 12. UN LOT : une carte à candidat unique est une question de lot (répondre ne coûte ni ne rend rien)
    {
        const lot = [qst([ID_A]), qst([ID_B])].map(c => ({ statutHttp: 200, corps: c }));
        const svL = await monter({ identifierLot: async () => lot });
        const x = await inst(3); const r = await poster(svL.url, x.jeton), j = r.json || {}, a = j.analyse || {};
        H.v('12. lot de 2 cartes à candidat unique : analyse lot, 2 cartes à trancher (confirmation), 1 crédit (ceil(2/10)), lot { aTrancher:2 }',
            [a.statut, (a.cartes || []).map(c => c.statut).sort(), (a.cartes || []).map(c => c.question.code), j.facturation && j.facturation.debite, a.lot && a.lot.aTrancher, a.lot && a.lot.introuvables], ['lot', ['a-trancher', 'a-trancher'], ['confirmation', 'confirmation'], 1, 2, 0]);
        H.v('   deux questions de lot écrites en attente (lot:true), aucune réservation de mouvement (un débit « debite »), essai 2', [await raw('questions_v2').countDocuments({ scanId: new mongoose.Types.ObjectId(j.scanId), lot: true, etat: 'en-attente' }), await livre(x)], [2, { essais: 2, net: -1, mouvements: 1, ouverts: ['debite'], remboursements: 0 }]);
        const i0 = a.cartes.findIndex(c => c.candidats[0].idProduct === ID_A), i1 = a.cartes.findIndex(c => c.candidats[0].idProduct === ID_B);
        const oui = await repondre(svL.url, x.jeton, { scanId: j.scanId, carte: a.cartes[i0].index, choix: 'a' });
        const non = await repondre(svL.url, x.jeton, { scanId: j.scanId, carte: a.cartes[i1].index, choix: 'aucune' });
        H.v('   OUI sur une carte, NON sur l\'autre : identifiee / introuvable, et le grand livre ne bouge PAS (le lot a été payé d\'un bloc : net -1, aucun remboursement)',
            [oui.json.carte.statut, non.json.carte.statut, await livre(x)], ['identifiee', 'introuvable', { essais: 2, net: -1, mouvements: 1, ouverts: ['debite'], remboursements: 0 }]);
        await svL.fermer();
        // un « lot » d'UN résultat n'est pas un lot : la branche une-carte, avec le même argent que 1.-3.
        const svU = await monter({ identifierLot: async () => [{ statutHttp: 200, corps: qst([ID_A]) }] });
        const y = await inst(3); const ru = await poster(svU.url, y.jeton), ju = ru.json || {};
        H.v('   lot d\'UN seul résultat (candidat unique) : une carte à trancher réservée comme 1. (essai 2, net -1, un débit réservé)', [ju.analyse.statut, ju.analyse.cartes[0].question.code, await livre(y)], ['a-trancher', 'confirmation', { essais: 2, net: -1, mouvements: 1, ouverts: ['reserve'], remboursements: 0 }]);
        const nu = await repondre(svU.url, y.jeton, { scanId: ju.scanId, choix: 'aucune' });
        H.v('   NON : rendu une fois (essai 3, net 0)', [nu.json.carte.statut, await livre(y)], ['introuvable', { essais: 3, net: 0, mouvements: 2, ouverts: [], remboursements: 1 }]);
        await svU.fermer();
    }
    // ── 13. TOUR 1 : un lot est rendu UNE fois quand CHACUNE de ses cartes est un introuvable ou une confirmation non confirmée (NON / abandon). Le client ne paie jamais plus qu'avant.
    {
        const intro = () => ({ statutHttp: 200, corps: { success: false, natureRefus: 'refus-delibere', motifRefus: 'aucun-prix' } });
        const conf = id => ({ statutHttp: 200, corps: qst([id]) });
        const deux = () => ({ statutHttp: 200, corps: qst([ID_A, ID_B]) });
        const affirmee = id => ({ statutHttp: 200, corps: { success: true, question: null, carte: carteCorps(id, false), etat: ETAT, candidats: [cand(id)], classement: [], guidePrix: {}, reverse: { attendue: false, motif: null, etat: 'aucun-motif', strategie: null }, codeLangue: 2 } });
        let liste = [];
        const svL = await monter({ identifierLot: async () => liste });
        const lanceLot = async (l) => { liste = l; const x = await inst(3); const r = await poster(svL.url, x.jeton), j = r.json || {}; return { ...x, j, cartes: (j.analyse && j.analyse.cartes) || [] }; };
        const carteDe = (L, id) => L.cartes.find(c => c.candidats.length && c.candidats[0].idProduct === id);
        const non = (L, id) => repondre(svL.url, L.jeton, { scanId: L.j.scanId, carte: carteDe(L, id).index, choix: 'aucune' });
        const oui = (L, id) => repondre(svL.url, L.jeton, { scanId: L.j.scanId, carte: carteDe(L, id).index, choix: 'a' });
        const RENDU = { essais: 3, net: 0, mouvements: 2, ouverts: [], remboursements: 1 }, PAYE = { essais: 2, net: -1, mouvements: 1, ouverts: ['debite'], remboursements: 0 };
        // le coût d'AVANT (62111b4a) : un candidat unique était un introuvable ; la règle des lots (inchangée) rend un lot sans carte identifiée ni à trancher
        const coutAvant = types => (types.some(t => t === 'affirmee' || t === 'deux') ? 1 : 0);
        const coutApres = async L => -(await livre(L)).net;
        const cas = [];                                                  // la comparaison, imprimée
        const noter = (nom, types, apres, avecOui) => { const avant = coutAvant(types); cas.push({ nom, avant, apres, avecOui }); H.vrai(`   coût du client : avant ${avant}, après ${apres}${avecOui ? ' (une confirmation OUI : une carte reconnue, le lot est payé — décision du coordinateur)' : ''}`, avecOui ? apres >= avant : apres <= avant); };
        const balayer = () => argentReg().balayerQuestions({ maintenant: new Date(Date.now() + 25 * 3600e3), max: 500 });

        const a = await lanceLot([conf(ID_A), conf(ID_B), conf(ID_C)]);
        H.v('13a. lot de 3 confirmations : payé à l\'émission (net -1, un débit)', await livre(a), PAYE);
        await non(a, ID_A); const apresUn = await livre(a); await non(a, ID_B); const apresDeux = await livre(a);
        H.v('   après 1 NON puis 2 NON : rien n\'est rendu (carte par carte, un NON ne rend toujours rien)', [apresUn, apresDeux], [PAYE, PAYE]);
        const r3 = await non(a, ID_C);
        H.v('   3e NON (la dernière confirmation) : le LOT est rendu, UNE fois (essai 3, net 0, 1 remboursement) ; la réponse le dit', [await livre(a), r3.json.facturation && r3.json.facturation.rembourse], [RENDU, true]);
        const rr = await non(a, ID_C); await non(a, ID_A);
        H.v('   rejeu d\'un NON : rien de plus (toujours 1 remboursement, net 0)', [rr.statut, await livre(a)], [200, RENDU]);
        noter('3 confirmations, 3 NON', ['conf', 'conf', 'conf'], await coutApres(a), false);
        await balayer();
        H.v('   un balayage ultérieur ne rend rien de plus', (await livre(a)).remboursements, 1);

        const b = await lanceLot([conf(ID_A), conf(ID_B), conf(ID_C)]);
        await non(b, ID_A); await non(b, ID_B);
        H.v('13b. deux NON, la 3e confirmation encore en attente : payé', await livre(b), PAYE);
        await balayer();
        H.v('   le balayage à +25 h abandonne la 3e : lot rendu UNE fois', await livre(b), RENDU);
        noter('2 NON + 1 abandon', ['conf', 'conf', 'conf'], await coutApres(b), false);

        const c = await lanceLot([conf(ID_A), conf(ID_B), conf(ID_C)]);
        await non(c, ID_A); await non(c, ID_B); await oui(c, ID_C);
        H.v('13c. deux NON et un OUI : le lot n\'est PAS rendu', await livre(c), PAYE);
        await balayer();
        H.v('   (le balayage ne change rien : toutes les questions sont réglées)', await livre(c), PAYE);
        noter('2 NON + 1 OUI', ['conf', 'conf', 'conf'], await coutApres(c), true);

        const d = await lanceLot([intro(), conf(ID_A), conf(ID_B)]);
        await non(d, ID_A);
        H.v('13d. 1 introuvable + 2 confirmations, un NON : pas encore rendu', await livre(d), PAYE);
        await non(d, ID_B);
        H.v('   le 2e NON : lot rendu UNE fois', await livre(d), RENDU);
        noter('1 introuvable + 2 NON', ['intro', 'conf', 'conf'], await coutApres(d), false);

        const e = await lanceLot([conf(ID_A), conf(ID_B), deux()]);
        const q2 = e.cartes.find(c2 => c2.candidats.length === 2);
        await non(e, ID_A); await non(e, ID_B);
        await repondre(svL.url, e.jeton, { scanId: e.j.scanId, carte: q2.index, choix: 'aucune' });
        H.v('13e. 2 confirmations NON + une question à 2 candidats répondue NON : le lot n\'est PAS rendu', await livre(e), PAYE);
        await balayer();
        H.v('   ni après le balayage', await livre(e), PAYE);
        noter('2 confirmations + 1 question à 2', ['conf', 'conf', 'deux'], await coutApres(e), false);

        const f = await lanceLot([affirmee(ID_D), conf(ID_A)]);
        await non(f, ID_A);
        H.v('13f. 1 carte affirmée + 1 confirmation NON : le lot n\'est PAS rendu', await livre(f), PAYE);
        noter('1 affirmée + 1 NON', ['affirmee', 'conf'], await coutApres(f), false);

        const g = await lanceLot([conf(ID_A), conf(ID_B), conf(ID_C)]);
        await non(g, ID_A);
        await Promise.all([non(g, ID_B), non(g, ID_C)]);
        H.v('13g. deux NON simultanés sur les deux dernières : UN seul remboursement du lot (net 0)', await livre(g), RENDU);
        noter('NON simultanés', ['conf', 'conf', 'conf'], await coutApres(g), false);
        const lots = []; for (let k = 0; k < 4; k++) lots.push(await lanceLot([conf(ID_A), conf(ID_B)]));
        await Promise.all(lots.flatMap(L => [non(L, ID_A), non(L, ID_B)]));
        H.v('13h. 4 lots de 2 confirmations, NON simultanés dans chacun : chaque lot rendu exactement UNE fois', await Promise.all(lots.map(async L => (await livre(L)).remboursements)), [1, 1, 1, 1]);

        console.log('   comparaison coût du client (crédits) — avant 62111b4a / après :');
        for (const k of cas) console.log(`     ${k.nom.padEnd(36)} avant ${k.avant}   après ${k.apres}`);
        H.vrai(`   ${cas.length} cas comparés ; le seul surcoût est celui d'une confirmation OUI`, cas.every(k => k.apres <= k.avant || k.avecOui));
        await svL.fermer();
    }
    // ── 14. TOUR 2 : un remboursement de lot qui échoue n'est jamais perdu ; le plafond du lot parle ; le rejeu redit le résultat
    {
        const { reconcilier } = require('../argent/reconcilier');
        const conf = id => ({ statutHttp: 200, corps: qst([id]) });
        let liste = [];
        const svT = await monter({ identifierLot: async () => liste });
        const lance = async (ids, x0) => { liste = ids.map(conf); const x = x0 || await inst(20); const r = await poster(svT.url, x.jeton), j = r.json || {}; return { ...x, j, cartes: (j.analyse && j.analyse.cartes) || [] }; };
        const rep = (L, id, choix) => repondre(svT.url, L.jeton, { scanId: L.j.scanId, carte: L.cartes.find(c => c.candidats[0].idProduct === id).index, choix });
        const porteurDe = x => ({ type: 'installation', id: x.i._id, compte: null, installation: x.i, surface: 'extension', administrateur: false });
        const idx = (L, id) => L.cartes.find(c => c.candidats[0].idProduct === id).index;
        const RENDU = { essais: 20, net: 0, mouvements: 2, ouverts: [], remboursements: 1 }, PAYE = { essais: 19, net: -1, mouvements: 1, ouverts: ['debite'], remboursements: 0 };
        const listes = async x => (await reconcilier(porteurDe(x), { cfg })).lotsARendre.length;
        const sid = L => new mongoose.Types.ObjectId(L.j.scanId);

        // S1 : l'analyse est ABSENTE au dernier NON (écriture annexe perdue)
        {
            const L = await lance([ID_A, ID_B]); await rep(L, ID_A, 'aucune');
            const analyse = await raw('analyses').findOne({ _id: sid(L) });
            await raw('analyses').deleteOne({ _id: sid(L) });
            const r = await argentReg().repondreQuestion(porteurDe(L), { scanId: sid(L), carte: idx(L, ID_B), choix: 'aucune' });
            H.v('14a. analyse absente au dernier NON : le lot n\'est pas rendu, MAIS l\'état « lot à rendre » est écrit en base', [r.statut, await livre(L), (await raw('questions_v2').countDocuments({ scanId: sid(L), 'lotARendre.cause': 'analyse-absente' }))], [200, PAYE, 2]);
            const rc = await reconcilier(porteurDe(L), { cfg });
            H.v('   reconcilier : le lot est LISTÉ, propre = false', [rc.lotsARendre.map(l => String(l.scanId)), rc.propre], [[String(sid(L))], false]);
            await argentReg().balayerQuestions({ maintenant: new Date(), max: 500 });
            H.v('   le balayage, analyse TOUJOURS absente : jamais rendu au hasard, toujours listé', [await livre(L), await listes(L)], [PAYE, 1]);
            await raw('analyses').insertOne(analyse);
            const b1 = await argentReg().balayerQuestions({ maintenant: new Date(), max: 500 });
            H.v('   l\'analyse revenue, le balayage rend le lot UNE fois (net 0), efface l\'état, propre = true', [await livre(L), await listes(L), (await reconcilier(porteurDe(L), { cfg })).propre, b1.lotsRepris], [RENDU, 0, true, 1]);
            const b2 = await argentReg().balayerQuestions({ maintenant: new Date(), max: 500 });
            H.v('   une reprise rejouée ne rend rien de plus', [(await livre(L)).remboursements, b2.lotsRepris], [1, 0]);
            const rj = await argentReg().repondreQuestion(porteurDe(L), { scanId: sid(L), carte: idx(L, ID_B), choix: 'aucune' });
            H.v('   le rejeu du dernier NON redit « rembourse » (le lot a été rendu) sans rien rendre de plus', [rj.facturation.rembourse, rj.facturation.motif, (await livre(L)).remboursements], [true, 'lot', 1]);
        }
        // un remboursement qui ÉCHOUE dans le ledger (erreur d'écriture du claim) : même chemin
        {
            const L = await lance([ID_A, ID_B]); await rep(L, ID_A, 'aucune');
            const colOrig = db.col; let armee = true;
            db.col = nom => { const c = colOrig(nom); if (nom !== 'mouvements') return c; return new Proxy(c, { get(t, p) { if (p === 'insertOne') return async (...a) => { if (armee && a[0] && a[0].type === 'remboursement') { armee = false; throw new Error('panne simulée'); } return t.insertOne(...a); }; const v = t[p]; return typeof v === 'function' ? v.bind(t) : v; } }); };
            let r2; try { r2 = await rep(L, ID_B, 'aucune'); } finally { db.col = colOrig; }
            H.v('14b. le ledger échoue au remboursement du lot : payé, « lot à rendre » écrit et listé', [r2.statut, await livre(L), await listes(L)], [200, PAYE, 1]);
            const b = await argentReg().balayerQuestions({ maintenant: new Date(), max: 500 });
            H.v('   le balayage rend le lot une fois et efface l\'état', [await livre(L), await listes(L), b.lotsRepris], [RENDU, 0, 1]);
        }
        // S3 : le plafond du lot (compteur PANNE, 5/jour) — le 6e lot du jour n'est pas rendu et la réponse le dit
        {
            const x = await inst(20); const res = []; let sixieme = null;
            for (let k = 0; k < 6; k++) { const L = await lance([ID_A, ID_B], x); await rep(L, ID_A, 'aucune'); const r = await rep(L, ID_B, 'aucune'); res.push(r.json.facturation.rembourse); if (k === 5) sixieme = { L, r }; }
            H.v('14c. 6 lots tout-NON du même porteur dans la journée : les 5 premiers rendus, le 6e non', res, [true, true, true, true, true, false]);
            const f = sixieme.r.json.facturation;
            H.v('   le 6e dit POURQUOI : plafond-jour, débité 1', [f.rembourse, f.debite, f.motif, f.raisonNonRembourse], [false, 1, 'plafond-jour', 'plafond-jour']);
            H.v('   le compteur est celui des PANNES (5/jour), pas celui des questions (30/jour)', [await compteurDe(x, 'panne'), await compteurDe(x, 'question')], [cfg.plafonds.panne, 0]);
            const rj = await rep(sixieme.L, ID_B, 'aucune');
            H.v('   le rejeu redit le même résultat, rien de plus ; ce refus est définitif (non listé)', [rj.json.facturation, await listes(x)], [f, 0]);
        }
        await svT.fermer();
    }
    H.v(`dénominateur : ${reponsesValidees} réponses de la route validées contre le contrat, ${ecartsContrat} écart(s)`, ecartsContrat, 0);
    H.vrai('   le banc a bien validé des réponses (un contrôle qui ne valide rien ne dit rien)', reponsesValidees >= 20);
    await sv.fermer();
    await mongoose.disconnect(); await H.arreterBanc();
    H.bilan();
})().catch(async e => { console.error('❌', e); try { await H.arreterBanc(); } catch (_) { } process.exit(1); });
