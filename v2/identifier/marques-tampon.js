'use strict';
// LOT TAMPONS (2026-10-18) — la LISTE FERMÉE des marques d'une carte tamponnée, et la forme des jetons de `variante` que le catalogue écrit dans cartes_produits (avec `variantePreuve`).
// UNE SEULE définition pour : la décision du chargeur (decision.js), la paire séparée par la variante (partage-variante.js), la lecture du tampon (lecture-tampon.js) et le contrat public (produit.js : `marques`).
// Module PUR : ni base, ni réseau.
// 🔑 Écrit par ce qu'il AUTORISE : une marque n'existe que si elle est dans MARQUES ; un jeton de variante n'existe que s'il est `normale`, `jumbo`, ou un ensemble de marques de la liste, joint par « + »,
// dans l'ordre de MARQUES, sans doublon. Tout le reste (une marque inconnue, un autre ordre, un espace, une casse) n'est PAS un jeton : null, jamais deviné, jamais « corrigé » en silence.
const MARQUES = Object.freeze(['staff', 'prerelease', 'league', 'championship', 'toys-r-us', 'gamestop', 'kfc', 'indomilk', 'professor', 'cosmo', 'snowflake', 'play-pokemon', 'place-1', 'place-2', 'place-3', 'place-4']);
const MARQUES_MAX = 4;                                                                   // un ensemble réel en porte deux (staff+prerelease, league+place-2) ; au-delà, la lecture ne s'affirme pas
const RANG = new Map(MARQUES.map((m, i) => [m, i]));
// La forme ANCIENNE posée sur 2 lignes par le catalogue (« staff-prerelease ») se LIT `staff+prerelease` : la seule équivalence admise, énumérée, jamais un motif.
const FORMES_ANCIENNES = Object.freeze({ 'staff-prerelease': 'staff+prerelease' });

const estMarque = x => typeof x === 'string' && RANG.has(x);

/** @param marques un tableau de marques ; @returns les marques dédoublonnées dans l'ordre de MARQUES, ou null (vide, trop long, une marque hors liste, pas un tableau). */
function ensembleDe(marques) {
    if (!Array.isArray(marques) || !marques.length || !marques.every(estMarque)) return null;
    const s = [...new Set(marques)].sort((a, b) => RANG.get(a) - RANG.get(b));
    return s.length <= MARQUES_MAX ? s : null;
}
/** Les marques → le jeton canonique (« staff+prerelease »), ou null. */
function jetonDeMarques(marques) { const s = ensembleDe(marques); return s ? s.join('+') : null; }

/**
 * Un jeton de `variante` → { type: 'normale' } | { type: 'jumbo' } | { type: 'marques', marques: [...], jeton } | null. STRICT : la forme canonique seulement.
 * Un ensemble mal ordonné, doublonné, avec un espace, une majuscule, ou une marque hors de la liste est null.
 */
function lireVariante(v) {
    if (typeof v !== 'string') return null;
    if (v === 'normale') return { type: 'normale' };
    if (v === 'jumbo') return { type: 'jumbo' };
    const parts = v.split('+');
    if (!parts.every(estMarque)) return null;
    for (let i = 1; i < parts.length; i++) if (RANG.get(parts[i]) <= RANG.get(parts[i - 1])) return null;       // l'ordre canonique, strictement croissant : ni doublon ni autre ordre
    if (parts.length > MARQUES_MAX) return null;
    return Object.freeze({ type: 'marques', marques: Object.freeze([...parts]), jeton: v });
}
/** Le jeton tel que le catalogue l'écrit : la forme canonique, ou la forme ancienne énumérée (→ canonique). null sinon. */
function normaliserVariante(v) {
    if (typeof v !== 'string') return null;
    const canon = Object.prototype.hasOwnProperty.call(FORMES_ANCIENNES, v) ? FORMES_ANCIENNES[v] : v;
    return lireVariante(canon) ? canon : null;
}
const estVariante = v => lireVariante(v) !== null;
/** Une variante qui N'EST PAS la normale : un ensemble de marques, ou jumbo (les « spéciales » d'une paire). */
const estSpeciale = v => { const x = lireVariante(v); return x !== null && x.type !== 'normale'; };
/**
 * Le champ ADDITIF `marques` du contrat public, d'après la variante PROUVÉE d'un produit : l'ensemble de ses marques (une ou plus) ; [] pour la `normale` (prouvée sans tampon de la liste) ; null pour tout le reste
 * (jumbo, absente, hors forme) — « on ne sait pas » n'est jamais « aucune marque ». `Produit.variante` n'est PAS touchée (sa liste fermée est lue par l'extension et le site).
 */
const marquesProuvees = v => { const x = lireVariante(v); return x === null ? null : x.type === 'marques' ? [...x.marques] : x.type === 'normale' ? [] : null; };

module.exports = { MARQUES, MARQUES_MAX, FORMES_ANCIENNES, estMarque, ensembleDe, jetonDeMarques, lireVariante, normaliserVariante, estVariante, estSpeciale, marquesProuvees };
