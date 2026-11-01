'use strict';
// GALERIE — la garde de la BASE DÉDIÉE. Écrite par ce qu'elle AUTORISE (relecture 2, tour 1) : avec le drapeau allumé, la Communauté ne démarre que si QUATRE conditions tiennent ensemble —
//   (a) la grappe de MONGO_URI_GALERIE est EXACTEMENT celle que l'éditeur a déclarée (V2_GALERIE_GRAPPE, OBLIGATOIRE : sans elle la garde ne sait pas où est la grappe voulue, donc elle bloque) ;
//   (b) elle diffère de chaque grappe connue posée dans le processus (production, cartes, essai, test, leurs lectures, toute MONGODB_* qui est une adresse) ;
//   (c) la base porte le document MARQUEUR `galerie_meta` / `marqueur`, posé par l'outil d'initialisation seul (v2/galerie/outils/initialiser-base.js, lancé à la main par un administrateur) ;
//   (d) toutes les collections de la base appartiennent à la liste fermée de la Communauté (base.js).
// Toute autre situation BLOQUE avec une cause nommée (refus.js). (a) et (b) se jugent sur l'environnement (jugerGrappe, pure) ; (c) et (d) sur la base RÉELLE, après connexion (ouvrir) : un alias DNS, une grappe homonyme
// ou une base de production ne portent pas le marqueur et portent d'autres collections. Un nom de base ne prouve rien (MongoDB le crée à la demande) : le contrôle porte sur ce que le cas redouté n'a PAS.
// Aucune valeur de variable n'est jamais imprimée : les messages nomment les VARIABLES.
const { hotesDe, cleDeGrappe } = require('../../collecte-cartes/garde-banc');   // sans dépendance : la production peut le charger
const { COLLECTIONS } = require('./base');
const { RefusGalerie } = require('./refus');

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

/** { ok:true, uri, grappe } | { ok:false, raison, cause }. Pure : ne se connecte à rien. `env` est l'environnement jugé (jamais process.env par défaut dans les bancs). */
function jugerGrappe(env = process.env) {
    const refus = (raison, cause = 'refus') => ({ ok: false, raison, cause });
    const uri = env.MONGO_URI_GALERIE;
    if (typeof uri !== 'string' || !uri.trim()) return refus('MONGO_URI_GALERIE absente : la Communauté n\'a pas de base dédiée, ses routes ne se montent pas.', 'variable-absente');
    const hotes = hotesDe(uri);
    if (!hotes.length) return refus('MONGO_URI_GALERIE illisible : je ne peux pas dire où elle pointe (doute = refus).', 'illisible');
    const base = baseDeLUri(uri);
    if (base === null) return refus('MONGO_URI_GALERIE illisible : le nom de base ne se lit pas (doute = refus).', 'illisible');
    if (base !== '' && base !== BASE_GALERIE) return refus(`MONGO_URI_GALERIE nomme une autre base que ${BASE_GALERIE} : refusé (la base de la Communauté est fixe).`, 'grappe-differente');
    const cles = [...new Set(hotes.map(cleDeGrappe))];
    if (cles.length !== 1) return refus('MONGO_URI_GALERIE désigne plusieurs grappes : refusé (une seule grappe dédiée).', 'grappe-differente');
    const declaree = typeof env.V2_GALERIE_GRAPPE === 'string' ? env.V2_GALERIE_GRAPPE.trim().toLowerCase() : '';
    // (a) la grappe attendue est DÉCLARÉE, obligatoirement, et c'est exactement celle de l'adresse
    if (!declaree) return refus('V2_GALERIE_GRAPPE absente : la grappe dédiée doit être DÉCLARÉE (son identité Atlas) ; sans elle la garde ne sait pas où est la grappe voulue et bloque.', 'variable-absente');
    if (declaree !== cles[0]) return refus('MONGO_URI_GALERIE ne désigne pas la grappe déclarée par V2_GALERIE_GRAPPE : refusé.', 'grappe-differente');
    // (b) les grappes connues : les trois de production et d'essai, leurs variantes de lecture, et toute autre variable MONGODB_* dont la valeur est une adresse.
    const noms = new Set(GRAPPES_CONNUES);
    for (const [k, v] of Object.entries(env)) if (/^MONGODB_/.test(k) && estUriMongo(v)) noms.add(k);
    noms.delete('MONGODB_BASE');
    // la production doit être LISIBLE : sans elle on ne peut pas comparer, donc on ne peut pas autoriser
    const prod = hotesDe(env.MONGODB_URI);
    if (!prod.length) return refus('MONGODB_URI absente ou illisible : je ne peux pas comparer à la production (doute = refus).', 'variable-absente');
    for (const nom of noms) {
        const v = env[nom];
        if (v === undefined || v === '') continue;               // une variable de lecture non posée n'est pas une grappe à comparer
        const h = hotesDe(v);
        if (!h.length) return refus(`${nom} illisible : je ne peux pas la comparer (doute = refus).`, 'illisible');
        if (h.some(x => cleDeGrappe(x) === cles[0])) return refus(`MONGO_URI_GALERIE désigne la même grappe que ${nom} : refusé (la Communauté n'écrit jamais sur une grappe de production, de cartes, d'essai ou de test).`, 'grappe-differente');
    }
    return { ok: true, uri: uri.trim(), grappe: cles[0] };
}

/** (c) et (d), sur la base RÉELLE : les collections sont toutes de la liste fermée, et le marqueur d'identifiant fixe est là et nomme cette base. Lève RefusGalerie. */
async function verifierContenu(db) {
    const noms = (await db.listCollections({}, { nameOnly: true }).toArray()).map(c => c.name).filter(n => !n.startsWith('system.'));
    const inconnues = noms.filter(n => !COLLECTIONS.includes(n));
    if (inconnues.length) throw new RefusGalerie('collection-inconnue', inconnues);
    const marqueur = await db.collection('galerie_meta').findOne({ _id: 'marqueur' });
    if (!marqueur) throw new RefusGalerie('marqueur-absent');
    if (marqueur.galerie !== true || marqueur.base !== BASE_GALERIE) throw new RefusGalerie('marqueur-incorrect');
}

/**
 * Ouvre la base dédiée ou LÈVE un RefusGalerie. `creer(uri, options)` rend une connexion (mongoose.createConnection(...).asPromise() par défaut) ; injectable.
 * Contrôles APRÈS connexion : le nom de base, la grappe, puis le contenu (marqueur, collections). `verifierLaBase: false` est réservé à l'outil d'initialisation (la base n'a pas encore son marqueur).
 */
async function ouvrir({ env = process.env, creer, verifierLaBase = true } = {}) {
    const j = jugerGrappe(env);
    if (!j.ok) throw new RefusGalerie(j.cause, j.raison);
    const fabrique = creer || ((uri, options) => require('mongoose').createConnection(uri, options).asPromise());
    const cx = await fabrique(j.uri, { dbName: BASE_GALERIE, maxPoolSize: 5, serverSelectionTimeoutMS: 8000 });
    const db = cx && cx.db;
    const fermer = async () => { try { if (cx && typeof cx.close === 'function') await cx.close(); } catch { /* rien */ } };
    try {
        if (!db || db.databaseName !== BASE_GALERIE) throw new RefusGalerie('grappe-differente', 'base connectée inattendue');
        const hoteReel = cx.host ? hotesDe(`mongodb://${cx.host}/`) : [];
        if (!hoteReel.length || hoteReel.some(h => cleDeGrappe(h) !== j.grappe)) throw new RefusGalerie('grappe-differente', 'la connexion ne tombe pas sur la grappe déclarée');
        if (verifierLaBase) await verifierContenu(db);
    } catch (e) { await fermer(); throw e; }
    return { db, fermer };
}

module.exports = { BASE_GALERIE, GRAPPES_CONNUES, jugerGrappe, ouvrir, verifierContenu, baseDeLUri };
