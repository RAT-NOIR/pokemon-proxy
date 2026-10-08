'use strict';
// Banc FACTICE lancé par test-fuite.js (son nom ne commence pas par "test-" : le lanceur ne le joue pas seul).
// Il reproduit les façons de finir d'un vrai banc ; le parent compte ensuite les collections de son préfixe.
const H = require('./_harnais');
const db = require('../db');
const M = require('../modeles');
const mode = process.argv[2];

(async () => {
    const prefixe = await H.ouvrirBac('fuite-enfant.js');
    console.log(`PREFIXE=${prefixe}`);
    await M.creerIndex();                                   // 25 collections avec index, comme test-modeles / test-limites
    await db.col('comptes').insertOne({ x: 1 });
    if (mode === 'normal') { await H.fermerBac(); return; }
    if (mode === 'exception') throw new Error('banc qui lève avant fermerBac');
    if (mode === 'exit') process.exit(1);                   // sortie directe, sans fermerBac
    if (mode === 'tardif') {                                // écritures lancées SANS attente, puis fermeture
        for (let i = 0; i < 20; i++) db.col(`tardive${i}`).insertOne({ i }).catch(() => {});
        db.col('limites').createIndex({ tardif: 1 }).catch(() => {});
        await H.fermerBac(); return;
    }
    throw new Error(`mode inconnu : ${mode}`);
})().catch(e => { console.error('❌', e.message); process.exit(1); });
