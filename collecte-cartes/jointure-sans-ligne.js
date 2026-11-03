'use strict';
// ============================================================
// JOINTURE-SANS-LIGNE — règle PURE (agent catalogue, 2026-11-03). Aucune base, aucun réseau.
// Décision du testeur (03/11) : toute fiche sans produit dont le produit existe dans l'export (même set, même numéro, nom concordant) est JOINTE.
// Une fiche = une appartenance `cartes.sets` (carte x set) sans ligne cartes_produits dans ce set ; un produit candidat = un produit SANS_LIGNE de l'expansion du set.
// 🔑 Une garde s'écrit par ce qu'elle AUTORISE : le seul chemin vers `{ ligne }` passe par (a) le numéro ET le témoin du nom, ou (b) le nom seul ET gardeNomSeul. Tout le reste refuse, avec une raison.
// Les règles du site (impressionDuSet, normaliserNumero, expansionsDuSet, tirageDuSet) sont INJECTÉES, jamais recopiées (clones.js fait de même).
// La ligne a EXACTEMENT la forme de jointure.js:279.
// ============================================================
const { decomposerNomCardmarket, nomJointDe, clesNom, cleNumero, temoinDuNom } = require('./jointure');
const { gardeNomSeul, numerosExacts, cleNom } = require('./garde-nom-seul');

const RAISONS = Object.freeze(['carte-deja-jointe-dans-le-set', 'produit-deja-joint', 'plusieurs-produits-au-numero', 'nom-contredit', 'nom-contredit-numero', 'nom-ambigu', 'nom-inclus-seulement', 'aucun-produit']);
const motsDe = n => String(n || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
const refus = raison => ({ refus: raison });

/**
 * @param {{ carte: object, set: object, produitsSansLigne: object[], produitsDuSet?: object[], cartesDuSet: object[], lignesDuSet: {carteId:number,idProduct:number}[], regles: object }} x
 *   produitsSansLigne : {idProduct, idExpansion, name, numero?, slug?, slugSet?} ; produitsDuSet (facultatif, défaut = produitsSansLigne) : TOUS les produits de l'expansion, pour compter les homonymes ;
 *   lignesDuSet : les lignes cartes_produits DÉJÀ présentes dans ce set (à enrichir par l'appelant des lignes qu'il vient d'accepter).
 * @returns {{ligne: object}|{refus: string}}
 */
function jugerJointure({ carte, set, produitsSansLigne, produitsDuSet, cartesDuSet, lignesDuSet, regles }) {
    const { impressionDuSet, normaliserNumero, expansionsDuSet, tirageDuSet } = regles || {};
    for (const [k, f] of Object.entries({ impressionDuSet, normaliserNumero, expansionsDuSet, tirageDuSet })) if (typeof f !== 'function') throw new Error(`jugerJointure : règle injectée absente (${k}) — jamais de repli`);
    const idsExpansion = [].concat(set.idExpansion ?? []);
    if (!idsExpansion.length) throw new Error(`jugerJointure : le set ${set._id} n'a pas d'idExpansion`);
    // 1. la carte a déjà son produit dans ce set
    if (lignesDuSet.some(l => l.carteId === carte._id)) return refus('carte-deja-jointe-dans-le-set');
    const prisIds = new Set(lignesDuSet.map(l => l.idProduct));
    const sansLigne = produitsSansLigne.filter(p => idsExpansion.includes(p.idExpansion));
    const tous = (produitsDuSet || produitsSansLigne).filter(p => idsExpansion.includes(p.idExpansion));
    const cible = { tirage: tirageDuSet(set), expansions: expansionsDuSet(set), deck: set.deck ?? null };
    // le cache porte les attaques en chaînes, la production en {nom} : le témoin du nom lit {nom}
    const cartes = cartesDuSet.map(c => ({ ...c, attaques: (c.attaques || []).map(a => (typeof a === 'string' ? { nom: a } : a)) }));
    const laCarte = cartes.find(c => c._id === carte._id) || { ...carte, attaques: (carte.attaques || []).map(a => (typeof a === 'string' ? { nom: a } : a)) };
    const decomp = p => decomposerNomCardmarket(p.name);
    const cleN = n => { const v = normaliserNumero(n); return v === null || v === undefined ? null : cleNumero(v); };
    const imps = (carte.impressions || []).filter(i => impressionDuSet(i, cible));
    const ligneDe = (p, preuve, numeroFiche, detail) => ({ _id: `${carte._id}|${p.idProduct}`, carteId: carte._id, idProduct: p.idProduct, idExpansion: p.idExpansion, tirage: cible.tirage, preuve, detail, numeroFiche, slug: p.slug ?? null, slugSet: p.slugSet ?? set._id ?? null, verifieLe: new Date() });

    // 2. PAR LE NUMÉRO : le numéro de l'impression de la carte dans CE set désigne un produit de l'expansion
    const { numeroDuProduit } = numerosExacts({ produits: tous.map(p => ({ idProduct: p.idProduct, numero: p.numero, slug: p.slug })), cartes: [], tirage: cible.tirage, expansions: cible.expansions, deck: cible.deck, code: set.code });
    const clesCarte = new Map(imps.map(i => [cleN(i.numero), i.numero]).filter(([k]) => k !== null));
    const auNumero = clesCarte.size ? tous.filter(p => { const k = cleN(numeroDuProduit.get(p.idProduct)); return k !== null && clesCarte.has(k); }) : [];
    if (auNumero.length > 1) return refus('plusieurs-produits-au-numero');
    if (auNumero.length === 1) {
        const p = auNumero[0];
        if (prisIds.has(p.idProduct)) return refus('produit-deja-joint');
        if (!sansLigne.some(q => q.idProduct === p.idProduct)) return refus('produit-deja-joint');   // joint dans un AUTRE set : absent des sans-ligne
        // le témoin du nom : le nom décomposé ne doit désigner aucune AUTRE carte du set (jointure.js::temoinDuNom, la fonction de production)
        const d = decomp(p);
        if (temoinDuNom(cartes, p.idExpansion)(laCarte, { nom: d.nom, attaques: d.attaques })) return refus('nom-contredit');
        const num = clesCarte.get(cleN(numeroDuProduit.get(p.idProduct)));
        return { ligne: ligneDe(p, 'set+numero', String(num), `n°${num} parmi les ${sansLigne.length} produits sans ligne de l'expansion ${p.idExpansion} ; nom ne désignant aucune autre carte du set (« ${d.nom} »)`) };
    }

    // 3. PAR LE NOM SEUL : égalité de clé, puis la garde bidirectionnelle (un produit, une carte)
    const clesC = clesNom(nomJointDe(carte));
    const auNom = tous.filter(p => clesNom(decomp(p).nom).some(k => clesC.includes(k)));
    if (auNom.length === 0) {
        // inclusion de mots : jamais une égalité — comptée, jamais écrite
        const mots = motsDe(nomJointDe(carte));
        const inclus = sansLigne.some(p => { const m = new Set(motsDe(decomp(p).nom)); return mots.length > 0 && m.size > 0 && (mots.every(w => m.has(w)) || [...m].every(w => mots.includes(w))); });
        return refus(inclus ? 'nom-inclus-seulement' : 'aucun-produit');
    }
    if (auNom.length > 1) return refus('nom-ambigu');
    const p = auNom[0];
    if (prisIds.has(p.idProduct)) return refus('produit-deja-joint');
    if (!sansLigne.some(q => q.idProduct === p.idProduct)) return refus('aucun-produit');
    // le produit porte un numéro, la carte en a dans ce set, aucun ne correspond : le numéro contredit le nom
    const numP = cleN(numeroDuProduit.get(p.idProduct));
    if (numP !== null && clesCarte.size && !clesCarte.has(numP)) return refus('nom-contredit-numero');
    const brouillon ={ _id: `${carte._id}|${p.idProduct}`, carteId: carte._id, idProduct: p.idProduct, preuve: 'set+nom-seul' };
    const g = gardeNomSeul({ lignes: [brouillon], produits: tous.map(q => ({ idProduct: q.idProduct, nom: decomp(q).nom, attaques: decomp(q).attaques })), cartes });
    if (!g.gardees.length) return refus('nom-ambigu');
    return { ligne: ligneDe(p, 'set+nom-seul', null, `nom seul « ${decomp(p).nom} » : seul produit et seule carte de ce nom, parmi les ${sansLigne.length} produits sans ligne de l'expansion ${p.idExpansion} ; nom concordant`) };
}

module.exports = { jugerJointure, RAISONS };
