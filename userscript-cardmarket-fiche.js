// ==UserScript==
// @name         Rat-Market — Relevé passif fiches Cardmarket
// @namespace    rat-market
// @version      1.0
// @description  Trois boutons sur une fiche produit Cardmarket que TU ouvres : Tampon visible, Pas de tampon visible, Je ne sais pas. Au clic seulement, relève le titre, l'image AFFICHÉE (pixels du canvas) et ton verdict, et les envoie au récepteur LOCAL (127.0.0.1). Aucune requête vers un autre hôte, aucune navigation, aucun cookie.
// @match        https://www.cardmarket.com/*/Pokemon/Products/Singles/*
// @grant        GM_xmlhttpRequest
// @connect      127.0.0.1
// @run-at       document-idle
// @noframes
// ==/UserScript==

// ============================================================
// 1.0 — PASSIF PAR CONSTRUCTION (décision du testeur, 2026-10-17 : « userscript au clic sur les pages que j'ouvre moi-même, lecture de l'image et du titre affichés, aucune navigation
// automatique, aucune requête en plus »). Règle permanente : AUCUNE requête de notre part vers Cardmarket. Au chargement, ce script n'ajoute qu'un panneau ; au clic, il lit ce que la
// fiche AFFICHE déjà.
//
// LA LECTURE DES OCTETS — UNE voie, la même que le relevé Collectorviper : le canvas des pixels affichés (drawImage + toDataURL). AUCUNE requête : on ne crée jamais d'image à charger,
// on ne pose jamais d'attribut de CORS (cela ferait recharger l'image). Si l'image vient d'un autre hôte sans en-tête CORS, le canvas est « contaminé », toDataURL lève, et le relevé part
// avec pixels = null et pixelsMotif = « canvas-protege » : le titre, l'adresse de l'image, ses dimensions et TON verdict suffisent à ce que le témoin humain compte. RIEN D'AUTRE n'est tenté.
//
// LE TÉMOIN HUMAIN : le clic sur l'un des trois boutons fait le relevé ET porte le verdict (verdictTesteur). Le panneau dit quel tampon chercher pour CETTE adresse quand elle figure dans la
// liste embarquée des 128 (paire n°, V1 = la plus ancienne, V2 ; tampon Pokumon attendu). La liste est une DONNÉE (collecte-cartes/cm-passif-liste.json, recopiée ici par
// lister-adresses-cm-passif.js, un banc compare les deux) : ce n'est pas une requête. Une adresse hors liste est relevée quand même, marquée « hors des 64 » par le récepteur.
//
// Le seul réseau est UN appel GM_xmlhttpRequest, vers http://127.0.0.1:<PORT>/releve (recepteur-cardmarket-fiche.js) ; @connect 127.0.0.1 seul.
// ============================================================
(function () {
    'use strict';
    // LE PORT du récepteur : la valeur de `--port` de recepteur-cardmarket-fiche.js (défaut 8768).
    var PORT = 8768;
    var RECEPTEUR = 'http://127.0.0.1:' + PORT + '/releve';
    var HOTE_ATTENDU = 'www.cardmarket.com';
    var IMAGE_OCTETS_MAX = 2.5 * 1024 * 1024;      // octets d'image par relevé, = celui du récepteur
    var PREFIXE_PNG = 'data:image/png;base64,';
    var RE_FICHE = /^\/[a-z]{2}\/Pokemon\/Products\/Singles\/([A-Za-z0-9][A-Za-z0-9._-]*)\/([A-Za-z0-9][A-Za-z0-9._-]*)$/;
    var RE_PRODUIT = /\/(\d+)\/\1\.[A-Za-z]+$/;       // l'image d'une fiche : …/<idProduct>/<idProduct>.jpg
    var RE_ID = /^.*\/(\d+)\/\1\.[A-Za-z]+$/;

    // LISTE:DEBUT — générée par lister-adresses-cm-passif.js, ne pas éditer à la main (n° de paire, version, tampon, set, numéro)
    var LISTE = {
        'MEP-Black-Star-Promos/Meganium-V1-MEP001': { n: 1, v: 'V1', i: 851043, t: 'Staff', s: 'MEP-Black-Star-Promos', o: '001' },
        'MEP-Black-Star-Promos/Meganium-V2-MEP001': { n: 1, v: 'V2', i: 851044, t: 'Staff', s: 'MEP-Black-Star-Promos', o: '001' },
        'MEP-Black-Star-Promos/Inteleon-V1-MEP002': { n: 2, v: 'V1', i: 851045, t: 'Staff', s: 'MEP-Black-Star-Promos', o: '002' },
        'MEP-Black-Star-Promos/Inteleon-V2-MEP002': { n: 2, v: 'V2', i: 851046, t: 'Staff', s: 'MEP-Black-Star-Promos', o: '002' },
        'MEP-Black-Star-Promos/Alakazam-V1-MEP003': { n: 3, v: 'V1', i: 851047, t: 'Staff', s: 'MEP-Black-Star-Promos', o: '003' },
        'MEP-Black-Star-Promos/Alakazam-V2-MEP003': { n: 3, v: 'V2', i: 851048, t: 'Staff', s: 'MEP-Black-Star-Promos', o: '003' },
        'MEP-Black-Star-Promos/Lunatone-V1-MEP004': { n: 4, v: 'V1', i: 851049, t: 'Staff', s: 'MEP-Black-Star-Promos', o: '004' },
        'MEP-Black-Star-Promos/Lunatone-V2-MEP004': { n: 4, v: 'V2', i: 851050, t: 'Staff', s: 'MEP-Black-Star-Promos', o: '004' },
        'MEP-Black-Star-Promos/Ceruledge-V1-MEP014': { n: 5, v: 'V1', i: 857390, t: 'Staff', s: 'MEP-Black-Star-Promos', o: '014' },
        'MEP-Black-Star-Promos/Ceruledge-V2-MEP014': { n: 5, v: 'V2', i: 859014, t: 'Staff', s: 'MEP-Black-Star-Promos', o: '014' },
        'MEP-Black-Star-Promos/Zacian-V1-MEP015': { n: 6, v: 'V1', i: 857393, t: 'Staff', s: 'MEP-Black-Star-Promos', o: '015' },
        'MEP-Black-Star-Promos/Zacian-V2-MEP015': { n: 6, v: 'V2', i: 859015, t: 'Staff', s: 'MEP-Black-Star-Promos', o: '015' },
        'MEP-Black-Star-Promos/Flygon-V1-MEP016': { n: 7, v: 'V1', i: 857396, t: 'Staff', s: 'MEP-Black-Star-Promos', o: '016' },
        'MEP-Black-Star-Promos/Flygon-V2-MEP016': { n: 7, v: 'V2', i: 859016, t: 'Staff', s: 'MEP-Black-Star-Promos', o: '016' },
        'MEP-Black-Star-Promos/Toxtricity-V1-MEP017': { n: 8, v: 'V1', i: 857400, t: 'Staff', s: 'MEP-Black-Star-Promos', o: '017' },
        'MEP-Black-Star-Promos/Toxtricity-V2-MEP017': { n: 8, v: 'V2', i: 859018, t: 'Staff', s: 'MEP-Black-Star-Promos', o: '017' },
        'MEP-Black-Star-Promos/Serperior-V1-MEP064': { n: 9, v: 'V1', i: 877543, t: 'Staff', s: 'MEP-Black-Star-Promos', o: '064' },
        'MEP-Black-Star-Promos/Serperior-V2-MEP064': { n: 9, v: 'V2', i: 879303, t: 'Staff', s: 'MEP-Black-Star-Promos', o: '064' },
        'MEP-Black-Star-Promos/Barbaracle-V1-MEP065': { n: 10, v: 'V1', i: 877544, t: 'Staff', s: 'MEP-Black-Star-Promos', o: '065' },
        'MEP-Black-Star-Promos/Barbaracle-V2-MEP065': { n: 10, v: 'V2', i: 879305, t: 'Staff', s: 'MEP-Black-Star-Promos', o: '065' },
        'MEP-Black-Star-Promos/Tyrantrum-V1-MEP066': { n: 11, v: 'V1', i: 877545, t: 'Staff', s: 'MEP-Black-Star-Promos', o: '066' },
        'MEP-Black-Star-Promos/Tyrantrum-V2-MEP066': { n: 11, v: 'V2', i: 879315, t: 'Staff', s: 'MEP-Black-Star-Promos', o: '066' },
        'MEP-Black-Star-Promos/Doublade-V1-MEP067': { n: 12, v: 'V1', i: 877546, t: 'Staff', s: 'MEP-Black-Star-Promos', o: '067' },
        'MEP-Black-Star-Promos/Doublade-V2-MEP067': { n: 12, v: 'V2', i: 879312, t: 'Staff', s: 'MEP-Black-Star-Promos', o: '067' },
        'MEP-Black-Star-Promos/Delphox-V1-MEP074': { n: 13, v: 'V1', i: 884752, t: 'Staff', s: 'MEP-Black-Star-Promos', o: '074' },
        'MEP-Black-Star-Promos/Delphox-V2-MEP074': { n: 13, v: 'V2', i: 884753, t: 'Staff', s: 'MEP-Black-Star-Promos', o: '074' },
        'MEP-Black-Star-Promos/Ampharos-V1-MEP075': { n: 14, v: 'V1', i: 884754, t: 'Staff', s: 'MEP-Black-Star-Promos', o: '075' },
        'MEP-Black-Star-Promos/Ampharos-V2-MEP075': { n: 14, v: 'V2', i: 884755, t: 'Staff', s: 'MEP-Black-Star-Promos', o: '075' },
        'MEP-Black-Star-Promos/Crobat-V1-MEP076': { n: 15, v: 'V1', i: 884756, t: 'Staff', s: 'MEP-Black-Star-Promos', o: '076' },
        'MEP-Black-Star-Promos/Crobat-V2-MEP076': { n: 15, v: 'V2', i: 884757, t: 'Staff', s: 'MEP-Black-Star-Promos', o: '076' },
        'MEP-Black-Star-Promos/Goodra-V1-MEP077': { n: 16, v: 'V1', i: 884758, t: 'Staff', s: 'MEP-Black-Star-Promos', o: '077' },
        'MEP-Black-Star-Promos/Goodra-V2-MEP077': { n: 16, v: 'V2', i: 884759, t: 'Staff', s: 'MEP-Black-Star-Promos', o: '077' },
        'MEP-Black-Star-Promos/Miraidon-MEP082': { n: 17, v: 'V1', i: 894261, t: 'Staff', s: 'MEP-Black-Star-Promos', o: '082' },
        'MEP-Black-Star-Promos/Miraidon-V2-MEP082': { n: 17, v: 'V2', i: 903005, t: 'Staff', s: 'MEP-Black-Star-Promos', o: '082' },
        'MEP-Black-Star-Promos/Slowbro-MEP083': { n: 18, v: 'V1', i: 894262, t: 'Staff', s: 'MEP-Black-Star-Promos', o: '083' },
        'MEP-Black-Star-Promos/Slowbro-V2-MEP083': { n: 18, v: 'V2', i: 903006, t: 'Staff', s: 'MEP-Black-Star-Promos', o: '083' },
        'MEP-Black-Star-Promos/Dhelmise-MEP084': { n: 19, v: 'V1', i: 894263, t: 'Staff', s: 'MEP-Black-Star-Promos', o: '084' },
        'MEP-Black-Star-Promos/Dhelmise-V2-MEP084': { n: 19, v: 'V2', i: 903007, t: 'Staff', s: 'MEP-Black-Star-Promos', o: '084' },
        'MEP-Black-Star-Promos/Bastiodon-MEP085': { n: 20, v: 'V1', i: 894264, t: 'Staff', s: 'MEP-Black-Star-Promos', o: '085' },
        'MEP-Black-Star-Promos/Bastiodon-V2-MEP085': { n: 20, v: 'V2', i: 903008, t: 'Staff', s: 'MEP-Black-Star-Promos', o: '085' },
        'SV-Black-Star-Promos/Mimikyu-ex-V1-SVPen004': { n: 21, v: 'V1', i: 701130, t: 'Play! Pokémon', s: 'SV-Black-Star-Promos', o: '004' },
        'SV-Black-Star-Promos/Mimikyu-ex-V2-SVPen004': { n: 21, v: 'V2', i: 701131, t: 'Play! Pokémon', s: 'SV-Black-Star-Promos', o: '004' },
        'SV-Black-Star-Promos/Quaquaval-V1-SVP005': { n: 22, v: 'V1', i: 692227, t: 'Staff', s: 'SV-Black-Star-Promos', o: '005' },
        'SV-Black-Star-Promos/Quaquaval-V2-SVP005': { n: 22, v: 'V2', i: 761119, t: 'Staff', s: 'SV-Black-Star-Promos', o: '005' },
        'SV-Black-Star-Promos/Pawmot-V1-SVP006': { n: 23, v: 'V1', i: 692228, t: 'Staff', s: 'SV-Black-Star-Promos', o: '006' },
        'SV-Black-Star-Promos/Pawmot-V2-SVP006': { n: 23, v: 'V2', i: 761120, t: 'Staff', s: 'SV-Black-Star-Promos', o: '006' },
        'SV-Black-Star-Promos/Hawlucha-V1-SVP007': { n: 24, v: 'V1', i: 692229, t: 'Staff', s: 'SV-Black-Star-Promos', o: '007' },
        'SV-Black-Star-Promos/Hawlucha-V2-SVP007': { n: 24, v: 'V2', i: 761121, t: 'Staff', s: 'SV-Black-Star-Promos', o: '007' },
        'SV-Black-Star-Promos/Revavroom-V1-SVP008': { n: 25, v: 'V1', i: 692230, t: 'Staff', s: 'SV-Black-Star-Promos', o: '008' },
        'SV-Black-Star-Promos/Revavroom-V2-SVP008': { n: 25, v: 'V2', i: 761122, t: 'Staff', s: 'SV-Black-Star-Promos', o: '008' },
        'SV-Black-Star-Promos/Cyclizar-ex-V1-SVPen018': { n: 26, v: 'V1', i: 703188, t: 'Play! Pokémon', s: 'SV-Black-Star-Promos', o: '018' },
        'SV-Black-Star-Promos/Cyclizar-ex-V2-SVPen018': { n: 26, v: 'V2', i: 703189, t: 'Play! Pokémon', s: 'SV-Black-Star-Promos', o: '018' },
        'SV-Black-Star-Promos/Baxcalibur-V1-SVP019': { n: 27, v: 'V1', i: 715467, t: 'Staff', s: 'SV-Black-Star-Promos', o: '019' },
        'SV-Black-Star-Promos/Baxcalibur-V2-SVP019': { n: 27, v: 'V2', i: 761123, t: 'Staff', s: 'SV-Black-Star-Promos', o: '019' },
        'SV-Black-Star-Promos/Tinkaton-V1-SVP020': { n: 28, v: 'V1', i: 715468, t: 'Staff', s: 'SV-Black-Star-Promos', o: '020' },
        'SV-Black-Star-Promos/Tinkaton-V2-SVP020': { n: 28, v: 'V2', i: 761124, t: 'Staff', s: 'SV-Black-Star-Promos', o: '020' },
        'SV-Black-Star-Promos/Murkrow-V1-SVP021': { n: 29, v: 'V1', i: 715469, t: 'Staff', s: 'SV-Black-Star-Promos', o: '021' },
        'SV-Black-Star-Promos/Murkrow-V2-SVP021': { n: 29, v: 'V2', i: 761125, t: 'Staff', s: 'SV-Black-Star-Promos', o: '021' },
        'SV-Black-Star-Promos/Pelipper-V1-SVP022': { n: 30, v: 'V1', i: 715470, t: 'Staff', s: 'SV-Black-Star-Promos', o: '022' },
        'SV-Black-Star-Promos/Pelipper-V2-SVP022': { n: 30, v: 'V2', i: 761126, t: 'Staff', s: 'SV-Black-Star-Promos', o: '022' },
        'SV-Black-Star-Promos/Palafin-V1-SVP036': { n: 31, v: 'V1', i: 720386, t: 'Staff', s: 'SV-Black-Star-Promos', o: '036' },
        'SV-Black-Star-Promos/Palafin-V2-SVP036': { n: 31, v: 'V2', i: 761127, t: 'Staff', s: 'SV-Black-Star-Promos', o: '036' },
        'SV-Black-Star-Promos/Cleffa-V1-SVP037': { n: 32, v: 'V1', i: 720387, t: 'Staff', s: 'SV-Black-Star-Promos', o: '037' },
        'SV-Black-Star-Promos/Cleffa-V2-SVP037': { n: 32, v: 'V2', i: 761128, t: 'Staff', s: 'SV-Black-Star-Promos', o: '037' },
        'SV-Black-Star-Promos/Togekiss-V1-SVP038': { n: 33, v: 'V1', i: 720388, t: 'Staff', s: 'SV-Black-Star-Promos', o: '038' },
        'SV-Black-Star-Promos/Togekiss-V2-SVP038': { n: 33, v: 'V2', i: 761129, t: 'Staff', s: 'SV-Black-Star-Promos', o: '038' },
        'SV-Black-Star-Promos/Mawile-V1-SVP039': { n: 34, v: 'V1', i: 720389, t: 'Staff', s: 'SV-Black-Star-Promos', o: '039' },
        'SV-Black-Star-Promos/Mawile-V2-SVP039': { n: 34, v: 'V2', i: 761130, t: 'Staff', s: 'SV-Black-Star-Promos', o: '039' },
        'SV-Black-Star-Promos/Paradise-Resort-V1-SVP045': { n: 35, v: 'V1', i: 726924, t: 'Staff', s: 'SV-Black-Star-Promos', o: '045' },
        'SV-Black-Star-Promos/Paradise-Resort-V2-SVP045': { n: 35, v: 'V2', i: 727542, t: 'Staff', s: 'SV-Black-Star-Promos', o: '045' },
        'SV-Black-Star-Promos/Chi-Yu-V1-SVP057': { n: 36, v: 'V1', i: 739441, t: 'Staff', s: 'SV-Black-Star-Promos', o: '057' },
        'SV-Black-Star-Promos/Chi-Yu-V2-SVP057': { n: 36, v: 'V2', i: 761131, t: 'Staff', s: 'SV-Black-Star-Promos', o: '057' },
        'SV-Black-Star-Promos/Iron-Bundle-V1-SVP058': { n: 37, v: 'V1', i: 739443, t: 'Staff', s: 'SV-Black-Star-Promos', o: '058' },
        'SV-Black-Star-Promos/Iron-Bundle-V4-SVP058': { n: 37, v: 'V2', i: 761132, t: 'Staff', s: 'SV-Black-Star-Promos', o: '058' },
        'SV-Black-Star-Promos/Xatu-V1-SVP059': { n: 38, v: 'V1', i: 739448, t: 'Staff', s: 'SV-Black-Star-Promos', o: '059' },
        'SV-Black-Star-Promos/Xatu-V2-SVP059': { n: 38, v: 'V2', i: 761133, t: 'Staff', s: 'SV-Black-Star-Promos', o: '059' },
        'SV-Black-Star-Promos/Aegislash-V1-SVP060': { n: 39, v: 'V1', i: 739449, t: 'Staff', s: 'SV-Black-Star-Promos', o: '060' },
        'SV-Black-Star-Promos/Aegislash-V2-SVP060': { n: 39, v: 'V2', i: 761134, t: 'Staff', s: 'SV-Black-Star-Promos', o: '060' },
        'SV-Black-Star-Promos/Feraligatr-V1-SVP089': { n: 40, v: 'V1', i: 760231, t: 'Staff', s: 'SV-Black-Star-Promos', o: '089' },
        'SV-Black-Star-Promos/Feraligatr-V2-SVP089': { n: 40, v: 'V2', i: 761135, t: 'Staff', s: 'SV-Black-Star-Promos', o: '089' },
        'SV-Black-Star-Promos/Metang-V1-SVP090': { n: 41, v: 'V1', i: 760232, t: 'Staff', s: 'SV-Black-Star-Promos', o: '090' },
        'SV-Black-Star-Promos/Metang-V2-SVP090': { n: 41, v: 'V2', i: 761136, t: 'Staff', s: 'SV-Black-Star-Promos', o: '090' },
        'SV-Black-Star-Promos/Koraidon-V1-SVP091': { n: 42, v: 'V1', i: 760233, t: 'Staff', s: 'SV-Black-Star-Promos', o: '091' },
        'SV-Black-Star-Promos/Koraidon-V2-SVP091': { n: 42, v: 'V2', i: 761137, t: 'Staff', s: 'SV-Black-Star-Promos', o: '091' },
        'SV-Black-Star-Promos/Miraidon-V1-SVP092': { n: 43, v: 'V1', i: 760234, t: 'Staff', s: 'SV-Black-Star-Promos', o: '092' },
        'SV-Black-Star-Promos/Miraidon-V2-SVP092': { n: 43, v: 'V2', i: 761138, t: 'Staff', s: 'SV-Black-Star-Promos', o: '092' },
        'SV-Black-Star-Promos/Thwackey-V1-SVP115': { n: 44, v: 'V1', i: 769411, t: 'Staff', s: 'SV-Black-Star-Promos', o: '115' },
        'SV-Black-Star-Promos/Thwackey-V2-SVP115': { n: 44, v: 'V2', i: 769412, t: 'Staff', s: 'SV-Black-Star-Promos', o: '115' },
        'SV-Black-Star-Promos/Infernape-V1-SVP116': { n: 45, v: 'V1', i: 769413, t: 'Staff', s: 'SV-Black-Star-Promos', o: '116' },
        'SV-Black-Star-Promos/Infernape-V2-SVP116': { n: 45, v: 'V2', i: 769414, t: 'Staff', s: 'SV-Black-Star-Promos', o: '116' },
        'SV-Black-Star-Promos/Froslass-V1-SVP117': { n: 46, v: 'V1', i: 769415, t: 'Staff', s: 'SV-Black-Star-Promos', o: '117' },
        'SV-Black-Star-Promos/Froslass-V2-SVP117': { n: 46, v: 'V2', i: 769416, t: 'Staff', s: 'SV-Black-Star-Promos', o: '117' },
        'SV-Black-Star-Promos/Tatsugiri-V1-SVP118': { n: 47, v: 'V1', i: 769417, t: 'Staff', s: 'SV-Black-Star-Promos', o: '118' },
        'SV-Black-Star-Promos/Tatsugiri-V2-SVP118': { n: 47, v: 'V2', i: 769418, t: 'Staff', s: 'SV-Black-Star-Promos', o: '118' },
        'SV-Black-Star-Promos/Ledian-V1-SVP133': { n: 48, v: 'V1', i: 785838, t: 'Staff', s: 'SV-Black-Star-Promos', o: '133' },
        'SV-Black-Star-Promos/Ledian-V2-SVP133': { n: 48, v: 'V2', i: 785839, t: 'Staff', s: 'SV-Black-Star-Promos', o: '133' },
        'SV-Black-Star-Promos/Crabominable-V1-SVP134': { n: 49, v: 'V1', i: 785840, t: 'Staff', s: 'SV-Black-Star-Promos', o: '134' },
        'SV-Black-Star-Promos/Crabominable-V2-SVP134': { n: 49, v: 'V2', i: 785841, t: 'Staff', s: 'SV-Black-Star-Promos', o: '134' },
        'SV-Black-Star-Promos/Drifblim-V1-SVP135': { n: 50, v: 'V1', i: 785842, t: 'Staff', s: 'SV-Black-Star-Promos', o: '135' },
        'SV-Black-Star-Promos/Drifblim-V2-SVP135': { n: 50, v: 'V2', i: 785843, t: 'Staff', s: 'SV-Black-Star-Promos', o: '135' },
        'SV-Black-Star-Promos/Bouffalant-V1-SVP136': { n: 51, v: 'V1', i: 785844, t: 'Staff', s: 'SV-Black-Star-Promos', o: '136' },
        'SV-Black-Star-Promos/Bouffalant-V2-SVP136': { n: 51, v: 'V2', i: 785845, t: 'Staff', s: 'SV-Black-Star-Promos', o: '136' },
        'SV-Black-Star-Promos/Paradise-Resort-V1-SVP150': { n: 52, v: 'V1', i: 783445, t: 'Staff', s: 'SV-Black-Star-Promos', o: '150' },
        'SV-Black-Star-Promos/Paradise-Resort-V2-SVP150': { n: 52, v: 'V2', i: 783446, t: 'Staff', s: 'SV-Black-Star-Promos', o: '150' },
        'SV-Black-Star-Promos/Gouging-Fire-V1-SVP151': { n: 53, v: 'V1', i: 793739, t: 'Staff', s: 'SV-Black-Star-Promos', o: '151' },
        'SV-Black-Star-Promos/Gouging-Fire-V2-SVP151': { n: 53, v: 'V2', i: 799711, t: 'Staff', s: 'SV-Black-Star-Promos', o: '151' },
        'SV-Black-Star-Promos/Chien-Pao-V1-SVP152': { n: 54, v: 'V1', i: 793742, t: 'Staff', s: 'SV-Black-Star-Promos', o: '152' },
        'SV-Black-Star-Promos/Chien-Pao-V2-SVP152': { n: 54, v: 'V2', i: 799712, t: 'Staff', s: 'SV-Black-Star-Promos', o: '152' },
        'SV-Black-Star-Promos/Magneton-V1-SVP153': { n: 55, v: 'V1', i: 793743, t: 'Staff', s: 'SV-Black-Star-Promos', o: '153' },
        'SV-Black-Star-Promos/Magneton-V2-SVP153': { n: 55, v: 'V2', i: 799713, t: 'Staff', s: 'SV-Black-Star-Promos', o: '153' },
        'SV-Black-Star-Promos/Indeedee-V1-SVP154': { n: 56, v: 'V1', i: 793744, t: 'Staff', s: 'SV-Black-Star-Promos', o: '154' },
        'SV-Black-Star-Promos/Indeedee-V2-SVP154': { n: 56, v: 'V2', i: 799714, t: 'Staff', s: 'SV-Black-Star-Promos', o: '154' },
        'SV-Black-Star-Promos/Ns-Darmanitan-V1-SVP181': { n: 57, v: 'V1', i: 816614, t: 'Staff', s: 'SV-Black-Star-Promos', o: '181' },
        'SV-Black-Star-Promos/Ns-Darmanitan-V2-SVP181': { n: 57, v: 'V2', i: 817772, t: 'Staff', s: 'SV-Black-Star-Promos', o: '181' },
        'SV-Black-Star-Promos/Ionos-Kilowattrel-V1-SVP182': { n: 58, v: 'V1', i: 816615, t: 'Staff', s: 'SV-Black-Star-Promos', o: '182' },
        'SV-Black-Star-Promos/Ionos-Kilowattrel-V2-SVP182': { n: 58, v: 'V2', i: 817773, t: 'Staff', s: 'SV-Black-Star-Promos', o: '182' },
        'SV-Black-Star-Promos/Lillies-Ribombee-V1-SVP183': { n: 59, v: 'V1', i: 816616, t: 'Staff', s: 'SV-Black-Star-Promos', o: '183' },
        'SV-Black-Star-Promos/Lillies-Ribombee-V2-SVP183': { n: 59, v: 'V2', i: 817774, t: 'Staff', s: 'SV-Black-Star-Promos', o: '183' },
        'SV-Black-Star-Promos/Hops-Snorlax-V1-SVP184': { n: 60, v: 'V1', i: 816617, t: 'Staff', s: 'SV-Black-Star-Promos', o: '184' },
        'SV-Black-Star-Promos/Hops-Snorlax-V2-SVP184': { n: 60, v: 'V2', i: 817775, t: 'Staff', s: 'SV-Black-Star-Promos', o: '184' },
        'SWSH-Black-Star-Promos/Galarian-Rapidash-V-V1': { n: 61, v: 'V1', i: 561771, t: 'Play! Pokémon', s: 'SWSH-Black-Star-Promos', o: '111' },
        'SWSH-Black-Star-Promos/Galarian-Rapidash-V-V2': { n: 61, v: 'V2', i: 561772, t: 'Play! Pokémon', s: 'SWSH-Black-Star-Promos', o: '111' },
        'SWSH-Black-Star-Promos/Leafeon-VSTAR-V1-SWSH195': { n: 62, v: 'V1', i: 604997, t: 'Play! Pokémon', s: 'SWSH-Black-Star-Promos', o: '195' },
        'SWSH-Black-Star-Promos/Leafeon-VSTAR-V2-SWSH195': { n: 62, v: 'V2', i: 605846, t: 'Play! Pokémon', s: 'SWSH-Black-Star-Promos', o: '195' },
        'SWSH-Black-Star-Promos/Glaceon-VSTAR-V1-SWSH197': { n: 63, v: 'V1', i: 604999, t: 'Play! Pokémon', s: 'SWSH-Black-Star-Promos', o: '197' },
        'SWSH-Black-Star-Promos/Glaceon-VSTAR-V2-SWSH197': { n: 63, v: 'V2', i: 605847, t: 'Play! Pokémon', s: 'SWSH-Black-Star-Promos', o: '197' },
        'SWSH-Black-Star-Promos/Champions-Festival-V1-SWSH296': { n: 64, v: 'V1', i: 671798, t: 'Staff', s: 'SWSH-Black-Star-Promos', o: '296' },
        'SWSH-Black-Star-Promos/Champions-Festival-V2-SWSH296': { n: 64, v: 'V2', i: 672087, t: 'Staff', s: 'SWSH-Black-Star-Promos', o: '296' }
    };
    // LISTE:FIN

    // ===== UI =====
    // Le panneau se construit par l'API DOM (createElement + textContent), jamais par une chaîne HTML.
    function noeud(balise, css, texte) {
        var n = balise === 'button' ? document.createElement('button') : document.createElement('div');   // littéraux seulement : la garde statique les lit
        n.style.cssText = css;
        if (texte) n.textContent = texte;
        return n;
    }
    var CSS_BOUTON = 'width:100%;padding:7px;margin-top:6px;background:#0c0c0e;color:#D4AF37;border:1px solid #D4AF37;border-radius:6px;cursor:pointer;font-weight:600';
    var panneau = noeud('div', 'position:fixed;bottom:16px;right:16px;z-index:2147483647;background:#0d0d10;color:#eee;font:13px system-ui,sans-serif;padding:12px 14px;border:1px solid #D4AF37;border-radius:10px;box-shadow:0 4px 16px rgba(0,0,0,.4);width:320px');
    panneau.appendChild(noeud('div', 'font-weight:600;margin-bottom:2px', '🐀 Relever cette fiche'));
    panneau.appendChild(noeud('div', 'color:#888;font-size:11px;margin-bottom:8px', 'Cardmarket · relevé local, pixels affichés, aucune requête vers le site'));
    var consigne = noeud('div', 'line-height:1.4;margin-bottom:4px');
    var b1 = noeud('button', CSS_BOUTON, 'Tampon visible');
    var b2 = noeud('button', CSS_BOUTON, 'Pas de tampon visible');
    var b3 = noeud('button', CSS_BOUTON, 'Je ne sais pas');
    var msg = noeud('div', 'margin-top:8px;min-height:16px;color:#bbb;line-height:1.4;white-space:pre-wrap');
    panneau.appendChild(consigne);
    panneau.appendChild(b1);
    panneau.appendChild(b2);
    panneau.appendChild(b3);
    panneau.appendChild(msg);
    document.body.appendChild(panneau);
    function dire(texte, couleur) { msg.style.color = couleur || '#bbb'; msg.textContent = texte; }

    // ===== Ce que la page est =====
    function cleDePage() {
        var chemin = String(location.pathname || '');
        return RE_FICHE.test(chemin) ? chemin.replace(RE_FICHE, '$1/$2') : '';
    }
    function paireDePage() {
        var cle = cleDePage();
        return cle && LISTE[cle] ? LISTE[cle] : null;
    }
    function annoncer() {
        var cle = cleDePage();
        var p = paireDePage();
        if (location.hostname !== HOTE_ATTENDU || !cle) {
            consigne.textContent = 'Ce n\'est pas une fiche produit : rien ne sera lu ni envoyé.';
        } else if (p) {
            consigne.textContent = 'Paire n°' + p.n + ' · ' + p.s + ' ' + p.o + ' · version ' + p.v + '\nCherche le tampon « ' + p.t + ' » sur l\'image : une des deux versions de la paire le porte. Puis clique la réponse qui correspond à ce que tu vois.';
        } else {
            consigne.textContent = 'Cette fiche est hors des 64 paires : le relevé part quand même, marqué « hors des 64 ». Regarde l\'image, puis clique la réponse qui correspond.';
        }
        dire('Rien n\'est lu ni envoyé avant ton clic. Laisse l\'image se charger, puis clique une fois.');
    }
    annoncer();

    // ===== Envoi au récepteur local =====
    function poster(objet) {
        return new Promise(function (resoudre, rejeter) {
            GM_xmlhttpRequest({
                method: 'POST',
                url: RECEPTEUR,
                headers: { 'Content-Type': 'application/json', 'X-Rat-Market': 'rat-market-passif' },
                data: JSON.stringify(objet),
                anonymous: true,
                timeout: 60000,
                redirect: 'error',
                onload: function (r) {
                    var j = null;
                    try { j = JSON.parse(r.responseText); } catch (e) { j = null; }
                    resoudre({ status: r.status, json: j });
                },
                onerror: function () { rejeter({ reseau: 'erreur' }); },
                ontimeout: function () { rejeter({ reseau: 'delai' }); }
            });
        });
    }

    // ===== Le relevé : ce que la page AFFICHE =====
    function normaliser(t) { return String(t == null ? '' : t).replace(/\s+/g, ' ').trim(); }
    function bornee(t, max) { return normaliser(t).slice(0, max); }
    function paquetId() {
        var d = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, ''), h = '';
        for (var i = 0; i < 8; i++) h += '0123456789abcdef'.charAt(Math.floor(Math.random() * 16));
        return d + '-' + h;
    }
    function adresseDe(img) {
        var a = String(img.currentSrc || img.src || '');
        return /^https:\/\/\S+$/.test(a) && a.length <= 2000 ? a : '';
    }
    // L'image principale. Adresse DE LA LISTE (idProduct attendu connu) : seule l'image dont le chemin porte /<idProduct attendu>/ est retenue, aucune autre ne gagne par la taille ;
    // absente, il n'y a pas d'image. Adresse hors liste (idAttendu null) : celle qui porte la forme …/<id>/<id>.jpg, sinon la plus grande d'au moins 150 px.
    function principale(imgs, idAttendu) {
        var meilleure = null, score = -1;
        for (var i = 0; i < imgs.length; i++) {
            var img = imgs[i], a = adresseDe(img), produit = RE_PRODUIT.test(a);
            var w = img.naturalWidth | 0, h = img.naturalHeight | 0;
            var s = w * h + (produit ? 1000000000 : 0);
            var admise = idAttendu ? a.indexOf('/' + idAttendu + '/') >= 0 : (produit || (w >= 150 && h >= 150));
            if (admise && s > score) { meilleure = img; score = s; }
        }
        return meilleure;
    }
    // Lit les pixels DÉJÀ affichés. Un échec du canvas est dit, jamais contourné : une seule tentative.
    function lirePixels(img) {
        if (!img) return { pixels: null, mime: null, motif: 'aucune-image' };
        if (!img.complete || !img.naturalWidth || !img.naturalHeight) return { pixels: null, mime: null, motif: 'image-non-chargee' };
        try {
            var toile = document.createElement('canvas');
            toile.width = img.naturalWidth; toile.height = img.naturalHeight;
            toile.getContext('2d').drawImage(img, 0, 0);
            var url = toile.toDataURL('image/png');
            if (typeof url !== 'string' || url.indexOf(PREFIXE_PNG) !== 0) return { pixels: null, mime: null, motif: 'canvas-protege' };
            var b64 = url.slice(PREFIXE_PNG.length);
            if (b64.length * 3 / 4 > IMAGE_OCTETS_MAX) return { pixels: null, mime: null, motif: 'trop-volumineuse' };
            return { pixels: b64, mime: 'image/png', motif: null };
        } catch (e) {
            return { pixels: null, mime: null, motif: 'canvas-protege' };   // canvas contaminé : aucune autre tentative
        }
    }
    function idProduitDe(adresse) {
        var id = adresse.replace(RE_ID, '$1');
        return /^\d{1,8}$/.test(id) ? Number(id) : null;
    }
    function dernierMot(motif) {
        if (motif === 'canvas-protege') return 'Les pixels de l\'image sont protégés par le navigateur : le relevé part sans image (rien d\'autre n\'est tenté), avec ton verdict.';
        if (motif === 'image-non-chargee') return 'L\'image n\'était pas encore chargée : le relevé part sans image, avec ton verdict.';
        if (motif === 'aucune-image') return 'Aucune image de produit trouvée sur la page : le relevé part sans image, avec ton verdict.';
        if (motif === 'trop-volumineuse') return 'L\'image est trop volumineuse pour un envoi : le relevé part sans image, avec ton verdict.';
        return 'Image relevée.';
    }

    // ===== Le clic (un des trois boutons) =====
    function releve(verdict) {
        var cle = cleDePage();
        if (location.hostname !== HOTE_ATTENDU || !cle) {
            dire('Ce n\'est pas une fiche produit de ' + HOTE_ATTENDU + ' : rien n\'est lu ni envoyé.', '#e6a23c');
            return;
        }
        var boutons = [b1, b2, b3];
        function fini() { boutons.forEach(function (b) { b.disabled = false; b.style.opacity = '1'; }); }
        boutons.forEach(function (b) { b.disabled = true; b.style.opacity = '.6'; });
        var h1 = document.querySelector('h1');
        var titre = bornee(h1 ? h1.textContent : '', 300);
        var paire = paireDePage();
        var img = principale(Array.prototype.slice.call(document.querySelectorAll('img')), paire ? paire.i : null);
        var introuvable = !!paire && !img;
        var adresse = img ? adresseDe(img) : '';
        var lecture = lirePixels(img);
        var paquet = paquetId();
        var message = {
            schema: 1, paquet: paquet, url: location.origin + location.pathname, titre: titre, nom: titre.replace(/\s*\([^)]*\)\s*$/, ''),
            idProduct: idProduitDe(adresse), imageMotif: introuvable ? 'image-du-produit-introuvable' : null, imageSrc: adresse, w: img ? img.naturalWidth | 0 : 0, h: img ? img.naturalHeight | 0 : 0,
            mime: lecture.mime, pixels: lecture.pixels, pixelsMotif: lecture.motif, verdictTesteur: verdict
        };
        dire('Envoi du relevé au récepteur local…');
        poster(message).then(function (rep) {
            fini();
            if (!(rep.json && rep.json.ok)) { dire('❌ Relevé refusé (HTTP ' + rep.status + ') : ' + ((rep.json && rep.json.motif) || 'réponse illisible du récepteur'), '#f56c6c'); return; }
            var p = rep.json.paire;
            var qui = p ? 'paire n°' + p.n + ' ' + p.version + ' (tampon attendu : ' + p.tamponAttendu + ')' : 'hors des 64';
            var texte = '✅ Relevé envoyé · ' + qui + ' · ' + rep.json.relevees + ' sur ' + rep.json.sur + ' adresses relevées.';
            if (introuvable) texte += '\nL\'image de ce produit (idProduct ' + paire.i + ') est introuvable sur la page : ton verdict part marqué « sans image rattachée ».';
            else if (lecture.motif) texte += '\n' + dernierMot(lecture.motif);
            dire(texte, lecture.motif ? '#e6a23c' : '#67c23a');
        }, function (e) {
            fini();
            dire(e && e.reseau === 'delai'
                ? '❌ Le récepteur ne répond pas (délai dépassé) : vérifie qu\'il tourne, puis recommence.'
                : '❌ Le récepteur ne répond pas : lance-le (node recepteur-cardmarket-fiche.js), puis recommence.', '#f56c6c');
        });
    }
    b1.addEventListener('click', function () { releve('tampon-visible'); });
    b2.addEventListener('click', function () { releve('pas-de-tampon'); });
    b3.addEventListener('click', function () { releve('ne-sais-pas'); });
})();
