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

// CE QUI A ÉTÉ LU À L'ŒIL sur les planches (lot B et lot C de l'audit S8) : la marque ou la finition qui distingue la cible du produit juste. `marque` : le nom de la marque telle que la liste de l'API l'écrit, ou null si la
// distinction n'est PAS une marque de la liste (finition, format, tampon d'un autre nom). Le jeton est ensuite VÉRIFIÉ contre la vraie liste (jetonDe), jamais tapé. UNE seule définition (PHASE 3b : elle vivait dans
// mesure-variantes-phase2.js ; l'outil d'écriture separer-variantes-phase2.js la lit ICI — §21 bis, la mesure et l'écriture ne peuvent pas lire deux tables).
const LU = Object.freeze(new Map([
    [752306, { quoi: 'tampon Toys R Us présent chez Cardmarket, absent de notre scan', marque: 'toys-r-us' }],
    [873081, { quoi: 'tampon Toys R Us, holo', marque: 'toys-r-us' }],
    [722696, { quoi: 'tampon « Holo 20th Anniversary Stamp Promo »', marque: null }],
    [362873, { quoi: 'carte Oversized (« Attention: Oversized Card »)', marque: 'jumbo' }],
    [362872, { quoi: 'carte Oversized', marque: 'jumbo' }],
    [362871, { quoi: 'carte Oversized', marque: 'jumbo' }],
    [901316, { quoi: 'version « Non-Holo » (finition)', marque: null }],
    [901315, { quoi: 'version « Non-Holo » (finition)', marque: null }],
    [576708, { quoi: 'version « Non-Holo » (finition)', marque: null }],
    [855023, { quoi: 'version « Non-Holo » (finition, Lava Theme Deck)', marque: null }],
    [280583, { quoi: 'finition foil du même dessin', marque: null }],
    [538823, { quoi: 'finition holo, tampon 25e anniversaire des deux côtés', marque: null }],
    [858713, { quoi: 'finition reverse holo', marque: null }]
]));

/**
 * Les GROUPES (une entrée, ses cibles avec leur jeton, ses produits justes) depuis les cibles « emprunt » de la table fermée de la phase 2 et la décision de l'API sur l'état ACTUEL.
 * LÈVE si les produits servis par une clé ne sont pas EXACTEMENT les cibles et les justes de la table (table périmée ou base changée), ou si une cible n'a pas été lue (`lu`).
 * @param cibles   P.ECARTES filtrées sur geste 'emprunt' (idProduct, carteId, set, numero, cleR2, partageAvec)
 * @param servisParCle  Map cleR2 → [idProduct triés] (P.produitsServisParCle(entrees de decider))
 * @param api      la chaîne importée (estVariante) · @param lu  la table LU (défaut : celle-ci)
 */
function construireGroupes({ cibles, servisParCle, api, lu = LU, verifierServis = true }) {
    const groupes = [];
    const parCle = {};
    for (const x of cibles) (parCle[x.cleR2] ||= []).push(x);
    for (const [cle, xs] of Object.entries(parCle)) {
        const x0 = xs[0], justes = [...new Set(xs.flatMap(x => x.partageAvec))], servisCle = servisParCle?.get(cle) || [];
        const attendus = [...justes, ...xs.map(x => x.idProduct)].sort((a, b) => a - b);
        // `verifierServis: false` : le RETRAIT d'une séparation déjà écrite (l'API ne sert plus les cibles sans jeton) ; l'état se vérifie alors ligne par ligne, pas par ce que l'API sert
        // l'état FINAL d'une séparation déjà écrite (ou à moitié) est aussi admis : l'API y sert les justes et les cibles À JETON, plus les cibles sans jeton — planifier() décide alors « deja » ligne par ligne
        const finals = [...justes, ...xs.filter(x => lu.has(x.idProduct) && jetonDe(lu.get(x.idProduct).marque, api)).map(x => x.idProduct)].sort((a, b) => a - b);
        if (verifierServis && JSON.stringify(servisCle) !== JSON.stringify(attendus) && JSON.stringify(servisCle) !== JSON.stringify(finals)) throw new Error(`l'entrée ${cle} sert ${servisCle.join(',')} et non ${attendus.join(',')} : la table n'est plus celle qui a été mesurée`);
        for (const x of xs) if (!lu.has(x.idProduct)) throw new Error(`la cible ${x.idProduct} n'a pas été lue à l'oeil (table LU) : rien n'est décidé`);
        groupes.push({ carteId: x0.carteId, set: x0.set, numero: x0.numero, cleR2: cle, justes, cibles: xs.map(x => ({ idProduct: x.idProduct, jeton: jetonDe(lu.get(x.idProduct).marque, api) })) });
    }
    return groupes;
}

module.exports = { jetonDe, simulerSeparation, LU, construireGroupes };
