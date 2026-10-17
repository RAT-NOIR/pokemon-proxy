'use strict';
// Lot CRITERE-A, tour 1 (relecture r1, C1) — la ROUTE et l'ARGENT : une affirmation née du critère A sur la voie « candidat unique » remplace une question que la CHAÎNE a déjà réservée
// (index.js : poserQuestion avant l'adaptateur). La réservation doit être RÉGLÉE comme une réponse par ce candidat : débit confirmé, question « repondue », rien de rendu par le balayage.
// Le cas inverse (question réservée par la chaîne, puis introuvable de l'adaptateur) : le filet l'annule et rend le crédit. Le lot : aucune réservation de question pour une carte affirmée.
// Base : la base EN MÉMOIRE du banc ; argent = le VRAI grand livre ; chaîne et crochet de lot FABRIQUÉS. Aucun réseau, aucun identifiant réel.
const H = require('./_harnais');
const mongoose = require('mongoose');
const db = require('../db'); const M = require('../modeles'); const J = require('../comptes/jetons'); const Q = require('./_aide-quota');
const { lireConfig } = require('../config');
const path = require('path');
const IMAGE = require(path.join(__dirname, '..', '..', 'verrou', 'charges.json')).charges.find(c => c.cellule === 'occidentale').imageUrl;
const cfg = lireConfig({ MONGODB_BASE: 'test_scratch', V2_HEBDO: '0', V2_QUOTA_SANS_COMPTE: '1000' });
const ORIGINE = cfg.origines.extension;
let nIp = 0; const ip = () => { nIp++; return { 'x-forwarded-for': `10.14.${Math.floor(nIp / 250)}.${nIp % 250 + 1}` }; };
let nCle = 0; const cle = () => `banc-critere-${Date.now().toString(36)}-${++nCle}`;
const raw = n => mongoose.connection.db.collection(n);
const VB = require('./_visuels-banc'); const VIS = [];
const ID_A = 895801, ID_B = 895802, EXP = 990011, EXP2 = 990012;

async function inst(essais = 3) {
    const jeton = J.genererJeton(); const i = M.nouvelleInstallation({ jetonEmpreinte: J.empreinte(jeton), essais, libelle: 'banc' });
    await db.col('installations').insertOne(i); await Q.poserRestant(`installation:${i._id}`, essais); return { i, jeton };
}
const corps = () => ({ contrat: 2, imageUrls: [IMAGE], title: null, description: null, prixVinted: null, devise: null, marche: 'vinted.fr', versionExtension: '2.0.0', langueInterface: 'fr' });
const poster = (url, jeton) => H.appel(url, '/api/identifier', { methode: 'POST', corps: corps(), entetes: { origin: ORIGINE, ...ip(), authorization: `Bearer ${jeton}`, 'idempotency-key': cle() } });
async function livre(x) {
    const mv = await raw('mouvements').find({ installationId: x.i._id }).toArray();
    return { essais: await Q.restantDe({ type: 'installation', id: x.i._id }, cfg), net: mv.reduce((s, m) => s + m.delta, 0), ouverts: mv.filter(m => m.type === 'debit' && m.etat !== 'rembourse').map(m => m.etat), remboursements: mv.filter(m => m.type === 'remboursement').length };
}
const ligneQ = async (scanId, carte = 0) => raw('questions_v2').findOne({ _id: `${scanId}:${carte}` });

(async () => {
    await H.ouvrirBancV2(); await Q.eviterMinuit();
    process.env.MONGODB_BASE = 'test_scratch';
    const { connecterMongo } = require('../../mongo-connexion');
    await connecterMongo({ script: 'test-critere-a-route.js', ecrit: true });
    db.brancher(mongoose.connection.db); await M.creerIndex();
    for (const c of ['catalogue_produits', 'numeros_cartes', 'guide_prix', 'codes_set']) await raw(c).deleteMany({});
    await raw('codes_set').insertOne({ idExpansion: EXP, codeSet: 'PBL', apprisLe: new Date() });
    await raw('codes_set').insertOne({ idExpansion: EXP2, codeSet: 'ZZZ', apprisLe: new Date() });
    for (const [id, ex, code, num] of [[ID_A, EXP, 'PBL', '001'], [ID_B, EXP2, 'ZZZ', '099']]) {
        await raw('catalogue_produits').insertOne({ idProduct: id, name: 'Tropius (' + code + ' ' + num + ')', idExpansion: ex, idMetacard: 990111 });
        await raw('numeros_cartes').insertOne({ idProduct: id, idExpansion: ex, numero: num, numeroUrl: code + num, codeSet: code, nomFr: 'Tropius', slug: 'Tropius-' + code + num, slugSet: 'Banc-Set-' + code, source: 'cardmarket', certitude: 'exacte' });
        await raw('guide_prix').insertOne({ idProduct: id, avg: 1.1, low: 0.5, trend: 1.0, avg1: 1.0, avg7: 1.0, avg30: 1.1, guideDu: new Date('2026-10-04') });
        VIS.push(VB.doc(id, { variante: 'normale', idMetacard: 990111 }));
    }
    VB.installer(VIS);
    const express = require('express'); const pret = require('../pret');
    const { dansUnScan } = require('../../sources'); const { assembler } = require('../index');
    const adaptateur = require('../identifier/adaptateur');
    const ETAT = { estimeIA: null, confianceIA: null, defautsVus: [], declareVendeur: null, declareCardmarket: null, retenu: null };
    const cand = id => ({ idProduct: id, nom: 'Tropius', numero: '001', set: 'Banc Set', prix: 1, photoUrl: null });
    const LECTURE = { numero: '001', total: '064', setCode: 'PBL', symboleSet: null, attaque: null, attaqueConfiance: null, carteTcgdexId: null, langue: null, totalHorsTailleDeSet: false, vivierIds: [ID_A, ID_B] };
    const reponse = (scanId, { ambigu, nom = 'Tropius', lecture = {} }) => ({ success: true, question: ambigu ? { etat: 'en-attente', delaiHeures: 24 } : null, scanId,
        carte: { idProduct: ID_A, nomProduit: 'Tropius', nom, nomBrut: nom, nomConfiance: 'haute', numero: '001', total: '064', setCode: 'PBL', rarete: null, langue: 'EN', ambigu },
        etat: ETAT, candidats: [cand(ID_A)], classement: [{ idProduct: ID_A, score: 80 }], guidePrix: {}, reverse: { attendue: false, motif: null, etat: 'aucun-motif', strategie: null }, codeLangue: 1,
        lectureGarde: { ...LECTURE, ...lecture } });
    let mode = 'unique', critere = true, lotImpl = null;
    // la chaîne : sur la voie « ambiguë » elle POSE la question (comme index.js:5959) AVANT de répondre ; sur la voie « affirmation » elle ne pose rien
    const chaine = async (req, res) => {
        const scanId = String(req.scanIdImpose);
        if (mode === 'affirmee') return res.json(reponse(scanId, { ambigu: false }));
        await req.credit.v2.poserQuestion(req, { scanId: req.scanIdImpose, raison: 'egalite-sans-enjeu', candidats: [ID_A] });
        return res.json(reponse(scanId, { ambigu: true, ...(mode === 'unique-nom-contredit' ? { nom: 'Pikachu' } : {}) }));
    };
    const monter = async deps => {
        const app = express(); app.set('trust proxy', true); app.use(express.json()); app.use((q, s, n) => dansUnScan(n));
        pret.armer(require('../modeles').verifierIndex);
        app.use(assembler([require('../argent/monter'), require('../identifier/monter')], cfg, {
            jumeaux: id => ({ conclu: true, ids: id === ID_A ? [ID_B] : id === ID_B ? [ID_A] : [] }),
            adapter: (a, ctx) => adaptateur.adapter(a, { ...ctx, critereA: critere }),
            gererIdentifier: chaine, gererRetourLive: async (q, s) => s.json({ success: true }), ...deps
        }));
        return H.serveur(app);
    };
    const sv = await monter({});
    const svLot = await monter({ identifierLot: async () => lotImpl() });
    const { balayerQuestions } = require('../argent/questions');
    const plus25h = () => new Date(Date.now() + 25 * 3600 * 1000);
    const un = async (m, avecCritere = true) => { mode = m; critere = avecCritere; const x = await inst(3); const r = await poster(sv.url, x.jeton); return { x, r, j: r.json || {} }; };

    // ── (1) C1 : candidat unique, critère allumé => identifiée, la réservation de la chaîne est RÉGLÉE comme une réponse (débit confirmé), le balayage à +25 h ne rend rien
    {
        const { x, j } = await un('unique');
        H.v('(1) candidat unique + critère A : la carte est identifiée', [j.analyse && j.analyse.statut, j.analyse && j.analyse.cartes[0].statut], ['identifiee', 'identifiee']);
        H.v('(1)     la facturation dite au client : débitée', j.facturation && [j.facturation.debite, j.facturation.reserve, j.facturation.rembourse, j.facturation.motif], [1, 0, false, 'affirmee']);
        const q = await ligneQ(j.scanId);
        H.v('(1)     la question de la chaîne est RÉGLÉE : « repondue » par ce candidat (jamais « en-attente »)', [q && q.etat, q && q.reponse && q.reponse.idProduct], ['repondue', ID_A]);
        H.v('(1)     le grand livre : un débit CONFIRMÉ (plus de réserve), net −1, restant 2', await livre(x), { essais: 2, net: -1, ouverts: ['debite'], remboursements: 0 });
        const b = await balayerQuestions({ maintenant: plus25h() }, cfg);
        H.v('(1)     le balayage à +25 h ne rend RIEN : 0 question réglée, 0 remboursée', [b.reglees, b.remboursees], [0, 0]);
        H.v('(1)     … le net reste −1 (1 débit), le restant 2, la ligne reste « repondue »', [await livre(x), (await ligneQ(j.scanId)).etat], [{ essais: 2, net: -1, ouverts: ['debite'], remboursements: 0 }, 'repondue']);
    }
    // ── (2) le témoin : critère éteint => la question de la chaîne reste (réservée) et le balayage la rend (comportement normal d'une question non répondue)
    {
        const { x, j } = await un('unique', false);
        H.v('(2) critère éteint : a-trancher, réservée', [j.analyse && j.analyse.cartes[0].statut, j.facturation && j.facturation.reserve, (await ligneQ(j.scanId)).etat], ['a-trancher', 1, 'en-attente']);
        const b = await balayerQuestions({ maintenant: plus25h() }, cfg);
        H.v('(2)     le balayage la rend (abandon)', [b.remboursees, (await livre(x)).net], [1, 0]);
    }
    // ── (3) l'affirmation de la chaîne (ambigu faux) : aucune question posée, un débit, le balayage sans effet
    {
        const { x, j } = await un('affirmee');
        H.v('(3) affirmation de la chaîne puis critère : identifiée, débitée, aucune ligne de question', [j.analyse.cartes[0].statut, j.facturation.debite, await ligneQ(j.scanId)], ['identifiee', 1, null]);
        await balayerQuestions({ maintenant: plus25h() }, cfg);
        H.v('(3)     le balayage ne change rien : net −1', (await livre(x)).net, -1);
    }
    // ── (4) le cas INVERSE : la chaîne a réservé une question, l'adaptateur rend un introuvable (le nom lu contredit l'unique candidat) : le filet l'annule et rend le crédit
    {
        const { x, j } = await un('unique-nom-contredit');
        H.v('(4) question réservée puis introuvable : introuvable, rendu', [j.analyse && j.analyse.cartes[0].statut, j.facturation && [j.facturation.debite, j.facturation.rembourse]], ['introuvable', [0, true]]);
        const q = await ligneQ(j.scanId);
        H.v('(4)     la question n\'est plus « en-attente » : annulée par le filet (état terminal « non-remboursee » = jamais reprise ; l\'argent est rendu par le livre, vérifié ci-dessous)', q && q.etat, 'non-remboursee');
        H.v('(4)     le grand livre : net 0, un remboursement, restant 3 ; le balayage à +25 h ne rend pas une seconde fois', [await livre(x), (await balayerQuestions({ maintenant: plus25h() }, cfg)).remboursees, (await livre(x)).net], [{ essais: 3, net: 0, ouverts: [], remboursements: 1 }, 0, 0]);
    }
    // ── (5) le LOT : une carte affirmée par le critère (candidat unique) et une autre affirmée par la chaîne : aucune réservation de question
    {
        mode = 'affirmee'; critere = true;
        const r2 = i => ({ statutHttp: 200, corps: reponse(`lot-${i}`, { ambigu: i === 0 }) });
        lotImpl = async () => [r2(0), r2(1)];
        const x = await inst(3); const r = await poster(svLot.url, x.jeton); const j = r.json || {};
        H.v('(5) lot de deux cartes, toutes deux identifiées par la chaîne/le critère', [j.analyse && j.analyse.statut, (j.analyse ? j.analyse.cartes : []).map(c => c.statut)], ['lot', ['identifiee', 'identifiee']]);
        H.v('(5)     aucune ligne de question pour ce scan', await raw('questions_v2').countDocuments({ scanId: j.scanId }), 0);
        await balayerQuestions({ maintenant: plus25h() }, cfg);
        H.v('(5)     le balayage ne rend rien : le lot reste débité (1 unité par tranche de 10)', (await livre(x)).net, -1);
        lotImpl = null;
    }
    await sv.fermer(); await svLot.fermer();
    await mongoose.disconnect(); await H.arreterBanc();
    H.bilan();
})().catch(async e => { console.error('❌', e); try { await H.arreterBanc(); } catch (_) { } process.exit(1); });
