'use strict';
// GARDE DE SERVICE DE L'ESSAI — écrite par ce qu'elle AUTORISE : une liste permise de TROIS conditions positives, toutes requises, sinon « ce n'est pas l'essai » et RIEN de ce qui n'existe
// que sur l'essai (l'exemption de mesure, le module v2/essai-parcours/, sa route d'administration) n'est même chargé :
//   · MONGODB_BASE exactement « rm_essai » (la base de l'essai, mongo-connexion.js) ;
//   · RENDER_SERVICE_ID exactement le service Render de l'essai (variable posée par Render lui-même : un copier-coller des variables de l'essai vers un autre service ne l'emporte pas) ;
//   · V2_CIBLE exactement « essai ».
// Variable absente, vide, de casse différente, entourée d'espaces : refus. Ce fichier est volontairement MINUSCULE et ne charge rien : c'est lui qui décide si le reste se charge.
const SERVICE_ESSAI = 'srv-db7ticgm7kps73crjibg';
const BASE_ESSAI = 'rm_essai';
const CIBLE_ESSAI = 'essai';

/** → null si l'environnement prouve l'essai ; sinon la cause du refus (jamais une valeur de variable). */
function raisonRefus(env) {
    if (!env || typeof env !== 'object') return 'environnement illisible';
    if (env.MONGODB_BASE !== BASE_ESSAI) return 'la base n\'est pas celle de l\'essai (MONGODB_BASE)';
    if (env.RENDER_SERVICE_ID !== SERVICE_ESSAI) return 'ce service n\'est pas celui de l\'essai (RENDER_SERVICE_ID)';
    if (env.V2_CIBLE !== CIBLE_ESSAI) return 'V2_CIBLE n\'est pas « essai »';
    return null;
}
const essaiProuve = env => raisonRefus(env) === null;

module.exports = { SERVICE_ESSAI, BASE_ESSAI, CIBLE_ESSAI, raisonRefus, essaiProuve };
