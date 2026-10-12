// ============================================================
// LE NUMÉRO DE LA FICHE D'UN PRODUIT DÉSIGNÉ PAR SES FRÈRES, ET LE VISUEL QU'IL FERAIT SERVIR (lot M2, §19, §66)
// ============================================================
// Ces produits sont des variantes NON NOMMÉES (ajoutées en lot par Cardmarket, jamais apprises : l'export ne dit pas si c'est une reverse, un tampon
// prerelease ou staff). Le TEXTE de la fiche est juste (la carte est établie par ses frères). Le VISUEL ne l'est que si le scan du numéro est celui du
// produit : poser `numeroFiche` fait servir le scan de ce numéro — un scan SANS tampon pour un produit tamponné est le mensonge que le chantier interdit
// (« un visuel absent est honnête, celui d'un autre tirage ne l'est pas »). Règle, écrite par ce qu'elle AUTORISE :
//   le numéro n'est posé que si TOUS les frères joints le portent (même cleNumero), ET
//     · TCGdex nomme le produit SANS tampon et à CE numéro (statut « sans-tampon-prouve »), OU
//     · TCGdex ne le nomme pas (« sans-preuve ») : aucun frère connu n'est tamponné, ET la carte est dans le clone ET elle ne porte aucune variante
//       tamponnée que PERSONNE ne nomme (le produit pourrait en être une).
//   Un produit que TCGdex nomme avec un tampon : fiche, jamais de numéro (« tampon »).
// `selonLeCahier` : ce que la règle écrite au cahier du lot (frères d'accord ET aucun frère connu tamponné) aurait posé — compté à côté pour que le coût
// de la prudence supplémentaire (carte absente du clone, tampon non nommé) soit LU, jamais subi en silence.
const { cleNumero } = require('./jointure');

const lit = n => (n == null || String(n).trim() === '' ? null : String(n).trim());

/**
 * @param {{p: {idProduct:number, idExpansion:number}, clone: object, freres: Array<{idProduct:number, numeroFiche:string|null}>}} o
 *   `freres` : les lignes des frères JOINTS (une par ligne de cartes_produits) ; `clone` : lireClone() de variantes-tcgdex.js
 * @returns {{numeroFiche: string|null, statut: 'tampon'|'sans-tampon-prouve'|'sans-preuve', motif: string, selonLeCahier: boolean, tampon: string[]}}
 */
function numeroDeLaFiche({ p, clone, freres }) {
    const hits = clone.parProduit.get(p.idProduct) || [];
    const tampon = [...new Set(hits.flatMap(h => h.variante?.stamp || []))];
    if (tampon.length) return { numeroFiche: null, statut: 'tampon', motif: `TCGdex nomme ce produit avec un tampon (${tampon.join(', ')}) : le scan du numéro est sans tampon`, selonLeCahier: false, tampon };
    // le numéro commun à TOUS les frères joints
    const parProduit = new Map();
    for (const f of freres) (parProduit.get(f.idProduct) || parProduit.set(f.idProduct, []).get(f.idProduct)).push(lit(f.numeroFiche));
    const sansNumero = [...parProduit.values()].some(ns => !ns.some(n => n != null));
    const numeros = [...parProduit.values()].flat().filter(n => n != null);
    const cles = new Set(numeros.map(n => cleNumero(n)));
    const partage = parProduit.size > 0 && !sansNumero && cles.size === 1;
    if (!partage) return { numeroFiche: null, statut: hits.length ? 'sans-tampon-prouve' : 'sans-preuve', motif: sansNumero ? 'un frère n\'a pas de numeroFiche : le numéro n\'est pas commun à tous' : `les frères ne partagent pas un numéro (${[...cles].join(' / ') || 'aucun'})`, selonLeCahier: false, tampon: [] };
    const numero = numeros[0];
    if (hits.length) {
        const autre = hits.find(h => cleNumero(h.localId) !== cleNumero(numero));
        if (autre) return { numeroFiche: null, statut: 'sans-tampon-prouve', motif: `TCGdex place ce produit au numéro ${autre.localId}, les frères au numéro ${numero} : deux sources en désaccord`, selonLeCahier: true, tampon: [] };
        return { numeroFiche: numero, statut: 'sans-tampon-prouve', motif: 'TCGdex nomme ce produit sans tampon, au numéro des frères', selonLeCahier: true, tampon: [] };
    }
    // aucune preuve de variante
    const freresTamponnes = [...parProduit.keys()].filter(id => (clone.parProduit.get(id) || []).some(h => h.variante?.stamp?.length));
    if (freresTamponnes.length) return { numeroFiche: null, statut: 'sans-preuve', motif: `un frère connu est tamponné (${freresTamponnes.join(', ')}) : ce produit peut être l'autre tampon`, selonLeCahier: false, tampon: [] };
    const trouvees = [];
    for (const setId of clone.setsParExpansion.get(p.idExpansion) || []) {
        const c = clone.carte(setId, numero) || clone.carte(setId, String(numero).replace(/^0+(?=\d)/, ''));
        if (c) trouvees.push({ setId, c });
    }
    if (!trouvees.length) return { numeroFiche: null, statut: 'sans-preuve', motif: 'la carte est absente du clone TCGdex : rien n\'est connu de ses tampons', selonLeCahier: true, tampon: [] };
    const nonNommes = trouvees.flatMap(t => t.c.variantes.filter(v => v.stamp.length && v.cardmarket == null));
    if (nonNommes.length) return { numeroFiche: null, statut: 'sans-preuve', motif: `la carte porte une variante tamponnée que personne ne nomme (${[...new Set(nonNommes.flatMap(v => v.stamp))].join(', ')}) : le produit peut en être une`, selonLeCahier: true, tampon: [] };
    return { numeroFiche: numero, statut: 'sans-preuve', motif: 'aucune preuve de variante, mais aucun tampon connu ni inconnu sur cette carte', selonLeCahier: true, tampon: [] };
}

module.exports = { numeroDeLaFiche };
