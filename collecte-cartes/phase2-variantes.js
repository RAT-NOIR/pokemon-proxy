// PHASE 2 v2, volet 2 — MESURE (rien n'est écrit) : la `variante` de la LIGNE sépare-t-elle, sur une entrée partagée, un produit « autre impression du même dessin » d'un produit juste ?
// Le mécanisme de l'API (decision.js, partage-variante.js, marques-tampon.js — importés, jamais recopiés) : une entrée marquée `partageeTamponNonSepare: false` SANS liste `produitsPartages` n'est servie qu'aux produits dont
// la ligne porte une variante de la liste fermée (une marque, jumbo, normale) AVEC sa preuve ; tout autre produit est REFUSÉ (`partageIncoherent`, fail-closed) — c'est l'exclusion cherchée. Module PUR.
'use strict';
const num = n => (n === undefined || n === null || String(n).trim() === '' ? null : String(n).trim());

/** Le jeton EXACT de l'API pour une marque lue, ou null (« aucun jeton ») : jamais deviné, jamais « corrigé ». `api` : la chaîne importée (estVariante). */
function jetonDe(marque, api) { return typeof marque === 'string' && api.estVariante(marque) ? marque : null; }

/**
 * L'état APRÈS écriture simulée de la séparation, en mémoire (ne modifie jamais l'entrée).
 * @param groupes [{ carteId, set, numero, cleR2, justes: [idProduct], cibles: [{ idProduct, jeton|null }] }]
 * @param scenario 'exclusion' : les justes prennent « normale », les cibles n'ont AUCUN jeton (donc sont refusées) ·
 *                 'jeton'     : idem, mais une cible qui a un jeton le reçoit (elle reste servie, distinguée).
 */
function simulerSeparation({ cartes, cartesProduits }, groupes, scenario) {
    if (scenario !== 'exclusion' && scenario !== 'jeton') throw new Error(`simulerSeparation : scénario « ${scenario} » inconnu`);
    const variantes = new Map();   // `${carteId}|${idProduct}` → jeton
    const entrees = new Map();     // carteId → [{ set, numero, cleR2 }]
    for (const g of groupes) {
        const c = cartes.find(x => x._id === g.carteId);
        const nb = (c?.images || []).filter(m => m.set === g.set && m.cleR2 === g.cleR2 && num(m.numero) === num(g.numero)).length;
        if (nb !== 1) throw new Error(`simulerSeparation : ${nb} entrée(s) (${g.set}, ${g.cleR2}) sur la carte ${g.carteId} : une seule attendue`);
        const aLigne = id => cartesProduits.some(l => l.idProduct === id && l.carteId === g.carteId);
        for (const id of [...g.justes, ...g.cibles.map(x => x.idProduct)]) if (!aLigne(id)) throw new Error(`simulerSeparation : le produit ${id} n'a pas de ligne sur la carte ${g.carteId} : il ne partage pas cette entrée`);
        for (const id of g.justes) variantes.set(`${g.carteId}|${id}`, 'normale');
        if (scenario === 'jeton') for (const x of g.cibles) if (x.jeton) variantes.set(`${g.carteId}|${x.idProduct}`, x.jeton);
        if (!entrees.has(g.carteId)) entrees.set(g.carteId, []);
        entrees.get(g.carteId).push(g);
    }
    return {
        cartes: cartes.map(c => {
            const gs = entrees.get(c._id);
            return gs ? { ...c, images: c.images.map(m => (gs.some(g => m.set === g.set && m.cleR2 === g.cleR2 && num(m.numero) === num(g.numero)) ? { ...m, partageeTamponNonSepare: false } : m)) } : c;
        }),
        cartesProduits: cartesProduits.map(l => { const v = variantes.get(`${l.carteId}|${l.idProduct}`); return v ? { ...l, variante: v, variantePreuve: 'mesure phase 2 (simulation, rien d\'écrit)' } : l; })
    };
}

module.exports = { jetonDe, simulerSeparation };
