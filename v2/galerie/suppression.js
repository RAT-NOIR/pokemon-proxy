'use strict';
// GALERIE — le crochet de la SUPPRESSION D'UN COMPTE (comptes/service.js, comptes/purge.js). Tout ce que la Communauté garde du compte part avec lui (service.supprimerDuCompte).
//   · lot éteint ou jamais monté : ne fait RIEN et ne touche à rien (la suppression est celle d'avant) ;
//   · lot monté mais base dédiée pas branchée : LÈVE — la suppression du compte s'arrête (rien n'est supprimé de plus) et se rejoue, au lieu d'oublier des données de la Communauté.
const monter = require('./monter');
const G = require('./base');
const svc = require('./service');

async function supprimerDuCompte(compteId) {
    if (monter.etat() !== 'monte') return null;
    if (!G.branche()) throw new Error('galerie : base dédiée indisponible, suppression de la Communauté à rejouer');
    return svc.supprimerDuCompte(compteId, monter.stockage());
}
module.exports = { supprimerDuCompte };
