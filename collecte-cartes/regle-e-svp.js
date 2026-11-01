// ============================================================
// LA RÈGLE E-SVP — les Énergies de base des promos japonaises SV-P (« Scarlet-Violet-Promos », idExpansion 5212)
// ============================================================
// UN SEUL MODULE : la simulation, l'outil d'écriture (poser-fiches-svp-energies.js) et le banc appellent `juger`. Pure : aucune base, aucun réseau, aucune
// lecture de fichier (le nom japonais est INJECTÉ par `nomJa`, le clone par `nommes`).
// Un produit « Basic <Type> Energy » est rattaché à la carte de même nom qui porte une impression SV-P, SI les QUATRE conditions tiennent :
//   (1) TCGdex nomme CE produit (thirdParty.cardmarket = idProduct) à `SV-P/<n>` — un seul numéro ; un doublon du même numéro n'est pas une ambiguïté ;
//   (2) n = le numéro appris de Cardmarket (numeros_cartes.numero) ;
//   (3) le nom japonais TCGdex de SV-P/<n> est 基本<type>エネルギー et son type est celui du produit (deux sources indépendantes du type) ;
//   (4) UNE SEULE carte candidate : même nomEn que le produit ET une impression de l'expansion « SV-P Promotional cards ». Deux, c'est « on ne choisit pas ».
// Une garde s'écrit par ce qu'elle autorise : tout ce qui n'est pas exactement ce cas rend `{ ok: false, condition, raison }`.
const { numeroComparable } = require('../mesurer-fiches-melangees');

const EXPANSION = 'SV-P Promotional cards';
const SET_TCGDEX = 'SV-P';
const TYPE_JA = { 草: 'Grass', 炎: 'Fire', 水: 'Water', 雷: 'Lightning', 超: 'Psychic', 闘: 'Fighting', 悪: 'Darkness', 鋼: 'Metal' };
const TYPES = new Set(Object.values(TYPE_JA));

const typeProduit = nom => { const t = /^Basic (\w+) Energy$/.exec(String(nom ?? ''))?.[1]; return t && TYPES.has(t) ? t : null; };
/** Le nom japonais d'une carte TCGdex, lu dans le texte de son fichier du clone (`ja: "…"`). */
const nomJaDuTexte = texte => /ja:\s*"([^"]*)"/.exec(String(texte ?? ''))?.[1] ?? null;
const typeJa = ja => { const m = /^基本(.)エネルギー$/.exec(String(ja ?? '')); return m ? (TYPE_JA[m[1]] ?? null) : null; };

/** Les cartes candidates : même nomEn que le produit ET une impression de l'expansion SV-P. Dédoublonnées par _id. Rend les _id. */
function candidates(nom, cartes, expansion = EXPANSION) {
    const ids = new Set();
    for (const c of cartes || []) if (c && c.nomEn === nom && (c.impressions || []).some(i => i && i.expansion === expansion)) ids.add(c._id);
    return [...ids];
}

/**
 * @param {object} o
 * @param {{idProduct:number,name:string}} o.produit
 * @param {string|null} o.numeroAppris        numeros_cartes.numero
 * @param {{setId:string,localId:string}[]} o.nommes   clone.parProduit.get(idProduct) || []
 * @param {(localId:string)=>string|null} o.nomJa      le nom japonais TCGdex de SV-P/<localId>
 * @param {{_id,nomEn,impressions}[]} o.cartes
 */
function juger({ produit, numeroAppris, nommes, nomJa, cartes }) {
    const non = (condition, raison, extra = {}) => ({ ok: false, condition, raison, ...extra });
    const type = typeProduit(produit?.name);
    if (!type) return non(0, 'pas une énergie de base');
    const dansSvp = (nommes || []).filter(x => x && x.setId === SET_TCGDEX);
    if (!dansSvp.length) return non(1, 'TCGdex ne nomme pas le produit à SV-P');
    const locaux = [...new Set(dansSvp.map(x => String(x.localId)))];
    if (locaux.length !== 1) return non(1, `TCGdex nomme le produit à ${locaux.length} numéros de SV-P (${locaux.join('/')}) : on ne choisit pas`);
    const [local] = locaux;
    if (numeroAppris == null || String(numeroAppris).trim() === '') return non(2, 'pas de numéro appris');
    if (numeroComparable(numeroAppris) !== numeroComparable(local)) return non(2, `numéro ${numeroAppris} ≠ TCGdex ${local}`);
    const ja = nomJa(local);
    const tJa = typeJa(ja);
    if (!tJa || tJa !== type) return non(3, `type japonais ${ja} ≠ ${type}`);
    const cs = candidates(produit.name, cartes);
    if (cs.length !== 1) return non(4, `${cs.length} cartes candidates`, { candidates: cs });
    return { ok: true, carteId: cs[0], numero: String(numeroAppris).trim(), type, tcgdex: `${SET_TCGDEX}/${local}`, nomJa: ja };
}

/**
 * La calibration : la règle REJOUÉE sur les produits Basic Energy DÉJÀ joints, ligne cachée, comparée à la ligne.
 * jugées = la règle a désigné une carte ; justes = c'est celle de la ligne ; faux = une autre ; refus = la règle s'est tue.
 */
function calibrer({ produits, lignes, nums, clone, nomJa, cartes }) {
    const parProduit = new Map((lignes || []).map(l => [l.idProduct, l]));
    const r = { jugees: 0, justes: 0, faux: 0, refus: 0, fauxListe: [] };
    for (const p of produits || []) {
        const l = parProduit.get(p.idProduct);
        if (!l || !typeProduit(p.name)) continue;
        const j = juger({ produit: p, numeroAppris: nums.get(p.idProduct), nommes: clone.parProduit.get(p.idProduct) || [], nomJa, cartes });
        if (!j.ok) { r.refus++; continue; }
        r.jugees++;
        if (j.carteId === l.carteId) r.justes++; else { r.faux++; r.fauxListe.push({ idProduct: p.idProduct, regle: j.carteId, ligne: l.carteId }); }
    }
    return r;
}

/**
 * LA SONDE D'UNICITÉ — sur TOUS les produits SV-P déjà joints (énergies ou non), ligne cachée : les conditions 1, 2 et 4 SANS la condition de type (qui n'existe que
 * pour les énergies). Elle ne sert pas à écrire : elle ÉPROUVE le test d'unicité sur de vraies ambiguïtés (Nemona et ses homonymes) et dit ce que l'unicité seule vaut.
 * ambigus = ≥ 2 candidats (la règle se tait) ; uniques = 1 candidat, juste ou FAUX selon la ligne cachée ; aucun = 0 candidat.
 */
function sonder({ produits, lignes, nums, clone, cartes, nomDe }) {
    const { decomposerNomCardmarket } = require('./jointure');
    const nom = nomDe || (p => decomposerNomCardmarket(p.name).nom);
    const parProduit = new Map((lignes || []).map(l => [l.idProduct, l]));
    const r = { joints: 0, passent12: 0, ambigus: 0, ambigusAvecVerite: 0, uniques: 0, uniquesJustes: 0, uniquesFaux: 0, aucun: 0, fauxListe: [] };
    for (const p of produits || []) {
        const l = parProduit.get(p.idProduct); if (!l) continue;
        r.joints++;
        const locaux = [...new Set(((clone.parProduit.get(p.idProduct) || []).filter(x => x && x.setId === SET_TCGDEX)).map(x => String(x.localId)))];
        const n = nums.get(p.idProduct);
        if (locaux.length !== 1 || n == null || numeroComparable(n) !== numeroComparable(locaux[0])) continue;
        r.passent12++;
        const cs = candidates(nom(p), cartes);
        if (cs.length === 0) r.aucun++;
        else if (cs.length >= 2) { r.ambigus++; if (cs.includes(l.carteId)) r.ambigusAvecVerite++; }
        else { r.uniques++; if (cs[0] === l.carteId) r.uniquesJustes++; else { r.uniquesFaux++; r.fauxListe.push({ idProduct: p.idProduct, regle: cs[0], ligne: l.carteId }); } }
    }
    return r;
}

module.exports = { juger, calibrer, sonder, candidates, typeProduit, typeJa, nomJaDuTexte, EXPANSION, SET_TCGDEX, TYPE_JA };
