'use strict';
// Lot ETAT-FOURCHETTE — LA règle « l'état n'est pas estimable, donc le prix est une FOURCHETTE », en UN SEUL endroit (§21 bis : deux exemplaires d'une règle divergent toujours).
// Module PUR : aucune base, aucun réseau. Appelé par prix-repli.js, donc par la réponse d'identification (avecRepliAnalyse) ET par le retour en direct (repliRetourLive).
//
// Décision de l'éditeur (2026-10-24) : « pour un scan sans état, ne refuse jamais le prix : affiche une FOURCHETTE (du plus abîmé plausible au meilleur) avec la mention "état non estimable sur les
// photos", jamais un prix sûr. » Ce module dit QUAND (etatNonEstimable) et QUOI (les bornes, d'où elles viennent, laquelle manque).
//
// 🔑 Écrit par ce qu'il AUTORISE :
//   · un état est ESTIMABLE seulement si au moins un état est donné et que TOUS ceux qu'on donne sont de la liste des sept ; tout le reste (null, absent, hors liste, deux sources qui se contredisent)
//     est NON estimable — « je ne peux pas conclure » n'est jamais « l'état est connu » ;
//   · une borne n'existe que si une donnée de prix que le serveur sert DÉJÀ la porte. Deux sources, et seulement elles : la grille lue en direct par l'extension (un prix par état, envoyé avec le retour
//     en direct), et le « De » du guide (l'offre la plus basse tous états). Le guide n'a AUCUN prix par état : sa tendance et ses moyennes sont des prix tous états, ce ne sont pas le prix du meilleur
//     état — elles ne deviennent donc JAMAIS la borne haute (la dériver de ce qu'on veut prédire la rendrait vraie par construction : CLAUDE.md §7). Une borne sans donnée est ABSENTE, et la réponse
//     dit laquelle (`absentes`).
const { ETAT_NON_ESTIMABLE } = require('./fiabilite-prix');

const ETATS = Object.freeze(['MT', 'NM', 'EX', 'GD', 'LP', 'PL', 'PO']);       // du meilleur au pire (index.js ORDRE_ETATS) — UNE copie : prix-repli.js la reprend d'ici
const SOURCES = Object.freeze(['guide-de', 'grille-directe']);
const BORNES = Object.freeze(['basse', 'haute']);

// Le plus petit prix d'une borne : 0,01 € (le minimum du schéma `BornePrix`, le plus petit prix Cardmarket). Un prix en dessous est une valeur invalide, écartée comme un zéro : le serveur ne sert jamais une borne hors de son propre contrat.
const PRIX_MIN = 0.01;
const prixDe = x => (typeof x === 'number' && Number.isFinite(x) && x >= PRIX_MIN ? x : null);          // un zéro n'est pas un prix ; un texte non plus (jamais « 0,5 » deviné)
const etatDe = x => { const e = typeof x === 'string' ? x.trim().toUpperCase() : null; return e !== null && ETATS.includes(e) ? e : null; };

/**
 * L'état est-il NON estimable ? `etats` : tous les états que les données de ce scan portent (l'état retenu de l'analyse, l'état visé à lire…). Estimable = au moins un état donné ET chacun de la liste.
 * Aucun argument, un `undefined`, un `null`, une chaîne vide, MINT, un nombre : non estimable. Une source nulle parmi plusieurs suffit à le rendre non estimable (la prudence).
 */
function etatNonEstimable(...etats) {
    return !(etats.length > 0 && etats.every(e => etatDe(e) !== null));
}

/** La grille lue en direct : { ETAT: prix }, états de la liste (casse libre) et prix valides seulement. Deux clés pour le même état avec des valeurs DIFFÉRENTES : l'état est ambigu, il est écarté. */
function grilleDe(g) {
    const sortie = {};
    if (g === null || typeof g !== 'object' || Array.isArray(g)) return sortie;
    const ambigus = new Set();
    for (const [k, valeur] of Object.entries(g)) {
        const e = etatDe(k), p = prixDe(valeur);
        if (e === null || p === null) continue;
        if (Object.prototype.hasOwnProperty.call(sortie, e) && sortie[e] !== p) ambigus.add(e);
        else sortie[e] = p;
    }
    for (const e of ambigus) delete sortie[e];
    return sortie;
}

/**
 * Les bornes de la fourchette.
 * L'état n'étant pas estimable, TOUS les états jusqu'au plus abîmé sont plausibles : une grille lue en direct, qui ne contient pas forcément le bas, ne fixe pas la borne basse seule.
 * @param o.guide   le prixGuide servi de la fiche (ou null) : son « De » (offre la plus basse TOUS ÉTATS et toutes langues) est un candidat de la borne basse ;
 * @param o.grille  la grille lue en direct { ETAT: prix } (ou rien) : ses prix valides (même un seul état) sont des candidats de la borne basse ; avec DEUX états valides au moins, son prix le plus haut est la borne haute
 *                  (avec un seul état on ne sait pas si un meilleur état coûte plus : la haute reste absente).
 *                  BASSE = le MINIMUM de tous les candidats, avec la source de ce minimum (à égalité : `grille-directe`, lue en direct). Un prix sous 0,01 n'est le candidat de rien.
 * @returns {{ basse: {prix, source}|null, haute: {prix, source}|null, absentes: string[] }}  `absentes` dit exactement les bornes nulles, basse puis haute.
 */
function fourchetteDe(o) {
    const { guide = null, grille = null } = o !== null && typeof o === 'object' ? o : {};
    const gr = grilleDe(grille), prix = Object.values(gr);
    const de = guide !== null && typeof guide === 'object' ? prixDe(guide.de) : null;
    const minGrille = prix.length ? Math.min(...prix) : null;
    let basse = null, haute = null;
    if (minGrille !== null && (de === null || minGrille <= de)) basse = Object.freeze({ prix: minGrille, source: 'grille-directe' });
    else if (de !== null) basse = Object.freeze({ prix: de, source: 'guide-de' });
    if (prix.length >= 2) haute = Object.freeze({ prix: Math.max(...prix), source: 'grille-directe' });
    const f = { basse, haute };
    return Object.freeze({ basse, haute, absentes: Object.freeze(BORNES.filter(b => f[b] === null)) });
}

/** Le guide d'un repli « sous fourchette » : les chiffres de la fiche, JAMAIS fiable, la mention après les réserves du produit. L'original n'est pas touché (la fiche garde son guide). */
function guideSousFourchette(guide) {
    const reserves = (Array.isArray(guide.reserves) ? guide.reserves : []).filter(r => r !== ETAT_NON_ESTIMABLE);
    return Object.freeze({ ...guide, fiable: false, reserves: Object.freeze([...reserves, ETAT_NON_ESTIMABLE]) });
}

/**
 * M1 (tour 4, correction 1) — « jamais un prix sûr » vaut pour TOUT prix servi d'un scan dont l'état n'est pas estimable : le `prixGuide` du produit et celui de ses impressions (appliqué à chaque candidat, celui des candidats
 * d'une question) passent SOUS la mention, par la même `guideSousFourchette`. Rend un objet NEUF (le produit servi est gelé, l'original n'est pas touché) ; la MÊME référence quand rien n'est à marquer (aucun prix servi, ou
 * déjà marqué). Écrit par ce qu'il AUTORISE : seul un guide objet est marqué, tout le reste (null, absent) est laissé tel quel.
 */
function produitSousFourchette(p) {
    if (p === null || typeof p !== 'object' || Array.isArray(p)) return p;
    const marque = g => (g !== null && typeof g === 'object' && !Array.isArray(g) ? guideSousFourchette(g) : g);
    const memes = (a, b) => a === b || (a !== null && b !== null && typeof a === 'object' && typeof b === 'object' && JSON.stringify(a) === JSON.stringify(b));
    const prixGuide = marque(p.prixGuide);
    const impressions = Array.isArray(p.impressions) ? p.impressions.map(i => (i !== null && typeof i === 'object' ? { ...i, ...('prixGuide' in i ? { prixGuide: marque(i.prixGuide) } : {}) } : i)) : null;
    const inchange = memes(prixGuide, p.prixGuide) && (impressions === null || impressions.every((i, k) => i === p.impressions[k] || memes(i.prixGuide, p.impressions[k].prixGuide)));
    if (inchange) return p;
    return Object.freeze({ ...p, ...('prixGuide' in p ? { prixGuide } : {}), ...(impressions ? { impressions: Object.freeze(impressions.map(i => (i !== null && typeof i === 'object' ? Object.freeze(i) : i))) } : {}) });
}

module.exports = { ETATS, SOURCES, BORNES, PRIX_MIN, etatNonEstimable, grilleDe, fourchetteDe, guideSousFourchette, produitSousFourchette };
