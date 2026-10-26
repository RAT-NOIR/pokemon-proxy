'use strict';
// COMPARATEUR-IMAGE (lot SPI-CONTRADICTIONS, derrière V2_SPI_COMPARATEUR, éteint par défaut) — la condition (6) de SUR-PAR-IMAGE (sur-par-image.js) compare ce que la photo a fait LIRE au désigné par l'image, champ par champ
// (garde-contradiction.statuts, la définition de la production). Mesuré avec la vraie lecture : 32 des 47 sûrs de la règle (tous justes) étaient « contredits » à tort. Ce module ne retire AUCUN champ du veto : il rend la comparaison
// JUSTE sur deux formes que la production lit mal, chacune écrite par ce qu'elle AUTORISE (un seul chemin mène à « inconnu », tout le reste rend le statut de la production) :
//   attaque-traduite : l'attaque lue sur une carte dont la langue lue est dans la liste FERMÉE de la production (garde-contradiction.langueCompatible) et n'est pas l'anglais est le nom anglais DEVINÉ par le modèle ; le catalogue porte
//                      l'anglais de Cardmarket (« Occult Number » face à « Ominous Numbers »). Le désaccord devient inconnu (ni contradiction ni concordance, §71) SEULEMENT si le numéro ET le total ET le CODE concordent (numéro + total sans
//                      code collisionnent entre sets : sv5K 012/071 / sv5M 012/071), si AUCUN autre candidat n'a une attaque qui concorde (la lecture le désignerait, positivement) et si la détection du jumeau est DÉCIDABLE et négative :
//                      tout autre candidat est une ligne complète (nom, tirage, numéro) et aucun n'est le jumeau du désigné (même nom, même tirage, même numéro par `comparerNumeros`). Un doute = le veto reste.
//   promo-prefixe    : « XY85 » est le numéro 85 de XYPR, « SM46 » le 46 de SM, « DP19 » le 19 de DPPR : le code que la carte imprime (XY, ou le set d'origine d'une promo à étoile : BUS, LOT, ROS…) n'est pas le code Cardmarket.
//                      Le ko du code devient inconnu SEULEMENT si le préfixe du numéro lu est une famille de la liste FERMÉE FAMILLES_PROMO ET le code catalogue en est EXACTEMENT un code ET les chiffres concordent ET le code lu est ce préfixe
//                      ou le set d'origine d'une promo à étoile. (Le symbole garde son veto : numéro + total seuls ne le lèvent pas — Expedition e1 4/165 n'est pas le 151 n°4/165.)
// Les fonctions de production sont importées (scoring.js, garde-contradiction.js), jamais recopiées (§21 bis). Module PUR : ni base, ni réseau, ne lève jamais.
const S = require('../../scoring');
const { statuts, langueCompatible } = require('./garde-contradiction');

const REGLES = Object.freeze(['attaque-traduite', 'promo-prefixe']);
// Les familles de promo dont le numéro imprimé porte le préfixe, et leur(s) code(s) Cardmarket : égalité EXACTE (« SM1 » n'est pas « SM »)
const FAMILLES_PROMO = Object.freeze({ XY: ['XYPR'], SM: ['SM'], DP: ['DPPR'] });
const texte = x => (typeof x === 'string' && x.trim() ? x.trim() : null);

// la langue lue est dans la liste fermée de la production (langueCompatible : occidentales, JP, ZH, KR) et n'est pas l'anglais : l'attaque est alors une traduction du modèle
function langueNonAnglaise(lu) {
    const l = texte(lu && lu.langue);
    return l !== null && l.toUpperCase() !== 'EN' && langueCompatible(l, 'intl') !== null;
}

// une ligne complète : tout ce que la détection du jumeau compare
const complete = a => Boolean(a && typeof a === 'object' && texte(a.nomCardmarket) && texte(a.tirageSource) && texte(a.numero));
const estJumeau = (ligne, a) => a.nomCardmarket === ligne.nomCardmarket && a.tirageSource === ligne.tirageSource && S.comparerNumeros(a.numero, ligne.numero) !== null;

// « XY85 » face à « 85 » du set XYPR : le préfixe du numéro lu est une famille fermée, le code catalogue en est un code exact, les chiffres concordent, et le code lu est ce préfixe ou le set d'origine d'une promo à étoile
function codeParPrefixeDePromo(lu, ligne) {
    const n = texte(lu.numero), m = n ? /^([A-Za-z]+)0*(\d+)$/.exec(n) : null;
    if (!m) return false;
    const ln = texte(ligne.numero);
    if (!ln || /[A-Za-z]/.test(ln) || S.comparerNumeros(n, ln) !== 'chiffres') return false;
    const prefixe = S.normaliserCodeSet(m[1]), codeCatalogue = S.normaliserCodeSet(ligne.set && ligne.set.code);
    if (!prefixe || !codeCatalogue || !Object.prototype.hasOwnProperty.call(FAMILLES_PROMO, prefixe) || !FAMILLES_PROMO[prefixe].includes(codeCatalogue)) return false;
    return S.normaliserCodeSet(lu.setCode) === prefixe || String(lu.symboleSet || '').trim().toLowerCase() === 'promo-etoile';
}

// L'attaque traduite peut-elle être levée ? Tout ce qui n'est pas prouvé rend false.
function attaqueLevable(st, lu, ligne, autres) {
    if (st.attaque !== 'ko' || !langueNonAnglaise(lu) || st.numero !== 'ok' || st.code !== 'ok') return false;
    if (!complete(ligne) || !Array.isArray(autres)) return false;
    for (const a of autres) {
        if (!complete(a)) return false;                                  // un candidat sans ligne ou incomplet : jumeau indécidable
        if (estJumeau(ligne, a)) return false;                           // entre jumeaux l'attaque ne sépare rien : elle garde son veto
        if (statuts(lu, a).attaque === 'ok') return false;               // la lecture désigne positivement un rival
    }
    return true;
}

/** Les statuts de la production corrigés par les deux règles. @param st les statuts de garde-contradiction.statuts(lu, ligne) @param autres les lignes des AUTRES candidats jugés avec le désigné */
function ajuster(st, lu, ligne, autres) {
    const o = { ...st };
    if (!lu || !ligne) return o;
    if (attaqueLevable(o, lu, ligne, autres)) o.attaque = '?';
    if (o.code === 'ko' && codeParPrefixeDePromo(lu, ligne)) o.code = '?';
    return o;
}

/** Les statuts de la condition (6) de SUR-PAR-IMAGE avec le comparateur juste. Ne lève jamais : sur une entrée qu'il ne sait pas lire, il rend ce que rend la production. */
function statutsPourImage(lu, ligne, autres) {
    const base = statuts(lu, ligne);
    try { return ajuster(base, lu, ligne, autres); } catch { return base; }
}

module.exports = { statutsPourImage, ajuster, REGLES, FAMILLES_PROMO };
