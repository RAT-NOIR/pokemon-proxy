// ============================================================
// ÉCRIRE LE RÉSULTAT D'UNE JOINTURE — une seule définition, deux appelants
// ============================================================
// `joindre()` CALCULE, ce module ÉCRIT : les lignes `cartes_produits`, les restes du set, et les liens
// dénormalisés portés par la carte. Extrait de collecteur-texte.js le 2026-09-19, au moment où un second
// appelant est apparu (la collecte SANS PAGE, qui prend ses cartes dans les expansions qu'elles déclarent).
//
// 🔑 POURQUOI EXTRAIRE PLUTÔT QUE RECOPIER : deux définitions de la même règle divergent toujours, et la
// seconde ne se découvre que par accident (§21 bis, quatre occurrences mesurées). Le geste d'écriture porte
// trois effets qu'on oublierait un par un dans une copie — l'upsert des lignes, le REMPLACEMENT des restes
// du set (sinon un reste corrigé survit à sa correction), et `liens.idProduct` / `liens.idMetacards`.

/**
 * @param M        modèles mongoose (modeles(cx))
 * @param slug     le slugSet de la ligne — les restes lui appartiennent
 * @param J        le retour de `joindre()` : { lignes, restes }
 * @param produits les produits Cardmarket de l'expansion (pour les métacartes)
 */
async function ecrireJointure(M, { slug, J, produits }) {
    for (const l of J.lignes) await M.CarteProduit.updateOne({ _id: l._id }, { $set: l }, { upsert: true });
    // Les restes du set sont REMPLACÉS, jamais ajoutés : un reste qu'une correction a fait disparaître
    // doit disparaître de la base, sinon le compte des trous ne descend jamais.
    // `fiche-contredite-par-le-nom` : le témoin du nom vit dans `joindre()` depuis le 2026-09-23 ; ses restes se remplacent
    // comme les autres, sinon chaque recollecte les ajouterait une fois de plus.
    await M.Reste.deleteMany({ set: slug, type: { $in: ['produit-sans-carte', 'carte-sans-produit', 'produit-vers-plusieurs-cartes', 'fiche-contredite-par-le-nom'] } });
    if (J.restes.length) await M.Reste.insertMany(J.restes.map(r => ({ ...r, set: slug, le: new Date() })));
    // liens dénormalisés sur la carte : produits joints, et leurs MÉTACARTES distinctes (le champ
    // singulier `idMetacard`, déclaré et jamais rempli, est retiré au passage).
    const metaDe = new Map(produits.map(p => [p.idProduct, p.idMetacard]));
    const parCarte = new Map();
    for (const l of J.lignes) { if (!parCarte.has(l.carteId)) parCarte.set(l.carteId, []); parCarte.get(l.carteId).push(l.idProduct); }
    for (const [carteId, ids] of parCarte) {
        const metas = [...new Set(ids.map(id => metaDe.get(id)).filter(m => m != null))];
        await M.Carte.updateOne({ _id: carteId }, { $addToSet: { 'liens.idProduct': { $each: ids }, 'liens.idMetacards': { $each: metas } }, $unset: { 'liens.idMetacard': 1 } });
    }
    return { lignes: J.lignes.length, restes: J.restes.length, cartes: parCarte.size };
}

module.exports = { ecrireJointure };
