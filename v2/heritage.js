'use strict';
// Les chemins que l'ancien serveur (index.js) déclare. Une route v2 qui recouvre l'un d'eux DOIT commencer par un aiguilleur :
// une requête 1.0.x (sans contrat 2, sans Bearer) doit retomber sur la route héritée, même quand la garde d'index ferme la v2.
// test-heritage.js compare cette liste aux routes réellement déclarées dans index.js, dans les deux sens.
const CHEMINS_HERITES = Object.freeze([
    '/api/webhook-stripe', '/api/analyser', '/api/identifier', '/api/retour-live', '/api/repondre-question',
    '/api/apprendre', '/api/apprendre-lot', '/api/creer-recharge', '/api/solde', '/ping', '/'
]);

const MARQUE = Symbol('rm.v2.aiguilleur');
/** Premier handler d'une route v2 qui recouvre un chemin hérité : prédicat faux => next('route') (l'héritée répond), AVANT la garde d'index. */
function aiguilleur(pred) {
    if (typeof pred !== 'function') throw new Error('aiguilleur : un prédicat (fonction) est exigé');
    const f = function aiguilleurV2(req, res, next) {
        let v = false;
        try { v = Boolean(pred(req)); } catch { v = false; }   // un prédicat qui lève ne peut pas conclure à « v2 » : l'héritée répond
        return v ? next() : next('route');
    };
    f[MARQUE] = true;
    return f;
}
const estAiguilleur = f => typeof f === 'function' && f[MARQUE] === true;
module.exports = { CHEMINS_HERITES, aiguilleur, estAiguilleur };
