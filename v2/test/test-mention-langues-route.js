'use strict';
// MENTION-LANGUES (câblage de la route) — POST /api/identifier, de bout en bout : `visuelMentionLangues` n'est servi QU'AU client qui annonce `capacitesClient: ["mention-langues-1"]`.
// Un client qui ne l'annonce pas (rien, autre valeur, valeur voisine, tableau trop long, type fautif) reçoit EXACTEMENT la réponse d'avant, OCTET POUR OCTET (comparée à la réponse sans le champ `capacitesClient`).
// Base EN MÉMOIRE du banc, chaîne héritée FABRIQUÉE, archive de visuels FABRIQUÉE (une mention d'emprunt sur le produit). Aucun réseau, aucun fichier du testeur, aucune dépense.
const H = require('./_harnais');
const mongoose = require('mongoose');
const db = require('../db'); const M = require('../modeles'); const J = require('../comptes/jetons'); const QA = require('./_aide-quota');
const { lireConfig } = require('../config');
const { MENTION_EDITION_1 } = require('../identifier/emprunt');
const VB = require('./_visuels-banc');
const cfg = lireConfig({});
const ORIGINE = cfg.origines.extension;
const path = require('path');
const IMAGE = require(path.join(__dirname, '..', '..', 'verrou', 'charges.json')).charges.find(c => c.cellule === 'occidentale').imageUrl;   // un hôte admis par la route (aucun téléchargement : la chaîne est fabriquée)
let nIp = 0; const ip = () => { nIp++; return { 'x-forwarded-for': `10.7.${Math.floor(nIp / 250)}.${nIp % 250 + 1}` }; };
let nCle = 0; const cle = () => `banc-ml-${Date.now().toString(36)}-${++nCle}`;
const raw = n => mongoose.connection.db.collection(n);
const corps = (o = {}) => ({ contrat: 2, imageUrls: [IMAGE], title: null, description: null, prixVinted: null, devise: null, marche: 'vinted.fr', versionExtension: '2.0.0', langueInterface: 'fr', ...o });
const ID = 990501;

(async () => {
    await H.ouvrirBancV2();
    await QA.eviterMinuit();
    process.env.MONGODB_BASE = 'test_scratch';
    const { connecterMongo } = require('../../mongo-connexion');
    await connecterMongo({ script: 'test-mention-langues-route.js', ecrit: true });
    db.brancher(mongoose.connection.db);
    await M.creerIndex();
    for (const c of ['catalogue_produits', 'numeros_cartes', 'guide_prix', 'codes_set']) await raw(c).deleteMany({});
    await raw('codes_set').insertOne({ idExpansion: 990001, codeSet: 'PBL', apprisLe: new Date() });
    await raw('catalogue_produits').insertOne({ idProduct: ID, name: 'Tropius (PBL 001)', idExpansion: 990001, idMetacard: 990100 });
    await raw('numeros_cartes').insertOne({ idProduct: ID, idExpansion: 990001, numero: '001', numeroUrl: 'PBL001', codeSet: 'PBL', nomFr: 'Tropius', slug: `Tropius-PBL001-${ID}`, slugSet: 'Banc-Set', source: 'cardmarket', certitude: 'exacte' });
    await raw('guide_prix').insertOne({ idProduct: ID, avg: 1.1, low: 0.5, trend: 1.0, avg1: 1.0, avg7: 1.0, avg30: 1.1, guideDu: new Date('2026-10-04') });
    VB.installer([VB.doc(ID, { numero: '001', idMetacard: 990100, mention: MENTION_EDITION_1 })], []);

    const express = require('express'); const pret = require('../pret');
    const { assembler } = require('../index');
    const lecture = id => ({ success: true, question: null, carte: { idProduct: id, nomProduit: 'Tropius', nom: 'Tropius', numero: '001', total: '064', setCode: 'PBL', rarete: null, langue: 'FR', ambigu: false },
        etat: { estimeIA: null, confianceIA: null, defautsVus: [], declareVendeur: null, declareCardmarket: null, retenu: null },
        candidats: [{ idProduct: id, nom: 'Tropius', numero: '001', set: 'Banc Set', prix: 1, photoUrl: null }], classement: [], guidePrix: {}, reverse: { attendue: false, motif: null, etat: 'aucun-motif', strategie: null }, codeLangue: 2 });
    const chaineFabriquee = async (req, res) => res.json({ ...lecture(ID), scanId: String(req.scanIdImpose) });
    const app = express(); app.set('trust proxy', true); app.use(express.json({ limit: '2400kb' }));
    pret.armer(require('../modeles').verifierIndex);
    app.use(assembler([require('../argent/monter'), require('../identifier/monter')], cfg, { jumeaux: () => ({ conclu: true, ids: [] }), gererIdentifier: chaineFabriquee }));
    const sv = await H.serveur(app);
    const crochet = require('../banc/crochet'); const origRep = crochet.apresReponse; crochet.apresReponse = () => { };

    const jouer = async (extra, o = {}) => {
        const jeton = J.genererJeton(); await db.col('installations').insertOne(M.nouvelleInstallation({ jetonEmpreinte: J.empreinte(jeton), essais: 3, libelle: 'banc' }));
        const r = await H.appel(sv.url, '/api/identifier', { methode: 'POST', corps: corps({ ...o, ...extra }), entetes: { origin: ORIGINE, ...ip(), authorization: `Bearer ${jeton}`, 'idempotency-key': cle() } });
        return r;
    };
    // tous les Produits servis dans la réponse (chaque objet qui porte `visuelMention`)
    const produits = j => { const t = []; const f = x => { if (Array.isArray(x)) x.forEach(f); else if (x && typeof x === 'object') { if ('visuelMention' in x) t.push(x); Object.values(x).forEach(f); } }; f(j); return t; };
    // la réponse SANS ce qui change à chaque appel (scanId, identifiants)
    const normaliser = j => JSON.stringify(j, (k, v) => (k === 'scanId' || k === 'analyseId' || k === 'idempotencyKey' ? '<id>' : v));
    const SANS = await jouer({});
    const dedans = produits(SANS.json);
    H.v('1a. sans `capacitesClient` : 200 et au moins un Produit servi avec sa mention (le banc voit le cas)', [SANS.statut, dedans.length > 0, dedans.every(p => p.visuelMention === MENTION_EDITION_1)], [200, true, true]);
    H.v('1b. … et AUCUNE clé `visuelMentionLangues` (le client d\'avant)', dedans.some(p => 'visuelMentionLangues' in p), false);

    const AVEC = await jouer({ capacitesClient: ['mention-langues-1'] });
    const avec = produits(AVEC.json);
    H.v('2a. `capacitesClient: ["mention-langues-1"]` : 200, chaque Produit porte `visuelMentionLangues` { fr, en }', [AVEC.statut, avec.length > 0, avec.every(p => p.visuelMentionLangues && p.visuelMentionLangues.fr === MENTION_EDITION_1 && p.visuelMentionLangues.en === 'Image from another printing')], [200, true, true]);
    H.v('2b. … `visuelMention` (la chaîne de la langue de l\'interface) ne change pas', avec.map(p => p.visuelMention), avec.map(() => MENTION_EDITION_1));
    const EN = await jouer({ capacitesClient: ['mention-langues-1'] }, { langueInterface: 'en' });
    H.v('2c. langue d\'interface en : les DEUX langues restent servies (indépendantes de l\'interface)', produits(EN.json).map(p => p.visuelMentionLangues), produits(EN.json).map(() => ({ fr: MENTION_EDITION_1, en: 'Image from another printing' })));
    const retire = j => JSON.parse(JSON.stringify(j, (k, v) => (k === 'visuelMentionLangues' ? undefined : v)));
    H.v('2d. déclarée : la réponse est celle d\'avant PLUS ce seul champ (rien d\'autre ne bouge)', normaliser(retire(AVEC.json)), normaliser(SANS.json));

    // les clients qui ne déclarent PAS (au sens strict) : la réponse est celle d'avant, octet pour octet
    const refs = normaliser(SANS.json);
    const cas = [['3a. une autre capacité', { capacitesClient: ['mesures-1'] }], ['3b. une valeur voisine « mention-langues-2 »', { capacitesClient: ['mention-langues-2'] }], ['3c. la casse « Mention-Langues-1 »', { capacitesClient: ['Mention-Langues-1'] }],
        ['3d. un tableau vide', { capacitesClient: [] }], ['3e. une chaîne au lieu d\'un tableau', { capacitesClient: 'mention-langues-1' }], ['3f. un objet', { capacitesClient: { 'mention-langues-1': true } }],
        ['3g. neuf éléments (plus de 8 : ignoré)', { capacitesClient: ['mention-langues-1', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] }], ['3h. la valeur dans un sous-tableau', { capacitesClient: [['mention-langues-1']] }]];
    for (const [nom, extra] of cas) {
        const r = await jouer(extra);
        if (nom.startsWith('3f.')) { H.v(`${nom} : refusé comme avant (400, le type du champ est fermé par la validation d'entrée), aucune clé servie`, [r.statut, produits(r.json).some(p => 'visuelMentionLangues' in p)], [400, false]); continue; }
        H.v(`${nom} : 200, aucune clé \`visuelMentionLangues\`, réponse identique à celle sans le champ`, [r.statut, produits(r.json).some(p => 'visuelMentionLangues' in p), normaliser(r.json) === refs], [200, false, true]);
    }
    const tard = await jouer({ capacitesClient: ['mesures-1', 'mention-langues-1'] });
    H.v('4. déclarée parmi d\'autres capacités : servie', produits(tard.json).every(p => p.visuelMentionLangues && p.visuelMentionLangues.fr === MENTION_EDITION_1) && produits(tard.json).length > 0, true);

    // 5. DRAPEAU V2_MENTION_LANGUES=0 : même route, même client qui déclare la capacité — le champ n'est JAMAIS servi, et la réponse est celle d'avant octet pour octet
    const cfg0 = lireConfig({ V2_MENTION_LANGUES: '0' });
    H.v('5a. la configuration lit V2_MENTION_LANGUES : « 0 » éteint, défaut allumé', [cfg0.mentionLangues, cfg.mentionLangues], [false, true]);
    const app0 = express(); app0.set('trust proxy', true); app0.use(express.json({ limit: '2400kb' }));
    app0.use(assembler([require('../argent/monter'), require('../identifier/monter')], cfg0, { jumeaux: () => ({ conclu: true, ids: [] }), gererIdentifier: chaineFabriquee }));
    const sv0 = await H.serveur(app0);
    const jouer0 = async extra => {
        const jeton = J.genererJeton(); await db.col('installations').insertOne(M.nouvelleInstallation({ jetonEmpreinte: J.empreinte(jeton), essais: 3, libelle: 'banc' }));
        return H.appel(sv0.url, '/api/identifier', { methode: 'POST', corps: corps(extra), entetes: { origin: ORIGINE, ...ip(), authorization: `Bearer ${jeton}`, 'idempotency-key': cle() } });
    };
    const S0 = await jouer0({ capacitesClient: ['mention-langues-1'] });
    const p0 = produits(S0.json);
    H.v('5b. drapeau à « 0 », client qui DÉCLARE la capacité : 200, des Produits servis, AUCUNE clé `visuelMentionLangues`', [S0.statut, p0.length > 0, p0.some(p => 'visuelMentionLangues' in p)], [200, true, false]);
    H.v('5c. … et la réponse est identique à celle d\'un client qui ne déclare rien', normaliser(S0.json) === normaliser((await jouer0({})).json), true);
    await sv0.fermer();

    crochet.apresReponse = origRep;
    const monter = require('../identifier/monter'); monter.arreterBalayage(); monter.arreterPurge(); require('../argent/marque-scan').arreterRattrapage();
    await sv.fermer();
    await mongoose.disconnect();
    await H.arreterBanc();
    H.bilan();
})().catch(async e => { console.error('❌', e); try { await H.arreterBanc(); } catch (_) { } process.exit(1); });
