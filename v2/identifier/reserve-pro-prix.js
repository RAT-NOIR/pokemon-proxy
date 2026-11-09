'use strict';
// RÉSERVATION PRO DU PRIX PAR ÉTAT ET PAR LANGUE (critère bloquant n° 5 de l'ouverture de Pro, LISTE-LANCEMENT.md ; décision de l'éditeur du 2026-11-08 ; CONTRAT-API-V2.md §1.5).
//
// LA RÈGLE : l'ÉTAT ESTIMÉ sans prix (le champ `etat` : état, confiance, défauts) reste GRATUIT pour tous, définitivement, à l'octet près — ce module ne le lit ni ne le touche jamais. Pro SEUL reçoit le PRIX selon
// l'état et selon la langue, c'est-à-dire :
//   · `prixLive` : l'instruction « lis le prix de CETTE carte, dans CES langues, à CET état » que l'analyse dicte à l'extension (identifier/adaptateur.js::prixLiveDe) ;
//   · `prixRepli` des genres d'ÉTAT : `etat-proche` (l'offre lue dans un état pire), `fourchette`, et tout repli qui porte une `fourchette` (état non estimable).
// Ce qui ne bouge JAMAIS : le prix du GUIDE général (`prixGuide` de la fiche et de ses impressions, sans état ni langue), le lien « Voir le prix », et le repli GÉNÉRAL `tendance` (la tendance et les moyennes du guide du
// jour : ni état, ni langue, ni fourchette, ni offre lue).
//
// DRAPEAU V2_PRO_PRIX_RESERVE (config.js : `cfg.proPrixReserve`), ÉTEINT par défaut. ÉTEINT, chaque fonction de ce module rend sa copie conforme (la MÊME référence) : chaque réponse est celle d'avant, à l'octet.
// ALLUMÉ, la garde est écrite par ce qu'elle AUTORISE : SEULE une offre dont le nom est exactement « pro » (l'offre RELUE en base par argent/offre.js : abonnement actif ET en cours, ou administrateur) reçoit ces champs.
// Offre absente (erreur de lecture : offreSur rend undefined), nulle, inconnue, d'une autre forme : la réponse du GRATUIT. « Je ne sais pas » n'est jamais « tout va bien ».
//
// UNE SEULE FONCTION DE DÉCISION (`accesPrixParEtat`), appelée par TOUTES les sorties qui posent ces champs : /api/identifier (une carte ET un lot, routes.js), /api/identifier/reponse (routes.js), /api/identifier/mesures
// (calcul-client-route.js), /api/retour-live (retour-live.js), et le REJEU d'idempotence (rejeuSelonOffre, branché sur ces quatre routes par identifier/monter.js). Le scanner ne sert jamais ces champs (scanner/routes.js
// les retire pour tout le monde). test-offre-prix-reserve-pro.js DÉDUIT du code la liste des fichiers qui posent ces champs et exige qu'ils importent ce module.
//
// LE REJEU (arbitrage) : la réponse conservée par l'idempotence est la réponse COMPLÈTE (celle que Pro recevrait) quand le gratuit est servi sans prix : au rejeu, l'offre ACTUELLE décide — expirée, rien ne fuit ; passée à
// Pro, rien n'est retiré à tort. Exceptions nommées, où la décision d'argent a dépendu de la réservation (le remboursement d'un lot, d'un retour en direct) : la réponse conservée est celle qui a été SERVIE, le rejeu ne fait
// que RETIRER (jamais de fuite), jamais ajouter.

const { offreSur } = require('../argent/offre-sur');
const PR = require('./prix-repli');

const aPropre = (o, k) => Boolean(o) && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k);

/** Le drapeau est-il allumé ? Écrit par ce qu'il AUTORISE : SEUL `true` (config.js ne rend que true ou false). Configuration absente : éteint. */
const reservationActive = cfg => Boolean(cfg) && cfg.proPrixReserve === true;

/**
 * LA décision. true = ce porteur reçoit le prix par état et par langue.
 * Éteint : true pour tous (la réponse d'avant). Allumé : true SEULEMENT pour une offre `{ nom: 'pro' }` ; tout le reste (undefined, null, nom inconnu, chaîne, tableau, objet vide) : false.
 */
function accesPrixParEtat(cfg, offre) {
    if (!reservationActive(cfg)) return true;
    return Boolean(offre) && typeof offre === 'object' && !Array.isArray(offre) && offre.nom === 'pro';
}

/** La décision d'un porteur : relit son offre (la MÊME lecture que toutes les routes : argent.offre) ; une lecture qui échoue donne le gratuit. Éteint : aucune lecture, true. Ne lève jamais. */
async function accesPour({ cfg, porteur, argent = null }) {
    if (!reservationActive(cfg)) return true;
    let offre;
    try { offre = await offreSur(porteur, argent); } catch (_) { offre = undefined; }
    return accesPrixParEtat(cfg, offre);
}

/** Le repli GÉNÉRAL : la tendance du guide, sans offre lue ni fourchette. Écrit par ce qu'il AUTORISE. */
const repliGeneral = r => Boolean(r) && typeof r === 'object' && !Array.isArray(r) && r.repli === 'tendance' && r.offre === null && !aPropre(r, 'fourchette');

/** Le repli « tendance » AVEC fourchette (état non estimable) : son guide (sous la mention d'état non estimable) est un prix du guide général ; seule la fourchette est un prix par état. */
const repliTendanceAFourchette = r => Boolean(r) && typeof r === 'object' && !Array.isArray(r) && r.repli === 'tendance' && r.offre === null && aPropre(r, 'fourchette') && Boolean(r.guide) && typeof r.guide === 'object';

/**
 * Un repli selon l'accès : tel quel avec l'accès. Sans accès : le repli général tel quel ; le repli « tendance » à fourchette DÉGRADÉ en repli général (le même guide, la fourchette retirée : il reste un prix du guide affiché, donc le scan
 * reste compté, F1 de la relecture de l'argent) ; tout autre genre (« etat-proche », « fourchette » sans guide) : null. La MÊME référence quand rien ne change.
 */
function repliSelonOffre(repli, acces) {
    if (acces) return repli;
    if (repliGeneral(repli)) return repli;
    if (repliTendanceAFourchette(repli)) { const { fourchette, ...general } = repli; return general; }
    return null;
}

/**
 * F2 (relecture de l'argent) : une carte IDENTIFIÉE (analyse COMPLÈTE : avec son repli de Pro) qui, servie à un non-Pro, n'affiche POSITIVEMENT aucun prix : prixGuide exactement null et aucun repli général. Un champ absent ou
 * d'une forme inconnue est un doute : un prix est supposé affiché (jamais un remboursement sur un doute). Même règle que lot.js (afficheUnPrix, la seule).
 */
function carteSansPrixPourGratuit(c) {
    try {
        if (!c || typeof c !== 'object' || c.statut !== 'identifiee' || !c.carte || typeof c.carte !== 'object' || c.carte.prixGuide !== null) return false;
        return !PR.afficheUnPrix({ prixRendu: false, repli: repliSelonOffre(PR.avecRepliAnalyse(c).prixRepli ?? null, false) });
    } catch (_) { return false; }
}

/** Une carte d'analyse selon l'accès. Sans accès : `prixLive` à null (la clé reste, comme pour une langue non lue) et `prixRepli` retiré s'il n'est pas général. La MÊME référence quand rien ne change (octet pour octet). */
function carteSelonOffre(c, acces) {
    if (acces || !c || typeof c !== 'object' || Array.isArray(c)) return c;
    const repli = aPropre(c, 'prixRepli') ? repliSelonOffre(c.prixRepli, false) : undefined;
    const changeRepli = aPropre(c, 'prixRepli') && repli !== c.prixRepli;
    const retireLive = c.prixLive !== null && c.prixLive !== undefined;
    if (!changeRepli && !retireLive) return c;
    const o = { ...c };
    if (changeRepli) { if (repli === null) delete o.prixRepli; else o.prixRepli = repli; }
    if (retireLive) o.prixLive = null;
    return o;
}

/** Une analyse (une ou plusieurs cartes) selon l'accès. La MÊME référence quand aucune carte ne change. */
function analyseSelonOffre(analyse, acces) {
    if (acces || !analyse || typeof analyse !== 'object' || !Array.isArray(analyse.cartes)) return analyse;
    const cartes = analyse.cartes.map(c => carteSelonOffre(c, false));
    return cartes.every((c, i) => c === analyse.cartes[i]) ? analyse : { ...analyse, cartes };
}

/**
 * Un corps de réponse selon l'accès, QUELLE QUE SOIT SA FORME (analyse, carte répondue, retour en direct) : sert au REJEU, qui ne connaît que le texte conservé. Sans accès : les cartes de `analyse.cartes`, la `carte`
 * et le `prixRepli` de premier niveau passent par la même règle que ci-dessus. La MÊME référence quand rien ne change.
 */
function corpsSelonOffre(corps, acces) {
    if (acces || !corps || typeof corps !== 'object' || Array.isArray(corps)) return corps;
    let sortie = corps;
    if (corps.analyse && typeof corps.analyse === 'object') { const a = analyseSelonOffre(corps.analyse, false); if (a !== corps.analyse) sortie = { ...sortie, analyse: a }; }
    if (corps.carte && typeof corps.carte === 'object') { const c = carteSelonOffre(corps.carte, false); if (c !== corps.carte) sortie = { ...sortie, carte: c }; }
    if (aPropre(corps, 'prixRepli')) { const r = repliSelonOffre(corps.prixRepli, false); if (r !== corps.prixRepli) { if (r === null) { const { prixRepli, ...reste } = sortie; sortie = reste; } else sortie = { ...sortie, prixRepli: r }; } }
    return sortie;
}

/**
 * Envoyer une réponse selon l'accès, en gardant dans `res.locals` la réponse COMPLÈTE que l'idempotence doit conserver (voir l'en-tête, « le rejeu »). `servi` est le corps déjà réservé, `complet` celui que Pro recevrait.
 * `complet` n'est conservé que si l'accès est refusé, que la route l'a demandé (`res.locals.rejeuReserve`, posé par idempotente) et que rien n'a dépendu de la réservation (`completPourRejeu`).
 */
function conserverComplet(res, complet, { acces, completPourRejeu = true } = {}) {
    if (acces || !completPourRejeu || !res || !res.locals || res.locals.rejeuReserve !== true) return;
    try { res.locals.reponseAConserver = JSON.stringify(complet); } catch (_) { /* la réponse servie est conservée telle quelle : le rejeu ne fait que retirer */ }
}

/**
 * Le transformeur du REJEU, branché par identifier/monter.js sur chaque route idempotente qui sert ces champs. `null` quand le drapeau est éteint (l'idempotence reste ce qu'elle était, octet pour octet).
 * Rend le texte à rejouer, ou `null` si on ne peut pas conclure (texte illisible) : l'idempotence répond alors INDISPONIBLE, jamais un prix.
 */
function rejeuSelonOffre(cfg, obtenirArgent = null) {
    if (!reservationActive(cfg)) return null;
    return async function rejeu(texte, req) {
        const porteur = req && req.v2 && req.v2.porteur;
        let argent = null;
        try { argent = typeof obtenirArgent === 'function' ? obtenirArgent() : null; } catch (_) { argent = null; }
        const acces = porteur ? await accesPour({ cfg, porteur, argent }) : false;
        if (acces) return texte;
        let corps;
        try { corps = JSON.parse(texte); } catch (_) { return null; }
        return JSON.stringify(corpsSelonOffre(corps, false));
    };
}

module.exports = { carteSansPrixPourGratuit, reservationActive, accesPrixParEtat, accesPour, repliGeneral, repliSelonOffre, carteSelonOffre, analyseSelonOffre, corpsSelonOffre, conserverComplet, rejeuSelonOffre };
