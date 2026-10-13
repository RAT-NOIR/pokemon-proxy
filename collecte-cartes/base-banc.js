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
const os = require('os');
const path = require('path');

// ── LE DOSSIER TEMPORAIRE DE LA BASE EN MÉMOIRE (lot FUITE-BANCS, incident du 2026-10-13 : 478 dossiers `mongo-mem-*`, 85,7 Go, disque plein)
// mongodb-memory-server crée `<tmp>/mongo-mem-XXXXXX` et ne le retire que dans `stop()` : une exception, un `process.exit`, un SIGINT/SIGTERM ou un
// mongod qui ne démarre pas le laissaient. Ici le dossier est créé PAR CE MODULE (son chemin est donc noté à la création) et retiré à chaque sortie
// que le processus contrôle. 🔑 Écrit par ce qu'il AUTORISE : il ne part que si TOUT tient — noté par ce processus, enfant direct de tmpdir(), nom en
// `mongo-mem-`, ni lui ni rien dedans n'est un point de reparse (lstat sur chaque entrée AVANT toute suppression), mongod arrêté. Sinon il reste, et une ligne le dit.
// ⛔ Aucun balayage des dossiers d'un AUTRE processus. Une mise à mort (TerminateProcess, taskkill /F) n'exécute aucun code du processus : sa fuite est mesurée au rapport.
const PREFIXE_DOSSIER_BANC = 'mongo-mem-';
const TENTATIVES_SUPPRESSION = 5;          // verrou passager Windows (EBUSY, EPERM, ENOTEMPTY) : 5 tentatives au plus, 300 ms entre deux, jamais de boucle
const PAUSE_SUPPRESSION_MS = 300;
const DOSSIERS_NOTES = new Set();          // les chemins créés par CE processus, et eux seuls
// Le journal WiredTiger préallouait 2 × 100 Mo (WiredTigerLog + WiredTigerPreplog) : un dossier de banc pesait 200,7 Mo. Sans préallocation et à 5 Mo par fichier : 5,7 Mo
// mesurés après écriture et transaction. L'ensemble de réplicas à un nœud et les transactions restent (le webhook en dépend).
const ARGS_MONGOD_BANC = ['--wiredTigerEngineConfigString', 'log=(prealloc=false,file_max=5MB)'];

const dormirSync = (ms) => { try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch (_) { /* pas de pause possible : on réessaie quand même */ } };
const memeChemin = (a, b) => process.platform === 'win32' ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase() : path.resolve(a) === path.resolve(b);

/** Y a-t-il un point de reparse (jonction, lien) dans ce dossier, lui compris ? lstat sur chaque entrée, sans jamais suivre. Un doute (lstat qui échoue) vaut « oui ». */
function trouverReparse(dossier, fsx) {
    const pile = [dossier];
    while (pile.length) {
        const d = pile.pop();
        let st;
        try { st = fsx.lstatSync(d); } catch (e) { return `lstat impossible sur ${path.basename(d)} (${e.code || e.message})`; }
        if (st.isSymbolicLink()) return `point de reparse (lien ou jonction) : ${path.relative(path.dirname(dossier), d)}`;
        if (!st.isDirectory()) continue;
        let noms;
        try { noms = fsx.readdirSync(d); } catch (e) { return `lecture impossible de ${path.basename(d)} (${e.code || e.message})`; }
        for (const n of noms) pile.push(path.join(d, n));
    }
    return null;
}

/**
 * Retire UN dossier de banc, ou le laisse et dit pourquoi. Rend { retire, raison, tentatives }. Synchrone (sert aussi dans le crochet `exit`).
 * `notes` : les chemins créés par ce processus ; `tmp` : le dossier temporaire attendu comme parent ; `mongodArrete` : mongod est-il mort ?
 */
function retirerDossierBanc(chemin, { fs: fsx = fs, tmp = os.tmpdir(), notes = DOSSIERS_NOTES, mongodArrete = false, dormir = dormirSync, ecrire = (m) => console.error(m) } = {}) {
    const garder = (raison, tentatives = 0) => { ecrire(`[base-banc] dossier conservé (${raison}) : ${chemin}`); return { retire: false, raison, tentatives }; };
    if (typeof chemin !== 'string' || !chemin) return garder('aucun chemin');
    if (!notes.has(chemin)) return garder('ce processus ne l\'a pas créé');
    if (!memeChemin(path.dirname(chemin), tmp)) return garder('son parent n\'est pas le dossier temporaire');
    if (!path.basename(chemin).startsWith(PREFIXE_DOSSIER_BANC)) return garder(`son nom ne commence pas par ${PREFIXE_DOSSIER_BANC}`);
    if (!mongodArrete) return garder('mongod n\'est pas arrêté');
    let raison = null;
    try { if (!fsx.existsSync(chemin)) { notes.delete(chemin); return { retire: true, raison: 'déjà absent', tentatives: 0 }; } raison = trouverReparse(chemin, fsx); }
    catch (e) { raison = `contrôle impossible (${e.code || e.message})`; }
    if (raison) return garder(raison);
    let derniere = null;
    for (let t = 1; t <= TENTATIVES_SUPPRESSION; t++) {
        try { fsx.rmSync(chemin, { recursive: true, force: true }); notes.delete(chemin); return { retire: true, raison: null, tentatives: t }; }
        catch (e) {
            derniere = e;
            if (!['EBUSY', 'EPERM', 'ENOTEMPTY'].includes(e.code)) return garder(`suppression impossible : ${e.code || e.message}`, t);
            if (t < TENTATIVES_SUPPRESSION) dormir(PAUSE_SUPPRESSION_MS);
        }
    }
    return garder(`suppression impossible après ${TENTATIVES_SUPPRESSION} tentatives : ${derniere.code}`, TENTATIVES_SUPPRESSION);
}

/** Crée le dossier de base d'un banc dans tmpdir() et NOTE son chemin. */
function creerDossierBanc({ fs: fsx = fs, tmp = os.tmpdir(), notes = DOSSIERS_NOTES } = {}) {
    const d = fsx.mkdtempSync(path.join(tmp, PREFIXE_DOSSIER_BANC));
    notes.add(d);
    return d;
}

// ── Les sorties que le processus contrôle : `exit` (couvre process.exit, exception non rattrapée, fin normale) et les signaux.
const ARRETS_EN_COURS = new Set();         // fonctions de nettoyage synchrones des bancs encore ouverts
let crochetsPoses = false;
function poserCrochets() {
    if (crochetsPoses) return; crochetsPoses = true;
    process.on('exit', () => { for (const f of [...ARRETS_EN_COURS]) { try { f(); } catch (e) { console.error(`[base-banc] nettoyage à la sortie : ${e.message}`); } } });
    // Un signal sans écouteur termine le processus : un écouteur le remplace, donc il faut sortir ; s'il y en a un autre (le harnais des bancs), c'est lui qui sort.
    const nums = { SIGINT: 2, SIGTERM: 15, SIGHUP: 1, SIGBREAK: 21 };
    for (const [s, n] of Object.entries(nums)) {
        const moi = () => { if (process.listenerCount(s) <= 1) process.exit(128 + n); };
        try { process.on(s, moi); } catch (_) { /* signal inconnu de cette plateforme */ }
    }
}
/** Tue un mongod que CE processus a lancé (par son PID) et attend, borné à 3 s, qu'il disparaisse. */
function arreterMongodSync(pid) {
    if (!(pid > 1)) return false;
    const mort = () => { try { process.kill(pid, 0); return false; } catch (e) { return e.code === 'ESRCH'; } };
    if (mort()) return true;
    try { process.kill(pid); } catch (_) { /* déjà mort ou refusé : le contrôle ci-dessous tranche */ }
    for (let i = 0; i < 15 && !mort(); i++) dormirSync(200);
    return mort();
}
// 🔑 Ce que la PRODUCTION charge (hotesDe, cleDeGrappe, verifierHoteBanc, verifierEcritureR2, garderClientR2, bucketsDeProduction) vit dans
// garde-banc.js, sans dépendance : ce module-ci (façade, mongodb-memory-server) peut lever à l'import et la production ne le requiert jamais.
const { hotesDe, cleDeGrappe, verifierHoteBanc, bucketsDeProduction, verifierEcritureR2, garderClientR2 } = require('./garde-banc');

const estIp = h => /^\d{1,3}(\.\d{1,3}){3}$/.test(h) || /^\[.*\]$/.test(h);
const estLoopback = h => /^127(\.\d{1,3}){3}$/.test(h) || h === '[::1]' || h === 'localhost';

/**
 * Cette URI peut-elle servir de base de banc ? { ok, raison }. `env` porte MONGODB_URI et MONGODB_CARTES_URI (les deux grappes de production).
 * ⚠️ LIMITES CONNUES (écrites, pas codées) : (1) une IP en forme exotique (`0x7f.0.0.1`, entier unique, octal) ne ressemble pas à `estIp` ; `hotesDe` la prend
 * pour un NOM, qui ne sera pas dans la production → acceptée alors qu'elle pourrait désigner une adresse (hors loopback) ; l'URI de banc vient d'un
 * opérateur (MONGODB_TEST_URI), pas d'une entrée non fiable. (2) Un nom DNS de banc qui pointe vers un nœud de production passe : le DNS n'est pas résolu ici.
 * La vraie garantie contre les deux est l'utilisateur Atlas en lecture seule (décision du testeur en attente).
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
    let uri = r.uri, arreter = async () => { }, dossier = null, pidMongod = () => null;
    if (r.origine === 'memoire') {
        if (!process.env.MONGOMS_DOWNLOAD_DIR) process.env.MONGOMS_DOWNLOAD_DIR = CACHE_MONGOD;
        // un ensemble de réplicas à UN nœud, pas un mongod isolé : le webhook Stripe écrit en transaction (« Transaction numbers are only
        // allowed on a replica set member »), comme la production Atlas. Même binaire, quelques secondes de démarrage en plus.
        const { MongoMemoryReplSet } = require(cheminMemoire());
        // Le dossier de données est créé ICI (chemin noté à la création) et passé à mongod : mongodb-memory-server ne supprime jamais un `dbPath` qu'on lui donne.
        poserCrochets();
        dossier = creerDossierBanc();
        const ms = new MongoMemoryReplSet({ replSet: { count: 1 }, instanceOpts: [{ dbPath: dossier, args: ARGS_MONGOD_BANC }] });
        const pid = () => ms.servers?.[0]?.instanceInfo?.instance?.mongodProcess?.pid ?? null;
        pidMongod = pid;
        let nettoye = false;
        // sortie SYNCHRONE (crochet `exit`, signaux) : mongod est tué par son PID puis le dossier part, ou reste avec sa raison
        const nettoyerSync = () => {
            if (nettoye) return; nettoye = true; ARRETS_EN_COURS.delete(nettoyerSync);
            const p = pid();
            retirerDossierBanc(dossier, { mongodArrete: p ? arreterMongodSync(p) : ms.state === 'stopped' });
        };
        ARRETS_EN_COURS.add(nettoyerSync);
        try {
            await ms.start(); await ms.waitUntilRunning();
        } catch (e) {
            // mongod n'a pas démarré (binaire absent, disque plein…) : mongodb-memory-server a déjà tenté de l'arrêter, sans effacer le dossier
            nettoye = true; ARRETS_EN_COURS.delete(nettoyerSync);
            let arrete = false; try { arrete = (await ms.stop({ doCleanup: false, force: false })) === true; } catch (_) { /* reste faux : le dossier reste et la ligne le dit */ }
            retirerDossierBanc(dossier, { mongodArrete: arrete });
            throw e;
        }
        uri = ms.getUri();
        arreter = async () => {
            if (nettoye) return;
            let arrete = false;
            try { arrete = (await ms.stop({ doCleanup: false, force: false })) === true; } catch (e) { console.error(`[base-banc] arrêt de mongod : ${e.message}`); }
            nettoye = true; ARRETS_EN_COURS.delete(nettoyerSync);
            retirerDossierBanc(dossier, { mongodArrete: arrete });
        };
    }
    // L'URI de production, gardée AVANT le remplacement, pour les seuls bancs qui LISENT la production (copie d'une tranche, journal des scans).
    // Elle ne passe jamais dans l'environnement : les enfants ne la voient pas. Toute écriture mongoose vers elle est refusée (garde ci-dessous).
    // Un utilisateur Atlas en LECTURE SEULE (MONGODB_LECTURE_URI / MONGODB_CARTES_LECTURE_URI), s'il existe, est préféré ; la façade s'applique de toute façon.
    const uriProduction = env.MONGODB_LECTURE_URI || env.MONGODB_URI, uriCartes = env.MONGODB_CARTES_LECTURE_URI || env.MONGODB_CARTES_URI;
    return {
        origine: r.origine, uri, arreter, uriProduction, uriCartes, dossier, pidMongod,
        appliquer() {
            // R2 : la liste des buckets de PRODUCTION est figée AVANT tout remplacement ; R2_BUCKET_BANC ne peut pas en faire partie
            const buckets = bucketsDeProduction(env);
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

// ── LA FAÇADE DE LECTURE : déplacée dans facade-lecture.js (sans dépendance : la production la charge aussi) ; ré-exportée ci-dessous.
const { facadeLecture, sortieSure, ecritDansPipeline } = require('./facade-lecture');


// toutes les opérations d'écriture du pilote natif qu'une collection mongoose expose (le reste — find, count… — est de la lecture) ;
// `aggregate` est traitée à part : permise en lecture, refusée avec $out/$merge. Les trois dernières lèvent de façon SYNCHRONE (elles ne rendent
// pas de promesse) ; toutes les autres REJETTENT la promesse, pour qu'un `.catch()` seul la capte.
const METHODES_ECRITURE = ['insertOne', 'insertMany', 'updateOne', 'updateMany', 'replaceOne', 'deleteOne', 'deleteMany', 'findOneAndUpdate',
    'findOneAndDelete', 'findOneAndReplace', 'bulkWrite', 'drop', 'createIndex', 'createIndexes', 'dropIndex', 'dropIndexes', 'rename', 'findAndModify',
    'watch', 'initializeOrderedBulkOp', 'initializeUnorderedBulkOp', 'mapReduce'];
const SYNCHRONES = new Set(['watch', 'initializeOrderedBulkOp', 'initializeUnorderedBulkOp']);

// ── R2 : verifierEcritureR2 et garderClientR2 vivent dans garde-banc.js (la production les charge) ; re-exportés ci-dessous.

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

module.exports = { retirerDossierBanc, creerDossierBanc, TENTATIVES_SUPPRESSION, ARGS_MONGOD_BANC, hotesDe, cleDeGrappe, jugerUri, verifierHoteBanc, resoudre, ouvrirBanc, memoireInstallee, variablesDeConnexion, installerGardeEcriture, METHODES_ECRITURE,
    facadeLecture, sortieSure, verifierEcritureR2, garderClientR2 };
