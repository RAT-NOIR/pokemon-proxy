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

// ════════════════════════════════════════════════════════════════════════════════════════════════
// 🔴 LE DÉFAUT DU 2026-09-21 : ON VÉRIFIAIT LE NOM DE LA BASE, JAMAIS LA GRAPPE
// ════════════════════════════════════════════════════════════════════════════════════════════════
// Ce module ouvrait TOUJOURS `MONGODB_URI` — la grappe de production — quelle que soit la base
// demandée, puis contrôlait que `databaseName` valait bien ce qu'on avait demandé. Ce contrôle
// passe toujours : **MongoDB crée une base à la demande**, donc `--base=cartes` ouvrait une base
// VIDE, du bon nom, sur la MAUVAISE grappe. `backup-collections.js` répondait alors « collection(s)
// introuvable(s) », c'est-à-dire qu'il accusait la collection d'un défaut de CONNEXION.
// ⚠️ **La base `cartes` — celle que toute la collecte écrit — n'a donc jamais pu être sauvegardée,
// et l'outil ne le disait pas.** Une sauvegarde qu'on croit avoir est pire que pas de sauvegarde :
// elle ne se découvre fausse qu'au moment de restaurer.
//
// 🔑 UNE VÉRIFICATION QUI PORTE SUR CE QUI EST FACILE À VÉRIFIER N'EST PAS UNE VÉRIFICATION. Le nom
// se lit sur la connexion ; la grappe demande de savoir OÙ la base est censée vivre. C'est cette
// table-là qui manquait, et sans elle le contrôle ne pouvait que se confirmer lui-même.
//
// LA TABLE EST DONC LA GARDE : une base qui n'y figure pas est REFUSÉE, jamais devinée.
const BASES = Object.freeze({
    [BASE_PRODUCTION]: 'MONGODB_URI',        // le catalogue Cardmarket appris, lecture seule
    [BASE_BAC_A_SABLE]: 'MONGODB_URI',       // le bac à sable, même grappe
    cartes: 'MONGODB_CARTES_URI'             // la base de collecte — AUTRE grappe (collecte-cartes/garde.js)
});

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
 * @param {boolean} options.confirmationProduction
 *        si true ET qu'on écrit ET que la cible est la production, exige en plus le
 *        drapeau --confirmer-production. Réservé aux opérations de MASSE (réécriture
 *        ou import de milliers de documents) : nommer la base protège de l'erreur de
 *        cible, ce second drapeau protège de l'erreur de geste. Les scripts
 *        d'apprentissage incrémental ne l'activent pas — ils tournent souvent, et une
 *        friction permanente finirait par être contournée.
 * @returns {Promise<string>} le nom de la base réellement connectée
 *
 * Ne renvoie JAMAIS sur une base non demandée : en cas d'écart, le processus s'arrête
 * avec un code de sortie 1, connexion fermée, avant toute opération.
 */
async function connecterMongo({ script = 'ce script', ecrit = false, confirmationProduction = false } = {}) {
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

    // ── LA GRAPPE, AVANT LA BASE. Une base inconnue de la table est REFUSÉE : elle ne « n'existe
    //    pas », elle n'a pas d'adresse chez nous, et c'est une phrase différente (§36).
    const variable = BASES[attendue];
    if (!variable) {
        console.error(`\n❌ REFUS : je ne sais pas OÙ vit la base "${attendue}".`);
        console.error(`   Ce n'est pas « elle est vide » ni « la collection est introuvable » : je n'ai`);
        console.error(`   pas son adresse. M'y connecter quand même créerait une base VIDE du bon nom`);
        console.error(`   sur la grappe de production, et tout contrôle portant sur le NOM passerait.`);
        console.error(`\n   Bases connues :`);
        for (const [b, v] of Object.entries(BASES))
            console.error(`     ${b.padEnd(14)} → ${v}${process.env[v] ? '' : '   🔴 absente du .env'}`);
        console.error(`\n   Pour en ajouter une : une ligne dans BASES de mongo-connexion.js, pas un --base= de plus.`);
        process.exit(1);
    }
    if (!process.env[variable]) {
        console.error(`\n❌ REFUS : la base "${attendue}" vit derrière ${variable}, absente du .env.`);
        console.error(`   Aucune opération n'a été effectuée, et surtout : aucune connexion de repli.`);
        process.exit(1);
    }

    await mongoose.connect(process.env[variable], { dbName: attendue });
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

    // 🔑 ET LE CONTRÔLE QUI AURAIT SUFFI À LUI SEUL, PARCE QU'IL NE PORTE PAS SUR UN NOM : une base
    // RÉELLE de ce projet n'est jamais vide. Zéro collection veut dire qu'on vient de la faire
    // naître en s'y connectant — la signature exacte d'une grappe fausse.
    const nCollections = (await mongoose.connection.db.listCollections().toArray()).length;
    if (!nCollections) {
        console.error(`\n❌ ARRÊT : la base "${reelle}" derrière ${variable} ne contient AUCUNE collection.`);
        console.error(`   Une base vide n'est pas un résultat : MongoDB la crée à la demande, donc c'est`);
        console.error(`   le signe qu'on n'est pas sur la bonne grappe. Aucune opération n'a été effectuée.`);
        await mongoose.disconnect();
        process.exit(1);
    }

    if (reelle === BASE_PRODUCTION) {
        console.log(`🗄️  Base : "${reelle}"  ⚠️  PRODUCTION${ecrit ? " — ce script ÉCRIT" : " (lecture seule)"}`);
    } else {
        console.log(`🗄️  Base : "${reelle}"${reelle === BASE_BAC_A_SABLE ? ' (bac à sable)' : ''}`);
    }

    // Second verrou, pour les écritures de MASSE en production : nommer la base protège
    // de l'erreur de CIBLE, ce drapeau protège de l'erreur de GESTE (un --ecrire lancé
    // par réflexe, une flèche haute dans l'historique du terminal).
    if (ecrit && confirmationProduction && reelle === BASE_PRODUCTION
        && !process.argv.includes('--confirmer-production')) {
        console.error("");
        console.error(`❌ ARRÊT : écriture de masse sur la PRODUCTION ("${reelle}") sans confirmation.`);
        console.error(`   Relance avec --confirmer-production si c'est bien ce que tu veux :`);
        console.error(`     node ${script} --base=${reelle} --ecrire --confirmer-production`);
        console.error("");
        console.error("   Pense à une sauvegarde d'abord :");
        console.error(`     node backup-collections.js --base=${reelle}`);
        await mongoose.disconnect();
        process.exit(1);
    }
    return reelle;
}

module.exports = { connecterMongo, baseDemandee, BASES, BASE_PRODUCTION, BASE_BAC_A_SABLE };
