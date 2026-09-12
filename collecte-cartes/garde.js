// ============================================================
// GARDE DU COLLECTEUR — quatre arrêts DURS avant toute écriture
// ============================================================
// La base cible est `cartes`, sur un cluster SÉPARÉ (projet Atlas rat-market-cartes). Notre cluster
// de production porte `test` et n'a que 61 Mo de marge : le collecteur ne doit JAMAIS pouvoir s'y
// connecter en écriture, même par une variable d'environnement mal copiée. Chaque arrêt est un
// `process.exit(1)`, jamais un `if` silencieux — personne ne lit une ligne de log avant que le mal
// soit fait (voir mongo-connexion.js pour l'occurrence qui a fondé cette règle).
//
// La production est OUVERTE EN LECTURE SEULE, sur une connexion distincte, pour la jointure avec
// `numeros_cartes` et `catalogue_produits`. Aucune fonction de ce module ni du collecteur n'écrit
// dessus : seules `find`, `countDocuments`, `distinct` y sont appelées.

const mongoose = require('mongoose');

const BASE_CIBLE = 'cartes';
const BASE_PRODUCTION = 'test';

function arret(message) {
    console.error(`❌ ARRÊT : ${message}`);
    process.exit(1);
}

/**
 * Vérifie les variables AVANT d'ouvrir quoi que ce soit. Deux des quatre arrêts sont ici.
 */
function verifierEnvironnement() {
    const uri = process.env.MONGODB_CARTES_URI;
    const base = process.env.MONGODB_CARTES_BASE;
    if (base !== BASE_CIBLE) arret(`MONGODB_CARTES_BASE doit valoir "${BASE_CIBLE}" (lu : ${JSON.stringify(base ?? null)}).`);
    if (!uri) arret('MONGODB_CARTES_URI absent du .env.');
    if (uri === process.env.MONGODB_URI) arret('MONGODB_CARTES_URI est ÉGAL à MONGODB_URI — c\'est le cluster de PRODUCTION. Refus.');
    if (!process.env.MONGODB_URI) arret('MONGODB_URI absent : la jointure lit la production en lecture seule, elle en a besoin.');
    for (const v of ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_BRUT']) {
        if (!process.env[v]) arret(`${v} absent du .env.`);
    }
}

/**
 * Ouvre les deux connexions : `cartes` (écriture) et production (lecture seule).
 * Les deux autres arrêts sont ici, APRÈS connexion, sur ce qu'on constate et non sur ce qu'on a demandé.
 * @returns {Promise<{cartes: mongoose.Connection, prod: mongoose.Connection, fermer: () => Promise<void>}>}
 */
async function ouvrirConnexions() {
    verifierEnvironnement();
    const cartes = await mongoose.createConnection(process.env.MONGODB_CARTES_URI, { dbName: BASE_CIBLE }).asPromise();
    const reelle = cartes.db.databaseName;
    if (reelle !== BASE_CIBLE) {
        await cartes.close();
        arret(`base connectée "${reelle}" alors que "${BASE_CIBLE}" était demandée.`);
    }
    // Empreinte de la production : si ce cluster porte `test` ou `test_scratch`, ce n'est pas le bon.
    let bases = [];
    try {
        bases = (await cartes.db.admin().listDatabases()).databases.map(d => d.name);
    } catch (e) {
        // Un utilisateur restreint à `cartes` n'a pas le droit de lister : c'est un BON signe, pas une
        // erreur — l'utilisateur `revolquentin38_db_user` du projet séparé peut être limité. On le dit.
        console.log(`ℹ️  listDatabases refusé (${e.codeName || e.message}) : utilisateur restreint à la base, empreinte non vérifiable par ce moyen.`);
    }
    if (bases.includes(BASE_PRODUCTION) || bases.includes('test_scratch')) {
        await cartes.close();
        arret(`le cluster connecté porte ${bases.filter(b => b === BASE_PRODUCTION || b === 'test_scratch').join(' et ')} : c'est la PRODUCTION.`);
    }
    const prod = await mongoose.createConnection(process.env.MONGODB_URI, { dbName: BASE_PRODUCTION }).asPromise();
    console.log(`🗄️  cible : "${reelle}" sur ${cartes.host} (écriture)  ·  production : "${prod.db.databaseName}" sur ${prod.host} (LECTURE SEULE)`);
    return {
        cartes, prod,
        fermer: async () => { await Promise.allSettled([cartes.close(), prod.close()]); }
    };
}

module.exports = { ouvrirConnexions, verifierEnvironnement, BASE_CIBLE, BASE_PRODUCTION };
