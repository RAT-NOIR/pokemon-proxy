'use strict';
// CAPACITES-PING (2026-10-24) — ce que `GET /ping` annonce : `capacites`, un tableau de jetons tiré d'une liste FERMÉE. Un jeton dit « cette partie du contrat est servie, et allumée, sur CE serveur » :
// l'extension (build final du Store) n'allume chaque contrat que si le serveur l'annonce. Annoncer ce qu'on ne sert pas fait afficher à un client une donnée absente ; taire ce qu'on sert coûte une fonction.
//
// MODULE PUR : aucun `require`, aucune base, aucun réseau, aucun temps — /ping reste un keep-alive. Un test (test-capacites-ping.js) échoue si un `require` apparaît ici.
//
// LA GARDE EST ÉCRITE PAR CE QU'ELLE AUTORISE : un jeton sort si et seulement s'il est dans CAPACITES ET si sa condition rend EXACTEMENT `true`. Pas de condition écrite, une condition qui lève, qui rend autre
// chose que le booléen vrai : le jeton tombe, en silence, jamais d'exception. La liste est gelée ; l'ORDRE de la réponse est celui de la liste ; aucun doublon.
//
// ── CE QUI REND CHAQUE JETON VRAI, SUR CE CODE (prouvé ligne à ligne ; le banc appelle ce code pour que la preuve ne vieillisse pas) ──
//   Aucun des cinq ne dépend d'un drapeau de v2/config.js : chaque partie est servie SANS condition par ce serveur. Les conditions sont donc des constantes, et chacune dit où est sa preuve.
//   Quand un drapeau conditionnera une partie, c'est ICI que la condition lira `cfg` (la MÊME configuration que la route) ; le banc échoue alors (il vérifie qu'aucun réglage ne bouge la liste) et exige un cas par drapeau.
//   `langue-impression`  : impressions[].langue — identifier/produit.js:77 (langueFermee, null si inconnue) ; la langue du tirage vient de identifier/visuels.js:162 (langueDeTirage, identifier/langue-decisive.js:73).
//   `marques`            : Produit.marques et Impression.marques — identifier/produit.js:103 et :75 (marquesDe, identifier/produit.js:56) ; l'archive les prouve par identifier/visuels.js:160.
//   `prix-incertains`    : prixGuide.{fiable, reserves, moyenne7, moyenne30, deBase} — identifier/produit.js:49 ; `version` — :76 et :103 ; `set.badge` — :101 (identifier/fiabilite-prix.js:54) ;
//                          regleVerdict.ecartTendanceMax — identifier/taux.js:12, posé dans la réponse par identifier/routes.js:655.
//   `prix-repli`         : carte.prixRepli — identifier/prix-repli.js:57-70, posé par identifier/routes.js:655 ET REPLI-QUOTA en place : un scan dont la réponse sert un repli compte (`raisonNonRembourse: "prix-repli"`),
//                          identifier/retour-live.js:157 (la règle est identifier/prix-repli.js:90, afficheUnPrix ; la raison est dans sources.js RAISONS_NON_REMBOURSE).
//   `achete-avant-jour`  : facturation.poche — argent/poche-servie.js:25, posé par identifier/routes.js:691 (et :629, :635, :641) ET l'achat est débité avant le quota du jour — argent/poches.js:8-10 (ordre fixé
//                          dans le code, config.js refuse qu'une variable le change : V2_ORDRE_POCHES ne peut pas nommer `achete`).
// Un jeton dont le code ne pourrait pas être prouvé servi n'entre pas dans CONDITIONS : il n'est jamais annoncé.

/** La liste fermée (DEMANDE-SERVEUR-EXTENSION.md, « EXTENSION — 24/10 (soir) »), dans l'ordre de la réponse. UN seul endroit : les bancs, le schéma et le contrat la lisent d'ici. */
const CAPACITES = Object.freeze(['langue-impression', 'marques', 'prix-incertains', 'prix-repli', 'achete-avant-jour']);

/** Les conditions du code d'aujourd'hui : cfg => true seulement si la partie est servie et allumée. Constantes ici (voir plus haut) ; gelées. */
const CONDITIONS = Object.freeze({
    'langue-impression': () => true,
    'marques': () => true,
    'prix-incertains': () => true,
    'prix-repli': () => true,
    'achete-avant-jour': () => true
});

/**
 * Les jetons à annoncer pour cette configuration. Ne lève JAMAIS. `conditions` ne sert qu'aux bancs (injecter une condition fausse) ; la production passe la table du code.
 * @param cfg        la configuration v2 (celle de la route) ; passée telle quelle à chaque condition
 * @param conditions { jeton: cfg => boolean } — seuls les jetons de CAPACITES, et seulement leurs propres entrées, sont lus
 * @returns {string[]} un tableau NEUF, dans l'ordre de CAPACITES, sans doublon
 */
function capacitesServies(cfg, conditions = CONDITIONS) {
    const sortie = [];
    if (cfg === null || typeof cfg !== 'object') return sortie;   // pas de configuration lue : la v2 n'est pas configurée, elle n'annonce rien (même condition que versionMinExtension)
    const table = conditions !== null && typeof conditions === 'object' ? conditions : {};
    for (const jeton of CAPACITES) {
        if (!Object.prototype.hasOwnProperty.call(table, jeton)) continue;
        const condition = table[jeton];
        if (typeof condition !== 'function') continue;
        let vrai = false;
        try { vrai = condition(cfg) === true; } catch (_) { vrai = false; }
        if (vrai) sortie.push(jeton);
    }
    return sortie;
}

module.exports = { CAPACITES, CONDITIONS, capacitesServies };
