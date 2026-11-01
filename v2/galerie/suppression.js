'use strict';
// GALERIE — le crochet de la SUPPRESSION D'UN COMPTE, appelé par comptes/service.js (supprimerCompte) : tout ce que la Communauté garde du compte part avec lui (service.supprimerDuCompte).
// Il n'est PAS appelé par comptes/purge.js (les comptes jamais confirmés) : un compte non confirmé n'est pas un porteur, donc il n'a ni pseudo ni dépôt ; la future passe de suppression pour inactivité devra passer par
// supprimerCompte, sinon la Communauté serait oubliée.
//   · lot éteint ou jamais monté : ne fait RIEN et ne touche à rien (la suppression est celle d'avant) ;
//   · lot monté mais base dédiée pas branchée : LÈVE — la suppression du compte s'arrête (rien n'est supprimé de plus) et se rejoue, au lieu d'oublier des données de la Communauté ;
//   · une suppression R2 qui échoue n'est pas avalée : la clé entre dans la file purges_r2, rejouée par le balayeur (balayeur.js).
const monter = require('./monter');
const G = require('./base');
const svc = require('./service');

async function supprimerDuCompte(compteId) {
    if (monter.etat() !== 'monte') return null;
    if (!G.branche()) throw new Error('galerie : base dédiée indisponible, suppression de la Communauté à rejouer');
    return svc.supprimerDuCompte(compteId, monter.stockage(), monter.secret());
}
module.exports = { supprimerDuCompte };
