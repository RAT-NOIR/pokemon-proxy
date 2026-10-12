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
function clesPartagees(resolues, { numerotes = false } = {}) {
    // 🔑 LOT V8 (tour 1) : `numerotes` étend LA MÊME règle aux numéros chiffrés, pour les seules lignes qui déclarent une sous-section (deux images au même
    // numéro ET au même nom dans un deck : Metagross 005, 643/5 et 643/6 — la dernière lue n'est pas une preuve). Hors déclaration : portée d'avant, inchangée.
    const parCle = new Map();
    for (const { carteId, im } of resolues) {
        // `numerotes` : un numéro ABSENT (null, vide) ne forme jamais de clé — sans cela « null » deviendrait une clé partagée par toutes les images sans numéro et les
        // refuserait en bloc. Une image sans numéro n'est pas touchée par cette règle (elle se joint, ou non, par son nom comme avant).
        if (numerotes ? (im.numero == null || String(im.numero).trim() === '') : !numeroSansChiffre(im.numero)) continue;
        const k = `${carteId}|${String(im.numero).trim()}`;
        (parCle.get(k) || parCle.set(k, new Set()).get(k)).add(im.sha256);
    }
    return new Set([...parCle].filter(([, shas]) => shas.size > 1).map(([k]) => k));
}

module.exports = { clesPartagees, numeroSansChiffre };
