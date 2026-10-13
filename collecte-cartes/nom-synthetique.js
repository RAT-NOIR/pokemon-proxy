// ============================================================
// LE NOM D'EXPANSION SYNTHÉTIQUE — `reimpressions/<slug>` (lot MULTI, 2026-10-13) : UNE fonction, pour tous
// ============================================================
// Un set de réimpressions n'a pas d'expansion Bulbapedia. Pour que le site rattache les impressions d'origine posées par
// completer-fiches-multi.js à CE set, `sets.bulba.expansion` porte un nom que nos outils inventent et qu'aucune page de carte n'écrit.
// 🔑 Un nom synthétique n'est PAS un nom d'expansion Bulbapedia : (1) la COLLECTE de texte ne réécrit jamais `bulba` d'un tel set
// (collecteur-texte.js), (2) les outils qui joignent par le nom d'expansion déclaré sur les pages de cartes le SAUTENT — comme avant que
// le set ait un nom. Le site, lui, compare par égalité et n'affiche jamais `imp.expansion` : il n'a rien à faire de cette fonction.
const PREFIXE = 'reimpressions/';
const expansionSynthetiqueDe = slug => `${PREFIXE}${slug}`;
/** Vrai si `nom` (une chaîne, ou un tableau dont UN élément l'est) est un nom synthétique. */
function estNomSynthetique(nom) {
    if (Array.isArray(nom)) return nom.some(estNomSynthetique);
    return typeof nom === 'string' && nom.startsWith(PREFIXE);
}
/** Les noms d'expansion BULBAPEDIA d'un document `sets` : les chaînes non vides, SANS les noms synthétiques. */
function nomsBulbapedia(set) {
    return [].concat(set?.bulba?.expansion ?? []).filter(e => typeof e === 'string' && e !== '' && !estNomSynthetique(e));
}
/** La garde de la COLLECTE : un message d'arrêt si le set porte un nom synthétique, sinon null. */
function refusDeCollecte(set, slug) {
    return estNomSynthetique(set?.bulba?.expansion)
        ? `le set « ${slug} » porte le nom d'expansion synthétique ${JSON.stringify(set.bulba.expansion)} (completer-fiches-multi.js) : la collecte réécrirait tout \`bulba\` et effacerait ce nom — arrêt pour ce set, rien n'est écrit`
        : null;
}
module.exports = { PREFIXE, expansionSynthetiqueDe, estNomSynthetique, nomsBulbapedia, refusDeCollecte };
