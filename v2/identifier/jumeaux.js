'use strict';
// JUMEAU-V2 — la garde « aucune affirmation d'un produit qui a un jumeau ». Module PUR (ni base, ni réseau).
// Un jumeau de P est un AUTRE produit de même métacarte, de même langue de tirage et d'un AUTRE créneau (expansion, numéro) : la lecture du code et du numéro le sépare de P, et c'est cette
// lecture qui se trompe (IMG_3237 : « PAR 251 » lu sur une carte qui imprime « PRE 162 » ; même nom, même métacarte ; prix rendu faux de 106 €). Un champ inconnu compte comme « même ».
// 🔑 La garde est écrite par ce qu'elle AUTORISE : UN seul chemin mène à « affirmer » — un fournisseur de jumeaux qui a CONCLU, sur une colonne à jour, et qui n'en rend AUCUN. Tout le reste :
//   · P et ses jumeaux tiennent en 3 produits ou moins, tous au catalogue de l'API → une QUESTION de départage (le mécanisme existant) ;
//   · plus de 3 produits → INTROUVABLE `impression-indeterminee` (jamais un choix de 3 parmi N : la question pourrait exclure la vérité), motif interne `jumeaux-trop-nombreux` ;
//   · la colonne manque, est périmée, ne couvre pas le produit, le fournisseur lève ou rend une forme inconnue, un jumeau n'a pas de ligne au catalogue de l'API → PANNE INDISPONIBLE (c'est
//     NOTRE infrastructure, pas la photo : « une panne n'est jamais un introuvable »), motif interne `jumeaux-indisponibles` / `jumeaux-perimes` / `jumeaux-incomplets`.
// Un refus de la garde est NOTRE refus : il se rembourse hors plafond de pannes (routes.js, lot.js). Chaque refus est COMPTÉ (compteurs()) et journalisé (CLAUDE.md §21).
const MAX_PRODUITS = 3;                         // la limite d'une question : celle de l'adaptateur
const MOTIFS = Object.freeze(['jumeaux-trop-nombreux', 'jumeaux-indisponibles', 'jumeaux-perimes', 'jumeaux-incomplets', 'question-de-jumeaux']);
const MOTIFS_PANNE = Object.freeze(['jumeaux-indisponibles', 'jumeaux-perimes', 'jumeaux-incomplets']);
const compte = Object.fromEntries(MOTIFS.map(m => [m, 0]));
const compteurs = () => ({ ...compte });
function noter(motif, idProduct, detail) {
    compte[motif]++;
    console.warn(`⚠️ [jumeaux-v2] ${motif} produit=${idProduct}${detail ? ` ${detail}` : ''}`);
}
const entiers = xs => Array.isArray(xs) && xs.every(Number.isInteger);
const empreinteValide = e => Boolean(e) && typeof e === 'object' && Number.isInteger(e.n) && e.n > 0 && Number.isInteger(e.max) && e.max > 0;
const NE_CONCLUT_PAS = (motif = null) => () => ({ conclu: false, ids: [], ...(motif ? { motif } : {}) });

/**
 * Le fournisseur de la route : { conclu, ids } pour un produit, lu dans UNE version (celle de la requête). Ne conclut jamais sans colonne.
 * `empreinteCatalogue` { n, max } : le catalogue de la route AUJOURD'HUI (nombre de produits, plus grand idProduct). La colonne décrit celui d'une archive plus ancienne ; si les deux diffèrent
 * (un produit ajouté depuis : il peut être le jumeau qu'elle ne connaît pas), elle ne conclut plus — motif `jumeaux-perimes`. `undefined` = pas de contrôle (le fournisseur est injecté par un banc) ;
 * `null` ou illisible = le catalogue n'a pas pu être lu : on ne peut pas savoir, motif `jumeaux-indisponibles`.
 */
function fournisseurDe(version, empreinteCatalogue) {
    if (!version || version.colonneJumeaux !== true || typeof version.jumeauxDe !== 'function') return NE_CONCLUT_PAS('jumeaux-indisponibles');
    if (empreinteCatalogue !== undefined) {
        if (!empreinteValide(empreinteCatalogue)) return NE_CONCLUT_PAS('jumeaux-indisponibles');
        const e = typeof version.empreinteJumeaux === 'function' ? version.empreinteJumeaux() : null;
        if (!empreinteValide(e) || e.n !== empreinteCatalogue.n || e.max !== empreinteCatalogue.max) return NE_CONCLUT_PAS('jumeaux-perimes');
    }
    return id => { const j = version.jumeauxDe(id); return j === null || j === undefined ? { conclu: false, ids: [], motif: 'jumeaux-indisponibles' } : { conclu: true, ids: j }; };
}

/** Le fournisseur de PRODUCTION : la version EN PLACE et l'empreinte du catalogue lue maintenant (`catalogue.empreinte`, absente ou en échec → null : on ne conclut pas). */
async function fournisseurParDefaut(catalogue, version) {
    let e = null;
    try { if (catalogue && typeof catalogue.empreinte === 'function') e = await catalogue.empreinte(); } catch { e = null; }
    return fournisseurDe(version, empreinteValide(e) ? e : null);
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
 * La décision pour UNE affirmation de la chaîne.
 * @returns {{ action: 'affirmer' } | { action: 'question', ids: number[] } | { action: 'introuvable', motif: string } | { action: 'panne', motif: string }}
 * ctx : { jumeaux: (idProduct) => { conclu, ids, motif? }, produits: Map<idProduct, ligne> }
 */
function garde(ctx, idProduct) {
    const introuvable = (motif, detail) => { noter(motif, idProduct, detail); return { action: 'introuvable', motif }; };
    const panne = (motif, detail) => { noter(motif, idProduct, detail); return { action: 'panne', motif }; };
    const f = ctx && ctx.jumeaux;
    if (typeof f !== 'function') return panne('jumeaux-indisponibles', '(aucun fournisseur)');
    let r;
    try { r = f(idProduct); } catch { return panne('jumeaux-indisponibles', '(fournisseur en erreur)'); }
    if (!r || typeof r !== 'object') return panne('jumeaux-indisponibles', '(forme inconnue)');
    if (r.conclu === false) return panne(MOTIFS_PANNE.includes(r.motif) ? r.motif : 'jumeaux-indisponibles', '(la colonne ne conclut pas)');
    if (r.conclu !== true || !entiers(r.ids)) return panne('jumeaux-indisponibles', '(forme inconnue)');
    const jumeaux = [...new Set(r.ids)].filter(i => i !== idProduct);
    if (!jumeaux.length) return { action: 'affirmer' };
    if (1 + jumeaux.length > MAX_PRODUITS) return introuvable('jumeaux-trop-nombreux', `(${1 + jumeaux.length} produits)`);
    const produits = ctx.produits instanceof Map ? ctx.produits : new Map();
    if (!produits.has(idProduct) || jumeaux.some(i => !produits.has(i))) return panne('jumeaux-incomplets', '(un produit sans ligne au catalogue de l\'API)');
    noter('question-de-jumeaux', idProduct, `(${1 + jumeaux.length} produits)`);
    return { action: 'question', ids: [idProduct, ...jumeaux] };
}

module.exports = { garde, fournisseurDe, fournisseurParDefaut, idsACharger, compteurs, MOTIFS, MOTIFS_PANNE, MAX_PRODUITS };
