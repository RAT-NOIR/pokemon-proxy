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
    db.definirPrefixe('');

    // 2 bis. tout fichier de v2/test qui lance un serveur enfant (verrou/serveur.js, hérite de process.env) ou ouvre Mongo lui-même passe par la base de banc :
    //    sans quoi l'enfant lirait MONGODB_URI du .env — la production. Lecture du code (un banc qui démarre un serveur ne se rejoue pas ici).
    const fs = require('fs'), path = require('path');
    const touche = fs.readdirSync(__dirname).filter(f => /\.js$/.test(f) && f !== 'test-banc-v2.js' && f !== '_harnais.js' && f !== 'lancer-tout.js')
        .filter(f => /verrou\/serveur|mongoose\.connect|connecterMongo/.test(fs.readFileSync(path.join(__dirname, f), 'utf8')));
    const sans = touche.filter(f => !/ouvrirBancV2\(|ouvrirBac\(/.test(fs.readFileSync(path.join(__dirname, f), 'utf8')));
    H.vrai(`dénominateur : ${touche.length} fichier(s) lancent un serveur ou ouvrent Mongo`, touche.length >= 2);
    H.v('   tous passent par ouvrirBancV2/ouvrirBac (liste des fautifs)', sans, []);

    // 3. sur la VRAIE base en mémoire : un banc v2 passe, il est sur l'hôte du banc, jamais sur la production
    const prefixe = await H.ouvrirBac('test-banc-v2.js');
    H.v('BANC_ISOLE=1 posé par le harnais', process.env.BANC_ISOLE, '1');
    H.vrai('la connexion mongoose est sur un hôte de loopback', /^127\.|^localhost|^\[::1\]/.test(mongoose.connection.host));
    H.vrai('MONGODB_URI vaut l\'URI du banc (loopback), plus celle de la production', /^mongodb:\/\/127\./.test(process.env.MONGODB_URI || ''));
    await db.col('comptes').insertOne({ x: 1 });
    H.v('une écriture v2 passe sur la base en mémoire', await db.col('comptes').countDocuments({}), 1);
    H.vrai('   et la collection est préfixée', (await db.base().listCollections().toArray()).some(c => c.name === `${prefixe}comptes`));
    await H.fermerBac();
    H.bilan();
})().catch(e => { console.error('❌', e); process.exit(1); });
