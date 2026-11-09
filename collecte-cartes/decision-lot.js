'use strict';
// LA DÉCISION D'ARRÊT D'UN LOT, isolée de lot-additif.js pour se tester avec des doubles en mémoire (aucune base, aucune grappe).
// Ce qui arrête un lot : une baisse non annoncée (garde-lot), un refus du contrat de l'API, un refus de l'ambiguïté du site. Chaque cause garde SON nom : un message « contrat API » sur un arrêt d'ambiguïté fait chercher au mauvais endroit.
// Quand le lot est fautif : restauration, puis relecture ; le code de sortie est 3 (restauré, relu propre) ou 4 (restauration incomplète). Une restauration qui lève remonte : le lot sort en erreur, jamais en « ✅ ».

const fautif = ({ nonAutorisees = [], contrat = [], ambiguite = [] } = {}) => nonAutorisees.length + contrat.length + ambiguite.length > 0;

/** Les phrases de l'arrêt (affichage) et la cause courte (journal), une par cause présente. */
function causesDArret({ nonAutorisees = [], contrat = [], ambiguite = [] } = {}) {
    const phrases = [], court = [];
    if (nonAutorisees.length) { phrases.push(`${nonAutorisees.length} baisse(s) NON ANNONCÉE(S)`); court.push('baisses non annoncées'); }
    if (contrat.length) { phrases.push(`${contrat.length} refus du CONTRAT DE L'API`); court.push('refus du contrat API'); }
    if (ambiguite.length) { phrases.push(`${ambiguite.length} refus de l'AMBIGUÏTÉ DU SITE`); court.push('refus de l\'ambiguïté du site'); }
    return { phrases, court: court.join(' + ') };
}

/** Non fautif : rien n'est appelé. Fautif : `restaurer()` puis `relire()` (rend { ok }) ; code 3 si ok, 4 sinon. */
async function arretDuLot({ nonAutorisees, contrat, ambiguite, restaurer, relire }) {
    if (!fautif({ nonAutorisees, contrat, ambiguite })) return { arret: false, restaure: false, relu: null, code: null };
    await restaurer();
    const relu = await relire();
    return { arret: true, restaure: true, relu, code: relu && relu.ok ? 3 : 4 };
}

module.exports = { fautif, causesDArret, arretDuLot };
