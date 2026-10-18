'use strict';
// F1-TAMPON — la ROUTE et l'ARGENT : du débit à la réponse, derrière l'interrupteur V2_LECTURE_TAMPON (défaut 0).
// Base : la base EN MÉMOIRE du banc — jamais la production, ni la grappe, ni R2. Aucun réseau, AUCUN appel payant : la chaîne héritée et le fournisseur de lecture du tampon sont FABRIQUÉS (deps.gererIdentifier,
// deps.lectureTampon) ; le « modèle » est une fonction de ce fichier.
// Ce que le banc tient : éteint, la réponse est la même OCTET POUR OCTET que sans fournisseur ; allumé, seule la lecture « STAFF » deux fois (ou le titre jumbo, à part) change une question en affirmation du
// produit STAFF (même argent qu'une affirmation : débit 1, rien de réservé) ; tout le reste rend la réponse d'AVANT, sans débit ni remboursement de plus ; ON N'AFFIRME JAMAIS LA VERSION NORMALE.
const H = require('./_harnais');
const mongoose = require('mongoose');
const db = require('../db'); const M = require('../modeles'); const J = require('../comptes/jetons'); const Q = require('./_aide-quota');
const { lireConfig } = require('../config'); const { valider } = require('../openapi/valider'); const SCHEMA = require('../openapi/openapi.v2.json');
const LT = require('../identifier/lecture-tampon');
const path = require('path');
const CHARGES = path.join(__dirname, '..', '..', 'verrou', 'charges.json');
const IMAGE = require(CHARGES).charges.find(c => c.cellule === 'occidentale').imageUrl;
const ref = n => ({ $ref: `#/components/schemas/${n}` });
const base = { MONGODB_BASE: 'test_scratch', V2_HEBDO: '0' };
const cfgOff = lireConfig(base);
const cfgOn = lireConfig({ ...base, V2_LECTURE_TAMPON: '1' });
const cfgJumbo = lireConfig({ ...base, V2_LECTURE_TAMPON: '1', V2_LECTURE_TAMPON_JUMBO: '1' });
const cfgJumboSeul = lireConfig({ ...base, V2_LECTURE_TAMPON_JUMBO: '1' });
const ORIGINE = cfgOff.origines.extension;
let nIp = 0; const ip = () => { nIp++; return { 'x-forwarded-for': `10.15.${Math.floor(nIp / 250)}.${nIp % 250 + 1}` }; };
let nCle = 0; const cle = () => `banc-tampon-${Date.now().toString(36)}-${++nCle}`;
const raw = n => mongoose.connection.db.collection(n);
const E = require('../chargeur/etat'); const { creerConstructeur } = require('../chargeur/version'); const VB = require('./_visuels-banc');
const PA = 895831, PB = 895832, PC = 895833, JA = 895841, JB = 895842, PX = 895851, EXP = 990031, EXPJ = 990032, EXPX = 990033, META = 990131, METAJ = 990132, METAX = 990133;
let ecartsContrat = 0, reponsesValidees = 0;

async function inst(essais = 3) {
    const jeton = J.genererJeton(); const i = M.nouvelleInstallation({ jetonEmpreinte: J.empreinte(jeton), essais, libelle: 'banc' });
    await db.col('installations').insertOne(i); return { i, jeton };
}
const corps = (o = {}) => ({ contrat: 2, imageUrls: [IMAGE], title: null, description: null, prixVinted: null, devise: null, marche: 'vinted.fr', versionExtension: '2.0.0', langueInterface: 'fr', ...o });
async function poster(url, jeton, cleIdem = cle(), titre = null) {
    const r = await H.appel(url, '/api/identifier', { methode: 'POST', corps: corps({ title: titre }), entetes: { origin: ORIGINE, ...ip(), authorization: `Bearer ${jeton}`, 'idempotency-key': cleIdem } });
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
    await H.ouvrirBancV2();
    await Q.eviterMinuit();
    process.env.MONGODB_BASE = 'test_scratch';
    const { connecterMongo } = require('../../mongo-connexion');
    await connecterMongo({ script: 'test-lecture-tampon-route.js', ecrit: true });
    db.brancher(mongoose.connection.db);
    await M.creerIndex();
    for (const c of ['catalogue_produits', 'numeros_cartes', 'guide_prix', 'codes_set']) await raw(c).deleteMany({});
    for (const [e, code] of [[EXP, 'PRE'], [EXPJ, 'PRJ'], [EXPX, 'PRX']]) await raw('codes_set').insertOne({ idExpansion: e, codeSet: code, apprisLe: new Date() });
    const SEMIS = [[PA, EXP, META, 'PRE', '162', {}], [PB, EXP, META, 'PRE', '162', {}], [PC, EXP, META + 1, 'PRE', '170', {}], [JA, EXPJ, METAJ, 'PRJ', '5', {}], [JB, EXPJ, METAJ, 'PRJ', '5', {}], [PX, EXPX, METAX, 'PRX', '9', { prixMelangeTampon: true }]];
    for (const [id, exp, meta, code, numero, plus] of SEMIS) {
        await raw('catalogue_produits').insertOne({ idProduct: id, name: 'Roaring Moon ex', idExpansion: exp, idMetacard: meta });
        await raw('numeros_cartes').insertOne({ idProduct: id, idExpansion: exp, numero, numeroUrl: `${code}${numero}`, codeSet: code, nomFr: 'Roaring Moon ex', slug: `Roaring-Moon-ex-${code}${numero}-${id}`, slugSet: 'Banc-Set', source: 'cardmarket', certitude: 'exacte', ...plus });
        await raw('guide_prix').insertOne({ idProduct: id, avg: 1.1, low: 0.5, trend: 1.0, avg1: 1.0, avg7: 1.0, avg30: 1.1, guideDu: new Date('2026-10-04') });
    }
    // l'archive du banc, AVEC la colonne des marquages : la paire staff (PA normale / PB staff), la paire jumbo (JA / JB), un produit marqué seul (PX), un tiers (PC)
    const mar = (id, extra) => VB.doc(id, { variante: 'normale', total: '131', ...extra });
    const b = creerConstructeur({ marquages: true });
    for (const d of [
        mar(PA, { idMetacard: META, variante: 'normale', partageeTamponNonSepare: false, produitsPartages: [PA, PB], tamponNonRepresente: 'Staff' }),
        mar(PB, { idMetacard: META, variante: 'staff', partageeTamponNonSepare: false, produitsPartages: [PA, PB], tamponNonRepresente: 'Staff' }),
        mar(PC, { idMetacard: META + 1 }),
        mar(JA, { idMetacard: METAJ, variante: 'normale', numero: '5', partageeTamponNonSepare: false, produitsPartages: [JA, JB] }),
        mar(JB, { idMetacard: METAJ, variante: 'jumbo', numero: '5', partageeTamponNonSepare: false, produitsPartages: [JA, JB] }),
        mar(PX, { idMetacard: METAX, numero: '9' })]) b.entree(d);
    E.installer(b.finir());

    const express = require('express'); const pret = require('../pret'); const registre = require('../registre');
    const { dansUnScan } = require('../../sources'); const { assembler } = require('../index');
    let mode = 'paire';
    const ETAT = { estimeIA: null, confianceIA: null, defautsVus: [], declareVendeur: null, declareCardmarket: null, retenu: null };
    const cand = (id, numero = '162') => ({ idProduct: id, nom: 'Roaring Moon ex', numero, set: 'Banc Set', prix: 1, photoUrl: null });
    const enTete = { etat: ETAT, classement: [], guidePrix: {}, reverse: { attendue: false, motif: null, etat: 'aucun-motif', strategie: null }, codeLangue: 2 };
    const chaine = async (req, res) => {
        const sid = String(req.scanIdImpose);
        const qui = { paire: [PA, PB], 'paire-trois': [PA, PB, PC], 'hors-paire': [PA, PC], 'paire-jumbo': [JA, JB], 'lu-autre': [PA, PB] }[mode];
        if (qui) {                                                   // la chaîne POSE la question (réserve le crédit) : elle n'affirme rien
            await req.credit.v2.poserQuestion(req, { scanId: req.scanIdImpose, raison: 'egalite-sans-enjeu', candidats: qui });
            const numero = mode === 'paire-jumbo' ? '5' : mode === 'lu-autre' ? '999' : '162';
            return res.json({ success: true, scanId: sid, question: { etat: 'en-attente', delaiHeures: 24 }, ...enTete, candidats: qui.map(i => cand(i, numero)),
                carte: { idProduct: qui[0], nomProduit: 'Roaring Moon ex', nom: 'Roaring Moon ex', numero, setCode: mode === 'paire-jumbo' ? 'PRJ' : 'PRE', total: '131', rarete: null, langue: 'FR', ambigu: true } });
        }
        const id = mode === 'jumeaux' ? PA : PX;                      // la chaîne AFFIRME : PA (la garde des jumeaux en fait une question avec PB) ou PX (le produit marqué seul)
        const code = id === PX ? 'PRX' : 'PRE', numero = id === PX ? '9' : '162';
        return res.json({ success: true, scanId: sid, question: null, ...enTete, candidats: [cand(id, numero)], carte: { idProduct: id, nomProduit: 'Roaring Moon ex', nom: 'Roaring Moon ex', numero, setCode: code, total: '131', rarete: null, langue: 'FR', ambigu: false } });
    };
    // le « modèle » factice
    const modele = { appels: [], lecture: 'oui', essais: ['oui', 'oui'], cout: 2, panne: false, lenteurMs: 0, sansImage: false };
    const fournisseur = async ({ image, signal, corps: c, scanId, compteur }) => {
        modele.appels.push({ scanId: String(scanId), image: Buffer.isBuffer(image), signal: Boolean(signal), corps: Boolean(c) });
        if (modele.sansImage) return { lecture: 'incertain', essais: [], echec: false, sansImage: true, raison: 'aucune image' };
        if (compteur) compteur.appels = (compteur.appels || 0) + modele.cout;
        if (modele.lenteurMs) await new Promise(r => setTimeout(r, modele.lenteurMs));
        if (modele.panne) return { lecture: 'incertain', essais: [], echec: true, raison: 'panne factice' };
        return { lecture: modele.lecture, essais: modele.essais, echec: false, raison: 'factice' };
    };
    const JUM = { [PA]: [PB] };
    const monter = async (deps = {}, cfgApp = cfgOn) => {
        const app = express(); app.set('trust proxy', true); app.use(express.json()); app.use((q, s, n) => dansUnScan(n));
        pret.armer(require('../modeles').verifierIndex);
        app.use(assembler([require('../argent/monter'), require('../identifier/monter')], cfgApp, { jumeaux: id => ({ conclu: true, ids: JUM[id] || [] }), gererIdentifier: chaine, gererRetourLive: async (q, s) => s.json({ success: true }), ...deps }));
        return H.serveur(app);
    };
    const scan = async (s, m = 'paire', titre = null, cleIdem) => { mode = m; const x = await inst(3); const r = await poster(s.url, x.jeton, cleIdem, titre); const j = r.json || {}; return { ...x, r, j, scanId: j.scanId, c0: j.analyse && j.analyse.cartes[0] }; };
    const ligneQ = async scanId => raw('questions_v2').findOne({ _id: `${scanId}:0` });
    const svSans = await monter({}, cfgOff), svOffAvec = await monter({ lectureTampon: fournisseur }, cfgOff), svOn = await monter({ lectureTampon: fournisseur }, cfgOn);
    const avertissements = async (deps, cfgApp) => { const vus = []; const ancien = console.warn; console.warn = (...a) => { vus.push(a.join(' ')); }; try { const s = await monter(deps, cfgApp); return { s, vus: vus.filter(l => /lecture du tampon/i.test(l)) }; } finally { console.warn = ancien; } };
    const aOn = await avertissements({}, cfgOn), aOff = await avertissements({}, cfgOff), aOk = await avertissements({ lectureTampon: fournisseur }, cfgOn);
    H.v('0. au montage : demandée sans fournisseur = UN avertissement ; éteinte, ou allumée avec fournisseur = aucun', [aOn.vus.length, aOff.vus.length, aOk.vus.length], [1, 0, 0]);
    await aOff.s.fermer(); await aOk.s.fermer();

    // ── 1. ÉTEINT : identique à aujourd'hui, octet pour octet, et le modèle n'est JAMAIS appelé
    LT.reinitialiser();
    {
        const ref0 = await scan(svSans); const off = await scan(svOffAvec);
        H.v('1a. éteint : la référence est la QUESTION de la chaîne à 2 (la normale et la staff), crédit réservé', [ref0.c0.statut, ids(ref0.c0), await livre(ref0)], ['a-trancher', [PA, PB], RESERVE]);
        H.v('1b. éteint, avec un fournisseur branché : réponse IDENTIQUE octet pour octet ; le modèle n\'est jamais appelé ; aucun compteur ne bouge ; `analyses` sans champ lectureTampon', [norm(JSON.stringify(off.j)) === norm(JSON.stringify(ref0.j)), modele.appels.length, LT.compteurs().declenchees + LT.compteurs().appels, Object.keys(await analyseDe(off.scanId)).includes('lectureTampon')], [true, 0, 0, false]);
        const sans = await scan(await aOn.s);
        H.v('1c. allumé SANS fournisseur : la question d\'avant, rien d\'appelé', [sans.c0.statut, await livre(sans), modele.appels.length], ['a-trancher', RESERVE, 0]);
        const jSeul = await monter({}, cfgJumboSeul); const js = await scan(jSeul, 'paire-jumbo', 'Pikachu jumbo');
        H.v('1d. le jumbo seul (V2_LECTURE_TAMPON éteint) : la question d\'avant — il n\'agit que si V2_LECTURE_TAMPON est allumé aussi', [js.c0.statut, ids(js.c0), await livre(js)], ['a-trancher', [JA, JB], RESERVE]);
        await jSeul.fermer();
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
        H.v('   le fournisseur a reçu la requête une fois, avec un signal d\'abandon ; aucune URL de photo ne lui est donnée', [modele.appels.length, modele.appels[0].signal, modele.appels[0].image, modele.appels[0].corps], [1, true, false, true]);
        H.v('   compteurs : 1 déclenchée, 1 affirmée, 2 appels', [LT.compteurs().declenchees, LT.compteurs().affirmees, LT.compteurs().appels], [1, 1, 2]);
        // la voie de la GARDE DES JUMEAUX : la chaîne affirme PA, la garde en fait une question (PA, PB) — sans question réservée par la chaîne
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
        const jum = await scan(svOn, 'paire-jumbo', 'Pikachu jumbo');
        H.v('5e. la paire jumbo/normale avec V2_LECTURE_TAMPON seul (jumbo éteint) : aucun appel, la question d\'avant', [jum.c0.statut, ids(jum.c0), modele.appels.length], ['a-trancher', [JA, JB], 0]);
    }

    // ── 6. JAMAIS DEUX FOIS POUR LE MÊME SCAN
    {
        modele.appels.length = 0;
        const x = await inst(3); const k = cle(); mode = 'paire';
        const r1 = await poster(svOn.url, x.jeton, k); const apres1 = modele.appels.length;
        const r2 = await poster(svOn.url, x.jeton, k);
        H.v('6a. même clé d\'idempotence rejouée : la même réponse, le modèle n\'est pas rappelé, un seul débit', [norm(r2.texte) === norm(r1.texte), apres1, modele.appels.length, (await livre(x)).net], [true, 1, 1, -1]);
    }

    // ── 7. LE JUMBO : le titre, une liste fermée, SANS appel au modèle, derrière son propre interrupteur
    {
        modele.appels.length = 0;
        const svJ = await monter({ lectureTampon: fournisseur }, cfgJumbo);
        const a = await scan(svJ, 'paire-jumbo', 'Pikachu JUMBO promo');
        H.v('7a. titre « jumbo » + paire jumbo/normale : le produit JUMBO est affirmé (débit 1), journal « jumbo », 0 appel au modèle', [a.c0.statut, a.c0.carte && a.c0.carte.idProduct, await livre(a), (await analyseDe(a.scanId)).lectureTampon.type, (await analyseDe(a.scanId)).lectureTampon.appels, modele.appels.length], ['identifiee', JB, PAYE, 'jumbo', 0, 0]);
        const n = await scan(svJ, 'paire-jumbo', 'Pikachu promo');
        H.v('7b. titre sans le mot : la question d\'avant', [n.c0.statut, ids(n.c0), await livre(n)], ['a-trancher', [JA, JB], RESERVE]);
        const neg = await scan(svJ, 'paire-jumbo', 'pas jumbo');
        H.v('7c. « pas jumbo » : la question d\'avant', [neg.c0.statut, await livre(neg)], ['a-trancher', RESERVE]);
        const st = await scan(svJ, 'paire', 'Roaring Moon jumbo');
        H.v('7d. le titre dit « jumbo » mais la paire est STAFF/normale : le titre ne tranche pas une paire staff — la lecture du tampon, elle, décide (ici : STAFF lu => PB)', [st.c0.statut, st.c0.carte && st.c0.carte.idProduct, (await analyseDe(st.scanId)).lectureTampon.type], ['identifiee', PB, 'staff']);
        await svJ.fermer();
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
        H.v('8c. « non » deux fois : la règle 3 reste (un tampon non lu n\'est pas un tampon absent, mais n\'est pas lu non plus)', [n.c0.carte.idProduct, prix(n), await livre(n)], [PX, ['prix-indicatif-tampons-melanges', 'peut-etre-gonfle-par-tampons'], PAYE]);
    }

    // ── 9. le contrat : rien de neuf pour le client que l'issue (une affirmation de plus) et la mention fermée de la règle 2
    H.vrai(`9. ${reponsesValidees} réponses d'analyse jugées contre le contrat OpenAPI, ${ecartsContrat} écart(s)`, ecartsContrat === 0 && reponsesValidees >= 15);

    for (const s of [svSans, svOffAvec, svOn, aOn.s]) await s.fermer();
    E.vider();
    await mongoose.disconnect(); await H.arreterBanc();
    H.bilan();
})().catch(async e => { console.error('❌', e); try { await H.arreterBanc(); } catch (_) { } process.exit(1); });
