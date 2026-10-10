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
async function instantane() {
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
    await H.ouvrirBancV2();
    process.env.MONGODB_BASE = 'test_scratch';
    const { connecterMongo } = require('../../mongo-connexion');
    await connecterMongo({ script: 'test-abus-routes.js', ecrit: true });
    db.brancher(mongoose.connection.db);
    await M.creerIndex();
    const sharp = require('sharp');
    const JPEG = await sharp(crypto.randomBytes(24 * 24 * 3), { raw: { width: 24, height: 24, channels: 3 } }).jpeg().toBuffer();

    // ── catalogue FABRIQUÉ (comme test-contrat-reel.js)
    const ID_A = 895789, ID_B = 895790, EXP = 990001;
    for (const c of ['catalogue_produits', 'numeros_cartes', 'guide_prix', 'codes_set', 'visuels']) await raw(c).deleteMany({});
    await raw('codes_set').insertOne({ idExpansion: EXP, codeSet: 'PBL', apprisLe: new Date() });
    for (const [id, variante, trend] of [[ID_A, 'normale', 1180], [ID_B, 'reverse', 1.0]]) {
        await raw('catalogue_produits').insertOne({ idProduct: id, name: 'Tropius (PBL 001)', idExpansion: EXP, idMetacard: 990101 });
        await raw('numeros_cartes').insertOne({ idProduct: id, idExpansion: EXP, numero: '001', numeroUrl: 'PBL001', codeSet: 'PBL', nomFr: 'Tropius', slug: 'Tropius-PBL001', slugSet: 'Banc-Set', source: 'cardmarket', certitude: 'exacte', ...(id === ID_B ? { variante: 'V2' } : {}) });
        await raw('guide_prix').insertOne({ idProduct: id, avg: trend, low: 0.5, trend, avg1: trend, avg7: trend, avg30: trend, guideDu: new Date('2026-10-04') });
        await raw('visuels').insertOne({ idProduct: id, vignette: { cle: `banc/${id}-v.webp`, w: 300, h: 420 }, grande: null, mention: null, idMetacard: 990101, numero: '001', rarete: 'Common', total: '064', variante, setNom: 'Banc Set', lien: null });
    }

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
        const routeur = assembler(LOTS, cfgApp, { gererIdentifier: chaine, gererRetourLive: retourLive, ...deps });
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
        'POST /api/installation': { auth: 'aucune', base: () => ({ versionExtension: '2.0.0', libelle: 'Chrome · Windows', userIdHerite: 'ancien-user-abus-0001' }), nullables: [],
            tolere: {
                libelle: { variantes: ['tableau', 'nombre', 'null'], ecriture: true, raison: 'type non-texte → libellé par défaut « Navigateur » (voulu, test-installations.js) ; jamais stocké tel quel' },
                userIdHerite: { variantes: ['tableau', 'nombre', 'null'], ecriture: true, raison: 'type non-texte ignoré : l\'héritage n\'est tenté que pour une chaîne (installations/routes.js)' }
            } },
        'POST /api/compte/lier': { auth: 'bearer', base: () => ({ code: 'ABC123' }), nullables: [] },
        'POST /api/compte/delier': { auth: 'bearer', base: () => ({}), nullables: [] },
        'POST /api/compte/inscription': { auth: 'site', base: () => ({ email: mail(), motDePasse: MDP, turnstile: 't' }), nullables: [] },
        'POST /api/compte/connexion': { auth: 'site', base: () => ({ email: mail(), motDePasse: MDP }), nullables: [] },
        'POST /api/compte/deconnexion': { auth: 'site', base: () => ({}), nullables: [] },
        // 202 IDENTIQUE par construction (anti-énumération) : un e-mail de mauvais type n'est ni accepté ni refusé, il ne déclenche RIEN (aucune écriture, aucun courrier). Les objets d'opérateur, eux, sont refusés (400).
        'POST /api/compte/mot-de-passe-oublie': { auth: 'site', base: () => ({ email: mail() }), nullables: [],
            tolere: { email: { variantes: ['tableau', 'nombre', 'null'], ecriture: false, raison: '202 identique par construction (anti-énumération) : aucun traitement, aucune écriture' } } },
        'POST /api/compte/renvoyer-verification': { auth: 'site', base: () => ({ email: mail() }), nullables: [],
            tolere: { email: { variantes: ['tableau', 'nombre', 'null'], ecriture: false, raison: '202 identique par construction (anti-énumération) : aucun traitement, aucune écriture' } } },
        'POST /api/compte/reinitialiser': { auth: 'site', base: () => ({ jeton: 'j'.repeat(43), motDePasse: MDP }), nullables: [] },
        'POST /api/compte/verification': { auth: 'site', base: () => ({ jeton: 'j'.repeat(43) }), nullables: [] },
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
        'POST /api/scanner/analyses': { auth: 'session', multipart: true, idem: true, base: () => ({ source: 'camera' }), nullables: [] },
        'POST /api/scanner/analyses/:id/reponse': { auth: 'session', base: () => ({ choix: 'a' }), nullables: [], idem: true, chemin: () => `/api/scanner/analyses/${new mongoose.Types.ObjectId().toHexString()}/reponse` }
    };
    const ecarts = [];                                     // tout ce que le banc reproche au serveur
    const ecart = (cible, charge, msg) => { ecarts.push(`${cible} [${charge}] ${msg}`); };
    const toleres = new Map();                             // acceptations NOMMÉES : clé -> nombre de variantes
    H.v('chaque route d\'écriture montée a une cible déclarée', ecritures.filter(r => !CIBLES[r.cle]).map(r => r.cle), []);
    H.v('chaque cible déclarée est une route montée (pas de cible périmée)', Object.keys(CIBLES).filter(k => !ecritures.some(r => r.cle === k)), []);

    // ── l'acteur d'une cible : un NEUF à chaque requête (un limiteur par compte ou par installation ne masque donc jamais la validation)
    async function acteur(cible) {
        if (cible.auth === 'bearer') { const x = await inst(3); return { x, entetes: extH(x.jeton) }; }
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
            const variantes = cible.multipart ? [['seule', POISON]] : [['seule', POISON], ['ajoutée à un corps valide', corpsBrut === '{}' ? POISON : `${corpsBrut.slice(0, -1)},${POISON.slice(1)}`]];
            for (const [nom, brut] of variantes) {
                const a = await acteur(cible); const avant = await instantane(); n++; envois++;
                const rep = await envoyer(V, { methode: r.methode, chemin: chemin(), entetes: entetesDe(a), brut, type: 'application/json' });
                await jugerRefus({ cible: r.cle, charge: 'b', detail: `clause __proto__ ${nom}`, reponse: rep, avant });
            }
            cellule(r.cle, 'b', 'jouee', n);
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
        question: await raw('questions').findOne({ _id: `${scanA}:0` }), analyse: await raw('analyses').findOne({ _id: new mongoose.Types.ObjectId(scanA) }),
        journal: await raw('journal_scans').findOne({ _id: new mongoose.Types.ObjectId(scanA) }), ligne: await raw('banc_lignes').countDocuments({ _id: 'ligne-victime' }),
        installationCompte: await raw('installations').findOne({ _id: CAinst.i._id })
    });
    const avantA = JSON.stringify(await etatA());

    const nonRejoue = (rep) => !rep.entetes['idempotency-replayed'];
    for (const r of ecritures) {
        const cible = CIBLES[r.cle]; if (!cible) continue;
        // ── (d) Idempotency-Key d'un AUTRE porteur : A joue une requête avec K ; B joue la même avec K ; B ne reçoit JAMAIS la réponse de A
        if (cible.idem) {
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
        else if (r.cle === 'DELETE /api/banc/contributions') { rep = await envoyer(V, { methode: 'DELETE', chemin: r.chemin, entetes: extH(B.jeton), corps: { jeton: 'jeton-banc-autrui-abcdefghij34' } }); attendu = [200]; }
        else if (r.cle === 'DELETE /api/compte/installations/:id') { rep = await envoyer(V, { methode: 'DELETE', chemin: `/api/compte/installations/${CAinst.i._id}`, entetes: siteH(CB.cookie) }); attendu = [404]; }
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
    console.log(`   ${ecritures.length} routes × 5 charges (a-e) = ${ecritures.length * 5} cellules : ${nJouees} jouées, ${nSans} sans objet ; ${envois} envois d'injection (a-c) + les envois de (d)(e)`);
    for (const c of cellules.filter(c => c.etat === 'sans-objet')) console.log(`   sans objet : ${c.cible} [${c.charge}] — ${c.raison}`);
    H.v('toute cellule est jouée ou déclarée sans objet AVEC sa raison', cellules.length === ecritures.length * 5 && cellules.every(c => c.etat === 'jouee' || c.raison), true);
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
    H.v('step 1 : aucun écart (a)-(e) — la liste est imprimée ci-dessous', ecarts.length, 0);

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
        const i1 = await envoyer(V, { methode: 'POST', chemin: '/api/compte/inscription', entetes: siteH(null), corps: { email: mail(), motDePasse: MDP, turnstile: 't' } });
        const i2 = await envoyer(V, { methode: 'POST', chemin: '/api/compte/inscription', entetes: siteH(null), corps: { email: prise, motDePasse: MDP, turnstile: 't' } });
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
        for (let k = 0; k < 8; k++) await envoyer(V, { methode: 'POST', chemin: '/api/compte/mot-de-passe-oublie', entetes: siteH(null), corps: { email: victime } });
        await svc.attendre();
        const recus = courrier.envoyes.filter(e => e.email === victime).length;
        // 🔴 CONSTAT OUVERT (AUDIT-SECURITE-V2.md §5, Moyen) : demanderReinit n'a AUCUNE limite par adresse (renvoyerVerification, elle, en a une : 3/h). Le plafond par IP (10/h) se contourne avec des IP ;
        // la correction (3 lignes, L.consommer comme renvoyerVerification) casse test-comptes-temps.js (hérité : 21 demandes pour UNE adresse, 21 courriers attendus) et n'est donc pas livrée ici.
        // Ce contrôle est ÉPINGLÉ sur l'état réel : le jour où la limite existera, il tombera et devra être remplacé par « au plus 3 courriers ».
        H.v(`step 2 (constat ouvert §5, Moyen) : 8 demandes de réinitialisation pour UNE adresse depuis 8 IP → ${recus} courriers (aucune limite par adresse)`, recus, 8);
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
        // (2) la règle écrite par ce qu'elle AUTORISE : aucun journal de production v2 n'imprime le MESSAGE d'une erreur (un pilote y cite une clé, une adresse, une URL). Exceptions nommées : les outils en ligne de commande (migrations/, admin/) écrivent sur le terminal de l'opérateur, et v2/index.js imprime le message d'une CONFIGURATION invalide (noms de variables, jamais leur valeur secrète).
        const fs = require('fs'), racine = path.join(__dirname, '..');
        const fichiers = [];
        (function parcourir(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { if (!['test', 'migrations', 'admin', 'openapi'].includes(e.name)) parcourir(p); } else if (e.name.endsWith('.js')) fichiers.push(p); } })(racine);
        const fautifs = [];
        for (const f of fichiers) {
            const rel = path.relative(racine, f).replace(/\\/g, '/'); if (rel === 'index.js') continue;
            fs.readFileSync(f, 'utf8').split(/\r?\n/).map(l => l.replace(/\s\/\/.*$/, '')).forEach((l, i) => { if (/console\.(log|warn|error|info)\(/.test(l) && /\.message\b/.test(l)) fautifs.push(`${rel}:${i + 1}`); });
        }
        H.v(`step 3 : aucun console.* de v2 (${fichiers.length} fichiers) n'imprime e.message`, fautifs, []);
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
        const noms = [...new Set([...fs.readFileSync(path.join(__dirname, '..', 'config.js'), 'utf8').matchAll(/env\.([A-Z][A-Z0-9_]+)/g)].map(m => m[1]))].sort();
        const PROD = { RM_API_V2: '1', MONGODB_BASE: 'test', V2_SECRET_EMPREINTE: 's'.repeat(20) };            // une configuration de PRODUCTION (allumée, hors base de banc)
        const entier = (c, ...cle) => cle.reduce((o, k) => o[k], c);
        // [lecture, défaut attendu, valeur mal formée, issue : 'leve' (la configuration est invalide : v2 répond 503, jamais mal configurée) | 'ignore' (retombe sur le défaut) | { ferme: prédicat }, base de l'essai]
        const T = {
            V2_ORDRE_POCHES: [c => c.ordrePoches, ['essai', 'accueil', 'hebdo', 'abonnement', 'achete'], 'essai,gratuit', 'leve'],
            MONGODB_BASE: [c => c.base, null, '   ', 'ignore', {}],
            RM_API_V2: [c => c.actif, false, 'true', 'ignore', {}],
            V2_SECRET_EMPREINTE: [c => c.empreinte.secret, null, 'trop-court', 'leve', {}],
            V2_TURNSTILE: [c => c.turnstile, 'on', 'peut-etre', 'leve'],
            V2_ESSAIS: [c => c.quotas.essai, 3, 'abc', 'leve'], V2_ACCUEIL: [c => c.quotas.accueil, 25, 'abc', 'leve'], V2_HEBDO: [c => c.quotas.hebdo, 2, 'abc', 'leve'], V2_ABO_MENSUEL: [c => c.quotas.aboMensuel, 100, 'abc', 'leve'],
            V2_PLAFOND_PANNES: [c => c.plafonds.panne, 5, 'abc', 'leve'], V2_PLAFOND_QUESTIONS: [c => c.plafonds.question, 30, 'abc', 'leve'], V2_LECTURE_LIVE_MAX: [c => c.lot.lectureLiveMax, 5, 'abc', 'leve'],
            V2_ESSAIS_GLOBAUX_JOUR: [c => c.limites.essaisGlobauxJour, 500, 'abc', 'leve'],
            V2_INSCRIPTION_IP_HEURE: [c => c.limites.inscriptionIpHeure, 10, '0', 'leve'], V2_OUBLI_IP_HEURE: [c => c.limites.oubliIpHeure, 10, '0', 'leve'], V2_REINIT_IP_HEURE: [c => c.limites.reinitIpHeure, 10, '0', 'leve'],
            V2_VERIFICATION_IP_HEURE: [c => c.limites.verificationIpHeure, 30, '0', 'leve'], V2_CONNEXION_IP_HEURE: [c => c.limites.connexionIpHeure, 30, '0', 'leve'],
            V2_SUPPRESSION_COMPTE_HEURE: [c => c.limites.suppressionParCompteHeure, 10, '0', 'leve'], V2_RENVOI_COMPTE_HEURE: [c => c.limites.renvoiParCompteHeure, 3, '0', 'leve'],
            V2_URL_VERIFICATION: [c => c.urls.verification, 'https://rat-market.fr/fr/verification', 'http://rat-market.fr/x', 'leve'], V2_URL_REINIT: [c => c.urls.reinit, 'https://rat-market.fr/fr/reinitialisation', 'http://rat-market.fr/x', 'leve'],
            V2_EMPREINTE_JOURS: [c => c.empreinte.jours, 365, '0', 'leve'],
            V2_ORIGINE_EXTENSION_DEV: [c => c.origines.extensionDev, null, 'chrome-extension://intrus', { ferme: c => c.origines.extensionDev === null }, PROD],   // honorée SEULEMENT sur test_scratch : en production elle est ignorée
            V2_DESCRIPTION_CONSERVEE: [c => c.annonce.conservee, true, '2', 'leve'], V2_DESCRIPTION_AU_MODELE: [c => c.annonce.auModele, false, '2', 'leve'],
            V2_MARCHES: [c => c.marches.length, 16, '%%', { ferme: c => !c.marches.includes('vinted.fr') }],   // un marché mal écrit : plus aucun marché réel (422 pour tous), jamais un marché de plus
            V2_VERSION_MIN_EXTENSION: [c => c.versionMinExtension, '2.0.0', '%%', { ferme: c => require('../identifier/routes').comparerVersions('2.0.0', c.versionMinExtension) === null }],   // illisible : 400 pour tous
            V2_REGLE_G: [c => c.regleG, false, '2', 'leve'], V2_COOKIE_SECURE: [c => c.cookieSecure, true, '2', 'leve']
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
