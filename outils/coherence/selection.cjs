'use strict';
// SELECTION de la population du TEST DE COHERENCE DES GRANDES PHOTOS. Module PUR : aucun fichier, aucun reseau, aucun verdict.
// Regle (figee AVANT tout calcul de verdict) : candidates -> (liste a garder) -> (grand cote > plusDe) -> moins toute empreinte de contenu exclue -> tri par nombre de pixels decroissant, a egalite par sha256 croissant -> les n premieres.
// Ecrite par ce qu'elle AUTORISE : une photo n'est retenue que si elle est dans la liste a garder (si donnee), depasse la taille voulue (si donnee) et n'a AUCUNE empreinte dans les exclusions.
const crypto = require('crypto');

/** Tri : pixels decroissants, a egalite sha256 croissant. Ne modifie pas l'entree. */
function ordonner(photos) {
    return [...photos].sort((a, b) => (b.pixels - a.pixels) || (a.sha256 < b.sha256 ? -1 : a.sha256 > b.sha256 ? 1 : 0));
}

/**
 * @param photos  [{ sha256, pixels, largeur?, hauteur?, chemin? }]
 * @param o       { exclus: Map(sha256 -> motif), n, plusDe?: grand cote strictement superieur a, garder?: Set(sha256), exigerExclusions?: bool }
 * @returns { retenues, exclues: [{sha256, motif}], candidates, petites, horsListe }
 */
function choisir(photos, o = {}) {
    const exclus = o.exclus instanceof Map ? o.exclus : new Map();
    if (o.exigerExclusions && exclus.size === 0) throw new Error('liste d\'exclusion vide : refus (une exclusion vide n\'exclut rien)');
    const vus = new Set();
    for (const p of photos) { if (vus.has(p.sha256)) throw new Error(`doublon de sha256 dans l'entree : ${p.sha256}`); vus.add(p.sha256); }
    let horsListe = 0, petites = 0;
    let liste = photos;
    if (o.garder instanceof Set) { const g = photos.filter(p => o.garder.has(p.sha256)); horsListe = photos.length - g.length; liste = g; }
    if (Number.isFinite(o.plusDe)) { const g = liste.filter(p => Math.max(p.largeur || 0, p.hauteur || 0) > o.plusDe); petites = liste.length - g.length; liste = g; }
    const candidates = liste.length;
    const exclues = [], propres = [];
    for (const p of liste) { if (exclus.has(p.sha256)) exclues.push({ sha256: p.sha256, motif: exclus.get(p.sha256) }); else propres.push(p); }
    exclues.sort((a, b) => (a.sha256 < b.sha256 ? -1 : 1));
    const retenues = ordonner(propres).slice(0, Number.isFinite(o.n) ? o.n : propres.length);
    return { retenues, exclues, candidates, petites, horsListe };
}

/** L'empreinte d'une liste ORDONNEE de photos : sha256 de « sha256 pixels » une ligne par photo. */
function empreinte(liste) {
    return crypto.createHash('sha256').update(liste.map(p => `${p.sha256} ${p.pixels}`).join('\n')).digest('hex');
}

/** La distribution des dimensions, par classes de grand cote. */
function distribution(photos) {
    const d = { '<=800': 0, '801-1200': 0, '1201-2000': 0, '2001-4000': 0, '>4000': 0 };
    for (const p of photos) {
        const g = Math.max(p.largeur, p.hauteur);
        d[g > 4000 ? '>4000' : g > 2000 ? '2001-4000' : g > 1200 ? '1201-2000' : g > 800 ? '801-1200' : '<=800']++;
    }
    return d;
}

module.exports = { ordonner, choisir, empreinte, distribution };
