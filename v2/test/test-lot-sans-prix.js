'use strict';
// Banc LOT-SANS-PRIX (décision de l'éditeur, 2026-10-24) : « Lot sans prix : OUI, rembourse-le, comme le contrat le promettait. Un scan qui n'affiche aucun prix ne compte pas dans le quota. »
// Un lot dont AUCUNE carte n'affiche de prix (au sens de prix-repli.js::afficheUnPrix : un `prixGuide` servi, ou un `prixRepli` servi ; les candidats d'une question comptent) est rendu en entier,
// par le MÊME chemin que le lot entièrement introuvable (ledger.rendreLeScan : une claim par scan, un seul passage au plafond, chaque unité à sa poche) ; un lot dont UNE carte affiche un prix reste compté.
// Base : la base EN MÉMOIRE du banc. Aucun réseau. Les résultats du crochet `deps.identifierLot` sont FABRIQUÉS (formes copiées de test-identifier-lot.js) ; les guides sont semés (valeurs de banc, jamais présentées comme réelles).
const H = require('./_harnais');
const path = require('path');
const mongoose = require('mongoose');
const express = require('express');
const db = require('../db'); const M = require('../modeles'); const J = require('../comptes/jetons'); const Q = require('./_aide-quota'); const VB = require('./_visuels-banc');
const { lireConfig } = require('../config');
const { valider } = require('../openapi/valider'); const SCHEMA = require('../openapi/openapi.v2.json');
const L = require('../identifier/lot');
const { adapter } = require('../identifier/adaptateur');
const CHARGES = path.join(__dirname, '..', '..', 'verrou', 'charges.json');
const IMAGE = require(CHARGES).charges.find(c => c.cellule === 'occidentale').imageUrl;
const ref = n => ({ $ref: `#/components/schemas/${n}` });
const BASE = { MONGODB_BASE: 'test_scratch', V2_HEBDO: '0', V2_LOT_CARTES_MAX: '100' };
const cfg = lireConfig(BASE);
const ORIGINE = cfg.origines.extension;
let nIp = 0; const ip = () => { nIp++; return { 'x-forwarded-for': `10.12.${Math.floor(nIp / 250)}.${nIp % 250 + 1}` }; };
let nCle = 0; const cle = () => `banc-lsp-${Date.now().toString(36)}-${++nCle}`;
const raw = n => mongoose.connection.db.collection(n);
const sur = f => { try { return f(); } catch (e) { return `💥 ${e && e.message}`; } };

// ════════════ A. la règle, pure (aucune base) ════════════
// Une carte de lot telle que l'adaptateur la rend : { index, statut, carte|null, candidats, question, prixLive, ... }.
const guide = { tendance: 4.2, de: 3, deBase: 'tous-etats', moyenne7: 4, moyenne30: 4.1, date: '2026-10-04', fiable: true, reserves: [] };
const idf = (prixGuide, extra = {}) => ({ index: 0, statut: 'identifiee', carte: { idProduct: 1, prixGuide }, candidats: [], question: null, prixLive: null, ...extra });
const qs = (...guides) => ({ index: 0, statut: 'a-trancher', carte: null, candidats: guides.map((g, i) => ({ idProduct: 10 + i, prixGuide: g })), question: {}, prixLive: null });
const intro = () => ({ index: 0, statut: 'introuvable', carte: null, candidats: [], question: null, raison: 'photo-illisible', prixLive: null });
const repli = { repli: 'tendance', cause: 'langue-non-lue', fiable: false, guide, offre: null };
const piege = new Proxy({}, { get() { throw new Error('boum'); } });
// tour 2 (I2) : la règle reçoit aussi les LECTURES du lot (lectures[i].codeLangue, ce que l'adaptateur a lu pour la carte d'entrée i) ; chaque carte reçoit son index d'entrée (sa position)
const NL = { codeLangue: null }, LU = { codeLangue: 2 };
const regle = (cs, lectures) => sur(() => L.lotAfficheUnPrix(Array.isArray(cs) ? cs.map((c, i) => (c && typeof c === 'object' ? { ...c, index: i } : c)) : cs, lectures));

H.v('A1. deux cartes identifiées sans AUCUN guide : aucun prix affiché', regle([idf(null), idf(null)]), false);
const live = { idProduct: 1, langues: [2], reverseHolo: false, etatVise: null };
H.v('A11. I1 : une carte sans guide ni repli dont la réponse sert une instruction de prix EN DIRECT (prixLive objet, même à etatVise null) : un prix est possiblement affiché', [regle([idf(null, { prixLive: live }), idf(null)]), regle([idf(null, { prixLive: { ...live, etatVise: 'EX' } })])], [true, true]);
H.v('A12. I1 : prixLive absent (undefined) ou d\'une forme inconnue : un doute, le lot est compté ; seule la valeur null (langue non lue) vaut « sans instruction »', [regle([idf(null, { prixLive: undefined })]), regle([idf(null, { prixLive: 'x' })]), regle([idf(null, { prixLive: null })])], [true, true, false]);
H.v('A2. une carte au guide parmi des cartes sans guide : un prix est affiché', regle([idf(null), idf(guide), idf(null)]), true);
H.v('A3. une carte sans guide mais qui porte un prixRepli servi : un prix est affiché (le repli compte, comme afficheUnPrix)', regle([idf(null, { prixRepli: repli }), idf(null)]), true);
H.v('A4. un prixGuide ABSENT (ni objet ni null : on ne sait pas) : jamais « sans prix » — une garde écrite par ce qu\'elle autorise', regle([idf(undefined), idf(null)]), true);
H.v('A5. une question dont AUCUN candidat n\'a de guide : aucun prix affiché ; dont UN candidat en a : un prix est affiché', [regle([qs(null, null, null), idf(null)], [NL, NL]), regle([qs(null, guide), idf(null)], [NL, NL])], [false, true]);
H.v('A13. I2 : une question sans guide dont la LANGUE est lue (lectures[i].codeLangue non null) recevra une instruction de prix en direct après un OUI : prix possiblement affiché, le lot reste compté', [regle([qs(null, null), idf(null)], [LU, NL]), regle([qs(null, null), idf(null)], [{ codeLangue: 5 }, NL])], [true, true]);
H.v('A14. I2 : lectures absentes, trop courtes ou d\'une forme inconnue : un doute (lot compté) ; seule la valeur codeLangue null de CETTE carte vaut « langue non lue »', [regle([qs(null, null), idf(null)]), regle([qs(null, null), idf(null)], []), regle([qs(null, null), idf(null)], [{}, NL]), regle([qs(null, null), idf(null)], [{ codeLangue: undefined }, NL]), regle([qs(null, null), idf(null)], [NL, NL])], [true, true, true, true, false]);
H.v('A15. M2 : une question SANS candidat (candidats vide) est un doute, jamais « sans prix » : le lot reste compté', [regle([qs(), idf(null)], [NL, NL]), regle([qs()], [NL])], [true, true]);
H.v('A6. introuvables seules ou avec des cartes sans prix : aucun prix ; un introuvable ne rend pas son voisin sans prix payant', [regle([intro(), intro()]), regle([intro(), idf(null)])], [false, false]);
H.v('A7. un statut inconnu, une carte non objet, une carte identifiée sans fiche : un prix est supposé affiché (jamais un remboursement sur un doute)', [regle([{ statut: 'inconnu' }, idf(null)]), regle([null, idf(null)]), regle([{ statut: 'identifiee', carte: null }, idf(null)])], [true, true, true]);
H.v('A8. une carte dont la lecture du prix LÈVE : supposée affichée (la règle ne lève jamais, et ne rembourse pas sur un doute)', regle([idf(piege), idf(null)]), true);
H.v('A9. une liste vide ou qui n\'en est pas une : un prix supposé affiché', [regle([]), regle(undefined), regle('x')], [true, true, true]);
H.v('A10. une question à candidats NON LISTÉS (champ absent) : supposée affichée', regle([{ index: 0, statut: 'a-trancher', carte: null, question: {} }]), true);

// ════════════ B. par la route ════════════
const EXP = 990003;
const AVEC = 920001, AVEC2 = 920002;                                  // au guide
const SANS = Array.from({ length: 14 }, (_, i) => 920100 + i);        // AUCUNE ligne au guide : prixGuide null
const VIS = [];
const semer = async (id, trend) => {
    await raw('catalogue_produits').insertOne({ idProduct: id, name: 'Tropius (PBL 001)', idExpansion: EXP, idMetacard: 990300 + (id % 1000) });
    await raw('numeros_cartes').insertOne({ idProduct: id, idExpansion: EXP, numero: '001', numeroUrl: 'PBL001', codeSet: 'PBL', nomFr: 'Tropius', slug: 'Tropius-PBL001', slugSet: 'Banc-Lot-Sans-Prix', source: 'cardmarket', certitude: 'exacte' });
    if (trend !== undefined) await raw('guide_prix').insertOne({ idProduct: id, avg: trend, low: trend / 2, trend, avg1: trend, avg7: trend, avg30: trend, guideDu: new Date('2026-10-04') });
    VIS.push(VB.doc(id, { idMetacard: 990300 + (id % 1000), setNom: 'Banc Lot Sans Prix' }));
};
const carteCorps = (id, ambigu) => ({ idProduct: id, nomProduit: 'Tropius', nom: 'Tropius', numero: '001', total: '064', setCode: 'PBL', rarete: null, langue: 'FR', ambigu });
const ETAT = { estimeIA: null, confianceIA: null, defautsVus: [], declareVendeur: null, declareCardmarket: null, retenu: null };
const cand = id => ({ idProduct: id, nom: 'Tropius', numero: '001', set: 'Banc Lot', prix: 1, photoUrl: null });
const aff = id => ({ statutHttp: 200, corps: { success: true, question: null, carte: carteCorps(id, false), etat: ETAT, candidats: [cand(id)], classement: [], guidePrix: {}, reverse: { attendue: false, motif: null, etat: 'aucun-motif', strategie: null }, codeLangue: 2 } });
const qst = ids => ({ statutHttp: 200, corps: { success: true, question: { etat: 'en-attente', delaiHeures: 24 }, carte: carteCorps(ids[0], true), etat: ETAT, candidats: ids.map(cand), classement: [], guidePrix: {}, reverse: { attendue: false, motif: null, etat: 'aucun-motif', strategie: null }, codeLangue: 2 } });
const introRes = () => ({ statutHttp: 200, corps: { success: false, natureRefus: 'refus-delibere', motifRefus: 'aucun-prix' } });
// LOT-SANS-PRIX tour 1 (I1) : une carte dont la LANGUE est lue reçoit une instruction de prix en direct (`prixLive` objet, adaptateur.js) : l'extension peut montrer un prix, le lot reste compté. `affNL` : langue NON lue
// (codeLangue null => prixLive null) ; c'est la seule forme d'une carte « positivement sans prix ». `sansN` = langue non lue (les lots rendus) ; `lueN` = langue lue (les lots comptés).
const affNL = id => { const r = aff(id); return { ...r, corps: { ...r.corps, codeLangue: null } }; };
const sansN = n => Array.from({ length: n }, (_, i) => affNL(SANS[i % SANS.length]));
const lueN = n => Array.from({ length: n }, (_, i) => aff(SANS[i % SANS.length]));
// tour 2 (I2) : une QUESTION à langue lue recevra un `prixLive` après un OUI (routes.js, prixLiveDe) : prix possiblement affiché ; `qstNL` : langue non lue (la seule question « positivement sans prix » quand ses candidats n'ont pas de guide)
const qstNL = ids => { const r = qst(ids); return { ...r, corps: { ...r.corps, codeLangue: null } }; };

async function inst(o = {}) {
    const jeton = J.genererJeton(); const i = Object.assign(M.nouvelleInstallation({ jetonEmpreinte: J.empreinte(jeton), essais: 3, libelle: 'banc' }), o);
    await db.col('installations').insertOne(i);
    if (o.achete > 0) await db.col('mouvements').insertOne({ installationId: i._id, le: new Date('2026-09-01T00:00:00Z'), surface: 'extension', type: 'migration', delta: o.achete, poche: 'achete', motif: 'migration', scanId: null, etat: 'debite', cleIdempotence: `ouverture|installation:${i._id}`, expireLe: new Date('2028-09-01T00:00:00Z') });
    return { i, jeton, p: { type: 'installation', id: i._id }, cle: `installation:${i._id}` };
}
const corps = () => ({ contrat: 2, imageUrls: [IMAGE], title: null, description: null, prixVinted: null, devise: null, marche: 'vinted.fr', versionExtension: '2.0.0', langueInterface: 'fr' });
const poster = (url, jeton, k = cle()) => H.appel(url, '/api/identifier', { methode: 'POST', corps: corps(), entetes: { origin: ORIGINE, ...ip(), authorization: `Bearer ${jeton}`, 'idempotency-key': k } });
const repondre = (url, jeton, b) => H.appel(url, '/api/identifier/reponse', { methode: 'POST', corps: b, entetes: { origin: ORIGINE, ...ip(), authorization: `Bearer ${jeton}` } });
const essais = x => Q.restantDe(x.p, cfg);
const mouv = x => raw('mouvements').find({ installationId: x.i._id }).toArray();
const net = async x => (await mouv(x)).filter(m => m.type !== 'migration').reduce((s, m) => s + m.delta, 0);          // hors l'ouverture : le NET des analyses (débits + rendus)
const rendus = async x => (await mouv(x)).filter(m => m.type === 'remboursement' && m.delta === 1);
const compteur = async (x, type) => ((await raw('plafonds').findOne({ porteur: x.cle, type })) || {}).count ?? 0;
const acheteDe = async x => (await db.col('installations').findOne({ _id: x.i._id })).achete;
const poserCompteur = (x, type, count) => raw('plafonds').insertOne({ porteur: x.cle, jour: Q.jourCourant(), type, count, expireLe: new Date(Date.now() + 3 * 86400e3) });

(async () => {
    await H.ouvrirBancV2();
    await H.eviterFrontieres({ jour: true });
    await Q.eviterMinuit();
    process.env.MONGODB_BASE = 'test_scratch';
    const { connecterMongo } = require('../../mongo-connexion');
    await connecterMongo({ script: 'test-lot-sans-prix.js', ecrit: true });
    db.brancher(mongoose.connection.db);
    await M.creerIndex();
    for (const c of ['catalogue_produits', 'numeros_cartes', 'guide_prix', 'codes_set']) await raw(c).deleteMany({});
    await raw('codes_set').insertOne({ idExpansion: EXP, codeSet: 'PBL', apprisLe: new Date() });
    await semer(AVEC, 6); await semer(AVEC2, 3);
    for (const id of SANS) await semer(id);
    VB.installer(VIS);

    const pret = require('../pret'); const { dansUnScan } = require('../../sources'); const { assembler } = require('../index');
    let lotImpl = null;
    const chaine = async (req, res) => res.json({ ...aff(AVEC).corps, scanId: String(req.scanIdImpose) });
    const identifierLot = async req => lotImpl(req);
    const monter = async (deps = {}, cfgApp = cfg) => {
        const app = express(); app.set('trust proxy', true); app.use(express.json()); app.use((q, s, n) => dansUnScan(n));
        pret.armer(M.verifierIndex);
        app.use(assembler([require('../argent/monter'), require('../identifier/monter')], cfgApp, { jumeaux: () => ({ conclu: true, ids: [] }), gererIdentifier: chaine, gererRetourLive: async (q, s) => s.json({ success: true }), identifierLot, ...deps }));
        return H.serveur(app);
    };
    const lot = liste => { lotImpl = async () => liste; };
    const sv = await monter();
    const FACT = (o = {}) => ({ debite: 0, reserve: 0, rembourse: true, motif: 'sans-prix', raisonNonRembourse: null, poche: 'jour', ...o });

    // ── B1. un lot de cartes identifiées SANS guide ni repli : remboursé, toutes ses unités, la poche du jour
    {
        const x = await inst(); lot(sansN(3));
        const r = await poster(sv.url, x.jeton), j = r.json || {};
        H.v('B1. 3 cartes identifiées sans aucun guide : 200, lot servi (3 cartes identifiées), remboursé { debite 0, rembourse true, motif sans-prix, poche jour }',
            [r.statut, j.analyse && j.analyse.statut, j.analyse && j.analyse.cartes.map(c => c.statut), j.facturation], [200, 'lot', ['identifiee', 'identifiee', 'identifiee'], FACT()]);
        H.v('   le quota est rendu (essai 3), net du grand livre 0, UN remboursement tracé (motif de grand livre sans-prix), offre.restant 3', [await essais(x), await net(x), (await rendus(x)).map(m => m.motif), j.offre && j.offre.restant], [3, 0, ['sans-prix'], 3]);
        H.v('   le compteur des CONSTATS du jour est à 1 (le serveur seul a constaté), celui des DÉCLARATIONS n\'est pas touché', [await compteur(x, 'constate'), await compteur(x, 'declare')], [1, 0]);
        H.v('   aucun prix n\'est réellement servi dans la réponse (ni prixGuide ni prixRepli sur aucune carte) — c\'est ce qui fonde le remboursement', (j.analyse.cartes).map(c => [c.carte.prixGuide, 'prixRepli' in c]), [[null, false], [null, false], [null, false]]);
        const v = valider(j, ref('ReponseAnalyse'), SCHEMA);
        H.vrai(`   la réponse valide contre ReponseAnalyse (${v.ok ? 'ok' : v.erreurs.slice(0, 3).map(e => e.chemin + ' ' + e.message).join(' ; ')})`, v.ok);
        const an = await raw('analyses').findOne({ _id: new mongoose.Types.ObjectId(j.scanId) });
        H.v('   la ligne `analyses` garde la facturation décidée (rendue, motif sans-prix)', [an && an.facturation.rembourse, an && an.facturation.motif], [true, 'sans-prix']);
    }
    // ── B1 bis (I1). les MÊMES cartes sans guide, mais dont la langue est LUE : la réponse sert une instruction de prix en direct (prixLive), l'extension peut montrer un prix que le serveur ne verra jamais : le lot reste COMPTÉ
    {
        const x = await inst(); lot(lueN(3));
        const r = await poster(sv.url, x.jeton), j = r.json || {};
        H.v('B1b. I1 : 3 cartes sans guide ni repli, langue lue (prixLive objet) : compté { debite 1, rembourse false, motif lot }, essai 2, aucun remboursement, aucun compteur', [r.statut, j.facturation, await essais(x), (await rendus(x)).length, await compteur(x, 'constate')], [200, FACT({ debite: 1, rembourse: false, motif: 'lot' }), 2, 0, 0]);
        H.v('   la réponse sert bien l\'instruction en direct sur ces cartes (sans guide, sans repli)', j.analyse.cartes.map(c => [c.carte.prixGuide, 'prixRepli' in c, c.prixLive && typeof c.prixLive.idProduct]), [[null, false, 'number'], [null, false, 'number'], [null, false, 'number']]);
        const y = await inst(); lot([...sansN(2), lueN(1)[0]]);
        const r2 = await poster(sv.url, y.jeton);
        H.v('   UNE seule carte à langue lue parmi des cartes à langue non lue suffit à garder le lot compté', [r2.json.facturation.motif, r2.json.facturation.rembourse, await essais(y)], ['lot', false, 2]);
    }
    // ── B2. UNE carte au guide : le lot est compté, comme aujourd'hui
    {
        const x = await inst(); lot([...sansN(2), aff(AVEC)]);
        const r = await poster(sv.url, x.jeton), j = r.json || {};
        H.v('B2. 2 cartes sans guide + 1 au guide : compté { debite 1, rembourse false, motif lot }, essai 2, aucun remboursement, aucun compteur', [r.statut, j.facturation, await essais(x), (await rendus(x)).length, await compteur(x, 'constate')],
            [200, FACT({ debite: 1, rembourse: false, motif: 'lot' }), 2, 0, 0]);
    }
    // ── B3. UN repli servi (carte sans guide mais qui porte un prixRepli) : compté. L'adaptateur est INJECTÉ (la route et la règle sont les vraies) : un repli naît d'un guide, la règle ne dépend pas de cette dérivation.
    {
        const adapterRepli = (res, ctx) => {
            const a = adapter(res, ctx);
            if (!a.analyse || !a.analyse.cartes) return a;
            const cartes = a.analyse.cartes.map((c, i) => (i === 0 && c.statut === 'identifiee' ? { ...c, carte: { ...c.carte, prixGuide: null }, prixRepli: repli } : c));
            return { ...a, analyse: { ...a.analyse, cartes } };
        };
        const svR = await monter({ adapter: adapterRepli });
        const x = await inst(); lot(sansN(3));
        const r = await poster(svR.url, x.jeton), j = r.json || {};
        H.v('B3. 3 cartes sans guide dont UNE porte un prixRepli servi : compté { debite 1, motif lot }, essai 2, aucun remboursement', [r.statut, j.facturation, await essais(x), (await rendus(x)).length], [200, FACT({ debite: 1, rembourse: false, motif: 'lot' }), 2, 0]);
        const y = await inst(); lot(sansN(3));
        const r2 = await poster(sv.url, y.jeton);
        H.v('   contrôle : les mêmes 3 cartes, adaptateur ordinaire (aucun repli) : remboursé', [r2.json.facturation.rembourse, await essais(y)], [true, 3]);
        await svR.fermer();
    }
    // ── B4. une QUESTION : un candidat au guide => compté ; aucun candidat au guide => remboursé, et la question reste posée et répondable
    {
        const x = await inst(); lot([...sansN(2), qst([SANS[5], AVEC])]);
        const r = await poster(sv.url, x.jeton), j = r.json || {};
        H.v('B4. 2 cartes sans guide + une question dont UN candidat a un guide : compté { debite 1, motif lot }, essai 2', [r.statut, j.facturation, await essais(x), (await rendus(x)).length], [200, FACT({ debite: 1, rembourse: false, motif: 'lot' }), 2, 0]);
        const y = await inst(); lot([...sansN(2), qstNL([SANS[5], SANS[6]])]);
        const r2 = await poster(sv.url, y.jeton), j2 = r2.json || {};
        const q = await raw('questions_v2').findOne({ _id: `${j2.scanId}:2` });
        H.v('   une question dont AUCUN candidat n\'a de guide : le lot est remboursé (motif sans-prix), essai 3, net 0', [r2.statut, j2.facturation, await essais(y), await net(y)], [200, FACT(), 3, 0]);
        const choixOui = { scanId: j2.scanId, carte: 2, choix: (j2.analyse.cartes.find(c => c.index === 2).question.choix[0].id) };
        const oui = await repondre(sv.url, y.jeton, choixOui);
        H.v('   la question est tout de même posée (lot: true, en attente) et répondable : répondre par un candidat 200 identifiee, rien n\'est coûté ni rendu de plus', [q && q.etat, q && q.lot, oui.statut, await essais(y), await net(y), (await rendus(y)).length], ['en-attente', true, 200, 3, 0, 1]);
        // M1 : la facturation servie à cette réponse OUI redit le remboursement déjà fait (rembourse true, même motif sans-prix, rien débité), jamais le « lot » générique d'un lot payé ; le rejeu de la même réponse la redit à l'identique
        const ouiRejeu = await repondre(sv.url, y.jeton, choixOui);
        const fRendu = { debite: 0, reserve: 0, rembourse: true, motif: 'sans-prix', raisonNonRembourse: null };
        H.v('   M1 : la réponse OUI sert { debite 0, rembourse true, motif sans-prix } ; son rejeu aussi ; toujours UN seul tracé, net 0, constats 1, déclarations 0, essai 3', [oui.json.facturation, ouiRejeu.statut, ouiRejeu.json.facturation, (await rendus(y)).length, await net(y), await compteur(y, 'constate'), await compteur(y, 'declare'), await essais(y)], [fRendu, 200, fRendu, 1, 0, 1, 0, 3]);
        // une confirmation à UN candidat sans prix + un introuvable : rien n'affiche de prix => remboursé ; refuser la confirmation ne rend RIEN de plus (la claim du lot est la même)
        // I2 : la MÊME question dont les candidats n'ont pas de guide mais dont la langue est LUE : compté (un OUI servira un prixLive), la question est posée
        const w = await inst(); lot([...sansN(2), qst([SANS[5], SANS[6]])]);
        const rw = await poster(sv.url, w.jeton);
        H.v('   I2 : 2 cartes à langue non lue + une question sans guide à langue LUE : compté { debite 1, motif lot }, essai 2, aucun remboursement, question posée', [rw.statut, rw.json.facturation, await essais(w), (await rendus(w)).length, await raw('questions_v2').countDocuments({ scanId: new mongoose.Types.ObjectId(rw.json.scanId), etat: 'en-attente' })], [200, FACT({ debite: 1, rembourse: false, motif: 'lot' }), 2, 0, 1]);
        const z = await inst(); lot([introRes(), qstNL([SANS[7]])]);
        const r3 = await poster(sv.url, z.jeton), j3 = r3.json || {};
        H.v('   1 introuvable + 1 confirmation sans prix : remboursé (rien n\'affiche de prix), essai 3', [r3.statut, j3.analyse && j3.analyse.statut, j3.facturation && j3.facturation.rembourse, await essais(z)], [200, 'lot', true, 3]);
        const non = await repondre(sv.url, z.jeton, { scanId: j3.scanId, carte: 1, choix: 'aucune' });
        H.v('   puis « aucune » à la confirmation : la réponse redit le lot rendu (rembourse true), SANS second remboursement (un tracé, net 0, constats 1, déclarations 0)',
            [non.statut, non.json.facturation && non.json.facturation.rembourse, (await rendus(z)).length, await net(z), await compteur(z, 'constate'), await compteur(z, 'declare'), await essais(z)], [200, true, 1, 0, 1, 0, 3]);
    }
    // ── B5. le REJEU de la même requête : une seule unité, un seul remboursement ; une autre clé = un autre lot, rendu aussi
    {
        const x = await inst(); lot(sansN(3)); const k = cle();
        const a = await poster(sv.url, x.jeton, k), b = await poster(sv.url, x.jeton, k);
        H.v('B5. même Idempotency-Key rejouée : même corps, marqué Idempotency-Replayed, UN remboursement, essai 3, net 0, constats 1', [a.statut, b.statut, b.texte === a.texte, b.entetes['idempotency-replayed'], (await rendus(x)).length, await essais(x), await net(x), await compteur(x, 'constate')], [200, 200, true, 'true', 1, 3, 0, 1]);
        const argent = require('../registre').obtenir('argent');
        const mem = await raw('mouvements').findOne({ installationId: x.i._id, type: 'debit' });
        const encore = await argent.rembourser(x.p, mem.credit, 'sans-prix', { scanId: mem.scanId });
        H.v('   un second remboursement du même scan (un autre chemin) : deja-rembourse, rien de plus rendu, compteur inchangé', [encore.rendu, encore.raisonNonRembourse, (await rendus(x)).length, await net(x), await compteur(x, 'constate')], [false, 'deja-rembourse', 1, 0, 1]);
        lot(sansN(3)); const c = await poster(sv.url, x.jeton);
        H.v('   une AUTRE clé : un autre lot, rendu lui aussi (2 tracés, constats 2, essai 3)', [c.json.facturation.rembourse, (await rendus(x)).length, await compteur(x, 'constate'), await essais(x)], [true, 2, 2, 3]);
    }
    // ── B6. le plafond atteint : le MÊME comportement qu'un lot entièrement introuvable (facturation, quota, compteur rendu à sa valeur)
    {
        const plein = cfg.plafonds.constates.sansCompte;
        const x = await inst(); await poserCompteur(x, 'constate', plein); lot(sansN(3));
        const r = await poster(sv.url, x.jeton), j = r.json || {};
        const y = await inst(); await poserCompteur(y, 'constate', plein); lot([introRes(), introRes(), introRes()]);
        const ri = await poster(sv.url, y.jeton), ji = ri.json || {};
        const attendu = { debite: 1, reserve: 0, rembourse: false, motif: 'plafond-jour', raisonNonRembourse: 'plafond-jour', poche: 'jour' };
        H.v(`B6. plafond des constats atteint (${plein}) : le lot sans prix n'est PAS rendu — { debite 1, motif plafond-jour, raisonNonRembourse plafond-jour }, essai 2, compteur resté à ${plein}, aucun tracé, pas de champ declaration`,
            [r.statut, j.facturation, await essais(x), await compteur(x, 'constate'), (await rendus(x)).length, 'declaration' in j], [200, attendu, 2, plein, 0, false]);
        H.v('   EXACTEMENT ce que fait un lot entièrement introuvable au même plafond (même facturation, même quota, même compteur)', [ji.facturation, await essais(y), await compteur(y, 'constate'), (await rendus(y)).length], [attendu, 2, plein, 0]);
        // un lot de 11 cartes (2 unités) au plafond : le client a payé TOUT le lot, la facturation le dit
        const z = await inst(); await poserCompteur(z, 'constate', plein); lot(sansN(11));
        const rz = await poster(sv.url, z.jeton);
        H.v('   lot de 11 cartes sans prix au plafond : debite 2 (tout le lot), essai 1', [rz.json.facturation.debite, rz.json.facturation.motif, await essais(z)], [2, 'plafond-jour', 1]);
        // le plafond des DÉCLARATIONS n'est pas celui-ci : plein, il ne change rien à ce remboursement (le serveur a constaté, le client n'a rien déclaré)
        const w = await inst(); await poserCompteur(w, 'declare', cfg.plafonds.declares.sansCompte); lot(sansN(3));
        const rw = await poster(sv.url, w.jeton);
        H.v('   le compteur des déclarations plein ne l\'empêche pas : rendu, constats 1, déclarations inchangées', [rw.json.facturation.rembourse, await compteur(w, 'constate'), await compteur(w, 'declare')], [true, 1, cfg.plafonds.declares.sansCompte]);
    }
    // ── B7. les trois poches, comme un lot introuvable
    {
        const a = await inst({ achete: 0 }); lot(sansN(11));
        const ra = await poster(sv.url, a.jeton);
        H.v('B7a. lot de 11 cartes sans prix (2 unités), sans achetée : rendu en entier, poche « jour », essai 3, net 0, 2 tracés', [ra.json.facturation, await essais(a), await net(a), (await rendus(a)).length], [FACT(), 3, 0, 2]);
        const b = await inst({ achete: 2 }); lot(sansN(11));
        const rb = await poster(sv.url, b.jeton);
        H.v('B7b. le même lot, 2 achetées : les deux unités étaient sur achete, rendues à achete — poche « achete », achete 2, quota intact (3), net 0', [rb.json.facturation, await acheteDe(b), await essais(b), await net(b), (await rendus(b)).map(m => m.poche)], [FACT({ poche: 'achete' }), 2, 3, 0, ['achete', 'achete']]);
        const c = await inst({ achete: 1 }); lot(sansN(11));
        const rc = await poster(sv.url, c.jeton);
        H.v('B7c. le même lot, 1 achetée (à cheval : achete puis jour) : chaque unité rendue à SA poche, poche « jour » (pas toutes sur achete), achete 1, quota 3, net 0', [rc.json.facturation, await acheteDe(c), await essais(c), await net(c), (await rendus(c)).map(m => m.poche).sort()], [FACT(), 1, 3, 0, ['achete', 'jour']]);
        // le contrôle : les mêmes poches pour un lot entièrement INTROUVABLE (le chemin dont celui-ci hérite)
        const d = await inst({ achete: 1 }); lot(Array.from({ length: 11 }, introRes));
        const rd = await poster(sv.url, d.jeton);
        H.v('   contrôle : un lot de 11 introuvables, 1 achetée : mêmes poches rendues, même poche servie « jour »', [rd.json.facturation.poche, await acheteDe(d), await essais(d), (await rendus(d)).map(m => m.poche).sort()], ['jour', 1, 3, ['achete', 'jour']]);
    }
    // ── B8. l'administrateur ne paie rien : aucun remboursement n'est tenté
    {
        const c = Object.assign(M.nouveauCompte({ email: `lsp${++nCle}@x.fr`, emailCle: `lsp${nCle}@x.fr`, motDePasse: {} }), { verifie: true, role: 'administrateur', solde: { accueil: 25, achete: 0 } });
        await db.col('comptes').insertOne(c);
        const jeton = J.genererJeton(); const i = Object.assign(M.nouvelleInstallation({ jetonEmpreinte: J.empreinte(jeton), essais: 0, libelle: 'banc' }), { compteId: c._id });
        await db.col('installations').insertOne(i);
        lot(sansN(3));
        const r = await poster(sv.url, jeton), j = r.json || {};
        const m = await raw('mouvements').find({ compteId: c._id }).toArray();
        H.v('B8. administrateur, lot sans prix : motif administrateur, aucun remboursement (débit à delta 0 seulement), compte intact (accueil 25)', [r.statut, j.facturation && j.facturation.motif, j.facturation && j.facturation.rembourse, m.filter(l => l.type === 'remboursement').length, (await raw('comptes').findOne({ _id: c._id })).solde.accueil], [200, 'administrateur', false, 0, 25]);
    }
    // ── B9. la réservation d'une question échoue dans un lot DÉJÀ rendu : une panne SERVEUR, et la facturation dit « rendu » (jamais « deja-rembourse »)
    {
        const registre = require('../registre'); const argentReg = registre.obtenir('argent');
        const orig = argentReg.reserverQuestion; const e = console.error; console.error = () => { };
        try {
            argentReg.reserverQuestion = async () => { throw new Error('panne simulée : réservation'); };
            const x = await inst(); lot([affNL(SANS[0]), qstNL([SANS[1], SANS[2]])]);
            const r = await poster(sv.url, x.jeton), j = r.json || {};
            H.v('B9. lot sans prix dont la réservation de question échoue : 500 SERVEUR, facturation rendue (rembourse true, pas une raison « deja-rembourse »), essai 3, net 0, UN tracé',
                [r.statut, j.erreur && j.erreur.code, j.facturation && j.facturation.rembourse, j.facturation && j.facturation.raisonNonRembourse, await essais(x), await net(x), (await rendus(x)).length], [500, 'SERVEUR', true, null, 3, 0, 1]);
            const y = await inst(); lot([aff(AVEC), qst([SANS[1], SANS[2]])]);
            const r2 = await poster(sv.url, y.jeton);
            H.v('   contrôle : le même échec dans un lot qui AFFICHE un prix : remboursé par la panne (comme avant), essai 3, net 0', [r2.statut, r2.json.facturation && r2.json.facturation.rembourse, await essais(y), await net(y)], [500, true, 3, 0]);
        } finally { argentReg.reserverQuestion = orig; console.error = e; }
    }
    // ── B10. les cas d'avant ne bougent pas : un lot entièrement introuvable reste « introuvable », un lot au guide reste compté
    {
        const x = await inst(); lot([introRes(), introRes()]);
        const r = await poster(sv.url, x.jeton);
        H.v('B10. lot entièrement introuvable : motif introuvable (inchangé), rendu', [r.json.facturation.motif, r.json.facturation.rembourse, await essais(x)], ['introuvable', true, 3]);
        const y = await inst(); lot([aff(AVEC), aff(AVEC2)]);
        const r2 = await poster(sv.url, y.jeton);
        H.v('    lot de deux cartes au guide : compté, motif lot', [r2.json.facturation.motif, r2.json.facturation.rembourse, await essais(y)], ['lot', false, 2]);
        const z = await inst(); lot([introRes(), introRes(), affNL(SANS[3])]);
        const r3 = await poster(sv.url, z.jeton);
        H.v('    2 introuvables + 1 identifiée sans prix : rendu, motif sans-prix (une carte lue, mais aucun prix affiché)', [r3.json.facturation.motif, r3.json.facturation.rembourse, await essais(z)], ['sans-prix', true, 3]);
    }

    await sv.fermer();
    await mongoose.disconnect(); await H.arreterBanc();
    H.bilan();
})().catch(async e => { console.error('❌', e); try { await H.arreterBanc(); } catch (_) { } process.exit(1); });
