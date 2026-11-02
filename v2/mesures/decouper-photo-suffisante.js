'use strict';
// Découpage des verdicts du juge selon « la photo suffit-elle à un expert pour trancher l'impression exacte ? » (champ `verite.photoSuffisante` des lignes de l'export du juge, exporter-seau.js).
// Fonctions PURES (aucun fichier, aucune base). À brancher dans l'outil de mesure qui lit lignes.json du juge : lui passer `lignes`, et sa fonction « cette unité est-elle juste ? » à `chiffrer`.
// Une unité = une carte d'un scan (verdict à `cartes[]` pour un scan multi-cartes, sinon le verdict seul). Les lignes sans verdict ne comptent pas.

const unitesDe = lignes => (Array.isArray(lignes) ? lignes : []).flatMap(l => {
    const v = l && l.verite;
    if (!v || typeof v !== 'object') return [];
    if (Array.isArray(v.cartes)) return v.cartes.map(c => ({ ligne: l, verite: c }));
    return [{ ligne: l, verite: v }];
});

/** { toutes, oui, non, sansReponse } : « oui » = exactement `true` ; « non » = exactement `false` ; tout le reste (absent, null, texte, nombre) = sans réponse. */
function decouper(lignes) {
    const toutes = unitesDe(lignes);
    return {
        toutes,
        oui: toutes.filter(u => u.verite.photoSuffisante === true),
        non: toutes.filter(u => u.verite.photoSuffisante === false),
        sansReponse: toutes.filter(u => typeof u.verite.photoSuffisante !== 'boolean')
    };
}

/** Les deux chiffres demandés, dénominateur imprimé : { toutes: { n, justes }, oui: { n, justes } }. `estJuste(unite)` est la règle de la mesure (la réponse directe est-elle la vérité ?). */
function chiffrer(lignes, estJuste) {
    const d = decouper(lignes), compte = us => ({ n: us.length, justes: us.filter(u => estJuste(u) === true).length });
    return { toutes: compte(d.toutes), oui: compte(d.oui) };
}

module.exports = { decouper, chiffrer };
