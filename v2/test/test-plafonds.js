'use strict';
// Banc PLAFONDS (2026-10-11, révisé par PLAFOND-DECLARE le 2026-10-14) — « prix illisible, définitif » : une DÉCLARATION, compteur commun plafonné par offre (sans compte 1, gratuit 3, Pro 30) ; lots trop grands : 10 refus par jour et par compte
// (V2_LOT_TROP_GRAND_JOUR), taille d'un lot 20 cartes (V2_LOT_CARTES_MAX, entier >= 2). Base EN MÉMOIRE (INT2), aucun réseau, résultats du crochet FABRIQUÉS.
// « Un jour » = le jour UTC de ledger.js (`maintenant.toISOString().slice(0, 10)`), la définition des plafonds panne/question.
const H = require('./_harnais');
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');
const db = require('../db'); const M = require('../modeles'); const J = require('../comptes/jetons');
const { lireConfig } = require('../config');
const CHARGES = path.join(__dirname, '..', '..', 'verrou', 'charges.json');
const IMAGE = require(CHARGES).charges.find(c => c.cellule === 'occidentale').imageUrl;
const Q = require('./_aide-quota');
// OFFRE-QUOTA : un « solde » de N crédits devient un quota du jour de 1000 dont 1000 - N sont déjà pris (voir _aide-quota.js) ; l'arithmétique des plafonds de remboursement n'en change pas.
const BASE = { MONGODB_BASE: 'test_scratch', V2_HEBDO: '0', V2_QUOTA_GRATUIT: String(Q.GRAND), V2_QUOTA_SANS_COMPTE: String(Q.GRAND), V2_QUOTA_PRO_PLAFOND: String(Q.GRAND) };
const cfg = lireConfig(BASE);
const ORIGINE = cfg.origines.extension;
let nIp = 0; const ip = () => { nIp++; return { 'x-forwarded-for': `10.12.${Math.floor(nIp / 250)}.${nIp % 250 + 1}` }; };
let nCle = 0; const cle = () => `banc-plaf-${Date.now().toString(36)}-${++nCle}`;
const raw = n => mongoose.connection.db.collection(n);
const jourUTC = () => Q.jourCourant();

const EXP = 990003;
const semer = async (id, trend) => {
    await raw('catalogue_produits').insertOne({ idProduct: id, name: 'Tropius (PBL 001)', idExpansion: EXP, idMetacard: 990300 + (id % 1000) });
    await raw('numeros_cartes').insertOne({ idProduct: id, idExpansion: EXP, numero: '001', numeroUrl: 'PBL001', codeSet: 'PBL', nomFr: 'Tropius', slug: 'Tropius-PBL001', slugSet: 'Banc-Plaf', source: 'cardmarket', certitude: 'exacte' });
    await raw('guide_prix').insertOne({ idProduct: id, avg: trend, low: trend / 2, trend, avg1: trend, avg7: trend, avg30: trend, guideDu: new Date('2026-10-04') });
    await raw('visuels').insertOne({ idProduct: id, vignette: { cle: `banc/${id}-v.webp`, w: 300, h: 420 }, grande: null, mention: null, idMetacard: 990300 + (id % 1000), numero: '001', rarete: 'Common', total: '064', variante: 'normale', setNom: 'Banc Plaf', lien: null });
};
const P = 920001, POOL = Array.from({ length: 6 }, (_, i) => 920100 + i);
const carteCorps = (id, ambigu) => ({ idProduct: id, nomProduit: 'Tropius', nom: 'Tropius', numero: '001', total: '064', setCode: 'PBL', rarete: null, langue: 'FR', ambigu });
const ETAT = { estimeIA: null, confianceIA: null, defautsVus: [], declareVendeur: null, declareCardmarket: null, retenu: null };
const cand = id => ({ idProduct: id, nom: 'Tropius', numero: '001', set: 'Banc Plaf', prix: 1, photoUrl: null });
const REV = { attendue: false, motif: null, etat: 'aucun-motif', strategie: null };
const aff = id => ({ statutHttp: 200, corps: { success: true, question: null, carte: carteCorps(id, false), etat: ETAT, candidats: [cand(id)], classement: [], guidePrix: {}, reverse: REV, codeLangue: 2 } });
const qst = ids => ({ statutHttp: 200, corps: { success: true, question: { etat: 'en-attente', delaiHeures: 24 }, carte: carteCorps(ids[0], true), etat: ETAT, candidats: ids.map(cand), classement: [], guidePrix: {}, reverse: REV, codeLangue: 2 } });
const nAff = n => Array.from({ length: n }, (_, i) => aff(POOL[i % POOL.length]));

async function compteLie(solde, role) {
    const c = Object.assign(M.nouveauCompte({ email: `plaf${++nCle}@x.fr`, emailCle: `plaf${nCle}@x.fr`, motDePasse: {} }), { verifie: true, solde: { ...solde, achete: 0 } }, role ? { role } : {});      // ACHETE-AVANT-JOUR : l'ancien stock devient du QUOTA ci-dessous ; le document garde achete 0 (la poche achete a son banc : test-achete-avant-jour.js)
    await db.col('comptes').insertOne(c);
    await Q.poserRestant(`compte:${c._id}`, (solde.achete || 0) + (solde.accueil || 0));
    return { c, ...(await installationDe(c)) };
}
async function installationDe(c) {
    const jeton = J.genererJeton(); const i = Object.assign(M.nouvelleInstallation({ jetonEmpreinte: J.empreinte(jeton), essais: 0, libelle: 'banc' }), { compteId: c._id });
    await db.col('installations').insertOne(i); return { i, jeton };
}
async function inst(o = {}) {
    const jeton = J.genererJeton(); const i = Object.assign(M.nouvelleInstallation({ jetonEmpreinte: J.empreinte(jeton), essais: 3, libelle: 'banc' }), o);
    await db.col('installations').insertOne(i); return { i, jeton };
}
const corps = (nImages = 1) => ({ contrat: 2, imageUrls: Array(nImages).fill(IMAGE), title: null, description: null, prixVinted: null, devise: null, marche: 'vinted.fr', versionExtension: '2.0.0', langueInterface: 'fr' });
const entetes = (jeton, plus = {}) => ({ origin: ORIGINE, ...ip(), authorization: `Bearer ${jeton}`, ...plus });
const poster = (url, jeton, c = corps(), k = cle()) => H.appel(url, '/api/identifier', { methode: 'POST', corps: c, entetes: entetes(jeton, { 'idempotency-key': k }) });
const repondre = (url, jeton, b) => H.appel(url, '/api/identifier/reponse', { methode: 'POST', corps: b, entetes: entetes(jeton) });
const retour = (url, jeton, b) => H.appel(url, '/api/retour-live', { methode: 'POST', corps: b, entetes: entetes(jeton) });
const LR = scanId => ({ scanId, carte: 0, lectureRatee: { cause: 'sans-prix', definitive: true } });
const solde = async c => ({ achete: await Q.restantDe({ type: 'compte', id: c._id }, cfg) });      // le « solde » d'un compte = ce qu'il lui reste aujourd'hui (OFFRE-QUOTA)
const compteur = async (cle_, type) => { const d = await raw('plafonds').findOne({ porteur: cle_, jour: jourUTC(), type }); return d ? d.count : 0; };
const capter = async f => { const lignes = []; const e = console.error, w = console.warn, l = console.log; console.error = console.warn = (...a) => { lignes.push(a.join(' ')); }; try { return { r: await f(), lignes }; } finally { console.error = e; console.warn = w; console.log = l; } };

(async () => {
    // ════════ configuration ════════
    {
        const c = lireConfig(BASE);
        // PLAFOND-DECLARE : « prix illisible, définitif » n'a plus de plafond propre (V2_SANS_PRIX_JOUR est sans objet) : il partage le compteur des déclarations (test-plafond-declare.js). Reste ici : lot-trop-grand et la taille d'un lot.
        H.v('C1. défauts : V2_LOT_TROP_GRAND_JOUR 10, V2_LOT_CARTES_MAX 20',
            [c.plafonds.lotTropGrand, c.lot.cartesMax], [10, 20]);
        const c2 = lireConfig({ ...BASE, V2_LOT_TROP_GRAND_JOUR: '3', V2_LOT_CARTES_MAX: '30' });
        H.v('C2. les deux variables changent les valeurs', [c2.plafonds.lotTropGrand, c2.lot.cartesMax], [3, 30]);
        const zero = lireConfig({ ...BASE, V2_LOT_TROP_GRAND_JOUR: '0' });
        H.v('C3. 0 est valide pour le plafond des refus de lot (aucun remboursement)', zero.plafonds.lotTropGrand, 0);
        const rejets = [];
        for (const [nom, v] of [['V2_LOT_TROP_GRAND_JOUR', ' '], ['V2_LOT_TROP_GRAND_JOUR', '-3'],
            ['V2_LOT_CARTES_MAX', '1'], ['V2_LOT_CARTES_MAX', '0'], ['V2_LOT_CARTES_MAX', 'abc'], ['V2_LOT_CARTES_MAX', '20.5'], ['V2_LOT_CARTES_MAX', ' ']]) {
            let e = null; try { lireConfig({ ...BASE, [nom]: v }); } catch (x) { e = x.message; }
            rejets.push(/configuration invalide/.test(e || ''));
        }
        H.v('C4. valeurs invalides (texte, négatif, décimal, espaces ; cartesMax 1 et 0 sous le minimum 2) : configuration invalide (7 sur 7)', rejets.filter(Boolean).length, 7);
        H.v('C5. V2_LOT_CARTES_MAX=2 est le minimum accepté', lireConfig({ ...BASE, V2_LOT_CARTES_MAX: '2' }).lot.cartesMax, 2);
        let haut = null; try { lireConfig({ ...BASE, V2_LOT_CARTES_MAX: '101' }); } catch (x) { haut = x.message; }
        H.v('C6. borne haute : 100 (l\'ancien plafond dur) accepté, 101 = configuration invalide', [lireConfig({ ...BASE, V2_LOT_CARTES_MAX: '100' }).lot.cartesMax, /configuration invalide/.test(haut || '')], [100, true]);
    }

    await H.ouvrirBancV2();
    // B2b point 6 : les plafonds sont comptés par JOUR UTC ; le banc sème un compteur du jour PUIS fait la requête, que la route date avec `new Date()` : minuit entre les deux ferait lire un autre jour.
    await H.eviterFrontieres({ jour: true }); await Q.eviterMinuit();
    process.env.MONGODB_BASE = 'test_scratch';
    const { connecterMongo } = require('../../mongo-connexion');
    await connecterMongo({ script: 'test-plafonds.js', ecrit: true });
    db.brancher(mongoose.connection.db);
    await M.creerIndex();
    for (const c of ['catalogue_produits', 'numeros_cartes', 'guide_prix', 'codes_set', 'visuels']) await raw(c).deleteMany({});
    await raw('codes_set').insertOne({ idExpansion: EXP, codeSet: 'PBL', apprisLe: new Date() });
    await semer(P, 20); for (const id of POOL) await semer(id, 2);

    const express = require('express'); const pret = require('../pret');
    const { dansUnScan } = require('../../sources'); const { assembler } = require('../index');
    let appelsLot = 0, lotImpl = null;
    const chaine = async (req, res) => res.json({ ...aff(P).corps, scanId: String(req.scanIdImpose) });
    const identifierLot = async () => { appelsLot++; return lotImpl(); };
    const monter = async (cfgApp, deps) => {
        const app = express(); app.set('trust proxy', true); app.use(express.json()); app.use((q, s, n) => dansUnScan(n));
        pret.armer(require('../modeles').verifierIndex);
        app.use(assembler([require('../argent/monter'), require('../identifier/monter')], cfgApp, { jumeaux: () => ({ conclu: true, ids: [] }), gererIdentifier: chaine, gererRetourLive: async (q, s) => s.json({ success: true }), ...deps }));
        return H.serveur(app);
    };
    const lot = liste => { lotImpl = async () => liste; };
    const svSimple = await monter(cfg, {});
    const svLot = await monter(cfg, { identifierLot });
    // un scan à UNE carte identifiée, avec la ligne du journal hérité que /retour-live exige ; `userIdDe` = l'identité du PORTEUR (compte, ou installation non liée)
    const scanIdentifie = async (x, porteurUserId) => {
        const r = await poster(svSimple.url, x.jeton);
        if (r.statut !== 200) throw new Error(`scan refusé ${r.statut}`);
        await raw('journal_scans').insertOne({ _id: new mongoose.Types.ObjectId(r.json.scanId), userId: porteurUserId });
        await Q.sansDonneeDePrix(r.json.scanId);      // REPLI-QUOTA : ce banc juge le REMBOURSEMENT et ses plafonds, qui ne valent que sans repli servi (avec un repli le scan compte : test-repli-quota.js)
        return r.json.scanId;
    };

    // ════════ « prix illisible, définitif » : DÉCLARATION du client, compteur commun, 3 par jour pour un compte gratuit (PLAFOND-DECLARE) ════════
    {
        const x = await compteLie({ accueil: 0, achete: 30 }); const pk = `compte:${x.c._id}`, uid = `v2:compte:${x.c._id}`;
        const issues = []; const ids = [];
        for (let k = 0; k < 4; k++) ids.push(await scanIdentifie(x, uid));
        const { r: reps, lignes } = await capter(async () => { const o = []; for (const id of ids) o.push(await retour(svSimple.url, x.jeton, LR(id))); return o; });
        for (const r of reps) issues.push(r.json.facturation.rembourse ? 'rendu' : r.json.facturation.raisonNonRembourse);
        H.v('S1. 4 « prix illisible, définitif » du même compte gratuit : 3 rendus, le 4e plafond-jour', issues, ['rendu', 'rendu', 'rendu', 'plafond-jour']);
        const f4 = reps[3].json.facturation;
        H.v('    le 4e : 200, facturation { debite:1, rembourse:false, motif plafond-jour, raisonNonRembourse plafond-jour } ET declaration { rendue:false, raison plafond-declarations, plafondJour 3 }', [reps[3].statut, f4.debite, f4.rembourse, f4.motif, f4.raisonNonRembourse, reps[3].json.declaration], [200, 1, false, 'plafond-jour', 'plafond-jour', { rendue: false, raison: 'plafond-declarations', plafondJour: 3 }]);
        H.v('    les trois premiers disent declaration { rendue:true, raison:null, plafondJour:3 }', reps.slice(0, 3).map(r => r.json.declaration), Array(3).fill({ rendue: true, raison: null, plafondJour: 3 }));
        H.v('    le crédit du 4e reste débité (achete 30 - 4 + 3 = 29)', (await solde(x.c)).achete, 29);
        H.v('    compteur COMMUN « declare » = 3 ; aucun compteur « sans-prix », « question » ni « panne »',
            [await compteur(pk, 'declare'), await compteur(pk, 'sans-prix'), await compteur(pk, 'question'), await compteur(pk, 'panne')], [3, 0, 0, 0]);
        const refus = lignes.filter(l => /\[v2 plafond\]/.test(l) && /declare/.test(l));
        H.v('    UNE ligne de journal pour l\'unique refus, sans e.message ni identifiant de compte', [refus.length, refus.some(l => l.includes(String(x.c._id)) || /Error:/.test(l))], [1, false]);
        const rejeu = await retour(svSimple.url, x.jeton, LR(ids[0]));
        H.v('    rejeu d\'un scan déjà rendu : deja-rembourse, le compteur ne bouge pas (3), aucun champ declaration', [rejeu.json.facturation.raisonNonRembourse, await compteur(pk, 'declare'), 'declaration' in rejeu.json], ['deja-rembourse', 3, false]);
        const val = require('../openapi/valider').valider(reps[3].json, { $ref: '#/components/schemas/ReponseRetourLive' }, require('../openapi/openapi.v2.json'));
        H.vrai(`    la réponse refusée valide contre ReponseRetourLive (${val.ok ? 'ok' : val.erreurs.slice(0, 3).map(e => e.chemin + ' ' + e.message).join(' ; ')})`, val.ok);
    }
    // deux installations d'un MÊME compte partagent le plafond (le porteur d'une installation liée EST le compte) ; une installation sans compte a le sien (1)
    {
        const a = await compteLie({ accueil: 0, achete: 30 }); const b = await installationDe(a.c); const uid = `v2:compte:${a.c._id}`, pk = `compte:${a.c._id}`;
        const sa = [], sb = [];
        for (let k = 0; k < 4; k++) sa.push(await scanIdentifie(a, uid));
        for (let k = 0; k < 2; k++) sb.push(await scanIdentifie(b, uid));
        const out = [];
        for (const id of sa.slice(0, 3)) out.push((await retour(svSimple.url, a.jeton, LR(id))).json.facturation.rembourse);
        for (const id of sb) out.push((await retour(svSimple.url, b.jeton, LR(id))).json.facturation.rembourse);
        const quatrieme = await retour(svSimple.url, a.jeton, LR(sa[3]));
        H.v('S2. deux installations du même compte (3 rendus depuis la première, 2 refusés depuis la seconde) : le compteur est celui du compte, la 4e depuis la première est refusée', [out, quatrieme.json.facturation.raisonNonRembourse, await compteur(pk, 'declare')], [[true, true, true, false, false], 'plafond-jour', 3]);
        H.v('    un seul compteur, celui du compte (aucun compteur d\'installation)', await raw('plafonds').countDocuments({ porteur: { $regex: '^installation:' }, type: 'declare', jour: jourUTC() }), 0);
        const z = await inst({ essais: 10 }); const zid = []; for (let k = 0; k < 3; k++) zid.push(await scanIdentifie(z, `v2:installation:${z.i._id}`));
        const o2 = []; for (const id of zid) o2.push((await retour(svSimple.url, z.jeton, LR(id))).json.facturation);
        H.v('S3. installation SANS compte (seul porteur possible) : son compteur propre, plafond 1 : une rendue puis plafond-jour',
            [o2.map(f => (f.rembourse ? 'rendu' : f.raisonNonRembourse)), await compteur(`installation:${z.i._id}`, 'declare')], [['rendu', 'plafond-jour', 'plafond-jour'], 1]);
    }
    // indépendance : les refus de lot ne vident pas les déclarations, et inversement ; l'abandon d'une question partage le compteur des déclarations
    {
        const x = await compteLie({ accueil: 0, achete: 30 }); const pk = `compte:${x.c._id}`, uid = `v2:compte:${x.c._id}`;
        await raw('plafonds').insertOne({ porteur: pk, jour: jourUTC(), type: 'lot-trop-grand', count: cfg.plafonds.lotTropGrand, expireLe: new Date(Date.now() + 3 * 86400e3) });
        const id = await scanIdentifie(x, uid);
        const r = await retour(svSimple.url, x.jeton, LR(id));
        H.v('S4. plafond des refus de lot saturé (10/10) : le « prix illisible, définitif » est quand même rendu', [r.json.facturation.rembourse, await compteur(pk, 'declare')], [true, 1]);
        const y = await compteLie({ accueil: 0, achete: 30 }); const pky = `compte:${y.c._id}`;
        await raw('plafonds').insertOne({ porteur: pky, jour: jourUTC(), type: 'declare', count: cfg.plafonds.declares.gratuit, expireLe: new Date(Date.now() + 3 * 86400e3) });
        lot([qst([POOL[0], POOL[1]])]);
        const q = await poster(svLot.url, y.jeton); const ab = await repondre(svLot.url, y.jeton, { scanId: q.json.scanId, carte: 0, choix: 'ne-sait-pas' });
        H.v('    plafond des déclarations saturé (3/3) : l\'abandon d\'une question n\'est PAS rendu (200, plafond-jour, declaration refusée), le compteur reste à 3',
            [ab.statut, ab.json.facturation && ab.json.facturation.rembourse, ab.json.facturation && ab.json.facturation.raisonNonRembourse, ab.json.declaration, await compteur(pky, 'declare')],
            [200, false, 'plafond-jour', { rendue: false, raison: 'plafond-declarations', plafondJour: 3 }, 3]);
        const valQ = require('../openapi/valider').valider(ab.json, { $ref: '#/components/schemas/ReponseQuestion' }, require('../openapi/openapi.v2.json'));
        H.vrai(`    la réponse valide contre ReponseQuestion (${valQ.ok ? 'ok' : valQ.erreurs.slice(0, 3).map(e => e.chemin + ' ' + e.message).join(' ; ')})`, valQ.ok);
    }
    // administrateur : rien débité, rien compté
    {
        const x = await compteLie({ accueil: 25, achete: 0 }, 'administrateur'); const id = await scanIdentifie(x, `v2:compte:${x.c._id}`);
        const r = await retour(svSimple.url, x.jeton, LR(id));
        H.v('S5. administrateur : motif administrateur, aucun compteur sans-prix', [r.json.facturation.motif, await compteur(`compte:${x.c._id}`, 'sans-prix')], ['administrateur', 0]);
    }

    // ════════ lots : taille (20 cartes) ════════
    {
        const x = await compteLie({ accueil: 0, achete: 40 }); const pk = `compte:${x.c._id}`;
        lot(nAff(20)); const ok = await poster(svLot.url, x.jeton);
        H.v('L1. 20 cartes : servi (200, lot de 20, 2 crédits)', [ok.statut, ok.json.analyse && ok.json.analyse.lot && ok.json.analyse.lot.cartesVues, ok.json.facturation && ok.json.facturation.debite], [200, 20, 2]);
        const avant = (await solde(x.c)).achete; appelsLot = 0;
        lot(nAff(21)); const trop = await poster(svLot.url, x.jeton); const j = trop.json || {};
        H.v('    21 cartes : REFUSÉ, 400 ENTREE, detail lot-trop-grand-taille (distinct du quota), jamais tronqué', [trop.statut, j.erreur && j.erreur.code, j.erreur && j.erreur.detail, Boolean(j.analyse)], [400, 'ENTREE', 'lot-trop-grand-taille', false]);
        H.v('    crédit initial rendu (facturation { debite:0, rembourse:true, motif lot }), aucun supplément pris, solde inchangé', [j.facturation && [j.facturation.debite, j.facturation.rembourse, j.facturation.motif], (await solde(x.c)).achete,
            (await raw('mouvements').find({ compteId: x.c._id, type: 'debit', delta: -1 }).toArray()).length], [[0, true, 'lot'], avant, 2 + 1]);
        H.v('    compté dans le compteur PROPRE « lot-trop-grand » (1), pas dans « panne »', [await compteur(pk, 'lot-trop-grand'), await compteur(pk, 'panne')], [1, 0]);
        const marques = await raw('scans_en_cours').find({ 'porteur.id': x.c._id }).toArray();
        H.v('    la marque de livraison (O5) de chaque scan du compte est close « livre » (2 scans : le lot servi et le refus)', [marques.length, marques.every(m => m.etat === 'livre')], [2, true]);
        const vE = require('../openapi/valider').valider(j, { $ref: '#/components/schemas/ReponseErreur' }, require('../openapi/openapi.v2.json'));
        H.vrai(`    la réponse valide contre ReponseErreur (${vE.ok ? 'ok' : vE.erreurs.slice(0, 3).map(e => e.chemin + ' ' + e.message).join(' ; ')})`, vE.ok);
    }
    // la variable change la borne
    {
        const sv30 = await monter(lireConfig({ ...BASE, V2_LOT_CARTES_MAX: '30' }), { identifierLot });
        const x = await compteLie({ accueil: 0, achete: 40 });
        lot(nAff(30)); const a = await poster(sv30.url, x.jeton); lot(nAff(31)); const b = await poster(sv30.url, x.jeton);
        H.v('L2. V2_LOT_CARTES_MAX=30 : 30 cartes servies (3 crédits), 31 refusées lot-trop-grand-taille', [a.statut, a.json.facturation && a.json.facturation.debite, b.statut, b.json.erreur && b.json.erreur.detail], [200, 3, 400, 'lot-trop-grand-taille']);
        await sv30.fermer();
        const sv2 = await monter(lireConfig({ ...BASE, V2_LOT_CARTES_MAX: '2' }), { identifierLot });
        lot(nAff(2)); const c = await poster(sv2.url, x.jeton); lot(nAff(3)); const d = await poster(sv2.url, x.jeton);
        H.v('    V2_LOT_CARTES_MAX=2 : 2 cartes servies, 3 refusées', [c.statut, c.json.analyse && c.json.analyse.statut, d.statut, d.json.erreur && d.json.erreur.detail], [200, 'lot', 400, 'lot-trop-grand-taille']);
        await sv2.fermer();
        await (await monter(cfg, {})).fermer();                                  // le registre « argent » est lié au dernier montage : on le relie à la configuration ordinaire
    }
    // ════════ lots : 10 refus par jour, au-delà la lecture est facturée ════════
    {
        const x = await compteLie({ accueil: 0, achete: 30 }); const pk = `compte:${x.c._id}`; lot(nAff(21));
        const issues = []; let derniere = null;
        for (let k = 0; k < 11; k++) { const r = await poster(svLot.url, x.jeton); derniere = r; issues.push(r.json.facturation.rembourse ? 'rendu' : r.json.facturation.raisonNonRembourse); }
        H.v('R1. 11 lots de 21 cartes du même compte : 10 crédits rendus, le 11e FACTURÉ (plafond-jour)', issues, [...Array(10).fill('rendu'), 'plafond-jour']);
        const f = derniere.json.facturation;
        H.v('    le 11e : la réponse reste le refus (400 ENTREE lot-trop-grand-taille), facturation { debite:1, rembourse:false, motif lot, raisonNonRembourse plafond-jour }', [derniere.statut, derniere.json.erreur.detail, f.debite, f.rembourse, f.motif, f.raisonNonRembourse], [400, 'lot-trop-grand-taille', 1, false, 'lot', 'plafond-jour']);
        H.v('    le crédit du 11e n\'est pas rendu (achete 29), le compteur reste à 10, aucun supplément pris', [(await solde(x.c)).achete, await compteur(pk, 'lot-trop-grand'), (await raw('mouvements').find({ compteId: x.c._id, type: 'debit', delta: -1 }).toArray()).length], [29, 10, 11]);
        const marques = await raw('scans_en_cours').find({ 'porteur.id': x.c._id }).toArray();
        H.v('    les 11 marques de livraison sont closes « livre » (la clôture reste la dernière opération, y compris sur le refus facturé)', [marques.length, marques.every(m => m.etat === 'livre')], [11, true]);
    }
    {   // le refus par QUOTA (supplément impayable) compte dans le MÊME compteur ; le supplément n'est jamais pris au-delà
        const x = await compteLie({ accueil: 0, achete: 1 }); const pk = `compte:${x.c._id}`; lot(nAff(20));
        await raw('plafonds').insertOne({ porteur: pk, jour: jourUTC(), type: 'lot-trop-grand', count: 9, expireLe: new Date(Date.now() + 3 * 86400e3) });
        const dixieme = await poster(svLot.url, x.jeton);
        H.v('R2. compteur à 9, lot de 20 cartes pour un solde de 1 (QUOTA) : le 10e refus est rendu (429 QUOTA lot-trop-grand, debite 0)', [dixieme.statut, dixieme.json.erreur.code, dixieme.json.erreur.detail, dixieme.json.facturation.debite, dixieme.json.facturation.rembourse, (await solde(x.c)).achete, await compteur(pk, 'lot-trop-grand')], [429, 'QUOTA', 'lot-trop-grand', 0, true, 1, 10]);
        const onzieme = await poster(svLot.url, x.jeton); const f = onzieme.json.facturation;
        H.v('    le 11e refus (QUOTA) : toujours le refus 429, mais FACTURÉ { debite:1, rembourse:false, raisonNonRembourse plafond-jour } ; le crédit initial reste pris (achete 0), supplément jamais pris (1 ligne de débit de plus, pas 2)',
            [onzieme.statut, onzieme.json.erreur.code, f.debite, f.rembourse, f.raisonNonRembourse, (await solde(x.c)).achete, (await raw('mouvements').find({ compteId: x.c._id, type: 'debit', delta: -1 }).toArray()).length, await compteur(pk, 'lot-trop-grand')], [429, 'QUOTA', 1, false, 'plafond-jour', 0, 2, 10]);
        H.v('    ces refus n\'ont consommé NI le plafond des pannes NI celui des questions', [await compteur(pk, 'panne'), await compteur(pk, 'question')], [0, 0]);
    }
    {   // mélange taille + quota : un seul compteur de 10
        const x = await compteLie({ accueil: 0, achete: 30 }); const pk = `compte:${x.c._id}`;
        const sorties = [];
        for (let k = 0; k < 11; k++) {
            if (k % 2 === 0) { lot(nAff(21)); } else { await Q.poserRestant(pk, 1); lot(nAff(20)); }
            const r = await poster(svLot.url, x.jeton); sorties.push(`${r.json.erreur.detail}:${r.json.facturation.rembourse ? 'rendu' : r.json.facturation.raisonNonRembourse}`);
        }
        H.v('R3. 6 refus de taille et 5 refus de quota en alternance (11) : 10 rendus, le 11e (taille) facturé — un seul compteur', [sorties.filter(s => s.endsWith(':rendu')).length, sorties[10], await compteur(pk, 'lot-trop-grand')], [10, 'lot-trop-grand-taille:plafond-jour', 10]);
    }
    {   // idempotence : une même requête (même Idempotency-Key) ne compte qu'UN refus
        const lignes = c => raw('mouvements').find({ compteId: c, type: 'debit', delta: -1 }).toArray();
        // (a) deux jumelles SIMULTANÉES : une seule exécute (claim d'`idempotente`), l'autre reçoit DEBIT « en cours »
        const x = await compteLie({ accueil: 0, achete: 30 }); const pk = `compte:${x.c._id}`; const k = cle();
        lotImpl = async () => { await new Promise(r => setTimeout(r, 300)); return nAff(21); };
        const [a, b] = await Promise.all([poster(svLot.url, x.jeton, corps(), k), poster(svLot.url, x.jeton, corps(), k)]);
        H.v('R4a. deux requêtes simultanées de MÊME clé, lot de 21 : un refus 400 et un DEBIT « en cours » 429 ; UN refus compté, UN débit', [[a.statut, b.statut].sort(), await compteur(pk, 'lot-trop-grand'), (await lignes(x.c._id)).length], [[400, 429], 1, 1]);
        // (b) le refus FACTURÉ (plafond atteint, crédit gardé) rejoué avec sa clé : DEBIT « en cours », ni second débit ni second compte
        const y = await compteLie({ accueil: 0, achete: 30 }); const pky = `compte:${y.c._id}`; lot(nAff(21));
        await raw('plafonds').insertOne({ porteur: pky, jour: jourUTC(), type: 'lot-trop-grand', count: cfg.plafonds.lotTropGrand, expireLe: new Date(Date.now() + 3 * 86400e3) });
        const k2 = cle(); const p1 = await poster(svLot.url, y.jeton, corps(), k2); const p2 = await poster(svLot.url, y.jeton, corps(), k2);
        H.v('R4b. refus facturé rejoué avec sa clé : 1re réponse facturée (debite 1), le rejeu = DEBIT 429 sans effet ; compteur 10, UN seul débit, achete 29',
            [p1.statut, p1.json.facturation.debite, p2.statut, p2.json.erreur.code, await compteur(pky, 'lot-trop-grand'), (await lignes(y.c._id)).length, (await solde(y.c)).achete], [400, 1, 429, 'DEBIT', 10, 1, 29]);
        // (c) un refus RENDU n'est pas figé (une réponse >= 300 n'est jamais rejouée) : la même clé rejouée est une NOUVELLE tentative payée (I2) = un NOUVEAU refus compté, borné par le plafond
        const z = await compteLie({ accueil: 0, achete: 30 }); const pkz = `compte:${z.c._id}`; lot(nAff(21)); const k3 = cle();
        const q1 = await poster(svLot.url, z.jeton, corps(), k3), q2 = await poster(svLot.url, z.jeton, corps(), k3);
        H.v('R4c. même clé rejouée après un refus RENDU : 2 réponses 400 rendues (pas de DEBIT figé), 2 refus comptés, 2 débits rendus, solde intact (30)',
            [q1.statut, q2.statut, q1.json.facturation.rembourse, q2.json.facturation.rembourse, await compteur(pkz, 'lot-trop-grand'), (await lignes(z.c._id)).length, (await solde(z.c)).achete], [400, 400, true, true, 2, 2, 30]);
        await raw('plafonds').updateOne({ porteur: pkz, jour: jourUTC(), type: 'lot-trop-grand' }, { $set: { count: cfg.plafonds.lotTropGrand } });
        const q3 = await poster(svLot.url, z.jeton, corps(), k3);
        H.v('    plafond atteint : la même clé rejouée encore = facturée (debite 1), le compteur ne dépasse pas 10', [q3.statut, q3.json.facturation.debite, q3.json.facturation.rembourse, await compteur(pkz, 'lot-trop-grand')], [400, 1, false, 10]);
        lot(nAff(21));
    }
    {   // administrateur : le plafond de taille s'applique, rien n'est payé ni compté
        const x = await compteLie({ accueil: 25, achete: 0 }, 'administrateur'); lot(nAff(21));
        const r = await poster(svLot.url, x.jeton);
        H.v('R5. administrateur, 21 cartes : refusé (400), motif administrateur, aucun compteur', [r.statut, r.json.erreur.detail, r.json.facturation.motif, r.json.facturation.debite, await compteur(`compte:${x.c._id}`, 'lot-trop-grand')], [400, 'lot-trop-grand-taille', 'administrateur', 0, 0]);
    }
    // ════════ CARTES_PAR_SCAN_MAX dérive de la configuration : aucune route n'adresse une carte au-delà ════════
    {
        const x = await inst(); const inconnu = String(new mongoose.Types.ObjectId());
        const rl = n => retour(svLot.url, x.jeton, { scanId: inconnu, carte: n, lectureRatee: { cause: 'sans-prix', definitive: true } });
        const rp = n => repondre(svLot.url, x.jeton, { scanId: inconnu, carte: n, choix: 'a' });
        const a = [await rl(19), await rl(20), await rp(19), await rp(20)];
        H.v('B1. bornes par défaut : /retour-live et /reponse acceptent la carte 19 (404 scan inconnu) et refusent la 20 (400 ENTREE)', a.map(r => r.statut), [404, 400, 404, 400]);
        const sv30 = await monter(lireConfig({ ...BASE, V2_LOT_CARTES_MAX: '30' }), { identifierLot });
        const y = await inst();
        const b = [await retour(sv30.url, y.jeton, { scanId: inconnu, carte: 29, lectureRatee: { cause: 'sans-prix', definitive: true } }), await retour(sv30.url, y.jeton, { scanId: inconnu, carte: 30, lectureRatee: { cause: 'sans-prix', definitive: true } }),
            await repondre(sv30.url, y.jeton, { scanId: inconnu, carte: 29, choix: 'a' }), await repondre(sv30.url, y.jeton, { scanId: inconnu, carte: 30, choix: 'a' })];
        await sv30.fermer(); await (await monter(cfg, {})).fermer();
        H.v('    avec V2_LOT_CARTES_MAX=30 : les deux routes suivent (29 acceptée, 30 refusée)', b.map(r => r.statut), [404, 400, 404, 400]);
        // /api/banc/correction (v2/banc/routes.js) : même source. La carte est jugée AVANT la recherche du scan : 400 « carte » ou 404 « scan introuvable »
        const { resoudrePorteur, exigerInstallation } = require('../porteur'); const { traiterCorrection } = require('../banc/routes');
        const montercorr = async c => { const app = express(); app.use(express.json()); app.post('/api/banc/correction', resoudrePorteur(c), exigerInstallation, traiterCorrection(c, { corriger: async () => { } })); return H.serveur(app); };
        const corr = (sv, n) => H.appel(sv.url, '/api/banc/correction', { methode: 'POST', corps: { scanId: inconnu, carte: n, idProduct: P }, entetes: entetes(x.jeton) });
        const svC = await montercorr(cfg); const svC30 = await montercorr(lireConfig({ ...BASE, V2_LOT_CARTES_MAX: '30' }));
        const cc = [await corr(svC, 19), await corr(svC, 20), await corr(svC30, 29), await corr(svC30, 30)].map(r => [r.statut, r.json.erreur && r.json.erreur.detail]);
        await svC.fermer(); await svC30.fermer();
        H.v('    /api/banc/correction : taille - 1 acceptée (404 scan inconnu), taille refusée (400 carte) — par défaut (19/20) et avec V2_LOT_CARTES_MAX=30 (29/30)', cc, [[404, undefined], [400, 'carte'], [404, undefined], [400, 'carte']]);
        H.vrai('    plus de « 99 » en dur dans v2/banc/routes.js', !/<=\s*99\b/.test(fs.readFileSync(path.join(__dirname, '..', 'banc', 'routes.js'), 'utf8')));
        const mod = require('../identifier/cartes-par-scan');
        H.v('    une seule source : cartes-par-scan.js n\'exporte plus de constante numérique, il dérive de cfg.lot.cartesMax', [typeof mod.CARTES_PAR_SCAN_MAX, typeof mod.cartesParScanMax, mod.cartesParScanMax && mod.cartesParScanMax(cfg), mod.cartesParScanMax && mod.cartesParScanMax(lireConfig({ ...BASE, V2_LOT_CARTES_MAX: '7' }))], ['undefined', 'function', 20, 7]);
        const src = n => fs.readFileSync(path.join(__dirname, '..', 'identifier', n), 'utf8');
        H.v('    aucun littéral ni constante CARTES_PAR_SCAN_MAX, ni borne `carte >= <nombre>`, dans routes.js, retour-live.js, lot.js, cartes-par-scan.js', ['routes.js', 'retour-live.js', 'lot.js', 'cartes-par-scan.js'].map(n => /CARTES_PAR_SCAN_MAX\s*=|carte\s*>=?\s*\d|CARTES_MAX\s*=\s*\d|resultats\.length\s*>\s*\d/.test(src(n))), [false, false, false, false]);
    }
    await svSimple.fermer(); await svLot.fermer();
    await mongoose.disconnect(); await H.arreterBanc();
    H.bilan();
})().catch(async e => { console.error('❌', e); try { await H.arreterBanc(); } catch (_) { } process.exit(1); });
