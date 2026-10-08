// Banc de collecte-cartes/base-banc.js — AUCUNE connexion, AUCUNE écriture : il ne fait que JUGER des URI (les vraies variables de .env y servent
// de cas « production », leur valeur n'est jamais imprimée) et lire le code des bancs câblés.
//   node test-base-banc.js
// Décision du testeur (2026-10-08) : « aucun banc ne doit plus jamais écrire dans la grappe de production ». Une base de banc est
//   (a) mongodb-memory-server si le paquet est installé, (b) sinon MONGODB_TEST_URI — seulement si son hôte n'est PAS celui de MONGODB_URI
//   ni de MONGODB_CARTES_URI, (c) sinon REFUS. Jamais de repli silencieux sur test_scratch de la production.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const B = require('./collecte-cartes/base-banc');

let echecs = 0, n = 0;
const verifier = (nom, obtenu, attendu) => { n++; const ok = JSON.stringify(obtenu) === JSON.stringify(attendu); if (!ok) echecs++; console.log(`${ok ? '✅' : '❌'} ${nom} : ${JSON.stringify(obtenu)}${ok ? '' : ` (attendu ${JSON.stringify(attendu)})`}`); };

(async () => {
    const PROD = process.env.MONGODB_URI, CARTES = process.env.MONGODB_CARTES_URI;
    verifier('précondition : MONGODB_URI et MONGODB_CARTES_URI sont définies dans .env (valeurs jamais imprimées)', [!!PROD, !!CARTES], [true, true]);
    const reel = { MONGODB_URI: PROD, MONGODB_CARTES_URI: CARTES };
    const dit = j => `${j.ok ? 'accepté' : 'refusé'}${j.ok ? '' : /production/.test(j.raison) ? ' (hôte = production)' : ' (autre raison)'}`;

    // ── 1. LA PRODUCTION RÉELLE EST REFUSÉE (hôte comparé, jamais affiché)
    verifier('URI de MONGODB_URI (production, vraie) : hôte = production : refusé', dit(B.jugerUri(PROD, reel)), 'refusé (hôte = production)');
    verifier('URI de MONGODB_CARTES_URI (grappe cartes, vraie) : hôte = production : refusé', dit(B.jugerUri(CARTES, reel)), 'refusé (hôte = production)');
    // la même grappe, écrite autrement (srv contre hôte de shard), sur des valeurs fabriquées
    const fab = { MONGODB_URI: 'mongodb+srv://u:p@cluster0.abcde.mongodb.net/test', MONGODB_CARTES_URI: 'mongodb+srv://u:p@cluster1.fghij.mongodb.net/cartes' };
    verifier('même grappe écrite avec un hôte de shard : refusé', dit(B.jugerUri('mongodb://u:p@cluster0-shard-00-01.abcde.mongodb.net:27017/x?ssl=true', fab)), 'refusé (hôte = production)');
    verifier('même grappe, autre base, autre utilisateur : refusé', dit(B.jugerUri('mongodb+srv://autre:secret@cluster0.abcde.mongodb.net/test_scratch', fab)), 'refusé (hôte = production)');
    verifier('un jeu d\'hôtes dont UN SEUL est la production : refusé', dit(B.jugerUri('mongodb://127.0.0.1:27017,cluster1-shard-00-00.fghij.mongodb.net:27017/x', fab)), 'refusé (hôte = production)');
    verifier('hôte en majuscules : refusé', dit(B.jugerUri('mongodb+srv://u:p@CLUSTER0.ABCDE.MONGODB.NET/x', fab)), 'refusé (hôte = production)');
    verifier('une AUTRE grappe Atlas (autre identifiant) : acceptée', dit(B.jugerUri('mongodb+srv://u:p@cluster0.zzzzz.mongodb.net/x', fab)), 'accepté');

    // ── 2. UNE URI LOCALE FABRIQUÉE EST ACCEPTÉE (sans connexion)
    verifier('mongodb://127.0.0.1:1/x avec les vraies variables : accepté', dit(B.jugerUri('mongodb://127.0.0.1:1/x', reel)), 'accepté');

    // ── 3. LE DOUTE REFUSE
    for (const [nom, uri] of [['vide', ''], ['absente', undefined], ['pas une URI', 'pas une uri'], ['sans hôte', 'mongodb:///x'], ['autre schéma', 'http://127.0.0.1/x']]) {
        verifier(`doute (${nom}) : refusé`, B.jugerUri(uri, reel).ok, false);
    }
    verifier('doute : sans MONGODB_URI ni MONGODB_CARTES_URI, impossible de comparer : refusé', B.jugerUri('mongodb://127.0.0.1:1/x', {}).ok, false);
    verifier('doute : une seule des deux variables de production est définie : refusé', B.jugerUri('mongodb://127.0.0.1:1/x', { MONGODB_URI: PROD }).ok, false);

    // ── 4. LA RÉSOLUTION : mémoire, puis MONGODB_TEST_URI, puis REFUS
    const r0 = B.resoudre({ ...reel }, { memoireDisponible: false });
    verifier('ni paquet ni MONGODB_TEST_URI : REFUS « aucune base de test hors production »', [r0.ok, /aucune base de test hors production/.test(r0.raison || '')], [false, true]);
    const r1 = B.resoudre({ ...reel }, { memoireDisponible: true });
    verifier('paquet présent : mongodb-memory-server', [r1.ok, r1.origine], [true, 'memoire']);
    const r2 = B.resoudre({ ...reel, MONGODB_TEST_URI: 'mongodb://127.0.0.1:1/x' }, { memoireDisponible: false });
    verifier('MONGODB_TEST_URI locale : acceptée, origine nommée', [r2.ok, r2.origine], [true, 'MONGODB_TEST_URI']);
    const r3 = B.resoudre({ ...reel, MONGODB_TEST_URI: PROD }, { memoireDisponible: false });
    verifier('MONGODB_TEST_URI = la production : REFUS, pas de repli', [r3.ok, /production/.test(r3.raison || '')], [false, true]);
    const r4 = B.resoudre({ ...reel, MONGODB_TEST_URI: CARTES }, { memoireDisponible: true });
    verifier('MONGODB_TEST_URI = grappe cartes, même avec le paquet présent : REFUS (une variable mal posée ne se contourne pas en silence)', r4.ok, false);
    verifier('aucun refus ne laisse fuiter une valeur de variable', [r0, r3, r4].some(r => (r.raison || '').includes(PROD) || (r.raison || '').includes(CARTES)), false);

    // ── 5. LE CÂBLAGE : le processus du banc ne voit plus la production
    const BANC_URI = 'mongodb://127.0.0.1:1/x';
    const env = { ...process.env, MONGODB_TEST_URI: BANC_URI };
    const banc = await B.ouvrirBanc({ env, memoireDisponible: false });
    banc.appliquer();
    verifier('appliquer : MONGODB_URI ET MONGODB_CARTES_URI valent la base de banc (remplacées, pas supprimées), BANC_ISOLE=1', [env.MONGODB_URI === BANC_URI, env.MONGODB_CARTES_URI === BANC_URI, env.BANC_ISOLE], [true, true, '1']);
    // LE PROCESSUS ENFANT (import-*.js fait require('dotenv').config() : dotenv REMET une variable ABSENTE de l'environnement hérité) :
    // un vrai `node` charge dotenv sur le .env réel puis lit ses variables, SANS se connecter. Il ne doit voir que la base de banc.
    const os = require('os');
    const racine = JSON.stringify(__dirname.replace(/\\/g, '/'));
    const script = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'banc-enfant-')), 'enfant.js');
    fs.writeFileSync(script, `require(${racine} + '/node_modules/dotenv').config({ path: ${racine} + '/.env' });
const noms = Object.keys(process.env).filter(k => /^MONGODB_.*URI$/.test(k));
console.log(JSON.stringify({ isole: process.env.BANC_ISOLE, noms: noms.sort(), tousLeBanc: noms.every(k => process.env[k] === process.env.MONGODB_URI), banc: process.env.MONGODB_URI === ${JSON.stringify(BANC_URI)}, cartesPresente: !!process.env.MONGODB_CARTES_URI }));`);
    const { spawnSync } = require('child_process');
    const e = spawnSync(process.execPath, [script], { env, encoding: 'utf8' });
    let vu = null; try { vu = JSON.parse(e.stdout); } catch (_) { }
    verifier('enfant réel (dotenv chargé sur le vrai .env) : MONGODB_URI et MONGODB_CARTES_URI = base de banc, BANC_ISOLE=1, aucune autre variable MONGODB_*URI ne vaut autre chose',
        [e.status, vu?.isole, vu?.banc, vu?.cartesPresente, vu?.tousLeBanc, (vu?.noms || []).includes('MONGODB_CARTES_URI')], [0, '1', true, true, true, true]);
    fs.rmSync(path.dirname(script), { recursive: true, force: true });
    // contraste : sans remplacement (variable seulement supprimée), l'enfant recevrait celle du .env — la raison même du remplacement
    const sup = { ...process.env, MONGODB_URI: BANC_URI }; delete sup.MONGODB_CARTES_URI;
    const fantome = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'banc-enfant-')), 'enfant.js');
    fs.writeFileSync(fantome, `require(${racine} + '/node_modules/dotenv').config({ path: ${racine} + '/.env' });
console.log(JSON.stringify({ cartesEstLeBanc: process.env.MONGODB_CARTES_URI === ${JSON.stringify(BANC_URI)} }));`);
    const e2 = spawnSync(process.execPath, [fantome], { env: sup, encoding: 'utf8' });
    verifier('contraste : une variable seulement SUPPRIMÉE est remise par dotenv dans l\'enfant (c\'était le défaut)', JSON.parse(e2.stdout).cartesEstLeBanc, false);
    fs.rmSync(path.dirname(fantome), { recursive: true, force: true });

    // ── 5 bis. LE GARDE-FOU DE CONNEXION sous BANC_ISOLE : toute URI dont l'hôte n'est pas celui du banc est refusée
    const iso = { BANC_ISOLE: '1', BANC_HOTES: '127.0.0.1' };
    verifier('BANC_ISOLE : l\'hôte du banc passe', B.verifierHoteBanc('mongodb://127.0.0.1:1/x', iso).ok, true);
    verifier('BANC_ISOLE : la production réelle est refusée', B.verifierHoteBanc(PROD, iso).ok, false);
    verifier('BANC_ISOLE : la grappe cartes réelle est refusée', B.verifierHoteBanc(CARTES, iso).ok, false);
    verifier('BANC_ISOLE : une URI illisible est refusée', B.verifierHoteBanc('n\'importe quoi', iso).ok, false);
    verifier('BANC_ISOLE posé mais hôte du banc inconnu : refusé (doute)', B.verifierHoteBanc('mongodb://127.0.0.1:1/x', { BANC_ISOLE: '1' }).ok, false);
    verifier('hors banc (BANC_ISOLE absent) : le garde-fou ne dit rien', B.verifierHoteBanc(PROD, {}).ok, true);
    const mc = require('./mongo-connexion');
    const baseVide = { listCollections: () => ({ toArray: async () => [] }) };
    const baseNonVide = { listCollections: () => ({ toArray: async () => [{ name: 'a' }] }) };
    verifier('mongo-connexion hors banc : une base SANS collection est refusée (§50 inchangé)', (await mc.controlerApresConnexion({ db: baseVide, hote: 'cluster0.abcde.mongodb.net', env: {} })).ok, false);
    verifier('mongo-connexion hors banc : une base non vide passe', (await mc.controlerApresConnexion({ db: baseNonVide, hote: 'cluster0.abcde.mongodb.net', env: {} })).ok, true);
    verifier('mongo-connexion sous BANC_ISOLE : une base de banc NEUVE (vide) passe, son hôte étant celui du banc', (await mc.controlerApresConnexion({ db: baseVide, hote: '127.0.0.1', env: iso })).ok, true);
    verifier('mongo-connexion sous BANC_ISOLE : une base vide sur un AUTRE hôte est refusée', (await mc.controlerApresConnexion({ db: baseVide, hote: 'cluster0.abcde.mongodb.net', env: iso })).ok, false);
    verifier('mongo-connexion sous BANC_ISOLE : une base NON vide sur un autre hôte est refusée aussi', (await mc.controlerApresConnexion({ db: baseNonVide, hote: 'cluster0.abcde.mongodb.net', env: iso })).ok, false);

    // ── 5 ter. variantes de forme de l'URI de production, et adresses IP
    const V = (u) => dit(B.jugerUri(u, fab));
    for (const [nom, u] of [['options de requête', 'mongodb+srv://u:p@cluster0.abcde.mongodb.net/?retryWrites=true&w=majority'], ['mot de passe encodé', 'mongodb+srv://u:p%40ss%2F@cluster0.abcde.mongodb.net/test'],
        ['point final de nom de domaine', 'mongodb+srv://u:p@cluster0.abcde.mongodb.net./test'], ['schéma en casse mixte', 'MongoDB+SRV://u:p@cluster0.abcde.mongodb.net/test'],
        ['trois hôtes de shard avec ports', 'mongodb://u:p@cluster0-shard-00-00.abcde.mongodb.net:27017,cluster0-shard-00-01.abcde.mongodb.net:27017,cluster0-shard-00-02.abcde.mongodb.net:27017/x?replicaSet=atlas-1&ssl=true'],
        ['sans identifiants', 'mongodb+srv://cluster0.abcde.mongodb.net'], ['blancs autour', '  mongodb+srv://u:p@cluster0.abcde.mongodb.net/test  ']]) {
        verifier(`variante de la production (${nom}) : refusée`, V(u), 'refusé (hôte = production)');
    }
    for (const [nom, u] of [['IPv4 publique', 'mongodb://203.0.113.7:27017/x'], ['IPv4 privée', 'mongodb://10.0.0.5/x'], ['IPv6 hors loopback', 'mongodb://[2001:db8::1]:27017/x']]) {
        verifier(`adresse IP hors loopback (${nom}) : refusée (le DNS n'est pas résolu, doute = refus)`, B.jugerUri(u, fab).ok, false);
    }
    verifier('loopback IPv6 [::1] : accepté', B.jugerUri('mongodb://[::1]:27017/x', fab).ok, true);
    verifier('localhost : accepté', B.jugerUri('mongodb://localhost:27017/x', fab).ok, true);
    verifier('127.0.0.2 : accepté (loopback)', B.jugerUri('mongodb://127.0.0.2:27017/x', fab).ok, true);
    verifier('un nom d\'hôte (non IP) hors production : accepté', B.jugerUri('mongodb://banc.interne.example:27017/x', fab).ok, true);
    verifier('MONGODB_TEST_URI en IP publique : REFUS à la résolution', B.resoudre({ ...fab, MONGODB_TEST_URI: 'mongodb://203.0.113.7:27017/x' }, { memoireDisponible: false }).ok, false);
    let leve = null; try { await B.ouvrirBanc({ env: { ...reel }, memoireDisponible: false }); } catch (e) { leve = e; }
    verifier('ouvrirBanc LÈVE (refus) sans paquet ni MONGODB_TEST_URI — un banc ne démarre pas', [!!leve, /aucune base de test hors production/.test(leve?.message || '')], [true, true]);

    // ── 6. les bancs câblés passent par le module (lecture du code : les faire tourner demanderait une base de banc)
    const CABLES = ['test-import-catalogue-quotidien.js', 'test-import-guide-quotidien.js', 'test-import-price-guide.js', 'test-acces.js',
        'test-identification-locale.js', 'test-webhook-stripe.js', 'test-remboursement-catch.js', 'test-retour-live.js', 'test-journal-echecs.js',
        'capture-reponse.js', 'smoke-test.js', 'verrou-charges.js', 'verrou-avant-push.js', 'test-vignette-scratch.js', 'test-lot-garde-scratch.js',
        'test-deduction-ecritures-scratch.js', 'test-file-apprentissage.js'];
    const sans = CABLES.filter(f => { const s = fs.readFileSync(path.join(__dirname, f), 'utf8'); return !(/require\('\.\/collecte-cartes\/base-banc'\)/.test(s) && /ouvrirBanc\(/.test(s) && /\.appliquer\(\)/.test(s)); });
    verifier(`${CABLES.length} bancs câblés : requièrent base-banc, ouvrent, appliquent`, sans, []);
    // l'ORDRE : `appliquer()` AVANT toute connexion, tout lancement de sous-processus, et tout require de index.js (qui se connecte au chargement)
    const mal = CABLES.filter(f => {
        // le corps du banc commence à `async function main()` ou à la première `(async () => {` ; les marqueurs ne comptent qu'à partir de là
        // (les fonctions-aides définies plus haut ne sont pas des appels), et la PREMIÈRE ligne `appliquer()` doit les précéder tous
        const s = fs.readFileSync(path.join(__dirname, f), 'utf8'), a = s.indexOf('.appliquer()');
        const debuts = [s.indexOf('async function main()'), s.indexOf('(async () => {')].filter(i => i >= 0), d = debuts.length ? Math.min(...debuts) : 0;
        const premiers = ['connecterMongo({', 'mongoose.connect(', 'createConnection(', 'ouvrirConnexions(', 'demarrer(', 'spawn(process', 'spawnSync(process', 'lancer(', "require('./index')", "require('./identification-locale')"]
            .map(m => s.indexOf(m, d)).filter(i => i >= 0);
        return a < 0 || premiers.some(i => i < a);
    });
    verifier('bancs câblés : appliquer() précède toute connexion, tout lancement d\'enfant et tout require de index.js', mal, []);
    // le garde-fou de connexion est branché là où l'on se connecte
    const garde = ['mongo-connexion.js', path.join('collecte-cartes', 'garde.js')].filter(f => !/verifierHoteBanc\(/.test(fs.readFileSync(path.join(__dirname, f), 'utf8')));
    verifier('mongo-connexion.js et collecte-cartes/garde.js appellent verifierHoteBanc avant de se connecter', garde, []);
    // lot-additif --base=test_scratch ne sert qu'aux bancs : il REFUSE hors banc isolé
    verifier('lot-additif.js refuse --base=test_scratch sans BANC_ISOLE=1', /BANC_ISOLE/.test(fs.readFileSync(path.join(__dirname, 'lot-additif.js'), 'utf8')), true);

    // ── 7. LA GARDE D'ÉCRITURE : toute écriture mongoose vers un hôte qui n'est pas celui du banc est refusée (lecture de la production permise)
    class FausseCollection { constructor(host) { this.conn = { host }; } }
    const ECRITURES = ['insertOne', 'insertMany', 'updateOne', 'updateMany', 'replaceOne', 'deleteOne', 'deleteMany', 'findOneAndUpdate', 'findOneAndDelete', 'findOneAndReplace', 'bulkWrite', 'drop', 'createIndex', 'createIndexes', 'dropIndex', 'dropIndexes', 'rename'];
    for (const m of [...ECRITURES, 'find', 'findOne', 'countDocuments']) FausseCollection.prototype[m] = function () { return 'passe'; };
    B.installerGardeEcriture(FausseCollection, iso);
    B.installerGardeEcriture(FausseCollection, iso);   // idempotent : pas de double enrobage
    const surBanc = new FausseCollection('127.0.0.1'), surProd = new FausseCollection('cluster0-shard-00-00.abcde.mongodb.net'), surInconnu = new FausseCollection(undefined);
    const essaie = (c, m) => { try { return c[m](); } catch (e) { return /ÉCRITURE REFUSÉE/.test(e.message) ? 'refusé' : `autre:${e.message}`; } };
    verifier(`${ECRITURES.length} méthodes d'écriture : sur le banc, elles passent`, ECRITURES.filter(m => essaie(surBanc, m) !== 'passe'), []);
    verifier(`${ECRITURES.length} méthodes d'écriture : sur un hôte qui n'est pas le banc, TOUTES sont refusées`, ECRITURES.filter(m => essaie(surProd, m) !== 'refusé'), []);
    verifier('écriture sur un hôte inconnu (connexion pas encore établie) : refusée (doute)', essaie(surInconnu, 'insertOne'), 'refusé');
    verifier('lecture (find, findOne, countDocuments) sur la production : permise', ['find', 'findOne', 'countDocuments'].map(m => essaie(surProd, m)), ['passe', 'passe', 'passe']);
    const horsBanc = new FausseCollection('cluster0-shard-00-00.abcde.mongodb.net');
    class SansBanc { constructor(h) { this.conn = { host: h }; } insertOne() { return 'passe'; } }
    B.installerGardeEcriture(SansBanc, {});
    verifier('hors banc (BANC_ISOLE absent) la garde est inerte', new SansBanc('x').insertOne(), 'passe');
    const mongooseReel = require('mongoose');
    const envG = { ...process.env, MONGODB_TEST_URI: BANC_URI };
    const bancG = await B.ouvrirBanc({ env: envG, memoireDisponible: false });
    bancG.appliquer();
    verifier('appliquer installe la garde sur mongoose.Collection (les 17 méthodes d\'écriture marquées)', ECRITURES.filter(m => !mongooseReel.Collection.prototype[m]?.__gardeBanc), []);
    verifier('le handle garde l\'URI de production pour la LECTURE (égale à l\'originale, jamais imprimée), distincte de celle du banc', [bancG.uriProduction === PROD, bancG.uriProduction === envG.MONGODB_URI], [true, false]);
    for (const nomBase of ['test_scratch', 'cartes', 'autre', undefined]) {
        let r = null; try { await bancG.connexionProduction(mongooseReel, nomBase); } catch (e) { r = e.message; }
        verifier(`connexionProduction refuse la base « ${nomBase} » (seule « test » se lit), sans se connecter`, /seule la base « test »/.test(r || ''), true);
    }
    console.log(`\n${echecs ? `⚠️ ${echecs}/${n} en échec` : `🎉 ${n}/${n} passés`} (aucune connexion, aucune écriture)`);
    process.exit(echecs ? 1 : 0);
})().catch(e => { console.error(e.message); process.exit(1); });
