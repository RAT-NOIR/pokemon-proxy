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

// ALIAS LIMITÉS À UNE EXPANSION (2026-10-13, lot CEL). Un alias GLOBAL s'applique à tout produit de ce nom dans toute expansion : « Luxray LV.X »
// (nom que le décomposeur rend pour « Luxray [GL] LV.X ») est AUSSI le nom du Luxray LV.X ordinaire de Platinum — l'aliaser partout rattacherait ce
// dernier à la carte « Luxray GL LV.X ». Ces entrées ne valent donc que pour l'idExpansion qui les a motivées (clé : idExpansion Cardmarket).
// 4347 = Celebrations : la Classic Collection y réimprime des cartes dont Cardmarket et Bulbapedia écrivent le nom autrement.
const ALIAS_PAR_EXPANSION = {
    4347: {
        'Gardevoir ex δ Delta Species': 'Gardevoir ex δ',
        'Umbreon Gold Star': 'Umbreon',
        'Luxray LV.X': 'Luxray GL LV.X',                       // « Luxray [GL] LV.X » : la lettre de forme entre crochets sort du nom
        'Garchomp LV.X C': 'Garchomp C LV.X',                  // « Garchomp [C] LV.X » : idem, et le décomposeur la remet APRÈS « LV.X »
        'Professor\'s Research - Professor Oak': 'Professor\'s Research'   // la page Bulbapedia est « Professor's Research » (023, 024) ; Cardmarket ajoute le dresseur
    }
};

/** Le nom Bulbapedia sous lequel un produit de cette expansion se joint EN PLUS du sien : alias global, sinon alias de l'expansion, sinon rien. */
function aliasDe(nom, idExpansion = null) {
    if (Object.prototype.hasOwnProperty.call(ALIAS_CARDMARKET_VERS_BULBAPEDIA, nom)) return ALIAS_CARDMARKET_VERS_BULBAPEDIA[nom];
    const table = idExpansion != null && Object.prototype.hasOwnProperty.call(ALIAS_PAR_EXPANSION, idExpansion) ? ALIAS_PAR_EXPANSION[idExpansion] : null;
    return table && Object.prototype.hasOwnProperty.call(table, nom) ? table[nom] : undefined;
}

module.exports = { ALIAS_CARDMARKET_VERS_BULBAPEDIA, ALIAS_PAR_EXPANSION, aliasDe };
