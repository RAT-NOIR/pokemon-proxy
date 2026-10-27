'use strict';
// PERF-SCAN P1 — les CLÉS DE NOM : ce qu'on écrit en base (migration) et ce qu'on cherche (serveur) sont calculés par CES fonctions, et par aucune autre.
// 🔑 Deux exemplaires d'une règle de normalisation divergent toujours (§21 bis) : index.js (trouverProduitsLocaux) et identification-locale.js importent d'ici `normaliserNom`,
// `sansNiveau` et `sansDelta` ; la migration (v2/migrations/poser-cles-nom.js) importe `clesDuProduit` et `cleNomFr`. Une clé écrite par une règle et cherchée par une autre manquerait des produits SANS erreur.
//
// POURQUOI DES CLÉS ET PAS UN INDEX SUR `name`. La présélection d'aujourd'hui est une regex SANS ancre et insensible à la casse (« contient le premier mot ») : aucun index ne l'accélère, c'est un balayage
// de tout le catalogue (74 694 documents). Mais ce que le serveur GARDE ensuite est strict : la partie du nom avant « [ », normalisée (`normaliserNom`), doit être l'une des CIBLES — ou l'être une fois
// le niveau (« Lv.61 ») ou la queue « δ Delta Species » retirés. Ces trois formes sont des clés exactes : on les écrit sur le produit (`nomCles`), on les cherche par `$in` sur un index, puis le serveur
// applique le MÊME filtre et la MÊME regex d'avant au résultat. L'ensemble rendu est donc celui d'avant (preuve : v2/mesures/rejouer-identite-index-nom.js), au prix d'un champ et d'un index.

const CHAMP_CATALOGUE = 'nomCles', INDEX_CATALOGUE = 'nomCles_1';          // catalogue_produits : tableau de clés (multikey)
const CHAMP_FR = 'nomFrCle', INDEX_FR = 'nomFrCle_1';                       // numeros_cartes : une chaîne (« » quand la ligne n'a pas de nom français)
const CHAMP_NOM_MIN = 'nomMin', INDEX_NOM_MIN = 'nomMin_1';                 // catalogue_produits : le nom entier en minuscules (« » sans nom) — pour « le nom COMMENCE par … » (pont-cartes.js)

/** Minuscules, sans espaces ni tirets ni apostrophes ni points ni « & » : « M Kangaskhan EX » et « MKangaskhan EX » sont identiques. La règle de index.js, qui l'importe désormais d'ici. */
function normaliserNom(nom) {
    return nom.toLowerCase().replace(/[\s\-'.&]/g, '');
}
/** Le nom du produit sans son niveau (« Dragonite Lv.61 » → « Dragonite »). La règle de trouverProduitsLocaux, recopiée à l'identique (elle y est désormais appelée d'ici). */
function sansNiveau(nomProduit) { return nomProduit.replace(/[\s-]*Lv\.?\s?(X|\d+)\b/i, '').trim(); }
/** Le nom du produit sans la queue « δ Delta Species ». Idem. */
function sansDelta(nomProduit) { return nomProduit.replace(/\s*δ\s*Delta\s*Species\s*$/i, '').trim(); }

/** Les clés d'un produit du catalogue : [forme brute, sans niveau si elle diffère, sans δ si elle diffère], dédoublonnées. Un nom absent (ou non textuel) n'a AUCUNE clé. */
function clesDuProduit(name) {
    if (typeof name !== 'string') return [];
    const nomProduit = name.split('[')[0].trim();
    const cles = [normaliserNom(nomProduit)];
    const n = sansNiveau(nomProduit); if (n !== nomProduit) cles.push(normaliserNom(n));
    const d = sansDelta(nomProduit); if (d !== nomProduit) cles.push(normaliserNom(d));
    return [...new Set(cles)];
}

/** La clé du nom français : minuscules et accents retirés (une condition NÉCESSAIRE de « même nom, casse ignorée » : le serveur réapplique la regex exacte au résultat). « » quand il n'y a pas de nom. */
function cleNomFr(nomFr) {
    if (typeof nomFr !== 'string') return '';
    return nomFr.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/** Le nom entier en minuscules (condition NÉCESSAIRE d'un « commence par … » insensible à la casse : le serveur réapplique la regex exacte au résultat). « » quand il n'y a pas de nom. */
function cleNomMin(name) { return typeof name === 'string' ? name.toLowerCase() : ''; }

module.exports = { normaliserNom, sansNiveau, sansDelta, clesDuProduit, cleNomFr, cleNomMin, CHAMP_CATALOGUE, INDEX_CATALOGUE, CHAMP_FR, INDEX_FR, CHAMP_NOM_MIN, INDEX_NOM_MIN };
