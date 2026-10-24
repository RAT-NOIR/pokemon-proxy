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
const FE = require('./fourchette-etat');
const ETATS = FE.ETATS;          // du meilleur au pire (index.js ORDRE_ETATS) — une seule copie, celle de fourchette-etat.js

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

/**
 * Le repli « tendance » : le guide du jour, ou null (aucune donnée de prix).
 * ETAT-FOURCHETTE : quand l'état n'est pas estimable (`o.etatNonEstimable === true`, la règle de fourchette-etat.js), le repli porte en plus la FOURCHETTE (`fourchette`, bornes tirées du guide servi et,
 * s'il est là, de `o.grille` lue en direct) et son guide est le guide de la fiche SOUS FOURCHETTE : jamais fiable, avec la mention `etat-non-estimable` après ses réserves. Le prix n'est jamais refusé à cause de l'état.
 */
function depuisGuide(prixGuide, cause, o = {}) {
    if (!CAUSES.includes(cause)) throw new Error(`prix-repli : cause hors liste : ${cause}`);
    const guide = guideServable(prixGuide);
    if (!guide) return null;
    if (o && o.etatNonEstimable === true) return Object.freeze({ repli: 'tendance', cause, fiable: false, guide: FE.guideSousFourchette(guide), offre: null, fourchette: FE.fourchetteDe({ guide, grille: o.grille }) });
    return Object.freeze({ repli: 'tendance', cause, fiable: false, guide, offre: null });
}

/** Le repli « etat-proche » : l'offre lue dans un état PIRE que l'état retenu. null si l'état retenu est inconnu, si l'état lu n'est pas pire, ou si l'offre n'est pas un prix. */
function depuisOffre(prixGuide, retenu, etatLu, prix) {
    const r = etatDe(retenu), e = etatDe(etatLu), p = prixDe(prix);
    if (r === null || e === null || p === null || ETATS.indexOf(e) <= ETATS.indexOf(r)) return null;
    return Object.freeze({ repli: 'etat-proche', cause: 'offre-autre-etat', fiable: false, guide: guideServable(prixGuide), offre: Object.freeze({ etat: e, prix: p }) });
}

/**
 * Au bord de la route : la carte d'une ANALYSE, ou de la réponse à une question. Une carte identifiée dont l'analyse n'a rien dicté à lire (prixLive null, ou état non estimable) reçoit `prixRepli`
 * si sa fiche a une donnée de prix. Toute autre carte est rendue TELLE QUELLE (la même référence : une réponse sans repli est celle d'avant, octet pour octet).
 * ETAT-FOURCHETTE : l'état est jugé par fourchette-etat.js::etatNonEstimable sur TOUT ce que la carte porte (l'état retenu de `etat` et l'état visé de `prixLive`) ; non estimable, le repli est la fourchette.
 * M1 (tour 4, correction 1) : sur une carte dont l'état est non estimable, TOUT prix servi passe sous la même mention (« jamais un prix sûr ») : le `prixGuide` de la carte et de ses impressions, et celui des candidats d'une
 * question à trancher (FE.produitSousFourchette). Une carte à trancher ne reçoit jamais de repli.
 */
function avecRepliAnalyse(c) {
    if (!c || typeof c !== 'object' || (c.statut !== 'identifiee' && c.statut !== 'a-trancher')) return c;
    const etats = [];
    if (c.etat && typeof c.etat === 'object') etats.push(c.etat.retenu);
    if (c.prixLive && typeof c.prixLive === 'object') etats.push(c.prixLive.etatVise);
    const nonEstimable = FE.etatNonEstimable(...etats);
    const marque = nonEstimable ? FE.produitSousFourchette : x => x;
    if (c.statut === 'a-trancher') {
        const candidats = Array.isArray(c.candidats) ? c.candidats.map(marque) : c.candidats;
        return Array.isArray(candidats) && candidats.some((x, i) => x !== c.candidats[i]) ? { ...c, candidats } : c;
    }
    if (!c.carte || typeof c.carte !== 'object') return c;
    const carte = marque(c.carte);
    const sansLecture = c.prixLive === null || c.prixLive === undefined;
    const cause = sansLecture ? 'langue-non-lue' : (c.prixLive && typeof c.prixLive === 'object' && nonEstimable) ? 'etat-non-retenu' : null;
    const repli = cause === null ? null : depuisGuide(c.carte.prixGuide, cause, { etatNonEstimable: nonEstimable });
    if (carte === c.carte && !repli) return c;
    return { ...c, carte, ...(repli ? { prixRepli: repli } : {}) };
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
 *                     o.originePrix / o.prixLive / o.prixLiveEtat / o.grilleLive : ce que l'extension a envoyé.
 * ETAT-FOURCHETTE : si l'état retenu n'est pas estimable (la MÊME règle que l'analyse, fourchette-etat.js::etatNonEstimable), JAMAIS un prix d'un seul état : la fourchette (guide + grille lue en direct) est servie
 * pour une lecture ratée, une tendance, une offre de la grille (cause `etat-non-retenu`) et un plancher toutes langues. Sans guide servi, rien à servir : le prix lu reste celui du client.
 */
function repliRetourLive(o = {}) {
    const opts = { etatNonEstimable: FE.etatNonEstimable(o.retenu) };
    if (o.lectureRatee) return depuisGuide(o.prixGuide, 'lecture-ratee', opts);
    if (o.originePrix === 'tendance') return depuisGuide(o.prixGuide, 'tendance-seule', opts);
    // M3 (tour 4, correction 1) : état nul et un prix valide lu, QUELLE QUE SOIT l'origine (grille, plancher toutes langues, origine absente ou inconnue des extensions anciennes) : le prix d'un seul état n'est jamais servi sans la mention
    // ni `fiable: false`. Forme la plus simple qui tienne la règle : le même repli à fourchette, cause `etat-non-retenu`. Seule l'origine `grille` apporte sa grille (celle d'un plancher « toutes langues » n'est pas celle de la langue visée).
    if (opts.etatNonEstimable && (o.originePrix === 'grille' || o.originePrix === 'plancher-toutes-langues' || prixDe(o.prixLive) !== null))
        return depuisGuide(o.prixGuide, 'etat-non-retenu', { ...opts, grille: o.originePrix === 'grille' ? o.grilleLive : null });
    if (o.originePrix === 'grille') return depuisOffre(o.prixGuide, o.retenu, o.prixLiveEtat, o.prixLive);
    return null;
}
/**
 * REPLI-QUOTA (décision de l'éditeur, 2026-10-24) — LA règle « ce scan AFFICHE un prix », en UN SEUL endroit (§21 bis : deux exemplaires d'une règle divergent toujours).
 * « Un scan qui AFFICHE un prix (même un repli avec mention) est une analyse rendue, donc il COMPTE dans le quota. Seuls les scans sans aucun prix affiché gardent le remboursement. »
 * Un scan affiche un prix quand (a) la page a rendu un prix (`prixRendu: true`) OU (b) le serveur sert, pour CE scan, un `prixRepli` non nul (`repli`).
 * Écrit par ce qu'il AUTORISE : seul un booléen vrai ou un objet de repli compte ; toute autre valeur (undefined, null, 1, une chaîne) n'affiche RIEN, donc le remboursement d'avant reste dû.
 * Le repli à passer est CELUI qui part dans la réponse (jamais un second calcul) : la décision d'argent et ce que le client voit ne peuvent pas diverger.
 */
function afficheUnPrix({ prixRendu = false, repli = null } = {}) {
    return prixRendu === true || (repli !== null && typeof repli === 'object' && !Array.isArray(repli));
}
/** `{ prixRepli }` ou `{}` : pour étaler dans une réponse sans jamais écrire une clé nulle. */
const avec = repli => (repli ? { prixRepli: repli } : {});
/** La carte SANS son repli (le scanner ne le sert jamais : il n'a aucune lecture live) ; la même référence quand il n'y en a pas. */
function sansRepli(c) {
    if (!c || typeof c !== 'object' || !Object.prototype.hasOwnProperty.call(c, 'prixRepli')) return c;
    const { prixRepli, ...reste } = c;
    return reste;
}

module.exports = { REPLIS, CAUSES, ETATS, etatNonEstimable: FE.etatNonEstimable, idConfirme, depuisGuide, depuisOffre, avecRepliAnalyse, analyseAvecRepli, repliRetourLive, afficheUnPrix, avec, sansRepli };
