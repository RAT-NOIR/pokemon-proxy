// ============================================================
// LES SOURCES D'IMAGES EN SERVICE — une définition, lue par le worker (collecteur-images.js) ET l'alimentateur (alimentateur.js)
// ============================================================
// UNE GARDE S'ÉCRIT PAR CE QU'ELLE AUTORISE (§51) : une source absente d'ici ne reçoit aucune requête et aucune unité neuve.
// 🔴 BULBAPEDIA EN EST SORTI LE 2026-10-04 : un essai à 23:19 a reçu un 403 Cloudflare `cf-mitigated: challenge` — un défi anti-robot,
// pas une cadence (§73). Contourner un défi serait de l'évasion : plus aucune requête à Bulbagarden (API et fichiers), copies d'archive
// seulement ; un accès se demande à Bulbagarden. Le worker remettait pourtant des unités Bulbapedia en file (l'alimentateur) et les
// collectait (relecture du 2026-10-06) — rien, dans le code, ne portait la décision.
// Rouvrir Bulbapedia = l'ajouter ici, dans un commit qui dit pourquoi : la décision a une seule adresse.
// ➕ 2026-10-07 (soir) — LES SOURCES OFFICIELLES TPC, sur décision de l'éditeur : TPC Asie et pokemon-card.com (impression exacte,
// rien de protégé, robots.txt respecté, cadence lente, arrêt au premier blocage — collecte-cartes/tpc.js). TPC Chine reste fermé.
const SOURCES_EN_SERVICE = Object.freeze(new Set(['artofpkm', 'tcgdex', 'tpc-asie', 'pokemon-card-com']));
const SOURCES_SUSPENDUES = Object.freeze({ bulbapedia: 'suspendu depuis le 2026-10-04 (403 Cloudflare, défi anti-robot) : plus aucune requête' });
const enService = source => SOURCES_EN_SERVICE.has(source);
module.exports = { SOURCES_EN_SERVICE, SOURCES_SUSPENDUES, enService };
