'use strict';
// Lot DESIGNATION, tour 1 (M1 de la relecture) — la ROUTE et l'ARGENT pour une affirmation née de la DÉSIGNATION `numero` sur une question à 2 candidats que la CHAÎNE a déjà réservée (index.js : poserQuestion avant l'adaptateur).
// La réservation est réglée comme une réponse par ce candidat (chemin du critère A, routes.js) : débit confirmé, question « repondue », rien de rendu par le balayage. Éteinte : la question reste réservée et le balayage la rend.
// Base : la base EN MÉMOIRE du banc ; argent = le VRAI grand livre ; chaîne FABRIQUÉE. Aucun réseau, aucun identifiant réel.
const H = require('./_harnais');
const mongoose = require('mongoose');
const db = require('../db'); const M = require('../modeles'); const J = require('../comptes/jetons'); const Q = require('./_aide-quota');
const { lireConfig } = require('../config');
const path = require('path');
const IMAGE = require(path.join(__dirname, '..', '..', 'verrou', 'charges.json')).charges.find(c => c.cellule === 'occidentale').imageUrl;
const cfg = lireConfig({ MONGODB_BASE: 'test_scratch', V2_HEBDO: '0', V2_QUOTA_SANS_COMPTE: '1000' });
const ORIGINE = cfg.origines.extension;
let nIp = 0; const ip = () => { nIp++; return { 'x-forwarded-for': `10.14.${Math.floor(nIp / 250)}.${nIp % 250 + 1}` }; };
let nCle = 0; const cle = () => `banc-desig-${Date.now().toString(36)}-${++nCle}`;
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
    await connecterMongo({ script: 'test-route-designation.js', ecrit: true });
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
    const LECTURE = { numero: '001', total: null, setCode: 'PBL', symboleSet: null, attaque: null, attaqueConfiance: null, carteTcgdexId: null, langue: null, totalHorsTailleDeSet: false, vivierIds: [ID_A, ID_B] };
    const reponse = scanId => ({ success: true, question: { etat: 'en-attente', delaiHeures: 24 }, scanId,
        carte: { idProduct: ID_A, nomProduit: 'Tropius', nom: 'Tropius', nomBrut: 'Tropius', nomConfiance: 'haute', numero: '001', total: null, setCode: 'PBL', rarete: null, langue: 'EN', ambigu: true },
        etat: ETAT, candidats: [cand(ID_A), cand(ID_B)], classement: [{ idProduct: ID_A, score: 80 }, { idProduct: ID_B, score: 79 }], guidePrix: {}, reverse: { attendue: false, motif: null, etat: 'aucun-motif', strategie: null }, codeLangue: 1, lectureGarde: LECTURE });
    let desig = { numero: true };
    const chaine = async (req, res) => { const scanId = String(req.scanIdImpose); await req.credit.v2.poserQuestion(req, { scanId: req.scanIdImpose, raison: 'egalite-sans-enjeu', candidats: [ID_A, ID_B] }); return res.json(reponse(scanId)); };
    const app = express(); app.set('trust proxy', true); app.use(express.json()); app.use((q, s, n) => dansUnScan(n));
    pret.armer(require('../modeles').verifierIndex);
    app.use(assembler([require('../argent/monter'), require('../identifier/monter')], cfg, {
        jumeaux: () => ({ conclu: true, ids: [] }),
        adapter: (a, ctx) => adaptateur.adapter(a, { ...ctx, critereA: true, codeNumeroExiste: Object.assign(() => false, { famille: () => [] }), designation: desig }),
        gererIdentifier: chaine, gererRetourLive: async (q, s) => s.json({ success: true })
    }));
    const sv = await H.serveur(app);
    const { balayerQuestions } = require('../argent/questions');
    const plus25h = () => new Date(Date.now() + 25 * 3600 * 1000);
    const un = async () => { const x = await inst(3); const r = await poster(sv.url, x.jeton); return { x, r, j: r.json || {} }; };
    // (1) désignation allumée : la question de la chaîne (2 candidats, réservée) devient une affirmation ; la réservation est réglée comme une réponse
    {
        desig = { numero: true };
        const { x, j } = await un();
        H.v('(R1) désignation numero : identifiée par A', [j.analyse && j.analyse.cartes[0].statut, j.analyse && j.analyse.cartes[0].carte && j.analyse.cartes[0].carte.idProduct], ['identifiee', ID_A]);
        H.v('(R1)     facturation débitée, rien de réservé', j.facturation && [j.facturation.debite, j.facturation.reserve, j.facturation.rembourse, j.facturation.motif], [1, 0, false, 'affirmee']);
        const q = await ligneQ(j.scanId);
        H.v('(R1)     la question de la chaîne est « repondue » par A', [q && q.etat, q && q.reponse && q.reponse.idProduct], ['repondue', ID_A]);
        H.v('(R1)     grand livre : un débit confirmé, net −1', await livre(x), { essais: 2, net: -1, ouverts: ['debite'], remboursements: 0 });
        const b = await balayerQuestions({ maintenant: plus25h() }, cfg);
        H.v('(R1)     le balayage à +25 h ne rend rien', [b.reglees, b.remboursees, (await livre(x)).net], [0, 0, -1]);
    }
    // (2) éteinte : la question reste réservée, le balayage la rend
    {
        desig = { numero: false };
        const { x, j } = await un();
        H.v('(R2) éteinte : a-trancher réservée', [j.analyse && j.analyse.cartes[0].statut, j.facturation && j.facturation.reserve, (await ligneQ(j.scanId)).etat], ['a-trancher', 1, 'en-attente']);
        const b = await balayerQuestions({ maintenant: plus25h() }, cfg);
        H.v('(R2)     le balayage la rend', [b.remboursees, (await livre(x)).net], [1, 0]);
    }
    await sv.fermer(); await mongoose.disconnect(); await H.arreterBanc();
    H.bilan();
})().catch(async e => { console.error('❌', e); try { await H.arreterBanc(); } catch (_) { } process.exit(1); });
