// ============================================================
// LES CHAMPS PAR TIRAGE POSÉS APRÈS LE PARSEUR — une réécriture de `impressions` ne les efface plus (2026-09-24)
// ============================================================
// `construire-illustrateurs.js` écrit `impressions[].illustrateur` et `illustrateurPreuve` : ils viennent de TCGdex et
// d'artofpkm, pas du wikitext. Le parseur, lui, rend `impressions` EN ENTIER, et trois écritures posaient ce tableau d'un
// `$set` (collecteur-texte.js à la collecte et à la relecture, rejouer-impressions.js).
// 🔴 MESURÉ LE 2026-09-24 : les recollectes de xASC (08 h UTC) et de HSP (09 h) ont effacé 2 179 illustrateurs d'impression
// sur 244 cartes, dont 1 339 nommés — sans un message, puisque rien ne compare le tableau écrit à celui qu'il remplace (§21).
// C'est le §21 bis entre deux outils : l'un pose un champ DANS un tableau que l'autre réécrit.
//
// LE REPORT SE FAIT PAR LA CLÉ DE L'IMPRESSION (tirage, expansion, numéro, deck — celle de rejouer-impressions.js). Une
// impression dont le numéro change (une correction lue à l'œil, collecte-cartes/corrections-impressions.js) ne reçoit
// RIEN : son illustrateur était celui d'un autre numéro, et construire-illustrateurs.js le recalcule. Cette perte-là est
// voulue, et elle est COMPTÉE (`perdus`).
const CHAMPS_POSES_APRES = ['illustrateur', 'illustrateurPreuve'];
const cleImpression = i => `${i.tirage}|${i.expansion}|${i.numero ?? ''}|${i.deck ?? ''}`;

/**
 * @param {object[]|undefined} anciennes  les impressions en base
 * @param {object[]} nouvelles            celles que le parseur vient de rendre
 * @returns {{ impressions: object[], reportes: number, perdus: number }}  `perdus` : impressions anciennes qui portaient un
 *          champ posé et dont la clé n'existe plus dans les nouvelles
 */
function reporterChampsPoses(anciennes, nouvelles) {
    const parCle = new Map((anciennes || []).map(i => [cleImpression(i), i]));
    const cles = new Set((nouvelles || []).map(cleImpression));
    let reportes = 0;
    const impressions = (nouvelles || []).map(n => {
        const a = parCle.get(cleImpression(n));
        const aReporter = a ? CHAMPS_POSES_APRES.filter(k => k in a && !(k in n)) : [];
        if (!aReporter.length) return n;
        reportes++;
        return { ...n, ...Object.fromEntries(aReporter.map(k => [k, a[k]])) };
    });
    const perdus = (anciennes || []).filter(a => CHAMPS_POSES_APRES.some(k => k in a) && !cles.has(cleImpression(a))).length;
    return { impressions, reportes, perdus };
}

module.exports = { CHAMPS_POSES_APRES, cleImpression, reporterChampsPoses };
