// ============================================================================
// LE NOM LISIBLE D'UN SET — une seule définition, dans une FEUILLE sans effet de bord
// ============================================================================
// POURQUOI CE FICHIER EXISTE, ET POURQUOI IL EST SI PETIT. `nomDeSet` vivait dans
// candidats-fiche.js, et /api/identifier a eu besoin de lui le 2026-09-07 pour nommer le
// set de chaque candidat montré à l'utilisateur. Or candidats-fiche.js requiert `./index`
// en tête — et index.js OUVRE la connexion Mongo au chargement, sur la base de l'URI.
//   · un `require('./candidats-fiche')` en tête d'index.js aurait fait un cycle, avec un
//     `module.exports` encore vide du côté de candidats-fiche ;
//   · un `require` paresseux dans la route marchait en production, mais `verifier-sources.js`
//     charge CHAQUE module qu'index.js mentionne pour lister ses exports : il chargeait donc
//     candidats-fiche, donc index.js, donc une connexion sur `test` DANS le processus du
//     smoke test — dont le nettoyage a refusé de tourner (« base de nettoyage inattendue :
//     test »). Le verrou était rouge, et la cause était à trois fichiers de là.
// Une feuille sans `require` local ne peut faire ni l'un ni l'autre. candidats-fiche.js
// continue de l'exporter : ses consommateurs (saisir-verites.js) ne voient aucune différence.
//
// ⚠️ NE PAS Y AJOUTER UN `require` VERS UN MODULE QUI OUVRE UNE CONNEXION. C'est toute la
// raison d'être du fichier.

/**
 * « Base-Expansion-Pack » -> « Base Expansion Pack ». Le slug EST le nom lisible : c'est la
 * seule forme lisible qu'on possède, `codes_set` ne porte qu'un code.
 * @param {object|null|undefined} num  une ligne de `numeros_cartes` (ou rien)
 * @returns {string|null}
 */
const nomDeSet = num => (num && num.slugSet) ? String(num.slugSet).replace(/-/g, ' ') : null;

module.exports = { nomDeSet };
