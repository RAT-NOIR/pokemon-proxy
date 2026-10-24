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

const prixDe = x => (typeof x === 'number' && Number.isFinite(x) && x > 0 ? x : null);          // un zéro n'est pas un prix ; un texte non plus (jamais « 0,5 » deviné)
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
 * @param o.guide   le prixGuide servi de la fiche (ou null) : son « De » (offre la plus basse TOUS ÉTATS et toutes langues) est la borne basse quand aucune grille ne la donne ;
 * @param o.grille  la grille lue en direct { ETAT: prix } (ou rien) : DEUX états valides au moins, sinon elle ne borne rien (avec un seul, on ne sait pas si d'autres états sont moins ou plus chers) ;
 *                  alors basse = le prix le plus bas de la grille, haute = le plus haut (un état meilleur qui coûterait moins resterait couvert).
 * @returns {{ basse: {prix, source}|null, haute: {prix, source}|null, absentes: string[] }}  `absentes` dit exactement les bornes nulles, basse puis haute.
 */
function fourchetteDe(o) {
    const { guide = null, grille = null } = o !== null && typeof o === 'object' ? o : {};
    const gr = grilleDe(grille), prix = Object.values(gr);
    let basse = null, haute = null;
    if (prix.length >= 2) {
        basse = Object.freeze({ prix: Math.min(...prix), source: 'grille-directe' });
        haute = Object.freeze({ prix: Math.max(...prix), source: 'grille-directe' });
    } else {
        const de = guide !== null && typeof guide === 'object' ? prixDe(guide.de) : null;
        if (de !== null) basse = Object.freeze({ prix: de, source: 'guide-de' });
    }
    const f = { basse, haute };
    return Object.freeze({ basse, haute, absentes: Object.freeze(BORNES.filter(b => f[b] === null)) });
}

/** Le guide d'un repli « sous fourchette » : les chiffres de la fiche, JAMAIS fiable, la mention après les réserves du produit. L'original n'est pas touché (la fiche garde son guide). */
function guideSousFourchette(guide) {
    const reserves = (Array.isArray(guide.reserves) ? guide.reserves : []).filter(r => r !== ETAT_NON_ESTIMABLE);
    return Object.freeze({ ...guide, fiable: false, reserves: Object.freeze([...reserves, ETAT_NON_ESTIMABLE]) });
}

module.exports = { ETATS, SOURCES, BORNES, etatNonEstimable, grilleDe, fourchetteDe, guideSousFourchette };
