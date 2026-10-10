'use strict';
// Le nombre maximal de cartes d'UN scan (un lot). Une seule définition : un lot rend au plus cette quantité de cartes (lot.js), et `carte` — l'index d'entrée
// qu'adressent /api/identifier/reponse et /api/retour-live — va de 0 à CARTES_PAR_SCAN_MAX - 1. Trois exemplaires du littéral divergeraient (§21 bis).
const CARTES_PAR_SCAN_MAX = 100;
module.exports = { CARTES_PAR_SCAN_MAX };
