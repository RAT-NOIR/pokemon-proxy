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
//   Aucun des cinq ne dépend d'un drapeau de v2/config.js. TROIS sont servis par le CODE seul (constantes vraies). DEUX (`langue-impression`, `marques`) dépendent d'une DONNÉE : l'archive des visuels, EN MÉMOIRE
//   (v2/chargeur/etat.js, `version()`) — sans archive (réveil à froid, clés de lecture fermées) `impressions` est vide et `Produit.marques` vaut null ; avec une archive d'avant la colonne des jumeaux, `langue` vaut null partout.
//   Un jeton ne s'annonce que si la donnée est RÉELLEMENT servie à cet instant : il lit la version en mémoire par un LECTEUR INJECTÉ (3e argument de capacitesServies ; index.js passe etat.version), jamais la base ;
//   pas de lecteur, lecteur qui lève, archive absente ou sans la colonne : le jeton tombe. Quand un drapeau conditionnera une partie, la condition lira `cfg` (la MÊME configuration que la route) ; le banc balaie
//   toutes les variables V2_* de config.js et échoue sur une variable nouvelle.
//   `langue-impression`  : impressions[].langue — identifier/produit.js:77 (langueFermee, null si inconnue) ; la langue du tirage vient de identifier/visuels.js:162 (langueDeTirage, identifier/langue-decisive.js:73)
//                          = chargeur/version.js:201 (tirageJumeaux, null sans la colonne des jumeaux) ; sans archive, identifier/visuels.js:150 rend []. CONDITION : archive en mémoire ET `colonneJumeaux === true` (version.js:195).
//   `marques`            : Produit.marques et Impression.marques — identifier/produit.js:103 et :75 (marquesDe, identifier/produit.js:56) ; la variante vient de l'ARCHIVE : identifier/catalogue.js:99/111,
//                          identifier/visuels.js:160 (chargeur/version.js:159). CONDITION : archive en mémoire, avec au moins une entrée qui porte la variante.
//   `prix-incertains`    : prixGuide.{fiable, reserves, moyenne7, moyenne30, deBase} — identifier/produit.js:49 ; `version` — :76 et :103 ; `set.badge` — :101 (identifier/fiabilite-prix.js:54) ;
//                          regleVerdict.ecartTendanceMax — identifier/taux.js:12, posé dans la réponse par identifier/routes.js:655.
//   `prix-repli`         : carte.prixRepli — identifier/prix-repli.js:57-70, posé par identifier/routes.js:655 ET REPLI-QUOTA en place : un scan dont la réponse sert un repli compte (`raisonNonRembourse: "prix-repli"`),
//                          identifier/retour-live.js:157 (la règle est identifier/prix-repli.js:90, afficheUnPrix ; la raison est dans sources.js RAISONS_NON_REMBOURSE).
//   `achete-avant-jour`  : facturation.poche — argent/poche-servie.js:25, posé par identifier/routes.js:691 (et :629, :635, :641) ET l'achat est débité avant le quota du jour — argent/poches.js:8-10 (ordre fixé
//                          dans le code, config.js refuse qu'une variable le change : V2_ORDRE_POCHES ne peut pas nommer `achete`).
// Un jeton dont le code ne pourrait pas être prouvé servi n'entre pas dans CONDITIONS : il n'est jamais annoncé.

/** La liste fermée (DEMANDE-SERVEUR-EXTENSION.md, « EXTENSION — 24/10 (soir) »), dans l'ordre de la réponse. UN seul endroit : les bancs, le schéma et le contrat la lisent d'ici. */
const CAPACITES = Object.freeze(['langue-impression', 'marques', 'prix-incertains', 'prix-repli', 'achete-avant-jour']);

/**
 * L'archive des visuels EN MÉMOIRE est-elle en place, avec au moins un produit ? `version` est ce que rend le lecteur (chargeur/etat.js::version) : un objet gelé, ou null. Écrit par ce qu'il AUTORISE :
 * un objet qui sait lister ses produits (`identifiants`) et en porte au moins un ; tout le reste (null, undefined, une chaîne, un tableau) n'est PAS une archive. Peut lever : l'appelant l'enveloppe.
 */
function archiveEnPlace(version) {
    if (version === null || typeof version !== 'object' || Array.isArray(version) || typeof version.identifiants !== 'function') return false;
    const ids = version.identifiants();
    return ids !== null && typeof ids === 'object' && ids.length > 0;
}

/**
 * Les conditions du code d'aujourd'hui : (cfg, lireVersion) => true seulement si la partie est servie et allumée. Gelées. `lireVersion` rend la version en mémoire (ou null) ; il est INJECTÉ (capacitesServies),
 * pour que ce module reste sans `require` et que le banc simule « archive absente », « sans la colonne » et « complète ». Aucune lecture en base.
 */
const CONDITIONS = Object.freeze({
    // l'archive en place ET la colonne des jumeaux (version.colonneJumeaux === true, le booléen) : c'est elle qui donne la langue du tirage de chaque impression
    'langue-impression': (cfg, lireVersion) => { const v = lireVersion(); return archiveEnPlace(v) && v.colonneJumeaux === true; },
    // l'archive en place ET une entrée qui porte la variante (la clé `variante`, même nulle) : c'est elle qui donne les marques prouvées d'un produit et de ses impressions
    'marques': (cfg, lireVersion) => {
        const v = lireVersion();
        if (!archiveEnPlace(v) || typeof v.entree !== 'function') return false;
        const e = v.entree(v.identifiants()[0]);
        return e !== null && typeof e === 'object' && 'variante' in e;
    },
    'prix-incertains': () => true,
    'prix-repli': () => true,
    'achete-avant-jour': () => true
});

/**
 * Les jetons à annoncer pour cette configuration. Ne lève JAMAIS. `conditions` ne sert qu'aux bancs (injecter une condition fausse) ; la production passe la table du code.
 * @param cfg           la configuration v2 (celle de la route) ; passée telle quelle à chaque condition
 * @param conditions    { jeton: (cfg, lireVersion) => boolean } — seuls les jetons de CAPACITES, et seulement leurs propres entrées, sont lus
 * @param lireVersion   () => la version de l'archive des visuels EN MÉMOIRE, ou null. Interrogé à CHAQUE condition qui le demande (jamais gardé). Absent ou pas une fonction : « aucune archive » — les jetons
 *                      qui dépendent d'elle tombent (ils ne s'annoncent jamais sur une donnée dont on ne sait pas qu'elle est là).
 * @returns {string[]} un tableau NEUF, dans l'ordre de CAPACITES, sans doublon
 */
function capacitesServies(cfg, conditions = CONDITIONS, lireVersion = null) {
    const sortie = [];
    if (cfg === null || typeof cfg !== 'object') return sortie;   // pas de configuration lue : la v2 n'est pas configurée, elle n'annonce rien (même condition que versionMinExtension)
    const table = conditions !== null && typeof conditions === 'object' ? conditions : {};
    const lire = typeof lireVersion === 'function' ? lireVersion : () => null;
    for (const jeton of CAPACITES) {
        if (!Object.prototype.hasOwnProperty.call(table, jeton)) continue;
        const condition = table[jeton];
        if (typeof condition !== 'function') continue;
        let vrai = false;
        try { vrai = condition(cfg, lire) === true; } catch (_) { vrai = false; }
        if (vrai) sortie.push(jeton);
    }
    return sortie;
}

module.exports = { CAPACITES, CONDITIONS, capacitesServies };
