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
    pcgE: { ids: [99], noms: ['Team Rocket Constructed Half Deck W -silver-'], note: 'Cardmarket « Silver Deck Kit » ; 3/3 : 001 Psyduck, 011 Dark Dragonair, 020 R Energy' },
    // 2026-10-05 (nuit), prouver-sources-artofpkm.js : trois pages DISTINCTES, même critère. Refusées la même nuit : LED → 206 (le set
    // porte les DEUX decks du kit en sous-sections, la ligne un seul : n°008 « Dual Ball » du deck Metagross est chez nous Good Rod du
    // deck Leafeon) et HXY → 223 (n°038 : trois cartes « Poké Ball » chez nous, le numéro ne désigne pas UNE carte).
    svC: { ids: [483], noms: ['Scarlet & Violet Starter set ex Pikachu ex & Pawmot'], note: 'Cardmarket « ex Starter Set Pikachu ex Pawmot » ; 3/3 : 001 Pikachu ex, 010 Lechonk, 017 Pokémon Catcher' },
    // 2026-10-13 (lot JA) : six sets japonais jamais rattachés à une liste artofpkm (INV-JP : les 70 sets de artofpkm-sets.json sans ligne, dont la liste n'avait jamais été lue).
    // Preuve de chaque ligne : la liste lue (INV-JP, 2026-10-12), des PAGES de carte lues le 2026-10-13 sous le verrou global (client de production), la LARGEUR de l'original d'une
    // entrée, puis `joindreImages` de production rejoué en simulation sur les noms et numéros (couverture\S3\JA\) — 0 contredite, 0 clé partagée, produits servis gagnés par la règle du site importée.
    // ⚠️ Le numéro imprimé des entrées dont la page n'a pas été lue est MODÉLISÉ (rang de la liste, sauf les « Basic … Energy », sans numéro) : le gain est une prévision. La largeur n'est lue que
    // sur l'entrée 1 de chaque liste (le worker mesure les trois premières et décide, médiane, seuil 350 inchangé).
    'sm1+': { gardeSansNumero: true, ids: [332], noms: ['Sun & Moon'], note: 'Cardmarket « Strength Expansion Pack Sun & Moon » ; 3 pages lues 2026-10-13 : 001/051 Rowlet, 037/051 Alolan Raticate, 065/051 Drampa-GX (numéro imprimé = rang de la liste, numéro ET nom) ; entrée 1 : 748 px ; clé numéro ET nom, 67 jointes par le numéro prévues (numéros hors des pages lues MODÉLISÉS) ; ⚠️ Basic Grass Energy a DEUX images sans numéro (68, 69) : jointe par le nom, la dernière lue gagne = non prouvée' },
    'sm2+': { gardeSansNumero: true, ids: [335], noms: ['Beyond A New Challenge'], note: 'Cardmarket « Facing a New Trial » ; 3 pages lues 2026-10-13 : 001/049 Bellsprout, 036/049 Honchkrow, 065/049 Multi Switch (numéro imprimé = rang, numéro ET nom) ; entrée 1 : 748 px ; clé numéro ET nom, 65 jointes par le numéro prévues (numéros hors des pages lues MODÉLISÉS) ; ⚠️ Basic Darkness Energy a DEUX images sans numéro (66, 67) : jointe par le nom, la dernière lue gagne = non prouvée' },
    ADV1: { gardeSansNumero: true, ids: [65], noms: ['ADV Expansion Pack 1'], note: 'Cardmarket « ADV Expansion Pack » ; 3 pages lues 2026-10-13 : 001/055 Koffing, 028/055 Kirlia, 055/055 Oran Berry (numéro imprimé = rang, numéro ET nom) ; entrée 1 : 593 px ; clé numéro ET nom, 55 jointes prévues (liste 55 entrées = 55 produits ; numéros hors des pages lues MODÉLISÉS)' },
    MCRP: { gardeSansNumero: true, ids: [200], noms: ['2009 Movie Commemoration Random Pack'], note: 'Cardmarket « Movie Commemoration Random Pack » ; 2 pages lues 2026-10-13 : 001/022 Chikorita M, 022/022 Arceus (numéro imprimé = rang, numéro ET nom) ; entrée 1 : 500 px ; clé numéro ET nom, 22 jointes prévues (numéros hors des pages lues MODÉLISÉS ; les 8 énergies de base de la liste n\'ont pas de carte chez nous) ; passait « PROBABLE » dans sources-sets-en-attente.json' },
    MEDK: { gardeSansNumero: true, ids: [165], noms: ['Battle Starter Pack Magmortar vs Electivire'], note: 'Cardmarket « Magmortar vs Electivire Deck Kit » ; 2 pages lues 2026-10-13 (1 Electabuzz, 28 Professor Oak\'s Visit) : AUCUN numéro imprimé, ni chez la source ni dans nos impressions (ligne « nom seul ») ; entrée 1 : 500 px ; clé = le NOM, jointure par le nom seul que le collecteur fait déjà (preuve « nom ») : 24 noms uniques des deux côtés, 24 jointes prévues, 0 ambiguë (INV-JP : nom unique bidirectionnel 24/28)' },
    CGH: { gardeSansNumero: true, ids: [13], noms: ['Celadon City Gym–Misty'], note: 'Cardmarket « Hanada City Gym » (les dresseurs « Misty\'s … » ; le libellé artofpkm dit « Celadon City Gym–Misty ») ; 1 page lue 2026-10-13 (1 Misty\'s Staryu) : AUCUN numéro imprimé ; entrée 1 : 593 px ; clé = le NOM, jointure par le nom seul que le collecteur fait déjà : 18 jointes prévues sur 18 produits, 0 ambiguë ; ⚠️ une seule page lue, la plus faible des six preuves' },
    // 2026-10-13 (lot JA-2) : neuf lignes de plus parmi les sets japonais sans liste (INV-JP, §63). Preuve : listes lues le 2026-10-13 (12, 15, 16, 22, 173, 106, 107 ; 21, 103-105, 108 et 42 relues d'INV-JP du 2026-10-12),
    // PAGES de carte lues le 2026-10-13 sous le verrou global (client de production), largeurs sondées, puis `joindreImages` de production rejoué en simulation — 0 contredite, produits servis par la règle du site importée.
    // ⚠️ Les noms des entrées non lues sont ceux de la LISTE (titre), pas ceux d'une page ; les largeurs ne sont lues que sur 1 à 3 entrées par liste (le worker mesure les trois premières et décide, médiane, seuil 350 inchangé).
    // Aucune ne déclare `gardeSansNumero` : rejouée avec la parade, 0 image refusée (elle ne sert que là où une carte porte ≥ 2 numéros).
    // Les cinq Gyms japonais : un set de dresseur par ville (Cardmarket « Nivi/Kuchiba/Tamamushi/Yamabuki/Guren »), artofpkm les nomme par la ville anglaise ET le dresseur (§30 : « Pewter City Gym–Brock » est Nivi, « Saffron City Gym–Sabrina » est Yamabuki ;
    // la liste 13 « Celadon City Gym–Misty » est Hanada, déjà déclarée au lot JA). Aucun numéro imprimé sauf la liste 16 (003/028…), et nos impressions n'en ont pas : clé = le NOM, que le collecteur fait déjà.
    CGN: { ids: [12], noms: ['Pewter City Gym–Brock'], note: 'Cardmarket « Nivi City Gym » (les dresseurs « Brock\'s … ») ; liste 12 lue 2026-10-13 (25 entrées, 1 requête) ; 2 pages lues 2026-10-13 (12/5 Brock\'s Graveler, 12/14 Brock) : AUCUN numéro imprimé, ni chez la source ni dans nos impressions ; entrée 5 : 593 px ; clé = le NOM (jointure par le nom seul que le collecteur fait déjà) : 21 jointes prévues sur 21 produits, 0 ambiguë ; 4 entrées sans carte chez nous (Brock\'s Onix ×2, Brock\'s Geodude ×2)' },
    CGK: { ids: [15], noms: ['Vermillion City Gym–Lt. Surge'], note: 'Cardmarket « Kuchiba City Gym » (les dresseurs « Lt. Surge\'s … ») ; liste 15 lue 2026-10-13 (25 entrées, 1 requête) ; 2 pages lues 2026-10-13 (15/3 Lt. Surge\'s Raichu, 15/14 Lt. Surge) : AUCUN numéro imprimé ; les trois premières largeurs lues : 593, 593 et 322 px (médiane 593, set admis) ; ⚠️ l\'entrée 3 (Raichu) ne fait que 322 px < 350 : écartée à son téléchargement, comptée, non servie (Lt. Surge\'s Raichu reste sans visuel) ; clé = le NOM : 12 jointes prévues sur 13 produits, 0 ambiguë ; 12 entrées sans carte chez nous' },
    CGT: { ids: [16], noms: ['Celedon City Gym–Erika'], note: 'Cardmarket « Tamamushi City Gym » (les dresseurs « Erika\'s … ») ; liste 16 lue 2026-10-13 (28 entrées, 1 requête) ; 2 pages lues 2026-10-13 (16/3 003/028 Erika\'s Gloom, 16/14 016/028 Erika) : numéro imprimé SUR 28 (≠ le rang : l\'entrée 14 porte 016), mais nos impressions n\'ont AUCUN numéro (fiches sans numéro) ; entrée 3 : 593 px ; clé = le NOM : 18 jointes prévues sur 18 produits, 0 ambiguë ; les numéros des entrées non lues sont MODÉLISÉS (rang), sans effet sur la jointure ni sur la fiche' },
    CGY: { ids: [21], noms: ['Saffron City Gym–Sabrina'], note: 'Cardmarket « Yamabuki City Gym » (les dresseurs « Sabrina\'s … ») ; liste 21 lue 2026-10-12 (INV-JP, 26 entrées) ; 2 pages lues 2026-10-13 (21/3 Sabrina\'s Kadabra, 21/14 Sabrina) : AUCUN numéro imprimé ; entrée 3 : 593 px ; clé = le NOM : 15 jointes prévues sur 15 produits, 0 ambiguë ; 11 entrées sans carte chez nous ; ligne PRÊTE depuis le lot JA (sources-sets-en-attente.json), prouvée ici' },
    GTG: { ids: [22], noms: ['Cinnabar City Gym–Blaine'], note: 'Cardmarket « Guren Town Gym » (les dresseurs « Blaine\'s … ») ; liste 22 lue 2026-10-13 (25 entrées, 1 requête) ; 2 pages lues 2026-10-13 (22/3 Blaine\'s Arcanine, 22/14 Blaine) : AUCUN numéro imprimé ; entrée 3 : 593 px ; clé = le NOM : 13 jointes prévues sur 14 produits, 0 ambiguë ; ⚠️ la liste titre l\'entrée 11 « Blane\'s Charmander » (faute de la source) : Blaine\'s Charmander reste sans visuel (un nom variant ne passe pas, jamais deviné)' },
    // HRDK : un Battle Starter Pack (comme MEDK), pas de numéro imprimé. Deux images nommées « Mewtwo » (3 et 15) et deux « Gliscor » (11 et 16) : la 15 et la 16 sont les cartes LV.X (corrections-images.js, lues à l'œil) ;
    // la 3 est une vignette de 162 px, écartée au téléchargement : Mewtwo reste sans visuel (la médiane des trois premières largeurs, 500, 500 et 162, laisse passer le set).
    HRDK: { ids: [173], noms: ['Battle Starter Pack Heatran vs Regigigas'], note: 'Cardmarket « Heatran vs Regigigas Deck Kit » ; liste 173 lue 2026-10-13 (28 entrées, 1 requête) ; 3 pages lues 2026-10-13 (173/1 Shinx, 173/3 Mewtwo, 173/15 Mewtwo) : AUCUN numéro imprimé ; les trois premières largeurs lues : 500, 500 et 162 px (médiane 500, set admis) ; clé = le NOM, avec deux corrections lues à l\'œil (173/15 = Mewtwo LV.X, 173/16 = Gliscor LV.X : la page les nomme sans « LV.X ») ; ⚠️ 173/3 (Mewtwo) ne fait que 162 px : écartée, non servie ; Gliscor (173/11) n\'est pas regardée : c\'est la seule autre image nommée « Gliscor » ; 4 Énergies de base sans carte chez nous' },
    // Quick Construction Packs : SIX listes (une par couleur), chacune numérotée 001-015 sur la carte (« 006/015 »). Nos impressions portent les numéros 001-010 pour les cartes à page, et les 38 « fiches simples »
    // (Énergies, Switch, TV Reporter, Bill's Maintenance : numéros préfixés G011, R008…) restent sans visuel : le numéro de l'image n'a pas le préfixe, et le NOM est porté par plusieurs fiches. Potion (3 packs), Mr. Stone's Project et
    // Professor Cozmo's Discovery (plusieurs packs) : un même numéro, plusieurs images — `numerosPartages` : si leurs fichiers diffèrent, aucune ne désigne la carte (refusées, nommées) ; s'ils sont identiques, la carte est servie.
    pcgG: { ids: [103, 104, 105, 106, 107, 108], numerosPartages: true, noms: ['Quick Construction Pack Grass', 'Quick Construction Pack Fire', 'Quick Construction Pack Water', 'Quick Construction Pack Lightning', 'Quick Construction Pack Psychic', 'Quick Construction Pack Fighting'], note: 'Cardmarket « Quick Construction Packs » (91 produits) ; listes 103-108 (15 entrées chacune ; 103-105 et 108 relues d\'INV-JP du 2026-10-12, 106 et 107 lues 2026-10-13, 1 requête chacune) ; 6 pages lues 2026-10-13 (103/6 006/015 Cacturne ex, 104/6 006/015 Camerupt ex, 105/4 004/015 Milotic, 106/2 002/015 Raichu ex, 107/6 006/015 Dusclops ex, 108/7 007/015 Medicham ex : numéro imprimé = rang, numéro ET nom) ; 6 largeurs lues : 593 px (103/6, 104/6, 105/4, 106/1, 107/1, 108/7) ; clé numéro ET nom, 42 jointes prévues sur 91 produits (les 7 premières cartes de chaque pack, dont Pikachu V1/V2 sur une seule carte) ; ⚠️ 105/4 « Milotic » est la carte Milotic ex (correction lue à l\'œil, 004/015) ; ⚠️ clés partagées (`numerosPartages`) : Potion, Mr. Stone\'s Project, Professor Cozmo\'s Discovery (11 produits) ne sont servis que si leurs fichiers de packs différents sont identiques (la simulation ne les voit pas : sha256 inconnus) ; ⚠️ 38 fiches simples (Énergies, Switch, TV Reporter, Bill\'s Maintenance) restent sans visuel : numéros préfixés chez nous, noms portés par plusieurs fiches ; numéros hors des pages lues MODÉLISÉS (rang)' },
    // Intro Pack Neo : UNE liste (42), 80 entrées, DEUX decks, aucun numéro imprimé (3 pages lues au lot JA : 42/1, 42/41, 42/79). `plageDeRangs` (lot JA-2, collecte-cartes/echantillon-mesure.js) : la ligne ne traite que sa plage, le rang dans le deck
    // tient lieu de numéro, et la jointure exige le NOM en plus. MESURÉ 2026-10-13 sur les 35 produits : le rang dans le deck est EXACTEMENT le numéro Cardmarket, nom compris (Chikorita : rangs 1-30 = numéros 1-30, 20 produits sur 20 ; Totodile : rangs 41-70 = numéros 1-30, 15 produits sur 15).
    IPNC: { ids: [42], plageDeRangs: [1, 40], noms: ['Intro Pack Neo'], note: 'Cardmarket « Intro Pack Neo Chikorita » (deck Chikorita, 20 produits) ; liste 42 lue 2026-10-12 (INV-JP, 80 entrées = deux decks sous UN id) ; 3 pages lues au lot JA 2026-10-13 (42/1, 42/41, 42/79) : aucun numéro imprimé ; entrée 1 : 593 px (les entrées 2 et 3 ne sont pas mesurées) ; plage de rangs 1-40 : le rang dans le deck est le numéro Cardmarket du produit, 20 produits sur 20 (nom compris) ; numéro ET nom (rang+nom) : 20 jointes prévues sur 20 produits, 0 contredite ; 20 autres entrées de la plage sans carte à leur rang chez nous (Énergies de base, side deck 31-40) ; ⚠️ numéros hors des pages lues MODÉLISÉS (rang)' },
    IPNT: { ids: [42], plageDeRangs: [41, 80], noms: ['Intro Pack Neo'], note: 'Cardmarket « Intro Pack Neo Totodile » (deck Totodile, 15 produits) ; liste 42 lue 2026-10-12 (INV-JP) ; 3 pages lues au lot JA 2026-10-13 (42/1, 42/41, 42/79) : aucun numéro imprimé ; plage de rangs 41-80 : le rang − 40 est le numéro Cardmarket du produit, 15 produits sur 15 (nom compris) ; les trois premières largeurs de la plage (rangs 41, 42, 43) ne sont PAS mesurées (593 px lus sur l\'entrée 1 de la liste, l\'autre deck) : le worker mesure et décide ; numéro ET nom (rang+nom) : 15 jointes prévues sur 15 produits, 0 contredite ; 25 entrées de la plage sans carte chez nous ; ⚠️ numéros hors des pages lues MODÉLISÉS (rang)' },
    // 2026-10-12 (lot V8) : les quatre sets sans page créés le matin (T4b). Preuve : la liste lue (étape 1), PAGES de carte (numéro imprimé ET nom, étape 2), puis
    // la jointure de production rejouée en simulation sur les noms et numéros — le numéro ET le nom de l'image désignent la même carte de NOTRE deck.
    // ⚠️ Un kit à deux decks (176, 206) se range en SOUS-SECTIONS (648/649, 642/643) : leurs images ne se joignent que par le numéro ET le nom
    // (sous-section-image.js) — le deck d'en face, ou une énergie que nous nommons autrement, reste un trou nommé, jamais un visuel d'une autre carte.
    MSM: { ids: [140], noms: ["Movie Commemoration VS Pack: Sea's Manaphy"], note: 'Cardmarket « Entry Pack DP » ; 3 pages lues (001/019 Phantom\'s Beedrill, 010/019 Ash\'s Aipom, 019/019 Rainbow Energy), les 16 autres numéros imprimés modélisés (concordance prévue 19/19) ; 3 largeurs lues sur la liste : 593 px' },
    // la liste 176 est lue par DEUX lignes (DHD, GHD) : `setDeBase` sur les deux, sans quoi la seconde cherche ses images sous son propre slug (collecteur-images.js l.386)
    // `sousSection` (V8, tour 1) : la ligne ne mesure, ne joint et ne partage ses clés QUE dans cette sous-section (echantillon-mesure.js, sous-section-image.js, images-cle-partagee.js)
    DHD: { ids: [176], sousSection: 649, noms: ['Battle Starter Pack Giratina vs Dialga'], setDeBase: 'DHD', note: 'Cardmarket « Giratina vs Dialga Deck Kit », sous-section 649 « Dialga Half Deck » ; 2 pages lues (007/014 Dialga, 014/014 Conductive Quarry), le reste modélisé (concordance prévue 13/14) ; 649 : largeurs non mesurées, jugées par le worker ; liste partagée avec GHD' },
    GHD: { ids: [176], sousSection: 648, noms: ['Battle Starter Pack Giratina vs Dialga'], setDeBase: 'DHD', note: 'sous-section 648 « Giratina Half Deck » ; 1 page lue (007/014 Giratina), le reste modélisé (concordance prévue 12/13) ; 3 largeurs lues sur 648 : 500 px ; Warp Point sans carte chez nous ; liste partagée avec DHD' },
    MED: { ids: [206], sousSection: 643, noms: ['Leafeon vs Metagross Expert Deck +Online'], note: 'sous-section 643 « Metagross Deck » ; 3 pages lues (005/014 Metagross sur 643/5 ET 643/6 : deux images, clé partagée = aucune ne le désigne ; 008/014 Dual Ball), le reste modélisé (concordance prévue 13/14) ; 643 : largeurs non mesurées (les 444-500 px lus sont ceux de 642), jugées par le worker' },
    // Classic jp (liste 545, un deck par sous-section). CLF (676) n'a PAS de source : les 3 premières de SA sous-section mesurent 321, 321, 500 px (médiane 321 < 350) — refus certain,
    // dit dans sources-sets-en-attente.json. CLL (677) et CLK (678) : leur sous-section n'a qu'UNE largeur lue chacune (1432 et 428 px) ; le worker mesure les trois siennes et décide.
    CLL: { ids: [545], sousSection: 677, noms: ['Pokémon Card Game Classic'], setDeBase: 'CLL', note: 'Cardmarket « Pokemon Card Game Classic Charizard Ho Oh ex Deck » ; sous-section 677 ; 1 page lue (020/032 Ultra Ball), le reste modélisé ; une seule largeur lue (1432 px) ; liste partagée avec CLK' },
    CLK: { ids: [545], sousSection: 678, noms: ['Pokémon Card Game Classic'], setDeBase: 'CLL', note: 'Cardmarket « Pokemon Card Game Classic Blastoise Suicune ex Deck » ; sous-section 678 ; 1 page lue (010/032 Suicune ex), le reste modélisé ; une seule largeur lue (428 px) ; liste partagée avec CLL' }
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
