'use strict';
// Faux module d'argent FIDÈLE à la signature RÉELLE de `fusionnerALaLiaison` (v2/argent/fusion.js : `{ compteId, installationId, maintenant?, session? }`, rend `{ ok, … }` et ne lève pas
// pour une installation inconnue). O3 tour 2 (I-B) : les anciens faux acceptaient n'importe quelle forme (`{ installation, compteId }`) et ont caché pendant des jours que la vraie
// fusion n'était jamais appelée avec le bon paramètre. Celui-ci exige la forme réelle : une clé inconnue, un `installationId` absent => `{ ok:false }`, comme le vrai.
const CLES = new Set(['compteId', 'installationId', 'maintenant', 'session']);
function fusionFidele(journal, { apres = null } = {}) {
    return async function fusionnerALaLiaison(o) {
        if (!o || typeof o !== 'object' || Object.keys(o).some(k => !CLES.has(k)) || !o.compteId || !o.installationId) return { ok: false, raison: 'installation-inconnue' };
        journal.push(o);
        if (apres) await apres(o);
        return { ok: true, transfere: { achete: 0, essais: 0 } };
    };
}
module.exports = { fusionFidele };
