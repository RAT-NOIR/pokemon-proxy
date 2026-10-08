'use strict';
// Banc FACTICE lancé par test-fuite.js (son nom ne commence pas par "test-" : le lanceur ne le joue pas seul).
// Il reproduit les façons de finir d'un vrai banc ; le parent compte ensuite les collections de son préfixe ET lit son code de sortie.
const H = require('./_harnais');
const db = require('../db');
const M = require('../modeles');
const mode = process.argv[2];
const jamais = () => new Promise(() => {});

(async () => {
    const prefixe = await H.ouvrirBac('fuite-enfant.js');
    console.log(`PREFIXE=${prefixe}`);
    await M.creerIndex();                                   // 16 collections avec index, comme test-modeles / test-limites
    await db.col('comptes').insertOne({ x: 1 });
    if (mode === 'normal') { await H.fermerBac(); return; }
    if (mode === 'exception') throw new Error('banc qui lève avant fermerBac');   // rattrapée par le .catch ci-dessous (=> process.exit(1))
    if (mode === 'exit') process.exit(1);                   // sortie directe, sans fermerBac
    if (mode === 'exit-puis-zero') { process.exit(1); H.bilan(); process.exit(0); return; }   // le code continue après exit(1) puis exit(0) : 1 doit gagner
    if (mode === 'non-attrapee') { setTimeout(() => { throw new Error('exception hors de toute promesse'); }, 0); await jamais(); }   // uncaughtException
    if (mode === 'rejet') { Promise.reject(new Error('rejet non traité')); await jamais(); }                                           // unhandledRejection
    if (mode === 'sigint') { setTimeout(() => process.emit('SIGINT'), 0); await jamais(); }
    if (mode === 'sigterm') { setTimeout(() => process.emit('SIGTERM'), 0); await jamais(); }
    if (mode === 'mongo-muet') {                            // le nettoyage ne répond jamais : le délai maximal doit forcer la sortie, code non nul
        db.viderPrefixe = jamais; process.env.RM_DELAI_NETTOYAGE_MS = '1000';
        process.exit(1); await jamais();
    }
    if (mode === 'double-sigint') {                         // nettoyage muet + délai très long : le 2e SIGINT doit sortir tout de suite
        db.viderPrefixe = jamais; process.env.RM_DELAI_NETTOYAGE_MS = '600000';
        setTimeout(() => process.emit('SIGINT'), 0); setTimeout(() => process.emit('SIGINT'), 300); await jamais();
    }
    if (mode === 'tardif') {                                // écritures lancées SANS attente, puis fermeture
        for (let i = 0; i < 20; i++) db.col(`tardive${i}`).insertOne({ i }).catch(() => {});
        db.col('limites').createIndex({ tardif: 1 }).catch(() => {});
        await H.fermerBac(); return;
    }
    throw new Error(`mode inconnu : ${mode}`);
})().catch(e => { console.error('❌', e.message); process.exit(1); });
