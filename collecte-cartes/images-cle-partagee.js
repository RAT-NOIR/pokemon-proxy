// ============================================================
// UNE CLÉ D'IMAGE QUE PLUSIEURS IMAGES PARTAGENT N'EN DÉSIGNE AUCUNE (2026-09-24)
// ============================================================
// artofpkm numérote les promos non numérotées par le CODE du set : « XY-P », « SM-P », « S-P ». Ce « numéro » ne
// distingue pas deux tirages : « Victory Ring » le porte sur 24 images de 24 tournois différents (Battle Festa 2015
// vainqueur…), « Victory Decoration » sur 24. La jointure est clé par (carte, set, numéro) : elle n'en gardait que la
// DERNIÈRE LUE — un tirage choisi par l'ordre de lecture, affiché comme s'il était LE visuel. Lu à l'œil sur 12 suspectes
// tirées au hasard parmi les 3 499 images jointes et invisibles.
// 🔑 C'est la garde par le nom de jointure.js (« un nom qui désigne plusieurs cartes ne désigne rien »), retournée : une
// clé qui désigne plusieurs images ne désigne aucune d'elles. Portée bornée à ce qui a été mesuré : un numéro SANS
// CHIFFRE. Un vrai numéro partagé (deux images du n°012) et l'absence de numéro (Gym, decks à emplacements) ne sont pas
// touchés — là, le comportement ne change pas (§20 : coût nul hors du cas mesuré).
const numeroSansChiffre = n => n != null && String(n).trim() !== '' && !/\d/.test(String(n));

/**
 * @param {{carteId: *, im: {numero: *, sha256: string}}[]} resolues  les images dont la jointure a désigné UNE carte
 * @returns {Set<string>}  les clés « carteId|numéro » refusées : numéro sans chiffre, porté par ≥ 2 images DIFFÉRENTES
 */
function clesPartagees(resolues) {
    const parCle = new Map();
    for (const { carteId, im } of resolues) {
        if (!numeroSansChiffre(im.numero)) continue;
        const k = `${carteId}|${String(im.numero).trim()}`;
        (parCle.get(k) || parCle.set(k, new Set()).get(k)).add(im.sha256);
    }
    return new Set([...parCle].filter(([, shas]) => shas.size > 1).map(([k]) => k));
}

module.exports = { clesPartagees, numeroSansChiffre };
