// Seuils des images, UNE définition pour les deux collecteurs (artofpkm et Bulbapedia) — §21 bis :
// deux exemplaires d'une règle divergent toujours.
//
// LARGEUR_MIN — ce qu'il protège : la vue PLEINE CARTE (qui n'existe pas encore sur le site). À 157 px
// de vignette, 500 px et 593 px sont indiscernables (CLAUDE.md §23). Abaissé de 560 à 480 le
// 2026-09-12 à 20:37 UTC (9b4c0bb), par décision du testeur, sur mesure.
const LARGEUR_MIN = 480;

// Le format servi : WebP, 700 px de large au plus, qualité 80 (SPEC-COLLECTE-IMAGES.md).
const WEBP_LARGEUR = 700;
const WEBP_QUALITE = 80;

module.exports = { LARGEUR_MIN, WEBP_LARGEUR, WEBP_QUALITE };
