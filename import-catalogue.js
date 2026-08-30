// Script d'import du catalogue produits Cardmarket dans MongoDB.
// À exécuter à la main quand tu as un nouveau fichier products_singles_*.json
// (ex: après un nouveau téléchargement depuis Cardmarket, pour rester à jour).
//
// Usage :
//   MONGODB_URI="ta_connection_string" node import-catalogue.js chemin/vers/products_singles_6.json
//
// (Remplace ta_connection_string par la même valeur que sur Render, ou laisse
// vide si tu as déjà un fichier .env avec MONGODB_URI dedans + `require('dotenv').config()`)

require('dotenv').config();
const { connecterMongo } = require('./mongo-connexion');
const fs = require('fs');
const mongoose = require('mongoose');

const cheminFichier = process.argv[2];
if (!cheminFichier) {
    console.error("Usage : node import-catalogue.js chemin/vers/products_singles_6.json");
    process.exit(1);
}

const catalogueProduitSchema = new mongoose.Schema({
    idProduct: { type: Number, required: true, unique: true },
    name: { type: String, required: true },
    idExpansion: { type: Number, required: true },
    idMetacard: { type: Number, required: true },
});
// ⚠️ DEUX INDEX RETIRÉS LE 2026-08-30, ET LA TRACE RESTE ICI POUR QU'ILS NE REVIENNENT PAS.
// Un index supprimé en base mais toujours déclaré ici serait recréé au prochain import :
// on croirait la place libérée, et elle reviendrait — probablement le jour où la base est
// au plus près de sa limite. La suppression en base se fait par `maintenance-index.js`,
// qui REFUSE de tourner tant que ces lignes existent.
//
//   catalogueProduitSchema.index({ name: 'text' });     -> name_text, 14 384 Ko
//     Interrogé par RIEN : zéro occurrence de `$text` dans tout le dépôt. Et il ne
//     pouvait pas servir : les deux recherches par nom du serveur sont des regex
//     INSENSIBLES À LA CASSE (`chercherPrixCatalogueLocal`, `trouverProduitsLocaux`), et
//     un index texte ne répond qu'à l'opérateur `$text`. Mesuré : `{name: /^Pikachu/i}`
//     fait un COLLSCAN de 70 975 documents en 70 ms, index présent ou non.
//     Le commentaire d'index.js:241 disait déjà « pas d'index sur name » — c'est ce
//     fichier-ci qui contredisait le serveur, depuis le début.
//
//   catalogueProduitSchema.index({ idMetacard: 1 });    -> idMetacard_1, 3 076 Ko
//     `idMetacard` n'est JAMAIS un critère de requête. Il est lu comme CHAMP de documents
//     ramenés par un autre critère, puis groupé en mémoire (index.js:739). Un index ne
//     sert pas à lire un champ, il sert à le chercher.
//
// L'index sur `idExpansion` reste : il est utilisé, et mesuré à ×1 (360 lus, 360 rendus).
catalogueProduitSchema.index({ idExpansion: 1 });

const CatalogueProduit = mongoose.model('CatalogueProduit', catalogueProduitSchema, 'catalogue_produits');

async function main() {
    if (!process.env.MONGODB_URI) {
        console.error("MONGODB_URI n'est pas défini (variable d'environnement ou fichier .env).");
        process.exit(1);
    }

    console.log("Connexion à MongoDB...");
    // Base nommée explicitement, sinon refus (voir mongo-connexion.js) : ce script
    // ÉCRIT, et la base de production s'appelle `test`.
    await connecterMongo({ script: 'import-catalogue.js', ecrit: true, confirmationProduction: true });
    console.log("✅ Connecté.");

    console.log(`Lecture de ${cheminFichier}...`);
    const brut = fs.readFileSync(cheminFichier, 'utf-8');
    const data = JSON.parse(brut);
    const produits = data.products;
    console.log(`${produits.length} produits trouvés dans le fichier (créé le ${data.createdAt}).`);

    const TAILLE_LOT = 2000;
    let traites = 0;

    for (let i = 0; i < produits.length; i += TAILLE_LOT) {
        const lot = produits.slice(i, i + TAILLE_LOT);
        const operations = lot.map(p => ({
            updateOne: {
                filter: { idProduct: p.idProduct },
                update: {
                    $set: {
                        name: p.name,
                        idExpansion: p.idExpansion,
                        idMetacard: p.idMetacard
                    }
                },
                upsert: true
            }
        }));
        await CatalogueProduit.bulkWrite(operations, { ordered: false });
        traites += lot.length;
        console.log(`... ${traites}/${produits.length} importés`);
    }

    console.log("✅ Import terminé.");
    await mongoose.disconnect();
}

main().catch(err => {
    console.error("❌ Erreur import :", err);
    process.exit(1);
});
