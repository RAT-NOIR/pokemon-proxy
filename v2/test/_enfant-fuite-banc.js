'use strict';
// ENFANT de test-fuite-banc.js : ouvre une base de banc en mémoire (collecte-cartes/base-banc.js, SANS le harnais : c'est la sortie du module seul qu'on éprouve)
// puis sort par le chemin demandé. Lancé avec TEMP/TMP pointés vers une racine PRIVÉE que le banc a créée.
//   node _enfant-fuite-banc.js <reussit|taille|leve|exit1|sigterm|sigint|sighup|tue|demarrage-impossible>
// Il imprime « PRET <dossier> <pid mongod> » dès que la base est prête (le parent s'en sert pour tuer l'enfant par son PID).
const path = require('path'), os = require('os'), fs = require('fs');
const action = process.argv[2];
const { ouvrirBanc } = require('../../collecte-cartes/base-banc');

function octets(d) { let t = 0; for (const n of fs.readdirSync(d)) { const p = path.join(d, n), s = fs.lstatSync(p); t += s.isDirectory() ? octets(p) : s.size; } return t; }

(async () => {
    if (action === 'demarrage-impossible') {
        // un mongod qui ne démarre pas : le binaire désigné n'existe pas (aucun téléchargement, aucune requête)
        process.env.MONGOMS_SYSTEM_BINARY = path.join(os.tmpdir(), 'mongod-absent.exe');
        try { await ouvrirBanc({ env: { ...process.env } }); console.log('ETRANGE : la base a démarré'); } catch (e) { console.log('ECHEC-DEMARRAGE'); }
        return;
    }
    const banc = await ouvrirBanc({ env: { ...process.env } });
    // (le repli « absent » sert à mesurer l'ANCIEN module, qui n'exposait ni dossier ni PID)
    console.log(`PRET ${banc.dossier || 'inconnu'} ${typeof banc.pidMongod === 'function' ? banc.pidMongod() : 'inconnu'}`);
    if (action === 'reussit') { await banc.arreter(); return; }
    if (action === 'taille') {
        const mongoose = require('mongoose');
        await mongoose.connect(banc.uri, { dbName: 'x' });
        for (let i = 0; i < 20; i++) await mongoose.connection.db.collection('c' + i).insertMany(Array.from({ length: 200 }, (_, k) => ({ k, t: 'x'.repeat(200) })));
        const session = await mongoose.connection.startSession();
        await session.withTransaction(async () => { await mongoose.connection.db.collection('c0').insertOne({ tx: 1 }, { session }); });   // les transactions restent permises
        await session.endSession();
        await mongoose.disconnect();
        await new Promise(r => setTimeout(r, 1500));
        const dossiers = fs.readdirSync(os.tmpdir()).filter(n => /^mongo-mem-/.test(n));   // TEMP est la racine privée de ce banc
        console.log(`TAILLE ${dossiers.length === 1 ? octets(path.join(os.tmpdir(), dossiers[0])) : -1}`);
        await banc.arreter();
        return;
    }
    if (action === 'leve') { setImmediate(() => { throw new Error('exception non rattrapée de test'); }); setInterval(() => { }, 1000); return; }
    if (action === 'exit1') { process.exit(1); }
    const signaux = { sigterm: 'SIGTERM', sigint: 'SIGINT', sighup: 'SIGHUP' };
    if (signaux[action]) { setInterval(() => { }, 1000); setTimeout(() => process.emit(signaux[action]), 100); return; }
    if (action === 'tue') { setInterval(() => { }, 1000); return; }
    console.log('action inconnue'); process.exit(2);
})().catch(e => { console.error('ENFANT', e.message); process.exit(3); });
