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
const SOURCES_OFFICIELLES = Object.freeze(['tpc-asie', 'pokemon-card-com', 'pokemon-com']);
function largeurMinDe(source) {
    return typeof source === 'string' && SOURCES_OFFICIELLES.includes(source) ? LARGEUR_MIN_OFFICIELLE : LARGEUR_MIN;
}

// Le format servi : WebP, 700 px de large au plus, qualité 80 (SPEC-COLLECTE-IMAGES.md).
const WEBP_LARGEUR = 700;
const WEBP_QUALITE = 80;

module.exports = { LARGEUR_MIN, LARGEUR_MIN_OFFICIELLE, SOURCES_OFFICIELLES, largeurMinDe, WEBP_LARGEUR, WEBP_QUALITE };
