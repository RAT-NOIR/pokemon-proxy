// ============================================================
// LA TABLE SET → idExpansion, ÉCRITE À LA MAIN
// ============================================================
// La liaison automatique a été mesurée : 2 appariements sur 177, les deux faux. Chaque ligne est
// donc écrite à la main et VÉRIFIÉE par un compte avant d'être admise — `verifie: true` n'est posé
// qu'après un relevé réel (liens de la page du set, comptés contre `attendu`). Le collecteur REFUSE
// une ligne non vérifiée : on ne collecte pas sur une hypothèse.
//
// Colonnes :
//   code, exp, prod       — les nôtres, recopiés de sets-vintage-japonais.js (source de vérité)
//   bulba.titre           — la page du SET sur Bulbapedia
//   bulba.expansion       — le nom que les pages de cartes donnent en `jpexpansion=` (nomDePage)
//   bulba.motifTitres     — regex des TITRES DE CARTES liés par la Setlist (avant redirection)
//   attendu               — nombre de pages de cartes attendu = `jacards` de l'infobox
//   verifie               — relevé fait, date, résultat
//
// Relevé du 2026-09-12 sur api.php (prop=links) : EXP 102 titres « (Base Set n) », PJU 64 titres
// « (Jungle n) » → 48 pages après redirections, MFO 62 → 47 pages pour 48 attendues (un reste).

const { SETS_VINTAGE_JAPONAIS } = require('../sets-vintage-japonais');

const parCode = Object.fromEntries(SETS_VINTAGE_JAPONAIS.map(s => [s.code, s]));

const TABLE = [
    { code: 'EXP', bulba: { titre: 'Expansion Pack (TCG)', expansion: 'Expansion Pack', motifTitres: '\\(Base Set \\d+\\)$' }, attendu: 102, verifie: { le: '2026-09-12', liens: 102, pages: 102 } },
    { code: 'PJU', bulba: { titre: 'Pokémon Jungle (TCG)', expansion: 'Pokémon Jungle', motifTitres: '\\(Jungle \\d+\\)$' }, attendu: 48, verifie: { le: '2026-09-12', liens: 64, pages: 48 } },
    { code: 'MFO', bulba: { titre: 'Mystery of the Fossils (TCG)', expansion: 'Mystery of the Fossils', motifTitres: '\\(Fossil \\d+\\)$' }, attendu: 48, verifie: { le: '2026-09-12', liens: 62, pages: 47, note: '47 pages pour 48 attendues : un reste à nommer' } },
    // ---- NON VÉRIFIÉES : titres et motifs supposés, le collecteur les refuse tant que `verifie` est null ----
    { code: 'ROG', bulba: { titre: 'Rocket Gang (TCG)', expansion: 'Rocket Gang', motifTitres: '\\(Team Rocket \\d+\\)$' }, attendu: 65, verifie: null },
    { code: 'G1', bulba: { titre: "Leaders' Stadium (TCG)", expansion: "Leaders' Stadium", motifTitres: '\\(Gym Heroes \\d+\\)$' }, attendu: 96, verifie: null },
    { code: 'G2', bulba: { titre: 'Challenge from the Darkness (TCG)', expansion: 'Challenge from the Darkness', motifTitres: '\\(Gym Challenge \\d+\\)$' }, attendu: 98, verifie: null },
    { code: 'SI-JP', bulba: { titre: 'Southern Islands (TCG)', expansion: 'Southern Islands', motifTitres: '\\(Southern Islands \\d+\\)$' }, attendu: 18, verifie: null },
    { code: 'N1', bulba: { titre: 'Gold, Silver, to a New World... (TCG)', expansion: 'Gold, Silver, to a New World...', motifTitres: '\\(Neo Genesis \\d+\\)$' }, attendu: 96, verifie: null },
    { code: 'N2', bulba: { titre: 'Crossing the Ruins... (TCG)', expansion: 'Crossing the Ruins...', motifTitres: '\\(Neo Discovery \\d+\\)$' }, attendu: 57, verifie: null },
    { code: 'N3', bulba: { titre: 'Awakening Legends (TCG)', expansion: 'Awakening Legends', motifTitres: '\\(Neo Revelation \\d+\\)$' }, attendu: 57, verifie: null },
    { code: 'N4', bulba: { titre: 'Darkness, and to Light... (TCG)', expansion: 'Darkness, and to Light...', motifTitres: '\\(Neo Destiny \\d+\\)$' }, attendu: 113, verifie: null },
    { code: 'VS', bulba: { titre: 'Pokémon VS (TCG)', expansion: 'Pokémon VS', motifTitres: '\\(VS \\d+\\)$' }, attendu: 151, verifie: null },
    { code: 'WEB', bulba: { titre: 'Pokémon Web (TCG)', expansion: 'Pokémon Web', motifTitres: '\\(Web \\d+\\)$' }, attendu: 48, verifie: null },
    { code: 'EC1', bulba: { titre: 'Base Expansion Pack (TCG)', expansion: 'Base Expansion Pack', motifTitres: '\\(Expedition \\d+\\)$' }, attendu: 128, verifie: null },
    { code: 'EC2', bulba: { titre: 'The Town on No Map (TCG)', expansion: 'The Town on No Map', motifTitres: '\\(Aquapolis \\d+\\)$' }, attendu: 92, verifie: null },
    { code: 'EC3', bulba: { titre: 'Wind from the Sea (TCG)', expansion: 'Wind from the Sea', motifTitres: '\\(Aquapolis \\d+\\)$' }, attendu: 87, verifie: null },
    { code: 'EC4', bulba: { titre: 'Split Earth (TCG)', expansion: 'Split Earth', motifTitres: '\\(Skyridge \\d+\\)$' }, attendu: 88, verifie: null },
    { code: 'EC5', bulba: { titre: 'Mysterious Mountains (TCG)', expansion: 'Mysterious Mountains', motifTitres: '\\(Skyridge \\d+\\)$' }, attendu: 88, verifie: null },
    { code: 'ADV2', bulba: { titre: 'Miracle of the Desert (TCG)', expansion: 'Miracle of the Desert', motifTitres: '\\(EX Sandstorm \\d+\\)$' }, attendu: 53, verifie: null },
    { code: 'ADV3', bulba: { titre: 'Rulers of the Heavens (TCG)', expansion: 'Rulers of the Heavens', motifTitres: '\\(EX Dragon \\d+\\)$' }, attendu: 54, verifie: null },
    { code: 'ADVex1', bulba: { titre: 'Magma VS Aqua: Two Ambitions (TCG)', expansion: 'Magma VS Aqua: Two Ambitions', motifTitres: '\\(EX Team Magma vs Team Aqua \\d+\\)$' }, attendu: 80, verifie: null },
    { code: 'IPB', bulba: { titre: 'Intro Pack (TCG)', expansion: 'Intro Pack', motifTitres: '\\(Base Set \\d+\\)$' }, attendu: 41, verifie: null },
    { code: 'MCDP', bulba: { titre: "McDonald's Pokémon-e Minimum Pack (TCG)", expansion: "McDonald's Pokémon-e Minimum Pack", motifTitres: '\\(McDonald\'s Pokémon-e Minimum Pack \\d+\\)$' }, attendu: 24, verifie: null },
    { code: 'DP5c', bulba: { titre: 'Cry from the Mysterious (TCG)', expansion: 'Cry from the Mysterious', motifTitres: '\\(Legends Awakened \\d+\\)$' }, attendu: 65, verifie: null },
    { code: 'PCG6', bulba: { titre: 'Holon Research Tower (TCG)', expansion: 'Holon Research Tower', motifTitres: '\\(EX Delta Species \\d+\\)$' }, attendu: 86, verifie: null },
    { code: 'PCG9', bulba: { titre: 'Offense and Defense of the Furthest Ends (TCG)', expansion: 'Offense and Defense of the Furthest Ends', motifTitres: '\\(EX Crystal Guardians \\d+\\)$' }, attendu: 68, verifie: null },
    { code: 'DP2', bulba: { titre: 'Secret of the Lakes (TCG)', expansion: 'Secret of the Lakes', motifTitres: '\\(Mysterious Treasures \\d+\\)$' }, attendu: 123, verifie: null },
    { code: 'EXS', bulba: { titre: 'Expansion Sheet (TCG)', expansion: 'Expansion Sheet', motifTitres: '\\(Vending S\\d \\d+\\)$' }, attendu: 125, verifie: null }
].map(l => {
    const s = parCode[l.code];
    if (!s) throw new Error(`table-sets : code ${l.code} absent de sets-vintage-japonais.js`);
    return { ...l, exp: s.exp, prod: s.prod, nom: s.nom, slugSet: s.slug };
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
