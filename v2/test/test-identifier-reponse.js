'use strict';
// Banc B1b.5 (1/2) — POST /api/identifier/reponse : la réponse à une question, de bout en bout.
// Base : la base EN MÉMOIRE du banc (INT2) — jamais la production, ni la grappe, ni R2. Aucune requête réseau réelle : le serveur ENFANT charge le faux réseau du verrou.
// Le scan est produit par la VRAIE chaîne héritée (charge ambiguë du verrou : deux candidats), la réponse passe par la VRAIE route v2, l'argent est le vrai ledger.
const H = require('./_harnais');
const path = require('path');
const mongoose = require('mongoose');
const db = require('../db'); const M = require('../modeles'); const J = require('../comptes/jetons'); const Q = require('./_aide-quota');
const { lireConfig } = require('../config'); const { valider } = require('../openapi/valider'); const SCHEMA = require('../openapi/openapi.v2.json');
const R = path.join(__dirname, '..', '..');
const CHARGES = path.join(R, 'verrou', 'charges.json');
const IMAGE = require(CHARGES).charges.find(c => c.cellule === 'occidentale').imageUrl;
const ref = n => ({ $ref: `#/components/schemas/${n}` });
const cfg = lireConfig({ MONGODB_BASE: 'test_scratch' });
const ORIGINE = cfg.origines.extension;
let nIp = 0; const ip = () => { nIp++; return { 'x-forwarded-for': `10.8.${Math.floor(nIp / 250)}.${nIp % 250 + 1}` }; };
let nCle = 0; const cle = () => `banc-b1b5r-${Date.now().toString(36)}-${++nCle}`;
const raw = n => mongoose.connection.db.collection(n);
const attendre = ms => new Promise(r => setTimeout(r, ms));
const toutes = [];
let reponsesValidees = 0, ecartsContrat = 0;

async function inst(essais = 3, o = {}) {
    const jeton = J.genererJeton(); const i = Object.assign(M.nouvelleInstallation({ jetonEmpreinte: J.empreinte(jeton), essais, libelle: 'banc' }), o);
    await db.col('installations').insertOne(i); return { i, jeton };
}
async function compte(o = {}) { const c = Object.assign(M.nouveauCompte({ email: `r${++nCle}@x.fr`, emailCle: `r${nCle}@x.fr`, motDePasse: {} }), { verifie: true }, o); await db.col('comptes').insertOne(c); return c; }
const entetes = (jeton, plus = {}) => ({ origin: ORIGINE, ...ip(), ...(jeton ? { authorization: `Bearer ${jeton}` } : {}), ...plus });
async function identifier(url, jeton) {
    return H.appel(url, '/api/identifier', { methode: 'POST', corps: { contrat: 2, imageUrls: [IMAGE], title: null, description: null, prixVinted: null, devise: null, marche: 'vinted.fr', versionExtension: '2.0.0', langueInterface: 'fr' },
        entetes: entetes(jeton, { 'idempotency-key': cle() }) });
}
async function repondre(url, jeton, corps, { cleIdem, nom } = {}) {
    const r = await H.appel(url, '/api/identifier/reponse', { methode: 'POST', corps, entetes: entetes(jeton, cleIdem ? { 'idempotency-key': cleIdem } : {}) });
    toutes.push({ nom, statut: r.statut, acao: r.entetes['access-control-allow-origin'] });
    if (r.json && r.json.success === true) { const v = valider(r.json, ref('ReponseQuestion'), SCHEMA); reponsesValidees++; if (!v.ok) { ecartsContrat++; console.log(`   écart de contrat : ${v.erreurs.slice(0, 3).map(e => `${e.chemin} ${e.message}`).join(' ; ')}`); } }
    return r;
}
const mouv = id => raw('mouvements').find({ installationId: id }).toArray();
// OFFRE-QUOTA : « essais » = ce qui reste aujourd'hui au porteur (3 par jour sans compte), relu par la fonction même des routes.
const essais = id => Q.restantDe({ type: 'installation', id }, cfg);
const ID_A = 895789, ID_B = 895790, EXP = 990001;
async function semer() {
    for (const c of ['catalogue_produits', 'numeros_cartes', 'guide_prix', 'codes_set']) await raw(c).deleteMany({});
    await raw('codes_set').insertOne({ idExpansion: EXP, codeSet: 'PBL', apprisLe: new Date() });
    for (const [id, variante] of [[ID_A, 'normale'], [ID_B, 'reverse']]) {
        await raw('catalogue_produits').insertOne({ idProduct: id, name: 'Tropius (PBL 001)', idExpansion: EXP, idMetacard: 990101 });
        await raw('numeros_cartes').insertOne({ idProduct: id, idExpansion: EXP, numero: '001', numeroUrl: 'PBL001', codeSet: 'PBL', nomFr: 'Tropius', slug: 'Tropius-PBL001', slugSet: 'Banc-Set', source: 'cardmarket', certitude: 'exacte', ...(id === ID_B ? { variante: 'V2' } : {}) });
        await raw('guide_prix').insertOne({ idProduct: id, avg: 1.1, low: 0.5, trend: 1.0, avg1: 1.0, avg7: 1.0, avg30: 1.1, guideDu: new Date('2026-10-04') });
        VIS.push(VB.doc(id, { variante }));
    }
}
const VB = require('./_visuels-banc'); const VIS = [];

(async () => {
    await H.ouvrirBancV2();
    await Q.eviterMinuit();
    process.env.MONGODB_BASE = 'test_scratch';
    const { connecterMongo } = require('../../mongo-connexion');
    await connecterMongo({ script: 'test-identifier-reponse.js', ecrit: true });
    db.brancher(mongoose.connection.db);
    await M.creerIndex();
    const { demarrer } = require('../../verrou/serveur');
    await semer();
    const srv = await demarrer(path.join(__dirname, 'faux-reseau-v2.js'), { VERROU_CHARGES: CHARGES, JETON_API: 'jeton-verrou', MONGODB_BASE: 'test_scratch', OPENROUTER_API_KEY: '', RM_API_V2: '1', V2_VISUELS_BANC_FICHIER: VB.fichier(VIS) });
    if (!await srv.attendreMongo()) throw new Error('Mongo non connecté');
    const url = `http://127.0.0.1:${srv.port}`;
    // un scan ambigu neuf : { x, jeton, j (réponse d'identifier), scanId, choix: {a,b} }
    const scanAmbigu = async (essaisInit = 3, o = {}) => {
        const x = await inst(essaisInit, o); const r = await identifier(url, x.jeton); const j = r.json || {};
        if (!(j.analyse && j.analyse.statut === 'a-trancher')) throw new Error(`scan ambigu attendu, reçu ${r.statut} ${r.texte && r.texte.slice(0, 200)}`);
        const q = await raw('questions_v2').findOne({ _id: `${j.scanId}:0` });
        return { ...x, j, scanId: j.scanId, q, id: Object.fromEntries(j.analyse.cartes[0].question.choix.map(c => [c.id, c.idProduct])) };
    };

    // ── 0. sans Bearer : 401 JETON, aucun mouvement (écrit en premier : aucune forme héritée pour cette route)
    {
        const s = await scanAmbigu(); const m0 = (await mouv(s.i._id)).length;
        const r = await repondre(url, null, { scanId: s.scanId, choix: 'a' }, { nom: '0' });
        H.v('0. sans Bearer : 401 JETON (corps v2), aucun mouvement de plus', [r.statut, r.json && r.json.erreur && r.json.erreur.code, (await mouv(s.i._id)).length - m0], [401, 'JETON', 0]);
        const q = await raw('questions_v2').findOne({ _id: `${s.scanId}:0` });
        H.v('   la question n\'a pas bougé (en-attente)', q.etat, 'en-attente');
    }

    // ── 1. candidat valide : identifiee, débitée UNE fois ; 9. la vérité est écrite
    const s1 = await scanAmbigu();
    const k1 = cle();
    const r1 = await repondre(url, s1.jeton, { scanId: s1.scanId, carte: 0, choix: 'a' }, { cleIdem: k1, nom: '1' });
    const j1 = r1.json || {};
    H.v('1. choix a : 200, carte identifiee désignant le candidat a', [r1.statut, j1.success, j1.carte && j1.carte.statut, j1.carte && j1.carte.carte && j1.carte.carte.idProduct, j1.carte && j1.carte.index], [200, true, 'identifiee', s1.id.a, 0]);
    H.v('   facturation { debite:1, reserve:0, rembourse:false, motif:question }, offre.restant 2 (le solde hérité n\'est plus débité : OFFRE-QUOTA)', [j1.facturation, j1.offre && j1.offre.restant], [{ debite: 1, reserve: 0, rembourse: false, motif: 'question', raisonNonRembourse: null }, 2]);
    H.v('   un seul débit net : essais 2, un débit « debite », pas de remboursement', [await essais(s1.i._id), (await mouv(s1.i._id)).map(m => `${m.type}:${m.etat}`)], [2, ['debit:debite']]);
    // 9. la vérité
    await attendre(200);
    const an1 = await raw('analyses').findOne({ _id: new mongoose.Types.ObjectId(s1.scanId) });
    const rep = an1 && an1.cartes[0].reponse;
    H.v('9. analyses.cartes[0].reponse = { choix, idProduct, le }', [rep && rep.choix, rep && rep.idProduct, rep && rep.le instanceof Date], ['a', s1.id.a, true]);
    // 2. rejeu : même clé, puis même réponse SANS clé
    const r1b = await repondre(url, s1.jeton, { scanId: s1.scanId, carte: 0, choix: 'a' }, { cleIdem: k1, nom: '2a' });
    H.v('2. rejeu (même Idempotency-Key) : même corps, Idempotency-Replayed', [r1b.texte === r1.texte, r1b.entetes['idempotency-replayed']], [true, 'true']);
    const r1c = await repondre(url, s1.jeton, { scanId: s1.scanId, carte: 0, choix: 'a' }, { nom: '2b' });
    H.v('   même réponse SANS clé : 200, même carte et même facturation', [r1c.statut, JSON.stringify(r1c.json.carte) === JSON.stringify(j1.carte), JSON.stringify(r1c.json.facturation) === JSON.stringify(j1.facturation)], [200, true, true]);
    H.v('   toujours UN seul débit (essais 2, 1 mouvement)', [await essais(s1.i._id), (await mouv(s1.i._id)).length], [2, 1]);
    // 3. réponse différente sur une carte tranchée
    const r1d = await repondre(url, s1.jeton, { scanId: s1.scanId, carte: 0, choix: 'b' }, { nom: '3' });
    H.v('3. réponse différente sur une carte tranchée : 409 CONFLIT', [r1d.statut, r1d.json.erreur.code], [409, 'CONFLIT']);
    H.v('   la vérité écrite n\'a pas changé', (await raw('analyses').findOne({ _id: new mongoose.Types.ObjectId(s1.scanId) })).cartes[0].reponse.choix, 'a');

    // ── 4. aucune : introuvable / hors-catalogue, crédit rendu
    {
        const s = await scanAmbigu(); const r = await repondre(url, s.jeton, { scanId: s.scanId, choix: 'aucune' }, { nom: '4' }), j = r.json || {};
        H.v('4. aucune : carte introuvable / hors-catalogue', [r.statut, j.carte && j.carte.statut, j.carte && j.carte.raison, j.carte && j.carte.index], [200, 'introuvable', 'hors-catalogue', 0]);
        H.v('   facturation { debite:0, rembourse:true, motif:question }, crédit rendu (essais 3)', [j.facturation && j.facturation.debite, j.facturation && j.facturation.rembourse, j.facturation && j.facturation.motif, await essais(s.i._id), j.solde && j.solde.essai], [0, true, 'question', 3, 3]);
        const rr = await repondre(url, s.jeton, { scanId: s.scanId, choix: 'aucune' }, { nom: '4b' });
        H.v('   rejeu sans clé : même corps, pas de second crédit (essais 3)', [rr.texte === r.texte, await essais(s.i._id)], [true, 3]);
    }
    // ── 5. ne-sait-pas : la carte reste a-trancher, mêmes candidats, crédit rendu
    {
        const s = await scanAmbigu(); const r = await repondre(url, s.jeton, { scanId: s.scanId, choix: 'ne-sait-pas' }, { nom: '5' }), j = r.json || {};
        const avant = s.j.analyse.cartes[0];
        H.v('5. ne-sait-pas : la carte reste a-trancher, mêmes candidats, question rendue, pas de verdict', [r.statut, j.carte && j.carte.statut, j.carte && j.carte.candidats.map(c => c.idProduct), j.carte && j.carte.carte, j.carte && j.carte.prixLive],
            [200, 'a-trancher', avant.candidats.map(c => c.idProduct), null, null]);
        H.v('   crédit rendu : { debite:0, rembourse:true, motif:question }, essais 3', [j.facturation && j.facturation.debite, j.facturation && j.facturation.rembourse, j.facturation && j.facturation.motif, await essais(s.i._id)], [0, true, 'question', 3]);
    }
    // ── 6. entrées et propriété
    {
        const s = await scanAmbigu(), autre = await inst(3);
        const m0 = (await mouv(s.i._id)).length;
        const r404 = await repondre(url, autre.jeton, { scanId: s.scanId, choix: 'a' }, { nom: '6a' });
        H.v('6. scanId d\'un AUTRE porteur : 404 (pas 403)', [r404.statut, r404.json.erreur.code], [404, 'CODE_INVALIDE']);
        const mal = await repondre(url, s.jeton, { scanId: 'pas-un-objectid', choix: 'a' }, { nom: '6b' });
        H.v('   scanId mal formé : 400 ENTREE (ni 404 ni exception)', [mal.statut, mal.json.erreur.code], [400, 'ENTREE']);
        const sans = await repondre(url, s.jeton, { choix: 'a' }, { nom: '6b2' });
        H.v('   scanId absent : 400', sans.statut, 400);
        const hors = await repondre(url, s.jeton, { scanId: s.scanId, choix: 'z' }, { nom: '6c' });
        H.v('   choix hors liste : 400 ENTREE', [hors.statut, hors.json.erreur.code], [400, 'ENTREE']);
        const troisieme = await repondre(url, s.jeton, { scanId: s.scanId, choix: 'c' }, { nom: '6d' });
        H.v('   choix « c » alors que la question n\'en a que deux : 400 ENTREE', [troisieme.statut, troisieme.json.erreur.code], [400, 'ENTREE']);
        const carte = await repondre(url, s.jeton, { scanId: s.scanId, carte: 5, choix: 'a' }, { nom: '6e' });
        H.v('   carte inexistante : 404', carte.statut, 404);
        const neg = await repondre(url, s.jeton, { scanId: s.scanId, carte: -1, choix: 'a' }, { nom: '6f' });
        H.v('   carte négative : 400', neg.statut, 400);
        H.v('   aucune de ces erreurs n\'a touché l\'argent ni la question', [(await mouv(s.i._id)).length - m0, (await raw('questions_v2').findOne({ _id: `${s.scanId}:0` })).etat], [0, 'en-attente']);
    }
    // ── 7. après 24 h : 410, crédit rendu par le balayage
    {
        const s = await scanAmbigu();
        await raw('questions_v2').updateOne({ _id: `${s.scanId}:0` }, { $set: { poseeLe: new Date(Date.now() - 25 * 3600e3) } });
        const bilan = await require('../argent/questions').balayerQuestions({}, cfg);
        const r = await repondre(url, s.jeton, { scanId: s.scanId, choix: 'a' }, { nom: '7' }), j = r.json || {};
        H.v('7. après 24 h (balayage passé) : 410 CODE_EXPIRE, facturation.rembourse true', [bilan.remboursees >= 1, r.statut, j.erreur && j.erreur.code, j.facturation && j.facturation.rembourse], [true, 410, 'CODE_EXPIRE', true]);
        H.v('   crédit rendu une seule fois (essais 3)', await essais(s.i._id), 3);
    }
    // ── 6bis. ligne analyses ABSENTE alors que la question de CE porteur existe : une panne explicite et réessayable, JAMAIS un 404 (qui veut dire « scan d'un autre »)
    {
        const s = await scanAmbigu(), autre = await inst(3);
        await raw('analyses').deleteOne({ _id: new mongoose.Types.ObjectId(s.scanId) });
        const m0 = (await mouv(s.i._id)).length;
        const r = await repondre(url, s.jeton, { scanId: s.scanId, choix: 'a' }, { nom: '6g' }), j = r.json || {};
        H.v('6bis. analyses absente, question du porteur présente : 503 INDISPONIBLE (detail analyse-absente), pas 404', [r.statut, j.erreur && j.erreur.code, j.erreur && j.erreur.detail, j.success], [503, 'INDISPONIBLE', 'analyse-absente', false]);
        const q = await raw('questions_v2').findOne({ _id: `${s.scanId}:0` });
        H.v('   la question est INTACTE (en-attente, non répondue), le crédit reste réservé, aucun mouvement de plus', [q.etat, q.reponse, (await mouv(s.i._id)).length - m0, await essais(s.i._id)], ['en-attente', null, 0, 2]);
        const rA = await repondre(url, autre.jeton, { scanId: s.scanId, choix: 'a' }, { nom: '6h' });
        H.v('   le même scan présenté par un AUTRE porteur : toujours 404 (la panne ne révèle rien)', [rA.statut, rA.json.erreur.code], [404, 'CODE_INVALIDE']);
        const rI = await repondre(url, s.jeton, { scanId: String(new mongoose.Types.ObjectId()), choix: 'a' }, { nom: '6i' });
        H.v('   un scan qui n\'existe nulle part : 404', rI.statut, 404);
    }
    // ── 10. lot : répondre ne coûte rien et ne rembourse rien (documents fabriqués d'après un vrai scan)
    {
        const s = await scanAmbigu(); const x = await inst(3);
        const src = await raw('analyses').findOne({ _id: new mongoose.Types.ObjectId(s.scanId) });
        const sid = new mongoose.Types.ObjectId();
        await raw('analyses').insertOne({ ...src, _id: sid, porteur: `installation:${x.i._id}` });
        await raw('questions_v2').insertOne({ _id: `${sid}:0`, scanId: sid, carte: 0, porteur: { type: 'installation', id: x.i._id }, surface: 'extension', credit: { poche: 'essai' }, raison: 'lot', choix: s.q.choix, candidats: s.q.candidats, poseeLe: new Date(), etat: 'en-attente', reponse: null, priseLe: null, regleeLe: null, rembourse: null, raisonNonRembourse: null, lot: true });
        const r = await repondre(url, x.jeton, { scanId: String(sid), choix: 'a' }, { nom: '10' }), j = r.json || {};
        H.v('10. lot : { debite:0, rembourse:false, motif:lot }, aucun mouvement, essais inchangés', [r.statut, j.facturation && j.facturation.debite, j.facturation && j.facturation.rembourse, j.facturation && j.facturation.motif, (await mouv(x.i._id)).length, await essais(x.i._id)], [200, 0, false, 'lot', 0, 3]);
        const rn = await repondre(url, x.jeton, { scanId: String(sid), choix: 'aucune' }, { nom: '10b' });
        H.v('   un lot répondu « aucune » après coup : 409 (déjà répondu), rien rendu', [rn.statut, await essais(x.i._id)], [409, 3]);
    }
    // ── administrateur : pas de question en base (rien de débité), la réponse se résout quand même
    {
        const c = await compte({ role: 'administrateur', solde: { accueil: 25, achete: 0 } });
        const s = await scanAmbigu(0, { compteId: c._id });
        H.v('adm. a-trancher sans document de question (aucun crédit pris)', await raw('questions_v2').countDocuments({ _id: `${s.scanId}:0` }), 0);
        const r = await repondre(url, s.jeton, { scanId: s.scanId, choix: 'b' }, { nom: 'adm' }), j = r.json || {};
        H.v('   réponse b : 200, identifiee, motif administrateur, rien débité', [r.statut, j.carte && j.carte.statut, j.carte && j.carte.carte && j.carte.carte.idProduct, j.facturation && j.facturation.motif, j.facturation && j.facturation.debite], [200, 'identifiee', s.id.b, 'administrateur', 0]);
        const r2 = await repondre(url, s.jeton, { scanId: s.scanId, choix: 'a' }, { nom: 'adm2' });
        H.v('   une autre réponse ensuite : 409 CONFLIT', [r2.statut, r2.json.erreur.code], [409, 'CONFLIT']);
        H.v('   solde du compte intact (accueil 25)', (await raw('comptes').findOne({ _id: c._id })).solde.accueil, 25);
    }
    // CORS de l'extension sur chaque réponse
    {
        const sans = toutes.filter(t => t.acao !== ORIGINE);
        H.v(`CORS de l'extension sur chacune des ${toutes.length} réponses (erreurs comprises)`, sans.length, 0);
    }
    H.v(`contrat : ${reponsesValidees} réponses validées contre ReponseQuestion, écarts`, [ecartsContrat, reponsesValidees > 0], [0, true]);
    srv.enfant.kill();

    // ── 8. le balayage des questions : une fois par minute, unref, rien sans Mongo
    {
        const express = require('express'); const monter = require('../identifier/monter');
        const vus = []; const orig = global.setInterval;
        global.setInterval = (fn, ms, ...a) => { const t = orig(fn, ms, ...a); const o = { ms, unref: false }; const u = t.unref.bind(t); t.unref = () => { o.unref = true; return u(); }; vus.push(o); return t; };
        try { monter.routes(express.Router(), cfg, {}); } finally { global.setInterval = orig; }
        H.v('8. monter.routes arme UN balayage : toutes les 60 s, avec unref()', vus.filter(v => v.ms === 60000).map(v => v.unref), [true]);
        let appels = 0; const faux = { balayerQuestions: async () => { appels++; return {}; } };
        await monter.balayerQuestionsUneFois({ etatMongo: () => 0, argent: () => faux });
        H.v('   SANS Mongo (connexion non prête) : le balayage ne fait rien', appels, 0);
        await monter.balayerQuestionsUneFois({ etatMongo: () => 1, argent: () => faux });
        H.v('   Mongo prêt : une passe', appels, 1);
        let leve = null; try { await monter.balayerQuestionsUneFois({ etatMongo: () => 1, argent: () => ({ balayerQuestions: async () => { throw new Error('boum'); } }) }); } catch (e) { leve = e; }
        H.v('   une passe qui échoue ne lève jamais (le minuteur survit)', leve, null);
        monter.arreterBalayage();
    }

    await mongoose.disconnect();
    await H.arreterBanc();
    H.bilan();
})().catch(async e => { console.error('❌', e); try { await H.arreterBanc(); } catch (_) { } process.exit(1); });
