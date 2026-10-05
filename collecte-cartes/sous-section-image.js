// ============================================================
// LA JOINTURE D'UNE IMAGE DE SOUS-SECTION artofpkm — une garde écrite par ce qu'elle AUTORISE (§51)
// ============================================================
// 🔴 2026-10-06. Le nouveau gabarit d'artofpkm range les decks d'un kit dans des SOUS-SECTIONS qui sont des sets à part
// (/sets/643/card/1 sous la liste 206), chacune numérotée depuis 1. Une ligne de table peut ne déclarer qu'UN deck (LED : le deck
// Leafeon) : par le numéro seul, « Dual Ball n°008 » du deck Metagross désignait la carte Good Rod n°008 du deck Leafeon — une image
// FAUSSE, posée sans un mot. Une image dont le set source n'est pas un des ids de la ligne ne se joint donc QUE si le numéro désigne
// une carte ET que le nom de l'image est celui de cette carte. Tout le reste se refuse (reste écrit) : le nom seul (le numéro écrit
// serait celui d'un autre deck), une image sans nom, un nom qui diffère. Une correction lue à l'œil passe telle quelle.
// ⚠️ Le nom anglais d'artofpkm se trompe ~0,3 % du temps (§55) : sur une sous-section, ce sont des images JUSTES refusées — un visuel
// absent est honnête, celui d'un autre tirage ne l'est pas.
// Les images de la liste elle-même (sourceSetId parmi les ids de la ligne) ne passent pas par ici : rien ne change pour elles.

/**
 * @param im      le document image ({ sourceSetId, nomEn })
 * @param cands   les cartes que la jointure a désignées
 * @param preuve  la preuve de la jointure ('numero', 'numero+nom', 'nom', …)
 * @param ids     les ids artofpkm de la ligne (sources-sets.js)
 * @param cleNom  la normalisation du nom (nomImage du collecteur)
 * @returns { cands, preuve, raison } — cands vide si refusée, `raison` dit laquelle des conditions manque
 */
function jointureSousSection(im, cands, preuve, ids, cleNom, { correction = false } = {}) {
    const deLaListe = im.sourceSetId == null || (ids || []).map(Number).includes(Number(im.sourceSetId));
    if (deLaListe || correction) return { cands, preuve, raison: null };
    const parLeNumero = preuve === 'numero' || preuve === 'numero+nom';
    const raison = !parLeNumero ? `jointe par « ${preuve} », pas par le numéro` : cands.length !== 1 ? `le numéro désigne ${cands.length} cartes`
        : !im.nomEn ? 'l\'image n\'a pas de nom' : cleNom(cands[0].nomEn) !== cleNom(im.nomEn) ? `le nom de l'image n'est pas celui de la carte (« ${cands[0].nomEn} »)` : null;
    return raison ? { cands: [], preuve, raison } : { cands, preuve: 'numero+nom (sous-section)', raison: null };
}

module.exports = { jointureSousSection };
