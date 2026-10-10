'use strict';
// Préchargement (-r) du serveur ENFANT des bancs de /api/identifier contrat 2 : le faux réseau du verrou, rien d'autre.
// Le plan (B1b.3 Step 1) y posait aussi un préfixe de collections de test_scratch ; le ruling INT2 (2026-10-08) le remplace : l'enfant hérite
// de l'URI de la base EN MÉMOIRE du banc (loopback, BANC_ISOLE=1) et lit/écrit les collections nues de CETTE base, jamais la production.
// Aucun appel sortant : axios.post/get sont remplacés par le verrou (OpenRouter rejoué, TCGdex enregistré, tout le reste lève).
require('../../verrou/faux-reseau.js');
