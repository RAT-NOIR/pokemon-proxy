'use strict';
// JUMEAUX-QUESTION (2026-10-17) — quand P et ses jumeaux sont PLUS de 3 produits, la garde (jumeaux.js) ne rend plus un « introuvable » : l'adaptateur pose une QUESTION de départage à 3 candidats.
// Module PUR (ni base, ni réseau). Rien n'est affirmé ici : on choisit 3 produits à MONTRER, le client tranche (D1 : « ce qui n'est pas affirmé devient une question »).
// L'ORDRE est écrit par des critères NOMMÉS, sans réglage sur les cartes du banc, dans cet ordre — P d'abord, toujours, puis les jumeaux par :
//   (1) le rang dans le classement de la chaîne (`corps.classement`, à défaut `corps.candidats`) : un jumeau que la chaîne a classé passe devant un jumeau qu'elle n'a pas vu ;
//   (2) le numéro lu EXACT (scoring.comparerNumeros === 'exact' : la fonction de la production, pas une copie) ;
//   (3) le numéro INCONNU du produit (un champ inconnu compte comme « même », comme dans la garde) ;
//   (4) l'idProduct (ordre stable). Jamais un prix : le prix ne vient pas de la chaîne et corrèle avec la vérité par construction (CLAUDE.md §7).
// Les jumeaux dont le nom est CONTREDIT par le nom lu sont retirés d'abord, par le filtre de CONFIRMATION-SURE (nom-compatible.js). Le choix exige la LIGNE de catalogue de chaque jumeau : s'il en manque une,
// on ne choisit pas (null) — l'adaptateur retombe sur l'introuvable d'avant, jamais sur un choix tronqué.
const S = require('../../scoring');
const { garderCompatibles } = require('./nom-compatible');

const NB_CHOIX = 3;                                // la limite d'une question (adaptateur, jumeaux.js MAX_PRODUITS)
const idDe = c => (c && Number.isInteger(c.idProduct) ? c.idProduct : c && c.candidat && Number.isInteger(c.candidat.idProduct) ? c.candidat.idProduct : null);

/** Le rang (0, 1, …) de chaque produit dans le classement de la chaîne, à défaut dans ses candidats. Les produits que la chaîne n'a pas classés n'ont pas de rang. */
function rangsDe(corps) {
    const liste = corps && Array.isArray(corps.classement) && corps.classement.length ? corps.classement : corps && Array.isArray(corps.candidats) ? corps.candidats : [];
    const rangs = new Map();
    for (const c of liste) { const id = idDe(c); if (id !== null && !rangs.has(id)) rangs.set(id, rangs.size); }
    return rangs;
}
/** Le numéro que la photo a lu (`carte.numero` d'un succès, `cardInfo.number` d'un refus), ou null. */
function numeroLuDe(corps) {
    const src = corps && typeof corps === 'object' ? (corps.success === true ? corps.carte : corps.cardInfo) : null;
    const n = src && typeof src === 'object' ? (src.numero ?? src.number) : null;
    return n != null && String(n).trim() !== '' ? String(n).trim() : null;
}
// 0 = numéro lu exact · 1 = numéro inconnu (du produit, ou rien de lu : on ne sépare pas) · 2 = un autre numéro
function classeDuNumero(lu, ligne) {
    if (lu === null) return 1;
    const ln = ligne && typeof ligne.numero === 'string' && ligne.numero.trim() ? ligne.numero.trim() : null;
    if (ln === null) return 1;
    return S.comparerNumeros(lu, ln) === 'exact' ? 0 : 2;
}

/**
 * @param p        idProduct de la tête de la chaîne (toujours le premier)
 * @param jumeaux  idProduct des jumeaux de P (selon la colonne)
 * @param corps    la réponse de la chaîne héritée (classement, candidats, numéro lu, nom lu)
 * @param produits Map<idProduct, ligne de catalogue> : doit porter P et TOUS les jumeaux
 * @returns {number[]|null} [P, …] (3 au plus), ou null si une ligne manque (pas de choix)
 */
function choisirTrois({ p, jumeaux, corps, produits } = {}) {
    if (!Number.isInteger(p) || !Array.isArray(jumeaux) || !(produits instanceof Map) || !produits.has(p)) return null;
    const uniques = [...new Set(jumeaux)].filter(i => Number.isInteger(i) && i !== p);
    if (uniques.some(i => !produits.has(i))) return null;
    const gardes = garderCompatibles(uniques, corps, produits);                       // le nom lu contredit un jumeau : il n'entre pas
    const rangs = rangsDe(corps), lu = numeroLuDe(corps);
    const cle = i => [rangs.has(i) ? rangs.get(i) : Infinity, classeDuNumero(lu, produits.get(i)), i];
    const ordonnes = [...gardes].sort((a, b) => { const x = cle(a), y = cle(b); return x[0] === y[0] ? (x[1] === y[1] ? x[2] - y[2] : x[1] - y[1]) : (x[0] < y[0] ? -1 : 1); });
    return [p, ...ordonnes.slice(0, NB_CHOIX - 1)];
}

module.exports = { choisirTrois, rangsDe, numeroLuDe, classeDuNumero, NB_CHOIX };
