'use strict';
// L'`offre` d'une réponse (OFFRE-QUOTA) : UNE lecture pour toutes les routes (identifier, reponse, retour-live, solde, scanner, lier, délier). Elle passe par le registre « argent » (offre.js,
// une seule fonction), relit tout en base, et n'invente rien : si la lecture échoue, l'objet est ABSENT de la réponse (et l'échec est journalisé), jamais un `restant` supposé.
const registre = require('../registre');
async function offreSur(porteur, argent = null) {
    try { return await (argent || registre.obtenir('argent')).offre(porteur); }
    catch (e) { console.error(`❌ [v2 offre] ${(e && (e.code || e.name)) || 'erreur'}`); return undefined; }
}
/** Le fragment à étaler dans un corps : `{ offre }` ou rien. */
const avecOffre = o => (o !== undefined ? { offre: o } : {});
/** Un refus QUOTA joint l'offre avec `restant: 0` (Pro garde `null` : son plafond technique ne se montre jamais). */
const offreRefusee = o => (o && o.nom !== 'pro' ? { ...o, restant: 0 } : o);
module.exports = { offreSur, avecOffre, offreRefusee };
