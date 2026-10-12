// ============================================================
// LE DECK D'UN SET — écrit sur son document, relu par la réparation des numéros (T4b fix1, 2026-10-12)
// ============================================================
// Plusieurs sets Cardmarket partagent UN nom d'expansion Bulbapedia (les trois Pokémon Card Game Classic, Giratina vs Dialga Deck Kit, …) : seul
// le DECK les sépare. `creer-sets-sans-page.js` l'écrit sur le set NEUF (champ `deck`, additif) ; `numero-fiche.js` (numerosDuSet) et
// `corriger-numero-fiche.js` (PROJECTION_SETS) le relisent — sans lui, une réparation ultérieure mélangerait les numéros de decks frères.
// Un set sans deck n'écrit RIEN : les sets existants restent tels quels.
const CHAMP_DECK = 'deck';
/** @param {{deck?: string|null}} x @returns {object} les champs de deck à poser sur le document du set ({} si aucun) */
function champsDeck(x) { return x?.deck != null && String(x.deck).trim() !== '' ? { [CHAMP_DECK]: x.deck } : {}; }
module.exports = { CHAMP_DECK, champsDeck };
