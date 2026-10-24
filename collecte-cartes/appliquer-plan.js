'use strict';
// ============================================================
// L'ÉTAT « APRÈS » D'UN LOT, EN MÉMOIRE — une seule définition (PHASE 3a-SUITE, §21 bis)
// ============================================================
// Un « plan » est le fichier que les outils de pose écrivent avec `--plan=` (poser-wcd, poser-reimpressions, poser-fiches-par-freres, poser-fiches-par-setlist, poser-par-metacarte,
// poser-fiches-deux-sources) : { lignes: [{_id, carteId, idProduct, idExpansion, numeroFiche, slug, slugSet, …}], cartes: [fiches simples], cartesSets: [{carteId, set}], impressions: [{carteId, imp}] }.
// Cette fonction applique des plans à un état lu, SANS rien écrire et SANS modifier l'état reçu (copie à l'écriture) : comme `$setOnInsert` / upsert, une ligne dont l'_id existe n'est pas touchée ; le set
// n'est ajouté à une carte que s'il y manque ; une impression n'est ajoutée que si (tirage, expansion, numéro) est absent. Elle sert à simuler la chaîne de l'API (simuler-lot-api.js) et les compteurs A, B, C (simuler-abc.js).
const J = require('./jointure');

/** @param {{cartes: object[], cartesProduits: object[]}} etat  @param {object[]} plans @returns {{cartes: object[], cartesProduits: object[], ajoutees: object[], dejaLa: object[], carteAbsente: number}} */
function appliquerPlans({ cartes, cartesProduits }, plans) {
    const connus = new Set(cartesProduits.map(l => String(l._id)));
    const lignesApres = cartesProduits.slice(), ajoutees = [], dejaLa = [];
    const cartesApres = cartes.slice(), idxCarte = new Map(cartes.map((c, i) => [c._id, i]));
    const copier = id => { const i = idxCarte.get(id); if (i === undefined) return null; const c = cartesApres[i]; if (!c.__copie) cartesApres[i] = { ...c, sets: [...(c.sets || [])], impressions: [...(c.impressions || [])], __copie: true }; return cartesApres[i]; };
    let carteAbsente = 0;
    // les CARTES que le plan créerait (fiches simples) entrent d'abord, pour que leurs lignes les trouvent ; une carte déjà en base n'est pas touchée
    for (const p of plans) for (const c of p.cartes || []) if (!idxCarte.has(c._id)) {
        idxCarte.set(c._id, cartesApres.length);
        cartesApres.push({ _id: c._id, nomEn: c.nomEn, sets: [...(c.sets || [])], attaques: (c.attaques || []).map(a => ({ ...a })), impressions: (c.impressions || []).map(i => ({ tirage: i.tirage, expansion: i.expansion, numero: i.numero, total: i.total ?? null, deck: i.deck ?? null, rarete: i.rarete ?? null })), images: [] });
    }
    for (const p of plans) {
        for (const l of p.lignes || []) {
            if (!idxCarte.has(l.carteId)) carteAbsente++;
            if (connus.has(String(l._id))) { dejaLa.push(l); continue; }
            connus.add(String(l._id));
            const d = { _id: l._id, carteId: l.carteId, idProduct: l.idProduct, idExpansion: l.idExpansion };
            if (l.numeroFiche != null) d.numeroFiche = l.numeroFiche;
            if (l.slug != null) d.slug = l.slug;
            if (l.slugSet != null) d.slugSet = l.slugSet;
            if (l.preuve != null) d.preuve = l.preuve;
            if (l.tirage != null) d.tirage = l.tirage;
            lignesApres.push(d); ajoutees.push(d);
        }
        for (const x of p.cartesSets || []) { const c = copier(x.carteId); if (c && !c.sets.includes(x.set)) c.sets.push(x.set); }
        for (const x of p.impressions || []) {
            const c = copier(x.carteId); if (!c) continue;
            if (!c.impressions.some(i => i.tirage === x.imp.tirage && i.expansion === x.imp.expansion && J.cleNumero(i.numero) === J.cleNumero(x.imp.numero))) c.impressions.push({ tirage: x.imp.tirage, expansion: x.imp.expansion, numero: x.imp.numero, total: x.imp.total ?? null, deck: x.imp.deck ?? null, rarete: x.imp.rarete ?? null });
        }
    }
    // `numerosFiche` (poser-numerotation.js) : le numéro posé sur une ligne EXISTANTE dont le numeroFiche est nul ou absent ; jamais une valeur remplacée (comme `numeroFiche: { $in: [null, ''] }` en base)
    let numeroFicheIntrouvable = 0;
    const idxLigne = new Map(lignesApres.map((l, i) => [String(l._id), i]));
    for (const p of plans) for (const n of p.numerosFiche || []) {
        const i = idxLigne.get(String(n._id)); if (i === undefined) { numeroFicheIntrouvable++; continue; }
        const l = lignesApres[i]; if (l.numeroFiche == null || l.numeroFiche === '') lignesApres[i] = { ...l, numeroFiche: n.numeroFiche };
    }
    return { cartes: cartesApres, cartesProduits: lignesApres, ajoutees, dejaLa, carteAbsente, numeroFicheIntrouvable };
}

// Les outils qui ne posent PAS de ligne : ils posent une impression sur la carte (et un numeroFiche) pour des lignes qui EXISTENT déjà. Les produits de leur lot sont donc toutes les lignes de leur plan.
const OUTILS_SUR_LIGNES_EXISTANTES = new Set(['poser-impressions-setlist', 'poser-numerotation']);
/** @returns {Set<number>} les idProduct du lot : les lignes ajoutées + (outils sur lignes existantes) toutes les lignes du plan */
function produitsDuLot(plans, ajoutees) {
    const ids = new Set(ajoutees.map(l => l.idProduct));
    for (const p of plans) if (OUTILS_SUR_LIGNES_EXISTANTES.has(p.outil)) for (const l of p.lignes || []) ids.add(l.idProduct);
    return ids;
}

module.exports = { appliquerPlans, produitsDuLot, OUTILS_SUR_LIGNES_EXISTANTES };
