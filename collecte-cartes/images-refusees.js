// ============================================================
// UNE LIGNE QUI REFUSE TOUTE IMAGE (lot X30C, 2026-10-13)
// ============================================================
// Une ligne de table peut déclarer `imagesRefusees: '<raison>'` : aucune source n'en collecte d'image, aucune file ne l'enfile (alimentateur, TCGdex, Bulbapedia).
// Le cas : un Additionals dont les produits sont des impressions TAMPONNÉES ou holo du parent (x30C : Mewtwo 063 « What's Your Favorite? », Eevee 116 holo de blister) —
// le scan du parent est celui d'une AUTRE impression, et « les réimpressions tamponnées ne reçoivent jamais l'image d'une autre impression » (CLAUDE.md, 2026-10-13).
// 🔑 UNE GARDE S'ÉCRIT PAR CE QU'ELLE AUTORISE : les images ne sont permises que si le champ est ABSENT. Présent sous n'importe quelle forme (vide, `true`, `false`), il refuse —
// une faute de frappe sur la raison ne rouvre jamais la collecte. Le point unique : les trois chemins (alimentateur, TCGdex, Bulbapedia) lisent CETTE fonction (§21 bis).
/** @returns {string|null} la raison du refus, ou null si la ligne n'a pas déclaré de refus. */
function imagesRefusees(L) {
    if (!L || !Object.hasOwn(L, 'imagesRefusees')) return null;
    const r = L.imagesRefusees;
    return typeof r === 'string' && r.trim() ? r : `imagesRefusees mal formé (${JSON.stringify(r)}) : par prudence, les images sont refusées`;
}
module.exports = { imagesRefusees };
