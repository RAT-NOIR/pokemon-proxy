// ============================================================
// ALIAS DE NOMS, À LA MAIN — quand Cardmarket et Bulbapedia ne nomment pas la même carte pareil
// ============================================================
// Chaque ligne est un FAIT constaté sur un reste, pas une règle générale : le nom Cardmarket (côté
// gauche, tel que `decomposerNomCardmarket` le rend, sans crochets) est joint SOUS le nom Bulbapedie
// (côté droit) EN PLUS de son propre nom. Une ligne ne s'ajoute qu'avec le reste qui l'a motivée.

const ALIAS_CARDMARKET_VERS_BULBAPEDIA = {
    // N4 « Darkness, and to Light... » : Cardmarket garde le nom japonais de la carte, Bulbapedia le nom occidental. 2026-09-12.
    'EXP. ALL': 'Exp. Share'
};

module.exports = { ALIAS_CARDMARKET_VERS_BULBAPEDIA };
