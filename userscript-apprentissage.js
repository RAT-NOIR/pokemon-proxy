// ==UserScript==
// @name         Rat-Market — Apprentissage manuel Cardmarket
// @namespace    rat-market
// @version      1.9
// @description  Apprend chaque page de galerie Singles dès son chargement — une vignette sans image comprise, par son lien et son titre —, suit les produits CIBLES (jamais appris, slug vide), et tient un JOURNAL par page (📥 pour l'exporter). Lit UNIQUEMENT la page ouverte — ne navigue jamais.
// @match        https://www.cardmarket.com/*/Pokemon/Products/Singles*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @connect      pokemon-proxy-ratnoir666.onrender.com
// @run-at       document-idle
// ==/UserScript==

// ============================================================
// 1.9 — 2026-09-26 : UN PRODUIT N'EST PLUS JAMAIS ÉCARTÉ À CAUSE DE SON IMAGE
// ============================================================
// Ton journal 1.8 (rat-market-journal-2026-09-26-15-15.json) : 218 produits ÉCARTÉS parce que leur image était
// « cardImageNotAvailable » — alors que leur LIEN porte le slug et leur TITRE le numéro (« Shiinotic-V2-SUM17 », « Lampignon
// (SUM 17) »). L'idProduct vient de l'URL de l'image : sans image, on ne le lit pas. La 1.9 envoie quand même la vignette —
// idProduct null, slug, numéro et code de son TITRE, `sansImage: true` — et c'est le SERVEUR qui déduit l'idProduct
// (collecte-cartes/deduire-produit.js, la règle même qui a appris 171 de ces 218 depuis le journal) : l'expansion par le slugSet,
// le produit par le nom du slug parmi ceux qui n'ont pas encore de slug, un seul, et ses frères déjà appris comme témoins. Ce
// qu'il ne peut pas déduire, il le dit (`nonDeduites`), et le panneau aussi. Seule une vignette SANS LIEN reste écartée.
// Deux sans-image d'une même page ne se fondent plus en une à l'envoi (le lot se dédoublonnait par idProduct).
// 🔴 SECONDE RELECTURE (2026-09-26, nuit), avant déploiement :
// · la VARIANTE n'est plus envoyée : la copie de la règle exigeait un tiret après « Vk » (« Mewtwo-V-UNION-V3 » rendait null) ; le
//   serveur la relit du slug, comme le numeroUrl — une seule règle, la sienne ;
// · un ÉCHEC de la déduction (`erreurDeduction`) ne marque plus la page : ses sans-image repartent au prochain chargement ; l'erreur
//   et les raisons des non déduites sont dans le panneau ET au journal ;
// · une cible SANS IMAGE que le serveur a déduite (`idsDeduits`) est marquée faite ;
// · le panneau dit sa version.
//
// ============================================================
// 1.8 — 2026-09-25 (soir) : « CERTAINS SETS N'ONT PAS PROGRESSÉ », ET RIEN NE PERMETTAIT DE DIRE POURQUOI
// ============================================================
// Mesuré en base après ta passe : 63 cibles faites sur 1 670, et UN seul set (XY-P, 14 produits neufs en 3 envois) a reçu du
// neuf. Mais ni le serveur (il n'écrit que sa console Render) ni la 1.7 (une marque par page : heure et nombre de cartes LUES)
// ne gardaient ce que chaque page portait : impossible de départager un filtre de Cardmarket, une pagination tronquée, une page
// non envoyée ou une vignette jetée. La 1.8 ne change pas l'apprentissage ; elle le rend lisible :
// · UN JOURNAL PAR PAGE CHARGÉE (📥 dans le panneau pour le télécharger) : vignettes présentes, cartes lues, vignettes ÉCARTÉES
//   (lien + attributs de l'image), total que Cardmarket annonce, filtres actifs de son formulaire, paramètres de l'URL, cibles
//   portées, et la réponse du serveur (ou le refus, avec son statut) ;
// · le panneau dit « N vignettes · M lues », et en rouge si Cardmarket annonce MOINS de produits que l'export du 24/09 n'en
//   compte pour cette expansion — la signature d'un filtre ou d'une limite de la page ;
// · une vignette dont l'image ne se lit pas n'est plus jetée sans un mot : lecture d'origine d'abord, puis les autres attributs
//   de chargement et formats (les deux nombres du chemin doivent être égaux), et le reste est compté.
//
// ============================================================
// 1.7 RÉÉCRITE LE 2026-09-25 — LE NOUVEL APPRENTISSAGE : LES PRODUITS CIBLES
// ============================================================
// La liste n'est plus « des expansions à parcourir » mais des PRODUITS à faire apprendre : 1 346 jamais appris (absents de
// numeros_cartes, donc sans numéro ni slug) et 324 au slug vide (appris, joints, mais le site ne lit pas leur numéro), sur 184
// expansions — mesurés le 2026-09-25 à 04:56 UTC par la table maîtresse (règles du site importées). Tes 8 d'abord (DRI, ASC,
// JTG, POR, PFL, MEG, PBL, xPRE), puis les expansions dont la ligne de table est admise, refusée, absente.
// · Le panneau dit, pour l'expansion ouverte : combien de cibles il reste, combien la PAGE en porte (à envoyer), et leurs noms.
// · Une cible compte comme faite quand une page qui la porte a été ENVOYÉE AVEC SUCCÈS (jamais à la simple lecture).
// · Une expansion est « faite » quand toutes ses cibles le sont (ou que le serveur la dit complète) : la suivante s'affiche.
// · « Réapprendre » reste utile : une page déjà apprise AVANT cette version peut porter une cible au slug vide — la 1.7
//   renvoie d'elle-même une page déjà marquée si elle porte une cible non faite.
// Rien d'autre ne change : une page par envoi, la file locale, la reprise sur 503/429/réseau, jamais de navigation.
//
// ============================================================
// CE QUI A CHANGÉ EN 1.7 — 2026-09-24, UNNUMBERED PROMOS (4170) NE S'APPRENAIT PAS
// ============================================================
// Aucune carte n'y a de numéro, ni dans le titre ni dans le slug (« Venusaur-V1-UNP ») : le serveur jetait le lot entier
// (« sans numéro ignorées »), et la 1.6 marquait pourtant la page « apprise ». Le serveur apprend désormais une carte sans
// numéro par son SLUG (numéro null, jamais inventé). Une page marquée par une version antérieure dont AUCUNE carte n'a de
// numéro de titre n'avait donc rien écrit : la 1.7 la considère comme NON apprise et la renvoie au chargement.
// Le bilan dit « N sans numéro : appris par leur slug » ; « ignorées » ne désigne plus que les cartes sans slug ni numéro.

// ============================================================
// CE QUI A CHANGÉ EN 1.6 — 2026-09-24, LE PANNEAU DISAIT TROIS CHOSES FAUSSES SUR 30th Celebration
// ============================================================
// 1. « terminée ✅ » à 84 % : la 1.5 appelait « terminée » une galerie dont la dernière page était apprise. Ses 191
//    produits l'étaient tous ; 30 rééditions « Classic Collection » (Charizard 30CBS-4…) n'ont simplement pas de numéro
//    dans leur titre. Le panneau montre désormais DEUX nombres — appris / numérotés — et ne dit « complète » que si tous
//    les produits du catalogue sont appris (champ `appris` de la couverture, serveur du 2026-09-24).
// 2. « 📤 Envoi : 30 cartes… » restait affiché après le succès : on croyait la page renvoyée. Remplacé à l'envoi.
// 3. « Page déjà apprise » s'affichait pour la page qu'on VENAIT d'envoyer. Il ne se dit plus que d'une page apprise
//    avant ce chargement — c'est la seule qui n'est pas renvoyée.

// ============================================================
// CE QUI A CHANGÉ EN 1.5 — 2026-09-24, POUR LE PASSAGE DES 30 EXPANSIONS JAMAIS APPRISES
// ============================================================
// 0. « Identifiant utilisateur manquant » : c'était la 1.3 en service. Le serveur exige `userId` depuis 707692a ;
//    la 1.4 l'envoyait déjà, la 1.5 le garde (généré une fois, persisté par GM_setValue).
// 1. L'APPRENTISSAGE PART AU CHARGEMENT DE LA PAGE (case « auto », cochée par défaut). On ne clique plus : on tourne
//    les pages. Le script lit toujours la seule page ouverte et ne navigue jamais de lui-même.
// 2. UN ENVOI PAR PAGE, PAS PAR 25 CARTES. Le limiteur du serveur compte des REQUÊTES (120/h/IP), pas des cartes :
//    découper une page en lots de 25 dépensait 2 à 4 requêtes pour rien. Jusqu'à 200 cartes par envoi (~50 Ko, sous
//    la limite de 100 Ko d'express.json()).
// 3. UNE PAGE LUE N'EST JAMAIS PERDUE (§38 : une source a une cadence ET une reprise). Chaque page lue entre dans une
//    file locale (GM_setValue) AVANT l'envoi et n'en sort qu'au succès :
//      · 503 « le serveur se réveille » (Render endormi) : on interroge /ping jusqu'à ce que Mongo réponde, puis on
//        renvoie — le serveur refuse un lot à froid plutôt que de l'écrire amputé ;
//      · 429 (limite de 120/h) : reprise AUTOMATIQUE à l'heure que le serveur donne (en-tête RateLimit-Reset). Les
//        pages lues entre-temps partent GROUPÉES, jusqu'à 200 cartes : dix pages pour une seule requête ;
//      · coupure réseau : trois essais à 15 s, puis reprise dans 2 min ;
//      · 400 / 401 / erreur serveur : arrêt et message — ce sont des défauts à corriger, pas à marteler.
//    La file survit à la fermeture de l'onglet : elle repart au prochain chargement d'une page Singles.
// 4. UNE PAGE DÉJÀ APPRISE N'EST PAS RENVOYÉE (le budget de 120/h sert aux pages neuves) ; « Réapprendre » force.
// 5. LA LISTE DU 25/09 EST DANS LE SCRIPT (APPRENTISSAGE-2026-09-25.md) : position de l'expansion ouverte, nombre de
//    terminées, et la suivante. Son lien est l'URL du FILTRE D'EXPANSION du site (`?idCategory=51&idExpansion=N`, celle
//    que live-cardmarket.js ouvrait, SANS `perSite` — le paramètre qui avait valu un ban) : c'est toi qui cliques.
// 6. Touche N : ouvre le lien « page suivante » QUE LA PAGE AFFICHE. Un raccourci pour ta main, pas une navigation.
// 7. La page « 1015 » de Cardmarket est reconnue : le panneau dit de s'arrêter, la file et la liste sont gardées.
// 8. Le serveur COMPLÈTE désormais les lignes exactes sans slug (slug, slugSet, nomFr, variante — jamais le numéro) :
//    246 lignes étaient sautées à chaque passage. Le panneau les compte (« complétées »).
//
// ⚠️ CE QUE LA ROUTE NE FAIT PAS, ET QUE LE PANNEAU DIT : une carte SANS numéro (ni dans le titre, ni dans le slug)
// n'est pas écrite (« sans numéro ignorées »). Les énergies de base (6697, 5415) risquent de n'apporter rien.

// ============================================================
// CE QUI RESTE DE 1.3 ET 1.4 — LES RÈGLES QUI TIENNENT
// ============================================================
// · La query string est retirée du slug (« ?language=2 » donnait le numéro « 2 »).
// · Le numeroUrl n'est PAS envoyé : le serveur le recalcule (scoring.numeroDepuisSlug), la règle vit à un seul endroit.
// · Le numéro du TITRE (« Nom (CODE 176) ») est la vraie prise ; le panneau compte les cartes qui en ont un.
// · Aucun paramètre d'URL fabriqué pour tourner les pages : on suit le lien « page suivante » de la page.
// · Un lot sur plusieurs expansions n'a pas de couverture : c'est dit, jamais tu.

(function () {
  'use strict';

  // La version, écrite UNE fois (égale à l'en-tête @version) : l'export, le journal et le panneau la lisent — le panneau ne la disait pas.
  const VERSION = '1.9';
  // ===================== À CONFIGURER =====================
  const URL_API = 'https://pokemon-proxy-ratnoir666.onrender.com';
  const JETON = 'K10-Sr7izvo-CG3bSRfCbhSnw8KTNrbJ';
  const MAX_CARTES_PAR_ENVOI = 200;
  const SEUIL_TERMINEE = 90;           // % de produits numérotés à partir duquel une expansion est « terminée »
  const REVEIL_MAX_MS = 120000, PAUSE_REVEIL_MS = 5000, ESSAIS_RESEAU = 3;

  // La liste du 2026-09-26 (LISTE-SEUL-CARDMARKET-2026-09-26.json, generer-cibles-userscript.js) : ce que SEUL Cardmarket peut t'apprendre ET
  // que ta passe peut VOIR (une offre au guide du 30/08) — 143 jamais appris, 277 au slug vide, 59 expansions, triées par VALEUR
  // (prix de tendance du guide). Les 598 invisibles (aucune offre : absents des listes Cardmarket) n'y sont pas.
  const LISTE = [[3324,"SM-P Sun-Moon-Promos — 77 slug vide · 12475 €"],
    [4218,"BW-P BW-Promos — 3 slug vide · 2180 €"],
    [4159,"XY-P XY-Promos — 59 jamais appris, 1 slug vide · 1684 €"],
    [6381,"mC MEGA-Start-Deck-100-Battle-Collection — 77 slug vide · 1075 €"],
    [4168,"VS Pokemon-CardVS — 1 slug vide · 500 €"],
    [5201,"CRZ Crown-Zenith — 13 slug vide · 476 €"],
    [3214,"S-P Sword-Shield-Promos — 25 slug vide · 465 €"],
    [4382,"FST Fusion-Strike — 4 slug vide · 174 €"],
    [2916,"SWSH SWSH-Black-Star-Promos — 4 slug vide · 157 €"],
    [5802,"SCR Stellar-Crown — 1 slug vide · 80 €"],
    [4347,"CEL Celebrations — 4 slug vide · 72 €"],
    [5944,"PRE Prismatic-Evolutions — 2 slug vide · 63 €"],
    [6443,"POR Perfect-Order — 2 slug vide · 54 €"],
    [1542,"MA EX-Team-Magma-vs-Team-Aqua — 2 slug vide · 47 €"],
    [5861,"RAID Raid-Battle — 3 jamais appris · 45 €"],
    [5700,"PCG8 Miracle-Crystal — 1 slug vide · 44 €"],
    [5241,"SVP SV-Black-Star-Promos — 2 slug vide · 35 €"],
    [1577,"BCR Boundaries-Crossed — 3 slug vide · 30 €"],
    [5212,"SV-P Scarlet-Violet-Promos — 1 slug vide · 28 €"],
    [6232,"MEP MEP-Black-Star-Promos — 1 jamais appris · 25 €"],
    [6517,"CRI Chaos-Rising — 1 slug vide · 22 €"],
    [4252,"smG Ultra-Sun-Ultra-Moon-Deck-Build-Boxes — 14 jamais appris · 16 €"],
    [6096,"DRI Destined-Rivals — 1 slug vide · 15 €"],
    [1845,"MCD17 McDonalds-Collection-2017 — 1 slug vide · 12 €"],
    [1552,"CG EX-Crystal-Guardians — 1 slug vide · 9 €"],
    [4074,"CP4 Premium-Champion-Pack — 9 jamais appris · 8 €"],
    [4099,"XYf Golduck-BREAK-Palkia-EX-Combo-Deck — 1 jamais appris · 5 €"],
    [4348,"MCVS Movie-Commemoration-VS-Pack — 2 jamais appris · 4 €"],
    [1745,"SUM Sun-Moon — 2 jamais appris · 4 €"],
    [4154,"HXY XY-Beginning-Set — 2 jamais appris · 4 €"],
    [1521,"PHF Phantom-Forces — 1 jamais appris · 3 €"],
    [4089,"20th BREAK-Starter-Pack — 7 slug vide · 2 €"],
    [1579,"PLF Plasma-Freeze — 1 jamais appris · 2 €"],
    [4388,"sI100 Start-Deck-100 — 7 slug vide · 2 €"],
    [4313,"DP3 Shining-Darkness — 2 jamais appris · 2 €"],
    [1544,"FL EX-FireRed-LeafGreen — 1 slug vide · 2 €"],
    [4317,"DP2 Secret-of-the-Lakes — 2 jamais appris · 2 €"],
    [5519,"sv4a Shiny-Treasure-ex — 23 slug vide · 1 €"],
    [4345,"s8a 25th-Anniversary-Collection — 8 jamais appris · 1 €"],
    [3974,"smD Ash-vs-Team-Rocket-Deck-Kit — 4 jamais appris · 1 €"],
    [4149,"X30 Xerneas-Half-Deck — 1 jamais appris · 1 €"],
    [1526,"FO Fossil — 1 slug vide · 1 €"],
    [1800,"GRI Guardians-Rising — 1 slug vide · 1 €"],
    [4466,"G1 Leaders-Stadium — 1 jamais appris · 1 €"],
    [5385,"OBF Obsidian-Flames — 2 slug vide · 1 €"],
    [5223,"SVI Scarlet-Violet — 1 slug vide · 1 €"],
    [4316,"BtD Bastiodon-the-Defender — 1 jamais appris · 1 €"],
    [4144,"Y30 Yveltal-Half-Deck — 1 jamais appris · 0 €"],
    [6099,"151C Collect-151 — 1 slug vide · 0 €"],
    [4139,"XYa MCharizard-EX-Mega-Battle-Deck — 2 jamais appris · 0 €"],
    [4134,"XYb Hyper-Metal-Chain-Deck — 1 jamais appris · 0 €"],
    [4243,"sH Sword-Shield-Family-Pokemon-Card-Game — 1 jamais appris · 0 €"],
    [5890,"BA24 Battle-Academy-2024 — 1 jamais appris · 0 €"],
    [5621,"svIba Scarlet-Violet-Battle-Academy — 1 jamais appris · 0 €"],
    [6409,"xm2a MEGA-Dream-ex-Additionals — 2 slug vide · 0 €"],
    [6673,"S-P/ID Sword-Shield-Indonesian-Promos — 17 jamais appris · 0 €"],
    [4240,"sp4 Eevee-Heroes-VMAX-Special-Set — 4 jamais appris · 0 €"],
    [6582,"CSM2DC Shining-Synergy-GX-Starter-Deck — 4 slug vide · 0 €"],
    [6127,"SV-P/ID Scarlet-Violet-Indonesian-Promos — 1 jamais appris · 0 €"]];

  // Les produits CIBLES, par expansion : [idProduct, « J » jamais appris | « V » slug vide, nom du catalogue], les plus chers d'abord.
  const CIBLES = {"1521":[[281821,"J","Feraligatr (Theme Deck)"]],"1526":[[273916,"V","Slowpoke [Spacing Out | Scavenge]"]],"1542":[[275987,"V","Team Magma's Houndoom [Roasting Heat | Magma Spurt]"],[276011,"V","Team Magma's Houndoom [Target Scorch | Damage Burn]"]],"1544":[[276221,"V","Pidgeotto [Clutch | Cutting Wind]"]],"1552":[[277109,"V","Venusaur [Chlorophyll | Green Blast | Toxic Sleep]"]],"1577":[[280607,"V","Charizard [Split Bomb | Scorching Fire]"],[280610,"V","Victini [Collect | Relentless Flames]"],[280693,"V","Meowth [Fake Out | BCR]"]],"1579":[[449553,"J","Frozen City"]],"1745":[[295426,"J","Oranguru [Instruct | Psychic]"],[295315,"J","Rowlet [Tackle | Leafage]"]],"1800":[[297474,"V","Victini [Victory Star | V-Flame]"]],"1845":[[301847,"V","Pikachu [Thunder Wave | Electro Ball]"]],"2916":[[690365,"V","Bulbasaur [Shake and Gather | Illustration Contest 2022]"],[437169,"V","Cinccino [Make Do | Energy Assist]"],[546936,"V","Cherrim [Spring Bloom | Seed Bomb]"],[516334,"V","Donphan [Earthquake | Heavy Impact]"]],"3214":[[855003,"V","Champions Festival [Duckboat]"],[571391,"V","Jolteon VMAX [Max Thunder Rumble]"],[571389,"V","Flareon VMAX [Max Detonate]"],[463119,"V","Hatenna [Find a Friend | Psyshot]"],[650951,"V","Hisuian Basculin [Submerge Silently | Bite]"],[570878,"V","Cheryl"],[574590,"V","Klara"],[605825,"V","Fire Energy"],[605829,"V","Fighting Energy"],[605830,"V","Darkness Energy"],[666790,"V","Cyllene"],[671881,"V","Barry"],[675889,"V","Archeops [Primal Turbo | Speed Wing]"],[675890,"V","Double Turbo Energy"],[738957,"V","Grass Energy"],[738962,"V","Fighting Energy"],[738963,"V","Darkness Energy"],[468299,"V","Darkness Energy"],[525030,"V","Grass Energy"],[525035,"V","Fire Energy"],[525055,"V","Fighting Energy"],[525195,"V","Gym Trainer"],[576798,"V","Escape Rope"],[605824,"V","Grass Energy"],[696018,"V","Float Stone"]],"3324":[[470004,"V","Mimikyu [Scream]"],[469964,"V","Yokohama's Pikachu [Sightseeing | Thunder Jolt]"],[469959,"V","Yokohama's Pikachu [Deep Sea Exploration | Tail Whap]"],[471479,"V","Pikachu [Quick Attack | Thunderbolt]"],[471609,"V","Acerola"],[471679,"V","Champions Festival [Duckboat]"],[469939,"V","Pikachu [Thunder Shock]"],[471659,"V","Mewtwo [Mind Report | Psyshock]"],[471514,"V","Pikachu [Thunder Jolt]"],[470159,"V","Abareru-kun"],[471449,"V","Mewtwo GX [Super Psy Bolt | Psycrush GX]"],[471599,"V","Pikachu GX [Agility | Volt Tackle | Tail Break GX]"],[471029,"V","Detective Pikachu [Scout | Surprise Attack]"],[471684,"V","Champions Festival [Duckboat]"],[471009,"V","Cynthia"],[471019,"V","Detective Pikachu [Scout | Surprise Attack]"],[470169,"V","Jirachi [Stellar Wish | Slap]"],[469954,"V","Zapdos [Thunder Shock | Drill Peck]"],[471519,"V","Pikachu [Thunder Jolt]"],[469949,"V","Articuno [Gust | Sheer Cold]"],[468679,"V","Rowlet [Tackle | Leafage]"],[470174,"V","Sylveon GX [Magical Ribbon | Fairy Wind | Plea GX]"],[471504,"V","Litten [Find | Flare]"],[471074,"V","Psychic Energy"],[471394,"V","Fairy Energy"],[471084,"V","Darkness Energy"],[470039,"V","Tate & Liza"],[679289,"V","Mewtwo GX [Telekinesis | Reigning Pulse | Psychic Nova GX]"],[471524,"V","Eevee [Gnaw]"],[471444,"V","Erika"],[471534,"V","Water Energy"],[471484,"V","Red's Challenge"],[469899,"V","Leafeon GX [Breath of the Leaves | Solar Beam | Grand Bloom GX]"],[471049,"V","Yveltal [Derail | Clutch]"],[471644,"V","Pokémon Communication"],[469704,"V","Samson Oak"],[470994,"V","Choice Helmet"],[469904,"V","Glaceon GX [Freezing Gaze | Frost Bullet | Polar Spear GX]"],[469739,"V","Mr. Mime GX [Magic Evens | Breakdown | Life Trick GX]"],[471654,"V","Volcanion [Flare Starter | High-Heat Blast]"],[471039,"V","Janine"],[471584,"V","Hapu"],[470984,"V","Pokémon Communication"],[826648,"V","Tornadus GX [Gust | Wild Fury | Destructive Cyclone GX]"],[470079,"V","Ear-Ringing Bell"],[470149,"V","Blaine's Quiz Show"],[470059,"V","Carvanha [Agility]"],[471429,"V","Dragonium Z: Dragon Claw"],[470179,"V","Erika's Hospitality"],[471419,"V","Crabrawler [Jab | Confront]"],[468504,"V","Oranguru [Instruct | Psychic]"],[468564,"V","Togedemaru [Nuzzle | Rollout]"],[468569,"V","Choice Band"],[468764,"V","Mareanie [Peck | Pin Missile]"],[468784,"V","Hala"],[468829,"V","Ultra Ball"],[468854,"V","Professor Kukui"],[468864,"V","Rainbow Energy"],[469144,"V","Tapu Koko [Flying Flip | Electric Ball]"],[469159,"V","Water Energy"],[469189,"V","Fairy Energy"],[469279,"V","Tapu Lele [Psywave | Magical Swap]"],[469289,"V","Tapu Koko [Flying Flip | Electric Ball]"],[469379,"V","Grass Energy"],[469389,"V","Fire Energy"],[469424,"V","Guzma"],[469464,"V","Darkness Energy"],[469659,"V","Necrozma GX [Light's End | Prismatic Burst | Black Ray GX]"],[469779,"V","Zekrom GX [Bullet Uppercut | Swift Bolt Strike | Rampage Bolt GX]"],[469789,"V","Mallow"],[469889,"V","Cynthia"],[469894,"V","Poipole [Eye Opener | Peck]"],[469914,"V","Escape Board"],[469924,"V","Pal Pad"],[470974,"V","Order Pad"],[471004,"V","Judge"],[471069,"V","Lightning Energy"]],"3974":[[561370,"J","Fighting Energy"],[561373,"J","Water Energy"],[561371,"J","Lightning Energy"],[561372,"J","Psychic Energy"]],"4074":[[562816,"J","Fighting Energy"],[562818,"J","Darkness Energy"],[562819,"J","Fairy Energy"],[562811,"J","Grass Energy"],[562812,"J","Fire Energy"],[562813,"J","Water Energy"],[562814,"J","Lightning Energy"],[562815,"J","Psychic Energy"],[562817,"J","Metal Energy"]],"4089":[[563114,"V","Psychic Energy"],[563115,"V","Fairy Energy"],[563111,"V","Water Energy"],[563109,"V","Grass Energy"],[563113,"V","Fighting Energy"],[563110,"V","Fire Energy"],[563112,"V","Lightning Energy"]],"4099":[[563253,"J","Water Energy"]],"4134":[[563958,"J","Metal Energy"]],"4139":[[564302,"J","Fire Energy"],[564303,"J","Darkness Energy"]],"4144":[[564408,"J","Darkness Energy"]],"4149":[[564426,"J","Fairy Energy"]],"4154":[[564604,"J","Metal Energy"],[564600,"J","Fairy Energy"]],"4159":[[553214,"J","Cosplay Pikachu [Quick Attack | Synchro Appeal]"],[553948,"J","Pikachu Libre [Quick Attack | Flying Elekick]"],[786637,"J","MGarchomp EX [Crimson Edge]"],[553853,"J","Lugia [Gust | Aeroblast]"],[864131,"J","Empoleon BREAK [Emperor's Command]"],[864133,"J","Crobat BREAK [Silent Bite]"],[553958,"J","Volcanion [Power Heater | Steam Artillery]"],[553349,"J","Rayquaza Spirit Link"],[553254,"J","Treecko [Quick Attack]"],[786633,"J","Team Flare Grunt"],[864132,"J","Crobat BREAK [Silent Bite]"],[553928,"J","Captivating Poké Puff"],[848304,"J","Bronzong [Metal Links | Hammer In]"],[553813,"J","Assault Vest"],[787870,"J","Fire Energy"],[787874,"J","Lightning Energy"],[787881,"J","Darkness Energy"],[553618,"V","Aerodactyl EX [Rock Smash | Land Crush]"],[553763,"J","Rainbow Energy"],[552754,"J","Dedenne [Nuzzle | Spiral Drain]"],[552789,"J","Talonflame [Devastating Wind | Flare Blitz]"],[553713,"J","Evosoda"],[554163,"J","Lass's Special"],[664952,"J","Psyduck [Stampede]"],[787841,"J","Fire Energy"],[787847,"J","Darkness Energy"],[787856,"J","Fire Energy"],[787860,"J","Lightning Energy"],[787861,"J","Psychic Energy"],[787864,"J","Darkness Energy"],[787865,"J","Metal Energy"],[552549,"J","Giovanni's Scheme"],[552739,"J","Honedge [Swords Dance | Slash]"],[552784,"J","Gogoat [Push Down | Forest Press]"],[552834,"J","Hand Scope"],[552839,"J","Professor Sycamore"],[552929,"J","Enhanced Hammer"],[552944,"J","Binacle [Sand Attack | Mud-Slap]"],[553304,"J","Energy Recycler"],[553394,"J","Heavy Boots"],[553568,"J","Energy Reset"],[553768,"J","Eco Arm"],[553933,"J","Max Elixir"],[679767,"J","Mega Turbo"],[680655,"J","Fighting Fury Belt"],[787823,"J","Grass Energy"],[787824,"J","Fire Energy"],[787832,"J","Fairy Energy"],[787836,"J","Grass Energy"],[787843,"J","Water Energy"],[787844,"J","Lightning Energy"],[787849,"J","Metal Energy"],[787850,"J","Fairy Energy"],[787854,"J","Grass Energy"],[787857,"J","Water Energy"],[787863,"J","Fighting Energy"],[787882,"J","Metal Energy"],[882110,"J","Muscle Band"],[882121,"J","Inkay [Happy Open! | Well, It's Okay]"],[882122,"J","Pikachu [Happy Gift! | Thunderbolt]"]],"4168":[[554581,"V","Lance's Charizard [Flamethrower]"]],"4218":[[572021,"V","Mewtwo [Battle Carnival]"],[572025,"V","Mewtwo EX [X Ball | Psydrive]"],[817863,"V","Champions Festival [Duckboat]"]],"4240":[[564181,"J","Fire Energy"],[564182,"J","Water Energy"],[564183,"J","Lightning Energy"],[564184,"J","Psychic Energy"]],"4243":[[571576,"J","Fire Energy"]],"4252":[[565036,"J","N"],[565030,"J","VS Seeker"],[565045,"J","Pokémon Ranger"],[565047,"J","Rough Seas"],[565035,"J","Brigette"],[565046,"J","Wally"],[565039,"J","Korrina"],[565048,"J","Forest of Giant Plants"],[565042,"J","Ninja Boy"],[565044,"J","Professor Sycamore"],[565025,"J","Special Charge"],[565038,"J","Xerosic"],[565043,"J","Skyla"],[565051,"J","Double Dragon Energy"]],"4313":[[698901,"J","Darkness Energy [Special]"],[698902,"J","Metal Energy [Special]"]],"4316":[[698954,"J","Switch"]],"4317":[[699115,"J","Darkness Energy [Special]"],[699116,"J","Metal Energy [Special]"]],"4345":[[577398,"J","Lightning Energy"],[577396,"J","Fire Energy"],[577394,"J","Grass Energy"],[577397,"J","Water Energy"],[577400,"J","Psychic Energy"],[577401,"J","Fighting Energy"],[577402,"J","Darkness Energy"],[577403,"J","Metal Energy"]],"4347":[[576780,"V","Shining Magikarp [Gold Scale | Dragon Bond]"],[576795,"V","Tapu Lele GX [Wonder Tag | Energy Drive | Tapu Cure GX]"],[576793,"V","Xerneas EX [Break Through | X Blast]"],[576782,"V","Rocket's Admin."]],"4348":[[570924,"J","Switch"],[570923,"J","Potion"]],"4382":[[582981,"V","Celebi V [Leaflet Dance | Slash Back]"],[653293,"V","Quick Ball"],[883765,"V","Galarian Obstagoon [Silence | Merciless Strike]"],[653292,"V","Quick Ball"]],"4388":[[588140,"V","Water Energy"],[588134,"V","Fighting Energy"],[588138,"V","Metal Energy"],[588139,"V","Psychic Energy"],[588137,"V","Lightning Energy"],[588136,"V","Grass Energy"],[588135,"V","Fire Energy"]],"4466":[[605156,"J","Brock's Mankey [Fidget | Karate Chop]"]],"5201":[[691947,"V","Origin Forme Palkia VSTAR [Subspace Swell | Star Portal]"],[691889,"V","Mew [Mysterious Tail | Psyshot]"],[691920,"V","Glaceon VSTAR [Icicle Shot | Crystal Star]"],[691916,"V","Entei V [Fleet-Footed | Burning Rondo]"],[691936,"V","Hisuian Zoroark VSTAR [Ticking Curse | Phantom Star]"],[691931,"V","Hisuian Samurott V [Basket Crash | Shadow Slash]"],[691882,"V","Magmortar [Mega Punch | Boltsplosion]"],[695867,"V","Fighting Energy"],[695862,"V","Grass Energy"],[695863,"V","Fire Energy"],[695865,"V","Lightning Energy"],[695868,"V","Darkness Energy"],[695869,"V","Metal Energy"]],"5212":[[841254,"V","Pikachu ex [Tail Whap | Thunder]"]],"5223":[[712642,"V","Annihilape [Rage Fist | Dynamite Punch]"]],"5241":[[850982,"V","Espeon ex [Psych Out | Amazez]"],[810392,"V","Eevee ex [Rainbow DNA | Coruscating Quartz]"]],"5385":[[725102,"V","Toedscruel ex [Protective Mycelium | Colony Rush]"],[804328,"V","Espeon [Psychic Assault | Psy Bolt]"]],"5519":[[746564,"V","Penny"],[746541,"V","Nest Ball"],[746539,"V","Superior Energy Retrieval"],[746442,"V","Luxio [Zap Kick | Head Bolt]"],[746463,"V","Kirlia [Magical Shot | Psychic]"],[746571,"V","Reversal Energy"],[746409,"V","Quaxly [Reckless Charge]"],[746479,"V","Greavard [Graveyard Gamboling]"],[746531,"V","Greedent [Bite | Enhanced Fang]"],[746554,"V","Clavell"],[746558,"V","Professor's Research - Professor Sada"],[746559,"V","Professor's Research - Professor Turo"],[746501,"V","Sneasel [Dig Claws]"],[746540,"V","Super Rod"],[746220,"V","Toedscool [Furious Kicks]"],[746505,"V","Bisharp [Dark Cutter | Double-Edged Slash]"],[746533,"V","Oinkologne [Finest Selection | Perfume Press]"],[746412,"V","Wiglett [Twisting Strike]"],[746210,"V","Pineco [Rollout | SV2D]"],[746224,"V","Rellor [Ball Roll]"],[746516,"V","Noibat [Gust]"],[746448,"V","Pawmi [Light Punch | Zap Kick]"],[746562,"V","Arven"]],"5621":[[761118,"J","Basic Metal Energy"]],"5700":[[762567,"V","Venusaur [Chlorophyll | Green Blast | Toxic Sleep]"]],"5802":[[785997,"V","Bulbasaur [Leech Seed | 151]"]],"5861":[[783507,"J","Alcremie VMAX [Aromatherapy | Draining Kiss | Dazzling Gleam]"],[783508,"J","Alcremie VMAX [Aromatherapy | Draining Kiss | Dazzling Gleam]"],[783509,"J","Alcremie VMAX [Aromatherapy | Draining Kiss | Dazzling Gleam]"]],"5890":[[786728,"J","Basic Lightning Energy"]],"5944":[[805545,"V","Palafin ex [Hero's Spirit | Giga Impact]"],[805422,"V","Espeon [Psychic Assault | Psy Bolt]"]],"6096":[[826116,"V","Team Rocket's Crobat ex [Biting Spree | Assassin's Return]"]],"6099":[[819069,"V","Venusaur ex [Tranquil Flower | Dangerous Toxwhip]"]],"6127":[[894273,"J","Pikachu [Iron Tail | Electro Ball]"]],"6232":[[865392,"J","Pikachu at the Museum [The Best Collection! | Thunderbolt]"]],"6381":[[864068,"V","Mega Charizard Y ex [Explosion Y]"],[864067,"V","Lillie's Clefairy ex [Fairy Zone | Full Moon Rondo]"],[864065,"V","Mega Feraligatr ex [Mortal Crunch]"],[863409,"V","Mega Emboar ex [Crimson Blast]"],[863780,"V","Hydreigon ex [Greed Eater | Dark Bite]"],[863653,"V","Houndstone ex [Horrifying Fang]"],[863614,"V","Latias ex [Skyliner | Eon Blade]"],[863880,"V","Miltank [Bellyful of Milk | Tackle]"],[864018,"V","Lacey"],[864022,"V","Kofu"],[863821,"V","Melmetal ex [Iron Swing]"],[863417,"V","Larvesta [Ram | Steady Firebreathing]"],[863875,"V","Noctowl [Jewel Seeker | Speed Wing]"],[863727,"V","Koraidon ex [Orichalcum Fang | Impact Blow]"],[863566,"V","Morpeko [Snack Seek | Pick and Stick]"],[863752,"V","Houndoom [Call to Muster | Pitch-Black Fangs]"],[863731,"V","Iron Boulder ex [Repulsor Axe | Power Stomp]"],[863751,"V","Houndour [Playful Kick]"],[863853,"V","Koraidon ex [Retribution Strike | Kaiser Tackle]"],[863569,"V","Iono's Tadbulb [Tiny Charge]"],[863670,"V","Meditite [Slap | Kick]"],[863671,"V","Medicham [Low Sweep | High Jump Kick]"],[863697,"V","Mienfoo [Kick]"],[863698,"V","Mienshao [Low Sweep | Smash Uppercut]"],[863699,"V","Landorus [Fist of Focus | Buster Swing]"],[863706,"V","Mudbray [Smash Kick | Mud-Slap]"],[863707,"V","Mudsdale [Mud Stock | High Horsepower]"],[863718,"V","Nacli [Ram]"],[863719,"V","Naclstack [Rock Hurl]"],[863765,"V","Marnie's Scraggy [Crunch]"],[863766,"V","Marnie's Scrafty [Rear Kick | Wild Tackle]"],[863808,"V","Klink [Hard Gears]"],[863809,"V","Klang [Hard Gears]"],[863810,"V","Klinklang [Gear Coating | Hammer In]"],[863896,"V","Lopunny [Dashing Kick | Spiral Kick]"],[863926,"V","Hop's Cramorant [Fickle Spitting]"],[863972,"V","Night Stretcher"],[864038,"V","Ignition Energy"],[863527,"V","Magnemite [Lightning Ball]"],[863573,"V","Kilowattrel [Glide | Storm Bolt]"],[863723,"V","Klawf [Snipping Pincers | Hammer In]"],[863580,"V","Miraidon ex [Slashing Claw | Hadron Spark]"],[863746,"V","Haunter [Spooky Shot]"],[863528,"V","Magneton [Overvolt Discharge | Electric Ball]"],[863576,"V","Iron Hands [Volt Wave | Superalloy Hands]"],[863579,"V","Miraidon [Electric Claws | Mach Bolt]"],[863550,"V","Joltik [Jolting Charge]"],[863797,"V","Mawile [Call for Family | Bite]"],[863613,"V","Latias [Allure | Lagoon Flight]"],[864013,"V","Judge"],[863315,"V","Heracross [Body Slam | Seismic Toss]"],[863838,"V","Iron Crown [Deleting Slash | Slicing Blade]"],[863968,"V","Hop's Bag"],[863390,"V","Magcargo ex [Hot Magma | Ground Burn]"],[863481,"V","Milotic ex [Sparkling Scales | Hypno Splash]"],[863499,"V","Kyurem ex [Slash | Blizzard Burst]"],[863531,"V","Iono's Electrode [Thump-Thump Boom | Electric Ball]"],[863608,"V","Grumpig [Energized Steps | Psychic Sphere]"],[863904,"V","Mega Audino ex [Kaleidowaltz | Ear Force]"],[863416,"V","Heatmor [Licking Catch | Fire Claws]"],[863444,"V","Hearthflame Mask Ogerpon [Fire Kagura | Searing Flame]"],[863492,"V","Lumineon [Return | Razor Fin]"],[863539,"V","Manectric [Zap Kick | Flash Impact]"],[863556,"V","Helioptile [Collect | Static Shock]"],[863557,"V","Heliolisk [Wild Charge]"],[863645,"V","Impidimp [Gentle Slap]"],[863646,"V","Morgrem [Light Punch | Smash Kick]"],[863662,"V","Iron Boulder [Adjusted Horn]"],[863663,"V","Iron Crown ex [Cobalt Command | Twin Shotels]"],[863817,"V","Magearna [Auto Heal | Spike Draw]"],[863933,"V","Iron Defender"],[863952,"V","Hyper Aroma"],[863955,"V","Hand Trimmer"],[864009,"V","Lucian"],[864028,"V","Lt. Surge's Bargain"],[864029,"V","Morty's Conviction"],[864032,"V","Lisia's Appeal"]],"6409":[[861753,"V","Bouffalant [Curly Wall | Boundless Power]"],[861752,"V","Bouffalant [Curly Wall | Boundless Power]"]],"6443":[[877540,"V","Rosa's Encouragement"],[877512,"V","Espurr [Nap | Stampede]"]],"6517":[[886513,"V","AZ's Tranquility"]],"6582":[[889046,"V","Double Colorless Energy"],[889052,"V","Sophocles"],[889054,"V","Celebi & Venusaur GX [Pollen Hazard | Solar Beam | Evergreen GX]"],[889056,"V","Dedenne GX [Dedechange | Static Shock | Tingly Return GX]"]],"6673":[[900016,"J","Exeggcute [Ram | Seed Bomb]"],[900017,"J","Magmar [Low Kick | Fiery Punch]"],[900018,"J","Empoleon [Emergency Surfacing | Water Arrow]"],[900019,"J","Sigilyph [Tri Recharge | Psychic]"],[900020,"J","Riolu [Low Kick]"],[900021,"J","Lucario [Roaring Resolve | Aura Sphere Volley]"],[900022,"J","Grimer [Poison Gas]"],[900023,"J","Minccino [Call for Family | Pound]"],[900026,"J","Turtwig [Bite | Headbutt Bounce]"],[900028,"J","Piplup [Bubble]"],[900067,"J","Giratina V [Abyss Seeking | Shred]"],[900074,"J","Charizard [Battle Sense | Royal Blaze]"],[900077,"J","Pikachu [Thunder Shock | Holiday Calendar]"],[900078,"J","Mewtwo [Life Sucker | Psyburn]"],[900079,"J","Eevee [Continuous Steps]"],[900080,"J","Snorlax [Heavy Impact]"],[900102,"J","Unown V [Shady Stamp | Victory Symbol]"]]};

  // Le nombre de produits de chaque expansion de la liste dans l'export Cardmarket du 24/09 (TOUS les Singles, cartes-code
  // comprises : c'est ce que la galerie montre). Comparé au total que Cardmarket annonce sur la page : s'il est plus petit, un
  // filtre ou une limite de la page masque des produits.
  const PRODUITS_EXPORT = {"1521":151,"1526":63,"1542":98,"1544":117,"1552":104,"1577":162,"1579":131,"1745":228,"1800":242,"1845":12,"2916":386,"3214":354,"3324":422,"3974":32,"4074":140,"4089":84,"4099":17,"4134":20,"4139":23,"4144":15,"4149":15,"4154":51,"4159":411,"4168":151,"4218":248,"4240":8,"4243":78,"4252":41,"4313":119,"4316":16,"4317":123,"4345":38,"4347":69,"4348":19,"4382":303,"4388":430,"4466":96,"5201":256,"5212":304,"5223":316,"5241":304,"5385":271,"5519":360,"5621":98,"5700":75,"5802":208,"5861":9,"5890":140,"5944":180,"6096":244,"6099":192,"6127":302,"6232":153,"6381":774,"6409":236,"6443":124,"6517":122,"6582":357,"6673":380};

  // idProduct → { e: idExpansion, k: 'J' | 'V', n: nom } ; une « galerie parcourue » ne compte que si elle l'a été après la mesure.
  const CIBLE = new Map();
  for (const [e, l] of Object.entries(CIBLES)) for (const [id, k, n] of l) CIBLE.set(id, { e: Number(e), k, n });
  const MESURE_LISTE = Date.parse('2026-09-26T15:54:00Z');

  // ===== Stockage du script (GM_*, jamais localStorage : celui-là appartient au site) =====
  const lire = (cle, defaut) => { try { const v = GM_getValue(cle, defaut); return v === undefined ? defaut : v; } catch (_) { return defaut; } };
  const garder = (cle, v) => { try { GM_setValue(cle, v); } catch (_) { /* non persisté : la session continue */ } };
  const pause = ms => new Promise(r => setTimeout(r, ms));
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // L'identifiant : STABLE d'une session à l'autre, pour que les refus tracés côté serveur désignent le même poste.
  function identifiantUtilisateur() {
    const id = lire('rm_userId', null);
    if (typeof id === 'string' && id) return id;
    const neuf = 'rm-' + ((self.crypto && self.crypto.randomUUID) ? self.crypto.randomUUID() : Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10));
    garder('rm_userId', neuf);
    return neuf;
  }
  const ID_UTILISATEUR = identifiantUtilisateur();

  // ===== Lecture de la page =====
  // L'idProduct vient de l'URL de l'image (« …/51/DRI/826050/826050.jpg »). 🔴 1.8 : jusqu'à la 1.7, une vignette dont l'image ne
  // répondait pas à ce motif (autre attribut de chargement, autre format, image absente) était JETÉE SANS UN MOT — le panneau
  // disait « N cartes » pour celles qu'il avait lues, jamais combien la page en portait. La lecture d'origine reste la première
  // (data-echo, puis src, en .jpg) ; à défaut, les autres attributs (data-src, data-lazy, srcset) et formats (png, webp, avif) —
  // seulement quand les DEUX nombres du chemin sont égaux, comme sur toute image produit. Ce qui ne se lit toujours pas est
  // COMPTÉ, affiché en rouge et gardé au journal (lien, attributs de l'image) : c'est ce qui dira pourquoi.
  const ECARTEES = [];
  // 1.9 : une vignette sans idProduct lisible mais avec un LIEN de produit part par ce lien et son titre (le serveur déduit l'id).
  const SANS_IMAGE = [];
  const ATTRS_IMAGE = ['data-echo', 'src', 'data-src', 'data-lazy', 'data-original', 'srcset'];
  function idDepuisImage(img) {
    if (!img) return null;
    const v1 = img.getAttribute('data-echo') || img.getAttribute('src') || '';
    const m1 = v1.match(/\/(\d+)\/(\d+)\.jpg/i);
    if (m1) return { id: parseInt(m1[1], 10), src: v1, lecture: 'jpg' };
    for (const a of ATTRS_IMAGE) {
      const v = img.getAttribute(a) || '';
      const m = v.match(/\/(\d+)\/(\d+)\.(?:jpe?g|png|webp|avif)(?=[?#\s,]|$)/i);
      if (m && m[1] === m[2]) return { id: parseInt(m[1], 10), src: v, lecture: `${a}:${(v.match(/\.(jpe?g|png|webp|avif)/i) || [, '?'])[1].toLowerCase()}` };
    }
    return null;
  }
  function lireCartesDeLaPage() {
    const cartes = [];
    document.querySelectorAll('a.galleryBox').forEach(a => {
      const img = a.querySelector('img');
      const r = idDepuisImage(img);
      if (!r || !r.id) {
        const h2e = a.querySelector('h2');
        const titre = h2e ? h2e.textContent.trim() : '';
        const href = String(a.getAttribute('href') || '');
        const bouts = href.split('/').filter(Boolean);
        const slugV = (bouts[bouts.length - 1] || '').split('?')[0];
        const slugSetV = bouts[bouts.length - 2] || null;
        // 1.9 : un lien de PRODUIT (…/Products/Singles/<set>/<produit>) suffit — slug, numéro et code du titre, idProduct déduit par le serveur.
        // ⚠️ SEUL le visuel de remplacement de Cardmarket (« cardImageNotAvailable ») vaut « sans image » (relecture du 2026-09-26) : toute
        // autre image illisible reste ÉCARTÉE, au journal avec ses attributs — si Cardmarket changeait sa balise d'image, rien ne
        // basculerait en silence vers la déduction.
        const indisponible = !!img && ATTRS_IMAGE.some(k => /cardImageNotAvailable/i.test(img.getAttribute(k) || ''));
        if (indisponible && bouts.includes('Products') && slugV && slugSetV && slugSetV !== 'Singles') {
          const mT = titre.match(/\(([^)\s]+)\s+([^)\s]+)\)\s*$/);
          // La variante n'est pas envoyée : le serveur la relit du slug (collecte-cartes/deduire-produit.js, varianteDuSlug).
          cartes.push({ idProduct: null, numero: mT ? mT[2] : null, codeSet: mT ? mT[1] : null, nomFr: (img && img.getAttribute('alt') || '').trim() || titre.replace(/\s*\([^)]*\)\s*$/, '').trim() || null,
            slug: slugV, slugSet: slugSetV, sansImage: true });
          SANS_IMAGE.push({ href: href.slice(0, 160), titre: titre.slice(0, 80) });
          return;
        }
        ECARTEES.push({ href: href.slice(0, 160), titre: titre ? titre.slice(0, 80) : null,
          image: img ? ATTRS_IMAGE.map(k => [k, img.getAttribute(k)]).filter(([, v]) => v).map(([k, v]) => `${k}=${String(v).slice(0, 120)}`) : ['(aucune balise img)'] });
        return;
      }
      const idProduct = r.id, src = r.src;
      const mCode = src.match(/cardmarket\.com\/\d+\/([^/]+)\//i);
      let codeSet = mCode ? mCode[1] : null;
      if (codeSet) { try { codeSet = decodeURIComponent(codeSet); } catch (_) { /* brut */ } }
      const nomFr = (img && img.getAttribute('alt') || '').trim() || null;
      const h2 = a.querySelector('h2');
      let numero = null;
      if (h2) { const m = h2.textContent.trim().match(/\(([^)\s]+)\s+([^)\s]+)\)\s*$/); if (m) numero = m[2]; }
      const morceaux = (a.getAttribute('href') || '').split('/').filter(Boolean);
      const dernierSegment = (morceaux[morceaux.length - 1] || '').split('?')[0];
      const slugSet = morceaux[morceaux.length - 2] || null;
      // Ni numeroUrl ni variante : le serveur les relit du slug (seconde relecture du 2026-09-26 : la copie d'ici ratait « …-V3 » final).
      cartes.push({ idProduct, numero, codeSet, nomFr, slug: dernierSegment || null, slugSet });
      if (r.lecture !== 'jpg') LECTURES_AUTRES.push(`${idProduct}:${r.lecture}`);
    });
    return cartes;
  }
  const LECTURES_AUTRES = [];

  // ===== Ce que la page DIT d'elle-même (1.8) — pour savoir si Cardmarket montre tout, sans jamais rien demander de plus =====
  // Le total que Cardmarket annonce (« 244 résultats »), les filtres actifs de son formulaire (cases cochées, listes), les
  // paramètres de l'URL tels quels. Rien n'est fabriqué ni ajouté à l'URL (perSite reste interdit) : on LIT ce qui est affiché.
  function diagnosticDeLaPage() {
    const vignettes = document.querySelectorAll('a.galleryBox').length;
    let total = null;
    const re = /(\d[\d .,  ]*)\s*(résultats?|results?|treffer|hits|ergebnisse|risultati|resultados)\b/i;
    for (const el of document.querySelectorAll('h1, h2, h3, h4, span, p, div, small, strong')) {
      if (el.children && el.children.length > 4) continue;
      const t = (el.textContent || '').trim();
      if (!t || t.length > 90) continue;
      const m = re.exec(t);
      if (m) { const n = parseInt(m[1].replace(/\D/g, ''), 10); if (n) { total = { n, texte: t.slice(0, 90) }; break; } }
    }
    const filtres = [];
    for (const el of document.querySelectorAll('form input[type="checkbox"]:checked, form input[type="radio"]:checked, form select')) {
      const nom = el.getAttribute('name'); if (!nom) continue;
      const v = el.tagName === 'SELECT' ? (el.value || '') : (el.getAttribute('value') || 'on');
      if (v !== '') filtres.push(`${nom}=${v}`.slice(0, 80));
    }
    const params = [];
    new URLSearchParams(location.search).forEach((v, k) => params.push(`${k}=${v}`.slice(0, 80)));
    return { vignettes, total, filtres: filtres.slice(0, 40), params };
  }

  // ===== Le journal (1.8) : une entrée par page CHARGÉE, complétée par la réponse du serveur =====
  // Il vit dans le stockage du script (GM_*), 1 500 pages au plus, et s'exporte d'un clic (📥) : c'est lui qu'on lit quand un
  // set « n'a pas progressé » — combien de vignettes chaque page portait, combien ont été lues, ce que Cardmarket annonçait,
  // ce que le serveur a répondu. Jusqu'à la 1.7, rien de cela n'était gardé nulle part (le serveur n'écrit que sa console).
  const JOURNAL_MAX = 1500;
  function journaliser(entree) {
    const j = lire('rm_journal', []);
    j.push(entree);
    if (j.length > JOURNAL_MAX) j.splice(0, j.length - JOURNAL_MAX);
    garder('rm_journal', j);
  }
  function annoterJournal(cles, info) {
    const j = lire('rm_journal', []);
    let n = 0;
    for (let i = j.length - 1; i >= 0 && n < cles.length; i--) {
      if (cles.includes(j[i].url) && (!j[i].envoi || j[i].envoi.status !== 200)) { j[i].envoi = info; n++; }
    }
    if (n) garder('rm_journal', j);
  }
  function exporterJournal() {
    const donnees = { script: VERSION, exporteLe: new Date().toISOString(), userId: ID_UTILISATEUR, journal: lire('rm_journal', []),
      fileEnAttente: lire('rm_file', []), pagesFaites: lire('rm_pagesFaites', {}), ciblesFaites: lire('rm_ciblesFaites', {}), couverture: lire('rm_couv', {}), bloque };
    const blob = new Blob([JSON.stringify(donnees)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `rat-market-journal-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json`;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  }

  // ===== Contexte : quelle expansion, quelle page — LU, jamais fabriqué =====
  function contexteDeLaPage(cartes) {
    const params = new URLSearchParams(location.search);
    const morceaux = location.pathname.split('/').filter(Boolean);
    const dernier = morceaux[morceaux.length - 1] || '';
    // Sur la page du filtre (`Singles?idExpansion=N`), le chemin se termine par « Singles » : le slug vient des cartes.
    const slugSet = (dernier && dernier !== 'Singles' ? dernier : null) || (cartes[0] && cartes[0].slugSet) || '?';
    const idUrl = parseInt(params.get('idExpansion') || '', 10) || null;
    const page = parseInt(params.get('site') || '1', 10) || 1;
    let pages = null;
    for (const el of document.querySelectorAll('.pagination a, .pagination span, nav a, nav span')) {
      const m = (el.textContent || '').trim().match(/^(\d+)$/);
      if (m) pages = Math.max(pages || 0, parseInt(m[1], 10));
    }
    let hrefSuivant = null;
    const lienRel = document.querySelector('a[rel="next"]');
    if (lienRel && lienRel.getAttribute('href')) hrefSuivant = lienRel.href;
    for (const a of hrefSuivant ? [] : document.querySelectorAll('.pagination a, nav a')) {
      const t = (a.textContent || '').trim();
      const aria = (a.getAttribute('aria-label') || '').toLowerCase();
      if ((t === String(page + 1) || /suivant|next/.test(aria) || /suivant|next/i.test(t)) && a.getAttribute('href')) { hrefSuivant = a.href; break; }
    }
    const langue = morceaux[0] || 'fr';
    return { slugSet, idUrl, page, pages, hrefSuivant, langue, cle: location.pathname + location.search };
  }

  // ===== Le serveur =====
  function envoyer(cartes) {
    return new Promise(resolve => {
      GM_xmlhttpRequest({
        method: 'POST', url: URL_API + '/api/apprendre-lot', timeout: 60000,
        headers: { 'Content-Type': 'application/json', 'x-jeton': JETON },
        data: JSON.stringify({ userId: ID_UTILISATEUR, cartes }),
        onload: r => {
          let corps = null; try { corps = JSON.parse(r.responseText); } catch (_) { /* le statut reste utile */ }
          // Les en-têtes du limiteur (express-rate-limit, standardHeaders) : quand il reprend, et ce qui reste dans l'heure.
          const m = /^ratelimit-reset:\s*(\d+)/im.exec(r.responseHeaders || '');
          const reste = /^ratelimit-remaining:\s*(\d+)/im.exec(r.responseHeaders || '');
          if (reste) session.restant = parseInt(reste[1], 10);
          resolve({ status: r.status, corps, reset: m ? parseInt(m[1], 10) : null });
        },
        onerror: () => resolve({ status: 0, erreur: 'requête échouée' }),
        ontimeout: () => resolve({ status: 0, erreur: 'délai dépassé' })
      });
    });
  }
  function mongoPret() {
    return new Promise(resolve => GM_xmlhttpRequest({
      method: 'GET', url: URL_API + '/ping', timeout: 20000,
      onload: r => { try { resolve(JSON.parse(r.responseText).mongo === true); } catch (_) { resolve(false); } },
      onerror: () => resolve(false), ontimeout: () => resolve(false)
    }));
  }
  async function attendreReveil() {
    const debut = Date.now();
    while (Date.now() - debut < REVEIL_MAX_MS) {
      etat(`😴 Le serveur se réveille… ${Math.round((Date.now() - debut) / 1000)} s`);
      if (await mongoPret()) return true;
      await pause(PAUSE_REVEIL_MS);
    }
    return false;
  }

  // ===== La file locale : une page lue y entre AVANT l'envoi, n'en sort qu'au succès =====
  function enfiler(p) { const f = lire('rm_file', []).filter(x => x.cle !== p.cle); f.push(p); garder('rm_file', f); }
  function retirer(cles) { garder('rm_file', lire('rm_file', []).filter(x => !cles.includes(x.cle))); }
  // Les pages en tête de file, de la MÊME galerie, jusqu'à MAX_CARTES_PAR_ENVOI : une expansion par envoi, pour que le
  // serveur rende sa couverture ; un idProduct vu deux fois ne part qu'une fois.
  function prochainEnvoi(file) {
    const items = [], parId = new Map();
    for (const it of file) {
      if (items.length && it.slugSet !== items[0].slugSet) break;
      if (items.length && parId.size + it.cartes.length > MAX_CARTES_PAR_ENVOI) break;
      items.push(it);
      // 1.9 : une carte sans idProduct (sans image) se reconnaît à son slug — sinon toutes les sans-image se fondraient en une.
      for (const c of it.cartes) parId.set(c.idProduct != null ? c.idProduct : `slug:${c.slugSet}/${c.slug}`, c);
    }
    return { items, cartes: [...parId.values()] };
  }

  const session = { nouvelles: 0, ameliorees: 0, dejaExactes: 0, completees: 0, sansNumero: 0, ignorees: 0, envois: 0, restant: null };
  let enCours = false, reprise = null, repriseA = null, bloque = null;
  function planifier(ms) {
    clearTimeout(reprise); repriseA = Date.now() + ms;
    reprise = setTimeout(() => { repriseA = null; vider(); }, ms);
  }

  async function vider() {
    if (enCours || bloque) return;
    enCours = true; clearTimeout(reprise); repriseA = null;
    let reseau = 0;
    try {
      for (;;) {
        const file = lire('rm_file', []);
        if (!file.length) break;
        const { items, cartes } = prochainEnvoi(file);
        etat(`📤 Envoi : ${cartes.length} cartes${items.length > 1 ? ` (${items.length} pages groupées)` : ''}…`);
        const r = await envoyer(cartes);
        if (r.status === 200 && r.corps && r.corps.success) {
          reseau = 0; session.envois++;
          retirer(items.map(i => i.cle));
          noterSucces(items, r.corps);
          // L'état « Envoi : … » ne doit pas survivre à l'envoi : il faisait croire à un renvoi en cours (2026-09-24).
          ligneEtat = `✅ ${items.length > 1 ? `${items.length} pages envoyées` : 'page envoyée'} à ${new Date().toLocaleTimeString()}`;
          continue;
        }
        // Au journal, chaque tentative qui n'aboutit pas : le statut et le message, sur les pages de l'envoi.
        annoterJournal(items.map(i => i.cle), { status: r.status, le: Date.now(), erreur: (r.corps && r.corps.error) || r.erreur || null });
        if (r.status === 503) { if (await attendreReveil()) continue; etat('😴 Serveur toujours endormi : nouvel essai dans 1 min.'); planifier(60000); break; }
        if (r.status === 429) { const s = r.reset != null ? r.reset : 300; etat(`⏳ Limite de 120 envois/h atteinte : reprise automatique dans ${Math.ceil(s / 60)} min. Tu peux continuer à tourner les pages.`); planifier(s * 1000 + 3000); break; }
        if (r.status === 0) { if (++reseau < ESSAIS_RESEAU) { etat(`📶 ${r.erreur} — nouvel essai dans 15 s (${reseau}/${ESSAIS_RESEAU - 1})`); await pause(15000); continue; } etat('📶 Réseau indisponible : nouvel essai dans 2 min.'); planifier(120000); break; }
        // 400, 401, ou 200 + success:false : un défaut, pas une surcharge. On s'arrête et on le dit ; la file est gardée.
        const aide = r.status === 400 ? ' — identifiant manquant : version du script à mettre à jour'
          : r.status === 401 ? ' — jeton refusé : JETON à recopier depuis le .env du serveur' : '';
        bloque = `❌ ${(r.corps && r.corps.error) || 'refus serveur'} (HTTP ${r.status})${aide}. Les pages restent dans la file.`;
        etat(bloque);
        break;
      }
    } finally { enCours = false; majPanneau(); }
  }

  function noterSucces(items, c) {
    for (const k of ['nouvelles', 'ameliorees', 'dejaExactes', 'completees', 'sansNumero', 'ignorees']) session[k] += (c[k] || 0);
    const faites = lire('rm_pagesFaites', {});
    // `v: 17` : la marque dit que la page a été apprise par un serveur qui écrit les cartes SANS numéro — il renvoie
    // `ignorees`. Un serveur plus ancien les jetait : sa marque reste sans `v` (voir `pageApprise`).
    // `v: 19` (1.9) : la page a été apprise par un serveur qui DÉDUIT les vignettes sans image (il renvoie `deduites`). Une marque
    // plus ancienne sur une page qui porte une sans-image ne compte pas : la page repart d'elle-même (voir `pageApprise`).
    // 🔴 SECONDE RELECTURE : un ÉCHEC de la déduction (`erreurDeduction`) marquait quand même la page v:19, et ses sans-image ne
    // repartaient jamais. Une page qui porte une sans-image n'est marquée que si la déduction a TOURNÉ (refus compris : un refus est
    // un verdict, une erreur n'en est pas un) ; ses cartes lues sont écrites, elle repart entière au prochain chargement.
    // 🔴 TROISIÈME RELECTURE : une sans-image REFUSÉE (et non en erreur) marquait la page pour toujours, alors que son refus peut dépendre
    // de l'ORDRE des pages (« 2 produits non appris » : le V1 de sa famille est sur une page suivante). La marque garde le nombre de
    // refusées ; la page repart UNE fois quand l'expansion a appris quelque chose depuis (`repartPourSesRefus`).
    const deduitsSlug = new Set((Array.isArray(c.idsDeduits) ? c.idsDeduits : []).map(d => d && d.slug).filter(Boolean));
    for (const it of items) {
      if (c.erreurDeduction && it.cartes.some(x => x.sansImage)) continue;
      const avant = faites[it.cle];
      const refusees = c.deduites != null ? it.cartes.filter(x => x.sansImage && !deduitsSlug.has(x.slug)).length : 0;
      faites[it.cle] = { le: Date.now(), n: it.cartes.length, ...(c.deduites != null ? { v: 19 } : c.ignorees != null ? { v: 17 } : {}),
        ...(refusees ? { sansImageRefusees: refusees, reprises: avant && avant.sansImageRefusees ? (avant.reprises || 0) + 1 : 0 } : {}) };
    }
    const cles = Object.keys(faites); if (cles.length > 3000) for (const k of cles.sort((a, b) => faites[a].le - faites[b].le).slice(0, cles.length - 3000)) delete faites[k];
    garder('rm_pagesFaites', faites);
    // Une cible n'est faite qu'ENVOYÉE AVEC SUCCÈS : le serveur l'a apprise (J) ou a complété son slug (V).
    const ciblesFaites = lire('rm_ciblesFaites', {});
    for (const it of items) for (const x of it.cartes) if (CIBLE.has(x.idProduct)) ciblesFaites[x.idProduct] = Date.now();
    // Une cible SANS IMAGE n'a pas d'idProduct côté page : le serveur rend ceux qu'il a déduits ET écrits (`idsDeduits`).
    const idsDeduits = Array.isArray(c.idsDeduits) ? c.idsDeduits.map(d => d && Number(d.idProduct)).filter(Boolean) : [];
    for (const id of idsDeduits) if (CIBLE.has(id)) ciblesFaites[id] = Date.now();
    garder('rm_ciblesFaites', ciblesFaites);
    annoterJournal(items.map(i => i.cle), { status: 200, le: Date.now(), pagesGroupees: items.length, recus: c.recus ?? null, nouvelles: c.nouvelles ?? 0, ameliorees: c.ameliorees ?? 0,
      dejaExactes: c.dejaExactes ?? 0, completees: c.completees ?? 0, sansNumero: c.sansNumero ?? 0, ignorees: c.ignorees ?? null, deduites: c.deduites ?? null, nonDeduites: c.nonDeduites ?? null,
      raisonsNonDeduites: c.raisonsNonDeduites ?? null, erreurDeduction: c.erreurDeduction ?? null, idsDeduits: c.idsDeduits != null ? idsDeduits : null,
      deductionsContredites: c.deductionsContredites ?? null,
      idExpansions: c.idExpansions ?? null, couverture: c.couverture ?? null });
    const exps = Array.isArray(c.idExpansions) ? c.idExpansions : (c.idExpansion != null ? [c.idExpansion] : []);
    if (c.idExpansion != null) {
      const slugExp = lire('rm_slugExp', {}); for (const it of items) slugExp[it.slugSet] = c.idExpansion; garder('rm_slugExp', slugExp);
      const couv = lire('rm_couv', {});
      const precedent = couv[c.idExpansion] || {};
      // « Parcourue » (la dernière page a été apprise) n'est PAS « complète » (tous les produits appris) : la 1.5 les
      // confondait et affichait 30th Celebration « terminée ✅ » à 84 %. La complétude se calcule à l'affichage.
      const parcourue = !!(precedent.parcourue || precedent.terminee || items.some(it => it.derniere));
      couv[c.idExpansion] = { ...(c.couverture || {}), le: Date.now(), parcourue };
      garder('rm_couv', couv);
      // l'état de l'expansion AU MOMENT de la marque : la page aux refus ne repart que si l'expansion a appris APRÈS
      let aRemarquer = false;
      for (const it of items) { const m = faites[it.cle]; if (m && m.sansImageRefusees) { m.leCouv = couv[c.idExpansion].le; aRemarquer = true; } }
      if (aRemarquer) garder('rm_pagesFaites', faites);
    }
    dernierBilan = { c, exps, pages: items.length };
  }

  // ===== Le panneau =====
  let dernierBilan = null;
  const cartesPage = lireCartesDeLaPage();
  const ctx = contexteDeLaPage(cartesPage);
  const avantPage = lire('rm_dernierePage', null);
  garder('rm_dernierePage', Date.now());

  const panneau = document.createElement('div');
  panneau.style.cssText = 'position:fixed;bottom:16px;right:16px;z-index:99999;background:#0d0d10;color:#eee;font:13px system-ui,sans-serif;' +
    'padding:12px 14px;border:1px solid #D4AF37;border-radius:10px;box-shadow:0 4px 16px rgba(0,0,0,.4);width:300px;line-height:1.45';
  document.body.appendChild(panneau);
  let ligneEtat = '';
  const etat = t => { ligneEtat = t; majPanneau(); };

  function idCourant() { return ctx.idUrl || lire('rm_slugExp', {})[ctx.slugSet] || null; }
  // COMPLÈTE = tous les produits du catalogue appris, numéro de titre ou non (`appris`, renvoyé par le serveur depuis le
  // 2026-09-24). Un serveur plus ancien ne le renvoie pas : on retombe alors sur le seuil des numéros.
  const complete = cv => !!cv && (cv.appris != null ? cv.appris >= cv.produits : cv.pourcent >= SEUIL_TERMINEE);
  const ciblesDe = id => CIBLES[id] || [];
  const ciblesRestantes = id => { const f = lire('rm_ciblesFaites', {}); return ciblesDe(id).filter(([p]) => !f[p]); };
  // Faite : plus aucune cible, ou le serveur la dit complète, ou sa galerie a été parcourue APRÈS la mesure (ses cibles
  // restantes ne sont alors dans aucune page de la galerie : il n'y a plus rien à y lire, et le panneau le dit).
  const faiteExp = (id, cv) => (ciblesDe(id).length > 0 && !ciblesRestantes(id).length) || complete(cv)
    || !!(cv && (cv.parcourue || cv.terminee) && cv.le >= MESURE_LISTE);
  // Une marque posée par un serveur d'avant le 2026-09-24 sur une page dont AUCUNE carte n'a de numéro de titre n'a rien
  // écrit : ce serveur jetait les cartes sans numéro (Unnumbered Promos, énergies de base). Elle ne compte pas — la page repart.
  // 1.9 : une page qui porte une vignette sans image n'est apprise que par un serveur qui la déduit (`v >= 19`) — les pages marquées
  // par la 1.8 (qui l'écartait) repartent d'elles-mêmes, sans « Réapprendre ».
  // une page dont des sans-image ont été REFUSÉES repart UNE fois si l'expansion a appris depuis sa marque (le refus dépendait peut-être
  // de l'ordre des pages) ; au-delà, son refus est un verdict — elle ne boucle pas.
  const repartPourSesRefus = m => !!(m && m.sansImageRefusees) && !((m.reprises || 0) >= 1) && (((lire('rm_couv', {})[idCourant()] || {}).le || 0) > (m.leCouv != null ? m.leCouv : m.le));
  const pageApprise = m => !!m && (m.v >= 17 || cartesPage.some(c => c.numero)) && (m.v >= 19 || !cartesPage.some(c => c.sansImage)) && !repartPourSesRefus(m);
  const marqueDeLaPage = () => { const m = lire('rm_pagesFaites', {})[ctx.cle]; return pageApprise(m) ? m : null; };
  // « Déjà apprise » ne se dit que d'une page apprise AVANT ce chargement — pas de celle qu'on vient d'envoyer.
  const faiteAvant = marqueDeLaPage();

  // 1.8 : la page au journal, dès son chargement — ce qu'elle portait, ce qui a été lu, ce qu'elle disait d'elle-même.
  const DIAG = diagnosticDeLaPage();
  journaliser({ le: Date.now(), v: VERSION, url: ctx.cle, exp: idCourant(), slugSet: ctx.slugSet, page: ctx.page, pages: ctx.pages, suivante: !!ctx.hrefSuivant,
    vignettes: DIAG.vignettes, lues: cartesPage.length, avecNumero: cartesPage.filter(c => c.numero).length, ecartees: ECARTEES.length, detailEcartees: ECARTEES.slice(0, 25),
    sansImage: SANS_IMAGE.length, detailSansImage: SANS_IMAGE.slice(0, 25),
    lecturesAutres: LECTURES_AUTRES.slice(0, 25), totalAnnonce: DIAG.total, produitsExport: idCourant() != null ? (PRODUITS_EXPORT[idCourant()] ?? null) : null,
    filtres: DIAG.filtres, params: DIAG.params, ids: cartesPage.filter(c => c.idProduct != null).map(c => c.idProduct), cibles: cartesPage.filter(c => CIBLE.has(c.idProduct)).map(c => c.idProduct),
    dejaApprise: !!faiteAvant, envoi: null });

  function majPanneau() {
    const couv = lire('rm_couv', {});
    const file = lire('rm_file', []);
    const id = idCourant();
    const rang = id != null ? LISTE.findIndex(([x]) => x === id) : -1;
    const faites = LISTE.filter(([x]) => faiteExp(x, couv[x])).length;
    const suivante = LISTE.find(([x]) => x !== id && !faiteExp(x, couv[x]));
    const fCibles = lire('rm_ciblesFaites', {});
    const totalCibles = CIBLE.size, faitesCibles = [...CIBLE.keys()].filter(p => fCibles[p]).length;
    const avecNum = cartesPage.filter(c => c.numero).length;
    const dejaFaite = marqueDeLaPage();
    const auto = lire('rm_auto', true);
    const cv = id != null ? couv[id] : null;
    let h = `<div style="display:flex;justify-content:space-between;align-items:center"><b>🐀 Apprentissage ${esc(VERSION)}</b>` +
      `<label style="font-size:11px;color:#aaa;cursor:pointer"><input id="rm-auto" type="checkbox" ${auto ? 'checked' : ''} style="vertical-align:middle"> auto</label></div>`;
    h += `<div style="color:#888;font-size:11px;margin:2px 0 6px">exp ${esc(id ?? '?')} · ${esc(ctx.slugSet)} · page ${ctx.page}${ctx.pages ? '/' + ctx.pages : ''} · ${cartesPage.length} cartes (${avecNum} numérotées)` +
      (avantPage ? ` · page précédente il y a ${Math.round((Date.now() - avantPage) / 1000)} s` : '') + '</div>';
    // 1.8 : ce que la page porte contre ce qui a été lu, et ce que Cardmarket annonce contre ce que l'export contient.
    const att = id != null ? (PRODUITS_EXPORT[id] ?? null) : null;
    h += `<div style="font-size:11px;margin-bottom:6px;color:#aaa">🔎 ${DIAG.vignettes} vignette(s) · ${cartesPage.length} lue(s)` +
      (SANS_IMAGE.length ? ` · ${SANS_IMAGE.length} sans image : envoyée(s) par son lien et son titre` : '') +
      (ECARTEES.length ? ` · <b style="color:#f56c6c">${ECARTEES.length} écartée(s) : ni image lisible ni lien de produit (voir le journal)</b>` : '') +
      (DIAG.total ? ` · Cardmarket annonce ${DIAG.total.n}` : ' · total non trouvé sur la page') + (att != null ? ` · l'export en compte ${att}` : '') +
      (DIAG.total && att != null && DIAG.total.n < att ? `<br><b style="color:#f56c6c">⚠️ Cardmarket en annonce ${att - DIAG.total.n} de moins que l'export : un filtre ou une limite de la page masque des produits${DIAG.filtres.length ? ` (filtres actifs : ${esc(DIAG.filtres.join(', '))})` : ''}.</b>` : '') + '</div>';
    h += `<div style="font-size:12px;margin-bottom:6px">📋 Liste du ${new Date(MESURE_LISTE).toISOString().slice(8, 10)}/${new Date(MESURE_LISTE).toISOString().slice(5, 7)} : ${rang >= 0 ? `<b>n° ${rang + 1}/${LISTE.length}</b> — ${esc(LISTE[rang][1])}` : 'expansion hors liste'} · ${faites} faite(s)` +
      ` · 🎯 ${faitesCibles}/${totalCibles} cibles` +
      (suivante ? `<br>➡️ suivante : <a href="/${esc(ctx.langue)}/Pokemon/Products/Singles?idCategory=51&idExpansion=${suivante[0]}" style="color:#D4AF37">${suivante[0]} — ${esc(suivante[1])}</a>` : '<br>🎉 liste terminée') + '</div>';
    if (id != null && ciblesDe(id).length) {
      // Les cibles de l'expansion ouverte : ce qui reste, ce que CETTE page porte, et les noms à chercher dans la galerie.
      const reste = ciblesRestantes(id);
      const surLaPage = cartesPage.filter(x => CIBLE.has(x.idProduct) && CIBLE.get(x.idProduct).e === id);
      const aEnvoyer = surLaPage.filter(x => !fCibles[x.idProduct]);
      h += `<div style="font-size:12px;margin-bottom:6px;color:${reste.length ? '#e6a23c' : '#67c23a'}">🎯 cibles de l'expansion : ${ciblesDe(id).length - reste.length}/${ciblesDe(id).length} faites` +
        (surLaPage.length ? ` · <b>${surLaPage.length} sur cette page</b>${aEnvoyer.length ? ` (${aEnvoyer.length} à envoyer)` : ' (toutes faites)'}` : ' · aucune sur cette page') +
        (reste.length ? `<br><span style="color:#999;font-size:11px">reste : ${reste.slice(0, 8).map(([, k, n]) => `${esc(n)}${k === 'V' ? ' (slug)' : ''}`).join(' · ')}${reste.length > 8 ? ` … +${reste.length - 8}` : ''}</span>` : '<br>✅ toutes les cibles de cette expansion sont faites') +
        (reste.length && cv && (cv.parcourue || cv.terminee) && cv.le >= MESURE_LISTE ? '<br><span style="color:#888;font-size:11px">galerie parcourue : ces cibles n\'ont été ni lues ni déduites sur ses pages (absentes, ou sans image et refusées — raisons au journal).</span>' : '') + '</div>';
    }
    if (cv && cv.produits != null) {
      if (cv.appris != null) {
        // Deux nombres, pas un : ce qui est APPRIS (le but du passage) et ce qui porte un numéro de TITRE.
        const sansNum = cv.appris - cv.avecNumero;
        h += `<div style="color:${complete(cv) ? '#67c23a' : '#e6a23c'}">📊 ${cv.appris}/${cv.produits} produits appris · ${cv.avecNumero} avec numéro de titre` +
          (sansNum > 0 ? `<br><span style="color:#888;font-size:11px">${sansNum} sans numéro dans leur titre (rééditions, énergies…) : appris quand même, slug compris.</span>` : '') +
          (complete(cv) ? '<br>✅ expansion complète' : cv.parcourue ? `<br>galerie parcourue : ${cv.produits - cv.appris} produit(s) du catalogue jamais vu(s) dans la galerie` : '') + '</div>';
      } else {
        const coul = cv.pourcent >= SEUIL_TERMINEE ? '#67c23a' : cv.pourcent >= 50 ? '#e6a23c' : '#f56c6c';
        h += `<div style="color:${coul}">📊 ${cv.avecNumero}/${cv.produits} avec numéro de titre (${cv.pourcent} %)${cv.parcourue || cv.terminee ? ' — galerie parcourue' : ''}` +
          '<br><span style="color:#888;font-size:11px">(serveur pas encore redéployé : le nombre d\'appris n\'est pas connu)</span></div>';
      }
    }
    if (dernierBilan) {
      const c = dernierBilan.c;
      // `ignorees` n'existe que sur le serveur qui apprend les cartes sans numéro (2026-09-24) : sans lui, elles étaient jetées.
      const sansNum = !c.sansNumero ? '' : c.ignorees != null ? ` · <span style="color:#888">${c.sansNumero} sans numéro : appris par leur slug</span>`
        : ` · <span style="color:#e6a23c">${c.sansNumero} sans numéro ignorées (serveur pas encore redéployé)</span>`;
      // 1.9 : les sans-image envoyées par leur lien — ce que le serveur en a déduit ; un serveur plus ancien ne les apprend pas, et c'est dit.
      const envoyeesSansImage = SANS_IMAGE.length;
      const deduc = c.deduites != null ? ` · ${c.deduites} déduite(s) par le serveur${c.nonDeduites ? `, <span style="color:#e6a23c">${c.nonDeduites} non déduite(s)</span>` : ''}`
        : envoyeesSansImage ? ` · <span style="color:#e6a23c">sans image non apprises (serveur pas encore redéployé)</span>` : '';
      h += `<div>✅ ${c.nouvelles} nouvelles · ${c.ameliorees} améliorées · ${c.dejaExactes} déjà exactes${c.completees ? ` (${c.completees} complétées)` : ''}${sansNum}${deduc}` +
        `${c.ignorees ? ` · <span style="color:#e6a23c">${c.ignorees} ignorées (ni numéro ni slug)</span>` : ''}</div>`;
      // Seconde relecture : l'échec de la déduction et les raisons des non déduites se DISENT (ils n'étaient qu'au corps de la réponse).
      if (c.erreurDeduction) h += `<div style="color:#f56c6c">❌ ${esc(c.erreurDeduction)} — la page n'est pas marquée : ses sans-image repartiront à son prochain chargement.</div>`;
      const raisons = c.raisonsNonDeduites && typeof c.raisonsNonDeduites === 'object' ? Object.entries(c.raisonsNonDeduites).sort((a, b) => b[1] - a[1]) : [];
      if (raisons.length) h += `<div style="color:#999;font-size:11px">non déduites : ${raisons.slice(0, 4).map(([k, n]) => `${n} × ${esc(k)}`).join(' · ')}${raisons.length > 4 ? ` … +${raisons.length - 4}` : ''}</div>`;
      // Une carte lue de cet envoi porte le slug d'une ligne DÉDUITE d'un autre produit : le serveur le dit, le journal le garde (📥).
      const contredites = Array.isArray(c.deductionsContredites) ? c.deductionsContredites : [];
      if (contredites.length) h += `<div style="color:#e6a23c;font-size:11px">⚠️ ${contredites.length} déduction(s) contredite(s) par une carte lue : gardée(s) au journal (📥), à signaler.</div>`;
      if (dernierBilan.exps.length > 1) h += `<div style="color:#e6a23c">⚠️ envoi sur ${dernierBilan.exps.length} expansions (${dernierBilan.exps.join(', ')}) : pas de couverture calculée.</div>`;
    }
    if (!cartesPage.length) h += `<div style="color:#e6a23c">${estPage1015() ? '🛑 Cardmarket te limite (erreur 1015). Arrête-toi un moment : ta file et ta liste sont gardées.' : 'Aucune carte lue : passe en vue GALERIE (icône grille).'}</div>`;
    else if (!avecNum) h += `<div style="color:#888">aucune carte de la page n'a de numéro dans son titre : le serveur les apprend par leur slug.</div>`;
    if (faiteAvant && !file.some(x => x.cle === ctx.cle)) h += `<div style="color:#888">Page déjà apprise avant ce chargement (${new Date(faiteAvant.le).toLocaleString()}) : rien n'a été renvoyé.</div>`;
    if (ligneEtat) h += `<div style="margin-top:4px">${esc(ligneEtat)}</div>`;
    if (file.length) h += `<div style="color:#aaa;font-size:11px">📦 ${file.length} page(s) en attente d'envoi${repriseA ? ` · reprise ${new Date(repriseA).toLocaleTimeString()}` : ''}</div>`;
    if (session.envois || session.restant != null) h += `<div style="color:#777;font-size:11px">onglet : ${session.envois} envoi(s), ${session.nouvelles} nouvelles, ${session.ameliorees} améliorées${session.completees ? `, ${session.completees} complétées` : ''}` +
      (session.restant != null ? ` · reste ${session.restant} envoi(s) dans l'heure` : '') + '</div>';
    h += ctx.hrefSuivant ? `<div style="margin-top:6px"><a href="${esc(ctx.hrefSuivant)}" style="color:#D4AF37;font-weight:600">→ page suivante${ctx.pages ? ` (${ctx.page + 1}/${ctx.pages})` : ''}</a> <span style="color:#666;font-size:11px">touche N</span></div>`
      : (cartesPage.length ? '<div style="margin-top:6px;color:#888">Dernière page de cette galerie.</div>' : '');
    h += `<div style="display:flex;gap:6px;margin-top:8px"><button id="rm-go" style="flex:1;padding:6px;background:#0c0c0e;color:#D4AF37;border:1px solid #D4AF37;border-radius:6px;cursor:pointer;font-weight:600">${dejaFaite ? 'Réapprendre' : 'Apprendre'}</button>` +
      (file.length && !enCours ? '<button id="rm-vider" style="flex:1;padding:6px;background:#0c0c0e;color:#ccc;border:1px solid #555;border-radius:6px;cursor:pointer">Envoyer maintenant</button>' : '') +
      `<button id="rm-journal" title="Télécharger le journal des pages (à envoyer pour diagnostic)" style="padding:6px;background:#0c0c0e;color:#ccc;border:1px solid #555;border-radius:6px;cursor:pointer">📥 ${lire('rm_journal', []).length}</button></div>`;
    panneau.innerHTML = h;
    panneau.querySelector('#rm-auto').addEventListener('change', e => { garder('rm_auto', e.target.checked); });
    panneau.querySelector('#rm-go').addEventListener('click', () => apprendreCettePage(true));
    const bv = panneau.querySelector('#rm-vider'); if (bv) bv.addEventListener('click', () => { bloque = null; vider(); });
    const bj = panneau.querySelector('#rm-journal'); if (bj) bj.addEventListener('click', exporterJournal);
  }

  function estPage1015() {
    const t = (document.title + ' ' + ((document.body && document.body.innerText) || '').slice(0, 3000));
    return /\b1015\b/.test(t) && /rate.?limit|limit/i.test(t);
  }

  function apprendreCettePage(forcer) {
    if (!cartesPage.length) { majPanneau(); return; }
    // Une page déjà apprise AVANT la liste du 25/09 peut porter une cible (un slug vide) : elle repart d'elle-même.
    const fCibles = lire('rm_ciblesFaites', {});
    const cibleOuverte = cartesPage.some(x => CIBLE.has(x.idProduct) && !fCibles[x.idProduct]);
    if (!forcer && marqueDeLaPage() && !cibleOuverte) { majPanneau(); vider(); return; }
    enfiler({ cle: ctx.cle, slugSet: ctx.slugSet, cartes: cartesPage, le: Date.now(), derniere: !ctx.hrefSuivant });
    bloque = null;
    vider();
  }

  // Touche N : le lien « page suivante » que la page affiche. Jamais quand on tape dans un champ.
  document.addEventListener('keydown', e => {
    if ((e.key !== 'n' && e.key !== 'N') || e.ctrlKey || e.metaKey || e.altKey) return;
    const cible = e.target; if (cible && (cible.isContentEditable || /^(input|textarea|select)$/i.test(cible.tagName))) return;
    if (ctx.hrefSuivant) location.href = ctx.hrefSuivant;
  });
  // Le décompte « page précédente il y a » et la reprise se rafraîchissent seuls.
  setInterval(() => { if (!enCours) majPanneau(); }, 15000);

  majPanneau();
  if (lire('rm_auto', true)) apprendreCettePage(false);
  else vider();   // même en manuel, une file laissée par une page précédente repart
})();
