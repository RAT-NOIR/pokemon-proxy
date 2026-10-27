'use strict';
// EDITION-LOCALE — l'édition locale d'un set OCCIDENTAL (`sets.editionLocale`, McDonald's FR), lue comme le SITE la lit (lib/entreesDuSet.ts::editionLocaleDuSet).
// La liste fermée ne vit pas dans la copie embarquée (entreesDuSet.ts importe la base et le cache : hors de la fermeture) ; elle est donc écrite ICI, et le banc
// test-chargeur-edition-locale.js la compare à celle du site AU COMMIT NOMMÉ (copier-regle-site.js::COMMIT) : un écart fait échouer le banc, jamais une dérive silencieuse.
// Écrite par ce qu'elle AUTORISE : jamais `ja` ni une langue d'Asie, qui ouvriraient les scans d'un autre tirage sur un set occidental.
const LANGUES_DES_EDITIONS_LOCALES = Object.freeze(['fr', 'de', 'it', 'es', 'pt', 'nl']);

/** @returns la langue (minuscules) si elle est dans la liste fermée, sinon null. */
function editionLocaleDuSet(valeur) {
    const e = typeof valeur === 'string' ? valeur.trim().toLowerCase() : '';
    return LANGUES_DES_EDITIONS_LOCALES.includes(e) ? e : null;
}
/** Une valeur brute est-elle PRÉSENTE (une chaîne non vide) mais hors de la liste ? — ce que la projection compte. */
const estHorsListe = valeur => typeof valeur === 'string' && valeur.trim() !== '' && editionLocaleDuSet(valeur) === null;

module.exports = { LANGUES_DES_EDITIONS_LOCALES, editionLocaleDuSet, estHorsListe };
