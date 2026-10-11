'use strict';
// LA FAÇADE DE LECTURE — sans dépendance à mongodb-memory-server : la PRODUCTION peut la charger (le chargeur en mémoire de l'API, lot COTES-VISUELS).
// Elle vivait dans base-banc.js (qui n'est jamais chargé en production) ; elle y est ré-exportée à l'identique, une seule définition (§21 bis).
// Écrite par ce qu'elle AUTORISE : une liste fermée de lectures, et un jugement de la VALEUR que le pilote rend.
// ── LA FAÇADE DE LECTURE : une liste FERMÉE de ce qui est sûr (jamais une liste de ce qui est interdit).
const LECTURES_COLLECTION = new Set(['find', 'findOne', 'countDocuments', 'estimatedDocumentCount', 'distinct', 'aggregate']);
const LECTURES_BASE = new Set(['databaseName', 'collection', 'listCollections', 'db', 'close']);
const refusLecture = (quoi) => new Error(`🔴 LECTURE SEULE : « ${quoi} » n'est pas dans la liste fermée de ce qu'un banc peut faire sur la production (find, findOne, countDocuments, estimatedDocumentCount, distinct, listCollections, aggregate sans $out/$merge).`);
const ecritDansPipeline = (x) => Array.isArray(x) ? x.some(ecritDansPipeline) : (x && typeof x === 'object') ? Object.entries(x).some(([k, v]) => k === '$out' || k === '$merge' || ecritDansPipeline(v)) : false;

// ── LE CURSEUR : enveloppé lui aussi, à liste fermée. Le curseur natif porte de quoi ÉCRIRE (AggregationCursor.out() et addStage() ajoutent un
// $out/$merge APRÈS la vérification du pipeline d'entrée) et de quoi s'échapper (l'accesseur `client` rend le MongoClient, `clone()` un curseur
// natif, `lookup`, `redact`… d'autres étapes). Trouvé dans le pilote : aucune propriété du curseur n'est sûre hors de cette liste.
const LECTURES_CURSEUR = new Set(['toArray', 'next', 'tryNext', 'hasNext', 'forEach', 'close', 'batchSize', 'maxTimeMS']);   // `stream` : retiré (tour 4, aucun appelant)
// constructeurs : chacun rend à son tour le curseur ENVELOPPÉ, et son argument ne doit contenir ni $out ni $merge
const CONSTRUCTEURS_CURSEUR = new Set(['limit', 'skip', 'sort', 'project', 'match', 'group', 'unwind', 'map']);

// ── 🔑 CE QUI SORT (tour 4) : la garde ne juge plus des NOMS (trois tours, un trou chacun : `batchSize` rendait `this` du pilote, `stream()` un flux
// natif portant `_cursor`), elle juge la VALEUR que le pilote rend. Une seule fonction, écrite par ce qu'elle AUTORISE :
//   · undefined, null, booléen, nombre, bigint, chaîne ;
//   · un DOCUMENT : un objet de prototype Object.prototype ou null (ce que rend la désérialisation BSON du pilote), un tableau, dont CHAQUE valeur
//     (récursivement, profondeur bornée) est elle-même une valeur de cette liste, un Date, ou une instance d'un type BSON (ObjectId, Decimal128,
//     Binary, Long…) ; propriétés de données seulement (ni accesseur, ni clé symbole) ;
//   · le curseur NATIF lui-même (le pilote rend `this`) — remplacé par l'ENVELOPPE ;
//   · une promesse de l'un de ces éléments, attendue puis jugée pareil.
// Tout le reste LÈVE : un curseur, un flux (ReadableCursorStream : prototype Readable), un client (MongoClient), une fonction, un EventEmitter, un thenable,
// une Map, toute instance de classe inconnue — leur prototype n'est ni Object.prototype ni null, ni un type BSON ; et un objet simple qui en porterait un
// dedans est refusé par la récursion (une fonction n'est pas une valeur). Un doute est un refus.
// 🔑 Tour 5 : « autorisé » veut dire EXACTEMENT ceci, et rien de plus large. Aucun Proxy à aucun niveau (util.types.isProxy : un Proxy peut mentir sur son
// prototype et ses clés) ; un tableau a le prototype Array.prototype, pour seules clés propres ses indices et `length`, en descripteurs de données ;
// un Date ou un type BSON a le prototype EXACT de sa classe (pas une sous-classe, pas Object.create(Classe.prototype)) et pour seules clés propres celles
// que porte une instance réelle du pilote (table ci-dessous), en descripteurs de données, chacune de la nature attendue.
// Refus VOULUS, qui échouent vers la sécurité : plus de 64 niveaux d'imbrication, et un RegExp natif (le pilote rend BSONRegExp, jamais RegExp).
const { isProxy } = require('util').types;
// Origine : `Reflect.ownKeys(new X())` lu sur une vraie instance de chaque classe (mongodb/bson du dépôt, 2026-10-08, sonde jetable). 'u8' = Uint8Array/Buffer
// (jamais parcouru), 'prim' = valeur simple, 'val' = valeur jugée récursivement (document, ObjectId…).
const NATURES = {
    ObjectId: { buffer: 'u8' }, Decimal128: { bytes: 'u8' }, Binary: { sub_type: 'prim', buffer: 'u8', position: 'prim' }, Long: { low: 'prim', high: 'prim', unsigned: 'prim' },
    Timestamp: { low: 'prim', high: 'prim', unsigned: 'prim' }, Double: { value: 'prim' }, Int32: { value: 'prim' }, MinKey: {}, MaxKey: {}, Code: { code: 'prim', scope: 'val' },
    BSONRegExp: { pattern: 'prim', options: 'prim' }, BSONSymbol: { value: 'prim' }, DBRef: { collection: 'prim', oid: 'val', db: 'prim', fields: 'val' }, UUID: { sub_type: 'prim', buffer: 'u8', position: 'prim' }
};
// prototype exact -> table des clés propres permises ; Date : aucune clé. Calculé à la PREMIÈRE utilisation (jamais à l'import : ce module ne doit pas pouvoir
// lever en se chargeant) et par `mongoose.mongo` — le pilote que mongoose utilise réellement, sans `require('mongodb')` (non déclaré dans le package.json racine).
let _classes = null;
function classes() {
    if (_classes) return _classes;
    const m = require('mongoose').mongo, t = new Map([[Date.prototype, {}]]);
    for (const [nom, cles] of Object.entries(NATURES)) { if (typeof m[nom] === 'function') t.set(m[nom].prototype, cles); }
    if (!t.has(m.ObjectId.prototype) || !t.has(m.Binary.prototype)) throw new Error('base-banc : le pilote mongodb n\'exporte plus ObjectId/Binary — la garde de sortie ne sait plus reconnaître un document, refusé.');
    return (_classes = t);
}
// Un tampon (ObjectId.buffer, Binary.buffer…) : un VRAI Uint8Array/Buffer (util.types.isUint8Array lit le slot interne, pas le prototype), non-Proxy, au
// prototype EXACT Uint8Array.prototype ou Buffer.prototype (ni sous-classe, ni objet ordinaire au prototype changé), sans autre clé propre que ses indices.
const { isUint8Array } = require('util').types;
const estTampon = v => isUint8Array(v) && !isProxy(v) && (Object.getPrototypeOf(v) === Uint8Array.prototype || Object.getPrototypeOf(v) === Buffer.prototype) && Reflect.ownKeys(v).length === v.length;
const ENVELOPPES = new WeakSet();   // nos propres enveloppes : jamais une valeur de document
const estIndice = k => typeof k === 'string' && /^(0|[1-9]\d*)$/.test(k);
const estPrim = v => v === null || v === undefined || ['string', 'number', 'boolean', 'bigint'].includes(typeof v);

function estValeurBson(x, prof = 0) {
    if (prof > 64) return false;
    if (x === null || x === undefined) return true;
    const t = typeof x;
    if (t === 'string' || t === 'number' || t === 'boolean' || t === 'bigint') return true;
    if (t !== 'object') return false;
    if (isProxy(x) || ENVELOPPES.has(x)) return false;
    const proto = Object.getPrototypeOf(x);
    if (proto === Object.prototype || proto === null) {   // le cas ordinaire d'abord : un document simple
        for (const k of Reflect.ownKeys(x)) {
            if (typeof k === 'symbol') return false;
            const d = Object.getOwnPropertyDescriptor(x, k);
            if (!d || !('value' in d) || !estValeurBson(d.value, prof + 1)) return false;
        }
        return true;
    }
    if (proto === Array.prototype) {
        for (const k of Reflect.ownKeys(x)) {
            if (k === 'length') continue;
            if (!estIndice(k) || Number(k) >= x.length) return false;
            const d = Object.getOwnPropertyDescriptor(x, k);
            if (!d || !('value' in d) || !estValeurBson(d.value, prof + 1)) return false;
        }
        return true;
    }
    const permises = classes().get(proto);
    if (!permises) return false;
    for (const k of Reflect.ownKeys(x)) {
        const nature = typeof k === 'string' ? permises[k] : undefined;
        const d = nature ? Object.getOwnPropertyDescriptor(x, k) : null;
        if (!d || !('value' in d)) return false;
        if (nature === 'u8' ? !estTampon(d.value) : nature === 'prim' ? !estPrim(d.value) : !estValeurBson(d.value, prof + 1)) return false;
    }
    return true;
}

/** Juge une valeur obtenue du pilote natif ; la rend (ou rend l'enveloppe si c'est le curseur natif lui-même), ou LÈVE « LECTURE SEULE ».
 *  `lien` = { natif, enveloppe } ; `document: true` interdit aussi de rendre l'enveloppe (callbacks, itérateur : seuls des documents). */
function sortieSure(v, lien = {}, { document = false } = {}) {
    if (lien.natif !== undefined && v === lien.natif) { if (document) throw refusLecture('un curseur natif comme document'); return lien.enveloppe; }   // identité : aucun piège de Proxy possible
    if (v !== null && typeof v === 'object' && isProxy(v)) throw refusLecture('Proxy');
    if (v instanceof Promise) return v.then(x => sortieSure(x, lien, { document }));
    if (estValeurBson(v)) return v;
    throw refusLecture(`valeur rendue par le pilote (${v === null ? 'null' : typeof v === 'object' ? (Object.getPrototypeOf(v)?.constructor?.name || 'objet') : typeof v}) : ni valeur simple, ni document`);
}

function envelopperCurseur(curseur) {
    const lien = { natif: curseur, enveloppe: null };
    const appeler = (p, a, opts) => {
        const f = curseur[p];
        if (typeof f !== 'function') throw refusLecture(`curseur.${p} (n'est pas une méthode)`);
        return sortieSure(f.apply(curseur, a), lien, opts);
    };
    // un callback (forEach, map) ne reçoit que des documents
    const gardeCallback = a => a.map(x => typeof x === 'function' ? (d, ...r) => x(sortieSure(d, lien, { document: true }), ...r) : x);
    const iterateur = async function* () {
        let origine = null;
        try { for (; ;) { const d = await appeler('next', [], { document: true }); if (d === null || d === undefined) return; yield d; } }
        catch (e) { origine = e; throw e; }
        finally { try { await appeler('close', []); } catch (e) { if (!origine) throw e; } }   // si close() lève après une erreur, l'erreur d'ORIGINE sort
    };
    const enveloppe = new Proxy({}, {
        get(_, p) {
            if (p === 'then') return undefined;
            if (p === Symbol.asyncIterator) return iterateur;   // écrit par l'enveloppe (son propre next()), jamais délégué au natif
            if (typeof p === 'symbol') return undefined;
            if (CONSTRUCTEURS_CURSEUR.has(p)) {
                return (...a) => {
                    if (ecritDansPipeline(a)) throw refusLecture(`curseur.${p} avec $out/$merge`);
                    return appeler(p, p === 'map' ? gardeCallback(a) : a);   // le pilote rend son curseur ; sortieSure rend l'ENVELOPPE à sa place
                };
            }
            if (LECTURES_CURSEUR.has(p)) return (...a) => appeler(p, p === 'forEach' ? gardeCallback(a) : a);
            throw refusLecture(`curseur.${String(p)}`);
        }
    });
    lien.enveloppe = enveloppe; ENVELOPPES.add(enveloppe);
    return enveloppe;
}

function facadeLecture(db, fermer = async () => { }) {
    const collection = nom => {
        const c = db.collection(nom);
        return new Proxy({}, {
            get(_, p) {
                if (typeof p === 'symbol' || p === 'then') return undefined;
                if (!LECTURES_COLLECTION.has(p)) throw refusLecture(`collection.${String(p)}`);
                if (p === 'aggregate') return (pipeline, ...r) => { if (ecritDansPipeline(pipeline)) throw refusLecture('aggregate avec $out/$merge'); return envelopperCurseur(c.aggregate(pipeline, ...r)); };
                if (p === 'find') return (...a) => envelopperCurseur(c.find(...a));
                return (...a) => sortieSure(c[p](...a));   // findOne, countDocuments, estimatedDocumentCount, distinct : jugés comme tout ce qui sort
            }
        });
    };
    const facade = new Proxy({}, {
        get(_, p) {
            if (typeof p === 'symbol' || p === 'then') return undefined;
            if (!LECTURES_BASE.has(p)) throw refusLecture(`db.${String(p)}`);
            if (p === 'databaseName') return sortieSure(db.databaseName);
            if (p === 'db') return facade;
            if (p === 'collection') return collection;
            if (p === 'listCollections') return (...a) => envelopperCurseur(db.listCollections(...a));
            return async (...a) => { await fermer(...a); };   // `cx.close()` rend la connexion mongoose (NativeConnection) : on la JETTE, rien n'en sort
        }
    });
    return facade;
}

module.exports = { facadeLecture, sortieSure, ecritDansPipeline, refusLecture };
