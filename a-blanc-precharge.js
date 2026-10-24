// Préchargé par lancer-a-blanc.js (`node -r a-blanc-precharge.js <outil>`) : l'outil reste le module PRINCIPAL (require.main === module vaut pour lui),
// l'environnement est réduit aux URI de LECTURE SEULE et à la lecture de l'archive R2, et `ouvrirConnexions` ouvre ces connexions-là.
const path = require('path');
const mongoose = require('mongoose');
const gardePath = require.resolve(path.resolve(__dirname, 'collecte-cartes/garde.js'));
async function ouvrirConnexions(options = {}) {
    const cartes = await mongoose.createConnection(process.env.MONGODB_CARTES_LECTURE_URI, { dbName: 'cartes' }).asPromise();
    const prod = options.production === false ? null : await mongoose.createConnection(process.env.MONGODB_LECTURE_URI, { dbName: 'test' }).asPromise();
    console.log('🗄️  [à blanc] cartes + production ouvertes par les utilisateurs de LECTURE SEULE');
    return { cartes, prod, fermer: async () => { await Promise.allSettled([cartes.close(), prod ? prod.close() : Promise.resolve()]); } };
}
require.cache[gardePath] = { id: gardePath, filename: gardePath, loaded: true, children: [], paths: [], exports: { ouvrirConnexions, verifierEnvironnement() {}, BASE_CIBLE: 'cartes', BASE_PRODUCTION: 'test' } };
