'use strict';
// AMORÇAGE-ESSAI (D4-BASE-DU-SERVICE-DE-TEST.md §5) — copie du CATALOGUE de la production (lue SEULEMENT) vers la base du service de TEST (`rm_essai`).
//
//   SIMULATION (par défaut, rien n'est écrit) : compte et poids de chaque collection, à la source ; l'état de la cible ; le total contre l'ARRÊT DUR.
//     node v2/migrations/amorcer-essai.js --base=rm_essai
//   COPIE :
//     node v2/migrations/amorcer-essai.js --base=rm_essai --executer
//   REPRISE après un arrêt au milieu (coupure réseau, seuil franchi, Ctrl-C) — la copie repart après le dernier _id présent dans la cible, sans doublon :
//     node v2/migrations/amorcer-essai.js --base=rm_essai --executer --reprendre
//   Ordre d'ensemble : (1) la simulation, (2) la copie, (3) node v2/migrations/creer-index.js --base=rm_essai (index propres à l'API, que la copie n'apporte pas).
//
// VARIABLES (des NOMS, jamais une valeur) : MONGODB_LECTURE_URI (utilisateur Atlas en LECTURE de la production, base `test`), MONGODB_ESSAI_URI (utilisateur `essai-amorcage`, readWrite rm_essai).
// Jamais MONGODB_URI : c'est l'URI d'ÉCRITURE de la production, ce script ne la lit que pour COMPARER son hôte.
//
// CE QUE LE SCRIPT AUTORISE (rien d'autre n'est possible) :
//  · SEPT collections, liste gelée ci-dessous (D4 §5). Toute autre — credits, journal_scans, quotas, remboursements, evenements_stripe, questions, comptes… — est impossible à lire par l'adaptateur de source.
//  · SOURCE = la base `test`, par une connexion dont les privilèges sont PROUVÉS en lecture seule (v2/chargeur/lecture-seule.js, la même garde que l'API) ; documents lus par la façade de lecture à liste fermée.
//  · CIBLE = la base `rm_essai`, par MONGODB_ESSAI_URI (mongo-connexion.js, seule option NOMMÉE autorisée à commencer sur du vide), sur un hôte qui n'est NI celui de la production NI celui des cartes NI celui de la source.
//  · LA CIBLE SE PROUVE côté serveur (tour 1, C1), avant toute lecture ou écriture : connectionStatus (l'utilisateur n'écrit QUE sur rm_essai, rôles readWrite/read@rm_essai) ET hello.setName connu et
//    DIFFÉRENT de celui de la source et de celui de cartes (MONGODB_CARTES_LECTURE_URI, lue le temps d'un hello). Cas non conclu = refus. mongo-connexion.js ne laisse passer le vide qu'APRÈS cette preuve.
//  · « TERMINÉE » ne se dit que si les comptes, les noms d'index ET la méta de la source (guide_prix_meta, catalogue_export_meta, relues avant/après) concordent ; le contenu document par document n'est PAS contrôlé, et le dit.
//  · CIBLE VIDE, ou RENDUE À UN ÉTAT DE COPIE que ce script a lui-même écrit (collection `_amorcage_etat`) ET --reprendre. Toute autre cible non vide est refusée, rien n'est écrit.
//  · ARRÊT DUR : avant chaque lot, poids mesuré de la cible (données + index) + octets du lot ≤ 480 Mo ; sinon la copie s'arrête AVANT de le franchir, et le dit.
//  · À LA FIN : compte source = compte cible, par collection, et mêmes noms d'index. Un écart = code 1, collection nommée, état « non terminé ».
// REPRISE SANS DOUBLON : les documents sont copiés dans l'ordre de _id ; le _id est unique dans la cible ; la reprise relit la source STRICTEMENT après le plus grand _id déjà présent
//   (un arrêt au milieu d'un lot laisse un préfixe, jamais un trou). ⚠️ Limite écrite : `$gt` ne compare qu'un même type BSON ; une collection aux _id de types mélangés ne reprendrait
//   pas tous ses documents — l'égalité finale des comptes le dit alors (code 1), elle ne laisse pas passer.
// ⚠️ La source est une base VIVANTE : un document ajouté pendant la copie, en deçà du point déjà copié, n'est pas vu — même garde finale, même verdict (relancer la simulation puis la copie).
// Aucune URI n'est jamais affichée ; une erreur du pilote n'est citée que par son nom et son code.
const fs = require('fs'); const path = require('path');

const COLLECTIONS_AUTORISEES = Object.freeze(['references_image', 'numeros_cartes', 'guide_prix', 'catalogue_produits', 'codes_set', 'catalogue_export_meta', 'guide_prix_meta']);
const BASE_SOURCE = 'test', BASE_CIBLE = 'rm_essai';
const ARRET_DUR_MO = 480;                // sur les 512 Mo d'une M0 (D4 §5) — la même unité que mesurer-taille-bases.js : 1 Mo = 1e6 octets, données + index
const ETAT = '_amorcage_etat';
const COLLECTIONS_META = Object.freeze(['guide_prix_meta', 'catalogue_export_meta']);   // ce que les imports de la production (guide 00:49, catalogue 05:00 et 12:15 UTC) mettent à jour
const TAILLE_LOT = 500;
const JOURNAL_PAR_DEFAUT = path.join(__dirname, '..', '..', 'backup-amorcage-essai', 'journal.jsonl');   // backup-*/ est ignoré par git

const mo = o => Number((o / 1e6).toFixed(1));
const nomCourt = x => String(x).slice(0, 60);
const cause = e => (e && (e.codeName || e.code || e.name)) || 'erreur';     // jamais e.message : un pilote peut y mettre une adresse

// ── 1. LES HÔTES : comparés, jamais affichés ──────────────────────────────────────────────────────────────────────────────
/** Les identités de serveur d'une URI mongodb(+srv)://. Hôte Atlas : ses trois derniers labels (le nom srv et les hôtes de shard d'une même grappe se confondent) ; autre hôte : hôte:port. [] si illisible. */
function clesDHotes(uri) {
    if (typeof uri !== 'string') return [];
    const m = /^mongodb(\+srv)?:\/\/(?:[^@/]*@)?([^/?#]+)/i.exec(uri.trim());
    if (!m) return [];
    const cles = [];
    for (let h of m[2].split(',')) {
        h = h.trim().toLowerCase();
        let port = null;
        const br = /^(\[[0-9a-f:.]+\])(?::(\d+))?$/.exec(h);
        if (br) { h = br[1]; port = br[2] || null; }
        else { const p = /^([a-z0-9._-]+?)(?::(\d+))?$/.exec(h); if (!p) return []; h = p[1].replace(/\.$/, ''); port = p[2] || null; }
        if (!h) return [];
        const l = h.split('.');
        cles.push(h.endsWith('.mongodb.net') && l.length >= 4 ? l.slice(-3).join('.') : `${h}:${port || '27017'}`);
    }
    return cles;
}
/** Un utilisateur ne se lit que dans l'URI : { ok, raison } — des NOMS de variables seulement. */
function jugerHotes(env) {
    const cible = clesDHotes(env.MONGODB_ESSAI_URI), lecture = clesDHotes(env.MONGODB_LECTURE_URI);
    if (!cible.length) return { ok: false, raison: 'MONGODB_ESSAI_URI est illisible : je ne peux pas dire où elle pointe, refusé (doute = refus).' };
    if (!lecture.length) return { ok: false, raison: 'MONGODB_LECTURE_URI est illisible : je ne peux pas dire où elle pointe, refusé (doute = refus).' };
    const production = new Set();
    for (const nom of ['MONGODB_URI', 'MONGODB_CARTES_URI', 'MONGODB_LECTURE_URI', 'MONGODB_CARTES_LECTURE_URI']) {
        if (env[nom] === undefined || env[nom] === '') continue;
        const c = clesDHotes(env[nom]);
        if (!c.length) return { ok: false, raison: `${nom} est illisible : je ne peux pas la comparer à la cible, refusé (doute = refus).` };
        c.forEach(x => production.add(x));
    }
    if (cible.some(c => production.has(c))) return { ok: false, raison: 'MONGODB_ESSAI_URI pointe l\'hôte (la grappe) de la production, des cartes ou de la source de lecture : refusé — la copie n\'écrit jamais là.' };
    if (env.MONGODB_URI) {
        const ecr = clesDHotes(env.MONGODB_URI);
        if (!lecture.some(c => ecr.includes(c))) return { ok: false, raison: 'MONGODB_LECTURE_URI ne pointe pas la grappe de MONGODB_URI (la production) : la source de la copie doit être la production, refusé.' };
    }
    return { ok: true };
}

// ── 2. LA SOURCE : un adaptateur à liste fermée ────────────────────────────────────────────────────────────────────────────
/** Ce que la copie peut faire de la production, et rien d'autre. `db` est la Db native d'une connexion DÉJÀ jugée en lecture seule ; elle ne sort jamais de ce module. */
function adapterSource(db) {
    const { facadeLecture } = require('../../collecte-cartes/facade-lecture');
    const facade = facadeLecture(db);
    const garde = nom => {
        if (!COLLECTIONS_AUTORISEES.includes(nom)) throw new Error(`🔴 « ${nomCourt(nom)} » n'est pas dans la liste des sept collections autorisées (D4 §5) : elle ne se lit pas.`);
        return nom;
    };
    return Object.freeze({
        nomBase: db.databaseName,
        async existe(nom) { return (await facade.listCollections({ name: garde(nom) }, { nameOnly: true }).toArray()).length > 0; },
        async compter(nom) { return facade.collection(garde(nom)).countDocuments({}); },
        async poids(nom) { const s = await db.command({ collStats: garde(nom) }); return { donnees: s.size, index: s.totalIndexSize }; },
        async indexes(nom) { return db.collection(garde(nom)).indexes(); },
        async lot(nom, apres, n) { return facade.collection(garde(nom)).find(apres === undefined ? {} : { _id: { $gt: apres } }).sort({ _id: 1 }).limit(n).toArray(); },
        /** L'identité du jeu de réplicas de la source (hello.setName), ou undefined si le serveur ne la donne pas. */
        async identite() { const h = await db.admin().command({ hello: 1 }); return h && typeof h.setName === 'string' && h.setName ? h.setName : undefined; },
        /** Les deux collections de MÉTA (date du guide, fichier d'export du catalogue), en entier, une chaîne par collection : ce que les imports de la production changent. */
        async meta() { const o = {}; for (const n of COLLECTIONS_META) o[n] = JSON.stringify(await facade.collection(garde(n)).find({}).sort({ _id: 1 }).toArray()); return o; }
    });
}

// ── 2bis. LA PREUVE DE LA CIBLE (tour 1, C1) : côté serveur, jamais par le nom d'un hôte ─────────────────────────────────────
// Une liste de noms d'hôtes est une liste de REFUS : un alias de la production, un point d'accès privé ou une troisième grappe n'y figurent pas, la cible y serait VIDE, et
// l'option du vide (mongo-connexion.js) retire justement le filet « une base réelle n'est jamais vide » (§50 : le contrôle juste porte sur ce que le cas redouté n'a PAS).
// Écrite par ce qu'elle AUTORISE, sur la connexion CIBLE elle-même :
//  (a) connectionStatus : l'utilisateur n'a d'actions d'écriture QUE sur la base rm_essai, et ses rôles sont readWrite/read sur rm_essai (aucun rôle d'une autre base, aucun rôle d'administration) ;
//  (b) hello.setName de la cible est connu, et DIFFÉRENT de celui de la source (la production) ET de celui de cartes ;
// tout cas non conclu (commande refusée, champ absent, erreur, cartes injoignable) BLOQUE et le dit. Aucune raison ne contient un nom d'utilisateur ni un setName.
const ROLES_ADMIS = Object.freeze(['readWrite', 'read']);
async function prouverCible(db, { source, ouvrirCartes, env = process.env } = {}) {
    const LS = require('../chargeur/lecture-seule');
    const refus = raison => ({ ok: false, raison });
    let statut;
    try { statut = await db.admin().command({ connectionStatus: 1, showPrivileges: true }); }
    catch { return refus('connectionStatus a échoué sur la cible : je ne peux pas prouver ce que son utilisateur peut écrire.'); }
    const info = statut && typeof statut === 'object' ? statut.authInfo : null;
    if (!info || typeof info !== 'object') return refus('connectionStatus sans authInfo : je ne sais pas ce que l\'utilisateur de la cible peut faire.');
    if (!Array.isArray(info.authenticatedUsers) || info.authenticatedUsers.length === 0) return refus('aucun utilisateur authentifié sur la cible : je ne sais pas qui écrit.');
    const roles = info.authenticatedUserRoles;
    if (!Array.isArray(roles) || roles.length === 0) return refus('liste des rôles de l\'utilisateur de la cible absente : je ne sais pas ce qu\'il est.');
    for (const r of roles) if (!r || typeof r !== 'object' || r.db !== BASE_CIBLE || !ROLES_ADMIS.includes(r.role)) return refus(`l'utilisateur de la cible porte un rôle autre que ${ROLES_ADMIS.join('/')} sur "${BASE_CIBLE}" : refusé (aucun rôle d'une autre base, aucun rôle d'administration).`);
    const privileges = info.authenticatedUserPrivileges;
    if (!Array.isArray(privileges) || privileges.length === 0) return refus('liste des privilèges de l\'utilisateur de la cible absente : je ne sais pas ce qu\'il peut écrire.');
    for (const p of privileges) {
        if (!p || typeof p !== 'object' || !Array.isArray(p.actions) || !p.resource || typeof p.resource !== 'object') return refus('un privilège illisible sur la cible : refusé.');
        const ecriture = p.actions.filter(a => typeof a !== 'string' || !LS.ACTIONS_DE_LECTURE.includes(a));
        const surRmEssai = p.resource.db === BASE_CIBLE && p.resource.cluster !== true;
        if (ecriture.length && !surRmEssai) return refus(`l'utilisateur de la cible a ${ecriture.length} action(s) d'écriture ou d'administration hors de la base "${BASE_CIBLE}" : refusé.`);
    }
    let h;
    try { h = await db.admin().command({ hello: 1 }); } catch { return refus('hello a échoué sur la cible : je ne peux pas dire quel jeu de réplicas c\'est.'); }
    const setCible = h && typeof h.setName === 'string' ? h.setName : '';
    if (!setCible) return refus('le jeu de réplicas de la cible n\'a pas de nom (hello.setName) : je ne peux pas prouver qu\'il n\'est pas la production.');
    let setSource;
    try { setSource = await source.identite(); } catch { return refus('la source ne sait pas dire son jeu de réplicas : je ne peux rien comparer.'); }
    if (typeof setSource !== 'string' || !setSource) return refus('le jeu de réplicas de la source est inconnu : je ne peux rien comparer.');
    if (setCible === setSource) return refus('la cible est le MÊME jeu de réplicas que la source (la production, sous un autre nom) : refusé.');
    let c = null;
    try {
        try { c = await ouvrirCartes(env); } catch { return refus('la grappe des cartes est injoignable : je ne peux pas comparer, refusé.'); }
        if (!c || c.ok !== true || typeof c.setName !== 'string' || !c.setName) return refus('l\'identité de la grappe des cartes est inconnue : je ne peux pas comparer, refusé.');
        if (setCible === c.setName) return refus('la cible est le MÊME jeu de réplicas que la grappe des cartes : refusé.');
        return { ok: true };
    } finally { if (c && typeof c.fermer === 'function') { try { await c.fermer(); } catch { /* déjà fermée */ } } }
}
/** La grappe des cartes, ouverte en LECTURE (MONGODB_CARTES_LECTURE_URI) le temps d'un hello. { ok, setName, fermer } | { ok: false, raison }. `connecter(uri)` injectable, rend { db, close }. */
async function ouvrirCartesParDefaut(env, { connecter = async uri => require('mongoose').createConnection(uri, { dbName: 'cartes', serverSelectionTimeoutMS: 20000 }).asPromise() } = {}) {
    const uri = env && typeof env.MONGODB_CARTES_LECTURE_URI === 'string' ? env.MONGODB_CARTES_LECTURE_URI.trim() : '';
    if (!uri) return { ok: false, raison: 'MONGODB_CARTES_LECTURE_URI absente : l\'identité de la grappe des cartes est inconnue, refusé.' };
    let cx = null;
    const fermer = async () => { try { if (cx) await cx.close(); } catch { /* déjà fermée */ } };
    try {
        cx = await connecter(uri);
        const h = await cx.db.admin().command({ hello: 1 });
        if (!h || typeof h.setName !== 'string' || !h.setName) { await fermer(); return { ok: false, raison: 'la grappe des cartes ne donne pas de nom de jeu de réplicas : refusé.' }; }
        return { ok: true, setName: h.setName, fermer };
    } catch (e) { await fermer(); return { ok: false, raison: `connexion à la grappe des cartes impossible (${cause(e)}).` }; }
}

async function connecterSourceParDefaut(uri) {
    const mongoose = require('mongoose');
    return mongoose.createConnection(uri, { dbName: BASE_SOURCE, serverSelectionTimeoutMS: 20000 }).asPromise();
}
/** Ouvre la source ou refuse en le disant. { ok, source, fermer } | { ok: false, raison }. `connecter(uri)` est injectable et rend { db, close }. */
async function ouvrirSourceParDefaut(env, { connecter = connecterSourceParDefaut } = {}) {
    const LS = require('../chargeur/lecture-seule');
    let cx = null;
    const fermer = async () => { try { if (cx) await cx.close(); } catch { /* déjà fermée */ } };
    try {
        cx = await connecter(env.MONGODB_LECTURE_URI);
        if (cx.db.databaseName !== BASE_SOURCE) { await fermer(); return { ok: false, raison: `la connexion de lecture est sur une autre base que "${BASE_SOURCE}" : refusé.` }; }
        let statut;
        try { statut = await cx.db.admin().command({ connectionStatus: 1, showPrivileges: true }); }
        catch { await fermer(); return { ok: false, raison: 'connectionStatus a échoué : je ne peux pas prouver que la source est en lecture seule, refusé.' }; }
        const p = LS.jugerPrivileges(statut);
        if (!p.ok) { await fermer(); return { ok: false, raison: `MONGODB_LECTURE_URI : ${p.raison}` }; }
        return { ok: true, source: adapterSource(cx.db), fermer };
    } catch (e) { await fermer(); return { ok: false, raison: `connexion à la source impossible (${cause(e)}).` }; }
}

// ── 3. LA CIBLE : mongo-connexion.js (grappe, nom, contrôles), avec l'option NOMMÉE du vide ───────────────────────────────
async function ouvrirCibleParDefaut(env, { preuve } = {}) {
    const { connecterMongo } = require('../../mongo-connexion');
    const mongoose = require('mongoose');
    // l'option du vide ne s'obtient qu'avec la PREUVE de la cible (mongo-connexion.js la joue avant d'accepter le vide)
    const base = await connecterMongo({ script: 'v2/migrations/amorcer-essai.js', ecrit: true, baseVideAutorisee: true, preuveCible: preuve });
    return { ok: true, db: mongoose.connection.db, nomBase: base, fermer: async () => { await mongoose.disconnect(); } };
}
async function poidsCibleParDefaut(db) { const s = await db.command({ dbStats: 1 }); return s.dataSize + s.indexSize; }
function journalParDefaut(ligne) {
    fs.mkdirSync(path.dirname(JOURNAL_PAR_DEFAUT), { recursive: true });
    fs.appendFileSync(JOURNAL_PAR_DEFAUT, JSON.stringify(ligne) + '\n');
}

// ── 4. LES ARGUMENTS : une garde s'écrit par ce qu'elle AUTORISE ───────────────────────────────────────────────────────────
function lireArguments(args) {
    const r = { executer: false, reprendre: false, base: null, collections: null };
    for (const a of args) {
        let m;
        if (a === '--executer') r.executer = true;
        else if (a === '--reprendre') r.reprendre = true;
        else if ((m = /^--base=(.*)$/.exec(a))) r.base = m[1];
        else if ((m = /^--collections=(.*)$/.exec(a))) r.collections = m[1].split(',').map(x => x.trim());
        else return { ok: false, raison: `argument non reconnu « ${nomCourt(a)} » (admis : --base=rm_essai, --executer, --reprendre, --collections=<liste>).` };
    }
    if (r.base !== BASE_CIBLE) return { ok: false, raison: `la seule cible est --base=${BASE_CIBLE} (reçu : ${r.base === null ? 'rien' : `« ${nomCourt(r.base)} »`}). La production n'est jamais une cible.` };
    if (r.collections) {
        const hors = r.collections.filter(c => !COLLECTIONS_AUTORISEES.includes(c));
        if (hors.length || !r.collections.length) return { ok: false, raison: `--collections= : « ${hors.map(nomCourt).join(', ') || '(vide)'} » n'est pas dans la liste autorisée (${COLLECTIONS_AUTORISEES.join(', ')}).` };
    }
    if (r.reprendre && !r.executer) return { ok: false, raison: '--reprendre n\'a de sens qu\'avec --executer.' };
    return { ok: true, ...r };
}

// ── 5. LE PROGRAMME ──────────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * @param {string[]} args  les arguments (sans node ni le script)
 * @param {object} env     l'environnement (des URI : jamais affichées)
 * @param {object} deps    ouvrirSource(env) · ouvrirCible(env) · journal(ligne) · poidsCible(db) · seuilOctets · tailleLot · apresLot({collection, copies, lot}) — les trois derniers pour les bancs
 * @returns {Promise<number>} le code de sortie
 */
async function principal(args = process.argv.slice(2), env = process.env, deps = {}) {
    const say = (...a) => console.log(...a);
    const stop = m => { console.error(`❌ ARRÊT : ${m}`); return 1; };
    const A = lireArguments(args);
    if (!A.ok) return stop(A.raison);
    for (const nom of ['MONGODB_ESSAI_URI', 'MONGODB_LECTURE_URI'])
        if (!env[nom] || !String(env[nom]).trim()) return stop(`${nom} est absente : aucune connexion, aucun repli (D4 §4).`);
    if (env.MONGODB_URI && String(env.MONGODB_LECTURE_URI).trim() === String(env.MONGODB_URI).trim()) return stop('MONGODB_LECTURE_URI est égale à MONGODB_URI (l\'écriture de la production) : la source doit être un utilisateur en LECTURE.');
    if (env.MONGODB_URI) {
        const LS = require('../chargeur/lecture-seule');
        const u = LS.utilisateurDe(env.MONGODB_LECTURE_URI);
        if (u && u === LS.utilisateurDe(env.MONGODB_URI)) return stop('MONGODB_LECTURE_URI porte le même utilisateur que MONGODB_URI : la source doit être un utilisateur en LECTURE.');
    }
    const h = jugerHotes(env);
    if (!h.ok) return stop(h.raison);

    const seuil = deps.seuilOctets !== undefined ? deps.seuilOctets : ARRET_DUR_MO * 1e6;
    const tailleLot = deps.tailleLot || TAILLE_LOT;
    const poidsCible = deps.poidsCible || poidsCibleParDefaut;
    const journal = deps.journal || journalParDefaut;
    const noms = A.collections || [...COLLECTIONS_AUTORISEES];

    const so = await (deps.ouvrirSource || ouvrirSourceParDefaut)(env);
    if (!so.ok) return stop(so.raison);
    try {
        const source = so.source;
        if (source.nomBase !== BASE_SOURCE) return stop(`la source est la base "${nomCourt(source.nomBase)}" et non "${BASE_SOURCE}" : refusé.`);
        // la PREUVE de la cible : jouée par mongo-connexion.js AVANT d'accepter le vide (ouvreur par défaut), et rejouée ici avant toute lecture ou écriture de la cible
        const preuve = db => (deps.prouverCible || prouverCible)(db, { source, ouvrirCartes: deps.ouvrirCartes || ouvrirCartesParDefaut, env });
        const co = await (deps.ouvrirCible || ouvrirCibleParDefaut)(env, { preuve });
        if (!co.ok) return stop(co.raison);
        try { return await corps({ A, source, cible: co.db, noms, seuil, tailleLot, poidsCible, journal, deps, say, stop, preuve }); }
        finally { await co.fermer(); }
    } finally { await so.fermer(); }
}

async function corps({ A, source, cible, noms, seuil, tailleLot, poidsCible, journal, deps, say, stop, preuve }) {
    if (cible.databaseName !== BASE_CIBLE) return stop(`la cible est la base "${nomCourt(cible.databaseName)}" et non "${BASE_CIBLE}" : refusé.`);
    let pr = null;
    try { pr = await preuve(cible); } catch { pr = null; }
    if (!pr || pr.ok !== true) return stop(`la cible n'est pas prouvée — ${(pr && typeof pr.raison === 'string' && pr.raison) || 'je ne sais pas'}. Rien n'est lu ni écrit dans la cible.`);
    say(`🗄️  Source : "${BASE_SOURCE}" (production, LECTURE SEULE)   →   cible : "${BASE_CIBLE}"`);
    say(A.executer ? (A.reprendre ? '▶️  COPIE — reprise' : '▶️  COPIE') : '🔎 SIMULATION — rien n\'est écrit (--executer pour copier)');

    // ── le plan, à la source
    const plan = [];
    for (const nom of noms) {
        if (!(await source.existe(nom))) return stop(`la collection « ${nom} » est absente de la source : une copie sans elle serait un catalogue amputé, refusé.`);
        const n = await source.compter(nom), p = await source.poids(nom), idx = await source.indexes(nom);
        plan.push({ nom, n, donnees: p.donnees, index: p.index, idx: idx.filter(i => i.name !== '_id_') });
    }
    const total = plan.reduce((a, c) => a + c.donnees + c.index, 0);
    say(`\nSource, par collection :`);
    for (const c of plan) say(`   ${c.nom.padEnd(24)} ${String(c.n).padStart(9)} documents · données ${String(mo(c.donnees)).padStart(7)} Mo · index ${String(mo(c.index)).padStart(6)} Mo · ${c.idx.length} index hors _id`);
    say(`   → total à copier : ${mo(total)} Mo (données + index) ; ARRÊT DUR : ${mo(seuil)} Mo`);
    if (total > seuil) return stop(`le total source (${mo(total)} Mo) dépasserait l'arrêt dur de ${mo(seuil)} Mo : la copie ne démarre pas, rien n'est écrit.`);
    // la MÉTA de la source au début (date du guide, fichier d'export) : relue à la fin ; si elle a bougé, un import de la production a eu lieu pendant la copie
    const metaDebut = await source.meta();
    const nomsChanges = (avant, apres) => COLLECTIONS_META.filter(n => avant[n] !== apres[n]);
    const CONSEIL_FENETRES = 'Relancer HORS des fenêtres d\'import de la production (guide : 00:49 UTC ; catalogue : 05:00 et 12:15 UTC) : supprimer les collections de "rm_essai" (utilisateur essai-amorcage), puis refaire la simulation et la copie.';

    // ── la cible : vide, ou reprenable, ou refus
    const presentes = (await cible.listCollections({}, { nameOnly: true }).toArray()).map(c => c.name);
    const etat = presentes.includes(ETAT) ? await cible.collection(ETAT).findOne({ _id: 'amorcage' }) : null;
    if (presentes.length === 0) {
        if (A.reprendre) return stop('--reprendre : la cible est vide, il n\'y a rien à reprendre (lancer sans --reprendre).');
        say('\nCible : VIDE.');
    } else {
        if (!etat) return stop(`la cible n'est pas vide (${presentes.length} collection(s)) et ne porte aucun état de copie (« ${ETAT} ») : je ne la reprends pas, je n'écris rien. Elle doit être vide, ou être l'état d'une copie que ce script a commencée.`);
        const etrangeres = presentes.filter(n => n !== ETAT && !COLLECTIONS_AUTORISEES.includes(n));
        if (etrangeres.length) return stop(`la cible porte des collections hors de la liste autorisée : ${etrangeres.map(nomCourt).join(', ')}. Je ne la reprends pas.`);
        if (A.executer && !A.reprendre) return stop(`une copie existe déjà dans la cible (${etat.termine ? 'terminée' : 'interrompue'}, commencée le ${etat.debut instanceof Date ? etat.debut.toISOString() : '?'}) : --reprendre pour la continuer ; rien n'a été écrit.`);
        if (A.executer) {
            // une reprise suppose que la source n'a pas changé de GUIDE ni de CATALOGUE depuis le début de la copie : sinon la cible mélangerait deux états de la production
            let avant = null; try { avant = typeof etat.metaDebut === 'string' ? JSON.parse(etat.metaDebut) : null; } catch { avant = null; }
            if (!avant) return stop('l\'état de la copie ne porte pas l\'empreinte de la méta de la source : je ne sais pas si elle a changé depuis le début, je ne reprends pas, rien n\'est écrit.');
            const diff = nomsChanges(avant, metaDebut);
            if (diff.length) return stop(`« ${diff.join('», « ')} » a changé à la source depuis le début de la copie (un import de la production a eu lieu) : la reprise mélangerait deux états. ${CONSEIL_FENETRES}`);
        }
        say(`\nCible : copie ${etat.termine ? 'TERMINÉE' : 'INTERROMPUE'} détectée — ${A.executer ? 'reprise' : 'relancer avec --executer --reprendre pour la reprendre'}.`);
    }
    if (!A.executer) { say(`\n✅ Simulation terminée : rien n'a été écrit. Pour copier : node v2/migrations/amorcer-essai.js --base=${BASE_CIBLE} --executer`); return 0; }

    // ── la copie
    const ecrireEtat = champs => cible.collection(ETAT).updateOne({ _id: 'amorcage' }, champs, { upsert: true });
    if (!etat) await ecrireEtat({ $set: { debut: new Date(), collections: noms, termine: false, comptesSource: Object.fromEntries(plan.map(c => [c.nom, c.n])), metaDebut: JSON.stringify(metaDebut) } });
    else await ecrireEtat({ $set: { termine: false }, $push: { reprises: new Date() } });
    const metaReference = etat ? JSON.parse(etat.metaDebut) : metaDebut;   // le début de la copie ENTIÈRE, pas de cette exécution

    const interrompre = async (nom, copies, raison) => {
        journal({ le: new Date().toISOString(), collection: nom, etat: 'interrompue', copies, raison });
        console.error(`❌ ARRÊT : ${raison}`);
        console.error(`   Copie PARTIELLE dans « ${BASE_CIBLE} » (« ${nom} » : ${copies} document(s) copiés par cette exécution dans cette collection). Elle se reprend, sans doublon, par :`);
        console.error(`     node v2/migrations/amorcer-essai.js --base=${BASE_CIBLE} --executer --reprendre`);
        return 1;
    };
    for (const c of plan) {
        const col = cible.collection(c.nom);
        if (!(await cible.listCollections({ name: c.nom }, { nameOnly: true }).toArray()).length) await cible.createCollection(c.nom);
        let avantN = 0, copies = 0;
        try {
            if (c.idx.length) await col.createIndexes(c.idx.map(({ v, ns, background, ...spec }) => spec));
            const dernier = await col.find({}, { projection: { _id: 1 } }).sort({ _id: -1 }).limit(1).toArray();
            let apres = dernier.length ? dernier[0]._id : undefined;
            avantN = await col.countDocuments({});
            if (apres !== undefined) say(`↻ « ${c.nom} » : reprise après le plus grand _id présent (${await col.countDocuments({})} document(s) déjà copiés).`);
            for (; ;) {
                const lot = await source.lot(c.nom, apres, tailleLot);
                if (!lot.length) break;
                // l'estimation du poids que ce lot ajoute : ses octets, MAJORÉS de la part d'index de cette collection à la source (les index grossissent avec les documents)
                const octets = Math.ceil(lot.reduce((a, d) => a + require('mongoose').mongo.BSON.calculateObjectSize(d), 0) * (1 + c.index / Math.max(c.donnees, 1)));
                const mesure = await poidsCible(cible);
                if (mesure + octets > seuil) return await interrompre(c.nom, copies, `ARRÊT DUR avant de franchir ${mo(seuil)} Mo : la cible pèse ${mo(mesure)} Mo et le lot suivant ajoute ${mo(octets)} Mo.`);
                await col.insertMany(lot, { ordered: true });
                apres = lot[lot.length - 1]._id; copies += lot.length;
                if (deps.apresLot) await deps.apresLot({ collection: c.nom, copies, lot: lot.length });
            }
            await ecrireEtat({ $set: { [`faites.${c.nom}`]: new Date() } });
            say(`✔️  « ${c.nom} » : ${copies} document(s) copiés par cette exécution.`);
        } catch (e) {
            // le VRAI nombre de documents copiés : ce que la collection porte maintenant moins ce qu'elle portait au début de cette exécution (un lot coupé en deux en a écrit une partie)
            let reels = copies; try { reels = (await col.countDocuments({})) - avantN; } catch { /* cible injoignable : le décompte des lots entiers fait foi */ }
            return await interrompre(c.nom, reels, `copie de « ${c.nom} » interrompue (${cause(e)}).`);
        }
    }

    // ── le contrôle final : compte source = compte cible, mêmes index
    say(`\nContrôle final :`);
    let ecarts = 0;
    for (const c of plan) {
        const s = await source.compter(c.nom), k = await cible.collection(c.nom).countDocuments({});
        const iS = (await source.indexes(c.nom)).map(i => i.name).sort().join('|'), iC = (await cible.collection(c.nom).indexes()).map(i => i.name).sort().join('|');
        const bon = s === k && iS === iC;
        if (!bon) ecarts++;
        say(`   ${bon ? '✅' : '🔴'} ${c.nom.padEnd(24)} source ${String(s).padStart(9)} · cible ${String(k).padStart(9)}${s === k ? '' : `   ÉCART ${k - s}`}${iS === iC ? '' : '   index différents'}`);
        journal({ le: new Date().toISOString(), collection: c.nom, source: s, cible: k, indexSource: iS === '' ? 0 : iS.split('|').length, indexCible: iC === '' ? 0 : iC.split('|').length, etat: bon ? 'complete' : 'ECART' });
    }
    // la MÉTA : relue à la source (a-t-elle bougé depuis le début de la copie ?) et comparée à ce que la cible a reçu
    const metaFin = await source.meta();
    const bougees = nomsChanges(metaReference, metaFin);
    const differentes = [];
    for (const n of COLLECTIONS_META.filter(x => noms.includes(x))) {
        const dansCible = JSON.stringify(await cible.collection(n).find({}).sort({ _id: 1 }).toArray());
        if (dansCible !== metaFin[n]) differentes.push(n);
    }
    for (const n of COLLECTIONS_META) {
        const ok = !bougees.includes(n) && !differentes.includes(n);
        say(`   ${ok ? '✅' : '🔴'} ${n.padEnd(24)} méta ${bougees.includes(n) ? 'CHANGÉE à la source depuis le début de la copie' : 'inchangée à la source'}${differentes.includes(n) ? ' · différente de la copie dans la cible' : ''}`);
    }
    const poidsFinal = await poidsCible(cible);
    say(`\n   Poids de la cible : ${mo(poidsFinal)} Mo (données + index) sur ${mo(seuil)} Mo d'arrêt dur.`);
    if (bougees.length || differentes.length) {
        console.error(`❌ ARRÊT : la méta « ${[...new Set([...bougees, ...differentes])].join('», « ')} » a changé à la source pendant la copie (ou ne correspond pas à la cible) : un import de la production a eu lieu, la copie mélange peut-être deux états. Elle n'est PAS déclarée terminée.`);
        console.error(`   ${CONSEIL_FENETRES}`);
        return 1;
    }
    if (ecarts) { console.error(`❌ ARRÊT : ${ecarts} collection(s) en écart (🔴 ci-dessus) : la copie n'est PAS déclarée terminée. La source est vivante : relancer la simulation, puis la copie après avoir compris l'écart.`); return 1; }
    await ecrireEtat({ $set: { termine: noms.length === COLLECTIONS_AUTORISEES.length, termineLe: new Date(), poidsFinalOctets: poidsFinal } });
    say(`\n✅ Copie terminée. CONTRÔLÉ : les comptes des collections copiées, leurs noms d'index, et la méta de la source (${COLLECTIONS_META.join(', ')}) inchangée pendant la copie et identique dans la cible.`);
    say(`   NON contrôlé : le contenu document par document (un document modifié à la source sans que la méta change n'est pas vu).`);
    say(`   Suite : node v2/migrations/creer-index.js --base=${BASE_CIBLE}`);
    return 0;
}

module.exports = { principal, jugerHotes, clesDHotes, adapterSource, ouvrirSourceParDefaut, ouvrirCartesParDefaut, prouverCible, lireArguments, COLLECTIONS_AUTORISEES, COLLECTIONS_META, ARRET_DUR_MO, ETAT, BASE_SOURCE, BASE_CIBLE };

if (require.main === module) {
    require('dotenv').config();
    principal().then(code => process.exit(code)).catch(e => { console.error('❌ erreur imprévue :', cause(e)); process.exit(1); });
}
