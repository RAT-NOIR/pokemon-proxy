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
    const uriProduction = env.MONGODB_URI, uriCartes = env.MONGODB_CARTES_URI;
    return {
        origine: r.origine, uri, arreter, uriProduction,
        appliquer() {
            for (const nom of variablesDeConnexion(env, fichierEnv)) env[nom] = uri;
            env.BANC_ISOLE = '1';
            env.BANC_HOTES = hotesDe(uri).join(',');
            installerGardeEcriture(require('mongoose').Collection, env);
        },
        /** Connexion mongoose à la base `test` de production, pour LIRE (find, count, aggregate). Les écritures y sont refusées par la garde. */
        async connexionProduction(mongoose, dbName) {
            if (dbName !== 'test') throw new Error('connexionProduction : seule la base « test » se lit (production en lecture seule) ; jamais test_scratch ni cartes.');
            if (!uriProduction) throw new Error('connexionProduction : MONGODB_URI absente, rien à lire.');
            return mongoose.createConnection(uriProduction, { dbName }).asPromise();
        },
        /** Connexion mongoose à la base `cartes` (autre grappe de production), pour LIRE des cartes réelles à copier dans le banc. Écritures refusées. */
        async connexionCartes(mongoose, dbName) {
            if (dbName !== 'cartes') throw new Error('connexionCartes : seule la base « cartes » se lit ici (lecture seule).');
            if (!uriCartes) throw new Error('connexionCartes : MONGODB_CARTES_URI absente, rien à lire.');
            return mongoose.createConnection(uriCartes, { dbName }).asPromise();
        }
    };
}

const METHODES_ECRITURE = ['insertOne', 'insertMany', 'updateOne', 'updateMany', 'replaceOne', 'deleteOne', 'deleteMany', 'findOneAndUpdate',
    'findOneAndDelete', 'findOneAndReplace', 'bulkWrite', 'drop', 'createIndex', 'createIndexes', 'dropIndex', 'dropIndexes', 'rename', 'findAndModify'];

/**
 * 🔑 LA GARDE D'ÉCRITURE : sous BANC_ISOLE=1, toute écriture d'une collection mongoose dont la connexion n'est PAS sur l'hôte du banc (ou dont
 * l'hôte est encore inconnu : doute = refus) lève. La lecture de la production reste permise (find, aggregate…). Idempotente.
 * `Collection` est mongoose.Collection (les méthodes y sont posées une à une depuis le pilote) ; passée en paramètre pour être testée sur une fausse.
 */
function installerGardeEcriture(Collection, env = process.env) {
    for (const m of METHODES_ECRITURE) {
        const original = Collection.prototype[m];
        if (typeof original !== 'function' || original.__gardeBanc) continue;
        const gardee = function (...args) {
            if (env.BANC_ISOLE === '1' && !(this?.conn?.host && verifierHoteBanc(`mongodb://${this.conn.host}/`, env).ok)) {
                throw new Error(`🔴 ÉCRITURE REFUSÉE (${m}) : la connexion de cette collection n'est pas sur l'hôte du banc — un banc n'écrit jamais ailleurs que sur sa base.`);
            }
            return original.apply(this, args);
        };
        gardee.__gardeBanc = true;
        Collection.prototype[m] = gardee;
    }
}

module.exports = { hotesDe, cleDeGrappe, jugerUri, verifierHoteBanc, resoudre, ouvrirBanc, memoireInstallee, variablesDeConnexion, installerGardeEcriture, METHODES_ECRITURE };
