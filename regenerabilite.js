// ============================================================
// LA REGENERABILITE D'UNE COLLECTION — par ce qu'on SAIT, jamais par defaut (2026-10-10)
// ============================================================
// Avant : `backup-collections.js` imprimait « (régénérable) » pour toute collection absente de NON_REGENERABLES. Le libelle
// rassurant etait le DEFAUT : `histo_valeur_sets` (un instantane par jour du guide, qui ne se refait plus une fois le guide
// remplace) sortait « régénérable ». Une garde s'ecrit par ce qu'elle AUTORISE : trois classes, et TOUT LE RESTE est « inconnue ».
//   · REGENERABLES     — liste FERMEE, chaque entree avec la commande qui la refait (la raison EST la preuve) ;
//   · NON_REGENERABLES — rien ne la refait a l'identique ;
//   · le reste         — « inconnue » : une collection neuve (comptes, mouvements, analyses de l'API v2…) n'est declaree sans danger par personne.
// Relevees le 2026-10-10 avec `node backup-collections.js --base=test|cartes` SANS --collections (noms et tailles seulement).

/** collection → la commande qui la refait. Ajouter une entree = ecrire cette phrase. */
const REGENERABLES = Object.freeze({
    // base `test`
    catalogue_produits: 'import-catalogue.js / integrer-export.js <products_singles_*.json> : c\'est l\'export Cardmarket (archive sur R2 par import-catalogue-quotidien.js) ; aucune ligne n\'en est tiree d\'ailleurs',
    references_image: 'ecrire-descripteurs.js --base=test (reprenable) : les descripteurs se recalculent depuis les images',
    cardprices: 'cache de prix a duree de vie de 24 h (index.js:635, « entièrement régénérable ») : une ligne perdue ne se distingue pas d\'une ligne expiree',
    // base `cartes`
    file_images: 'collecte-cartes/remplir-file-images.js (reconstruit la file depuis collecte_images_etat) et l\'alimentateur du worker (collecte-cartes/alimentateur.js)'
});

/** Rien ne la refait a l'identique : apprise, journal, argent, historique date, decision a la main. */
const NON_REGENERABLES = Object.freeze([
    // base `test` — historiques de l'outil
    'numeros_cartes', 'codes_set',              // APPRISES scan apres scan
    'journal_scans',                            // le journal de production
    'credits', 'evenements_stripe', 'remboursements', 'quotas_semaine', 'quotas',   // argent et quotas
    'questions', 'remboursements_questions',    // facturation : questions en attente et compteur de remboursements (acces.js:116-136)
    'guide_prix',                               // une ligne absente du dernier guide GARDE son prix date (import-price-guide.js:49-52, 158)
    // base `cartes`
    'histo_valeur_sets',                        // un instantane par set et par jour du guide (collecte-cartes/historique-valeur.js:13)
    'cartes',                                   // illustrateurs/impressions posees que le parseur ne refabrique pas (schemas.js:41-42, impressions-posees.js)
    'cartes_produits',                          // preuve 'manuel', detachements, visuelSubstitut : decisions ecrites (schemas.js:75)
    'sets',                                     // nomAffichage, logos, dates poses par des outils dedies (nom-affichage.js)
    'images'                                    // documents `etat: 'retire'` (retirer-visuels.js:10) : un rejeu ne les reprend pas
]);

/** Pure : 'non-regenerable' | 'regenerable' | 'inconnue'. Tout ce qui n'est pas NOMME dans une liste est « inconnue ». */
function libelleRegeneration(nom) {
    if (typeof nom !== 'string' || !nom) return 'inconnue';
    if (NON_REGENERABLES.includes(nom)) return 'non-regenerable';
    if (Object.prototype.hasOwnProperty.call(REGENERABLES, nom)) return 'regenerable';
    return 'inconnue';
}

/** Le texte imprime a la suite d'une collection non sauvegardee. */
const ETIQUETTES = Object.freeze({
    'non-regenerable': '  🔴 NON RÉGÉNÉRABLE — es-tu sûr ?',
    'regenerable': '  (régénérable : voir regenerabilite.js)',
    'inconnue': '  ❓ régénérabilité INCONNUE — personne ne l\'a classée'
});

module.exports = { REGENERABLES, NON_REGENERABLES, libelleRegeneration, ETIQUETTES };
