'use strict';
// COTES-VISUELS — MESURE (ruling 6) sur des données RÉELLES, sans toucher la production : la sauvegarde locale du lot-additif (Extended JSON) est restaurée dans la base EN MÉMOIRE
// d'un banc (jamais une grappe), puis un processus ENFANT neuf charge comme l'API le fait (même chemin : projections, façade de lecture restreinte, decider, version compacte) et mesure
// RSS / heapUsed avant, pendant (le PIC : ancienne et nouvelle versions coexistent au rechargement) et après.
//   node v2/test/mesure-chargeur/mesurer-memoire.js [--sauvegarde=<dossier>] [--tas=<Mo>] [--rechargements=2]
// Le catalogue (idProduct → idMetacard) vient de products_singles_6.json, l'export Cardmarket local (jamais une requête) : le dénominateur de `catalogue_produits`.
// Rien n'est écrit ailleurs que dans la base en mémoire ; aucune variable MONGODB_* n'est lue (le banc n'ouvre que son propre mongod, en loopback).
const fs = require('fs'); const path = require('path'); const { spawn } = require('child_process');
const arg = (n, d) => { const a = process.argv.find(x => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const SAUVEGARDE = arg('sauvegarde', 'C:\\Users\\Yung\\Desktop\\pokemon-proxy\\backup-2026-10-10-lot-075226');
const EXPORT = path.join(__dirname, '..', '..', '..', 'products_singles_6.json');

(async () => {
    const { ouvrirBanc } = require('../../../collecte-cartes/base-banc');
    const mongoose = require('mongoose');
    const { EJSON } = mongoose.mongo.BSON;
    process.env.MONGOMS_DOWNLOAD_DIR = process.env.MONGOMS_DOWNLOAD_DIR || 'C:\\Users\\Yung\\Desktop\\pokemon-proxy\\.banc-local\\cache-mongod';
    const banc = await ouvrirBanc({ env: { ...process.env, MONGODB_TEST_URI: '' } });
    let code = 1;
    try {
        const cartes = mongoose.connection;                                              // non utilisée : on ouvre des connexions NOMMÉES sur l'URI du banc
        const cx = await mongoose.createConnection(banc.uri, { dbName: 'cartes' }).asPromise();
        const api = await mongoose.createConnection(banc.uri, { dbName: 'api_banc' }).asPromise();
        const comptes = {};
        for (const nom of ['sets', 'cartes', 'cartes_produits']) {
            const t0 = Date.now();
            const brut = JSON.parse(fs.readFileSync(path.join(SAUVEGARDE, `${nom}.json`), 'utf8'));
            const docs = EJSON.deserialize(brut);
            for (let i = 0; i < docs.length; i += 1000) await cx.db.collection(nom).insertMany(docs.slice(i, i + 1000), { ordered: false });
            comptes[nom] = docs.length;
            console.log(`restauré ${nom} : ${docs.length} documents (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
        }
        const exp = JSON.parse(fs.readFileSync(EXPORT, 'utf8')).products;
        for (let i = 0; i < exp.length; i += 5000) await api.db.collection('catalogue_produits').insertMany(exp.slice(i, i + 5000).map(p => ({ idProduct: p.idProduct, idMetacard: p.idMetacard })), { ordered: false });
        console.log(`catalogue_produits (export Cardmarket local) : ${exp.length} produits`);
        console.log(`dénominateurs de la base restaurée : ${JSON.stringify(comptes)}`);
        const tas = arg('tas', null);
        const args = [...(tas ? [`--max-old-space-size=${tas}`] : []), '--expose-gc', path.join(__dirname, 'mesurer-enfant.js'), `--uri=${banc.uri}`, `--rechargements=${arg('rechargements', '2')}`];
        code = await new Promise(res => { const e = spawn(process.execPath, args, { stdio: 'inherit' }); e.on('close', c => res(c)); });
        await cx.close(); await api.close();
    } finally { await banc.arreter(); }
    process.exit(code);
})().catch(e => { console.error('❌', e); process.exit(1); });
