// ============================================================
// LE SERVEUR D'IMAGES PUBLIC DE POKEMONTCG.IO (images.pokemontcg.io) — visuels MANQUANTS, tirage exact (2026-10-10)
// ============================================================
// 🔑 DÉCISION DU TESTEUR (2026-10-08) : « serveur d'images public (images.pokemontcg.io) seulement, jamais l'API Scrydex, aucune clé, aucun
// compte. Collecte de nos trous uniquement, preuve set + numéro + variante. Mention « © Pokémon / The Pokémon Company », source interne
// images.source = pokemontcg.io, retirable en un lot. Occidental d'abord. » Rien d'autre n'entre ici : ni l'API, ni le dépôt de données
// (sans licence), ni aucun autre hôte.
//
// CE QUE LA SOURCE EST, MESURÉ le 2026-10-10 (MESURE-PTCGIO.md) : Cloudflare en simple CDN, aucun défi, robots.txt sans Disallow, AUCUNE
// condition publiée (/terms : 404, accueil : un renvoi vers Scrydex) — « aucune condition trouvée » n'est pas « autorisé ». Le serveur répond
// 404 avec l'image d'une carte « introuvable » pour une adresse absente : seul le STATUT dit l'absence.
//
// 🔑 L'APPARIEMENT SE PROUVE PAR L'IMAGE, JAMAIS PAR L'ADRESSE (ruling du coordinateur, 2026-10-08) : une adresse qui répond ne prouve rien.
// Chaque ligne de TABLE_PTCGIO porte ses `temoins` — des images OUVERTES à l'œil, à des numéros dispersés, dont le numéro imprimé et le NOM
// désignent notre produit au même numéro, 3 sur 3 au moins — et sa `marque` (ce qui montre que le set EST le tirage de notre set). Un set
// qui ne s'est pas prouvé n'a pas de ligne et reste un trou. Les Prize Packs, Battle Academy et WCD sont des réimpressions MARQUÉES : sans set
// dédié montrant la marque, une image serait un SUBSTITUT (§19) — `verdictDuSet` les refuse par leur nom, énumérés.
// ⚠️ La source ne livre ni nom ni donnée : le NOM d'un produit ne se vérifie donc pas carte par carte à la collecte. Ce qui le garantit est la
// numérotation du set (segments couverts par les témoins, suffixe/préfixe du kit) ; un numéro « non couvert par un témoin » reste un trou.
const { cleNumero, normaliserNom } = require('./jointure');
const T = require('./tpc');
const H = require('./hotes-images-ptcgio');       // ➕ 2026-10-17 : les DEUX hôtes d'images permis (la garde « jamais d'API » s'écrit par ce qu'elle autorise)

const SOURCE = 'pokemontcg.io';
const HOTE = 'https://images.pokemontcg.io';
const HOTE_NOM = 'images.pokemontcg.io';
// ➕ 2026-10-17 — DÉCISION DU TESTEUR : images.scrydex.com est OUVERT, aux mêmes conditions (serveur d'images seulement, jamais d'API, source interne `pokemontcg.io` — c'est
// le serveur d'images du même jeu de données —, mention « © Pokémon / The Pokémon Company », jamais le nom de l'hôte dans un champ public). L'hôte se lit dans `urlOriginal`.
const HOTE_SCRYDEX_NOM = 'images.scrydex.com';
const HOTE_SCRYDEX = `https://${HOTE_SCRYDEX_NOM}`;
// les identifiants de set que le client autorise sur cet hôte (énumérés ; un de plus = une décision). clb/clv/clc (SCRYDEX-DECKS, 2026-10-17) : répondent (sonde du coordinateur, cartes vues) ;
// leurs lignes de TABLE_PTCGIO sont ACTIVES depuis les 12 témoins regardés le 2026-10-17 (date lu).
const SETS_SCRYDEX = Object.freeze(['me55c', 'clb', 'clv', 'clc']);
const LOT = 'ptcgio-2026-10';
const MENTION = T.MENTION;                                  // une seule mention pour toutes nos sources de scans (§75)
const CADENCE_MS = 3000;
const CADENCE_MIN_MS = 2000;                                // consigne du coordinateur : jamais moins de 2 s
const REESSAI_MS = 30000;
const UA = 'pokemon-proxy-catalogue/1.0 (mesure, cadence lente)';
const VERROU_GLOBAL = 'pokemontcg-io/__collecteur__';
const VERROU_GLOBAL_MS = 3 * 60 * 1000;
const ID_ALERTE = 'alerte/source-bloquee/pokemontcg-io';
const CRAWL_DELAY_MAX_S = 60;

// Une ligne par set pokemontcg.io PROUVÉ. `suffixe` / `prefixe` : la moitié d'un kit (EX Trainer Kit : A = Latias = tk1a, O = Latios = tk1b).
// `segments` : les plages de numérotation que les TÉMOINS couvrent (principal, secrètes) — chacune a un témoin en son sein ET un témoin à son plus grand
// numéro (test-ptcgio.js le vérifie) ; au-delà, le numéro est « non couvert par un témoin » : il reste un trou, nommé.
const t = (n, nom, imprime) => ({ n, nom, imprime });
const pp = (idProduct, nom, numero, imprime, id) => ({ idProduct, nom, numero, imprime, id });   // une ligne `parProduit` (SCRYDEX-OCC) : tout ce qui a été LU à l'œil sur l'image du serveur
const TABLE_PTCGIO = Object.freeze([
    { slug: 'EX-Trainer-Kit', id: 'tk1a', suffixe: 'A', segments: [[1, 10]], marque: 'symbole du EX Trainer Kit (Latias), dénominateur /10', temoins: [t(1, 'Bagon', '1/10'), t(4, 'Latias', '4/10'), t(10, 'Fire Energy', '10/10')] },
    { slug: 'EX-Trainer-Kit', id: 'tk1b', suffixe: 'O', segments: [[1, 10]], marque: 'symbole du EX Trainer Kit (Latios), dénominateur /10', temoins: [t(1, 'Electrike', '1/10'), t(2, 'Latios', '2/10'), t(10, 'Lightning Energy', '10/10')] },
    { slug: 'EX-Trainer-Kit-2', id: 'tk2a', prefixe: 'P', segments: [[1, 12]], marque: 'symbole du EX Trainer Kit 2 (Plusle), dénominateur /12', temoins: [t(1, 'Beldum', '1/12'), t(6, 'Plusle', '6/12'), t(12, 'Psychic Energy', '12/12')] },
    { slug: 'EX-Trainer-Kit-2', id: 'tk2b', prefixe: 'M', segments: [[1, 12]], marque: 'symbole du EX Trainer Kit 2 (Minun), dénominateur /12', temoins: [t(1, 'Arcanine', '1/12'), t(6, 'Minun', '6/12'), t(12, 'Lightning Energy', '12/12')] },
    { slug: 'McDonalds-Collection-2011', id: 'mcd11', segments: [[1, 12]], marque: 'collection de 12 cartes ©2011 ; symbole d\'extension propre au tirage McDonald\'s : un hexagone noir et blanc à côté de 1/12 (vu en haute définition, relecteur)', temoins: [t(1, 'Snivy', '1/12'), t(6, 'Blitzle', '6/12'), t(12, 'Audino', '12/12')] },
    { slug: 'McDonalds-Collection-2012', id: 'mcd12', segments: [[1, 12]], marque: 'arches McDonald\'s dans l\'illustration (Servine, Emolga, Axew en haute définition)', temoins: [t(1, 'Servine', '1/12'), t(6, 'Emolga', '6/12'), t(12, 'Axew', '12/12')] },
    { slug: 'McDonalds-Collection-2016', id: 'mcd16', segments: [[1, 12]], marque: 'collection de 12 cartes ©2015 ; symbole d\'extension propre au tirage McDonald\'s : un « m » stylisé à côté de 6/12 (vu agrandi, relecteur)', temoins: [t(1, 'Vulpix', '1/12'), t(6, 'Pikachu', '6/12'), t(12, 'Eevee', '12/12')] },
    { slug: 'McDonalds-Collection-2019', id: 'mcd19', segments: [[1, 12]], marque: 'collection de 12 cartes ©2019 ; symbole d\'extension propre au tirage McDonald\'s : un symbole rond (M stylisé) en bas à gauche (vu agrandi, relecteur)', temoins: [t(1, 'Caterpie', '1/12'), t(6, 'Pikachu', '6/12'), t(12, 'Eevee', '12/12')] },
    { slug: 'McDonalds-Collection-2022', id: 'mcd22', segments: [[1, 15]], marque: 'collection de 15 cartes ©2022 ; symbole propre au tirage, en bas à gauche, à côté de la marque de règlement « E » (vu agrandi, relecteur)', temoins: [t(1, 'Ledyba', '1/15'), t(8, 'Chinchou', '8/15'), t(15, 'Smeargle', '15/15')] },
    // ── CEL (2026-10-13) : la CLASSIC COLLECTION de Celebrations (25 cartes, réimpressions des sets d'origine, marquées du logo « 25 »). Le serveur la range sous `cel25c`, fichier
    // `<n° imprimé d'origine>_A_hires.png`. Elle n'a PAS de segment de numérotation : ses numéros sont ceux de sets d'origine différents (2/102, 8/82, 17/17, 109/111…) et quatre
    // cartes partagent « 15 ». Chaque numéro n'est donc servi que sous le NOM de son témoin (`numeroDe: 'fiche'` : le numéro de la FICHE, sans zéros de tête — « 002 » est le tirage
    // principal, ligne cel25 — ET le nom de la carte), jamais par plage. 22 images ouvertes à l'œil le 2026-10-13 (numéro imprimé, nom, logo « 25 ») ; les 3 autres cartes « 15 »
    // (Here Comes Team Rocket!, Rocket's Zapdos, Claydol) n'ont pas d'adresse connue (15_A1…A4 : 404) : elles restent des trous. Placée AVANT cel25 : un numéro de fiche à nom prouvé
    // gagne sur l'adresse nue.
    { slug: 'Celebrations', id: 'cel25c', numeroDe: 'fiche', suffixeUrl: '_A', segments: [], lu: '2026-10-13',
      marque: 'logo « 25 » de la célébration (Pikachu jaune, « 2 » et « 5 » rouges) imprimé sur chaque carte de la Classic Collection, numéro imprimé = numéro de la carte d\'origine',
      temoins: [t(2, 'Blastoise', '2/102'), t(4, 'Charizard', '4/102'), t(8, 'Dark Gyarados', '8/82'), t(9, 'Team Magma\'s Groudon', '9/95'), t(15, 'Venusaur', '15/102'), t(17, 'Umbreon', '17/17'),
          t(20, 'Cleffa', '20/111'), t(24, '_____\'s Pikachu', '24'), t(54, 'Mewtwo-EX', '54/99'), t(60, 'Tapu Lele-GX', '60/145'), t(66, 'Shining Magikarp', '66/64'), t(73, 'Imposter Professor Oak', '73/102'),
          t(76, 'M Rayquaza-EX', '76/108'), t(86, 'Rocket\'s Admin.', '86/109'), t(88, 'Mew ex', '88/92'), t(93, 'Gardevoir ex δ', '93/101'), t(97, 'Xerneas-EX', '97/146'), t(107, 'Donphan', '107/123'),
          t(109, 'Luxray GL LV.X', '109/111'), t(113, 'Reshiram', '113/114'), t(114, 'Zekrom', '114/114'), t(145, 'Garchomp C LV.X', '145/147')] },
    { slug: 'Celebrations', id: 'cel25', segments: [[1, 25]], marque: 'logo « 25 » de la célébration imprimé sur chaque carte', temoins: [t(1, 'Ho-Oh', '001/025'), t(5, 'Pikachu', '005/025'), t(11, 'Mew', '011/025'), t(24, 'Professor\'s Research', '024/025'), t(25, 'Mew', '025/025')] },
    { slug: 'Shining-Legends', id: 'sm35', segments: [[1, 73], [74, 77]], marque: 'symbole Shining Legends, ©2017, dénominateur /73 (principal 1-73, secrètes au-delà ; 76 Mewtwo-GX et 77 Zoroark-GX vus le 2026-10-17)',
      temoins: [t(1, 'Bulbasaur', '1/73'), t(4, 'Shroomish', '4/73'), t(29, 'Raichu-GX', '29/73'), t(55, 'Hoopa', '55/73'), t(72, 'Mewtwo-GX', '72/73'), t(73, 'Pokémon Breeder', '73/73'), t(75, 'Raichu-GX', '75/73'), t(76, 'Mewtwo-GX', '76/73'), t(77, 'Zoroark-GX', '77/73')] },
    // ── PTCGIO-SETS (2026-10-17) : Forbidden Light (sm6) et Guardians Rising (sm2). Segments = les numéros OUVERTS à l'œil (nos trous numérotés) ; les alternatives « a » et les produits sans numéro restent des trous.
    { slug: 'Forbidden-Light', id: 'sm6', segments: [[82, 82], [90, 90], [122, 122], [134, 134], [140, 140]], marque: 'symbole Forbidden Light, ©2018, dénominateur /131 (82 et 90 principal, 122 plein cadre, 134 et 140 secrètes arc-en-ciel)',
      temoins: [t(82, 'Dialga-GX', '82/131'), t(90, 'Xerneas-GX', '90/131'), t(122, 'Lucario-GX', '122/131'), t(134, 'Naganadel-GX', '134/131'), t(140, 'Ultra Necrozma-GX', '140/131')], lu: '2026-10-17' },
    { slug: 'Guardians-Rising', id: 'sm2', segments: [[143, 143]], marque: 'symbole Guardians Rising, ©2017, dénominateur /145 ; le n° 143 est Hala plein cadre (143/145) ; 1 (Bellsprout) et 150 (Alolan Ninetales-GX) vus aussi',
      temoins: [t(1, 'Bellsprout', '1/145'), t(143, 'Hala', '143/145'), t(150, 'Alolan Ninetales-GX', '150/145')], lu: '2026-10-17' },
    { slug: 'Dragon-Majesty', id: 'sm75', segments: [[1, 70], [71, 78]], marque: 'symbole Dragon Majesty, ©2018, dénominateur /70 (principal 1-70, secrètes 71-78)',
      temoins: [t(1, 'Charmander', '1/70'), t(2, 'Charmeleon', '2/70'), t(30, 'Phione', '30/70'), t(41, 'Altaria-GX', '41/70'), t(63, 'Wela Volcano Park', '63/70'), t(65, 'Reshiram-GX', '65/70'), t(69, 'Blaine\'s Last Stand', '69/70'), t(70, 'Zinnia', '70/70'),
          t(75, 'Dragon Talon', '75/70'), t(77, 'Switch Raft', '77/70'), t(78, 'Ultra Necrozma-GX', '78/70')] },
    { slug: 'POP-Series-5', id: 'pop5', segments: [[1, 16]], marque: 'symbole POP Series 5, ©2007, dénominateur /17 (le n° 17 n\'a pas de témoin : non couvert)', temoins: [t(1, 'Ho-Oh', '1/17'), t(9, 'δ Rainbow Energy', '9/17'), t(16, 'Espeon ☆', '16/17')] },
    // ── T2 (2026-10-12) : cinq sets de plus, prouvés à l'œil (23 images ouvertes, dont 17 gardées ici ; 36 requêtes sur 80 permises). Le numéro de FICHIER
    // de la source n'est pas l'entier nu : `jeton` dit le préfixe (liste énumérée JETONS_URL) ; `prefixe` (numéro Cardmarket « TG10 ») ne sert qu'aux Trainer Gallery.
    { slug: 'SM-Black-Star-Promos', id: 'smp', jeton: { prefixe: 'SM', largeur: 2 }, segments: [[89, 248]], marque: 'étoile noire « Black Star » des promos Sun & Moon, numéro imprimé « SMnn » à côté du copyright (©2018 puis ©2021)',
      temoins: [t(89, 'Zoroark', 'SM89'), t(156, 'Dragonite-GX', 'SM156'), t(246, 'Sabrina & Brycen', 'SM246'), t(248, 'Pikachu & Zekrom-GX', 'SM248')], lu: '2026-10-12' },
    { slug: 'Brilliant-Stars', id: 'swsh9tg', prefixe: 'TG', jeton: { prefixe: 'TG', largeur: 2 }, segments: [[1, 30]], marque: 'Trainer Gallery de Brilliant Stars : « TGnn/TG30 » imprimé, symbole de l\'extension Brilliant Stars, ©2022',
      temoins: [t(1, 'Flareon', 'TG01/TG30'), t(15, 'Sylveon VMAX', 'TG15/TG30'), t(30, 'Rapid Strike Urshifu VMAX', 'TG30/TG30')], lu: '2026-10-12' },
    { slug: 'Lost-Origin', id: 'swsh11tg', prefixe: 'TG', jeton: { prefixe: 'TG', largeur: 2 }, segments: [[2, 30]], marque: 'Trainer Gallery de Lost Origin : « TGnn/TG30 » imprimé, symbole de l\'extension Lost Origin, ©2022 (segment à partir de TG02, Roserade vu le 2026-10-17 ; TG01 non ouvert)',
      temoins: [t(2, 'Roserade', 'TG02/TG30'), t(3, 'Charizard', 'TG03/TG30'), t(17, 'Pikachu VMAX', 'TG17/TG30'), t(30, 'Mew VMAX', 'TG30/TG30')], lu: '2026-10-12' },
    { slug: 'HGSS-Black-Star-Promos', id: 'hsp', jeton: { prefixe: 'HGSS', largeur: 2 }, segments: [[17, 25]], marque: 'étoile noire « Black Star » des promos HeartGold SoulSilver, numéro imprimé « HGSSnn », ©2010',
      temoins: [t(17, 'Minun', 'HGSS17'), t(24, 'Hitmonchan', 'HGSS24'), t(25, 'Hitmonlee', 'HGSS25')], lu: '2026-10-12' },
    { slug: 'McDonalds-Collection-25th-Anniversary', id: 'mcd21', segments: [[1, 25]], marque: 'collection de 25 cartes ©2021 ; logo « 25 » de la célébration sur l\'illustration et symbole McDonald\'s près du dénominateur /25',
      temoins: [t(1, 'Bulbasaur', '1/25'), t(13, 'Tepig', '13/25'), t(17, 'Squirtle', '17/25'), t(25, 'Pikachu', '25/25')], lu: '2026-10-12' },
    // ── T7b (2026-10-12) : les holos « H » des séries e-Card. Notre fiche H<n> est l'impression HOLO ; l'image ordinaire (n°2, n°8…) en serait un substitut (§19).
    // `prefixe: 'H'` (forme du numéro Cardmarket « H7 ») : l'entier nu — l'impression ordinaire — n'a PAS d'adresse ici. 8 images ouvertes à l'œil, « Hn/H32 » imprimé.
    { slug: 'Skyridge', id: 'ecard3', prefixe: 'H', jeton: { prefixe: 'H', largeur: 1 }, segments: [[1, 32]], marque: 'symbole Skyridge (silhouette) et logo « e » e-Card, ©2003, numéro imprimé « Hn/H32 » avec étoile holo',
      // H16/H17 (Magcargo) et H18/H19 (Magneton) : jumeaux de même nom, séparés par les attaques, les PV, le type et l'illustrateur lus sur l'image (Kusajima / Arita ; Kusajima 80 PV / Saitou 70 PV), pas par le nom
      temoins: [t(1, 'Alakazam', 'H1/H32'), t(9, 'Gengar', 'H9/H32'), t(16, 'Magcargo', 'H16/H32'), t(17, 'Magcargo', 'H17/H32'), t(18, 'Magneton', 'H18/H32'), t(19, 'Magneton', 'H19/H32'), t(20, 'Moltres', 'H20/H32'), t(32, 'Xatu', 'H32/H32')], lu: '2026-10-12' },
    { slug: 'Aquapolis', id: 'ecard2', prefixe: 'H', jeton: { prefixe: 'H', largeur: 1 }, segments: [[7, 32]], marque: 'symbole Aquapolis (vague) et logo « e » e-Card, ©2002, numéro imprimé « Hn/H32 » avec étoile holo (segment à partir de H7, le premier témoin ; H1 à H6 sont déjà servis)',
      temoins: [t(7, 'Electrode', 'H7/H32'), t(14, 'Kingdra', 'H14/H32'), t(24, 'Sudowoodo', 'H24/H32'), t(32, 'Zapdos', 'H32/H32')], lu: '2026-10-12' },
    // ── T2-COLLECTE (2026-10-17) : les 7 « Na », swshp et cinq produits isolés. 43 images ouvertes à l'œil (19 demandées à images.pokemontcg.io le 17/10, 25 de la mesure MESURE-OCC), numéro imprimé, nom et symbole lus contre
    // NOS fiches. Les segments ne couvrent QUE les numéros prouvés (les trous visés), jamais la plage entière du set : les autres cartes sont déjà servies par TCGdex.
    // 🔴 LES « Na » : TCGdex servait au n° de base (143, 92, 65, 73, 28, 43, 146) l'illustration ALTERNATIVE « 143a/236 » (cadre jaune, « A » en pied) — ces sept visuels ont été retirés le 17/10 (A-prouves-faux.json). Chez cette
    // source l'alternative n'existe pas : le fichier du n° de base imprime « 143/236 » sans « a » (vu, à côté de la 143a retirée) ; un numéro de la forme « 143a » n'a de toute façon pas d'adresse (`lireNumero`).
    // Un seul produit (V1) par numéro : aucune variante à signaler. Pas de reverse ni de tampon chez cette source (un fichier par numéro, scan non-reverse).
    { slug: 'Cosmic-Eclipse', id: 'sm12', segments: [[143, 143]], marque: 'symbole Cosmic Eclipse, ©2019, dénominateur /236 ; le n° 143 imprime « 143/236 » (la 143a alternative, cadre fond coloré, n\'existe pas chez cette source)',
      temoins: [t(1, 'Venusaur & Snivy-GX', '1/236'), t(100, 'Cosmog', '100/236'), t(143, 'Togepi & Cleffa & Igglybuff-GX', '143/236')], lu: '2026-10-17' },
    { slug: 'Roaring-Skies', id: 'xy6', segments: [[92, 92]], marque: 'symbole Roaring Skies, ©2015, dénominateur /108 ; le n° 92 imprime « 92/108 » (pas de « 92a » chez cette source)',
      temoins: [t(77, 'Shaymin-EX', '77/108'), t(92, 'Trainers\' Mail', '92/108'), t(108, 'Winona', '108/108')], lu: '2026-10-17' },
    { slug: 'Phantom-Forces', id: 'xy4', segments: [[65, 65]], marque: 'symbole Phantom Forces, ©2014, dénominateur /119 ; le n° 65 imprime « 65/119 » (pas de « 65a » chez cette source)',
      temoins: [t(24, 'M Manectric-EX', '24/119'), t(65, 'Aegislash-EX', '65/119'), t(119, 'Xerosic', '119/119')], lu: '2026-10-17' },
    { slug: 'Generations', id: 'g1', segments: [[28, 28], [73, 73]], marque: 'symbole Generations, ©2016, dénominateur /83 ; les n° 28 et 73 impriment « 28/83 » et « 73/83 » (pas de « a » chez cette source)',
      temoins: [t(28, 'Jolteon-EX', '28/83'), t(40, 'Machop', '40/83'), t(73, 'Team Flare Grunt', '73/83')], lu: '2026-10-17' },
    { slug: 'Fates-Collide', id: 'xy10', segments: [[43, 43]], marque: 'symbole Fates Collide, ©2016, dénominateur /124 ; le n° 43 imprime « 43/124 » (pas de « 43a » chez cette source ; 54, 105 et 111 vus aussi)',
      temoins: [t(43, 'Regirock-EX', '43/124'), t(54, 'Zygarde-EX', '54/124'), t(105, 'N', '105/124')], lu: '2026-10-17' },
    { slug: 'BREAKthrough', id: 'xy8', segments: [[146, 146]], marque: 'symbole BREAKthrough, ©2015, dénominateur /162 ; le n° 146 imprime « 146/162 » (pas de « 146a » chez cette source)',
      temoins: [t(1, 'Paras', '1/162'), t(100, 'Ralts', '100/162'), t(146, 'Professor\'s Letter', '146/162')], lu: '2026-10-17' },
    // swshp : « SWSHnnn » imprimé près du copyright, étoile noire « Black Star ». Segments = les numéros OUVERTS : 75, 251, 282-283, 287-290 (les quatre morceaux du V-UNION Morpeko, 288 à 290 vus un à un), 292.
    // SWSH300 répond 404 et SWSH301 (deux produits Cardmarket, V1/V2) n'est pas prouvé : trous nommés.
    { slug: 'SWSH-Black-Star-Promos', id: 'swshp', jeton: { prefixe: 'SWSH', largeur: 3 }, segments: [[75, 75], [251, 251], [282, 283], [287, 290], [292, 292]], marque: 'étoile noire « Black Star » des promos Sword & Shield, numéro imprimé « SWSHnnn » à côté du copyright (©2020 à ©2023)',
      temoins: [t(75, 'Special Delivery Charizard', 'SWSH075'), t(251, 'Boss\'s Orders', 'SWSH251'), t(282, 'Galarian Articuno', 'SWSH282'), t(283, 'Galarian Zapdos', 'SWSH283'), t(287, 'Morpeko V-UNION', 'SWSH287'), t(288, 'Morpeko V-UNION', 'SWSH288'),
          t(289, 'Morpeko V-UNION', 'SWSH289'), t(290, 'Morpeko V-UNION', 'SWSH290'), t(292, 'Zacian V', 'SWSH292')], lu: '2026-10-17' },
    // isolés : énergies de base sans numéro de fiche (le numéro Cardmarket fait l'adresse). hgss1 : l'énergie Cardmarket « 2010 » est une autre impression, hors de la forme (4 chiffres) : elle reste un trou.
    { slug: 'EX-Emerald', id: 'ex9', segments: [[103, 103]], marque: 'symbole EX Emerald, ©2005, dénominateur /106 ; le n° 103 est l\'énergie Eau holo « 103/106 »',
      temoins: [t(1, 'Blaziken', '1/106'), t(50, 'Feebas', '50/106'), t(103, 'Water Energy', '103/106')], lu: '2026-10-17' },
    { slug: 'HeartGold-SoulSilver', id: 'hgss1', segments: [[121, 122]], marque: 'symbole HeartGold & SoulSilver, ©2010, dénominateur /123 ; les n° 121 et 122 sont les énergies Obscurité et Métal',
      temoins: [t(1, 'Arcanine', '1/123'), t(121, 'Darkness Energy', '121/123'), t(122, 'Metal Energy', '122/123')], lu: '2026-10-17' },
    { slug: 'Chilling-Reign', id: 'swsh6', segments: [[231, 232]], marque: 'symbole Chilling Reign, ©2021, dénominateur /198 ; les n° 231 et 232 sont les énergies dorées Eau et Psy (secrètes)',
      temoins: [t(1, 'Weedle', '001/198'), t(231, 'Water Energy', '231/198'), t(232, 'Psychic Energy', '232/198')], lu: '2026-10-17' },
    { slug: 'Fusion-Strike', id: 'swsh8', segments: [[283, 284]], marque: 'symbole Fusion Strike, ©2021, dénominateur /264 ; les n° 283 et 284 sont les énergies dorées Plante et Feu (secrètes)',
      temoins: [t(1, 'Caterpie', '001/264'), t(283, 'Grass Energy', '283/264'), t(284, 'Fire Energy', '284/264')], lu: '2026-10-17' },
    { slug: 'Rising-Rivals', id: 'pl2', segments: [[84, 84]], marque: 'symbole Rising Rivals, ©2009, dénominateur /111 ; le n° 84 imprime « 84/111 »',
      temoins: [t(1, 'Arcanine Lv.53', '1/111'), t(50, 'Starmie Lv.44', '50/111'), t(84, 'Trapinch Lv.14', '84/111')], lu: '2026-10-17' },
    // ── SCRYDEX-OCC (2026-10-17) : la CLASSIC COLLECTION de 30th Celebration, servie par images.scrydex.com sous `pokemon/me55c-<n>[lettre]/large` (images.pokemontcg.io répond 404 pour me55c).
    // 30 images ouvertes à l'œil le 2026-10-17 (654×914, bordure dorée, logo « 30 » = Pikachu jaune, « 3 » et « 0 » rouges) : 29 portent le numéro imprimé ET le nom de NOTRE produit.
    // Les produits n'ont ni numéro de fiche ni numéro Cardmarket (« Charizard-30CBS-4 » : le numéro d'ORIGINE est dans le slug) ; trois cartes s'impriment « 106 » (Shining Celebi, Palkia LV.X,
    // M Gardevoir-EX) et deux « 11 » : l'adresse se prouve donc PAR PRODUIT (`parProduit` : idProduct, nom, numéro d'origine, numéro imprimé lu sur l'image, identifiant du serveur) ET par le NOM
    // de la carte au moment du plan. Un produit absent de cette liste reste un trou ; `refuses` nomme celui que l'image contredit.
    { slug: '30th-Celebration', id: 'me55c', hote: HOTE_SCRYDEX_NOM, idServeur: 'me55c', numeroDe: 'produit', segments: [], lu: '2026-10-17',
      marque: 'Classic Collection de 30th Celebration (réimpression, pas la carte d\'origine) : bordure dorée et logo « 30 » (Pikachu jaune, « 3 » et « 0 » rouges) imprimés sur chaque carte ; numéro imprimé = numéro de la carte d\'origine',
      parProduit: [
          pp(907939, 'Pikachu', '58', '58/102', 'me55c-58'), pp(907940, 'Charizard', '4', '4/102', 'me55c-4'), pp(907941, 'Misty', '18', '18/132', 'me55c-18'),
          pp(907942, 'Erika\'s Jigglypuff', '69', '69/132', 'me55c-69'), pp(907943, 'Sneasel', '25', '25/111', 'me55c-25'), pp(907944, 'Shining Celebi', '106', '106/105', 'me55c-106'),
          pp(907945, 'Lugia', '149', '149/147', 'me55c-149'), pp(907946, 'Delcatty', '5', '5/109', 'me55c-5'), pp(907947, 'Dark Tyranitar', '19', '19/109', 'me55c-19'),
          pp(907948, 'Scizor ex', '108', '108/115', 'me55c-108'), pp(907949, 'Metagross', '11', '11/113', 'me55c-11'), pp(907950, 'Palkia LV.X', '106', '106/106', 'me55c-106p'),
          pp(907951, 'Uxie', '43', '43/146', 'me55c-43'), pp(907952, 'Crobat G', '47', '47/127', 'me55c-47'), pp(907953, 'Gengar', '94', '94/102', 'me55c-94'),
          pp(907956, 'N', '101', '101/101', 'me55c-101'),
          pp(907957, 'Rayquaza-EX', '85', '85/124', 'me55c-85'), pp(907959, 'M Gardevoir-EX', '106', '106/160', 'me55c-106m'), pp(907960, 'Greninja BREAK', '41', '41/122', 'me55c-41'),
          pp(907961, 'Solgaleo-GX', '89', '89/149', 'me55c-89'), pp(907962, 'Buzzwole-GX', '57', '57/111', 'me55c-57'), pp(907963, 'Pikachu & Zekrom-GX', '33', '33/181', 'me55c-33'),
          pp(907964, 'Zacian V', '138', '138/202', 'me55c-138'), pp(907965, 'Raikou', '50', '50/185', 'me55c-50'), pp(907966, 'Mew VMAX', '114', '114/264', 'me55c-114'),
          pp(907967, 'Arceus VSTAR', '123', '123/172', 'me55c-123'), pp(907968, 'Magikarp', '203', '203/193', 'me55c-203')],
      // « Genesect-EX-30CPLB-97 » : le serveur sert sous me55c-11g une Genesect-EX qui imprime 11/101 (vue le 2026-10-17), jamais 97 — le produit n'est pas prouvé, il reste un trou
      // les deux moitiés de Darkrai & Cresselia LEGEND (me55c-99 et me55c-100, 99/102 et 100/102 imprimés, justes à l'œil) sont UNE carte (un document `cartes`) et DEUX produits ; la fiche du site n'a
      // pas de numéro et sert la première image du set aux deux produits (simulation, règle du site importée : 907954 reçoit me55c-100). Aucune des deux n'est écrite : un trou est honnête, la moitié d'une autre carte non.
      refuses: [{ idProduct: 907958, nom: 'Genesect-EX', motif: 'numero-contredit-par-l-image', vu: 'me55c-11g imprime 11/101, le produit porte 97' },
          { idProduct: 907954, nom: 'Darkrai & Cresselia LEGEND', motif: 'deux-produits-une-fiche', vu: 'me55c-99 : 99/102 juste ; une fiche sans numéro pour les deux moitiés' },
          { idProduct: 907955, nom: 'Darkrai & Cresselia LEGEND', motif: 'deux-produits-une-fiche', vu: 'me55c-100 : 100/102 juste ; une fiche sans numéro pour les deux moitiés' }],
      ouvertes: 30 },
    // ── SCRYDEX-DECKS (2026-10-17) : les trois decks TCG Classic, serveur d'images. 12 images ouvertes à l'œil le 2026-10-17 (4 par deck : n° 1, 34, un milieu, et la carte de la première sonde), toutes avec le code du deck
    // et le numéro « nnn/034 » imprimés, 596×834, nom = celui de NOTRE produit au même numéro. Les identifiants clk, clf, cll, mfb, mfba, mfbb ont rendu le DOS de carte du serveur (refusé par empreinte). My First Battle : non trouvé.
    // lu (date AAAA-MM-JJ, exigée par ligneActive) est la décision : sans date, la ligne est inactive et ne prouve rien. Le segment [[1, 34]] est couvert par les témoins (1 et 34 compris).
    { slug: 'Pokemon-Trading-Card-Game-Classic-Blastoise-Suicune-ex-Deck', id: 'clb', hote: HOTE_SCRYDEX_NOM, idServeur: 'clb', segments: [[1, 34]], lu: '2026-10-17',
      marque: 'Pokémon TCG Classic, deck Blastoise & Suicune ex : code CLB imprimé sur chaque carte, numérotation nnn/034',
      temoins: [t(1, 'Squirtle', '001/034'), t(10, 'Suicune ex', '010/034'), t(17, 'Kangaskhan', '017/034'), t(34, 'Psychic Energy', '034/034')] },
    { slug: 'Pokemon-Trading-Card-Game-Classic-Venusaur-Lugia-ex-Deck', id: 'clv', hote: HOTE_SCRYDEX_NOM, idServeur: 'clv', segments: [[1, 34]], lu: '2026-10-17',
      marque: 'Pokémon TCG Classic, deck Venusaur & Lugia ex : code CLV imprimé sur chaque carte, numérotation nnn/034',
      temoins: [t(1, 'Bulbasaur', '001/034'), t(16, 'Snorlax', '016/034'), t(17, 'Lugia ex', '017/034'), t(34, 'Fighting Energy', '034/034')] },
    { slug: 'Pokemon-Trading-Card-Game-Classic-Charizard-Ho-Oh-ex-Deck', id: 'clc', hote: HOTE_SCRYDEX_NOM, idServeur: 'clc', segments: [[1, 34]], lu: '2026-10-17',
      marque: 'Pokémon TCG Classic, deck Charizard & Ho-Oh ex : code CLC imprimé sur chaque carte, numérotation nnn/034',
      temoins: [t(1, 'Charmander', '001/034'), t(7, 'Ho-Oh ex', '007/034'), t(17, 'Miltank Lv.32', '017/034'), t(34, 'Lightning Energy', '034/034')] }
].map(l => Object.freeze({ lu: '2026-10-10', ...l, ...(l.parProduit ? { temoins: l.parProduit.map(e => t(Number(e.numero), e.nom, e.imprime)) } : {}) })));   // une ligne par produit : chaque produit prouvé EST un témoin

const NOTE_VARIANTE = 'variante Cardmarket : la source ne distingue pas les variantes de ce numéro — une image par numéro';
/** Une ligne est ACTIVE si et seulement si son lu est une DATE réelle AAAA-MM-JJ (pas toute chaîne non vide) : écrite par ce qu'elle autorise. */
const ligneActive = l => !!l && typeof l.lu === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(l.lu) && (d => !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === l.lu)(new Date(l.lu + 'T00:00:00Z'));
const lignesDe = slug => TABLE_PTCGIO.filter(l => l.slug === slug && ligneActive(l));   // une ligne sans date de lecture est INACTIVE : aucun témoin regardé, elle ne prouve rien

/** Le numéro d'URL (entier) d'un numéro de produit qui a la FORME de cette ligne (suffixe/préfixe du kit), couvert ou non ; sinon null. */
function lireNumero(ligne, numeroFiche) {
    if (!ligne || numeroFiche == null) return null;
    if (ligne.parProduit) return null;           // une ligne PAR PRODUIT (SCRYDEX-OCC) n'adresse jamais par un numéro : seul l'idProduct prouvé fait l'adresse (planifierPtcgio)
    const s = String(numeroFiche).trim();
    if (ligne.numeroDe === 'fiche') return /^[1-9]\d{0,2}$/.test(s) ? Number(s) : null;   // numéro d'ORIGINE : sans zéros de tête (« 002 » est le tirage principal, ligne cel25)
    const m = ligne.suffixe ? new RegExp(`^(\\d{1,3})${ligne.suffixe}$`).exec(s) : ligne.prefixe ? new RegExp(`^${ligne.prefixe}(\\d{1,3})$`).exec(s) : /^0*(\d{1,3})$/.exec(s);
    return m ? Number(m[1]) : null;
}
/**
 * Le numéro d'URL (entier) que cette ligne sert pour ce numéro de produit, ou null : écrit par ce qu'il AUTORISE.
 * 🔑 RULING DU 2026-10-10 : la source ne livre aucun nom, la garantie d'un numéro vient des TÉMOINS. Un numéro n'est servi que dans un SEGMENT de
 * numérotation (principal, secrètes) que la ligne déclare, et chaque segment a un témoin en son sein et un témoin à son plus grand numéro.
 */
function adresseDe(ligne, numeroFiche, nomEn = undefined) {
    const n = lireNumero(ligne, numeroFiche);
    if (n == null) return null;
    // 🔑 CEL (2026-10-13) : une ligne `numeroDe: 'fiche'` ne sert un numéro que sous le NOM de son témoin — quatre cartes de la Classic Collection portent « 15 », une seule est la Venusaur.
    // Sans le nom de la carte, rien ne se construit.
    if (ligne.numeroDe === 'fiche') { const w = ligne.temoins.find(x => x.n === n); return w && nomEn != null && normaliserNom(w.nom) === normaliserNom(nomEn) ? n : null; }
    return ligne.segments.some(([de, a]) => n >= de && n <= a) ? n : null;
}
// 🔑 T2 (2026-10-12) : certains sets numérotent leurs fichiers « SM246 », « TG05 » (promos, Trainer Gallery) — pas l'entier nu. Le jeton d'URL d'une ligne
// (`jeton: { prefixe, largeur }`) s'écrit par ce qu'il AUTORISE : un préfixe de cette liste ÉNUMÉRÉE, sinon rien ne se construit.
const JETONS_URL = Object.freeze(['SM', 'SWSH', 'XY', 'HGSS', 'BW', 'DP', 'TG', 'GG', 'H']);   // T7b : « H » = les holos des séries e-Card (Skyridge ecard3, Aquapolis ecard2), fichiers « H1 »…« H32 »
// 🔑 CEL (2026-10-13) : la Classic Collection de Celebrations est servie sous `cel25c/<n>_A_hires.png`. Le suffixe est une liste ÉNUMÉRÉE d'un seul élément, et le client ne
// l'autorise que sur cel25c (CHEMIN_AUTORISE) : aucun autre chemin ne s'élargit.
const SUFFIXES_URL = Object.freeze(['_A']);
function urlHires(id, n, jeton = null, suffixe = '') {
    if (suffixe && !SUFFIXES_URL.includes(suffixe)) throw new Error(`${SOURCE} : suffixe d'URL « ${suffixe} » hors de ce que le client autorise (${SUFFIXES_URL.join(', ')})`);
    if (!jeton) return `${HOTE}/${id}/${n}${suffixe}_hires.png`;
    if (!JETONS_URL.includes(jeton.prefixe) || !Number.isInteger(jeton.largeur) || jeton.largeur < 1 || jeton.largeur > 3) throw new Error(`${SOURCE} : jeton d'URL « ${jeton.prefixe} » hors de ce que le client autorise (${JETONS_URL.join(', ')})`);
    return `${HOTE}/${id}/${jeton.prefixe}${String(n).padStart(jeton.largeur, '0')}${suffixe}_hires.png`;
}

/** L'adresse d'une image du serveur d'images scrydex : `/pokemon/<set énuméré>-<n>[lettre]/large`. Un identifiant hors des sets énumérés LÈVE (jamais une adresse bâtie sur autre chose). */
function urlScrydex(id) {
    if (!new RegExp(`^(?:${SETS_SCRYDEX.join('|')})-[1-9]\\d{0,2}[a-z]?$`).test(String(id))) throw new Error(`${SOURCE} : identifiant « ${id} » hors de ce que le client autorise (${HOTE_SCRYDEX_NOM} : ${SETS_SCRYDEX.join(', ')}-<n>)`);
    return `${HOTE_SCRYDEX}/pokemon/${id}/large`;
}

// Les réimpressions MARQUÉES (tampon) : sans set dédié qui montre la marque, ce serait un substitut. ÉNUMÉRÉ, par le nom Cardmarket du set.
const SUBSTITUTS = [/Prize-Pack/i, /^Battle-Academy/i, /^WCD-/i];
function verdictDuSet(slug) {
    if (SUBSTITUTS.some(r => r.test(String(slug)))) return { verdict: 'substitut-interdit', motif: `${slug} : réimpression marquée sans set dédié prouvé chez pokemontcg.io — une image serait celle d'un autre tirage (§19)` };
    if (lignesDe(slug).length) return { verdict: 'prouve', motif: `${slug} : ${lignesDe(slug).map(l => l.id).join(', ')}` };
    return { verdict: 'non-apparie', motif: `${slug} : aucun set pokemontcg.io prouvé par l'image` };
}

/**
 * ➕ R5 (tour 1, A-I) — LES NUMÉROS DE TOUS LES PRODUITS DU SET, pour le décompte de `noteVariante` : le numéro Cardmarket (`numeros_cartes`) quand le
 * produit en a un, SINON le numéro de sa ligne de jointure (`cartes_produits.numeroFiche`). Un produit jamais appris par Cardmarket (SL Marshadow 368764,
 * Zorua 368730 : pas de ligne `numeros_cartes`) partage pourtant l'image de son frère au même numéro ; sans lui, la note manquait. Le numéro de fiche ne
 * sert qu'au DÉCOMPTE (il n'adresse rien : `planifierPtcgio` n'adresse que par `numeroCm`).
 */
function numerosDuSet(lignes, numerosCm) {
    // tous les numéros Cardmarket connus (comme avant) + celui de la ligne pour chaque produit qui n'en a pas
    const sans = (lignes || []).filter(l => !numerosCm.has(l.idProduct)).map(l => l.numeroFiche);
    return [...numerosCm.values(), ...sans].filter(n => n != null && String(n).trim() !== '').map(String);
}

/**
 * LE PLAN, pur : chaque trou (carte, numéro) reçoit l'adresse de SON numéro dans la ligne prouvée, ou un MOTIF. Un trou déjà servi (au
 * même numéro, ou sans numéro dans le set) n'y figure jamais — additif.
 * @param {{slug: string, trous: Array<{carte: object, numeroFiche: string|null, idProduct: number}>}} o
 */
function planifierPtcgio({ slug, trous, tousNumerosCm = null, lignes: lignesImposees = null }) {
    // `lignes` (banc seulement) : rejouer le plan avec des lignes données, sans toucher à la table gelée (une ligne imposée est prise pour prouvée)
    const V = lignesImposees ? { verdict: 'prouve' } : verdictDuSet(slug), lignes = lignesImposees || lignesDe(slug);
    // 🔑 T2 : la source n'a qu'UN fichier par numéro ; quand 2 produits Cardmarket du set ou plus portent ce numéro (V1/V2/V3), le choix de la variante n'est
    // pas prouvé et l'entrée le DIT (`noteVariante`, lue par le site). Compté par le numéro du PRODUIT (l'adresse qu'il fait), jamais par le nom ; sans la
    // liste des numéros du set, aucune note n'est inventée.
    const parAdresse = new Map();
    // (une ligne `numeroDe: 'fiche'` n'est pas comptée ici : ses adresses sont gardées par le NOM, une seule carte par adresse — pas de variantes à signaler)
    for (const nc of tousNumerosCm || []) for (const l of lignes) { if (l.numeroDe === 'fiche') continue; const n = adresseDe(l, nc); if (n != null) { const k = `${l.id}|${n}`; parAdresse.set(k, (parAdresse.get(k) || 0) + 1); break; } }
    const vus = new Set(), plan = [], restes = [];
    for (const x of trous) {
        // 🔴 LE NUMÉRO QUI FAIT L'ADRESSE EST CELUI DU PRODUIT CARDMARKET (`numeroCm`), pas `numeroFiche` : une réimpression porte en fiche le
        // numéro de la carte d'ORIGINE (Celebrations, classic collection : « 15 Venusaur » = n° 15 de Base Set, et le n° 15 de cel25 est Lunala).
        // `numeroFiche` ne sert qu'à CONTREDIRE : s'il porte un numéro, ses chiffres doivent être ceux de l'adresse.
        const numero = x.numeroFiche ?? x.numeroCm ?? null;       // celui que l'entrée `cartes.images` portera (comme les autres sources)
        const base = { carteId: x.carte._id, nomEn: x.carte.nomEn ?? null, numero, idProduct: x.idProduct };
        if (V.verdict !== 'prouve') { restes.push({ ...base, motif: V.verdict }); continue; }
        // 🔑 SCRYDEX-OCC (2026-10-17) : un set dont les lignes sont PAR PRODUIT (30th Celebration, Classic Collection) s'adresse par l'idProduct prouvé À L'ŒIL, jamais par un numéro — les produits n'ont ni numéro
        // de fiche ni numéro Cardmarket, et trois cartes s'impriment « 106 ». Deux éléments : l'idProduct de la table ET le NOM de la carte ; un numéro de fiche ou Cardmarket qui contredit refuse.
        if (lignes.length && lignes.every(l => l.parProduit)) {
            const refuse = lignes.flatMap(l => l.refuses || []).find(r => r.idProduct === x.idProduct);
            if (refuse) { restes.push({ ...base, motif: refuse.motif }); continue; }
            const trouve = lignes.map(l => ({ l, e: l.parProduit.find(z => z.idProduct === x.idProduct) })).find(h => h.e);
            if (!trouve) { restes.push({ ...base, motif: 'produit-hors-table' }); continue; }
            const { l, e } = trouve, b2 = { ...base, numero: e.numero };
            if (normaliserNom(e.nom) !== normaliserNom(x.carte.nomEn)) { restes.push({ ...b2, motif: 'numero-nom-contredit' }); continue; }
            if ([x.numeroFiche, x.numeroCm].some(v => v != null && (!/\d+/.test(String(v)) || Number(/\d+/.exec(String(v))[0]) !== Number(e.numero)))) { restes.push({ ...b2, motif: 'numero-contradictoire' }); continue; }
            if (T.dejaServi(x.carte, slug, e.numero)) continue;
            const cleP = `${x.carte._id}|${l.id}|${x.idProduct}`;
            if (vus.has(cleP)) continue;
            vus.add(cleP);
            plan.push({ ...b2, ligneId: l.id, n: Number(e.numero), url: urlScrydex(e.id), voie: 'set-prouve+produit',
                preuve: `${l.hote} ${e.id} (Classic Collection) ; produit ${x.idProduct} « ${x.carte.nomEn} » = carte n°${e.numero} du set d'origine, numéro imprimé « ${e.imprime} » et nom lus à l'œil sur l'image ; set prouvé le ${l.lu} sur ${l.ouvertes ?? l.parProduit.length} images ouvertes ; marque : ${l.marque}` });
            continue;
        }
        if (T.dejaServi(x.carte, slug, numero)) continue;
        // 🔑 Le numéro qui fait l'adresse est celui du PRODUIT Cardmarket (`numeroCm`) — SAUF sur une ligne `numeroDe: 'fiche'` (Classic Collection de CEL : Cardmarket ne numérote pas ces
        // réimpressions, ou écrit « BS 15 »), où c'est le numéro de FICHE sans zéros ET le nom de la carte qui font l'adresse.
        const source = l => (l.numeroDe === 'fiche' ? x.numeroFiche : x.numeroCm);
        let hit = null;
        for (const l of lignes) { const n = adresseDe(l, source(l), x.carte.nomEn); if (n != null) { hit = { l, n }; break; } }
        if (!hit) {
            // un numéro de fiche que la ligne `fiche` connaît MAIS sous un autre nom : jamais l'image d'une autre carte (quatre cartes « 15 »)
            const parFiche = lignes.filter(l => l.numeroDe === 'fiche');
            if (parFiche.some(l => { const n = lireNumero(l, x.numeroFiche); return n != null && l.temoins.some(w => w.n === n); })) { restes.push({ ...base, motif: 'numero-nom-contredit' }); continue; }
            if (x.numeroCm == null || !cleNumero(x.numeroCm)) {
                // ni numéro de produit, ni numéro de fiche lisible par une ligne : un numéro de la forme de la ligne `fiche` sans témoin reste NOMMÉ ; sinon « sans numéro »
                restes.push({ ...base, motif: parFiche.some(l => lireNumero(l, x.numeroFiche) != null) ? 'non-couvert-par-un-temoin' : 'sans-numero' }); continue;
            }
            // la forme est celle du set mais aucun témoin ne couvre ce numéro : RETIRÉ de l'écriture et nommé ; une autre forme (« BS 15 », « 77a ») n'est pas de ce set
            const nonCouvert = lignes.some(l => lireNumero(l, source(l)) != null);
            restes.push({ ...base, motif: nonCouvert ? 'non-couvert-par-un-temoin' : 'numero-hors-set' }); continue;
        }
        if (x.numeroFiche != null) {
            const chiffres = /\d+/.exec(String(x.numeroFiche));
            if (!chiffres || Number(chiffres[0]) !== hit.n) { restes.push({ ...base, motif: 'numero-contradictoire' }); continue; }
        }
        const cle = `${x.carte._id}|${hit.l.id}|${hit.n}`;
        if (vus.has(cle)) continue;
        vus.add(cle);
        plan.push({ ...base, ...((parAdresse.get(`${hit.l.id}|${hit.n}`) || 0) >= 2 ? { noteVariante: NOTE_VARIANTE } : {}), ligneId: hit.l.id, n: hit.n, url: hit.l.hote ? urlScrydex(`${hit.l.idServeur}-${hit.n}`) : urlHires(hit.l.id, hit.n, hit.l.jeton, hit.l.suffixeUrl || ''), voie: 'set-prouve+numero',
            preuve: `${hit.l.hote || 'images.pokemontcg.io'} set ${hit.l.id} n°${hit.n} ; numéro identique au nôtre (${hit.l.numeroDe === 'fiche' ? `fiche ${x.numeroFiche}, nom « ${x.carte.nomEn} » = celui du témoin lu à l'œil` : `Cardmarket ${x.numeroCm}${x.numeroFiche != null ? `, fiche ${x.numeroFiche}` : ''}`}) ; set prouvé à l'œil le ${hit.l.lu} sur ${hit.l.temoins.map(w => `n°${w.n} ${w.nom} ${w.imprime}`).join(', ')} ; marque : ${hit.l.marque}` });
    }
    return { plan, restes };
}

/** Les fichiers d'un set doivent partager dimensions : la MAJORITÉ STRICTE fait la règle, l'écart est refusé et nommé ; sans majorité, rien. */
function dimensionsAdmises(fichiers) {
    const compte = new Map();
    for (const f of fichiers) { const k = `${f.w}×${f.h}`; compte.set(k, (compte.get(k) || 0) + 1); }
    const top = [...compte].sort((a, b) => b[1] - a[1])[0];
    if (!top || top[1] * 2 <= fichiers.length) return { admis: [], refuses: fichiers.map(f => ({ cle: f.cle, motif: `aucune dimension majoritaire (${[...compte].map(([k, n]) => `${k}×${n}`).join(', ')})` })) };
    return {
        reference: top[0],
        admis: fichiers.filter(f => `${f.w}×${f.h}` === top[0]).map(f => f.cle),
        refuses: fichiers.filter(f => `${f.w}×${f.h}` !== top[0]).map(f => ({ cle: f.cle, motif: `${f.w}×${f.h} contre ${top[0]} pour la majorité du set` }))
    };
}

// ── LE CLIENT ───────────────────────────────────────────────────────────────────────────────────────────────────────
const transportFetch = {
    async get(url, { binaire = false } = {}) {
        // 🔑 2026-10-17 « jamais d'API » : la garde est AUSSI ici, au dernier mètre avant fetch — même un appel direct à ce transport ne peut atteindre qu'un hôte d'images
        if (!H.hoteDeLUrl(url)) throw new Error(`${SOURCE} : adresse hors de ce que le client autorise (seuls les hôtes d'images ${H.HOTES_IMAGES.join(', ')}) — aucune requête`);
        let r;
        // `manual` : une redirection n'est JAMAIS suivie
        try { r = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'manual', signal: AbortSignal.timeout(45000) }); }
        catch (e) { throw Object.assign(new Error(`${e.name === 'TimeoutError' ? 'ETIMEDOUT' : e.cause?.code || 'ERR_NETWORK'} ${url}`), { reseau: true }); }
        const cfMitigated = r.headers.get('cf-mitigated');
        if (r.status >= 300 && r.status < 400) return { status: r.status, location: r.headers.get('location'), cfMitigated };
        const type = r.headers.get('content-type') || '';
        if (r.status === 404 || r.status === 410) return { status: r.status, type, cfMitigated };   // le corps est l'image « introuvable » : on ne le lit pas
        if (binaire && r.ok && /^image\//.test(type)) return { status: r.status, type, octets: Buffer.from(await r.arrayBuffer()), cfMitigated };
        return { status: r.status, type, texte: await r.text(), cfMitigated };
    }
};
const DEFI = /Just a moment|cf-chl|challenge-platform|g-recaptcha|h-captcha|hcaptcha|captcha|Attention Required/i;
// …et, SEUL, `cel25c/<n>_A_hires.png` (Classic Collection de Celebrations, lot CEL du 2026-10-13) : le suffixe `_A` n'est autorisé sur aucun autre set.
const CHEMIN_AUTORISE = new RegExp(`^/(robots\\.txt|[a-z0-9-]{2,24}/(?:(?:${JETONS_URL.join('|')})\\d{1,3}|\\d{1,3})_hires\\.png|cel25c/[1-9]\\d{0,2}_A_hires\\.png)$`);
// ➕ 2026-10-17 — images.scrydex.com : robots.txt et `/pokemon/<set énuméré>-<n>[lettre]/large` (la forme relevée dans les réponses déjà en cache), rien d'autre.
const CHEMIN_AUTORISE_SCRYDEX = new RegExp(`^/(robots\\.txt|pokemon/(?:${SETS_SCRYDEX.join('|')})-[1-9]\\d{0,2}[a-z]?/large)$`);
const CHEMINS_PAR_HOTE = Object.freeze({ [HOTE_NOM]: CHEMIN_AUTORISE, [HOTE_SCRYDEX_NOM]: CHEMIN_AUTORISE_SCRYDEX });

/**
 * Le SEUL chemin vers images.pokemontcg.io. Garde FERMÉE : aucune requête sans verrou global lié et tenu ; hôte unique, chemins ÉNUMÉRÉS
 * (robots.txt, /<id>/<n>_hires.png) ; robots.txt lu avant la première image et respecté ; cadence tenue dans une file (jamais sous 2 s) ;
 * un réessai sur une coupure ou un 5xx, puis l'échec LÈVE ; 403, 429, `cf-mitigated`, défi : BLOQUÉ, plus aucune requête.
 */
function fabriquerClientPtcgio({ transport = transportFetch, cadenceMs = CADENCE_MS, reessaiMs = REESSAI_MS, verrou = null, pause = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
    let lie = verrou, file = Promise.resolve(), dernier = 0, compte = 0, bloque = null;
    const robotsDe = new Map();                                // ➕ 2026-10-17 : le robots.txt de CHAQUE hôte ; absent = pas encore lu, null = pas de robots.txt (404)
    const parHote = {};
    let cadenceEff = Math.max(CADENCE_MIN_MS, Number(cadenceMs) || 0);
    function garde() {
        if (bloque) throw bloque;
        if (!lie) throw new Error(`${SOURCE} : aucun verrou global lié (${VERROU_GLOBAL}) — pas de requête sans verrou`);
        if (lie.perdu || !lie.tenu) throw new Error(`${SOURCE} : verrou global ${lie.perdu ? 'PERDU' : 'non tenu'} — pas de requête sans verrou`);
    }
    function chemin(url) {
        let u; try { u = new URL(url); } catch { throw new Error(`${SOURCE} : adresse illisible`); }
        const hote = H.hoteDeLUrl(u.href);          // seuls les deux hôtes d'images, https, sans identifiants ni port : l'API de l'un comme de l'autre ne passe pas ici
        if (!hote || u.search || u.hash || !CHEMINS_PAR_HOTE[hote].test(u.pathname)) throw new Error(`${SOURCE} : « ${u.origin}${u.pathname} » hors de ce que le client autorise (${H.HOTES_IMAGES.join(', ')}, robots.txt et les chemins d'images énumérés)`);
        return { url: u.href, chemin: u.pathname, hote };
    }
    async function une(url, o) {
        garde();
        const hote = H.hoteDeLUrl(url);
        if (!hote) throw new Error(`${SOURCE} : adresse hors de ce que le client autorise — aucune requête`);
        const attente = dernier + cadenceEff - Date.now();
        if (attente > 0) await pause(attente);
        garde();
        dernier = Date.now(); compte++; parHote[hote] = (parHote[hote] || 0) + 1;
        return transport.get(url, o);
    }
    const bloquer = (r, url) => { bloque = Object.assign(new Error(`${SOURCE} BLOQUÉ (HTTP ${r.status}${r.cfMitigated ? `, cf-mitigated ${r.cfMitigated}` : ''}) sur ${url} — on s'arrête, plus aucune requête`), { bloque: true, status: r.status }); throw bloque; };
    const defi = r => r.status === 403 || r.status === 429 || !!r.cfMitigated || (typeof r.texte === 'string' && DEFI.test(r.texte.slice(0, 5000)));
    // 🔑 2026-10-17 : robots.txt se lit POUR CHAQUE HÔTE (le robots.txt d'un hôte ne parle pas pour l'autre) ; renvoie ses règles (null = pas de robots.txt)
    async function assurerRobots(hote) {
        if (robotsDe.has(hote)) return robotsDe.get(hote);
        const adresseRobots = `https://${hote}/robots.txt`;
        const r = await une(adresseRobots, {});
        if (defi(r)) bloquer(r, adresseRobots);
        if (r.status === 404 || r.status === 410) { robotsDe.set(hote, null); return null; }
        if (r.status !== 200) throw Object.assign(new Error(`${r.status} ${adresseRobots} : robots.txt illisible — on ne peut pas conclure, aucune image`), { robots: true, status: r.status });
        const texteRobots = r.texte ?? '';
        const d = T.delaiDesRobots(texteRobots, UA);
        if (d && d > CRAWL_DELAY_MAX_S) { bloque = Object.assign(new Error(`${SOURCE} : robots.txt de ${hote} demande un Crawl-delay de ${d} s — on s'arrête`), { bloque: true, robots: true }); throw bloque; }
        if (d) cadenceEff = Math.max(cadenceEff, d * 1000);
        robotsDe.set(hote, texteRobots);
        return texteRobots;
    }
    const enFile = fn => { const p = file.then(fn); file = p.catch(() => { }); return p; };
    async function image(url) {
        garde();
        const c = chemin(url);
        return enFile(async () => {
            const robots = await assurerRobots(c.hote);
            if (!T.autoriseParRobots(robots, c.chemin, UA)) throw Object.assign(new Error(`${SOURCE} : robots.txt de ${c.hote} interdit ${c.chemin} — aucune requête`), { robots: true });
            let r;
            try { r = await une(c.url, { binaire: true }); }
            catch (e) { if (!e.reseau) throw e; await pause(reessaiMs); r = await une(c.url, { binaire: true }); }
            if (r.status >= 500) { await pause(reessaiMs); r = await une(c.url, { binaire: true }); }
            if (defi(r)) bloquer(r, c.url);
            if (r.status >= 300 && r.status < 400) throw new Error(`${SOURCE} : redirection ${r.status} non suivie sur ${c.url}`);
            if (r.status === 404 || r.status === 410) return null;
            if (r.status >= 400) throw Object.assign(new Error(`${r.status} ${c.url}`), { status: r.status });
            if (!r.octets) throw new Error(`${SOURCE} : « ${r.type} » n'est pas une image (${c.url})`);
            if (H.estDosDeCarte(r.octets)) return null;     // 2026-10-17 : le « introuvable » du serveur d'images scrydex est le dos d'une carte, en HTTP 200 — un trou ne le reçoit jamais
            return r.octets;
        });
    }
    return { image, lier(v) { lie = v; }, compteRequetes: () => compte, requetesParHote: () => ({ ...parHote }), cadence: () => cadenceEff, bloque: () => bloque };
}

// ── L'IDENTIFIANT ET LE RETRAIT EN UN LOT ───────────────────────────────────────────────────────────────────────────────
const idImagePtcgio = (slug, carteId, numero) => `${SOURCE}/${slug}/${carteId}/${String(numero ?? '').replace(/[^0-9A-Za-z]/g, '') || 'sans-numero'}/en`;
/** Ce qu'un retrait en un lot retire : les entrées `cartes.images` de CETTE source ET de CE lot — rien d'autre — et leurs clés R2 (vignette comprise). */
function planRetraitPtcgio(cartes) {
    const touchees = [], cles = [];
    let entrees = 0;
    for (const c of cartes) {
        const es = (c.images || []).filter(e => e.source === SOURCE && e.lot === LOT);
        if (!es.length) continue;
        touchees.push(c._id); entrees += es.length; cles.push(...es.flatMap(e => [e.cleR2, e.vignette?.cleR2].filter(Boolean)));
    }
    return { cartes: touchees, entrees, cles };
}

module.exports = {
    SOURCE, HOTE, HOTE_NOM, HOTE_SCRYDEX, HOTE_SCRYDEX_NOM, SETS_SCRYDEX, ligneActive, hoteDeLUrl: H.hoteDeLUrl, urlScrydex, transportFetch, LOT, MENTION, CADENCE_MS, CADENCE_MIN_MS, VERROU_GLOBAL, VERROU_GLOBAL_MS, ID_ALERTE, UA,
    TABLE_PTCGIO, NOTE_VARIANTE, JETONS_URL, lignesDe, lireNumero, adresseDe, numerosDuSet, urlHires, verdictDuSet, planifierPtcgio, dimensionsAdmises,
    fabriquerClientPtcgio, idImagePtcgio, planRetraitPtcgio
};
