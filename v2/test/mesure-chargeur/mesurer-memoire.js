'use strict';
// COTES-VISUELS — MESURE (ruling 6) sur des données RÉELLES, sans toucher la production : la sauvegarde locale du lot-additif (Extended JSON) est restaurée dans la base EN MÉMOIRE
// d'un banc (jamais une grappe), puis des processus ENFANTS neufs chargent comme l'API le fait (le fil plafonné, ou le fichier précalculé) et mesurent RSS / heapUsed / maxRSS du processus entier.
//   node v2/test/mesure-chargeur/mesurer-memoire.js [--sauvegarde=<dossier>] [--rechargements=2] [--tas=<Mo>]
//   Trois enfants, dans l'ordre : construire (le script autonome → archive), fil (le chargeur), fichier (la voie précalculée).
// Le catalogue (idProduct → idMetacard) vient de products_singles_6.json, l'export Cardmarket local (jamais une requête). Rien n'est écrit ailleurs que dans la base en mémoire et dans le dossier temporaire.
const fs = require('fs'); const os = require('os'); const path = require('path'); const { spawn } = require('child_process');
const arg = (n, d) => { const a = process.argv.find(x => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const SAUVEGARDE = arg('sauvegarde', 'C:\\Users\\Yung\\Desktop\\pokemon-proxy\\backup-2026-10-10-lot-075226');
const EXPORT = path.join(__dirname, '..', '..', '..', 'products_singles_6.json');

(async () => {
    const { ouvrirBanc } = require('../../../collecte-cartes/base-banc');
    const mongoose = require('mongoose');
    const { EJSON } = mongoose.mongo.BSON;
    process.env.MONGOMS_DOWNLOAD_DIR = process.env.MONGOMS_DOWNLOAD_DIR || 'C:\\Users\\Yung\\Desktop\\pokemon-proxy\\.banc-local\\cache-mongod';
    const banc = await ouvrirBanc({ env: { ...process.env, MONGODB_TEST_URI: '' } });
    let code = 0;
    const archive = path.join(os.tmpdir(), `visuels-mesure-${process.pid}.rmv.gz`);
    try {
        const cx = await mongoose.createConnection(banc.uri, { dbName: 'cartes' }).asPromise();
        const api = await mongoose.createConnection(banc.uri, { dbName: 'api_banc' }).asPromise();
        const comptes = {};
        for (const nom of ['sets', 'cartes', 'cartes_produits']) {
            const docs = EJSON.deserialize(JSON.parse(fs.readFileSync(path.join(SAUVEGARDE, `${nom}.json`), 'utf8')));
            for (let i = 0; i < docs.length; i += 1000) await cx.db.collection(nom).insertMany(docs.slice(i, i + 1000), { ordered: false });
            comptes[nom] = docs.length;
        }
        const exp = JSON.parse(fs.readFileSync(EXPORT, 'utf8')).products;
        for (let i = 0; i < exp.length; i += 5000) await api.db.collection('catalogue_produits').insertMany(exp.slice(i, i + 5000).map(p => ({ idProduct: p.idProduct, idMetacard: p.idMetacard })), { ordered: false });
        console.log(`base restaurée : ${JSON.stringify(comptes)} ; catalogue_produits (export Cardmarket local) : ${exp.length}`);
        const preload = path.join(__dirname, 'mesure-preload.js'), enfant = path.join(__dirname, 'mesurer-enfant.js');
        const tas = arg('tas', null);
        const lancer = args => new Promise(res => { const e = spawn(process.execPath, ['-r', preload, ...(tas ? [`--max-old-space-size=${tas}`] : []), '--expose-gc', enfant, ...args], { stdio: 'inherit', env: { ...process.env, MESURE_URI: banc.uri,
            MONGODB_CARTES_LECTURE_URI: 'mesure', MONGODB_CARTES_URI: 'mesure-ecriture' } }); e.on('close', c => res(c)); });
        for (const args of [['--mode=construire', `--vers=${archive}`], ['--mode=fil', `--rechargements=${arg('rechargements', '2')}`], ['--mode=fichier', `--fichier=${archive}`, '--rechargements=2']]) {
            console.log(`--- enfant ${args[0]}`);
            const c = await lancer(args); if (c) code = c;
        }
        await cx.close(); await api.close();
    } finally { await banc.arreter(); try { fs.unlinkSync(archive); } catch { /* absente */ } }
    process.exit(code);
})().catch(e => { console.error('❌', e); process.exit(1); });
