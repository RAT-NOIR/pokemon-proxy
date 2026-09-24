// ============================================================
// LA GARDE BIDIRECTIONNELLE D'UNE JOINTURE PAR LE NOM SEUL — une définition, pour la calibration et pour la collecte
// ============================================================
// Extraite de rejouer-nom-seul.js le 2026-09-24, au moment où un second appelant est apparu : la collecte « sans page »
// d'une expansion SANS AUCUN numéro (Unnumbered Promos, 4170), où le nom est la seule clé (§21 bis : deux copies d'une
// règle divergent toujours).
// La règle, énoncée avant d'avoir vu le résultat (2026-09-23) : une ligne jointe par le nom n'est gardée que si son produit
// est le SEUL produit de l'expansion à porter ce nom, ET sa carte la SEULE carte du set à le porter, ET le produit ne
// désigne qu'une carte. Multiplicités COMPTÉES, jamais un `Set` (§34).
// 🔑 CALIBRÉE SUR CE QUI MARCHE (rejouer-nom-seul.js, numéros masqués sur 55 413 jointures par le numéro) : 21 925 justes,
// 0 faux. Et DANS LES 178 SETS DE RÉIMPRESSIONS, garde passée : 9 031 justes, 0 faux — l'exclusion des réimpressions ne
// protège rien de plus une fois cette garde appliquée (mesuré le 2026-09-24).
// Une ligne jointe par un NUMÉRO (preuve contenant « numero ») n'est jamais touchée : ce n'est pas le nom qui l'a faite.
const { normaliserNom } = require('./jointure');

const cleNom = n => normaliserNom(String(n || '').replace(/^Basic\s+/i, ''));

/**
 * @param {{ lignes: object[], produits: object[], cartes: object[] }} x  les lignes de `joindre()`, les produits de
 *        l'expansion, les cartes du set (la population entière, pas seulement les jointes)
 * @returns {{ gardees: object[], refusees: { idProduct: number, raison: string }[] }}
 */
function gardeNomSeul({ lignes, produits, cartes }) {
    const nProd = new Map(); for (const p of produits) { const k = cleNom(p.nom); nProd.set(k, (nProd.get(k) || 0) + 1); }
    const nCarte = new Map(); for (const c of cartes) { const k = cleNom(c.nomEn); nCarte.set(k, (nCarte.get(k) || 0) + 1); }
    const produitDe = new Map(produits.map(p => [p.idProduct, p]));
    const carteDe = new Map(cartes.map(c => [c._id, c]));
    const parProduit = new Map();
    for (const l of lignes) (parProduit.get(l.idProduct) || parProduit.set(l.idProduct, []).get(l.idProduct)).push(l);
    const gardees = [], refusees = [];
    for (const [idProduct, ls] of parProduit) {
        if (ls.every(l => /numero/.test(l.preuve || ''))) { gardees.push(...ls); continue; }
        const cartesDuProduit = new Set(ls.map(l => l.carteId));
        const np = nProd.get(cleNom(produitDe.get(idProduct)?.nom)) || 0;
        const nc = nCarte.get(cleNom(carteDe.get(ls[0].carteId)?.nomEn)) || 0;
        const raison = cartesDuProduit.size > 1 ? `produit joint à ${cartesDuProduit.size} cartes`
            : np !== 1 ? `nom de produit porté par ${np} produits`
            : nc !== 1 ? `nom de carte porté par ${nc} cartes` : null;
        if (raison) refusees.push({ idProduct, raison }); else gardees.push(...ls);
    }
    return { gardees, refusees };
}

module.exports = { gardeNomSeul, cleNom };
