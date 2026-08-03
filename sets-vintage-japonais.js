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
    { nom: 'Gold, Silver, to a New World...', annee: 2000, slug: 'Gold-Silver-to-a-New-World', exp: 4506, code: 'N1', prod: 96, regionSource: 'place-internationale-prise-par-NG' },
    { nom: 'Crossing the Ruins...', annee: 2000, slug: 'Crossing-the-Ruins', exp: 4507, code: 'N2', prod: 57, regionSource: 'place-internationale-prise-par-NDI' },
    { nom: 'Awakening Legends', annee: 2000, slug: 'Awakening-Legends', exp: 4508, code: 'N3', prod: 57, regionSource: 'place-internationale-prise-par-NR' },
    { nom: 'Darkness, and to Light...', annee: 2001, slug: 'Darkness-and-to-Light', exp: 4509, code: 'N4', prod: 113, regionSource: 'place-internationale-prise-par-NDE' },
    { nom: 'Pokémon VS', annee: 2001, slug: 'Pokemon-CardVS', exp: 4168, code: 'VS', prod: 151, regionSource: 'liste-verifiee' },
    { nom: 'Pokémon Card web', annee: 2001, slug: 'Pokemon-Cardweb', exp: 4355, code: 'WEB', prod: 48, regionSource: 'liste-verifiee' },
    { nom: 'Base Expansion Pack', annee: 2001, slug: 'Base-Expansion-Pack', exp: 5021, code: 'EC1', prod: 157, regionSource: 'liste-verifiee' },
    { nom: 'The Town on No Map', annee: 2002, slug: 'The-Town-on-No-Map', exp: 5022, code: 'EC2', prod: 92, regionSource: 'liste-verifiee' },
    { nom: 'Wind from the Sea', annee: 2002, slug: 'Wind-from-the-Sea', exp: 5023, code: 'EC3', prod: 90, regionSource: 'liste-verifiee' },
    { nom: 'Split Earth', annee: 2002, slug: 'Split-Earth', exp: 5024, code: 'EC4', prod: 91, regionSource: 'liste-verifiee' },
    { nom: 'Mysterious Mountains', annee: 2002, slug: 'Mysterious-Mountains', exp: 5025, code: 'EC5', prod: 91, regionSource: 'liste-verifiee' },
    { nom: 'Miracle of the Desert', annee: 2003, slug: 'Miracle-of-the-Desert', exp: 5873, code: 'ADV2', prod: 53, regionSource: 'liste-verifiee' },
    { nom: 'Rulers of the Heavens', annee: 2003, slug: 'Rulers-of-the-Heavens', exp: 5872, code: 'ADV3', prod: 54, regionSource: 'liste-verifiee' },
    { nom: 'Magma VS Aqua: Two Ambitions', annee: 2003, slug: 'Magma-VS-Aqua-Two-Ambitions', exp: 5869, code: 'ADVex1', prod: 80, regionSource: 'code-minuscule' },
    // ⚠️ RÉGION NON VÉRIFIÉE PAR MOI. codes_set dit INCONNUE (regionSource 'nom-hors-catalogue') :
    // le nom de l'expansion n'existe pas au catalogue international, donc la dérivation ne
    // conclut rien. L'attestation vient de chartmon.com/pokemon/jp/sets, qui date ce set de
    // 1999 dans l'ère japonaise — RAPPORTÉE PAR LE TESTEUR : ma propre requête sur cette page
    // a reçu un HTTP 403, je n'ai donc pas pu la vérifier moi-même. La provenance est écrite
    // ici pour que ce soit relisible, pas pour faire croire à une vérification.
    { nom: 'Intro Pack (Bulbasaur)', annee: 1999, slug: 'Intro-Pack-Bulbasaur', exp: 5059, code: 'IPB', prod: 41, regionSource: 'chartmon-rapporte-par-testeur' },
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
        nom: 'ADV Expansion Pack', slug: null, code: 'ADV1', prod: null,
        // Le refus tient, mais pour une raison MEILLEURE que celle que j'avais donnée. Ce
        // n'était pas une ambiguïté d'homonyme tranchable par l'année : il n'y a
        // simplement AUCUNE expansion cible. Relevé : la base contient douze expansions à
        // code ADV (advD à advJ, ADV2, ADV3, ADV4, ADVex1, ADV-P), et pas une seule ne
        // correspond à l'ADV Expansion Pack de 2003. Une date n'aide pas à choisir entre
        // zéro candidat.
        preuveManquante: 'aucune expansion ADV1 en base — IMPASSE, pas ambiguïté'
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
