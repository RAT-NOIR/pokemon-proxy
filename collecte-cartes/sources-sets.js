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
    sp4: { ids: [435], noms: ['VMAX Special Set, Eevee Heroes'] },
    // 2026-09-15, lignes japonaises ajoutées (demi-sets écrasés par leur jumeau, film) : nom artofpkm différent.
    s6k: { ids: [431], noms: ['Jet-Black Poltergeist'], note: 'Cardmarket « Jet Black Spirit »' },
    s7D: { ids: [438], noms: ['Skyscraping Perfect'], note: 'Cardmarket « Towering Perfection »' },
    sm4s: { ids: [343], noms: ['Awakening Hero'], note: 'Cardmarket « Awakened Heroes »' },
    smP2: { ids: [382], noms: ['Detective Pikachu'], note: 'Cardmarket « Detective Pikachu JP »' },
    // 2026-09-25 : lignes japonaises SANS source dont les cartes attendent un visuel (55 lignes, 1 920 cartes). --correspondre
    // se taisait : un mot de plus (« The Glory… », « PCG-P » contre « PCG »), une autre traduction du même titre japonais
    // (« Amazing » / « Astonishing Volt Tackle »), l'ère en préfixe (« Scarlet & Violet Starter set ex… »). Paires LUES une à
    // une dans artofpkm-sets.json, jamais par inclusion (§31). Les « douteuses » de ce jour (svIba, MDB, XYe, 20th, ADV4…) ont été
    // PROUVÉES l'après-midi par la source (plus bas) ; restent dehors : sD (artofpkm renumérote chaque deck, prouvé), HSP, MCRP,
    // smA, pcgM/N/O, les demi-decks de coffret (artofpkm renumérote le coffret entier).
    'PCG-P': { ids: [89], noms: ['PCG Promotional Cards'], note: 'Cardmarket « PCG Promos » ; 3 « PCG Players Promotional Cards » est un autre set' },
    'ADV-P': { ids: [64], noms: ['ADV Promotional cards'], note: 'Cardmarket « ADV Promos »' },
    'L-P': { ids: [202], noms: ['Legend Promos'], note: 'Cardmarket « L P Promos » (L-P Promotional cards)' },
    sv10: { ids: [563], noms: ['Glory of Team Rocket'], note: 'Cardmarket « The Glory of Team Rocket »' },
    s4: { ids: [415], noms: ['Astonishing Volt Tackle'], note: 'Cardmarket « Shocking Volt Tackle », Bulbapedia « Amazing Volt Tackle » : trois traductions du même titre' },
    sF: { ids: [422], noms: ['Premium Trainer Box - Rapid Strike, Single Strike'], note: 'Cardmarket « Single Strike Rapid Strike Premium Trainer Boxes »' },
    mP1: { ids: [582], noms: ['Start Deck 100 Battle Collection - CoroCiào Ver.'] },
    sN: { ids: [455], noms: ['Start Deck 100 (Corocoro Version)'], note: 'Cardmarket « Start Deck 100 CoroCoro Comic Version »' },
    svAM: { ids: [540], noms: ['Scarlet & Violet Starter set ex Sprigatito & Lucario ex'] },
    svAW: { ids: [541], noms: ['Scarlet & Violet Starter set ex Quaxly & Mimikyu ex'] },
    smE: { ids: [348], noms: ['Starter Set Legend Solgaleo GX & Lunala GX'], note: 'Cardmarket « Solgaleo GX Lunala GX Legendary Starter Set »' },
    smC: { ids: [334], noms: ['Starter Set Tapu Bulu GX'], note: 'Cardmarket « Tapu Bulu GX Enhanced Starter Set »' },
    svEL: { ids: [500], noms: ['Starter Set Tera Skeledirge ex'], note: 'Cardmarket « Terastal Starter Set Skeledirge ex »' },
    svEM: { ids: [499], noms: ['Starter Set Tera Mewtwo ex'], note: 'Cardmarket « Terastal Starter Set Mewtwo ex »' },
    XYd: { ids: [304], noms: ['Battle Deck 60 Mega Rayquaza EX'], note: 'Cardmarket « MRayquaza EX Mega Battle Deck »' },
    XYb: { ids: [297], noms: ['Hyper Metal Chain Deck Dialga EX & Aegislash EX'] },
    smP1: { ids: [331], noms: ['Corocoro Rockruff Full Power Deck'] },
    smG: { ids: [354], noms: ['Deck Build Box Ultra Sun & Ultra Moon'], note: 'Cardmarket « Ultra Sun Ultra Moon Deck Build Boxes »' },
    sp3: { ids: [430], noms: ['Jumbo Pack Set - Silver Lance & Jet-Black Poltergeist'], note: 'Cardmarket « Silver Lance Jet Black Spirit Jumbo Pack Set »' },
    's8a-P': { ids: [447], noms: ['25th Anniversary Promo Pack'], note: 'Cardmarket « 25th Anniversary Edition » (Promo Card Pack 25th Anniversary Edition)' },
    RtA: { ids: [152], noms: ['Constructed Half Deck Rampardos the Attacker'] },
    BtD: { ids: [151], noms: ['Constructed Half Deck Bastiodon the Defender'] },
    // 2026-09-25 (après-midi) : paires « douteuses » PROUVÉES par la source elle-même, critère écrit avant la mesure : la liste
    // artofpkm lue, puis 3 pages de carte (premier, milieu, dernier rang numéroté) ; le NUMÉRO imprimé de chaque page désigne chez
    // nous une carte du set au MÊME nom — 3 sur 3, sinon rien. Une paire refusée par ce critère (sD : artofpkm renumérote chaque
    // deck de « Starter Set V » depuis 001, nous de 1 à 127) reste dehors : ses images tomberaient sur les mauvaises cartes.
    'M-P': { ids: [573], noms: ['MEGA Promos'], note: 'Cardmarket « M P Promos » (M-P Promotional cards) ; 3/3 : 001 Chikorita, 103 Squirtle, 154 Lucario' },
    ADV4: { ids: [84], noms: ['The Broken Seal'], note: 'Cardmarket « Undone Seal » ; 3/3 : 001 Zubat, 042 Chinchou, 083 Magnetic Storm ; nom japonais du set identique au nôtre (とかれた封印)' },
    // ⚠️ Les listes finissent par des Énergies de base SANS numéro imprimé : un échantillon qui en tombe une ne se JUGE pas (il
    // recule jusqu'à un numéro, 10 rangs au plus), il ne compte jamais comme un succès. 3e échantillon au rang 80 % pour tous.
    // Un kit dont les deux moitiés portent le même numéro (MG : 001 Tangela ET 001 Mewtwo, chez nous comme chez artofpkm) ne peut
    // pas recevoir de faux visuel : la jointure refuse un numéro qui désigne deux cartes (`image-vers-plusieurs-cartes`).
    svIba: { ids: [512], noms: ['Battle Academy'], note: 'Cardmarket « Scarlet Violet Battle Academy » ; 3/3 : 001 Celebi, 050 Potion, 061 Nemona' },
    '20th': { ids: [529], noms: ['Starter Pack'], note: 'Cardmarket « BREAK Starter Pack » ; 3/3 : 001 Venusaur-EX, 043 Persian, 068 Lysandre' },
    XYe: { ids: [310], noms: ['Tournament Starter Set 30 Emboar EX vs Togekiss EX'], note: '3/3 : 001 Growlithe, 017 Great Ball, 021 Tierno' },
    MG: { ids: [278], noms: ['30-Card Battle Deck Set Mewtwo VS Genesect'], note: '3/3 : 001 Tangela, 009 Crushing Hammer, 016 Double Colorless Energy ; moitiés à numéros partagés, refusées par la jointure' },
    advG: { ids: [81], noms: ['Team Aqua Deck W'], note: 'Cardmarket « Aqua Deck Kit » ; 3/3 : 001 Team Aqua\'s Carvanha, 017 Team Aqua\'s Electrike, 033 Aqua Energy' },
    advF: { ids: [80], noms: ['Team Magma Deck W'], note: 'Cardmarket « Magma Deck Kit » ; 3/3 : 001 Entei ex, 017 Team Magma\'s Aggron, 033 Magma Energy' },
    smD: { ids: [336], noms: ['30 Card Deck Match Set: Ash vs Team Rocket'], note: '3/3 : 001 Rowlet, 017 Stufful, 024 Poké Ball' },
    smK: { ids: [374], noms: ['Trainer Battle Deck - Brock of Pewter City Gym & Misty of Cerulean City Gym'], note: 'Cardmarket « Trainer Battle Decks » ; 3/3 : 001 Psyduck, 017 Nest Ball, 031 Double Colorless Energy' },
    smM: { ids: [385], noms: ['Starter Set Tag Team GX, Darkrai & Umbreon GX /  Espeon & Deoxys GX'], note: 'Cardmarket « Tag Team GX Starter Sets » ; 3/3 : 001 Espeon & Deoxys-GX, 017 Ultra Ball, 031 Double Colorless Energy' },
    sB: { ids: [401], noms: ['Premium Trainer Box (2019)'], note: 'Cardmarket « Premium Trainer Box Sword Shield » ; 3/3 : 001 Energy Retrieval, 017 Metal Frying Pan, 024 Triple Acceleration Energy' },
    smB: { ids: [327], noms: ['Premium Trainer Box (2016)'], note: 'Cardmarket « Premium Trainer Box » ; 3/3 : 001 Nest Ball, 014 Lysandre, 018 Mystery Energy' },
    MDB: { ids: [262], noms: ['Master Deck Build Box'], note: 'Cardmarket « Master Deck Build Box EX » ; 3/3 : 001 Victini, 026 Tornadus, 041 N' },
    PPB: { ids: [113], noms: ['PokéPark Premium File - Blue Version'], note: 'Cardmarket « PokePark Blue » ; 3/3 : 001 Entei, 005 Raikou, 009 Rayquaza' },
    pcgD: { ids: [97], noms: ['Team Rocket Constructed Half Deck W -black-'], note: 'Cardmarket « Black Deck Kit » ; 3/3 : 001 Spinarak, 011 Dark Tyranitar, 020 R Energy' },
    pcgE: { ids: [99], noms: ['Team Rocket Constructed Half Deck W -silver-'], note: 'Cardmarket « Silver Deck Kit » ; 3/3 : 001 Psyduck, 011 Dark Dragonair, 020 R Energy' }
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
