'use strict';
// ============================================================
// APPARTENANCE PAR PRODUIT — module PUR (agent catalogue, 2026-11-07). Aucune base, aucun réseau.
// ============================================================
// Règle du testeur (03/11) : la composition d'un set est celle des produits Cardmarket de CE set ; une fiche sans produit dans son set est un CLONE.
// `collecteur-texte.js` n'inscrit donc le slug dans `cartes.sets` que pour une carte qui a au moins un produit du set. ADDITIF SEULEMENT : il ne retire
// rien (retirer est le lot clones, collecte-cartes/clones.js).
// 🔑 UNE SEULE DÉFINITION de « a un produit dans le set » : `aUnProduitDuSet`, lue par clones.js (classerClones) ET par la règle d'ajout (§21 bis).

/** La carte a-t-elle un produit dans ce set : une ligne cartes_produits du set vers elle, ou un produit SANS_LIGNE du set que la jointure lui attribue (`fiche`). */
function aUnProduitDuSet(carteId, slugSet, lignes, produitsAttribues) {
    return (lignes || []).some(l => l && l.carteId === carteId && l.slugSet === slugSet)
        || (produitsAttribues || []).some(p => p && p.fiche && p.fiche.carteId === carteId && p.fiche.setId === slugSet);
}

/**
 * @param slugSet            le slug du set (non vide)
 * @param cartesJointes      [{_id, sets}] les cartes énumérées par la Setlist (ou la voie « sans page »)
 * @param lignesDuSet        [{carteId, slugSet}] les lignes cartes_produits de CE set
 * @param produitsAttribues  [{fiche:{carteId,setId}}] produits SANS_LIGNE du set attribués par la jointure (facultatif)
 * @returns {{ajouter, refusees, dejaMembres, setSansProduit, message}} — `refusees` : {carteId, raison:'sans-produit-du-set'}
 */
function cartesAAjouterAuSet(slugSet, cartesJointes, lignesDuSet, produitsAttribues = []) {
    if (typeof slugSet !== 'string' || !slugSet.trim()) throw new Error('cartesAAjouterAuSet : slug de set vide — jamais de repli');
    if (!Array.isArray(cartesJointes)) throw new Error('cartesAAjouterAuSet : cartesJointes doit être un tableau');
    const lignes = lignesDuSet || [];
    const ajouter = [], refusees = [], dejaMembres = [], vus = new Set();
    for (const c of cartesJointes) {
        if (!c || vus.has(c._id)) continue;
        vus.add(c._id);
        if ((c.sets || []).includes(slugSet)) { dejaMembres.push(c._id); continue; }   // additif : on ne touche pas, on ne retire pas
        if (aUnProduitDuSet(c._id, slugSet, lignes, produitsAttribues)) ajouter.push(c._id);
        else refusees.push({ carteId: c._id, raison: 'sans-produit-du-set' });
    }
    const setSansProduit = !lignes.some(l => l && l.slugSet === slugSet) && !(produitsAttribues || []).some(p => p && p.fiche && p.fiche.setId === slugSet);
    const message = setSansProduit ? `${slugSet} : aucun produit du set (ni ligne, ni produit attribué) — aucune appartenance ajoutée, ${refusees.length} carte(s) refusée(s) sans produit du set` : '';
    return { ajouter, refusees, dejaMembres, setSansProduit, message };
}

/**
 * Les lignes cartes_produits lues pour l'appartenance, au format de aUnProduitDuSet : le `slugSet` RÉEL de la ligne est gardé (jamais forcé au slug — deux sets frères
 * sur le même idExpansion se distingueraient plus), les lignes DÉTACHÉES (`interdits` : Set « carte|produit », lignes-detachees.js::lireInterdits) sont exclues.
 */
function lignesDuSetPourAppartenance(lignes, interdits) {
    if (!(interdits instanceof Set)) throw new Error('lignesDuSetPourAppartenance : interdits (Set des lignes détachées) obligatoire — jamais de repli');
    return (lignes || []).filter(l => !interdits.has(typeof l._id === 'string' ? l._id : `${l.carteId}|${l.idProduct}`)).map(l => ({ carteId: l.carteId, slugSet: l.slugSet ?? null }));
}

/** L'étape 4 bis du collecteur : lit les lignes de l'expansion des cartes candidates, applique la règle, écrit (additif) le slug des seules cartes retenues. */
async function poserAppartenances({ M, slug, exp, cartes, interdits }) {
    const brutes = await M.CarteProduit.find({ carteId: { $in: cartes.map(c => c._id) }, idExpansion: exp }).select('_id carteId idProduct slugSet').lean();
    const AP = cartesAAjouterAuSet(slug, cartes, lignesDuSetPourAppartenance(brutes, interdits));
    if (AP.ajouter.length) await M.Carte.updateMany({ _id: { $in: AP.ajouter } }, { $addToSet: { sets: slug } });
    return AP;
}

/** Les candidates de la jointure : membres du set ∪ pages écrites (état « ok » de collecte_etat + exécution courante). `pagesEcrites` est relu à chaque appel. */
function fabriquerCandidates({ M, slug, pagesEcrites }) {
    return async (champs = null) => {
        const etatPages = (await M.Etat.findById(slug).select('pages').lean())?.pages || [];
        const ids = [...new Set([...etatPages.filter(p => p.etat === 'ok' && p.pageid != null).map(p => p.pageid), ...pagesEcrites])];
        const q = M.Carte.find({ $or: [{ sets: slug }, { _id: { $in: ids } }] });
        return (champs ? q.select(champs) : q).lean();
    };
}

module.exports = { aUnProduitDuSet, cartesAAjouterAuSet, lignesDuSetPourAppartenance, poserAppartenances, fabriquerCandidates };
