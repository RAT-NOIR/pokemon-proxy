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
    EXS: { ids: [11, 14, 17], noms: ['Expansion Sheet No. 1 (Blue Version)', 'Expansion Sheet No. 2 (Red Version)', 'Expansion Sheet No. 3 (Green Version)'] },
    // 2026-09-15 : lignes automatiques dont le nom artofpkm DIFFÈRE (preparer-images-auto.js les listait « absentes »),
    // relues dans artofpkm-sets.json. ⚠️ Ce commentaire disait « sm12a n'a AUCUN set chez artofpkm » : FAUX, il y est sous
    // « Tag Team GX All Stars » (392). Une correspondance de nom absente n'est pas un set absent (§22).
    sv8: { ids: [551], noms: ['Electric Breaker'], note: 'Cardmarket « Super Electric Breaker »' },
    CP4: { ids: [531], noms: ['Premium Champion Pack EX x M x BREAK'], note: 'Cardmarket « Premium Champion Pack »' },
    // Fusionnées depuis sources-sets-en-attente.json (2026-09-15) : les 20 CERTAINES. Les 4 probables (sm2+, ADV4, MDB, MCRP)
    // restent en attente : une source fausse attacherait les images d'un autre set.
    CP6: { ids: [536], noms: ['20th Anniversary'], note: 'Cardmarket « Expansion Pack 20th Anniversary »' },
    sm1S: { ids: [325], noms: ['Collection Sun'] },
    sm1M: { ids: [326], noms: ['Collection Moon'] },
    DP5t: { ids: [172], noms: ['Temple of Wrath'], note: 'Cardmarket « Temple of Anger »' },
    sm3h: { ids: [339], noms: ['Did You See the Fighting Rainbow'], note: 'Cardmarket « To Have Seen the Battle Rainbow »' },
    sm3n: { ids: [338], noms: ['Light-Devouring Darkness'], note: 'Cardmarket « Darkness that Consumes Light »' },
    sm4a: { ids: [342], noms: ['Ultra Dimensional Beast'], note: 'Cardmarket « Ultradimensional Beasts »' },
    'sm5+': { ids: [352], noms: ['Ultra Forces'], note: 'Cardmarket « Ultra Force »' },
    svN: { ids: [587], noms: ['Deck Build Box Battle Partners'] },
    sm12a: { ids: [392], noms: ['Tag Team GX All Stars'], note: 'Cardmarket « Tag All Stars »' },
    s10a: { ids: [462], noms: ['Dark Fantasma'], note: 'Cardmarket « Dark Phantasma »' },
    svK: { ids: [542], noms: ['Deck Build Box Stellar Miracle'] },
    CP5: { ids: [535], noms: ['Mythical / Legendary Dream Holo Collection'], note: 'Cardmarket « Mythical Legendary Dream Shine Collection »' },
    svF: { ids: [494], noms: ['Deck Build Box Ruler of the Black Flame'] },
    CP1: { ids: [301], noms: ['Team Magma vs. Team Aqua Double Crisis'], note: 'Cardmarket « Magma Gang VS Aqua Gang Double Crisis »' },
    CP2: { ids: [309], noms: ['Legendary Holo Collection'], note: 'Cardmarket « Legendary Shine Collection »' },
    SNPr: { ids: [525], noms: ['BREAK Evolution Pack Raichu BREAK'] },
    SNPn: { ids: [523], noms: ['BREAK Evolution Pack Noivern BREAK'] },
    sm0: { ids: [323], noms: ['Pikachu and their New Friends'], note: 'Cardmarket « Pikachus New Friends »' },
    sp4: { ids: [435], noms: ['VMAX Special Set, Eevee Heroes'] }
};

// LES LIGNES AUTOMATIQUES : correspondance GÉNÉRÉE par `preparer-images-auto.js --correspondre` (nom normalisé,
// unique ; ambiguë ou absente = non écrite). La table à la main l'emporte toujours.
const FICHIER_AUTO = require('path').join(__dirname, 'sources-sets-auto.json');
const ARTOFPKM_AUTO = require('fs').existsSync(FICHIER_AUTO) ? JSON.parse(require('fs').readFileSync(FICHIER_AUTO, 'utf8')) : {};

function sourceDe(code, source = 'artofpkm') {
    if (source !== 'artofpkm') return null;
    const l = ARTOFPKM[code] || ARTOFPKM_AUTO[code];
    return l ? { source, code, ...l } : null;
}

module.exports = { ARTOFPKM, ARTOFPKM_AUTO, sourceDe };
