'use strict';
// COTES-VISUELS — la version EN PLACE : un seul pointeur, remplacé d'un geste (bascule atomique). Rien d'autre ne l'écrit que le chargeur (installer) ; les lecteurs
// (identifier/visuels.js, collection/cotes.js) n'en gardent jamais une copie : ils relisent `version()` à chaque appel. `null` = l'état « sans visuel » (aucun chargement réussi).
let courante = null;
module.exports = {
    version: () => courante,
    /** Remplace la version d'un seul geste. Une version doit être gelée : un lecteur ne peut pas la modifier en passant. */
    installer(v) { if (!v || !Object.isFrozen(v)) throw new Error('version refusée : absente ou non gelée'); courante = v; },
    vider() { courante = null; }
};
