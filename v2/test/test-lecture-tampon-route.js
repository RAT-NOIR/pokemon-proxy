'use strict';
// F1-TAMPON — la ROUTE et l'ARGENT : du débit à la réponse, derrière DEUX interrupteurs (V2_LECTURE_TAMPON ET V2_EMPREINTE_EXTENSION, défaut 0).
// Base : la base EN MÉMOIRE du banc — jamais la production, ni la grappe, ni R2. Aucun réseau, AUCUN appel payant : la chaîne héritée, le fournisseur de lecture du tampon et le client du modèle sont FABRIQUÉS.
// Ce que le banc tient : éteint, la réponse est la même OCTET POUR OCTET que sans fournisseur ; allumé, seule la lecture « STAFF » deux fois sur la CARTE REDRESSÉE de l'empreinte (JPEG 420 × 587, validée par
// MODELE-VISUEL-API) change une question en affirmation du produit STAFF ; tout le reste rend la réponse d'AVANT ; ON N'AFFIRME JAMAIS LA VERSION NORMALE ; un jumbo reste une question (titre ou pas) ;
// chaque appel du modèle est compté dans le plafond GLOBAL de dépense ; les quatre gardes de la décision ont chacune leur banc.
const H = require('./_harnais');
const mongoose = require('mongoose');
const sharp = require('sharp');
const db = require('../db'); const M = require('../modeles'); const J = require('../comptes/jetons'); const Q = require('./_aide-quota');
const { lireConfig } = require('../config'); const { valider } = require('../openapi/valider'); const SCHEMA = require('../openapi/openapi.v2.json');
const LT = require('../identifier/lecture-tampon');
const { consulterLectureTampon } = require('../identifier/lecture-tampon-route');
const path = require('path');
const CHARGES = path.join(__dirname, '..', '..', 'verrou', 'charges.json');
const IMAGE = require(CHARGES).charges.find(c => c.cellule === 'occidentale').imageUrl;
const ref = n => ({ $ref: `#/components/schemas/${n}` });
const base = { MONGODB_BASE: 'test_scratch', V2_HEBDO: '0' };
const cfgOff = lireConfig(base);
const cfgOn = lireConfig({ ...base, V2_LECTURE_TAMPON: '1', V2_EMPREINTE_EXTENSION: '1' });
const cfgTamponSeul = lireConfig({ ...base, V2_LECTURE_TAMPON: '1' });
const cfgEmpreinteSeule = lireConfig({ ...base, V2_EMPREINTE_EXTENSION: '1' });
const cfgPlafond = lireConfig({ ...base, V2_LECTURE_TAMPON: '1', V2_EMPREINTE_EXTENSION: '1', V2_DEPENSE_MODELE_JOUR_USD: '0.01', V2_COUT_APPEL_ESTIME_USD: '0.004' });
const ORIGINE = cfgOff.origines.extension;
let nIp = 0; const ip = () => { nIp++; return { 'x-forwarded-for': `10.15.${Math.floor(nIp / 250)}.${nIp % 250 + 1}` }; };
let nCle = 0; const cle = () => `banc-tampon-${Date.now().toString(36)}-${++nCle}`;
const raw = n => mongoose.connection.db.collection(n);
const E = require('../chargeur/etat'); const { creerConstructeur } = require('../chargeur/version'); const VB = require('./_visuels-banc');
const PA = 895831, PB = 895832, PC = 895833, JA = 895841, JB = 895842, PX = 895851, EXP = 990031, EXPJ = 990032, EXPX = 990033, META = 990131, METAJ = 990132, METAX = 990133;
// LOT TAMPONS : une paire league / normale (LA normale, LB league) et une paire staff+prerelease / normale (SA normale, SB staff+prerelease)
const LA = 895861, LB = 895862, SA = 895871, SB = 895872, EXPL = 990034, EXPS = 990035, METAL = 990134, METAS = 990135;
let ecartsContrat = 0, reponsesValidees = 0;
let CARTE = null;                                           // la carte redressée valide : base64 d'un JPEG 420 × 587

async function inst(essais = 3) {
    const jeton = J.genererJeton(); const i = M.nouvelleInstallation({ jetonEmpreinte: J.empreinte(jeton), essais, libelle: 'banc' });
    await db.col('installations').insertOne(i); return { i, jeton };
}
const empreintesAvec = carte => ({ modeleEmpreinte: { id: 'modele-banc', sha256: '0'.repeat(64) }, empreintes: [{ photo: 0, vecteur: 'AAAA', redressee: true, ...(carte === undefined ? {} : { carte }) }] });
const corps = (o = {}) => ({ contrat: 2, imageUrls: [IMAGE], title: null, description: null, prixVinted: null, devise: null, marche: 'vinted.fr', versionExtension: '2.0.0', langueInterface: 'fr', ...o });
async function poster(url, jeton, cleIdem = cle(), titre = null, emp = undefined) {
    const r = await H.appel(url, '/api/identifier', { methode: 'POST', corps: corps({ title: titre, ...empreintesAvec(emp === undefined ? CARTE : emp) }), entetes: { origin: ORIGINE, ...ip(), authorization: `Bearer ${jeton}`, 'idempotency-key': cleIdem } });
    if (r.json && r.json.success === true && r.json.contrat === 2) { reponsesValidees++; const v = valider(r.json, ref('ReponseAnalyse'), SCHEMA); if (!v.ok) { ecartsContrat++; console.log(`   écart de contrat : ${v.erreurs.slice(0, 3).map(e => `${e.chemin} ${e.message}`).join(' ; ')}`); } }
    return r;
}
async function livre(x) {
    const mv = await raw('mouvements').find({ installationId: x.i._id }).toArray();
    const ins = { essais: await Q.restantDe({ type: 'installation', id: x.i._id }, cfgOff) };
    return { essais: ins.essais, net: mv.reduce((s, m) => s + m.delta, 0), mouvements: mv.length, ouverts: mv.filter(m => m.type === 'debit' && m.etat !== 'rembourse').map(m => m.etat), remboursements: mv.filter(m => m.type === 'remboursement').length };
}
const PAYE = { essais: 2, net: -1, mouvements: 1, ouverts: ['debite'], remboursements: 0 };
const RESERVE = { essais: 2, net: -1, mouvements: 1, ouverts: ['reserve'], remboursements: 0 };
const analyseDe = scanId => raw('analyses').findOne({ _id: new mongoose.Types.ObjectId(scanId) });
const norm = s => String(s).replace(/"scanId":"[0-9a-f]{24}"/g, '"scanId":"<id>"');
const ids = c0 => c0.candidats.map(c => c.idProduct);

(async () => {
    const cleEnv = process.env.OPENROUTER_API_KEY; delete process.env.OPENROUTER_API_KEY;      // le banc ne doit JAMAIS trouver une vraie clé
    CARTE = (await sharp({ create: { width: 420, height: 587, channels: 3, background: { r: 90, g: 90, b: 90 } } }).jpeg({ quality: 92 }).toBuffer()).toString('base64');
    H.vrai('0. les configurations du banc : les deux drapeaux allumés (cfgOn), un seul (les deux autres), éteints (cfgOff)', cfgOn.lectureTampon && cfgOn.empreinteExtension && cfgTamponSeul.lectureTampon && !cfgTamponSeul.empreinteExtension && !cfgEmpreinteSeule.lectureTampon && !cfgOff.lectureTampon);
    await H.ouvrirBancV2();
    await Q.eviterMinuit();
    process.env.MONGODB_BASE = 'test_scratch';
    const { connecterMongo } = require('../../mongo-connexion');
    await connecterMongo({ script: 'test-lecture-tampon-route.js', ecrit: true });
    db.brancher(mongoose.connection.db);
    await M.creerIndex();
    for (const c of ['catalogue_produits', 'numeros_cartes', 'guide_prix', 'codes_set', 'depense_modele']) await raw(c).deleteMany({});
    for (const [e, code] of [[EXP, 'PRE'], [EXPJ, 'PRJ'], [EXPX, 'PRX'], [EXPL, 'PRL'], [EXPS, 'PRS']]) await raw('codes_set').insertOne({ idExpansion: e, codeSet: code, apprisLe: new Date() });
    const SEMIS = [[PA, EXP, META, 'PRE', '162', {}], [PB, EXP, META, 'PRE', '162', {}], [PC, EXP, META + 1, 'PRE', '170', {}], [JA, EXPJ, METAJ, 'PRJ', '5', {}], [JB, EXPJ, METAJ, 'PRJ', '5', {}], [PX, EXPX, METAX, 'PRX', '9', { prixMelangeTampon: true }],
        [LA, EXPL, METAL, 'PRL', '7', {}], [LB, EXPL, METAL, 'PRL', '7', {}], [SA, EXPS, METAS, 'PRS', '8', {}], [SB, EXPS, METAS, 'PRS', '8', {}]];
    for (const [id, exp, meta, code, numero, plus] of SEMIS) {
        await raw('catalogue_produits').insertOne({ idProduct: id, name: 'Roaring Moon ex', idExpansion: exp, idMetacard: meta });
        await raw('numeros_cartes').insertOne({ idProduct: id, idExpansion: exp, numero, numeroUrl: `${code}${numero}`, codeSet: code, nomFr: 'Roaring Moon ex', slug: `Roaring-Moon-ex-${code}${numero}-${id}`, slugSet: 'Banc-Set', source: 'cardmarket', certitude: 'exacte', ...plus });
        await raw('guide_prix').insertOne({ idProduct: id, avg: 1.1, low: 0.5, trend: 1.0, avg1: 1.0, avg7: 1.0, avg30: 1.1, guideDu: new Date('2026-10-04') });
    }
    // l'archive du banc, AVEC la colonne des marquages : la paire staff (PA normale / PB staff), la paire jumbo (JA / JB), un produit marqué seul (PX), un tiers (PC)
    const mar = (id, extra) => VB.doc(id, { variante: 'normale', total: '131', ...extra });
    const entrees = [
        mar(PA, { idMetacard: META, variante: 'normale', partageeTamponNonSepare: false, produitsPartages: [PA, PB], tamponNonRepresente: 'Staff' }),
        mar(PB, { idMetacard: META, variante: 'staff', partageeTamponNonSepare: false, produitsPartages: [PA, PB], tamponNonRepresente: 'Staff' }),
        mar(PC, { idMetacard: META + 1 }),
        mar(JA, { idMetacard: METAJ, variante: 'normale', numero: '5', partageeTamponNonSepare: false, produitsPartages: [JA, JB] }),
        mar(JB, { idMetacard: METAJ, variante: 'jumbo', numero: '5', partageeTamponNonSepare: false, produitsPartages: [JA, JB] }),
        mar(PX, { idMetacard: METAX, numero: '9', variante: 'staff' }),                  // le produit marqué : sa variante STAFF est PROUVÉE (I3 : la règle 2 exige la même preuve qu'un sûr)
        mar(895852, { idMetacard: METAX, numero: '9', variante: 'league' }),             // un frère de la fiche (même métacarte), variante LEAGUE prouvée : une impression sans ligne de catalogue
        mar(LA, { idMetacard: METAL, numero: '7', variante: 'normale', partageeTamponNonSepare: false, produitsPartages: [LA, LB], tamponNonRepresente: 'League' }),
        mar(LB, { idMetacard: METAL, numero: '7', variante: 'league', partageeTamponNonSepare: false, produitsPartages: [LA, LB], tamponNonRepresente: 'League' }),
        mar(SA, { idMetacard: METAS, numero: '8', variante: 'normale', partageeTamponNonSepare: false, produitsPartages: [SA, SB], tamponNonRepresente: 'Staff' }),
        mar(SB, { idMetacard: METAS, numero: '8', variante: 'staff+prerelease', partageeTamponNonSepare: false, produitsPartages: [SA, SB], tamponNonRepresente: 'Staff' })];
    const bm = creerConstructeur({ marquages: true }); for (const d of entrees) bm.entree(d);
    const VERSION_MAR = bm.finir(); E.installer(VERSION_MAR);
    const bs = creerConstructeur(); for (const d of entrees.map(x => ({ ...x, partageeTamponNonSepare: undefined, produitsPartages: undefined, tamponNonRepresente: undefined }))) bs.entree(d);   // une archive d'AVANT : sans la colonne des marquages
    const VERSION_SANS = bs.finir();

    const express = require('express'); const pret = require('../pret');
    const { dansUnScan } = require('../../sources'); const { assembler } = require('../index');
    let mode = 'paire';
    const ETAT = { estimeIA: null, confianceIA: null, defautsVus: [], declareVendeur: null, declareCardmarket: null, retenu: null };
    const cand = (id, numero = '162') => ({ idProduct: id, nom: 'Roaring Moon ex', numero, set: 'Banc Set', prix: 1, photoUrl: null });
    const enTete = { etat: ETAT, classement: [], guidePrix: {}, reverse: { attendue: false, motif: null, etat: 'aucun-motif', strategie: null }, codeLangue: 2 };
    const chaine = async (req, res) => {
        const sid = String(req.scanIdImpose);
        const qui = { paire: [PA, PB], 'paire-trois': [PA, PB, PC], 'hors-paire': [PA, PC], 'paire-jumbo': [JA, JB], 'lu-autre': [PA, PB], 'paire-league': [LA, LB], 'paire-staff-prerelease': [SA, SB] }[mode];
        if (qui) {                                                   // la chaîne POSE la question (réserve le crédit) : elle n'affirme rien
            await req.credit.v2.poserQuestion(req, { scanId: req.scanIdImpose, raison: 'egalite-sans-enjeu', candidats: qui });
            const numero = mode === 'paire-jumbo' ? '5' : mode === 'lu-autre' ? '999' : mode === 'paire-league' ? '7' : mode === 'paire-staff-prerelease' ? '8' : '162';
            const setCode = mode === 'paire-jumbo' ? 'PRJ' : mode === 'paire-league' ? 'PRL' : mode === 'paire-staff-prerelease' ? 'PRS' : 'PRE';
            return res.json({ success: true, scanId: sid, question: { etat: 'en-attente', delaiHeures: 24 }, ...enTete, candidats: qui.map(i => cand(i, numero)),
                carte: { idProduct: qui[0], nomProduit: 'Roaring Moon ex', nom: 'Roaring Moon ex', numero, setCode, total: '131', rarete: null, langue: 'FR', ambigu: true } });
        }
        const id = mode === 'jumeaux' ? PA : PX;                      // la chaîne AFFIRME : PA (la garde des jumeaux en fait une question avec PB) ou PX (le produit marqué seul)
        const code = id === PX ? 'PRX' : 'PRE', numero = id === PX ? '9' : '162';
        return res.json({ success: true, scanId: sid, question: null, ...enTete, candidats: [cand(id, numero)], carte: { idProduct: id, nomProduit: 'Roaring Moon ex', nom: 'Roaring Moon ex', numero, setCode: code, total: '131', rarete: null, langue: 'FR', ambigu: false } });
    };
    // le « modèle » factice du FOURNISSEUR (deps.lectureTampon). LOT TAMPONS : les essais sont des ENSEMBLES de marques ; les notations courtes de F1 se lisent ainsi : 'oui' = [staff], 'non' = aucune marque.
    // `modele.essais` peut aussi porter des essais déjà normalisés ({ marques } | { autre } | 'incertain') ; `modele.lecture` la lecture que le fournisseur ANNONCE (la route la refait sur les essais).
    const modele = { appels: [], lecture: 'oui', essais: ['oui', 'oui'], cout: 2, panne: false, lenteurMs: 0, sansImage: false };
    const EN_ESSAI = x => (x === 'oui' ? { marques: ['staff'] } : x === 'non' ? { marques: [] } : x);
    const EN_LECTURE = x => (x === 'oui' ? 'marques' : x === 'non' ? 'aucune' : x);
    const fournisseur = async ({ image, signal, corps: c, scanId, compteur }) => {
        modele.appels.push({ scanId: String(scanId), image: Buffer.isBuffer(image), jpeg: Buffer.isBuffer(image) && image[0] === 0xff && image[1] === 0xd8, signal: Boolean(signal), corps: Boolean(c) });
        if (modele.sansImage) return { lecture: 'incertain', marques: [], essais: [], echec: false, sansImage: true, raison: 'aucune image' };
        if (compteur) compteur.appels = (compteur.appels || 0) + modele.cout;
        if (modele.lenteurMs) await new Promise(r => setTimeout(r, modele.lenteurMs));
        if (modele.panne) return { lecture: 'incertain', marques: [], essais: [], echec: true, raison: 'panne factice' };
        const essais = modele.essais.map(EN_ESSAI);
        return { lecture: EN_LECTURE(modele.lecture), marques: modele.lecture === 'oui' ? ['staff'] : (modele.lecture === 'marques' ? (essais[0] && essais[0].marques) || [] : []), essais, echec: false, raison: 'factice' };
    };
    const JUM = { [PA]: [PB] };
    const voisinsMuet = async () => ({ ok: false, code: 'muette' });      // la règle G par l'empreinte se TAIT : seule la lecture du tampon est mesurée
    const monter = async (deps = {}, cfgApp = cfgOn) => {
        const app = express(); app.set('trust proxy', true); app.use(express.json()); app.use((q, s, n) => dansUnScan(n));
        pret.armer(require('../modeles').verifierIndex);
        app.use(assembler([require('../argent/monter'), require('../identifier/monter')], cfgApp, { jumeaux: id => ({ conclu: true, ids: JUM[id] || [] }), gererIdentifier: chaine, gererRetourLive: async (q, s) => s.json({ success: true }), voisinsEmpreinte: voisinsMuet, ...deps }));
        return H.serveur(app);
    };
    const scan = async (s, m = 'paire', titre = null, cleIdem, emp) => { mode = m; const x = await inst(3); const r = await poster(s.url, x.jeton, cleIdem, titre, emp); const j = r.json || {}; return { ...x, r, j, scanId: j.scanId, c0: j.analyse && j.analyse.cartes[0] }; };
    const ligneQ = async scanId => raw('questions_v2').findOne({ _id: `${scanId}:0` });
    const svSans = await monter({}, cfgOff), svOffAvec = await monter({ lectureTampon: fournisseur }, cfgOff), svOn = await monter({ lectureTampon: fournisseur }, cfgOn);
    const avertissements = async (deps, cfgApp) => { const vus = []; const ancien = console.warn; console.warn = (...a) => { vus.push(a.join(' ')); }; try { const s = await monter(deps, cfgApp); return { s, vus: vus.filter(l => /lecture du tampon demandée/i.test(l)) }; } finally { console.warn = ancien; } };
    const aOn = await avertissements({}, cfgOn), aOff = await avertissements({}, cfgOff), aOk = await avertissements({ lectureTampon: fournisseur }, cfgOn);
    const STAFF_LU = '{"stamps":["staff"],"other":false,"unclear":false}';
    const postFactice = { appels: 0, corps: [], cout: 0.002, contenu: STAFF_LU };
    const post = async (url, c) => { postFactice.appels++; postFactice.corps.push(c); return { data: { choices: [{ message: { content: postFactice.contenu } }], usage: { cost: postFactice.cout } } }; };
    const aCle = await avertissements({ cleModele: 'cle-factice-du-banc', postModele: post }, cfgOn);
    H.v('0b. au montage : demandée sans fournisseur ni clé = UN avertissement ; éteinte, avec fournisseur, ou avec la clé du modèle (le fournisseur est BRANCHÉ) = aucun', [aOn.vus.length, aOff.vus.length, aOk.vus.length, aCle.vus.length], [1, 0, 0, 0]);
    await aOff.s.fermer(); await aOk.s.fermer(); await aCle.s.fermer();

    // ── 1. ÉTEINT : identique à aujourd'hui, octet pour octet, et le modèle n'est JAMAIS appelé
    LT.reinitialiser();
    {
        const ref0 = await scan(svSans); const off = await scan(svOffAvec);
        H.v('1a. éteint : la référence est la QUESTION de la chaîne à 2 (la normale et la staff), crédit réservé', [ref0.c0.statut, ids(ref0.c0), await livre(ref0)], ['a-trancher', [PA, PB], RESERVE]);
        H.v('1b. éteint, avec un fournisseur branché et une carte valide : réponse IDENTIQUE octet pour octet ; le modèle n\'est jamais appelé ; aucun compteur ne bouge ; `analyses` sans champ lectureTampon', [norm(JSON.stringify(off.j)) === norm(JSON.stringify(ref0.j)), modele.appels.length, LT.compteurs().declenchees + LT.compteurs().appels, Object.keys(await analyseDe(off.scanId)).includes('lectureTampon')], [true, 0, 0, false]);
        const sans = await scan(await aOn.s);
        H.v('1c. allumé SANS fournisseur : la question d\'avant, rien d\'appelé', [sans.c0.statut, await livre(sans), modele.appels.length], ['a-trancher', RESERVE, 0]);
        // I4 : la lecture exige les DEUX drapeaux
        const sTampon = await monter({ lectureTampon: fournisseur }, cfgTamponSeul), sEmpreinte = await monter({ lectureTampon: fournisseur }, cfgEmpreinteSeule);
        const t = await scan(sTampon), e = await scan(sEmpreinte);
        H.v('1d. V2_LECTURE_TAMPON SANS V2_EMPREINTE_EXTENSION, ou l\'inverse : la question d\'avant, le modèle n\'est jamais appelé', [t.c0.statut, ids(t.c0), e.c0.statut, ids(e.c0), modele.appels.length, await livre(t)], ['a-trancher', [PA, PB], 'a-trancher', [PA, PB], 0, RESERVE]);
        await sTampon.fermer(); await sEmpreinte.fermer();
    }

    // ── 2. ALLUMÉ, STAFF lu deux fois : le produit STAFF est AFFIRMÉ, même argent qu'une affirmation
    LT.reinitialiser(); modele.appels.length = 0;
    {
        const a = await scan(svOn);
        H.v('2a. affirmée : issue identifiee, le produit STAFF (et lui seul — jamais la normale), facturation { debite:1, reserve:0, motif:affirmee }', [a.j.analyse.statut, a.c0.statut, a.c0.carte && a.c0.carte.idProduct, a.c0.candidats.length, a.j.facturation],
            ['identifiee', 'identifiee', PB, 0, { debite: 1, reserve: 0, rembourse: false, motif: 'affirmee', raisonNonRembourse: null, poche: 'jour' }]);
        const q = await ligneQ(a.scanId);
        H.v('   grand livre : la question réservée par la chaîne est REPONDUE par le candidat STAFF, un débit « debite », aucun remboursement', [await livre(a), q && q.etat, q && q.choix.map(x => x.idProduct)], [PAYE, 'repondue', [PB]]);
        const an = await analyseDe(a.scanId);
        H.v('   le coût est journalisé dans `analyses` (déclenchée, 2 appels, confirmée, type staff) et jamais servi au client', [an.lectureTampon && an.lectureTampon.declenchee, an.lectureTampon && an.lectureTampon.appels, an.lectureTampon && an.lectureTampon.issue, an.lectureTampon && an.lectureTampon.type, JSON.stringify(a.j).includes('lectureTampon')], [true, 2, 'confirmee', 'staff', false]);
        H.v('   le fournisseur a reçu UNE fois la carte validée (JPEG, octets de la requête, jamais une URL) avec un signal d\'abandon', [modele.appels.length, modele.appels[0].signal, modele.appels[0].image, modele.appels[0].jpeg, modele.appels[0].corps], [1, true, true, true, true]);
        H.v('   compteurs : 1 déclenchée, 1 affirmée, 2 appels', [LT.compteurs().declenchees, LT.compteurs().affirmees, LT.compteurs().appels], [1, 1, 2]);
        const g = await scan(svOn, 'jumeaux');
        H.v('2b. la chaîne affirme PA, la garde des jumeaux en fait une question PA/PB : STAFF lu => PB affirmé, débit « debite », aucune question écrite', [g.c0.statut, g.c0.carte && g.c0.carte.idProduct, await livre(g), await ligneQ(g.scanId)], ['identifiee', PB, PAYE, null]);
    }

    // ── 3. toute autre issue : la question d'avant, sans débit ni remboursement de plus — JAMAIS la version normale
    {
        const cas = async (nom, parametres, issue, appels) => {
            Object.assign(modele, { lecture: 'oui', essais: ['oui', 'oui'], panne: false, sansImage: false }, parametres); const avant = modele.appels.length;
            const b = await scan(svOn); const an = await analyseDe(b.scanId);
            H.v(`3. ${nom} : la question d'avant (PA/PB), crédit réservé, journal « ${issue} », jamais la normale`, [b.c0.statut, ids(b.c0), await livre(b), an.lectureTampon && an.lectureTampon.issue, an.lectureTampon && an.lectureTampon.appels, modele.appels.length - avant], ['a-trancher', [PA, PB], RESERVE, issue, appels, 1]);
        };
        await cas('« non » deux fois (le tampon n\'est PAS lu : absence de lecture, pas preuve de la normale)', { lecture: 'non', essais: ['non', 'non'] }, 'non-confirmee', 2);
        await cas('incertain deux fois', { lecture: 'incertain', essais: ['incertain', 'incertain'] }, 'non-confirmee', 2);
        await cas('désaccord (oui puis non)', { lecture: 'desaccord', essais: ['oui', 'non'] }, 'non-confirmee', 2);
        await cas('un seul essai « oui »', { lecture: 'oui', essais: ['oui'] }, 'non-confirmee', 2);
        await cas('le fournisseur dit « oui » mais ses essais ne le disent pas (le module décide, jamais le fournisseur)', { lecture: 'oui', essais: ['oui', 'incertain'] }, 'non-confirmee', 2);
        await cas('panne du modèle (les appels tentés sont comptés)', { panne: true }, 'echec', 2);
        await cas('pas d\'octets d\'image', { sansImage: true }, 'sans-image', 0);
        H.v('   compteurs : échecs et non faisables comptés', [LT.compteurs().echecs >= 1, LT.compteurs().nonFaisables >= 1], [true, true]);
    }

    // ── 4. ÉCHEC et DÉLAI
    {
        Object.assign(modele, { lecture: 'oui', essais: ['oui', 'oui'], panne: false, sansImage: false });
        const svLent = await monter({ lectureTampon: fournisseur, delaiTamponMs: 150 }, cfgOn);
        modele.lenteurMs = 2500;
        const t0 = Date.now(); const b = await scan(svLent); const dt = Date.now() - t0; modele.lenteurMs = 0;
        H.v('4a. le modèle dépasse le délai borné : la question d\'avant, journal « delai », rendue bien avant la fin de l\'appel lent', [b.c0.statut, await livre(b), (await analyseDe(b.scanId)).lectureTampon.issue, dt < 2300], ['a-trancher', RESERVE, 'delai', true]);
        await svLent.fermer();
        const svThrow = await monter({ lectureTampon: async () => { throw new Error('boum'); } }, cfgOn);
        const c = await scan(svThrow);
        H.v('4b. le fournisseur LÈVE : la question d\'avant, journal « echec », jamais une panne client', [c.c0.statut, await livre(c), (await analyseDe(c.scanId)).lectureTampon.issue], ['a-trancher', RESERVE, 'echec']);
        await svThrow.fermer();
        const svNul = await monter({ lectureTampon: async () => null }, cfgOn);
        const d = await scan(svNul);
        H.v('4c. le fournisseur rend null : la question d\'avant', [d.c0.statut, await livre(d)], ['a-trancher', RESERVE]);
        await svNul.fermer();
    }

    // ── 5. LE COÛT NE SE DÉCLENCHE QUE SUR LE CAS VISÉ (aucune autre question ne lit le tampon)
    {
        Object.assign(modele, { lecture: 'oui', essais: ['oui', 'oui'] }); modele.appels.length = 0;
        const hors = await scan(svOn, 'hors-paire');
        H.v('5a. une question dont les candidats ne sont pas une paire séparée (PA et un tiers) : aucun appel, la question d\'avant', [hors.c0.statut, ids(hors.c0), modele.appels.length, await livre(hors)], ['a-trancher', [PA, PC], 0, RESERVE]);
        const trois = await scan(svOn, 'paire-trois');
        H.v('5b. une question à 3 (la paire et un tiers) : aucun appel — le tiers pourrait être la vérité', [trois.c0.statut, ids(trois.c0), modele.appels.length], ['a-trancher', [PA, PB, PC], 0]);
        const autre = await scan(svOn, 'lu-autre');
        H.v('5c. la photo a lu un numéro qui contredit la version STAFF : aucun appel, la question d\'avant, journal « contredit »', [autre.c0.statut, modele.appels.length, (await analyseDe(autre.scanId)).lectureTampon.issue], ['a-trancher', 0, 'contredit']);
        const svPanneJum = await monter({ lectureTampon: fournisseur, jumeaux: () => ({ conclu: false, ids: [], motif: 'jumeaux-perimes' }) }, cfgOn);
        const p = await scan(svPanneJum, 'jumeaux');
        H.v('5d. la garde des jumeaux ne conclut pas (panne 503) : aucun appel', [p.r.statut, modele.appels.length], [503, 0]);
        await svPanneJum.fermer();
    }

    // ── 6. JAMAIS DEUX FOIS POUR LE MÊME SCAN (rejeu de la clé d'idempotence)
    {
        modele.appels.length = 0;
        const x = await inst(3); const k = cle(); mode = 'paire';
        const r1 = await poster(svOn.url, x.jeton, k); const apres1 = modele.appels.length;
        const r2 = await poster(svOn.url, x.jeton, k);
        H.v('6a. même clé d\'idempotence rejouée : la même réponse, le modèle n\'est pas rappelé, un seul débit', [norm(r2.texte) === norm(r1.texte), apres1, modele.appels.length, (await livre(x)).net], [true, 1, 1, -1]);
    }

    // ── 7. LE JUMBO RESTE UNE QUESTION (C1) : aucun titre, aucune négation ne le tranche ; la règle « jumbo par le titre » n'existe plus
    {
        modele.appels.length = 0;
        const titres = ['Pikachu JUMBO promo', 'pas de jumbo', 'not a jumbo', 'sans version jumbo', 'Pikachu normale, jumbo vendue séparément', 'jumbo oversize géante'];
        const rendus = [];
        for (const t of titres) { const s = await scan(svOn, 'paire-jumbo', t); rendus.push([s.c0.statut, ids(s.c0), (await livre(s)).ouverts]); }
        H.v('7a. la paire jumbo/normale avec les DEUX drapeaux, quel que soit le titre (« jumbo », « pas de jumbo », « not a jumbo »…) : la QUESTION, crédit réservé, 0 appel au modèle', [rendus.every(r => r[0] === 'a-trancher' && JSON.stringify(r[1]) === JSON.stringify([JA, JB]) && JSON.stringify(r[2]) === JSON.stringify(['reserve'])), modele.appels.length], [true, 0]);
        const st = await scan(svOn, 'paire', 'Roaring Moon jumbo');
        H.v('7b. un titre « jumbo » sur la paire STAFF/normale : le titre ne change rien, la lecture du tampon décide (STAFF lu => PB)', [st.c0.statut, st.c0.carte && st.c0.carte.idProduct], ['identifiee', PB]);
    }

    // ── 7c. la CARTE : une seule image, la carte redressée validée ; sans carte valide, rien n'est lu
    {
        Object.assign(modele, { lecture: 'oui', essais: ['oui', 'oui'] }); modele.appels.length = 0;
        const mauvaise = (await sharp({ create: { width: 640, height: 894, channels: 3, background: { r: 1, g: 2, b: 3 } } }).jpeg().toBuffer()).toString('base64');
        const png = (await sharp({ create: { width: 420, height: 587, channels: 3, background: { r: 1, g: 2, b: 3 } } }).png().toBuffer()).toString('base64');
        const cas = [['aucune carte', null], ['une carte 640 × 894 (pas 420 × 587)', mauvaise], ['un PNG 420 × 587 (pas un JPEG)', png], ['du texte', 'pas une carte !']];
        const sortie = [];
        for (const [, emp] of cas) { const s = await scan(svOn, 'paire', null, undefined, emp); sortie.push([s.c0.statut, (await livre(s)).ouverts]); }
        H.v('7c. aucune carte, une carte hors format, un PNG, du texte : la question d\'avant (réservée), 0 appel — pas de photo pleine, pas de repli', [sortie.every(s => s[0] === 'a-trancher' && JSON.stringify(s[1]) === JSON.stringify(['reserve'])), modele.appels.length], [true, 0]);
    }

    // ── 8. LES PRIX MÉLANGÉS (règle 2) : une fiche à produit unique marquée, STAFF lu => la mention de la règle 2 remplace la règle 3 ; le verdict ne change pas
    {
        const prix = x => x.c0.carte && x.c0.carte.prixGuide && x.c0.carte.prixGuide.reserves;
        Object.assign(modele, { lecture: 'oui', essais: ['oui', 'oui'], panne: false, sansImage: false }); modele.appels.length = 0;
        const refX = await scan(svSans, 'prix-seul'), a = await scan(svOn, 'prix-seul');
        H.v('8a. éteint : la règle 3 (« peut être gonflé »), le modèle jamais appelé', [refX.c0.carte.idProduct, prix(refX)], [PX, ['prix-indicatif-tampons-melanges', 'peut-etre-gonfle-par-tampons']]);
        H.v('8b. allumé, STAFF lu deux fois : MÊME produit (le verdict ne change pas), la mention de la règle 2 À LA PLACE de la règle 3, jamais fiable, débit 1', [a.c0.carte.idProduct, prix(a), a.c0.carte.prixGuide.fiable, await livre(a), (await analyseDe(a.scanId)).lectureTampon.type], [PX, ['prix-indicatif-tampons-melanges', 'version-tamponnee-prix-sous-estime'], false, PAYE, 'prix']);
        Object.assign(modele, { lecture: 'non', essais: ['non', 'non'] });
        const n = await scan(svOn, 'prix-seul');
        H.v('8c. « non » deux fois : la règle 3 reste', [n.c0.carte.idProduct, prix(n), await livre(n)], [PX, ['prix-indicatif-tampons-melanges', 'peut-etre-gonfle-par-tampons'], PAYE]);
        // LOT TAMPONS : n'importe quelle marque de la liste lue deux fois (League, une enseigne…) donne la règle 2 ; une marque hors liste, des ensembles qui diffèrent ou rien : la règle 3
        const mentionPour = async (essais, lecture) => { Object.assign(modele, { lecture, essais }); return prix(await scan(svOn, 'prix-seul')); };
        const R2 = ['prix-indicatif-tampons-melanges', 'version-tamponnee-prix-sous-estime'], R3 = ['prix-indicatif-tampons-melanges', 'peut-etre-gonfle-par-tampons'];
        H.v('8d. I3 : [league] lu deux fois (variante PROUVÉE d\'un produit de la fiche) : la règle 2 ; [kfc] ou [cosmo] (aucun produit de la fiche ne les porte : le faux positif Rayquaza, le logo imprimé), un sur-ensemble : la règle 3 ; `autre`, [league] puis [kfc], aucune marque, incertain : la règle 3', [await mentionPour([{ marques: ['league'] }, { marques: ['league'] }], 'marques'), await mentionPour([{ marques: ['kfc'] }, { marques: ['kfc'] }], 'marques'),
            await mentionPour([{ autre: true }, { autre: true }], 'autre'), await mentionPour([{ marques: ['league'] }, { marques: ['kfc'] }], 'desaccord'), await mentionPour([{ marques: [] }, { marques: [] }], 'aucune'), await mentionPour(['incertain', 'incertain'], 'incertain'),
            await mentionPour([{ marques: ['league'] }, { autre: true }], 'marques'), await mentionPour([{ marques: ['cosmo'] }, { marques: ['cosmo'] }], 'marques'), await mentionPour([{ marques: ['league', 'staff'] }, { marques: ['league', 'staff'] }], 'marques')], [R2, R3, R3, R3, R3, R3, R3, R3, R3]);              // le dernier : le fournisseur dit « marques » (à tort), ses essais ne le disent pas
        Object.assign(modele, { lecture: 'oui', essais: ['oui', 'oui'] });
    }

    // ── 9. I1 : le fournisseur de PRODUCTION (branché au montage par le client du modèle) compte CHAQUE appel dans le plafond GLOBAL de dépense, et ne part plus au plafond
    {
        const un = (x, o = {}) => ({ ...x, ...o });
        const svP = await monter({ cleModele: 'cle-factice-du-banc', postModele: post, voisinsEmpreinte: voisinsMuet }, cfgPlafond);
        const jourId = `jour:${require('../argent/offre').jourDeParis(new Date())}`;
        await raw('depense_modele').deleteMany({}); Object.assign(postFactice, { appels: 0, corps: [], cout: 0.002, contenu: STAFF_LU });
        const a = await scan(svP);
        H.v('9a. fournisseur de production (client du modèle fabriqué) : STAFF lu deux fois => PB affirmé ; 2 appels du client ; la consigne ne pose que la question STAFF ; le coût réel est demandé', [a.c0.carte && a.c0.carte.idProduct, postFactice.appels, /STAFF/.test(postFactice.corps[0].messages[0].content[0].text), postFactice.corps[0].usage], [PB, 2, true, { include: true }]);
        const d = await raw('depense_modele').findOne({ _id: jourId });
        H.v('9b. CHAQUE appel est compté dans le plafond global (2 appels à 0,002 $ = 4 000 µ$)', [d && d.microUsd, d && d.appels], [4000, 2]);
        // plafond franchi PENDANT la lecture : le second appel n'est pas émis, la question reste
        await raw('depense_modele').deleteMany({}); await raw('depense_modele').insertOne({ _id: jourId, microUsd: 7500, appels: 1, expireLe: new Date(Date.now() + 86400e3) });
        Object.assign(postFactice, { appels: 0, corps: [], cout: 0.006 });
        const b = await scan(svP);
        H.v('9c. le plafond du jour (0,01 $) est franchi par le premier appel : le second n\'est PAS émis (1 appel au client), la question d\'avant, crédit réservé, journal « echec »', [b.c0.statut, ids(b.c0), postFactice.appels, await livre(b), (await analyseDe(b.scanId)).lectureTampon.issue], ['a-trancher', [PA, PB], 1, RESERVE, 'echec']);
        const apres = await raw('depense_modele').findOne({ _id: jourId });
        H.v('   et le compte du jour reflète l\'appel émis seulement (7 500 + 6 000 = 13 500 µ$), pas de second appel compté', [apres.microUsd, apres.appels], [13500, 2]);
        void un;
        await svP.fermer();
    }

    // ── 10. I3 : les quatre gardes de la décision ont chacune leur banc (appel DIRECT de la décision de la route)
    {
        modele.appels.length = 0; Object.assign(modele, { lecture: 'oui', essais: ['oui', 'oui'], panne: false, sansImage: false });
        const ligne = id => ({ idProduct: id, nomCardmarket: 'Roaring Moon ex', set: { slug: 'banc', nom: 'Banc' }, numero: '162' });
        const PRODUITS = new Map([[PA, ligne(PA)], [PB, ligne(PB)]]);
        const question = (extra = {}) => ({ issue: 'question', analyse: { cartes: [{ candidats: [{ idProduct: PA }, { idProduct: PB }] }] }, ...extra });
        const affirmer = (id, s, critere) => ({ issue: 'affirmee', analyse: { cartes: [{ carte: { idProduct: id } }] }, critere });
        const entree = { empreintes: { rejet: null, modele: null, entrees: [{ photo: 0, vecteur: 'AAAA', redressee: true, carte: CARTE }] } };
        const base = { deps: { lectureTampon: fournisseur }, cfg: cfgOn, entree, scanId: 'scan-direct-0', resultat: question(), corpsChaine: { success: true, carte: { numero: '162', setCode: 'PRE' } }, produits: PRODUITS, version: VERSION_MAR, affirmer, avecBorne: f => f() };
        const appels = () => modele.appels.length;
        const a0 = appels(); const ok = await consulterLectureTampon(base);
        H.v('10 témoin : la décision appelée directement affirme la Staff (le montage des gardes ci-dessous est celui qui marche)', [ok && ok.resultat && ok.resultat.analyse.cartes[0].carte.idProduct, appels() - a0], [PB, 1]);
        // (1) premiereFois : un MÊME scan ne lit qu'une fois
        const a1 = appels(); const deux = await consulterLectureTampon(base);
        H.v('10a. gardes 1 — le même scanId consulté une seconde fois : « deja-tentee », aucun appel, aucune affirmation', [deux.trace.issue, deux.resultat, appels() - a1], ['deja-tentee', undefined, 0]);
        // (2) motif / contradiction de la garde : une question née d'un refus de la garde des jumeaux ou de la contradiction ne se lit pas
        const a2 = appels();
        const r2 = [await consulterLectureTampon({ ...base, scanId: 'scan-direct-1', resultat: question({ motif: 'jumeaux-trop-nombreux' }) }), await consulterLectureTampon({ ...base, scanId: 'scan-direct-2', resultat: question({ contradiction: 'contredit par numero' }) })];
        H.v('10b. garde 2 — une question avec `motif` ou `contradiction` : rien (null), aucun appel', [r2, appels() - a2], [[null, null], 0]);
        // (3) colonneMarquages : une archive d'avant (sans la colonne) ne conclut rien
        const a3 = appels();
        const r3 = [await consulterLectureTampon({ ...base, scanId: 'scan-direct-3', version: VERSION_SANS }), await consulterLectureTampon({ ...base, scanId: 'scan-direct-4', version: { colonneMarquages: false, entree: id => VERSION_MAR.entree(id) } }), await consulterLectureTampon({ ...base, scanId: 'scan-direct-5', version: null })];
        H.v('10c. garde 3 — l\'archive SANS colonne des marquages (ou sans version) : rien (null), aucun appel, même si l\'entrée de la paire existe', [r3, VERSION_SANS.colonneMarquages, appels() - a3], [[null, null, null], false, 0]);
        // (4) prixMelangeTampon === true : « true » (texte), 1, null ne marquent rien
        const a4 = appels();
        const ligneX = v => new Map([[PX, { ...ligne(PX), prixMelangeTampon: v, marques: ['staff'] }]]);       // I3 : la variante staff du produit est prouvée
        const affX = { issue: 'affirmee', analyse: { cartes: [{ carte: { idProduct: PX } }] } };
        const r4 = [];
        for (const [i, v] of ['true', 1, null, undefined, 'oui'].entries()) r4.push(await consulterLectureTampon({ ...base, scanId: `scan-prix-${i}`, resultat: affX, produits: ligneX(v) }));
        H.v('10d. garde 4 — prixMelangeTampon « true » (texte), 1, null, absent, « oui » : rien (null), aucun appel ; seul `true` lit', [r4, appels() - a4], [[null, null, null, null, null], 0]);
        const vrai = await consulterLectureTampon({ ...base, scanId: 'scan-prix-vrai', resultat: affX, produits: ligneX(true) });
        H.v('   témoin : prixMelangeTampon === true lit, et la mention est posée', [vrai && vrai.trace.issue, appels() - a4], ['confirmee', 1]);
        // les deux drapeaux, au niveau de la décision elle-même
        const a5 = appels();
        const r5 = [await consulterLectureTampon({ ...base, scanId: 'scan-d-1', cfg: { lectureTampon: true, empreinteExtension: false } }), await consulterLectureTampon({ ...base, scanId: 'scan-d-2', cfg: { lectureTampon: false, empreinteExtension: true } }), await consulterLectureTampon({ ...base, scanId: 'scan-d-3', deps: {} })];
        H.v('10e. un seul drapeau, ou aucun fournisseur : rien (null), aucun appel', [r5, appels() - a5], [[null, null, null], 0]);
    }

    // ── 12. LOT TAMPONS : l'ENSEMBLE de marques lu doit être EXACTEMENT celui du produit tamponné de la paire (variante prouvée). Rien d'autre n'affirme.
    {
        const M = (...m) => ({ marques: m }), AUT = { autre: true };
        const lire12 = async (mode12, essais, lecture = 'marques', ancre = null) => {
            Object.assign(modele, { lecture, essais, panne: false, sansImage: false, lenteurMs: 0 }); modele.appels.length = 0;
            const s = await scan(svOn, mode12); const an = await analyseDe(s.scanId);
            return { s, an, lt: an.lectureTampon || null, id: s.c0.carte && s.c0.carte.idProduct, statut: s.c0.statut, appels: modele.appels.length, ancre };
        };
        const juste = await lire12('paire-league', [M('league'), M('league')]);
        H.v('12a. paire league/normale, [league] lu deux fois : le produit LEAGUE (LB) est affirmé, jamais la normale ; la trace dit le type, les marques lues et l\'accord', [juste.statut, juste.id, juste.lt && juste.lt.type, juste.lt && juste.lt.marques, juste.lt && juste.lt.accord, juste.lt && juste.lt.issue, await livre(juste.s)], ['identifiee', LB, 'league', ['league'], true, 'confirmee', PAYE]);
        const sp = await lire12('paire-staff-prerelease', [M('staff', 'prerelease'), M('prerelease', 'staff')]);
        H.v('12b. paire staff+prerelease/normale, les deux marques lues deux fois (dans un ordre ou l\'autre) : le produit staff+prerelease (SB) est affirmé', [sp.statut, sp.id, sp.lt && sp.lt.type, sp.lt && sp.lt.marques], ['identifiee', SB, 'staff+prerelease', ['staff', 'prerelease']]);
        // tout le reste : la question d'avant, crédit réservé, 2 lectures faites (le coût), jamais la normale
        const nonConf = async (nom, mode12, essais, lecture, issueAttendue, raisonRe) => {
            const x = await lire12(mode12, essais, lecture);
            H.v(`12c. ${nom} : la question d'avant, crédit réservé, journal « ${issueAttendue} », jamais la normale`, [x.statut, x.id === LA || x.id === SA, x.lt && x.lt.issue, raisonRe ? raisonRe.test(x.lt.raison) : true, JSON.stringify(await livre(x.s))], ['a-trancher', false, issueAttendue, true, JSON.stringify(RESERVE)]);
            return x;
        };
        const avantSansProduit = LT.compteurs().marquesSansProduit;
        const sousEns = await nonConf('paire staff+prerelease, mais seulement [staff] lu deux fois (un SOUS-ensemble : le produit staff n\'existe pas dans la paire)', 'paire-staff-prerelease', [M('staff'), M('staff')], 'marques', 'non-confirmee', /ne sont pas celles du produit/);
        H.v('   … la trace garde ce qui a été lu', [sousEns.lt.marques, sousEns.lt.accord, sousEns.lt.type], [['staff'], true, 'staff+prerelease']);
        await nonConf('paire league, mais [staff] lu deux fois (une AUTRE marque)', 'paire-league', [M('staff'), M('staff')], 'marques', 'non-confirmee', /ne sont pas celles du produit/);
        await nonConf('paire league, mais [league, place-2] lu deux fois (un SUR-ensemble)', 'paire-league', [M('league', 'place-2'), M('league', 'place-2')], 'marques', 'non-confirmee', /ne sont pas celles du produit/);
        H.v('   … les trois lectures « aucun produit de la paire ne porte ces marques » sont COMPTÉES (marquesSansProduit +3) ; les autres refus (rien lu, autre, désaccord) ne le sont pas', LT.compteurs().marquesSansProduit - avantSansProduit, 3);
        await nonConf('paire league, [league] puis [league, place-2] (désaccord)', 'paire-league', [M('league'), M('league', 'place-2')], 'desaccord', 'non-confirmee', null);
        await nonConf('paire league, AUCUNE marque lue deux fois (un tampon manqué n\'est pas un tampon absent)', 'paire-league', [M(), M()], 'aucune', 'non-confirmee', null);
        await nonConf('paire league, une marque HORS liste (`autre`) lue', 'paire-league', [AUT, AUT], 'autre', 'non-confirmee', null);
        await nonConf('paire league, `autre` d\'un côté et [league] de l\'autre', 'paire-league', [AUT, M('league')], 'desaccord', 'non-confirmee', null);
        await nonConf('paire league, incertain deux fois', 'paire-league', ['incertain', 'incertain'], 'incertain', 'non-confirmee', null);
        const faux = await nonConf('paire league : le FOURNISSEUR annonce « marques » mais ses essais ne le disent pas (le module décide, jamais le fournisseur)', 'paire-league', [M('league'), AUT], 'marques', 'non-confirmee', null);
        H.v('   … le fournisseur n\'est consulté qu\'UNE fois par scan (le coût de ses deux essais est compté par le plafond de dépense, pas ici)', faux.appels, 1);
        // le fournisseur annonce [staff] (modele.lecture 'oui') mais ses essais sont [league] : la route ne se fie qu'aux essais
        Object.assign(modele, { lecture: 'oui', essais: [M('league'), M('league')], panne: false, sansImage: false }); modele.appels.length = 0;
        const trompe = await scan(svOn, 'paire-league');
        H.v('12d. le fournisseur annonce des marques ([staff]) que ses essais ([league]) ne portent pas : c\'est l\'ensemble DES ESSAIS qui compte (LB, league), pas celui que le fournisseur annonce', [trompe.c0.statut, trompe.c0.carte && trompe.c0.carte.idProduct], ['identifiee', LB]);
        // la paire STAFF d'avant n'a pas changé : [staff] lu deux fois affirme PB ; [staff, prerelease] sur la paire staff : la question
        const staffPlus = await lire12('paire', [M('staff', 'prerelease'), M('staff', 'prerelease')]);
        H.v('12e. la paire staff/normale d\'avant : [staff, prerelease] lu deux fois n\'affirme PAS le produit staff (un autre ensemble) ; [staff] l\'affirme toujours', [staffPlus.statut, staffPlus.id === PB, staffPlus.lt && staffPlus.lt.issue, (await lire12('paire', [M('staff'), M('staff')])).id], ['a-trancher', false, 'non-confirmee', PB]);
        Object.assign(modele, { lecture: 'oui', essais: ['oui', 'oui'], panne: false, sansImage: false });
    }

    // ── 11. le contrat : rien de neuf pour le client que l'issue (une affirmation de plus) et la mention fermée de la règle 2
    H.vrai(`11. ${reponsesValidees} réponses d'analyse jugées contre le contrat OpenAPI, ${ecartsContrat} écart(s)`, ecartsContrat === 0 && reponsesValidees >= 15);

    for (const s of [svSans, svOffAvec, svOn, aOn.s]) await s.fermer();
    E.vider();
    if (cleEnv !== undefined) process.env.OPENROUTER_API_KEY = cleEnv;
    await mongoose.disconnect(); await H.arreterBanc();
    H.bilan();
})().catch(async e => { console.error('❌', e); try { await H.arreterBanc(); } catch (_) { } process.exit(1); });
