// Connexion à la base `cartes` en LECTURE SEULE (utilisateur Atlas de lecture : MONGODB_CARTES_LECTURE_URI). Une simulation lit par ici ; seule une écriture ouvre la connexion d'écriture.
// Rend la forme de `ouvrirConnexions` dont les simulations ont besoin : { cartes: { db }, fermer }.
async function ouvrirLecture(env = process.env) {
    const uri = env.MONGODB_CARTES_LECTURE_URI;
    if (!uri) return null;
    const { MongoClient } = require('mongodb');
    const client = new MongoClient(uri);
    await client.connect();
    const db = client.db('cartes');
    if (!(await db.listCollections({}, { nameOnly: true }).toArray()).length) { await client.close(); throw new Error('base cartes vide : grappe fausse ?'); }
    return { cartes: { db }, fermer: () => client.close() };
}

/**
 * La connexion d'une SIMULATION. Garde écrite par ce qu'elle autorise : la lecture seule, ou l'option EXPLICITE `viaEcriture` (`--lecture-via-ecriture`), qui imprime son bandeau.
 * Sans la variable de lecture et sans l'option : REFUS nommé, AUCUNE connexion ouverte (jamais un repli silencieux sur la connexion d'écriture).
 */
async function ouvrirSimulation({ env = process.env, viaEcriture = false, ouvrirConnexions, journal = m => console.log(m) } = {}) {
    const lecture = await ouvrirLecture(env);
    if (lecture) return lecture;
    if (!viaEcriture) throw new Error('MONGODB_CARTES_LECTURE_URI absente : une simulation ne lit que par la connexion de lecture seule ; refus, aucune connexion ouverte (option explicite : --lecture-via-ecriture)');
    journal('⚠️ LECTURE VIA LA CONNEXION D\'ÉCRITURE');
    return ouvrirConnexions({ production: false, buckets: [] });
}
module.exports = { ouvrirLecture, ouvrirSimulation };
