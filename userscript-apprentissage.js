// ==UserScript==
// @name         Rat-Market — Apprentissage manuel Cardmarket
// @namespace    rat-market
// @version      1.10
// @description  Apprend chaque page de galerie Singles dès son chargement — une vignette sans image comprise, par son lien et son titre —, te donne la liste ORDONNÉE des seules PAGES UTILES (celles qui portent un produit à apprendre), et tient un JOURNAL par page (📥 pour l'exporter). Lit UNIQUEMENT la page ouverte — ne navigue jamais.
// @match        https://www.cardmarket.com/*/Pokemon/Products/Singles*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @connect      pokemon-proxy-ratnoir666.onrender.com
// @run-at       document-idle
// ==/UserScript==

// ============================================================
// 1.10 — 2026-09-28 : NE VISITER QUE LES PAGES UTILES, ET PLUS JAMAIS UN ENVOI REFUSÉ PAR NOTRE SERVEUR
// ============================================================
// Ton journal 1.9 : 223 pages, 6 912 produits reçus, 6 476 déjà exacts (94 %) — la passe relisait du connu, et chaque page
// chargée coûte chez Cardmarket (1015). Et 3 envois refusés par NOTRE serveur (429, 120 envois/h), 4 pages restées en file.
// · LES PAGES UTILES (`PAGES_UTILES`, generer-pages-utiles.js) : la page où chaque produit à apprendre se trouve, dans une liste
//   triée par nom (`sortBy=name_asc`, 30 par page, sans `perSite`), calculée puis calibrée sur les pages de tes journaux ; d'abord
//   les pages SÛRES (une cible a une offre au guide du 27/09), puis les autres, par valeur. Le panneau montre la PROCHAINE, dit si
//   la page ouverte en fait partie, et — si une cible attendue n'y est pas (le calcul se trompe d'une page ~7 % du temps) — la page
//   voisine à ouvrir. Une page utile compte faite quand elle a été ENVOYÉE (200, ou mise en file par le serveur).
// · 202 « mis en file » : au-delà de 120 envois/h, le serveur ne refuse plus un envoi — il le garde en file et l'apprend à la même
//   cadence (collecte-cartes/file-apprentissage.js). La page sort de ta file locale ; le panneau le dit. Un 429 ne reste possible
//   que file serveur pleine (un abus, pas une passe) : la reprise automatique d'avant s'applique.
//
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
  const VERSION = '1.10';
  // ===================== À CONFIGURER =====================
  const URL_API = 'https://pokemon-proxy-ratnoir666.onrender.com';
  const JETON = 'K10-Sr7izvo-CG3bSRfCbhSnw8KTNrbJ';
  const MAX_CARTES_PAR_ENVOI = 200;
  const SEUIL_TERMINEE = 90;           // % de produits numérotés à partir duquel une expansion est « terminée »
  const REVEIL_MAX_MS = 120000, PAUSE_REVEIL_MS = 5000, ESSAIS_RESEAU = 3;

  // La liste du 2026-09-27 (LISTE-SEUL-CARDMARKET-2026-09-27.json, generer-cibles-userscript.js) : ce que SEUL Cardmarket peut t'apprendre ET
  // que ta passe peut VOIR (une offre au guide du 30/08) — 14 jamais appris, 231 au slug vide, 23 expansions, triées par VALEUR
  // (prix de tendance du guide). Les 462 invisibles (aucune offre : absents des listes Cardmarket) n'y sont pas.
  const LISTE = [[3324,"SM-P Sun-Moon-Promos — 77 slug vide · 12475 €"],
    [6381,"mC MEGA-Start-Deck-100-Battle-Collection — 77 slug vide · 1075 €"],
    [5201,"CRZ Crown-Zenith — 13 slug vide · 476 €"],
    [3214,"S-P Sword-Shield-Promos — 25 slug vide · 465 €"],
    [4382,"FST Fusion-Strike — 4 slug vide · 174 €"],
    [6443,"POR Perfect-Order — 2 slug vide · 54 €"],
    [5861,"RAID Raid-Battle — 3 jamais appris · 45 €"],
    [5241,"SVP SV-Black-Star-Promos — 2 slug vide · 35 €"],
    [5212,"SV-P Scarlet-Violet-Promos — 1 slug vide · 28 €"],
    [6517,"CRI Chaos-Rising — 1 slug vide · 22 €"],
    [6096,"DRI Destined-Rivals — 1 slug vide · 15 €"],
    [1745,"SUM Sun-Moon — 2 jamais appris · 4 €"],
    [1579,"PLF Plasma-Freeze — 1 jamais appris · 2 €"],
    [4313,"DP3 Shining-Darkness — 2 jamais appris · 2 €"],
    [4317,"DP2 Secret-of-the-Lakes — 2 jamais appris · 2 €"],
    [5519,"sv4a Shiny-Treasure-ex — 23 slug vide · 1 €"],
    [4466,"G1 Leaders-Stadium — 1 jamais appris · 1 €"],
    [5385,"OBF Obsidian-Flames — 2 slug vide · 1 €"],
    [5223,"SVI Scarlet-Violet — 1 slug vide · 1 €"],
    [5890,"BA24 Battle-Academy-2024 — 1 jamais appris · 0 €"],
    [6409,"xm2a MEGA-Dream-ex-Additionals — 2 slug vide · 0 €"],
    [4074,"CP4 Premium-Champion-Pack — 1 jamais appris · 0 €"],
    [6127,"SV-P/ID Scarlet-Violet-Indonesian-Promos — 1 jamais appris · 0 €"]];

  // Les produits CIBLES, par expansion : [idProduct, « J » jamais appris | « V » slug vide, nom du catalogue], les plus chers d'abord.
  const CIBLES = {"1579":[[449553,"J","Frozen City"]],"1745":[[295426,"J","Oranguru [Instruct | Psychic]"],[295315,"J","Rowlet [Tackle | Leafage]"]],"3214":[[855003,"V","Champions Festival [Duckboat]"],[571391,"V","Jolteon VMAX [Max Thunder Rumble]"],[571389,"V","Flareon VMAX [Max Detonate]"],[463119,"V","Hatenna [Find a Friend | Psyshot]"],[650951,"V","Hisuian Basculin [Submerge Silently | Bite]"],[570878,"V","Cheryl"],[574590,"V","Klara"],[605825,"V","Fire Energy"],[605829,"V","Fighting Energy"],[605830,"V","Darkness Energy"],[666790,"V","Cyllene"],[671881,"V","Barry"],[675889,"V","Archeops [Primal Turbo | Speed Wing]"],[675890,"V","Double Turbo Energy"],[738957,"V","Grass Energy"],[738962,"V","Fighting Energy"],[738963,"V","Darkness Energy"],[468299,"V","Darkness Energy"],[525030,"V","Grass Energy"],[525035,"V","Fire Energy"],[525055,"V","Fighting Energy"],[525195,"V","Gym Trainer"],[576798,"V","Escape Rope"],[605824,"V","Grass Energy"],[696018,"V","Float Stone"]],"3324":[[470004,"V","Mimikyu [Scream]"],[469964,"V","Yokohama's Pikachu [Sightseeing | Thunder Jolt]"],[469959,"V","Yokohama's Pikachu [Deep Sea Exploration | Tail Whap]"],[471479,"V","Pikachu [Quick Attack | Thunderbolt]"],[471609,"V","Acerola"],[471679,"V","Champions Festival [Duckboat]"],[469939,"V","Pikachu [Thunder Shock]"],[471659,"V","Mewtwo [Mind Report | Psyshock]"],[471514,"V","Pikachu [Thunder Jolt]"],[470159,"V","Abareru-kun"],[471449,"V","Mewtwo GX [Super Psy Bolt | Psycrush GX]"],[471599,"V","Pikachu GX [Agility | Volt Tackle | Tail Break GX]"],[471029,"V","Detective Pikachu [Scout | Surprise Attack]"],[471684,"V","Champions Festival [Duckboat]"],[471009,"V","Cynthia"],[471019,"V","Detective Pikachu [Scout | Surprise Attack]"],[470169,"V","Jirachi [Stellar Wish | Slap]"],[469954,"V","Zapdos [Thunder Shock | Drill Peck]"],[471519,"V","Pikachu [Thunder Jolt]"],[469949,"V","Articuno [Gust | Sheer Cold]"],[468679,"V","Rowlet [Tackle | Leafage]"],[470174,"V","Sylveon GX [Magical Ribbon | Fairy Wind | Plea GX]"],[471504,"V","Litten [Find | Flare]"],[471074,"V","Psychic Energy"],[471394,"V","Fairy Energy"],[471084,"V","Darkness Energy"],[470039,"V","Tate & Liza"],[679289,"V","Mewtwo GX [Telekinesis | Reigning Pulse | Psychic Nova GX]"],[471524,"V","Eevee [Gnaw]"],[471444,"V","Erika"],[471534,"V","Water Energy"],[471484,"V","Red's Challenge"],[469899,"V","Leafeon GX [Breath of the Leaves | Solar Beam | Grand Bloom GX]"],[471049,"V","Yveltal [Derail | Clutch]"],[471644,"V","Pokémon Communication"],[469704,"V","Samson Oak"],[470994,"V","Choice Helmet"],[469904,"V","Glaceon GX [Freezing Gaze | Frost Bullet | Polar Spear GX]"],[469739,"V","Mr. Mime GX [Magic Evens | Breakdown | Life Trick GX]"],[471654,"V","Volcanion [Flare Starter | High-Heat Blast]"],[471039,"V","Janine"],[471584,"V","Hapu"],[470984,"V","Pokémon Communication"],[826648,"V","Tornadus GX [Gust | Wild Fury | Destructive Cyclone GX]"],[470079,"V","Ear-Ringing Bell"],[470149,"V","Blaine's Quiz Show"],[470059,"V","Carvanha [Agility]"],[471429,"V","Dragonium Z: Dragon Claw"],[470179,"V","Erika's Hospitality"],[471419,"V","Crabrawler [Jab | Confront]"],[468504,"V","Oranguru [Instruct | Psychic]"],[468564,"V","Togedemaru [Nuzzle | Rollout]"],[468569,"V","Choice Band"],[468764,"V","Mareanie [Peck | Pin Missile]"],[468784,"V","Hala"],[468829,"V","Ultra Ball"],[468854,"V","Professor Kukui"],[468864,"V","Rainbow Energy"],[469144,"V","Tapu Koko [Flying Flip | Electric Ball]"],[469159,"V","Water Energy"],[469189,"V","Fairy Energy"],[469279,"V","Tapu Lele [Psywave | Magical Swap]"],[469289,"V","Tapu Koko [Flying Flip | Electric Ball]"],[469379,"V","Grass Energy"],[469389,"V","Fire Energy"],[469424,"V","Guzma"],[469464,"V","Darkness Energy"],[469659,"V","Necrozma GX [Light's End | Prismatic Burst | Black Ray GX]"],[469779,"V","Zekrom GX [Bullet Uppercut | Swift Bolt Strike | Rampage Bolt GX]"],[469789,"V","Mallow"],[469889,"V","Cynthia"],[469894,"V","Poipole [Eye Opener | Peck]"],[469914,"V","Escape Board"],[469924,"V","Pal Pad"],[470974,"V","Order Pad"],[471004,"V","Judge"],[471069,"V","Lightning Energy"]],"4074":[[562811,"J","Grass Energy"]],"4313":[[698901,"J","Darkness Energy [Special]"],[698902,"J","Metal Energy [Special]"]],"4317":[[699115,"J","Darkness Energy [Special]"],[699116,"J","Metal Energy [Special]"]],"4382":[[582981,"V","Celebi V [Leaflet Dance | Slash Back]"],[653293,"V","Quick Ball"],[883765,"V","Galarian Obstagoon [Silence | Merciless Strike]"],[653292,"V","Quick Ball"]],"4466":[[605156,"J","Brock's Mankey [Fidget | Karate Chop]"]],"5201":[[691947,"V","Origin Forme Palkia VSTAR [Subspace Swell | Star Portal]"],[691889,"V","Mew [Mysterious Tail | Psyshot]"],[691920,"V","Glaceon VSTAR [Icicle Shot | Crystal Star]"],[691916,"V","Entei V [Fleet-Footed | Burning Rondo]"],[691936,"V","Hisuian Zoroark VSTAR [Ticking Curse | Phantom Star]"],[691931,"V","Hisuian Samurott V [Basket Crash | Shadow Slash]"],[691882,"V","Magmortar [Mega Punch | Boltsplosion]"],[695867,"V","Fighting Energy"],[695862,"V","Grass Energy"],[695863,"V","Fire Energy"],[695865,"V","Lightning Energy"],[695868,"V","Darkness Energy"],[695869,"V","Metal Energy"]],"5212":[[841254,"V","Pikachu ex [Tail Whap | Thunder]"]],"5223":[[712642,"V","Annihilape [Rage Fist | Dynamite Punch]"]],"5241":[[850982,"V","Espeon ex [Psych Out | Amazez]"],[810392,"V","Eevee ex [Rainbow DNA | Coruscating Quartz]"]],"5385":[[725102,"V","Toedscruel ex [Protective Mycelium | Colony Rush]"],[804328,"V","Espeon [Psychic Assault | Psy Bolt]"]],"5519":[[746564,"V","Penny"],[746541,"V","Nest Ball"],[746539,"V","Superior Energy Retrieval"],[746442,"V","Luxio [Zap Kick | Head Bolt]"],[746463,"V","Kirlia [Magical Shot | Psychic]"],[746571,"V","Reversal Energy"],[746409,"V","Quaxly [Reckless Charge]"],[746479,"V","Greavard [Graveyard Gamboling]"],[746531,"V","Greedent [Bite | Enhanced Fang]"],[746554,"V","Clavell"],[746558,"V","Professor's Research - Professor Sada"],[746559,"V","Professor's Research - Professor Turo"],[746501,"V","Sneasel [Dig Claws]"],[746540,"V","Super Rod"],[746220,"V","Toedscool [Furious Kicks]"],[746505,"V","Bisharp [Dark Cutter | Double-Edged Slash]"],[746533,"V","Oinkologne [Finest Selection | Perfume Press]"],[746412,"V","Wiglett [Twisting Strike]"],[746210,"V","Pineco [Rollout | SV2D]"],[746224,"V","Rellor [Ball Roll]"],[746516,"V","Noibat [Gust]"],[746448,"V","Pawmi [Light Punch | Zap Kick]"],[746562,"V","Arven"]],"5861":[[783507,"J","Alcremie VMAX [Aromatherapy | Draining Kiss | Dazzling Gleam]"],[783508,"J","Alcremie VMAX [Aromatherapy | Draining Kiss | Dazzling Gleam]"],[783509,"J","Alcremie VMAX [Aromatherapy | Draining Kiss | Dazzling Gleam]"]],"5890":[[786728,"J","Basic Lightning Energy"]],"6096":[[826116,"V","Team Rocket's Crobat ex [Biting Spree | Assassin's Return]"]],"6127":[[894273,"J","Pikachu [Iron Tail | Electro Ball]"]],"6381":[[864068,"V","Mega Charizard Y ex [Explosion Y]"],[864067,"V","Lillie's Clefairy ex [Fairy Zone | Full Moon Rondo]"],[864065,"V","Mega Feraligatr ex [Mortal Crunch]"],[863409,"V","Mega Emboar ex [Crimson Blast]"],[863780,"V","Hydreigon ex [Greed Eater | Dark Bite]"],[863653,"V","Houndstone ex [Horrifying Fang]"],[863614,"V","Latias ex [Skyliner | Eon Blade]"],[863880,"V","Miltank [Bellyful of Milk | Tackle]"],[864018,"V","Lacey"],[864022,"V","Kofu"],[863821,"V","Melmetal ex [Iron Swing]"],[863417,"V","Larvesta [Ram | Steady Firebreathing]"],[863875,"V","Noctowl [Jewel Seeker | Speed Wing]"],[863727,"V","Koraidon ex [Orichalcum Fang | Impact Blow]"],[863566,"V","Morpeko [Snack Seek | Pick and Stick]"],[863752,"V","Houndoom [Call to Muster | Pitch-Black Fangs]"],[863731,"V","Iron Boulder ex [Repulsor Axe | Power Stomp]"],[863751,"V","Houndour [Playful Kick]"],[863853,"V","Koraidon ex [Retribution Strike | Kaiser Tackle]"],[863569,"V","Iono's Tadbulb [Tiny Charge]"],[863670,"V","Meditite [Slap | Kick]"],[863671,"V","Medicham [Low Sweep | High Jump Kick]"],[863697,"V","Mienfoo [Kick]"],[863698,"V","Mienshao [Low Sweep | Smash Uppercut]"],[863699,"V","Landorus [Fist of Focus | Buster Swing]"],[863706,"V","Mudbray [Smash Kick | Mud-Slap]"],[863707,"V","Mudsdale [Mud Stock | High Horsepower]"],[863718,"V","Nacli [Ram]"],[863719,"V","Naclstack [Rock Hurl]"],[863765,"V","Marnie's Scraggy [Crunch]"],[863766,"V","Marnie's Scrafty [Rear Kick | Wild Tackle]"],[863808,"V","Klink [Hard Gears]"],[863809,"V","Klang [Hard Gears]"],[863810,"V","Klinklang [Gear Coating | Hammer In]"],[863896,"V","Lopunny [Dashing Kick | Spiral Kick]"],[863926,"V","Hop's Cramorant [Fickle Spitting]"],[863972,"V","Night Stretcher"],[864038,"V","Ignition Energy"],[863527,"V","Magnemite [Lightning Ball]"],[863573,"V","Kilowattrel [Glide | Storm Bolt]"],[863723,"V","Klawf [Snipping Pincers | Hammer In]"],[863580,"V","Miraidon ex [Slashing Claw | Hadron Spark]"],[863746,"V","Haunter [Spooky Shot]"],[863528,"V","Magneton [Overvolt Discharge | Electric Ball]"],[863576,"V","Iron Hands [Volt Wave | Superalloy Hands]"],[863579,"V","Miraidon [Electric Claws | Mach Bolt]"],[863550,"V","Joltik [Jolting Charge]"],[863797,"V","Mawile [Call for Family | Bite]"],[863613,"V","Latias [Allure | Lagoon Flight]"],[864013,"V","Judge"],[863315,"V","Heracross [Body Slam | Seismic Toss]"],[863838,"V","Iron Crown [Deleting Slash | Slicing Blade]"],[863968,"V","Hop's Bag"],[863390,"V","Magcargo ex [Hot Magma | Ground Burn]"],[863481,"V","Milotic ex [Sparkling Scales | Hypno Splash]"],[863499,"V","Kyurem ex [Slash | Blizzard Burst]"],[863531,"V","Iono's Electrode [Thump-Thump Boom | Electric Ball]"],[863608,"V","Grumpig [Energized Steps | Psychic Sphere]"],[863904,"V","Mega Audino ex [Kaleidowaltz | Ear Force]"],[863416,"V","Heatmor [Licking Catch | Fire Claws]"],[863444,"V","Hearthflame Mask Ogerpon [Fire Kagura | Searing Flame]"],[863492,"V","Lumineon [Return | Razor Fin]"],[863539,"V","Manectric [Zap Kick | Flash Impact]"],[863556,"V","Helioptile [Collect | Static Shock]"],[863557,"V","Heliolisk [Wild Charge]"],[863645,"V","Impidimp [Gentle Slap]"],[863646,"V","Morgrem [Light Punch | Smash Kick]"],[863662,"V","Iron Boulder [Adjusted Horn]"],[863663,"V","Iron Crown ex [Cobalt Command | Twin Shotels]"],[863817,"V","Magearna [Auto Heal | Spike Draw]"],[863933,"V","Iron Defender"],[863952,"V","Hyper Aroma"],[863955,"V","Hand Trimmer"],[864009,"V","Lucian"],[864028,"V","Lt. Surge's Bargain"],[864029,"V","Morty's Conviction"],[864032,"V","Lisia's Appeal"]],"6409":[[861753,"V","Bouffalant [Curly Wall | Boundless Power]"],[861752,"V","Bouffalant [Curly Wall | Boundless Power]"]],"6443":[[877540,"V","Rosa's Encouragement"],[877512,"V","Espurr [Nap | Stampede]"]],"6517":[[886513,"V","AZ's Tranquility"]]};

  // Les PAGES UTILES (PAGES-UTILES-2026-09-27.json, generer-pages-utiles.js) : [ordre, idExpansion, page, sûre (1/0/null), voisine de marge (1/0),
  // [idProduct des cibles], code, slugSet, chemin] — la page où chaque produit à apprendre se trouve, triée par nom, dans l'ordre de valeur.
  const PAGES_UTILES = [[1,3324,1,1,0,[471609,470159,469949],"SM-P","Sun-Moon-Promos","/en/Pokemon/Products/Singles/Sun-Moon-Promos?searchMode=v2&idCategory=51&idExpansion=3324&idRarity=0&sortBy=name_asc"],[2,3324,2,1,0,[471679,471684,469949,471499,470994,470149,470059,468569],"SM-P","Sun-Moon-Promos","/en/Pokemon/Products/Singles/Sun-Moon-Promos?searchMode=v2&idCategory=51&idExpansion=3324&idRarity=0&sortBy=name_asc&site=2"],[3,3324,3,1,0,[471029,471009,471019,471499,471084,470994,470079,471429,471419,468499,468569,469179,469464,469889],"SM-P","Sun-Moon-Promos","/en/Pokemon/Products/Singles/Sun-Moon-Promos?searchMode=v2&idCategory=51&idExpansion=3324&idRarity=0&sortBy=name_asc&site=3"],[4,3324,4,1,0,[471059,471394,471524,471444,470079,470179,469189,469389,469914,471079],"SM-P","Sun-Moon-Promos","/en/Pokemon/Products/Singles/Sun-Moon-Promos?searchMode=v2&idCategory=51&idExpansion=3324&idRarity=0&sortBy=name_asc&site=4"],[5,3324,5,1,0,[471614,471059,469904,471054,471584,468784,469379,469389,469424],"SM-P","Sun-Moon-Promos","/en/Pokemon/Products/Singles/Sun-Moon-Promos?searchMode=v2&idCategory=51&idExpansion=3324&idRarity=0&sortBy=name_asc&site=5"],[6,3324,6,1,0,[470169,471504,469899,471039,471004,471069],"SM-P","Sun-Moon-Promos","/en/Pokemon/Products/Singles/Sun-Moon-Promos?searchMode=v2&idCategory=51&idExpansion=3324&idRarity=0&sortBy=name_asc&site=6"],[7,3324,7,1,0,[471659,471449,471454,469879,471504,679289,468699,468764,469789,471389],"SM-P","Sun-Moon-Promos","/en/Pokemon/Products/Singles/Sun-Moon-Promos?searchMode=v2&idCategory=51&idExpansion=3324&idRarity=0&sortBy=name_asc&site=7"],[8,3324,8,1,0,[470004,471659,742025,471449,471454,469879,471664,679289,470979,470989,469739,468504,469659,469924,470974],"SM-P","Sun-Moon-Promos","/en/Pokemon/Products/Singles/Sun-Moon-Promos?searchMode=v2&idCategory=51&idExpansion=3324&idRarity=0&sortBy=name_asc&site=8"],[9,3324,9,1,0,[471479,469939,471624,471514,742025,471599,471519,469799,469894],"SM-P","Sun-Moon-Promos","/en/Pokemon/Products/Singles/Sun-Moon-Promos?searchMode=v2&idCategory=51&idExpansion=3324&idRarity=0&sortBy=name_asc&site=9"],[10,3324,10,1,0,[471644,470984,469894],"SM-P","Sun-Moon-Promos","/en/Pokemon/Products/Singles/Sun-Moon-Promos?searchMode=v2&idCategory=51&idExpansion=3324&idRarity=0&sortBy=name_asc&site=10"],[11,3324,11,1,0,[468679,471074,471484,469454,468484,468489,468494,468854,468864,469169],"SM-P","Sun-Moon-Promos","/en/Pokemon/Products/Singles/Sun-Moon-Promos?searchMode=v2&idCategory=51&idExpansion=3324&idRarity=0&sortBy=name_asc&site=11"],[12,3324,12,1,0,[468679,470174,470039,469704,468704,469144,469279,469289],"SM-P","Sun-Moon-Promos","/en/Pokemon/Products/Singles/Sun-Moon-Promos?searchMode=v2&idCategory=51&idExpansion=3324&idRarity=0&sortBy=name_asc&site=12"],[13,3324,13,1,0,[470039,471654,826648,468564,468799,468829,469279,471689,471694,471699],"SM-P","Sun-Moon-Promos","/en/Pokemon/Products/Singles/Sun-Moon-Promos?searchMode=v2&idCategory=51&idExpansion=3324&idRarity=0&sortBy=name_asc&site=13"],[14,3324,14,1,0,[469964,469959,469954,471534,471064,471049,471654,469159,469779,469784,471699],"SM-P","Sun-Moon-Promos","/en/Pokemon/Products/Singles/Sun-Moon-Promos?searchMode=v2&idCategory=51&idExpansion=3324&idRarity=0&sortBy=name_asc&site=14"],[15,6381,10,1,0,[863915,863752,863926,863746,863315,863968,863608,863416,863444,863556,863557,863955],"mC","MEGA-Start-Deck-100-Battle-Collection","/en/Pokemon/Products/Singles/MEGA-Start-Deck-100-Battle-Collection?searchMode=v2&idCategory=51&idExpansion=6381&idRarity=0&sortBy=name_asc&site=10"],[16,6381,11,1,0,[863780,863653,863752,863731,863751,863569,864038,863576,863838,863531,863645,863662,863663,863933,863952],"mC","MEGA-Start-Deck-100-Battle-Collection","/en/Pokemon/Products/Singles/MEGA-Start-Deck-100-Battle-Collection?searchMode=v2&idCategory=51&idExpansion=6381&idRarity=0&sortBy=name_asc&site=11"],[17,6381,12,1,0,[864018,864022,863727,863853,863699,863808,863809,863810,863573,863723,863550,864013,863499],"mC","MEGA-Start-Deck-100-Battle-Collection","/en/Pokemon/Products/Singles/MEGA-Start-Deck-100-Battle-Collection?searchMode=v2&idCategory=51&idExpansion=6381&idRarity=0&sortBy=name_asc&site=12"],[18,6381,13,1,0,[864067,863614,863417,863699,863896,863613,864028,864032],"mC","MEGA-Start-Deck-100-Battle-Collection","/en/Pokemon/Products/Singles/MEGA-Start-Deck-100-Battle-Collection?searchMode=v2&idCategory=51&idExpansion=6381&idRarity=0&sortBy=name_asc&site=13"],[19,6381,14,1,0,[863671,863765,863766,863896,863527,863528,863797,863390,863492,863539,863817,864009,864028],"mC","MEGA-Start-Deck-100-Battle-Collection","/en/Pokemon/Products/Singles/MEGA-Start-Deck-100-Battle-Collection?searchMode=v2&idCategory=51&idExpansion=6381&idRarity=0&sortBy=name_asc&site=14"],[20,6381,15,1,0,[864068,864065,863409,863880,863821,863670,863671,863697,863698,863765,863579,863797,863481,863904],"mC","MEGA-Start-Deck-100-Battle-Collection","/en/Pokemon/Products/Singles/MEGA-Start-Deck-100-Battle-Collection?searchMode=v2&idCategory=51&idExpansion=6381&idRarity=0&sortBy=name_asc&site=15"],[21,6381,16,1,0,[863880,863875,863566,863706,863707,863718,863719,863972,863580,863579,863481,863646,864029],"mC","MEGA-Start-Deck-100-Battle-Collection","/en/Pokemon/Products/Singles/MEGA-Start-Deck-100-Battle-Collection?searchMode=v2&idCategory=51&idExpansion=6381&idRarity=0&sortBy=name_asc&site=16"],[22,5201,1,1,0,[695868],"CRZ","Crown-Zenith","/en/Pokemon/Products/Singles/Crown-Zenith?searchMode=v2&idCategory=51&idExpansion=5201&idRarity=0&sortBy=name_asc"],[23,5201,2,1,0,[691916,695867,695863,695868],"CRZ","Crown-Zenith","/en/Pokemon/Products/Singles/Crown-Zenith?searchMode=v2&idCategory=51&idExpansion=5201&idRarity=0&sortBy=name_asc&site=2"],[24,5201,3,1,0,[691920,691936,691931,695867,695862,695863],"CRZ","Crown-Zenith","/en/Pokemon/Products/Singles/Crown-Zenith?searchMode=v2&idCategory=51&idExpansion=5201&idRarity=0&sortBy=name_asc&site=3"],[25,5201,4,1,0,[691936,691931,695865],"CRZ","Crown-Zenith","/en/Pokemon/Products/Singles/Crown-Zenith?searchMode=v2&idCategory=51&idExpansion=5201&idRarity=0&sortBy=name_asc&site=4"],[26,5201,5,1,0,[691889,691882,695869],"CRZ","Crown-Zenith","/en/Pokemon/Products/Singles/Crown-Zenith?searchMode=v2&idCategory=51&idExpansion=5201&idRarity=0&sortBy=name_asc&site=5"],[27,5201,6,1,0,[691947,691889,695869],"CRZ","Crown-Zenith","/en/Pokemon/Products/Singles/Crown-Zenith?searchMode=v2&idCategory=51&idExpansion=5201&idRarity=0&sortBy=name_asc&site=6"],[28,3214,1,1,0,[855003,671881,675889],"S-P","Sword-Shield-Promos","/en/Pokemon/Products/Singles/Sword-Shield-Promos?searchMode=v2&idCategory=51&idExpansion=3214&idRarity=0&sortBy=name_asc"],[29,3214,2,1,0,[570878,605830,666790,738963,468299,525060],"S-P","Sword-Shield-Promos","/en/Pokemon/Products/Singles/Sword-Shield-Promos?searchMode=v2&idCategory=51&idExpansion=3214&idRarity=0&sortBy=name_asc&site=2"],[30,3214,3,1,0,[605830,675890,738963,576798,738955],"S-P","Sword-Shield-Promos","/en/Pokemon/Products/Singles/Sword-Shield-Promos?searchMode=v2&idCategory=51&idExpansion=3214&idRarity=0&sortBy=name_asc&site=3"],[31,3214,4,1,0,[571389,605825,605829,738962,525035,525055,576798,696018,738955,738958],"S-P","Sword-Shield-Promos","/en/Pokemon/Products/Singles/Sword-Shield-Promos?searchMode=v2&idCategory=51&idExpansion=3214&idRarity=0&sortBy=name_asc&site=4"],[32,3214,5,1,0,[463119,650951,738957,525030,525195,605824],"S-P","Sword-Shield-Promos","/en/Pokemon/Products/Singles/Sword-Shield-Promos?searchMode=v2&idCategory=51&idExpansion=3214&idRarity=0&sortBy=name_asc&site=5"],[33,3214,6,1,0,[571391,650951,574590],"S-P","Sword-Shield-Promos","/en/Pokemon/Products/Singles/Sword-Shield-Promos?searchMode=v2&idCategory=51&idExpansion=3214&idRarity=0&sortBy=name_asc&site=6"],[34,4382,1,1,0,[582981],"FST","Fusion-Strike","/en/Pokemon/Products/Singles/Fusion-Strike?searchMode=v2&idCategory=51&idExpansion=4382&idRarity=0&sortBy=name_asc"],[35,4382,4,1,0,[883765],"FST","Fusion-Strike","/en/Pokemon/Products/Singles/Fusion-Strike?searchMode=v2&idCategory=51&idExpansion=4382&idRarity=0&sortBy=name_asc&site=4"],[36,4382,8,1,0,[653293,653292],"FST","Fusion-Strike","/en/Pokemon/Products/Singles/Fusion-Strike?searchMode=v2&idCategory=51&idExpansion=4382&idRarity=0&sortBy=name_asc&site=8"],[37,6443,2,1,0,[877512],"POR","Perfect-Order","/en/Pokemon/Products/Singles/Perfect-Order?searchMode=v2&idCategory=51&idExpansion=6443&idRarity=0&sortBy=name_asc&site=2"],[38,6443,4,1,0,[877540],"POR","Perfect-Order","/en/Pokemon/Products/Singles/Perfect-Order?searchMode=v2&idCategory=51&idExpansion=6443&idRarity=0&sortBy=name_asc&site=4"],[39,5861,1,1,0,[783507,783508,783509],"RAID","Raid-Battle","/en/Pokemon/Products/Singles/Raid-Battle?searchMode=v2&idCategory=51&idExpansion=5861&idRarity=0&sortBy=name_asc"],[40,5241,2,1,0,[850982,810392],"SVP","SV-Black-Star-Promos","/en/Pokemon/Products/Singles/SV-Black-Star-Promos?searchMode=v2&idCategory=51&idExpansion=5241&idRarity=0&sortBy=name_asc&site=2"],[41,5212,7,1,0,[841254],"SV-P","Scarlet-Violet-Promos","/en/Pokemon/Products/Singles/Scarlet-Violet-Promos?searchMode=v2&idCategory=51&idExpansion=5212&idRarity=0&sortBy=name_asc&site=7"],[42,1745,5,1,0,[295426,368765,312266],"SUM","Sun-Moon","/en/Pokemon/Products/Singles/Sun-Moon?searchMode=v2&idCategory=51&idExpansion=1745&idRarity=0&sortBy=name_asc&site=5"],[43,1745,6,1,0,[295315,312233,312222,312266,368687,312278,407019,407134],"SUM","Sun-Moon","/en/Pokemon/Products/Singles/Sun-Moon?searchMode=v2&idCategory=51&idExpansion=1745&idRarity=0&sortBy=name_asc&site=6"],[44,6517,1,1,0,[886513],"CRI","Chaos-Rising","/en/Pokemon/Products/Singles/Chaos-Rising?searchMode=v2&idCategory=51&idExpansion=6517&idRarity=0&sortBy=name_asc"],[45,6096,6,1,0,[826116],"DRI","Destined-Rivals","/en/Pokemon/Products/Singles/Destined-Rivals?searchMode=v2&idCategory=51&idExpansion=6096&idRarity=0&sortBy=name_asc&site=6"],[46,6009,3,1,0,[810421,806569,806571,806573,806575],"xPRE","Prismatic-Evolutions-Additionals","/en/Pokemon/Products/Singles/Prismatic-Evolutions-Additionals?searchMode=v2&idCategory=51&idExpansion=6009&idRarity=0&sortBy=name_asc&site=3"],[47,1579,2,1,0,[449553],"PLF","Plasma-Freeze","/en/Pokemon/Products/Singles/Plasma-Freeze?searchMode=v2&idCategory=51&idExpansion=1579&idRarity=0&sortBy=name_asc&site=2"],[48,4313,1,1,0,[698901],"DP3","Shining-Darkness","/en/Pokemon/Products/Singles/Shining-Darkness?searchMode=v2&idCategory=51&idExpansion=4313&idRarity=0&sortBy=name_asc"],[49,4313,2,1,0,[698902],"DP3","Shining-Darkness","/en/Pokemon/Products/Singles/Shining-Darkness?searchMode=v2&idCategory=51&idExpansion=4313&idRarity=0&sortBy=name_asc&site=2"],[50,4317,1,1,0,[699115],"DP2","Secret-of-the-Lakes","/en/Pokemon/Products/Singles/Secret-of-the-Lakes?searchMode=v2&idCategory=51&idExpansion=4317&idRarity=0&sortBy=name_asc"],[51,4317,3,1,0,[699116],"DP2","Secret-of-the-Lakes","/en/Pokemon/Products/Singles/Secret-of-the-Lakes?searchMode=v2&idCategory=51&idExpansion=4317&idRarity=0&sortBy=name_asc&site=3"],[52,5519,1,1,0,[746505,746562],"sv4a","Shiny-Treasure-ex","/en/Pokemon/Products/Singles/Shiny-Treasure-ex?searchMode=v2&idCategory=51&idExpansion=5519&idRarity=0&sortBy=name_asc"],[53,5519,2,1,0,[746554],"sv4a","Shiny-Treasure-ex","/en/Pokemon/Products/Singles/Shiny-Treasure-ex?searchMode=v2&idCategory=51&idExpansion=5519&idRarity=0&sortBy=name_asc&site=2"],[54,5519,4,1,0,[746479,746531],"sv4a","Shiny-Treasure-ex","/en/Pokemon/Products/Singles/Shiny-Treasure-ex?searchMode=v2&idCategory=51&idExpansion=5519&idRarity=0&sortBy=name_asc&site=4"],[55,5519,5,1,0,[746442,746463],"sv4a","Shiny-Treasure-ex","/en/Pokemon/Products/Singles/Shiny-Treasure-ex?searchMode=v2&idCategory=51&idExpansion=5519&idRarity=0&sortBy=name_asc&site=5"],[56,5519,7,1,0,[746541,746533,746516],"sv4a","Shiny-Treasure-ex","/en/Pokemon/Products/Singles/Shiny-Treasure-ex?searchMode=v2&idCategory=51&idExpansion=5519&idRarity=0&sortBy=name_asc&site=7"],[57,5519,8,1,0,[746564,746558,746559,746210,746448],"sv4a","Shiny-Treasure-ex","/en/Pokemon/Products/Singles/Shiny-Treasure-ex?searchMode=v2&idCategory=51&idExpansion=5519&idRarity=0&sortBy=name_asc&site=8"],[58,5519,9,1,0,[746571,746409,746558,746559,746224],"sv4a","Shiny-Treasure-ex","/en/Pokemon/Products/Singles/Shiny-Treasure-ex?searchMode=v2&idCategory=51&idExpansion=5519&idRarity=0&sortBy=name_asc&site=9"],[59,5519,10,1,0,[746501],"sv4a","Shiny-Treasure-ex","/en/Pokemon/Products/Singles/Shiny-Treasure-ex?searchMode=v2&idCategory=51&idExpansion=5519&idRarity=0&sortBy=name_asc&site=10"],[60,5519,11,1,0,[746539,746540,746220],"sv4a","Shiny-Treasure-ex","/en/Pokemon/Products/Singles/Shiny-Treasure-ex?searchMode=v2&idCategory=51&idExpansion=5519&idRarity=0&sortBy=name_asc&site=11"],[61,5519,12,1,0,[746412],"sv4a","Shiny-Treasure-ex","/en/Pokemon/Products/Singles/Shiny-Treasure-ex?searchMode=v2&idCategory=51&idExpansion=5519&idRarity=0&sortBy=name_asc&site=12"],[62,4466,1,1,0,[605156],"G1","Leaders-Stadium","/en/Pokemon/Products/Singles/Leaders-Stadium?searchMode=v2&idCategory=51&idExpansion=4466&idRarity=0&sortBy=name_asc"],[63,5385,3,1,0,[804328],"OBF","Obsidian-Flames","/en/Pokemon/Products/Singles/Obsidian-Flames?searchMode=v2&idCategory=51&idExpansion=5385&idRarity=0&sortBy=name_asc&site=3"],[64,5385,8,1,0,[725102],"OBF","Obsidian-Flames","/en/Pokemon/Products/Singles/Obsidian-Flames?searchMode=v2&idCategory=51&idExpansion=5385&idRarity=0&sortBy=name_asc&site=8"],[65,5223,1,1,0,[712642],"SVI","Scarlet-Violet","/en/Pokemon/Products/Singles/Scarlet-Violet?searchMode=v2&idCategory=51&idExpansion=5223&idRarity=0&sortBy=name_asc"],[66,5890,1,1,0,[786728],"BA24","Battle-Academy-2024","/en/Pokemon/Products/Singles/Battle-Academy-2024?searchMode=v2&idCategory=51&idExpansion=5890&idRarity=0&sortBy=name_asc"],[67,6409,1,1,0,[861753,861752],"xm2a","MEGA-Dream-ex-Additionals","/en/Pokemon/Products/Singles/MEGA-Dream-ex-Additionals?searchMode=v2&idCategory=51&idExpansion=6409&idRarity=0&sortBy=name_asc"],[68,4074,2,1,0,[562811],"CP4","Premium-Champion-Pack","/en/Pokemon/Products/Singles/Premium-Champion-Pack?searchMode=v2&idCategory=51&idExpansion=4074&idRarity=0&sortBy=name_asc&site=2"],[69,6127,7,1,0,[894273],"SV-P/ID","Scarlet-Violet-Indonesian-Promos","/en/Pokemon/Products/Singles/Scarlet-Violet-Indonesian-Promos?searchMode=v2&idCategory=51&idExpansion=6127&idRarity=0&sortBy=name_asc&site=7"],[70,6510,2,1,0,[875538,875539],"HSP","Beginning-Set-Pikachu","/en/Pokemon/Products/Singles/Beginning-Set-Pikachu?searchMode=v2&idCategory=51&idExpansion=6510&idRarity=0&sortBy=name_asc&site=2"],[71,6582,11,1,0,[889018],"CSM2DC","Shining-Synergy-GX-Starter-Deck","/en/Pokemon/Products/Singles/Shining-Synergy-GX-Starter-Deck?searchMode=v2&idCategory=51&idExpansion=6582&idRarity=0&sortBy=name_asc&site=11"],[72,6582,12,1,0,[889013,889017,889033,889045,889053],"CSM2DC","Shining-Synergy-GX-Starter-Deck","/en/Pokemon/Products/Singles/Shining-Synergy-GX-Starter-Deck?searchMode=v2&idCategory=51&idExpansion=6582&idRarity=0&sortBy=name_asc&site=12"],[73,6602,3,1,0,[909512,909513,909514],"m6a","30th-Celebration-JP","/en/Pokemon/Products/Singles/30th-Celebration-JP?searchMode=v2&idCategory=51&idExpansion=6602&idRarity=0&sortBy=name_asc&site=3"],[74,6603,2,1,0,[908297,908309],"30thC","30th-Celebration-Simplified-Chinese","/en/Pokemon/Products/Singles/30th-Celebration-Simplified-Chinese?searchMode=v2&idCategory=51&idExpansion=6603&idRarity=0&sortBy=name_asc&site=2"],[75,6603,3,1,0,[909518,909519,909520,908297,908306,908307],"30thC","30th-Celebration-Simplified-Chinese","/en/Pokemon/Products/Singles/30th-Celebration-Simplified-Chinese?searchMode=v2&idCategory=51&idExpansion=6603&idRarity=0&sortBy=name_asc&site=3"],[76,6673,11,1,0,[899830],"S-P/ID","Sword-Shield-Indonesian-Promos","/en/Pokemon/Products/Singles/Sword-Shield-Indonesian-Promos?searchMode=v2&idCategory=51&idExpansion=6673&idRarity=0&sortBy=name_asc&site=11"],[77,6673,12,1,0,[899809,899812],"S-P/ID","Sword-Shield-Indonesian-Promos","/en/Pokemon/Products/Singles/Sword-Shield-Indonesian-Promos?searchMode=v2&idCategory=51&idExpansion=6673&idRarity=0&sortBy=name_asc&site=12"],[78,6381,9,0,1,[863608],"mC","MEGA-Start-Deck-100-Battle-Collection","/en/Pokemon/Products/Singles/MEGA-Start-Deck-100-Battle-Collection?searchMode=v2&idCategory=51&idExpansion=6381&idRarity=0&sortBy=name_asc&site=9"],[79,6381,17,0,1,[863875,863719,863972],"mC","MEGA-Start-Deck-100-Battle-Collection","/en/Pokemon/Products/Singles/MEGA-Start-Deck-100-Battle-Collection?searchMode=v2&idCategory=51&idExpansion=6381&idRarity=0&sortBy=name_asc&site=17"],[80,1605,1,0,0,[280574,280575],"BEST","Best-of-Game-Cards-Promos","/en/Pokemon/Products/Singles/Best-of-Game-Cards-Promos?searchMode=v2&idCategory=51&idExpansion=1605&idRarity=0&sortBy=name_asc"],[81,2487,2,0,0,[407049,407394,407184,407259],"UNM","Unified-Minds","/en/Pokemon/Products/Singles/Unified-Minds?searchMode=v2&idCategory=51&idExpansion=2487&idRarity=0&sortBy=name_asc&site=2"],[82,2487,3,0,0,[406974],"UNM","Unified-Minds","/en/Pokemon/Products/Singles/Unified-Minds?searchMode=v2&idCategory=51&idExpansion=2487&idRarity=0&sortBy=name_asc&site=3"],[83,2487,4,0,0,[407109,406979,407309,407034,407149,407219,407244],"UNM","Unified-Minds","/en/Pokemon/Products/Singles/Unified-Minds?searchMode=v2&idCategory=51&idExpansion=2487&idRarity=0&sortBy=name_asc&site=4"],[84,2487,5,0,0,[406979,406984],"UNM","Unified-Minds","/en/Pokemon/Products/Singles/Unified-Minds?searchMode=v2&idCategory=51&idExpansion=2487&idRarity=0&sortBy=name_asc&site=5"],[85,2487,6,0,0,[406959,407089,406999],"UNM","Unified-Minds","/en/Pokemon/Products/Singles/Unified-Minds?searchMode=v2&idCategory=51&idExpansion=2487&idRarity=0&sortBy=name_asc&site=6"],[86,2487,7,0,0,[407294,407089,406999],"UNM","Unified-Minds","/en/Pokemon/Products/Singles/Unified-Minds?searchMode=v2&idCategory=51&idExpansion=2487&idRarity=0&sortBy=name_asc&site=7"],[87,2487,8,0,0,[407294,407189,407399],"UNM","Unified-Minds","/en/Pokemon/Products/Singles/Unified-Minds?searchMode=v2&idCategory=51&idExpansion=2487&idRarity=0&sortBy=name_asc&site=8"],[88,2487,9,0,0,[407324,407404,407414],"UNM","Unified-Minds","/en/Pokemon/Products/Singles/Unified-Minds?searchMode=v2&idCategory=51&idExpansion=2487&idRarity=0&sortBy=name_asc&site=9"],[89,1800,1,0,0,[312251,312206,312250,312270],"GRI","Guardians-Rising","/en/Pokemon/Products/Singles/Guardians-Rising?searchMode=v2&idCategory=51&idExpansion=1800&idRarity=0&sortBy=name_asc"],[90,1800,2,0,0,[368694,312225,312244,312271,368733,368697,312294,368675,368761],"GRI","Guardians-Rising","/en/Pokemon/Products/Singles/Guardians-Rising?searchMode=v2&idCategory=51&idExpansion=1800&idRarity=0&sortBy=name_asc&site=2"],[91,1800,3,0,0,[368739,312295,312229,368694,312246,368759,368701,312273,368668,312221,368706,368731,368753],"GRI","Guardians-Rising","/en/Pokemon/Products/Singles/Guardians-Rising?searchMode=v2&idCategory=51&idExpansion=1800&idRarity=0&sortBy=name_asc&site=3"],[92,1800,4,0,0,[368680],"GRI","Guardians-Rising","/en/Pokemon/Products/Singles/Guardians-Rising?searchMode=v2&idCategory=51&idExpansion=1800&idRarity=0&sortBy=name_asc&site=4"],[93,1800,6,0,0,[312224,312247,368745,368757,368692],"GRI","Guardians-Rising","/en/Pokemon/Products/Singles/Guardians-Rising?searchMode=v2&idCategory=51&idExpansion=1800&idRarity=0&sortBy=name_asc&site=6"],[94,1800,7,0,0,[312232,312205,312254,368703,312279,368735,368754,312256,312282],"GRI","Guardians-Rising","/en/Pokemon/Products/Singles/Guardians-Rising?searchMode=v2&idCategory=51&idExpansion=1800&idRarity=0&sortBy=name_asc&site=7"],[95,1800,8,0,0,[368703,368735,368754],"GRI","Guardians-Rising","/en/Pokemon/Products/Singles/Guardians-Rising?searchMode=v2&idCategory=51&idExpansion=1800&idRarity=0&sortBy=name_asc&site=8"],[96,1687,1,0,0,[295223,295216,295291],"BKP","BREAKpoint","/en/Pokemon/Products/Singles/BREAKpoint?searchMode=v2&idCategory=51&idExpansion=1687&idRarity=0&sortBy=name_asc"],[97,1687,2,0,0,[312281,295273,295240,295228,368737,312228,368664,368705,295275,295276],"BKP","BREAKpoint","/en/Pokemon/Products/Singles/BREAKpoint?searchMode=v2&idCategory=51&idExpansion=1687&idRarity=0&sortBy=name_asc&site=2"],[98,1687,3,0,0,[295272,295273,295239,368756,368662],"BKP","BREAKpoint","/en/Pokemon/Products/Singles/BREAKpoint?searchMode=v2&idCategory=51&idExpansion=1687&idRarity=0&sortBy=name_asc&site=3"],[99,1687,4,0,0,[295239,312236,312213,368670,312260,368756,368662,312285],"BKP","BREAKpoint","/en/Pokemon/Products/Singles/BREAKpoint?searchMode=v2&idCategory=51&idExpansion=1687&idRarity=0&sortBy=name_asc&site=4"],[100,1687,5,0,0,[312236,312213,368670,368691,312260,295245,368769,312285,368744,368770,368749],"BKP","BREAKpoint","/en/Pokemon/Products/Singles/BREAKpoint?searchMode=v2&idCategory=51&idExpansion=1687&idRarity=0&sortBy=name_asc&site=5"],[101,1687,6,0,0,[295279,312230,368736,295227,368704],"BKP","BREAKpoint","/en/Pokemon/Products/Singles/BREAKpoint?searchMode=v2&idCategory=51&idExpansion=1687&idRarity=0&sortBy=name_asc&site=6"],[102,1660,1,0,0,[312290,295207,295201,295221,295280],"AOR","Ancient-Origins","/en/Pokemon/Products/Singles/Ancient-Origins?searchMode=v2&idCategory=51&idExpansion=1660&idRarity=0&sortBy=name_asc"],[103,1660,2,0,0,[295224,295226,295249,312248,312215,295287,312290,295259,295215,295221],"AOR","Ancient-Origins","/en/Pokemon/Products/Singles/Ancient-Origins?searchMode=v2&idCategory=51&idExpansion=1660&idRarity=0&sortBy=name_asc&site=2"],[104,1660,3,0,0,[295287,295215,295258,295211,295236],"AOR","Ancient-Origins","/en/Pokemon/Products/Singles/Ancient-Origins?searchMode=v2&idCategory=51&idExpansion=1660&idRarity=0&sortBy=name_asc&site=3"],[105,1660,4,0,0,[295264,295206,295237],"AOR","Ancient-Origins","/en/Pokemon/Products/Singles/Ancient-Origins?searchMode=v2&idCategory=51&idExpansion=1660&idRarity=0&sortBy=name_asc&site=4"],[106,1660,5,0,0,[295264,295200,295237],"AOR","Ancient-Origins","/en/Pokemon/Products/Singles/Ancient-Origins?searchMode=v2&idCategory=51&idExpansion=1660&idRarity=0&sortBy=name_asc&site=5"],[107,2437,2,0,0,[407299,406964,407114,407079,407074,407204,407374],"UNB","Unbroken-Bonds","/en/Pokemon/Products/Singles/Unbroken-Bonds?searchMode=v2&idCategory=51&idExpansion=2437&idRarity=0&sortBy=name_asc&site=2"],[108,2437,3,0,0,[407079],"UNB","Unbroken-Bonds","/en/Pokemon/Products/Singles/Unbroken-Bonds?searchMode=v2&idCategory=51&idExpansion=2437&idRarity=0&sortBy=name_asc&site=3"],[109,2437,5,0,0,[407314,407319,406994,407119],"UNB","Unbroken-Bonds","/en/Pokemon/Products/Singles/Unbroken-Bonds?searchMode=v2&idCategory=51&idExpansion=2437&idRarity=0&sortBy=name_asc&site=5"],[110,2437,6,0,0,[407059],"UNB","Unbroken-Bonds","/en/Pokemon/Products/Singles/Unbroken-Bonds?searchMode=v2&idCategory=51&idExpansion=2437&idRarity=0&sortBy=name_asc&site=6"],[111,2437,7,0,0,[407004,407194,407359],"UNB","Unbroken-Bonds","/en/Pokemon/Products/Singles/Unbroken-Bonds?searchMode=v2&idCategory=51&idExpansion=2437&idRarity=0&sortBy=name_asc&site=7"],[112,2437,9,0,0,[407239,407024,407144],"UNB","Unbroken-Bonds","/en/Pokemon/Products/Singles/Unbroken-Bonds?searchMode=v2&idCategory=51&idExpansion=2437&idRarity=0&sortBy=name_asc&site=9"],[113,1678,1,0,0,[312238,312265,312289,312217,368699,368734],"BKT","BREAKthrough","/en/Pokemon/Products/Singles/BREAKthrough?searchMode=v2&idCategory=51&idExpansion=1678&idRarity=0&sortBy=name_asc"],[114,1678,2,0,0,[312296,368665,312209,312272,312245,295266,295241,368752,368758,368693,295281],"BKT","BREAKthrough","/en/Pokemon/Products/Singles/BREAKthrough?searchMode=v2&idCategory=51&idExpansion=1678&idRarity=0&sortBy=name_asc&site=2"],[115,1678,3,0,0,[312209,312249,295210],"BKT","BREAKthrough","/en/Pokemon/Products/Singles/BREAKthrough?searchMode=v2&idCategory=51&idExpansion=1678&idRarity=0&sortBy=name_asc&site=3"],[116,1678,5,0,0,[312207,368678,312253,295244,295267,368747,368690],"BKT","BREAKthrough","/en/Pokemon/Products/Singles/BREAKthrough?searchMode=v2&idCategory=51&idExpansion=1678&idRarity=0&sortBy=name_asc&site=5"],[117,1678,6,0,0,[312252,312208,368677],"BKT","BREAKthrough","/en/Pokemon/Products/Singles/BREAKthrough?searchMode=v2&idCategory=51&idExpansion=1678&idRarity=0&sortBy=name_asc&site=6"],[118,1678,7,0,0,[368671,312220,368746,295243,368771,295270,295289],"BKT","BREAKthrough","/en/Pokemon/Products/Singles/BREAKthrough?searchMode=v2&idCategory=51&idExpansion=1678&idRarity=0&sortBy=name_asc&site=7"],[119,1612,3,0,0,[312257],"XYPR","XY-Black-Star-Promos","/en/Pokemon/Products/Singles/XY-Black-Star-Promos?searchMode=v2&idCategory=51&idExpansion=1612&idRarity=0&sortBy=name_asc&site=3"],[120,1612,4,0,0,[312264,371611,371612,371613,371614,371617,371616,371610,368698,371615],"XYPR","XY-Black-Star-Promos","/en/Pokemon/Products/Singles/XY-Black-Star-Promos?searchMode=v2&idCategory=51&idExpansion=1612&idRarity=0&sortBy=name_asc&site=4"],[121,1612,5,0,1,[312264],"XYPR","XY-Black-Star-Promos","/en/Pokemon/Products/Singles/XY-Black-Star-Promos?searchMode=v2&idCategory=51&idExpansion=1612&idRarity=0&sortBy=name_asc&site=5"],[122,6443,1,0,1,[877512],"POR","Perfect-Order","/en/Pokemon/Products/Singles/Perfect-Order?searchMode=v2&idCategory=51&idExpansion=6443&idRarity=0&sortBy=name_asc"],[123,6443,3,0,1,[877540],"POR","Perfect-Order","/en/Pokemon/Products/Singles/Perfect-Order?searchMode=v2&idCategory=51&idExpansion=6443&idRarity=0&sortBy=name_asc&site=3"],[124,2407,1,0,0,[407029],"TEU","Team-Up","/en/Pokemon/Products/Singles/Team-Up?searchMode=v2&idCategory=51&idExpansion=2407&idRarity=0&sortBy=name_asc"],[125,2407,2,0,0,[406969],"TEU","Team-Up","/en/Pokemon/Products/Singles/Team-Up?searchMode=v2&idCategory=51&idExpansion=2407&idRarity=0&sortBy=name_asc&site=2"],[126,2407,4,0,0,[407199],"TEU","Team-Up","/en/Pokemon/Products/Singles/Team-Up?searchMode=v2&idCategory=51&idExpansion=2407&idRarity=0&sortBy=name_asc&site=4"],[127,2407,5,0,0,[407209],"TEU","Team-Up","/en/Pokemon/Products/Singles/Team-Up?searchMode=v2&idCategory=51&idExpansion=2407&idRarity=0&sortBy=name_asc&site=5"],[128,2407,6,0,0,[407289,407264,407389],"TEU","Team-Up","/en/Pokemon/Products/Singles/Team-Up?searchMode=v2&idCategory=51&idExpansion=2407&idRarity=0&sortBy=name_asc&site=6"],[129,2407,7,0,0,[407329,407214,407039],"TEU","Team-Up","/en/Pokemon/Products/Singles/Team-Up?searchMode=v2&idCategory=51&idExpansion=2407&idRarity=0&sortBy=name_asc&site=7"],[130,1649,1,0,0,[295252,295230],"ROS","Roaring-Skies","/en/Pokemon/Products/Singles/Roaring-Skies?searchMode=v2&idCategory=51&idExpansion=1649&idRarity=0&sortBy=name_asc"],[131,1649,2,0,0,[295268],"ROS","Roaring-Skies","/en/Pokemon/Products/Singles/Roaring-Skies?searchMode=v2&idCategory=51&idExpansion=1649&idRarity=0&sortBy=name_asc&site=2"],[132,1649,3,0,0,[295225,295202,295248],"ROS","Roaring-Skies","/en/Pokemon/Products/Singles/Roaring-Skies?searchMode=v2&idCategory=51&idExpansion=1649&idRarity=0&sortBy=name_asc&site=3"],[133,1649,4,0,0,[295262,295242,295290,295217],"ROS","Roaring-Skies","/en/Pokemon/Products/Singles/Roaring-Skies?searchMode=v2&idCategory=51&idExpansion=1649&idRarity=0&sortBy=name_asc&site=4"],[134,1649,5,0,1,[295262,295290],"ROS","Roaring-Skies","/en/Pokemon/Products/Singles/Roaring-Skies?searchMode=v2&idCategory=51&idExpansion=1649&idRarity=0&sortBy=name_asc&site=5"],[135,2107,2,0,0,[275569,275570],"PR","Promos","/en/Pokemon/Products/Singles/Promos?searchMode=v2&idCategory=51&idExpansion=2107&idRarity=0&sortBy=name_asc&site=2"],[136,5241,3,0,1,[850982],"SVP","SV-Black-Star-Promos","/en/Pokemon/Products/Singles/SV-Black-Star-Promos?searchMode=v2&idCategory=51&idExpansion=5241&idRarity=0&sortBy=name_asc&site=3"],[137,1824,1,0,0,[312241,312288,312216],"BUS","Burning-Shadows","/en/Pokemon/Products/Singles/Burning-Shadows?searchMode=v2&idCategory=51&idExpansion=1824&idRarity=0&sortBy=name_asc"],[138,1824,2,0,0,[312204,368760],"BUS","Burning-Shadows","/en/Pokemon/Products/Singles/Burning-Shadows?searchMode=v2&idCategory=51&idExpansion=1824&idRarity=0&sortBy=name_asc&site=2"],[139,1824,3,0,0,[312201,312287,312262,312274,312240,312226,312218,368751,368673,368702,368755,368760],"BUS","Burning-Shadows","/en/Pokemon/Products/Singles/Burning-Shadows?searchMode=v2&idCategory=51&idExpansion=1824&idRarity=0&sortBy=name_asc&site=3"],[140,1824,4,0,0,[312202],"BUS","Burning-Shadows","/en/Pokemon/Products/Singles/Burning-Shadows?searchMode=v2&idCategory=51&idExpansion=1824&idRarity=0&sortBy=name_asc&site=4"],[141,1824,6,0,0,[312203],"BUS","Burning-Shadows","/en/Pokemon/Products/Singles/Burning-Shadows?searchMode=v2&idCategory=51&idExpansion=1824&idRarity=0&sortBy=name_asc&site=6"],[142,1824,8,0,0,[312227,312275],"BUS","Burning-Shadows","/en/Pokemon/Products/Singles/Burning-Shadows?searchMode=v2&idCategory=51&idExpansion=1824&idRarity=0&sortBy=name_asc&site=8"],[143,1757,1,0,0,[358429,358427],"SM","SM-Black-Star-Promos","/en/Pokemon/Products/Singles/SM-Black-Star-Promos?searchMode=v2&idCategory=51&idExpansion=1757&idRarity=0&sortBy=name_asc"],[144,1757,9,0,0,[407009,312280,312255,312231],"SM","SM-Black-Star-Promos","/en/Pokemon/Products/Singles/SM-Black-Star-Promos?searchMode=v2&idCategory=51&idExpansion=1757&idRarity=0&sortBy=name_asc&site=9"],[145,1757,11,0,0,[368763],"SM","SM-Black-Star-Promos","/en/Pokemon/Products/Singles/SM-Black-Star-Promos?searchMode=v2&idCategory=51&idExpansion=1757&idRarity=0&sortBy=name_asc&site=11"],[146,2370,1,0,0,[407084],"LOT","Lost-Thunder","/en/Pokemon/Products/Singles/Lost-Thunder?searchMode=v2&idCategory=51&idExpansion=2370&idRarity=0&sortBy=name_asc"],[147,2370,2,0,0,[407054,407169,407369],"LOT","Lost-Thunder","/en/Pokemon/Products/Singles/Lost-Thunder?searchMode=v2&idCategory=51&idExpansion=2370&idRarity=0&sortBy=name_asc&site=2"],[148,2370,3,0,0,[407164,407249,407379],"LOT","Lost-Thunder","/en/Pokemon/Products/Singles/Lost-Thunder?searchMode=v2&idCategory=51&idExpansion=2370&idRarity=0&sortBy=name_asc&site=3"],[149,2370,4,0,1,[407249],"LOT","Lost-Thunder","/en/Pokemon/Products/Singles/Lost-Thunder?searchMode=v2&idCategory=51&idExpansion=2370&idRarity=0&sortBy=name_asc&site=4"],[150,2370,5,0,0,[406989,407094],"LOT","Lost-Thunder","/en/Pokemon/Products/Singles/Lost-Thunder?searchMode=v2&idCategory=51&idExpansion=2370&idRarity=0&sortBy=name_asc&site=5"],[151,2370,6,0,0,[407094,407104],"LOT","Lost-Thunder","/en/Pokemon/Products/Singles/Lost-Thunder?searchMode=v2&idCategory=51&idExpansion=2370&idRarity=0&sortBy=name_asc&site=6"],[152,2370,8,0,0,[407364],"LOT","Lost-Thunder","/en/Pokemon/Products/Singles/Lost-Thunder?searchMode=v2&idCategory=51&idExpansion=2370&idRarity=0&sortBy=name_asc&site=8"],[153,2370,10,0,0,[407304],"LOT","Lost-Thunder","/en/Pokemon/Products/Singles/Lost-Thunder?searchMode=v2&idCategory=51&idExpansion=2370&idRarity=0&sortBy=name_asc&site=10"],[154,1521,1,0,0,[295285,295220,295212,295235,295257],"PHF","Phantom-Forces","/en/Pokemon/Products/Singles/Phantom-Forces?searchMode=v2&idCategory=51&idExpansion=1521&idRarity=0&sortBy=name_asc"],[155,1521,5,0,0,[312268,312292,312219,312243,295203,295233,295260],"PHF","Phantom-Forces","/en/Pokemon/Products/Singles/Phantom-Forces?searchMode=v2&idCategory=51&idExpansion=1521&idRarity=0&sortBy=name_asc&site=5"],[156,1521,6,0,1,[295203],"PHF","Phantom-Forces","/en/Pokemon/Products/Singles/Phantom-Forces?searchMode=v2&idCategory=51&idExpansion=1521&idRarity=0&sortBy=name_asc&site=6"],[157,1706,1,0,0,[295247,295265],"FCO","Fates-Collide","/en/Pokemon/Products/Singles/Fates-Collide?searchMode=v2&idCategory=51&idExpansion=1706&idRarity=0&sortBy=name_asc"],[158,1706,2,0,0,[295208,295254],"FCO","Fates-Collide","/en/Pokemon/Products/Singles/Fates-Collide?searchMode=v2&idCategory=51&idExpansion=1706&idRarity=0&sortBy=name_asc&site=2"],[159,1706,3,0,0,[295246],"FCO","Fates-Collide","/en/Pokemon/Products/Singles/Fates-Collide?searchMode=v2&idCategory=51&idExpansion=1706&idRarity=0&sortBy=name_asc&site=3"],[160,1706,4,0,0,[312214,312237,312261,312286,368743,295256,295282,295213,368683,368696,295232],"FCO","Fates-Collide","/en/Pokemon/Products/Singles/Fates-Collide?searchMode=v2&idCategory=51&idExpansion=1706&idRarity=0&sortBy=name_asc&site=4"],[161,1706,5,0,0,[368663,295214,295263,295238],"FCO","Fates-Collide","/en/Pokemon/Products/Singles/Fates-Collide?searchMode=v2&idCategory=51&idExpansion=1706&idRarity=0&sortBy=name_asc&site=5"],[162,1693,1,0,0,[368732],"GEN","Generations","/en/Pokemon/Products/Singles/Generations?searchMode=v2&idCategory=51&idExpansion=1693&idRarity=0&sortBy=name_asc"],[163,1693,2,0,1,[368732],"GEN","Generations","/en/Pokemon/Products/Singles/Generations?searchMode=v2&idCategory=51&idExpansion=1693&idRarity=0&sortBy=name_asc&site=2"],[164,1693,4,0,0,[295261,312263,295218,312293],"GEN","Generations","/en/Pokemon/Products/Singles/Generations?searchMode=v2&idCategory=51&idExpansion=1693&idRarity=0&sortBy=name_asc&site=4"],[165,1693,5,0,0,[368708],"GEN","Generations","/en/Pokemon/Products/Singles/Generations?searchMode=v2&idCategory=51&idExpansion=1693&idRarity=0&sortBy=name_asc&site=5"],[166,1745,1,0,1,[312277],"SUM","Sun-Moon","/en/Pokemon/Products/Singles/Sun-Moon?searchMode=v2&idCategory=51&idExpansion=1745&idRarity=0&sortBy=name_asc"],[167,1745,2,0,0,[312276,312234,312259,312284,312212,407234,312210,312277,407014,407124],"SUM","Sun-Moon","/en/Pokemon/Products/Singles/Sun-Moon?searchMode=v2&idCategory=51&idExpansion=1745&idRarity=0&sortBy=name_asc&site=2"],[168,1745,3,0,0,[407234,312235,312283,368768,407014,407124],"SUM","Sun-Moon","/en/Pokemon/Products/Singles/Sun-Moon?searchMode=v2&idCategory=51&idExpansion=1745&idRarity=0&sortBy=name_asc&site=3"],[169,1745,4,0,0,[368766,407334],"SUM","Sun-Moon","/en/Pokemon/Products/Singles/Sun-Moon?searchMode=v2&idCategory=51&idExpansion=1745&idRarity=0&sortBy=name_asc&site=4"],[170,1745,8,0,0,[312291,312242,312269,312223,312258],"SUM","Sun-Moon","/en/Pokemon/Products/Singles/Sun-Moon?searchMode=v2&idCategory=51&idExpansion=1745&idRarity=0&sortBy=name_asc&site=8"],[171,1716,1,0,0,[295251],"STS","Steam-Siege","/en/Pokemon/Products/Singles/Steam-Siege?searchMode=v2&idCategory=51&idExpansion=1716&idRarity=0&sortBy=name_asc"],[172,1716,2,0,0,[295250],"STS","Steam-Siege","/en/Pokemon/Products/Singles/Steam-Siege?searchMode=v2&idCategory=51&idExpansion=1716&idRarity=0&sortBy=name_asc&site=2"],[173,1716,3,0,0,[295250,295234,295209,295231,295283],"STS","Steam-Siege","/en/Pokemon/Products/Singles/Steam-Siege?searchMode=v2&idCategory=51&idExpansion=1716&idRarity=0&sortBy=name_asc&site=3"],[174,1716,4,0,0,[295284,295277,295209,295219,295231,295255],"STS","Steam-Siege","/en/Pokemon/Products/Singles/Steam-Siege?searchMode=v2&idCategory=51&idExpansion=1716&idRarity=0&sortBy=name_asc&site=4"],[175,1716,5,0,0,[295222,295205,295204],"STS","Steam-Siege","/en/Pokemon/Products/Singles/Steam-Siege?searchMode=v2&idCategory=51&idExpansion=1716&idRarity=0&sortBy=name_asc&site=5"],[176,6290,1,0,0,[879345,879366],"xMEG","Mega-Evolution-Additionals","/en/Pokemon/Products/Singles/Mega-Evolution-Additionals?searchMode=v2&idCategory=51&idExpansion=6290&idRarity=0&sortBy=name_asc"],[177,2075,1,0,0,[368669,368681,368684,407129,407179],"FLI","Forbidden-Light","/en/Pokemon/Products/Singles/Forbidden-Light?searchMode=v2&idCategory=51&idExpansion=2075&idRarity=0&sortBy=name_asc"],[178,2075,2,0,0,[368660,368681,368684],"FLI","Forbidden-Light","/en/Pokemon/Products/Singles/Forbidden-Light?searchMode=v2&idCategory=51&idExpansion=2075&idRarity=0&sortBy=name_asc&site=2"],[179,2075,3,0,1,[407339],"FLI","Forbidden-Light","/en/Pokemon/Products/Singles/Forbidden-Light?searchMode=v2&idCategory=51&idExpansion=2075&idRarity=0&sortBy=name_asc&site=3"],[180,2075,4,0,0,[368750,368767,368695,407339,407064,407174,407354],"FLI","Forbidden-Light","/en/Pokemon/Products/Singles/Forbidden-Light?searchMode=v2&idCategory=51&idExpansion=2075&idRarity=0&sortBy=name_asc&site=4"],[181,2075,5,0,0,[407099,368750,368767,368679,407064,407174],"FLI","Forbidden-Light","/en/Pokemon/Products/Singles/Forbidden-Light?searchMode=v2&idCategory=51&idExpansion=2075&idRarity=0&sortBy=name_asc&site=5"],[182,2075,6,0,0,[407159],"FLI","Forbidden-Light","/en/Pokemon/Products/Singles/Forbidden-Light?searchMode=v2&idCategory=51&idExpansion=2075&idRarity=0&sortBy=name_asc&site=6"],[183,2320,1,0,0,[368685,368762,407044,407254],"CES","Celestial-Storm","/en/Pokemon/Products/Singles/Celestial-Storm?searchMode=v2&idCategory=51&idExpansion=2320&idRarity=0&sortBy=name_asc"],[184,2320,2,0,0,[407384],"CES","Celestial-Storm","/en/Pokemon/Products/Singles/Celestial-Storm?searchMode=v2&idCategory=51&idExpansion=2320&idRarity=0&sortBy=name_asc&site=2"],[185,2320,5,0,0,[368772,368686,368682],"CES","Celestial-Storm","/en/Pokemon/Products/Singles/Celestial-Storm?searchMode=v2&idCategory=51&idExpansion=2320&idRarity=0&sortBy=name_asc&site=5"],[186,2320,6,0,0,[368682,368707],"CES","Celestial-Storm","/en/Pokemon/Products/Singles/Celestial-Storm?searchMode=v2&idCategory=51&idExpansion=2320&idRarity=0&sortBy=name_asc&site=6"],[187,2320,7,0,0,[407069,407269,407409],"CES","Celestial-Storm","/en/Pokemon/Products/Singles/Celestial-Storm?searchMode=v2&idCategory=51&idExpansion=2320&idRarity=0&sortBy=name_asc&site=7"],[188,2065,1,0,1,[368700,368738,407139],"UPR","Ultra-Prism","/en/Pokemon/Products/Singles/Ultra-Prism?searchMode=v2&idCategory=51&idExpansion=2065&idRarity=0&sortBy=name_asc"],[189,2065,2,0,0,[368700,368738,407139,407349],"UPR","Ultra-Prism","/en/Pokemon/Products/Singles/Ultra-Prism?searchMode=v2&idCategory=51&idExpansion=2065&idRarity=0&sortBy=name_asc&site=2"],[190,2065,3,0,0,[407274],"UPR","Ultra-Prism","/en/Pokemon/Products/Singles/Ultra-Prism?searchMode=v2&idCategory=51&idExpansion=2065&idRarity=0&sortBy=name_asc&site=3"],[191,2065,4,0,0,[368774],"UPR","Ultra-Prism","/en/Pokemon/Products/Singles/Ultra-Prism?searchMode=v2&idCategory=51&idExpansion=2065&idRarity=0&sortBy=name_asc&site=4"],[192,2065,5,0,0,[407284],"UPR","Ultra-Prism","/en/Pokemon/Products/Singles/Ultra-Prism?searchMode=v2&idCategory=51&idExpansion=2065&idRarity=0&sortBy=name_asc&site=5"],[193,2065,6,0,1,[407284],"UPR","Ultra-Prism","/en/Pokemon/Products/Singles/Ultra-Prism?searchMode=v2&idCategory=51&idExpansion=2065&idRarity=0&sortBy=name_asc&site=6"],[194,2065,7,0,0,[407344,368742],"UPR","Ultra-Prism","/en/Pokemon/Products/Singles/Ultra-Prism?searchMode=v2&idCategory=51&idExpansion=2065&idRarity=0&sortBy=name_asc&site=7"],[195,2916,8,0,0,[684352],"SWSH","SWSH-Black-Star-Promos","/en/Pokemon/Products/Singles/SWSH-Black-Star-Promos?searchMode=v2&idCategory=51&idExpansion=2916&idRarity=0&sortBy=name_asc&site=8"],[196,1842,1,0,0,[368688,368741],"SLG","Shining-Legends","/en/Pokemon/Products/Singles/Shining-Legends?searchMode=v2&idCategory=51&idExpansion=1842&idRarity=0&sortBy=name_asc"],[197,1842,2,0,0,[368764],"SLG","Shining-Legends","/en/Pokemon/Products/Singles/Shining-Legends?searchMode=v2&idCategory=51&idExpansion=1842&idRarity=0&sortBy=name_asc&site=2"],[198,1842,3,0,0,[368748,368667,368730,368689,368773],"SLG","Shining-Legends","/en/Pokemon/Products/Singles/Shining-Legends?searchMode=v2&idCategory=51&idExpansion=1842&idRarity=0&sortBy=name_asc&site=3"],[199,1842,4,0,0,[368748,368730],"SLG","Shining-Legends","/en/Pokemon/Products/Singles/Shining-Legends?searchMode=v2&idCategory=51&idExpansion=1842&idRarity=0&sortBy=name_asc&site=4"],[200,1582,2,0,0,[295274],"XY","XY","/en/Pokemon/Products/Singles/XY?searchMode=v2&idCategory=51&idExpansion=1582&idRarity=0&sortBy=name_asc&site=2"],[201,4089,2,0,0,[563108],"20th","BREAK-Starter-Pack","/en/Pokemon/Products/Singles/BREAK-Starter-Pack?searchMode=v2&idCategory=51&idExpansion=4089&idRarity=0&sortBy=name_asc&site=2"],[202,1585,1,0,1,[295286],"PRC","Primal-Clash","/en/Pokemon/Products/Singles/Primal-Clash?searchMode=v2&idCategory=51&idExpansion=1585&idRarity=0&sortBy=name_asc"],[203,1585,2,0,0,[295286,295269],"PRC","Primal-Clash","/en/Pokemon/Products/Singles/Primal-Clash?searchMode=v2&idCategory=51&idExpansion=1585&idRarity=0&sortBy=name_asc&site=2"],[204,1585,4,0,1,[295292],"PRC","Primal-Clash","/en/Pokemon/Products/Singles/Primal-Clash?searchMode=v2&idCategory=51&idExpansion=1585&idRarity=0&sortBy=name_asc&site=4"],[205,1585,5,0,0,[312239,312267,295292],"PRC","Primal-Clash","/en/Pokemon/Products/Singles/Primal-Clash?searchMode=v2&idCategory=51&idExpansion=1585&idRarity=0&sortBy=name_asc&site=5"],[206,1585,6,0,0,[312239,312211],"PRC","Primal-Clash","/en/Pokemon/Products/Singles/Primal-Clash?searchMode=v2&idCategory=51&idExpansion=1585&idRarity=0&sortBy=name_asc&site=6"],[207,1843,1,0,0,[368666],"CIN","Crimson-Invasion","/en/Pokemon/Products/Singles/Crimson-Invasion?searchMode=v2&idCategory=51&idExpansion=1843&idRarity=0&sortBy=name_asc"],[208,1843,3,0,0,[368740],"CIN","Crimson-Invasion","/en/Pokemon/Products/Singles/Crimson-Invasion?searchMode=v2&idCategory=51&idExpansion=1843&idRarity=0&sortBy=name_asc&site=3"],[209,6009,1,0,0,[806543,806545,806547,806549,806551,806553,806555,806557,806559],"xPRE","Prismatic-Evolutions-Additionals","/en/Pokemon/Products/Singles/Prismatic-Evolutions-Additionals?searchMode=v2&idCategory=51&idExpansion=6009&idRarity=0&sortBy=name_asc"],[210,6009,2,0,0,[806559,806561,806563,806565,806567],"xPRE","Prismatic-Evolutions-Additionals","/en/Pokemon/Products/Singles/Prismatic-Evolutions-Additionals?searchMode=v2&idCategory=51&idExpansion=6009&idRarity=0&sortBy=name_asc&site=2"],[211,6009,4,0,0,[806577,806579,806575],"xPRE","Prismatic-Evolutions-Additionals","/en/Pokemon/Products/Singles/Prismatic-Evolutions-Additionals?searchMode=v2&idCategory=51&idExpansion=6009&idRarity=0&sortBy=name_asc&site=4"],[212,6009,5,0,0,[806581,806583,806585,806587],"xPRE","Prismatic-Evolutions-Additionals","/en/Pokemon/Products/Singles/Prismatic-Evolutions-Additionals?searchMode=v2&idCategory=51&idExpansion=6009&idRarity=0&sortBy=name_asc&site=5"],[213,6009,6,0,0,[806589,806591],"xPRE","Prismatic-Evolutions-Additionals","/en/Pokemon/Products/Singles/Prismatic-Evolutions-Additionals?searchMode=v2&idCategory=51&idExpansion=6009&idRarity=0&sortBy=name_asc&site=6"],[214,6009,7,0,0,[806591,806593,806595,806597,806599,806601,806603,806605],"xPRE","Prismatic-Evolutions-Additionals","/en/Pokemon/Products/Singles/Prismatic-Evolutions-Additionals?searchMode=v2&idCategory=51&idExpansion=6009&idRarity=0&sortBy=name_asc&site=7"],[215,6009,8,0,0,[806607],"xPRE","Prismatic-Evolutions-Additionals","/en/Pokemon/Products/Singles/Prismatic-Evolutions-Additionals?searchMode=v2&idCategory=51&idExpansion=6009&idRarity=0&sortBy=name_asc&site=8"],[216,1583,4,0,0,[295271,295288],"FLF","Flashfire","/en/Pokemon/Products/Singles/Flashfire?searchMode=v2&idCategory=51&idExpansion=1583&idRarity=0&sortBy=name_asc&site=4"],[217,1583,5,0,1,[295288],"FLF","Flashfire","/en/Pokemon/Products/Singles/Flashfire?searchMode=v2&idCategory=51&idExpansion=1583&idRarity=0&sortBy=name_asc&site=5"],[218,1579,1,0,1,[449553],"PLF","Plasma-Freeze","/en/Pokemon/Products/Singles/Plasma-Freeze?searchMode=v2&idCategory=51&idExpansion=1579&idRarity=0&sortBy=name_asc"],[219,4317,2,0,1,[699115],"DP2","Secret-of-the-Lakes","/en/Pokemon/Products/Singles/Secret-of-the-Lakes?searchMode=v2&idCategory=51&idExpansion=4317&idRarity=0&sortBy=name_asc&site=2"],[220,5519,6,0,1,[746442],"sv4a","Shiny-Treasure-ex","/en/Pokemon/Products/Singles/Shiny-Treasure-ex?searchMode=v2&idCategory=51&idExpansion=5519&idRarity=0&sortBy=name_asc&site=6"],[221,2351,1,0,1,[407279],"DRM","Dragon-Majesty","/en/Pokemon/Products/Singles/Dragon-Majesty?searchMode=v2&idCategory=51&idExpansion=2351&idRarity=0&sortBy=name_asc"],[222,2351,2,0,0,[407279],"DRM","Dragon-Majesty","/en/Pokemon/Products/Singles/Dragon-Majesty?searchMode=v2&idCategory=51&idExpansion=2351&idRarity=0&sortBy=name_asc&site=2"],[223,2351,3,0,0,[407229,407224],"DRM","Dragon-Majesty","/en/Pokemon/Products/Singles/Dragon-Majesty?searchMode=v2&idCategory=51&idExpansion=2351&idRarity=0&sortBy=name_asc&site=3"],[224,1634,1,0,0,[278858,278860],"RM","Pokemon-Rumble","/en/Pokemon/Products/Singles/Pokemon-Rumble?searchMode=v2&idCategory=51&idExpansion=1634&idRarity=0&sortBy=name_asc"],[225,1539,2,0,0,[362909],"RS","EX-Ruby-Sapphire","/en/Pokemon/Products/Singles/EX-Ruby-Sapphire?searchMode=v2&idCategory=51&idExpansion=1539&idRarity=0&sortBy=name_asc&site=2"],[226,1539,3,0,1,[362909],"RS","EX-Ruby-Sapphire","/en/Pokemon/Products/Singles/EX-Ruby-Sapphire?searchMode=v2&idCategory=51&idExpansion=1539&idRarity=0&sortBy=name_asc&site=3"],[227,4170,1,0,0,[806285],"UNP","Unnumbered-Promos","/en/Pokemon/Products/Singles/Unnumbered-Promos?searchMode=v2&idCategory=51&idExpansion=4170&idRarity=0&sortBy=name_asc"],[228,5142,4,0,0,[682254],"SIT","Silver-Tempest","/en/Pokemon/Products/Singles/Silver-Tempest?searchMode=v2&idCategory=51&idExpansion=5142&idRarity=0&sortBy=name_asc&site=4"],[229,5431,7,0,0,[728280],"PPS3","Play-Pokemon-Prize-Pack-Series-Three","/en/Pokemon/Products/Singles/Play-Pokemon-Prize-Pack-Series-Three?searchMode=v2&idCategory=51&idExpansion=5431&idRarity=0&sortBy=name_asc&site=7"],[230,5796,1,0,0,[785593,785640,785645,785652,785654,785656],"BOO24","Trick-or-Trade-2024","/en/Pokemon/Products/Singles/Trick-or-Trade-2024?searchMode=v2&idCategory=51&idExpansion=5796&idRarity=0&sortBy=name_asc"],[231,5796,2,0,0,[785640,785645],"BOO24","Trick-or-Trade-2024","/en/Pokemon/Products/Singles/Trick-or-Trade-2024?searchMode=v2&idCategory=51&idExpansion=5796&idRarity=0&sortBy=name_asc&site=2"],[232,6391,3,0,1,[868435],"M-P/CT","M-P-Traditional-Chinese-Promos","/en/Pokemon/Products/Singles/M-P-Traditional-Chinese-Promos?searchMode=v2&idCategory=51&idExpansion=6391&idRarity=0&sortBy=name_asc&site=3"],[233,6391,4,0,0,[868435],"M-P/CT","M-P-Traditional-Chinese-Promos","/en/Pokemon/Products/Singles/M-P-Traditional-Chinese-Promos?searchMode=v2&idCategory=51&idExpansion=6391&idRarity=0&sortBy=name_asc&site=4"],[234,6509,1,0,0,[875476,875478],"HSPL","Beginning-Set-Plus","/en/Pokemon/Products/Singles/Beginning-Set-Plus?searchMode=v2&idCategory=51&idExpansion=6509&idRarity=0&sortBy=name_asc"],[235,6509,2,0,0,[875476,875478],"HSPL","Beginning-Set-Plus","/en/Pokemon/Products/Singles/Beginning-Set-Plus?searchMode=v2&idCategory=51&idExpansion=6509&idRarity=0&sortBy=name_asc&site=2"],[236,6510,1,0,1,[875539],"HSP","Beginning-Set-Pikachu","/en/Pokemon/Products/Singles/Beginning-Set-Pikachu?searchMode=v2&idCategory=51&idExpansion=6510&idRarity=0&sortBy=name_asc"],[237,6603,4,0,1,[908306],"30thC","30th-Celebration-Simplified-Chinese","/en/Pokemon/Products/Singles/30th-Celebration-Simplified-Chinese?searchMode=v2&idCategory=51&idExpansion=6603&idRarity=0&sortBy=name_asc&site=4"],[238,6604,3,0,1,[909515],"MA6","30th-Celebration-IDTH","/en/Pokemon/Products/Singles/30th-Celebration-IDTH?searchMode=v2&idCategory=51&idExpansion=6604&idRarity=0&sortBy=name_asc&site=3"],[239,6604,4,0,0,[909515,909516,909517],"MA6","30th-Celebration-IDTH","/en/Pokemon/Products/Singles/30th-Celebration-IDTH?searchMode=v2&idCategory=51&idExpansion=6604&idRarity=0&sortBy=name_asc&site=4"],[240,6673,1,0,0,[899827],"S-P/ID","Sword-Shield-Indonesian-Promos","/en/Pokemon/Products/Singles/Sword-Shield-Indonesian-Promos?searchMode=v2&idCategory=51&idExpansion=6673&idRarity=0&sortBy=name_asc"],[241,6673,2,0,0,[899816],"S-P/ID","Sword-Shield-Indonesian-Promos","/en/Pokemon/Products/Singles/Sword-Shield-Indonesian-Promos?searchMode=v2&idCategory=51&idExpansion=6673&idRarity=0&sortBy=name_asc&site=2"],[242,6673,3,0,0,[899835],"S-P/ID","Sword-Shield-Indonesian-Promos","/en/Pokemon/Products/Singles/Sword-Shield-Indonesian-Promos?searchMode=v2&idCategory=51&idExpansion=6673&idRarity=0&sortBy=name_asc&site=3"],[243,6673,7,0,0,[899811],"S-P/ID","Sword-Shield-Indonesian-Promos","/en/Pokemon/Products/Singles/Sword-Shield-Indonesian-Promos?searchMode=v2&idCategory=51&idExpansion=6673&idRarity=0&sortBy=name_asc&site=7"],[244,6673,8,0,0,[899844],"S-P/ID","Sword-Shield-Indonesian-Promos","/en/Pokemon/Products/Singles/Sword-Shield-Indonesian-Promos?searchMode=v2&idCategory=51&idExpansion=6673&idRarity=0&sortBy=name_asc&site=8"],[245,6673,10,0,0,[899814],"S-P/ID","Sword-Shield-Indonesian-Promos","/en/Pokemon/Products/Singles/Sword-Shield-Indonesian-Promos?searchMode=v2&idCategory=51&idExpansion=6673&idRarity=0&sortBy=name_asc&site=10"],[246,6673,13,0,0,[899809,899841],"S-P/ID","Sword-Shield-Indonesian-Promos","/en/Pokemon/Products/Singles/Sword-Shield-Indonesian-Promos?searchMode=v2&idCategory=51&idExpansion=6673&idRarity=0&sortBy=name_asc&site=13"],[247,6699,2,0,0,[903649,903650,903864],"AC3","Tag-Team-Collection","/en/Pokemon/Products/Singles/Tag-Team-Collection?searchMode=v2&idCategory=51&idExpansion=6699&idRarity=0&sortBy=name_asc&site=2"],[248,6699,3,0,0,[903654,903839,903864],"AC3","Tag-Team-Collection","/en/Pokemon/Products/Singles/Tag-Team-Collection?searchMode=v2&idCategory=51&idExpansion=6699&idRarity=0&sortBy=name_asc&site=3"],[249,6699,4,0,0,[903633,903839],"AC3","Tag-Team-Collection","/en/Pokemon/Products/Singles/Tag-Team-Collection?searchMode=v2&idCategory=51&idExpansion=6699&idRarity=0&sortBy=name_asc&site=4"],[250,6699,5,0,0,[903630,903636],"AC3","Tag-Team-Collection","/en/Pokemon/Products/Singles/Tag-Team-Collection?searchMode=v2&idCategory=51&idExpansion=6699&idRarity=0&sortBy=name_asc&site=5"],[251,6699,6,0,0,[903630,903634,903859],"AC3","Tag-Team-Collection","/en/Pokemon/Products/Singles/Tag-Team-Collection?searchMode=v2&idCategory=51&idExpansion=6699&idRarity=0&sortBy=name_asc&site=6"],[252,6699,7,0,0,[903865],"AC3","Tag-Team-Collection","/en/Pokemon/Products/Singles/Tag-Team-Collection?searchMode=v2&idCategory=51&idExpansion=6699&idRarity=0&sortBy=name_asc&site=7"],[253,6699,8,0,0,[903631],"AC3","Tag-Team-Collection","/en/Pokemon/Products/Singles/Tag-Team-Collection?searchMode=v2&idCategory=51&idExpansion=6699&idRarity=0&sortBy=name_asc&site=8"],[254,6699,9,0,0,[903619],"AC3","Tag-Team-Collection","/en/Pokemon/Products/Singles/Tag-Team-Collection?searchMode=v2&idCategory=51&idExpansion=6699&idRarity=0&sortBy=name_asc&site=9"],[255,6700,2,0,1,[910039],"AS4","Sky-Ruler","/en/Pokemon/Products/Singles/Sky-Ruler?searchMode=v2&idCategory=51&idExpansion=6700&idRarity=0&sortBy=name_asc&site=2"],[256,6700,3,0,0,[910039,910045,910119],"AS4","Sky-Ruler","/en/Pokemon/Products/Singles/Sky-Ruler?searchMode=v2&idCategory=51&idExpansion=6700&idRarity=0&sortBy=name_asc&site=3"]];

  // Le nombre de produits de chaque expansion de la liste dans l'export Cardmarket du 24/09 (TOUS les Singles, cartes-code
  // comprises : c'est ce que la galerie montre). Comparé au total que Cardmarket annonce sur la page : s'il est plus petit, un
  // filtre ou une limite de la page masque des produits.
  const PRODUITS_EXPORT = {"1579":131,"1745":228,"3214":354,"3324":422,"4074":140,"4313":119,"4317":123,"4382":303,"4466":96,"5201":256,"5212":304,"5223":316,"5241":304,"5385":271,"5519":360,"5861":9,"5890":140,"6096":244,"6127":302,"6381":774,"6409":236,"6443":124,"6517":122};

  // idProduct → { e: idExpansion, k: 'J' | 'V', n: nom } ; une « galerie parcourue » ne compte que si elle l'a été après la mesure.
  const CIBLE = new Map();
  for (const [e, l] of Object.entries(CIBLES)) for (const [id, k, n] of l) CIBLE.set(id, { e: Number(e), k, n });
  // 1.10 : les PAGES UTILES. Une page se reconnaît par (expansion, tri par nom, numéro de page) — jamais par l'URL exacte, dont
  // Cardmarket peut réordonner les paramètres. Une page sans `sortBy=name_asc`, ou avec `perSite`, n'en est jamais une.
  const PAGE_UTILE = new Map(PAGES_UTILES.map(([ordre, e, site, sure, voisine, ids, code, slugSet, url]) => [`${e}|${site}`, { ordre, e, site, sure, voisine, ids, code, slugSet, url }]));
  function pageUtileDe(cle, idExp) {
    let u; try { u = new URL(cle, location.origin); } catch (_) { return null; }
    const p = u.searchParams;
    if (p.get('sortBy') !== 'name_asc' || p.get('perSite')) return null;
    const e = parseInt(p.get('idExpansion') || '', 10) || idExp || null;
    return e ? PAGE_UTILE.get(`${e}|${parseInt(p.get('site') || '1', 10) || 1}`) || null : null;
  }
  const MESURE_LISTE = Date.parse('2026-09-27T22:32:00Z');

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
        // 1.10 : 202 — le serveur a GARDÉ l'envoi dans sa file (au-delà de 120/h) et l'apprendra lui-même : la page sort de notre file.
        if (r.status === 202 && r.corps && r.corps.success && r.corps.enFile) {
          reseau = 0; session.envois++; session.enFileServeur = (session.enFileServeur || 0) + 1;
          retirer(items.map(i => i.cle));
          noterEnFileServeur(items, r.corps);
          annoterJournal(items.map(i => i.cle), { status: 202, le: Date.now(), enFile: true, position: r.corps.position ?? null, recus: r.corps.recus ?? null });
          ligneEtat = `📥 ${items.length > 1 ? `${items.length} pages gardées` : 'page gardée'} par le serveur (file, position ${r.corps.position ?? '?'}) : il l'apprendra lui-même — rien à renvoyer`;
          continue;
        }
        // Au journal, chaque tentative qui n'aboutit pas : le statut et le message, sur les pages de l'envoi.
        annoterJournal(items.map(i => i.cle), { status: r.status, le: Date.now(), erreur: (r.corps && r.corps.error) || r.erreur || null });
        if (r.status === 503) { if (await attendreReveil()) continue; etat('😴 Serveur toujours endormi : nouvel essai dans 1 min.'); planifier(60000); break; }
        // 1.10 : un 429 ne vient plus que d'une file serveur PLEINE (ou d'un serveur d'avant la 1.10) — la reprise automatique reste.
        if (r.status === 429) { const s = r.reset != null ? r.reset : 300; etat(`⏳ ${(r.corps && r.corps.error) || 'Limite de 120 envois/h atteinte'} : reprise automatique dans ${Math.ceil(s / 60)} min. Tu peux continuer à tourner les pages.`); planifier(s * 1000 + 3000); break; }
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

  // 1.10 : une page UTILE envoyée (200 ou gardée en file par le serveur) est faite ; on garde aussi les cibles qu'elle portait
  // réellement — une cible attendue et absente dit que le calcul de la page s'est trompé d'une page (le panneau montre la voisine).
  function marquerPagesUtiles(items, idExp) {
    const faites = lire('rm_pagesUtilesFaites', {});
    for (const it of items) {
      const pu = pageUtileDe(it.cle, idExp);
      if (!pu) continue;
      const lus = new Set(it.cartes.map(x => x.idProduct).filter(x => x != null));
      // une cible SANS IMAGE n'a pas d'idProduct sur la page : « absente » peut vouloir dire « parmi les sans-image » — le nombre est gardé
      faites[pu.ordre] = { le: Date.now(), absentes: pu.ids.filter(id => !lus.has(id)), sansImage: it.cartes.filter(x => x.sansImage).length };
    }
    garder('rm_pagesUtilesFaites', faites);
  }

  // 1.10 : 202 — gardée par le serveur. La page est marquée apprise (le serveur l'apprendra, déduction comprise : `v: 19`) ; ses
  // cibles ne sont pas encore « faites » (rien n'est écrit tant que le serveur ne l'a pas prise) — la liste de la prochaine mesure le dira.
  function noterEnFileServeur(items, c) {
    const faites = lire('rm_pagesFaites', {});
    for (const it of items) faites[it.cle] = { le: Date.now(), n: it.cartes.length, v: 19, serveur: 'file' };
    garder('rm_pagesFaites', faites);
    marquerPagesUtiles(items, null);
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
    marquerPagesUtiles(items, c.idExpansion ?? null);
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
    // 1.10 : les PAGES UTILES — la prochaine à ouvrir, et ce que la page ouverte est pour elles. Les liens restent en /en/ : la page
    // a été calculée et calibrée sur des listes ANGLAISES triées par nom (une liste /fr/ trie peut-être sur le nom français).
    if (PAGES_UTILES.length) {
      const fPU = lire('rm_pagesUtilesFaites', {});
      const nFaites = PAGES_UTILES.filter(([o]) => fPU[o]).length, nSures = PAGES_UTILES.filter(p => p[3] === 1).length;
      const ici = pageUtileDe(ctx.cle, idCourant());
      const prochaine = PAGES_UTILES.find(([o]) => !fPU[o] && !(ici && ici.ordre === o));
      h += `<div style="font-size:12px;margin-bottom:6px;border-top:1px solid #333;padding-top:4px">📍 Pages utiles : <b>${nFaites}/${PAGES_UTILES.length}</b> faites (les ${nSures} sûres d'abord)`;
      if (ici) {
        const lus = new Set(cartesPage.map(x => x.idProduct).filter(x => x != null));
        const presentes = ici.ids.filter(id => lus.has(id)).length, absentes = ici.ids.length - presentes;
        h += `<br>✅ cette page est la n°${ici.ordre}${ici.sure === 1 ? ' (sûre)' : ici.sure === 0 ? ' (aucune cible n\'a d\'offre)' : ''} : ${presentes}/${ici.ids.length} cible(s) lue(s) ici`;
        if (absentes) {
          const nSans = cartesPage.filter(x => x.sansImage).length;
          const voisine = s => `/en/Pokemon/Products/Singles/${ici.slugSet}?searchMode=v2&idCategory=51&idExpansion=${ici.e}&idRarity=0&sortBy=name_asc${s > 1 ? `&site=${s}` : ''}`;
          h += `<br><span style="color:#e6a23c">${absentes} cible(s) attendue(s) pas lue(s) ici${nSans ? ` (peut-être parmi les ${nSans} sans image)` : ''} : essaie <a href="${esc(voisine(ici.site + 1))}" style="color:#D4AF37">page ${ici.site + 1}</a>${ici.site > 1 ? ` ou <a href="${esc(voisine(ici.site - 1))}" style="color:#D4AF37">page ${ici.site - 1}</a>` : ''}</span>`;
        }
      } else if (cartesPage.length) h += '<br><span style="color:#888">cette page n\'est pas dans la liste : rien à apprendre n\'y est prévu.</span>';
      h += prochaine ? `<br>➡️ prochaine : <a href="${esc(prochaine[8])}" style="color:#D4AF37;font-weight:600">n°${prochaine[0]} — ${esc(prochaine[6] || '')} ${esc(prochaine[7])} p.${prochaine[2]}</a>${prochaine[3] === 0 ? ' <span style="color:#888">(aucune cible n\'a d\'offre)</span>' : ''}` : '<br>🎉 toutes les pages utiles sont faites';
      h += '</div>';
    }
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
    if (session.envois || session.restant != null) h += `<div style="color:#777;font-size:11px">onglet : ${session.envois} envoi(s)${session.enFileServeur ? ` dont ${session.enFileServeur} gardé(s) en file par le serveur` : ''}, ${session.nouvelles} nouvelles, ${session.ameliorees} améliorées${session.completees ? `, ${session.completees} complétées` : ''}` +
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
