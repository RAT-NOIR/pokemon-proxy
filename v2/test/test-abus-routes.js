'use strict';
// B8.1 — LE BANC D'INJECTION ET D'ABUS, sur CHAQUE route montée (audit de sécurité de la branche v2).
// Step 1 : les routes d'écriture sont DÉRIVÉES de la pile du routeur monté (`router.stack`), jamais d'une liste en dur. Le banc ÉCHOUE si une route d'écriture montée (toute
//          méthode hors GET, HEAD, OPTIONS) n'a pas de cible déclarée ci-dessous, ou si une cible déclarée n'est plus montée. Cinq charges par route :
//          (a) chaque champ texte du corps remplacé par {"$ne":""}, {"$gt":""}, {"$where":"1"}, un tableau, un nombre, null ;
//          (b) {"__proto__":{"role":"administrateur"},"constructor":{"prototype":{"x":1}}} seul, puis ajouté à un corps valide ;
//          (c) un corps de 5 Mo ;  (d) un Idempotency-Key d'un autre porteur ;  (e) l'id d'une ressource d'un autre porteur (scan, installation, question, code).
//          Attendu : jamais 2xx sur (a)(b)(c) (sauf tolérance NOMMÉE plus bas), jamais 5xx, aucune écriture en base (compte de documents avant/après, toutes les collections),
//          Object.prototype intact, aucun corps d'erreur ne contient une pile, un chemin de fichier ou un nom de collection ; (d)(e) => jamais les données d'autrui.
//          Dénominateur imprimé : « N routes × M charges ».
// Step 2 : timing de la connexion (adresse inconnue / mot de passe faux, 20 essais) ; inscription, réinitialisation et renvoi : réponses identiques OCTET POUR OCTET.
// Step 3 : tous les journaux du banc (captés) sont parcourus : aucun secret n'y figure. Step 4 : SSRF (imageUrls), ReDoS (expurger), client Turnstile.
// Base : la base EN MÉMOIRE du banc (INT2). Aucun réseau (chaîne héritée, Turnstile et courrier FABRIQUÉS), aucun R2.
const H = require('./_harnais');
const path = require('path');
const crypto = require('crypto');
const mongoose = require('mongoose');
const express = require('express');

// ── les journaux sont CAPTÉS (Step 3). Seules les lignes du banc lui-même sont recopiées à l'écran.
const journaux = [];
const sortie = { log: console.log.bind(console), error: console.error.bind(console) };
for (const k of ['log', 'warn', 'error', 'info']) {
    console[k] = (...a) => {
        const t = a.map(x => (typeof x === 'string' ? x : (x && x.stack) || JSON.stringify(x))).join(' ');
        journaux.push(t);
        if (/^(\n)?(✅|❌) (?!\[)/.test(t) || /^\s{3}/.test(t) || /^\n?\d+ réussis, \d+ échoués/.test(t) || /^[═─]{3}/.test(t)) sortie.log(t);
    };
}
const db = require('../db'); const M = require('../modeles'); const J = require('../comptes/jetons');
const { lireConfig } = require('../config');
const CHARGES = path.join(__dirname, '..', '..', 'verrou', 'charges.json');
const IMAGE = require(CHARGES).charges.find(c => c.cellule === 'occidentale').imageUrl;
const cfg = lireConfig({ MONGODB_BASE: 'test_scratch' });
const EXT = cfg.origines.extension, SITE = cfg.origines.site;
const raw = n => mongoose.connection.db.collection(n);
const attendre = ms => new Promise(r => setTimeout(r, ms));
const MDP = 'un-mot-de-passe-solide';
const POISON = '{"__proto__":{"role":"administrateur"},"constructor":{"prototype":{"x":1}}}';

// ── les secrets que le banc fabrique : ils ne doivent apparaître dans AUCUN journal (Step 3)
const secrets = new Set();
const secret = (x, libelle) => { if (typeof x === 'string' && x.length >= 6) secrets.add(JSON.stringify([libelle, x])); return x; };
let nIp = 0, nCle = 0, nMail = 0;
const ipPropre = () => { nIp++; return `10.80.${Math.floor(nIp / 250)}.${nIp % 250 + 1}`; };
const ip = () => ({ 'x-forwarded-for': secret(ipPropre(), 'ip') });
const cle = () => secret(`abus-b8-${Date.now().toString(36)}-${++nCle}`, 'idempotency-key');
const mail = () => secret(`abus${++nMail}.${Date.now().toString(36)}@exemple.fr`, 'e-mail');
const extH = (jeton, plus = {}) => ({ origin: EXT, ...ip(), ...(jeton ? { authorization: `Bearer ${jeton}` } : {}), ...plus });
const siteH = (cookie, plus = {}) => ({ origin: SITE, 'x-rat-market': '1', ...(cookie ? { cookie } : {}), ...ip(), ...plus });
const corpsId = (o = {}) => ({ contrat: 2, imageUrls: [IMAGE], title: 'Dracaufeu', description: 'belle carte', prixVinted: 5, devise: 'EUR', marche: 'vinted.fr', vintedEtat: 'Très bon état', vintedUrl: 'https://www.vinted.fr/items/123-dracaufeu',
    versionExtension: '2.0.0', langueInterface: 'fr', ...o });

// ── ce que le banc juge sur CHAQUE réponse
const MOTIFS_FUITE = [[/\bat\s+\S+\s+\([^)]*:\d+:\d+\)/, 'pile'], [/node_modules/, 'chemin node_modules'], [/[A-Za-z]:\\\\|[A-Za-z]:\\[A-Za-z]/, 'chemin Windows'], [/\/(home|app|opt|usr|srv)\/[^\s"]+/, 'chemin Unix'],
    [/\.js:\d+/, 'fichier:ligne'], [/Mongo(Server)?Error|E11000|ValidationError|CastError|BSONError|MongooseError/, 'erreur du pilote'], [/ECONN|ENOTFOUND|ETIMEDOUT/, 'erreur réseau']];
let NOMS_COLLECTIONS = [];
// Le nom d'une collection ne se cherche que dans une réponse d'ERREUR ou illisible : une réponse de succès porte légitimement des clés (`solde.hebdo`) qui portent le même nom.
function fuite(texte, reponse = {}) {
    for (const [re, nom] of MOTIFS_FUITE) if (re.test(texte)) return nom;
    const erreur = reponse.statut >= 400 || !reponse.json || reponse.json.success === false;
    if (erreur) for (const n of NOMS_COLLECTIONS) if (new RegExp(`\\b${n}\\b`).test(texte)) return `nom de collection « ${n} »`;
    return null;
}
const protoSain = () => Object.keys(Object.prototype).length === 0 && ({}).role === undefined && ({}).x === undefined && !Object.prototype.hasOwnProperty.call(Object.prototype, 'x') && Object.getPrototypeOf(Object.prototype) === null;
// Le compteur de la collection (`compteurs`, clé collection-octets) est créé par un RECOMPTE lancé au MONTAGE du lot, sans que personne l'attende (collection/service.js : initialiser). Sous charge
// (lancer-tout), il peut aboutir APRÈS le premier instantané : « ÉCART … écriture en base (compteurs 0→1) » sur une requête hostile qui n'a rien écrit (« 85 réussis, 2 échoués », vu en B1 puis au tour 1 de
// B2b). Tour 2 : le lot expose la PROMESSE de ce recompte (`collection/monter.js` : pret, production inchangée) ; le premier instantané l'ATTEND (30 s) au lieu de sonder la base, et l'attente qui expire,
// un recompte en échec ou un compteur toujours absent LÈVENT : le banc n'est plus instable en silence.
let compteurAttendu = false;
async function attendreCompteur() {
    if (compteurAttendu) return; compteurAttendu = true;
    await require('../collection/monter').pret(30000);
    if (await raw('compteurs').countDocuments({ cle: 'collection-octets' }) < 1) throw new Error('le recompte de la collection a abouti mais le compteur global est absent');
}
async function instantane() {
    await attendreCompteur();
    const noms = (await mongoose.connection.db.listCollections().toArray()).map(c => c.name).filter(n => !n.startsWith('system.'));
    const o = {}; for (const n of noms) o[n] = await raw(n).countDocuments({});
    return o;
}
const EXCLUS_ECRITURE = new Set(['limites']);      // compteurs de débit : l'état d'un limiteur n'est pas une donnée métier (ils sont comptés à part)
const ecrits = (a, b) => Object.keys(b).filter(k => !EXCLUS_ECRITURE.has(k) && (a[k] || 0) !== b[k]).map(k => `${k} ${a[k] || 0}→${b[k]}`);

async function envoyer(base, { methode, chemin, entetes = {}, corps, brut, type }) {
    const h = { ...entetes }; let body;
    if (brut !== undefined) { body = brut; if (type) h['content-type'] = type; }
    else if (corps !== undefined) { body = JSON.stringify(corps); h['content-type'] = 'application/json'; }
    const t0 = performance.now();
    try {
        const r = await fetch(base + chemin, { method: methode, headers: h, body, redirect: 'manual' });
        const texte = Buffer.from(await r.arrayBuffer()).toString('utf8');
        let json = null; try { json = JSON.parse(texte); } catch { /* corps non JSON */ }
        return { statut: r.status, entetes: Object.fromEntries(r.headers), texte, json, ms: performance.now() - t0 };
    } catch (e) { return { statut: 0, entetes: {}, texte: '', json: null, coupure: String(e && e.cause && e.cause.code || e && e.message || e), ms: performance.now() - t0 }; }
}

(async () => {
    // B2b point 6 : (O1) « au plus 3 courriers par adresse et par heure » est un compteur de SERVICE (consommer, `new Date()`) : une frontière d'heure entre les 8 demandes ferait partir 3 courriers dans chaque
    // heure (6 reçus, assertion fausse) ; c'est la cause retenue du « 85 réussis, 2 échoués » vu une fois en B1 (reproduit à l'horloge décalée sur une copie sans garde). La garde attend la frontière si elle est à moins de 4 minutes (le banc dure ~35 s).
    // (les limiteurs de ce banc passent par l'horloge commune, fixée au milieu de l'heure après l'ouverture de la base : fenêtres d'IP et de porteur.)
    await H.eviterFrontieres({ heure: true });
    await H.ouvrirBancV2();
    H.fixerHorlogeMilieu();
    process.env.MONGODB_BASE = 'test_scratch';
    const { connecterMongo } = require('../../mongo-connexion');
    await connecterMongo({ script: 'test-abus-routes.js', ecrit: true });
    db.brancher(mongoose.connection.db);
    await M.creerIndex();
    const sharp = require('sharp');
    const JPEG = await sharp(crypto.randomBytes(24 * 24 * 3), { raw: { width: 24, height: 24, channels: 3 } }).jpeg().toBuffer();

    // ── catalogue FABRIQUÉ (comme test-contrat-reel.js)
    const ID_A = 895789, ID_B = 895790, EXP = 990001;
    for (const c of ['catalogue_produits', 'numeros_cartes', 'guide_prix', 'codes_set']) await raw(c).deleteMany({});
    await raw('codes_set').insertOne({ idExpansion: EXP, codeSet: 'PBL', apprisLe: new Date() });
    const VB = require('./_visuels-banc'); const VIS = [];
    for (const [id, variante, trend] of [[ID_A, 'normale', 1180], [ID_B, 'reverse', 1.0]]) {
        await raw('catalogue_produits').insertOne({ idProduct: id, name: 'Tropius (PBL 001)', idExpansion: EXP, idMetacard: 990101 });
        await raw('numeros_cartes').insertOne({ idProduct: id, idExpansion: EXP, numero: '001', numeroUrl: 'PBL001', codeSet: 'PBL', nomFr: 'Tropius', slug: 'Tropius-PBL001', slugSet: 'Banc-Set', source: 'cardmarket', certitude: 'exacte', ...(id === ID_B ? { variante: 'V2' } : {}) });
        await raw('guide_prix').insertOne({ idProduct: id, avg: trend, low: 0.5, trend, avg1: trend, avg7: trend, avg30: trend, guideDu: new Date('2026-10-04') });
        VIS.push(VB.doc(id, { variante }));
    }
    VB.installer(VIS);                                                  // les visuels vivent EN MÉMOIRE (v2/chargeur), plus dans une collection

    // ── porteurs
    async function inst(essais = 3, o = {}) {
        const jeton = secret(J.genererJeton(), 'jeton d\'installation'); const i = Object.assign(M.nouvelleInstallation({ jetonEmpreinte: J.empreinte(jeton), essais, libelle: 'banc' }), o);
        await raw('installations').insertOne(i); return { i, jeton };
    }
    async function compte(o = {}) {
        const adresse = mail();
        const c = Object.assign(M.nouveauCompte({ email: adresse, emailCle: adresse, motDePasse: {} }), { verifie: true, solde: { accueil: 25, achete: 0 } }, o);
        await raw('comptes').insertOne(c);
        const s = await require('../comptes/sessions').creerSession(c._id);
        secret(s.token, 'jeton de session');
        return { c, cookie: `rm_session=${s.token}` };
    }
    async function instLiee(c) { return inst(0, { compteId: c.c._id, lieeLe: new Date() }); }

    // ── le serveur : tous les lots, la chaîne héritée FABRIQUÉE (comme index.js : express.json() puis les lots, puis le gestionnaire d'erreurs FINAL)
    const pret = require('../pret'); const registre = require('../registre'); const { dansUnScan } = require('../../sources'); const { assembler, LOTS } = require('../index');
    const courrier = require('../comptes/courrier').creerCourrierMemoire();
    registre.fournir('courrier', courrier); registre.fournir('turnstile', { verifier: async () => true });
    let mode = 'affirmee';
    const affirme = id => ({ success: true, question: null, carte: { idProduct: id, nomProduit: 'Tropius', nom: 'Tropius', numero: '001', total: '064', setCode: 'PBL', rarete: null, langue: 'FR', ambigu: false },
        etat: { estimeIA: null, confianceIA: null, defautsVus: [], declareVendeur: null, declareCardmarket: null, retenu: null },
        candidats: [{ idProduct: id, nom: 'Tropius', numero: '001', set: 'Banc Set', prix: 1, photoUrl: null }], classement: [], guidePrix: {}, reverse: { attendue: false, motif: null, etat: 'aucun-motif', strategie: null }, codeLangue: 2 });
    const chaine = async (req, res) => {
        const sid = String(req.scanIdImpose);
        if (mode === 'affirmee') return res.json({ ...affirme(ID_A), scanId: sid });
        await req.credit.v2.poserQuestion(req, { scanId: req.scanIdImpose, raison: 'egalite-sans-enjeu', candidats: [ID_A, ID_B] });
        return res.json({ ...affirme(ID_A), scanId: sid, question: { etat: 'en-attente', delaiHeures: 24 }, carte: { ...affirme(ID_A).carte, ambigu: true },
            candidats: [ID_A, ID_B].map(id => ({ idProduct: id, nom: 'Tropius', numero: '001', set: 'Banc Set', prix: 1, photoUrl: null })) });
    };
    const retourLive = async (q, s) => s.json({ success: true });
    // COPIE du gestionnaire d'erreurs final d'index.js (l. 7147) : le corps d'erreur d'un 413 / d'un JSON illisible vient de LUI, pas des lots.
    const gestionnaireFinal = (err, req, res, next) => {
        if (res.headersSent) return next(err);
        const statut = Number.isInteger(err?.status) ? err.status : (Number.isInteger(err?.statusCode) ? err.statusCode : 500);
        if (statut >= 400 && statut < 500) return res.status(statut).json({ success: false, error: statut === 403 ? 'Origine non autorisée' : 'Requête illisible' });
        return res.status(500).json({ success: false, error: 'Erreur serveur interne' });
    };
    const monter = async (deps = {}, cfgApp = cfg) => {
        const app = express(); app.set('trust proxy', true);
        for (const l of LOTS) l.enTete(app, cfgApp);
        app.use(express.json()); app.use((q, s, n) => dansUnScan(n));
        pret.armer(M.verifierIndex);
        const routeur = assembler(LOTS, cfgApp, { jumeaux: () => ({ conclu: true, ids: [] }), gererIdentifier: chaine, gererRetourLive: retourLive, ...deps });
        app.use(routeur); app.use(gestionnaireFinal);
        const s = await H.serveur(app);
        return { ...s, routeur };
    };
    const sv = await monter();
    const V = sv.url;
    NOMS_COLLECTIONS = (await mongoose.connection.db.listCollections().toArray()).map(c => c.name).filter(n => !n.startsWith('system.') && n.length > 5);
    NOMS_COLLECTIONS.push('banc_lignes', 'sessions', 'comptes', 'hebdo');

    // ═══════════════ LES ROUTES MONTÉES, DÉRIVÉES DE router.stack ═══════════════
    const montees = [];
    for (const couche of sv.routeur.stack) if (couche.route) for (const m of Object.keys(couche.route.methods)) montees.push({ methode: m.toUpperCase(), chemin: couche.route.path, cle: `${m.toUpperCase()} ${couche.route.path}` });
    const ecritures = montees.filter(r => !['GET', 'HEAD', 'OPTIONS'].includes(r.methode));
    const lectures = montees.filter(r => ['GET', 'HEAD', 'OPTIONS'].includes(r.methode));
    console.log(`   routes montées : ${montees.length} (${ecritures.length} qui ÉCRIVENT : ${ecritures.map(r => r.cle).join(' ; ')} ; ${lectures.length} en lecture : ${lectures.map(r => r.cle).join(' ; ')})`);

    // ═══════════════ LES CIBLES : comment atteindre chaque route d'écriture, avec un corps VALIDE ═══════════════
    // auth : 'aucune' | 'bearer' (jeton d'installation) | 'site' (Origin + X-Rat-Market, sans session) | 'session' (cookie + Origin + X-Rat-Market).
    // base(acteur) : le corps valide ; nullables : les champs que le CONTRAT (openapi.v2.json) type `null` ; tolere : { champ: raison } — une acceptation (2xx) NOMMÉE, jamais silencieuse.
    // idem : la route lit Idempotency-Key.   multipart : la route lit un formulaire, pas du JSON.
    const IDENTIFIER_NULL = ['vintedEtat', 'vintedUrl', 'prixVinted'];
    const CIBLES = {
        // libelle / userIdHerite de type non-texte : 201, libellé par défaut, aucun héritage — comportement VOULU et pinglé par test-installations.js (« libellé non-texte » → « Navigateur ») ;
        // la valeur n'est jamais stockée ni interrogée telle quelle (nettoyerLibelle ; l'héritage n'est tenté que pour une chaîne). Les OBJETS d'opérateur sont, eux, refusés (400) par la garde de clés.
        'POST /api/installation': { auth: 'aucune', idemCle: true, base: () => ({ versionExtension: '2.0.0', libelle: 'Chrome · Windows', userIdHerite: 'ancien-user-abus-0001' }), nullables: [],
            tolere: {
                libelle: { variantes: ['tableau', 'nombre', 'null'], ecriture: true, raison: 'type non-texte → libellé par défaut « Navigateur » (voulu, test-installations.js) ; jamais stocké tel quel' },
                userIdHerite: { variantes: ['tableau', 'nombre', 'null'], ecriture: true, raison: 'type non-texte : l\'héritage n\'est tenté que pour une chaîne, la réponse dit heritage « inconnu » (null : « absent ») (installations/routes.js)' }
            } },
        'POST /api/compte/lier': { auth: 'bearer', idemCle: true, base: () => ({ code: 'ABC123' }), nullables: [] },
        'POST /api/compte/delier': { auth: 'bearer', base: () => ({}), nullables: [] },
        'POST /api/compte/inscription': { auth: 'site', base: () => ({ email: mail(), turnstile: 't' }), nullables: [] },   // D6 : l'inscription ne prend plus de mot de passe
        'POST /api/compte/connexion': { auth: 'site', base: () => ({ email: mail(), motDePasse: MDP }), nullables: [] },
        'POST /api/compte/deconnexion': { auth: 'site', base: () => ({}), nullables: [] },
        // 202 IDENTIQUE par construction (anti-énumération) : un e-mail de mauvais type n'est ni accepté ni refusé, il ne déclenche RIEN (aucune écriture, aucun courrier). Les objets d'opérateur, eux, sont refusés (400).
        'POST /api/compte/mot-de-passe-oublie': { auth: 'site', base: () => ({ email: mail() }), nullables: [],
            tolere: { email: { variantes: ['tableau', 'nombre', 'null'], ecriture: false, raison: '202 identique par construction (anti-énumération) : aucun traitement, aucune écriture' } } },
        'POST /api/compte/renvoyer-verification': { auth: 'site', base: () => ({ email: mail() }), nullables: [],
            tolere: { email: { variantes: ['tableau', 'nombre', 'null'], ecriture: false, raison: '202 identique par construction (anti-énumération) : aucun traitement, aucune écriture' } } },
        'POST /api/compte/reinitialiser': { auth: 'site', base: () => ({ jeton: 'j'.repeat(43), motDePasse: MDP }), nullables: [] },
        'POST /api/compte/verification': { auth: 'site', base: () => ({ jeton: 'j'.repeat(43), motDePasse: MDP }), nullables: [] },   // D6 : lien + mot de passe choisi au clic
        'POST /api/compte/code': { auth: 'session', base: () => ({}), nullables: [] },
        'DELETE /api/compte': { auth: 'session', base: () => ({ motDePasse: 'pas-le-bon-mot-de-passe', renonciation: false }), nullables: [] },
        'DELETE /api/compte/installations/:id': { auth: 'session', base: () => ({}), nullables: [], chemin: () => `/api/compte/installations/${crypto.randomBytes(16).toString('hex')}` },
        'POST /api/creer-recharge': { auth: 'bearer', base: () => ({ prix: 'x' }), nullables: [] },
        'POST /api/identifier': { auth: 'bearer', base: () => corpsId(), nullables: IDENTIFIER_NULL, idem: true, entetesPlus: () => ({ 'idempotency-key': cle() }),
            tolere: {
                langueInterface: { variantes: '*', ecriture: true, raison: 'contrat : « toute autre valeur rend l\'anglais » — le champ ne vaut que fr ou en côté serveur, jamais stocké tel quel' },
                title: { variantes: ['null'], ecriture: true, raison: 'null = champ absent (le serveur est plus tolérant que le contrat, qui type title « string »)' },
                description: { variantes: ['null'], ecriture: true, raison: 'null = champ absent (le serveur est plus tolérant que le contrat, qui type description « string »)' }
            } },
        'POST /api/identifier/reponse': { auth: 'bearer', base: () => ({ scanId: new mongoose.Types.ObjectId().toHexString(), choix: 'a' }), nullables: [], idem: true },
        'POST /api/retour-live': { auth: 'bearer', base: () => ({ scanId: new mongoose.Types.ObjectId().toHexString(), prixLive: 5 }), nullables: [], idem: true },
        'POST /api/solde': { auth: 'bearer', base: () => ({}), nullables: [] },
        'POST /api/banc/correction': { auth: 'bearer', base: () => ({ scanId: new mongoose.Types.ObjectId().toHexString(), idProduct: ID_A, consentementBanc: { version: cfg.banc.versionsTexte[0], le: new Date().toISOString(), jeton: 'jeton-de-banc-abcdefghij1234' } }), nullables: [] },
        'DELETE /api/banc/contributions': { auth: 'bearer', base: () => ({ jeton: 'jeton-de-banc-abcdefghij9999' }), nullables: [] },
        // ETIQUETAGE-A : réservée à l'administrateur (404 pour tout autre) — l'acteur est donc un compte ADMINISTRATEUR avec son installation liée, jamais une installation seule (elle ne verrait que des 404 : la validation ne serait jamais jouée)
        'POST /api/banc/etiquette': { auth: 'admin', base: () => ({ scanId: new mongoose.Types.ObjectId().toHexString(), verdict: 'corrige', idProduct: ID_A, rev: 1 }), nullables: [], idem: true },
        // PHOTO-EXTENSION (recadrage) : réservée à l'administrateur, corps BINAIRE (une image) et paramètres dans l'URL : aucun champ texte à injecter (la cellule (a) est « sans objet », dite) ; (b), (c), (f) sont refusées
        // par les gardes d'entrée communes avant la route ; (e) rejoue le scan de la victime avec un AUTRE administrateur (404)
        'POST /api/banc/photo': { auth: 'admin', base: () => ({}), nullables: [] },
        'POST /api/scanner/analyses': { auth: 'session', multipart: true, idem: true, base: () => ({ source: 'camera' }), nullables: [] },
        'POST /api/scanner/analyses/:id/reponse': { auth: 'session', base: () => ({ choix: 'a' }), nullables: [], idem: true, chemin: () => `/api/scanner/analyses/${new mongoose.Types.ObjectId().toHexString()}/reponse` },
        // lot COLLECTION : le corps est un booléen (aucun champ texte à injecter : la cellule (a) est « sans objet », dite) ; le compte de l'acteur est vérifié ; la clé et le slug sont ceux d'une fiche plausible
        'PUT /api/collection/sets/:slug/fiches/:cle': { auth: 'session', base: () => ({ possedee: true }), nullables: [], chemin: () => `/api/collection/sets/Banc-Set/fiches/${encodeURIComponent('895789|001')}` }
    };
    // les routes en LECTURE à paramètre de chemin : le banc les joue avec un paramètre ordinaire (un « :slug » littéral n'est pas un slug)
    const CHEMIN_LECTURE = { 'GET /api/collection/sets/:slug': '/api/collection/sets/Banc-Set' };
    const ecarts = [];                                     // tout ce que le banc reproche au serveur
    const ecart = (cible, charge, msg) => { ecarts.push(`${cible} [${charge}] ${msg}`); };
    const toleres = new Map();                             // acceptations NOMMÉES : clé -> nombre de variantes
    H.v('chaque route d\'écriture montée a une cible déclarée', ecritures.filter(r => !CIBLES[r.cle]).map(r => r.cle), []);
    H.v('chaque cible déclarée est une route montée (pas de cible périmée)', Object.keys(CIBLES).filter(k => !ecritures.some(r => r.cle === k)), []);

    // ── l'acteur d'une cible : un NEUF à chaque requête (un limiteur par compte ou par installation ne masque donc jamais la validation)
    async function acteur(cible) {
        if (cible.auth === 'bearer') { const x = await inst(3); return { x, entetes: extH(x.jeton) }; }
        if (cible.auth === 'admin') { const c = await compte({ role: 'administrateur' }); const x = await instLiee(c); return { c, x, entetes: extH(x.jeton) }; }
        if (cible.auth === 'session') { const c = await compte(); return { c, entetes: siteH(c.cookie) }; }
        if (cible.auth === 'site') return { entetes: siteH(null) };
        return { entetes: extH(null) };
    }
    function formulaire({ source = 'camera', image = JPEG, type = 'image/jpeg' } = {}) {
        const f = new FormData(); if (source !== null) f.append('source', source); if (image !== null) f.append('image', new Blob([image], { type }), 'photo.jpg'); return f;
    }
    async function envoyerFormulaire(chemin, entetes, form) { const r = await fetch(V + chemin, { method: 'POST', headers: entetes, body: form, redirect: 'manual' }); const texte = await r.text(); let json = null; try { json = JSON.parse(texte); } catch { /* */ } return { statut: r.status, entetes: Object.fromEntries(r.headers), texte, json }; }

    // les champs TEXTE d'un corps (chemins), un niveau d'objet et le premier élément d'un tableau de chaînes compris
    function champsTexte(corps) {
        const chemins = [];
        for (const [k, v] of Object.entries(corps)) {
            if (typeof v === 'string') chemins.push([k]);
            else if (Array.isArray(v) && typeof v[0] === 'string') { chemins.push([k]); chemins.push([k, 0]); }
            else if (v && typeof v === 'object') for (const [k2, v2] of Object.entries(v)) if (typeof v2 === 'string') chemins.push([k, k2]);
        }
        return chemins;
    }
    const poser = (corps, chemin, valeur) => { const c = JSON.parse(JSON.stringify(corps)); let o = c; for (const k of chemin.slice(0, -1)) o = o[k]; o[chemin[chemin.length - 1]] = valeur; return c; };
    const VARIANTES = [['{"$ne":""}', { $ne: '' }], ['{"$gt":""}', { $gt: '' }], ['{"$where":"1"}', { $where: '1' }], ['tableau', ['x']], ['nombre', 42], ['null', null]];

    // ── le verdict commun d'une réponse à une charge qui NE DOIT RIEN ÉCRIRE ni réussir
    // tolerance : { raison, ecriture } — une acceptation NOMMÉE. `ecriture: true` : la route écrit légitimement (un débit) ; sinon l'absence d'écriture reste exigée.
    // Un 200 dont le corps dit `success: false` (codes IMAGE et IA du contrat) est un REFUS métier, pas un succès ; le claim d'idempotence qu'il laisse (réponse rejouable) n'est pas une écriture.
    async function jugerRefus({ cible, charge, detail, reponse, avant, tolerance = null }) {
        const apres = await instantane();
        const etiquette = `${detail}`;
        const refusMetier = reponse.statut === 200 && reponse.json && reponse.json.success === false;
        if (reponse.statut >= 500) ecart(cible, charge, `${etiquette} : statut ${reponse.statut} (jamais 5xx)`);
        if (reponse.statut >= 200 && reponse.statut < 400 && !refusMetier) {
            if (tolerance) { const k = `${cible} [${charge}] ${etiquette.split(' = ')[0]} : ${tolerance.raison}`; toleres.set(k, (toleres.get(k) || 0) + 1); }
            else ecart(cible, charge, `${etiquette} : statut ${reponse.statut} (une charge d'injection ne doit jamais réussir)`);
        }
        const f = fuite(reponse.texte, reponse); if (f) ecart(cible, charge, `${etiquette} : le corps d'erreur contient ${f}`);
        const w = ecrits(avant, apres).filter(x => !(refusMetier && x.startsWith('idempotence ')));
        if (w.length && !(tolerance && tolerance.ecriture)) ecart(cible, charge, `${etiquette} : écriture en base (${w.join(', ')})`);
        if (!protoSain()) { ecart(cible, charge, `${etiquette} : Object.prototype a été modifié`); delete Object.prototype.x; delete Object.prototype.role; }
        return apres;
    }
    const cellules = [];                                   // { cible, charge, etat: 'jouee'|'sans-objet', n, raison }
    const cellule = (cible, charge, etat, n, raison = '') => cellules.push({ cible, charge, etat, n, raison });
    let envois = 0;

    // ═══════════════ (a) (b) (c) PAR ROUTE ═══════════════
    for (const r of ecritures) {
        const cible = CIBLES[r.cle]; if (!cible) continue;
        const chemin = () => (cible.chemin ? cible.chemin() : r.chemin);
        const entetesDe = (a) => ({ ...a.entetes, ...(cible.entetesPlus ? cible.entetesPlus() : {}) });
        // (a)
        if (cible.multipart) {
            let n = 0;
            for (const [nom, valeur] of [['{"$ne":""}', '{"$ne":""}'], ['{"$gt":""}', '{"$gt":""}'], ['{"$where":"1"}', '{"$where":"1"}'], ['tableau', '["camera"]'], ['nombre', '42'], ['vide', '']]) {
                const a = await acteur(cible); const avant = await instantane(); n++; envois++;
                const rep = await envoyerFormulaire(chemin(), { ...a.entetes }, formulaire({ source: valeur }));
                await jugerRefus({ cible: r.cle, charge: 'a', detail: `source = ${nom}`, reponse: rep, avant });
            }
            cellule(r.cle, 'a', 'jouee', n, 'champ multipart « source »');
        } else {
            const base = cible.base(); const champs = champsTexte(base); let n = 0;
            if (!champs.length) cellule(r.cle, 'a', 'sans-objet', 0, 'le corps n\'a aucun champ texte');
            else {
                for (const chp of champs) for (const [nom, valeur] of VARIANTES) {
                    const a = await acteur(cible); const avant = await instantane(); n++; envois++;
                    const champNom = chp.join('.');
                    const nullable = valeur === null && (cible.nullables || []).includes(chp[0]) && chp.length === 1;
                    const t = cible.tolere && cible.tolere[chp[0]];
                    const tolerance = nullable ? { raison: 'null admis par le contrat (type [..., null])', ecriture: true }
                        : (t && (t.variantes === '*' || t.variantes.includes(nom)) ? t : null);
                    const rep = await envoyer(V, { methode: r.methode, chemin: chemin(), entetes: entetesDe(a), corps: poser(cible.base(), chp, valeur) });
                    await jugerRefus({ cible: r.cle, charge: 'a', detail: `${champNom} = ${nom}`, reponse: rep, avant, tolerance });
                }
                cellule(r.cle, 'a', 'jouee', n, `${champs.length} champ(s) × ${VARIANTES.length}`);
            }
        }
        // (b) — la clause __proto__ / constructor, SEULE puis ajoutée à un corps valide. Envoyée en TEXTE BRUT : un littéral JS { "__proto__": … } changerait le prototype de l'objet au lieu de créer la clé.
        {
            let n = 0;
            const corpsBrut = cible.multipart ? null : JSON.stringify(cible.base());
            // I-1 (liste PERMISE) : un nom qui est une propriété d'Object.prototype, une clé pointée, 10 niveaux d'objets et plus de 5 000 nœuds sont refusés aussi.
            const variantes = [['clause __proto__ seule', POISON], ['clé « toString »', '{"toString":"x"}'], ['clé « hasOwnProperty »', '{"hasOwnProperty":1}'], ['clé pointée « a.b »', '{"a.b":1}'],
                ['10 niveaux d\'objets', `${'{"a":'.repeat(10)}1${'}'.repeat(10)}`], ['5 001 nœuds', `{"a":[${Array(5001).fill('{}').join(',')}]}`]];
            if (!cible.multipart) variantes.push(['clause __proto__ ajoutée à un corps valide', corpsBrut === '{}' ? POISON : `${corpsBrut.slice(0, -1)},${POISON.slice(1)}`]);
            for (const [nom, brut] of variantes) {
                const a = await acteur(cible); const avant = await instantane(); n++; envois++;
                const rep = await envoyer(V, { methode: r.methode, chemin: chemin(), entetes: entetesDe(a), brut, type: 'application/json' });
                await jugerRefus({ cible: r.cle, charge: 'b', detail: nom, reponse: rep, avant });
            }
            if (cible.multipart) {   // m5 : un champ multipart NOMMÉ __proto__ (ou constructor) n'entre nulle part
                for (const nom of ['__proto__', 'constructor']) {
                    const a = await acteur(cible); const avant = await instantane(); n++; envois++;
                    const f = formulaire(); f.append(nom, '{"role":"administrateur"}');
                    const rep = await envoyerFormulaire(chemin(), { ...a.entetes }, f);
                    await jugerRefus({ cible: r.cle, charge: 'b', detail: `champ multipart nommé « ${nom} »`, reponse: rep, avant });
                }
            }
            cellule(r.cle, 'b', 'jouee', n);
        }
        // (f) la REQUÊTE : la requête est valide par ailleurs, seule la chaîne de requête est hostile (objet imbriqué, prototype, nom hérité)
        {
            let n = 0;
            for (const qs of ['?a[$ne]=1', '?constructor[prototype][x]=1', '?a=1&a[b]=2', '?toString=1']) {
                const a = await acteur(cible); const avant = await instantane(); n++; envois++;
                const rep = cible.multipart ? await envoyerFormulaire(chemin() + qs, { ...a.entetes }, formulaire())
                    : await envoyer(V, { methode: r.methode, chemin: chemin() + qs, entetes: entetesDe(a), corps: cible.base() });
                await jugerRefus({ cible: r.cle, charge: 'f', detail: `requête ${qs}`, reponse: rep, avant });
            }
            cellule(r.cle, 'f', 'jouee', n);
        }
        // (c) — 5 Mo
        {
            let n = 0;
            const gros = `{"x":"${'a'.repeat(5 * 1024 * 1024)}"}`;
            const a = await acteur(cible); const avant = await instantane(); n++; envois++;
            const rep = await envoyer(V, { methode: r.methode, chemin: chemin(), entetes: entetesDe(a), brut: gros, type: 'application/json' });
            await jugerRefus({ cible: r.cle, charge: 'c', detail: 'corps JSON de 5 Mo', reponse: rep.statut === 0 ? { ...rep, statut: 499 } : rep, avant });
            if (cible.multipart) {
                const a2 = await acteur(cible); const av2 = await instantane(); n++; envois++;
                const rep2 = await envoyerFormulaire(chemin(), { ...a2.entetes }, formulaire({ image: Buffer.alloc(5 * 1024 * 1024, 7) }));
                await jugerRefus({ cible: r.cle, charge: 'c', detail: 'formulaire dont l\'image fait 5 Mo d\'octets quelconques', reponse: rep2, avant: av2 });
            }
            cellule(r.cle, 'c', 'jouee', n);
        }
    }

    // ═══════════════ (d) (e) : les ressources d'AUTRUI ═══════════════
    // A est la victime : une installation avec un scan à question, un compte avec session, un code de liaison utilisé, une ligne du banc, un journal.
    mode = 'ambigue2';
    const A = await inst(3);
    const ra = await envoyer(V, { methode: 'POST', chemin: '/api/identifier', entetes: extH(A.jeton, { 'idempotency-key': cle() }), corps: corpsId() });
    const scanA = ra.json && ra.json.scanId;
    H.vrai('(d)(e) contrôle de l\'instrument : la victime A a un scan à question', Boolean(scanA && ra.json.analyse && ra.json.analyse.cartes[0].question));
    mode = 'affirmee';
    await raw('journal_scans').insertOne({ _id: new mongoose.Types.ObjectId(scanA), userId: `v2:installation:${A.i._id}`, prixLive: null, idProduct: ID_A });
    const CA = await compte(); const CAinst = await instLiee(CA);
    const prepCoche = await envoyer(V, { methode: 'PUT', chemin: `/api/collection/sets/Banc-Set/fiches/${encodeURIComponent('895789|001')}`, entetes: siteH(CA.cookie), corps: { possedee: true } });   // la victime coche une fiche
    H.v('(e) contrôle de l\'instrument : la préparation (la victime coche une fiche) a réussi — une préparation qui échoue en silence fausserait la comparaison d\'état plus bas', prepCoche.statut, 200);
    const jetonBancA = 'jeton-banc-victime-abcdefghij12'; secret(jetonBancA, 'jeton de consentement');
    await raw('banc_lignes').insertOne({ _id: 'ligne-victime', cleR2: 'banc/final/x.webp', etat: 'confirmee', jetonEmpreinte: crypto.createHash('sha256').update(jetonBancA).digest('hex'), le: new Date(), expireLe: new Date(Date.now() + 86400e3), source: 'affirme', verite: ID_A });
    const codeA = (await envoyer(V, { methode: 'POST', chemin: '/api/compte/code', entetes: siteH(CA.cookie), corps: {} })).json;
    secret(codeA && codeA.code, 'code de liaison');
    const liaisonA = await envoyer(V, { methode: 'POST', chemin: '/api/compte/lier', entetes: extH((await inst(3)).jeton), corps: { code: codeA.code } });   // le code de A est CONSOMMÉ par une autre installation (usage normal)
    H.v('(e) contrôle de l\'instrument : le code de la victime est consommé par sa propre installation', liaisonA.statut, 200);
    mode = 'ambigue2';
    const sa = await envoyerFormulaire('/api/scanner/analyses', siteH(CA.cookie), formulaire());
    mode = 'affirmee';
    const scanSA = sa.json && sa.json.scanId;
    H.vrai('(d)(e) contrôle de l\'instrument : la victime A a un scan de scanner à question', Boolean(scanSA));
    await raw('credits').insertOne({ userId: 'ancien-user-victime-0001', soldeGratuit: 2, soldeScans: 0 });
    const heritageA = await envoyer(V, { methode: 'POST', chemin: '/api/installation', entetes: extH(null), corps: { versionExtension: '2.0.0', libelle: 'victime', userIdHerite: 'ancien-user-victime-0001' } });
    const etatA = async () => ({
        question: await raw('questions_v2').findOne({ _id: `${scanA}:0` }), analyse: await raw('analyses').findOne({ _id: new mongoose.Types.ObjectId(scanA) }),
        journal: await raw('journal_scans').findOne({ _id: new mongoose.Types.ObjectId(scanA) }), ligne: await raw('banc_lignes').countDocuments({ _id: 'ligne-victime' }),
        installationCompte: await raw('installations').findOne({ _id: CAinst.i._id }),
        collection: await raw('collection_fiches').find({ compteId: CA.c._id }).toArray()
    });
    const avantA = JSON.stringify(await etatA());
    H.v('(e) contrôle de l\'instrument — la collection de la victime A existe (une clé cochée par elle)', [(await raw('collection_fiches').find({ compteId: CA.c._id }).toArray()).map(d => d.hors)], [[['895789|001']]]);

    const nonRejoue = (rep) => !rep.entetes['idempotency-replayed'];
    for (const r of ecritures) {
        const cible = CIBLES[r.cle]; if (!cible) continue;
        // ── (d) Idempotency-Key d'un AUTRE porteur : A joue une requête avec K ; B joue la même avec K ; B ne reçoit JAMAIS la réponse de A
        if (cible.idemCle) {
            // LOT IDEMPOTENCE-INSTALLATION : deux routes dont la réponse PORTE UN JETON honorent une clé facultative. Elles ne se jouent pas comme les autres : la réponse est un 201 (installation) ou un
            // 200 (liaison) qui contient le jeton de A. Ce que B ne doit JAMAIS recevoir : ce jeton. Installation : aucun porteur, la clé (aléatoire) est la capacité — B avec la même clé mais un AUTRE corps
            // est refusé (422) et ne voit rien ; liaison : le claim vit sous l'installation, B (une autre installation) exécute pour de bon.
            const K = r.cle === 'POST /api/installation' ? `${cle()}-`.padEnd(40, 'k') : cle(); let repA, repB;      // la clé de /api/installation tient lieu de secret : 32 caractères au moins
            if (r.cle === 'POST /api/installation') {
                repA = await envoyer(V, { methode: 'POST', chemin: r.chemin, entetes: extH(null, { 'idempotency-key': K }), corps: { versionExtension: '2.0.0', libelle: 'idem-A' } });
                repB = await envoyer(V, { methode: 'POST', chemin: r.chemin, entetes: extH(null, { 'idempotency-key': K }), corps: { versionExtension: '2.0.0', libelle: 'idem-B' } });
                if (repB.statut !== 422) ecart(r.cle, 'd', `B (même clé, autre corps) devait être refusée en 422 (statut ${repB.statut})`);
            } else {
                const a = await inst(0), b = await inst(0), CX = await compte();
                const codeX = (await envoyer(V, { methode: 'POST', chemin: '/api/compte/code', entetes: siteH(CX.cookie), corps: {} })).json;
                repA = await envoyer(V, { methode: 'POST', chemin: r.chemin, entetes: extH(a.jeton, { 'idempotency-key': K }), corps: { code: codeX && codeX.code } });
                repB = await envoyer(V, { methode: 'POST', chemin: r.chemin, entetes: extH(b.jeton, { 'idempotency-key': K }), corps: { code: 'ZZZZZZ' } });
                if (repB.statut !== 404) ecart(r.cle, 'd', `B (une autre installation, même clé) doit exécuter pour de bon : code inconnu 404 (statut ${repB.statut})`);
            }
            const attenduA = r.cle === 'POST /api/installation' ? 201 : 200, jetonA = repA.json && repA.json.jetonInstallation;
            if (!(repA && repA.statut === attenduA && jetonA)) ecart(r.cle, 'd', `contrôle de l'instrument : la requête de A avec la clé devait réussir et rendre un jeton (statut ${repA && repA.statut})`);
            if (!nonRejoue(repB)) ecart(r.cle, 'd', 'B a reçu un REJEU (Idempotency-Replayed) de la réponse de A');
            if (jetonA && repB.texte.includes(jetonA)) ecart(r.cle, 'd', 'la réponse de B contient le jeton de A');
            cellule(r.cle, 'd', 'jouee', 2, `A puis B, même clé (${repB.statut}) : B ne reçoit jamais le jeton de A`);
        } else if (cible.idem) {
            const K = cle(); let repA, repB, ciblesA = null;
            if (r.cle === 'POST /api/identifier') {
                const a = await inst(3), b = await inst(3);
                repA = await envoyer(V, { methode: 'POST', chemin: '/api/identifier', entetes: extH(a.jeton, { 'idempotency-key': K }), corps: corpsId() });
                repB = await envoyer(V, { methode: 'POST', chemin: '/api/identifier', entetes: extH(b.jeton, { 'idempotency-key': K }), corps: corpsId() });
                ciblesA = repA.json && repA.json.scanId;
            } else if (r.cle === 'POST /api/identifier/reponse') {
                mode = 'ambigue2'; const a = await inst(3);
                const sc = await envoyer(V, { methode: 'POST', chemin: '/api/identifier', entetes: extH(a.jeton, { 'idempotency-key': cle() }), corps: corpsId() }); mode = 'affirmee';
                const corps = { scanId: sc.json.scanId, choix: 'a' };
                repA = await envoyer(V, { methode: 'POST', chemin: r.chemin, entetes: extH(a.jeton, { 'idempotency-key': K }), corps });
                repB = await envoyer(V, { methode: 'POST', chemin: r.chemin, entetes: extH((await inst(3)).jeton, { 'idempotency-key': K }), corps });
                ciblesA = sc.json.scanId;
            } else if (r.cle === 'POST /api/retour-live') {
                mode = 'ambigue2'; const a = await inst(3);
                const sc = await envoyer(V, { methode: 'POST', chemin: '/api/identifier', entetes: extH(a.jeton, { 'idempotency-key': cle() }), corps: corpsId() }); mode = 'affirmee';
                await raw('journal_scans').insertOne({ _id: new mongoose.Types.ObjectId(sc.json.scanId), userId: `v2:installation:${a.i._id}`, prixLive: null, idProduct: ID_A });
                const corps = { scanId: sc.json.scanId, prixLive: 5 };
                repA = await envoyer(V, { methode: 'POST', chemin: r.chemin, entetes: extH(a.jeton, { 'idempotency-key': K }), corps });
                repB = await envoyer(V, { methode: 'POST', chemin: r.chemin, entetes: extH((await inst(3)).jeton, { 'idempotency-key': K }), corps });
                ciblesA = sc.json.scanId;
            } else if (r.cle === 'POST /api/banc/etiquette') {
                // deux administrateurs, chacun sur SON scan ; la même clé : B ne reçoit jamais la réponse de A
                const semer = async ad => { const id = new mongoose.Types.ObjectId(); await raw('analyses').insertOne({ _id: id, porteur: `compte:${ad.c.c._id}`, surface: 'extension', statut: 'identifiee', cartes: [{ idProduct: ID_A, statut: 'identifiee' }], produits: [], facturation: null, creeLe: new Date(), expireLe: new Date(Date.now() + 86400e3) }); return String(id); };
                const a = await acteur(cible), b = await acteur(cible);
                const sa = await semer(a), sb = await semer(b);
                repA = await envoyer(V, { methode: 'POST', chemin: r.chemin, entetes: { ...a.entetes, 'idempotency-key': K }, corps: { scanId: sa, verdict: 'juste', rev: 1 } });
                repB = await envoyer(V, { methode: 'POST', chemin: r.chemin, entetes: { ...b.entetes, 'idempotency-key': K }, corps: { scanId: sb, verdict: 'juste', rev: 2 } });   // rev 2 : un corps différent, donc une réponse différente (l'octet pour octet de A serait un rejeu)
                ciblesA = sa;
            } else if (r.cle === 'POST /api/scanner/analyses') {
                const a = await compte(), b = await compte();
                repA = await envoyerFormulaire(r.chemin, siteH(a.cookie, { 'idempotency-key': K }), formulaire());
                repB = await envoyerFormulaire(r.chemin, siteH(b.cookie, { 'idempotency-key': K }), formulaire());
                ciblesA = repA.json && repA.json.scanId;
            } else if (r.cle === 'POST /api/scanner/analyses/:id/reponse') {
                mode = 'ambigue2'; const a = await compte(), b = await compte();
                const sc = await envoyerFormulaire('/api/scanner/analyses', siteH(a.cookie), formulaire()); mode = 'affirmee';
                const ch = `/api/scanner/analyses/${sc.json.scanId}/reponse`;
                repA = await envoyer(V, { methode: 'POST', chemin: ch, entetes: siteH(a.cookie, { 'idempotency-key': K }), corps: { choix: 'a' } });
                repB = await envoyer(V, { methode: 'POST', chemin: ch, entetes: siteH(b.cookie, { 'idempotency-key': K }), corps: { choix: 'a' } });
                ciblesA = sc.json.scanId;
            }
            if (!(repA && repA.statut === 200)) ecart(r.cle, 'd', `contrôle de l'instrument : la requête de A avec la clé devait réussir (statut ${repA && repA.statut})`);
            if (repB.statut >= 500) ecart(r.cle, 'd', `B : statut ${repB.statut}`);
            if (!nonRejoue(repB)) ecart(r.cle, 'd', 'B a reçu un REJEU (Idempotency-Replayed) de la réponse de A');
            if (ciblesA && repB.texte.includes(String(ciblesA))) ecart(r.cle, 'd', 'la réponse de B contient l\'identifiant du scan de A');
            if (repA && repA.statut === 200 && repB.texte === repA.texte) ecart(r.cle, 'd', 'la réponse de B est octet pour octet celle de A');
            cellule(r.cle, 'd', 'jouee', 2, `A puis B, même clé (${repB.statut})`);
        } else {
            // la route ne lit pas Idempotency-Key : l'envoyer ne doit RIEN faire (aucun claim, aucun rejeu)
            const a = await acteur(cible); const avant = await instantane(); envois++;
            const rep = await envoyer(V, { methode: r.methode, chemin: cible.chemin ? cible.chemin() : r.chemin, entetes: { ...a.entetes, 'idempotency-key': cle() }, corps: cible.base() });
            const apres = await instantane();
            if (rep.statut >= 500) ecart(r.cle, 'd', `statut ${rep.statut}`);
            if (!nonRejoue(rep)) ecart(r.cle, 'd', 'un rejeu est annoncé sur une route sans idempotence');
            if ((avant.idempotence || 0) !== (apres.idempotence || 0)) ecart(r.cle, 'd', 'un claim d\'idempotence est resté en base sur une route qui ne lit pas la clé');
            cellule(r.cle, 'd', 'jouee', 1, 'la route ignore la clé : aucun claim, aucun rejeu');
        }
        // ── (e) l'id d'une ressource d'un AUTRE porteur : 404 / 401, jamais ses données, et la ressource de A est INTACTE
        let rep = null, attendu = null, raison = null;
        const B = await inst(3), CB = await compte();
        if (r.cle === 'POST /api/identifier/reponse') { rep = await envoyer(V, { methode: 'POST', chemin: r.chemin, entetes: extH(B.jeton), corps: { scanId: scanA, choix: 'a' } }); attendu = [404]; }
        else if (r.cle === 'POST /api/retour-live') { rep = await envoyer(V, { methode: 'POST', chemin: r.chemin, entetes: extH(B.jeton), corps: { scanId: scanA, prixLive: 5 } }); attendu = [404]; }
        else if (r.cle === 'POST /api/banc/correction') { rep = await envoyer(V, { methode: 'POST', chemin: r.chemin, entetes: extH(B.jeton), corps: { scanId: scanA, idProduct: ID_A } }); attendu = [404]; }
        else if (r.cle === 'POST /api/banc/etiquette') { const ad = await acteur(cible); rep = await envoyer(V, { methode: 'POST', chemin: r.chemin, entetes: ad.entetes, corps: { scanId: scanA, verdict: 'corrige', idProduct: ID_B, rev: 1 } }); attendu = [404]; }   // un AUTRE administrateur, le scan de la victime A
        else if (r.cle === 'POST /api/banc/photo') { const ad = await acteur(cible); rep = await envoyer(V, { methode: 'POST', chemin: `${r.chemin}?scanId=${scanA}`, entetes: ad.entetes, brut: JPEG, type: 'image/jpeg' }); attendu = [404]; }   // un AUTRE administrateur, le scan de la victime A
        else if (r.cle === 'DELETE /api/banc/contributions') { rep = await envoyer(V, { methode: 'DELETE', chemin: r.chemin, entetes: extH(B.jeton), corps: { jeton: 'jeton-banc-autrui-abcdefghij34' } }); attendu = [200]; }
        else if (r.cle === 'DELETE /api/compte/installations/:id') { rep = await envoyer(V, { methode: 'DELETE', chemin: `/api/compte/installations/${CAinst.i._id}`, entetes: siteH(CB.cookie) }); attendu = [404]; }
        else if (r.cle === 'PUT /api/collection/sets/:slug/fiches/:cle') {
            // B « décoche » la clé de A dans le MÊME set : 200, mais sur SA collection (0 fiche) — la clé de A est invisible et ne se modifie pas (état de A comparé plus bas)
            rep = await envoyer(V, { methode: 'PUT', chemin: cible.chemin(), entetes: siteH(CB.cookie), corps: { possedee: false } }); attendu = [200];
            const lu = await envoyer(V, { methode: 'GET', chemin: '/api/collection/sets/Banc-Set', entetes: siteH(CB.cookie) });
            if (rep.json && rep.json.possedees !== 0) ecart(r.cle, 'e', `B voit ${rep.json.possedees} fiche(s) cochée(s) dans le set de A`);
            if (!lu.json || lu.json.possedees.length) ecart(r.cle, 'e', 'la lecture de B montre une clé de A');
        }
        else if (r.cle === 'POST /api/scanner/analyses/:id/reponse') { rep = await envoyer(V, { methode: 'POST', chemin: `/api/scanner/analyses/${scanSA}/reponse`, entetes: siteH(CB.cookie), corps: { choix: 'a' } }); attendu = [404]; }
        else if (r.cle === 'POST /api/compte/lier') { rep = await envoyer(V, { methode: 'POST', chemin: r.chemin, entetes: extH(B.jeton), corps: { code: codeA.code } }); attendu = [404, 410]; }
        else if (r.cle === 'POST /api/installation') {
            rep = await envoyer(V, { methode: 'POST', chemin: r.chemin, entetes: extH(null), corps: { versionExtension: '2.0.0', libelle: 'intrus', userIdHerite: 'ancien-user-victime-0001' } }); attendu = [201];
            const e = rep.json && rep.json.solde && JSON.stringify(rep.json.solde), eA = heritageA.json && heritageA.json.solde && JSON.stringify(heritageA.json.solde);
            if (rep.statut === 201 && JSON.stringify(rep.json.solde) === eA && /"essais":2/.test(eA || '') && /"essais":2/.test(e || '')) ecart(r.cle, 'e', 'l\'intrus a repris l\'héritage déjà migré par la victime');
        } else raison = {
            'POST /api/identifier': 'aucune ressource d\'autrui dans le corps (imageUrls est une URL publique d\'un hôte autorisé)',
            'POST /api/solde': 'aucun identifiant dans le corps : le solde est celui du jeton présenté',
            'POST /api/compte/delier': 'aucun identifiant : l\'installation est celle du jeton',
            'POST /api/compte/code': 'aucun identifiant : le compte est celui de la session',
            'DELETE /api/compte': 'aucun identifiant : le compte est celui de la session',
            'POST /api/creer-recharge': 'route héritée (aucun porteur v2 : l\'aiguilleur la laisse à l\'ancien serveur)',
            'POST /api/scanner/analyses': 'aucun identifiant dans le corps (une image)'
        }[r.cle] || 'le corps ne désigne aucune ressource (adresse ou lien à usage unique : un secret du porteur)';
        if (rep) {
            if (rep.statut >= 500) ecart(r.cle, 'e', `statut ${rep.statut}`);
            if (!attendu.includes(rep.statut)) ecart(r.cle, 'e', `statut ${rep.statut}, attendu ${attendu.join(' ou ')} (jamais les données d'autrui)`);
            if (rep.statut !== 0 && (rep.texte.includes(String(scanA)) && r.cle !== 'POST /api/banc/correction' && false)) ecart(r.cle, 'e', 'la réponse reprend l\'identifiant d\'autrui');
            const f = fuite(rep.texte, rep); if (f) ecart(r.cle, 'e', `le corps contient ${f}`);
            if (rep.json && rep.json.success === true && rep.json.carte) ecart(r.cle, 'e', 'une carte de la victime a été servie');
            cellule(r.cle, 'e', 'jouee', 1, `statut ${rep.statut}`);
        } else cellule(r.cle, 'e', 'sans-objet', 0, raison);
    }
    H.v('(e) toutes les ressources de la victime sont INTACTES après les charges d\'autrui', JSON.stringify(await etatA()) === avantA, true);

    // ── bilan des cinq charges
    const nJouees = cellules.filter(c => c.etat === 'jouee').length, nSans = cellules.filter(c => c.etat === 'sans-objet').length;
    console.log(`   ${ecritures.length} routes × 6 charges (a-e, plus f = la requête) = ${ecritures.length * 6} cellules : ${nJouees} jouées, ${nSans} sans objet ; ${envois} envois d'injection (a-c, f) + les envois de (d)(e)`);
    for (const c of cellules.filter(c => c.etat === 'sans-objet')) console.log(`   sans objet : ${c.cible} [${c.charge}] — ${c.raison}`);
    H.v('toute cellule est jouée ou déclarée sans objet AVEC sa raison', cellules.length === ecritures.length * 6 && cellules.every(c => c.etat === 'jouee' || c.raison), true);
    // la route en LECTURE (GET /api/compte) : sa chaîne de requête passe la même garde
    for (const r of lectures) {
        const c = await compte(); let bons = 0, n = 0; const ch = CHEMIN_LECTURE[r.cle] || r.chemin;
        for (const qs of ['?a[$ne]=1', '?constructor[prototype][x]=1', '?suite[$ne]=x']) { n++; const rep = await envoyer(V, { methode: r.methode, chemin: ch + qs, entetes: siteH(c.cookie) }); if (rep.statut === 400) bons++; }
        const ok = await envoyer(V, { methode: r.methode, chemin: ch, entetes: siteH(c.cookie) });
        H.v(`(f) ${r.cle} : ${n} requêtes hostiles → 400, la requête ordinaire → 200`, [bons, ok.statut], [n, 200]);
    }
    for (const [t, n] of toleres) console.log(`   toléré (${n} variante(s)) : ${t}`);
    // les acceptations tolérées n'ont rien stocké d'opérateur : aucun document ne porte une clé $ne / $gt / $where
    {
        let operateurs = [];
        for (const n of (await mongoose.connection.db.listCollections().toArray()).map(c => c.name).filter(n => !n.startsWith('system.'))) {
            for (const d of await raw(n).find({}).toArray()) { const t = JSON.stringify(d); if (/"\$(ne|gt|where)"/.test(t)) operateurs.push(n); }
        }
        H.v('aucun document ne porte un opérateur Mongo ($ne, $gt, $where) venu d\'un corps', [...new Set(operateurs)], []);
    }
    H.v('Object.prototype est intact après toutes les charges', protoSain(), true);
    H.v('step 1 : aucun écart (a)-(f) — la liste est imprimée ci-dessous', ecarts.length, 0);
    // ── I-1 : la garde est une LISTE PERMISE ; sa forme est confrontée à TOUTES les clés de requête légitimes (dénominateur imprimé), et ses bornes sont éprouvées à la limite
    {
        const { cleInterdite, requeteRefusee, parametresRefuses } = require('../index'); const fs = require('fs');
        const A2 = require('./_contrat-reel-aide');
        const legit = new Map();                                                                    // clé -> d'où elle vient
        const noter = (k, d) => { if (!legit.has(k)) legit.set(k, d); };
        const sch = (s, d) => { if (!s || typeof s !== 'object') return; for (const [k, v] of Object.entries(s.properties || {})) { noter(k, d); sch(v, d); } if (s.items) sch(s.items, d); for (const x of s.oneOf || []) sch(x, d); };
        let nSchemas = 0; for (const [n, s] of Object.entries(A2.SCHEMA.components.schemas)) if (/^Requete/.test(n)) { sch(s, 'openapi'); nSchemas++; }
        for (const k of require('../identifier/retour-live').CHAMPS_PRIX) noter(k, 'retour-live');
        for (const ops of Object.values(A2.SCHEMA.paths)) for (const op of Object.values(ops)) for (const p of op.parameters || []) if (p.in === 'query') noter(p.name, 'openapi (paramètre de requête)');
        const refusees = [...legit.keys()].filter(k => cleInterdite({ [k]: 1 }) !== null || requeteRefusee({ [k]: 'v' }) !== null);
        H.v(`I-1 : ${legit.size} clés de requête légitimes examinées (${nSchemas} schémas Requete* de openapi.v2.json + CHAMPS_PRIX + paramètres de requête), ${legit.size - refusees.length} acceptées (corps ET requête)`, refusees, []);
        // les vecteurs de l'extension (lecture seule) : ce sont des RÉPONSES du faux serveur ; leurs clés sont dites, pas jugées
        const dirExt = 'C:\\Users\\Yung\\Desktop\\extension v2\\src\\fond\\fausses';
        if (fs.existsSync(dirExt)) {
            const cles = new Set(); const marcher = v => { if (Array.isArray(v)) v.forEach(marcher); else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { cles.add(k); marcher(x); } };
            for (const f of fs.readdirSync(dirExt)) if (f.endsWith('.json')) marcher(JSON.parse(fs.readFileSync(path.join(dirExt, f), 'utf8')));
            const hors = [...cles].filter(k => cleInterdite({ [k]: 1 }) !== null);
            console.log(`   vecteurs de l'extension (${fs.readdirSync(dirExt).filter(f => f.endsWith('.json')).length} fichiers JSON, RÉPONSES du faux serveur) : ${cles.size} clés distinctes, ${hors.length} hors de la forme permise (identifiants de produit, « ne-sait-pas », « _lisez-moi » : des clés de réponse, qu'une requête ne porte pas)`);
            H.v('I-1 : les clés des vecteurs refusées par la forme sont des identifiants de produit, « ne-sait-pas », « _lisez-moi », des clés de scénario : aucun nom de champ d\'une requête', hors.filter(k => !/^(\d+|_lisez-moi|ne-sait-pas|fausse-[a-z]+-\d+)$/.test(k)), []);
        } else console.log('   vecteurs de l\'extension absents de cette machine : étape non jouée');
        const interdites = ['toString', 'hasOwnProperty', 'valueOf', 'isPrototypeOf', 'constructor', '__proto__', '__defineGetter__', '__lookupSetter__', 'a.b', 'a$ne', '$ne', ' $ne', '$where', '1a', 'a b', '', 'a-b', 'é'];
        H.v('I-1 : ces clés sont REFUSÉES (noms hérités d\'Object.prototype, pointée, en $, espace, chiffre initial, vide, tiret, accent)', interdites.filter(k => cleInterdite({ [k]: 1 }) === null), []);
        const profond = n => { let o = 1; for (let i = 0; i < n; i++) o = { a: o }; return o; };
        const noeuds = n => ({ a: Array.from({ length: n }, () => ({})) });
        H.v('m1 : 9 niveaux d\'objets passent, 10 sont refusés ; 5 000 nœuds passent, 5 001 sont refusés (la borne dit « 9 niveaux », la limite réelle)', [cleInterdite(profond(9)), cleInterdite(profond(10)) !== null, cleInterdite(noeuds(4998)), cleInterdite(noeuds(4999)) !== null], [null, true, null, true]);
        H.v('I-1 : les tableaux sont parcourus à toute profondeur', [cleInterdite([{ a: [{ $ne: 1 }] }]) !== null, cleInterdite({ a: [[{ toString: 1 }]] }) !== null, cleInterdite({ a: [1, 'x', null, [2]] })], [true, true, null]);
        H.v('I-1 : la requête n\'admet ni objet imbriqué ni nom hérité ; chaîne et liste de chaînes seulement', [requeteRefusee({ a: '1' }), requeteRefusee({ suite: ['a', 'b'] }), requeteRefusee({ a: { $ne: '1' } }) !== null, requeteRefusee({ constructor: 'x' }) !== null, requeteRefusee({ 'a.b': '1' }) !== null, requeteRefusee({ a: [{}] }) !== null], [null, null, true, true, true, true]);
        H.v('I-1 : chaque paramètre de chemin est une chaîne', [parametresRefuses({ id: 'x' }), parametresRefuses({ id: {} }) !== null, parametresRefuses({ id: ['a'] }) !== null, parametresRefuses({}), parametresRefuses(undefined)], [null, true, true, null, null]);
        // le CÂBLAGE de la garde des paramètres (Express ne rend que des chaînes : un aiguilleur de lot fabriqué, qui passe AVANT la garde, y glisse un objet — le mutant « paramètres non gardés » doit tomber)
        {
            const { assembler: assembler2, aiguilleur: aiguilleur2 } = require('../index');
            const lotFab = { enTete() { }, routes(r) {
                r.post('/api/zz/:id', aiguilleur2(q => { q.params.id = { $ne: 1 }; return true; }), (q, s) => s.json({ ok: true }));
                r.post('/api/zz/:id/temoin', aiguilleur2(() => true), (q, s) => s.json({ ok: true }));
            } };
            const app = express(); app.use(express.json()); pret.armer(M.verifierIndex); app.use(assembler2([lotFab], cfg, {}));
            const s2 = await H.serveur(app);
            const mauvais = await envoyer(s2.url, { methode: 'POST', chemin: '/api/zz/abc', corps: {} }), bon = await envoyer(s2.url, { methode: 'POST', chemin: '/api/zz/abc/temoin', corps: {} });
            await s2.fermer(); pret.armer(M.verifierIndex);
            H.v('I-1 : un paramètre de chemin qui n\'est pas une chaîne est refusé (400 ENTREE « parametre »), le témoin à paramètre ordinaire passe', [mauvais.statut, mauvais.json && mauvais.json.erreur && mauvais.json.erreur.detail, bon.statut], [400, 'parametre', 200]);
        }
    }

    // ═══════════════ STEP 2 : le temps et l'énumération ═══════════════
    {
        const P = require('../comptes/mots-de-passe'); const hash = await P.hacher(MDP);
        const connus = [];
        for (let i = 0; i < 20; i++) { const adresse = mail(); await raw('comptes').insertOne(Object.assign(M.nouveauCompte({ email: adresse, emailCle: adresse, motDePasse: hash }), { verifie: true })); connus.push(adresse); }
        const t = { inconnue: [], faux: [] };
        await envoyer(V, { methode: 'POST', chemin: '/api/compte/connexion', entetes: siteH(null), corps: { email: mail(), motDePasse: MDP } });   // échauffement
        for (let i = 0; i < 20; i++) {
            const r1 = await envoyer(V, { methode: 'POST', chemin: '/api/compte/connexion', entetes: siteH(null), corps: { email: mail(), motDePasse: 'mot-de-passe-faux-1' } });
            const r2 = await envoyer(V, { methode: 'POST', chemin: '/api/compte/connexion', entetes: siteH(null), corps: { email: connus[i], motDePasse: 'mot-de-passe-faux-2' } });
            t.inconnue.push(r1.ms); t.faux.push(r2.ms);
            if (r1.statut !== 401 || r2.statut !== 401 || r1.texte !== r2.texte) ecart('POST /api/compte/connexion', 'step2', `les deux échecs ne sont pas identiques (${r1.statut}/${r2.statut})`);
        }
        const moy = a => a.reduce((x, y) => x + y, 0) / a.length;
        console.log(`   connexion : adresse inconnue ${moy(t.inconnue).toFixed(1)} ms, mot de passe faux ${moy(t.faux).toFixed(1)} ms (20 essais chacun)`);
        H.vrai(`step 2 : écart moyen de temps < 50 ms (${Math.abs(moy(t.inconnue) - moy(t.faux)).toFixed(1)} ms)`, Math.abs(moy(t.inconnue) - moy(t.faux)) < 50);

        const svc = require('../comptes/service');
        const signature = r => JSON.stringify({ statut: r.statut, texte: r.texte, entetes: Object.fromEntries(Object.entries(r.entetes).filter(([k]) => !['date', 'content-length'].includes(k)).sort()) });
        // inscription : adresse neuve / adresse déjà prise
        const prise = mail(); await raw('comptes').insertOne(Object.assign(M.nouveauCompte({ email: prise, emailCle: prise, motDePasse: hash }), { verifie: true }));
        const i1 = await envoyer(V, { methode: 'POST', chemin: '/api/compte/inscription', entetes: siteH(null), corps: { email: mail(), turnstile: 't' } });
        const i2 = await envoyer(V, { methode: 'POST', chemin: '/api/compte/inscription', entetes: siteH(null), corps: { email: prise, turnstile: 't' } });
        await svc.attendre();
        H.v('step 2 : inscription — adresse neuve et adresse déjà prise : 202, MÊMES OCTETS (corps et en-têtes)', [i1.statut, i2.statut, signature(i1) === signature(i2)], [202, 202, true]);
        // mot de passe oublié : adresse connue / inconnue
        const o1 = await envoyer(V, { methode: 'POST', chemin: '/api/compte/mot-de-passe-oublie', entetes: siteH(null), corps: { email: prise } });
        const o2 = await envoyer(V, { methode: 'POST', chemin: '/api/compte/mot-de-passe-oublie', entetes: siteH(null), corps: { email: mail() } });
        await svc.attendre();
        H.v('step 2 : mot de passe oublié — adresse connue et inconnue : 202, MÊMES OCTETS', [o1.statut, o2.statut, signature(o1) === signature(o2)], [202, 202, true]);
        // renvoi de la vérification : compte non vérifié / vérifié / inconnu
        const nv = mail(); await raw('comptes').insertOne(Object.assign(M.nouveauCompte({ email: nv, emailCle: nv, motDePasse: hash }), { verifie: false }));
        const v1 = await envoyer(V, { methode: 'POST', chemin: '/api/compte/renvoyer-verification', entetes: siteH(null), corps: { email: nv } });
        const v2 = await envoyer(V, { methode: 'POST', chemin: '/api/compte/renvoyer-verification', entetes: siteH(null), corps: { email: prise } });
        const v3 = await envoyer(V, { methode: 'POST', chemin: '/api/compte/renvoyer-verification', entetes: siteH(null), corps: { email: mail() } });
        await svc.attendre();
        H.v('step 2 : renvoi — non vérifié, vérifié, inconnu : 202, MÊMES OCTETS', [v1.statut, v2.statut, v3.statut, signature(v1) === signature(v2), signature(v2) === signature(v3)], [202, 202, 202, true, true]);
        // le courrier n'est pas une arme : une même adresse ne reçoit pas plus de `renvoiParCompteHeure` liens de réinitialisation par heure, d'où que viennent les demandes
        courrier.envoyes.length = 0;
        const victime = mail(); await raw('comptes').insertOne(Object.assign(M.nouveauCompte({ email: victime, emailCle: victime, motDePasse: hash }), { verifie: true }));
        const reps = [];        for (let k = 0; k < 8; k++) reps.push(await envoyer(V, { methode: 'POST', chemin: '/api/compte/mot-de-passe-oublie', entetes: siteH(null), corps: { email: victime } }));
        const inconnue = await envoyer(V, { methode: 'POST', chemin: '/api/compte/mot-de-passe-oublie', entetes: siteH(null), corps: { email: mail() } });
        await svc.attendre();
        const recus = courrier.envoyes.filter(e => e.email === victime).length;
        // O1 (corrigé, I-3) : au plus `renvoiParCompteHeure` courriers par adresse et par heure, d'où que viennent les demandes (le plafond par IP se contourne avec des IP). Et la LIMITE NE SE VOIT PAS :
        // les 8 réponses (celles d'avant la limite comme celles d'après) et celle d'une adresse inconnue ont les MÊMES OCTETS — aucune énumération par la limite.
        H.vrai(`O1 : 8 demandes de réinitialisation pour UNE adresse depuis 8 IP → au plus ${cfg.limites.renvoiParCompteHeure} courriers (reçus : ${recus})`, recus >= 1 && recus <= cfg.limites.renvoiParCompteHeure);
        H.v('O1 : les 8 réponses (avant ET après la limite) et celle d\'une adresse inconnue : 202, MÊMES OCTETS', [...new Set([...reps, inconnue].map(r => signature(r)))].length, 1);
        H.v('O1 : ... et ce 202 unique est bien un 202', reps[7].statut, 202);
    }

    // ═══════════════ STEP 4 : SSRF, ReDoS, client Turnstile ═══════════════
    {
        const ssrf = ['http://127.0.0.1/x.jpg', 'https://127.0.0.1/x.jpg', 'https://vinted.net@evil.example/x.jpg', 'https://x.vinted.net.evil.example/x.jpg', 'https://[::1]/x.jpg', 'https://localhost/x.jpg',
            'https://169.254.169.254/latest/meta-data/', 'file:///etc/passwd', 'data:image/jpeg;base64,AAAA', 'https://evil.example/https://images1.vinted.net/x.jpg', 'https://images1.vinted.net.evil.example/x.jpg',
            'https://images1.vinted.net@evil.example/x.jpg', 'https://evilvinted.net/x.jpg', '//images1.vinted.net/x.jpg', 'HTTPS://EVIL.EXAMPLE/x.jpg', 'https://images1.vinted.net\\@evil.example/x.jpg'];
        let ok = true;
        for (const u of ssrf) {
            const x = await inst(3); const avant = await instantane();
            const rep = await envoyer(V, { methode: 'POST', chemin: '/api/identifier', entetes: extH(x.jeton, { 'idempotency-key': cle() }), corps: corpsId({ imageUrls: [u] }) });
            const w = ecrits(avant, await instantane());
            if (rep.statut !== 400 || w.length) { ok = false; ecart('POST /api/identifier', 'step4', `imageUrls ${JSON.stringify(u)} → ${rep.statut} (attendu 400), écritures : ${w.join(', ') || 'aucune'}`); }
        }
        const temoin = await envoyer(V, { methode: 'POST', chemin: '/api/identifier', entetes: extH((await inst(3)).jeton, { 'idempotency-key': cle() }), corps: corpsId() });
        H.v('step 4 : contrôle de l\'instrument — une URL d\'hôte vinted.net légitime passe (200)', temoin.statut, 200);
        H.vrai(`step 4 : ${ssrf.length} URL d'images hostiles → 400, aucune écriture`, ok);
        // ReDoS : 1 Mo d'entrées pathologiques
        const { expurger } = require('../annonce/expurger'); const { preparerAnnonce } = require('../annonce/verifier');
        const Mo = 1024 * 1024;
        const patho = { zeros: '0'.repeat(Mo), 'zéro espace': '0 '.repeat(Mo / 2), 'a@a@': 'a@'.repeat(Mo / 2), points: '.'.repeat(Mo), 'tirets-point': 'a-'.repeat(Mo / 2) + '.', 'insta espaces': 'insta  '.repeat(Mo / 7), 'http': 'http://'.repeat(Mo / 7),
            'slash': 'a.b/'.repeat(Mo / 4), 'chiffres espacés': '06 12 '.repeat(Mo / 6), 'crochets at': '[at]'.repeat(Mo / 4), 'plus': '+33 '.repeat(Mo / 4), 'unicode': '́'.repeat(Mo / 2), 'tld': 'x.fr'.repeat(Mo / 4), 'parenthèses': '(0'.repeat(Mo / 2),
            'nom long': 'a'.repeat(Mo) + '@', 'domaine long': 'a@' + 'b.'.repeat(Mo / 2) };
        let lent = [];
        for (const [nom, s] of Object.entries(patho)) {
            const t0 = performance.now(); expurger(s); const ms1 = performance.now() - t0;
            const t1 = performance.now(); preparerAnnonce({ title: s, description: s }, cfg); const ms2 = performance.now() - t1;
            if (ms1 >= 500 || ms2 >= 500) lent.push(`${nom} (${ms1.toFixed(0)} / ${ms2.toFixed(0)} ms)`);
        }
        H.v(`step 4 : expurger sur ${Object.keys(patho).length} entrées pathologiques de 1 Mo : toutes < 500 ms`, lent, []);
        // le client Turnstile : son hôte seul, rien d'autre, et il ne reste jamais suspendu
        const { verifierTurnstile } = require('../comptes/turnstile');
        const appels = [];
        const faux = async (url, opts) => { appels.push({ url: String(url), opts }); return { ok: true, json: async () => ({ success: true }) }; };
        await verifierTurnstile('jeton-banc-turnstile', '1.2.3.4', { fetch: faux, secret: 'secret-banc-turnstile' });
        H.v('step 4 : le client Turnstile appelle UNE fois, https://challenges.cloudflare.com', [appels.length, appels[0] && new URL(appels[0].url).protocol, appels[0] && new URL(appels[0].url).hostname], [1, 'https:', 'challenges.cloudflare.com']);
        H.vrai('step 4 : le secret voyage dans le corps POST, jamais dans l\'URL', appels[0] && !appels[0].url.includes('secret-banc-turnstile') && String(appels[0].opts.body).includes('secret=secret-banc-turnstile'));
        H.vrai('step 4 : le client Turnstile ne suit AUCUNE redirection (redirect: "error")', appels[0] && appels[0].opts.redirect === 'error');
        H.vrai('step 4 : le client Turnstile a une échéance (signal d\'annulation)', appels[0] && appels[0].opts.signal && typeof appels[0].opts.signal.aborted === 'boolean');
        let leve = null; try { await verifierTurnstile('x', null, { fetch: faux, secret: '' }); } catch (e) { leve = e.message; }
        H.v('step 4 : sans secret le client LÈVE (fail-closed)', leve, 'turnstile-non-configure');
    }

    // ═══════════════ STEP 3 bis : les chemins d'ERREUR du ledger et la règle « jamais e.message » ═══════════════
    {
        // (1) une ligne de débit au rendu non confirmé, rejouée : le ledger la journalise (EN_RECONCILIATION) — sans la clé du client en clair
        const Lg = require('../argent/ledger');
        const x = await inst(3), secretClient = secret('cle-client-secrete-abcdef12', 'Idempotency-Key (dans une clé de ledger)');
        const cleBrute = `scan|installation:${x.i._id}|${secretClient}`;
        await raw('mouvements').insertOne({ installationId: x.i._id, le: new Date(), type: 'debit', delta: -1, poche: 'essai', credit: { poche: 'essai' }, motif: null, scanId: new mongoose.Types.ObjectId(), etat: 'rendu-en-cours', cleIdempotence: cleBrute, surface: 'extension' });
        const r = await Lg.debiter({ type: 'installation', id: x.i._id, compte: null, installation: x.i, surface: 'extension', administrateur: false }, { scanId: new mongoose.Types.ObjectId(), cleIdempotence: cleBrute }, cfg);
        H.v('step 3 : contrôle de l\'instrument — le chemin EN_RECONCILIATION du ledger est joué', r.code, 'EN_RECONCILIATION');
        // (2) LISTE PERMISE (I-4) : `.message` est INTERDIT dans tout fichier non-test de v2/ — pas seulement sur la ligne d'un console.* : une indirection (`repli(…)`, `signaler(…)`, `journal(…)`) l'imprime aussi.
        // Un pilote y cite une clé, une adresse, une URL, un nom de collection. Seules passent les exceptions NOMMÉES ci-dessous, chacune reconnue par son fichier ET un fragment de la ligne (pas un numéro de ligne, qui dérive).
        const fs = require('fs'), racine = path.join(__dirname, '..');
        const EXCEPTIONS = [
            { fichier: 'index.js', contient: 'console.error(`🔴 [v2] ${e.message} — les routes v2', raison: 'message d\'une CONFIGURATION invalide (lireConfig) : noms de variables, jamais la valeur d\'un secret' },
            { fichier: 'identifier/routes.js', contient: 'r.erreur.message', raison: 'champ `message` de l\'objet de refus FABRIQUÉ par verifierEntree (pas une Error de pilote)' },
            { fichier: 'identifier/adaptateur.js', contient: 'e instanceof Panne ? e.message', raison: 'message d\'une Panne : phrase fabriquée par l\'adaptateur (motif ou nature du refus de la chaîne héritée), jamais un message de pilote' },
            { fichier: 'openapi/valider.js', contient: 'meilleure[0].message', raison: 'champ `message` d\'un écart du validateur (objet fabriqué)' }
        ];
        // `mesures` : outillage lancé à la main (comme migrations/ et admin/), JAMAIS chargé par le serveur — l'assertion « aucun require de mesures/ » plus bas garde cette exclusion de devenir un trou
        const REPERTOIRES_CLI = ['migrations', 'admin', 'test', 'mesures'];       // outils en ligne de commande : ils écrivent sur le terminal de l'opérateur, pas dans un journal de serveur
        const fichiers = [];
        (function parcourir(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { if (!(REPERTOIRES_CLI.includes(e.name) && (e.name !== 'mesures' || path.relative(racine, p).replace(/\\/g, '/') === 'mesures'))) parcourir(p); } else if (e.name.endsWith('.js')) fichiers.push(p); } })(racine);   // `mesures` n'est exclu QU'au chemin exact v2/mesures/ (jamais un homonyme plus profond)
        // la règle, en fonction pure : les lignes (hors commentaire de fin de ligne) qui portent `.message` sans exception nommée
        // Une règle statique est un FILET, pas une preuve (audit §6) : elle voit les formes ci-dessous, pas un `e` passé tel quel à une fonction tierce. Formes vues : `.message`, `['message']`,
        // `catch ({ message })`, et, sur chaque variable de `catch (x)` du fichier : `${x}`, `String(x)`, `x.stack`, `x.toString(`, `'' + x`.
        const formesDe = source => {
            const noms = [...source.matchAll(/catch\s*\(\s*([A-Za-z_$][\w$]*)\s*\)/g)].map(m => m[1]);
            const echapper = n => n.replace(/\$/g, '\\$');
            const re = [/\.message\b/, /\[\s*['"`]message['"`]\s*\]/, /\bcatch\s*\(\s*\{[^)]*\bmessage\b/];
            for (const n of new Set(noms)) { const x = echapper(n); re.push(new RegExp('\\$\\{\\s*' + x + '\\s*\\}'), new RegExp('\\bString\\(\\s*' + x + '\\s*\\)'), new RegExp('\\b' + x + '\\.(?:stack\\b|toString\\()'), new RegExp('[\'"`]\\s*\\+\\s*' + x + '\\b'),
                new RegExp('\\bconsole\\.\\w+\\((?:[^()]*,)?\\s*' + x + '\\s*[,)]'),                      // console.* reçoit DIRECTEMENT la variable : pile et message imprimés
                new RegExp('\\{[^}]*\\bmessage\\b[^}]*\\}\\s*=\\s*' + x + '\\b')); }                      // const { message: m } = e
            return re;
        };
        const fautifsDe = (rel, source) => { const re = formesDe(source); return source.split(/\r?\n/).map(l => l.replace(/\s\/\/.*$/, '')).map((l, i) => ({ l, i })).filter(({ l }) => re.some(r => r.test(l)) && !EXCEPTIONS.some(x => x.fichier === rel && l.includes(x.contient))).map(({ i }) => `${rel}:${i + 1}`); };
        const fautifs = [], utilisees = new Set();
        for (const f of fichiers) {
            const rel = path.relative(racine, f).replace(/\\/g, '/'), source = fs.readFileSync(f, 'utf8');
            fautifs.push(...fautifsDe(rel, source));
            for (const x of EXCEPTIONS) if (x.fichier === rel && source.includes(x.contient)) utilisees.add(x.contient);
        }
        H.v(`step 3 : AUCUN \`.message\` dans les ${fichiers.length} fichiers non-test de v2/ (hors ${EXCEPTIONS.length} exceptions nommées et les dossiers ${REPERTOIRES_CLI.join(', ')})`, fautifs, []);
        H.v('step 3 : chaque exception nommée existe encore dans son fichier (pas d\'exception morte)', EXCEPTIONS.filter(x => !utilisees.has(x.contient)).map(x => x.fichier), []);
        // la règle SAIT dire non : le correctif de questions.js remis tel qu'il était (un `repli(e.message)` réintroduit) la fait tomber
        const q = fs.readFileSync(path.join(racine, 'argent', 'questions.js'), 'utf8');
        const reintroduit = q.replace('repli(`écriture refusée (${(e && (e.code || e.name)) || \'erreur\'})`)', 'repli(`écriture refusée (${e.message})`)');
        H.v('step 3 : contrôle de l\'instrument — un `repli(e.message)` réintroduit dans argent/questions.js fait tomber la règle (et la version actuelle ne la fait pas tomber)', [reintroduit !== q, fautifsDe('argent/questions.js', reintroduit).length, fautifsDe('argent/questions.js', q).length], [true, 1, 0]);
        // la règle voit AUSSI les contournements nommés par la relecture (R3 à R8) ; un `catch` qui ne dit que le code ou le nom de l'erreur n'est pas signalé
        const contournements = ['catch ({ message }) { journal(message); }', 'catch (e) { journal(`${e}`); }', 'catch (e) { journal(e[\'message\']); }', 'catch (e) { journal(String(e)); }', 'catch (e) { journal(e.stack); }', 'catch (e) { journal(e.toString()); }', 'catch (e) { journal(\'x\' + e); }', 'catch (e) { console.error(e); }', 'catch (err) { console.warn(\'x\', err); }', 'catch (e) { console.log(`x`, e, 1); }', 'catch (e) { const { message: m } = e; journal(m); }', 'catch (e) { const { code, message: m } = e; journal(m); }'];
        H.v('step 3 : contrôle de l\'instrument — catch ({ message }), `${e}`, e[\'message\'], String(e), e.stack, e.toString(), \'x\' + e sont TOUS signalés', contournements.filter(f => fautifsDe('x.js', f).length === 0), []);
        H.v('step 3 : ... et un catch qui ne dit que le code ou le nom de l\'erreur n\'est pas signalé', fautifsDe('x.js', 'catch (e) { journal((e && (e.code || e.name)) || \'erreur\'); }').length, 0);
    }
    // ═══════════════ STEP 3 ter : le pilote de courrier MÉMOIRE est celui de la production tant que BREVO_API_KEY manque (comptes/monter.js) ═══════════════
    {
        const c = require('../comptes/courrier').creerCourrierMemoire();
        for (let k = 0; k < 5000; k++) await c.envoyerVerification(`mem${k}@exemple.fr`, 'https://rat-market.fr/fr/verification?jeton=x');
        H.vrai(`step 3 : le pilote mémoire est BORNÉ (5 000 envois → ${c.envoyes.length} entrées, au plus 1 000) : ni fuite de mémoire, ni liens de vérification gardés sans fin`, c.envoyes.length <= 1000);
    }
    // ═══════════════ STEP 5 (parqués B7b) : la correction et l'effacement du banc, JOUÉS en 200 avec des lignes réelles, validés contre le contrat ═══════════════
    {
        const A2 = require('./_contrat-reel-aide'); const { creerBanc } = require('../banc/routes'); const { creerPurge } = require('../banc/purge'); const { creerStockageMemoire } = require('../banc/stockage');
        const stockage = creerStockageMemoire(), env = { V2_BANC_SEL: 'sel-du-banc-b8-abcdefgh', V2_BANC_BUCKET: 'bucket-banc-b8' };
        const banc = creerBanc({ cfg, env, stockage }), purge = creerPurge({ cfg, env, stockage });
        const sv2 = await monter({ banc, purge });
        const x = await inst(3);
        const sc = await envoyer(sv2.url, { methode: 'POST', chemin: '/api/identifier', entetes: extH(x.jeton, { 'idempotency-key': cle() }), corps: corpsId() });
        const jeton = secret('jeton-banc-m5-abcdefghijkl12', 'jeton de consentement'), empreinte = crypto.createHash('sha256').update(jeton).digest('hex');
        const cles = [`banc-reel/v2/${'a'.repeat(32)}.webp`, `banc-reel/v2/${'b'.repeat(32)}.webp`];
        for (const k of cles) await stockage.ecrire(k, Buffer.from('image'));
        const idLigne = (scanId, carte) => crypto.createHash('sha256').update(`${String(scanId).toLowerCase()}|${carte}|${env.V2_BANC_SEL}`).digest('hex');
        const maintenant = new Date(), jourUTC = new Date(Date.UTC(maintenant.getUTCFullYear(), maintenant.getUTCMonth(), maintenant.getUTCDate()));
        await raw('banc_lignes').insertOne({ _id: idLigne(sc.json.scanId, 0), cleR2: cles[0], etat: 'confirmee', jetonEmpreinte: empreinte, le: jourUTC, expireLe: new Date(jourUTC.getTime() + 600 * 86400e3), source: 'affirme', verite: ID_A, versionModele: null, versionTexte: cfg.banc.versionsTexte[0] });
        await raw('banc_lignes').insertOne({ _id: idLigne('c'.repeat(24), 0), cleR2: cles[1], etat: 'confirmee', jetonEmpreinte: empreinte, le: jourUTC, expireLe: new Date(jourUTC.getTime() + 600 * 86400e3), source: 'affirme', verite: ID_B, versionModele: null, versionTexte: cfg.banc.versionsTexte[0] });
        const consentement = { version: cfg.banc.versionsTexte[0], le: new Date().toISOString(), jeton };
        // la correction, le banc ACTIF : la ligne du scan est corrigée (source « correction », vérité = le produit envoyé)
        const cor = await envoyer(sv2.url, { methode: 'POST', chemin: '/api/banc/correction', entetes: extH(x.jeton), corps: { scanId: sc.json.scanId, idProduct: ID_B, consentementBanc: consentement } });
        const ligne = await raw('banc_lignes').findOne({ _id: idLigne(sc.json.scanId, 0) });
        const ecartsCor = A2.juger('POST /api/banc/correction', cor.statut, cor.json, cor.texte, cor.entetes);
        H.v('M-5 : correction avec le banc ACTIF — 200, la ligne est corrigée (source, vérité), réponse conforme au contrat', [cor.statut, ligne && ligne.source, ligne && ligne.verite, ecartsCor.length], [200, 'correction', ID_B, 0]);
        // l'effacement de lignes RÉELLES (supprimees ≥ 1, stockage factice) : les deux lignes et leurs deux objets partent
        const efc = await envoyer(sv2.url, { methode: 'DELETE', chemin: '/api/banc/contributions', entetes: extH(x.jeton), corps: { jeton } });
        const ecartsEfc = A2.juger('DELETE /api/banc/contributions', efc.statut, efc.json, efc.texte, efc.entetes);
        H.v('M-5 : effacement de lignes réelles — 200, supprimees 2, echecs 0, plus aucune ligne ni objet, réponse conforme au contrat', [efc.statut, efc.json && efc.json.supprimees, efc.json && efc.json.echecs, await raw('banc_lignes').countDocuments({ jetonEmpreinte: empreinte }), stockage.cles().length, ecartsEfc.length], [200, 2, 0, 0, 0, 0]);
        // parqué B7b : POST /api/banc/correction n'a pas de garde de surface — exigerInstallation la protège : une SESSION (surface scanner) n'y entre pas
        const cs = await compte();
        const viaSession = await envoyer(sv2.url, { methode: 'POST', chemin: '/api/banc/correction', entetes: siteH(cs.cookie), corps: { scanId: sc.json.scanId, idProduct: ID_B, consentementBanc: consentement } });
        H.v('parqué B7b : POST /api/banc/correction avec une SESSION du site → 401 JETON (exigerInstallation suffit : la surface scanner n\'y entre pas)', [viaSession.statut, viaSession.json && viaSession.json.erreur && viaSession.json.erreur.code], [401, 'JETON']);
        // parqué B7b (M-7) : creer-recharge n'est pas atteint par la v2 — avec un jeton v2 valide, la requête sort du routeur v2 sans écriture (la route héritée répond à sa place)
        const avant = await instantane();
        const cr = await envoyer(sv2.url, { methode: 'POST', chemin: '/api/creer-recharge', entetes: extH(x.jeton), corps: { prix: 'x' } });
        const w = ecrits(avant, await instantane());
        H.v('parqué B7b (M-7) : POST /api/creer-recharge avec un jeton v2 valide — la v2 ne répond pas (404 ici : aucune route héritée dans ce banc), aucune écriture', [cr.statut, w], [404, []]);
        await sv2.fermer();
    }
    // ═══════════════ STEP 6 : la table des VALEURS PAR DÉFAUT (B8.2) — chaque variable de v2/config.js : son défaut, et ce que fait une valeur mal formée. Chaque défaut doit FERMER. ═══════════════
    {
        const { lireConfig: lire } = require('../config'); const fs = require('fs');
        // BANC_ISOLE est lue sur process.env (second témoin du mode banc), pas sur l'objet `env` passé à lireConfig : elle est éprouvée par le bloc « m4 » plus bas, pas par une ligne de cette table
        const noms = [...new Set([...fs.readFileSync(path.join(__dirname, '..', 'config.js'), 'utf8').matchAll(/env\.([A-Z][A-Z0-9_]+)/g)].map(m => m[1]))].filter(n => n !== 'BANC_ISOLE').sort();
        const PROD = { RM_API_V2: '1', MONGODB_BASE: 'test', V2_SECRET_EMPREINTE: 's'.repeat(20) };            // une configuration de PRODUCTION (allumée, hors base de banc)
        const entier = (c, ...cle) => cle.reduce((o, k) => o[k], c);
        // [lecture, défaut attendu, valeur mal formée, issue : 'leve' (la configuration est invalide : v2 répond 503, jamais mal configurée) | 'ignore' (retombe sur le défaut) | { ferme: prédicat }, base de l'essai]
        const T = {
            V2_ORDRE_POCHES: [c => c.ordrePoches, ['jour'], 'essai,gratuit', 'leve'],      // OFFRE-QUOTA : la seule poche débitable est le quota du jour
            V2_QUOTA_SANS_COMPTE: [c => c.quotas.sansCompte, 3, 'abc', 'leve'], V2_QUOTA_GRATUIT: [c => c.quotas.gratuit, 10, 'abc', 'leve'], V2_QUOTA_PRO_PLAFOND: [c => c.quotas.proPlafond, 200, 'abc', 'leve'],      // OFFRE-QUOTA : quotas quotidiens (3 / 10 / plafond technique Pro 200)
            MONGODB_BASE: [c => c.base, null, '   ', 'ignore', {}],
            RM_API_V2: [c => c.actif, false, 'true', 'ignore', {}],
            V2_SECRET_EMPREINTE: [c => c.empreinte.secret, null, 'trop-court', 'leve', {}],
            V2_TURNSTILE: [c => c.turnstile, 'on', 'peut-etre', 'leve'],
            V2_ESSAIS: [c => c.quotas.essai, 3, 'abc', 'leve'], V2_ACCUEIL: [c => c.quotas.accueil, 25, 'abc', 'leve'], V2_HEBDO: [c => c.quotas.hebdo, 2, 'abc', 'leve'], V2_ABO_MENSUEL: [c => c.quotas.aboMensuel, 100, 'abc', 'leve'],
            V2_DECLARES_SANS_COMPTE: [c => c.plafonds.declares.sansCompte, 1, 'abc', 'leve'], V2_DECLARES_GRATUIT: [c => c.plafonds.declares.gratuit, 3, 'abc', 'leve'], V2_DECLARES_PRO: [c => c.plafonds.declares.pro, 30, 'abc', 'leve'],      // PLAFOND-DECLARE : les déclarations du client, par offre (V2_PLAFOND_PANNES / _QUESTIONS, V2_SANS_PRIX_JOUR, V2_JUMEAUX_REMBOURSES_JOUR n'ont plus d'objet : test-plafond-declare.js)
            V2_CONSTATES_SANS_COMPTE: [c => c.plafonds.constates.sansCompte, 20, 'abc', 'leve'], V2_CONSTATES_GRATUIT: [c => c.plafonds.constates.gratuit, 50, 'abc', 'leve'], V2_CONSTATES_PRO: [c => c.plafonds.constates.pro, 100, 'abc', 'leve'],      // FREIN-CONSTATES : ce que le serveur constate, par offre
            V2_DEPENSE_MODELE_JOUR_USD: [c => c.depenseModele.jourUsd, 5, '0', 'leve'], V2_COUT_APPEL_ESTIME_USD: [c => c.depenseModele.appelEstimeUsd, 0.004, 'abc', 'leve'],      // FREIN-CONSTATES : le plafond global de dépense du modèle
            V2_LECTURE_LIVE_MAX: [c => c.lot.lectureLiveMax, 5, 'abc', 'leve'],
            V2_LOT_REPRISES_PASSAGE: [c => c.lot.reprisesParPassage, 200, '0', 'leve'], V2_LOT_REGLEMENT_REPRISE_MIN: [c => c.lot.reglementBloqueMs, 15 * 60e3, '0', 'leve'], V2_CLAIM_ORPHELINE_MIN: [c => c.lot.claimOrphelineMs, 60 * 60e3, '59', 'leve'], V2_REPARATION_AGE_MIN: [c => c.lot.reparationAgeMs, 15 * 60e3, '4', 'leve'],
            V2_LOT_TROP_GRAND_JOUR: [c => c.plafonds.lotTropGrand, 10, 'abc', 'leve'], V2_LOT_CARTES_MAX: [c => c.lot.cartesMax, 20, '1', 'leve'],
            V2_COMPTE_HEURE: [c => c.limites.compteParPorteurHeure, 600, '0', 'leve'], V2_SOLDE_HEURE: [c => c.limites.soldeParPorteurHeure, 1200, '0', 'leve'],      // MOYENS-B1 (O4) : plafonds par porteur, posés sans mesure d'usage réel
            V2_REPONSE_HEURE: [c => c.limites.reponseParPorteurHeure, 600, '0', 'leve'], V2_RETOUR_LIVE_HEURE: [c => c.limites.retourLiveParPorteurHeure, 600, '0', 'leve'],
            V2_ETIQUETTE_HEURE: [c => c.limites.etiquetteParPorteurHeure, 600, '0', 'leve'],      // ETIQUETAGE-A : le plafond horaire de POST /api/banc/etiquette (administrateur), posé sans mesure d'usage réel
            RENDER_GIT_COMMIT: [c => c.versions.chaine, null, 'pas-un-commit', 'ignore'], V2_VERSION_MODELE: [c => c.versions.modele, null, '%%', 'ignore'],   // ETIQUETAGE-A : informations internes, une valeur illisible vaut `null` (jamais invalide, jamais inventée)
            V2_ESSAIS_GLOBAUX_JOUR: [c => c.limites.essaisGlobauxJour, 500, 'abc', 'leve'],
            V2_INSTALLATION_REQUETES_HEURE: [c => c.limites.installationRequetesIpHeure, 30, '0', 'leve'],      // IDEMPOTENCE-INSTALLATION r1 I1 : borne les devinettes de clé sur /api/installation
            V2_BANC_LIEN_MOIS: [c => c.retention.bancLienMois, 12, '13', 'leve'],      // BANC-12 : jamais plus de 12 mois
            V2_BANC_GRACE_JOURS: [c => c.retention.bancGraceJours, 7, '31', 'leve'],   // BANC-12 tour 1 : la grâce avant suppression d'une ligne non réécrite, 21 jours au plus (BANC-12 : « 30 » a été ramené à 21)
            V2_INSCRIPTION_IP_HEURE: [c => c.limites.inscriptionIpHeure, 10, '0', 'leve'], V2_OUBLI_IP_HEURE: [c => c.limites.oubliIpHeure, 10, '0', 'leve'], V2_REINIT_IP_HEURE: [c => c.limites.reinitIpHeure, 10, '0', 'leve'],
            V2_VERIFICATION_IP_HEURE: [c => c.limites.verificationIpHeure, 30, '0', 'leve'], V2_CONNEXION_IP_HEURE: [c => c.limites.connexionIpHeure, 30, '0', 'leve'],
            V2_SUPPRESSION_COMPTE_HEURE: [c => c.limites.suppressionParCompteHeure, 10, '0', 'leve'], V2_RENVOI_COMPTE_HEURE: [c => c.limites.renvoiParCompteHeure, 3, '0', 'leve'],
            V2_URL_VERIFICATION: [c => c.urls.verification, 'https://rat-market.fr/fr/verification', 'http://rat-market.fr/x', 'leve'], V2_URL_REINIT: [c => c.urls.reinit, 'https://rat-market.fr/fr/reinitialisation', 'http://rat-market.fr/x', 'leve'],
            V2_EMPREINTE_JOURS: [c => c.empreinte.jours, 365, '0', 'leve'],
            V2_ORIGINE_EXTENSION_DEV: [c => c.origines.extensionDev, null, 'chrome-extension://intrus', { ferme: c => c.origines.extensionDev === null }, PROD],   // honorée SEULEMENT sur test_scratch : en production elle est ignorée
            V2_DESCRIPTION_CONSERVEE: [c => c.annonce.conservee, false, '2', 'leve'], V2_DESCRIPTION_AU_MODELE: [c => c.annonce.auModele, false, '2', 'leve'],
            V2_MARCHES: [c => c.marches.length, 27, '%%', { ferme: c => !c.marches.includes('vinted.fr') }],   // un marché mal écrit : plus aucun marché réel (422 pour tous), jamais un marché de plus
            V2_VERSION_MIN_EXTENSION: [c => c.versionMinExtension, '2.0.0', '%%', { ferme: c => require('../identifier/routes').comparerVersions('2.0.0', c.versionMinExtension) === null }],   // illisible : 400 pour tous
            V2_VISUELS_SOURCE: [c => c.visuels.source, 'fichier', 'cartes', 'leve'],
            V2_VISUELS_BANC_FICHIER: [c => c.visuels.fichierBanc, null, 'C:\\tmp\\intrus.rmv.gz', { ferme: c => c.visuels.fichierBanc === null }, PROD],   // honorée SEULEMENT en mode banc : en production elle est ignorée
            V2_REGLE_G: [c => c.regleG, false, '2', 'leve'], V2_SECONDE_LECTURE: [c => c.secondeLecture, false, '2', 'leve'],      // SECONDE-LECTURE : éteinte par défaut, tout autre que 0 ou 1 est invalide
            V2_TAUX_BCE: [c => c.tauxBce, false, '2', 'leve'],      // TAUX-BCE : éteint par défaut, tout autre que 0 ou 1 est invalide
            V2_COOKIE_SECURE: [c => c.cookieSecure, true, '2', 'leve'],
            V2_RESOLUTION_CARDMARKET: [c => c.resolutionCardmarket, false, 'true', 'ignore'],      // RESOUDRE-CARDMARKET : éteint par défaut ; seul « 1 » l'allume, toute autre valeur l'éteint sans invalider la configuration
            V2_PHOTOS_MULTIPLES: [c => c.photosMultiples, false, 'true', 'ignore'], V2_PHOTOS_MULTIPLES_TOUS: [c => c.photosMultiplesTous, false, 'true', 'ignore'],      // PHOTOS-MULTIPLES (7d) : éteints par défaut ; seul « 1 » allume, toute autre valeur éteint sans invalider la configuration ; le second (phase 2) est LU et ne branche rien
            V2_PHOTO_ADMIN_DELAI_S: [c => c.photoAdmin.delaiS, 15, '301', 'leve'], V2_PHOTO_ADMIN_INTERVALLE_S: [c => c.photoAdmin.intervalleS, 10, '-1', 'leve'], V2_PHOTO_ADMIN_MAX_JOUR: [c => c.photoAdmin.maxJour, 400, '-1', 'leve']     // PHOTO-EXTENSION : le repli du téléchargement serveur (entiers, 0 à 3 600 et 0 à 100 000)
        };
        H.v('step 6 : chaque variable lue par v2/config.js a une ligne de la table (et réciproquement)', [noms.filter(n => !T[n]), Object.keys(T).filter(n => !noms.includes(n))], [[], []]);
        const echecs = [];
        for (const [nom, [lecture, defaut, mal, issue, base]] of Object.entries(T)) {
            const b = base || { MONGODB_BASE: 'test_scratch' };
            try {
                const d = lecture(lire(b));
                if (JSON.stringify(d) !== JSON.stringify(defaut)) echecs.push(`${nom} : défaut ${JSON.stringify(d)} ≠ ${JSON.stringify(defaut)}`);
                let c = null, leve = null; try { c = lire({ ...b, [nom]: mal }); } catch (e) { leve = e; }
                if (issue === 'leve') { if (!leve) echecs.push(`${nom}=« ${mal} » devait lever`); }
                else if (leve) echecs.push(`${nom}=« ${mal} » ne devait pas lever (${leve.message})`);
                else if (issue === 'ignore') { if (JSON.stringify(lecture(c)) !== JSON.stringify(defaut)) echecs.push(`${nom}=« ${mal} » devait retomber sur le défaut`); }
                else if (!issue.ferme(c)) echecs.push(`${nom}=« ${mal} » ne ferme pas`);
            } catch (e) { echecs.push(`${nom} : ${e.message}`); }
        }
        H.v(`step 6 : ${Object.keys(T).length} variables de v2/config.js — défaut attendu, valeur mal formée → refusée, ignorée ou fermée`, echecs, []);
        // les gardes de combinaison : une configuration de PRODUCTION (allumée, hors test_scratch) refuse ce qui n'est admis que sur un banc
        const refus = (extra, retire = []) => { const e = { ...PROD, ...extra }; for (const k of retire) delete e[k]; try { lire(e); return null; } catch (x) { return x.message.slice(0, 60); } };
        H.vrai('step 6 : production allumée SANS V2_SECRET_EMPREINTE → configuration invalide', refus({}, ['V2_SECRET_EMPREINTE']));
        H.vrai('step 6 : production allumée avec V2_TURNSTILE=off → configuration invalide', refus({ V2_TURNSTILE: 'off' }));
        H.vrai('step 6 : production allumée avec V2_COOKIE_SECURE=0 → configuration invalide (le cookie de session ne voyage jamais sans Secure en production)', refus({ V2_COOKIE_SECURE: '0' }));
        H.vrai('step 6 : contrôle de l\'instrument — la même configuration de production, sans écart, est valide', refus({}) === null);
        // m4 : le nom `test_scratch` n'est qu'une étiquette (db.js:21-23) ; le mode banc exige AUSSI un second témoin que seul le harnais pose (BANC_ISOLE=1, _env-banc.js) — un nom n'est pas une preuve
        {
            const garde = process.env.BANC_ISOLE; const sec = 's'.repeat(20);
            const essai = (env, banc) => { if (banc) process.env.BANC_ISOLE = '1'; else delete process.env.BANC_ISOLE; try { const c = lire(env); return { ok: true, c }; } catch (e) { return { ok: false }; } };
            try {
                const E = { RM_API_V2: '1', MONGODB_BASE: 'test_scratch' };
                H.v('m4 : sans BANC_ISOLE, « test_scratch » seul n\'ouvre RIEN — secret de bac, Turnstile off, cookie sans Secure : tous refusés',
                    [essai(E, false).ok, essai({ ...E, V2_SECRET_EMPREINTE: sec, V2_TURNSTILE: 'off' }, false).ok, essai({ ...E, V2_SECRET_EMPREINTE: sec, V2_COOKIE_SECURE: '0' }, false).ok, essai({ MONGODB_BASE: 'test_scratch', V2_ORIGINE_EXTENSION_DEV: 'chrome-extension://dev' }, false).c.origines.extensionDev], [false, false, false, null]);
                H.v('m4 : avec BANC_ISOLE=1 (posé par le harnais seul), le mode banc s\'ouvre comme avant',
                    [essai(E, true).ok, essai({ ...E, V2_SECRET_EMPREINTE: sec, V2_TURNSTILE: 'off' }, true).ok, essai({ ...E, V2_SECRET_EMPREINTE: sec, V2_COOKIE_SECURE: '0' }, true).ok, essai({ MONGODB_BASE: 'test_scratch', V2_ORIGINE_EXTENSION_DEV: 'chrome-extension://dev' }, true).c.origines.extensionDev], [true, true, true, 'chrome-extension://dev']);
            } finally { if (garde === undefined) delete process.env.BANC_ISOLE; else process.env.BANC_ISOLE = garde; }
        }
        // m3 : le gestionnaire d'erreurs final que ce banc COPIE (413 « Requête illisible » du test (c)) ne dérive pas de l'original : index.js est LU, jamais modifié ici
        {
            const src = fs.readFileSync(path.join(__dirname, '..', '..', 'index.js'), 'utf8');
            const i = src.indexOf('app.use((err, req, res, next) => {'), bloc = i >= 0 ? src.slice(i, i + 900) : '';
            const fragments = ["'Origine non autorisée'", "'Requête illisible'", "'Erreur serveur interne'", 'statut >= 400 && statut < 500', 'Number.isInteger(err?.status)', 'if (res.headersSent) return next(err)'];
            H.v('m3 : le gestionnaire d\'erreurs final d\'index.js porte toujours les 3 messages, la règle `statut >= 400 && statut < 500` et la garde `headersSent` que le banc copie', fragments.filter(f => !bloc.includes(f)), []);
            const mute = bloc.replace("'Requête illisible'", "'x'").replace('statut >= 400 && statut < 500', 'statut >= 400');
            H.v('m3 : contrôle de l\'instrument — un original dont on retire « Requête illisible » ou la règle des 4xx fait tomber la dérive', fragments.filter(f => !mute.includes(f)), ["'Requête illisible'", 'statut >= 400 && statut < 500']);
            H.vrai('m3 : et la copie du banc porte les mêmes fragments (sinon la dérive passerait inaperçue des DEUX côtés)', fragments.every(f => gestionnaireFinal.toString().includes(f.replace(/^'|'$/g, '')) || gestionnaireFinal.toString().includes(f)));
        }
        // m2 + dérive : TOUT nom de variable d'environnement lu par la production de v2/ (et par le client R2 que le banc réel charge) figure, en NOM, dans la table de AUDIT-SECURITE-V2.md
        {
            const racine = path.join(__dirname, '..'), noms = new Set(), fichiers = [path.join(racine, '..', 'collecte-cartes', 'r2.js')];
            (function parcourir(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { if (!(['test', 'migrations', 'admin', 'mesures'].includes(e.name) && (e.name !== 'mesures' || path.relative(racine, p).replace(/\\/g, '/') === 'mesures'))) parcourir(p); } else if (e.name.endsWith('.js')) fichiers.push(p); } })(racine);   // mesures/ : outillage manuel, jamais chargé par le serveur (voir l'assertion « aucun require de mesures/ »)
            for (const f of fichiers) { const s = fs.readFileSync(f, 'utf8'); for (const re of [/process\.env\.([A-Z][A-Z0-9_]{2,})/g, /\benv\.([A-Z][A-Z0-9_]{2,})/g, /'((?:R2|V2|MONGODB|TURNSTILE|BREVO|BANC|JETON|RM)_[A-Z0-9_]+)'/g]) for (const m of s.matchAll(re)) noms.add(m[1]); }
            const audit = fs.readFileSync(path.join(racine, '..', 'AUDIT-SECURITE-V2.md'), 'utf8');
            // tour 3 (F-1) : la variable doit figurer DANS LA TABLE §4 (de « ## 4. » à « ## 5. »), pas n'importe où dans le document (une ligne de table perdue passait si le nom était cité ailleurs)
            const i4 = audit.indexOf('## 4. Table des valeurs par défaut'), i5 = audit.indexOf('\n## 5.', i4);
            H.vrai('m2 instrument : la table §4 est bien délimitée (début trouvé, fin après lui)', i4 >= 0 && i5 > i4);
            const doc = i4 >= 0 && i5 > i4 ? audit.slice(i4, i5) : '';
            const absents = [...noms].sort().filter(n => !doc.includes('`' + n + '`'));
            H.v(`m2 : ${noms.size} noms de variables lus par la production (${fichiers.length} fichiers) — tous dans la table des valeurs par défaut de AUDIT-SECURITE-V2.md (noms seulement)`, absents, []);
        }
        // L'EXCLUSION de v2/mesures/ des deux contrôles ci-dessus ne doit pas devenir un trou : AUCUN fichier de v2/ hors mesures/ et test/ ne fait `require` (ni `import()`) d'un fichier de v2/mesures/.
        {
            const racine = path.join(__dirname, '..'), liste = [];
            (function parcourir(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { if (!(['test', 'mesures'].includes(e.name) && (e.name !== 'mesures' || path.relative(racine, p).replace(/\\/g, '/') === 'mesures'))) parcourir(p); } else if (e.name.endsWith('.js')) liste.push(p); } })(racine);
            // aucun AUTRE dossier `mesures` sous v2/ (à toute profondeur, test/ compris) : l'exclusion ne vaut que pour v2/mesures/
            const homonymes = []; (function chercher(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) if (e.isDirectory()) { const p = path.join(d, e.name), rel = path.relative(racine, p).replace(/\\/g, '/'); if (e.name === 'mesures' && rel !== 'mesures') homonymes.push(rel); chercher(p); } })(racine);
            H.v('mesures : aucun autre dossier « mesures » sous v2/ que v2/mesures/', homonymes, []);
            const RE_MESURES = /\b(?:require|import)\s*\(\s*['"`][^'"`]*\bmesures\b[^'"`]*['"`]\s*\)/;
            const lierMesures = source => source.split(/\r?\n/).some(l => RE_MESURES.test(l.replace(/\s\/\/.*$/, '')));
            const fautifs = liste.filter(f => lierMesures(fs.readFileSync(f, 'utf8'))).map(f => path.relative(racine, f).replace(/\\/g, '/'));
            H.v(`mesures : aucun des ${liste.length} fichiers de v2/ (hors mesures/ et test/) ne fait require de v2/mesures/`, fautifs, []);
            // la règle SAIT dire non : une COPIE (en mémoire) de index.js à laquelle on ajoute un require de mesures/ la fait tomber ; l'original ne la fait pas tomber
            const original = fs.readFileSync(path.join(racine, 'index.js'), 'utf8');
            const copie = original + "\nconst _m = require('./mesures/garde-reseau');\n", copie2 = original + "\nconst _n = require('../mesures/mesurer-identification');\n";
            H.v('mesures : contrôle de l\'instrument — un require de mesures/ ajouté à une copie de index.js fait tomber la règle (l\'original, non)', [lierMesures(copie), lierMesures(copie2), lierMesures(original)], [true, true, false]);
        }
        // I-2 / N1 : le §10 de l'audit se bâtit par ÉNUMÉRATION du registre (progress.md), et s'INDEXE PAR UN FRAGMENT DE CONTENU de chaque ligne — jamais par son numéro (le registre grandit à chaque étape :
        // un numéro dérive, un fragment non). Périmètre : les lignes marquées qui PRÉCÈDENT la sentinelle `- **Task B8: complete` (que le coordinateur ajoute à la fusion) ; tant qu'elle n'existe pas, tout le fichier.
        // Les dettes écrites après la sentinelle relèvent de la revue finale, pas de ce banc. Registre : $RM_PROGRESS, sinon le chemin du poste du coordinateur ; absent = saut DIT ; présent mais illisible = ÉCHEC.
        {
            const MARQUEURS = ['minor (deferred', 'parked', 'Parqués', 'parqués', "POUR L'AUDIT B8", 'audit B8', 'À PORTER'], SENTINELLE = '- **Task B8: complete', LONGUEUR = 48;
            const normaliser = s => s.replace(/[`|]/g, '').replace(/\s+/g, ' ').trim();
            const fragmentDe = l => normaliser(l.replace(/^-\s*/, '')).slice(0, LONGUEUR).trim();
            const dettesDe = texte => { const L = texte.split(/\r?\n/), s = L.findIndex(l => l.startsWith(SENTINELLE)); return (s < 0 ? L : L.slice(0, s)).filter(l => MARQUEURS.some(m => l.includes(m))).map(fragmentDe); };
            const lireRegistre = chemin => (fs.existsSync(chemin) ? fs.readFileSync(chemin, 'utf8') : null);       // fichier présent mais illisible : readFileSync LÈVE, le banc échoue
            const cellulesDe = ligne => ligne.split(/(?<!\\)\|/).slice(1, -1).map(c => c.trim());
            // jugement pur : les fragments sans verdict (aucune ligne du §10 dont la 1re cellule le porte, ou verdict vide), et les fragments non uniques
            const jugerDettes = (registre, section) => {
                const fragments = dettesDe(registre), tab = section.split(/\r?\n/).filter(l => l.startsWith('|'));
                const sep = tab.findIndex(l => /^\|[\s:|-]+\|$/.test(l)), lignes = (sep < 0 ? tab : tab.slice(sep + 1)).map(cellulesDe).filter(c => c.length >= 4);   // l'en-tête et le séparateur ne sont pas des verdicts
                const sans = fragments.filter(f => { const l = lignes.filter(c => normaliser(c[0]).startsWith(f)); return l.length !== 1 || l[0][3].length < 8; });
                const doubles = [...new Set(fragments.filter((f, i) => fragments.indexOf(f) !== i))];
                // sens inverse : un verdict dont la 1re cellule ne retrouve aucune ligne marquée du périmètre
                const orphelins = lignes.filter(c => !fragments.some(f => normaliser(c[0]).startsWith(f))).map(c => normaliser(c[0]).slice(0, 40));
                return { trouvees: fragments.length, verdicts: lignes.length, sans, doubles, orphelins };
            };
            // accepté seulement si : au moins une ligne marquée (0 = clé fausse), tout fragment a UN verdict, aucun doublon, aucun verdict orphelin, effectifs ÉGAUX
            const verdictGlobal = j => j.trouvees > 0 && j.sans.length === 0 && j.doubles.length === 0 && j.orphelins.length === 0 && j.trouvees === j.verdicts;
            const doc = fs.readFileSync(path.join(__dirname, '..', '..', 'AUDIT-SECURITE-V2.md'), 'utf8');
            const i10 = doc.indexOf('## 10.'), i11 = doc.indexOf('## 11.'), sect = i10 >= 0 && i11 > i10 ? doc.slice(i10, i11) : '';
            // ── preuve de l'INSTRUMENT sur un registre fabriqué : insérer ou retirer des lignes AILLEURS ne change rien ; retirer un verdict, si ; la sentinelle borne le périmètre
            {
                const l1 = '- Task Z1: parked — première dette fabriquée du banc', l2 = '- Task Z2: minor (deferred): seconde dette fabriquée du banc';
                const sectionZ = `| ${fragmentDe(l1)} | Z1 | dette un | assumée : fabriquée |\n| ${fragmentDe(l2)} | Z2 | dette deux | assumée : fabriquée |`;
                const base = ['- ligne ordinaire 1', l1, '- ligne ordinaire 2', l2, '- ligne ordinaire 3'].join('\n');
                const decale = ['- insérée en tête', '- insérée en tête bis', '- ligne ordinaire 1', '- insérée au milieu', l1, l2, '- ligne ordinaire 3'].join('\n');   // lignes insérées, une ordinaire retirée, tous les numéros changent
                const apres = `${base}\n- **Task B8: complete (fabriquée)\n- Task Z3: minor (deferred): dette écrite APRÈS la sentinelle`;
                const sansSentinelle = `${base}\n- Task Z3: minor (deferred): dette écrite sans sentinelle`;
                H.v('N1 instrument : registre fabriqué — 2 dettes, 2 verdicts', [jugerDettes(base, sectionZ).trouvees, jugerDettes(base, sectionZ).sans], [2, []]);
                H.v('N1 instrument : des lignes INSÉRÉES et RETIRÉES ailleurs (les numéros de ligne changent tous) ne changent rien', jugerDettes(decale, sectionZ), { trouvees: 2, verdicts: 2, sans: [], doubles: [], orphelins: [] });
                H.v('N1 instrument : une dette écrite APRÈS la sentinelle n\'est pas jugée', [jugerDettes(apres, sectionZ).trouvees, jugerDettes(apres, sectionZ).sans], [2, []]);
                H.v('N1 instrument : SANS sentinelle, tout le fichier est jugé (la dette de plus n\'a pas de verdict : le banc tomberait)', jugerDettes(sansSentinelle, sectionZ).sans.map(f => f.slice(0, 20)), ['Task Z3: minor (defe']);
                H.v('N1 instrument : un verdict retiré ou VIDE fait tomber le banc', [jugerDettes(base, sectionZ.split('\n')[0]).sans.length, jugerDettes(base, sectionZ.replace(/assumée : fabriquée/g, '')).sans.length], [1, 2]);
                H.v('N1 instrument : deux dettes au même fragment sont signalées (le fragment doit être UNIQUE)', jugerDettes(`${l1}\n${l1}`, sectionZ).doubles.length, 1);
                // N3 : la correspondance est BIDIRECTIONNELLE et COMPTÉE ; zéro ligne marquée sur un registre présent n'est pas un monde vide mais une clé fausse (CLAUDE.md §41)
                const sectionPlus = `${sectionZ}\n| ${fragmentDe('- Task Z9: parked — verdict sans ligne au registre')} | Z9 | dette neuf | assumée : fabriquée |`;
                const sentinelleEnTete = ['- **Task B8: complete (en première ligne)', l1, l2].join('\n');
                const sansMarqueur = '- ligne ordinaire 1\n- ligne ordinaire 2\n- ligne ordinaire 3';
                H.vrai('N3 instrument : un registre cohérent (2 lignes, 2 verdicts) est accepté', verdictGlobal(jugerDettes(base, sectionZ)));
                H.vrai('N3 instrument : des lignes insérées/retirées ailleurs restent acceptées', verdictGlobal(jugerDettes(decale, sectionZ)));
                H.vrai('N3 instrument : un registre NON VIDE SANS AUCUN marqueur est REFUSÉ (0 ligne, 0 verdict ne passe plus)', !verdictGlobal(jugerDettes(sansMarqueur, sectionZ)) && !verdictGlobal(jugerDettes(sansMarqueur, '')));
                H.vrai('N3 instrument : la sentinelle en PREMIÈRE ligne (périmètre vide) est REFUSÉE', !verdictGlobal(jugerDettes(sentinelleEnTete, sectionZ)));
                H.vrai('N3 instrument : un §10 avec un verdict de PLUS que le registre est REFUSÉ (effectifs inégaux, orphelin nommé)', !verdictGlobal(jugerDettes(base, sectionPlus)) && jugerDettes(base, sectionPlus).orphelins.length === 1);
                H.v('N3 instrument : les deux effectifs sont comptés', [jugerDettes(base, sectionPlus).trouvees, jugerDettes(base, sectionPlus).verdicts], [2, 3]);
                let leve = null; try { lireRegistre(__dirname); } catch (e) { leve = e.code || e.name; }
                H.vrai('N1 instrument : un registre présent mais illisible (ici un dossier) LÈVE — un échec de lecture reste un échec', Boolean(leve));
            }
            const prog = process.env.RM_PROGRESS || 'C:\\Users\\Yung\\Desktop\\pokemon-proxy-api-v2\\.superpowers\\sdd\\PLAN-API-V2\\progress.md';
            const registre = lireRegistre(prog);
            if (registre === null) console.log('   SAUT DIT : le registre (progress.md ; variable RM_PROGRESS, sinon le chemin du poste du coordinateur) est absent de cette machine : énumération des dettes NON jouée');
            else {
                const j = jugerDettes(registre, sect), sentinelle = registre.split(/\r?\n/).some(l => l.startsWith(SENTINELLE));
                console.log(`   registre lu (${process.env.RM_PROGRESS ? 'copie RM_PROGRESS' : 'chemin du poste'}), sentinelle ${sentinelle ? 'présente' : 'absente (tout le fichier est jugé)'} : ${j.trouvees} lignes de dette trouvées, ${j.trouvees - j.sans.length} verdicts au §10`);
                H.v(`I-2 : ${j.trouvees} lignes trouvées, ${j.trouvees - j.sans.length} verdicts (les fragments sans verdict sont listés)`, j.sans, []);
                H.v('I-2 : chaque fragment est UNIQUE parmi les lignes de dette jugées', j.doubles, []);
                console.log(`   N3 : ${j.trouvees} lignes marquées dans le registre, ${j.verdicts} verdicts au §10, ${j.orphelins.length} verdict(s) sans ligne`);
                H.vrai(`N3 : un registre présent rend au moins une ligne marquée (${j.trouvees}) — zéro sur un registre non vide est une clé fausse`, j.trouvees > 0);
                H.v('N3 : chaque verdict du §10 retrouve sa ligne au registre (verdicts sans ligne)', j.orphelins, []);
                H.v('N3 : effectifs ÉGAUX, lignes marquées / verdicts', [j.trouvees, j.verdicts], [j.trouvees, j.trouvees]);
                H.vrai('N3 : verdict global (au moins une ligne, un verdict chacune, aucun orphelin, effectifs égaux)', verdictGlobal(j));
            }
        }
        // TURNSTILE_SECRET absent : le pilote réel LÈVE (503), il n'accepte jamais « faute de secret » ; sans pilote branché, l'inscription ferme aussi
        const { verifierTurnstile } = require('../comptes/turnstile'); let e1 = null; try { await verifierTurnstile('jeton', '1.1.1.1', { secret: undefined }); } catch (e) { e1 = e.message; }
        H.v('step 6 : TURNSTILE_SECRET absent → le pilote réel lève (inscription : 503), jamais « accepté »', e1, 'turnstile-non-configure');
    }
    // ═══════════════ STEP 3 : les journaux ═══════════════
    await require('../comptes/service').attendre(); await attendre(300);
    {
        const fuites = [];
        for (const s of secrets) { const [lib, valeur] = JSON.parse(s); const trouve = journaux.find(l => l.includes(valeur)); if (trouve) fuites.push(`${lib} (${valeur.length} caractères) dans « ${trouve.replace(valeur, '‹…›').slice(0, 160)} »`); }
        // une adresse ou une IP « entière » sous une autre forme que celle fabriquée (le motif, pas la liste)
        const motifs = journaux.filter(l => /[\w.+-]+@[\w-]+\.[a-z]{2,}/i.test(l) && !/@(exemple\.fr)/i.test(l) && false);
        console.log(`   journaux captés : ${journaux.length} lignes ; secrets fabriqués par le banc : ${secrets.size}`);
        H.v('step 3 : aucun secret (jeton, session, code, lien, Idempotency-Key, e-mail, IP) dans les journaux', fuites, []);
        H.vrai('step 3 : contrôle de l\'instrument — le détecteur voit un secret écrit au journal', (() => { const s = 'secret-de-controle-abcdef'; journaux.push(`x ${s}`); const v = journaux.find(l => l.includes(s)); journaux.pop(); return Boolean(v); })());
        void motifs;
    }
    // ── les écarts du Step 1, un par ligne
    for (const e of ecarts) console.log(`   ÉCART ${e}`);
    H.v(`ensemble des écarts (step 1 à 4) : ${ecarts.length}`, ecarts.length, 0);
    await sv.fermer();
    await mongoose.disconnect();
    await H.arreterBanc();
    H.bilan();
})().catch(async e => { sortie.error('❌ banc en échec :', e); try { await H.arreterBanc(); } catch (_) { } process.exit(1); });
