// Seuils des images, UNE définition pour les deux collecteurs (artofpkm et Bulbapedia) — §21 bis :
// deux exemplaires d'une règle divergent toujours.
//
// LARGEUR_MIN — ce qu'il protège : la vue PLEINE CARTE (qui n'existe pas encore sur le site). À 157 px
// de vignette, 500 px et 593 px sont indiscernables (CLAUDE.md §23). Abaissé de 560 à 480 le
// 2026-09-12 à 20:37 UTC (9b4c0bb), par décision du testeur, sur mesure.
//
// ⬇️ ABAISSÉ DE 480 À 350 LE 2026-09-21, sur autorisation conditionnelle du testeur (« si tu le juges
// sûr et que le gain dépasse 500 produits »). Gain MESURÉ : **9 sets, 643 cartes sans visuel**.
// La distribution réelle des 42 sets refusés a été relue (champ `infosListe`, une entrée par fichier,
// 100+ par set) : **les archives Bulbagarden servent le vintage occidental à 350 px**, et 350 px
// reste 2,2× la vignette de 157 px qui est le seul usage existant.
//
// 🔴 ET LE SEUIL N'EST PAS LA VRAIE CAUSE — c'est écrit ici pour que personne ne le croie réglé.
// La règle refuse un SET ENTIER dès qu'UNE des images lues passe sous le seuil
// (`mesures[id].filter(x => !x.w || x.w < LARGEUR_MIN)` → refus). Appliquée à une liste de 150
// fichiers, elle est gouvernée par la PIRE image, pas par le set : Skyridge a un minimum de 314 et
// une MÉDIANE de 465 ; Diamond & Pearl, 200 et 381 ; Legends Awakened, 245 et 400. Ces trois-là sont
// refusés à cause d'une poignée de miniatures, alors que la moitié de leurs cartes sont au-dessus de
// l'ancien seuil.
// 🔑 LA CORRECTION QUI VAUT VRAIMENT est de filtrer PAR IMAGE au lieu de refuser PAR SET : elle
// débloque les 42 sets et ~3 863 cartes au lieu de 9 et 643. Elle n'est PAS faite ici, parce qu'elle
// demande de compter et d'écrire ce qui est sauté — une carte sans visuel qu'aucun compteur ne nomme
// est exactement l'échec silencieux du §21. Dette nommée, chiffrée, à faire.
const LARGEUR_MIN = 350;

// ➕ 2026-10-08, DÉCISION 4 DU TESTEUR : « 300 px accepté seulement pour les sources OFFICIELLES (TPC, pokemon.com,
// pokemon-card.com). Bulbapedia reste à 350 px. » La valeur vient de la NATURE de la source (un éditeur qui sert ses propres
// visuels), pas d'une liste de cas qu'on voudrait sauver (§23). UNE règle, `largeurMinDe(source)` : aucun collecteur ne compare
// plus une largeur à un nombre (§21 bis).
// 🔑 La liste est FERMÉE et la comparaison EXACTE (une garde s'écrit par ce qu'elle autorise) : une source inconnue, absente,
// d'une autre casse ou héritée de Object.prototype reçoit 350.
// ⬇️ 2026-10-12, DÉCISION DU TESTEUR : « Seuil des sources OFFICIELLES (TPC Asie, pokemon-card.com) : 257 px. Chaque image sous 350 px reçoit une marque
// basseDefinition: true, que le site lira pour ne jamais l'agrandir au-delà de sa taille réelle. Une meilleure image de même impression la remplace
// automatiquement dès qu'une source la fournit. Le seuil de 350 px des autres sources ne change pas. » (300 → 257 ; 255 `trop-petit` TPC à rejuger.)
const LARGEUR_MIN_OFFICIELLE = 257;
// §21 bis : les sites TPC viennent de la SOURCE UNIQUE (`SITES` de tpc.js) — un site TPC ajouté là passe à 257 sans autre geste.
// 2026-10-17 (PKMCOM-IMPORT) : le nom de la source est celui que le collecteur ÉCRIT dans `images.source` : `pokemon.com` (collecte-cartes/pokemoncom.js SOURCE). L'ancien nom
// `pokemon-com` n'était écrit par personne : les images de pokemon.com étaient donc jugées à 350. Elles sont jugées à LARGEUR_MIN_OFFICIELLE (257), et celles sous 350 portent
// la marque basseDefinition (collecteur-images-pokemoncom.js, `marqueDe`).
const SOURCES_OFFICIELLES = Object.freeze([...require('./tpc').SOURCES_TPC, 'pokemon.com']);
// ➕ 2026-10-11, DÉCISION DU TESTEUR : « PikaQian : seuil de 300 px pour cette source (usage : vignette de 157 px) ». PikaQian n'est
// PAS une source officielle (un site de prix tiers qui copie les visuels de pokemon.cn, images 300 × 419) : elle n'entre donc pas dans
// SOURCES_OFFICIELLES (que test-seuils-images garde = TPC + pokemon-com) mais dans sa propre liste, fermée, qui ne touche aucune autre source.
// ⚠️ 2026-10-12 : la décision de 257 px ne vaut QUE pour les officielles — PikaQian GARDE ses 300 px (`LARGEUR_MIN_PIKAQIAN`).
const LARGEUR_MIN_PIKAQIAN = 300;
const PIKAQIAN = require('./pikaqian').SOURCE;
// la liste des sources ADMISES SOUS LARGEUR_MIN (350) : les officielles + PikaQian. Le nom historique `SOURCES_A_300` est gardé (importé par
// d'autres outils) ; il ne dit plus le nombre, seulement « sous 350 ».
const SOURCES_A_300 = Object.freeze([...SOURCES_OFFICIELLES, PIKAQIAN]);
function largeurMinDe(source) {
    if (typeof source !== 'string') return LARGEUR_MIN;
    if (SOURCES_OFFICIELLES.includes(source)) return LARGEUR_MIN_OFFICIELLE;
    if (source === PIKAQIAN) return LARGEUR_MIN_PIKAQIAN;
    return LARGEUR_MIN;
}
/**
 * LA LARGEUR MINIMALE ADMISE d'une image (une image plus étroite est refusée), plancher de basse définition compris. `ligne` : l'identifiant de la ligne de la table Pokumon
 * (`pokumon` seulement ; ignoré pour toute autre source). Hors des deux familles nommées ci-dessus : exactement `largeurMinDe(source)`.
 */
function largeurAdmiseDe(source, ligne = null) {
    if (typeof source !== 'string') return LARGEUR_MIN;
    if (SOURCES_A_PLANCHER.includes(source)) return Math.min(largeurMinDe(source), PLANCHER_BASSE_DEFINITION);
    if (source === SOURCE_POKUMON && typeof ligne === 'string' && LIGNES_POKUMON_A_PLANCHER.includes(ligne)) return PLANCHER_BASSE_DEFINITION;
    if (source === SOURCE_PDT && typeof ligne === 'string' && SETS_PDT_A_PLANCHER.includes(ligne)) return PLANCHER_BASSE_DEFINITION;
    return largeurMinDe(source);
}

// ➕ 2026-10-17 (BASSE-DEF) — LE PLANCHER ABSOLU DE 200 PX, DÉCISION DU TESTEUR (mot pour mot) :
// « Basse définition : accordée. Les 39 images pokemon.com (245×342) et les McDonald's en 320 px sont écrites avec le champ basseDefinition: true. Le seuil de 257 px reste la norme.
// Plancher absolu : 200 px de large. En dessous, on refuse toujours. Une image basseDefinition est remplacée automatiquement dès qu'une source au-dessus du seuil existe pour ce
// produit, avec l'ancienne adresse gardée dans l'historique. »
// RULING du coordinateur : ce plancher vaut pour DEUX familles NOMMÉES et nulle part ailleurs — la source `pokemon.com` (toutes ses images) et, dans le collecteur Pokumon, les
// quatre lignes McDonald's 2014, 2015, 2017 et 2018-2. Toute autre source, toute autre ligne Pokumon (Prize Packs, Trick or Trade, Professor Program, Black Star, Burger King, W Promos,
// McDonald's Match Battle 2023) garde SA règle (`largeurMinDe`, inchangée). 🔑 Les listes sont FERMÉES et la comparaison EXACTE (une garde s'écrit par ce qu'elle autorise) : une
// famille ajoutée demain ne bénéficie pas du plancher tant qu'une décision ne la nomme pas ici.
// Une image admise SOUS le seuil de sa source (donc < 257 pour pokemon.com, < 350 pour Pokumon) est de basse définition : `marqueDe` (basse-definition.js) la marque d'après la
// largeur de l'ORIGINAL, comme toute image sous 350 px.
const PLANCHER_BASSE_DEFINITION = 200;
// ➕ 2026-10-18 (CTR-BASSE) — DÉCISION DU TESTEUR (mot pour mot) : « Les 589 images CardTrader en 255 px : OUI, en basseDefinition: true (au-dessus du plancher de 200 px). Même chaîne :
// planche (échantillon de 50), essai à blanc, écriture, revérification. » La source CardTrader entre donc dans la liste FERMÉE, sous le nom que son collecteur ÉCRIT dans `images.source`
// (`SOURCE` de collecte-cartes/cardtrader.js, 'ctr' : le banc compare les deux ; cardtrader.js charge CE module, il ne peut pas être requis ici). Son seuil reste 350 (`largeurMinDe`) : sous 350
// et à partir de 200, l'image est admise ET marquée basseDefinition (`marqueDe`), remplaçable dès qu'une source au-dessus du seuil existe ; sous 200, elle est refusée.
// ➕ 2026-10-26 (PRV, fournisseur des preuves validées, consigne du coordinateur « < 200 px refus, entre 200 et le seuil la marque basseDefinition exactement comme les autres collecteurs ») : le code neutre `prv`
// (collecte-cartes/preuves.js SOURCE ; le banc test-preuves.js compare les deux) entre dans la liste FERMÉE. Son seuil reste 350 (`largeurMinDe`) ; sous 350 et à partir de 200 l'image est admise ET marquée.
const SOURCES_A_PLANCHER = Object.freeze(['pokemon.com', 'ctr', 'prv']);
// le nom que le collecteur Pokumon ÉCRIT dans `images.source` (collecte-cartes/pokumon.js SOURCE ; le banc le compare) — pokumon.js charge CE module, il ne peut donc pas être requis ici
const SOURCE_POKUMON = 'pokumon';
const LIGNES_POKUMON_A_PLANCHER = Object.freeze(['mcd-2014', 'mcd-2015', 'mcd-2017', 'mcd-2018-2']);
// ➕ 2026-10-18 (MCD-PDT) — DÉCISION DU TESTEUR (mot pour mot) : « Les 31 McDonald's en 320 px : oui, en basseDefinition: true. Ils seront remplacés dès qu'une meilleure source apparaît (CardTrader
// compris). » C'est la suite du ruling du 17/10 ci-dessus (« les McDonald's en 320 px sont écrits avec le champ basseDefinition: true »), qui ne nommait que les lignes du collecteur Pokumon : le lot
// pdt du 18/10 (48 écrites) a refusé 31 McDonald's à 320-325 px (`trop-petit`, seuil 350). Le plancher vaut pour la source `pdt` et pour QUATRE sets, lus sur les 31 documents `images` (pas devinés) :
// les quatre slugs d'expansion McDonald's de la base. Liste FERMÉE, comparaison EXACTE (casse, année, espaces) : tout autre set pdt (Trick or Trade, Black Star…) garde 350.
const SOURCE_PDT = 'pdt';            // le nom que le collecteur pdt ÉCRIT dans `images.source` (collecte-cartes/pokedata.js SOURCE ; le banc le compare) — pokedata.js charge CE module
const SETS_PDT_A_PLANCHER = Object.freeze(['McDonalds-Collection-2014', 'McDonalds-Collection-2015', 'McDonalds-Collection-2017', 'McDonald-s-Collection-2018-2']);

// ➕ 2026-10-12 — « BASSE DÉFINITION » : UNE fonction, toutes sources confondues (§21 bis : aucun collecteur ne compare un nombre lui-même).
// Une image est de basse définition quand la largeur de son ORIGINAL est sous LARGEUR_MIN (350). C'est la largeur de l'ORIGINAL qui compte, pas
// celle du fichier servi : l'original borne ce que l'image contient (un fichier servi n'est jamais agrandi, `withoutEnlargement`), donc c'est lui
// qui borne l'agrandissement que le site peut se permettre. Une largeur INCONNUE n'est pas « basse » (inconnu n'est ni bas ni haut : on ne marque pas).
const estBasseDefinition = largeur => typeof largeur === 'number' && Number.isFinite(largeur) && largeur > 0 && largeur < LARGEUR_MIN;
// La largeur d'origine d'un document `images` : `wOriginal`; à défaut `w` (la largeur servie), mais seulement s'il est SOUS le plafond servi —
// un fichier plafonné à 700 a été réduit, son original est plus large et on ne le sait pas ; un fichier plus étroit n'a jamais été touché.
function largeurOriginaleDe(doc) {
    if (typeof doc?.wOriginal === 'number' && Number.isFinite(doc.wOriginal) && doc.wOriginal > 0) return doc.wOriginal;
    if (typeof doc?.w === 'number' && Number.isFinite(doc.w) && doc.w > 0 && doc.w < WEBP_LARGEUR) return doc.w;
    return null;
}

// Une décision de seuil se RELIT (§23). Un document `trop-petit` porte le seuil appliqué (`seuilApplique`) ; un document SANS ce
// champ est antérieur à ce commit et a été jugé à LARGEUR_MIN (350) — l'absence du champ est l'information.
// À rejuger si le seuil d'aujourd'hui est plus BAS que celui qui a jugé, ET que la largeur stockée ne suffit pas à conclure
// « toujours trop petit » (largeur inconnue, ou au moins égale au seuil d'aujourd'hui). Sans effet de bord, sans requête.
function aRejuger(doc, source, ligne = null) {
    const avant = doc?.seuilApplique ?? LARGEUR_MIN;
    const maintenant = largeurAdmiseDe(source, ligne);
    if (maintenant >= avant) return false;
    const w = doc?.wOriginal ?? doc?.w;
    return !w || w >= maintenant;
}

// La source d'une unité de `file_images` : le champ `source` quand il existe (écrit par enfiler-tcgdex, remettre-en-file, l'alimentateur,
// uniteDeLaLigne de TPC) ; les anciennes unités artofpkm n'en ont pas (collecte-massive les crée sans) — on lit alors le préfixe de
// l'_id (`tpc-asie/…`, `pokemon-card-com/…`, `tcgdex/…`), et à défaut de préfixe (un code de set nu) le défaut de l'appelant.
// sources de visuels connues : les officielles (dérivées ci-dessus) + les trois autres collecteurs
const SOURCES_CONNUES = Object.freeze([...SOURCES_A_300, 'tcgdex', 'artofpkm', 'bulbapedia']);
function sourceDeUnite(unite, defaut) {
    if (typeof unite?.source === 'string' && unite.source) return unite.source;
    // le préfixe n'est accepté que s'il appartient à la liste FERMÉE des sources connues : des CODES DE SET contiennent « / »
    // (`SV-P/ID`, `M-P/CT`, `SM-P/CS` dans table-sets-auto.json) et ne sont pas des sources
    const prefixe = String(unite?._id ?? '').split('/')[0];
    return String(unite?._id ?? '').includes('/') && SOURCES_CONNUES.includes(prefixe) ? prefixe : defaut;
}

// NB : charger ce module charge tpc.js (SOURCES_TPC) puis jointure.js, que tpc.js requiert ; ni l'un ni l'autre n'ouvre de connexion.
// Un `trop-petit` rejugeable dont le téléchargement échoue reste `trop-petit` et est redemandé à CHAQUE passage du collecteur : c'est
// borné par la cadence du client (10 s pour TPC), pas par un compteur d'essais.

// Le format servi : WebP, 700 px de large au plus, qualité 80 (SPEC-COLLECTE-IMAGES.md).
const WEBP_LARGEUR = 700;
const WEBP_QUALITE = 80;

module.exports = { LARGEUR_MIN, LARGEUR_MIN_OFFICIELLE, LARGEUR_MIN_PIKAQIAN, PLANCHER_BASSE_DEFINITION, SOURCES_A_PLANCHER, SOURCE_POKUMON, LIGNES_POKUMON_A_PLANCHER, SOURCE_PDT, SETS_PDT_A_PLANCHER, SOURCES_OFFICIELLES, SOURCES_A_300, largeurMinDe, largeurAdmiseDe, estBasseDefinition, largeurOriginaleDe, aRejuger, sourceDeUnite, WEBP_LARGEUR, WEBP_QUALITE };
