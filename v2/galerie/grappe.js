'use strict';
// GALERIE — la garde de la BASE DÉDIÉE. Écrite par ce qu'elle AUTORISE : une seule grappe passe, celle que l'éditeur a DÉCLARÉE (V2_GALERIE_GRAPPE) pour la Communauté,
// à condition qu'elle ne soit AUCUNE des grappes connues (production `MONGODB_URI`, cartes, essai `rm_essai`, test, et leurs variantes de lecture), que le nom de base de l'adresse soit
// absent ou `rm_galerie_essai`, et qu'on ait pu tout LIRE et tout COMPARER. Un doute (adresse illisible, variable de production absente, plusieurs grappes dans l'adresse) est un refus.
// Un nom de base ne prouve rien (MongoDB crée une base à la demande) : la comparaison porte sur la GRAPPE (cleDeGrappe), jamais seulement sur le nom.
// Aucune valeur de variable n'est jamais imprimée : les messages nomment les VARIABLES.
const { hotesDe, cleDeGrappe } = require('../../collecte-cartes/garde-banc');   // sans dépendance : la production peut le charger

const BASE_GALERIE = 'rm_galerie_essai';
// Les grappes qu'aucune donnée de la Communauté ne doit jamais approcher. Toute variable MONGODB_* dont la valeur est une adresse mongodb s'y ajoute (voir plus bas).
const GRAPPES_CONNUES = Object.freeze(['MONGODB_URI', 'MONGODB_CARTES_URI', 'MONGODB_ESSAI_URI', 'MONGODB_TEST_URI', 'MONGODB_LECTURE_URI', 'MONGODB_CARTES_LECTURE_URI', 'MONGODB_ESSAI_LECTURE_URI']);
const estUriMongo = v => typeof v === 'string' && /^mongodb(\+srv)?:\/\//i.test(v.trim());

/** La base nommée par l'adresse : '' (aucune), ou le nom. null si l'adresse n'a pas la forme attendue. */
function baseDeLUri(uri) {
    const m = /^mongodb(?:\+srv)?:\/\/(?:[^@/]*@)?[^/?#]+(?:\/([^?#]*))?/i.exec(String(uri).trim());
    if (!m) return null;
    let nom = m[1] || '';
    try { nom = decodeURIComponent(nom); } catch { return null; }
    return nom;
}

/** { ok:true, uri, grappe } | { ok:false, raison }. Pure : ne se connecte à rien. `env` est l'environnement jugé (jamais process.env par défaut dans les bancs). */
function jugerGrappe(env = process.env) {
    const refus = raison => ({ ok: false, raison });
    const uri = env.MONGO_URI_GALERIE;
    if (typeof uri !== 'string' || !uri.trim()) return refus('MONGO_URI_GALERIE absente : la Communauté n\'a pas de base dédiée, ses routes ne se montent pas.');
    const hotes = hotesDe(uri);
    if (!hotes.length) return refus('MONGO_URI_GALERIE illisible : je ne peux pas dire où elle pointe (doute = refus).');
    const base = baseDeLUri(uri);
    if (base === null) return refus('MONGO_URI_GALERIE illisible : le nom de base ne se lit pas (doute = refus).');
    if (base !== '' && base !== BASE_GALERIE) return refus(`MONGO_URI_GALERIE nomme une autre base que ${BASE_GALERIE} : refusé (la base de la Communauté est fixe).`);
    const cles = [...new Set(hotes.map(cleDeGrappe))];
    if (cles.length !== 1) return refus('MONGO_URI_GALERIE désigne plusieurs grappes : refusé (une seule grappe dédiée).');
    const declaree = typeof env.V2_GALERIE_GRAPPE === 'string' ? env.V2_GALERIE_GRAPPE.trim().toLowerCase() : '';
    // la déclaration est FACULTATIVE (décision de l'éditeur : la garde porte sur les trois grappes connues) ; posée, elle doit être EXACTEMENT la grappe de l'adresse
    if (declaree && declaree !== cles[0]) return refus('MONGO_URI_GALERIE ne désigne pas la grappe déclarée par V2_GALERIE_GRAPPE : refusé.');
    // Les grappes connues : les trois de production et d'essai, leurs variantes de lecture, et toute autre variable MONGODB_* dont la valeur est une adresse.
    const noms = new Set(GRAPPES_CONNUES);
    for (const [k, v] of Object.entries(env)) if (/^MONGODB_/.test(k) && estUriMongo(v)) noms.add(k);
    noms.delete('MONGODB_BASE');
    // la production doit être LISIBLE : sans elle on ne peut pas comparer, donc on ne peut pas autoriser
    const prod = hotesDe(env.MONGODB_URI);
    if (!prod.length) return refus('MONGODB_URI absente ou illisible : je ne peux pas comparer à la production (doute = refus).');
    for (const nom of noms) {
        const v = env[nom];
        if (v === undefined || v === '') continue;               // une variable de lecture non posée n'est pas une grappe à comparer
        const h = hotesDe(v);
        if (!h.length) return refus(`${nom} illisible : je ne peux pas la comparer (doute = refus).`);
        if (h.some(x => cleDeGrappe(x) === cles[0])) return refus(`MONGO_URI_GALERIE désigne la même grappe que ${nom} : refusé (la Communauté n'écrit jamais sur une grappe de production, de cartes, d'essai ou de test).`);
    }
    return { ok: true, uri: uri.trim(), grappe: cles[0] };
}

/** Ouvre la base dédiée ou LÈVE. `creer(uri, options)` rend une connexion (mongoose.createConnection(...).asPromise() par défaut) ; injectable. Contrôle APRÈS connexion : le nom de base ET la grappe. */
async function ouvrir({ env = process.env, creer } = {}) {
    const j = jugerGrappe(env);
    if (!j.ok) throw new Error(`galerie : base dédiée refusée — ${j.raison}`);
    const fabrique = creer || ((uri, options) => require('mongoose').createConnection(uri, options).asPromise());
    const cx = await fabrique(j.uri, { dbName: BASE_GALERIE, maxPoolSize: 5, serverSelectionTimeoutMS: 8000 });
    const db = cx && cx.db;
    const fermer = async () => { try { if (cx && typeof cx.close === 'function') await cx.close(); } catch { /* rien */ } };
    if (!db || db.databaseName !== BASE_GALERIE) { await fermer(); throw new Error(`galerie : base connectée inattendue (attendue ${BASE_GALERIE}) — refusé.`); }
    const hoteReel = cx.host ? hotesDe(`mongodb://${cx.host}/`) : [];
    if (!hoteReel.length || hoteReel.some(h => cleDeGrappe(h) !== j.grappe)) { await fermer(); throw new Error('galerie : la connexion ne tombe pas sur la grappe déclarée — refusé.'); }
    return { db, fermer };
}

module.exports = { BASE_GALERIE, GRAPPES_CONNUES, jugerGrappe, ouvrir, baseDeLUri };
