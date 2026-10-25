'use strict';
// ============================================================
// LE SUBSTITUT DE POPULARITÉ (testeur, 2026-10-25) — module pur, aucune base
// ============================================================
// ⚠️ Le guide de prix ne porte PAS de nombre d'offres (champs : avg, avg1, avg7, avg30, low, trend et leurs Holo) : c'est un PROXY, dit dans chaque sortie qui s'en sert.
// L'ordre, du plus populaire au moins populaire :
//   1. une offre en cours (`low` ou `lowHolo` non nul)
//   2. l'activité de vente : avg1 > avg7 > avg30 > aucune ; un produit ABSENT du guide passe après « aucune »
//   3. `trend` décroissant (absent = 0)
//   4. idProduct croissant (ordre total : deux exécutions rendent le même ordre)
// Référence de la règle : S8\PRIORITES\files-par-popularite.js (lignes 28-33), dont ce module est la reprise testée (§21 bis : une règle, un endroit).

/** Ce que dit une ligne du guide (ou son absence) : { auGuide, offres, activite, trend }. */
function popDe(g) {
    if (!g) return { auGuide: false, offres: false, activite: -1, trend: 0 };
    return {
        auGuide: true,
        offres: g.low != null || g.lowHolo != null,
        activite: g.avg1 != null ? 3 : g.avg7 != null ? 2 : g.avg30 != null ? 1 : 0,
        trend: g.trend || 0
    };
}

/** Comparateur de deux éléments { idProduct, pop } : négatif si `a` est PLUS populaire que `b`. */
const comparer = (a, b) => (Number(b.pop.offres) - Number(a.pop.offres)) || (b.pop.activite - a.pop.activite) || (b.pop.trend - a.pop.trend) || (a.idProduct - b.idProduct);

/** Une copie triée ; le tableau reçu n'est pas modifié. */
const trier = (xs) => [...xs].sort(comparer);

module.exports = { popDe, comparer, trier };
