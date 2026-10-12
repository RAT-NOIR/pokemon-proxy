'use strict';
// Banc B1b.8 — les lots : coût par tranche de 10, ordre par valeur, supplément tout-ou-rien, remboursement poche par poche.
// Base : la base EN MÉMOIRE du banc (INT2) — jamais la production, ni la grappe, ni R2. Aucun réseau.
// Les résultats du crochet `deps.identifierLot` sont FABRIQUÉS (formes copiées de capture-reponse.js / adaptateur.js) : aucun chiffre inventé n'est présenté comme réel.
// Les assertions 1 à 10 du plan (§14, Task B1b.8) sont numérotées ; les suivantes sont les rulings du coordinateur (crochet absent, concurrence, sans-prix, règle G).
const H = require('./_harnais');
const path = require('path');
const mongoose = require('mongoose');
const db = require('../db'); const M = require('../modeles'); const J = require('../comptes/jetons');
const { lireConfig } = require('../config');
const { valider } = require('../openapi/valider'); const SCHEMA = require('../openapi/openapi.v2.json');
const RG = require('../identifier/regle-g');
const L = require('../identifier/lot');
const CHARGES = path.join(__dirname, '..', '..', 'verrou', 'charges.json');
const IMAGE = require(CHARGES).charges.find(c => c.cellule === 'occidentale').imageUrl;
const ref = n => ({ $ref: `#/components/schemas/${n}` });
// hebdo éteinte : un compte débite accueil puis achete (l'ordre du plan, assertion 10). V2_LOT_CARTES_MAX=100 : ce banc exerce les lots de 21 à 100 cartes (coût, supplément, remboursement poche par poche) ;
// la borne par défaut (20), son refus et le plafond des refus de lot sont dans test-plafonds.js.
const BASE = { MONGODB_BASE: 'test_scratch', V2_HEBDO: '0', V2_LOT_CARTES_MAX: '100' };
const cfg = lireConfig(BASE);
const ORIGINE = cfg.origines.extension;
let nIp = 0; const ip = () => { nIp++; return { 'x-forwarded-for': `10.11.${Math.floor(nIp / 250)}.${nIp % 250 + 1}` }; };
let nCle = 0; const cle = () => `banc-b1b8-${Date.now().toString(36)}-${++nCle}`;
const raw = n => mongoose.connection.db.collection(n);
const attendre = ms => new Promise(r => setTimeout(r, ms));
const sur = f => { try { return f(); } catch (e) { return `💥 ${e && e.message}`; } };

// ── catalogue FABRIQUÉ : (idProduct, tendance|undefined) ; undefined = aucune ligne de guide (prixGuide null)
const EXP = 990002;
const semer = async (id, trend) => {
    await raw('catalogue_produits').insertOne({ idProduct: id, name: 'Tropius (PBL 001)', idExpansion: EXP, idMetacard: 990200 + (id % 1000) });
    await raw('numeros_cartes').insertOne({ idProduct: id, idExpansion: EXP, numero: '001', numeroUrl: 'PBL001', codeSet: 'PBL', nomFr: 'Tropius', slug: 'Tropius-PBL001', slugSet: 'Banc-Lot', source: 'cardmarket', certitude: 'exacte' });
    if (trend !== undefined) await raw('guide_prix').insertOne({ idProduct: id, avg: trend, low: trend / 2, trend, avg1: trend, avg7: trend, avg30: trend, guideDu: new Date('2026-10-04') });
    VIS.push(VB.doc(id, { idMetacard: 990200 + (id % 1000), setNom: 'Banc Lot' }));
};
const VB = require('./_visuels-banc'); const VIS = [];
const P5 = 910001, P20A = 910002, PNOG = 910003, P20B = 910004, P1 = 910005, POOL = Array.from({ length: 40 }, (_, i) => 910100 + i);

// ── résultats FABRIQUÉS du crochet (forme de la chaîne héritée : { statutHttp, corps })
const carteCorps = (id, ambigu) => ({ idProduct: id, nomProduit: 'Tropius', nom: 'Tropius', numero: '001', total: '064', setCode: 'PBL', rarete: null, langue: 'FR', ambigu });
const ETAT = { estimeIA: null, confianceIA: null, defautsVus: [], declareVendeur: null, declareCardmarket: null, retenu: null };
const cand = id => ({ idProduct: id, nom: 'Tropius', numero: '001', set: 'Banc Lot', prix: 1, photoUrl: null });
const aff = id => ({ statutHttp: 200, corps: { success: true, question: null, carte: carteCorps(id, false), etat: ETAT, candidats: [cand(id)], classement: [], guidePrix: {}, reverse: { attendue: false, motif: null, etat: 'aucun-motif', strategie: null }, codeLangue: 2 } });
const qst = ids => ({ statutHttp: 200, corps: { success: true, question: { etat: 'en-attente', delaiHeures: 24 }, carte: carteCorps(ids[0], true), etat: ETAT, candidats: ids.map(cand), classement: [], guidePrix: {}, reverse: { attendue: false, motif: null, etat: 'aucun-motif', strategie: null }, codeLangue: 2 } });
const intro = () => ({ statutHttp: 200, corps: { success: false, natureRefus: 'refus-delibere', motifRefus: 'aucun-prix' } });
const nAff = n => Array.from({ length: n }, (_, i) => aff(POOL[i % POOL.length]));
const nIntro = n => Array.from({ length: n }, () => intro());

// ── porteurs
async function inst(o = {}) {
    const jeton = J.genererJeton(); const i = Object.assign(M.nouvelleInstallation({ jetonEmpreinte: J.empreinte(jeton), essais: 3, libelle: 'banc' }), o);
    await db.col('installations').insertOne(i); return { i, jeton, base: { installationId: i._id } };
}
async function compteLie(solde, role) {
    const c = Object.assign(M.nouveauCompte({ email: `lot${++nCle}@x.fr`, emailCle: `lot${nCle}@x.fr`, motDePasse: {} }), { verifie: true, solde }, role ? { role } : {});
    await db.col('comptes').insertOne(c);
    const jeton = J.genererJeton(); const i = Object.assign(M.nouvelleInstallation({ jetonEmpreinte: J.empreinte(jeton), essais: 0, libelle: 'banc' }), { compteId: c._id });
    await db.col('installations').insertOne(i); return { i, c, jeton, base: { compteId: c._id } };
}
const corps = (nImages = 1, o = {}) => ({ contrat: 2, imageUrls: Array(nImages).fill(IMAGE), title: null, description: null, prixVinted: null, devise: null, marche: 'vinted.fr', versionExtension: '2.0.0', langueInterface: 'fr', ...o });
const poster = (url, jeton, c = corps(), k = cle()) => H.appel(url, '/api/identifier', { methode: 'POST', corps: c, entetes: { origin: ORIGINE, ...ip(), authorization: `Bearer ${jeton}`, 'idempotency-key': k } });
const repondre = (url, jeton, b) => H.appel(url, '/api/identifier/reponse', { methode: 'POST', corps: b, entetes: { origin: ORIGINE, ...ip(), authorization: `Bearer ${jeton}` } });
const mouvements = async x => raw('mouvements').find(x.base).sort({ _id: 1 }).toArray();
const net = async (x, nom) => { const m = await mouvements(x); const s = m.reduce((t, y) => t + y.delta, 0); console.log(`   (dénominateur ${nom} : ${m.length} ligne(s) mouvements, somme des delta ${s})`); return s; };
const debits = async x => (await mouvements(x)).filter(m => m.type === 'debit');
const essais = async x => (await raw('installations').findOne({ _id: x.i._id })).essais;
const soldeCompte = async x => (await raw('comptes').findOne({ _id: x.c._id })).solde;

(async () => {
    // ════════════ unités pures (aucune base) ════════════
    const cv = (index, tendance) => ({ index, statut: 'identifiee', carte: tendance === undefined ? null : { prixGuide: tendance === null ? null : { tendance } } });
    // (4) ordre : tendance décroissante, null en dernier, égalité => ordre d'ENTRÉE (tri stable, prouvé par des égalités), index inchangé
    const entree = [cv(0, 5), cv(1, 20), cv(2, null), cv(3, 20), cv(4, 1), cv(5), cv(6, 20), cv(7, 0)];
    H.v('4. ordonnerParValeur : tendance décroissante, null/absent en dernier, égalités dans l\'ordre d\'entrée (8 cartes, 3 égales à 20, 3 sans valeur)',
        sur(() => L.ordonnerParValeur(entree).map(c => c.index)), [1, 3, 6, 0, 4, 7, 2, 5]);
    H.v('   l\'entrée n\'est pas modifiée (index = position d\'entrée)', entree.map(c => c.index), [0, 1, 2, 3, 4, 5, 6, 7]);
    // (9) V2_LECTURE_LIVE_MAX
    H.v('9. V2_LECTURE_LIVE_MAX : défaut 5 ; 3 => 3 ; 0 => 0', [lireConfig(BASE).lot.lectureLiveMax, lireConfig({ ...BASE, V2_LECTURE_LIVE_MAX: '3' }).lot.lectureLiveMax, lireConfig({ ...BASE, V2_LECTURE_LIVE_MAX: '0' }).lot.lectureLiveMax], [5, 3, 0]);
    for (const mauvaise of ['2.5', 'abc', ' ', '-1', '1e1x']) {
        let e = null; try { lireConfig({ ...BASE, V2_LECTURE_LIVE_MAX: mauvaise }); } catch (x) { e = x.message; }
        H.vrai(`9. V2_LECTURE_LIVE_MAX="${mauvaise}" rend la configuration invalide`, /configuration invalide/.test(e || ''));
    }

    await H.ouvrirBancV2();
    process.env.MONGODB_BASE = 'test_scratch';
    const { connecterMongo } = require('../../mongo-connexion');
    await connecterMongo({ script: 'test-identifier-lot.js', ecrit: true });
    db.brancher(mongoose.connection.db);
    await M.creerIndex();
    for (const c of ['catalogue_produits', 'numeros_cartes', 'guide_prix', 'codes_set']) await raw(c).deleteMany({});
    await raw('codes_set').insertOne({ idExpansion: EXP, codeSet: 'PBL', apprisLe: new Date() });
    await semer(P5, 5); await semer(P20A, 20); await semer(PNOG); await semer(P20B, 20); await semer(P1, 1);
    for (const id of POOL) await semer(id, 2);
    VB.installer(VIS);                                                  // les visuels vivent EN MÉMOIRE (v2/chargeur), plus dans une collection

    const express = require('express'); const pret = require('../pret');
    const { dansUnScan } = require('../../sources'); const { assembler } = require('../index');
    let appelsChaine = 0, appelsLot = 0, derniereReq = null, lotImpl = null, appelsVoisins = 0;
    const chaine = async (req, res) => { appelsChaine++; return res.json({ ...aff(P20A).corps, scanId: String(req.scanIdImpose) }); };
    const voisins = async () => { appelsVoisins++; return { ligne: {}, nEssais: 1, mesures: {}, contexteG: null }; };
    const identifierLot = async req => { appelsLot++; derniereReq = req; return lotImpl(req); };
    const monter = async (cfgApp, deps) => {
        const app = express(); app.set('trust proxy', true); app.use(express.json()); app.use((q, s, n) => dansUnScan(n));
        pret.armer(require('../modeles').verifierIndex);
        app.use(assembler([require('../argent/monter'), require('../identifier/monter')], cfgApp, { jumeaux: () => ({ conclu: true, ids: [] }), gererIdentifier: chaine, gererRetourLive: async (q, s) => s.json({ success: true }), ...deps }));
        return H.serveur(app);
    };
    const sv = await monter(cfg, { identifierLot });
    const svSimple = await monter(cfg, {});                                  // pas de crochet : une seule carte, comme avant le lot
    const lot = (liste, delai = 0) => { lotImpl = async () => { if (delai) await attendre(delai); return liste; }; };

    // ── (1) 4 cartes (3 affirmées + 1 question)
    {
        const x = await inst(); const Q = [POOL[30], POOL[31]];
        lot([aff(P5), aff(P20A), qst(Q), aff(P1)]); appelsChaine = 0; appelsLot = 0;
        const r = await poster(sv.url, x.jeton); const j = r.json || {}; const a = j.analyse || {};
        H.v('1. 4 cartes => analyse.statut lot, 4 cartes, lot { cartesVues:4, identifiees:3, aTrancher:1, introuvables:0, lectureLiveMax:5 }',
            [r.statut, a.statut, (a.cartes || []).length, a.lot], [200, 'lot', 4, { cartesVues: 4, identifiees: 3, aTrancher: 1, introuvables: 0, lectureLiveMax: 5 }]);
        H.v('   1 crédit (essai 3 -> 2), facturation { debite:1, reserve:0, rembourse:false, motif:lot }, le crochet appelé UNE fois, la chaîne à une carte jamais',
            [await essais(x), j.facturation, appelsLot, appelsChaine], [2, { debite: 1, reserve: 0, rembourse: false, motif: 'lot', raisonNonRembourse: null }, 1, 0]);
        const v = valider(j, ref('ReponseAnalyse'), SCHEMA);
        H.vrai(`   la réponse valide contre ReponseAnalyse (${v.ok ? 'ok' : v.erreurs.slice(0, 3).map(e => e.chemin + ' ' + e.message).join(' ; ')})`, v.ok);
        H.vrai('   le crochet ne reçoit AUCUN crédit (il ne peut ni débiter ni rembourser), mais l\'annonce et le scan imposé', derniereReq && derniereReq.credit === undefined && derniereReq.body && derniereReq.scanIdImpose);
        H.v('   un lot n\'est pas une carte : l\'ordre des cartes est celui des valeurs (20, 5, 1, puis la question sans valeur) ; index = position d\'entrée', (a.cartes || []).map(c => c.index), [1, 0, 3, 2]);
    }
    // ── crochet absent / non fonction : une seule carte, octet pour octet
    {
        const x = await inst(), y = await inst();
        const norm = s => s.replace(/"scanId":"[0-9a-f]{24}"/g, '"scanId":"<id>"');
        const a = await poster(svSimple.url, x.jeton);
        const svBizarre = await monter(cfg, { identifierLot: 'pas-une-fonction' });
        const b = await poster(svBizarre.url, y.jeton); await svBizarre.fermer();
        H.v('0. crochet absent : une seule carte (identifiee, lot null), jamais un lot inventé', [a.statut, a.json.analyse.statut, a.json.analyse.cartes.length, a.json.analyse.lot], [200, 'identifiee', 1, null]);
        H.v('   crochet non fonction : même corps octet pour octet (scanId normalisé)', norm(JSON.stringify(b.json)), norm(JSON.stringify(a.json)));
    }
    // ── (2) coût max(1, ceil(N/10)) — mesuré sur les LIGNES de débit, pas seulement sur le solde
    {
        const lignes = [];
        for (const [n, attendu] of [[1, 1], [10, 1], [11, 2], [20, 2], [21, 3]]) {
            const x = await compteLie({ accueil: 0, achete: 10 }); lot(nAff(n));
            const r = await poster(sv.url, x.jeton);
            lignes.push([n, r.statut, (await debits(x)).length, (await soldeCompte(x)).achete, r.json.facturation && r.json.facturation.debite]);
            void attendu;
        }
        H.v('2. cartes -> [N, HTTP, lignes de débit, achete restant, facturation.debite] : 1 -> 1 · 10 -> 1 · 11 -> 2 · 20 -> 2 · 21 -> 3', lignes,
            [[1, 200, 1, 9, 1], [10, 200, 1, 9, 1], [11, 200, 2, 8, 2], [20, 200, 2, 8, 2], [21, 200, 3, 7, 3]]);
    }
    // ── (3) cartesVues compte les introuvables
    {
        const x = await compteLie({ accueil: 0, achete: 10 }); lot([...nAff(5), ...nIntro(7)]);
        const r = await poster(sv.url, x.jeton); const a = r.json.analyse || {};
        H.v('3. 5 identifiées + 7 introuvables : cartesVues 12 (le travail de lecture a eu lieu), introuvables 7, 2 crédits, aucun remboursement',
            [a.lot, r.json.facturation && r.json.facturation.motif, r.json.facturation && r.json.facturation.rembourse, (await debits(x)).length, (await soldeCompte(x)).achete],
            [{ cartesVues: 12, identifiees: 5, aTrancher: 0, introuvables: 7, lectureLiveMax: 5 }, 'lot', false, 2, 8]);
    }
    // ── (4) ordre par la route
    {
        const x = await inst(); const Q = [POOL[32], POOL[33]];
        lot([aff(P5), aff(P20A), aff(PNOG), aff(P20B), aff(P1), qst(Q), intro()]);
        const r = await poster(sv.url, x.jeton); const cs = (r.json.analyse || {}).cartes || [];
        H.v('4. par la route : valeur décroissante (20, 20 dans l\'ordre d\'entrée, 5, 1), puis les sans-valeur (carte sans guide, question, introuvable) dans l\'ordre d\'entrée',
            cs.map(c => c.index), [1, 3, 0, 4, 2, 5, 6]);
        H.v('   chaque carte porte l\'index de SA position d\'entrée', cs.filter(c => c.carte).map(c => [c.index, c.carte.idProduct]), [[1, P20A], [3, P20B], [0, P5], [4, P1], [2, PNOG]]);
    }
    // ── (5) supplément non payable : 25 cartes, solde 1
    {
        const x = await inst({ essais: 1, achete: 0 }); lot(nAff(25));
        const r = await poster(sv.url, x.jeton); const j = r.json || {};
        H.v('5. 25 cartes, solde 1 : 429 QUOTA detail lot-trop-grand, facturation rendue { debite:0, rembourse:true }', [r.statut, j.erreur && j.erreur.code, j.erreur && j.erreur.detail, j.facturation && j.facturation.debite, j.facturation && j.facturation.rembourse], [429, 'QUOTA', 'lot-trop-grand', 0, true]);
        const vE = valider(j, ref('ReponseErreur'), SCHEMA);
        H.vrai(`   la réponse 429 valide contre ReponseErreur (detail est une chaîne libre au contrat : aucune valeur à ajouter) — ${vE.ok ? 'ok' : vE.erreurs.slice(0, 3).map(e => e.chemin + ' ' + e.message).join(' ; ')}`, vE.ok);
        const plafonds = await raw('plafonds').find({ porteur: `installation:${x.i._id}` }).toArray();
        H.v('   crédit initial rendu (essai 1), aucun mouvement net ; le refus compte dans son compteur PROPRE lot-trop-grand (1) et dans aucun autre (ni panne ni question)', [await essais(x), await net(x, 'lot-trop-grand'), plafonds.map(p => `${p.type}:${p.count}`)], [1, 0, ['lot-trop-grand:1']]);
        // partiel : 2 crédits pour un lot à 3
        const y = await inst({ essais: 1, achete: 1 }); lot(nAff(25));
        const r2 = await poster(sv.url, y.jeton);
        H.v('   2 crédits pour un lot à 3 (tout-ou-rien) : QUOTA, les deux poches retrouvées (essai 1, achete 1), somme des delta 0', [r2.statut, r2.json.erreur && r2.json.erreur.detail, await essais(y), (await raw('installations').findOne({ _id: y.i._id })).achete, await net(y, 'supplément partiel')], [429, 'lot-trop-grand', 1, 1, 0]);
    }
    // ── (6) lot entièrement introuvable : remboursé ; un seul identifié : jamais remboursé (ruling 4)
    {
        const x = await inst(); lot(nIntro(5));
        const r = await poster(sv.url, x.jeton); const j = r.json || {};
        H.v('6. 5 cartes, aucune identifiée : remboursé, motif introuvable, essai 3, somme 0, cartesVues 5 et introuvables 5', [r.statut, j.facturation, await essais(x), await net(x, 'lot introuvable'), j.analyse && j.analyse.lot && [j.analyse.lot.cartesVues, j.analyse.lot.introuvables]],
            [200, { debite: 0, reserve: 0, rembourse: true, motif: 'introuvable', raisonNonRembourse: null }, 3, 0, [5, 5]]);
        const y = await inst(); lot([...nIntro(4), aff(P5)]);
        const r2 = await poster(sv.url, y.jeton);
        H.v('   4 introuvables + 1 identifiée : pas de remboursement (essai 2), motif lot', [r2.json.facturation.motif, r2.json.facturation.rembourse, await essais(y)], ['lot', false, 2]);
    }
    // ── JUMEAU-V2 (C1 de la relecture 1) : la garde des jumeaux du LOT. Chaque carte affirmée par la chaîne passe par elle ; sans elle (un lot « tout affirmé »), ces assertions rougissent.
    {
        const aujourdhui = new Date().toISOString().slice(0, 10);
        const plafondPlein = async x => raw('plafonds').insertOne({ porteur: `installation:${x.i._id}`, jour: aujourdhui, type: 'panne', count: cfg.plafonds.panne, expireLe: new Date(Date.now() + 3 * 86400e3) });
        const compteurPanne = async x => (await raw('plafonds').findOne({ porteur: `installation:${x.i._id}`, type: 'panne' }) || {}).count;
        const parIndex = j => Object.fromEntries(((j.analyse || {}).cartes || []).map(c => [c.index, c]));
        const analyseDe = async j => raw('analyses').findOne({ _id: new mongoose.Types.ObjectId(j.scanId) });
        const avec = async (jumeaux, f) => { const s = await monter(cfg, { identifierLot, jumeaux }); try { await f(s); } finally { await s.fermer(); } };
        const J1 = id => ({ conclu: true, ids: id === P5 ? [POOL[0]] : [] });                         // P5 a UN jumeau
        const J3 = id => ({ conclu: true, ids: id === P5 ? [POOL[0], POOL[1], POOL[2]] : [] });       // P5 a TROIS jumeaux : 4 produits, trop pour une question

        await avec(J1, async s => {
            const x = await inst(); lot([aff(P5), aff(P20A), aff(P1)]);
            const r = await poster(s.url, x.jeton), j = r.json || {}, c = parIndex(j);
            H.v('JUMEAU-V2 lot : la carte dont le produit a UN jumeau devient une QUESTION (a-trancher à 2 candidats : le produit et son jumeau), les deux autres restent identifiées',
                [r.statut, [0, 1, 2].map(i => c[i] && c[i].statut), c[0] && c[0].candidats.map(p => p.idProduct).sort((a, b) => a - b)], [200, ['a-trancher', 'identifiee', 'identifiee'], [P5, POOL[0]].sort((a, b) => a - b)]);
            const q = await raw('questions').findOne({ _id: `${j.scanId}:0` });
            H.v('   la question du lot est RÉSERVÉE (lot: true, en attente), les choix sont ceux du contrat ; un crédit pris pour le lot (essai 3 -> 2), jamais remboursé',
                [q && q.etat, q && q.lot, q && q.choix.map(y => y.idProduct).sort((a, b) => a - b), await essais(x), j.facturation && j.facturation.rembourse], ['en-attente', true, [P5, POOL[0]].sort((a, b) => a - b), 2, false]);
        });
        await avec(J3, async s => {
            const x = await inst(); lot([aff(P5), aff(P20A)]);
            const r = await poster(s.url, x.jeton), j = r.json || {}, c = parIndex(j), an = await analyseDe(j);
            H.v('JUMEAU-V2 lot : la carte à plus de 3 produits (elle et ses 3 jumeaux) est INTROUVABLE « impression-indeterminee » (jamais 3 parmi N), l\'autre reste identifiée, le lot n\'est pas remboursé',
                [[0, 1].map(i => c[i] && c[i].statut), c[0] && c[0].raison, c[0] && c[0].candidats, await essais(x), j.facturation && j.facturation.rembourse], [['introuvable', 'identifiee'], 'impression-indeterminee', [], 2, false]);
            H.v('   I4 : le motif de la garde est tracé PAR CARTE dans analyses (champ interne, jamais servi) : la carte 0 le porte, la carte 1 non',
                [an && an.cartes[0].motifJumeaux, an && an.cartes[1].motifJumeaux, JSON.stringify(j).includes('jumeaux-')], ['jumeaux-trop-nombreux', undefined, false]);
        });
        const compteurDe = async (x, type) => (await raw('plafonds').findOne({ porteur: `installation:${x.i._id}`, type }) || {}).count ?? 0;
        const poserCompteur = (x, type, count) => raw('plafonds').insertOne({ porteur: `installation:${x.i._id}`, jour: aujourdhui, type, count, expireLe: new Date(Date.now() + 3 * 86400e3) });
        await avec(J3, async s => {
            const x = await inst(); await plafondPlein(x); lot([aff(P5), aff(P5)]);
            const r = await poster(s.url, x.jeton), j = r.json || {};
            H.v('JUMEAU-V2 lot ENTIÈREMENT refusé par la garde (2 cartes) : remboursé dans le compteur DÉDIÉ jumeaux, UNE unité par carte (2), plafond de pannes plein et inchangé (essai 3, debite 0)',
                [r.statut, (j.analyse || {}).lot && j.analyse.lot.introuvables, j.facturation && j.facturation.rembourse, j.facturation && j.facturation.debite, await essais(x), await compteurPanne(x), await compteurDe(x, 'jumeaux')], [200, 2, true, 0, 3, cfg.plafonds.panne, 2]);
        });
        // C1 de la passe 2 (M2) : UNE seule carte refusée par la garde dans un lot de déchets ne fait pas rendre tout le lot (`every`, pas `some`) — la sonde du relecteur, [200, true, 3, 5], doit changer
        await avec(J3, async s => {
            const x = await inst(); await plafondPlein(x); lot([aff(P5), intro(), intro(), intro(), intro()]);
            const r = await poster(s.url, x.jeton), j = r.json || {};
            H.v('JUMEAU-V2 lot MIXTE (1 carte refusée par la garde + 4 introuvables de la chaîne), plafond de pannes PLEIN : PAS remboursé (plafond-jour, essai 2), le compteur dédié n\'est pas touché',
                [r.statut, j.facturation && j.facturation.rembourse, j.facturation && j.facturation.debite, j.facturation && j.facturation.raisonNonRembourse, await essais(x), await compteurPanne(x), await compteurDe(x, 'jumeaux')], [200, false, 1, 'plafond-jour', 2, cfg.plafonds.panne, 0]);
        });
        await avec(J3, async s => {
            const x = await inst(); lot([aff(P5), aff(P5), intro()]);
            const r = await poster(s.url, x.jeton), j = r.json || {};
            H.v('JUMEAU-V2 lot mixte, plafond de pannes LIBRE : remboursé comme un lot introuvable ordinaire (une unité du plafond de pannes, rien dans le compteur dédié)',
                [j.facturation && j.facturation.rembourse, await essais(x), await compteurPanne(x), await compteurDe(x, 'jumeaux')], [true, 3, 1, 0]);
        });
        // le 21e : compteur dédié à 19 + un lot de 2 cartes refusées (19 + 2 > 20) et plafond de pannes plein : PAS remboursé, jamais gratuit sans limite
        await avec(J3, async s => {
            const x = await inst(); await plafondPlein(x); await poserCompteur(x, 'jumeaux', 19); lot([aff(P5), aff(P5)]);
            const r = await poster(s.url, x.jeton), j = r.json || {};
            H.v('JUMEAU-V2 lot de 2 cartes refusées, compteur dédié à 19 (19 + 2 > 20) et pannes plein : PAS remboursé { debite:1, plafond-jour, essai 2 }, compteur dédié resté à 19',
                [j.facturation && j.facturation.rembourse, j.facturation && j.facturation.debite, j.facturation && j.facturation.raisonNonRembourse, await essais(x), await compteurDe(x, 'jumeaux')], [false, 1, 'plafond-jour', 2, 19]);
        });
        await avec(() => ({ conclu: false, ids: [] }), async s => {
            const x = await inst(); await plafondPlein(x); lot([aff(P5), aff(P20A)]);
            const r = await poster(s.url, x.jeton), j = r.json || {};
            H.v('JUMEAU-V2 lot dont aucune carte n\'a de colonne : PANNE 503 INDISPONIBLE (jamais un lot d\'introuvables), remboursée dans le compteur dédié (2 cartes = 2 unités), pannes inchangé (essai 3)',
                [r.statut, j.erreur && j.erreur.code, j.analyse, j.facturation && j.facturation.rembourse, await essais(x), await compteurPanne(x), await compteurDe(x, 'jumeaux')], [503, 'INDISPONIBLE', undefined, true, 3, cfg.plafonds.panne, 2]);
        });
        await avec(undefined, async s => {
            const x = await inst(); lot([aff(P5), aff(P20A)]);
            const r = await poster(s.url, x.jeton), j = r.json || {};
            H.v('JUMEAU-V2 lot, DÉFAUT DE PRODUCTION (aucun fournisseur injecté, aucune colonne en mémoire) : aucune affirmation, panne INDISPONIBLE remboursée',
                [r.statut, j.erreur && j.erreur.code, j.facturation && j.facturation.rembourse, await essais(x)], [503, 'INDISPONIBLE', true, 3]);
        });
        await avec(id => (id === P5 ? { conclu: false, ids: [] } : { conclu: true, ids: [] }), async s => {
            const x = await inst(); lot([aff(P5), aff(P20A)]);
            const r = await poster(s.url, x.jeton), j = r.json || {}, c = parIndex(j), an = await analyseDe(j);
            H.v('JUMEAU-V2 lot, une carte sans colonne et une autre sans jumeau : la 1re est illisible (introuvable panne-lecture), la 2e identifiée ; le lot n\'est pas remboursé ; le motif est tracé par carte',
                [[0, 1].map(i => c[i] && c[i].statut), c[0] && c[0].raison, await essais(x), j.facturation && j.facturation.rembourse, an && an.cartes[0].motifJumeaux], [['introuvable', 'identifiee'], 'panne-lecture', 2, false, 'jumeaux-indisponibles']);
        });
    }
    {
        // Passe 2 (I1, N1) : la disponibilité. Le catalogue de la route, ET la colonne d'une archive plus ancienne : un produit PLUS RÉCENT que l'archive sous la métacarte du produit affirmé
        // bloque CE produit seul ; un produit ajouté sous une autre métacarte ne bloque rien. Chemin de PRODUCTION (aucun fournisseur injecté), version et catalogue réels du banc.
        const parIndex = j => Object.fromEntries(((j.analyse || {}).cartes || []).map(c => [c.index, c]));
        const analyseDe = async j => raw('analyses').findOne({ _id: new mongoose.Types.ObjectId(j.scanId) });
        const avec = async (jumeaux, f) => { const s = await monter(cfg, { identifierLot, jumeaux }); try { await f(s); } finally { await s.fermer(); } };
        const { creerCatalogue } = require('../identifier/catalogue');
        const cat = creerCatalogue({ cfg });
        const META_P5 = 990200 + (P5 % 1000);
        H.v('JUMEAU-V2 : catalogue.plusRecentDansMetacarte(max, métacarte) : aucun produit plus récent → false ; une métacarte non entière → lève',
            [await cat.plusRecentDansMetacarte(910139, META_P5), await cat.plusRecentDansMetacarte(910139, 12345), await cat.plusRecentDansMetacarte(910139, 'x').then(() => 'ne lève pas', () => 'lève')], [false, false, 'lève']);
        await raw('catalogue_produits').insertOne({ idProduct: 910998, name: 'Nouveau (PBL 099)', idExpansion: EXP, idMetacard: META_P5 });
        H.v('   un produit plus récent sous la métacarte → true ; sous une AUTRE métacarte → false ; pas plus récent que max → false',
            [await cat.plusRecentDansMetacarte(910139, META_P5), await cat.plusRecentDansMetacarte(910139, META_P5 + 1), await cat.plusRecentDansMetacarte(910998, META_P5)], [true, false, false]);
        const E = require('../chargeur/etat'), { creerConstructeur } = require('../chargeur/version');
        const b = creerConstructeur(); b.entree(VB.doc(P5, { idMetacard: META_P5, setNom: 'Banc Lot' }));
        for (const id of [P5, P20A, P1]) b.jumeau({ idProduct: id, idMetacard: 990200 + (id % 1000), idExpansion: EXP, numero: '1', tirage: 'intl' });
        E.installer(b.finir());
        await avec(undefined, async s => {
            const x = await inst(); lot([aff(P5), aff(P20A)]);
            const r = await poster(s.url, x.jeton), j = r.json || {}, c = parIndex(j), an = await analyseDe(j);
            H.v('JUMEAU-V2 lot, colonne CHARGÉE et un produit plus récent sous la métacarte de P5 : P5 seul ne conclut pas (carte illisible, motif jumeaux-perimes tracé), P20A (autre métacarte) est identifiée',
                [[0, 1].map(i => c[i] && c[i].statut), c[0] && c[0].raison, an && an.cartes[0].motifJumeaux, an && an.cartes[1].motifJumeaux], [['introuvable', 'identifiee'], 'panne-lecture', 'jumeaux-perimes', undefined]);
        });
        await raw('catalogue_produits').deleteOne({ idProduct: 910998 });
        await avec(undefined, async s => {
            const x = await inst(); lot([aff(P5), aff(P20A)]);
            const r = await poster(s.url, x.jeton), j = r.json || {}, c = parIndex(j);
            H.v('   le produit plus récent retiré : les deux cartes sont identifiées par la colonne (aucun jumeau), chemin de PRODUCTION', [[0, 1].map(i => c[i] && c[i].statut), await essais(x)], [['identifiee', 'identifiee'], 2]);
        });
        VB.installer(VIS);                                                    // la version du banc d'avant (sans colonne), pour la suite
    }
    // ── (7) les questions d'un lot
    {
        const x = await inst(); const Q1 = [POOL[1], POOL[2]], Q2 = [POOL[3], POOL[4], POOL[5]], Q3 = [POOL[6], POOL[7]];
        lot([aff(P5), qst(Q1), aff(P20A), qst(Q2), qst(Q3)]);
        const r = await poster(sv.url, x.jeton); const j = r.json || {}; const cs = (j.analyse || {}).cartes || [];
        const ts = cs.filter(c => c.statut === 'a-trancher');
        const lignes = await raw('questions').find({ scanId: new mongoose.Types.ObjectId(j.scanId) }).sort({ _id: 1 }).toArray();
        H.v('7. 3 questions : chacune a sa propre question (3 candidats distincts les uns des autres), scanId commun, une ligne `questions` par carte (_id scanId:index, lot:true, en-attente)',
            [ts.length, new Set(ts.map(c => JSON.stringify(c.candidats.map(p => p.idProduct)))).size, lignes.map(q => [q.carte, q.lot, q.etat])], [3, 3, [[1, true, 'en-attente'], [3, true, 'en-attente'], [4, true, 'en-attente']]]);
        H.v('   le crédit n\'est pas « réservé » (une question de lot ne se règle pas) : le débit reste débité, facturation { debite:1, reserve:0, motif lot }', [(await debits(x)).map(m => m.etat), j.facturation.debite, j.facturation.reserve, j.facturation.motif], [['debite'], 1, 0, 'lot']);
        const avant = [await mouvements(x), await essais(x)].map(v => JSON.stringify(v));
        const choixDe = c => c.question.choix[0].id;
        const q1 = ts.find(c => c.index === 1), q3 = ts.find(c => c.index === 3);
        const a = await repondre(sv.url, x.jeton, { scanId: j.scanId, carte: 1, choix: choixDe(q1) });
        const b = await repondre(sv.url, x.jeton, { scanId: j.scanId, carte: 3, choix: 'aucune' });
        const c = await repondre(sv.url, x.jeton, { scanId: j.scanId, carte: 4, choix: 'ne-sait-pas' });
        H.v('   répondre par un candidat : 200, carte identifiee à l\'index 1, facturation motif lot { debite:0 }', [a.statut, a.json.carte && a.json.carte.statut, a.json.carte && a.json.carte.index, a.json.facturation && [a.json.facturation.motif, a.json.facturation.debite]], [200, 'identifiee', 1, ['lot', 0]]);
        H.v('   « aucune » : 200 introuvable ; « ne-sait-pas » : 200 a-trancher — et rien n\'est coûté NI rendu', [b.statut, b.json.carte && b.json.carte.statut, c.statut, c.json.carte && c.json.carte.statut], [200, 'introuvable', 200, 'a-trancher']);
        H.v('   mouvements et solde identiques avant/après les trois réponses (répondre ne coûte rien et ne rembourse rien)', [JSON.stringify(await mouvements(x)), JSON.stringify(await essais(x))], avant);
        const faux = await repondre(sv.url, x.jeton, { scanId: j.scanId, carte: 0, choix: 'a' });
        H.v('   la carte 0 (identifiée) n\'a pas de question : 404 CODE_INVALIDE', [faux.statut, faux.json.erreur.code], [404, 'CODE_INVALIDE']);
        void q3;
    }
    // ── (8) images vs cartes (ruling 2)
    {
        const x = await compteLie({ accueil: 0, achete: 10 }); lot(nAff(25));
        const avantLot = appelsLot, avantChaine = appelsChaine;
        const trop = await poster(sv.url, x.jeton, corps(21));
        H.v('8. 21 images : 400 ENTREE (B1b.1), ni crochet (compteur d\'appels inchangé) ni chaîne ni débit', [trop.statut, trop.json.erreur.code, (await debits(x)).length, appelsLot - avantLot, appelsChaine - avantChaine], [400, 'ENTREE', 0, 0, 0]);
        const ok = await poster(sv.url, x.jeton, corps(3));
        H.v('   25 cartes vues sur 3 images : légitime (200, lot de 25, 3 crédits, le crochet appelé une fois de plus)', [ok.statut, ok.json.analyse && ok.json.analyse.lot && ok.json.analyse.lot.cartesVues, ok.json.facturation && ok.json.facturation.debite, appelsLot - avantLot], [200, 25, 3, 1]);
    }
    // ── (9) V2_LECTURE_LIVE_MAX par la route
    {
        const cfg3 = lireConfig({ ...BASE, V2_LECTURE_LIVE_MAX: '3' }); const sv3 = await monter(cfg3, { identifierLot });
        const x = await inst(); lot(nAff(2));
        const r = await poster(sv3.url, x.jeton, corps(1)); await sv3.fermer();
        H.v('9. lectureLiveMax rendu = celui de la configuration (3)', r.json.analyse && r.json.analyse.lot && r.json.analyse.lot.lectureLiveMax, 3);
    }
    // ── (10) 25 cartes débitées sur accueil + achete, une ligne UNITAIRE par crédit, remboursement poche par poche
    {
        const x = await compteLie({ accueil: 1, achete: 5 }); lot(nAff(25));
        const r = await poster(sv.url, x.jeton); const d = await debits(x);
        H.v('10. 25 cartes sur un compte accueil 1 + achete 5 : 3 lignes UNITAIRES (delta -1 chacune), poches [accueil, achete, achete], clés base / #0 / #1 du supplément',
            [r.statut, d.length, d.map(m => m.delta), d.map(m => m.credit && m.credit.poche), d.slice(1).map(m => m.cleIdempotence.replace(/^.*\|supplement/, 'supplement'))], [200, 3, [-1, -1, -1], ['accueil', 'achete', 'achete'], ['supplement#0', 'supplement#1']]);
        H.v('   soldes après débit : accueil 0, achete 3', [(await soldeCompte(x)).accueil, (await soldeCompte(x)).achete], [0, 3]);
        const y = await compteLie({ accueil: 1, achete: 5 }); lot(nIntro(25));
        const r2 = await poster(sv.url, y.jeton); const s = await soldeCompte(y);
        const rb = (await mouvements(y)).filter(m => m.type === 'remboursement' && m.delta === 1).map(m => m.poche).sort();
        H.v('   le même lot de 25, entièrement introuvable : remboursé poche par poche — accueil 1 et achete 5 retrouvés, une ligne +1 par unité (accueil, achete, achete), somme 0',
            [r2.json.facturation.rembourse, s.accueil, s.achete, rb, await net(y, 'lot de 25 remboursé')], [true, 1, 5, ['accueil', 'achete', 'achete'], 0]);
    }
    // ── supplément et concurrence entre deux requêtes de MÊME clé (ruling 3) : un seul jeu de lignes, le jumeau reçoit « en cours »
    {
        const x = await compteLie({ accueil: 0, achete: 10 }); lot(nAff(25), 400); const k = cle(); appelsLot = 0;
        const [a, b] = await Promise.all([poster(sv.url, x.jeton, corps(), k), poster(sv.url, x.jeton, corps(), k)]);
        const sts = [a.statut, b.statut].sort();
        const jumeau = a.statut === 200 ? b : a;
        H.v('C. deux requêtes concurrentes, même Idempotency-Key, lot de 25 : une réussit (200), le jumeau reçoit DEBIT « en cours » (429, reessayerDans 2)', [sts, jumeau.json.erreur.code, jumeau.json.erreur.reessayerDans], [[200, 429], 'DEBIT', 2]);
        const d = await debits(x);
        H.v('   UN seul jeu de lignes : 3 débits (jamais 6), 7 crédits restants, le crochet appelé une fois', [d.length, new Set(d.map(m => m.cleIdempotence)).size, (await soldeCompte(x)).achete, appelsLot], [3, 3, 7, 1]);
    }
    // ── la règle G ne juge pas un lot (ruling du brief)
    {
        const cfgG = lireConfig({ ...BASE, V2_REGLE_G: '1' });
        const svG = await monter(cfgG, { identifierLot, voisins }), svGsimple = await monter(cfgG, { voisins });
        const orig = RG.decisionRegleG; let appelsG = 0; RG.decisionRegleG = (...a) => { appelsG++; return orig(...a); };
        try {
            const x = await inst(); lot(nAff(3)); appelsVoisins = 0;
            const r = await poster(svG.url, x.jeton);
            H.v('G. règle G allumée + fournisseur de voisins + lot : decisionRegleG et voisins jamais appelés (espions 0 et 0), lot rendu', [r.json.analyse.statut, appelsG, appelsVoisins], ['lot', 0, 0]);
            const y = await inst(); await poster(svGsimple.url, y.jeton);
            H.v('   contrôle de l\'espion : la même configuration sans crochet (une carte) appelle bien decisionRegleG', [appelsG >= 1, appelsVoisins >= 1], [true, true]);
        } finally { RG.decisionRegleG = orig; await svG.fermer(); await svGsimple.fermer(); }
    }
    // ── pannes du crochet : rendues, jamais payées
    {
        const e = console.error; console.error = () => { };
        try {
            const res = [];
            for (const [nom, impl] of [['lève', async () => { throw new Error('boum'); }], ['rend un objet', async () => ({})], ['rend []', async () => []]]) {
                const x = await inst(); lotImpl = impl; const r = await poster(sv.url, x.jeton);
                res.push([nom, r.statut, r.json.erreur && r.json.erreur.code, r.json.facturation && r.json.facturation.rembourse, await essais(x), await net(x, `crochet ${nom}`)]);
            }
            H.v('P. crochet qui lève / rend un objet / rend [] : 500 SERVEUR, remboursé (essai 3), somme 0', res, [['lève', 500, 'SERVEUR', true, 3, 0], ['rend un objet', 500, 'SERVEUR', true, 3, 0], ['rend []', 500, 'SERVEUR', true, 3, 0]]);
            // toutes les cartes en panne (corps illisible) : une panne, pas un « introuvable »
            const y = await inst(); lot([{ statutHttp: 500, corps: null }, { statutHttp: 200, corps: { success: 'peut-être' } }]);
            const r = await poster(sv.url, y.jeton);
            H.v('   toutes les cartes en panne : 500 SERVEUR remboursée (jamais un lot « introuvable »)', [r.statut, r.json.erreur && r.json.erreur.code, await essais(y)], [500, 'SERVEUR', 3]);
            const z = await inst(); lot([{ statutHttp: 500, corps: null }, aff(P5)]);
            const r3 = await poster(sv.url, z.jeton);
            H.v('   une carte en panne parmi une identifiée : le lot vit, la carte en panne devient introuvable « panne-lecture » (cartesVues 2)', [r3.statut, r3.json.analyse.cartes.map(c => c.raison).filter(Boolean), r3.json.analyse.lot.cartesVues, r3.json.analyse.lot.introuvables], [200, ['panne-lecture'], 2, 1]);
        } finally { console.error = e; }
    }
    // ── administrateur : rien débité, jamais de supplément
    {
        const x = await compteLie({ accueil: 25, achete: 0 }, 'administrateur'); lot(nAff(25));
        const r = await poster(sv.url, x.jeton); const m = await mouvements(x);
        H.v('A. administrateur, lot de 25 : motif administrateur, UNE ligne de débit à delta 0, aucun supplément', [r.statut, r.json.facturation.motif, m.length, m.map(l => l.delta)], [200, 'administrateur', 1, [0]]);
    }
    // ── sans-prix : la garde reste FERMÉE sur un lot (ruling 4)
    {
        const x = await inst(); const Q = [POOL[10], POOL[11]];
        lot([aff(P5), aff(P20A), qst(Q)]);
        const r = await poster(sv.url, x.jeton); const scanId = new mongoose.Types.ObjectId(r.json.scanId);
        await raw('journal_scans').insertOne({ _id: scanId, userId: `v2:installation:${x.i._id}` });      // la ligne que la chaîne héritée écrit pour un scan
        const sp = idx => H.appel(sv.url, '/api/retour-live', { methode: 'POST', corps: { scanId: r.json.scanId, carte: idx, lectureRatee: { cause: 'sans-prix', definitive: true } }, entetes: { origin: ORIGINE, ...ip(), authorization: `Bearer ${x.jeton}` } });
        const a = await sp(0), b = await sp(2);
        H.v('S. sans-prix définitif sur une carte IDENTIFIÉE d\'un lot (index 0) et sur une question de lot (index 2) : 409 CONFLIT carte-non-identifiee, rien remboursé',
            [a.statut, a.json.erreur && a.json.erreur.detail, b.statut, b.json.erreur && b.json.erreur.detail, await essais(x), await net(x, 'sans-prix sur un lot')], [409, 'carte-non-identifiee', 409, 'carte-non-identifiee', 2, -1]);
        // contrôle : la garde n'est pas fermée partout — une carte seule, identifiée, est remboursée
        const y = await inst(); const r1 = await poster(svSimple.url, y.jeton); const s1 = new mongoose.Types.ObjectId(r1.json.scanId);
        await raw('journal_scans').insertOne({ _id: s1, userId: `v2:installation:${y.i._id}` });
        const c = await H.appel(sv.url, '/api/retour-live', { methode: 'POST', corps: { scanId: r1.json.scanId, carte: 0, lectureRatee: { cause: 'sans-prix', definitive: true } }, entetes: { origin: ORIGINE, ...ip(), authorization: `Bearer ${y.jeton}` } });
        H.v('   contrôle : le même appel sur une carte seule identifiée est remboursé (200, rembourse true, essai 3)', [c.statut, c.json.facturation && c.json.facturation.rembourse, await essais(y)], [200, true, 3]);
    }
    // ── sans-prix : la garde est écrite par ce qu'elle AUTORISE (identifiee / a-trancher) : un statut inconnu ne rembourse rien
    {
        const x = await inst(); const scanId = new mongoose.Types.ObjectId();
        await raw('analyses').insertOne({ _id: scanId, porteur: `installation:${x.i._id}`, statut: 'statut-inconnu', cartes: [{ statut: 'identifiee', idProduct: P5 }] });
        await raw('journal_scans').insertOne({ _id: scanId, userId: `v2:installation:${x.i._id}` });
        const r = await H.appel(sv.url, '/api/retour-live', { methode: 'POST', corps: { scanId: String(scanId), carte: 0, lectureRatee: { cause: 'sans-prix', definitive: true } }, entetes: { origin: ORIGINE, ...ip(), authorization: `Bearer ${x.jeton}` } });
        H.v('S2. sans-prix sur une analyse au statut INCONNU (carte identifiée dedans) : 409 carte-non-identifiee, rien remboursé', [r.statut, r.json.erreur && r.json.erreur.detail, await essais(x)], [409, 'carte-non-identifiee', 3]);
    }
    // ── U. un crochet qui rend EXACTEMENT 1 résultat ne fait pas un lot : branche UNE-CARTE (règle G, question réservée, sans-prix)
    {
        const cfgG = lireConfig({ ...BASE, V2_REGLE_G: '1' });
        const svG = await monter(cfgG, { identifierLot, voisins });
        const orig = RG.decisionRegleG; let appelsG = 0; RG.decisionRegleG = (...a) => { appelsG++; return orig(...a); };
        try {
            const x = await inst(); lot([aff(P5)]); appelsLot = 0; appelsChaine = 0;
            const r = await poster(sv.url, x.jeton); const a = r.json.analyse || {};
            H.v('U1. 1 résultat identifié : forme d\'une carte seule (identifiee, 1 carte, lot null, facturation affirmee), 1 crédit ; crochet appelé 1 fois, chaîne héritée jamais',
                [r.statut, a.statut, (a.cartes || []).length, a.lot, r.json.facturation.motif, await essais(x), appelsLot, appelsChaine], [200, 'identifiee', 1, null, 'affirmee', 2, 1, 0]);
            const y = await inst(); const Q = [POOL[20], POOL[21]]; lot([qst(Q)]); appelsLot = 0; appelsChaine = 0;
            const q = await poster(sv.url, y.jeton); const qa = q.json.analyse || {};
            const ligne = await raw('questions').findOne({ _id: `${q.json.scanId}:0` });
            H.v('U2. 1 résultat à trancher : a-trancher à 2 candidats, facturation { debite:0, reserve:1, motif question }, question réservée (PAS de lot:true), crochet 1 fois, chaîne 0',
                [q.statut, qa.statut, (qa.cartes[0].candidats || []).length, qa.lot, q.json.facturation, ligne && ligne.etat, ligne && ligne.lot, appelsLot, appelsChaine],
                [200, 'a-trancher', 2, null, { debite: 0, reserve: 1, rembourse: false, motif: 'question', raisonNonRembourse: null }, 'en-attente', false, 1, 0]);
            const ab = await repondre(sv.url, y.jeton, { scanId: q.json.scanId, carte: 0, choix: 'aucune' });
            H.v('   répondre « aucune » à cette question : le crédit est RENDU (essai 3, somme 0), facturation rembourse', [ab.statut, ab.json.facturation && ab.json.facturation.rembourse, await essais(y), await net(y, 'question à 1 résultat abandonnée')], [200, true, 3, 0]);
            const z = await inst(); lot([intro()]);
            const i = await poster(sv.url, z.jeton);
            H.v('U3. 1 résultat introuvable : introuvable (1 carte, lot null), remboursé (essai 3)', [i.json.analyse.statut, i.json.analyse.lot, i.json.facturation.rembourse, await essais(z)], ['introuvable', null, true, 3]);
            appelsG = 0; const g = await inst(); lot([aff(P5)]);
            const rg = await poster(svG.url, g.jeton);
            H.v('U4. règle G allumée + 1 résultat : decisionRegleG CONSULTÉE (espion), la chaîne héritée décide (identifiee)', [rg.json.analyse.statut, appelsG], ['identifiee', 1]);
            const s = await inst(); lot([aff(P5)]);
            const rs = await poster(sv.url, s.jeton); const sid = new mongoose.Types.ObjectId(rs.json.scanId);
            await raw('journal_scans').insertOne({ _id: sid, userId: `v2:installation:${s.i._id}` });
            const sp = await H.appel(sv.url, '/api/retour-live', { methode: 'POST', corps: { scanId: rs.json.scanId, carte: 0, lectureRatee: { cause: 'sans-prix', definitive: true } }, entetes: { origin: ORIGINE, ...ip(), authorization: `Bearer ${s.jeton}` } });
            H.v('U5. sans-prix sur le résultat unique : remboursé comme une carte seule (200, rembourse, essai 3)', [sp.statut, sp.json.facturation && sp.json.facturation.rembourse, await essais(s)], [200, true, 3]);
        } finally { RG.decisionRegleG = orig; await svG.fermer(); }
    }
    // ── M. plafond partagé de 100 cartes par scan
    {
        let mod = sur(() => require('../identifier/cartes-par-scan'));
        H.v('M0. borne partagée cartesParScanMax(cfg) = cfg.lot.cartesMax (100 dans ce banc) : un seul module, aucune constante', typeof mod === 'object' && typeof mod.cartesParScanMax === 'function' ? [mod.cartesParScanMax(cfg), mod.CARTES_PAR_SCAN_MAX] : mod, [100, undefined]);
        const fs = require('fs');
        const src = n => fs.readFileSync(path.join(__dirname, '..', 'identifier', n), 'utf8');
        H.v('   plus de littéral 99 ni de constante locale dans routes.js, retour-live.js, lot.js', ['routes.js', 'retour-live.js', 'lot.js'].map(n => /carte\s*>\s*99|CARTES_MAX\s*=/.test(src(n))), [false, false, false]);
        const x = await inst(); lot(nAff(101));
        const e = console.error; console.error = () => { };
        let r; try { r = await poster(sv.url, x.jeton); } finally { console.error = e; }
        H.v('M1. 101 résultats (borne 100) : REFUSÉ lot-trop-grand-taille (400 ENTREE, jamais tronqué), remboursé, essai 3, somme 0', [r.statut, r.json.erreur && r.json.erreur.code, r.json.erreur && r.json.erreur.detail, r.json.facturation && r.json.facturation.rembourse, await essais(x), await net(x, '101 résultats')], [400, 'ENTREE', 'lot-trop-grand-taille', true, 3, 0]);
        const y = await compteLie({ accueil: 0, achete: 20 }); lot(nAff(100));
        const r2 = await poster(sv.url, y.jeton);
        H.v('M2. 100 résultats : servi (200, lot de 100, 10 crédits)', [r2.statut, r2.json.analyse && r2.json.analyse.lot && r2.json.analyse.lot.cartesVues, r2.json.facturation && r2.json.facturation.debite, (await soldeCompte(y)).achete], [200, 100, 10, 10]);
        const a = await repondre(sv.url, y.jeton, { scanId: r2.json.scanId, carte: 99, choix: 'a' }), b = await repondre(sv.url, y.jeton, { scanId: r2.json.scanId, carte: 100, choix: 'a' });
        H.v('   /reponse : la carte 99 est adressable (404 « pas de question », pas 400), la 100 est refusée (400 ENTREE)', [a.statut, b.statut], [404, 400]);
    }
    // ── 3a. questions seules / introuvables + question : jamais remboursé
    {
        const x = await inst(); const Q = [POOL[22], POOL[23]]; lot([...nIntro(3), qst(Q)]);
        const r = await poster(sv.url, x.jeton); const j = r.json;
        const rep = await repondre(sv.url, x.jeton, { scanId: j.scanId, carte: 3, choix: 'a' });
        H.v('3a. 3 introuvables + 1 question : NON remboursé (motif lot, essai 2), question posée à l\'index 3 et répondable (200 identifiee)', [j.facturation.rembourse, j.facturation.motif, await essais(x), j.analyse.lot.aTrancher, rep.statut, rep.json.carte && rep.json.carte.statut], [false, 'lot', 2, 1, 200, 'identifiee']);
        const y = await inst(); lot([qst([POOL[24], POOL[25]]), qst([POOL[26], POOL[27]])]);
        const r2 = await poster(sv.url, y.jeton);
        const n = await raw('questions').countDocuments({ scanId: new mongoose.Types.ObjectId(r2.json.scanId), etat: 'en-attente' });
        H.v('   un lot de questions seules : NON remboursé (essai 2), 2 questions en attente', [r2.json.analyse.statut, r2.json.facturation.rembourse, await essais(y), n], ['lot', false, 2, 2]);
    }
    // ── 3b. deux lots de 25 du même porteur, clés différentes : deux jeux de clés de supplément
    {
        const x = await compteLie({ accueil: 0, achete: 20 });
        lot(nAff(25)); const a = await poster(sv.url, x.jeton), b = await poster(sv.url, x.jeton);
        const d = await debits(x); const sup = d.map(m => m.cleIdempotence).filter(k => k.includes('|supplement#'));
        H.v('3b. deux lots de 25 (clés différentes) : 6 lignes de débit, 6 clés distinctes, DEUX préfixes de supplément distincts (4 unités), achete 14', [a.statut, b.statut, d.length, new Set(d.map(m => m.cleIdempotence)).size, sup.length, new Set(sup.map(k => k.split('#')[0])).size, (await soldeCompte(x)).achete], [200, 200, 6, 6, 4, 2, 14]);
    }
    // ── 3c. refus du supplément par un autre code que QUOTA, supplément qui lève, réservation de question qui échoue
    {
        const registre = require('../registre'); const argentReg = registre.obtenir('argent');
        const origS = argentReg.debiterSupplement, origQ = argentReg.reserverQuestion;
        const e = console.error; console.error = () => { };
        try {
            const res = [];
            for (const [code, statut] of [['VERIFICATION', 403], ['EN_RECONCILIATION', 409]]) {
                argentReg.debiterSupplement = async () => ({ ok: false, code }); const x = await inst(); lot(nAff(25));
                const r = await poster(sv.url, x.jeton);
                res.push([code, r.statut, r.json.erreur && r.json.erreur.code, r.json.erreur && r.json.erreur.detail === undefined, await essais(x), await net(x, `supplément refusé ${code}`)]);
                void statut;
            }
            H.v('3c. supplément refusé par VERIFICATION / EN_RECONCILIATION : l\'erreur de CE code (pas QUOTA), pas de detail lot-trop-grand, crédit initial rendu, somme 0', res, [['VERIFICATION', 403, 'VERIFICATION', true, 3, 0], ['EN_RECONCILIATION', 409, 'EN_RECONCILIATION', true, 3, 0]]);
            argentReg.debiterSupplement = async () => { throw new Error('panne simulée : supplément'); }; const y = await inst(); lot(nAff(25));
            const r2 = await poster(sv.url, y.jeton);
            H.v('   debiterSupplement qui LÈVE : 500 SERVEUR remboursée (essai 3, somme 0)', [r2.statut, r2.json.erreur && r2.json.erreur.code, r2.json.facturation && r2.json.facturation.rembourse, await essais(y), await net(y, 'supplément qui lève')], [500, 'SERVEUR', true, 3, 0]);
            argentReg.debiterSupplement = origS;
            argentReg.reserverQuestion = async () => { throw new Error('panne simulée : réservation'); }; const z = await inst(); lot([qst([POOL[28], POOL[29]]), aff(P5)]);
            const r3 = await poster(sv.url, z.jeton);
            const ouvertes = await raw('questions').countDocuments({ scanId: new mongoose.Types.ObjectId(r3.json.scanId || '0'.repeat(24)), etat: 'en-attente' });
            H.v('   réservation de question qui échoue dans un lot : 500 SERVEUR remboursée (essai 3, somme 0), aucune question en attente', [r3.statut, r3.json.erreur && r3.json.erreur.code, await essais(z), await net(z, 'réservation qui échoue'), ouvertes], [500, 'SERVEUR', 3, 0, 0]);
        } finally { argentReg.debiterSupplement = origS; argentReg.reserverQuestion = origQ; console.error = e; }
    }
    // ── 3d. le remboursement d'un lot introuvable est refusé (plafond du jour atteint) : le client paie TOUT le lot, et on le dit
    {
        const svPlaf = await monter(lireConfig({ ...BASE, V2_PLAFOND_PANNES: '0' }), { identifierLot });
        const x = await compteLie({ accueil: 0, achete: 10 }); lot(nIntro(25));
        const r = await poster(svPlaf.url, x.jeton); await svPlaf.fermer();
        // le registre « argent » est global au processus et LIÉ à la configuration du dernier montage : on le relie à la configuration ordinaire pour la suite
        await (await monter(cfg, {})).fermer();
        H.v('3d. lot de 25 introuvable, plafond de remboursements atteint : facturation { debite:3 (le coût du lot), rembourse:false, motif plafond-jour, cause plafond-jour }, achete 7',
            [r.statut, r.json.facturation, (await soldeCompte(x)).achete], [200, { debite: 3, reserve: 0, rembourse: false, motif: 'plafond-jour', raisonNonRembourse: 'plafond-jour' }, 7]);
    }
    // ── N1. un résultat unique NON CONFORME ne rappelle JAMAIS la vraie chaîne (une seconde lecture payante) : 500 SERVEUR remboursé
    {
        const e = console.error; console.error = () => { };
        try {
            const res = [];
            for (const [nom, v] of [['null', null], ['undefined', undefined], ['0', 0], ['chaîne vide', '']]) {
                const x = await inst(); lot([v]); appelsLot = 0; appelsChaine = 0;
                const r = await poster(sv.url, x.jeton);
                res.push([nom, r.statut, r.json.erreur && r.json.erreur.code, r.json.facturation && r.json.facturation.rembourse, await essais(x), await net(x, `résultat unique ${nom}`), appelsChaine, appelsLot]);
            }
            H.v('N1. crochet [null] / [undefined] / [0] / [\'\'] : 500 SERVEUR remboursé (essai 3, somme 0), chaîne héritée 0 appel, crochet 1 appel', res,
                [['null', 500, 'SERVEUR', true, 3, 0, 0, 1], ['undefined', 500, 'SERVEUR', true, 3, 0, 0, 1], ['0', 500, 'SERVEUR', true, 3, 0, 0, 1], ['chaîne vide', 500, 'SERVEUR', true, 3, 0, 0, 1]]);
            // N2. un résultat unique EN PANNE : comme une carte seule en panne
            const y = await inst(); lot([{ statutHttp: 500, corps: null }]); appelsLot = 0; appelsChaine = 0;
            const r = await poster(sv.url, y.jeton);
            H.v('N2. 1 résultat en panne { statutHttp:500, corps:null } : 500 SERVEUR remboursé comme une carte seule (essai 3, somme 0), chaîne 0 appel, crochet 1 appel',
                [r.statut, r.json.erreur && r.json.erreur.code, r.json.facturation && r.json.facturation.rembourse, await essais(y), await net(y, 'résultat unique en panne'), appelsChaine, appelsLot], [500, 'SERVEUR', true, 3, 0, 0, 1]);
        } finally { console.error = e; }
    }
    // ── N3. /api/retour-live à la frontière de CARTES_PAR_SCAN_MAX (comportement, pas seulement la regex) : 99 passe la validation, 100 ⇒ 400
    {
        const x = await inst(); const idInconnu = String(new mongoose.Types.ObjectId());
        const rl = idx => H.appel(sv.url, '/api/retour-live', { methode: 'POST', corps: { scanId: idInconnu, carte: idx, lectureRatee: { cause: 'sans-prix', definitive: true } }, entetes: { origin: ORIGINE, ...ip(), authorization: `Bearer ${x.jeton}` } });
        const a = await rl(99), b = await rl(100);
        H.v('N3. /retour-live : carte 99 acceptée par la validation (404 scan introuvable), carte 100 ⇒ 400 ENTREE', [a.statut, a.json.erreur && a.json.erreur.code, b.statut, b.json.erreur && b.json.erreur.code], [404, 'CODE_INVALIDE', 400, 'ENTREE']);
    }
    await sv.fermer(); await svSimple.fermer();
    await mongoose.disconnect(); await H.arreterBanc();
    H.bilan();
})().catch(async e => { console.error('❌', e); try { await H.arreterBanc(); } catch (_) { } process.exit(1); });
