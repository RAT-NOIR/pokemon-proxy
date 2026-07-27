// ============================================================
// CONNEXION MONGO — nommage EXPLICITE de la base, avec refus
// ============================================================
// ⚠️ LE PIÈGE DE CE PROJET : la base de PRODUCTION s'appelle littéralement `test`.
// C'est le nom que Mongoose choisit par défaut quand l'URI ne précise aucune base.
// Un seul underscore la sépare de `test_scratch`, le bac à sable. Conséquence : un
// script qui se connecte par `mongoose.connect(process.env.MONGODB_URI)` en croyant
// être dans un bac à sable écrit en réalité dans les données réelles — sans le moindre
// signal, et sans laisser de trace exploitable (ces collections n'ont pas de
// timestamps, donc rien ne permet de constater après coup qu'un document a bougé).
//
// D'où la règle appliquée à TOUS les scripts : la base est nommée explicitement, elle
// est AFFICHÉE au démarrage, et le script REFUSE de continuer si ce n'est pas celle
// attendue. Un affichage seul ne suffit pas : personne ne lit une ligne de log avant
// que le mal soit fait.

const mongoose = require('mongoose');

// Nom de la base de production. Sert uniquement à afficher un avertissement bien
// visible — le script s'y connecte volontiers, à condition qu'on l'ait demandé.
const BASE_PRODUCTION = 'test';
const BASE_BAC_A_SABLE = 'test_scratch';

/**
 * Résout la base demandée, sans jamais deviner.
 * Ordre de priorité : --base=<nom> en ligne de commande, puis MONGODB_BASE (.env).
 * @returns {string|null} null si aucune n'a été fournie
 */
function baseDemandee() {
    const arg = process.argv.find(a => a.startsWith('--base='));
    if (arg) return arg.slice('--base='.length).trim() || null;
    return (process.env.MONGODB_BASE || '').trim() || null;
}

/**
 * Se connecte à Mongo sur une base NOMMÉE, ou refuse.
 *
 * @param {object} options
 * @param {string} options.script   nom du script appelant, pour les messages d'aide
 * @param {boolean} options.ecrit   le script écrit-il ? (change la formulation des avertissements)
 * @returns {Promise<string>} le nom de la base réellement connectée
 *
 * Ne renvoie JAMAIS sur une base non demandée : en cas d'écart, le processus s'arrête
 * avec un code de sortie 1, connexion fermée, avant toute opération.
 */
async function connecterMongo({ script = 'ce script', ecrit = false } = {}) {
    if (!process.env.MONGODB_URI) {
        console.error("❌ MONGODB_URI absent du .env — impossible de continuer.");
        process.exit(1);
    }

    const attendue = baseDemandee();
    if (!attendue) {
        console.error("❌ ARRÊT : aucune base précisée, et je ne devine pas.");
        console.error(`   Usage : node ${script} --base=<nom> [autres options]`);
        console.error(`   ou     MONGODB_BASE=<nom> node ${script}`);
        console.error("");
        console.error(`   ⚠️ Rappel : la base de PRODUCTION de ce projet s'appelle "${BASE_PRODUCTION}".`);
        console.error(`      Le bac à sable est "${BASE_BAC_A_SABLE}". Un underscore les sépare.`);
        process.exit(1);
    }

    await mongoose.connect(process.env.MONGODB_URI, { dbName: attendue });
    const reelle = mongoose.connection.db.databaseName;

    // Vérification malgré dbName : une URI contenant déjà un chemin de base, une
    // version de driver différente ou une redirection côté serveur pourraient faire
    // diverger le réel du demandé. On ne fait confiance qu'à ce qu'on constate.
    if (reelle !== attendue) {
        console.error(`❌ ARRÊT : base connectée "${reelle}" alors que "${attendue}" était demandée.`);
        console.error("   Aucune opération n'a été effectuée.");
        await mongoose.disconnect();
        process.exit(1);
    }

    if (reelle === BASE_PRODUCTION) {
        console.log(`🗄️  Base : "${reelle}"  ⚠️  PRODUCTION${ecrit ? " — ce script ÉCRIT" : " (lecture seule)"}`);
    } else {
        console.log(`🗄️  Base : "${reelle}"${reelle === BASE_BAC_A_SABLE ? ' (bac à sable)' : ''}`);
    }
    return reelle;
}

module.exports = { connecterMongo, baseDemandee, BASE_PRODUCTION, BASE_BAC_A_SABLE };
