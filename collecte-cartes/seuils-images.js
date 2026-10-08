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
const LARGEUR_MIN_OFFICIELLE = 300;
// §21 bis : les sites TPC viennent de la SOURCE UNIQUE (`SITES` de tpc.js) — un site TPC ajouté là passe à 300 sans autre geste.
// `pokemon-com` n'a pas encore de collecteur, donc pas de site : il s'ajoute ici, à la main.
const SOURCES_OFFICIELLES = Object.freeze([...require('./tpc').SOURCES_TPC, 'pokemon-com']);
function largeurMinDe(source) {
    return typeof source === 'string' && SOURCES_OFFICIELLES.includes(source) ? LARGEUR_MIN_OFFICIELLE : LARGEUR_MIN;
}

// Une décision de seuil se RELIT (§23). Un document `trop-petit` porte le seuil appliqué (`seuilApplique`) ; un document SANS ce
// champ est antérieur à ce commit et a été jugé à LARGEUR_MIN (350) — l'absence du champ est l'information.
// À rejuger si le seuil d'aujourd'hui est plus BAS que celui qui a jugé, ET que la largeur stockée ne suffit pas à conclure
// « toujours trop petit » (largeur inconnue, ou au moins égale au seuil d'aujourd'hui). Sans effet de bord, sans requête.
function aRejuger(doc, source) {
    const avant = doc?.seuilApplique ?? LARGEUR_MIN;
    const maintenant = largeurMinDe(source);
    if (maintenant >= avant) return false;
    const w = doc?.wOriginal ?? doc?.w;
    return !w || w >= maintenant;
}

// La source d'une unité de `file_images` : le champ `source` quand il existe (écrit par enfiler-tcgdex, remettre-en-file, l'alimentateur,
// uniteDeLaLigne de TPC) ; les anciennes unités artofpkm n'en ont pas (collecte-massive les crée sans) — on lit alors le préfixe de
// l'_id (`tpc-asie/…`, `pokemon-card-com/…`, `tcgdex/…`), et à défaut de préfixe (un code de set nu) le défaut de l'appelant.
// sources de visuels connues : les officielles (dérivées ci-dessus) + les trois autres collecteurs
const SOURCES_CONNUES = Object.freeze([...SOURCES_OFFICIELLES, 'tcgdex', 'artofpkm', 'bulbapedia']);
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

module.exports = { LARGEUR_MIN, LARGEUR_MIN_OFFICIELLE, SOURCES_OFFICIELLES, largeurMinDe, aRejuger, sourceDeUnite, WEBP_LARGEUR, WEBP_QUALITE };
