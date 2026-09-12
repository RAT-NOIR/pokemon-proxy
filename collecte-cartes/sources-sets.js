// ============================================================
// LA TABLE SET → SOURCE D'IMAGES, ÉCRITE À LA MAIN
// ============================================================
// Relation n-n set-source ↔ expansion Cardmarket : EXS = trois Expansion Sheet chez PKMJP pour une
// expansion chez nous ; PCG6 = le set principal, les half decks (123/125/126) sont d'autres produits.
// Résolue le 2026-09-12 sur les noms du site (SPEC-COLLECTE-IMAGES.md §1). Quatre sets ne portent
// PAS le nom attendu : EXP est « Base Set », MFO « The Secret of the Fossil », VS « Pokémon
// Card★VS », DP5c « Cries of Secrecy ». IPB « Intro Pack » (id 28) : Bulbasaur seul ou les deux
// decks ? le compte tranche à la collecte.

const ARTOFPKM = {
    EXP: { ids: [6], noms: ['Base Set'] },
    PJU: { ids: [8], noms: ['Pokémon Jungle'] },
    MFO: { ids: [9], noms: ['The Secret of the Fossil'] },
    ROG: { ids: [10], noms: ['Rocket Gang'] },
    G1: { ids: [18], noms: ['Gym Expansion 1: Gym Leader Stadiums'] },
    G2: { ids: [25], noms: ['Gym Expansion 2: Challenge from the Dark'] },
    'SI-JP': { ids: [27], noms: ['Southern Islands'] },
    N1: { ids: [31], noms: ['Gold, Silver, to a New World...'] },
    N2: { ids: [34], noms: ['Crossing the Ruins...'] },
    N3: { ids: [40], noms: ['Awakening Legends'] },
    N4: { ids: [43], noms: ['Darkness, and to Light...'] },
    VS: { ids: [46], noms: ['Pokémon Card★VS'] },
    WEB: { ids: [50], noms: ['Pokémon Card★web'] },
    EC1: { ids: [51], noms: ['Base Expansion Pack'] },
    EC2: { ids: [56], noms: ['The Town on No Map'] },
    EC3: { ids: [57], noms: ['Wind from the Sea'] },
    EC4: { ids: [59], noms: ['Split Earth'] },
    EC5: { ids: [61], noms: ['Mysterious Mountains'] },
    ADV2: { ids: [71], noms: ['Miracle of the Desert'] },
    ADV3: { ids: [73], noms: ['Rulers of the Heavens'] },
    ADVex1: { ids: [79], noms: ['Magma VS Aqua: Two Ambitions'] },
    IPB: { ids: [28], noms: ['Intro Pack'], note: 'Bulbasaur seul ou les deux decks ? le compte tranche' },
    MCDP: { ids: [54], noms: ["McDonald's Pokémon-e Minimum Pack"] },
    DP5c: { ids: [171], noms: ['Cries of Secrecy'] },
    PCG6: { ids: [127], noms: ['Holon Research Tower'], note: 'half decks 123/125/126 à part' },
    PCG9: { ids: [137], noms: ['Offense and Defense of the Furthest Ends'] },
    DP2: { ids: [150], noms: ['Secret of the Lake'] },
    EXS: { ids: [11, 14, 17], noms: ['Expansion Sheet No. 1 (Blue Version)', 'Expansion Sheet No. 2 (Red Version)', 'Expansion Sheet No. 3 (Green Version)'] }
};

function sourceDe(code, source = 'artofpkm') {
    if (source !== 'artofpkm') return null;
    const l = ARTOFPKM[code];
    return l ? { source, code, ...l } : null;
}

module.exports = { ARTOFPKM, sourceDe };
