// ============================================================
// LA TABLE CLOSE DES SETS JAPONAIS VINTAGE (1996-2003)
// ============================================================
// ⚠️ ÉCRITE À LA MAIN, ET C'EST LE SEUL GESTE CORRECT. La liaison automatique a été
// tentée et mesurée : les 177 sets de /v2/ja/sets contre nos slugs donnent 2 appariements
// sur 177 (1,1 %), et LES DEUX SONT FAUX. La raison est structurelle — TCGdex nomme ses
// sets japonais en japonais (« 裂けた大地 »), nos slugs Cardmarket sont anglais
// (« Split-Earth »). Les deux côtés ne partagent aucune langue. Vingt lignes vérifiées
// valent mieux que cent soixante-dix-sept devinées.
//
// POURQUOI CETTE TABLE EXISTE. Mesuré : 69 identifiants TCGdex sont partagés par
// plusieurs expansions Cardmarket, et le motif est systématique — chaque set japonais
// partage son identifiant avec son jumeau occidental :
//   neo4 -> N4 [jap] + NDE [occ]        gym1 -> G1 [jap] + GH [occ]
//   base5 -> ROG [jap] + TR [occ]       ecard3 -> EC4 [jap] + EC5 [jap] + SK [occ]
// Le pont japonais n'est pas incomplet : il est FAUX PAR CONSTRUCTION sur toute la
// période vintage. Le Rhydon rendu « m3 » (set de 2025) était le premier symptôme visible,
// pas une exception.
//
// RÈGLE D'ADMISSION, SANS EXCEPTION. Une ligne n'entre que si :
//   1. son `slugSet` existe EXACTEMENT dans numeros_cartes ;
//   2. il ne désigne qu'UNE expansion ;
//   3. la région lue dans codes_set est « japonais » — pas inconnue, pas occidentale.
// Tout le reste part dans SETS_NON_PROUVES, en bas de ce fichier. Le plausible-et-faux
// est le mode d'échec de ce projet depuis le début ; une table de 23 lignes sûres vaut
// mieux qu'une de 27 dont 4 sont vraisemblables.
//
// SOURCES, une par colonne :
//   nom + année : pokesymbols.com/tcg/japanese-sets (liste datée, noms anglais canoniques)
//   slug + expansion + nb de produits : notre base, vérifiés un par un
//   région + sa provenance : codes_set.region / codes_set.regionSource
//
// ⚠️ CE FICHIER NE PILOTE PAS ENCORE L'IDENTIFICATION. Il ne sert, pour l'instant, qu'à la
// règle d'ambiguïté des identifiants partagés. Le périmètre fermé viendra APRÈS validation
// ligne à ligne.

const SETS_VINTAGE_JAPONAIS = [
    // nom anglais canonique          année  slugSet                            exp    code     prod  source de la région
    { nom: 'Expansion Pack', annee: 1996, slug: 'Expansion-Pack', exp: 4169, code: 'EXP', prod: 102, regionSource: 'liste-verifiee' },
    { nom: 'Pokémon Jungle', annee: 1997, slug: 'Pokemon-Jungle', exp: 4463, code: 'PJU', prod: 48, regionSource: 'place-internationale-prise-par-JU' },
    { nom: 'Mystery of the Fossils', annee: 1997, slug: 'Mystery-of-the-Fossils', exp: 4464, code: 'MFO', prod: 48, regionSource: 'place-internationale-prise-par-FO' },
    { nom: 'Rocket Gang', annee: 1997, slug: 'Rocket-Gang', exp: 4465, code: 'ROG', prod: 65, regionSource: 'place-internationale-prise-par-TR' },
    { nom: "Leaders' Stadium", annee: 1998, slug: 'Leaders-Stadium', exp: 4466, code: 'G1', prod: 96, regionSource: 'place-internationale-prise-par-GH' },
    { nom: 'Challenge from the Darkness', annee: 1999, slug: 'Challenge-from-the-Darkness', exp: 4467, code: 'G2', prod: 98, regionSource: 'place-internationale-prise-par-GC' },
    { nom: 'Southern Islands', annee: 1999, slug: 'Southern-Islands-JP', exp: 4357, code: 'SI-JP', prod: 18, regionSource: 'code-suffixe-JP' },
    { nom: 'Gold, Silver, to a New World...', annee: 2000, slug: 'Gold-Silver-to-a-New-World', exp: null, code: 'N1', prod: null, regionSource: 'derive' },
    { nom: 'Crossing the Ruins...', annee: 2000, slug: 'Crossing-the-Ruins', exp: null, code: 'N2', prod: null, regionSource: 'derive' },
    { nom: 'Awakening Legends', annee: 2000, slug: 'Awakening-Legends', exp: null, code: 'N3', prod: null, regionSource: 'derive' },
    { nom: 'Darkness, and to Light...', annee: 2001, slug: 'Darkness-and-to-Light', exp: 4509, code: 'N4', prod: 113, regionSource: 'place-internationale-prise-par-NDE' },
    { nom: 'Pokémon VS', annee: 2001, slug: 'Pokemon-CardVS', exp: 4168, code: 'VS', prod: 151, regionSource: 'liste-verifiee' },
    { nom: 'Pokémon Card web', annee: 2001, slug: 'Pokemon-Cardweb', exp: 4355, code: 'WEB', prod: 48, regionSource: 'liste-verifiee' },
    { nom: 'Base Expansion Pack', annee: 2001, slug: 'Base-Expansion-Pack', exp: 5021, code: 'EC1', prod: 157, regionSource: 'liste-verifiee' },
    { nom: 'The Town on No Map', annee: 2002, slug: 'The-Town-on-No-Map', exp: 5022, code: 'EC2', prod: 92, regionSource: 'liste-verifiee' },
    { nom: 'Wind from the Sea', annee: 2002, slug: 'Wind-from-the-Sea', exp: 5023, code: 'EC3', prod: 90, regionSource: 'liste-verifiee' },
    { nom: 'Split Earth', annee: 2002, slug: 'Split-Earth', exp: 5024, code: 'EC4', prod: 91, regionSource: 'liste-verifiee' },
    { nom: 'Mysterious Mountains', annee: 2002, slug: 'Mysterious-Mountains', exp: 5025, code: 'EC5', prod: 91, regionSource: 'liste-verifiee' },
    { nom: 'Miracle of the Desert', annee: 2003, slug: 'Miracle-of-the-Desert', exp: null, code: 'ADV2', prod: null, regionSource: 'derive' },
    { nom: 'Rulers of the Heavens', annee: 2003, slug: 'Rulers-of-the-Heavens', exp: null, code: 'ADV3', prod: null, regionSource: 'derive' },
    { nom: 'Magma VS Aqua: Two Ambitions', annee: 2003, slug: 'Magma-VS-Aqua-Two-Ambitions', exp: null, code: 'ADVex1', prod: null, regionSource: 'derive' },
    // Hors de la liste pokesymbols mais exigés par le banc : promo et sets dérivés japonais
    // dont la région est établie et le slug unique.
    { nom: "McDonald's Original Minimum Pack", annee: 2002, slug: 'McDonalds-Original-Minimum-Pack', exp: 4178, code: 'MCDP', prod: 24, regionSource: 'liste-verifiee' },
    { nom: 'Cry from the Mysterious', annee: 2007, slug: 'Cry-from-the-Mysterious', exp: 4305, code: 'DP5c', prod: 65, regionSource: 'code-minuscule' }
];

// ============================================================
// LES NON PROUVÉES — elles n'entrent pas, et on dit pourquoi
// ============================================================
// Aucune de ces lignes ne doit être ajoutée sans une preuve NOUVELLE. Les recopier telles
// quelles dans la table ci-dessus reviendrait à faire exactement ce que la règle
// d'admission interdit.
const SETS_NON_PROUVES = [
    {
        nom: 'Intro Pack Bulbasaur', slug: 'Intro-Pack-Bulbasaur', exp: 5059, code: 'IPB', prod: 41,
        // La région lue en base est INCONNUE (regionSource: 'nom-hors-catalogue') : le nom
        // de l'expansion n'existe pas au catalogue international, donc la dérivation ne
        // peut rien conclure. Et pokesymbols ne le liste pas non plus — c'est un deck de
        // démarrage, pas un set principal.
        preuveManquante: 'région INCONNUE en base, et absent de la liste pokesymbols',
        // ⚠️ CE REFUS A UN COÛT CONNU ET CHIFFRÉ : le Raichu du testeur est
        // Intro-Pack-Bulbasaur/Raichu-IPB3. Sans cette ligne, cette carte n'a pas de
        // périmètre. Le refus est assumé tant que la région n'est pas établie.
        cout: 'le Raichu (Raichu-IPB3) reste sans périmètre'
    },
    {
        nom: 'ADV Expansion Pack', slug: null, code: 'ADV1', prod: null,
        // La correspondance de nom tombe sur « Expansion-Pack » (EXP, 1996) : un homonyme
        // à seize ans d'écart. C'est le piège exact du contre-test.
        preuveManquante: 'aucun slug distinct trouvé ; le nom tombe sur l\'homonyme de 1996'
    },
    {
        nom: 'Expansion Sheet (Vending Machine, séries 1 à 3)', slug: 'Expansion-Sheet', code: 'EXS', prod: null,
        // pokesymbols en liste TROIS (bleue 1998, rouge 1998, verte 1998), la base n'a
        // qu'un slug. On ne sait pas lequel des trois il désigne, ni s'il les fusionne.
        preuveManquante: 'trois séries chez pokesymbols, un seul slug en base'
    },
    {
        nom: 'Gym Booster 1 (Grass Deck) et 2 (Psychic Deck)', slug: null, code: null, prod: null,
        // IMPASSE CONNUE, et c'est une information utile : aucune expansion cible
        // n'existe. Une carte de ces sets doit se refuser PROPREMENT — surtout pas
        // retomber sur une recherche dans le catalogue entier, qui rendrait un homonyme
        // occidental avec l'assurance d'une réponse.
        preuveManquante: 'aucun slug en base — IMPASSE CONNUE, refus propre attendu'
    }
];

// Index par expansion, pour les tests d'appartenance. Seules les lignes dont l'expansion
// est VÉRIFIÉE y figurent : une ligne à `exp: null` est prouvée comme set mais son
// expansion reste à relever, elle ne peut donc pas servir de périmètre.
const EXPANSIONS_VINTAGE = new Set(SETS_VINTAGE_JAPONAIS.filter(s => s.exp != null).map(s => s.exp));
const CODES_VINTAGE = new Set(SETS_VINTAGE_JAPONAIS.map(s => s.code));

module.exports = {
    SETS_VINTAGE_JAPONAIS, SETS_NON_PROUVES,
    EXPANSIONS_VINTAGE, CODES_VINTAGE
};
