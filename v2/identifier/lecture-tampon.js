'use strict';
// F1-TAMPON puis LOT TAMPONS (2026-10-18) — lire les MARQUES d'une carte tamponnée (Staff, Prerelease, League, enseignes…) sur la photo, dans une liste FERMÉE (marques-tampon.js), pour trancher une paire SÉPARÉE par
// l'étiquette Cardmarket, à 0 faux. Module PUR : ni base, ni réseau, ni modèle (la préparation de l'image et le lecteur sont INJECTÉS ; les octets viennent de l'appelant, jamais d'un téléchargement).
// Décision du testeur (17/10) : « STAFF lu => l'idProduct staff ; sinon une question », étendue le 18/10 à la liste fermée. Un JUMBO reste une question : la règle « jumbo par le titre » est RETIRÉE.
// 🔑 Écrit par ce qu'il AUTORISE :
//   · le déclenchement : la question est EXACTEMENT une paire que l'archive prouve séparée (partageeTamponNonSepare false des deux côtés, la paire nommée par les listes OU séparée par la variante : même visuel,
//     même fiche) ; un côté porte un ensemble de marques de la liste prouvé (`variante`), l'autre `normale` ;
//   · un seul chemin mène à « SÛR » : DEUX essais indépendants lisent le MÊME ensemble NON VIDE de marques de la liste, sans `autre`, ET cet ensemble est EXACTEMENT celui du produit spécial de la paire (route).
//     Rien lu, une marque hors liste, `autre`, un ensemble différent, incertain, désaccord, panne, délai : la question reste, inchangée ;
//   · 🔴 ON N'AFFIRME JAMAIS LA VERSION NORMALE sur une absence de lecture : un tampon manqué n'est pas un tampon absent. Ce module ne sait même pas désigner la normale à partir d'une lecture.
const PV = require('./partage-variante');
const MT = require('./marques-tampon');
// `marquesSansProduit` : des marques lues en consensus (deux essais) qu'AUCUN produit de la paire ne porte de façon prouvée — une question, jamais un sûr, et on la COMPTE (sous-ensemble de `nonConfirmees`)
const COMPTEURS = ['declenchees', 'affirmees', 'nonConfirmees', 'echecs', 'appels', 'dejaTentees', 'nonFaisables', 'marquesSansProduit'];
const compte = Object.fromEntries(COMPTEURS.map(k => [k, 0]));
const compteurs = () => ({ ...compte });
const noter = (k, n = 1) => { compte[k] += n; };
const MEMOIRE_MAX = 5000;
const tentes = new Set();
function premiereFois(scanId) {
    if (typeof scanId !== 'string' || !scanId) return false;
    if (tentes.has(scanId)) { noter('dejaTentees'); return false; }
    if (tentes.size >= MEMOIRE_MAX) tentes.delete(tentes.values().next().value);
    tentes.add(scanId);
    return true;
}
function reinitialiser() { COMPTEURS.forEach(k => { compte[k] = 0; }); tentes.clear(); }

// ── le déclenchement
const refus = motif => ({ ok: false, motif });
const MOTIF_PAIRE = 'les variantes ne sont pas une paire marque/normale';
const memeListe = (l, a, b) => Array.isArray(l) && l.length === 2 && l.every(Number.isInteger) && [...l].sort((x, y) => x - y).join() === [a, b].sort((x, y) => x - y).join();
const texteNonVide = x => typeof x === 'string' && x.trim() !== '';
/**
 * @param ids     les idProduct de la question
 * @param entree  (idProduct) => l'entrée d'archive (format 2) ou null
 * @returns { ok: true, type, variante, marques, special: idProduct, normale: idProduct } | { ok: false, motif } — `variante` est le jeton du produit spécial, `marques` ses marques (un jumbo est refusé).
 */
function paireSeparee({ ids, entree, memeFiche } = {}) {
    try {
        if (!Array.isArray(ids) || ids.length !== 2 || !ids.every(Number.isInteger) || ids[0] === ids[1]) return refus('la question n\'est pas exactement la paire');
        if (typeof entree !== 'function') return refus('aucune archive');
        const [a, b] = ids, ea = entree(a), eb = entree(b);
        if (!ea || !eb || typeof ea !== 'object' || typeof eb !== 'object') return refus('un candidat n\'a pas d\'entrée d\'archive');
        if (ea.partageeTamponNonSepare !== false || eb.partageeTamponNonSepare !== false) return refus('la paire n\'est pas marquée séparée');
        // PARTAGES-VARIANTE : deux formes de paire « prouvée séparée ». (a) les DEUX listes nomment exactement la paire. (b) AUCUNE liste des deux côtés : la paire est séparée par la variante, et
        // les deux produits partagent le même visuel ET la même fiche (partage-variante.js, la définition commune). Une liste d'un seul côté n'est ni l'une ni l'autre.
        const sansListe = x => x.produitsPartages === undefined || x.produitsPartages === null;
        const dit = () => [ea, eb].some(x => texteNonVide(x.tamponNonRepresente));
        const REFUS_DIT = 'l\'archive ne dit pas quel tampon n\'est pas représenté';
        if (sansListe(ea) && sansListe(eb)) {
            if (ea.partageeHoloNonHolo === true || eb.partageeHoloNonHolo === true) return refus('un partage holo / non-holo se mêle à la paire');
            const p = PV.pairePar({ ...ea, idProduct: a }, { ...eb, idProduct: b }, memeFiche);
            if (!p.ok) return refus(/^les variantes/.test(p.motif) ? MOTIF_PAIRE : p.motif);
            const lu = MT.lireVariante(p.variante);
            if (!lu || lu.type !== 'marques') return refus(MOTIF_PAIRE);      // un JUMBO reste une question
            if (!dit()) return refus(REFUS_DIT);
            return { ok: true, type: lu.jeton, variante: lu.jeton, marques: [...lu.marques], special: p.special, normale: p.normale };
        }
        if (!memeListe(ea.produitsPartages, a, b) || !memeListe(eb.produitsPartages, a, b)) return refus('la liste de partage ne nomme pas exactement la paire');
        if (ea.partageeHoloNonHolo === true || eb.partageeHoloNonHolo === true) return refus('un partage holo / non-holo se mêle à la paire');
        const la = MT.lireVariante(ea.variante), lb = MT.lireVariante(eb.variante);
        const ok = la && lb && ((la.type === 'marques' && lb.type === 'normale') || (la.type === 'normale' && lb.type === 'marques'));
        if (!ok) return refus(MOTIF_PAIRE);
        const special = la.type === 'marques' ? la : lb, idSpecial = la.type === 'marques' ? a : b, idNormale = idSpecial === a ? b : a;
        if (!dit()) return refus(REFUS_DIT);
        return { ok: true, type: special.jeton, variante: special.jeton, marques: [...special.marques], special: idSpecial, normale: idNormale };
    } catch { return refus('archive illisible'); }
}

// ── UN essai : la réponse brute du lecteur -> { marques: [...] } (peut être vide) | { autre: true } | 'incertain'
const UNE_PLACE_AU_PLUS = marques => marques.filter(m => /^place-\d$/.test(m)).length <= 1;
/** @param r { marques: string[], autre: boolean, incertain: boolean } | { illisible: true } — tout ce qui n'a pas EXACTEMENT cette forme est « incertain » (jamais une marque inventée). */
function essaiDe(r) {
    if (!r || typeof r !== 'object' || Array.isArray(r) || r.illisible === true || r.incertain === true) return 'incertain';
    if (!Array.isArray(r.marques) || !r.marques.every(x => typeof x === 'string') || typeof r.autre !== 'boolean' || typeof r.incertain !== 'boolean') return 'incertain';
    const m = r.marques.map(x => x.trim().toLowerCase());
    if (r.autre === true || !m.every(MT.estMarque)) return { autre: true };                 // une marque hors de la liste, ou `autre` : une question, jamais un sûr
    if (!m.length) return { marques: [] };
    const e = MT.ensembleDe(m);
    return e !== null && UNE_PLACE_AU_PLUS(e) ? { marques: e } : { autre: true };           // trop de marques, deux places : pas une lecture qu'on affirme
}
const cleDeEssai = x => {
    if (x === 'incertain') return 'incertain';
    if (!x || typeof x !== 'object') return null;
    if (x.autre === true) return 'autre';
    if (!Array.isArray(x.marques)) return null;
    if (!x.marques.length) return 'm:';
    const e = MT.ensembleDe(x.marques);                                            // canonique : l'ordre des marques lues ne compte pas
    return e !== null && UNE_PLACE_AU_PLUS(e) ? `m:${e.join('+')}` : null;
};

// ── le consensus : DEUX essais à l'identique
/**
 * @param essais  des essais normalisés (essaiDe) @returns { sur: boolean, lecture: 'marques'|'aucune'|'autre'|'incertain'|'desaccord', marques: string[], raison }
 * `sur` est vrai SEULEMENT pour l'ensemble NON VIDE que tous les essais (au moins deux) lisent à l'identique.
 */
function decider({ essais } = {}) {
    const r = (sur, lecture, marques, raison) => ({ sur, lecture, marques, raison });
    if (!Array.isArray(essais) || essais.length < 2) return r(false, 'incertain', [], 'moins de deux essais lisibles');
    // M2 : un essai BRUT (la forme du lecteur, qui porte `incertain`) passe par essaiDe ; un essai déjà normalisé se juge tel quel
    const cles = essais.map(x => cleDeEssai(x && typeof x === 'object' && 'incertain' in x ? essaiDe(x) : x));
    if (cles.some(k => k === null)) return r(false, 'incertain', [], 'un essai illisible');
    if (!cles.every(k => k === cles[0])) return r(false, 'desaccord', [], 'les essais ne répondent pas à l\'identique');
    const k = cles[0];
    if (k === 'incertain') return r(false, 'incertain', [], 'les essais sont incertains');
    if (k === 'autre') return r(false, 'autre', [], 'une marque hors de la liste fermée (ou « autre ») est lue : une question');
    if (k === 'm:') return r(false, 'aucune', [], 'aucune marque lue : un tampon manqué n\'est pas un tampon absent');
    return r(true, 'marques', MT.ensembleDe(essais[0].marques.map(m => String(m).trim().toLowerCase())), 'deux essais indépendants lisent le même ensemble de marques');
}
/** Le jeton de variante de l'ensemble lu quand la lecture est sûre ; sinon null. */
const jetonLu = d => (d && d.sur === true ? MT.jetonDeMarques(d.marques) : null);

/**
 * Le fournisseur d'essais. `preparer({ image, corps })` rend les images à lire (une par essai, préparations DISTINCTES) ou [] ; `lecteur(bande, { signal })` rend { marques, autre, incertain } ou { illisible: true }.
 * Ne LÈVE JAMAIS : un échec rend { echec: true } ; chaque appel TENTÉ est compté (compteur.appels et le compteur global) — c'est le coût, qu'il ait réussi ou non. Aucun téléchargement : `image` est un Buffer de l'appelant.
 * Rend { lecture, marques, essais (NORMALISÉS), echec, sansImage, raison } : la route refait la décision sur `essais`, un fournisseur ne décide jamais à la place du module.
 */
function creerFournisseur({ preparer, lecteur } = {}) {
    if (typeof preparer !== 'function' || typeof lecteur !== 'function') throw new Error('creerFournisseur : preparer et lecteur sont obligatoires');
    return async function lectureDuTampon({ image, corps, compteur, signal } = {}) {
        const c = compteur && typeof compteur === 'object' ? compteur : { appels: 0 };
        const essais = [];
        const fin = (lecture, extra = {}) => ({ lecture, marques: [], essais, echec: false, sansImage: false, ...extra });
        if (!Buffer.isBuffer(image) || !image.length) return fin('incertain', { sansImage: true, raison: 'aucun octet d\'image fourni' });
        try {
            const bandes = await preparer({ image, corps, signal });
            if (!Array.isArray(bandes) || bandes.length < 2) return fin('incertain', { raison: 'aucune préparation de l\'image possible' });
            for (const bande of bandes.slice(0, 2)) {
                if (signal && signal.aborted) throw Object.assign(new Error('interrompue'), { code: 'INTERROMPUE' });
                c.appels = (c.appels || 0) + 1;                                    // compté AVANT l'appel : un appel qui échoue a coûté quand même
                const r = await lecteur(bande, { signal });
                const x = essaiDe(r);
                essais.push(x);
                if (!(x && x.marques && x.marques.length)) break;                  // un premier essai qui ne lit AUCUNE marque de la liste ne peut plus mener à un sûr : le second appel est évité (coût)
            }
        } catch (e) { return { lecture: 'incertain', marques: [], essais, echec: true, sansImage: false, raison: `échec de la lecture (${(e && (e.code || e.name)) || 'erreur'})` }; }
        if (essais.length === 1) {
            const x = essais[0], lecture = x === 'incertain' ? 'incertain' : x.autre === true ? 'autre' : 'aucune';
            return fin(lecture, { raison: `le premier essai ne lit aucune marque exploitable (${lecture}) : pas de second appel` });
        }
        const d = decider({ essais });
        return fin(d.lecture, { marques: d.marques, raison: d.raison });
    };
}

module.exports = { paireSeparee, essaiDe, decider, jetonLu, creerFournisseur, premiereFois, reinitialiser, compteurs, noter };
