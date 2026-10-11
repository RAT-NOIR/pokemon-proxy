'use strict';
// COTES-VISUELS — l'UNIQUE porte de l'API vers la base `cartes` : lecture seule, par MONGODB_CARTES_LECTURE_URI, prouvée par ce qu'elle PEUT faire (CLAUDE.md §78 :
// « une lecture est sûre par ce qu'elle PEUT faire, pas par ce qu'on lui demande »). Écrite par ce qu'elle AUTORISE :
//   1. AVANT toute connexion : la variable existe, elle n'est pas MONGODB_CARTES_URI (l'écriture), elle ne porte pas le même utilisateur, elle en porte un.
//   2. AU BRANCHEMENT : `connectionStatus` avec `showPrivileges` ; chaque action de chaque privilège doit être dans ACTIONS_DE_LECTURE (la liste d'un rôle `read`).
//      Une action hors de la liste, une réponse illisible, aucun utilisateur, aucun privilège : « je ne sais pas » = REFUS, connexion fermée, aucune lecture.
//   3. ENSUITE : la façade de collecte-cartes/facade-lecture.js (la même que celle des bancs, pas une copie) enveloppée d'une liste FERMÉE — trois collections, `find` seulement.
// Aucune raison ne contient une valeur de variable, d'URI ou de message du pilote : des NOMS seulement.
const { facadeLecture } = require('../../collecte-cartes/facade-lecture');

const COLLECTIONS_LUES = Object.freeze(['sets', 'cartes', 'cartes_produits']);
// Les actions d'un rôle de lecture MongoDB (`read`). Toute autre action — écriture, administration, action future — refuse.
// (`listDatabases` : l'action de liste que porte le rôle Atlas `readAnyDatabase` — elle nomme des bases, elle n'écrit rien ; l'utilisateur de lecture du testeur la porte, constaté le 2026-10-11.)
const ACTIONS_DE_LECTURE = Object.freeze(['changeStream', 'collStats', 'dbHash', 'dbStats', 'find', 'killCursors', 'listCollections', 'listDatabases', 'listIndexes', 'listSearchIndexes', 'planCacheRead']);

const texte = x => (typeof x === 'string' && x.trim() ? x.trim() : null);
/** L'utilisateur d'une URI mongodb(+srv)://utilisateur:mot-de-passe@hôte/… — `null` si l'URI n'en porte pas ou n'a pas cette forme. Le mot de passe n'est jamais lu. */
function utilisateurDe(uri) {
    const m = /^mongodb(?:\+srv)?:\/\/([^:@/?#]+)(?::[^@/?#]*)?@/i.exec(texte(uri) || '');
    if (!m) return null;
    try { return decodeURIComponent(m[1]); } catch { return null; }
}

/** La même URI sans son mot de passe (`mongodb+srv://utilisateur@hôte/…`) : ce qui peut voyager vers le fil — la comparaison n'a besoin que de l'adresse et de l'utilisateur. Absente : undefined. */
function sansMotDePasse(uri) {
    const t = texte(uri);
    return t === null ? undefined : t.replace(/^(mongodb(?:\+srv)?:\/\/[^:@/?#]+):[^@/?#]*@/i, '$1@');
}

/** Les refus qui ne demandent AUCUNE connexion. Pure. @returns {{ ok: boolean, raison?: string }} */
function jugerVariables(env = process.env) {
    const lecture = texte(env.MONGODB_CARTES_LECTURE_URI);
    if (!lecture) return { ok: false, raison: 'MONGODB_CARTES_LECTURE_URI absente ou vide' };
    const ecriture = texte(env.MONGODB_CARTES_URI);
    if (ecriture && lecture === ecriture) return { ok: false, raison: 'MONGODB_CARTES_LECTURE_URI est égale à MONGODB_CARTES_URI (l\'écriture)' };
    const u = utilisateurDe(lecture);
    if (!u) return { ok: false, raison: 'MONGODB_CARTES_LECTURE_URI ne porte aucun utilisateur lisible : je ne peux pas dire qui lit' };
    if (ecriture && utilisateurDe(ecriture) === u) return { ok: false, raison: 'MONGODB_CARTES_LECTURE_URI porte le même utilisateur que MONGODB_CARTES_URI' };
    return { ok: true };
}

/** Le jugement de `connectionStatus` : tout ce qui n'est pas PROUVÉ en lecture seule refuse. Pure. */
function jugerPrivileges(statut) {
    const info = statut && typeof statut === 'object' ? statut.authInfo : null;
    if (!info || typeof info !== 'object') return { ok: false, raison: 'connectionStatus sans authInfo : je ne sais pas ce que cet utilisateur peut faire' };
    if (!Array.isArray(info.authenticatedUsers) || info.authenticatedUsers.length === 0) return { ok: false, raison: 'aucun utilisateur authentifié : je ne sais pas qui lit' };
    const privileges = info.authenticatedUserPrivileges;
    if (!Array.isArray(privileges) || privileges.length === 0) return { ok: false, raison: 'aucun privilège lisible : je ne sais pas ce que cet utilisateur peut faire' };
    const vues = new Set();
    for (const p of privileges) {
        if (!p || typeof p !== 'object' || !Array.isArray(p.actions) || p.actions.length === 0) return { ok: false, raison: 'un privilège sans liste d\'actions lisible : refus' };
        for (const a of p.actions) {
            if (typeof a !== 'string' || !ACTIONS_DE_LECTURE.includes(a)) return { ok: false, raison: `action « ${typeof a === 'string' ? a.slice(0, 40) : '?'} » hors de la liste de lecture : cet utilisateur peut faire plus que lire` };
            vues.add(a);
        }
    }
    if (!vues.has('find')) return { ok: false, raison: 'aucun droit `find` : cet utilisateur ne lit rien' };
    return { ok: true };
}

/** La façade restreinte : trois collections, find et aggregate. Tout le reste lève. `fermer()` ferme la connexion. */
function restreindre(facade) {
    const collection = nom => {
        if (!COLLECTIONS_LUES.includes(nom)) throw new Error(`🔴 LECTURE SEULE : la collection « ${String(nom).slice(0, 40)} » n'est pas dans la liste fermée (${COLLECTIONS_LUES.join(', ')})`);
        const c = facade.collection(nom);
        // `find` SEULEMENT (revue, M1) : l'API n'appelle jamais aggregate, et un pipeline peut lire d'autres collections ($lookup, $unionWith, $graphLookup) ou exécuter du code ($function) — hors de la liste fermée.
        return Object.freeze({ find: (...a) => c.find(...a) });
    };
    return new Proxy({}, {
        get(_, p) {
            if (p === 'collection') return collection;
            if (p === 'fermer') return () => facade.close();
            if (p === 'then' || typeof p === 'symbol') return undefined;
            throw new Error(`🔴 LECTURE SEULE : « ${String(p)} » n'existe pas sur la base de lecture de cartes`);
        }
    });
}

async function connecterParDefaut(uri) {
    const mongoose = require('mongoose');
    return mongoose.createConnection(uri, { dbName: 'cartes', serverSelectionTimeoutMS: 20000 }).asPromise();
}

/**
 * Ouvre la lecture seule de `cartes`, ou refuse en le disant. Ne lève jamais : un refus est une valeur.
 * `connecter(uri)` est injectable (le banc passe une fausse connexion qui enregistre ses appels) et rend { db, close }.
 * @returns {Promise<{ ok: true, cartes: object } | { ok: false, raison: string }>}
 */
async function ouvrir({ env = process.env, connecter = connecterParDefaut } = {}) {
    const j = jugerVariables(env);
    if (!j.ok) return j;
    let cx = null;
    const fermer = async () => { try { if (cx) await cx.close(); } catch { /* déjà fermée */ } };
    try {
        cx = await connecter(texte(env.MONGODB_CARTES_LECTURE_URI));
        let statut;
        try { statut = await cx.db.admin().command({ connectionStatus: 1, showPrivileges: true }); }
        catch { await fermer(); return { ok: false, raison: 'connectionStatus a échoué : je ne peux pas prouver que la connexion est en lecture seule' }; }
        const p = jugerPrivileges(statut);
        if (!p.ok) { await fermer(); return p; }
        return { ok: true, cartes: restreindre(facadeLecture(cx.db, fermer)) };
    } catch (e) {
        await fermer();
        return { ok: false, raison: `connexion à cartes impossible (${(e && (e.codeName || e.code || e.name)) || 'erreur'})` };   // jamais e.message : un pilote peut y mettre une adresse
    }
}

module.exports = { ouvrir, jugerVariables, jugerPrivileges, utilisateurDe, sansMotDePasse, restreindre, COLLECTIONS_LUES, ACTIONS_DE_LECTURE };
