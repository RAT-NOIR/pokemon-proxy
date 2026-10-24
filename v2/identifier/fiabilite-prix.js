'use strict';
// Lot F4-PRIX — ce qui rend un prix du guide « sûr » ou non, et les petits champs fermés qui l'accompagnent. Module PUR : aucune base, aucun réseau.
// Règle du projet : « tout ce qui donne un chiffre au client se compte dans les faux ». Un prix présenté comme sûr qui ne l'est pas est un faux.
//
// 🔑 Écrit par ce qu'il AUTORISE : un prix n'est `fiable` que si AUCUNE réserve ne le touche. Les réserves sont une liste FERMÉE ; une valeur hors liste, une liste illisible, une donnée
// absente ne rendent jamais « fiable » (« je ne peux pas conclure » n'est jamais « tout va bien »). Mais une mesure impossible (moyenne absente) n'invente pas non plus une réserve :
// on ne devine pas un écart qu'on ne peut pas calculer.

// L'écart de la tendance : au-delà de 30 % de la moyenne sur 7 jours OU sur 30 jours, la tendance ne dit pas le marché (cas réel : 7,67 € contre 13,45 € et 14,35 €).
const ECART_TENDANCE_MAX = 0.30;

// Les réserves, dans l'ordre où elles sont rendues. Les deux dernières viennent du catalogue (`prixMelangeTampon`) : Cardmarket n'a qu'UN produit pour la carte, mais une version tamponnée
// existe (Staff, Prerelease, League…) ; les vendeurs le disent dans leurs notes, pas dans la fiche. RÈGLE 2 du testeur (la photo montre le tampon : verdict sur l'idProduct, mention « version
// tamponnée : le prix Cardmarket sous-estime sa valeur ») : CODÉE (voir RÈGLE 2 plus bas) ; sans tampon lu, règle 3.
// `ecart-non-mesurable` (tour 1, I1) : aucune comparaison de la tendance à une moyenne n'a pu avoir lieu (tendance absente, aucune moyenne valide) OU la ligne du produit n'a pas été lue (absente de
// numeros_cartes, lecture en panne) : « je ne peux pas conclure » n'est jamais « fiable ». Texte proposé à l'éditeur : « Écart non vérifiable : prix indicatif. » (à valider par le testeur).
// RÈGLE 2 (F1-TAMPON, codée ; LOT TAMPONS : étendue à la liste fermée des marques) : UNE marque de la liste lue deux fois à l'identique sur la photo d'une fiche marquée (`tamponLu`) =>
// `version-tamponnee-prix-sous-estime` (« version tamponnée : le prix Cardmarket sous-estime sa valeur ») est servie À LA PLACE de la règle 3, jamais en plus. Elle est INERTE tant que le catalogue ne marque
// aucune fiche (prixMelangeTampon) et que la lecture du tampon est éteinte.
// `etat-non-estimable` (lot ETAT-FOURCHETTE, décision de l'éditeur du 2026-10-24) : l'état de la carte n'a pas pu être estimé sur les photos (aucun état retenu) ; le prix servi est une FOURCHETTE, jamais un
// prix sûr. Texte de l'éditeur : « état non estimable sur les photos ». Elle ne dépend PAS du produit mais de la photo : `reservesDe` ne la produit jamais, c'est identifier/fourchette-etat.js qui la pose
// sur le guide d'un repli (prix-repli.js), après les réserves du produit.
const ETAT_NON_ESTIMABLE = 'etat-non-estimable';
const RESERVES = Object.freeze(['ecart-tendance', 'ecart-non-mesurable', 'prix-indicatif-tampons-melanges', 'peut-etre-gonfle-par-tampons', 'version-tamponnee-prix-sous-estime', ETAT_NON_ESTIMABLE]);

// Le « De » du guide (`low`) est l'offre la PLUS BASSE, tous états et toutes langues confondus (une carte Poor suffit). Le guide ne porte aucun prix par état : un prix dans l'état retenu
// n'existe que lu en direct par l'extension (`prixLive`). La seule valeur servie dit donc ce que le « De » est.
const BASE_DE = 'tous-etats';

const nombre = x => (typeof x === 'number' && Number.isFinite(x) && x > 0 ? x : null);

/** |tendance − moyenne| / moyenne, ou null quand l'un des deux n'est pas un prix valide (un zéro n'est pas un prix). */
function ecartTendance(tendance, moyenne) {
    const t = nombre(tendance), m = nombre(moyenne);
    return t === null || m === null ? null : Math.abs(t - m) / m;
}

/** @param {{ tendance?, moyenne7?, moyenne30?, prixMelangeTampon? }} o @returns {readonly string[]} les réserves, dans l'ordre de RESERVES */
function reservesDe(o = {}) {
    const r = [];
    const ecarts = [ecartTendance(o.tendance, o.moyenne7), ecartTendance(o.tendance, o.moyenne30)];
    if (ecarts.some(e => e !== null && e > ECART_TENDANCE_MAX * (1 + 1e-9))) r.push('ecart-tendance');       // « plus de 30 % » : pile 30 % ne déclenche pas
    if (o.nonLu === true || ecarts.every(e => e === null)) r.push('ecart-non-mesurable');                    // fiable = MESURÉ et dans la borne ; sans mesure, ou sur une ligne non lue, jamais
    if (o.prixMelangeTampon === true) r.push('prix-indicatif-tampons-melanges', o.tamponLu === true ? 'version-tamponnee-prix-sous-estime' : 'peut-etre-gonfle-par-tampons');   // === true : « true » (texte), 1, null, absent ne marquent rien
    return Object.freeze(r);
}

/** Fiable = une liste de réserves, connue, VIDE. Tout le reste (hors liste, pas une liste) ne l'est pas. */
const fiable = reserves => Array.isArray(reserves) && reserves.every(x => RESERVES.includes(x)) && reserves.length === 0;

// LE BADGE DU SET : le code d'un set (« SV » pour Supreme Victors) se confond avec le préfixe d'une série (« SV1 », « SV10 » : Scarlet & Violet). Mesuré le 2026-10-18 sur les 783 codes
// distincts de numeros_cartes : 13 sont égaux au préfixe d'une série connue (SV, SM, XY, BW, DP, SWSH, EX, HS, PL, HGSS, NP, SS, BS), 65 sont le préfixe strict d'un autre code. Ces
// 13 se donnent par leur NOM ; les autres restent des codes (un code qui n'est le préfixe d'aucune série ne se confond avec rien). La liste est FERMÉE : elle ne s'élargit que par une mesure.
const CODES_DE_SERIE = Object.freeze(['SV', 'SWSH', 'SM', 'XY', 'BW', 'DP', 'PL', 'HS', 'EX', 'HGSS', 'BS', 'NP', 'SS']);
const texte = x => (typeof x === 'string' && x.trim() ? x.trim() : null);

/** @returns {{ badge: string|null, badgeSource: 'code'|'nom'|null }} */
function badgeDe(set) {
    const s = set && typeof set === 'object' ? set : {};
    const code = texte(s.code), nom = texte(s.nom);
    if (code && !CODES_DE_SERIE.includes(code.toUpperCase())) return { badge: code, badgeSource: 'code' };
    if (nom) return { badge: nom, badgeSource: 'nom' };
    return { badge: null, badgeSource: null };
}

// LA VERSION CARDMARKET (V1, V2…) : Cardmarket numérote ses produits au même set et au même numéro (« Arcanine-G-Lv60-V1-SV15 » et « …-V2-SV15 »). C'est CE qui les sépare chez lui ; elle n'a aucune
// signification stable (ni reverse, ni holo, ni édition : CLAUDE.md §7) et ne se devine pas. Forme fermée V1…V99 (le catalogue va jusqu'à V18) ; tout le reste est null.
const versionDe = x => (typeof x === 'string' && /^V[1-9][0-9]?$/.test(x) ? x : null);

module.exports = { ECART_TENDANCE_MAX, RESERVES, ETAT_NON_ESTIMABLE, BASE_DE, CODES_DE_SERIE, ecartTendance, reservesDe, fiable, badgeDe, versionDe };
