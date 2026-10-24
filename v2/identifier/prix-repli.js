'use strict';
// Lot PRIX-LISIBLE — le REPLI HONNÊTE du prix. Module PUR : aucune base, aucun réseau.
// Décision de l'éditeur (2026-10-24) : jamais « prix illisible » quand la fiche a une donnée de prix. Quand le prix DANS L'ÉTAT ne peut pas être présenté, le serveur sert `prixRepli` :
//   · `repli: "tendance"`    — la tendance et les moyennes du guide du jour (le `PrixGuide` de la fiche, tel que le serveur le sert déjà) ;
//   · `repli: "etat-proche"` — l'offre lue par l'extension dans un état PIRE que l'état retenu (la seule offre qu'elle a), avec le guide s'il existe.
// Toujours : `fiable: false` (un repli n'est JAMAIS un prix sûr, quel que soit `guide.fiable`), une `cause` de liste fermée, et AUCUN verdict (le serveur n'en sert pas ; le client n'en calcule pas dessus).
// Sans AUCUNE donnée de prix (ni guide servi, ni offre), le repli est ABSENT : alors seulement « illisible » est vrai. La clé `prixRepli` n'existe pas quand il n'y a pas de repli (jamais null) :
// une réponse sans repli est celle d'avant, octet pour octet.
//
// 🔑 Écrit par ce qu'il AUTORISE : un repli ne naît que des cas listés ci-dessous ; tout ce qui n'y est pas (donnée illisible, état hors liste, prix non fini) ne donne rien.

const REPLIS = Object.freeze(['tendance', 'etat-proche']);
// langue-non-lue / etat-non-retenu : l'ANALYSE n'a rien dicté à lire (adaptateur.js prixLiveDe : codeLangue absent, ou etat.retenu null — la porte de confiance de l'état) ;
// lecture-ratee / tendance-seule / offre-autre-etat : le retour de l'extension (POST /api/retour-live).
const CAUSES = Object.freeze(['langue-non-lue', 'etat-non-retenu', 'lecture-ratee', 'tendance-seule', 'offre-autre-etat']);
const ETATS = Object.freeze(['MT', 'NM', 'EX', 'GD', 'LP', 'PL', 'PO']);          // du meilleur au pire (index.js ORDRE_ETATS)

const etatDe = x => { const e = typeof x === 'string' ? x.trim().toUpperCase() : null; return ETATS.includes(e) ? e : null; };
const prixDe = x => (typeof x === 'number' && Number.isFinite(x) && x > 0 ? x : null);

/**
 * TOUR 1 (M-1) — l'idProduct que l'ANALYSE a confirmé pour cette carte, ou null. Écrit par ce qu'il AUTORISE : une carte `identifiee` (son idProduct), ou une question `a-trancher` RÉPONDUE par un candidat
 * (`reponse.idProduct`, écrit par /api/identifier/reponse). Tout le reste — question en attente ou abandonnée (« aucune », « ne-sait-pas »), introuvable, ligne illisible — n'a pas de produit confirmé : jamais le gagnant
 * du journal ni un candidat (le guide d'un candidat non confirmé serait le prix d'une autre carte).
 */
function idConfirme(e) {
    if (!e || typeof e !== 'object') return null;
    if (e.statut === 'identifiee') return Number.isInteger(e.idProduct) ? e.idProduct : null;
    if (e.statut === 'a-trancher' && e.reponse && typeof e.reponse === 'object' && Number.isInteger(e.reponse.idProduct)) return e.reponse.idProduct;
    return null;
}

/** Le guide d'une fiche est servable seulement s'il porte une date ET un prix (la même règle que produit.js::prixGuideDe, qui rend null sinon). */
function guideServable(g) {
    if (!g || typeof g !== 'object' || Array.isArray(g) || typeof g.date !== 'string') return null;
    return prixDe(g.tendance) !== null || prixDe(g.de) !== null || prixDe(g.moyenne30) !== null ? g : null;
}

/** Le repli « tendance » : le guide du jour, ou null (aucune donnée de prix). */
function depuisGuide(prixGuide, cause) {
    if (!CAUSES.includes(cause)) throw new Error(`prix-repli : cause hors liste : ${cause}`);
    const guide = guideServable(prixGuide);
    return guide ? Object.freeze({ repli: 'tendance', cause, fiable: false, guide, offre: null }) : null;
}

/** Le repli « etat-proche » : l'offre lue dans un état PIRE que l'état retenu. null si l'état retenu est inconnu, si l'état lu n'est pas pire, ou si l'offre n'est pas un prix. */
function depuisOffre(prixGuide, retenu, etatLu, prix) {
    const r = etatDe(retenu), e = etatDe(etatLu), p = prixDe(prix);
    if (r === null || e === null || p === null || ETATS.indexOf(e) <= ETATS.indexOf(r)) return null;
    return Object.freeze({ repli: 'etat-proche', cause: 'offre-autre-etat', fiable: false, guide: guideServable(prixGuide), offre: Object.freeze({ etat: e, prix: p }) });
}

/**
 * Au bord de la route : la carte d'une ANALYSE, ou de la réponse à une question. Une carte identifiée dont l'analyse n'a rien dicté à lire (prixLive null, ou etatVise null) reçoit `prixRepli`
 * si sa fiche a une donnée de prix. Toute autre carte est rendue TELLE QUELLE (la même référence : une réponse sans repli est celle d'avant, octet pour octet).
 */
function avecRepliAnalyse(c) {
    if (!c || typeof c !== 'object' || c.statut !== 'identifiee' || !c.carte || typeof c.carte !== 'object') return c;
    const cause = c.prixLive === null || c.prixLive === undefined ? 'langue-non-lue' : (c.prixLive && typeof c.prixLive === 'object' && (c.prixLive.etatVise === null || c.prixLive.etatVise === undefined)) ? 'etat-non-retenu' : null;
    if (cause === null) return c;
    const repli = depuisGuide(c.carte.prixGuide, cause);
    return repli ? { ...c, prixRepli: repli } : c;
}

/** L'analyse entière (une ou plusieurs cartes) : chaque carte reçoit son repli s'il y a lieu. La MÊME référence quand aucune carte n'en reçoit (octet pour octet). */
function analyseAvecRepli(analyse) {
    if (!analyse || typeof analyse !== 'object' || !Array.isArray(analyse.cartes)) return analyse;
    const cartes = analyse.cartes.map(avecRepliAnalyse);
    return cartes.every((c, i) => c === analyse.cartes[i]) ? analyse : { ...analyse, cartes };
}

/**
 * Le retour de l'extension (POST /api/retour-live) : le repli à joindre à la réponse, ou null.
 * @param o.prixGuide  le `prixGuide` de la fiche (celui que l'analyse a servi) ; o.retenu l'état retenu de l'analyse ; o.lectureRatee { cause, definitive } | null ;
 *                     o.originePrix / o.prixLive / o.prixLiveEtat : ce que l'extension a envoyé.
 */
function repliRetourLive(o = {}) {
    if (o.lectureRatee) return depuisGuide(o.prixGuide, 'lecture-ratee');
    if (o.originePrix === 'tendance') return depuisGuide(o.prixGuide, 'tendance-seule');
    if (o.originePrix === 'grille') return depuisOffre(o.prixGuide, o.retenu, o.prixLiveEtat, o.prixLive);
    return null;
}
/** `{ prixRepli }` ou `{}` : pour étaler dans une réponse sans jamais écrire une clé nulle. */
const avec = repli => (repli ? { prixRepli: repli } : {});
/** La carte SANS son repli (le scanner ne le sert jamais : il n'a aucune lecture live) ; la même référence quand il n'y en a pas. */
function sansRepli(c) {
    if (!c || typeof c !== 'object' || !Object.prototype.hasOwnProperty.call(c, 'prixRepli')) return c;
    const { prixRepli, ...reste } = c;
    return reste;
}

module.exports = { REPLIS, CAUSES, ETATS, idConfirme, depuisGuide, depuisOffre, avecRepliAnalyse, analyseAvecRepli, repliRetourLive, avec, sansRepli };
