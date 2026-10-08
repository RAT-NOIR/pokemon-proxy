// ============================================================================
// LA BASE DES BANCS — UNE SEULE PORTE, ÉCRITE PAR CE QU'ELLE AUTORISE
// ============================================================================
// Décision du testeur (2026-10-08) : « AUCUN banc ne doit plus jamais écrire dans la grappe de production. »
// `test_scratch` vit sur la grappe de PRODUCTION (MONGODB_URI) : elle a dépassé DEUX fois l'arrêt dur de 480 Mo le même jour, la place étant
// prise par des collections VIDES laissées par les outils du dépôt (lot FUITE-MAIN : `deleteMany` garde fichier et index). Le vidage en `drop`
// (verrou/bac.js) limite les dégâts ; ce module les SUPPRIME : un banc n'ouvre plus la production, il ouvre une base de banc ou il refuse.
//
// Une base de banc est, dans cet ordre, la SEULE de ces trois choses :
//   (a) une base mongodb-memory-server — si le paquet est installé (rien n'est installé par ce dépôt sans feu vert) ;
//   (b) MONGODB_TEST_URI (grappe de test dédiée) — SEULEMENT si son hôte n'est celui ni de MONGODB_URI ni de MONGODB_CARTES_URI ;
//   (c) sinon : REFUS de démarrer, « aucune base de test hors production ». JAMAIS de repli silencieux sur test_scratch de la production.
// 🔑 Une garde s'écrit par ce qu'elle autorise : un URI n'est accepté que si l'on a pu le LIRE, le COMPARER aux deux grappes de production, et
// qu'il n'en est aucune. Un doute (URI illisible, variable de production absente) est un refus. Aucun message ne contient de valeur de variable.
// ⚠️ ADRESSES IP : une URI de banc en adresse IP HORS LOOPBACK est REFUSÉE. On ne résout pas le DNS ici, donc on ne sait pas si cette adresse
// est un nœud de la production (un nœud Atlas répond aussi par IP) : un doute est un refus. Seuls 127.x, ::1 et localhost passent sans nom.
//
// 🔴 ET LE REFUS NE TIENT QUE SI LES ENFANTS LE VOIENT. Les outils `import-*.js` lancés par un banc font `require('dotenv').config()` : dotenv
// REMET dans l'enfant toute variable ABSENTE de l'environnement hérité. Supprimer MONGODB_CARTES_URI ne la retirait donc pas, il la rendait au
// .env (la production). `appliquer()` REMPLACE : chaque variable MONGODB_*URI connue (environnement et .env) vaut l'URI du banc — dotenv
// n'écrase pas une variable présente — et pose BANC_ISOLE=1 + BANC_HOTES ; `verifierHoteBanc` (mongo-connexion.js, collecte-cartes/garde.js)
// refuse alors toute connexion dont l'hôte n'est pas celui du banc.

const fs = require('fs');
const path = require('path');

/** Hôtes d'une URI mongodb:// ou mongodb+srv:// (minuscules, sans port, sans point final) ; [] si elle n'est pas lisible. */
function hotesDe(uri) {
    if (typeof uri !== 'string') return [];
    const m = /^mongodb(?:\+srv)?:\/\/(?:[^@/]*@)?([^/?#]+)/i.exec(uri.trim());
    if (!m) return [];
    const hotes = m[1].split(',').map(h => h.trim().toLowerCase().replace(/(?<=\]|[^:\]]):\d+$/, '').replace(/\.$/, '')).filter(Boolean);
    return hotes.some(h => !/^(\[[0-9a-f:.]+\]|[a-z0-9._-]+)$/.test(h)) ? [] : hotes;
}

/** Identité de GRAPPE d'un hôte : un hôte Atlas (srv `cluster0.abcde.mongodb.net` ou shard `cluster0-shard-00-00.abcde.mongodb.net`) se compare
 *  par ses trois derniers labels (`abcde.mongodb.net`) ; tout autre hôte, tel quel. */
function cleDeGrappe(hote) {
    const l = hote.split('.');
    return hote.endsWith('.mongodb.net') && l.length >= 4 ? l.slice(-3).join('.') : hote;
}

const estIp = h => /^\d{1,3}(\.\d{1,3}){3}$/.test(h) || /^\[.*\]$/.test(h);
const estLoopback = h => /^127(\.\d{1,3}){3}$/.test(h) || h === '[::1]' || h === 'localhost';

/**
 * Cette URI peut-elle servir de base de banc ? { ok, raison }. `env` porte MONGODB_URI et MONGODB_CARTES_URI (les deux grappes de production).
 */
function jugerUri(uri, env = process.env) {
    const hotes = hotesDe(uri);
    if (!hotes.length) return { ok: false, raison: 'URI de banc illisible : je ne peux pas dire où elle pointe, refusé.' };
    const ip = hotes.find(h => estIp(h) && !estLoopback(h));
    if (ip) return { ok: false, raison: 'URI de banc en adresse IP hors loopback : le DNS n\'est pas résolu, je ne peux pas exclure que ce soit un nœud de production (doute = refus).' };
    const prod = [];
    for (const nom of ['MONGODB_URI', 'MONGODB_CARTES_URI']) {
        const h = hotesDe(env[nom]);
        if (!h.length) return { ok: false, raison: `${nom} absente ou illisible : je ne peux pas comparer à la production, refusé.` };
        prod.push(...h.map(cleDeGrappe));
    }
    if (hotes.some(h => prod.includes(cleDeGrappe(h)))) return { ok: false, raison: 'hôte = production : refusé (un banc n\'écrit jamais dans une grappe de production).' };
    return { ok: true, raison: null };
}

/**
 * Sous BANC_ISOLE=1, une connexion n'est permise que vers l'hôte du banc (BANC_HOTES). Hors banc : ne dit rien (ok). Un doute refuse.
 * @param {string} uri  l'URI (ou `mongodb://<hôte>/` pour un hôte déjà connecté)
 */
function verifierHoteBanc(uri, env = process.env) {
    if (env.BANC_ISOLE !== '1') return { ok: true, isole: false, raison: null };
    const banc = (env.BANC_HOTES || '').split(',').map(h => h.trim()).filter(Boolean).map(cleDeGrappe);
    const hotes = hotesDe(uri);
    if (!banc.length) return { ok: false, isole: true, raison: 'BANC_ISOLE=1 sans BANC_HOTES : je ne sais pas où est le banc, refusé.' };
    if (!hotes.length) return { ok: false, isole: true, raison: 'BANC_ISOLE=1 et URI illisible : refusé.' };
    if (!hotes.every(h => banc.includes(cleDeGrappe(h)))) return { ok: false, isole: true, raison: 'BANC_ISOLE=1 : l\'hôte de cette connexion n\'est pas celui du banc, refusé (hôte = production ou inconnu).' };
    return { ok: true, isole: true, raison: null };
}

// Le paquet mongodb-memory-server vit dans `.banc-local/` (son package.json et son lock épinglés, HORS du package.json du dépôt : Render ne
// l'installe jamais) ; son binaire mongod (≈ 78 Mo) est mis en cache dans `.banc-local/cache-mongod/`. Absent = refus, comme avant.
//   installation : npm ci --prefix .banc-local   (avec MONGOMS_DOWNLOAD_DIR=<racine>/.banc-local/cache-mongod pour garder le binaire sur place)
const DOSSIER_BANC = path.join(__dirname, '..', '.banc-local');
const CACHE_MONGOD = path.join(DOSSIER_BANC, 'cache-mongod');

function cheminMemoire() {
    try { return require.resolve('mongodb-memory-server', { paths: [DOSSIER_BANC] }); } catch (_) { return null; }
}
function memoireInstallee() { return cheminMemoire() !== null; }

/**
 * Quelle base de banc, ou le refus. { ok, origine, uri?, raison? }. Pure : ne se connecte à rien.
 */
function resoudre(env = process.env, { memoireDisponible = memoireInstallee() } = {}) {
    const test = env.MONGODB_TEST_URI;
    if (test !== undefined && test !== '') {
        // une MONGODB_TEST_URI posée doit être saine, même si le paquet mémoire est là : une variable mal posée ne se contourne pas en silence
        const j = jugerUri(test, env);
        if (!j.ok) return { ok: false, origine: null, raison: `MONGODB_TEST_URI refusée — ${j.raison}` };
    }
    if (memoireDisponible) return { ok: true, origine: 'memoire' };
    if (test) return { ok: true, origine: 'MONGODB_TEST_URI', uri: test };
    return {
        ok: false, origine: null,
        raison: 'aucune base de test hors production : installer mongodb-memory-server, ou définir MONGODB_TEST_URI (une grappe de test DÉDIÉE, ' +
            'jamais MONGODB_URI ni MONGODB_CARTES_URI). Un banc ne se rabat pas sur test_scratch de la production.'
    };
}

/** Les noms de variables MONGODB_*URI à remplacer : les trois connues, celles de l'environnement, et celles du .env (valeur en mongodb://). */
function variablesDeConnexion(env, fichierEnv) {
    const noms = new Set(['MONGODB_URI', 'MONGODB_CARTES_URI', 'MONGODB_TEST_URI']);
    const estUri = v => typeof v === 'string' && /^mongodb(\+srv)?:\/\//i.test(v.trim());
    for (const [k, v] of Object.entries(env)) if (/^MONGODB_/.test(k) && estUri(v)) noms.add(k);
    try {
        for (const [k, v] of Object.entries(require('dotenv').parse(fs.readFileSync(fichierEnv)))) if (/^MONGODB_/.test(k) && estUri(v)) noms.add(k);
    } catch (_) { /* pas de .env lisible : les noms connus et ceux de l'environnement restent remplacés */ }
    return [...noms];
}

/**
 * Ouvre la base du banc ou LÈVE (le banc ne démarre pas). Rend { origine, uri, arreter(), appliquer() }.
 * `appliquer()` : REMPLACE chaque variable MONGODB_*URI (environnement et .env) par l'URI du banc et pose BANC_ISOLE=1 / BANC_HOTES. À appeler
 * AVANT tout require qui lit MONGODB_*, toute connexion et tout lancement de sous-processus.
 */
async function ouvrirBanc({ env = process.env, memoireDisponible, fichierEnv = path.join(__dirname, '..', '.env') } = {}) {
    const r = resoudre(env, memoireDisponible === undefined ? undefined : { memoireDisponible });
    if (!r.ok) throw new Error(`🔴 BANC REFUSÉ — ${r.raison}`);
    let uri = r.uri, arreter = async () => { };
    if (r.origine === 'memoire') {
        if (!process.env.MONGOMS_DOWNLOAD_DIR) process.env.MONGOMS_DOWNLOAD_DIR = CACHE_MONGOD;
        // un ensemble de réplicas à UN nœud, pas un mongod isolé : le webhook Stripe écrit en transaction (« Transaction numbers are only
        // allowed on a replica set member »), comme la production Atlas. Même binaire, quelques secondes de démarrage en plus.
        const { MongoMemoryReplSet } = require(cheminMemoire());
        const ms = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
        uri = ms.getUri();
        arreter = () => ms.stop();
    }
    // L'URI de production, gardée AVANT le remplacement, pour les seuls bancs qui LISENT la production (copie d'une tranche, journal des scans).
    // Elle ne passe jamais dans l'environnement : les enfants ne la voient pas. Toute écriture mongoose vers elle est refusée (garde ci-dessous).
    // Un utilisateur Atlas en LECTURE SEULE (MONGODB_LECTURE_URI / MONGODB_CARTES_LECTURE_URI), s'il existe, est préféré ; la façade s'applique de toute façon.
    const uriProduction = env.MONGODB_LECTURE_URI || env.MONGODB_URI, uriCartes = env.MONGODB_CARTES_LECTURE_URI || env.MONGODB_CARTES_URI;
    return {
        origine: r.origine, uri, arreter, uriProduction, uriCartes,
        appliquer() {
            // R2 : la liste des buckets de PRODUCTION est figée AVANT tout remplacement ; R2_BUCKET_BANC ne peut pas en faire partie
            const buckets = Object.entries(env).filter(([k, v]) => /^R2_BUCKET_/.test(k) && k !== 'R2_BUCKET_BANC' && v).map(([, v]) => v);
            if (env.R2_BUCKET_BANC && buckets.includes(env.R2_BUCKET_BANC)) throw new Error('🔴 BANC REFUSÉ — R2_BUCKET_BANC est égal à un bucket R2 de production : un banc n\'écrit jamais dans la production, R2 compris.');
            for (const nom of variablesDeConnexion(env, fichierEnv)) env[nom] = uri;
            env.BANC_ISOLE = '1';
            env.BANC_HOTES = hotesDe(uri).join(',');
            env.BANC_R2_INTERDITS = [...new Set(buckets)].join(',');
            if (env.R2_BUCKET_BANC) for (const k of Object.keys(env)) if (/^R2_BUCKET_/.test(k) && k !== 'R2_BUCKET_BANC') env[k] = env.R2_BUCKET_BANC;
            installerGardeEcriture(require('mongoose').Collection, env);
        },
        /** La base `test` de production, pour LIRE : une FAÇADE à liste fermée (find, findOne, countDocuments, estimatedDocumentCount, distinct, listCollections,
         *  aggregate sans $out/$merge) — jamais la connexion ni le Db bruts. Tout le reste lève. */
        async connexionProduction(mongoose, dbName) {
            if (dbName !== 'test') throw new Error('connexionProduction : seule la base « test » se lit (production en lecture seule) ; jamais test_scratch ni cartes.');
            if (!uriProduction) throw new Error('connexionProduction : MONGODB_URI absente, rien à lire.');
            const cx = await mongoose.createConnection(uriProduction, { dbName }).asPromise();
            return facadeLecture(cx.db, () => cx.close());
        },
        /** La base `cartes` (autre grappe de production), pour LIRE des cartes réelles à copier dans le banc : même façade à liste fermée. */
        async connexionCartes(mongoose, dbName) {
            if (dbName !== 'cartes') throw new Error('connexionCartes : seule la base « cartes » se lit ici (lecture seule).');
            if (!uriCartes) throw new Error('connexionCartes : MONGODB_CARTES_URI absente, rien à lire.');
            const cx = await mongoose.createConnection(uriCartes, { dbName }).asPromise();
            return facadeLecture(cx.db, () => cx.close());
        }
    };
}

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
const TYPES_BSON = (() => {
    const m = require('mongodb');
    const t = ['ObjectId', 'Decimal128', 'Binary', 'Long', 'Timestamp', 'Double', 'Int32', 'MinKey', 'MaxKey', 'Code', 'BSONRegExp', 'BSONSymbol', 'DBRef', 'UUID'].map(k => m[k]).filter(f => typeof f === 'function');
    if (!t.includes(m.ObjectId) || !t.includes(m.Binary)) throw new Error('base-banc : le pilote mongodb n\'exporte plus ObjectId/Binary — la garde de sortie ne sait plus reconnaître un document, refusé.');
    return t;
})();
const ENVELOPPES = new WeakSet();   // nos propres enveloppes : jamais une valeur de document

function estValeurBson(x, prof = 0) {
    if (prof > 64) return false;
    if (x === null || x === undefined) return true;
    const t = typeof x;
    if (t === 'string' || t === 'number' || t === 'boolean' || t === 'bigint') return true;
    if (t !== 'object') return false;
    if (ENVELOPPES.has(x)) return false;
    if (x instanceof Date || TYPES_BSON.some(T => x instanceof T)) return true;
    if (Array.isArray(x)) { for (let i = 0; i < x.length; i++) if (!estValeurBson(x[i], prof + 1)) return false; return true; }
    const proto = Object.getPrototypeOf(x);
    if (proto !== Object.prototype && proto !== null) return false;
    for (const k of Reflect.ownKeys(x)) {
        if (typeof k === 'symbol') return false;
        const d = Object.getOwnPropertyDescriptor(x, k);
        if (!d || !('value' in d) || !estValeurBson(d.value, prof + 1)) return false;
    }
    return true;
}

/** Juge une valeur obtenue du pilote natif ; la rend (ou rend l'enveloppe si c'est le curseur natif lui-même), ou LÈVE « LECTURE SEULE ».
 *  `lien` = { natif, enveloppe } ; `document: true` interdit aussi de rendre l'enveloppe (callbacks, itérateur : seuls des documents). */
function sortieSure(v, lien = {}, { document = false } = {}) {
    if (v instanceof Promise) return v.then(x => sortieSure(x, lien, { document }));
    if (lien.natif !== undefined && v === lien.natif) { if (document) throw refusLecture('un curseur natif comme document'); return lien.enveloppe; }
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
        try { for (; ;) { const d = await appeler('next', [], { document: true }); if (d === null || d === undefined) return; yield d; } }
        finally { await appeler('close', []); }
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
            if (p === 'databaseName') return db.databaseName;
            if (p === 'db') return facade;
            if (p === 'collection') return collection;
            if (p === 'listCollections') return (...a) => envelopperCurseur(db.listCollections(...a));
            return async (...a) => { await fermer(...a); };   // `cx.close()` rend la connexion mongoose (NativeConnection) : on la JETTE, rien n'en sort
        }
    });
    return facade;
}

// toutes les opérations d'écriture du pilote natif qu'une collection mongoose expose (le reste — find, count… — est de la lecture) ;
// `aggregate` est traitée à part : permise en lecture, refusée avec $out/$merge. Les trois dernières lèvent de façon SYNCHRONE (elles ne rendent
// pas de promesse) ; toutes les autres REJETTENT la promesse, pour qu'un `.catch()` seul la capte.
const METHODES_ECRITURE = ['insertOne', 'insertMany', 'updateOne', 'updateMany', 'replaceOne', 'deleteOne', 'deleteMany', 'findOneAndUpdate',
    'findOneAndDelete', 'findOneAndReplace', 'bulkWrite', 'drop', 'createIndex', 'createIndexes', 'dropIndex', 'dropIndexes', 'rename', 'findAndModify',
    'watch', 'initializeOrderedBulkOp', 'initializeUnorderedBulkOp', 'mapReduce'];
const SYNCHRONES = new Set(['watch', 'initializeOrderedBulkOp', 'initializeUnorderedBulkOp']);

// ── R2 : sous BANC_ISOLE=1, la LECTURE est permise (liste fermée) ; toute autre commande n'est permise que vers R2_BUCKET_BANC, jamais un bucket de production.
const LECTURES_R2 = new Set(['GetObjectCommand', 'HeadObjectCommand', 'ListObjectsV2Command', 'ListObjectsCommand', 'HeadBucketCommand']);

/** { ok, raison } : cette commande S3 peut-elle partir ? Pure. */
function verifierEcritureR2(nomCommande, bucket, env = process.env) {
    if (env.BANC_ISOLE !== '1' || LECTURES_R2.has(nomCommande)) return { ok: true, raison: null };
    const banc = env.R2_BUCKET_BANC;
    if (!banc) return { ok: false, raison: `ÉCRITURE R2 REFUSÉE (${nomCommande}) : R2_BUCKET_BANC absent — un banc n'écrit jamais dans un bucket de production (même des clés idempotentes).` };
    const interdits = env.BANC_R2_INTERDITS !== undefined
        ? env.BANC_R2_INTERDITS.split(',').filter(Boolean)
        : Object.entries(env).filter(([k, v]) => /^R2_BUCKET_/.test(k) && k !== 'R2_BUCKET_BANC' && v).map(([, v]) => v);
    if (interdits.includes(banc)) return { ok: false, raison: `ÉCRITURE R2 REFUSÉE (${nomCommande}) : R2_BUCKET_BANC est égal à un bucket de production.` };
    if (bucket !== banc) return { ok: false, raison: `ÉCRITURE R2 REFUSÉE (${nomCommande}) : le bucket visé n'est pas R2_BUCKET_BANC.` };
    return { ok: true, raison: null };
}

/** Enrobe `client.send` : la décision tombe AVANT toute requête, et c'est la PROMESSE qui est rejetée. Idempotente.
 *  ⚠️ LIMITE : une URL PRÉSIGNÉE (getSignedUrl pour un PUT) ne passe pas par `send` — elle est signée localement puis appelée en HTTP par un autre
 *  chemin — donc pas par cette garde. Le dépôt n'a AUCUN présigneur aujourd'hui (grep de `@aws-sdk/s3-request-presigner` : aucune occurrence) ; si
 *  un présigneur y arrive, il doit lui aussi appeler `verifierEcritureR2` (commande PutObjectCommand, bucket visé) avant de signer, ou être refusé. */
function garderClientR2(client, env = process.env) {
    if (!client || client.send?.__gardeBanc) return client;
    const original = client.send.bind(client);
    const send = async (commande, ...r) => {
        const v = verifierEcritureR2(commande?.constructor?.name, commande?.input?.Bucket, env);
        if (!v.ok) throw new Error(`🔴 ${v.raison}`);
        return original(commande, ...r);
    };
    send.__gardeBanc = true;
    client.send = send;
    return client;
}

/**
 * 🔑 LA GARDE D'ÉCRITURE : sous BANC_ISOLE=1, toute écriture d'une collection mongoose dont la connexion n'est PAS sur l'hôte du banc (ou dont
 * l'hôte est encore inconnu : doute = refus) lève. La lecture de la production reste permise (find, aggregate…). Idempotente.
 * `Collection` est mongoose.Collection (les méthodes y sont posées une à une depuis le pilote) ; passée en paramètre pour être testée sur une fausse.
 */
function installerGardeEcriture(Collection, env = process.env) {
    for (const m of [...METHODES_ECRITURE, 'aggregate']) {
        const original = Collection.prototype[m];
        if (typeof original !== 'function' || original.__gardeBanc) continue;
        const gardee = function (...args) {
            const ecrit = m !== 'aggregate' || ecritDansPipeline(args[0]);   // aggregate : lecture permise, $out/$merge refusés
            if (ecrit && env.BANC_ISOLE === '1' && !(this?.conn?.host && verifierHoteBanc(`mongodb://${this.conn.host}/`, env).ok)) {
                const e = new Error(`🔴 ÉCRITURE REFUSÉE (${m}) : la connexion de cette collection n'est pas sur l'hôte du banc — un banc n'écrit jamais ailleurs que sur sa base.`);
                if (SYNCHRONES.has(m)) throw e;
                return Promise.reject(e);
            }
            return original.apply(this, args);
        };
        gardee.__gardeBanc = true;
        Collection.prototype[m] = gardee;
    }
}

module.exports = { hotesDe, cleDeGrappe, jugerUri, verifierHoteBanc, resoudre, ouvrirBanc, memoireInstallee, variablesDeConnexion, installerGardeEcriture, METHODES_ECRITURE,
    facadeLecture, sortieSure, verifierEcritureR2, garderClientR2 };
