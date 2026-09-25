// ==UserScript==
// @name         Rat-Market — Apprentissage manuel Cardmarket
// @namespace    rat-market
// @version      1.7
// @description  Apprend chaque page de galerie Singles dès son chargement, et suit les 1 670 produits CIBLES (jamais appris, slug vide). Lit UNIQUEMENT la page ouverte — ne navigue jamais.
// @match        https://www.cardmarket.com/*/Pokemon/Products/Singles*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @connect      pokemon-proxy-ratnoir666.onrender.com
// @run-at       document-idle
// ==/UserScript==

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

  // ===================== À CONFIGURER =====================
  const URL_API = 'https://pokemon-proxy-ratnoir666.onrender.com';
  const JETON = 'K10-Sr7izvo-CG3bSRfCbhSnw8KTNrbJ';
  const MAX_CARTES_PAR_ENVOI = 200;
  const SEUIL_TERMINEE = 90;           // % de produits numérotés à partir duquel une expansion est « terminée »
  const REVEIL_MAX_MS = 120000, PAUSE_REVEIL_MS = 5000, ESSAIS_RESEAU = 3;

  // La liste du 25/09 après-midi (mesure de la table maîtresse, 2026-09-25 04:56 UTC) : 1346 produits JAMAIS appris et 324 au SLUG VIDE,
  // 184 expansions. D'abord les 8 que tu as nommées, puis les lignes admises, refusées, absentes (du plus de cibles au moins).
  const LISTE = [[6096,"DRI Destined-Rivals — 7 slug vide (ligne admise)"],
    [6395,"ASC Ascended-Heroes — 8 slug vide (ligne admise)"],
    [6006,"JTG Journey-Together — 5 slug vide (ligne admise)"],
    [6443,"POR Perfect-Order — 3 slug vide (ligne admise)"],
    [6299,"PFL Phantasmal-Flames — 3 slug vide (ligne admise)"],
    [6209,"MEG Mega-Evolution — 2 slug vide (ligne admise)"],
    [6569,"PBL Pitch-Black — 1 slug vide (ligne admise)"],
    [6009,"xPRE Prismatic-Evolutions-Additionals — 28 jamais appris, 6 slug vide (ligne admise)"],
    [6673,"S-P/ID Sword-Shield-Indonesian-Promos — 114 jamais appris (ligne admise)"],
    [5519,"sv4a Shiny-Treasure-ex — 52 slug vide (ligne admise)"],
    [3324,"SM-P Sun-Moon-Promos — 47 slug vide (ligne admise)"],
    [4159,"XY-P XY-Promos — 45 jamais appris (ligne admise)"],
    [1800,"GRI Guardians-Rising — 40 jamais appris (ligne admise)"],
    [1678,"BKT BREAKthrough — 36 jamais appris (ligne admise)"],
    [5318,"PAL Paldea-Evolved — 26 jamais appris, 9 slug vide (ligne admise)"],
    [6581,"CSM1DC Storming-Emergence-GX-Starter-Deck — 35 jamais appris (ligne admise)"],
    [1745,"SUM Sun-Moon — 34 jamais appris (ligne admise)"],
    [1687,"BKP BREAKpoint — 33 jamais appris (ligne admise)"],
    [6135,"WHT White-Flare — 30 slug vide (ligne admise)"],
    [6237,"CSV5C Dark-Crystal-Blaze — 30 jamais appris (ligne admise)"],
    [4252,"smG Ultra-Sun-Ultra-Moon-Deck-Build-Boxes — 29 jamais appris (ligne admise)"],
    [2487,"UNM Unified-Minds — 22 jamais appris, 6 slug vide (ligne admise)"],
    [1566,"HS HeartGold-SoulSilver — 24 jamais appris (ligne admise)"],
    [6409,"xm2a MEGA-Dream-ex-Additionals — 24 jamais appris (ligne admise)"],
    [1660,"AOR Ancient-Origins — 20 jamais appris (ligne admise)"],
    [1706,"FCO Fates-Collide — 20 jamais appris (ligne admise)"],
    [1824,"BUS Burning-Shadows — 20 jamais appris (ligne admise)"],
    [2437,"UNB Unbroken-Bonds — 18 jamais appris (ligne admise)"],
    [1582,"XY XY — 15 jamais appris, 1 slug vide (ligne admise)"],
    [2075,"FLI Forbidden-Light — 16 jamais appris (ligne admise)"],
    [6549,"CSMPC Battle-Party-Set — 16 jamais appris (ligne admise)"],
    [1521,"PHF Phantom-Forces — 13 jamais appris (ligne admise)"],
    [1612,"XYPR XY-Black-Star-Promos — 11 jamais appris, 2 slug vide (ligne admise)"],
    [1716,"STS Steam-Siege — 13 jamais appris (ligne admise)"],
    [6328,"SV-P/CS Scarlet-Violet-Simplified-Chinese-Promos — 13 jamais appris (ligne admise)"],
    [2320,"CES Celestial-Storm — 12 jamais appris (ligne admise)"],
    [2370,"LOT Lost-Thunder — 12 jamais appris (ligne admise)"],
    [2407,"TEU Team-Up — 10 jamais appris, 2 slug vide (ligne admise)"],
    [1649,"ROS Roaring-Skies — 10 jamais appris (ligne admise)"],
    [1693,"GEN Generations — 6 jamais appris, 4 slug vide (ligne admise)"],
    [2065,"UPR Ultra-Prism — 10 jamais appris (ligne admise)"],
    [2352,"MCD13 McDonalds-Collection-2013 — 9 jamais appris (ligne admise)"],
    [2514,"HIF Hidden-Fates — 9 jamais appris (ligne admise)"],
    [3419,"CPA Champions-Path — 9 jamais appris (ligne admise)"],
    [3580,"s4a Shiny-Star-V — 9 slug vide (ligne admise)"],
    [5093,"LOR Lost-Origin — 9 slug vide (ligne admise)"],
    [5402,"MEW 151 — 9 slug vide (ligne admise)"],
    [5444,"PAR Paradox-Rift — 9 slug vide (ligne admise)"],
    [6381,"mC MEGA-Start-Deck-100-Battle-Collection — 9 slug vide (ligne admise)"],
    [1842,"SLG Shining-Legends — 8 jamais appris (ligne admise)"],
    [4390,"s8b VMAX-Climax — 8 jamais appris (ligne admise)"],
    [1567,"UL Unleashed — 7 jamais appris (ligne admise)"],
    [1757,"SM SM-Black-Star-Promos — 6 jamais appris, 1 slug vide (ligne admise)"],
    [2916,"SWSH SWSH-Black-Star-Promos — 1 jamais appris, 6 slug vide (ligne admise)"],
    [5212,"SV-P Scarlet-Violet-Promos — 7 jamais appris (ligne admise)"],
    [6510,"HSP Beginning-Set-Pikachu — 7 jamais appris (ligne admise)"],
    [6603,"30thC 30th-Celebration-Simplified-Chinese — 7 jamais appris (ligne admise)"],
    [1585,"PRC Primal-Clash — 6 jamais appris (ligne admise)"],
    [2644,"CEC Cosmic-Eclipse — 6 slug vide (ligne admise)"],
    [4243,"sH Sword-Shield-Family-Pokemon-Card-Game — 6 jamais appris (ligne admise)"],
    [5241,"SVP SV-Black-Star-Promos — 4 jamais appris, 2 slug vide (ligne admise)"],
    [6134,"BLK Black-Bolt — 6 slug vide (ligne admise)"],
    [3214,"S-P Sword-Shield-Promos — 5 slug vide (ligne admise)"],
    [4196,"HSZ National-Pokedex-Beginning-Set — 5 jamais appris (ligne admise)"],
    [4205,"BGS Battle-Gift-Set-Thundurus-vs-Tornadus — 5 jamais appris (ligne admise)"],
    [4216,"HSBW Beginning-Set — 5 jamais appris (ligne admise)"],
    [4434,"BRS Brilliant-Stars — 5 slug vide (ligne admise)"],
    [5691,"TWM Twilight-Masquerade — 1 jamais appris, 4 slug vide (ligne admise)"],
    [3961,"sm1+ Strength-Expansion-Pack-Sun-Moon — 4 jamais appris (ligne admise)"],
    [4240,"sp4 Eevee-Heroes-VMAX-Special-Set — 4 jamais appris (ligne admise)"],
    [4490,"ERB Extra-Regulation-Box — 4 jamais appris (ligne admise)"],
    [5051,"PGO Pokemon-GO — 4 slug vide (ligne admise)"],
    [5223,"SVI Scarlet-Violet — 1 jamais appris, 3 slug vide (ligne admise)"],
    [6127,"SV-P/ID Scarlet-Violet-Indonesian-Promos — 4 jamais appris (ligne admise)"],
    [6219,"xsv2a Pokemon-Card-151-Additionals — 4 slug vide (ligne admise)"],
    [6309,"CSVH3C Happy-Set-Altaria-Latios-Infernape-Maushold — 4 jamais appris (ligne admise)"],
    [1546,"DX EX-Deoxys — 3 jamais appris (ligne admise)"],
    [1555,"DP Diamond-Pearl — 3 jamais appris (ligne admise)"],
    [1579,"PLF Plasma-Freeze — 3 jamais appris (ligne admise)"],
    [2351,"DRM Dragon-Majesty — 3 jamais appris (ligne admise)"],
    [3675,"BST Battle-Styles — 3 slug vide (ligne admise)"],
    [3946,"sm2+ Facing-a-New-Trial — 3 jamais appris (ligne admise)"],
    [4197,"KLD Keldeo-Battle-Strength-Deck — 3 jamais appris (ligne admise)"],
    [4198,"GBR Garchomp-Half-Deck — 3 jamais appris (ligne admise)"],
    [4199,"SZD Hydreigon-Half-Deck — 3 jamais appris (ligne admise)"],
    [4211,"BTV Battle-Theme-Deck-Victini — 3 jamais appris (ligne admise)"],
    [4238,"XYe Emboar-EX-vs-Togekiss-EX-Deck-Kit — 3 jamais appris (ligne admise)"],
    [4328,"EVS Evolving-Skies — 2 jamais appris, 1 slug vide (ligne admise)"],
    [4348,"MCVS Movie-Commemoration-VS-Pack — 3 jamais appris (ligne admise)"],
    [4979,"ASR Astral-Radiance — 3 slug vide (ligne admise)"],
    [5142,"SIT Silver-Tempest — 1 jamais appris, 2 slug vide (ligne admise)"],
    [5201,"CRZ Crown-Zenith — 3 slug vide (ligne admise)"],
    [5385,"OBF Obsidian-Flames — 3 slug vide (ligne admise)"],
    [5589,"TEF Temporal-Forces — 3 slug vide (ligne admise)"],
    [5861,"RAID Raid-Battle — 3 jamais appris (ligne admise)"],
    [5879,"SSP Surging-Sparks — 3 slug vide (ligne admise)"],
    [6442,"CSVM1C Master-Strategy-Deck-Building-Sets — 3 jamais appris (ligne admise)"],
    [6517,"CRI Chaos-Rising — 3 slug vide (ligne admise)"],
    [6602,"m6a 30th-Celebration-JP — 3 jamais appris (ligne admise)"],
    [6604,"MA6 30th-Celebration-IDTH — 3 jamais appris (ligne admise)"],
    [1525,"JU Jungle — 2 slug vide (ligne admise)"],
    [1535,"LC Legendary-Collection — 2 jamais appris (ligne admise)"],
    [1569,"TM Triumphant — 2 jamais appris (ligne admise)"],
    [1583,"FLF Flashfire — 2 jamais appris (ligne admise)"],
    [1634,"RM Pokemon-Rumble — 2 jamais appris (ligne admise)"],
    [1843,"CIN Crimson-Invasion — 2 jamais appris (ligne admise)"],
    [3143,"RCL Rebel-Clash — 2 jamais appris (ligne admise)"],
    [4129,"XYc Super-Legend-Set-Xerneas-EX-Yveltal-EX — 2 jamais appris (ligne admise)"],
    [4154,"HXY XY-Beginning-Set — 2 jamais appris (ligne admise)"],
    [4170,"UNP Unnumbered-Promos — 2 jamais appris (ligne admise)"],
    [4179,"MG Mewtwo-vs-Genesect-Deck-Kit — 2 jamais appris (ligne admise)"],
    [4188,"PBG Team-Plasma-Battle-Gift-Set — 2 jamais appris (ligne admise)"],
    [4190,"BKB Black-Kyurem-EX-Battle-Strength-Deck — 2 jamais appris (ligne admise)"],
    [4192,"PPD Team-Plasmas-Powered-Half-Deck — 2 jamais appris (ligne admise)"],
    [4206,"BKZ Zekrom-EX-Battle-Strength-Deck — 2 jamais appris (ligne admise)"],
    [4214,"BW1b Black-Collection — 2 jamais appris (ligne admise)"],
    [5216,"sv1S Scarlet-ex — 2 jamais appris (ligne admise)"],
    [5760,"SFA Shrouded-Fable — 2 slug vide (ligne admise)"],
    [6290,"xMEG Mega-Evolution-Additionals — 2 jamais appris (ligne admise)"],
    [6391,"M-P/CT M-P-Traditional-Chinese-Promos — 2 jamais appris (ligne admise)"],
    [6634,"CSVH5C Happy-Set-Mewtwo-Dragonite-Camerupt-Sinistcha — 2 jamais appris (ligne admise)"],
    [1539,"RS EX-Ruby-Sapphire — 1 jamais appris (ligne admise)"],
    [1548,"UF EX-Unseen-Forces — 1 jamais appris (ligne admise)"],
    [1578,"PLS Plasma-Storm — 1 jamais appris (ligne admise)"],
    [1742,"EVO Evolutions — 1 jamais appris (ligne admise)"],
    [2921,"SSH Sword-Shield — 1 slug vide (ligne admise)"],
    [3199,"DAA Darkness-Ablaze — 1 slug vide (ligne admise)"],
    [3274,"s3 Infinity-Zone — 1 slug vide (ligne admise)"],
    [3816,"sm11 Miracle-Twin — 1 slug vide (ligne admise)"],
    [4079,"XYh MAudino-EX-Mega-Battle-Deck — 1 jamais appris (ligne admise)"],
    [4084,"XYg Zygarde-EX-Perfect-Battle-Deck — 1 jamais appris (ligne admise)"],
    [4119,"XYd MRayquaza-EX-Mega-Battle-Deck — 1 jamais appris (ligne admise)"],
    [4174,"CRE Chilling-Reign — 1 slug vide (ligne admise)"],
    [4181,"K+K Blastoise-Kyurem-EX-Combo-Deck — 1 jamais appris (ligne admise)"],
    [4189,"BKW White-Kyurem-EX-Battle-Strength-Deck — 1 jamais appris (ligne admise)"],
    [4207,"BKR Reshiram-EX-Battle-Strength-Deck — 1 jamais appris (ligne admise)"],
    [4241,"sGG Gengar-VMAX-High-Class-Deck — 1 jamais appris (ligne admise)"],
    [4242,"sGI Inteleon-VMAX-High-Class-Deck — 1 jamais appris (ligne admise)"],
    [4291,"PtP Piplup-DPt-Half-Deck — 1 jamais appris (ligne admise)"],
    [4382,"FST Fusion-Strike — 1 slug vide (ligne admise)"],
    [4516,"sLL Sword-Shield-Starter-Set-Lucario-VSTAR — 1 jamais appris (ligne admise)"],
    [4517,"sLD Sword-Shield-Starter-Set-Darkrai-VSTAR — 1 jamais appris (ligne admise)"],
    [4518,"sN Start-Deck-100-CoroCoro-Comic-Version — 1 jamais appris (ligne admise)"],
    [4786,"s10b Pokemon-GO-Enhanced-Expansion-Pack — 1 jamais appris (ligne admise)"],
    [5328,"sv2a Pokemon-Card-151 — 1 slug vide (ligne admise)"],
    [5546,"PAF Paldean-Fates — 1 slug vide (ligne admise)"],
    [5621,"svIba Scarlet-Violet-Battle-Academy — 1 jamais appris (ligne admise)"],
    [5757,"sv6a Night-Wanderer — 1 slug vide (ligne admise)"],
    [5996,"sv9 Battle-Partners — 1 slug vide (ligne admise)"],
    [6092,"sv10 The-Glory-of-Team-Rocket — 1 slug vide (ligne admise)"],
    [6130,"sv11B Black-Bolt-JP — 1 slug vide (ligne admise)"],
    [6131,"sv11W White-Flare-JP — 1 slug vide (ligne admise)"],
    [6230,"M-P M-P-Promos — 1 jamais appris (ligne admise)"],
    [6291,"m2 Inferno-X — 1 slug vide (ligne admise)"],
    [6392,"M-P/TH M-P-Thai-Promos — 1 jamais appris (ligne admise)"],
    [6393,"M-P/ID M-P-Indonesian-Promos — 1 jamais appris (ligne admise)"],
    [6427,"m3 Nihil-Zero — 1 slug vide (ligne admise)"],
    [6494,"m4 Ninja-Spinner — 1 slug vide (ligne admise)"],
    [6556,"m5 Abyss-Eye — 1 slug vide (ligne admise)"],
    [6672,"S-P/TH Sword-Shield-Thai-Promos — 1 jamais appris (ligne admise)"],
    [6699,"AC3 Tag-Team-Collection — 84 jamais appris (ligne refusée)"],
    [2070,"TK11 SM-Trainer-Kit-Alolan-Sandslash-Alolan-Ninetales — 26 jamais appris (ligne refusée)"],
    [5681,"CGN Nivi-City-Gym — 16 jamais appris (ligne refusée)"],
    [5684,"CGT Tamamushi-City-Gym — 15 jamais appris (ligne refusée)"],
    [5682,"CGH Hanada-City-Gym — 11 jamais appris (ligne refusée)"],
    [5683,"CGK Kuchiba-City-Gym — 9 jamais appris (ligne refusée)"],
    [5686,"GTG Guren-Town-Gym — 9 jamais appris (ligne refusée)"],
    [4187,"WAK Everyones-Exciting-Battle — 8 jamais appris (ligne refusée)"],
    [5685,"CGY Yamabuki-City-Gym — 8 jamais appris (ligne refusée)"],
    [5796,"BOO24 Trick-or-Trade-2024 — 6 jamais appris (ligne refusée)"],
    [4392,"PWC Pikachu-World-Collection — 3 jamais appris (ligne refusée)"],
    [4340,"MSD Movie-Commemoration-VS-Pack-Sky-Splitting-Deoxys — 1 jamais appris (ligne refusée)"],
    [4347,"CEL Celebrations — 1 jamais appris (ligne refusée)"],
    [5431,"PPS3 Play-Pokemon-Prize-Pack-Series-Three — 1 jamais appris (ligne refusée)"],
    [5890,"BA24 Battle-Academy-2024 — 1 jamais appris (ligne refusée)"],
    [1551,"— (jamais appris : nom inconnu chez nous) — 54 jamais appris (ligne aucune)"],
    [6700,"AS4 Sky-Ruler — 38 jamais appris (ligne aucune)"],
    [5526,"— (jamais appris : nom inconnu chez nous) — 24 jamais appris (ligne aucune)"],
    [5877,"— (jamais appris : nom inconnu chez nous) — 15 jamais appris (ligne aucune)"],
    [6509,"HSPL Beginning-Set-Plus — 11 jamais appris (ligne aucune)"],
    [2107,"PR Promos — 4 jamais appris (ligne aucune)"],
    [5834,"SEA Southeast-Asia-Promos — 4 jamais appris (ligne aucune)"],
    [1605,"BEST Best-of-Game-Cards-Promos — 2 jamais appris (ligne aucune)"],
    [6683,"M-P/CS M-P-Simplified-Chinese-Promos — 1 jamais appris (ligne aucune)"]];

  // Les produits CIBLES, par expansion : [idProduct, « J » jamais appris | « V » slug vide, nom du catalogue].
  const CIBLES = {"1521":[[281821,"J","Feraligatr (Theme Deck)"],[295203,"J","Yanma [Air Slash]"],[295212,"J","AZ"],[295220,"J","Battle Compressor Team Flare Gear"],[295233,"J","Xerosic"],[295235,"J","AZ"],[295257,"J","AZ"],[295260,"J","Xerosic"],[295285,"J","Battle Compressor Team Flare Gear"],[312219,"J","VS Seeker"],[312243,"J","VS Seeker"],[312268,"J","VS Seeker"],[312292,"J","VS Seeker"]],"1525":[[273813,"V","Wigglytuff [Lullaby | Do the Wave]"],[273829,"V","Wigglytuff [Lullaby | Do the Wave]"]],"1535":[[901315,"J","Dark Blastoise [Hydrocannon | Rocket Tackle]"],[901316,"J","Dark Raichu [Surprise Thunder]"]],"1539":[[362909,"J","Metal Energy [Special]"]],"1546":[[901173,"J","Space Center"],[901210,"J","Deoxys [Form Change | Link Blast]"],[901214,"J","Rayquaza [Dragon Aura | Tumbling Attack]"]],"1548":[[901195,"J","Ho-Oh [Gust | Sacred Fire]"]],"1551":[[276971,"J","Armaldo δ Delta Species [Delta Edge | Fossil Charge]"],[276972,"J","Cradily δ Delta Species [Harsh Fluid | Poison Tentacles]"],[276973,"J","Deoxys δ Delta Species [Form Change | Energy Loop]"],[276974,"J","Deoxys δ Delta Species [Form Change | Delta Reduction]"],[276975,"J","Deoxys δ Delta Species [Form Change | Crystal Laser]"],[276976,"J","Deoxys δ Delta Species [Form Change | Teleportation Burst]"],[276977,"J","Flygon δ Delta Species [Delta Supply | Swift]"],[276978,"J","Gyarados δ Delta Species [Delta Reactor | Hyper Beam | Heavy"],[276979,"J","Kabutops δ Delta Species [Vital Drain | Thunderous Blow]"],[276980,"J","Kingdra δ Delta Species [Dragon Curse | Extra Flame | Heat B"],[276981,"J","Latias δ Delta Species [Dual Aura | Spearhead | Dragon Claw]"],[276982,"J","Latios δ Delta Species [Dual Aura | Dive | Aqua Blast]"],[276983,"J","Omastar δ Delta Species [Bind | Vengeful Spikes]"],[276984,"J","Pidgeot δ Delta Species [Delta Reverse | Rotating Claws]"],[276985,"J","Raichu δ Delta Species [Zzzap | Metallic Thunder]"],[276986,"J","Rayquaza δ Delta Species [Hydro Barrier | Delta Search | Ozo"],[276987,"J","Vileplume δ Delta Species [Poison Pollen | Poltergeist]"],[276989,"J","Bellossom δ Delta Species [Fellowship | Aqua Flower]"],[276991,"J","Latias δ Delta Species [Combustion | Super Singe]"],[276992,"J","Latios δ Delta Species [Aqua Wave | Dragonbreath]"],[276994,"J","Mewtwo δ Delta Species [Psychic Erase | Swift]"],[276996,"J","Rayquaza δ Delta Species [Outrage | Flamethrower]"],[277005,"J","Aerodactyl δ Delta Species [Primal Light | Granite Head]"],[277007,"J","Chimecho δ Delta Species [Delta Support | Hook]"],[277011,"J","Exeggutor δ Delta Species [Delta Circle | Split Bomb]"],[277012,"J","Gloom δ Delta Species [Drool | Acid]"],[277013,"J","Golduck δ Delta Species [Delta Block | Mind Play]"],[277018,"J","Persian δ Delta Species [Scratch and Draw | Deceive]"],[277019,"J","Pidgeotto δ Delta Species [Whirlwind]"],[277020,"J","Primeape δ Delta Species [Wreck | Flames of Rage]"],[277022,"J","Seadra δ Delta Species [Searing Flame | Combustion]"],[277023,"J","Sharpedo δ Delta Species [Brush Aside | Swift Turn]"],[277024,"J","Vibrava δ Delta Species [Knock Away | Cutting Wind]"],[277027,"J","Anorith δ Delta Species [Metal Claw | Rising Lunge]"],[277031,"J","Carvanha δ Delta Species [Bite | Reckless Charge]"],[277035,"J","Exeggcute δ Delta Species [Rollout | Pebble Throw]"],[277036,"J","Horsea δ Delta Species [Ram | Steady Firebreathing]"],[277037,"J","Kabuto δ Delta Species [Eerie Light | Shell Attack]"],[277038,"J","Lileep δ Delta Species [Poison Tentacles | Mud Shot]"],[277039,"J","Magikarp δ Delta Species [Splash]"],[277040,"J","Mankey δ Delta Species [Paralyzing Gaze | Low Kick]"],[277041,"J","Meowth δ Delta Species [Slash | Pay Day]"],[277043,"J","Oddish δ Delta Species [Tackle | Blot]"],[277044,"J","Omanyte δ Delta Species [Collect | Water Arrow]"],[277046,"J","Pichu δ Delta Species [Baby Evolution | Paste]"],[277047,"J","Pidgey δ Delta Species [Wing Attack]"],[277049,"J","Pikachu δ Delta Species [Tail Whap | Steel Headbutt]"],[277051,"J","Psyduck δ Delta Species [Scratch | Disable]"],[277054,"J","Trapinch δ Delta Species [Big Bite | Mud Slap]"],[277068,"J","Rainbow Energy Delta"],[277072,"J","Gyarados Gold Star δ Delta Species [Spiral Growth | All-out "],[277073,"J","Mewtwo Gold Star [Energy Absorption | Psychic Star]"],[277074,"J","Pikachu Gold Star [Thundershock | Spring Back]"],[882863,"J","Exeggutor δ Delta Species [Delta Circle | Split Bomb]"]],"1555":[[901177,"J","Chimchar Lv.8 [Scratch | Ember]"],[901178,"J","Piplup Lv.9 [Peck | Water Splash]"],[901186,"J","Turtwig Lv.10 [Tackle | Razor Leaf]"]],"1566":[[279000,"J","Pichu [Sweet Sleeping Face | Playground]"],[371563,"J","Delibird [Snowy Present | Hail]"],[450098,"J","Pokémon Collector"],[450103,"J","Pokémon Communication"],[450228,"J","Rainbow Energy"],[573477,"J","Pikachu [Tail Slap | Quick Attack]"],[882912,"J","Pichu [Sweet Sleeping Face | Playground]"],[902371,"J","Corsola [Recover | Hyper Cannon]"],[902372,"J","Delibird [Snowy Present | Hail]"],[902373,"J","Miltank [Moomoo Squeeze | Body Slam]"],[902374,"J","Chikorita [Tackle | Razor Leaf]"],[902375,"J","Clefairy [Minimize | Slap]"],[902376,"J","Cyndaquil [Beat | Flare]"],[902377,"J","Growlithe [Bite | Combustion]"],[902378,"J","Hoothoot [Hypnosis | Tackle]"],[902379,"J","Koffing [Smokescreen | Suffocating Gas]"],[902380,"J","Magikarp [Splash | CL]"],[902381,"J","Mareep [Static Electricity | Ram]"],[902382,"J","Marill [Water Splash | Tail Slap]"],[902383,"J","Meowth [Pay Day | Dig Claws]"],[902384,"J","Paras [Scratch | Double-edge Claw]"],[902385,"J","Pikachu [Tail Slap | Quick Attack]"],[902386,"J","Staryu [Spinning Attack | HS]"],[902387,"J","Totodile [Gnaw | Wave Splash]"]],"1567":[[902388,"J","Aipom [Tail Code | Tail Smash]"],[902389,"J","Chinchou [Ram | Lightning Ball]"],[902390,"J","Horsea [Beat | Fin Smack]"],[902391,"J","Larvitar [Bite | Knuckle Punch]"],[902392,"J","Natu [Peck | Teleport]"],[902393,"J","Onix [Energy Healer | Boundless Power]"],[902394,"J","Riolu [Kick | Double Chop]"]],"1569":[[363455,"J","Darkrai & Cresselia LEGEND"],[363456,"J","Palkia & Dialga LEGEND"]],"1578":[[449638,"J","Hypnotoxic Laser"]],"1579":[[449153,"J","Leafeon [Energy Crush | Leaf Blade]"],[449553,"J","Frozen City"],[450083,"J","Plasma Energy"]],"1582":[[281480,"V","Emolga EX [Energy Glide | Electron Crush]"],[295274,"J","Greninja [Water Shuriken | Mist Slash]"],[449258,"J","Aegislash [Stance Change | Buster Swing]"],[449438,"J","Doublade [Dual Blades]"],[449633,"J","Honedge [Pierce]"],[450183,"J","Pumpkaboo [Confuse Ray]"],[450188,"J","Pumpkaboo [Confuse Ray]"],[450193,"J","Pumpkaboo [Confuse Ray]"],[450198,"J","Pumpkaboo [Confuse Ray]"],[450398,"J","Solrock [Cosmic Spin | Solar Beam]"],[450403,"J","Solrock [Cosmic Spin | Solar Beam]"],[450408,"J","Solrock [Cosmic Spin | Solar Beam]"],[700739,"J","Vivillon [Conversion Powder | Colorful Wind]"],[700740,"J","Vivillon [Conversion Powder | Colorful Wind]"],[700742,"J","Vivillon [Conversion Powder | Colorful Wind]"],[700744,"J","Vivillon [Conversion Powder | Colorful Wind]"]],"1583":[[295271,"J","Startling Megaphone"],[295288,"J","Startling Megaphone"]],"1585":[[295269,"J","Escape Rope"],[295286,"J","Dive Ball"],[295292,"J","Rough Seas"],[312211,"J","Wonder Energy"],[312239,"J","Teammates"],[312267,"J","Rough Seas"]],"1605":[[280574,"J","Rocket's Mewtwo [Juxtapose | Hypnoblast | Psyburn]"],[280575,"J","Rocket's Hitmonchan [Crosscounter | Magnum Punch]"]],"1612":[[293003,"V","Pikachu EX [Iron Tail | Overspark]"],[312257,"J","Giratina [Devour Light | Shadow Claw]"],[312264,"J","Karen"],[363899,"V","Pikachu EX [Iron Tail | Overspark]"],[368698,"J","Jirachi [Stardust | Dream Dance]"],[371610,"J","Gym Badge"],[371611,"J","Gym Badge"],[371612,"J","Gym Badge"],[371613,"J","Gym Badge"],[371614,"J","Gym Badge"],[371615,"J","Gym Badge"],[371616,"J","Gym Badge"],[371617,"J","Gym Badge"]],"1634":[[278858,"J","Eevee"],[278860,"J","Croagunk"]],"1649":[[295202,"J","Shaymin EX [Set Up | Sky Return]"],[295217,"J","VS Seeker"],[295225,"J","Shaymin EX [Set Up | Sky Return]"],[295230,"J","Double Dragon Energy"],[295242,"J","VS Seeker"],[295248,"J","Shaymin EX [Set Up | Sky Return]"],[295252,"J","Absol [Cursed Eyes | Mach Claw]"],[295262,"J","VS Seeker"],[295268,"J","Mega Turbo"],[295290,"J","VS Seeker"]],"1660":[[295200,"J","Vespiquen [Intelligence Gathering | Bee Revenge]"],[295201,"J","Combee [Bug Bite]"],[295206,"J","Spinarak [String Shot]"],[295207,"J","Ariados [Poisonous Nest | Impound]"],[295211,"J","Lysandre"],[295215,"J","Level Ball"],[295221,"J","Forest of Giant Plants"],[295224,"J","Giratina EX [Renegade Pulse | Chaos Wheel]"],[295226,"J","Hoopa EX [Scoundrel Ring | Hyperspace Fury]"],[295236,"J","Lysandre"],[295237,"J","Trainers' Mail"],[295249,"J","Hoopa EX [Scoundrel Ring | Hyperspace Fury]"],[295258,"J","Lysandre"],[295259,"J","Hex Maniac"],[295264,"J","Trainers' Mail"],[295280,"J","Ace Trainer"],[295287,"J","Level Ball"],[312215,"J","Hex Maniac"],[312248,"J","Hex Maniac"],[312290,"J","Forest of Giant Plants"]],"1678":[[295210,"J","Judge"],[295241,"J","Float Stone"],[295243,"J","Super Rod"],[295244,"J","Parallel City"],[295266,"J","Float Stone"],[295267,"J","Parallel City"],[295270,"J","Super Rod"],[295281,"J","Fisherman"],[295289,"J","Super Rod"],[312207,"J","Octillery [Abyssal Hand | Hug]"],[312208,"J","Remoraid [Ion Pool | Water Gun]"],[312209,"J","Gallade [Premonition | Sensitive Blade]"],[312217,"J","Brigette"],[312220,"J","Super Rod"],[312238,"J","Brigette"],[312245,"J","Float Stone"],[312249,"J","Heavy Ball"],[312252,"J","Remoraid [Wild River | Water Gun]"],[312253,"J","Octillery [Abyssal Hand | Hug]"],[312265,"J","Brigette"],[312272,"J","Float Stone"],[312289,"J","Brigette"],[312296,"J","Float Stone"],[368665,"J","Float Stone"],[368671,"J","Super Rod"],[368677,"J","Remoraid [Ion Pool | Water Gun]"],[368678,"J","Octillery [Abyssal Hand | Hug]"],[368690,"J","Parallel City"],[368693,"J","Float Stone"],[368699,"J","Brigette"],[368734,"J","Brigette"],[368746,"J","Town Map"],[368747,"J","Parallel City"],[368752,"J","Float Stone"],[368758,"J","Float Stone"],[368771,"J","Super Rod"]],"1687":[[295216,"J","Bursting Balloon"],[295223,"J","Darkrai EX [Dark Pulse | Dark Head]"],[295227,"J","Trubbish [Acid Spray]"],[295228,"J","Garbodor [Garbotoxin | Offensive Bomb]"],[295239,"J","Max Elixir"],[295240,"J","Fighting Fury Belt"],[295245,"J","Reverse Valley"],[295272,"J","Greninja BREAK [Giant Water Shuriken]"],[295273,"J","Greninja [Shadow Stitching | Moonlight Slash]"],[295275,"J","Frogadier [Water Duplicates]"],[295276,"J","Froakie [Bubble]"],[295279,"J","Splash Energy"],[295291,"J","Bursting Balloon"],[312213,"J","Professor Sycamore"],[312228,"J","Garbodor [Garbotoxin | Offensive Bomb]"],[312230,"J","Trubbish [Acid Spray]"],[312236,"J","Professor Sycamore"],[312260,"J","Professor Sycamore"],[312281,"J","Espeon EX [Miraculous Shine | Psyshock]"],[312285,"J","Professor Sycamore"],[368662,"J","Max Elixir"],[368664,"J","Fighting Fury Belt"],[368670,"J","Professor Sycamore"],[368691,"J","Professor Sycamore"],[368704,"J","Trubbish [Acid Spray]"],[368705,"J","Garbodor [Garbotoxin | Offensive Bomb]"],[368736,"J","Trubbish [Acid Spray]"],[368737,"J","Garbodor [Garbotoxin | Offensive Bomb]"],[368744,"J","Puzzle of Time"],[368749,"J","Professor Sycamore"],[368756,"J","Max Elixir"],[368769,"J","Professor Sycamore"],[368770,"J","Puzzle of Time"]],"1693":[[288464,"V","Pikachu [Nuzzle | Quick Attack]"],[288515,"V","Flareon EX [Flash Fire | Blaze Ball]"],[288537,"V","Flareon EX [Flash Fire | Blaze Ball]"],[288538,"V","Pikachu [Nuzzle | Quick Attack]"],[295218,"J","Revitalizer"],[295261,"J","Pokémon Center Lady"],[312263,"J","Pokémon Center Lady"],[312293,"J","Revitalizer"],[368708,"J","Wobbuffet [Bide Barricade | Psychic Assault]"],[368732,"J","Evosoda"]],"1706":[[295208,"J","Double Colorless Energy"],[295213,"J","N"],[295214,"J","Ultra Ball"],[295232,"J","N"],[295238,"J","Ultra Ball"],[295246,"J","MAudino EX [Magical Symphony]"],[295247,"J","Audino EX [Drain Slap | Do the Wave]"],[295254,"J","Double Colorless Energy"],[295256,"J","N"],[295263,"J","Ultra Ball"],[295265,"J","Audino Spirit Link"],[295282,"J","N"],[312214,"J","N"],[312237,"J","N"],[312261,"J","N"],[312286,"J","N"],[368663,"J","Strong Energy"],[368683,"J","N"],[368696,"J","N"],[368743,"J","N"]],"1716":[[295204,"J","Yanmega [Sonic Vision | Assault Boom]"],[295205,"J","Yanmega BREAK [Barrier Break]"],[295209,"J","Professor Sycamore"],[295219,"J","Special Charge"],[295222,"J","Yveltal [Oblivion Wing | Darkness Blade]"],[295231,"J","Professor Sycamore"],[295234,"J","Pokémon Ranger"],[295250,"J","Magearna EX [Mystic Heart | Soul Blaster]"],[295251,"J","Cobalion [Quick Guard | Revenge Blast]"],[295255,"J","Professor Sycamore"],[295277,"J","Talonflame [Gale Wings | Aero Blitz]"],[295283,"J","Pokémon Ranger"],[295284,"J","Professor Sycamore"]],"1742":[[901314,"J","Mewtwo [Psychic | Barrier]"]],"1745":[[295315,"J","Rowlet [Tackle | Leafage]"],[295325,"J","Shiinotic [Illuminate | Flickering Spores]"],[295349,"J","Popplio [Pound | Water Gun]"],[295411,"J","Kangaskhan [Cross-Cut | Hurricane Punch]"],[295426,"J","Oranguru [Instruct | Psychic]"],[312210,"J","Fairy Energy"],[312212,"J","Double Colorless Energy"],[312222,"J","Rare Candy"],[312223,"J","Ultra Ball"],[312233,"J","Rainbow Energy"],[312234,"J","Double Colorless Energy"],[312235,"J","Grass Energy"],[312242,"J","Ultra Ball"],[312258,"J","Water Energy"],[312259,"J","Double Colorless Energy"],[312266,"J","Professor Kukui"],[312269,"J","Ultra Ball"],[312276,"J","Decidueye GX [Feather Arrow | Razor Leaf | Hollow Hunt GX]"],[312277,"J","Dartrix [Sharp Blade Quill | Leaf Blade]"],[312278,"J","Rowlet [Tackle | Leafage]"],[312283,"J","Grass Energy"],[312284,"J","Double Colorless Energy"],[312291,"J","Ultra Ball"],[368661,"J","Fighting Energy"],[368687,"J","Psychic Energy"],[368765,"J","Oranguru [Instruct | Psychic]"],[368766,"J","Lightning Energy"],[368768,"J","Grass Energy"],[407014,"J","Fire Energy"],[407019,"J","Psychic Energy"],[407124,"J","Fire Energy"],[407134,"J","Psychic Energy"],[407234,"J","Fire Energy"],[407334,"J","Lightning Energy"]],"1757":[[312231,"J","Tapu Koko [Flying Flip | Electric Ball]"],[312255,"J","Tapu Koko [Flying Flip | Electric Ball]"],[312280,"J","Tapu Koko [Flying Flip | Electric Ball]"],[368763,"J","Xurkitree GX [Flashing Head | Rumbling Wires | Lighting GX]"],[368851,"V","Charizard [Roaring Resolve | Continuous Blaze Ball]"],[407009,"J","Solgaleo GX [Shining Mane | Turbo Strike | Prominence GX]"],[899735,"J","Psyduck [Scratch]"]],"1800":[[312205,"J","Tapu Lele GX [Wonder Tag | Energy Drive | Tapu Cure GX]"],[312206,"J","Alolan Vulpix [Beacon | Icy Snow]"],[312221,"J","Field Blower"],[312224,"J","Rescue Stretcher"],[312225,"J","Choice Band"],[312229,"J","Garbodor [Trashalanche | Acid Spray]"],[312232,"J","Tapu Lele GX [Wonder Tag | Energy Drive | Tapu Cure GX]"],[312244,"J","Choice Band"],[312246,"J","Field Blower"],[312247,"J","Rescue Stretcher"],[312250,"J","Alolan Vulpix [Beacon | Icy Snow]"],[312251,"J","Alolan Ninetales GX [Ice Blade | Blizzard Edge | Ice Path GX"],[312254,"J","Tapu Lele GX [Wonder Tag | Energy Drive | Tapu Cure GX]"],[312256,"J","Sudowoodo [Roadblock | Rock Throw]"],[312270,"J","Aqua Patch"],[312271,"J","Choice Band"],[312273,"J","Field Blower"],[312279,"J","Tapu Lele GX [Wonder Tag | Energy Drive | Tapu Cure GX]"],[312282,"J","Sudowoodo [Roadblock | Rock Throw]"],[312294,"J","Choice Band"],[312295,"J","Field Blower"],[368668,"J","Field Blower"],[368675,"J","Choice Band"],[368680,"J","Lycanroc GX [Bloodthirsty Eyes | Claw Slash | Dangerous Rogu"],[368692,"J","Rescue Stretcher"],[368694,"J","Drampa GX [Righteous Edge | Berserk | Big Wheel GX]"],[368697,"J","Choice Band"],[368701,"J","Field Blower"],[368703,"J","Tapu Lele GX [Wonder Tag | Energy Drive | Tapu Cure GX]"],[368706,"J","Garbodor [Trashalanche | Acid Spray]"],[368731,"J","Field Blower"],[368733,"J","Choice Band"],[368735,"J","Tapu Lele GX [Wonder Tag | Energy Drive | Tapu Cure GX]"],[368739,"J","Garbodor [Trashalanche | Acid Spray]"],[368745,"J","Rescue Stretcher"],[368753,"J","Enhanced Hammer"],[368754,"J","Tapu Lele GX [Wonder Tag | Energy Drive | Tapu Cure GX]"],[368757,"J","Rescue Stretcher"],[368759,"J","Field Blower"],[368761,"J","Choice Band"]],"1824":[[312201,"J","Gardevoir GX [Secret Spring | Infinite Force | Twilight GX]"],[312202,"J","Kirlia [Smack | Magical Shot]"],[312203,"J","Ralts [Draining Kiss]"],[312204,"J","Diancie [Sparkling Wish | Diamond Storm]"],[312216,"J","Acerola"],[312218,"J","Guzma"],[312226,"J","Golisopod GX [First Impression | Armor Press | Crossing Cut "],[312227,"J","Wimpod [Wimp Out | Gnaw]"],[312240,"J","Guzma"],[312241,"J","Acerola"],[312262,"J","Guzma"],[312274,"J","Golisopod GX [First Impression | Armor Press | Crossing Cut "],[312275,"J","Wimpod [Wimp Out | Gnaw]"],[312287,"J","Guzma"],[312288,"J","Acerola"],[368673,"J","Guzma"],[368702,"J","Guzma"],[368751,"J","Guzma"],[368755,"J","Guzma"],[368760,"J","Escape Rope"]],"1842":[[368667,"J","Ultra Ball"],[368688,"J","Double Colorless Energy"],[368689,"J","Ultra Ball"],[368730,"J","Zorua [Stampede | Ram]"],[368741,"J","Double Colorless Energy"],[368748,"J","Zoroark GX [Trade | Riotous Beating | Trickster GX]"],[368764,"J","Marshadow [Let Loose | Shadow Punch]"],[368773,"J","Ultra Ball"]],"1843":[[368666,"J","Buzzwole GX [Jet Punch | Knuckle Impact | Absorption GX]"],[368740,"J","Kartana GX [Slice Off | Gale Blade | Blade GX]"]],"2065":[[368700,"J","Cynthia"],[368738,"J","Cynthia"],[368742,"J","Unit Energy [LPM]"],[368774,"J","Lillie"],[371628,"J","Infernape [Flaming Fighter | Burst Punch]"],[407139,"J","Cynthia"],[407274,"J","Escape Board"],[407284,"J","Pal Pad"],[407344,"J","Volkner"],[407349,"J","Cynthia"]],"2070":[[359270,"J","Water Energy"],[359271,"J","Water Energy"],[359272,"J","Water Energy"],[359273,"J","Water Energy"],[359274,"J","Water Energy"],[359275,"J","Water Energy"],[359276,"J","Metal Energy"],[359277,"J","Metal Energy"],[359278,"J","Metal Energy"],[359279,"J","Metal Energy"],[359280,"J","Metal Energy"],[359281,"J","Metal Energy"],[359282,"J","Metal Energy"],[359299,"J","Grass Energy"],[359300,"J","Grass Energy"],[359301,"J","Grass Energy"],[359302,"J","Grass Energy"],[359303,"J","Grass Energy"],[359304,"J","Grass Energy"],[359305,"J","Fairy Energy"],[359306,"J","Fairy Energy"],[359307,"J","Fairy Energy"],[359308,"J","Fairy Energy"],[359309,"J","Fairy Energy"],[359310,"J","Fairy Energy"],[359311,"J","Fairy Energy"]],"2075":[[368660,"J","Diancie ◇ [Princess's Cheers | Diamond Rain | Prism]"],[368669,"J","Beast Energy ◇ [Prism]"],[368679,"J","Rockruff [Surprise Attack]"],[368681,"J","Buzzwole [Sledgehammer | Swing Around]"],[368684,"J","Buzzwole [Sledgehammer | Swing Around]"],[368695,"J","Mysterious Treasure"],[368750,"J","Mysterious Treasure"],[368767,"J","Mysterious Treasure"],[407064,"J","Mysterious Treasure"],[407099,"J","Poipole [Spit Poison | Knockout Reviver]"],[407129,"J","Beast Energy ◇ [Prism]"],[407159,"J","Ultra Space"],[407174,"J","Mysterious Treasure"],[407179,"J","Beast Ring"],[407339,"J","Judge"],[407354,"J","Lysandre Labs"]],"2107":[[275569,"J","Pikachu (Power Magazine)"],[275570,"J","Pikachu (Top Deck)"],[901057,"J","Arven"],[901064,"J","Geeta"]],"2320":[[368682,"J","Regirock [Enhanced Stomp | Hammer Arm]"],[368685,"J","Banette GX [Shady Move | Shadow Chant | Tomb Hunt GX]"],[368686,"J","Rainbow Energy"],[368707,"J","Shuppet [Headbutt | Will-O-Wisp]"],[368762,"J","Acro Bike"],[368772,"J","Rayquaza GX [Stormy Winds | Dragon Break | Tempest GX]"],[407044,"J","Acro Bike"],[407069,"J","Switch"],[407254,"J","Acro Bike"],[407269,"J","Switch"],[407384,"J","Energy Switch"],[407409,"J","Switch"]],"2351":[[407224,"J","Turtonator [Explosive Jet]"],[407229,"J","Victini ◇ [Infinity | Prism]"],[407279,"J","Fiery Flint"]],"2352":[[361722,"J","Flareon [Sand-Attack | Fire Slash]"],[361724,"J","Glaceon [Quick Attack | Reflect Energy]"],[361726,"J","Jolteon [Electrigun | Pin Missile]"],[361727,"J","Espeon [Solar Revelation | Psy Report]"],[361728,"J","Timburr [Low Kick | Pound]"],[361729,"J","Umbreon [Confuse Ray | Shadow Shutdown]"],[361730,"J","Scraggy [Rising Lunge]"],[361731,"J","Zorua [Ram | Rising Lunge]"],[361732,"J","Eevee [Surprise Attack]"]],"2370":[[406989,"J","Magcargo GX [Crushing Charge | Lava Flow | Burning Magma GX]"],[407054,"J","Custom Catcher"],[407084,"J","Blacephalon GX [Bursting Burn | Mind Blown | Burst GX]"],[407094,"J","Naganadel [Charging Up | Turning Point]"],[407104,"J","Poipole [Eye Opener | Peck]"],[407164,"J","Heat Factory ◇ [Prism]"],[407169,"J","Custom Catcher"],[407249,"J","Heat Factory ◇ [Prism]"],[407304,"J","Zeraora GX [Thunderclap Zone | Plasma Fists | Full Voltage G"],[407364,"J","Thunder Mountain ◇ [Prism]"],[407369,"J","Custom Catcher"],[407379,"J","Electropower"]],"2407":[[366888,"V","Pikachu & Zekrom GX [Full Blitz | Tag Bolt GX]"],[367096,"V","Eevee & Snorlax GX [Cheer Up | Dump Truck Press | Megaton Fr"],[406969,"J","Cobalion GX [Metal Symbol | Dueling Saber | Iron Rule GX]"],[407029,"J","Bill's Analysis"],[407039,"J","Viridian Forest"],[407199,"J","Jirachi [Stellar Wish | Slap]"],[407209,"J","Ninetales [Nine Temptations | Flame Tail]"],[407214,"J","Vulpix [Tail Whip]"],[407264,"J","Pokémon Communication"],[407289,"J","Pikachu & Zekrom GX [Full Blitz | Tag Bolt GX]"],[407329,"J","Tapu Koko ◇ [Dance of the Ancients | Mach Bolt | Prism]"],[407389,"J","Pokémon Communication"]],"2437":[[406964,"J","Dedenne GX [Dedechange | Static Shock | Tingly Return GX]"],[406994,"J","Marshadow [Resetting Hole | Red Knuckles]"],[407004,"J","Reshiram & Charizard GX [Outrage | Flare Strike | Double Bla"],[407024,"J","Welder"],[407059,"J","Pokégear 3.0"],[407074,"J","Electromagnetic Radar"],[407079,"J","Fire Crystal"],[407114,"J","Dedenne GX [Dedechange | Static Shock | Tingly Return GX]"],[407119,"J","Mew [Bench Barrier | Psypower]"],[407144,"J","Welder"],[407194,"J","Reshiram & Charizard GX [Outrage | Flare Strike | Double Bla"],[407204,"J","Dedenne GX [Dedechange | Static Shock | Tingly Return GX]"],[407239,"J","Welder"],[407299,"J","Dedenne GX [Dedechange | Static Shock | Tingly Return GX]"],[407314,"J","Marshadow [Resetting Hole | Red Knuckles]"],[407319,"J","Mew [Bench Barrier | Psypower]"],[407359,"J","Power Plant"],[407374,"J","Electromagnetic Radar"]],"2487":[[377502,"V","Mega Sableye & Tyranitar GX [Greedy Crush | Gigafall GX]"],[388797,"V","Misty's Favor"],[388912,"V","Mega Sableye & Tyranitar GX [Greedy Crush | Gigafall GX]"],[388917,"V","Mega Sableye & Tyranitar GX [Greedy Crush | Gigafall GX]"],[388947,"V","Channeler"],[388962,"V","Misty's Favor"],[406959,"J","Mewtwo & Mew GX [Perfection | Miraculous Duo GX]"],[406974,"J","Espeon & Deoxys GX [Psychic Club | Cross Division GX]"],[406979,"J","Jirachi GX [Psychic Zone | Star Search | Star Shield GX]"],[406984,"J","Latios GX [Power Bind | Tag Purge | Clear Vision GX]"],[406999,"J","Naganadel GX [Ultra Conversion | Venom Shot | Injection GX]"],[407034,"J","Giant Hearth"],[407049,"J","Cherish Ball"],[407089,"J","Naganadel GX [Ultra Conversion | Venom Shot | Injection GX]"],[407109,"J","Heatran GX [Burning Road | Steaming Stomp | Hot Burn GX]"],[407149,"J","Hapu"],[407184,"J","Cherish Ball"],[407189,"J","Reset Stamp"],[407219,"J","Heatran GX [Burning Road | Steaming Stomp | Hot Burn GX]"],[407244,"J","Giant Hearth"],[407259,"J","Cherish Ball"],[407294,"J","Raichu & Alolan Raichu GX [Tandem Shock | Lightning Ride GX]"],[407309,"J","Hoopa [Evil Admonition | Mind Shock]"],[407324,"J","Tapu Fini [Razor Fin | Nature Wave]"],[407394,"J","Cherish Ball"],[407399,"J","Reset Stamp"],[407404,"J","Stadium Nav"],[407414,"J","Tag Switch"]],"2514":[[566116,"J","Grass Energy"],[566117,"J","Fire Energy"],[566118,"J","Water Energy"],[566119,"J","Lightning Energy"],[566120,"J","Psychic Energy"],[566121,"J","Fighting Energy"],[566122,"J","Darkness Energy"],[566123,"J","Metal Energy"],[566124,"J","Fairy Energy"]],"2644":[[398449,"V","Venusaur & Snivy GX [Shining Vine | Forest Dump | Solar Plan"],[398454,"V","Charizard & Braixen GX [Brilliant Flare | Crimson Flame Pill"],[398514,"V","Mimikyu [Impersonation | Mischievous Hands]"],[398529,"V","Weavile [Nasty Plot | Slashing Claw]"],[398534,"V","Pikachu [Nuzzle | Volt Tackle]"],[398544,"V","Koffing [Blow-Away Bomb | Poison Gas]"]],"2916":[[453458,"V","Coalossal [Tar Generator | Flaming Avalanche]"],[566760,"V","Cinderace [Crisis Power | Fireball Shot]"],[573859,"V","Galarian Zapdos [Strong Legs Charge | Zapper Kick]"],[573860,"V","Galarian Moltres [Malevolent Charge | Fiery Wrath]"],[583208,"V","Jolteon V [Thunder Spear | Pin Missile]"],[684352,"J","Lucario VSTAR [Fighting Knuckle | Aura Star]"],[703213,"V","Arceus V [Trinity Charge | Power Edge]"]],"2921":[[427236,"V","Snorlax VMAX [G-Max Fall]"]],"3143":[[905504,"J","Snorlax [Collect | Collapse]"],[907242,"J","Alcremie [Decorate | Draining Kiss]"]],"3199":[[483779,"V","Houndoom V [Searing Flame | Vengeful Flame]"]],"3214":[[463184,"V","Vitality Band"],[525340,"V","Sobble [Water Gun]"],[525360,"V","Vitality Band"],[561780,"V","Leon"],[605839,"V","Raihan"]],"3274":[[481604,"V","Houndoom V [Searing Flame | Vengeful Flame]"]],"3324":[[468564,"V","Togedemaru [Nuzzle | Rollout]"],[468674,"V","Pikachu [Thunderbolt]"],[468679,"V","Rowlet [Tackle | Leafage]"],[468799,"V","The Masked Royal"],[468829,"V","Ultra Ball"],[469144,"V","Tapu Koko [Flying Flip | Electric Ball]"],[469159,"V","Water Energy"],[469169,"V","Psychic Energy"],[469179,"V","Darkness Energy"],[469189,"V","Fairy Energy"],[469289,"V","Tapu Koko [Flying Flip | Electric Ball]"],[469379,"V","Grass Energy"],[469389,"V","Fire Energy"],[469424,"V","Guzma"],[469454,"V","Psychic Energy"],[469464,"V","Darkness Energy"],[469779,"V","Zekrom GX [Bullet Uppercut | Swift Bolt Strike | Rampage Bol"],[469784,"V","Zekrom GX [Bullet Uppercut | Swift Bolt Strike | Rampage Bol"],[469799,"V","Player's Ceremony"],[469889,"V","Cynthia"],[469924,"V","Pal Pad"],[469939,"V","Pikachu [Thunder Shock]"],[470979,"V","Pal Pad"],[470984,"V","Pokémon Communication"],[471009,"V","Cynthia"],[471019,"V","Detective Pikachu [Scout | Surprise Attack]"],[471029,"V","Detective Pikachu [Scout | Surprise Attack]"],[471054,"V","Grass Energy"],[471059,"V","Fire Energy"],[471064,"V","Water Energy"],[471069,"V","Lightning Energy"],[471074,"V","Psychic Energy"],[471079,"V","Fighting Energy"],[471084,"V","Darkness Energy"],[471389,"V","Metal Energy"],[471394,"V","Fairy Energy"],[471449,"V","Mewtwo GX [Super Psy Bolt | Psycrush GX]"],[471454,"V","Mewtwo GX [Super Psy Bolt | Psycrush GX]"],[471479,"V","Pikachu [Quick Attack | Thunderbolt]"],[471514,"V","Pikachu [Thunder Jolt]"],[471519,"V","Pikachu [Thunder Jolt]"],[471534,"V","Water Energy"],[471609,"V","Acerola"],[471614,"V","Guzma"],[471624,"V","Player's Ceremony"],[471644,"V","Pokémon Communication"],[471664,"V","Pal Pad"]],"3419":[[572225,"J","Grass Energy"],[572226,"J","Fire Energy"],[572227,"J","Water Energy"],[572228,"J","Lightning Energy"],[572229,"J","Psychic Energy"],[572230,"J","Fighting Energy"],[572231,"J","Metal Energy"],[572232,"J","Darkness Energy"],[572233,"J","Fairy Energy"]],"3580":[[520960,"V","Dottler [Reflect | Ram]"],[521100,"V","Drizzile [Shady Dealings | Water Drip]"],[521370,"V","Rolycoly [Ram]"],[521495,"V","Nickit [Instigate]"],[521760,"V","Bird Keeper"],[521775,"V","Ball Guy"],[521790,"V","Rose"],[521895,"V","Rose"],[522095,"V","Boltund [Big Bite | Fighting Fangs]"]],"3675":[[546346,"V","Mimikyu V [Dummy Doll | Jealous Eyes]"],[546426,"V","Tyranitar V [Cragalanche | Single Strike Crush]"],[546626,"V","Single Strike Urshifu VMAX [Beatdown | G-Max One Blow]"]],"3816":[[557066,"V","Misty's Favor"]],"3946":[[561337,"J","Water Energy"],[561338,"J","Lightning Energy"],[561339,"J","Fighting Energy"]],"3961":[[561597,"J","Fairy Energy"],[561598,"J","Fire Energy"],[561600,"J","Metal Energy"],[561601,"J","Psychic Energy"]],"4079":[[562919,"J","Fairy Energy"]],"4084":[[562942,"J","Fighting Energy"]],"4119":[[563720,"J","Lightning Energy"]],"4129":[[563938,"J","Darkness Energy"],[563939,"J","Fairy Energy"]],"4154":[[564599,"J","Grass Energy"],[564603,"J","Water Energy"]],"4159":[[552549,"J","Giovanni's Scheme"],[552569,"J","Mario Pikachu [Coin Gather | Super Jump]"],[552579,"J","Luigi Pikachu [Coin Gather | Super Dash]"],[552584,"J","Suzukisan"],[552589,"J","MSachiko EX [Galaxy Voice]"],[552739,"J","Honedge [Swords Dance | Slash]"],[552754,"J","Dedenne [Nuzzle | Spiral Drain]"],[552784,"J","Gogoat [Push Down | Forest Press]"],[552789,"J","Talonflame [Devastating Wind | Flare Blitz]"],[552834,"J","Hand Scope"],[552839,"J","Professor Sycamore"],[552864,"J","Pyroar [Crunch | Royal Flare]"],[552929,"J","Enhanced Hammer"],[552944,"J","Binacle [Sand Attack | Mud-Slap]"],[553214,"J","Cosplay Pikachu [Quick Attack | Synchro Appeal]"],[553249,"J","Meowth [Feelin' Fine | Fury Swipes]"],[553254,"J","Treecko [Quick Attack]"],[553304,"J","Energy Recycler"],[553349,"J","Rayquaza Spirit Link"],[553394,"J","Heavy Boots"],[553419,"J","Umbreon [Mach Claw | Lunatic Sense]"],[553568,"J","Energy Reset"],[553713,"J","Evosoda"],[553763,"J","Rainbow Energy"],[553768,"J","Eco Arm"],[553813,"J","Assault Vest"],[553853,"J","Lugia [Gust | Aeroblast]"],[553928,"J","Captivating Poké Puff"],[553933,"J","Max Elixir"],[553948,"J","Pikachu Libre [Quick Attack | Flying Elekick]"],[554163,"J","Lass's Special"],[554190,"J","Pikachu [Tail Whip | Electro Ball]"],[554195,"J","Pikachu [Tail Whip | Electro Ball]"],[554198,"J","Pikachu [Tail Whip | Electro Ball]"],[554201,"J","Pikachu [Tail Whip | Electro Ball]"],[554206,"J","Pikachu [Tail Whip | Electro Ball]"],[554207,"J","Pikachu [Tail Whip | Electro Ball]"],[554265,"J","Pikachu [Nuzzle | Quick Attack]"],[554270,"J","Pikachu [Nuzzle | Quick Attack]"],[752373,"J","Mewtwo EX [Photon Wave | Psyburn]"],[786637,"J","MGarchomp EX [Crimson Edge]"],[864131,"J","Empoleon BREAK [Emperor's Command]"],[864132,"J","Crobat BREAK [Silent Bite]"],[864133,"J","Crobat BREAK [Silent Bite]"],[882110,"J","Muscle Band"]],"4170":[[806285,"J","Boss's Orders - Lysandre"],[911484,"J","Articuno, Moltres, and Zapdos [Big Bang]"]],"4174":[[567280,"V","Shadow Rider Calyrex V [Shadow Mist | Astral Barrage]"]],"4179":[[567373,"J","Grass Energy"],[567390,"J","Psychic Energy"]],"4181":[[567512,"J","Water Energy"]],"4187":[[567967,"J","Grass Energy"],[567968,"J","Fire Energy"],[567969,"J","Water Energy"],[567970,"J","Lightning Energy"],[567971,"J","Psychic Energy"],[567972,"J","Fighting Energy"],[567973,"J","Darkness Energy"],[567974,"J","Metal Energy"]],"4188":[[567991,"J","Psychic Energy"],[567992,"J","Darkness Energy"]],"4189":[[568012,"J","Water Energy"]],"4190":[[568031,"J","Water Energy"],[568032,"J","Lightning Energy"]],"4192":[[568193,"J","Psychic Energy"],[568194,"J","Metal Energy"]],"4196":[[568934,"J","Grass Energy"],[568936,"J","Water Energy"],[568937,"J","Lightning Energy"],[568938,"J","Psychic Energy"],[568939,"J","Fighting Energy"]],"4197":[[568955,"J","Water Energy"],[568956,"J","Metal Energy"],[568957,"J","Darkness Energy"]],"4198":[[568973,"J","Water Energy"],[568974,"J","Lightning Energy"],[568975,"J","Fighting Energy"]],"4199":[[568991,"J","Grass Energy"],[568992,"J","Psychic Energy"],[568993,"J","Darkness Energy"]],"4205":[[569348,"J","Water Energy"],[569349,"J","Metal Energy"],[569350,"J","Lightning Energy"],[569351,"J","Fighting Energy"],[569353,"J","Darkness Energy"]],"4206":[[569381,"J","Grass Energy"],[569382,"J","Lightning Energy"]],"4207":[[569402,"J","Water Energy"]],"4211":[[569717,"J","Fire Energy"],[569718,"J","Lightning Energy"],[569719,"J","Psychic Energy"]],"4214":[[890048,"J","Reshiram [Outrage | Blue Flare]"],[890052,"J","Zekrom [Outrage | Bolt Strike]"]],"4216":[[875559,"J","Water Energy"],[875561,"J","Psychic Energy"],[875563,"J","Lightning Energy"],[875564,"J","Grass Energy"],[875565,"J","Fighting Energy"]],"4238":[[563479,"J","Psychic Energy"],[563480,"J","Lightning Energy"],[563481,"J","Fairy Energy"]],"4240":[[564181,"J","Fire Energy"],[564182,"J","Water Energy"],[564183,"J","Lightning Energy"],[564184,"J","Psychic Energy"]],"4241":[[564257,"J","Darkness Energy"]],"4242":[[564280,"J","Water Energy"]],"4243":[[571575,"J","Grass Energy"],[571576,"J","Fire Energy"],[571577,"J","Water Energy"],[571578,"J","Lightning Energy"],[571579,"J","Fighting Energy"],[571580,"J","Darkness Energy"]],"4252":[[565023,"J","Revitalizer"],[565024,"J","Super Rod"],[565025,"J","Special Charge"],[565026,"J","Dive Ball"],[565027,"J","Trainers' Mail"],[565028,"J","Professor's Letter"],[565029,"J","Battle Compressor Team Flare Gear"],[565030,"J","VS Seeker"],[565031,"J","Max Elixir"],[565032,"J","Float Stone"],[565033,"J","Bursting Balloon"],[565034,"J","Fighting Fury Belt"],[565035,"J","Brigette"],[565036,"J","N"],[565037,"J","Hex Maniac"],[565038,"J","Xerosic"],[565039,"J","Korrina"],[565040,"J","Delinquent"],[565041,"J","Teammates"],[565042,"J","Ninja Boy"],[565043,"J","Skyla"],[565044,"J","Professor Sycamore"],[565045,"J","Pokémon Ranger"],[565046,"J","Wally"],[565047,"J","Rough Seas"],[565048,"J","Forest of Giant Plants"],[565049,"J","Dimension Valley"],[565050,"J","Sky Field"],[565051,"J","Double Dragon Energy"]],"4291":[[678442,"J","Poké Ball"]],"4328":[[574275,"V","Rayquaza VMAX [Azure Pulse | Max Burst]"],[901055,"J","Marshadow [Rapid Hunt | Shadow Flicker]"],[903181,"J","Regieleki [Static Shock | Teraspark]"]],"4340":[[902396,"J","Sky-Splitting Deoxys [Forme Change | Ozone Hole | Ozone Torn"]],"4347":[[576784,"J","Gardevoir ex δ Delta Species [Imprison | Flame Ball]"]],"4348":[[570922,"J","Energy Switch"],[570923,"J","Potion"],[570924,"J","Switch"]],"4382":[[582613,"V","Mew VMAX [Cross Fusion Strike | Max Miracle]"]],"4390":[[609603,"J","Grass Energy"],[609604,"J","Fire Energy"],[609605,"J","Water Energy"],[609606,"J","Lightning Energy"],[609607,"J","Psychic Energy"],[609608,"J","Fighting Energy"],[609609,"J","Darkness Energy"],[609610,"J","Metal Energy"]],"4392":[[576936,"J","_____'s Pikachu [Birthday Surprise]"],[576937,"J","Flying Pikachu [Thundershock | Fly]"],[576938,"J","Surfing Pikachu [Surf]"]],"4434":[[608462,"V","Charizard VSTAR [Explosive Fire | Star Blaze]"],[608668,"V","Arceus V [Trinity Charge | Power Edge]"],[608748,"V","Mimikyu V [Dummy Doll | Jealous Eyes]"],[608751,"V","Single Strike Urshifu VMAX [Beatdown | G-Max One Blow]"],[608761,"V","Single Strike Urshifu VMAX [Beatdown | G-Max One Blow]"]],"4490":[[588181,"J","Darkrai EX [Dark Cloak | Night Spear]"],[588185,"J","MGardevoir EX [Despair Ray]"],[588189,"J","MRayquaza EX [Emerald Break]"],[588190,"J","Shaymin EX [Set Up | Sky Return]"]],"4516":[[609667,"J","Fighting Energy"]],"4517":[[609689,"J","Darkness Energy"]],"4518":[[606648,"J","Lightning Energy"]],"4786":[[668110,"J","Pokémon GO Game Code (JP)"]],"4979":[[658889,"V","Hoothoot [Stand Sentry | Flap]"],[658890,"V","Starmie V [Swift | Energy Spiral]"],[658900,"V","Garchomp V [Dragon Claw | Sonic Strike]"]],"5051":[[665267,"V","Mewtwo VSTAR [Psy Purge | Star Raid]"],[665675,"V","Dragonite V [Hyper Beam | Buster Tail]"],[665690,"V","Mewtwo VSTAR [Psy Purge | Star Raid]"],[665697,"V","Mewtwo VSTAR [Psy Purge | Star Raid]"]],"5093":[[670828,"V","Chandelure [Mountain Roasting | Heat Blast]"],[670829,"V","Snorlax [Unfazed Fat | Thumping Snore]"],[670831,"V","Gallade V [Rising Sword | Buster Swing]"],[674225,"V","Pikachu [Pika Dash | Whimsy Tackle]"],[674226,"V","Gengar [Netherworld Gate | Screaming Circle]"],[674228,"V","Hisuian Arcanine [Very Vulnerable | Sharp Fang]"],[674235,"V","Pikachu VMAX [G-Max Volt Tackle]"],[674236,"V","Enamorus V [Guardian of Love | Blossom Tail]"],[674244,"V","Pikachu VMAX [G-Max Volt Tackle]"]],"5142":[[682185,"V","Lugia V [Read the Wind | Aero Dive]"],[682187,"V","Ho-Oh V [Reviving Flame | Rainbow Burn]"],[682254,"J","Gym Trainer"]],"5201":[[691922,"V","Zeraora VMAX [Reactive Pulse | Max Fist]"],[691923,"V","Zeraora VSTAR [Crushing Beat | Lightning Storm Star]"],[691935,"V","Regigigas VSTAR [Giga Impact | Star Guardian]"]],"5212":[[699707,"J","Victory Symbol"],[699708,"J","Victory Symbol"],[699709,"J","Victory Symbol"],[829090,"J","Cheren"],[830066,"J","Tohoku's Pikachu [SV-P]"],[830067,"J","Hiroshima's Pikachu [SV-P]"],[830068,"J","Fukuoka's Pikachu [SV-P]"]],"5216":[[698993,"J","Basic Darkness Energy"],[698994,"J","Basic Metal Energy"]],"5223":[[702507,"V","Ralts [Psyshot]"],[702509,"V","Fidough [Springy | Flop]"],[703594,"V","Koraidon ex [Dino Cry | Wild Impact]"],[901056,"J","Miraidon ex [Tandem Unit | Photon Blaster]"]],"5241":[[703196,"J","Pikachu [Adventuring Together]"],[761127,"J","Palafin [Jet Punch | Justice Kick]"],[765995,"J","Teal Mask Ogerpon [Mountain Stroll | Ogre Comeback]"],[770951,"V","Greninja ex [Stealthy Shuriken | Torrential Slash]"],[783446,"J","Paradise Resort"],[796935,"V","Magneton [Overvolt Discharge | Electric Ball]"]],"5318":[[715525,"J","Quaxly [Reckless Charge]"],[715671,"V","Sprigatito [Gather Sunlight | Seed Bomb]"],[715675,"V","Pyroar [Singe | Overrun]"],[715676,"V","Fuecoco [Spacing Out | Flare]"],[715678,"V","Magikarp [Expert Splasher]"],[715686,"V","Raichu [Electrocharge | Thunderbolt]"],[715700,"V","Rookidee [Send Back]"],[715701,"V","Maushold [Gentle Slap | Gnaw Relentlessly]"],[715731,"V","Meowscarada ex [Bouquet Magic | Scratching Nails]"],[715733,"V","Skeledirge ex [Vitality Song | Burning Voice]"],[719851,"J","Lokix [Assaulting Kick | Speed Attack]"],[719852,"J","Baxcalibur [Super Cold | Buster Tail]"],[719853,"J","Tinkaton [Gather Materials | Special Hammer]"],[719854,"J","Tinkaton [Gather Materials | Special Hammer]"],[746573,"J","Chien-Pao ex [Shivery Chill | Hail Blade]"],[754781,"J","Orthworm [Nutritional Iron | Shoot Through]"],[754782,"J","Gyarados [Revengeful Storm | Berserker Tackle]"],[754783,"J","Luxray [Swelling Flash | Wild Charge]"],[766960,"J","Orthworm [Nutritional Iron | Shoot Through]"],[785700,"J","Tinkaton [Gather Materials | Special Hammer]"],[785701,"J","Garganacl [Blessed Salt | Knocking Hammer]"],[785702,"J","Glimmora [Shattering Crystal | Poison Petals]"],[785703,"J","Hydreigon [Tri Howl | Dark Cutter]"],[786659,"J","Rockruff [Rock Throw | Bite]"],[793388,"J","Pikachu [Growl | Pika Bolt]"],[794945,"J","Sprigatito [Gather Sunlight | Seed Bomb]"],[858712,"J","Pawmot [Mach Bolt | Electric Fist]"],[858714,"J","Larvitar [Double Stab]"],[858715,"J","Pupitar [Headbutt Bounce]"],[858716,"J","Tyranitar [Rout | Dread Mountain]"],[858717,"J","Sableye [Night Eyes | Unseen Claw]"],[858718,"J","Slakoth [Yawn]"],[858719,"J","Vigoroth [Confront | Sharp Claws]"],[858720,"J","Slaking [Stir and Snooze | Slacker's Headstrike]"],[872163,"J","Boss's Orders - Ghetsis"]],"5328":[[719445,"V","Venusaur ex [Tranquil Flower | Dangerous Toxwhip]"]],"5385":[[725279,"V","Ninetales [Will-O-Wisp | Nine-tailed Dance]"],[725282,"V","Cleffa [Grasping Draw]"],[725284,"V","Houndour [Coordinated Pack | Focus Fangs]"]],"5402":[[720365,"V","Bulbasaur [Leech Seed | 151]"],[733761,"V","Bulbasaur [Leech Seed | 151]"],[733769,"V","Nidoking [Enthusiastic King | Venom Impact]"],[733771,"V","Poliwhirl [Wave Splash | Frog Hop]"],[733772,"V","Machoke [Mountain Ramming]"],[733775,"V","Omanyte [Tentacular Return]"],[733793,"V","Venusaur ex [Tranquil Flower | Dangerous Toxwhip]"],[733796,"V","Alakazam ex [Mind Jack | Dimensional Hand]"],[733798,"V","Erika's Invitation"]],"5431":[[728280,"J","Vitality Band"]],"5444":[[740728,"V","Toedscruel [Slime Mold Colony | Mushroom Drain]"],[740733,"V","Vanillish [Frost Smash]"],[740736,"V","Plusle [Plus Damage]"],[740750,"V","Brute Bonnet [Toxic Powder | Rampaging Hammer]"],[743159,"V","Iron Moth [Thermal Reactor | Heat Ray]"],[743160,"V","Slither Wing [Stomp Off | Burning Turbulence]"],[749909,"V","Iron Moth [Thermal Reactor | Heat Ray]"],[782654,"V","Iron Moth [Thermal Reactor | Heat Ray]"],[786603,"V","Steelix [Earthquake | Heavy Impact]"]],"5519":[[746204,"V","Gloom [Semi-Blooming Energy | Drool]"],[746207,"V","Hoppip [Splashing Dodge]"],[746208,"V","Skiploom [Drifting Dodge | Flowery Zephyr]"],[746210,"V","Pineco [Rollout | SV2D]"],[746212,"V","Snover [Corkscrew Punch]"],[746215,"V","Floragato [Seed Bomb | Magic Whip]"],[746218,"V","Dolliv [Slap | Apply Oil]"],[746220,"V","Toedscool [Furious Kicks]"],[746222,"V","Capsakid [Increasing Spice | Playful Kick]"],[746224,"V","Rellor [Ball Roll]"],[746235,"V","Charcadet [Heat Blast]"],[746408,"V","Paldean Tauros [Raging Horns | Aqua Dive]"],[746409,"V","Quaxly [Reckless Charge]"],[746410,"V","Quaxwell [Water Gun | Wave Splash]"],[746412,"V","Wiglett [Twisting Strike]"],[746416,"V","Veluza [Ram | Slim Screw]"],[746418,"V","Tatsugiri [Mise en Place | Curl Up]"],[746428,"V","Arctibax [Sharp Fin | Frost Smash]"],[746441,"V","Shinx [Wild Kick]"],[746442,"V","Luxio [Zap Kick | Head Bolt]"],[746444,"V","Pachirisu [Electricity Pouches | Everyone Discharge]"],[746445,"V","Thundurus [Adverse Weather | Gigantic Bolt]"],[746446,"V","Toxel [Slight Intrusion]"],[746448,"V","Pawmi [Light Punch | Zap Kick]"],[746449,"V","Pawmo [Thunder Shock | Head Bolt]"],[746452,"V","Kilowattrel [United Thunder | Speed Wing]"],[746462,"V","Ralts [Psyshot]"],[746463,"V","Kirlia [Magical Shot | Psychic]"],[746465,"V","Drifloon [Gust | Balloon Blast]"],[746466,"V","Drifblim [Gust | Curse Spreading]"],[746472,"V","Dachsbun [Well-Baked Body | Headbutt Bounce]"],[746475,"V","Flittle [Psy Bolt]"],[746477,"V","Tinkatuff [Play Rough | Pulverizing Press]"],[746479,"V","Greavard [Graveyard Gamboling]"],[746482,"V","Mankey [Monkey Beatdown]"],[746483,"V","Primeape [Raging Punch]"],[746486,"V","Riolu [Punch | Reckless Charge]"],[746489,"V","Nacli [Salt Coating | Tackle]"],[746490,"V","Naclstack [Salt Cannon]"],[746492,"V","Glimmet [Ascension]"],[746501,"V","Sneasel [Dig Claws]"],[746505,"V","Bisharp [Dark Cutter | Double-Edged Slash]"],[746507,"V","Maschiff [Ambush]"],[746508,"V","Mabosstiff [Intimidating Howl | Wild Tackle]"],[746509,"V","Shroodle [Berry Search | Scratch]"],[746510,"V","Grafaiai [Spit Poison | Colorful Graffiti]"],[746516,"V","Noibat [Gust]"],[746524,"V","Doduo [Reckless Charge]"],[746531,"V","Greedent [Bite | Enhanced Fang]"],[746558,"V","Professor's Research - Professor Sada"],[746559,"V","Professor's Research - Professor Turo"],[746562,"V","Arven"]],"5526":[[741975,"J","Bulbasaur [Tackle | Vine Whip]"],[741976,"J","Bulbasaur [Tackle | Vine Whip]"],[741983,"J","Potion"],[741984,"J","Switch"],[741985,"J","Basic Grass Energy"],[741986,"J","Basic Grass Energy"],[741987,"J","Charmander [Scratch | Ember | MFB]"],[741988,"J","Charmander [Scratch | Ember | MFB]"],[741995,"J","Potion"],[741996,"J","Switch"],[741997,"J","Basic Fire Energy"],[741998,"J","Basic Fire Energy"],[741999,"J","Pikachu [Quick Attack | Electro Ball | MFB]"],[742000,"J","Pikachu [Quick Attack | Electro Ball | MFB]"],[742007,"J","Potion"],[742008,"J","Switch"],[742009,"J","Basic Lightning Energy"],[742010,"J","Basic Lightning Energy"],[742011,"J","Squirtle [Tackle | Water Gun]"],[742012,"J","Squirtle [Tackle | Water Gun]"],[742019,"J","Potion"],[742020,"J","Switch"],[742021,"J","Basic Water Energy"],[742022,"J","Basic Water Energy"]],"5546":[[751748,"V","Tandemaus [Collect | Gentle Slap]"]],"5589":[[760796,"V","Sawsbuck [Changing Seasons | Superpowered Horns]"],[760805,"V","Mudsdale [Mud Stock | High Horsepower]"],[760841,"V","Morty's Conviction"]],"5621":[[761118,"J","Basic Metal Energy"]],"5681":[[902282,"J","Brock's Vulpix [Flame | Quick Attack]"],[902283,"J","Brock's Geodude [Call for Friend | Hook Shot]"],[902284,"J","Brock's Golem [Rock Slide | Fissure]"],[902285,"J","Brock's Onix [Bellow | Rock Throw]"],[902286,"J","Brock's Rhydon [Bench Guard | Lariat]"],[902287,"J","Energy Retrieval"],[902288,"J","Recall"],[902289,"J","Potion"],[902290,"J","Revive"],[902291,"J","Brock's Training Method"],[902292,"J","Full Heal"],[902293,"J","Pewter City Gym"],[902294,"J","Switch"],[902295,"J","Pokédex"],[902296,"J","Pokémon Center"],[902297,"J","Double Colorless Energy"]],"5682":[[902241,"J","Misty's Tentacruel [Flee | Jellyfish Poison]"],[902242,"J","Misty's Horsea [Tackle | Smokescreen]"],[902243,"J","Misty's Goldeen [Fury Attack | Supersonic]"],[902244,"J","Misty's Staryu [Star Boomerang]"],[902245,"J","Misty's Wrath"],[902246,"J","Misty's Duel"],[902247,"J","Misty's Tears"],[902248,"J","Defender"],[902249,"J","Gust of Wind"],[902255,"J","Cerulean City Gym"],[902266,"J","Poké Ball"]],"5683":[[902267,"J","Lt. Surge's Magnemite [Removal Pulse | Confusion Pulse]"],[902269,"J","Lt. Surge's Magnemite [Thundershock | Tackle]"],[902271,"J","Lt. Surge's Magneton [Energy Charge | Mega Shock]"],[902272,"J","Lt. Surge's Voltorb [Spin Ball | Double Spin]"],[902273,"J","Super Potion"],[902274,"J","Energy Flow"],[902276,"J","Vermilion City Gym"],[902277,"J","Secret Mission"],[902278,"J","Lt. Surge's Treaty"]],"5684":[[902298,"J","Erika's Oddish [Blot | Sporadic Sponging]"],[902300,"J","Erika's Vileplume [Pollen Defense | Mega Drain]"],[902301,"J","Erika's Bellsprout [Careless Tackle]"],[902302,"J","Erika's Victreebel [Fragrance Trap | Razor Leaf]"],[902303,"J","Erika's Exeggutor [Psychic Exchange | Stomp]"],[902304,"J","Erika's Tangela [Vine Slap | Stretch Vine]"],[902305,"J","Erika's Dratini [Strange Barrier | Tail Strike]"],[902306,"J","Energy Search"],[902307,"J","Erika's Maids"],[902308,"J","Erika's Perfume"],[902309,"J","Charity"],[902310,"J","Celadon City Gym"],[902311,"J","PlusPower"],[902312,"J","Recycle"],[902313,"J","Good Manners"]],"5685":[[902315,"J","Sabrina's Kadabra [Life Drain | Psyshot]"],[902316,"J","Sabrina's Alakazam [Psylink | Mega Burn]"],[902317,"J","Sabrina's Hypno [Invigorate | Pendulum Curse]"],[902318,"J","Sabrina's Porygon [Sharp Point | Barrier Attack]"],[902319,"J","Sabrina's ESP"],[902320,"J","Sabrina's Gaze"],[902321,"J","Saffron City Gym"],[902322,"J","Warp Point"]],"5686":[[902232,"J","Blaine's Vulpix [Natural Healing | Tail Fan]"],[902233,"J","Blaine's Ninetales [Healing Fire | Burn Up]"],[902234,"J","Blaine's Arcanine [Heat Tackle | Firestorm]"],[902235,"J","Blaine's Ponyta [Hind Kick]"],[902236,"J","Blaine's Rapidash [Fire Mane | Stamp]"],[902237,"J","Blaine's Magmar [Firebreathing | Lava Burst]"],[902238,"J","Blaine's Doduo [Wild Kick | Retaliate]"],[902239,"J","Blaine's Gamble"],[902240,"J","Cinnabar City Gym"]],"5691":[[769355,"V","Hisuian Growlithe [Blazing Destruction | Take Down]"],[769362,"V","Eevee [Ascension | Quick Attack]"],[769390,"V","Bloodmoon Ursaluna ex [Seasoned Skill | Blood Moon]"],[769394,"V","Perrin"],[901089,"J","Luxray ex [Piercing Gaze | Volt Strike]"]],"5757":[[773836,"V","Okidogi ex [Poisonous Musculature | Chain-Crazed]"]],"5760":[[780961,"V","Houndoom [Bite | Snarl]"],[780985,"V","Okidogi ex [Poisonous Musculature | Chain-Crazed]"]],"5796":[[785593,"J","Darkrai [Dark Slumber | Night Cyclone]"],[785640,"J","Sinistcha [Cursed Drop | Spill the Tea]"],[785645,"J","Teal Mask Ogerpon [Mountain Stroll | Ogre Comeback]"],[785652,"J","Munkidori [Adrena-Brain | Mind Bend]"],[785654,"J","Fezandipiti [Adrena-Pheromone | Energy Feather]"],[785656,"J","Okidogi [Adrena-Power | Good Punch]"]],"5834":[[901058,"J","Chien-Pao ex [Shivery Chill | Hail Blade]"],[901074,"J","Glass Trumpet"],[901104,"J","Budew [Itchy Pollen]"],[901109,"J","Fan Rotom [Fan Call | Assault Landing]"]],"5861":[[783507,"J","Alcremie VMAX [Aromatherapy | Draining Kiss | Dazzling Gleam"],[783508,"J","Alcremie VMAX [Aromatherapy | Draining Kiss | Dazzling Gleam"],[783509,"J","Alcremie VMAX [Aromatherapy | Draining Kiss | Dazzling Gleam"]],"5877":[[784487,"J","Sceptile [Lizard Poison | Solarbeam]"],[784495,"J","Blaziken [Fire Starter | Fire Stream]"],[784500,"J","Swampert [Water Call | Hypno Splash]"],[784508,"J","Electrike [Charge | Thunder Jolt]"],[784509,"J","Manectric [Attract Current | Thunder Jolt]"],[784511,"J","Ralts [Pound | Link Blast]"],[784512,"J","Kirlia [Dazzle Dance | Life Drain]"],[784517,"J","Makuhita [Fake Out]"],[784518,"J","Hariyama [Super Slap Push | Mega Throw]"],[784528,"J","Skitty [Minor Errand-Running | Lullaby]"],[784529,"J","Delcatty [Energy Draw | Max Energy Source]"],[784531,"J","Poochyena [Shadow Bind]"],[784532,"J","Mightyena [Intimidating Fang | Shakedown]"],[784533,"J","Aron [Rollout | Double Stab]"],[784534,"J","Lairon [Magnitude | One-Two Strike]"]],"5879":[[794568,"V","Castform Sunny Form [Singe | Sunny Assist]"],[794570,"V","Ceruledge [Cursed Edge | Black Blaze Slash]"],[794576,"V","Latios [Skill Dive | Jet Headbutt]"]],"5890":[[786728,"J","Basic Lightning Energy"]],"5996":[[807696,"V","N's Reshiram [Powerful Rage | Virtuous Flame]"]],"6006":[[817313,"V","Articuno [Frigid Fluttering | Ice Blast]"],[817320,"V","N's Reshiram [Powerful Rage | Virtuous Flame]"],[817326,"V","Lillie's Clefairy ex [Fairy Zone | Full Moon Rondo]"],[817335,"V","Volcanion ex [Scalding Steam | Scorching Cyclone]"],[817337,"V","Lillie's Clefairy ex [Fairy Zone | Full Moon Rondo]"]],"6009":[[806543,"J","Amarys"],[806545,"J","Area Zero Underdepths"],[806547,"J","Binding Mochi"],[806549,"J","Black Belt's Training"],[806551,"J","Black Belt's Training"],[806553,"J","Black Belt's Training"],[806555,"J","Black Belt's Training"],[806557,"J","Briar"],[806559,"J","Buddy-Buddy Poffin"],[806561,"J","Bug Catching Set"],[806563,"J","Carmine"],[806565,"J","Ciphermaniac's Codebreaking"],[806567,"V","Crispin"],[806569,"J","Earthen Vessel"],[806571,"J","Explorer's Guidance"],[806573,"J","Festival Grounds"],[806575,"V","Friends in Paldea"],[806577,"J","Glass Trumpet"],[806579,"J","Haban Berry"],[806581,"V","Janine's Secret Art"],[806583,"V","Kieran"],[806585,"V","Lacey"],[806587,"V","Larry's Skill"],[806589,"J","Ogre's Mask"],[806591,"J","Professor Sada's Vitality"],[806593,"J","Professor Turo's Scenario"],[806595,"J","Professor's Research - Professor Oak"],[806597,"J","Professor's Research - Professor Elm"],[806599,"J","Professor's Research - Professor Rowan"],[806601,"J","Professor's Research - Professor Sycamore"],[806603,"J","Rescue Board"],[806605,"J","Roto-Stick"],[806607,"J","Techno Radar"],[810421,"J","Eevee [Boosted Evolution | Reckless Charge]"]],"6092":[[821944,"V","Team Rocket's Moltres ex [Flame Screen | Evil Incineration]"]],"6096":[[826064,"V","Ethan's Typhlosion [Buddy Blast | Steam Artillery]"],[826065,"V","Team Rocket's Houndoom [Cruel Coal | Scorching Fire]"],[826068,"V","Misty's Lapras [Swim Together | Surf]"],[826075,"V","Zamazenta [Strong Bash]"],[826076,"V","Team Rocket's Raticate [Reckless Abandon]"],[826082,"V","Team Rocket's Moltres ex [Flame Screen | Evil Incineration]"],[826116,"V","Team Rocket's Crobat ex [Biting Spree | Assassin's Return]"]],"6127":[[859886,"J","Air Balloon"],[859887,"J","Hilda"],[879049,"J","Pikachu [Scrappy Spark]"],[894273,"J","Pikachu [Iron Tail | Electro Ball]"]],"6130":[[829408,"V","Cobalion [Righteous Edge | Metal Arms]"]],"6131":[[829464,"V","Vanillite [Beat | Ice Edge]"]],"6134":[[836089,"V","Simisage [Gentle Slap]"],[836100,"V","Amoonguss [Dangerous Reaction | Seed Bomb]"],[836105,"V","Larvesta [Peck Off]"],[836139,"V","Eelektross [Thunder Fang | Buzz Flip]"],[836212,"V","Cobalion [Righteous Edge | Metal Arms]"],[836222,"V","Unfezant [Add On | Swift Flight]"]],"6135":[[835930,"V","Simisear [Gentle Slap]"],[835952,"V","Ducklett [Firefighting | Wing Attack]"],[835958,"V","Vanillish [Ram | Ice Beam]"],[835960,"V","Vanilluxe [Ram | Double Freeze]"],[836025,"V","Zweilous [Double Hit | Pitch-Black Fangs]"],[836032,"V","Patrat [Procurement | Gnaw]"],[836034,"V","Watchog [Focus Energy | Hyper Fang]"],[836072,"V","Swadloon [Healing Leaves | Bug Buzz]"],[836080,"V","Shelmet [Stimulated Evolution | Headbutt Bounce]"],[836084,"V","Tepig [Tackle | Rollout | SV]"],[836092,"V","Simisear [Gentle Slap]"],[836095,"V","Litwick [Brighten and Burn]"],[836110,"V","Basculin [Bite | Bared Fangs]"],[836116,"V","Vanillite [Beat | Ice Edge]"],[836122,"V","Blitzle [Smash Kick | Zap Kick]"],[836126,"V","Joltik [Surprise Attack]"],[836130,"V","Stunfisk [Muddy Bolt | Flop]"],[836136,"V","Yamask [Focused Wish]"],[836142,"V","Frillish [Oceanic Gloom]"],[836143,"V","Roggenrola [Harden | Rolling Rocks]"],[836149,"V","Sawk [Elbow Strike | Rising Chop]"],[836150,"V","Archen [Acrobatics]"],[836152,"V","Archeops [Ancient Wing | Rock Throw]"],[836155,"V","Mienshao [Low Sweep | Smash Uppercut]"],[836161,"V","Scraggy [Headbutt | Invade]"],[836164,"V","Trubbish [Drool | Sludge Bomb]"],[836179,"V","Zweilous [Double Hit | Pitch-Black Fangs]"],[836180,"V","Ferroseed [Zzzt | Metal Claw]"],[836188,"V","Watchog [Focus Energy | Hyper Fang]"],[836189,"V","Lillipup [Play Rough]"]],"6209":[[851209,"V","Vulpix [Stampede | Combustion]"],[851225,"V","Stufful [Light Punch | Flop]"]],"6219":[[837546,"V","Daisy's Help"],[837547,"V","Daisy's Help"],[837548,"V","Bill's Transfer"],[837549,"V","Bill's Transfer"]],"6230":[[905268,"J","Paradise Resort"]],"6237":[[848542,"J","Yveltal [Cross-Cut | Dark Edge]"],[848555,"J","Jirachi [Stellar Veil | Charge Energy]"],[848557,"J","Ferroseed [Spike Sting]"],[848558,"J","Ferrothorn [Exoskeleton | Spinning Needle]"],[848560,"J","Bisharp [Metal Claw | Fury Cutter]"],[848561,"J","Kingambit [Strike Down | Massive Rend]"],[848563,"J","Doublade [Swords Dance | Slicing Blade]"],[848565,"J","Zacian [Iron Roar | Brave Blade]"],[848566,"J","Orthworm [Punch and Draw | Crunch-Time Rush]"],[848568,"J","Zigzagoon [Headbutt Bounce | Claw Slash]"],[848569,"J","Linoone [Jet Headbutt | Reckless Charge]"],[848570,"J","Swablu [Peck | Bind Wound]"],[848576,"J","Flamigo [Flap | Nosedive]"],[848606,"J","Fighting Au Lait"],[848607,"J","Cursed Duster"],[848608,"J","Patrol Cap"],[848609,"J","Technical Machine: Evolution"],[848610,"J","Technical Machine: Devolution"],[848611,"J","Larry"],[848612,"J","Shauntal"],[848614,"J","Paldean Student"],[848615,"J","Paldean Student"],[848616,"J","Poppy"],[848618,"J","Town Store"],[848639,"J","Shauntal"],[848642,"J","Mela"],[848645,"J","Charizard ex [Infernal Reign | Burning Darkness]"],[848649,"J","Poppy"],[848650,"J","Mela"],[848654,"J","Defiance Band"]],"6290":[[879345,"J","Cinderace [Explosiveness | Turbo Flare]"],[879366,"J","Meganium [Wild Growth | Solar Beam]"]],"6291":[[850593,"V","Piplup [Call for Support | Tackle]"]],"6299":[[857673,"V","Piplup [Call for Support | Tackle]"],[857674,"V","Yamper [Play Rough]"],[857690,"V","Mega Lopunny ex [Gale Thrust | Spiky Hopper]"]],"6309":[[852127,"J","Basic Grass Energy"],[852130,"J","Basic Lightning Energy"],[852132,"J","Basic Fighting Energy"],[852133,"J","Basic Darkness Energy"]],"6328":[[897883,"J","Milotic ex [Sparkling Scales | Hypno Splash]"],[897891,"J","Blissey ex [Happy Switch | Return]"],[897896,"J","Yanma [Silent Wing]"],[897898,"J","Yanmega ex [Buzzing Boost | Jet Cyclone]"],[897905,"J","Volcanion ex [Scalding Steam | Scorching Cyclone]"],[897907,"J","Wooper [Scoop Water | Headbutt]"],[897908,"J","Quagsire [Rollout | Drenched Headbutt]"],[897911,"J","Dondozo ex [Avenging Billow | Dynamic Dive]"],[897920,"J","Okidogi ex [Poisonous Musculature | Chain-Crazed]"],[897923,"J","Dudunsparce ex [Tenacious Tail | Destructive Drill]"],[897933,"J","Rabsca ex [Upside Down Draw | Psychic]"],[902018,"J","Eevee [Boosted Evolution | Reckless Charge]"],[903177,"J","Gengar ex [Gnawing Curse | Tricky Steps]"]],"6381":[[863409,"V","Mega Emboar ex [Crimson Blast]"],[863433,"V","Scorbunny [Quick Attack]"],[863467,"V","Weavile [Slash | Hail Claw]"],[863559,"V","Vikavolt [Volt Switch | Sparking Strike]"],[863867,"V","Eevee [Boosted Evolution | Reckless Charge]"],[864047,"V","Scorbunny [Quick Attack]"],[864065,"V","Mega Feraligatr ex [Mortal Crunch]"],[864067,"V","Lillie's Clefairy ex [Fairy Zone | Full Moon Rondo]"],[864068,"V","Mega Charizard Y ex [Explosion Y]"]],"6391":[[868435,"J","Lillie's Determination"],[905267,"J","Paradise Resort"]],"6392":[[905265,"J","Paradise Resort"]],"6393":[[905264,"J","Paradise Resort"]],"6395":[[869753,"V","Fezandipiti ex [Flip the Script | Cruel Arrow]"],[869829,"V","Erika's Tangela [Gathering of Blossoms | Bind]"],[869833,"V","Ethan's Magcargo [Melt Away | Lava Burst]"],[869835,"V","Salazzle [Sudden Scorching | Flamethrower]"],[869837,"V","Psyduck [Damp | Ram]"],[869845,"V","Banette [Cursed Words | Spooky Shot]"],[869895,"V","Mega Gengar ex [Shadowy Concealment | Void Gale]"],[869899,"V","Fezandipiti ex [Flip the Script | Cruel Arrow]"]],"6409":[[861527,"J","Ethan's Pinsir [Vise Grip | Rallying Horn]"],[861537,"J","Cascoon [Trading Places]"],[861542,"J","Cynthia's Roserade [Cheer On to Glory | Leaf Step]"],[861561,"J","Entei [Flare Fall]"],[861577,"J","Charcadet [Will-O-Wisp]"],[861588,"J","N's Vanillish [Flop | Sheer Cold]"],[861604,"J","Tynamo [Hold Still]"],[861607,"J","Eelektrik [Dynamotor | Electric Ball]"],[861621,"J","Iono's Wattrel [Quick Attack]"],[861630,"J","Togetic [Draining Kiss]"],[861640,"J","Kirlia [Call Sign | Psyshot]"],[861644,"J","Dusclops [Cursed Blast | Will-O-Wisp]"],[861649,"J","Rotom [Roto Call | Gadget Show]"],[861677,"J","Riolu [Accelerating Stab]"],[861678,"J","Pancham [Reckless Charge]"],[861680,"J","Rolycoly [Mud-Slap]"],[861692,"J","Team Rocket's Murkrow [Deceit | Torment]"],[861704,"J","Cynthia's Spiritomb [Raging Curse]"],[861708,"J","N's Zorua [Scratch]"],[861716,"J","Bisharp [Rapid Draw]"],[861725,"J","Dratini [Headbutt]"],[861736,"J","Noivern [Agility | Enhanced Blade]"],[861752,"J","Bouffalant [Curly Wall | Boundless Power]"],[861753,"J","Bouffalant [Curly Wall | Boundless Power]"]],"6427":[[868096,"V","Clefairy [Follow Me | Flop]"]],"6442":[[867560,"J","Basic Fire Energy"],[867583,"J","Basic Psychic Energy"],[867602,"J","Basic Lightning Energy"]],"6443":[[877511,"V","Clefairy [Follow Me | Flop]"],[877512,"V","Espurr [Nap | Stampede]"],[877540,"V","Rosa's Encouragement"]],"6494":[[877317,"V","Ampharos [Synchro Pulse | Flashing Bolt]"]],"6509":[[875476,"J","Potion"],[875478,"J","Potion"],[875482,"J","Switch"],[875485,"J","Pokédex"],[875488,"J","Poké Ball"],[875489,"J","Grass Energy"],[875490,"J","Fighting Energy"],[875491,"J","Fire Energy"],[875492,"J","Lightning Energy"],[875493,"J","Water Energy"],[875494,"J","Psychic Energy"]],"6510":[[875526,"J","Potion"],[875538,"J","Water Energy"],[875539,"J","Psychic Energy"],[875540,"J","Fire Energy"],[875542,"J","Lightning Energy"],[875543,"J","Grass Energy"],[875544,"J","Fighting Energy"]],"6517":[[886482,"V","Ampharos [Synchro Pulse | Flashing Bolt]"],[886511,"V","Mega Dragalge ex [Corrosive Liquid | Pernicious Poison]"],[886513,"V","AZ's Tranquility"]],"6549":[[881855,"J","Basic Water Energy"],[886873,"J","Kangaskhan GX [Split Spiral Punch | Enraged Strike | Familia"],[886874,"J","Wishful Baton"],[886875,"J","Grimsley"],[886876,"J","Dark City"],[886877,"J","Counter Energy"],[886878,"J","Mawile GX [Captivating Wink | Wily Bite | Big Eater GX]"],[886879,"J","Jirachi [Stellar Wish | Slap]"],[886880,"J","Kartana GX [Slice Off | Gale Blade | Blade GX]"],[886881,"J","Dusk Mane Necrozma [Dusk Shot | Rusty Claws]"],[886882,"J","Rayquaza [Turbo Storm | Dragon Claw]"],[886883,"J","Celesteela GX [Force Canceler | Power Cyclone | Discovery GX"],[886884,"J","Rescue Stretcher"],[886885,"J","Metal Frying Pan"],[886886,"J","Choice Band"],[886887,"J","Apricorn Maker"]],"6556":[[888630,"V","Primarina [Enriching Melody | Aqua Return]"]],"6569":[[895872,"V","Primarina [Enriching Melody | Aqua Return]"]],"6581":[[887673,"J","Zinnia"],[887674,"J","Wicke"],[887675,"J","Tate & Liza"],[887676,"J","Pokémon Fan Club"],[887677,"J","Pokémon Breeder"],[887678,"J","Mars"],[887679,"J","Sophocles"],[887680,"J","Mallow"],[887681,"J","Crasher Wake"],[887682,"J","Bill's Maintenance"],[887683,"J","Morty"],[887684,"J","Mina"],[887685,"J","Jasmine"],[887686,"J","Copycat"],[887687,"J","Hiker"],[887688,"J","Lillie"],[887689,"J","Lusamine"],[887690,"J","Wela Volcano Park"],[887691,"J","Sea of Nothingness"],[887692,"J","Aether Paradise Conservation Area"],[887693,"J","Altar of the Moone"],[887694,"J","Brooklet Hill"],[887695,"J","Sky Pillar"],[887696,"J","Altar of the Sunne"],[887697,"J","Po Town"],[887698,"J","Mount Lanakila"],[887699,"J","Double Colorless Energy"],[887702,"J","Diantha"],[887703,"J","Underground Expedition"],[887704,"J","Wicke"],[887705,"J","Morty"],[887708,"J","Switch Raft"],[887709,"J","Crushing Hammer"],[887710,"J","Super Scoop Up"],[887711,"J","Rotom Dex"]],"6602":[[909512,"J","Mew [Psychic | 30C]"],[909513,"J","Mew [Psychic | 30C]"],[909514,"J","Mew [Psychic | 30C]"]],"6603":[[908297,"J","Kommo-o [Blazing Uppercut]"],[908306,"J","Mewtwo ex [Photon Bullets | Psychic Powers]"],[908307,"J","Mew ex [Memory Helix | Teleportation Burst]"],[908309,"J","Gengar ex [Fainting Spell | Chaotic Pain]"],[909518,"J","Mew [Psychic | 30C]"],[909519,"J","Mew [Psychic | 30C]"],[909520,"J","Mew [Psychic | 30C]"]],"6604":[[909515,"J","Mew [Psychic | 30C]"],[909516,"J","Mew [Psychic | 30C]"],[909517,"J","Mew [Psychic | 30C]"]],"6634":[[902458,"J","Basic Water Energy"],[902459,"J","Basic Lightning Energy"]],"6672":[[899549,"J","Champions Festival [Duckboat]"]],"6673":[[899808,"J","Charizard V [Claw Slash | Fire Spin]"],[899809,"J","Vulpix [Flare]"],[899810,"J","Ninetales [Flame Cloak | Fire Mane]"],[899811,"J","Magmar [Punch | Heat Breath]"],[899812,"J","Victini [Quick Draw | Combustion]"],[899813,"J","Turtonator [Tackle | Fire Spin]"],[899814,"J","Scorbunny [Tackle | Flare]"],[899815,"J","Raboot [Kick | Heat Blast]"],[899816,"J","Cinderace [Pyro Ball | Burning Kick]"],[899824,"J","Krabby [Super Slice]"],[899825,"J","Wingull [Collect | Wave Splash]"],[899827,"J","Buizel [Rain Splash]"],[899828,"J","Floatzel [Surf]"],[899829,"J","Bruxish [Bite | Surf]"],[899830,"J","Sobble [Pound | Water Gun]"],[899831,"J","Drizzile [Rain Splash | Wave Splash]"],[899832,"J","Inteleon [Silent Shot | Hydro Snipe]"],[899834,"J","Voltorb [Continuous Tumble]"],[899835,"J","Electabuzz [Knuckle Punch | Electroslug]"],[899836,"J","Electrike [Collect | Bite]"],[899837,"J","Joltik [Flop]"],[899840,"J","Galvantula [Volt Wave]"],[899841,"J","Yamper [Bite | Zap Kick]"],[899843,"J","Boltund [Bite | Electrodash]"],[899844,"J","Morpeko [Attack the Wound]"],[899845,"J","Potion"],[899847,"J","Crushing Hammer"],[899848,"J","Evolution Incense"],[899849,"J","Switch"],[899850,"J","Pokémon Catcher"],[899851,"J","Poké Ball"],[899852,"J","Shauna"],[899853,"J","Bede"],[899855,"J","Hop"],[900013,"J","Throh [Lunge Out | Seismic Toss]"],[900014,"J","Heatran [Guard Claw | Iron Hammer]"],[900015,"J","Castform [Double Draw | Hurricane]"],[900016,"J","Exeggcute [Ram | Seed Bomb]"],[900017,"J","Magmar [Low Kick | Fiery Punch]"],[900018,"J","Empoleon [Emergency Surfacing | Water Arrow]"],[900019,"J","Sigilyph [Tri Recharge | Psychic]"],[900020,"J","Riolu [Low Kick]"],[900021,"J","Lucario [Roaring Resolve | Aura Sphere Volley]"],[900022,"J","Grimer [Poison Gas]"],[900023,"J","Minccino [Call for Family | Pound]"],[900024,"J","Raichu V [Fast Charge | Dynamic Spark]"],[900025,"J","Flygon V [Sand Spray | Draconic Impulse]"],[900026,"J","Turtwig [Bite | Headbutt Bounce]"],[900027,"J","Chimchar [Ember]"],[900028,"J","Piplup [Bubble]"],[900031,"J","Dark Sylveon V [Disarming Voice | Tricky Ribbon]"],[900032,"J","Bulbasaur [Vine Whip | Razor Leaf]"],[900033,"J","Charmander [Tail on Fire]"],[900035,"J","Pikachu [Gift Delivery | Pika Ball]"],[900037,"J","Kricketot [Trip Over]"],[900038,"J","Hisuian Lilligant V [Dance Gracefully | Leaf Step]"],[900039,"J","Hisuian Basculin [Submerge Silently | Bite]"],[900040,"J","Togetic [Voice of Happiness | Fairy Wind]"],[900041,"J","Cranidos [Ram | Stone Edge]"],[900042,"J","Kleavor V [Cut | Axe Slash]"],[900043,"J","Ursaluna V [Hard Coat | Peat Shoulder]"],[900044,"J","Pawniard [Reckless Charge]"],[900045,"J","Switch Cart"],[900046,"J","Feather Ball"],[900047,"J","Professor Laventon"],[900048,"J","Temple of Sinnoh"],[900049,"J","Origin Forme Palkia V [Rule the Region | Hydro Break]"],[900050,"J","Origin Forme Dialga V [Metal Coating | Temporal Rupture]"],[900051,"J","Pikachu [Pika Dash | Whimsy Tackle]"],[900052,"J","Hisuian Goodra V [Slip-'n'-Trip | Rolling Shell]"],[900053,"J","Hisuian Zoroark V [Void Return | Shadow Cyclone]"],[900054,"J","Sunkern [Seed Bomb]"],[900055,"J","Seel [Headbutt | Wave Splash]"],[900056,"J","Kyogre V [Dual Splash | Aqua Typhoon]"],[900057,"J","Kyurem V [Rapid Freeze | Frost Smash]"],[900058,"J","Eelektrik [Ad Hoc Shock | Static Shock]"],[900059,"J","Enamorus [Draining Kiss | Loving Sympathy]"],[900060,"J","Drapion V [Wild Style | Dynamic Tail]"],[900061,"J","Metang [Bullet Punch | 299]"],[900062,"J","Panic Mask"],[900063,"J","Digging Duo"],[900064,"J","Lady"],[900065,"J","Gift Energy"],[900066,"J","Aerodactyl V [Bite | Rock Crush]"],[900067,"J","Giratina V [Abyss Seeking | Shred]"],[900068,"J","Marnie"],[900069,"J","Marnie's Pride"],[900070,"J","Barry"],[900071,"J","Lucario V [Crushing Punch | Cyclone Kick]"],[900072,"J","Lucario VSTAR [Fighting Knuckle | Aura Star]"],[900073,"J","Manaphy [Pulling Currents | Aqua Bullet]"],[900074,"J","Charizard [Battle Sense | Royal Blaze]"],[900077,"J","Pikachu [Thunder Shock | Holiday Calendar]"],[900078,"J","Mewtwo [Life Sucker | Psyburn]"],[900079,"J","Eevee [Continuous Steps]"],[900080,"J","Snorlax [Heavy Impact]"],[900081,"J","Serperior V [Noble Light | Solar Beam]"],[900087,"J","Ponyta [Take Down]"],[900088,"J","Quagsire V [Unaware | Muddy Noggin]"],[900090,"J","Regieleki V [Switching Bolt | Lightning Wall]"],[900091,"J","Duosion [Cell Spear]"],[900092,"J","Pancham [Chop]"],[900093,"J","Galarian Meowth [Fasten Claws]"],[900094,"J","Regidrago V [Celestial Roar | Dragon Laser]"],[900095,"J","Aerodactyl [Linear Attack | Jet Dive]"],[900096,"J","Hisuian Braviary [Battle Cry | Dual Cut]"],[900097,"J","Quad Stone"],[900098,"J","Peaceful Park"],[900100,"J","Regenerative Energy"],[900102,"J","Unown V [Shady Stamp | Victory Symbol]"],[900106,"J","Absol [Slash | Lost Claw]"],[900119,"J","Lugia V [Read the Wind | Aero Dive]"],[900120,"J","Lugia VSTAR [Tempest Dive | Summoning Star]"],[900125,"J","Champions Festival [Duckboat]"]],"6683":[[905266,"J","Paradise Resort"]],"6699":[[903618,"J","Celebi & Venusaur GX [Pollen Hazard | Solar Beam | Evergreen"],[903619,"J","Venusaur & Snivy GX [Shining Vine | Forest Dump | Solar Plan"],[903620,"J","Rowlet & Alolan Exeggutor GX [Super Growth | Calming Hurrica"],[903621,"J","Pheromosa & Buzzwole GX [Jet Punch | Elegant Sole | Beast Ga"],[903622,"J","Vileplume GX [Flagrant Flower Garden | Massive Bloom | Aller"],[903624,"J","Venomoth GX [Shinobi Mastery | Ten-Card Return GX]"],[903625,"J","Pikachu & Zekrom GX [Full Blitz | Tag Bolt GX]"],[903626,"J","Raichu & Alolan Raichu GX [Tandem Shock | Lightning Ride GX]"],[903627,"J","Dedenne GX [Dedechange | Static Shock | Tingly Return GX]"],[903628,"J","Muk & Alolan Muk GX [Severe Poison | Poison Absorption | Nas"],[903629,"J","Gengar & Mimikyu GX [Poltergeist | Horror House GX]"],[903630,"J","Mewtwo & Mew GX [Perfection | Miraculous Duo GX]"],[903631,"J","Trevenant & Dusknoir GX [Night Watch | Pale Moon GX]"],[903632,"J","Solgaleo & Lunala GX [Cosmic Burn | Light of the Protector G"],[903633,"J","Latios GX [Power Bind | Tag Purge | Clear Vision GX]"],[903634,"J","Oricorio GX [Dance of Tribute | Razor Wing | Strafe GX]"],[903635,"J","Lucario & Melmetal GX [Steel Fist | Heavy Impact | Full Meta"],[903636,"J","Mawile GX [Captivating Wink | Wily Bite | Big Eater GX]"],[903637,"J","Togepi & Cleffa & Igglybuff GX [Rolling Panic | Supreme Puff"],[903638,"J","Gardevoir & Sylveon GX [Fairy Song | Kaleidostorm | Magical "],[903639,"J","Whimsicott GX [Fluffy Cotton | Energy Blow | Toy Box GX]"],[903640,"J","Latias & Latios GX [Buster Purge | Aero Unit GX]"],[903641,"J","Garchomp & Giratina GX [Linear Attack | Calamitous Slash | G"],[903642,"J","Dragonite GX [Dragon Claw | Sky Judgment | Mach Delivery GX]"],[903644,"J","Naganadel GX [Ultra Conversion | Venom Shot | Injection GX]"],[903645,"J","Mega Lopunny & Jigglypuff GX [Jumping Balloon | Puffy Smashe"],[903646,"J","Celesteela GX [Force Canceler | Power Cyclone | Discovery GX"],[903647,"J","Judge Whistle"],[903648,"J","Lana's Fishing Rod"],[903649,"J","Electromagnetic Radar"],[903650,"J","Cherish Ball"],[903652,"J","Pokégear 3.0"],[903653,"J","Lillie's Poké Doll"],[903654,"J","Giant Bomb"],[903655,"J","Beast Bringer"],[903657,"J","Metal Core Barrier"],[903659,"J","Shrine of Punishment"],[903661,"J","Aether Paradise Conservation Area"],[903662,"J","Mt. Coronet"],[903663,"J","Viridian Forest"],[903664,"J","Draw Energy"],[903665,"J","Recycle Energy"],[903744,"J","Weavile [Nasty Plot | Slashing Claw]"],[903745,"J","Excadrill [Eleventh Hour Tackle | Drill Bazooka]"],[903746,"J","Stoutland [Arf Arf Bark | Overrun]"],[903837,"J","Reshiram & Charizard GX [Outrage | Flare Strike | Double Bla"],[903838,"J","Charizard & Braixen GX [Brilliant Flare | Crimson Flame Pill"],[903839,"J","Heatran GX [Burning Road | Steaming Stomp | Hot Burn GX]"],[903840,"J","Volcarona GX [Flaming Shot | Backfire | Massive Heat Wave GX"],[903841,"J","Blastoise & Piplup GX [Splash Maker | Bubble Launcher GX]"],[903842,"J","Slowpoke & Psyduck GX [Ditch and Splash | Thrilling Times GX"],[903843,"J","Magikarp & Wailord GX [Super Splash | Towering Splash GX]"],[903844,"J","Blastoise GX [Solid Shell | Rocket Splash | Giant Geyser GX]"],[903845,"J","Keldeo GX [Pure Heart | Sonic Edge | Resolute Blade GX]"],[903846,"J","Wishiwashi GX [School Storm | Massive Catch GX]"],[903847,"J","Marshadow & Machamp GX [Revenge | Hundred-Blows Impact | Acm"],[903848,"J","Aerodactyl GX [Primal Winds | Boulder Crush | Wild Dive GX]"],[903849,"J","Flygon GX [Dusty Defense | Desert Hurricane | Sonic Edge GX]"],[903850,"J","Mega Sableye & Tyranitar GX [Greedy Crush | Gigafall GX]"],[903851,"J","Greninja & Zoroark GX [Dark Pulse | Dark Union GX]"],[903852,"J","Alolan Persian GX [Smug Face | Claw Slash | Stalking Claws G"],[903853,"J","Honchkrow GX [Ruler of the Night | Feather Storm | Unfair GX"],[903854,"J","Arceus & Dialga & Palkia GX [Ultimate Ray | Altered Creation"],[903855,"J","Reshiram & Zekrom GX [Fabled Flarebolts | Cross Break GX]"],[903856,"J","Naganadel & Guzzlord GX [Violent Appetite | Jet Pierce | Cha"],[903857,"J","Eevee & Snorlax GX [Cheer Up | Dump Truck Press | Megaton Fr"],[903858,"J","Moltres & Zapdos & Articuno GX [Trinity Burn | Sky Legends G"],[903859,"J","Persian GX [Cat Walk | Vengeance | Slash Back GX]"],[903860,"J","Silvally GX [Disk Reload | Brave Buddies | Silver Knight GX]"],[903861,"J","Great Catcher"],[903862,"J","Tag Call"],[903863,"J","Tag Switch"],[903864,"J","Fire Crystal"],[903865,"J","Pokémon Communication"],[903866,"J","Reset Stamp"],[903867,"J","Karate Belt"],[903868,"J","Island Challenge Amulet"],[903869,"J","U-Turn Board"],[903870,"J","Martial Arts Dojo"],[903871,"J","Giant Hearth"],[903872,"J","Brooklet Hill"],[903873,"J","Power Plant"],[903874,"J","Weakness Guard Energy"],[903875,"J","Triple Acceleration Energy"]],"6700":[[910036,"J","Shiftry GX [Perplex | Extrasensory | Den of Iniquity GX]"],[910037,"J","Zekrom GX [Bullet Uppercut | Swift Bolt Strike | Rampage Bol"],[910038,"J","Zeraora GX [Thunderclap Zone | Plasma Fists | Full Voltage G"],[910039,"J","Mr. Mime GX [Magic Evens | Breakdown | Life Trick GX]"],[910040,"J","Banette GX [Shady Move | Shadow Chant | Tomb Hunt GX]"],[910041,"J","Sigilyph GX [Mirror Counter | Sonic Wing | Intercept GX]"],[910042,"J","Yveltal GX [Absorb Vitality | Sonic Evil | Doom Count GX]"],[910043,"J","Altaria GX [Bright Tone | Sonic Edge | Euphoria GX]"],[910044,"J","Rayquaza GX [Stormy Winds | Dragon Break | Tempest GX]"],[910045,"J","Palkia GX [Spatial Control | Hydro Pressure | Zero Vanish GX"],[910046,"J","White Kyurem GX [Shred | Raging Blade | Dragon Nova GX]"],[910047,"J","Net Ball"],[910048,"J","Mysterious Treasure"],[910049,"J","Lost Blender"],[910050,"J","Choice Helmet"],[910051,"J","Spell Tag"],[910052,"J","Hustle Belt"],[910053,"J","Dragon Talon"],[910054,"J","Unit Energy [GRW]"],[910113,"J","Magcargo GX [Crushing Charge | Lava Flow | Burning Magma GX]"],[910114,"J","Blaziken GX [Slash | Explosive Kick | Blaze Out GX]"],[910115,"J","Reshiram GX [Flame Charge | Scorching Collumn | Vermillion G"],[910117,"J","Articuno GX [Legendary Ascent | Ice Wing | Cold Crush GX]"],[910118,"J","Suicune GX [Phantom Winds | Cure Stream | Brinicle GX]"],[910119,"J","Palkia GX [Spatial Control | Hydro Pressure | Zero Vanish GX"],[910120,"J","Zygarde GX [Cell Connector | Land's Wrath | Verdict GX]"],[910122,"J","Scizor GX [Danger Perception | Steel Wing | Cross-Cut GX]"],[910123,"J","Cobalion GX [Metal Symbol | Dueling Saber | Iron Rule GX]"],[910125,"J","Genesect GX [Double Drive | Burst Shot | Break Buster GX]"],[910126,"J","Alolan Ninetales GX [Mysterious Guidance | Snowy Wind | Subl"],[910127,"J","Mimikyu GX [Perplex | Let's Snuggle & Fall | Dream Fear GX]"],[910129,"J","Eneporter"],[910130,"J","Custom Catcher"],[910132,"J","Acro Bike"],[910133,"J","Life Herb"],[910134,"J","Adventure Bag"],[910136,"J","Missing Clover"],[910137,"J","Rainbow Brush"]]};

  // idProduct → { e: idExpansion, k: 'J' | 'V', n: nom } ; une « galerie parcourue » ne compte que si elle l'a été après la mesure.
  const CIBLE = new Map();
  for (const [e, l] of Object.entries(CIBLES)) for (const [id, k, n] of l) CIBLE.set(id, { e: Number(e), k, n });
  const MESURE_LISTE = Date.parse('2026-09-25T04:56:00Z');

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

  // ===== Lecture de la page (inchangée depuis 1.3 : même logique que scraperListeExpansion) =====
  function lireCartesDeLaPage() {
    const cartes = [];
    document.querySelectorAll('a.galleryBox').forEach(a => {
      const img = a.querySelector('img');
      const src = (img && (img.getAttribute('data-echo') || img.getAttribute('src'))) || '';
      const mImg = src.match(/\/(\d+)\/(\d+)\.jpg/i);
      if (!mImg) return;
      const idProduct = parseInt(mImg[1], 10);
      if (!idProduct) return;
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
      const mVar = dernierSegment.match(/-(V\d+)-/i);
      cartes.push({ idProduct, numero, codeSet, nomFr, variante: mVar ? mVar[1].toUpperCase() : null, slug: dernierSegment || null, slugSet });
    });
    return cartes;
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
      for (const c of it.cartes) parId.set(c.idProduct, c);
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
    for (const it of items) faites[it.cle] = { le: Date.now(), n: it.cartes.length, ...(c.ignorees != null ? { v: 17 } : {}) };
    const cles = Object.keys(faites); if (cles.length > 3000) for (const k of cles.sort((a, b) => faites[a].le - faites[b].le).slice(0, cles.length - 3000)) delete faites[k];
    garder('rm_pagesFaites', faites);
    // Une cible n'est faite qu'ENVOYÉE AVEC SUCCÈS : le serveur l'a apprise (J) ou a complété son slug (V).
    const ciblesFaites = lire('rm_ciblesFaites', {});
    for (const it of items) for (const x of it.cartes) if (CIBLE.has(x.idProduct)) ciblesFaites[x.idProduct] = Date.now();
    garder('rm_ciblesFaites', ciblesFaites);
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
  const pageApprise = m => !!m && (m.v >= 17 || cartesPage.some(c => c.numero));
  const marqueDeLaPage = () => { const m = lire('rm_pagesFaites', {})[ctx.cle]; return pageApprise(m) ? m : null; };
  // « Déjà apprise » ne se dit que d'une page apprise AVANT ce chargement — pas de celle qu'on vient d'envoyer.
  const faiteAvant = marqueDeLaPage();

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
    let h = `<div style="display:flex;justify-content:space-between;align-items:center"><b>🐀 Apprentissage</b>` +
      `<label style="font-size:11px;color:#aaa;cursor:pointer"><input id="rm-auto" type="checkbox" ${auto ? 'checked' : ''} style="vertical-align:middle"> auto</label></div>`;
    h += `<div style="color:#888;font-size:11px;margin:2px 0 6px">exp ${esc(id ?? '?')} · ${esc(ctx.slugSet)} · page ${ctx.page}${ctx.pages ? '/' + ctx.pages : ''} · ${cartesPage.length} cartes (${avecNum} numérotées)` +
      (avantPage ? ` · page précédente il y a ${Math.round((Date.now() - avantPage) / 1000)} s` : '') + '</div>';
    h += `<div style="font-size:12px;margin-bottom:6px">📋 Liste du 25/09 : ${rang >= 0 ? `<b>n° ${rang + 1}/${LISTE.length}</b> — ${esc(LISTE[rang][1])}` : 'expansion hors liste'} · ${faites} faite(s)` +
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
        (reste.length && cv && (cv.parcourue || cv.terminee) && cv.le >= MESURE_LISTE ? '<br><span style="color:#888;font-size:11px">galerie parcourue : ces cibles ne sont sur aucune de ses pages.</span>' : '') + '</div>';
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
      h += `<div>✅ ${c.nouvelles} nouvelles · ${c.ameliorees} améliorées · ${c.dejaExactes} déjà exactes${c.completees ? ` (${c.completees} complétées)` : ''}${sansNum}` +
        `${c.ignorees ? ` · <span style="color:#e6a23c">${c.ignorees} ignorées (ni numéro ni slug)</span>` : ''}</div>`;
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
      (file.length && !enCours ? '<button id="rm-vider" style="flex:1;padding:6px;background:#0c0c0e;color:#ccc;border:1px solid #555;border-radius:6px;cursor:pointer">Envoyer maintenant</button>' : '') + '</div>';
    panneau.innerHTML = h;
    panneau.querySelector('#rm-auto').addEventListener('change', e => { garder('rm_auto', e.target.checked); });
    panneau.querySelector('#rm-go').addEventListener('click', () => apprendreCettePage(true));
    const bv = panneau.querySelector('#rm-vider'); if (bv) bv.addEventListener('click', () => { bloque = null; vider(); });
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
