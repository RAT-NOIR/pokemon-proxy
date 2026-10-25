'use strict';
// ============================================================
// `--seulement=<fichier>.json` — LA LISTE DES SEULS PRODUITS À ÉCRIRE (PHASE 3a-SUITE, règle des deux sources du testeur, 2026-10-24)
// ============================================================
// Un outil de pose propose un PLAN ; la règle des deux sources en confirme une partie (collecte-cartes/deux-sources.js). La liste `--seulement` est cette partie, fabriquée par
// scanner-deux-sources.js — jamais à la main au moment du lot. Écrite par ce qu'elle AUTORISE : ce qui n'est pas dans la liste n'est pas écrit ; un idProduct de la liste qu'aucun
// plan n'a proposé (la liste ne correspond pas à l'état de la base) refuse TOUT ; un fichier vide ou mal formé est refusé, jamais ignoré (il ne protège rien).
// Même contrat que poser-wcd.js et poser-reimpressions.js, une seule définition (§21 bis).
const fs = require('fs');

/** Lit la liste : un tableau NON VIDE d'idProduct entiers, sans doublon. LÈVE sinon, en nommant l'option. @returns {Set<number>} */
function lire(option, lireFichier) {
    let a;
    try { a = JSON.parse(lireFichier()); } catch (e) { throw new Error(`${option} : fichier illisible (${String(e.message).slice(0, 120)})`); }
    if (!Array.isArray(a) || !a.length || !a.every(Number.isInteger)) throw new Error(`${option} : le fichier doit être un tableau NON VIDE d'idProduct entiers (un fichier vide ou mal formé ne protège rien)`);
    const doublons = a.filter((x, i) => a.indexOf(x) !== i);
    if (doublons.length) throw new Error(`${option} : doublon(s) dans la liste (${[...new Set(doublons)].slice(0, 8).join(', ')}) — une liste de lot ne double pas un produit`);
    return new Set(a);
}
/** Lit la liste depuis un chemin (le cas des outils en ligne de commande). */
const lireFichier = (option, chemin) => lire(option, () => fs.readFileSync(chemin, 'utf8'));

/** Restreint un plan à la liste. Sans liste (null) rien n'est filtré. @returns {{retenus: Array, ecartes: Array}} */
function restreindre(plan, seulement, cle) {
    if (!seulement) return { retenus: plan, ecartes: [] };
    const retenus = [], ecartes = [];
    for (const x of plan) (seulement.has(cle(x)) ? retenus : ecartes).push(x);
    return { retenus, ecartes };
}
/** Les idProduct de la liste que AUCUN plan n'a proposé (`vus` : l'ensemble des idProduct des plans bruts). */
function horsPlan(seulement, vus) {
    if (!seulement) return [];
    return [...seulement].filter(id => !vus.has(id)).sort((a, b) => a - b);
}
/** L'attendu d'un lot restreint est le compte du plan RETENU. */
function verifierAttendu({ retenus, attendu }) {
    if (!Number.isInteger(attendu)) return { ok: false, motif: '--ecrire exige un --attendu entier' };
    if (attendu !== retenus) return { ok: false, motif: `le plan retenu rend ${retenus}, attendu ${attendu}` };
    return { ok: true, motif: null };
}

/**
 * La liste d'un lot : les lignes d'un plan CONFIRMÉES par deux sources (`detail` : la sortie de scanner-deux-sources.js --plans, une entrée { idProduct, ok } par ligne), moins les produits
 * que la phase 2 a détachés par décision (`sauf`) et la matière spéciale (`estMatiere`). Chaque exclu est nommé avec son motif. Une entrée par produit : deux lignes d'un même produit
 * ne font pas une liste. @returns {{ids: number[], refuses: Array<{idProduct: number, motif: string}>}}
 */
function construire({ detail, sauf, estMatiere }) {
    if (!Array.isArray(detail) || !detail.length) throw new Error('construire : détail vide — une liste construite sur zéro ligne ne confirme rien');
    const vus = new Set();
    for (const d of detail) { if (vus.has(d.idProduct)) throw new Error(`construire : idProduct ${d.idProduct} en double dans le détail`); vus.add(d.idProduct); }
    const ids = [], refuses = [];
    for (const d of detail) {
        if (!d.ok) refuses.push({ idProduct: d.idProduct, motif: 'non confirmé par deux sources' });
        else if (sauf.has(d.idProduct)) refuses.push({ idProduct: d.idProduct, motif: 'détaché par décision (--sauf)' });
        else if (estMatiere(d.idProduct)) refuses.push({ idProduct: d.idProduct, motif: 'matière spéciale (table fermée)' });
        else ids.push(d.idProduct);
    }
    if (!ids.length) throw new Error(`construire : aucune ligne confirmée sur ${detail.length} — la liste serait vide`);
    return { ids, refuses };
}

/** Les lignes du détail des codes demandés (un lot par code ou par groupe de codes). Un code qu'aucune ligne ne porte LÈVE. */
function filtrerParCodes(detail, codes) {
    const presents = new Set(detail.map(d => d.code));
    const absents = codes.filter(c => !presents.has(c));
    if (absents.length) throw new Error('filtrerParCodes : aucune ligne du plan ne porte le code ' + absents.join(', ') + ' (codes du plan : ' + [...presents].join(', ') + ')');
    return detail.filter(d => codes.includes(d.code));
}

module.exports = { lire, lireFichier, restreindre, horsPlan, verifierAttendu, construire, filtrerParCodes };
