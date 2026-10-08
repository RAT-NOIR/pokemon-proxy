'use strict';
// Enfant factice de test-banc-v2.js (son nom ne commence pas par "test-" : le lanceur ne le joue pas seul). Il dit sur quelle base de banc il tombe.
const H = require('./_harnais');
(async () => {
    const banc = await H.ouvrirBancV2();
    console.log(`ORIGINE=${banc.origine}`);
    console.log(`URI=${process.env.MONGODB_URI}`);
    await H.arreterBanc();
})().catch(e => { console.error('❌', e.message); process.exit(1); });
