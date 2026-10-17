'use strict';
// ============================================================
// RETRAIT DES SUBSTITUTS — retirer une image retire aussi les `cartes_produits.visuelSubstitut` qui la servent (lot VIGN-SUITE, 2026-10-17)
// ============================================================
// Deux chemins servent une image : `cartes.images` (le visuel du set) ET `cartes_produits.visuelSubstitut` (le visuel de substitution, que le site et
// l'exporteur lisent quand la fiche n'a pas le sien). `retirer-visuels.js` ne connaissait que le premier : le 17/10, 9 images fausses retirées,
// trois lignes WCD (865714, 865715, 867385) servaient encore `tcgdex/Roaring-Skies/92-203164.webp` par le second, preuve caduque comprise.
//
// UNE GARDE S'ÉCRIT PAR CE QU'ELLE AUTORISE : seules les lignes dont `visuelSubstitut.cleR2` est EXACTEMENT une clé de la liste (égalité de chaîne,
// ni préfixe ni inclusion). Le filtre d'écriture reprend la clé : une ligne qui a changé depuis la simulation ne matche pas.
// Trace (même forme que `retrait` des documents images : date, motif, état d'avant) : `visuelSubstitutRetrait { le, motif, cleR2, avant }`, où
// `avant` est l'ancien substitut tel quel (mention, preuve, lot…) — réversible en remettant `avant` dans `visuelSubstitut`.
// Pure par rapport à la base : `db` est injecté (find().toArray, updateOne, countDocuments).

const verifierCles = cles => {
    if (!Array.isArray(cles) || !cles.length || cles.some(c => typeof c !== 'string' || !c)) throw new Error('liste de clés vide ou invalide : une clé est une chaîne non vide (cleR2) — rien n\'est lu');
};

/** @returns {Promise<string[]>} les clés des documents `images` déjà à l'état « retire » */
async function clesDejaRetirees(db) {
    const docs = await db.collection('images').find({ etat: 'retire' }, { projection: { cleR2: 1 } }).toArray();
    return [...new Set(docs.map(d => d.cleR2).filter(c => typeof c === 'string' && c))];
}

/** Les lignes dont le substitut vise EXACTEMENT une des clés. @returns {Promise<{_id, idProduct, carteId, slugSet, cleR2, lot}[]>} */
async function planPourCles(db, cles) {
    verifierCles(cles);
    const demandees = new Set(cles);
    const lignes = await db.collection('cartes_produits').find({ 'visuelSubstitut.cleR2': { $in: [...demandees] } }, { projection: { idProduct: 1, carteId: 1, slugSet: 1, visuelSubstitut: 1 } }).toArray();
    return lignes.filter(l => demandees.has(l.visuelSubstitut?.cleR2))
        .map(l => ({ _id: l._id, idProduct: l.idProduct, carteId: l.carteId, slugSet: l.slugSet, cleR2: l.visuelSubstitut.cleR2, lot: l.visuelSubstitut.lot ?? null, avant: l.visuelSubstitut }));
}

/** Écrit le plan. @returns {Promise<number>} lignes détachées */
async function detacher(db, plan, { motif, le = new Date() }) {
    if (typeof motif !== 'string' || motif.length < 10) throw new Error('motif de 10 caractères au moins requis');
    let n = 0;
    for (const x of plan) {
        n += (await db.collection('cartes_produits').updateOne(
            { _id: x._id, 'visuelSubstitut.cleR2': x.cleR2 },
            { $set: { visuelSubstitutRetrait: { le, motif, cleR2: x.cleR2, avant: x.avant } }, $unset: { visuelSubstitut: '' } })).modifiedCount;
    }
    return n;
}

module.exports = { clesDejaRetirees, planPourCles, detacher };
