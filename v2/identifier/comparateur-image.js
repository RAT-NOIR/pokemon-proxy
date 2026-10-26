'use strict';
// COMPARATEUR-IMAGE (lot SPI-CONTRADICTIONS, derrière V2_SPI_COMPARATEUR, éteint par défaut) — la condition (6) de SUR-PAR-IMAGE (sur-par-image.js) compare ce que la photo a fait LIRE au désigné par l'image, champ par champ
// (garde-contradiction.statuts, la définition de la production). Mesuré avec la vraie lecture : 32 des 47 sûrs de la règle (tous justes) étaient « contredits » à tort. Ce module ne retire AUCUN champ du veto : il rend la comparaison
// JUSTE sur trois formes que la production lit mal, chacune écrite par ce qu'elle AUTORISE (un seul chemin mène à « inconnu », tout le reste rend le statut de la production) :
//   attaque-traduite : l'attaque lue sur une carte NON anglaise (langue lue connue et différente d'EN) est le nom anglais DEVINÉ par le modèle ; le catalogue porte l'anglais de Cardmarket (« Occult Number » face à « Ominous Numbers »).
//                      Le désaccord devient inconnu (ni contradiction ni concordance, §71) SEULEMENT si le numéro est concordant ET (le total OU le code) aussi, et si aucun autre candidat n'est le JUMEAU du désigné
//                      (même nom, même tirage, même numéro) : entre jumeaux l'attaque ne sépare rien, elle garde son veto.
//   promo-prefixe    : « XY85 » est le numéro 85 de XYPR, « SM46 » le 46 de SM, « DP19 » le 19 de DPPR : le code que la carte imprime (XY, ou le set d'origine d'une promo à étoile : BUS, LOT, ROS…) n'est pas le code Cardmarket.
//                      Le ko du code devient inconnu SEULEMENT si le préfixe du numéro lu est la famille du code du catalogue ET les chiffres concordent ET le code lu est ce préfixe ou le set d'origine d'une promo à étoile.
//   symbole-isole    : un symbole e-Reader (e1…e5) lu sur une carte dont le numéro ET le total concordent est une lecture isolée : le ko du symbole devient inconnu.
// Les fonctions de production sont importées (scoring.js, garde-contradiction.js), jamais recopiées (§21 bis). Module PUR : ni base, ni réseau, ne lève jamais.
const S = require('../../scoring');
const { statuts } = require('./garde-contradiction');

const REGLES = Object.freeze(['attaque-traduite', 'promo-prefixe', 'symbole-isole']);
const texte = x => (typeof x === 'string' && x.trim() ? x.trim() : null);

// la langue lue est CONNUE et n'est pas l'anglais : l'attaque est alors une traduction du modèle
const langueNonAnglaise = lu => { const l = texte(lu && lu.langue); return l !== null && l.toUpperCase() !== 'EN'; };

// un autre candidat est le jumeau du désigné : même nom Cardmarket, même tirage, même numéro (une même carte, un autre produit)
const estJumeau = (ligne, a) => Boolean(a && typeof a === 'object' && texte(a.nomCardmarket) && a.nomCardmarket === ligne.nomCardmarket && texte(a.tirageSource) && a.tirageSource === ligne.tirageSource && texte(a.numero) && a.numero === ligne.numero);

// « XY85 » face à « 85 » du set XYPR : le préfixe du numéro lu est la famille du code du catalogue, les chiffres concordent, et le code lu est ce préfixe ou le set d'origine d'une promo à étoile
function codeParPrefixeDePromo(lu, ligne) {
    const n = texte(lu.numero), m = n ? /^([A-Za-z]+)0*(\d+)$/.exec(n) : null;
    if (!m) return false;
    const ln = texte(ligne.numero);
    if (!ln || /[A-Za-z]/.test(ln) || S.comparerNumeros(n, ln) !== 'chiffres') return false;
    const prefixe = S.normaliserCodeSet(m[1]), codeCatalogue = S.normaliserCodeSet(ligne.set && ligne.set.code);
    if (!prefixe || !codeCatalogue || !(codeCatalogue === prefixe || codeCatalogue.startsWith(prefixe))) return false;
    return S.normaliserCodeSet(lu.setCode) === prefixe || String(lu.symboleSet || '').trim().toLowerCase() === 'promo-etoile';
}

/** Les statuts de la production corrigés par les trois règles. @param st les statuts de garde-contradiction.statuts(lu, ligne) @param autres les lignes des AUTRES candidats jugés avec le désigné */
function ajuster(st, lu, ligne, autres) {
    const o = { ...st };
    if (!lu || !ligne) return o;
    const numeroOk = o.numero === 'ok', totalOk = o.total === 'ok';
    if (o.attaque === 'ko' && langueNonAnglaise(lu) && numeroOk && (totalOk || o.code === 'ok') && !(Array.isArray(autres) ? autres : []).some(a => estJumeau(ligne, a))) o.attaque = '?';
    if (o.code === 'ko' && codeParPrefixeDePromo(lu, ligne)) o.code = '?';
    if (o.symbole === 'ko' && numeroOk && totalOk) o.symbole = '?';
    return o;
}

/** Les statuts de la condition (6) de SUR-PAR-IMAGE avec le comparateur juste. Ne lève jamais : sur une entrée qu'il ne sait pas lire, il rend ce que rend la production. */
function statutsPourImage(lu, ligne, autres) {
    const base = statuts(lu, ligne);
    try { return ajuster(base, lu, ligne, autres); } catch { return base; }
}

module.exports = { statutsPourImage, ajuster, REGLES };
