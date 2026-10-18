'use strict';
// SECONDE-LECTURE — la ROUTE et l'ARGENT : du débit à la réponse, derrière l'interrupteur V2_SECONDE_LECTURE (défaut 0).
// Base : la base EN MÉMOIRE du banc — jamais la production, ni la grappe, ni R2. Aucun réseau, AUCUN appel payant : la chaîne héritée et le fournisseur de seconde lecture sont FABRIQUÉS
// (deps.gererIdentifier, deps.secondeLecture) ; le « modèle » est une fonction de ce fichier.
// Ce que le banc tient : éteint, la réponse est la même OCTET POUR OCTET que sans fournisseur ; allumé, seule la CONFIRMATION change une question en affirmation (même argent qu'une
// affirmation : débit 1, rien de réservé) ; tout le reste (autre lecture, échec, délai, deuxième passage) rend la réponse d'AVANT, sans débit ni remboursement de plus ; le coût est journalisé.
const H = require('./_harnais');
const mongoose = require('mongoose');
const db = require('../db'); const M = require('../modeles'); const J = require('../comptes/jetons'); const Q = require('./_aide-quota');
const { lireConfig } = require('../config'); const { valider } = require('../openapi/valider'); const SCHEMA = require('../openapi/openapi.v2.json');
const SL = require('../identifier/seconde-lecture');
const { choixPour } = require('../choix');
const path = require('path');
const CHARGES = path.join(__dirname, '..', '..', 'verrou', 'charges.json');
const IMAGE = require(CHARGES).charges.find(c => c.cellule === 'occidentale').imageUrl;
const ref = n => ({ $ref: `#/components/schemas/${n}` });
const cfgOff = lireConfig({ MONGODB_BASE: 'test_scratch', V2_HEBDO: '0' });
const cfgOn = lireConfig({ MONGODB_BASE: 'test_scratch', V2_HEBDO: '0', V2_SECONDE_LECTURE: '1' });
const ORIGINE = cfgOff.origines.extension;
let nIp = 0; const ip = () => { nIp++; return { 'x-forwarded-for': `10.14.${Math.floor(nIp / 250)}.${nIp % 250 + 1}` }; };
let nCle = 0; const cle = () => `banc-seconde-${Date.now().toString(36)}-${++nCle}`;
const raw = n => mongoose.connection.db.collection(n);
const VB = require('./_visuels-banc'); const VIS = [];
const ID_P = 895821, ID_J = 895822, ID_J2 = 895823, ID_J3 = 895824, EXP = 990021, META = 990121;
let ecartsContrat = 0, reponsesValidees = 0;

async function inst(essais = 3) {
    const jeton = J.genererJeton(); const i = M.nouvelleInstallation({ jetonEmpreinte: J.empreinte(jeton), essais, libelle: 'banc' });
    await db.col('installations').insertOne(i); return { i, jeton };
}
const corps = (o = {}) => ({ contrat: 2, imageUrls: [IMAGE], title: null, description: null, prixVinted: null, devise: null, marche: 'vinted.fr', versionExtension: '2.0.0', langueInterface: 'fr', ...o });
async function poster(url, jeton, cleIdem = cle()) {
    const r = await H.appel(url, '/api/identifier', { methode: 'POST', corps: corps(), entetes: { origin: ORIGINE, ...ip(), authorization: `Bearer ${jeton}`, 'idempotency-key': cleIdem } });
    if (r.json && r.json.success === true && r.json.contrat === 2) { reponsesValidees++; const v = valider(r.json, ref('ReponseAnalyse'), SCHEMA); if (!v.ok) { ecartsContrat++; console.log(`   écart de contrat : ${v.erreurs.slice(0, 3).map(e => `${e.chemin} ${e.message}`).join(' ; ')}`); } }
    return r;
}
async function livre(x) {
    const mv = await raw('mouvements').find({ installationId: x.i._id }).toArray();
    // OFFRE-QUOTA : « essais » = ce qui reste aujourd'hui à l'installation seule (3 par jour), relu par la fonction même des routes
    const ins = { essais: await Q.restantDe({ type: 'installation', id: x.i._id }, cfgOff) };
    return { essais: ins.essais, net: mv.reduce((s, m) => s + m.delta, 0), mouvements: mv.length, ouverts: mv.filter(m => m.type === 'debit' && m.etat !== 'rembourse').map(m => m.etat), remboursements: mv.filter(m => m.type === 'remboursement').length };
}
const PAYE = { essais: 2, net: -1, mouvements: 1, ouverts: ['debite'], remboursements: 0 };       // une affirmation : débit 1, rien de réservé
const RESERVE = { essais: 2, net: -1, mouvements: 1, ouverts: ['reserve'], remboursements: 0 };   // une question : crédit réservé
const analyseDe = scanId => raw('analyses').findOne({ _id: new mongoose.Types.ObjectId(scanId) });
const norm = s => String(s).replace(/"scanId":"[0-9a-f]{24}"/g, '"scanId":"<id>"');

(async () => {
    await H.ouvrirBancV2();
    await Q.eviterMinuit();
    process.env.MONGODB_BASE = 'test_scratch';
    const { connecterMongo } = require('../../mongo-connexion');
    await connecterMongo({ script: 'test-seconde-lecture-route.js', ecrit: true });
    db.brancher(mongoose.connection.db);
    await M.creerIndex();
    for (const c of ['catalogue_produits', 'numeros_cartes', 'guide_prix', 'codes_set']) await raw(c).deleteMany({});
    await raw('codes_set').insertOne({ idExpansion: EXP, codeSet: 'PRE', apprisLe: new Date() });
    const SEMIS = [[ID_P, 'PRE', '162'], [ID_J, 'PAR', '251'], [ID_J2, 'PAF', '30'], [ID_J3, 'MEW', '7']];
    for (const [id, code, numero] of SEMIS) {
        await raw('catalogue_produits').insertOne({ idProduct: id, name: 'Roaring Moon ex', idExpansion: EXP, idMetacard: META });
        await raw('numeros_cartes').insertOne({ idProduct: id, idExpansion: EXP, numero, numeroUrl: `${code}${numero}`, codeSet: code, nomFr: 'Roaring Moon ex', slug: `Roaring-Moon-ex-${code}${numero}`, slugSet: 'Banc-Set', source: 'cardmarket', certitude: 'exacte' });
        await raw('guide_prix').insertOne({ idProduct: id, avg: 1.1, low: 0.5, trend: 1.0, avg1: 1.0, avg7: 1.0, avg30: 1.1, guideDu: new Date('2026-10-04') });
        VIS.push(VB.doc(id, { variante: 'normale', idMetacard: META, total: '131' }));
    }
    VB.installer(VIS);

    const express = require('express'); const pret = require('../pret'); const registre = require('../registre');
    const { dansUnScan } = require('../../sources'); const { assembler } = require('../index');
    let mode = 'affirmee';
    const ETAT = { estimeIA: null, confianceIA: null, defautsVus: [], declareVendeur: null, declareCardmarket: null, retenu: null };
    const cand = id => ({ idProduct: id, nom: 'Roaring Moon ex', numero: '162', set: 'Banc Set', prix: 1, photoUrl: null });
    const chaine = async (req, res) => {
        if (mode === 'ambigue-un') {                                  // la chaîne POSE la question (réserve le crédit) pour un candidat unique : elle n'affirme rien
            await req.credit.v2.poserQuestion(req, { scanId: req.scanIdImpose, raison: 'egalite-sans-enjeu', candidats: [ID_P] });
            return res.json({ success: true, scanId: String(req.scanIdImpose), question: { etat: 'en-attente', delaiHeures: 24 }, etat: ETAT, candidats: [cand(ID_P)], classement: [], guidePrix: {}, reverse: { attendue: false, motif: null, etat: 'aucun-motif', strategie: null }, codeLangue: 2,
                carte: { idProduct: ID_P, nomProduit: 'Roaring Moon ex', nom: 'Roaring Moon ex', numero: '162', setCode: 'PRE', total: '131', rarete: null, langue: 'FR', ambigu: true } });
        }
        const lu = mode === 'sans-lecture' ? { numero: null, setCode: null } : mode === 'lu-jumeau' ? { numero: null, setCode: 'PAR' } : mode === 'lu-jumeau-numero' ? { numero: '251', setCode: 'PAR' } :{ numero: '162', setCode: 'PRE' };
        return res.json({ success: true, scanId: String(req.scanIdImpose), question: null, etat: ETAT, candidats: [cand(ID_P)], classement: [], guidePrix: {}, reverse: { attendue: false, motif: null, etat: 'aucun-motif', strategie: null }, codeLangue: 2,
            carte: { idProduct: ID_P, nomProduit: 'Roaring Moon ex', nom: 'Roaring Moon ex', ...lu, total: '131', rarete: null, langue: 'FR', ambigu: false } });
    };
    // le « modèle » factice : ce que la seconde lecture rend, et combien d'appels elle aurait coûté
    const modele = { appels: [], reponse: { setCode: 'PRE', numero: '162' }, cout: 2, panne: false, lenteurMs: 0 };
    const fournisseur = async ({ image, signal, corps: c, scanId, compteur, photos }) => {
        modele.appels.push({ scanId: String(scanId), image: Buffer.isBuffer(image), signal: Boolean(signal), photos: photos === undefined ? 'absent' : 'fourni', premiere: c && c.carte && { numero: c.carte.numero, setCode: c.carte.setCode } });
        if (compteur) compteur.appels = (compteur.appels || 0) + modele.cout;
        if (modele.lenteurMs) await new Promise(r => setTimeout(r, modele.lenteurMs));
        if (modele.panne) return { setCode: null, numero: null, essais: [], echec: true, raison: 'panne factice' };
        return { ...modele.reponse, essais: [], echec: false, raison: 'factice' };
    };
    const JUM = { [ID_P]: [ID_J] };
    const monter = async (deps = {}, cfgApp = cfgOn) => {
        const app = express(); app.set('trust proxy', true); app.use(express.json()); app.use((q, s, n) => dansUnScan(n));
        pret.armer(require('../modeles').verifierIndex);
        app.use(assembler([require('../argent/monter'), require('../identifier/monter')], cfgApp, { jumeaux: id => ({ conclu: true, ids: JUM[id] || [] }), gererIdentifier: chaine, gererRetourLive: async (q, s) => s.json({ success: true }), ...deps }));
        return H.serveur(app);
    };
    const scan = async (s, m = 'affirmee', cleIdem) => { mode = m; const x = await inst(3); const r = await poster(s.url, x.jeton, cleIdem); const j = r.json || {}; return { ...x, r, j, scanId: j.scanId, c0: j.analyse && j.analyse.cartes[0] }; };
    const ligneQ = async scanId => raw('questions_v2').findOne({ _id: `${scanId}:0` });
    const svSans = await monter({}, cfgOff);                                       // éteint, SANS fournisseur : la référence d'aujourd'hui
    const svOffAvec = await monter({ secondeLecture: fournisseur }, cfgOff);       // éteint, AVEC fournisseur : doit être identique à la référence
    const svOn = await monter({ secondeLecture: fournisseur }, cfgOn);             // allumé, avec fournisseur
    const avertissements = async (deps, cfgApp) => { const vus = []; const ancien = console.warn; console.warn = (...a) => { vus.push(a.join(' ')); }; try { const s = await monter(deps, cfgApp); return { s, vus: vus.filter(l => /seconde lecture/i.test(l)) }; } finally { console.warn = ancien; } };
    const aOn = await avertissements({}, cfgOn);                                   // allumé, SANS fournisseur (V2_SECONDE_LECTURE=1 mais rien de branché)
    const svOnSans = aOn.s;
    const aOff = await avertissements({}, cfgOff), aOk = await avertissements({ secondeLecture: fournisseur }, cfgOn);
    H.v('0. au montage : demandée sans fournisseur = UN avertissement (comme la règle G) ; éteinte, ou allumée avec fournisseur = aucun', [aOn.vus.length, aOff.vus.length, aOk.vus.length], [1, 0, 0]);
    await aOff.s.fermer(); await aOk.s.fermer();

    // ── 1. L'INTERRUPTEUR ÉTEINT : identique à aujourd'hui, octet pour octet, et le modèle n'est JAMAIS appelé
    SL.reinitialiser();
    {
        const ref0 = await scan(svSans); const off = await scan(svOffAvec);
        H.v('1a. éteint : la référence est une QUESTION de départage à 2 (le produit et son jumeau), crédit réservé', [ref0.c0.statut, ref0.c0.candidats.map(c => c.idProduct), await livre(ref0)], ['a-trancher', [ID_P, ID_J], RESERVE]);
        H.v('1b. éteint, avec un fournisseur branché : réponse IDENTIQUE octet pour octet à la référence (scanId normalisé) ; le modèle n\'est jamais appelé', [norm(JSON.stringify(off.j)) === norm(JSON.stringify(ref0.j)), modele.appels.length, await livre(off)], [true, 0, RESERVE]);
        H.v('   aucun compteur ne bouge, et `analyses` ne porte AUCUN champ secondeLecture', [SL.compteurs().declenchees + SL.compteurs().appels, Object.keys(await analyseDe(off.scanId)).includes('secondeLecture')], [0, false]);
        const sans = await scan(svOnSans);
        H.v('1c. allumé SANS fournisseur branché : la question d\'avant (comme la règle G sans voisins), rien d\'appelé', [sans.c0.statut, await livre(sans), modele.appels.length], ['a-trancher', RESERVE, 0]);
    }

    // ── 2. ALLUMÉ, le modèle CONFIRME : une affirmation de plus, même argent qu'une affirmation
    SL.reinitialiser(); modele.appels.length = 0;
    {
        modele.reponse = { setCode: 'PRE', numero: '162' };
        const a = await scan(svOn);
        H.v('2a. confirmée : issue affirmée (identifiee), le produit LU (et lui seul), facturation { debite:1, reserve:0, motif:affirmee }', [a.j.analyse.statut, a.c0.statut, a.c0.carte && a.c0.carte.idProduct, a.c0.candidats.length, a.j.facturation],
            ['identifiee', 'identifiee', ID_P, 0, { debite: 1, reserve: 0, rembourse: false, motif: 'affirmee', raisonNonRembourse: null, poche: 'jour' }]);
        H.v('   grand livre : un débit « debite », aucune question écrite, aucun remboursement', [await livre(a), await ligneQ(a.scanId)], [PAYE, null]);
        const an = await analyseDe(a.scanId);
        H.v('   le coût est journalisé dans `analyses` : déclenchée, 2 appels, confirmée — et jamais servi au client', [an.secondeLecture && an.secondeLecture.declenchee, an.secondeLecture && an.secondeLecture.appels, an.secondeLecture && an.secondeLecture.issue, JSON.stringify(a.j).includes('secondeLecture')], [true, 2, 'confirmee', false]);
        H.v('   le fournisseur a reçu la PREMIÈRE lecture (numéro et code) et un signal d\'abandon, une fois ; AUCUNE URL de photo ne lui est donnée (TOUR 1 : plus de téléchargement) et la requête ne porte pas d\'octets', [modele.appels.length, modele.appels[0].photos, modele.appels[0].signal, modele.appels[0].image, modele.appels[0].premiere], [1, 'absent', true, false, { numero: '162', setCode: 'PRE' }]);
        H.v('   compteurs : 1 déclenchée, 1 confirmée, 2 appels', [SL.compteurs().declenchees, SL.compteurs().confirmees, SL.compteurs().appels], [1, 1, 2]);
    }

    // ── 3. ALLUMÉ, le modèle ne confirme pas : la réponse d'AVANT, sans débit ni remboursement de plus
    {
        const cas = async (nom, reponse, issue) => {
            modele.reponse = reponse; const avant = modele.appels.length;
            const b = await scan(svOn);
            const an = await analyseDe(b.scanId);
            H.v(`3. ${nom} : la question d'avant (2 candidats), crédit réservé, journal « ${issue} »`, [b.c0.statut, b.c0.candidats.map(c => c.idProduct), await livre(b), an.secondeLecture && an.secondeLecture.issue, modele.appels.length - avant], ['a-trancher', [ID_P, ID_J], RESERVE, issue, 1]);
        };
        await cas('le modèle lit le code et le numéro du JUMEAU', { setCode: 'PAR', numero: '251' }, 'non-confirmee');
        await cas('le modèle ne lit rien de sûr', { setCode: null, numero: null }, 'non-confirmee');
        await cas('le modèle contredit le numéro du produit', { setCode: 'PRE', numero: '999' }, 'non-confirmee');
        await cas('le modèle lit le numéro du jumeau avec le code du produit', { setCode: 'PRE', numero: '251' }, 'non-confirmee');
    }

    // ── 4. ÉCHEC et DÉLAI : jamais pire, jamais d'argent de plus ; l'appel tenté est compté
    {
        modele.reponse = { setCode: 'PRE', numero: '162' }; modele.panne = true;
        const e0 = SL.compteurs().echecs;
        const a = await scan(svOn);
        H.v('4a. le modèle tombe : la question d\'avant, crédit réservé (net -1, aucun remboursement de plus), journal « echec », appels comptés', [a.c0.statut, await livre(a), (await analyseDe(a.scanId)).secondeLecture.issue, (await analyseDe(a.scanId)).secondeLecture.appels, SL.compteurs().echecs - e0], ['a-trancher', RESERVE, 'echec', 2, 1]);
        modele.panne = false;
        const svLent = await monter({ secondeLecture: fournisseur, delaiSecondeMs: 150 }, cfgOn);
        modele.lenteurMs = 2500;
        const t0 = Date.now(); const b = await scan(svLent); const dt = Date.now() - t0; modele.lenteurMs = 0;
        H.v('4b. le modèle dépasse le délai borné : la question d\'avant, journal « delai », rendue bien avant la fin de l\'appel lent', [b.c0.statut, await livre(b), (await analyseDe(b.scanId)).secondeLecture.issue, dt < 2300], ['a-trancher', RESERVE, 'delai', true]);
        await svLent.fermer();
        const svThrow = await monter({ secondeLecture: async () => { throw new Error('boum'); } }, cfgOn);
        const c = await scan(svThrow);
        H.v('4c. le fournisseur LÈVE : la question d\'avant, journal « echec », jamais une panne client', [c.c0.statut, await livre(c), (await analyseDe(c.scanId)).secondeLecture.issue], ['a-trancher', RESERVE, 'echec']);
        await svThrow.fermer();
        const svNul = await monter({ secondeLecture: async () => null }, cfgOn);
        const d = await scan(svNul);
        H.v('4d. le fournisseur rend null (rien à dire) : la question d\'avant', [d.c0.statut, await livre(d)], ['a-trancher', RESERVE]);
        await svNul.fermer();
        const svSansBande = await monter({ secondeLecture: async () => ({ setCode: null, numero: null, essais: [], echec: false, raison: 'aucune bande à lire (pas de recadrage possible)' }) }, cfgOn);
        const nf0 = SL.compteurs().nonFaisables;
        const e = await scan(svSansBande);
        H.v('4e. aucune bande à lire (pas de géométrie), 0 appel : la question d\'avant, compté « non faisable », journal « non-confirmee » à 0 appel', [e.c0.statut, await livre(e), SL.compteurs().nonFaisables - nf0, (await analyseDe(e.scanId)).secondeLecture.appels, (await analyseDe(e.scanId)).secondeLecture.issue], ['a-trancher', RESERVE, 1, 0, 'non-confirmee']);
        await svSansBande.fermer();
        // TOUR 1 (I-2) : pas d'octets d'image => pas de seconde lecture, aucun appel payant, compté « sans-image »
        const svSansImage = await monter({ secondeLecture: async () => ({ setCode: null, numero: null, essais: [], echec: false, sansImage: true, raison: 'aucune image fournie (octets)' }) }, cfgOn);
        const nf1 = SL.compteurs().nonFaisables, nc1 = SL.compteurs().nonConfirmees;
        const f = await scan(svSansImage); const tf = (await analyseDe(f.scanId)).secondeLecture;
        H.v('4f. pas d\'octets d\'image : la question d\'avant, journal « sans-image » à 0 appel, compté « non faisable » (et pas « non confirmée »)', [f.c0.statut, await livre(f), tf.issue, tf.appels, SL.compteurs().nonFaisables - nf1, SL.compteurs().nonConfirmees - nc1], ['a-trancher', RESERVE, 'sans-image', 0, 1, 0]);
        await svSansImage.fermer();
        // TOUR 1 (coût exact) : le délai INTERROMPT les appels restants (signal) et tout appel parti est compté
        const attente = ms => new Promise(r => setTimeout(r, ms));
        let partis = 0;
        const sequentiel = async ({ compteur, signal }) => { for (let k = 0; k < 3; k++) { if (signal && signal.aborted) return { echec: true, essais: [], raison: 'interrompue' }; compteur.appels = (compteur.appels || 0) + 1; partis++; await attente(100); } return { setCode: null, numero: null, essais: [], echec: false, raison: 'fin' }; };
        const svCoupe = await monter({ secondeLecture: sequentiel, delaiSecondeMs: 150 }, cfgOn);
        const a0 = SL.compteurs().appels;
        const g = await scan(svCoupe); await attente(500);
        const tg = (await analyseDe(g.scanId)).secondeLecture;
        H.v('4g. délai de 150 ms, un appel toutes les 100 ms : le 3e appel ne part JAMAIS (2 partis), 2 comptés au global ET dans la trace, journal « delai », la question d\'avant',
            [partis, SL.compteurs().appels - a0, tg.appels, tg.issue, g.c0.statut, await livre(g)], [2, 2, 2, 'delai', 'a-trancher', RESERVE]);
        await svCoupe.fermer();
        // un fournisseur qui IGNORE le signal et lance un appel après le délai : l'appel est quand même compté au global (le coût est exact)
        const tardif = async ({ compteur }) => { await attente(2500); compteur.appels = (compteur.appels || 0) + 1; return { setCode: null, numero: null, essais: [], echec: false, raison: 'tard' }; };
        const svTard = await monter({ secondeLecture: tardif, delaiSecondeMs: 100 }, cfgOn);
        const a1 = SL.compteurs().appels;
        const h = await scan(svTard); const apresReponse = SL.compteurs().appels - a1; await attente(3000);
        H.v('4h. un fournisseur sourd au signal qui appelle APRÈS le délai : la réponse part sans attendre (0 compté à ce moment), puis l\'appel tardif est compté au global (1)', [apresReponse, SL.compteurs().appels - a1, (await analyseDe(h.scanId)).secondeLecture.issue], [0, 1, 'delai']);
        await svTard.fermer();
    }

    // ── TOUR 1 (I-1) : les deux lectures se contredisent => la question reste, jamais une affirmation
    {
        modele.reponse = { setCode: 'PRE', numero: '162' }; const avant = modele.appels.length;
        const j = await scan(svOn, 'lu-jumeau');
        const tj = (await analyseDe(j.scanId)).secondeLecture;
        H.v('9. la chaîne a lu le JUMEAU (PAR/251) et affirmé P ; le modèle relit P (PRE/162) : les deux lectures se contredisent => la question d\'avant, journal « non-confirmee », raison « conflit de lecture »',
            [j.c0.statut, j.c0.candidats.map(c => c.idProduct), await livre(j), tj.issue, /conflit de lecture/.test(tj.raison), modele.appels.length - avant], ['a-trancher', [ID_P, ID_J], RESERVE, 'non-confirmee', true, 1]);
    }

    // ── GARDE-CONTRADICTION : une lecture qui contredit le NUMÉRO du gagnant (le jumeau lu en entier, 251/PAR) ôte le sûr, et la seconde lecture est sautée
    {
        modele.reponse = { setCode: 'PRE', numero: '162' }; const avant = modele.appels.length;
        const j = await scan(svOn, 'lu-jumeau-numero');
        const tj = (await analyseDe(j.scanId)).secondeLecture;
        H.v('9b. la chaîne a lu le numéro du JUMEAU (251) et affirmé P : la garde contredit le numéro, pose la question, aucune seconde lecture',
            [j.c0.statut, await livre(j), tj == null, modele.appels.length - avant], ['a-trancher', RESERVE, true, 0]);
    }

    // ── 5. LE COÛT NE SE DÉCLENCHE QUE SUR LE CAS VISÉ
    {
        modele.reponse = { setCode: 'PRE', numero: '162' }; modele.appels.length = 0;
        const n0 = SL.compteurs().declenchees;
        const sans = await scan(svOn, 'sans-lecture');
        H.v('5a. la première lecture n\'a lu NI code NI numéro : aucun appel au modèle, la question d\'avant', [modele.appels.length, sans.c0.statut], [0, 'a-trancher']);
        JUM[ID_P] = [];
        const aucun = await scan(svOn);
        H.v('5b. un produit SANS jumeau : affirmé comme avant, aucun appel', [aucun.c0.statut, modele.appels.length, await livre(aucun)], ['identifiee', 0, PAYE]);
        JUM[ID_P] = [ID_J, ID_J2, ID_J3];
        const trop = await scan(svOn);
        // JUMEAUX-QUESTION (2026-10-17) : trois jumeaux = une QUESTION à 3 (réservée), plus l'introuvable d'avant ; la seconde lecture ne se déclenche toujours pas (trop de jumeaux pour la confirmer)
        H.v('5c. trois jumeaux (4 produits) : une question à 3, réservée, aucun appel au modèle', [trop.c0.statut, trop.c0.candidats.length, await livre(trop), modele.appels.length], ['a-trancher', 3, RESERVE, 0]);
        JUM[ID_P] = [ID_J];
        mode = 'affirmee';
        const svPanne = await monter({ secondeLecture: fournisseur, jumeaux: () => ({ conclu: false, ids: [], motif: 'jumeaux-perimes' }) }, cfgOn);
        const p = await scan(svPanne);
        H.v('5d. la garde des jumeaux ne conclut pas (panne 503) : aucun appel', [p.r.statut, modele.appels.length], [503, 0]);
        await svPanne.fermer();
        H.v('5e. aucun de ces scans n\'a compté comme déclenché', SL.compteurs().declenchees - n0, 0);
    }

    // 5f. un candidat UNIQUE non affirmé (la chaîne n'a pas affirmé : l'ambiguë à un candidat) : jamais de seconde lecture, la question d'avant
    {
        modele.appels.length = 0; mode = 'ambigue-un';
        const u = await scan(svOn, 'ambigue-un');
        H.v('5f. la chaîne n\'a PAS affirmé (ambiguë à un candidat, jumeau => question de départage) : aucun appel, la question d\'avant', [u.c0.statut, u.c0.candidats.map(c => c.idProduct), modele.appels.length], ['a-trancher', [ID_P, ID_J], 0]);
    }

    // ── 6. JAMAIS DEUX FOIS POUR LE MÊME SCAN
    {
        modele.reponse = { setCode: 'PRE', numero: '162' }; modele.appels.length = 0;
        const x = await inst(3); mode = 'affirmee';
        const k = cle();
        const r1 = await poster(svOn.url, x.jeton, k); const apres1 = modele.appels.length;
        const r2 = await poster(svOn.url, x.jeton, k);
        H.v('6a. même clé d\'idempotence rejouée : la même réponse, le modèle n\'est pas rappelé, un seul débit', [norm(r2.texte) === norm(r1.texte), apres1, modele.appels.length, (await livre(x)).net], [true, 1, 1, -1]);
        // le garde-fou du module, au niveau de la route : un scanId déjà tenté ne rappelle pas le modèle
        const y = await inst(3); const ia0 = modele.appels.length;
        const s1 = await poster(svOn.url, y.jeton); SL.premiereFois(String(new mongoose.Types.ObjectId()));
        H.v('6b. deux scans DIFFÉRENTS appellent chacun le modèle une fois (la mémoire est par scanId, pas globale)', [s1.json.analyse.statut, modele.appels.length - ia0], ['identifiee', 1]);
        // la décision de la route elle-même, appelée deux fois pour le MÊME scanId (un rejeu interne) : le modèle n'est appelé qu'une fois, la seconde fois la trace le dit
        const { consulterSecondeLecture } = require('../identifier/routes');
        const pl = { idProduct: ID_P, set: { code: 'PRE' }, numero: '162' }, jl = { idProduct: ID_J, set: { code: 'PAR' }, numero: '251' };
        const args = { deps: { secondeLecture: fournisseur }, cfg: cfgOn, entree: { imageUrls: [IMAGE] }, scanId: String(new mongoose.Types.ObjectId()), resultat: { issue: 'question' },
            corpsChaine: { success: true, carte: { idProduct: ID_P, numero: '162', setCode: 'PRE', ambigu: false } }, produits: new Map([[ID_P, pl], [ID_J, jl]]), jumeaux: id => ({ conclu: true, ids: id === ID_P ? [ID_J] : [] }),
            rejouer: () => ({ issue: 'affirmee' }) };
        const avant = modele.appels.length;
        const un = await consulterSecondeLecture(args), deux = await consulterSecondeLecture(args);
        H.v('   le MÊME scanId consulté deux fois : un appel au modèle, la seconde fois « deja-tentee » (aucune confirmation, aucun coût)', [modele.appels.length - avant, un.trace.issue, deux.trace.issue, deux.trace.appels, deux.resultat], [1, 'confirmee', 'deja-tentee', 0, undefined]);
    }

    // ── 7. le contrat : rien de neuf pour le client (une affirmation de plus, ou la même question)
    H.vrai(`7. ${reponsesValidees} réponses d'analyse jugées contre le contrat OpenAPI, ${ecartsContrat} écart(s)`, ecartsContrat === 0 && reponsesValidees >= 10);

    for (const s of [svSans, svOffAvec, svOn, svOnSans]) await s.fermer();
    await mongoose.disconnect(); await H.arreterBanc();
    H.bilan();
})().catch(async e => { console.error('❌', e); try { await H.arreterBanc(); } catch (_) { } process.exit(1); });
