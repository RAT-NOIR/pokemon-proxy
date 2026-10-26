'use strict';
// CACHE-ZONES — le réglage V2_SHARP_CACHE du cache de libvips (sharp.cache). NON POSÉ : sharp n'est pas touché (le comportement actuel — le cache par défaut de libvips : 50 Mo, 20 fichiers, 100 opérations — est inchangé).
// Valeurs admises, et rien d'autre (une valeur vide ou inconnue LÈVE au chargement, comme RM_IDENTITE_MAX) :
//   false          → sharp.cache(false) : plus de cache d'opérations (ni mémoire, ni fichiers, ni éléments)
//   true           → sharp.cache(true)  : le cache par défaut, demandé explicitement
//   memoire:<Mo>   → sharp.cache({ memory: <Mo> }) : le plafond mémoire du cache d'opérations, entier ≥ 0 ; fichiers et éléments restent aux défauts
// Le choix d'une valeur se fait sur l'essai (lot CACHE-ZONES) : ce module ne change AUCUN défaut.
function lireSharpCache(env = process.env) {
    const brut = env.V2_SHARP_CACHE;
    if (brut == null) return null;
    const v = brut.trim();
    if (v === 'false') return false;
    if (v === 'true') return true;
    const m = /^memoire:([0-9]+)$/.exec(v);
    if (m) return { memory: Number(m[1]) };
    throw new Error(`V2_SHARP_CACHE « ${brut} » : « false », « true » ou « memoire:<Mo entier ≥ 0> » attendu`);
}
/** Applique le réglage à `sharp` (rien si la variable n'est pas posée). Rend la valeur appliquée, ou null. */
function appliquer(sharp, env = process.env) {
    const r = lireSharpCache(env);
    if (r === null) return null;
    sharp.cache(r);
    return r;
}
module.exports = { lireSharpCache, appliquer };
