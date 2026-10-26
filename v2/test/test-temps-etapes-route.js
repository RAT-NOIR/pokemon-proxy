'use strict';
// LOT TEMPS-ETAPES — la route /api/identifier de bout en bout : (A) le journal des durées par étape (`analyses.durees`, additif, nombres seulement) ; (B) les trois coupes de temps, chacune derrière son drapeau
// (ÉTEINT par défaut) : éteintes, la route est celle d'avant ; allumées, elles rendent EXACTEMENT les mêmes réponses, la même ligne `analyses` (hors `durees`), le même débit, les mêmes questions, les mêmes appels
// aux zones — sur toute une batterie de scénarios (affirmée, question, promotion, introuvable, panne, modèle inconnu, carte honnête, carte forgée, sans carte) — et la clôture de la marque reste LA DERNIÈRE écriture.
// Base : la base EN MÉMOIRE du banc ; la chaîne héritée est FABRIQUÉE ; l'index est celui de _empreinte-aide.js (fabriqué). Aucun réseau, aucun fichier du testeur, aucun modèle, aucune dépense.
const H = require('./_harnais');
const path = require('path');
const mongoose = require('mongoose');
// ⚠️ les recopies de fonctions de la route (destructurées au chargement de routes.js) sont posées AVANT tout require de la route : le banc observe ce que la route appelle vraiment
const TAUX = require('../identifier/taux'); const CONSERVATION = require('../annonce/conservation');
const evenements = []; let delaiFin = 0;
const attendre = ms => new Promise(r => setTimeout(r, ms));
const noter = async (nom, f) => { const e = { nom, t0: Date.now() }; evenements.push(e); if (delaiFin) await attendre(delaiFin); try { return await f(); } finally { e.t1 = Date.now(); } };
const vraiRegle = TAUX.regleVerdict; TAUX.regleVerdict = (...a) => noter('regle', () => vraiRegle(...a));
const vraieAnnonce = CONSERVATION.conserverAnnonce; let annonceImpl = vraieAnnonce; CONSERVATION.conserverAnnonce = (...a) => noter('annonce', () => annonceImpl(...a));
const db = require('../db'); const M = require('../modeles'); const J = require('../comptes/jetons'); const QA = require('./_aide-quota');
const { lireConfig } = require('../config');
const A = require('./_empreinte-aide');
const TE = require('../identifier/temps-etapes');
const R = path.join(__dirname, '..', '..');
const IMAGE = require(path.join(R, 'verrou', 'charges.json')).charges.find(c => c.cellule === 'occidentale').imageUrl;
// TE_VIVIER=1 (test-temps-etapes-route-vivier.js) : toute la batterie rejouée AVEC V2_VIVIER_IMAGE=1 (le vivier élargi de SUR-PAR-IMAGE, qui réutilise les voisins du top 10)
const ENVB = { ...A.ENV_EMPREINTE, V2_SUR_PAR_IMAGE: '1', V2_DESCRIPTION_CONSERVEE: '1', ...(process.env.TE_VIVIER === '1' ? { V2_VIVIER_IMAGE: '1' } : {}) };
const DRAPEAUX = { voisins: { V2_TE_VOISINS_UNE_FOIS: '1' }, tot: { V2_TE_EMPREINTE_TOT: '1' }, fin: { V2_TE_FIN_PARALLELE: '1' }, orb: { V2_TE_ORB_UTILE: '1' }, tous: { V2_TE_VOISINS_UNE_FOIS: '1', V2_TE_EMPREINTE_TOT: '1', V2_TE_FIN_PARALLELE: '1', V2_TE_ORB_UTILE: '1' } };
const cfgDe = (extra = {}) => lireConfig({ ...ENVB, ...extra });
const cfgOff = cfgDe();
const ORIGINE = cfgOff.origines.extension;
let nIp = 0; const ip = () => { nIp++; return { 'x-forwarded-for': `10.9.${Math.floor(nIp / 250)}.${nIp % 250 + 1}` }; };
let nCle = 0; const cle = () => `banc-te-${Date.now().toString(36)}-${++nCle}`;
const raw = n => mongoose.connection.db.collection(n);
const corps = (o = {}) => ({ contrat: 2, imageUrls: [IMAGE], title: 'Tropius pbl', description: 'belle carte', prixVinted: null, devise: null, marche: 'vinted.fr', versionExtension: '2.0.0', langueInterface: 'fr', ...o });
async function inst(essais = 3) { const jeton = J.genererJeton(); const i = M.nouvelleInstallation({ jetonEmpreinte: J.empreinte(jeton), essais, libelle: 'banc' }); await db.col('installations').insertOne(i); return { i, jeton }; }
const poster = (url, jeton, c) => H.appel(url, '/api/identifier', { methode: 'POST', corps: c, entetes: { origin: ORIGINE, ...ip(), authorization: `Bearer ${jeton}`, 'idempotency-key': cle() } });
const essaisDe = id => QA.restantDe({ type: 'installation', id }, cfgOff);
const VB = require('./_visuels-banc'); const VIS = [];
const semer = async (id, numero = '001') => {
    await raw('catalogue_produits').insertOne({ idProduct: id, name: `Tropius (PBL ${numero})`, idExpansion: 990001, idMetacard: 990100 + (id % 100) });
    await raw('numeros_cartes').insertOne({ idProduct: id, idExpansion: 990001, numero, numeroUrl: 'PBL' + numero, codeSet: 'PBL', nomFr: 'Tropius', slug: `Tropius-PBL${numero}-${id}`, slugSet: 'Banc-Set', source: 'cardmarket', certitude: 'exacte' });
    await raw('guide_prix').insertOne({ idProduct: id, avg: 1.1, low: 0.5, trend: 1.0, avg1: 1.0, avg7: 1.0, avg30: 1.1, guideDu: new Date('2026-10-04') });
    VIS.push(VB.doc(id, { numero, idMetacard: 990100 + (id % 100) }));
};
const egal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
let rejetsNonGeres = 0; process.on('unhandledRejection', () => { rejetsNonGeres++; });

(async () => {
    await H.ouvrirBancV2();
    await QA.eviterMinuit();
    process.env.MONGODB_BASE = 'test_scratch';
    const { connecterMongo } = require('../../mongo-connexion');
    await connecterMongo({ script: 'test-temps-etapes-route.js', ecrit: true });
    db.brancher(mongoose.connection.db);
    await M.creerIndex();
    for (const c of ['catalogue_produits', 'numeros_cartes', 'guide_prix', 'codes_set']) await raw(c).deleteMany({});
    await raw('codes_set').insertOne({ idExpansion: 990001, codeSet: 'PBL', apprisLe: new Date() });
    for (const id of [A.ID_A, A.ID_B, A.ID_P]) await semer(id, '001');
    await semer(A.ID_X, '002');
    VB.installer(VIS, [], { emprunts: true });

    const express = require('express'); const pret = require('../pret'); const registre = require('../registre');
    const { dansUnScan } = require('../../sources');
    const { assembler } = require('../index');
    const MS = require('../argent/marque-scan');
    const vraieClore = MS.clore; MS.clore = (...a) => noter('clore', () => vraieClore(...a));
    // le registre « argent » observé : solde et offre (lectures de la fin de requête)
    const vraiObtenir = registre.obtenir.bind(registre);
    registre.obtenir = nom => {
        const x = vraiObtenir(nom);
        if (nom !== 'argent' || !x) return x;
        return new Proxy(x, { get(t, p) { const f = t[p]; if ((p === 'solde' || p === 'offre') && typeof f === 'function') return (...a) => noter(String(p), () => f.apply(t, a)); return typeof f === 'function' ? f.bind(t) : f; } });
    };
    // Mongo observé : l'insertion de la ligne d'analyse
    const vraieDb = mongoose.connection.db;
    const dbObservee = new Proxy(vraieDb, { get(t, p) {
        if (p === 'collection') return nomC => { const c = t.collection(nomC); return nomC.endsWith('analyses') ? new Proxy(c, { get(tc, q) { const f = tc[q]; if (q === 'insertOne') return (...a) => noter('analyses', () => f.apply(tc, a)); return typeof f === 'function' ? f.bind(tc) : f; } }) : c; };
        const f = t[p]; return typeof f === 'function' ? f.bind(t) : f;
    } });
    db.brancher(dbObservee);

    // le compteur de recherches de voisins (l'index en place)
    A.installerIndex();
    const idx = A.etat.courante().index; let nVoisins = 0; const vraieVoisins = idx.voisins.bind(idx); idx.voisins = (q, k) => { nVoisins++; return vraieVoisins(q, k); };

    // la chaîne héritée FABRIQUÉE (comme test-identifier-empreinte-route.js), avec un délai réglable et les durées qu'elle annonce par req.dureesChaine
    const lecture = (id, o = {}) => ({ success: true, question: null, carte: { idProduct: id, nomProduit: 'Tropius', nom: 'Tropius', numero: '001', total: '064', setCode: 'PBL', rarete: null, langue: 'FR', ambigu: false, ...o },
        etat: { estimeIA: null, confianceIA: null, defautsVus: [], declareVendeur: null, declareCardmarket: null, retenu: null },
        candidats: [{ idProduct: id, nom: 'Tropius', numero: '001', set: 'Banc Set', prix: 1, photoUrl: null }], classement: [], guidePrix: {}, reverse: { attendue: false, motif: null, etat: 'aucun-motif', strategie: null }, codeLangue: 2 });
    let chargeEnCours = false;
    let chaine = null, delaiChaine = 0, durees = { lecture: 2050, etat: 40, catalogue: 504, image: 3 };
    const chaineFabriquee = async (req, res) => {
        if (delaiChaine) { chargeEnCours = true; try { await attendre(delaiChaine); } finally { chargeEnCours = false; } }
        if (req.dureesChaine && durees) Object.assign(req.dureesChaine, durees);
        const { mode, ids } = chaine;
        if (mode === 'exception') throw new Error('panne de la chaîne');
        if (mode === 'affirmee') return res.json({ ...lecture(ids[0]), scanId: String(req.scanIdImpose) });
        if (mode === 'introuvable') { await req.credit.v2.rembourser(req, 'aucun-prix'); return res.json({ success: false, natureRefus: 'refus-delibere', motifRefus: 'aucun-prix' }); }
        if (mode === 'ambigue' || mode === 'ambigue-sans-lecture') {
            await req.credit.v2.poserQuestion(req, { scanId: req.scanIdImpose, raison: 'egalite-sans-enjeu', candidats: ids });
            const l = lecture(ids[0], mode === 'ambigue' ? {} : { numero: null, total: null, setCode: null });
            return res.json({ ...l, scanId: String(req.scanIdImpose), question: { etat: 'en-attente', delaiHeures: 24 }, carte: { ...l.carte, ambigu: true }, candidats: ids.map(id => ({ idProduct: id, nom: 'Tropius', numero: '001', set: 'Banc Set', prix: 1, photoUrl: null })) });
        }
        throw new Error(`mode inconnu ${mode}`);
    };
    // un serveur par configuration ; ses zones sont à lui (on compare leurs appels), ses appels au fournisseur sont comptés
    const serveurs = [];
    async function serveur(cfgApp, { delaiZones = 0, deps = {}, lentSousCharge = 0, delaiMs } = {}) {
        const zones = A.fausseZones();
        if (delaiZones) { const pg = zones.photoGrise; zones.photoGrise = async (...a) => { await attendre(delaiZones); return pg(...a); }; }
        // CPU SIMULÉ LENT (0,15 vCPU) : tant que la chaîne calcule (`chargeEnCours`), chaque appel aux zones prend `lentSousCharge` ms de plus ; la chaîne finie, les zones sont rapides
        if (lentSousCharge) for (const k of ['photoGrise', 'comparerPaire', 'scoresZones']) { const f = zones[k]; zones[k] = async (...a) => { if (chargeEnCours) await attendre(lentSousCharge); return f(...a); }; }
        const appelsFournisseur = [];
        const reel = require('../identifier/voisins-empreinte').creerFournisseurEmpreinte({ cfg: cfgApp, zones, scan: A.scanBanc, ...(delaiMs ? { delaiMs } : {}) });
        const espion = async a => { appelsFournisseur.push({ cle: Object.keys(a).sort().join(','), chrono: Boolean(a.chrono) }); return reel(a); };
        const app = express(); app.set('trust proxy', true); app.use(express.json({ limit: '2400kb' }));
        pret.armer(require('../modeles').verifierIndex);
        app.use(assembler([require('../argent/monter'), require('../identifier/monter')], cfgApp, { jumeaux: () => ({ conclu: true, ids: [] }), gererIdentifier: chaineFabriquee, voisinsEmpreinte: espion, ...deps }));
        const sv = await H.serveur(app); sv.zones = zones; sv.appelsFournisseur = appelsFournisseur; serveurs.push(sv);
        return sv;
    }
    const vec = (i, redressee = false, carte = undefined) => ({ empreintes: [A.entree(0, i, redressee, carte)], modeleEmpreinte: A.modeleAnnonce() });
    await A.preparer();
    const C = A.cartes();
    const normaliser = (j, scanId) => JSON.parse(JSON.stringify(j).split(scanId).join('SCAN'));
    const sansVolatil = j => { const { scanId, solde, offre, ...x } = JSON.parse(JSON.stringify(j)); void scanId; void solde; void offre; if (x.facturation) delete x.facturation.poche; return x; };
    async function jouer(sv, c, requete) {
        chaine = c; evenements.length = 0; const n0 = nVoisins; sv.appelsFournisseur.length = 0; sv.zones.appels.length = 0;
        const x = await inst(3); const t0 = Date.now(); const r = await poster(sv.url, x.jeton, corps(requete)); const duree = Date.now() - t0; await attendre(40);
        const j = r.json || {}; const sid = j.scanId || null;
        const an = sid ? await raw('analyses').findOne({ _id: new mongoose.Types.ObjectId(sid) }) : null;
        const q = sid ? await raw('questions_v2').findOne({ _id: `${sid}:0` }) : null;
        const mv = await raw('mouvements').find({ installationId: x.i._id }).toArray();
        const anNorm = an ? (() => { const { _id, creeLe, expireLe, durees: d, porteur, ...reste } = an; void _id; void creeLe; void expireLe; void d; void porteur; return normaliser(reste, sid); })() : null;
        return { statut: r.statut, duree, corps: sid ? normaliser(sansVolatil(j), sid) : sansVolatil(j), analyse: anNorm, durees: an ? an.durees : undefined, question: q ? q.etat : null, essais: await essaisDe(x.i._id),
            mouvements: mv.map(m => [m.type, m.delta, m.etat]).sort(), recherches: nVoisins - n0, appelsZones: sv.zones.appels.map(a => a.join('|')).sort(), appelsFournisseur: sv.appelsFournisseur.slice(), evenements: evenements.map(e => ({ ...e })), brut: j };
    }
    const svOff = await serveur(cfgOff);

    // ════════════ (A) LE JOURNAL DES DURÉES, tous drapeaux éteints ════════════
    console.log('=== A. analyses.durees : additif, nombres seulement, les durées de la chaîne y sont ===');
    {
        const o = await jouer(svOff, { mode: 'affirmee', ids: [A.ID_A] }, vec(5));
        const d = o.durees;
        H.vrai('A1. la ligne `analyses` porte `durees`', d && typeof d === 'object');
        H.vrai('A2. … rien que des entiers >= 0 (cpu : un objet d\'entiers), clés de la liste fermée + cpu / gc / rssMo', d && Object.entries(d).every(([k, x]) => (k === 'cpu' ? Object.values(x).every(y => Number.isInteger(y) && y >= 0) : Number.isInteger(x) && x >= 0)) && Object.keys(d).every(k => ['cpu', 'gc', 'rssMo'].includes(k) || TE.ETAPES.includes(k)));
        H.v('A3. les durées annoncées par la chaîne héritée sont reprises (lecture, état, catalogue, image)', [d.lecture, d.etat, d.catalogue, d.image], [2050, 40, 504, 3]);
        H.vrai('A4. la chaîne, l\'empreinte (le vecteur est joint), la recherche des voisins et la base sont comptées ; le total les contient', d.chaine >= 0 && d.empreinte >= 0 && d.voisins >= 0 && d.base >= 0 && d.total >= d.chaine);
        H.vrai('A5. rien d\'autre qu\'un objet de nombres : aucune chaîne, aucune adresse, aucun jeton (le JSON ne contient que des chiffres et des noms de la liste)', /^[\d{}":,a-zA-Z]+$/.test(JSON.stringify(d)) && !JSON.stringify(d).includes(IMAGE) && !JSON.stringify(d).includes('http'));
        H.vrai('A6. la réponse HTTP ne porte PAS `durees` (interne, jamais servie)', !JSON.stringify(o.brut).includes('durees'));
        // une chaîne qui annonce n'importe quoi ne pollue pas le journal
        const avant = durees; durees = { lecture: 'secret-factice', etat: NaN, catalogue: -5, image: null, nimporte: 12, '__proto__': 5 };       // secret-factice
        const sale = await jouer(svOff, { mode: 'affirmee', ids: [A.ID_A] }, vec(5));
        durees = avant;
        H.vrai('A7. des valeurs fausses de la chaîne (texte, NaN, négatif, nom inconnu) sont ignorées : aucune clé de plus, aucun nombre invalide', sale.statut === 200 && !('nimporte' in sale.durees) && !JSON.stringify(sale.durees).includes('secret') && !JSON.stringify(sale.durees).includes('null'));
        durees = null;
        const sans = await jouer(svOff, { mode: 'affirmee', ids: [A.ID_A] }, {});
        durees = avant;
        H.vrai('A8. une chaîne qui n\'annonce rien : la ligne porte quand même `durees` (chaîne, total), sans lecture ni catalogue', sans.durees && sans.durees.total >= 0 && !('lecture' in sans.durees) && !('catalogue' in sans.durees));
        H.vrai('A9. sans vecteur, ni recherche de voisins ni étape empreinte', !('voisins' in sans.durees) && !('empreinte' in sans.durees) && sans.recherches === 0);
    }

    // ════════════ (B) LES COUPES : éteintes = la route d'avant ; allumées = les mêmes sorties ════════════
    const SCENARIOS = [
        ['affirmée sans vecteur', () => ({ mode: 'affirmee', ids: [A.ID_A] }), {}],
        ['affirmée, G d\'accord (jeu-5)', () => ({ mode: 'affirmee', ids: [A.ID_A] }), vec(5)],
        ['affirmée, G affirme un AUTRE produit (jeu-3) : question', () => ({ mode: 'affirmee', ids: [A.ID_A] }), vec(3)],
        ['question [A,B], G affirme P (promotion, jeu-3)', () => ({ mode: 'ambigue', ids: [A.ID_A, A.ID_B] }), vec(3)],
        ['question [A,B], le produit de G contredit la lecture (jeu-4)', () => ({ mode: 'ambigue', ids: [A.ID_A, A.ID_B] }), vec(4)],
        ['question [A,B], SANS carte (G se tait, SUR-PAR-IMAGE consulté)', () => ({ mode: 'ambigue', ids: [A.ID_A, A.ID_B] }), vec(8, true, false)],
        ['question [A,B], carte honnête, jumeaux jeu-10/11 : les zones tranchent', () => ({ mode: 'ambigue', ids: [A.ID_A, A.ID_B] }), vec(10, true, C.CARTE)],
        ['question [A,B], carte FORGÉE (jeu-10, pixels de jeu-11)', () => ({ mode: 'ambigue', ids: [A.ID_A, A.ID_B] }), vec(10, true, C.CARTE_FORGEE)],
        ['question [A,B], jumeaux jeu-12/13, carte honnête', () => ({ mode: 'ambigue', ids: [A.ID_A, A.ID_B] }), vec(12, true, C.CARTE)],
        ['question sans lecture, carte forgée', () => ({ mode: 'ambigue-sans-lecture', ids: [A.ID_A, A.ID_B] }), vec(10, true, C.CARTE_FORGEE)],
        ['introuvable de la chaîne, G affirme P', () => ({ mode: 'introuvable', ids: [] }), vec(3)],
        ['modèle inconnu', () => ({ mode: 'ambigue', ids: [A.ID_A, A.ID_B] }), { empreintes: [A.entree(0, 3)], modeleEmpreinte: { id: A.MODELE.id, sha256: 'd'.repeat(64) } }],
        ['vecteur de norme 1,5 (invalide)', () => ({ mode: 'ambigue', ids: [A.ID_A, A.ID_B] }), { empreintes: [{ photo: 0, vecteur: require('../identifier/empreinte-vecteur').encoderVecteur(Float32Array.from(A.ligneDe(3)).map(x => x * 1.5)) }], modeleEmpreinte: A.modeleAnnonce() }],
        ['panne de la chaîne (exception)', () => ({ mode: 'exception', ids: [] }), vec(3)]
    ];
    const reference = []; // la sortie de la route éteinte, scénario par scénario
    console.log('=== B0. éteint (défaut) : la référence ; une recherche de voisins par lecteur du vecteur ===');
    for (const [nom, mk, req] of SCENARIOS) {
        const o = await jouer(svOff, mk(), req); reference.push(o);
    }
    const ref = Object.fromEntries(SCENARIOS.map(([n], i) => [n, reference[i]]));
    H.v('B0-. le vivier élargi est allumé exactement quand TE_VIVIER=1 (la batterie « vivier » rejoue la même chose avec V2_VIVIER_IMAGE=1)', cfgOff.vivierImage, process.env.TE_VIVIER === '1');
    H.v('B0a. SUR-PAR-IMAGE consulté (G muette) : DEUX recherches de voisins quand tout est éteint', ref['question [A,B], SANS carte (G se tait, SUR-PAR-IMAGE consulté)'].recherches, 2);
    H.v('B0b. sans vecteur : aucune recherche', ref['affirmée sans vecteur'].recherches, 0);
    H.v('B0c. le fournisseur est appelé UNE fois par requête à vecteur (éteint : à la fin de la chaîne)', ref['question [A,B], G affirme P (promotion, jeu-3)'].appelsFournisseur.length, 1);
    H.vrai('B0d. panne de la chaîne : 500, aucune ligne d\'analyse (donc aucune durée) et le crédit rendu', ref['panne de la chaîne (exception)'].statut === 500 && ref['panne de la chaîne (exception)'].analyse === null && ref['panne de la chaîne (exception)'].essais === 3);

    for (const [etiquette, extra] of Object.entries(DRAPEAUX)) {
        console.log(`=== B-${etiquette}. ${JSON.stringify(extra)} : mêmes sorties que la route éteinte, sur ${SCENARIOS.length} scénarios ===`);
        const sv = await serveur(cfgDe(extra));
        H.vrai(`B-${etiquette}-0. la configuration allume exactement ces drapeaux`, egal(Object.entries(cfgDe(extra).tempsEtapes).filter(([, x]) => x).map(([k]) => k).sort(), Object.keys(extra).map(k => ({ V2_TE_VOISINS_UNE_FOIS: 'voisinsUneFois', V2_TE_EMPREINTE_TOT: 'empreinteTot', V2_TE_FIN_PARALLELE: 'finParallele', V2_TE_ORB_UTILE: 'orbUtile' })[k]).sort()));
        let identiques = 0; const diffs = [];
        const orbActif = Boolean(extra.V2_TE_ORB_UTILE);
        // orbUtile : sur un INTROUVABLE de la chaîne, la règle G n'est pas consultée ; les SEULES différences admises sont les champs qui disent ce que G a fait (`empreinte` de la réponse, `desaccordRegleG` et `empreinteExtension` du journal) — jamais une décision
        const sansG = (x, champs) => { if (!x) return x; const y = JSON.parse(JSON.stringify(x)); for (const k of champs) delete y[k]; return y; };
        for (const [nom, mk, req] of SCENARIOS) {
            const o = await jouer(sv, mk(), req), r0 = ref[nom];
            const exempt = orbActif && nom.startsWith('introuvable');
            const memeCorps = egal(exempt ? sansG(o.corps, ['empreinte']) : o.corps, exempt ? sansG(r0.corps, ['empreinte']) : r0.corps), memeAnalyse = egal(exempt ? sansG(o.analyse, ['desaccordRegleG', 'empreinteExtension']) : o.analyse, exempt ? sansG(r0.analyse, ['desaccordRegleG', 'empreinteExtension']) : r0.analyse);
            const meme = o.statut === r0.statut && memeCorps && memeAnalyse && o.question === r0.question && o.essais === r0.essais && egal(o.mouvements, r0.mouvements) && egal(o.appelsZones, r0.appelsZones);
            if (meme) identiques++; else diffs.push({ nom, statut: [o.statut, r0.statut], corps: memeCorps, analyse: memeAnalyse, question: [o.question, r0.question], essais: [o.essais, r0.essais], mouvements: egal(o.mouvements, r0.mouvements), zones: egal(o.appelsZones, r0.appelsZones) });
        }
        H.v(`B-${etiquette}-a. ${SCENARIOS.length} scénarios : statut HTTP, réponse, ligne analyses (hors durees), question, débit, mouvements, appels aux zones IDENTIQUES à la route éteinte`, [identiques, diffs.slice(0, 2)], [SCENARIOS.length, []]);
        const spi = await jouer(sv, { mode: 'ambigue', ids: [A.ID_A, A.ID_B] }, vec(8, true, false));
        const attendu = extra.V2_TE_VOISINS_UNE_FOIS ? 1 : 2;
        H.v(`B-${etiquette}-b. SUR-PAR-IMAGE consulté : ${attendu} recherche(s) de voisins (${extra.V2_TE_VOISINS_UNE_FOIS ? 'une seule pour la règle G ET SUR-PAR-IMAGE' : 'une par lecteur, comme avant'})`, spi.recherches, attendu);
        const prom = await jouer(sv, { mode: 'ambigue', ids: [A.ID_A, A.ID_B] }, vec(3));
        H.v(`B-${etiquette}-c. le fournisseur est appelé UNE seule fois par requête (jamais deux), chrono joint`, [prom.appelsFournisseur.length, prom.appelsFournisseur[0] && prom.appelsFournisseur[0].chrono], [1, true]);
        H.vrai(`B-${etiquette}-d. la ligne analyses porte toujours ses durees (nombres)`, prom.durees && Number.isInteger(prom.durees.total));
        const sansVec = await jouer(sv, { mode: 'affirmee', ids: [A.ID_A] }, {});
        H.v(`B-${etiquette}-e. sans vecteur : le fournisseur n'est jamais appelé (rien n'est lancé d'avance pour rien)`, sansVec.appelsFournisseur.length, 0);
        const pan = await jouer(sv, { mode: 'exception', ids: [] }, vec(3));
        H.vrai(`B-${etiquette}-f. panne de la chaîne : 500, crédit rendu, et aucun rejet de promesse non géré`, pan.statut === 500 && pan.essais === 3 && rejetsNonGeres === 0);
        const intro = await jouer(sv, { mode: 'introuvable', ids: [] }, vec(3));
        if (orbActif) {
            H.v(`B-${etiquette}-g. orbUtile, introuvable de la chaîne : introuvable gardé, crédit rendu (essai 3), net 0, et la réponse dit que G se tait`, [intro.corps.analyse.cartes[0].statut, intro.corps.facturation.rembourse, intro.essais, intro.brut.empreinte], ['introuvable', true, 3, { utilisee: false, code: 'muette' }]);
            H.vrai(`B-${etiquette}-h. … la ligne d'analyse ne porte plus de désaccord « introuvable » (G n'a pas été consultée) et le dit : empreinteExtension utilisee faux`, intro.analyse && !('desaccordRegleG' in intro.analyse) && intro.analyse.empreinteExtension && intro.analyse.empreinteExtension.utilisee === false);
            if (!extra.V2_TE_EMPREINTE_TOT) H.v(`B-${etiquette}-i. … ni recherche de voisins, ni appel au fournisseur (rien n'est calculé pour un introuvable)`, [intro.recherches, intro.appelsFournisseur.length, 'voisins' in intro.durees, 'empreinte' in intro.durees], [0, 0, false, false]);
            const aff = await jouer(sv, { mode: 'affirmee', ids: [A.ID_A] }, vec(3));
            H.v(`B-${etiquette}-j. … et sur une AFFIRMATION de la chaîne, G est toujours consultée (elle rend la question prudente)`, [aff.brut.empreinte, aff.corps.analyse.cartes[0].statut], [{ utilisee: true, code: null }, 'a-trancher']);
        } else {
            H.v(`B-${etiquette}-g. drapeau orbUtile éteint : sur un introuvable, G est consultée comme avant`, intro.brut.empreinte, { utilisee: true, code: null });
        }
    }

    // ════════════ (C) empreinteTot : la recherche et les zones partent pendant l'attente du modèle ════════════
    console.log('=== C. empreinteTot : le temps de la garde des zones se recouvre avec celui de la chaîne ===');
    {
        delaiChaine = 150;
        const off = await serveur(cfgOff, { delaiZones: 150 }), tot = await serveur(cfgDe(DRAPEAUX.tot), { delaiZones: 150 });
        const sc = { mode: 'ambigue', ids: [A.ID_A, A.ID_B] }, rq = vec(10, true, C.CARTE);
        const a = await jouer(off, sc, rq), b = await jouer(tot, sc, rq);
        delaiChaine = 0;
        H.vrai(`C1. éteint : la chaîne PUIS les zones (${a.duree} ms >= 280) ; allumé : les deux en même temps (${b.duree} ms) — au moins 80 ms de moins`, a.duree >= 280 && b.duree <= a.duree - 80);
        H.v('C2. même décision (identifiee B par les zones), même réponse, mêmes appels aux zones', [b.corps.analyse.cartes[0].statut, egal(a.corps, b.corps), egal(a.appelsZones, b.appelsZones)], ['identifiee', true, true]);
        H.vrai('C3. l\'étape « orb » est comptée (la garde des zones a tourné) et « empreinte » aussi', b.durees.orb >= 150 && b.durees.empreinte >= 150);
        H.vrai(`C4. la chaîne annonce ses ${b.durees.chaine} ms ET l'empreinte ${b.durees.empreinte} ms : les deux étapes se chevauchent (leur somme dépasse le total ${b.durees.total} de plus de 50 ms)`, b.durees.chaine + b.durees.empreinte > b.durees.total + 50);
        // le fournisseur injecté qui ne répond jamais : la borne court à partir de l'ATTENTE, la réponse arrive (comme éteint)
        const jamais = await serveur(cfgDe(DRAPEAUX.tot), { deps: { voisinsEmpreinte: () => new Promise(() => { }), delaiVoisinsMs: 80 } });
        const e3 = console.error; console.error = () => { };
        let p; try { p = await jouer(jamais, sc, vec(3)); } finally { console.error = e3; }
        H.vrai('C5. un fournisseur qui ne répond jamais : la réponse arrive, « indisponible », la chaîne décide', p.statut === 200 && p.brut.empreinte.code === 'indisponible' && p.brut.analyse.cartes[0].statut === 'a-trancher');
        const leve = await serveur(cfgDe(DRAPEAUX.tot), { deps: { voisinsEmpreinte: async () => { throw new Error('index cassé'); } } });
        const e4 = console.error; console.error = () => { };
        let l; try { l = await jouer(leve, sc, vec(3)); } finally { console.error = e4; }
        H.vrai('C6. un fournisseur qui LÈVE : « indisponible », la chaîne décide, aucun rejet non géré', l.statut === 200 && l.brut.empreinte.code === 'indisponible' && rejetsNonGeres === 0);
    }

    // ════════════ (C bis) CPU simulé lent : la précharge ne doit JAMAIS faire passer G « indisponible » à la place de la route normale ════════════
    console.log('=== C bis. CPU lent simulé : la voie anticipée affamée est relancée par la voie normale ===');
    {
        delaiChaine = 300;
        // zones : +120 ms par appel tant que la chaîne calcule ; budget des mesures 100 ms → la voie anticipée est affamée, la voie normale (chaîne finie) ne l'est pas
        const off = await serveur(cfgOff, { lentSousCharge: 120, delaiMs: 100 }), tot = await serveur(cfgDe(DRAPEAUX.tot), { lentSousCharge: 120, delaiMs: 100 });
        const sc = { mode: 'ambigue', ids: [A.ID_A, A.ID_B] }, rq = vec(10, true, C.CARTE);
        const a = await jouer(off, sc, rq), b = await jouer(tot, sc, rq);
        delaiChaine = 0;
        H.v('Cb1. éteint (référence) : G tranche sur la carte (identifiee), empreinte utilisée', [a.corps.analyse.cartes[0].statut, a.brut.empreinte], ['identifiee', { utilisee: true, code: null }]);
        H.v('Cb2. empreinteTot sous CPU lent : MÊME décision, même réponse (jamais « indisponible » parce que la précharge a été affamée)', [b.corps.analyse.cartes[0].statut, b.brut.empreinte, egal(a.corps, b.corps), egal(a.analyse, b.analyse)], ['identifiee', { utilisee: true, code: null }, true, true]);
        H.v('Cb3. la voie normale a relancé le fournisseur : deux appels (anticipé affamé, puis normal)', b.appelsFournisseur.length, 2);
    }

    // ════════════ (D) finParallele : les lectures annexes partent ensemble, la clôture reste la dernière ════════════
    console.log('=== D. finParallele : solde / offre / taux ensemble ; analyse / annonce ensemble ; clôture en dernier ===');
    {
        const sc = { mode: 'affirmee', ids: [A.ID_A] };
        const off = await serveur(cfgOff), fin = await serveur(cfgDe(DRAPEAUX.fin));
        delaiFin = 60;
        const a = await jouer(off, sc, {}), b = await jouer(fin, sc, {});
        delaiFin = 0;
        const par = (ev, nom) => ev.filter(e => e.nom === nom);
        const premier = (ev, nom) => par(ev, nom)[0];
        const recouvre = (ev, n1, n2) => { const x = premier(ev, n1), y = premier(ev, n2); return x && y && x.t0 < y.t1 && y.t0 < x.t1; };
        const noms = ['solde', 'offre', 'regle', 'analyses', 'annonce', 'clore'];
        H.vrai('D0b. chaque lecture ou écriture n\'a lieu qu\'UNE fois par requête, dans les deux configurations (le taux n\'est pas lu deux fois)', noms.every(n => par(a.evenements, n).length === 1 && par(b.evenements, n).length === 1));
        H.vrai('D0. les six opérations observées ont eu lieu, dans les deux configurations', noms.every(n => premier(a.evenements, n) && premier(b.evenements, n)));
        H.vrai('D1. éteint : solde, offre, taux se suivent (aucun recouvrement) ; analyse puis annonce se suivent', !recouvre(a.evenements, 'solde', 'offre') && !recouvre(a.evenements, 'offre', 'regle') && !recouvre(a.evenements, 'solde', 'regle') && !recouvre(a.evenements, 'analyses', 'annonce'));
        H.vrai('D2. allumé : solde, offre et taux se recouvrent deux à deux', recouvre(b.evenements, 'solde', 'offre') && recouvre(b.evenements, 'offre', 'regle') && recouvre(b.evenements, 'solde', 'regle'));
        H.vrai('D3. allumé : la ligne d\'analyse et l\'annonce se recouvrent', recouvre(b.evenements, 'analyses', 'annonce'));
        for (const [nom, o] of [['éteint', a], ['allumé', b]]) {
            const cl = premier(o.evenements, 'clore'), an = premier(o.evenements, 'analyses'), ann = premier(o.evenements, 'annonce'), so = premier(o.evenements, 'solde'), of = premier(o.evenements, 'offre'), rg = premier(o.evenements, 'regle');
            H.vrai(`D4. ${nom} : la clôture de la marque commence APRÈS la fin de l'analyse, de l'annonce, du solde, de l'offre et du taux`, cl.t0 >= an.t1 && cl.t0 >= ann.t1 && cl.t0 >= so.t1 && cl.t0 >= of.t1 && cl.t0 >= rg.t1);
        }
        H.vrai(`D5. allumé : plus rapide (${b.duree} ms contre ${a.duree} ms, 5 opérations de 60 ms au lieu de 3 phases)`, b.duree <= a.duree - 100);
        H.v('D6. mêmes sorties (réponse, analyse, débit) allumé et éteint', [egal(a.corps, b.corps), egal(a.analyse, b.analyse), a.essais === b.essais, egal(a.mouvements, b.mouvements)], [true, true, true, true]);
        // une écriture d'annonce qui ÉCHOUE n'empêche ni l'analyse ni la réponse, ni la clôture (allumé comme éteint)
        annonceImpl = async () => { throw new Error('annonce cassée'); };
        const e5 = console.error; console.error = () => { };
        let z; try { z = await jouer(fin, sc, {}); } finally { console.error = e5; annonceImpl = vraieAnnonce; }
        H.vrai('D7. allumé, l\'annonce LÈVE : 200, l\'analyse est écrite, la marque est close', z.statut === 200 && z.analyse !== null && z.evenements.some(e => e.nom === 'clore'));
    }

    // D8 : sur une PANNE de la chaîne, aucune lecture du taux n'est lancée d'avance, même drapeau allumé (le chemin d'erreur reste celui d'avant)
    {
        const fin = serveurs[serveurs.length - 1];
        const off = await jouer(svOff, { mode: 'exception', ids: [] }, vec(3)), on = await jouer(fin, { mode: 'exception', ids: [] }, vec(3));
        H.v('D8. panne de la chaîne : aucun taux lu, drapeau éteint comme allumé ; 500 des deux côtés', [off.evenements.filter(e => e.nom === 'regle').length, on.evenements.filter(e => e.nom === 'regle').length, off.statut, on.statut], [0, 0, 500, 500]);
    }

    // ════════════ (F) la durée du dépôt de la photo (POST /api/photo) arrive au journal ════════════
    console.log('=== F. photoIds : la durée du dépôt est reprise dans analyses.durees ===');
    {
        const { creerPhotosRecues } = require('../identifier/photos-recues');
        const store = creerPhotosRecues();
        const sv = await serveur(lireConfig({ ...ENVB, V2_PHOTOS_MULTIPLES: '1' }), { deps: { photosRecues: store } });
        chaine = { mode: 'affirmee', ids: [A.ID_A] }; evenements.length = 0;
        const x = await inst(3);
        const photoId = store.deposer(`installation:${x.i._id}`, 0, Buffer.from('octets-factices'), null, { totalMs: 777.4, traitementMs: 555.2 });
        const r = await poster(sv.url, x.jeton, corps({ photoIds: [{ index: 0, photoId }], ...vec(5) }));
        await attendre(40);
        const an = await raw('analyses').findOne({ _id: new mongoose.Types.ObjectId(r.json.scanId) });
        H.v('F1. durees.photo = la durée du dépôt (arrondie), durees.photoTraitement = son traitement', [r.statut, an && an.durees.photo, an && an.durees.photoTraitement], [200, 777, 555]);
        H.v('F2. la réponse dit que la photo a été reçue (la plomberie des photos est intacte)', [r.json.analyse.photoRecue, r.json.analyse.photosRecues], [true, [0]]);
        store.arreter();
    }

    // ════════════ (E) un LOT : rien n'est lancé d'avance (la règle G ne s'applique pas à plusieurs cartes) ════════════
    console.log('=== E. lots : plusieurs cartes, rien n\'est lancé d\'avance ; UNE carte, la règle G s\'applique et le fournisseur est appelé une seule fois ===');
    {
        const lot = await serveur(cfgDe(DRAPEAUX.tous), { deps: { identifierLot: async () => [{ statutHttp: 200, corps: lecture(A.ID_A) }, { statutHttp: 200, corps: lecture(A.ID_B) }] } });
        const o = await jouer(lot, { mode: 'affirmee', ids: [A.ID_A] }, { imageUrls: [IMAGE, IMAGE], ...vec(3) });
        H.v('E1. lot de 2 cartes, tous drapeaux allumés : 200 et le fournisseur n\'a pas été appelé', [o.statut, o.appelsFournisseur.length], [200, 0]);
        // un lot dont le crochet ne rend QU'UNE carte : la branche d'une carte, la règle G s'y applique (le vecteur est joint)
        const un = () => ({ identifierLot: async () => [{ statutHttp: 200, corps: lecture(A.ID_A) }] });
        const lotOff = await serveur(cfgOff, { deps: un() }), lotOn = await serveur(cfgDe(DRAPEAUX.tous), { deps: un() });
        const a = await jouer(lotOff, { mode: 'affirmee', ids: [A.ID_A] }, vec(3)), b = await jouer(lotOn, { mode: 'affirmee', ids: [A.ID_A] }, vec(3));
        H.v('E2. lot d\'UNE carte, vecteur joint : le fournisseur est appelé une fois, drapeaux éteints comme allumés', [a.appelsFournisseur.length, b.appelsFournisseur.length], [1, 1]);
        H.v('E3. … et la réponse, la ligne d\'analyse, le débit et la question sont les mêmes', [a.statut === b.statut, egal(a.corps, b.corps), egal(a.analyse, b.analyse), a.essais === b.essais, egal(a.mouvements, b.mouvements)], [true, true, true, true, true]);
        H.vrai('E4. … la règle G a bien eu lieu (chaîne affirme A, G affirme P : question)', b.corps.analyse.cartes[0].statut === 'a-trancher' && b.brut.empreinte && b.brut.empreinte.utilisee === true);
    }

    for (const sv of serveurs) await sv.fermer();
    const monter = require('../identifier/monter'); monter.arreterBalayage(); monter.arreterPurge(); MS.arreterRattrapage();
    A.etat.vider();
    await mongoose.disconnect();
    await H.arreterBanc();
    H.bilan();
})().catch(async e => { console.error('❌', e); try { await H.arreterBanc(); } catch (_) { } process.exit(1); });
