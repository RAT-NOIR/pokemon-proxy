'use strict';
// USAGE : node v2/migrations/creer-index.js --base=test_scratch
//         node v2/migrations/creer-index.js --base=test --confirmer-production      (PRODUCTION : à ne lancer qu'au réveil du testeur)
const { connecterMongo } = require('../../mongo-connexion');
const mongoose = require('mongoose');
const { creerIndex, verifierIndex } = require('../modeles');
(async () => {
    const base = await connecterMongo({ script: 'v2/migrations/creer-index.js', ecrit: true, confirmationProduction: true });
    console.log(`création de ${await creerIndex()} index sur "${base}"`);
    const { manquants } = await verifierIndex();
    console.log(manquants.length ? `🔴 manquants : ${manquants.join(', ')}` : '✅ tous les index sont présents');
    await mongoose.disconnect();
    process.exit(manquants.length ? 1 : 0);
})();
