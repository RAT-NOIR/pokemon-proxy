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

    // ── 6 bis. (correction finale) les bancs qui ouvraient ENCORE la production : lecteurs par la façade, ou refus de démarrer. Lecture du code seulement pour les
    // outils du verrou (on ne les exécute pas) ; les deux bancs hors verrou qui refusent sont exécutés (ils sortent AVANT toute connexion).
    const code = f => fs.readFileSync(path.join(__dirname, f), 'utf8').replace(/\/\/.*$/gm, '');
    const LECTEURS = ['test-table-vintage.js', 'verrou-cellules.js', path.join('verrou', 'constituer-photos.js')];
    const malLecteurs = LECTEURS.filter(f => { const s = code(f); return !(/ouvrirBanc\(/.test(s) && /\.appliquer\(\)/.test(s) && /connexionProduction\(/.test(s)) || /createConnection\(\s*process\.env\.MONGODB_URI/.test(s) || /mongoose\.connect\(/.test(s); });
    verifier(`${LECTEURS.length} lecteurs de la production : ouvrent la base de banc, lisent par connexionProduction (façade), n'ouvrent plus MONGODB_URI eux-mêmes`, malLecteurs, []);
    const REFUSEURS = ['banc-japonais.js', 'test-setcode-numero.js', path.join('verrou', 'sonde-image-jeu.js')];
    const malRefus = REFUSEURS.filter(f => { const s = code(f), x = s.indexOf('process.exit(1)'); return !(x >= 0 && /REFUS/.test(s) && x < s.indexOf("require('dotenv')") && x < s.indexOf('require(\'mongoose\')')); });
    verifier(`${REFUSEURS.length} bancs qui lisent la production sans pouvoir passer par la façade : REFUSENT de démarrer avant tout require (dotenv, mongoose, index)`, malRefus, []);
    const lances = ['banc-japonais.js', 'test-setcode-numero.js'].map(f => { const r = spawnSync(process.execPath, [path.join(__dirname, f)], { encoding: 'utf8', timeout: 20000 }); return [f, r.status, /REFUS/.test(r.stderr || '')]; });
    verifier('banc-japonais.js et test-setcode-numero.js lancés : sortie 1, message « REFUS », aucune connexion (ils sortent avant tout require)', lances, [['banc-japonais.js', 1, true], ['test-setcode-numero.js', 1, true]]);

    // ── 7. LA GARDE D'ÉCRITURE : toute écriture mongoose vers un hôte qui n'est pas celui du banc est refusée (lecture de la production permise)
    class FausseCollection { constructor(host) { this.conn = { host }; } }
    const ECRITURES = ['insertOne', 'insertMany', 'updateOne', 'updateMany', 'replaceOne', 'deleteOne', 'deleteMany', 'findOneAndUpdate', 'findOneAndDelete', 'findOneAndReplace', 'bulkWrite', 'drop', 'createIndex', 'createIndexes', 'dropIndex', 'dropIndexes', 'rename'];
    for (const m of [...ECRITURES, 'find', 'findOne', 'countDocuments']) FausseCollection.prototype[m] = function () { return 'passe'; };
    B.installerGardeEcriture(FausseCollection, iso);
    B.installerGardeEcriture(FausseCollection, iso);   // idempotent : pas de double enrobage
    const surBanc = new FausseCollection('127.0.0.1'), surProd = new FausseCollection('cluster0-shard-00-00.abcde.mongodb.net'), surInconnu = new FausseCollection(undefined);
    // 🔑 la garde REJETTE la promesse (un `.catch()` seul la capte) : un appelant `async` ne doit pas avoir à entourer l'appel d'un try synchrone
    const essaie = async (c, m, ...a) => {
        let r; try { r = c[m](...a); } catch (e) { return `levé-synchrone:${/ÉCRITURE REFUSÉE/.test(e.message)}`; }
        return await Promise.resolve(r).then(v => v, e => /ÉCRITURE REFUSÉE/.test(e.message) ? 'refusé' : `autre:${e.message}`);
    };
    const filtrer = async (liste, f) => { const r = await Promise.all(liste.map(f)); return liste.filter((_, i) => r[i]); };
    verifier(`${ECRITURES.length} méthodes d'écriture : sur le banc, elles passent`, await filtrer(ECRITURES, async m => (await essaie(surBanc, m)) !== 'passe'), []);
    verifier(`${ECRITURES.length} méthodes d'écriture : sur un hôte qui n'est pas le banc, TOUTES rejettent la promesse (jamais un lancer synchrone)`, await filtrer(ECRITURES, async m => (await essaie(surProd, m)) !== 'refusé'), []);
    verifier('écriture sur un hôte inconnu (connexion pas encore établie) : refusée (doute)', await essaie(surInconnu, 'insertOne'), 'refusé');
    verifier('un `.catch()` seul capte le refus (aucun try autour de l\'appel)', await new Promise(r => { surProd.insertOne().catch(e => r(/ÉCRITURE REFUSÉE/.test(e.message))); }), true);
    verifier('lecture (find, findOne, countDocuments) sur la production : permise', await Promise.all(['find', 'findOne', 'countDocuments'].map(m => essaie(surProd, m))), ['passe', 'passe', 'passe']);
    // aggregate : permis en lecture, refusé avec $out / $merge (même imbriqué) sur un hôte qui n'est pas le banc
    FausseCollection.prototype.aggregate = function () { return 'passe'; };
    B.installerGardeEcriture(FausseCollection, iso);
    verifier('aggregate en lecture : permis ; avec $out, $merge, ou $merge sous $facet : refusé', await Promise.all([[{ $match: {} }], [{ $out: 'x' }], [{ $merge: { into: 'x' } }], [{ $facet: { a: [{ $merge: { into: 'x' } }] } }]].map(p => essaie(surProd, 'aggregate', p))), ['passe', 'refusé', 'refusé', 'refusé']);
    verifier('méthodes natives supplémentaires (watch, bulk ordonné/non ordonné, mapReduce) : couvertes par la garde', B.METHODES_ECRITURE.filter(m => ['watch', 'initializeOrderedBulkOp', 'initializeUnorderedBulkOp', 'mapReduce'].includes(m)).length, 4);
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
    // ── 8. LA GARDE R2 : sous BANC_ISOLE=1, aucune écriture (put, delete, copy, multipart…) hors du bucket R2_BUCKET_BANC, lui-même distinct de
    //       tout bucket de production lu dans l'environnement ; la lecture reste permise. Faux client : on COMPTE les commandes qui partiraient.
    const S3 = require('@aws-sdk/client-s3');
    const r2mod = require('./collecte-cartes/r2');
    const fauxClient = () => { const c = { envoyees: [], async send(cmd) { c.envoyees.push(cmd.constructor.name); return {}; } }; return c; };
    const envR2 = (extra = {}) => ({ BANC_ISOLE: '1', R2_BUCKET_IMAGES: 'bucket-images-prod', R2_BUCKET_BRUT: 'bucket-brut-prod', ...extra });
    const ECRITURES_R2 = [['PutObjectCommand', () => new S3.PutObjectCommand({ Bucket: 'bucket-images-prod', Key: 'k', Body: 'x' })], ['DeleteObjectsCommand', () => new S3.DeleteObjectsCommand({ Bucket: 'bucket-images-prod', Delete: { Objects: [{ Key: 'k' }] } })],
        ['DeleteObjectCommand', () => new S3.DeleteObjectCommand({ Bucket: 'bucket-images-prod', Key: 'k' })], ['CopyObjectCommand', () => new S3.CopyObjectCommand({ Bucket: 'bucket-images-prod', Key: 'k', CopySource: 'a/b' })],
        ['CreateMultipartUploadCommand', () => new S3.CreateMultipartUploadCommand({ Bucket: 'bucket-images-prod', Key: 'k' })], ['PutBucketCorsCommand', () => new S3.PutBucketCorsCommand({ Bucket: 'bucket-images-prod', CORSConfiguration: { CORSRules: [] } })]];
    {
        const fc = fauxClient(); B.garderClientR2(fc, envR2());
        const sorties = await Promise.all(ECRITURES_R2.map(([, mk]) => fc.send(mk()).then(() => 'envoyée', e => /ÉCRITURE R2 REFUSÉE/.test(e.message) ? 'refusée' : `autre:${e.message}`)));
        verifier(`${ECRITURES_R2.length} commandes d'écriture R2 vers R2_BUCKET_IMAGES sous BANC_ISOLE=1 : toutes REFUSÉES (promesse rejetée) AVANT toute requête`, [sorties.every(s => s === 'refusée'), fc.envoyees.length], [true, 0]);
        const lect = fauxClient(); B.garderClientR2(lect, envR2());
        await Promise.all([new S3.GetObjectCommand({ Bucket: 'bucket-images-prod', Key: 'k' }), new S3.HeadObjectCommand({ Bucket: 'bucket-images-prod', Key: 'k' }), new S3.ListObjectsV2Command({ Bucket: 'bucket-images-prod' })].map(c => lect.send(c)));
        verifier('lectures R2 (Get, Head, ListObjectsV2) : permises', lect.envoyees, ['GetObjectCommand', 'HeadObjectCommand', 'ListObjectsV2Command']);
        const sans = fauxClient(); B.garderClientR2(sans, envR2());
        const r0 = await sans.send(new S3.PutObjectCommand({ Bucket: 'bucket-du-banc', Key: 'k', Body: 'x' })).then(() => 'envoyée', e => `refusée:${/R2_BUCKET_BANC absent/.test(e.message)}`);
        verifier('R2_BUCKET_BANC absent : écriture vers n\'importe quel bucket REFUSÉE (0 requête)', [r0, sans.envoyees.length], ['refusée:true', 0]);
        const bon = fauxClient(); B.garderClientR2(bon, envR2({ R2_BUCKET_BANC: 'bucket-du-banc' }));
        const ok1 = await bon.send(new S3.PutObjectCommand({ Bucket: 'bucket-du-banc', Key: 'k', Body: 'x' })).then(() => 'envoyée', e => `refusée:${e.message}`);
        const ko1 = await bon.send(new S3.PutObjectCommand({ Bucket: 'bucket-images-prod', Key: 'k', Body: 'x' })).then(() => 'envoyée', () => 'refusée');
        verifier('R2_BUCKET_BANC présent : écriture vers lui permise, vers R2_BUCKET_IMAGES toujours refusée', [ok1, ko1, bon.envoyees], ['envoyée', 'refusée', ['PutObjectCommand']]);
        for (const cible of ['bucket-images-prod', 'bucket-brut-prod']) {
            const egal = fauxClient(); B.garderClientR2(egal, envR2({ R2_BUCKET_BANC: cible }));
            const re = await egal.send(new S3.PutObjectCommand({ Bucket: cible, Key: 'k', Body: 'x' })).then(() => 'envoyée', e => `refusée:${/production/.test(e.message)}`);
            verifier(`R2_BUCKET_BANC égal à un bucket de production (${cible}) : REFUSÉ`, [re, egal.envoyees.length], ['refusée:true', 0]);
        }
        const inerte = fauxClient(); B.garderClientR2(inerte, { R2_BUCKET_IMAGES: 'x' });
        await inerte.send(new S3.PutObjectCommand({ Bucket: 'x', Key: 'k', Body: 'x' }));
        verifier('hors banc (BANC_ISOLE absent) la garde R2 est inerte', inerte.envoyees, ['PutObjectCommand']);
        // par le module r2 lui-même (deposerBinaire), quel que soit le chemin : le client posé est gardé, la lecture HEAD passe, le PUT n'est jamais envoyé
        const avantEnv = { BANC_ISOLE: process.env.BANC_ISOLE, R2_BUCKET_IMAGES: process.env.R2_BUCKET_IMAGES, R2_BUCKET_BANC: process.env.R2_BUCKET_BANC };
        process.env.BANC_ISOLE = '1'; process.env.R2_BUCKET_IMAGES = 'bucket-images-prod'; delete process.env.R2_BUCKET_BANC;
        const fm = fauxClient(); fm.send = async cmd => { fm.envoyees.push(cmd.constructor.name); if (cmd.constructor.name === 'HeadObjectCommand') { const e = new Error('nf'); e.name = 'NotFound'; throw e; } return {}; };
        r2mod._poserClient(fm);
        const viaModule = await r2mod.deposerBinaire('bucket-images-prod', 'vignettes/x.webp', Buffer.from('x'), 'image/webp').then(() => 'écrit', e => /ÉCRITURE R2 REFUSÉE/.test(e.message) ? 'refusé' : `autre:${e.message}`);
        verifier('r2.deposerBinaire vers R2_BUCKET_IMAGES sous BANC_ISOLE=1 : refusé, aucun PutObject envoyé (seul le Head de lecture est parti)', [viaModule, fm.envoyees.filter(c => c === 'PutObjectCommand').length], ['refusé', 0]);
        for (const [k, v] of Object.entries(avantEnv)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
        r2mod._poserClient(null);
        // appliquer() fige la liste des buckets de production AVANT tout remplacement et refuse un R2_BUCKET_BANC qui en fait partie
        const sansR2 = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^R2_BUCKET_/.test(k)));
        const envA = { ...sansR2, MONGODB_TEST_URI: BANC_URI, R2_BUCKET_IMAGES: 'img-prod', R2_BUCKET_BRUT: 'brut-prod', R2_BUCKET_BANC: 'banc-r2' };
        (await B.ouvrirBanc({ env: envA, memoireDisponible: false })).appliquer();
        verifier('appliquer : les buckets de production sont remplacés par R2_BUCKET_BANC pour les enfants, et la liste d\'origine figée dans BANC_R2_INTERDITS', [envA.R2_BUCKET_IMAGES, envA.R2_BUCKET_BRUT, envA.BANC_R2_INTERDITS.split(',').sort()], ['banc-r2', 'banc-r2', ['brut-prod', 'img-prod']]);
        let refus = null; try { (await B.ouvrirBanc({ env: { ...sansR2, MONGODB_TEST_URI: BANC_URI, R2_BUCKET_IMAGES: 'img-prod', R2_BUCKET_BANC: 'img-prod' }, memoireDisponible: false })).appliquer(); } catch (e) { refus = e.message; }
        verifier('appliquer REFUSE un R2_BUCKET_BANC égal à un bucket de production', /R2_BUCKET_BANC/.test(refus || ''), true);
    }

    // ── 9. LA FAÇADE DE LECTURE DE LA PRODUCTION : une liste FERMÉE de lectures ; tout le reste lève, sans qu'aucun appel d'écriture n'atteigne le Db
    {
        const appels = [];
        // 🔑 LE FAUX CURSEUR PORTE LES MÉTHODES DU VRAI : toutes celles de AggregationCursor et FindCursor du pilote (out, addStage, clone, explain, rewind,
        // withReadConcern…) et leurs accesseurs (client, server, session…), lus sur les prototypes réels. Un faux plus pauvre que le vrai ne peut pas
        // échouer là où le vrai écrit (89a5596 : la façade rendait le curseur natif, `.out()` et `.addStage()` y ajoutent un $out/$merge après coup).
        const { AggregationCursor, FindCursor } = require('mongodb');
        const nomsCurseur = new Set(), accesseurs = new Set();
        for (const K of [AggregationCursor, FindCursor]) for (let p = K.prototype; p && p !== Object.prototype; p = Object.getPrototypeOf(p)) {
            for (const [nom, d] of Object.entries(Object.getOwnPropertyDescriptors(p))) { if (nom === 'constructor') continue; if (typeof d.value === 'function') nomsCurseur.add(nom); else if (d.get) accesseurs.add(nom); }
        }
        const appelsCurseur = [];
        const fauxCursor = {};
        for (const nom of nomsCurseur) fauxCursor[nom] = function () { appelsCurseur.push(nom); return nom === 'toArray' ? Promise.resolve([]) : (nom === 'next' || nom === 'tryNext') ? null : this; };
        for (const g of accesseurs) Object.defineProperty(fauxCursor, g, { get() { appelsCurseur.push(`get:${g}`); return { ECRITURE_POSSIBLE: true }; } });
        fauxCursor[Symbol.asyncIterator] = async function* () { appelsCurseur.push('asyncIterator'); };
        fauxCursor.nimporteQuoi = function () { appelsCurseur.push('nimporteQuoi'); return this; };
        const fauxColl = new Proxy({}, { get: (_, m) => (...a) => { appels.push(`coll.${String(m)}`); return m === 'find' || m === 'aggregate' ? fauxCursor : { _id: 1 }; } });   // findOne/count/distinct rendent un document, plus un curseur
        const fauxDb = { databaseName: 'test', collection: () => fauxColl, command: async () => { appels.push('db.command'); }, listCollections: () => { appels.push('db.listCollections'); return fauxCursor; }, dropDatabase: async () => { appels.push('db.dropDatabase'); } };
        const F = B.facadeLecture(fauxDb, async () => { });
        const nonLevee = async f => { try { await f(); return false; } catch (e) { return /LECTURE SEULE/.test(e.message); } };
        const COLLECTION_ECRITURES = ['insertOne', 'insertMany', 'updateOne', 'updateMany', 'replaceOne', 'deleteOne', 'deleteMany', 'bulkWrite', 'findOneAndUpdate', 'findOneAndDelete', 'findOneAndReplace', 'drop', 'createIndex', 'createIndexes', 'rename', 'watch', 'initializeOrderedBulkOp', 'mapReduce', 'indexes', 'options', 'stats'];
        const echecsFacade = [];
        for (const m of COLLECTION_ECRITURES) if (!await nonLevee(() => F.collection('x')[m]({}))) echecsFacade.push(`collection.${m}`);
        for (const m of ['command', 'dropDatabase', 'createCollection', 'dropCollection', 'renameCollection', 'admin', 'watch', 'createIndex']) if (!await nonLevee(() => F[m]?.({}) ?? (() => { throw new Error('LECTURE SEULE'); })())) echecsFacade.push(`db.${m}`);
        for (const [nom, p] of [['$out', [{ $out: 'x' }]], ['$merge', [{ $merge: { into: 'x' } }]], ['$merge sous $facet', [{ $facet: { a: [{ $merge: { into: 'x' } }] } }]], ['$out sous $lookup', [{ $lookup: { from: 'y', pipeline: [{ $out: 'x' }], as: 'z' } }]], ['$unionWith + $merge', [{ $unionWith: { coll: 'y', pipeline: [{ $merge: { into: 'x' } }] } }]]]) {
            if (!await nonLevee(() => F.collection('x').aggregate(p))) echecsFacade.push(`aggregate ${nom}`);
        }
        verifier(`façade : ${COLLECTION_ECRITURES.length} méthodes de collection hors liste fermée, 8 de db, 5 formes d'aggregate écrivant : TOUTES lèvent « LECTURE SEULE »`, echecsFacade, []);
        verifier('façade : AUCUN appel d\'écriture n\'a atteint le Db (0 appel compté)', appels, []);
        await F.collection('x').find({}).toArray(); await F.collection('x').findOne({}); await F.collection('x').countDocuments({}); await F.collection('x').estimatedDocumentCount();
        await F.collection('x').distinct('a'); await F.collection('x').aggregate([{ $match: {} }, { $sort: { a: 1 } }]); F.listCollections({});
        verifier('façade : les lectures de la liste fermée (find, findOne, countDocuments, estimatedDocumentCount, distinct, aggregate sans $out/$merge, listCollections) passent', appels, ['coll.find', 'coll.findOne', 'coll.countDocuments', 'coll.estimatedDocumentCount', 'coll.distinct', 'coll.aggregate', 'db.listCollections']);
        verifier('façade : databaseName lisible, db renvoie la façade elle-même (jamais le Db brut)', [F.databaseName, F.db === F], ['test', true]);

        // ── LE CURSEUR : enveloppé, à liste fermée, jamais le curseur natif (qui porte out(), addStage(), clone(), et l'accesseur client)
        const AUTORISES = new Set(['toArray', 'next', 'tryNext', 'hasNext', 'forEach', 'close', 'batchSize', 'maxTimeMS', 'limit', 'skip', 'sort', 'project', 'match', 'group', 'unwind', 'map']);
        verifier(`le faux curseur porte les méthodes du VRAI (${nomsCurseur.size} méthodes, ${accesseurs.size} accesseurs lus sur AggregationCursor et FindCursor), dont out, addStage, clone, explain et l'accesseur client`,
            [['out', 'addStage', 'clone', 'explain', 'rewind'].every(m => nomsCurseur.has(m)), accesseurs.has('client')], [true, true]);
        appels.length = 0; appelsCurseur.length = 0;
        const ouvertures = { 'aggregate([])': () => F.collection('x').aggregate([{ $match: {} }]), 'find({})': () => F.collection('x').find({}), 'listCollections()': () => F.listCollections({}) };
        const curseurLeves = [];
        for (const [origine, ouvrir] of Object.entries(ouvertures)) {
            for (const nom of [...nomsCurseur, ...accesseurs, 'nimporteQuoi']) {
                if (AUTORISES.has(nom)) continue;
                if (!await nonLevee(() => ouvrir()[nom]?.({ $merge: { into: 'x' } }))) curseurLeves.push(`${origine}.${nom}`);
            }
        }
        verifier(`curseur : tout ce qui n'est pas dans la liste fermée (${[...nomsCurseur, ...accesseurs].filter(m => !AUTORISES.has(m)).length + 1} noms dont out, addStage, clone, client, server, session, explain, nimporteQuoi) LÈVE « LECTURE SEULE » sur les curseurs de aggregate, find et listCollections`, curseurLeves, []);
        verifier('curseur : AUCUN appel n\'a atteint le curseur natif, aucun accesseur lu (0 appel compté)', appelsCurseur, []);
        // les chaînes : un constructeur de la liste fermée rend à son tour le curseur ENVELOPPÉ, jamais le natif
        const chaines = [['aggregate().out()', () => F.collection('x').aggregate([]).out('y')], ['aggregate().addStage($merge)', () => F.collection('x').aggregate([]).addStage({ $merge: { into: 'x' } })],
            ['aggregate().sort().limit().addStage($out)', () => F.collection('x').aggregate([]).sort({ a: 1 }).limit(5).addStage({ $out: 'y' })], ['find().sort().client', () => F.collection('x').find({}).sort({ a: 1 }).client],
            ['find().limit().skip().project().clone()', () => F.collection('x').find({}).limit(2).skip(1).project({ a: 1 }).clone()], ['find().map().out()', () => F.collection('x').find({}).map(d => d).out('y')],
            ['aggregate().match({$out})', () => F.collection('x').aggregate([]).match({ $out: 'y' })], ['aggregate().group({$merge})', () => F.collection('x').aggregate([]).group({ $merge: { into: 'y' } })],
            ['aggregate().unwind().lookup()', () => F.collection('x').aggregate([]).unwind('$a').lookup({ from: 'y' })],
            // les trois chaînes nommées par la relecture du tour 4 : batchSize/maxTimeMS rendent `this` dans le pilote, stream() porte `_cursor`
            ['aggregate().batchSize(1).out()', () => F.collection('x').aggregate([]).batchSize(1).out('y')], ['aggregate().maxTimeMS(1).addStage($merge)', () => F.collection('x').aggregate([]).maxTimeMS(1).addStage({ $merge: 'y' })],
            ['aggregate().stream()._cursor', () => F.collection('x').aggregate([]).stream()._cursor]];
        verifier('curseur : les chaînes (constructeurs autorisés puis out, addStage, client, clone, lookup ; batchSize/maxTimeMS puis out/addStage ; stream()._cursor) lèvent toutes « LECTURE SEULE »', (await Promise.all(chaines.map(async ([nom, f]) => (await nonLevee(f)) ? null : nom))).filter(Boolean), []);
        verifier('curseur : après toutes ces chaînes, 0 appel d\'écriture (out, addStage, clone, stream…) n\'a atteint le curseur natif', appelsCurseur.filter(a => !AUTORISES.has(a)), []);
        appelsCurseur.length = 0;
        const c1 = F.collection('x').aggregate([{ $match: {} }]);
        const lus = [await c1.sort({ a: 1 }).limit(3).skip(1).project({ a: 1 }).match({ b: 1 }).group({ _id: '$a' }).unwind('$a').toArray(), await c1.next(), await c1.tryNext(), await c1.hasNext(), await c1.forEach(() => { }), await c1.close()];
        for await (const _ of F.collection('x').find({})) { /* itère */ }
        const lectureOk = appelsCurseur.every(a => AUTORISES.has(a));
        verifier('curseur : les lectures de la liste fermée (toArray, next, tryNext, hasNext, forEach, close, constructeurs, for await) passent jusqu\'au curseur natif, et rien d\'autre ; le for await passe par next() de l\'ENVELOPPE, jamais par l\'itérateur natif', [lectureOk, appelsCurseur.includes('toArray'), !appelsCurseur.includes('asyncIterator') && appelsCurseur.includes('next'), lus.length], [true, true, true, 6]);

        // ── 🔑 TOUR 4 : LA GARDE JUGE CE QUI SORT, PAS LES NOMS. Aucune des vérifications ci-dessous ne lit la liste des méthodes autorisées : elle
        // SONDE chaque nom du vrai prototype, observe si l'enveloppe répond ou lève, et juge la VALEUR rendue. Si l'on ajoutait demain à la liste
        // autorisée une méthode qui rend le natif (batchSize l'était, stream aussi), ces sondes échoueraient sans qu'on les ait retouchées.
        const { Readable } = require('stream'); const { EventEmitter } = require('events');
        const mongodbReel = require('mongodb');
        class NatifMarque { constructor() { this._cursor = { out() { } }; this.client = {}; } }   // un faux flux (avec `_cursor`) / faux client natif
        const fauxQui = rendre => {
            const f = {};
            for (const nom of nomsCurseur) f[nom] = function () { return rendre(this, nom); };
            for (const g of accesseurs) Object.defineProperty(f, g, { get() { return rendre(this, g); } });
            f.nimporteQuoi = function () { return rendre(this, 'nimporteQuoi'); };
            f[Symbol.asyncIterator] = function () { return rendre(this, 'asyncIterator'); };
            return f;
        };
        const enveloppeDe = fauxC => B.facadeLecture({ databaseName: 'test', collection: () => ({ find: () => fauxC, aggregate: () => fauxC }), listCollections: () => fauxC }, async () => { }).collection('x').find({});
        const exploration = async fauxC => {
            const env = enveloppeDe(fauxC), bilan = { autorisees: [], sortis: [], inattendus: [] };
            const sur = r => r === env || r == null || (typeof r !== 'object' && typeof r !== 'function') || (Array.isArray(r) && r.length === 0);
            for (const nom of [...nomsCurseur, ...accesseurs, 'nimporteQuoi']) {
                let r, leve = null;
                try { r = await Promise.race([Promise.resolve(env[nom]?.(() => { }, {})), new Promise((_, no) => setTimeout(() => no(new Error('délai : thenable natif attendu pour rien')), 100))]); } catch (e) { leve = e; }
                if (leve) { if (!/LECTURE SEULE/.test(leve.message)) bilan.inattendus.push(`${nom} : ${leve.message}`); continue; }
                bilan.autorisees.push(nom);
                if (!sur(r)) bilan.sortis.push(nom);
            }
            return bilan;
        };
        const rendantThis = await exploration(fauxQui(f => f));
        verifier(`sortie : un curseur dont CHAQUE méthode du vrai prototype (${nomsCurseur.size}) rend this : toute méthode que l'enveloppe laisse répondre rend l'ENVELOPPE (0 objet natif sorti, 0 erreur autre que « LECTURE SEULE »)`,
            [rendantThis.sortis, rendantThis.inattendus, rendantThis.autorisees.length >= 10], [[], [], true]);
        const natifs = { 'objet natif marqué (faux flux/client)': () => new NatifMarque(), 'promesse d\'un objet natif': () => Promise.resolve(new NatifMarque()), 'flux Readable réel': () => Readable.from([]),
            'EventEmitter': () => new EventEmitter(), 'fonction': () => () => 1, 'MongoClient réel': () => new mongodbReel.MongoClient('mongodb://127.0.0.1:1'), 'thenable': () => ({ then() { } }), 'tableau d\'objets natifs': () => [new NatifMarque()],
            'document portant un objet natif': () => ({ a: { b: new NatifMarque() } }) };
        const natifsSortis = [];
        for (const [quoi, fabriquer] of Object.entries(natifs)) {
            const b = await exploration(fauxQui(() => fabriquer()));
            if (b.autorisees.length || b.inattendus.length) natifsSortis.push(`${quoi} : sortie par ${[...b.autorisees, ...b.inattendus].slice(0, 4).join(', ')}`);
        }
        verifier(`sortie : un curseur dont CHAQUE méthode rend un objet natif (${Object.keys(natifs).length} natures) : l'enveloppe LÈVE « LECTURE SEULE » pour chaque nom — aucune méthode ne le laisse sortir`, natifsSortis, []);
        // les callbacks et l'itérateur : seuls des DOCUMENTS en sortent
        const recus = [];
        const fauxCb = fauxQui(f => f); fauxCb.forEach = async function (fn) { fn(new NatifMarque()); }; fauxCb.map = function (fn) { fn(new NatifMarque()); return this; };
        const cbLeves = [];
        for (const m of ['forEach', 'map']) if (!await nonLevee(() => enveloppeDe(fauxCb)[m](d => recus.push(d)))) cbLeves.push(m);
        verifier('callback : forEach(fn) et map(fn) ne passent JAMAIS un objet natif à la fonction (elle n\'est pas appelée, l\'enveloppe lève)', [cbLeves, recus.length], [[], 0]);
        const fauxDocs = fauxQui(f => f); fauxDocs.forEach = async function (fn) { fn({ a: 1 }); fn({ a: 2 }); };
        const docsRecus = []; await enveloppeDe(fauxDocs).forEach(d => docsRecus.push(d));
        verifier('callback : un document (objet simple) arrive au callback', docsRecus, [{ a: 1 }, { a: 2 }]);
        let itNatif = 0; const reste = [{ a: 1 }, { a: 2 }];
        const fauxIt = fauxQui(f => f); fauxIt.next = async () => reste.shift() ?? null; fauxIt.close = async () => { }; fauxIt[Symbol.asyncIterator] = () => { itNatif++; return (async function* () { yield new NatifMarque(); })(); };
        const itLus = []; for await (const d of enveloppeDe(fauxIt)) itLus.push(d);
        verifier('itérateur : for await est écrit par l\'enveloppe (son propre next()), l\'itérateur natif n\'est jamais appelé', [itLus, itNatif], [[{ a: 1 }, { a: 2 }], 0]);
        const fauxItErreur = fauxQui(f => f); fauxItErreur.next = async () => { throw new Error('origine'); }; fauxItErreur.close = async () => { throw new Error('fermeture'); };
        let msgIt = null; try { for await (const _ of enveloppeDe(fauxItErreur)) { /* rien */ } } catch (e) { msgIt = e.message; }
        verifier('itérateur : si close() lève dans le finally, l\'erreur d\'ORIGINE reste celle qui sort', msgIt, 'origine');
        const dbNatif = await nonLevee(async () => B.facadeLecture({ databaseName: new NatifMarque(), collection: () => ({}), listCollections: () => ({}) }, async () => { }).databaseName);
        verifier('db.databaseName passe aussi par sortieSure (un nom natif lève)', dbNatif, true);
        const fauxItNatif = fauxQui(f => f); fauxItNatif.next = async () => new NatifMarque(); fauxItNatif.close = async () => { }; fauxItNatif[Symbol.asyncIterator] = () => ({ next: async () => ({ done: true, value: undefined }) });
        verifier('itérateur : un next() natif qui rend autre chose qu\'un document fait LEVER le for await', await nonLevee(async () => { for await (const _ of enveloppeDe(fauxItNatif)) { /* rien */ } }), true);
        // la fonction de jugement elle-même (documents acceptés, tout le reste refusé) et les méthodes de COLLECTION qui rendent une valeur
        if (typeof B.sortieSure !== 'function') verifier('sortieSure est exportée (une seule fonction juge ce qui sort)', typeof B.sortieSure, 'function');
        else {
            const { ObjectId, Decimal128, Binary, Long } = mongodbReel;
            const nu = Object.assign(Object.create(null), { a: 1 });
            const acceptes = [undefined, null, true, 3, 'x', { a: 1 }, nu, [], [{ a: 1 }, { b: [1, 2, { c: null }] }], { _id: new ObjectId(), d: new Date(), x: Decimal128.fromString('1.5'), b: new Binary(Buffer.from('ab')), l: Long.fromNumber(7) }, [new ObjectId(), new Date()]];
            const refuses = [Symbol('s'), () => 1, new NatifMarque(), Readable.from([]), new EventEmitter(), new Map(), new (class Autre { })(), { f() { } }, { a: [{ b: new EventEmitter() }] }, [() => 1], Buffer.from('x'), new mongodbReel.MongoClient('mongodb://127.0.0.1:1')];
            // tour 5 : le contrat INVERSE (une vraie instance de chaque type accepté passe toujours) et les formes qui ressemblent à un type accepté sans l'être
            const { Timestamp, Double, Int32, MinKey, MaxKey, Code, BSONRegExp, BSONSymbol, DBRef, UUID } = mongodbReel;
            const vraies = { ObjectId: new ObjectId(), Decimal128: Decimal128.fromString('1.5'), Binary: new Binary(Buffer.from('ab')), Long: Long.fromNumber(7), Timestamp: new Timestamp({ t: 1, i: 2 }), Double: new Double(1.5), Int32: new Int32(3),
                MinKey: new MinKey(), MaxKey: new MaxKey(), Code: new Code('x', { a: 1 }), BSONRegExp: new BSONRegExp('a', 'i'), BSONSymbol: new BSONSymbol('s'), DBRef: new DBRef('c', new ObjectId(), 'db', { z: 1 }), UUID: new UUID(), Date: new Date() };
            const sousClasse = new (class X extends ObjectId { })(); const sansConstructeur = Object.create(ObjectId.prototype); sansConstructeur.client = new NatifMarque();
            const idChargee = new ObjectId(); idChargee.client = new NatifMarque();
            const tabProp = [1, 2]; tabProp.client = new NatifMarque();
            const tabAccesseur = [1]; Object.defineProperty(tabAccesseur, 0, { get: () => new NatifMarque(), enumerable: true });
            const dateChargee = new Date(); dateChargee.client = new NatifMarque();
            const profond = {}; { let c = profond; for (let i = 0; i < 70; i++) c = c.x = {}; }
            const idTampon = Object.create(ObjectId.prototype); idTampon.buffer = Object.setPrototypeOf({ c: { find() { } } }, Uint8Array.prototype);   // tampon contrefait : un objet ordinaire au prototype changé (sonde du relecteur)
            const idSousU8 = Object.create(ObjectId.prototype); { class U8 extends Uint8Array { } const u = new U8(12); u.client = new NatifMarque(); idSousU8.buffer = u; }
            const menteur = new Proxy(new NatifMarque(), { getPrototypeOf: () => Object.prototype });
            const formesFausses = { 'ObjectId au tampon contrefait (prototype Uint8Array posé sur un objet ordinaire)': idTampon, 'ObjectId au tampon sous-classe d\'Uint8Array': idSousU8, 'sous-classe d\'ObjectId': sousClasse, 'Object.create(ObjectId.prototype) chargé': sansConstructeur, 'ObjectId portant une propriété propre': idChargee, 'tableau portant une propriété propre': tabProp,
                'tableau à accesseur d\'index': tabAccesseur, 'Date portant une propriété propre': dateChargee, 'Proxy dont getPrototypeOf ment': menteur, 'Proxy d\'un objet simple': new Proxy({ a: 1 }, {}), 'Proxy d\'un tableau': new Proxy([1], {}),
                'document contenant un Proxy': { a: new Proxy({}, {}) }, 'RegExp (refus voulu)': /a/, 'plus de 64 niveaux (refus voulu)': profond, 'DBRef dont fields porte un natif': new DBRef('c', new ObjectId(), 'db', { n: new NatifMarque() }) };
            const mal = [];
            for (const [nom, v] of Object.entries(vraies)) { try { if (await B.sortieSure(v) !== v) mal.push(`${nom} altéré`); } catch (e) { mal.push(`${nom} refusé à tort`); } }
            for (const [nom, v] of Object.entries(formesFausses)) if (!await nonLevee(async () => B.sortieSure(v))) mal.push(`laissé passer : ${nom}`);
            verifier(`sortieSure (tour 5) : une vraie instance de chacun des ${Object.keys(vraies).length} types acceptés passe ; ${Object.keys(formesFausses).length} formes qui y ressemblent (sous-classe, prototype menti, propriété propre, accesseur, Proxy…) LÈVENT`, mal, []);
            mal.length = 0;
            for (const v of acceptes) { try { if (await B.sortieSure(v) !== v) mal.push(`accepté mais altéré : ${typeof v}`); } catch (e) { mal.push(`refusé à tort : ${String(e.message).slice(0, 40)}`); } }
            for (const v of refuses) { if (!await nonLevee(async () => B.sortieSure(v))) mal.push(`laissé passer : ${typeof v === 'object' ? v?.constructor?.name : typeof v}`); }
            if (!await nonLevee(() => B.sortieSure(Promise.resolve(new NatifMarque())))) mal.push('promesse d\'un natif laissée passer');
            if ((await B.sortieSure(Promise.resolve({ a: 1 })))?.a !== 1) mal.push('promesse d\'un document refusée');
            verifier(`sortieSure : ${acceptes.length} valeurs/documents acceptés (ObjectId, Date, Decimal128, Binary, Long à l'intérieur compris), ${refuses.length + 1} sorties refusées (curseur/flux/client/fonction/EventEmitter/Map/instance de classe/Buffer/promesse d'un natif)`, mal, []);
        }
        const natifColl = new Proxy({}, { get: () => async () => new NatifMarque() });
        const Fn = B.facadeLecture({ databaseName: 'test', collection: () => natifColl, listCollections: () => fauxCursor }, async () => new NatifMarque());
        const collLevees = [];
        for (const m of ['findOne', 'countDocuments', 'estimatedDocumentCount', 'distinct']) if (!await nonLevee(() => Fn.collection('x')[m]({}))) collLevees.push(`collection.${m}`);
        verifier('collection : findOne, countDocuments, estimatedDocumentCount et distinct qui rendraient un objet natif LÈVENT « LECTURE SEULE » (la même fonction de sortie)', collLevees, []);
        verifier('db.close() : la valeur de fermeture du pilote (cx.close() rend la connexion mongoose, ici un objet natif) est JETÉE — close rend undefined', await Fn.close(), undefined);
        appelsCurseur.length = 0;

        // connexionProduction / connexionCartes rendent la FAÇADE (preuve de comportement, faux mongoose sans réseau) : le Db brut n'en sort jamais
        const dbBrut = { databaseName: 'test', collection: () => fauxColl, command: async () => { appels.push('db.command'); }, listCollections: () => fauxCursor };
        const fauxMongoose = { createConnection: () => ({ asPromise: async () => ({ db: dbBrut, close: async () => { } }) }) };
        const bf = await B.ouvrirBanc({ env: { ...process.env, MONGODB_TEST_URI: BANC_URI }, memoireDisponible: false });
        appels.length = 0;
        const lecturesOuvertes = [await bf.connexionProduction(fauxMongoose, 'test'), await bf.connexionCartes(fauxMongoose, 'cartes')];
        const sortieBrute = [];
        for (const h of lecturesOuvertes) {
            if (h === dbBrut || h.db === dbBrut) sortieBrute.push('Db brut');
            for (const m of ['command', 'insertOne', 'dropDatabase']) if (!await nonLevee(() => h[m]?.({}) ?? h.collection('x')[m]({}))) sortieBrute.push(`écriture ${m}`);
            if (!await nonLevee(() => h.collection('x').aggregate([]).out('y'))) sortieBrute.push('curseur.out');
        }
        verifier('connexionProduction et connexionCartes rendent une façade : ni Db brut, ni commande, ni écriture, ni curseur.out ne passent (faux mongoose, 0 appel d\'écriture)', [sortieBrute, appels.filter(a => a !== 'coll.aggregate')], [[], []]);
        // les URI de LECTURE dédiées (utilisateur Atlas en lecture seule) sont préférées quand elles existent
        const envL = { ...process.env, MONGODB_TEST_URI: BANC_URI, MONGODB_LECTURE_URI: 'mongodb://lecture.example/x', MONGODB_CARTES_LECTURE_URI: 'mongodb://lecture-cartes.example/x' };
        const bl = await B.ouvrirBanc({ env: envL, memoireDisponible: false });
        verifier('MONGODB_LECTURE_URI et MONGODB_CARTES_LECTURE_URI, quand elles existent, sont préférées pour la lecture ; puis REMPLACÉES dans l\'environnement des enfants', [bl.uriProduction === 'mongodb://lecture.example/x', bl.uriCartes === 'mongodb://lecture-cartes.example/x'], [true, true]);
        bl.appliquer();
        verifier('   ... après appliquer, plus aucune variable MONGODB_*URI ne vaut autre chose que le banc', Object.entries(envL).filter(([k, v]) => /^MONGODB_.*URI$/.test(k) && v !== BANC_URI).map(([k]) => k), []);
    }

    // ── 10. le banc vignette n'écrit plus sur R2 : faux stockage en mémoire, aucun identifiant R2 exigé, pas de bucket de production
    {
        const v = fs.readFileSync(path.join(__dirname, 'test-vignette-scratch.js'), 'utf8');
        verifier('test-vignette-scratch.js : substitue le module r2 par un FAUX STOCKAGE, n\'exige aucun identifiant R2 et ne lit pas R2_BUCKET_IMAGES', [/fauxStockage/.test(v), /Object\.assign\(r2, fauxStockage/.test(v), /R2_ACCESS_KEY_ID|R2_SECRET_ACCESS_KEY|process\.env\.R2_BUCKET_IMAGES/.test(v.replace(/\/\/.*$/gm, ''))], [true, true, false]);
    }
    console.log(`\n${echecs ? `⚠️ ${echecs}/${n} en échec` : `🎉 ${n}/${n} passés`} (aucune connexion, aucune écriture)`);
    process.exit(echecs ? 1 : 0);
})().catch(e => { console.error(e.message); process.exit(1); });
