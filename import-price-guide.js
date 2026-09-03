// Script d'import du guide des prix Cardmarket dans MongoDB.
// Complète le catalogue produits déjà importé (jointure par idProduct).
//
// Usage (PowerShell, comme la dernière fois) :
//   $env:MONGODB_URI="ta_connection_string"
//   node import-price-guide.js price_guide_6.json
//
// ════════════════════════════════════════════════════════════════════════════
// 📌 À QUELLE CADENCE FAUT-IL RÉIMPORTER ? — LA MÉTHODE, PAS LA RÉPONSE
// ════════════════════════════════════════════════════════════════════════════
// ⚠️ AUCUN CHIFFRE ICI, ET C'EST DÉLIBÉRÉ. « Toutes les deux semaines » serait une
// habitude déguisée en mesure. Ce qui décide de la cadence est la VOLATILITÉ DES PRIX,
// et elle n'est pas mesurable aujourd'hui.
//
// POURQUOI ELLE NE L'EST PAS : `majAt` est écrasé à chaque import. Au 2026-09-02, les
// 78 225 lignes portent TOUTES la même date (2026-08-30, 21:01–21:03) — un seul import,
// donc AUCUNE SÉRIE À COMPARER. On sait que le guide a 3,5 jours ; on ne sait rien de la
// vitesse à laquelle il se périme.
//
// 🔑 LA MÉTHODE, quand la place ne pressera plus (le cluster était à 2,5 Mo de marge) :
//   1. garder DEUX imports successifs — le second dans une collection à part, pas en
//      écrasement, sinon on reproduit le problème qu'on veut mesurer ;
//   2. comparer `trend` PRODUIT PAR PRODUIT entre les deux ;
//   3. lire la distribution de l'écart relatif, et surtout sa QUEUE HAUTE — la médiane
//      dira « les prix ne bougent pas », ce qui est vrai et sans intérêt : ce qui coûte,
//      c'est la carte à 40 € qui en vaut 25 une semaine plus tard ;
//   4. la cadence se déduit du délai au bout duquel la queue haute dépasse ce que la
//      règle de la fourchette tolère — pas d'un calendrier.
// C'est UN IMPORT DE PLUS, pas un chantier.
//
// ⚠️ ET LA MÊME MESURE RÉPOND À UNE AUTRE QUESTION : si le guide bouge peu, la lecture
// live Cardmarket — un onglet ouvert chez l'utilisateur à chaque scan abouti, sur le seul
// mur qui ne s'achète pas — devient un raffinement coûteux plutôt qu'une nécessité.

require('dotenv').config();
const { connecterMongo } = require('./mongo-connexion');
const fs = require('fs');
const mongoose = require('mongoose');

const cheminFichier = process.argv[2];
if (!cheminFichier) {
    console.error("Usage : node import-price-guide.js chemin/vers/price_guide_6.json");
    process.exit(1);
}

const guidePrixSchema = new mongoose.Schema({
    idProduct: { type: Number, required: true, unique: true },
    avg: Number,
    low: Number,
    trend: Number,
    avg1: Number,
    avg7: Number,
    avg30: Number,
    avgHolo: Number,
    lowHolo: Number,
    trendHolo: Number,
    avg1Holo: Number,
    avg7Holo: Number,
    avg30Holo: Number,
    majAt: { type: Date, default: Date.now }
});

const GuidePrix = mongoose.model('GuidePrix', guidePrixSchema, 'guide_prix');

async function main() {
    if (!process.env.MONGODB_URI) {
        console.error("MONGODB_URI n'est pas défini.");
        process.exit(1);
    }

    console.log("Connexion à MongoDB...");
    // Base nommée explicitement, sinon refus (voir mongo-connexion.js) : ce script
    // ÉCRIT, et la base de production s'appelle `test`.
    await connecterMongo({ script: 'import-price-guide.js', ecrit: true, confirmationProduction: true });
    console.log("✅ Connecté.");

    console.log(`Lecture de ${cheminFichier}...`);
    const brut = fs.readFileSync(cheminFichier, 'utf-8');
    const data = JSON.parse(brut);
    const guides = data.priceGuides;
    console.log(`${guides.length} prix trouvés dans le fichier (créé le ${data.createdAt}).`);

    const TAILLE_LOT = 2000;
    let traites = 0;

    for (let i = 0; i < guides.length; i += TAILLE_LOT) {
        const lot = guides.slice(i, i + TAILLE_LOT);
        const operations = lot.map(g => ({
            updateOne: {
                filter: { idProduct: g.idProduct },
                update: {
                    $set: {
                        avg: g.avg, low: g.low, trend: g.trend,
                        avg1: g.avg1, avg7: g.avg7, avg30: g.avg30,
                        avgHolo: g['avg-holo'], lowHolo: g['low-holo'], trendHolo: g['trend-holo'],
                        avg1Holo: g['avg1-holo'], avg7Holo: g['avg7-holo'], avg30Holo: g['avg30-holo'],
                        majAt: new Date()
                    }
                },
                upsert: true
            }
        }));
        await GuidePrix.bulkWrite(operations, { ordered: false });
        traites += lot.length;
        console.log(`... ${traites}/${guides.length} importés`);
    }

    console.log("✅ Import terminé.");
    await mongoose.disconnect();
}

main().catch(err => {
    console.error("❌ Erreur import :", err);
    process.exit(1);
});
