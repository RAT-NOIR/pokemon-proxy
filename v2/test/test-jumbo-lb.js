'use strict';
// JUMBO-LB (27/10) — le titre de l'annonce n'affirme JAMAIS une carte JUMBO que par une LISTE BLANCHE : chaque mot du titre doit appartenir à un ensemble FERMÉ
// (les termes jumbo des langues de Vinted, les mots du produit JUMBO candidat, un petit ensemble de mots neutres). Un seul mot hors de ces ensembles, un titre trop long, une ponctuation
// hors de l'ensemble fermé : pas de sûr. Un titre qui nomme un terme jumbo sans être entièrement admis est AMBIGU : la question { normale, jumbo } reste, jamais un sûr.
// Aucune base, aucun réseau : l'archive, les produits, l'affirmation et la question sont FABRIQUÉS ici.
const H = require('./_harnais');
const G = require('../identifier/garde-marqueurs');

const PIKA = G.motsDuProduit({ nomCardmarket: 'Pikachu', nomFr: 'Pikachu', numero: '025', total: '165', set: { slug: 'Banc-Set', nom: 'Banc Set', code: 'PMJ' } });
const DRACO = G.motsDuProduit({ nomCardmarket: 'Charizard', nomFr: 'Dracaufeu', numero: '4', total: '102', set: { slug: 'Base-Set', nom: 'Base Set', code: 'BS' } });
const lire = (s, p = PIKA) => G.lireTitreJumbo(s, p);
const oui = (s, p) => lire(s, p).oui === true;
const sonde = {   // les titres de la sonde du tour 2 et des deux relectures : tout ce qui n'est pas un positif propre se TAIT
    tour1: ["Dracaufeu isn't jumbo", 'Pikachu never oversized', 'Carte standard, aucune version jumbo', 'Pikachu jumbo ? non', 'Jumbo or regular size?', 'Lot Pikachu jumbo et normale', 'version normale / jumbo en vente',
        'Dracaufeu - nope jumbo', 'Pikachu jumbo? nein', 'carte jumbo? neither', 'jumbo? nope', 'isnt jumbo', 'jumbo is false', 'jumbo? n est pas', 'Pikachu jumbo ou petite', 'jumbo vs ordinaire', 'jumbo petite taille'],
    negations: ['pas jumbo', 'carte non jumbo', 'jumbo non', 'not jumbo', 'jumbo: none', "ce n'est pas une jumbo", 'pas une carte géante', 'ce n est pas une jumbo', 'Pikachu jumbo none', 'jumbo nada', 'jumbo nein', 'jumbo nope',
        'carte jumbo (non)', 'jumbo absent', 'jumbo inexistant', 'jumbo no', 'Pikachu jumbo unavailable', 'jumbo: nil', 'jumbo - n/a', 'pas de jumbo ici', 'ce nest pas une jumbo', 'ceci n’est pas une carte jumbo', 'jumbo? rien', 'fake jumbo', 'faux jumbo',
        'jumbo replica', 'jumbo reproduction', 'custom jumbo proxy', 'jumbo=0', 'jumbo : 0'],
    comparaisons: ['jumbo ou pas', 'jumbo vs std', 'jumbo, petit format', 'jumbo - format normal', 'jumbo (pas normale)', 'jumbo plutot que normale', 'jumbo au lieu de la normale', 'jumbo, pas la petite', 'jumbo like regular', 'jumbo versus std',
        'jumbo instead of normal', 'jumbo format A', 'jumbo ou standard', 'jumbo vs mini', 'jumbo et sa version small', 'jumbo ou 63x88', 'jumbo ou petit format', 'jumbo, taille carte classique', 'jumbo vs base'],
    doutes: ['jumbo je crois', 'peut-etre jumbo', 'maybe jumbo', 'jumbo probably', 'jumbo ??', 'jumbo possibly', 'jumbo je pense', 'jumbo sûrement', 'jumbo à vérifier', 'jumbo unsure', 'jumbo 50/50', 'jumbo ish', 'jumbo like', 'type jumbo', 'style jumbo',
        'format jumbo ?', 'jumbo cherche', 'wanted jumbo', 'cherche jumbo Pikachu', 'recherche carte jumbo', 'echange jumbo contre normale', 'jumbo acheté pour 2 euros mais pas la mienne', 'jumbo en photo mais envoi normale',
        'sleeve pour jumbo', 'classeur jumbo', 'boite jumbo', 'pochette jumbo', 'jumbo toploader', 'maybe jumbo ?', 'Pikachu jumbo état neuf, envoi suivi'],
    relecture1: ['Pikachu -jumbo', 'Pikachu un-jumbo', 'Pikachu de-jumbo', 'Pikachu -oversized', 'Pikachu 025 -xxl', 'jumbo-', 'Pikachu jumbo-', 'Pikachu - jumbo', 'Pikachu - jumbo -', 'Jumbo-Pikachu', 'non-jumbo', 'sans-jumbo', 'anti-jumbo',
        'lote gigante', 'Pikachu gigante', 'Pikachu giganti', 'Charizard gigamax gigante', 'Gigantamax Pikachu', 'Pikachu reuze', 'Pikachu riesig', 'Pikachu riesig gefreut', 'Pikachu geant', 'Pikachu geante', 'Pikachu obri', 'gigante', 'reuze', 'riesig', 'geant', 'obri', 'Pikachu sobredimensionada',
        'Pikachu jumbo l', 'Pikachu jumbo d', 'Pikachu jumbo gnaw', 'Pikachu jumbo thunder', 'Pikachu sin jumbo', 'Pikachu ohne jumbo', 'Pikachu nie jumbo', 'Pikachu zonder jumbo', 'Pikachu kein jumbo', 'Pikachu senza jumbo', 'Pikachu bez jumbo', 'Pikachu nao jumbo',
        'Pikachu x2 jumbo', 'lot 3 jumbo', 'Pikachu jumbo 50/50', 'Pikachu jumbo (not)', 'Pikachu (not) jumbo', 'Pikachu jumbo not', 'Pikachu jumbojumbo', 'jumbopikachu', 'Pikachu jumbo m', 'Pikachu jumbo j', 'Pikachu jumbo s', 'Pikachu jumbo p', 'Pikachu jumbo v', 'Pikachu jumbo x'],
    tour2: ['Pikachu jumbo 25 25', 'Pikachu jumbo 165', '3 jumbo', '10 jumbo 3 3', 'v jumbo', 'x jumbo', 'jumbo v', 'Pikachu v jumbo', 'Pikachu jumbo v Pikachu', 'Pikachu V jumbo v Pikachu V', 'Pikachu jumbo 25 025', 'Pikachu jumbo 25/165 25', 'Pikachu Pikachu jumbo', 'Pikachu jumbo Banc Banc', 'Pikachu jumbo x2', 'lot de 3 jumbo'],
    tour3: ['Pikachu jumbo ...', 'Pikachu ... jumbo', "Pikachu 'jumbo'", 'Pikachu "jumbo"', 'Pikachu jumbo ,,', 'Pikachu ,, jumbo', 'Pikachu ,jumbo', 'Pikachu (jumbo', 'Pikachu jumbo)', 'Pikachu ((jumbo))', 'Pikachu #jumbo', 'Pikachu # jumbo', 'Pikachu jumbo #', '# jumbo', 'Pikachu jumbo .', 'Pikachu . jumbo', '. jumbo', 'Pikachu jumbo.......', "Pikachu jumbo '", "' jumbo", "Pikachu 'jumbo", "Pikachu jumbo'", 'Pikachu jumbo!!', 'Pikachu jumbo??', 'Pikachu jumbo.,', 'Pikachu (jumbo.)', 'Pikachu )jumbo(', 'Pikachu «jumbo»', 'Pikachu “jumbo”', 'Pikachu ‘jumbo’'],
    autres: ['Éclat Géant', 'ｊｕｍｂｏ', 'Pikachu jumbo!', 'Pikachu jumbo; Dracaufeu', 'Pikachu [jumbo]', 'Pikachu jumbo: 2€', 'Pikachu jumbo 100%', 'Pikachu jumbo ​holo', 'Pikachu jumbo 026/165', 'Pikachu jumbo 25/166', 'Pikachu jumbo oversize xxl géant nope']
};
const tous = Object.values(sonde).flat();
H.v('1a. le corpus de la sonde (' + tous.length + ' titres) : AUCUN n\'affirme', tous.filter(s => oui(s)), []);
H.v('1a2. chaque titre du corpus qui nomme un terme jumbo sans être admis est AMBIGU (la question reste, jamais un sûr) ; aucun terme : pas ambigu', [lire('maybe jumbo').ambigu, lire('fake jumbo').ambigu, lire('sleeve pour jumbo').ambigu, lire('Pikachu 025').ambigu === true, lire('Pikachu 025').motif], [true, true, true, false, 'aucun terme']);

// ── les positifs propres affirment
H.v('1b. les positifs propres (le nom du produit, son numéro, son set, les mots neutres, les termes jumbo) : sûrs', ['Carte JUMBO Pikachu', 'Pikachu Jumbo 2016'.replace('2016', '025'), 'Pokemon carte Pikachu jumbo holo', 'jumbo', 'JUMBO', 'JÚMBO', 'XXL', 'Pikachu XXL', 'pikachu jumbo promo', 'Pikachu jumbo 025/165', 'Pikachu jumbo 25/165', 'Pikachu jumbo 25',
    'Jumbo Pikachu', 'jumbo.', '(jumbo)', 'Pikachu Oversized', 'Pikachu oversize', "l'oversize de Pikachu", 'carte géante Pikachu', 'Carte Geante Pikachu', 'Pikachu Banc Set jumbo PMJ', 'jumbo Pikachu, Banc Set', 'Pikachu jumbó'].map(s => oui(s)), Array(23).fill(true));
H.v('1b2. le nom du produit est celui du JUMBO CANDIDAT : un autre nom ne passe pas (Charizard sur Pikachu, Pikachu sur Charizard) ; le nom français vient de la ligne', [oui('Oversized Charizard promo'), oui('Oversized Charizard promo', DRACO), oui('carte géante Dracaufeu', DRACO), oui('carte géante Dracaufeu'), oui('Dracaufeu Charizard jumbo', DRACO), oui('Base Set Dracaufeu jumbo 4/102', DRACO)],
    [false, true, true, false, true, true]);
H.v('1b3. sans contexte de produit : seuls les termes jumbo et les mots neutres passent', [G.lireTitreJumbo('Pikachu jumbo').oui, oui('Pikachu jumbo', null), oui('Pikachu jumbo', {}), G.lireTitreJumbo('pokemon carte jumbo').oui, G.lireTitreJumbo('jumbo').oui, oui('jumbo', []), oui('jumbo', 'x')], [false, false, false, true, true, true, true]);
H.v('1b4. le motif d\'un sûr et le terme', [lire('carte Pikachu GÉANT')], [{ oui: true, terme: 'geant', motif: 'liste blanche', ambigu: false }]);

const MEW = G.motsDuProduit({ nomCardmarket: 'Mew', nomFr: 'Mew', numero: '8', total: null, set: { slug: 'Promos', nom: 'Promos', code: 'S-P' } });
H.v('1b5. un TITRE RÉEL du journal de l\'essai (« Carta Mew (s-p) jumbo ») : le code du set (s-p, lettres seules) est un mot du produit ; un nom de 1 lettre ne l\'est pas', [oui('Carta Mew (s-p) jumbo', MEW), oui('Carta Mew (s-p) jumbo', PIKA), oui('Carta Mew (s-p) jumbo'.replace('s-p', 'x-z'), MEW), G.motsDuProduit({ nomCardmarket: 'N', set: { slug: 'Set', nom: 'Set', code: 'XY' } }).includes('n')], [true, false, false, false]);

// trouvé par le REJEU sur les groupes réels de la candidate : un mot du produit qui est un mot de doute (« Type: Null » → « type jumbo ») et une fraction « 50/50 » dont les deux nombres sont admis séparément
const TYPENULL = G.motsDuProduit({ nomCardmarket: 'Type: Null', numero: '50', total: '100', set: { slug: 'Sun-Moon', nom: 'Sun Moon', code: 'SM' } });
H.v('1b6. REJEU réel : « Type: Null » ne blanchit pas « type jumbo » ; « 50/50 » n\'est pas « 50/100 » (la fraction n\'est admise que si elle est le numéro ET le total du produit) ; « 025/165 » ou « 25/165 » oui', [TYPENULL.includes('type'), oui('type jumbo', TYPENULL), oui('Type Null jumbo', TYPENULL), oui('Null jumbo 50/50', TYPENULL), oui('Null jumbo 50/100', TYPENULL), oui('Null jumbo 050/100', TYPENULL), oui('Null jumbo 50', TYPENULL), oui('Pikachu jumbo 25/165'), oui('Pikachu jumbo 026/165')],
    [false, false, false, false, true, true, true, true, false]);       // coût assumé : « Type Null jumbo » se tait (« type » est un mot de doute) — une question, jamais un faux
H.v('1b7. les mots de doute, de recherche, d\'échange et d\'accessoire ne sont jamais des mots du produit', G.DOUTE_ACCESSOIRE.filter(m => G.motsDuProduit({ nomCardmarket: m, set: { slug: 'S', nom: 'S', code: 'S' } }).includes(m)), []);

const ROCKET = G.motsDuProduit({ nomCardmarket: 'Team Rocket\'s Dragonite', numero: '5', total: '82', set: { slug: 'Team-Rocket', nom: 'Team Rocket', code: 'TR' } });
H.v('1b8. REJEU réel : le possessif d\'un nom (« Team Rocket\'s Dragonite ») est un mot du produit ; une lettre isolée qui ne suit pas une apostrophe ne l\'est pas', [oui('Team Rocket\'s Dragonite jumbo', ROCKET), oui('Rocket’s Dragonite jumbo', ROCKET), oui('Rocket s Dragonite jumbo', ROCKET), oui('Dragonite g jumbo', ROCKET), oui('Dragonite m jumbo', ROCKET)], [true, true, true, false, false]);

// ── TOUR 1 (relecture) : le tiret, les adjectifs, les lettres seules, les attaques
const HOOH = G.motsDuProduit({ nomCardmarket: 'Ho-Oh', nomFr: 'Ho-Oh', numero: '7', total: '102', set: { slug: 'Neo-Revelation', nom: 'Neo Revelation', code: 'S-P' } });
H.v('3a. B1 : le tiret n\'est admis qu\'À L\'INTÉRIEUR d\'un mot admis en entier (nom du produit, code du set) ; en tête, en fin, isolé, collé à un terme jumbo ou à un mot neutre : pas de sûr', [oui('Ho-Oh jumbo', HOOH), oui('Ho Oh jumbo', HOOH), oui('Carta Ho-Oh (s-p) jumbo', HOOH), oui('Ho-Oh -jumbo', HOOH), oui('-Ho-Oh jumbo', HOOH), oui('Ho-Oh- jumbo', HOOH), oui('Ho-Oh jumbo-', HOOH), oui('Ho-Oh un-jumbo', HOOH), oui('Ho-Oh de-jumbo', HOOH), oui('Ho-Oh jumbo-pikachu', HOOH), oui('Ho-Pikachu jumbo', HOOH), oui('Pikachu -jumbo'), oui('Pikachu -oversized'), oui('Pikachu 025 -xxl'), oui('Pikachu un-jumbo'), oui('Pikachu de-jumbo'), oui('Jumbo-Pikachu'), oui('Pikachu - jumbo'), oui('pokemon-carte jumbo')],
    [true, true, true, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false]);
H.v('3b. B1 : un titre à tiret hors mot est AMBIGU avec le motif « tiret hors d\'un mot admis » (la question reste)', [lire('Pikachu -jumbo').ambigu, lire('Pikachu -jumbo').motif, lire('Pikachu un-jumbo').motif], [true, 'tiret hors d\'un mot admis', 'mot hors de la liste blanche']);
H.v('3c. I : aucune lettre seule n\'est neutre (ni « l » ni « d »), l\'élision « l\'oversize » / « d\'oversize » reste admise', [G.MOTS_NEUTRES.includes('l'), G.MOTS_NEUTRES.includes('d'), oui('Pikachu jumbo l'), oui('Pikachu jumbo d'), oui("l'oversize de Pikachu"), oui("Pikachu d'oversize"), oui('Pikachu jumbo m')], [false, false, false, false, true, true, false]);
const ATTAQUES = G.motsDuProduit({ nomCardmarket: 'Pikachu [Gnaw | Thunder Jolt]', nomFr: 'Pikachu', numero: '025', total: '165', set: { slug: 'Banc-Set', nom: 'Banc Set', code: 'PMJ' } });
H.v('3d. mineur : les attaques entre crochets ne sont pas des mots du produit (nom, numéro, code et nom du set seulement)', [ATTAQUES.includes('gnaw'), ATTAQUES.includes('thunder'), ATTAQUES.includes('pikachu'), oui('Pikachu jumbo gnaw', ATTAQUES), oui('Pikachu jumbo thunder', ATTAQUES), oui('Pikachu jumbo PMJ', ATTAQUES), oui('Pikachu jumbo Banc Set', ATTAQUES)], [false, false, true, false, false, true, true]);
H.v('3e. B2 : un adjectif seul n\'affirme JAMAIS (avec ou sans produit) ; « Carte Pokémon géante » et « jumbo » seuls restent affirmés', [oui('gigante'), oui('reuze'), oui('riesig'), oui('Pikachu geant'), oui('Pikachu obri'), oui('lote gigante'), oui('Pikachu gigante'), oui('Pikachu giganti'), G.lireTitreJumbo('Carte Pokémon géante').oui, G.lireTitreJumbo('jumbo').oui, G.lireTitreJumbo('Reuzenkaart').oui, G.lireTitreJumbo('Riesenkarte').oui], [false, false, false, false, false, false, false, false, true, true, true, true]);

// ── TOUR 2 : v/x jamais seuls, un mot du produit une seule fois, un nombre seulement s'il est le numéro
const PV = G.motsDuProduit({ nomCardmarket: 'Pikachu V', numero: '3', total: '10', set: { slug: 'Banc-Set', nom: 'Banc Set', code: 'PMJ' } });
const MCX = G.motsDuProduit({ nomCardmarket: 'Mega Charizard X', numero: '12', total: '99', set: { slug: 'Banc-Set', nom: 'Banc Set', code: 'PMJ' } });
H.v('4a. v / x ne sont JAMAIS un mot seul : le produit « Pikachu V » ne les admet qu\'à l\'intérieur de la suite exacte de son nom lue dans le titre', [PV.includes('v'), PV.includes('x'), PV.includes('~pikachu v'),
    oui('Pikachu V jumbo', PV), oui('jumbo Pikachu V', PV), oui('Pikachu V jumbo v Pikachu V', PV), oui('Pikachu jumbo v Pikachu', PV), oui('Pikachu v jumbo', PV), oui('v jumbo', PV), oui('jumbo v', PV), oui('x jumbo', PV), oui('Pikachu V x jumbo', PV), oui('Pikachu V jumbo x Pikachu', PV), oui('Pikachu jumbo', PV)],
    [false, false, true, true, true, false, false, true, false, false, false, false, false, true]);       // « Pikachu v jumbo » = « Pikachu V » à la suite, casse indifférente : le nom du produit
H.v('4a2. idem pour « Mega Charizard X » : « Mega Charizard X jumbo » oui ; « x jumbo », « jumbo x », « Charizard jumbo x Charizard » non ; une sous-suite du nom « Charizard X jumbo » oui', [oui('Mega Charizard X jumbo', MCX), oui('Charizard X jumbo', MCX), oui('x jumbo', MCX), oui('jumbo x', MCX), oui('Charizard jumbo x Charizard', MCX), oui('Mega jumbo X', MCX)], [true, true, false, false, false, false]);
H.v('4b. un mot du produit ne figure qu\'UNE fois, et le nom du produit qu\'une fois : un mot répété = pas de sûr (motif « mot répété »)', [oui('Pikachu Pikachu jumbo'), oui('Pikachu jumbo Banc Banc'), oui('Pikachu jumbo 25 25'), oui('Pikachu jumbo 25 025'), oui('Pikachu jumbo 25/165 25'), oui('Pikachu jumbo 25/165 25/165'), lire('Pikachu Pikachu jumbo').motif, oui('Pikachu jumbo Banc'), oui('Pikachu jumbo 25 PMJ'), oui('Pikachu V jumbo Pikachu V', PV), lire('Pikachu V jumbo Pikachu V', PV).motif],
    [false, false, false, false, false, false, 'mot répété', true, true, false, 'mot répété']);
H.v('4c. un nombre n\'est admis que s\'il est le NUMÉRO du produit (zéros de tête et « n/total » admis) : « 3 jumbo » n\'affirme que si 3 est le numéro', [oui('3 jumbo', PV), oui('3 jumbo'), oui('Pikachu jumbo 10', PV), oui('Pikachu jumbo 3/10', PV), oui('Pikachu jumbo 03/10', PV), oui('Pikachu jumbo 003', PV), oui('Pikachu jumbo 165'), oui('lot de 3 jumbo', PV), oui('10 jumbo 3 3', PV), oui('Pikachu jumbo 2', PV), oui('Pikachu jumbo 3 10', PV)],
    [true, false, false, true, true, true, false, false, false, false, false]);
H.v('4d. XXL seul reste admis (terme de la liste de l\'éditeur)', [G.lireTitreJumbo('XXL').oui, G.lireTitreJumbo('Pokemon XXL').oui], [true, true]);

// ── TOUR 3 : la ponctuation est écrite par ce qui reste AUTORISÉ
H.v('5a. autorisé : des mots séparés par des espaces ; une virgule ou un point UNIQUE collé à la fin d\'un mot ; des parenthèses ÉQUILIBRÉES, une seule à l\'ouverture d\'un mot et une seule à la fermeture ; l\'apostrophe ENTRE deux lettres ; le tiret À L\'INTÉRIEUR d\'un mot admis ; « n/total » du produit',
    ['Pikachu jumbo', 'Pikachu jumbo.', 'Pikachu jumbo,', 'Pikachu, jumbo', 'Pikachu (jumbo)', '(jumbo)', '(Pikachu jumbo)', 'Pikachu (jumbo).', 'Pikachu (jumbo),', 'Pikachu jumbo (25)', 'Pikachu, jumbo, holo.', 'Pikachu jumbo 25/165', 'Pikachu jumbo (25/165)'].map(s => oui(s)), Array(13).fill(true));
H.v('5b. refusé : guillemets simples et doubles (« \'jumbo\' » = soi-disant), deux signes ou plus d\'affilée (... ,, !! ?? .,), signe isolé, parenthèses déséquilibrées ou doublées, « # »', ['Pikachu \'jumbo\'', 'Pikachu "jumbo"', 'Pikachu \u201cjumbo\u201d', 'Pikachu \u2018jumbo\u2019', 'Pikachu \u00abjumbo\u00bb', 'Pikachu jumbo ...', 'Pikachu jumbo,,', 'Pikachu jumbo!!', 'Pikachu jumbo??', 'Pikachu jumbo.,', 'Pikachu jumbo .', '. jumbo', 'Pikachu ,jumbo', 'Pikachu (jumbo', 'Pikachu jumbo)', 'Pikachu ((jumbo))', 'Pikachu )jumbo(', 'Pikachu (jumbo.)', 'Pikachu #jumbo', 'Pikachu jumbo #25', 'Pikachu jumbo #', "Pikachu jumbo '", "Pikachu 'jumbo", "Pikachu jumbo'"].map(s => oui(s)), Array(24).fill(false));
H.v('5c. l\'apostrophe qui reste (possessif) est entre deux lettres ; l\'élision l\'/d\' reste retirée avant', [oui("Team Rocket's Dragonite jumbo", ROCKET), oui("l'oversize de Pikachu"), oui("Pikachu d'oversize"), oui("Team Rocket' Dragonite jumbo", ROCKET), oui("'Team Rocket's Dragonite jumbo", ROCKET)], [true, true, true, false, false]);

// ── les mots de refus ne sont JAMAIS admis, même quand ils sont dans le nom du produit
const PIEGE = G.motsDuProduit({ nomCardmarket: 'Not Pikachu fake', nomFr: 'Pas Pikachu', numero: '1', total: '2', set: { slug: 'Sans-Set', nom: 'Sans Set ou Normal', code: 'NO' } });
H.v('1c. un mot du produit qui est une négation, une liaison ou la version normale n\'entre pas dans la liste blanche (« Pas Pikachu jumbo » se tait même si le produit s\'appelle ainsi)', [PIEGE.includes('pas'), PIEGE.includes('not'), PIEGE.includes('sans'), PIEGE.includes('ou'), PIEGE.includes('normal'), PIEGE.includes('pikachu'), PIEGE.includes('fake'),
    oui('Pas Pikachu jumbo', PIEGE), oui('Not Pikachu jumbo', PIEGE), oui('Pikachu jumbo', PIEGE), oui('Pikachu fake jumbo', PIEGE)], [false, false, false, false, false, true, false, false, false, true, false]);

// ── la forme : longueur, ponctuation, caractères
H.v('1d. un titre trop long (plus de 200 caractères, ou plus de 12 mots) : pas de sûr, même fait de mots admis', [lire('Pikachu jumbo ' + 'holo '.repeat(10)).oui, lire('Pikachu jumbo ' + 'holo '.repeat(11)).oui, lire('Pikachu jumbo ' + 'a'.repeat(250)).motif, lire('Pikachu jumbo ' + 'holo '.repeat(50)).motif, lire('Pikachu jumbo ' + 'holo '.repeat(11)).motif],
    [true, false, 'titre trop long', 'titre trop long', 'titre trop long']);
H.v('1e. la ponctuation hors de l\'ensemble fermé (espace - \' ’ . , ( ) # et le « / » entre deux nombres) : pas de sûr', ['Pikachu jumbo ?', 'Pikachu jumbo !', 'Pikachu / jumbo', 'Pikachu | jumbo', 'Pikachu + jumbo', 'Pikachu & jumbo', 'Pikachu: jumbo', 'Pikachu; jumbo', 'Pikachu "jumbo"', 'Pikachu [jumbo]', 'Pikachu {jumbo}', 'Pikachu jumbo =', 'Pikachu jumbo *', 'Pikachu jumbo @', 'Pikachu jumbo %', 'Pikachu jumbo ~', 'Pikachu jumbo_', 'Pikachu jumbo\ttab'.replace('\t', '​'), 'Pikachu jumbo 😀', 'Pikachu jumbo \\'].map(s => oui(s)), Array(20).fill(false));
H.v('1f. mot entier : « jumbos », « jumbo2 », « xxlarge », « super jumboo » ne sont pas des termes (aucun terme : pas ambigu)', ['jumbos', 'jumbo2', 'xxlarge', 'super jumboo'].map(s => [oui(s), lire(s).ambigu === true]), Array(4).fill([false, false]));
H.v('1g. pas de titre : jamais', ['', '   ', null, undefined, 5, {}].map(s => [oui(s), lire(s).motif]), Array(6).fill([false, 'pas de titre']));
H.v('1g2. un titre propre mais la ponctuation de choix « ? » nie : jamais affirmé, ambigu', [lire('Taille Normale ou jumbo ?').oui, lire('Taille Normale ou jumbo ?').ambigu], [false, true]);

// ── les langues de Vinted : chaque langue a un positif ET un nié ; tout est écrit avec sa source
const L = G.TERMES_PAR_LANGUE;
H.v('1h. les langues de la liste fermée : fr, en, de, es, it, nl, pt, pl, cs ; chacune porte sa source écrite', [Object.keys(L).sort(), Object.values(L).every(x => Array.isArray(x.termes) && x.termes.length > 0 && typeof x.source === 'string' && x.source.length > 20)], [['cs', 'de', 'en', 'es', 'fr', 'it', 'nl', 'pt', 'pl'].sort(), true]);
const NEG = { fr: 'pas', en: 'not', de: 'nicht', es: 'no', it: 'non', nl: 'geen', pt: 'nao', pl: 'nie', cs: 'ne' };
for (const [lang, { seuls, adjectifs, cartes }] of Object.entries(L)) {
    const carte = cartes[0], tous = [...seuls, ...adjectifs];
    H.v(`1i. ${lang} : les termes non ambigus (${seuls.join(', ')}) suffisent seuls avec un mot neutre ; les adjectifs (${adjectifs.join(', ') || 'aucun'}) NON : sans le nom « carte » de la langue ils ne sont pas un terme (aucun terme, pas ambigu)`,
        [seuls.map(t => oui(`${carte} Pikachu ${t}`)), adjectifs.map(t => oui(`Pikachu ${t}`)), adjectifs.map(t => lire(`Pikachu ${t}`).motif), adjectifs.map(t => lire(`Pikachu ${t}`).ambigu)],
        [seuls.map(() => true), adjectifs.map(() => false), adjectifs.map(() => 'aucun terme'), adjectifs.map(() => false)]);
    H.v(`1i1. ${lang} : un adjectif AVEC le nom « carte » de la langue (${cartes.join(', ')}) est un terme et affirme, où que soit le nom`, [adjectifs.map(t => oui(`${carte} Pikachu ${t}`)), adjectifs.map(t => oui(`Pikachu ${t} ${carte}`))], [adjectifs.map(() => true), adjectifs.map(() => true)]);
    const nies = tous.map(t => lire(`${NEG[lang]} ${t} ${carte}`)), avant = tous.map(t => lire(`${t} ${carte} ${NEG[lang]}`));
    H.v(`1i2. ${lang} : le même terme nié (« ${NEG[lang]} … » et « … ${NEG[lang]} ») se tait ET est ambigu (question, jamais un sûr)`, [nies.map(r => r.oui), nies.map(r => r.ambigu), avant.map(r => r.oui), avant.map(r => r.ambigu)], [tous.map(() => false), tous.map(() => true), tous.map(() => false), tous.map(() => true)]);
}
H.v('1i3. un adjectif ne compte qu\'avec le nom « carte » de SA langue : « gigante » + « card » (anglais) ou « reuze » + « carta » : aucun terme ; « carta gigante » (es/it/pt) et « carte géante » (fr) : oui', [lire('card Pikachu gigante').motif, lire('carta Pikachu reuze').motif, oui('carta Pikachu gigante'), oui('carte Pikachu géante'), oui('Pikachu reuze kaart'), oui('Pikachu karte riesig'), oui('Pikachu karta obri'), oui('Pikachu obri kaart')], ['aucun terme', 'aucun terme', true, true, true, true, true, false]);
H.v('1j. les termes du contrat §5 (jumbo, oversize(d), XXL, géant(e)) restent dans la liste fermée, qui est la réunion des langues', [['jumbo', 'oversize', 'oversized', 'xxl', 'geant', 'geante'].every(t => G.TERMES_JUMBO.includes(t)), G.TERMES_JUMBO.length === new Set(Object.values(L).flatMap(x => x.termes)).size, G.TERMES_JUMBO.every(t => t === t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase())], [true, true, true]);
H.v('1k. la liste blanche neutre est COURTE (au plus 30 mots) et ne contient ni négation, ni liaison, ni version normale, ni contrefaçon', [G.MOTS_NEUTRES.length <= 30, G.MOTS_NEUTRES.filter(m => [...G.NEGATIONS, ...G.CONTRACTIONS, ...G.LIAISONS, ...G.VERSION_NORMALE].includes(m)), ['pokemon', 'carte', 'card', 'karte', 'carta', 'tcg', 'holo'].every(m => G.MOTS_NEUTRES.includes(m)), G.MOTS_NEUTRES.filter(m => m.length < 2)], [true, [], true, []]);

// ── le câblage : parJumbo prête le contexte du produit JUMBO ; ambigu ou nié : la question reste, les deux versions, en UN clic
const MQ = require('../identifier/marqueurs');
const el = (type, params = {}) => MQ.valider({ type, params });
const jumbo = [el('JUMBO'), el('NON_LEGAL')];
const entrees = { 11: { vignette: { cle: 'v-j' }, grande: { cle: 'g-j' }, idMetacard: 7, numero: '5', setNom: 'Set Banc' }, 12: { vignette: { cle: 'v-j' }, grande: { cle: 'g-j' }, idMetacard: 7, numero: '5', setNom: 'Set Banc' } };
const version = { entree: id => entrees[id] || null, empruntDe: () => null };
const affirmee = (id, critere = null) => ({ issue: 'affirmee', analyse: { statut: 'identifiee', cartes: [{ statut: 'identifiee', carte: { idProduct: id }, candidats: [] }] }, ...(critere ? { critere } : {}) });
const question = ids => ({ issue: 'question', analyse: { statut: 'a-trancher', cartes: [{ statut: 'a-trancher', carte: null, candidats: ids.map(idProduct => ({ idProduct })) }] }, question: { choix: ids.map(idProduct => ({ idProduct })) } });
const motsDe = { 11: PIKA, 12: PIKA };
const jouer = (titre, { mots = motsDe, sansOutil = false } = {}) => {
    const appels = [];
    const x = G.consulterMarqueurs({ cfg: { jumboTitre: true, gardeMarqueurs: false }, titre, resultat: question([11, 12]), produits: new Map(), version, affirmer: (id, s, critere) => { appels.push([id, critere]); return affirmee(id, critere); },
        marqueursDe: id => (id === 12 ? jumbo : []), questionDeGroupe: ids => question(ids), ...(sansOutil ? {} : { motsDeProduit: id => mots[id] }) });
    return { x, appels };
};
const lu = ({ x }) => (x === null ? null : [x.resultat ? 'sur' : 'question-reste', x.trace.issue, x.trace.motif, x.trace.ambigu === true]);
H.v('2a. titre admis : le produit JUMBO est affirmé (critère « jumbo (titre) »), UNE affirmation', (() => { const r = jouer('Pikachu jumbo promo'); return [lu(r)[0], r.appels.length, r.appels[0][0], r.appels[0][1].startsWith('jumbo (titre)')]; })(), ['sur', 1, 12, true]);
H.v('2b. titre ambigu ou nié (terme jumbo + un mot hors liste) : AUCUNE affirmation, la question { normale, jumbo } reste telle quelle, la trace dit « ambigu »', ['maybe jumbo', 'Pikachu jumbo pas cher', 'fake jumbo', 'Pikachu jumbo état neuf'].map(s => { const r = jouer(s); return [lu(r), r.appels.length, r.x.resultat]; }),
    Array(4).fill([['question-reste', 'se-tait', 'mot hors de la liste blanche', true], 0, undefined]));
H.v('2c. aucun terme jumbo : la question d\'aujourd\'hui, inchangée, pas ambiguë ; JAMAIS la version normale affirmée sur l\'absence du mot', ['Pikachu 025', 'Pikachu normale', 'carte standard', null].map(s => { const r = jouer(s); return [lu(r), r.appels.length]; }),
    [[['question-reste', 'se-tait', 'aucun terme', false], 0], [['question-reste', 'se-tait', 'aucun terme', false], 0], [['question-reste', 'se-tait', 'aucun terme', false], 0], [['question-reste', 'se-tait', 'pas de titre', false], 0]]);
H.v('2d. sans le contexte du produit (l\'outil ne répond pas, ou ne connaît pas l\'id) : seuls les termes et les mots neutres passent — « Pikachu jumbo » se tait, « jumbo » affirme', [lu(jouer('Pikachu jumbo', { sansOutil: true }))[0], lu(jouer('Pikachu jumbo', { mots: {} }))[0], lu(jouer('jumbo', { sansOutil: true }))[0], lu(jouer('pokemon carte jumbo', { mots: {} }))[0]], ['question-reste', 'question-reste', 'sur', 'sur']);
H.v('2e. le contexte est celui du produit JUMBO (12), pas de la normale (11) : un mot qu\'on ne lit que sur la normale ne suffit pas', [lu(jouer('Charizard jumbo', { mots: { 11: DRACO, 12: PIKA } }))[0], lu(jouer('Charizard jumbo', { mots: { 11: PIKA, 12: DRACO } }))[0]], ['question-reste', 'sur']);
H.v('2f. un outil de contexte qui lève : pas de sûr, la question reste (jamais une exception)', (() => { const r = (() => { try { return jouer('Pikachu jumbo', { mots: new Proxy({}, { get: () => { throw new Error('boum'); } }) }); } catch (e) { return { x: 'exception' }; } })(); return r.x === null ? 'null' : (r.x === 'exception' ? 'exception' : lu(r)[0]); })(), 'question-reste');

H.bilan();
