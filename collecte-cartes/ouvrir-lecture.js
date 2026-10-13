// Connexion à la base `cartes` en LECTURE SEULE (utilisateur Atlas de lecture : MONGODB_CARTES_LECTURE_URI). Une simulation lit par ici ; seule une écriture ouvre la connexion d'écriture.
// Rend la forme de `ouvrirConnexions` dont les simulations ont besoin : { cartes: { db }, fermer }. Rend null si la variable est absente (l'appelant retombe sur ouvrirConnexions).
async function ouvrirLecture() {
    const uri = process.env.MONGODB_CARTES_LECTURE_URI;
    if (!uri) return null;
    const { MongoClient } = require('mongodb');
    const client = new MongoClient(uri);
    await client.connect();
    const db = client.db('cartes');
    if (!(await db.listCollections({}, { nameOnly: true }).toArray()).length) { await client.close(); throw new Error('base cartes vide : grappe fausse ?'); }
    return { cartes: { db }, fermer: () => client.close() };
}
module.exports = { ouvrirLecture };
