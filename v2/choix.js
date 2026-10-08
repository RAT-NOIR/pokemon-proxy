'use strict';
// Les candidats d'une question, SANS ORDRE DE CLASSEMENT (CONTRAT-2 §3.1) : triés par idProduct croissant, identifiés a/b/c.
// Partagé par B1 (qui pose la question) et B3 (qui la règle) : une seule définition.
function choixPour(idProducts) {
    if (!Array.isArray(idProducts)) throw new Error('choixPour : tableau attendu');
    if (new Set(idProducts).size !== idProducts.length) throw new Error('choixPour : doublon (deux fois le même candidat n\'est pas deux candidats)');
    if (idProducts.length < 2 || idProducts.length > 3) throw new Error(`choixPour : 2 ou 3 candidats, reçu ${idProducts.length}`);
    return [...idProducts].sort((x, y) => x - y).map((idProduct, i) => ({ id: 'abc'[i], idProduct }));
}
module.exports = { choixPour };
