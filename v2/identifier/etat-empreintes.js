'use strict';
// MODELE-VISUEL-API — l'index des empreintes EN PLACE : un seul pointeur, remplacé d'un geste (bascule atomique), comme chargeur/etat.js pour l'archive des visuels. Rien d'autre que le chargeur
// (chargeur/montage-empreintes.js) ne l'écrit ; les lecteurs (voisins-empreinte.js) relisent `courante()` à chaque appel et n'en gardent jamais de copie. `null` = pas d'index : G se tait.
let courante = null;
module.exports = {
    courante: () => courante,
    /** @param {{index: object, meta: object}} v   gelé : un lecteur ne peut pas le modifier en passant */
    installer(v) { if (!v || !v.index || !v.meta || !Object.isFrozen(v)) throw new Error('index d\'empreintes refusé : absent ou non gelé'); courante = v; },
    vider() { courante = null; }
};
