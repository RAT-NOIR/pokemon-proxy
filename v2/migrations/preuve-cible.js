'use strict';
// PREUVE-CIBLE — UNE SEULE preuve que la base visée est bien `rm_essai`, sur la bonne grappe, avec un utilisateur qui n'écrit que là.
// Partagée par v2/migrations/amorcer-essai.js (la copie du catalogue) et v2/admin/compte-essai.js (le compte du testeur) : deux exemplaires d'une règle de sécurité divergent (§21 bis),
// donc il n'y en a qu'un, et il prend le PLUS STRICT des deux outils sur chaque point :
//  · RÔLES (AMORÇAGE) : readWrite ou read, et SEULEMENT sur rm_essai — même `read` d'une autre base refuse ;
//  · PRIVILÈGES (COMPTE-ESSAI) : toute action hors lecture doit viser { db: rm_essai, collection: <chaîne> } (ni cluster, ni anyResource, ni autre base) ET faire partie de la liste FERMÉE d'un
//    readWrite DOCUMENTÉ par MongoDB ; `insert` et `update` sont exigés (un utilisateur qui ne peut pas écrire n'est pas celui qu'on croit) ;
//  · IDENTITÉ DE LA GRAPPE (AMORÇAGE) : hello.setName de la cible connu et DIFFÉRENT de celui de la production (la source) et de celui de cartes ; jugerHotes compare les hôtes sans connexion.
// Écrite par ce qu'elle AUTORISE : tout cas non conclu (commande refusée, champ absent, erreur, cartes injoignable) BLOQUE et le dit.
// Aucune raison ne contient un nom d'utilisateur, un setName, une URI ou le message d'un pilote.
const { ACTIONS_DE_LECTURE } = require('../chargeur/lecture-seule');

const BASE_CIBLE = 'rm_essai', BASE_SOURCE = 'test';
const ROLES_ADMIS = Object.freeze(['readWrite', 'read']);
// SOURCE de la liste fermée : le rôle readWrite DOCUMENTÉ par MongoDB (doc « Built-In Roles », rôle readWrite, version actuelle ;
// db.getRole("readWrite", { showPrivileges: true, showBuiltinRoles: true })), 25 actions — décision du testeur du 2026-10-14. Elle REMPLACE l'ancienne liste « mesurée » (relecture 3 d'AMORÇAGE) :
// ses 6 actions absentes de la doc (bypassDocumentValidation, collMod, compact, enableProfiler, planCacheWrite, reIndex) sont désormais REFUSÉES.
// Une action hors de cette liste refuse ; la ressource reste jugée (rm_essai seulement : ni cluster, ni anyResource, ni autre base).
const ACTIONS_READWRITE = Object.freeze(['changeStream', 'cleanupStructuredEncryptionData', 'collStats', 'compactStructuredEncryptionData', 'convertToCapped', 'createCollection', 'createIndex', 'createSearchIndexes', 'dbHash', 'dbStats', 'dropCollection', 'dropIndex', 'dropSearchIndex', 'find', 'insert', 'killCursors', 'listCollections', 'listIndexes', 'listSearchIndexes', 'performRawDataOperations', 'planCacheRead', 'remove', 'renameCollectionSameDB', 'update', 'updateSearchIndex']);
const ACTIONS_ECRITURE_ADMISES = Object.freeze(new Set([...ACTIONS_DE_LECTURE, ...ACTIONS_READWRITE]));
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
    if (cible.some(c => production.has(c))) return { ok: false, raison: 'MONGODB_ESSAI_URI pointe l\'hôte (la grappe) de la production, des cartes ou de la source de lecture : refusé — on n\'écrit jamais là.' };
    if (env.MONGODB_URI) {
        const ecr = clesDHotes(env.MONGODB_URI);
        if (!lecture.some(c => ecr.includes(c))) return { ok: false, raison: 'MONGODB_LECTURE_URI ne pointe pas la grappe de MONGODB_URI (la production) : la source de comparaison doit être la production, refusé.' };
    }
    return { ok: true };
}

// ── 2. LE STATUT : ce que l'utilisateur de la cible peut faire (pur, sans connexion) ───────────────────────────────────────
/** @param {object} statut  la réponse de connectionStatus { showPrivileges: true } → { ok } | { ok: false, raison } */
function jugerStatut(statut) {
    const refus = raison => ({ ok: false, raison });
    const info = statut && typeof statut === 'object' ? statut.authInfo : null;
    if (!info || typeof info !== 'object' || Array.isArray(info)) return refus('connectionStatus sans authInfo : je ne sais pas ce que l\'utilisateur de la cible peut faire.');
    if (!Array.isArray(info.authenticatedUsers) || info.authenticatedUsers.length === 0) return refus('aucun utilisateur authentifié sur la cible : je ne sais pas qui écrit.');
    const roles = info.authenticatedUserRoles;
    if (!Array.isArray(roles) || roles.length === 0) return refus('liste des rôles de l\'utilisateur de la cible absente : je ne sais pas ce qu\'il est.');
    for (const r of roles) {
        if (!r || typeof r !== 'object' || r.db !== BASE_CIBLE || !ROLES_ADMIS.includes(r.role)) return refus(`l'utilisateur de la cible porte un rôle autre que ${ROLES_ADMIS.join('/')} sur "${BASE_CIBLE}" : refusé (aucun rôle d'une autre base, aucun rôle d'administration).`);
    }
    const privileges = info.authenticatedUserPrivileges;
    if (!Array.isArray(privileges) || privileges.length === 0) return refus('liste des privilèges de l\'utilisateur de la cible absente : je ne sais pas ce qu\'il peut écrire.');
    const vues = new Set();
    for (const p of privileges) {
        if (!p || typeof p !== 'object' || !Array.isArray(p.actions) || p.actions.length === 0 || !p.resource || typeof p.resource !== 'object' || Array.isArray(p.resource)) return refus('un privilège illisible sur la cible : refusé.');
        if (p.actions.some(a => typeof a !== 'string')) return refus('une action illisible dans un privilège de la cible : refusé.');
        if (p.actions.every(a => ACTIONS_DE_LECTURE.includes(a))) continue;                       // lecture seule, où que ce soit : sans danger
        const res = p.resource;
        if (res.db !== BASE_CIBLE || typeof res.collection !== 'string' || res.cluster === true || res.anyResource === true) return refus(`l'utilisateur de la cible a une action d'écriture ou d'administration ailleurs que sur la base "${BASE_CIBLE}" : refusé.`);
        for (const a of p.actions) {
            if (!ACTIONS_ECRITURE_ADMISES.has(a)) return refus(`action « ${a.slice(0, 40)} » hors de la liste d'un simple readWrite : l'utilisateur de la cible peut faire plus qu'écrire dans "${BASE_CIBLE}".`);
            vues.add(a);
        }
    }
    if (!vues.has('insert') || !vues.has('update')) return refus(`l'utilisateur de la cible n'a pas le droit d'écrire sur "${BASE_CIBLE}" (insert et update exigés) : ce n'est pas l'utilisateur attendu.`);
    return { ok: true };
}

// ── 3. LA PREUVE : côté serveur, jamais par le nom d'un hôte ─────────────────────────────────────────────────────────────
/**
 * @param {object} db  la Db native de la connexion CIBLE
 * @param {{ source: { identite(): Promise<string> }, ouvrirCartes(env): Promise<{ ok, setName, fermer }>, env?: object }} opts
 *        `source` : l'identité (hello.setName) de la production ; `ouvrirCartes` : celle de la grappe des cartes, ouverte en lecture le temps d'un hello.
 */
async function prouverCible(db, { source, ouvrirCartes, env = process.env } = {}) {
    const refus = raison => ({ ok: false, raison });
    let statut;
    try { statut = await db.admin().command({ connectionStatus: 1, showPrivileges: true }); }
    catch { return refus('connectionStatus a échoué sur la cible : je ne peux pas prouver ce que son utilisateur peut écrire.'); }
    const j = jugerStatut(statut);
    if (!j.ok) return j;
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

/** L'identité de la PRODUCTION (hello.setName), lue par MONGODB_LECTURE_URI — un `hello`, rien d'autre. { ok, source: { identite }, fermer } | { ok: false, raison }. Pour COMPTE-ESSAI ; AMORÇAGE a déjà sa source. */
async function ouvrirIdentiteProduction(env, { connecter = async uri => require('mongoose').createConnection(uri, { dbName: BASE_SOURCE, serverSelectionTimeoutMS: 20000 }).asPromise() } = {}) {
    const uri = env && typeof env.MONGODB_LECTURE_URI === 'string' ? env.MONGODB_LECTURE_URI.trim() : '';
    if (!uri) return { ok: false, raison: 'MONGODB_LECTURE_URI absente : l\'identité de la production est inconnue, refusé.' };
    let cx = null;
    const fermer = async () => { try { if (cx) await cx.close(); } catch { /* déjà fermée */ } };
    try {
        cx = await connecter(uri);
        if (!cx.db || cx.db.databaseName !== BASE_SOURCE) { await fermer(); return { ok: false, raison: `la connexion de lecture est sur une autre base que "${BASE_SOURCE}" : refusé.` }; }
        const h = await cx.db.admin().command({ hello: 1 });
        if (!h || typeof h.setName !== 'string' || !h.setName) { await fermer(); return { ok: false, raison: 'la production ne donne pas de nom de jeu de réplicas : je ne peux rien comparer, refusé.' }; }
        const setName = h.setName;
        return { ok: true, source: Object.freeze({ identite: async () => setName }), fermer };
    } catch (e) { await fermer(); return { ok: false, raison: `connexion à la production (lecture) impossible (${cause(e)}).` }; }
}

module.exports = { jugerHotes, clesDHotes, jugerStatut, prouverCible, ouvrirCartesParDefaut, ouvrirIdentiteProduction, ROLES_ADMIS, ACTIONS_READWRITE, BASE_CIBLE, BASE_SOURCE };
