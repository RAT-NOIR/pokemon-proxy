'use strict';
// Le nombre maximal de cartes d'UN scan (un lot). Une seule source : `cfg.lot.cartesMax` (V2_LOT_CARTES_MAX, défaut 20, entier >= 2, validé par config.js).
// Un lot rend au plus cette quantité de cartes (lot.js refuse au-delà), et `carte` — l'index d'entrée qu'adressent /api/identifier/reponse et /api/retour-live — va de
// 0 à cartesParScanMax(cfg) - 1. Aucune constante numérique ici : trois exemplaires du littéral divergeraient (§21 bis).
const cartesParScanMax = cfg => cfg.lot.cartesMax;
module.exports = { cartesParScanMax };
