// ============================================================
// LES LIGNES DÉTACHÉES NE SE REPOSENT PAS — le reste `fiche-contredite-par-la-vue` est respecté par TOUTES les voies qui posent des lignes
// ============================================================
// Décision du testeur (2026-10-24) : détacher la ligne `cartes_produits` fausse de 20 produits (detacher-lignes-prouvees.js, décision 2026-10-24, preuve « vu ») ; chaque produit reçoit un RESTE
// `fiche-contredite-par-la-vue` { carteId, idProduct }. 🔴 SANS CE MODULE, la prochaine recollecte REPOSAIT les 20 lignes : la preuve « vu » est visuelle, aucun témoin de `joindre()` (nom, attaques,
// numéro) ne contredit ces lignes, et `ecrireJointure` ne purgeait pas ce type mais ne le LISAIT pas non plus.
//
// 🔑 CE QUE LE RESTE INTERDIT, EXACTEMENT : la LIGNE (carte|produit), jamais le produit. Le même produit joint à une AUTRE carte (la phase 3, une jointure prouvée) n'est pas refusé. C'est pourquoi ce n'est
// PAS dans les `RESTES_EXCLUS` de poser-cartes-tcgdex.js, poser-par-nom-tcgdex.js, creer-sets-par-pages-de-cartes.js : ceux-là excluent un PRODUIT entier, et la phase 3 doit pouvoir lui refaire une ligne.
//
// 🔑 TROIS COUCHES, DU CALCUL AU FILET (la liste des voies : test-lignes-detachees.js, section 6) :
//   1. `joindre()` : `cible.lignesInterdites` (un Set « carte|produit ») — la ligne n'est pas proposée, le produit tombe en reste « produit-sans-carte » qui le dit ;
//   2. `ecrireJointure()` et le bonus intl de collecteur-texte.js : les lignes d'un J calculé par un appelant qui ne connaît pas l'interdit sont FILTRÉES avant l'écriture (bilan : `refusees`) ;
//   3. LE FILET : `installerGardeLignes(db)` (collecte-cartes/garde.js::ouvrirConnexions) enveloppe `db.collection('cartes_produits')` — toute CRÉATION (upsert, insert, bulkWrite) d'une ligne interdite LÈVE,
//      AVANT la moindre écriture du lot : les poser-*, creer-sets-*, completer-*, y compris ceux qu'on n'a pas encore écrits. Écrit par ce qu'il AUTORISE : une création dont l'identifiant ne se détermine pas
//      LÈVE ; des restes qui ne se lisent pas LÈVENT. Une MISE À JOUR sans upsert (un numéro de fiche) n'est jamais refusée : elle ne crée rien.
//      Le filet refuse aussi, par construction (tour 1 de correction, 2026-10-24) : les constructeurs `initializeOrderedBulkOp` / `initializeUnorderedBulkOp` de cartes_produits (leurs écritures
//      s'accumulent hors de sa vue — utiliser `bulkWrite`), et toute `aggregate` — de cartes_produits OU d'une autre collection de la connexion — dont un `$merge` / `$out` vise cartes_produits ou une cible
//      qui ne se détermine pas.
// 🔑 LE PRODUIT GELÉ (joindre) : le produit dont la ligne est refusée n'est offert à AUCUNE carte par la passe 2 (repli par le nom) — une autre carte du même nom le prendrait avec une preuve plus faible.
// ⚠️ LES DEUX SORTIES : (1) la RESTAURATION d'un lot (lot-additif.js) remet l'état EXACT d'avant le lot, y compris une ligne que le lot a lui-même détachée : elle lève le filet par `sansGardeLignes(db, fn)`,
//      sur SA connexion et pour ses seules écritures de restauration (un compteur sur l'objet `db` — jamais une variable d'environnement, que la commande enfant du lot hériterait) ;
//      (2) une décision nouvelle du testeur : `LIGNES_DETACHEES_RETABLIR` = une PHRASE d'au moins 20 caractères (la raison), imprimée quand elle sert. Une variable vide ou courte ne change rien. Posée avant
//      lot-additif.js, elle s'applique AUSSI à la commande enfant du lot : le message de refus le dit.
// 🕳️ LIMITES NOMMÉES (acceptées par la relecture, 2026-10-24) :
//   · LE CACHE DES RESTES DURE 30 s (`ttlMs`), par connexion : un reste « fiche-contredite-par-la-vue » posé par un AUTRE processus depuis moins de 30 s peut ne pas être vu par un processus qui vient de lire. Accepté : les
//     restes ne se posent que par un lot de détachement (une écriture sérialisée, sous lot-additif.js), jamais pendant une collecte ; un nouveau processus relit à sa première création.
//   · les modèles mongoose créés AVANT l'installation du filet gardent leur collection native non gardée (ouvrirConnexions l'installe avant tout modèle), et `Model.aggregate` n'est pas surveillé ;
//   · un MongoClient brut, un `mongosh`, l'outil MCP : hors du filet (aucun ne passe par ouvrirConnexions).
'use strict';

const TYPE_RESTE = 'fiche-contredite-par-la-vue';
const idLigne = (carteId, idProduct) => `${carteId}|${idProduct}`;
const estId = x => typeof x === 'string' && /^[^|]+\|[^|]+$/.test(x);

/** Les lignes interdites d'une liste de restes : « carte|produit » des restes du type, qui portent une carte ET un produit. */
function interditsDe(restes) {
    const s = new Set();
    for (const r of restes || []) if (r && r.type === TYPE_RESTE && r.carteId != null && r.idProduct != null) s.add(idLigne(r.carteId, r.idProduct));
    return s;
}
const idDeLigne = l => (typeof l._id === 'string' ? l._id : idLigne(l.carteId, l.idProduct));
/** Sépare des lignes (`_id` ou carteId + idProduct) en gardées et refusées. */
function filtrerLignes(lignes, interdits) {
    const gardees = [], refusees = [];
    for (const l of lignes) (interdits.has(idDeLigne(l)) ? refusees : gardees).push(l);
    return { gardees, refusees };
}
/** Lit les restes interdits dans une collection native (find().toArray()) ou un modèle mongoose (find().lean()). */
async function lireInterdits(coll) {
    if (!coll || typeof coll.find !== 'function') throw new Error('lireInterdits : pas de collection de restes lisible — je ne peux pas conclure');
    const c = coll.find({ type: TYPE_RESTE });
    const docs = typeof c.lean === 'function' ? await c.lean() : await c.toArray();
    return interditsDe(docs);
}

// ── Ce qu'une écriture CRÉERAIT : une liste d'id (vide : rien ne se crée), ou null (« je ne sais pas »).
const idDepuis = (filtre, ...docs) => {
    if (estId(filtre?._id)) return filtre._id;
    const lire = o => (o && o.carteId != null && o.idProduct != null && typeof o.carteId !== 'object' && typeof o.idProduct !== 'object' ? idLigne(o.carteId, o.idProduct) : null);
    for (const o of [filtre, ...docs]) { if (estId(o?._id)) return o._id; const r = lire(o); if (r) return r; }
    return null;
};
function creeUne(op, upsert) {   // une écriture unitaire : filtre, update ou remplacement
    if (!upsert) return [];
    const id = idDepuis(op.filter, op.update?.$setOnInsert, op.update?.$set, op.replacement);
    return id ? [id] : null;
}
function idsCreesPar(methode, args) {
    switch (methode) {
        case 'insertOne': return estId(args[0]?._id) ? [args[0]._id] : null;
        case 'insertMany': { const ids = (args[0] || []).map(d => d?._id); return ids.every(estId) ? ids : null; }
        case 'updateOne': case 'updateMany': case 'findOneAndUpdate': return creeUne({ filter: args[0], update: args[1] }, args[2]?.upsert === true);
        case 'replaceOne': case 'findOneAndReplace': return creeUne({ filter: args[0], replacement: args[1] }, args[2]?.upsert === true);
        case 'bulkWrite': {
            const out = [];
            for (const o of args[0] || []) {
                let r = [];
                if (o.insertOne) r = estId(o.insertOne.document?._id) ? [o.insertOne.document._id] : null;
                else if (o.updateOne || o.updateMany) { const u = o.updateOne || o.updateMany; r = creeUne({ filter: u.filter, update: u.update }, u.upsert === true); }
                else if (o.replaceOne) r = creeUne({ filter: o.replaceOne.filter, replacement: o.replaceOne.replacement }, o.replaceOne.upsert === true);
                if (r === null) return null;
                out.push(...r);
            }
            return out;
        }
        case 'initializeOrderedBulkOp': case 'initializeUnorderedBulkOp': return null;     // des écritures que le filet ne verra jamais : « je ne sais pas »
        default: return [];
    }
}
/** LÈVE si l'écriture créerait une ligne interdite, ou si elle crée quelque chose dont l'identifiant ne se détermine pas. */
function verifierEcriture(methode, args, interdits) {
    const ids = idsCreesPar(methode, args);
    if (ids === null) throw new Error(`lignes détachées : ${methode} crée une ligne dont l'identifiant est indéterminable — je ne sais pas conclure, rien n'est écrit`);
    const hits = ids.filter(i => interdits.has(i));
    if (hits.length) throw new Error(`lignes détachées : ${methode} créerait ${hits.length} ligne(s) interdite(s) (${hits.slice(0, 6).join(', ')}${hits.length > 6 ? ', …' : ''}) : un reste « ${TYPE_RESTE} » les a détachées (décision du testeur, preuve « vu ») — rien n'est écrit. ${SORTIES}`);
}
// 🔑 Un refus qui ne nomme pas sa sortie fait chercher (§6). Les DEUX sorties, et le piège de la seconde.
const SORTIES = 'Pour lever l\'interdit : (1) restaurer un lot depuis sa sauvegarde — lot-additif.js lève le filet tout seul, sur sa connexion, pour ses seules écritures de restauration ; (2) une décision nouvelle du testeur : '
    + 'poser LIGNES_DETACHEES_RETABLIR = une phrase d\'au moins 20 caractères (la raison, imprimée quand elle sert). ⚠️ Posée AVANT lot-additif.js, cette variable s\'applique aussi à la commande enfant du lot (elle en hérite) : à éviter, la poser sur la seule commande qui rétablit.';

/**
 * Le contrôle commun des outils qui écrivent leurs lignes UNE À UNE (boucle d'upserts) : à appeler AVANT la première écriture, sur la base native. Une ligne interdite dans le lot fait LEVER tout le lot —
 * jamais « les trois premières écrites, la quatrième refusée ». (Les `bulkWrite` n'en ont pas besoin : le filet de `garderCollectionLignes` juge le lot entier avant de l'envoyer.)
 */
async function preverifierLignes(db, lignes) {
    if (retablir()) return;
    let interdits;
    try { interdits = await lireInterdits(db.collection('restes')); } catch (e) { throw new Error(`lignes détachées : je ne peux pas lire les restes « ${TYPE_RESTE} » (${String(e.message).slice(0, 120)}) — rien n'est écrit`); }
    verifierEcriture('bulkWrite', [lignes.map(l => ({ updateOne: { filter: { _id: idDeLigne(l) }, update: { $setOnInsert: l }, upsert: true } }))], interdits);
}

// Les constructeurs d'opérations en vrac (`initialize*BulkOp`) accumulent des écritures (`find().upsert().updateOne()`, `insert()`) que ce filet ne voit PAS avant `execute()` : ils sont REFUSÉS (utiliser `bulkWrite`,
// qui est jugé en entier). Écrit par ce qu'il autorise : une méthode d'écriture de cette liste fermée est jugée, ou refusée ; le reste (lecture, suppression, comptage) passe.
const BULK = ['initializeOrderedBulkOp', 'initializeUnorderedBulkOp'];
const METHODES = ['insertOne', 'insertMany', 'updateOne', 'updateMany', 'replaceOne', 'findOneAndUpdate', 'findOneAndReplace', 'bulkWrite', ...BULK];

/** La collection qu'une étape `$merge` / `$out` ÉCRIT : un nom, ou `null` si elle ne se détermine pas, ou `undefined` si l'étape n'écrit pas. */
function cibleDEcriture(etape) {
    if (!etape || typeof etape !== 'object') return undefined;
    const cle = ['$merge', '$out'].find(k => k in etape);
    if (!cle) return undefined;
    const v = etape[cle], t = cle === '$merge' ? (v && typeof v === 'object' ? v.into : v) : v;
    if (typeof t === 'string') return t;
    if (t && typeof t === 'object' && typeof t.coll === 'string') return t.coll;
    return null;
}
/** LÈVE si une agrégation écrirait dans `cartes_produits` (ou dans une cible qui ne se détermine pas) : `$merge` et `$out` créent des lignes sans passer par aucune méthode d'écriture. */
function verifierAgregation(pipeline) {
    if (pipeline === undefined) return;
    if (!Array.isArray(pipeline)) throw new Error(`lignes détachées : aggregate dont le pipeline n'est pas un tableau — je ne sais pas conclure, rien n'est écrit`);
    for (const etape of pipeline) {
        const cible = cibleDEcriture(etape);
        if (cible === null) throw new Error(`lignes détachées : aggregate avec un $merge/$out dont la cible est indéterminable — je ne sais pas conclure, rien n'est écrit. ${SORTIES}`);
        if (cible === 'cartes_produits') throw new Error(`lignes détachées : aggregate avec $merge/$out vers cartes_produits — il créerait des lignes que le filet ne peut pas juger, rien n'est écrit. ${SORTIES}`);
    }
}
const retablir = () => { const p = process.env.LIGNES_DETACHEES_RETABLIR; return typeof p === 'string' && p.trim().length >= 20 ? p.trim() : null; };
let dit = false;

/** Enveloppe une collection `cartes_produits` : les écritures qui CRÉENT sont jugées avant d'être faites ; tout le reste passe tel quel. `lire` : async () → Set des lignes interdites. */
function garderCollectionLignes(coll, lire, levee = () => false) {
    return new Proxy(coll, {
        get(cible, p) {
            const v = Reflect.get(cible, p, cible);
            if (typeof v !== 'function') return v;
            if (p === 'aggregate') return (pipeline, ...r) => { if (!levee() && !retablir()) verifierAgregation(pipeline); return v.apply(cible, [pipeline, ...r]); };
            if (BULK.includes(p)) return (...args) => {         // synchrone (rend le constructeur) : refusé, sauf restauration d'un lot ou phrase de rétablissement
                if (!levee() && !retablir()) throw new Error(`lignes détachées : ${p} est refusé sur cartes_produits (les écritures qu'il accumule échappent au filet) — utiliser bulkWrite, rien n'est écrit. ${SORTIES}`);
                return v.apply(cible, args);
            };
            if (!METHODES.includes(p)) return v.bind(cible);
            return async (...args) => {
                if (levee()) return v.apply(cible, args);      // restauration d'un lot : l'état EXACT d'avant le lot, jamais jugé (sansGardeLignes)
                const ids = idsCreesPar(p, args);
                const phrase = retablir();
                if (phrase) { if (!dit) { dit = true; console.warn(`⚠️ LIGNES_DETACHEES_RETABLIR posée (« ${phrase} ») : la garde des lignes détachées est levée pour ce processus`); } }
                else if (ids === null || ids.length) {
                    let interdits;
                    if (ids !== null) { try { interdits = await lire(); } catch (e) { throw new Error(`lignes détachées : je ne peux pas lire les restes « ${TYPE_RESTE} » (${String(e.message).slice(0, 120)}) — une création n'est jamais écrite sans les avoir lus`); } }
                    verifierEcriture(p, args, interdits || new Set());
                }
                return v.apply(cible, args);
            };
        }
    });
}

/** Les AUTRES collections de la connexion : seule leur `aggregate` est regardée ($merge/$out vers cartes_produits) ; tout le reste est intact. */
function garderAgregation(coll, levee) {
    return new Proxy(coll, {
        get(cible, p) {
            const v = Reflect.get(cible, p, cible);
            if (typeof v !== 'function') return v;
            if (p === 'aggregate') return (pipeline, ...r) => { if (!levee() && !retablir()) verifierAgregation(pipeline); return v.apply(cible, [pipeline, ...r]); };
            return v.bind(cible);
        }
    });
}

/**
 * Installe la garde sur un `Db` natif (celui de la connexion mongoose `cartes`) : `db.collection('cartes_produits')` rend la collection enveloppée, et les modèles mongoose créés ensuite
 * (qui prennent leur collection native dans `db`) la partagent. Idempotente. Les restes sont lus à la première création, puis relus au plus toutes les 30 s.
 */
function installerGardeLignes(db, { ttlMs = 30000 } = {}) {
    if (db.__gardeLignes) return db;
    const original = db.collection.bind(db);
    let cache = null;
    const lire = async () => { if (!cache || Date.now() - cache.t > ttlMs) cache = { t: Date.now(), v: await lireInterdits(original('restes')) }; return cache.v; };
    db.__gardeLignes = true;
    db.__gardeLignesLevee = 0;
    const levee = () => db.__gardeLignesLevee > 0;
    db.collection = (nom, ...a) => (nom === 'cartes_produits' ? garderCollectionLignes(original(nom, ...a), lire, levee) : garderAgregation(original(nom, ...a), levee));
    return db;
}

/**
 * Exécute `fn` avec le filet LEVÉ sur CETTE connexion seulement (un compteur sur l'objet `db`, jamais une variable d'environnement : une commande enfant ne l'hérite pas ni aucun autre `Db`).
 * Réservé à la RESTAURATION d'un lot (lot-additif.js) : elle remet l'état exact d'avant le lot, y compris une ligne que le lot lui-même avait détachée. Le filet se remet quoi qu'il arrive (finally).
 * Sur un `db` sans filet, `fn` s'exécute simplement : il n'y a rien à lever.
 */
async function sansGardeLignes(db, fn) {
    if (!db.__gardeLignes) return fn();
    db.__gardeLignesLevee++;
    try { return await fn(); } finally { db.__gardeLignesLevee--; }
}

module.exports = { TYPE_RESTE, idLigne, interditsDe, filtrerLignes, lireInterdits, preverifierLignes, idsCreesPar, verifierEcriture, garderCollectionLignes, installerGardeLignes, sansGardeLignes, verifierAgregation, METHODES };
