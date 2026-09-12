// ============================================================
// LA TABLE SET → idExpansion, ÉCRITE À LA MAIN
// ============================================================
// La liaison automatique a été mesurée : 2 appariements sur 177, les deux faux. Chaque ligne est
// donc écrite à la main et VÉRIFIÉE par un relevé avant d'être admise ; le collecteur REFUSE une
// ligne non vérifiée. On ne collecte pas sur une hypothèse.
//
// CE QUE LE RELEVÉ DU 2026-09-12 A ÉTABLI (verifier-table.js, 3 requêtes par set, 80 requêtes) :
//   · Bulbapedia FUSIONNE un set japonais et son jumeau occidental sur UNE page : « Mystery of the
//     Fossils (TCG) » redirige vers « Fossil (TCG) », « Leaders' Stadium (TCG) » vers « Gym Heroes
//     (TCG) », et une page occidentale peut porter DEUX sets japonais (Aquapolis = The Town on No
//     Map + Wind from the Sea ; Skyridge = Split Earth + Mysterious Mountains ; Legends Awakened =
//     Cry from the Mysterious + Temple of Wrath). Le titre de la page ne suffit donc jamais.
//   · L'APPARTENANCE se lit dans la SETLIST de la page : une section `Setlist/…header|title=X` par
//     set, dont les entrées `{{TCG ID|A|Nom|B}}` donnent le titre `Nom (A B)`, redirection vers la
//     page de la carte. C'est `bulba.setlist` (titres de sections) qui énumère, et
//     `bulba.expansion` (le nom que `jpexpansion=` donne sur la page de la carte) qui joint.
//   · `jacards` de l'infobox est le compte du DERNIER set japonais de la page quand elle en porte
//     deux (Skyridge dit 91 pour Split Earth 88 + Mysterious Mountains 91) : il s'imprime, il ne
//     décide pas. Le compte des entrées de la section décide.
//
// Colonnes :
//   code, exp, prod, nom, slugSet   — les nôtres, recopiés de sets-vintage-japonais.js
//   bulba.titre                     — la page demandée (la redirection est suivie et journalisée)
//   bulba.setlist                   — titre(s) de section(s) de la Setlist à énumérer (défaut : expansion)
//   bulba.expansion                 — nom(s) `jpexpansion=` sur les pages de cartes (jointure)
//   bulba.deck                      — pour un kit : le deck retenu (IPB = Bulbasaur Deck)
//   attendu                         — produits Cardmarket (notre dénominateur, PAS celui de Bulbapedia)
//   verifie                         — le relevé : date, page résolue, entrées TCG ID vues par nom de set

const { SETS_VINTAGE_JAPONAIS } = require('../sets-vintage-japonais');

const parCode = Object.fromEntries(SETS_VINTAGE_JAPONAIS.map(s => [s.code, s]));
const V = (page, entrees, note) => ({ le: '2026-09-12', page, entrees, ...(note ? { note } : {}) });

const TABLE = [
    { code: 'EXP', bulba: { titre: 'Expansion Pack (TCG)', expansion: 'Expansion Pack' }, attendu: 102, verifie: V('Base Set (TCG)', { 'Expansion Pack': 102 }, 'collecté : 102 = 102 = 102, 102 produits joints, 0 reste') },
    { code: 'PJU', bulba: { titre: 'Pokémon Jungle (TCG)', expansion: 'Pokémon Jungle' }, attendu: 48, verifie: V('Jungle (TCG)', { 'Pokémon Jungle': 48 }) },
    { code: 'MFO', bulba: { titre: 'Mystery of the Fossils (TCG)', expansion: 'Mystery of the Fossils' }, attendu: 48, verifie: V('Fossil (TCG)', { 'Mystery of the Fossils': 48 }, '47 pages « (Fossil n) » pour 48 : la 48e (Mew) n\'a pas de tirage Fossil occidental, la Setlist japonaise la porte') },
    { code: 'ROG', bulba: { titre: 'Rocket Gang (TCG)', expansion: 'Rocket Gang' }, attendu: 65, verifie: V('Team Rocket (TCG)', { 'Rocket Gang': 65 }) },
    { code: 'G1', bulba: { titre: "Leaders' Stadium (TCG)", expansion: "Leaders' Stadium" }, attendu: 96, verifie: V('Gym Heroes (TCG)', { "Leaders' Stadium": 96 }, '84 + 12 titres désambiguïsés « (Leaders\' Stadium 1/2) »') },
    { code: 'G2', bulba: { titre: 'Challenge from the Darkness (TCG)', expansion: 'Challenge from the Darkness' }, attendu: 98, verifie: V('Gym Challenge (TCG)', { 'Challenge from the Darkness': 97 }, '91 + 6 désambiguïsés = 97 pour 98 attendus : un reste à nommer') },
    { code: 'SI-JP', bulba: { titre: 'Southern Islands (TCG)', expansion: 'Southern Islands' }, attendu: 18, verifie: V('Southern Islands (TCG)', { 'Southern Islands': 36 }, 'deux sections (occidentale et japonaise) aux mêmes 18 titres ; infobox sans jacards') },
    { code: 'N1', bulba: { titre: 'Gold, Silver, to a New World... (TCG)', expansion: 'Gold, Silver, to a New World...' }, attendu: 96, verifie: V('Neo Genesis (TCG)', { 'Gold, Silver, to a New World...': 101 }, '101 entrées pour jacards 96 : à lire au collecté') },
    { code: 'N2', bulba: { titre: 'Crossing the Ruins... (TCG)', expansion: 'Crossing the Ruins...' }, attendu: 57, verifie: V('Neo Discovery (TCG)', { 'Crossing the Ruins...': 57 }, '55 + 2 désambiguïsés = 57 ; jacards dit 56') },
    { code: 'N3', bulba: { titre: 'Awakening Legends (TCG)', expansion: 'Awakening Legends' }, attendu: 57, verifie: V('Neo Revelation (TCG)', { 'Awakening Legends': 57 }) },
    { code: 'N4', bulba: { titre: 'Darkness, and to Light... (TCG)', expansion: 'Darkness, and to Light...' }, attendu: 113, verifie: V('Neo Destiny (TCG)', { 'Darkness, and to Light...': 113 }) },
    { code: 'VS', bulba: { titre: 'Pokémon VS (TCG)', setlist: ['Pokémon Card★VS'], expansion: 'Pokémon VS' }, attendu: 151, verifie: V('Pokémon VS (TCG)', { 'VS': 143 }, 'page japonaise seule, section « Pokémon Card★VS » ×142, titres « (VS n) », pour 151 produits') },
    // `titresSupplementaires` : cartes DU set que la Setlist liste sous un titre de promo, hors motif
    // (constaté sur les restes du 2026-09-12). Elles sont fetchées comme les autres, jointes par nom.
    { code: 'WEB', bulba: { titre: 'Pokémon Web (TCG)', expansion: 'Pokémon Web', titresSupplementaires: ['Slowpoke (Promotional Card P11)'] }, attendu: 48, verifie: V('Pokémon Web (TCG)', { 'Pokémon Web': 49 }, '47 entrées de section + Slowpoke n°012 listé comme promo P11 ; Bill P Promo 9 reste hors set') },
    { code: 'EC1', bulba: { titre: 'Base Expansion Pack (TCG)', expansion: 'Base Expansion Pack' }, attendu: 157, verifie: V('Expedition Base Set (TCG)', { 'Base Expansion Pack': 129 }, '129 entrées pour jacards 128 ; Cardmarket a 157 produits (sous-série S de 29 ?)') },
    { code: 'EC2', bulba: { titre: 'The Town on No Map (TCG)', expansion: 'The Town on No Map' }, attendu: 92, verifie: V('Aquapolis (TCG)', { 'The Town on No Map': 92 }) },
    { code: 'EC3', bulba: { titre: 'Wind from the Sea (TCG)', expansion: 'Wind from the Sea' }, attendu: 90, verifie: V('Aquapolis (TCG)', { 'Wind from the Sea': 90 }, 'même page qu\'EC2 ; jacards 92 est celui de The Town on No Map') },
    { code: 'EC4', bulba: { titre: 'Split Earth (TCG)', expansion: 'Split Earth' }, attendu: 91, verifie: V('Skyridge (TCG)', { 'Split Earth': 91 }, 'même page qu\'EC5') },
    { code: 'EC5', bulba: { titre: 'Mysterious Mountains (TCG)', expansion: 'Mysterious Mountains' }, attendu: 91, verifie: V('Skyridge (TCG)', { 'Mysterious Mountains': 91 }) },
    { code: 'ADV2', bulba: { titre: 'Miracle of the Desert (TCG)', expansion: 'Miracle of the Desert' }, attendu: 53, verifie: V('EX Sandstorm (TCG)', { 'Miracle of the Desert': 53 }) },
    { code: 'ADV3', bulba: { titre: 'Rulers of the Heavens (TCG)', expansion: 'Rulers of the Heavens' }, attendu: 54, verifie: V('EX Dragon (TCG)', { 'Rulers of the Heavens': 54 }) },
    { code: 'ADVex1', bulba: { titre: 'Magma VS Aqua: Two Ambitions (TCG)', expansion: 'Magma VS Aqua: Two Ambitions' }, attendu: 80, verifie: V('EX Team Magma vs Team Aqua (TCG)', { 'Magma VS Aqua: Two Ambitions': 80 }) },
    { code: 'IPB', bulba: { titre: 'Intro Pack (TCG)', setlistMotif: '^Bulbasaur Deck( \\d+)?$', expansion: 'Intro Pack', deck: 'Bulbasaur Deck' }, attendu: 41, verifie: V('Intro Pack (TCG)', { 'Bulbasaur Deck': 40, 'Bulbasaur': 2 }, 'kit à deux decks, page SANS gabarit Setlist (entrées TCG ID lues sur tout le wikitext) ; seul le Bulbasaur Deck est notre IPB (41 produits)') },
    { code: 'MCDP', bulba: { titre: "McDonald's Pokémon-e Minimum Pack (TCG)", setlistMotif: '^McDonald Pack( \\d+)?$', expansion: "McDonald's Pokémon-e Minimum Pack" }, attendu: 24, verifie: V("McDonald's Pokémon-e Minimum Pack (TCG)", { 'McDonald Pack': 18 }, "section « McDonald's Original … », entrées « (McDonald Pack n) », 18 pour 24 produits Cardmarket") },
    { code: 'DP5c', bulba: { titre: 'Cry from the Mysterious (TCG)', expansion: 'Cry from the Mysterious' }, attendu: 65, verifie: V('Legends Awakened (TCG)', { 'Cry from the Mysterious': 62 }, 'page à deux sets japonais (+ Temple of Wrath 61) ; 62 entrées pour 65 produits') },
    { code: 'PCG6', bulba: { titre: 'Holon Research Tower (TCG)', expansion: 'Holon Research Tower' }, attendu: 86, verifie: V('EX Delta Species (TCG)', { 'Holon Research Tower': 83 }, '83 entrées pour jacards 86 et 86 produits') },
    { code: 'PCG9', bulba: { titre: 'Offense and Defense of the Furthest Ends (TCG)', expansion: 'Offense and Defense of the Furthest Ends' }, attendu: 68, verifie: V('EX Dragon Frontiers (TCG)', { 'Offense and Defense of the Furthest Ends': 66 }, '66 entrées pour 68') },
    { code: 'DP2', bulba: { titre: 'Secret of the Lakes (TCG)', expansion: 'Secret of the Lakes' }, attendu: 123, verifie: V('Mysterious Treasures (TCG)', { 'Secret of the Lakes': 123 }) },
    { code: 'EXS', bulba: { titre: 'Vending Machine cards (TCG)', setlistMotif: '^Vending S[123]( \\d+)?$', expansion: ['Expansion Sheet 1', 'Expansion Sheet 2', 'Expansion Sheet 3'], titresSupplementaires: ['Snorlax (Wizards Promo 49)'] }, attendu: 125, verifie: V('Vending Machine cards (TCG)', { 'Vending S1/S2/S3': 125 }, 'trois feuilles pour une expansion Cardmarket ; entrées « (Vending S1) » … « (Vending S3 n) », les promos Wizards/CoroCoro de la même page sont exclues par le motif') },
    // ════════════════════════════════════════════════════════════════════════
    // LES DIX OCCIDENTALES — 2026-09-12, relevé fait, `tirage: 'intl'`
    // ════════════════════════════════════════════════════════════════════════
    // Elles portent 35 des 51 lignes que la base ne sert pas (SPEC-PONT §5 : le gisement est
    // occidental). Leur page Bulbapedia a la MÊME structure que les japonaises : une section de
    // Setlist au nom du set, et `expansion=` sur la page de carte qui donne ce nom.
    // ⚠️ ELLES NE SONT PAS DÉRIVÉES DE sets-vintage-japonais.js : elles portent leur `exp`, `prod`,
    // `nom` et `slugSet` en propre. `attendu` reste NOTRE compte de produits Cardmarket ; les
    // sections comptent moins (les secrètes et alternatives sont des produits chez nous, des
    // « Additional cards » ou rien chez eux) — l'écart se lit en restes, comme au japonais.
    // 🔑 DEUX PAGES SONT DÉJÀ ARCHIVÉES : « Team Rocket (TCG) » est la page de ROG, et ASC/xASC
    // partagent la leur. Une page, deux sets : c'est la relation n-n, déjà prévue.
    { code: 'PBL', exp: 6569, prod: 120, nom: 'Pitch Black', slugSet: 'Pitch-Black', region: 'occidental', bulba: { titre: 'Pitch Black (TCG)', tirage: 'intl', setlist: ['Pitch Black'], expansion: 'Pitch Black' }, attendu: 120, verifie: V('Pitch Black (TCG)', { 'Pitch Black': 95, 'Additional Cards': 9 }, 'section 95 pour 120 produits') },
    { code: 'ASC', exp: 6395, prod: 296, nom: 'Ascended Heroes', slugSet: 'Ascended-Heroes', region: 'occidental', bulba: { titre: 'Ascended Heroes (TCG)', tirage: 'intl', setlist: ['Ascended Heroes'], expansion: 'Ascended Heroes' }, attendu: 296, verifie: V('Ascended Heroes (TCG)', { 'Ascended Heroes': 225, 'Additional Cards': 11 }, 'partage sa page avec xASC') },
    { code: 'xASC', exp: 6455, prod: 296, nom: 'Ascended Heroes Additionals', slugSet: 'Ascended-Heroes-Additionals', region: 'occidental', bulba: { titre: 'Ascended Heroes (TCG)', tirage: 'intl', setlist: ['Additional Cards'], expansion: 'Ascended Heroes' }, attendu: 296, verifie: V('Ascended Heroes (TCG)', { 'Additional Cards': 11 }, 'même page qu\'ASC, section des additionnelles') },
    { code: 'JTG', exp: 6006, prod: 190, nom: 'Journey Together', slugSet: 'Journey-Together', region: 'occidental', bulba: { titre: 'Journey Together (TCG)', tirage: 'intl', setlist: ['Journey Together'], expansion: 'Journey Together' }, attendu: 190, verifie: V('Journey Together (TCG)', { 'Journey Together': 158, 'Additional Cards': 21 }) },
    { code: 'BRS', exp: 4434, prod: 253, nom: 'Brilliant Stars', slugSet: 'Brilliant-Stars', region: 'occidental', bulba: { titre: 'Brilliant Stars (TCG)', tirage: 'intl', setlist: ['Brilliant Stars', 'Trainer Gallery'], expansion: 'Brilliant Stars' }, attendu: 253, verifie: V('Brilliant Stars (TCG)', { 'Brilliant Stars': 136, 'Trainer Gallery': 17 }, 'la Trainer Gallery est une section à part, et ce sont nos produits') },
    { code: 'TR', exp: 1528, prod: 84, nom: 'Team Rocket', slugSet: 'Team-Rocket', region: 'occidental', bulba: { titre: 'Team Rocket (TCG)', tirage: 'intl', setlist: ['Team Rocket'], expansion: 'Team Rocket' }, attendu: 84, verifie: V('Team Rocket (TCG)', { 'Team Rocket': 83 }, 'la page de ROG, déjà archivée sur R2') },
    { code: 'MEW', exp: 5402, prod: 242, nom: '151', slugSet: '151', region: 'occidental', bulba: { titre: '151 (TCG)', tirage: 'intl', setlist: ['151'], expansion: '151' }, attendu: 242, verifie: V('151 (TCG)', { '151': 177, 'Additional Cards': 29 }) },
    { code: 'CRI', exp: 6517, prod: 122, nom: 'Chaos Rising', slugSet: 'Chaos-Rising', region: 'occidental', bulba: { titre: 'Chaos Rising (TCG)', tirage: 'intl', setlist: ['Chaos Rising'], expansion: 'Chaos Rising' }, attendu: 122, verifie: V('Chaos Rising (TCG)', { 'Chaos Rising': 96, 'Additional Cards': 8 }) },
    { code: 'PAL', exp: 5318, prod: 337, nom: 'Paldea Evolved', slugSet: 'Paldea-Evolved', region: 'occidental', bulba: { titre: 'Paldea Evolved (TCG)', tirage: 'intl', setlist: ['Paldea Evolved'], expansion: 'Paldea Evolved' }, attendu: 337, verifie: V('Paldea Evolved (TCG)', { 'Paldea Evolved': 230, 'Additional Cards': 92 }) },
    { code: 'EVO', exp: 1742, prod: 132, nom: 'Evolutions', slugSet: 'Evolutions', region: 'occidental', bulba: { titre: 'Evolutions (TCG)', tirage: 'intl', setlist: ['Evolutions'], expansion: 'Evolutions' }, attendu: 132, verifie: V('Evolutions (TCG)', { 'Evolutions': 90, 'Additional cards': 40 }) }
].map(l => {
    if (l.region === 'occidental') return l;          // elles portent leurs propres colonnes
    const s = parCode[l.code];
    if (!s) throw new Error(`table-sets : code ${l.code} absent de sets-vintage-japonais.js`);
    return { ...l, exp: s.exp, prod: s.prod, nom: s.nom, slugSet: s.slug, region: 'japonais' };
});

// Expansions OCCIDENTALES nommées par les pages des 28 sets (jumelles), pour la jointure `intl` en
// bonus. Vérifiées en base le 2026-09-12 : Base-Set -> 1523 (211 produits, code BS), Base-Set-2 -> 1527.
// Elles ne comptent PAS dans la complétude, qui ne porte que sur le set cible.
const EXPANSIONS_INTL = {
    'Base Set': 1523,
    'Base Set 2': 1527
};

function ligne(code) {
    return TABLE.find(l => l.code === code) || null;
}

module.exports = { TABLE, EXPANSIONS_INTL, ligne };
