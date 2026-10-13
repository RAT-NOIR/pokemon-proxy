'use strict';
// Les FILTRES du banc de l'administrateur, écrits UNE fois : ils servent à la fois de requête (reprise des lignes en attente, filet des orphelins) et de `partialFilterExpression` des index qui les servent
// (v2/modeles.js). Un index partiel ne sert une requête que si le filtre de la requête IMPLIQUE celui de l'index : les deux sortent de la même constante, et v2/test/test-banc-etiquette-tour2.js
// vérifie l'égalité et le plan d'exécution (parcours d'index, jamais de parcours complet de `analyses`).
module.exports = {
    attente: { bancAttente: true },                       // une analyse dont au moins une étiquette n'est pas encore reflétée dans le banc
    photo: { 'photoBanc.cle': { $type: 'string' } }       // une analyse qui nomme une photo du bucket du banc
};
