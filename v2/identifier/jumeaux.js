'use strict';
// JUMEAU-V2 — la garde « aucune affirmation d'un produit qui a un jumeau ». Module PUR (ni base, ni réseau).
// Un jumeau de P est un AUTRE produit de même métacarte, de même langue de tirage et d'un AUTRE créneau (expansion, numéro) : la lecture du code et du numéro le sépare de P, et c'est cette
// lecture qui se trompe (IMG_3237 : « PAR 251 » lu sur une carte qui imprime « PRE 162 » ; même nom, même métacarte ; prix rendu faux de 106 €). Un champ inconnu compte comme « même ».
// 🔑 La garde est écrite par ce qu'elle AUTORISE : UN seul chemin mène à « affirmer » — un fournisseur de jumeaux qui a CONCLU, qui n'en rend AUCUN. Tout le reste ne produit jamais d'affirmation :
//   · P et ses jumeaux tiennent en 3 produits ou moins, tous au catalogue de l'API → une QUESTION de départage (le mécanisme existant) ;
//   · plus de 3 produits → introuvable (jamais un choix de 3 parmi N : la question pourrait exclure la vérité), motif `jumeaux-trop-nombreux` ;
//   · pas de fournisseur, colonne absente (fichier de visuels plus ancien), produit hors colonne, fournisseur qui lève ou rend une forme inconnue → introuvable, motif `jumeaux-indisponibles` ;
//   · un jumeau sans ligne au catalogue de l'API (pas de question possible) → introuvable, motif `jumeaux-incomplets`.
// Chaque refus est COMPTÉ (compteurs()) et journalisé : un « introuvable » qui ne dit pas pourquoi serait invisible (CLAUDE.md §21).
const MAX_PRODUITS = 3;                         // la limite d'une question : celle de l'adaptateur
const MOTIFS = Object.freeze(['jumeaux-trop-nombreux', 'jumeaux-indisponibles', 'jumeaux-incomplets', 'question-de-jumeaux']);
const compte = Object.fromEntries(MOTIFS.map(m => [m, 0]));
const compteurs = () => ({ ...compte });
function noter(motif, idProduct, detail) {
    compte[motif]++;
    console.warn(`⚠️ [jumeaux-v2] ${motif} produit=${idProduct}${detail ? ` ${detail}` : ''}`);
}
const entiers = xs => Array.isArray(xs) && xs.every(Number.isInteger);
const AUCUN = Object.freeze({ conclu: false, ids: Object.freeze([]) });

/** Le fournisseur de la route : { conclu, ids } pour un produit, lu dans UNE version (celle de la requête). Ne conclut jamais sans colonne. */
function fournisseurDe(version) {
    if (!version || version.colonneJumeaux !== true || typeof version.jumeauxDe !== 'function') return () => ({ conclu: false, ids: [] });
    return id => { const j = version.jumeauxDe(id); return j === null || j === undefined ? { conclu: false, ids: [] } : { conclu: true, ids: j }; };
}

/** Les produits à charger EN PLUS pour que l'adaptateur puisse poser la question d'une affirmation : ses jumeaux, seulement s'ils tiennent dans une question (au plus 2). */
function idsACharger(corps, fournisseur) {
    const c = corps && typeof corps === 'object' ? corps.carte : null;
    if (!corps || corps.success !== true || !c || c.ambigu !== false || !Number.isInteger(c.idProduct) || typeof fournisseur !== 'function') return [];
    try {
        const r = fournisseur(c.idProduct);
        if (!r || r.conclu !== true || !entiers(r.ids)) return [];
        const ids = [...new Set(r.ids)].filter(i => i !== c.idProduct);
        return ids.length >= 1 && ids.length <= MAX_PRODUITS - 1 ? ids : [];
    } catch { return []; }
}

/**
 * La décision pour UNE affirmation de la chaîne. @returns {{ action: 'affirmer' } | { action: 'question', ids: number[] } | { action: 'introuvable', motif: string }}
 * ctx : { jumeaux: (idProduct) => { conclu, ids }, produits: Map<idProduct, ligne> }
 */
function garde(ctx, idProduct) {
    const refus = (motif, detail) => { noter(motif, idProduct, detail); return { action: 'introuvable', motif }; };
    const f = ctx && ctx.jumeaux;
    if (typeof f !== 'function') return refus('jumeaux-indisponibles', '(aucun fournisseur)');
    let r;
    try { r = f(idProduct); } catch { return refus('jumeaux-indisponibles', '(fournisseur en erreur)'); }
    if (!r || r.conclu !== true || !entiers(r.ids)) return refus('jumeaux-indisponibles', r && r.conclu === false ? '(la colonne ne conclut pas)' : '(forme inconnue)');
    const jumeaux = [...new Set(r.ids)].filter(i => i !== idProduct);
    if (!jumeaux.length) return { action: 'affirmer' };
    if (1 + jumeaux.length > MAX_PRODUITS) return refus('jumeaux-trop-nombreux', `(${1 + jumeaux.length} produits)`);
    const produits = ctx.produits instanceof Map ? ctx.produits : new Map();
    if (!produits.has(idProduct) || jumeaux.some(i => !produits.has(i))) return refus('jumeaux-incomplets', '(un produit sans ligne au catalogue de l\'API)');
    noter('question-de-jumeaux', idProduct, `(${1 + jumeaux.length} produits)`);
    return { action: 'question', ids: [idProduct, ...jumeaux] };
}

module.exports = { garde, fournisseurDe, idsACharger, compteurs, MOTIFS, MAX_PRODUITS };
