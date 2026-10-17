'use strict';
// GARDE-CONTRADICTION — le CÂBLAGE (tour 1, I1 de la relecture) : la route d'une carte et le lot chargent le vivier lu par la chaîne, puis la garde de l'adaptateur voit les autres candidats.
// Sans le chargement (`...idsDeLaGarde(c)` de routes.js ou de lot.js), la garde se tait EN SILENCE et S41 repart en sûr : ce banc doit rougir si l'une des deux lignes disparaît.
// Base : la base EN MÉMOIRE du banc (jamais la production, ni R2). La chaîne héritée est FABRIQUÉE (deps.gererIdentifier, deps.identifierLot) ; le catalogue de l'API est le vrai, sur des lignes de banc.
const H = require('./_harnais');
const mongoose = require('mongoose');
const db = require('../db'); const M = require('../modeles'); const J = require('../comptes/jetons'); const Q = require('./_aide-quota');
const { lireConfig } = require('../config');
const path = require('path');
const IMAGE = require(path.join(__dirname, '..', '..', 'verrou', 'charges.json')).charges.find(c => c.cellule === 'occidentale').imageUrl;
const cfg = lireConfig({ MONGODB_BASE: 'test_scratch', V2_HEBDO: '0', V2_QUOTA_SANS_COMPTE: '1000' });
const ORIGINE = cfg.origines.extension;
let nIp = 0; const ip = () => { nIp++; return { 'x-forwarded-for': `10.14.${Math.floor(nIp / 250)}.${nIp % 250 + 1}` }; };
let nCle = 0; const cle = () => `banc-garde-contradiction-${Date.now().toString(36)}-${++nCle}`;
const raw = n => mongoose.connection.db.collection(n);
const VB = require('./_visuels-banc');
const EXP_LM = 990021, EXP_AQ = 990022, ID_LM = 889001, ID_AQ = 889002, ID_PLAT = 889003, EXP_PLAT = 990023;
const corps2 = (o = {}) => ({ contrat: 2, imageUrls: [IMAGE], title: null, description: null, prixVinted: null, devise: null, marche: 'vinted.fr', versionExtension: '2.0.0', langueInterface: 'fr', ...o });
const ETAT = { estimeIA: null, confianceIA: null, defautsVus: [], declareVendeur: null, declareCardmarket: null, retenu: null };

// La réponse de la chaîne héritée pour une AFFIRMATION, avec le bloc lectureGarde (ce que index.js pose pour une requête v2).
const affirmation = (id, lecture, vivierIds) => ({ success: true, scanId: 'x', question: null,
    carte: { idProduct: id, nomProduit: 'Magneton', nom: 'Magneton', nomBrut: 'Magneton', nomConfiance: 'haute', numero: lecture.numero, total: lecture.total, setCode: lecture.setCode, tcgdexId: lecture.carteTcgdexId, rarete: null, langue: 'EN', ambigu: false },
    etat: ETAT, candidats: [], classement: [], guidePrix: {}, reverse: { attendue: false, motif: null, etat: 'aucun-motif', strategie: null }, codeLangue: 1,
    lectureGarde: { symboleSet: null, attaqueConfiance: 'haute', totalHorsTailleDeSet: false, langue: 'EN', vivierIds, ...lecture } });
const LECTURE_S41 = { numero: '22', total: '147', setCode: 'AQU', attaque: 'Steel Wave', carteTcgdexId: 'ecard2-22' };
const LECTURE_PLAT = { numero: '5', total: '100', setCode: 'PLT', attaque: null, carteTcgdexId: null };

(async () => {
    await H.ouvrirBancV2();
    await Q.eviterMinuit();
    process.env.MONGODB_BASE = 'test_scratch';
    const { connecterMongo } = require('../../mongo-connexion');
    await connecterMongo({ script: 'test-garde-contradiction-route.js', ecrit: true });
    db.brancher(mongoose.connection.db);
    await M.creerIndex();
    for (const c of ['catalogue_produits', 'numeros_cartes', 'guide_prix', 'codes_set']) await raw(c).deleteMany({});
    const semer = async (id, exp, nom, code, numero, slugSet, setTcgdex) => {
        await raw('codes_set').updateOne({ idExpansion: exp }, { $set: { idExpansion: exp, codeSet: code, apprisLe: new Date() } }, { upsert: true });
        await raw('catalogue_produits').insertOne({ idProduct: id, name: nom, idExpansion: exp, idMetacard: 990200 + id % 10 });
        await raw('numeros_cartes').insertOne({ idProduct: id, idExpansion: exp, numero, numeroUrl: code + numero, codeSet: code, nomFr: 'Magneton', slug: `${slugSet}-${numero}`, slugSet, setTcgdex, source: 'cardmarket', certitude: 'exacte' });
        await raw('guide_prix').insertOne({ idProduct: id, avg: 1.1, low: 0.5, trend: 1.0, avg1: 1.0, avg7: 1.0, avg30: 1.1, guideDu: new Date('2026-10-04') });
    };
    await semer(ID_LM, EXP_LM, 'Magneton [Reactive Recharge | Multiple Force | Magnetic Blast]', 'LM', '22', 'EX-Legend-Maker', 'ex12');
    await semer(ID_AQ, EXP_AQ, 'Magneton [Magnetic Flow | Steel Wave]', 'AQ', '22', 'Aquapolis', 'ecard2');
    await semer(ID_PLAT, EXP_PLAT, 'Magneton [Un | Deux]', 'PLT', '5', 'Plat-Set', 'plt1');
    VB.installer([VB.doc(ID_LM, { idMetacard: 990201, numero: '22', total: '92', setNom: 'EX Legend Maker' }), VB.doc(ID_AQ, { idMetacard: 990202, numero: '22', total: '147', setNom: 'Aquapolis' }), VB.doc(ID_PLAT, { idMetacard: 990203, numero: '5', total: '100', setNom: 'Plat Set' })]);

    const express = require('express'); const pret = require('../pret');
    const { dansUnScan } = require('../../sources'); const { assembler } = require('../index');
    let chaineCorps = null, lotCorps = null;
    const chaine = async (req, res) => res.json({ ...chaineCorps, scanId: String(req.scanIdImpose) });
    const identifierLot = async () => lotCorps.map(c => ({ statutHttp: 200, corps: c }));
    const monter = async deps => {
        const app = express(); app.set('trust proxy', true); app.use(express.json()); app.use((q, s, n) => dansUnScan(n));
        pret.armer(require('../modeles').verifierIndex);
        app.use(assembler([require('../argent/monter'), require('../identifier/monter')], cfg, { jumeaux: () => ({ conclu: true, ids: [] }), gererIdentifier: chaine, gererRetourLive: async (q, s) => s.json({ success: true }), ...deps }));
        return H.serveur(app);
    };
    const sv = await monter({}), svLot = await monter({ identifierLot });
    const inst = async () => {
        const jeton = J.genererJeton(); const i = M.nouvelleInstallation({ jetonEmpreinte: J.empreinte(jeton), essais: 3, libelle: 'banc' });
        await db.col('installations').insertOne(i); await Q.poserRestant(`installation:${i._id}`, 3); return { i, jeton };
    };
    const poster = (url, x) => H.appel(url, '/api/identifier', { methode: 'POST', corps: corps2(), entetes: { origin: ORIGINE, ...ip(), authorization: `Bearer ${x.jeton}`, 'idempotency-key': cle() } });
    const ligneQ = async scanId => raw('questions_v2').findOne({ _id: `${scanId}:0` });

    // ── 1. la route d'UNE carte : S41 affirmée par la chaîne, le vivier [LM, AQ] est CHARGÉ, la garde le voit
    {
        chaineCorps = affirmation(ID_LM, LECTURE_S41, [ID_LM, ID_AQ]);
        const x = await inst(); const r = await poster(sv.url, x); const j = r.json || {}, c0 = j.analyse && j.analyse.cartes[0];
        H.v('1. route d\'une carte : S41 affirmée par la chaîne => 200, a-trancher (jamais identifiee), la vérité AQ et le gagnant LM montrés',
            [r.statut, c0 && c0.statut, c0 && c0.candidats.map(c => c.idProduct)], [200, 'a-trancher', [ID_LM, ID_AQ]]);
        H.v('   le crédit est RÉSERVÉ comme toute question (debite 0, reserve 1), la question est écrite en attente avec les deux choix',
            [j.facturation && j.facturation.debite, j.facturation && j.facturation.reserve, (await ligneQ(j.scanId) || {}).etat, ((await ligneQ(j.scanId) || {}).choix || []).map(c => c.idProduct)], [0, 1, 'en-attente', [ID_LM, ID_AQ]]);
        H.vrai('   la réponse ne sert ni le résumé de la contradiction ni le bloc de lecture', !JSON.stringify(j).includes('contredit par') && !JSON.stringify(j).includes('lectureGarde') && !JSON.stringify(j).includes('ecard2'));
    }
    // ── 2. la même carte sans contradiction : l'affirmation passe (le câblage ne rétrograde pas à tort)
    {
        chaineCorps = affirmation(ID_PLAT, LECTURE_PLAT, [ID_PLAT, ID_LM]);
        const x = await inst(); const r = await poster(sv.url, x); const c0 = r.json.analyse.cartes[0];
        H.v('2. aucune contradiction : identifiee, débit 1', [r.statut, c0.statut, r.json.facturation.debite], [200, 'identifiee', 1]);
    }
    // ── 3. le LOT : le vivier de CHAQUE carte est chargé (une carte contredite devient une question, l'autre reste affirmée)
    {
        lotCorps = [affirmation(ID_LM, LECTURE_S41, [ID_LM, ID_AQ]), affirmation(ID_PLAT, LECTURE_PLAT, [ID_PLAT])];
        const x = await inst(); const r = await poster(svLot.url, x); const a = r.json.analyse || {};
        H.v('3. lot de 2 cartes : S41 => a-trancher, l\'autre identifiee (le vivier de la carte contredite est chargé par lot.js)',
            [r.statut, a.statut, (a.cartes || []).map(c => [c.index, c.statut]).sort((p, q) => p[0] - q[0]), a.lot && [a.lot.identifiees, a.lot.aTrancher], ((a.cartes || []).find(c => c.index === 0) || { candidats: [] }).candidats.map(c => c.idProduct)],
            [200, 'lot', [[0, 'a-trancher'], [1, 'identifiee']], [1, 1], [ID_LM, ID_AQ]]);
    }
    await sv.fermer(); await svLot.fermer();
    H.bilan();
})().catch(e => { console.error('❌', e); process.exitCode = 1; }).finally(async () => { try { await mongoose.disconnect(); await H.arreterBanc(); } catch (e) { console.error(e.message); } });
