'use strict';
// Les chemins que l'ancien serveur (index.js) déclare. Une route v2 qui recouvre l'un d'eux DOIT commencer par un aiguilleur :
// une requête 1.0.x (sans contrat 2, sans Bearer) doit retomber sur la route héritée, même quand la garde d'index ferme la v2.
// test-heritage.js compare cette liste aux routes réellement déclarées dans index.js, dans les deux sens.
const CHEMINS_HERITES = Object.freeze([
    '/api/webhook-stripe', '/api/analyser', '/api/identifier', '/api/retour-live', '/api/repondre-question',
    '/api/apprendre', '/api/apprendre-lot', '/api/creer-recharge', '/api/solde', '/ping', '/'
]);

const MARQUE = Symbol('rm.v2.aiguilleur');
const LIMITE_JOURNAL = 5;
/** Premier handler d'une route v2 qui recouvre un chemin hérité : prédicat faux => next('route') (l'héritée répond), AVANT la garde d'index. */
function aiguilleur(pred) {
    if (typeof pred !== 'function') throw new Error('aiguilleur : un prédicat (fonction) est exigé');
    let journalises = 0;
    const signaler = raison => {   // journal BORNÉ : au plus LIMITE_JOURNAL lignes par aiguilleur, puis une ligne de silence
        if (journalises > LIMITE_JOURNAL) return;
        journalises++;
        console.error(journalises > LIMITE_JOURNAL ? '🔴 [v2 aiguilleur] suite du journal supprimée (même défaut)' : `🔴 [v2 aiguilleur] ${String(raison).slice(0, 200)} — la route héritée répond`);
    };
    const f = function aiguilleurV2(req, res, next) {
        // Seul `true` (booléen, synchrone) envoie vers la v2 : tout le reste (faux, exception, Promise, valeur truthy non booléenne)
        // ne peut pas conclure à « v2 » et laisse répondre la route héritée.
        let v = false;
        try {
            const r = pred(req);
            if (r && typeof r.then === 'function') { r.then(() => {}, () => {}); signaler('prédicat asynchrone (Promise) : un booléen synchrone est exigé'); }
            else if (typeof r !== 'boolean') signaler(`prédicat non booléen (${typeof r}) : un booléen est exigé`);
            else v = r;
        } catch (e) { signaler(`prédicat qui lève : ${(e && (e.code || e.name)) || 'erreur'}`); }
        return v ? next() : next('route');
    };
    f[MARQUE] = true;
    return f;
}
const estAiguilleur = f => typeof f === 'function' && f[MARQUE] === true;
module.exports = { CHEMINS_HERITES, aiguilleur, estAiguilleur };
