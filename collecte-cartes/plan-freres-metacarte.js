// ============================================================
// LE PLAN D'UN SET (clé des frères + numéro de la fiche) ET CE QU'IL CHANGERAIT POUR LE SITE — UNE définition pour la simulation et l'écriture (§21 bis)
// ============================================================
const K = require('./cle-freres-metacarte');
const { numeroDeLaFiche } = require('./numero-fiche-freres');

/**
 * @param {object} o
 * @param {object[]} o.produits   les produits décomposés du set (idProduct, name, nom, attaques, idMetacard, idExpansion), SANS les cartes-code
 * @param {Set<number>} o.jointsIds  les produits qui ont déjà une ligne (hors celles de cet outil : la reprise rejoue le même plan)
 * @param {{freres: Map, set: object}} o.ctx  indexerFreres(...) et preparerSet(...)
 * @param {object} o.clone  lireClone(...) de variantes-tcgdex.js
 * @returns {{retenus: Array<{p, d, num, freresLignes}>, refus: Array<{p, raison, niveau}>}}
 */
function planDuSet({ produits, jointsIds, ctx, clone, tirage = null, expansions = [] }) {
    const retenus = [], refus = [];
    for (const p of produits.filter(x => !jointsIds.has(x.idProduct))) {
        const d = K.designerParFreres(ctx, p);
        if (!d.carte) { refus.push({ p, raison: d.raison, niveau: d.niveau }); continue; }
        // les lignes des frères JOINTS (leur numeroFiche), lues dans le même index que la désignation
        const groupe = ctx.freres.get(`${p.idMetacard}|${p.idExpansion}`) || new Map();
        const freresLignes = [...groupe].filter(([id]) => id !== p.idProduct).flatMap(([id, ls]) => ls.map(l => ({ idProduct: id, numeroFiche: l.numeroFiche ?? null })));
        const num = numeroDeLaFiche({ p, clone, freres: freresLignes });
        // 🔴 LA RÈGLE DU TOUR 1, sur la donnée DURABLE : une carte qui n'a qu'UN numéro (ou aucun) dans le set n'a qu'une fiche, et le site y place TOUT produit sans
        // numéro — le premier scan collecté à ce numéro lui serait servi, sans preuve de variante (MEP, Pikachu 093). Le numéro n'est pas posé (pas de preuve) : la
        // ligne n'est pas écrite, sauf preuve de variante SANS tampon (TCGdex nomme le produit). Aucune lecture de l'état des images du jour.
        if (num.numeroFiche == null && num.statut !== 'sans-tampon-prouve') {
            const nums = numerosDuSet(d.carte, tirage, expansions);
            if (nums.length <= 1) { refus.push({ p, niveau: 4, raison: `la carte ${d.carte._id} n'a qu'un numéro (${nums[0] ?? 'aucun'}) dans le set : le site y placerait ce produit et lui servirait le scan de la carte, sans preuve de variante (numéro non posé : ${num.motif})` }); continue; }
        }
        retenus.push({ p, d, num, freresLignes });
    }
    return { retenus, refus };
}

/** Les numéros distincts (cleNumero de la production) des impressions de la carte dans CE set (tirage et noms d'expansion de la ligne). */
function numerosDuSet(carte, tirage, expansions) {
    const { cleNumero } = require('./jointure');
    const ns = (carte.impressions || []).filter(i => i && i.tirage === tirage && expansions.includes(i.expansion) && i.numero != null && String(i.numero).trim() !== '').map(i => cleNumero(i.numero));
    return [...new Set(ns)];
}

/**
 * Ce que les lignes ajoutées changeraient pour le SITE, par la règle du site IMPORTÉE (jamais recopiée) : fiches (`fichesDesProduits`) et visuels servis
 * (`imageDeLImpression` sur les entrées admises par `refusDuVisuel`), avant et après. Un produit qui avait une fiche ou un visuel et le perd est un PERDU.
 * @param {{regle: object, fichesDesProduits: Function, refusDuVisuel: Function, imageDeLImpression: Function}} site
 * @param {object} setDoc  le document `sets`
 * @param {object[]} docs  les cartes du set (nomEn, impressions, images)
 * @param {object[]} lignesAvant  cartes_produits de l'expansion du set (hors lignes de cet outil)
 * @param {object[]} ajoutees  { idProduct, carteId, idExpansion, slugSet, numeroFiche }
 */
function simulerSet({ site, setDoc, docs, lignesAvant, ajoutees }) {
    const tir = setDoc.tirage ?? setDoc.region;
    const parId = new Map(docs.map(d => [d._id, d]));
    const evaluer = lignes => {
        const F = site.fichesDesProduits(site.regle, setDoc, docs, lignes);
        const fiche = new Set(), servi = new Set();
        for (const l of lignes) {
            const f = F.fiche.get(l.idProduct);
            if (!f || f.carteId !== l.carteId) continue;
            fiche.add(l.idProduct);
            const entrees = (parId.get(l.carteId)?.images || []).filter(e => e && e.set === setDoc._id && e.cleR2);
            if (site.imageDeLImpression(entrees.filter(e => site.refusDuVisuel(e, tir) === null), f.numero) !== null) servi.add(l.idProduct);
        }
        return { fiche, servi, doubles: F.doubles };
    };
    const avant = evaluer(lignesAvant), apres = evaluer([...lignesAvant, ...ajoutees]);
    const ids = new Set(ajoutees.map(a => a.idProduct));
    const perdusFiche = [...avant.fiche].filter(id => !apres.fiche.has(id)), perdusServi = [...avant.servi].filter(id => !apres.servi.has(id));
    return { avant: { fiches: avant.fiche.size, servis: avant.servi.size, doubles: avant.doubles }, apres: { fiches: apres.fiche.size, servis: apres.servi.size, doubles: apres.doubles },
        ajouteesAvecFiche: [...ids].filter(id => apres.fiche.has(id)).length, ajouteesServies: [...ids].filter(id => apres.servi.has(id)), perdusFiche, perdusServi };
}

module.exports = { planDuSet, simulerSet };
