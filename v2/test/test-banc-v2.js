'use strict';
// INT2 : un banc v2 n'ouvre JAMAIS la grappe de production. Il ouvre la base de banc (mémoire, ou MONGODB_TEST_URI hors production), sinon il REFUSE
// avant toute connexion. Écrit par ce qu'il AUTORISE : l'hôte du banc ; tout le reste refuse, exception comprise.
const H = require('./_harnais');
const db = require('../db');
const mongoose = require('mongoose');

const PROD = { MONGODB_URI: 'mongodb://c0-shard-00-00.abcde.mongodb.net/', MONGODB_CARTES_URI: 'mongodb://d0-shard-00-00.fghij.mongodb.net/' };
const fausseBase = (hote) => ({ databaseName: 'test_scratch', client: { options: { hosts: hote === null ? undefined : [{ host: hote, port: 27017 }] } }, collection: nom => ({ nom }) });
const refus = async (f) => { try { await f(); return null; } catch (e) { return e.message; } };
const avecEnv = (vars, f) => {
    const avant = {}; for (const k of Object.keys(vars)) { avant[k] = process.env[k]; if (vars[k] === undefined) delete process.env[k]; else process.env[k] = vars[k]; }
    try { return f(); } finally { for (const k of Object.keys(vars)) { if (avant[k] === undefined) delete process.env[k]; else process.env[k] = avant[k]; } }
};

(async () => {
    // 1. le harnais REFUSE de démarrer sans base de banc, avant toute connexion (aucune URI de production n'est contactée : le refus tombe dans resoudre())
    H.vrai('le harnais exporte ouvrirBancV2', typeof H.ouvrirBancV2 === 'function');
    const sansBase = await refus(() => H.ouvrirBancV2({ env: { ...PROD }, memoireDisponible: false }));
    H.vrai('ni mémoire ni MONGODB_TEST_URI : BANC REFUSÉ', /BANC REFUSÉ/.test(sansBase || ''));
    const surProd = await refus(() => H.ouvrirBancV2({ env: { ...PROD, MONGODB_TEST_URI: 'mongodb://c0-shard-00-01.abcde.mongodb.net/' }, memoireDisponible: false }));
    H.vrai('MONGODB_TEST_URI sur la grappe de production : BANC REFUSÉ (hôte = production)', /BANC REFUSÉ/.test(surProd || '') && /production/.test(surProd));
    const sansComparer = await refus(() => H.ouvrirBancV2({ env: { MONGODB_TEST_URI: 'mongodb://ailleurs.exemple.net/' }, memoireDisponible: false }));
    H.vrai('MONGODB_URI absente : je ne peux pas comparer, BANC REFUSÉ (le doute refuse)', /BANC REFUSÉ/.test(sansComparer || ''));

    // 1 bis. 🔴 LA CAUSE DE L'INCIDENT : le harnais charge .env, donc process.env portait l'URI de PRODUCTION pour tout code qui ouvrait Mongo hors ouvrirBancV2.
    // Écrit par ce qu'on AUTORISE : après le chargement du harnais, toute variable MONGODB_* et toute variable dont la VALEUR est une URI mongodb est retirée,
    // sauf l'URI d'un banc déjà isolé (loopback + BANC_HOTES). AUCUNE connexion ici : on lit la PRÉSENCE de la variable dans un enfant qui n'ouvre rien.
    const cp = require('child_process'), chemin = require('path'), sys = require('fs'), os = require('os');
    const envProduction = () => {
        const e = { ...process.env, MONGODB_URI: 'mongodb://c0-shard-00-00.abcde.mongodb.net/', MONGODB_CARTES_URI: 'mongodb://d0-shard-00-00.fghij.mongodb.net/',
            MONGODB_LECTURE_URI: 'mongodb://c0-shard-00-01.abcde.mongodb.net/', MA_BASE_A_MOI: 'mongodb+srv://x.klmno.mongodb.net/' };
        delete e.BANC_ISOLE; delete e.BANC_HOTES; delete e.MONGODB_TEST_URI; return e;
    };
    const sonde = cp.spawnSync(process.execPath, [chemin.join(__dirname, 'banc-sonde-env.js')], { encoding: 'utf8', env: envProduction(), timeout: 60000 });
    const vu = JSON.parse(/RES=(.+)/.exec(sonde.stdout || '')?.[1] || 'null');
    H.vrai('   la sonde (enfant sous le harnais) a répondu', vu);
    H.v('   sous le harnais : MONGODB_URI, MONGODB_CARTES_URI, MONGODB_LECTURE_URI absentes', vu && [vu.uri, vu.cartes, vu.lecture], ['undefined', 'undefined', 'undefined']);
    H.v('   aucune variable, quel que soit son nom, ne porte encore une URI mongodb', vu && vu.variablesUri, []);
    H.v('   BANC_ISOLE=1 posé dès le chargement du harnais', vu && vu.isole, '1');
    H.v('   mongoose.connect(process.env.MONGODB_URI) ne trouve rien : il refuse (sans connexion)', vu && vu.refus, true);
    // la fonction elle-même, sur des états fabriqués (aucun enfant, aucune connexion)
    let purgerEnv = () => { }; try { ({ purgerEnv } = require('./_env-banc')); } catch (e) { H.vrai('   ./_env-banc.js existe (purgerEnv)', false); }
    const e1 = { MONGODB_URI: 'mongodb://c0-shard-00-00.abcde.mongodb.net/', X: 'mongodb://127.0.0.1:5/', MONGODB_BASE: 'test_scratch', AUTRE: 'ok' };
    purgerEnv(e1);
    H.v('   purgerEnv (hors banc) : les URI et les MONGODB_* partent, le reste reste, BANC_ISOLE=1', [e1.MONGODB_URI, e1.X, e1.MONGODB_BASE, e1.AUTRE, e1.BANC_ISOLE], [undefined, undefined, undefined, 'ok', '1']);
    const e2 = { BANC_ISOLE: '1', BANC_HOTES: '127.0.0.1', MONGODB_URI: 'mongodb://127.0.0.1:5/?replicaSet=x', MONGODB_CARTES_URI: 'mongodb://127.0.0.1:5/?replicaSet=x', MONGODB_BASE: 'test_scratch' };
    purgerEnv(e2);
    H.v('   purgerEnv (enfant d\'un banc isolé, loopback) : l\'URI du banc reste', [e2.MONGODB_URI, e2.MONGODB_BASE, e2.BANC_ISOLE], ['mongodb://127.0.0.1:5/?replicaSet=x', 'test_scratch', '1']);
    const e3 = { BANC_ISOLE: '1', BANC_HOTES: '127.0.0.1', MONGODB_URI: 'mongodb://127.0.0.1:5/', MONGODB_CARTES_URI: 'mongodb://c0-shard-00-00.abcde.mongodb.net/' };
    purgerEnv(e3);
    H.v('   purgerEnv : une seule variable hors banc dans un env « isolé » retire TOUT (doute = refus)', [e3.MONGODB_URI, e3.MONGODB_CARTES_URI], [undefined, undefined]);
    // lancer-tout : l'environnement de ses enfants est purgé aussi (un banc lancé par le lanceur ne voit pas la production)
    const dLanceur = sys.mkdtempSync(chemin.join(__dirname, '.jetable-banc-v2-'));
    try {
        sys.copyFileSync(chemin.join(__dirname, 'lancer-tout.js'), chemin.join(dLanceur, 'lancer-tout.js'));
        sys.writeFileSync(chemin.join(dLanceur, 'test-env.js'), "const m = process.env.MONGODB_URI === undefined && !Object.values(process.env).some(v => /^mongodb(\\+srv)?:\\/\\//i.test(v)) && process.env.BANC_ISOLE === '1';\nconsole.log(m ? '1 réussis, 0 échoués' : '0 réussis, 1 échoués'); process.exitCode = m ? 0 : 1;\n");
        const rl = cp.spawnSync(process.execPath, [chemin.join(dLanceur, 'lancer-tout.js')], { encoding: 'utf8', env: envProduction(), timeout: 60000, cwd: dLanceur });
        H.v('   lancer-tout : ses enfants ne voient ni URI mongodb ni production (code 0)', rl.status, 0);
    } finally { sys.rmSync(dLanceur, { recursive: true, force: true }); }
    // le rejeu de migration, LANCÉ SEUL (hors banc), refuse AVANT de se connecter. L'URI donnée est un port fermé de loopback : si le script tentait quand même
    // la connexion, il ne toucherait aucune grappe, mais il attendrait sa sélection de serveur (≥ 15 s) et ne dirait jamais « banc ».
    const fichierCredits = chemin.join(os.tmpdir(), `credits-banc-v2-${Date.now()}.json`);
    sys.writeFileSync(fichierCredits, JSON.stringify([{ userId: 'u1', soldeGratuit: 1, soldeScans: 5, email: null }]));
    const envCli = { ...process.env, MONGODB_URI: 'mongodb://127.0.0.1:1/' }; delete envCli.BANC_ISOLE; delete envCli.BANC_HOTES;
    const t0cli = Date.now();
    const cli = cp.spawnSync(process.execPath, [chemin.join(__dirname, '..', 'migrations', 'rejouer-migration-credits.js'), '--base=test_scratch', `--depuis=${fichierCredits}`], { encoding: 'utf8', env: envCli, timeout: 12000 });
    sys.rmSync(fichierCredits, { force: true });
    H.v('rejeu de migration lancé seul : refus, code 1, avant toute connexion', [cli.status, /banc/i.test((cli.stderr || '') + (cli.stdout || '')), /Base :/.test(cli.stdout || ''), Date.now() - t0cli < 10000], [1, true, false, true]);

    // 2. v2/db.js : une collection préfixée n'est atteignable QUE sur l'hôte du banc (BANC_ISOLE=1)
    db.definirPrefixe('rm_tabc123_');
    const ENV_OK = { BANC_ISOLE: '1', BANC_HOTES: '127.0.0.1' };
    db.brancher(fausseBase('127.0.0.1'));
    H.vrai('hôte du banc, banc isolé : col() passe', avecEnv(ENV_OK, () => db.col('comptes').nom === 'rm_tabc123_comptes'));
    for (const [quoi, base, env] of [
        ['hôte de PRODUCTION (shard Atlas), banc isolé', fausseBase('c0-shard-00-00.abcde.mongodb.net'), ENV_OK],
        ['hôte du banc mais SANS BANC_ISOLE', fausseBase('127.0.0.1'), { BANC_ISOLE: undefined, BANC_HOTES: '127.0.0.1' }],
        ['BANC_ISOLE sans BANC_HOTES', fausseBase('127.0.0.1'), { BANC_ISOLE: '1', BANC_HOTES: undefined }],
        ['hôte inconnu (aucun client lisible)', fausseBase(null), ENV_OK]
    ]) {
        db.brancher(base);
        const m = await avecEnv(env, () => refus(async () => db.col('comptes')));
        H.vrai(`col() REFUSE : ${quoi}`, /banc/i.test(m || '') && /refus/i.test(m || ''));
        const v = await avecEnv(env, () => refus(() => db.viderPrefixe()));
        H.vrai(`viderPrefixe() REFUSE : ${quoi}`, /banc/i.test(v || '') && /refus/i.test(v || ''));
    }
    // 2 bis. SANS préfixe (les collections nues de la production) : sous BANC_ISOLE=1, col() refuse aussi tout hôte qui n'est pas celui du banc ;
    // hors BANC_ISOLE (la production elle-même) rien ne change.
    db.definirPrefixe('');
    db.brancher(fausseBase('c0-shard-00-00.abcde.mongodb.net'));
    const nu = await avecEnv(ENV_OK, () => refus(async () => db.col('comptes')));
    H.vrai('sans préfixe, banc isolé, hôte de PRODUCTION : col() REFUSE', /banc/i.test(nu || '') && /refus/i.test(nu || ''));
    db.brancher(fausseBase(null));
    const nu2 = await avecEnv(ENV_OK, () => refus(async () => db.col('comptes')));
    H.vrai('sans préfixe, banc isolé, hôte inconnu : col() REFUSE', /banc/i.test(nu2 || '') && /refus/i.test(nu2 || ''));
    db.brancher(fausseBase('127.0.0.1'));
    H.v('sans préfixe, banc isolé, hôte du banc : col() passe, nom NU', avecEnv(ENV_OK, () => db.col('comptes').nom), 'comptes');
    db.brancher(fausseBase('c0-shard-00-00.abcde.mongodb.net'));
    H.v('HORS BANC_ISOLE (production) : col() sans préfixe inchangé, nom nu, aucun contrôle d\'hôte', avecEnv({ BANC_ISOLE: undefined, BANC_HOTES: undefined }, () => db.col('comptes').nom), 'comptes');
    db.definirPrefixe('');

    // 2 bis. tout fichier de v2/test qui lance un serveur enfant (verrou/serveur.js, hérite de process.env) ou ouvre Mongo lui-même passe par la base de banc :
    //    sans quoi l'enfant lirait MONGODB_URI du .env — la production. Lecture du code (un banc qui démarre un serveur ne se rejoue pas ici).
    const fs = require('fs'), path = require('path');
    const touche = fs.readdirSync(__dirname).filter(f => /\.js$/.test(f) && f !== 'test-banc-v2.js' && f !== 'banc-sonde-env.js' && f !== '_harnais.js' && f !== 'lancer-tout.js')
        .filter(f => /verrou\/serveur|mongoose\.connect|connecterMongo/.test(fs.readFileSync(path.join(__dirname, f), 'utf8')));
    const sans = touche.filter(f => !/ouvrirBancV2\(|ouvrirBac\(/.test(fs.readFileSync(path.join(__dirname, f), 'utf8')));
    H.vrai(`dénominateur : ${touche.length} fichier(s) lancent un serveur ou ouvrent Mongo`, touche.length >= 2);
    H.v('   tous passent par ouvrirBancV2/ouvrirBac (liste des fautifs)', sans, []);

    // 3. sur la VRAIE base en mémoire : un banc v2 passe, il est sur l'hôte du banc, jamais sur la production
    const prefixe = await H.ouvrirBac('test-banc-v2.js');
    H.v('BANC_ISOLE=1 posé par le harnais', process.env.BANC_ISOLE, '1');
    H.vrai('la connexion mongoose est sur un hôte de loopback', /^127\.|^localhost|^\[::1\]/.test(mongoose.connection.host));
    H.vrai('MONGODB_URI vaut l\'URI du banc (loopback), plus celle de la production', /^mongodb:\/\/127\./.test(process.env.MONGODB_URI || ''));
    // un banc ENFANT d'un banc isolé tombe sur la MÊME base (sinon test-fuite compterait les collections d'une base que ses enfants n'ont jamais vue)
    const { spawnSync } = require('child_process');
    const enfant = spawnSync(process.execPath, [path.join(__dirname, 'banc-enfant.js')], { encoding: 'utf8', timeout: 60000 });
    H.v('   un enfant d\'un banc isolé hérite de la base du parent (même URI, origine « herite »)', [/URI=(.+)/.exec(enfant.stdout || '')?.[1], /ORIGINE=(.+)/.exec(enfant.stdout || '')?.[1]], [process.env.MONGODB_URI, 'herite']);
    await db.col('comptes').insertOne({ x: 1 });
    H.v('une écriture v2 passe sur la base en mémoire', await db.col('comptes').countDocuments({}), 1);
    H.vrai('   et la collection est préfixée', (await db.base().listCollections().toArray()).some(c => c.name === `${prefixe}comptes`));
    await H.fermerBac();
    H.bilan();
})().catch(e => { console.error('❌', e); process.exit(1); });
