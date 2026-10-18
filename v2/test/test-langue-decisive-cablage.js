'use strict';
// Lot LANGUE-DECISIVE, tour de correction 2 (M-C) — le CÂBLAGE de `preparer` dans la VRAIE route d'une carte ET dans le VRAI lot : un espion sur le module (posé AVANT le chargement des routes) compte les appels.
// Une carte => un appel avec UNE réponse de la chaîne ; un lot de deux cartes => un appel avec DEUX ; la version de la colonne est passée (lue une fois) ; la réponse du client n'est pas modifiée.
// Base EN MÉMOIRE, argent = le VRAI grand livre, chaîne et crochet de lot FABRIQUÉS. Aucun réseau, aucun identifiant réel.
const charge = require('../identifier/langue-decisive-charge');
const origine = charge.preparer;
const appels = [];
charge.preparer = async a => { appels.push({ corps: (a.corpsListe || []).length, aVersion: a.version !== undefined, aCatalogue: Boolean(a.catalogue) }); return origine(a); };   // AVANT toute charge de routes.js / lot.js

const H = require('./_harnais');
const mongoose = require('mongoose');
const db = require('../db'); const M = require('../modeles'); const J = require('../comptes/jetons'); const Q = require('./_aide-quota');
const { lireConfig } = require('../config');
const path = require('path');
const IMAGE = require(path.join(__dirname, '..', '..', 'verrou', 'charges.json')).charges.find(c => c.cellule === 'occidentale').imageUrl;
const cfg = lireConfig({ MONGODB_BASE: 'test_scratch', V2_HEBDO: '0', V2_QUOTA_SANS_COMPTE: '1000' });
const ORIGINE = cfg.origines.extension;
let nIp = 0; const ip = () => { nIp++; return { 'x-forwarded-for': `10.15.${Math.floor(nIp / 250)}.${nIp % 250 + 1}` }; };
let nCle = 0; const cle = () => `banc-cablage-${Date.now().toString(36)}-${++nCle}`;
const raw = n => mongoose.connection.db.collection(n);
const VB = require('./_visuels-banc'); const VIS = [];
const ID_A = 895901, ID_B = 895902, EXP = 990021, EXP2 = 990022;

async function inst(essais = 3) {
    const jeton = J.genererJeton(); const i = M.nouvelleInstallation({ jetonEmpreinte: J.empreinte(jeton), essais, libelle: 'banc' });
    await db.col('installations').insertOne(i); await Q.poserRestant(`installation:${i._id}`, essais); return { i, jeton };
}
const corps = () => ({ contrat: 2, imageUrls: [IMAGE], title: null, description: null, prixVinted: null, devise: null, marche: 'vinted.fr', versionExtension: '2.0.0', langueInterface: 'fr' });
const poster = (url, jeton) => H.appel(url, '/api/identifier', { methode: 'POST', corps: corps(), entetes: { origin: ORIGINE, ...ip(), authorization: `Bearer ${jeton}`, 'idempotency-key': cle() } });

(async () => {
    await H.ouvrirBancV2(); await Q.eviterMinuit();
    process.env.MONGODB_BASE = 'test_scratch';
    const { connecterMongo } = require('../../mongo-connexion');
    await connecterMongo({ script: 'test-langue-decisive-cablage.js', ecrit: true });
    db.brancher(mongoose.connection.db); await M.creerIndex();
    for (const c of ['catalogue_produits', 'numeros_cartes', 'guide_prix', 'codes_set']) await raw(c).deleteMany({});
    await raw('codes_set').insertOne({ idExpansion: EXP, codeSet: 'PBL', apprisLe: new Date() });
    await raw('codes_set').insertOne({ idExpansion: EXP2, codeSet: 'ZZZ', apprisLe: new Date() });
    for (const [id, ex, code, num] of [[ID_A, EXP, 'PBL', '001'], [ID_B, EXP2, 'ZZZ', '099']]) {
        await raw('catalogue_produits').insertOne({ idProduct: id, name: 'Tropius (' + code + ' ' + num + ')', idExpansion: ex, idMetacard: 990121 });
        await raw('numeros_cartes').insertOne({ idProduct: id, idExpansion: ex, numero: num, numeroUrl: code + num, codeSet: code, nomFr: 'Tropius', slug: 'Tropius-' + code + num, slugSet: 'Banc-Set-' + code, source: 'cardmarket', certitude: 'exacte' });
        await raw('guide_prix').insertOne({ idProduct: id, avg: 1.1, low: 0.5, trend: 1.0, avg1: 1.0, avg7: 1.0, avg30: 1.1, guideDu: new Date('2026-10-04') });
        VIS.push(VB.doc(id, { variante: 'normale', idMetacard: 990121 }));
    }
    VB.installer(VIS);
    const express = require('express'); const pret = require('../pret');
    const { dansUnScan } = require('../../sources'); const { assembler } = require('../index');
    const ETAT = { estimeIA: null, confianceIA: null, defautsVus: [], declareVendeur: null, declareCardmarket: null, retenu: null };
    const cand = id => ({ idProduct: id, nom: 'Tropius', numero: '001', set: 'Banc Set', prix: 1, photoUrl: null });
    const LECTURE = { numero: '001', total: '064', setCode: 'PBL', symboleSet: null, attaque: null, attaqueConfiance: null, carteTcgdexId: null, langue: null, totalHorsTailleDeSet: false, vivierIds: [ID_A, ID_B] };
    const reponse = (scanId) => ({ success: true, question: null, scanId,
        carte: { idProduct: ID_A, nomProduit: 'Tropius', nom: 'Tropius', nomBrut: 'Tropius', nomConfiance: 'haute', numero: '001', total: '064', setCode: 'PBL', rarete: null, langue: 'EN', ambigu: false },
        etat: ETAT, candidats: [cand(ID_A)], classement: [{ idProduct: ID_A, score: 80 }], guidePrix: {}, reverse: { attendue: false, motif: null, etat: 'aucun-motif', strategie: null }, codeLangue: 1, lectureGarde: LECTURE });
    const chaine = async (req, res) => res.json(reponse(String(req.scanIdImpose)));
    let lotImpl = null;
    const monter = async deps => {
        const app = express(); app.set('trust proxy', true); app.use(express.json()); app.use((q, s, n) => dansUnScan(n));
        pret.armer(require('../modeles').verifierIndex);
        app.use(assembler([require('../argent/monter'), require('../identifier/monter')], cfg, { jumeaux: () => ({ conclu: true, ids: [] }), gererIdentifier: chaine, gererRetourLive: async (q, s) => s.json({ success: true }), ...deps }));
        return H.serveur(app);
    };
    const sv = await monter({});
    const svLot = await monter({ identifierLot: async () => lotImpl() });

    // ── la route d'UNE carte
    {
        appels.length = 0;
        const x = await inst(3); const r = await poster(sv.url, x.jeton); const j = r.json || {};
        H.v('(1) route : la requête aboutit (une carte rendue)', j.analyse && j.analyse.cartes.length, 1);
        H.v('(1)     preparer est appelé UNE fois, avec UNE réponse de la chaîne, la version et le catalogue', appels, [{ corps: 1, aVersion: true, aCatalogue: true }]);
    }
    // ── le LOT de deux cartes
    {
        appels.length = 0;
        const r2 = i => ({ statutHttp: 200, corps: reponse(`lot-${i}`) });
        lotImpl = async () => [r2(0), r2(1)];
        const x = await inst(3); const r = await poster(svLot.url, x.jeton); const j = r.json || {};
        H.v('(2) lot : deux cartes rendues', j.analyse && j.analyse.cartes.length, 2);
        H.v('(2)     preparer est appelé UNE fois, avec DEUX réponses de la chaîne, la version et le catalogue', appels, [{ corps: 2, aVersion: true, aCatalogue: true }]);
        lotImpl = null;
    }
    await sv.fermer(); await svLot.fermer();
    await mongoose.disconnect(); await H.arreterBanc();
    H.bilan();
})().catch(async e => { console.error('❌', e); try { await H.arreterBanc(); } catch (_) { } process.exit(1); });
