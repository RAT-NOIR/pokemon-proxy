'use strict';
// ============================================================
// `numeroFiche` AVEC SA LETTRE (« 84 » → « 84a ») — feu vert NOMMÉ de l'éditeur, 2026-10-27
// ============================================================
// SOURCE : le numéro du produit Cardmarket, lettre comprise (vignette du produit lue le 2026-10-27, S8\PRIORITES\yellow-a-base.json).
// Une garde s'écrit par ce qu'elle AUTORISE : une ligne n'est écrite que si TOUT ceci est vrai —
//   · le produit a exactement UNE ligne cartes_produits ;
//   · la valeur visée a la forme ^\d+[a-z]$ ;
//   · la ligne n'a pas de numeroFiche, OU un numeroFiche dont les chiffres (sans zéros de tête) sont ceux de la valeur visée sans sa lettre ;
// sinon refus NOMMÉ, rien n'est écrit pour ce produit. Une ligne qui porte déjà la valeur visée est « déjà faite » (idempotent).
const FORME = /^\d+[a-z]$/;
const PREUVE = 'numéro du produit Cardmarket avec sa lettre (vignette du produit lue le 2026-10-27, S8\\PRIORITES) ; feu vert nommé de l\'éditeur du 2026-10-27';
const sansZeros = s => String(s).replace(/^0+(?=\d)/, '');
const vide = v => v === null || v === undefined || v === '';

/**
 * @param {Array<{idProduct:number, carte?:string, numero:string}>} produits  la liste fermée (yellow-a-base.json)
 * @param {Map<number, Array<{_id:string, idProduct:number, slugSet?:string, numeroFiche?:string|null}>>} lignesParProduit  la base, lue
 */
function planifier(produits, lignesParProduit) {
    const pose = [], deja = [], refus = [];
    const vus = new Set();
    for (const p of produits || []) {
        const id = p.idProduct;
        if (vus.has(id)) { refus.push({ idProduct: id, carte: p.carte, raison: 'produit en double dans la liste' }); continue; }
        vus.add(id);
        const visee = typeof p.numero === 'string' ? p.numero.trim() : p.numero;
        if (typeof visee !== 'string' || !FORME.test(visee)) { refus.push({ idProduct: id, carte: p.carte, raison: `numéro « ${p.numero} » : pas de la forme chiffres+lettre` }); continue; }
        const ls = lignesParProduit.get(id) || [];
        if (ls.length !== 1) { refus.push({ idProduct: id, carte: p.carte, raison: ls.length ? `${ls.length} lignes cartes_produits — une seule attendue` : 'aucune ligne cartes_produits' }); continue; }
        const l = ls[0];
        if (l._id === undefined || l._id === null) { refus.push({ idProduct: id, carte: p.carte, raison: 'ligne sans _id' }); continue; }
        const avant = vide(l.numeroFiche) ? null : String(l.numeroFiche);
        if (avant === visee) { deja.push({ idProduct: id, _id: l._id, slugSet: l.slugSet, numeroFiche: visee }); continue; }
        if (avant !== null && sansZeros(avant) !== sansZeros(visee.slice(0, -1))) { refus.push({ idProduct: id, carte: p.carte, raison: `numeroFiche « ${avant} » déjà posé : ses chiffres ne sont pas ceux de « ${visee} »` }); continue; }
        pose.push({ idProduct: id, carte: p.carte, _id: l._id, slugSet: l.slugSet ?? null, avant, numeroFiche: visee, preuve: PREUVE });
    }
    const parRaison = {};
    for (const r of refus) { const k = r.raison.replace(/« [^»]* »/g, '«…»').replace(/^\d+ lignes/, 'N lignes'); parRaison[k] = (parRaison[k] || 0) + 1; }
    return { pose, deja, refus, comptes: { liste: (produits || []).length, pose: pose.length, deja: deja.length, refus: refus.length, parRaison } };
}

module.exports = { FORME, PREUVE, planifier };
