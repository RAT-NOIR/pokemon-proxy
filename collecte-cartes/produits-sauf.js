// ============================================================
// `--sauf=<fichier>.json` — LES PRODUITS QU'UNE DÉCISION A DÉTACHÉS NE SE REPOSENT PAS PAR UNE CLÉ MÉCANIQUE (PHASE 3a, 2026-10-24)
// ============================================================
// L'occurrence : la phase 2 a détaché 20 lignes « autre dessin » sur décision du testeur (« le produit devient sans ligne, la phase 3 lui refera une ligne JUSTE »).
// Les clés mécaniques n'ont aucune mémoire de ce détachement : `poser-fiches-par-freres.js` proposait de reposer 8 de ces lignes (même carte, même clé qui les avait posées)
// et `poser-fiches-par-setlist.js` une neuvième (Eevee SV-P/TH n°225 joint au n°177). Un outil additif qui repose une ligne détachée DÉFAIT la décision.
// Le fichier est un tableau NON VIDE d'idProduct entiers (un fichier vide ne protège rien : il est refusé, pas ignoré). Il se fabrique depuis les décisions de détachement,
// jamais à la main au moment du lot.
const fs = require('fs');

/** @param {string} chemin  @param {(f:string)=>string} [lire] @returns {Set<number>} */
function lireSauf(chemin, lire = f => fs.readFileSync(f, 'utf8')) {
    let a;
    try { a = JSON.parse(lire(chemin)); } catch (e) { throw new Error(`--sauf : fichier illisible (${String(e.message).slice(0, 120)})`); }
    if (!Array.isArray(a) || !a.length || !a.every(Number.isInteger)) throw new Error('--sauf : le fichier doit être un tableau NON VIDE d\'idProduct entiers (un fichier vide ou mal formé ne protège rien)');
    return new Set(a);
}

module.exports = { lireSauf };
