'use strict';
// JUMEAU-V2 — la garde « aucune affirmation d'un produit qui a un jumeau ». Module PUR (ni base, ni réseau).
// Un jumeau de P est un AUTRE produit de même métacarte, de même langue de tirage et d'un AUTRE créneau (expansion, numéro) : la lecture du code et du numéro le sépare de P, et c'est cette
// lecture qui se trompe (IMG_3237 : « PAR 251 » lu sur une carte qui imprime « PRE 162 » ; même nom, même métacarte ; prix rendu faux de 106 €). Un champ inconnu compte comme « même ».
// 🔑 La garde est écrite par ce qu'elle AUTORISE : UN seul chemin mène à « affirmer » — un fournisseur de jumeaux qui a CONCLU, sur une colonne à jour, et qui n'en rend AUCUN. Tout le reste :
//   · P et ses jumeaux tiennent en 3 produits ou moins, tous au catalogue de l'API → une QUESTION de départage (le mécanisme existant) ;
//   · plus de 3 produits → INTROUVABLE `impression-indeterminee` (jamais un choix de 3 parmi N : la question pourrait exclure la vérité), motif interne `jumeaux-trop-nombreux` ;
//   · la colonne manque, est périmée, ne couvre pas le produit, le fournisseur lève ou rend une forme inconnue, un jumeau n'a pas de ligne au catalogue de l'API → PANNE INDISPONIBLE (c'est
//     NOTRE infrastructure, pas la photo : « une panne n'est jamais un introuvable »), motif interne `jumeaux-indisponibles` / `jumeaux-perimes` / `jumeaux-incomplets`.
// Un refus de la garde est NOTRE refus : il se rembourse dans le compteur DÉDIÉ `jumeaux` (une unité par carte), qui retombe sur le plafond de pannes quand il est plein (routes.js, lot.js, argent/ledger.js). Chaque refus est COMPTÉ (compteurs()) et journalisé (CLAUDE.md §21).
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
 * `verdicts` : Map idProduct → 'ok' | 'perime' | 'indisponible', établi AVANT l'adaptation par fournisseurParDefaut (la garde de l'adaptateur est synchrone). La colonne décrit un catalogue plus
 * ancien : un produit PLUS RÉCENT qu'elle, de la MÊME métacarte que le produit affirmé, est peut-être son jumeau qu'elle ne connaît pas → pour CE produit seulement, `jumeaux-perimes`.
 * `undefined` = pas de contrôle (le fournisseur est celui d'un banc ou d'un rejeu) ; une Map : tout produit qui n'y figure pas ne conclut pas (jamais un défaut passant).
 */
function fournisseurDe(version, verdicts) {
    if (!version || version.colonneJumeaux !== true || typeof version.jumeauxDe !== 'function') return NE_CONCLUT_PAS('jumeaux-indisponibles');
    if (verdicts !== undefined && !(verdicts instanceof Map)) return NE_CONCLUT_PAS('jumeaux-indisponibles');
    return id => {
        if (verdicts !== undefined) {
            const v = verdicts.get(id);
            if (v === 'perime') return { conclu: false, ids: [], motif: 'jumeaux-perimes' };
            if (v !== 'ok') return { conclu: false, ids: [], motif: 'jumeaux-indisponibles' };
        }
        const j = version.jumeauxDe(id);
        return j === null || j === undefined ? { conclu: false, ids: [], motif: 'jumeaux-indisponibles' } : { conclu: true, ids: j };
    };
}

const idsDe = xs => [...new Set((Array.isArray(xs) ? xs : []).map(c => c && c.idProduct).filter(Number.isInteger))];
const MOTIFS_EGALITE_EN_QUESTION = Object.freeze(['egalite-parfaite', 'nom-contredit-egalite']);     // PAS nom-contredit-sans-repli : le nom y CONTREDIT les candidats, jamais une question

/**
 * UN-CANDIDAT (D1) : le produit UNIQUE qu'une réponse non affirmée désigne — une ambiguë qui n'a qu'un candidat, ou une égalité dont l'UNION (corps + `extra` = ctx.candidatsDeRefus) n'en compte qu'un.
 * C'est lui qui passe par la garde des jumeaux avant de devenir une question « est-ce cette carte ? ». null : pas de candidat unique (0, 2 ou plus, sans-repli, une affirmation, un refus).
 */
function candidatUniqueDe(corps, extra = []) {
    if (!corps || typeof corps !== 'object') return null;
    if (corps.success === true) {
        const c = corps.carte;
        if (!c || typeof c !== 'object' || c.ambigu !== true) return null;
        const ids = idsDe(corps.candidats);
        return ids.length === 1 ? ids[0] : null;
    }
    if (corps.success === false && corps.natureRefus === 'refus-delibere' && MOTIFS_EGALITE_EN_QUESTION.includes(corps.motifRefus)) {
        const union = [...new Set([...idsDe(corps.candidats), ...idsDe(extra)])];
        return union.length === 1 ? union[0] : null;
    }
    return null;
}

/** Les produits qu'une réponse de la chaîne AFFIRME (success et ambigu faux), ou désigne comme CANDIDAT UNIQUE (UN-CANDIDAT) : les seuls pour lesquels la garde est consultée, donc les seuls à vérifier. */
function idsAffirmes(corps) {
    const c = corps && typeof corps === 'object' ? corps.carte : null;
    if (corps && corps.success === true && c && c.ambigu === false && Number.isInteger(c.idProduct)) return [c.idProduct];
    const u = candidatUniqueDe(corps);
    return u === null ? [] : [u];
}

/**
 * Le fournisseur de PRODUCTION : la version EN PLACE, et, pour chacun des produits que la chaîne AFFIRME, UNE requête indexée dans le catalogue de la route — « existe-t-il un produit PLUS RÉCENT que
 * l'archive (idProduct > maxArchive) de la même métacarte ? ». Oui → ce produit-là seul ne conclut pas (`jumeaux-perimes`) ; non → la colonne s'applique ; la requête échoue, la méthode manque, la
 * métacarte du produit est inconnue → il ne conclut pas non plus (on échoue fermé). Sans colonne, le catalogue n'est même pas interrogé.
 */
async function fournisseurParDefaut(catalogue, version, idsAffirmes) {
    if (!version || version.colonneJumeaux !== true || typeof version.empreinteJumeaux !== 'function' || typeof version.metacarteJumeaux !== 'function') return NE_CONCLUT_PAS('jumeaux-indisponibles');
    const verdicts = new Map();
    const e = version.empreinteJumeaux();
    for (const id of [...new Set(Array.isArray(idsAffirmes) ? idsAffirmes : [])]) {
        const meta = version.metacarteJumeaux(id);
        if (!empreinteValide(e) || meta === null || !catalogue || typeof catalogue.plusRecentDansMetacarte !== 'function') { verdicts.set(id, 'indisponible'); continue; }
        try { const r = await catalogue.plusRecentDansMetacarte(e.max, meta); verdicts.set(id, r === false ? 'ok' : r === true ? 'perime' : 'indisponible'); }   // « ok » seulement sur un FAUX franc
        catch { verdicts.set(id, 'indisponible'); }
    }
    return fournisseurDe(version, verdicts);
}

/** Les produits à charger EN PLUS pour que l'adaptateur puisse poser la question d'une affirmation : ses jumeaux, seulement s'ils tiennent dans une question (au plus 2). */
function idsACharger(corps, fournisseur) {
    const p = idsAffirmes(corps)[0];                                    // le produit affirmé, ou le candidat UNIQUE (UN-CANDIDAT)
    if (p === undefined || typeof fournisseur !== 'function') return [];
    try {
        const r = fournisseur(p);
        if (!r || r.conclu !== true || !entiers(r.ids)) return [];
        const ids = [...new Set(r.ids)].filter(i => i !== p);
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

module.exports = { garde, fournisseurDe, fournisseurParDefaut, idsAffirmes, idsACharger, candidatUniqueDe, compteurs, MOTIFS, MOTIFS_PANNE, MAX_PRODUITS };
