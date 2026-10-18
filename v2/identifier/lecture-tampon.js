'use strict';
// F1-TAMPON (2026-10-18) — lire le tampon STAFF sur la photo pour trancher une paire SÉPARÉE par l'étiquette Cardmarket, à 0 faux. Module PUR : ni base, ni réseau, ni modèle
// (la préparation de l'image et le lecteur sont INJECTÉS ; les octets viennent de l'appelant, jamais d'un téléchargement).
// Décision du testeur (17/10) : « STAFF lu => l'idProduct staff ; sinon une question ». Un JUMBO reste une question : la règle « jumbo par le titre » est RETIRÉE (tour 1 : elle ne se défend pas contre la négation).
// 🔑 Écrit par ce qu'il AUTORISE :
//   · le déclenchement : la question est EXACTEMENT une paire que l'archive prouve séparée (partageeTamponNonSepare false des deux côtés, listes de partage = la paire, variantes staff/normale) ;
//   · un seul chemin mène à « STAFF lu » : DEUX essais indépendants répondent « oui » à l'identique. Non, incertain, désaccord, panne, délai : la question reste, inchangée ;
//   · 🔴 ON N'AFFIRME JAMAIS LA VERSION NORMALE sur une absence de lecture : un tampon manqué n'est pas un tampon absent. Ce module ne sait même pas désigner la normale.
const COMPTEURS = ['declenchees', 'affirmees', 'nonConfirmees', 'echecs', 'appels', 'dejaTentees', 'nonFaisables'];
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
const memeListe = (l, a, b) => Array.isArray(l) && l.length === 2 && l.every(Number.isInteger) && [...l].sort((x, y) => x - y).join() === [a, b].sort((x, y) => x - y).join();
/**
 * @param ids     les idProduct de la question
 * @param entree  (idProduct) => l'entrée d'archive (format 2) ou null
 * @returns { ok: true, type: 'staff', special: idProduct, normale: idProduct } | { ok: false, motif }
 */
function paireSeparee({ ids, entree } = {}) {
    try {
        if (!Array.isArray(ids) || ids.length !== 2 || !ids.every(Number.isInteger) || ids[0] === ids[1]) return refus('la question n\'est pas exactement la paire');
        if (typeof entree !== 'function') return refus('aucune archive');
        const [a, b] = ids, ea = entree(a), eb = entree(b);
        if (!ea || !eb || typeof ea !== 'object' || typeof eb !== 'object') return refus('un candidat n\'a pas d\'entrée d\'archive');
        if (ea.partageeTamponNonSepare !== false || eb.partageeTamponNonSepare !== false) return refus('la paire n\'est pas marquée séparée');
        if (!memeListe(ea.produitsPartages, a, b) || !memeListe(eb.produitsPartages, a, b)) return refus('la liste de partage ne nomme pas exactement la paire');
        if (ea.partageeHoloNonHolo === true || eb.partageeHoloNonHolo === true) return refus('un partage holo / non-holo se mêle à la paire');
        const v = [ea.variante, eb.variante];
        const special = 'staff';
        if (!(v.includes(special) && v.includes('normale') && v[0] !== v[1])) return refus('les variantes ne sont pas une paire staff/normale');
        const idSpecial = ea.variante === special ? a : b, idNormale = idSpecial === a ? b : a;
        const dit = [ea, eb].some(x => typeof x.tamponNonRepresente === 'string' && x.tamponNonRepresente.trim().toLowerCase() === 'staff');
        if (!dit) return refus('l\'archive ne dit pas que le tampon Staff n\'est pas représenté');
        return { ok: true, type: special, special: idSpecial, normale: idNormale };
    } catch { return refus('archive illisible'); }
}

// ── le consensus : DEUX essais « oui » à l'identique
const VALEURS = Object.freeze(['oui', 'non', 'incertain']);
/** @param essais  ['oui'|'non'|'incertain', …] @returns { staff: boolean, lecture: 'oui'|'non'|'incertain'|'desaccord', raison } */
function decider({ essais } = {}) {
    const r = (staff, lecture, raison) => ({ staff, lecture, raison });
    if (!Array.isArray(essais) || essais.length < 2 || !essais.every(x => VALEURS.includes(x))) return r(false, 'incertain', 'moins de deux essais lisibles');
    if (essais.every(x => x === essais[0])) return essais[0] === 'oui' ? r(true, 'oui', 'deux essais indépendants lisent STAFF') : r(false, essais[0], `les essais répondent tous « ${essais[0]} »`);
    return r(false, 'desaccord', 'les essais ne répondent pas à l\'identique');
}

/**
 * Le fournisseur d'essais. `preparer({ image, corps })` rend les images à lire (une par essai, préparations DISTINCTES) ou [] ; `lecteur(bande, { signal })` rend { staff: 'yes'|'no'|'uncertain' | 'oui'… } ou { illisible: true }.
 * Ne LÈVE JAMAIS : un échec rend { echec: true } ; chaque appel TENTÉ est compté (compteur.appels et le compteur global) — c'est le coût, qu'il ait réussi ou non. Aucun téléchargement : `image` est un Buffer de l'appelant.
 */
const VERS_FR = Object.freeze({ yes: 'oui', no: 'non', uncertain: 'incertain', oui: 'oui', non: 'non', incertain: 'incertain' });
function creerFournisseur({ preparer, lecteur } = {}) {
    if (typeof preparer !== 'function' || typeof lecteur !== 'function') throw new Error('creerFournisseur : preparer et lecteur sont obligatoires');
    return async function lectureDuTampon({ image, corps, compteur, signal } = {}) {
        const c = compteur && typeof compteur === 'object' ? compteur : { appels: 0 };
        const essais = [];
        const fin = (lecture, extra = {}) => ({ lecture, essais, echec: false, sansImage: false, ...extra });
        if (!Buffer.isBuffer(image) || !image.length) return fin('incertain', { sansImage: true, raison: 'aucun octet d\'image fourni' });
        try {
            const bandes = await preparer({ image, corps, signal });
            if (!Array.isArray(bandes) || bandes.length < 2) return fin('incertain', { raison: 'aucune préparation de l\'image possible' });
            for (const bande of bandes.slice(0, 2)) {
                if (signal && signal.aborted) throw Object.assign(new Error('interrompue'), { code: 'INTERROMPUE' });
                c.appels = (c.appels || 0) + 1;                                    // compté AVANT l'appel : un appel qui échoue a coûté quand même
                const r = await lecteur(bande, { signal });
                essais.push(r && typeof r === 'object' && !r.illisible && VERS_FR[r.staff] ? VERS_FR[r.staff] : 'incertain');
                if (essais[0] !== 'oui') break;                                    // un premier essai qui ne dit pas « oui » ne peut plus mener à STAFF : le second appel est évité (coût)
            }
        } catch (e) { return { lecture: 'incertain', essais, echec: true, sansImage: false, raison: `échec de la lecture (${(e && (e.code || e.name)) || 'erreur'})` }; }
        if (essais.length === 1) return fin(essais[0], { raison: `le premier essai répond « ${essais[0]} » : pas de second appel` });
        const d = decider({ essais });
        return fin(d.lecture, { raison: d.raison });
    };
}

module.exports = { paireSeparee, decider, creerFournisseur, premiereFois, reinitialiser, compteurs, noter };
