'use strict';
// LE PAIEMENT — ARRÊTÉ (lot OFFRE-QUOTA, décision du testeur 2026-10-13) : plus aucune vente de scans, plus de recharge. Le grand livre des achats est en LECTURE SEULE : les soldes `achete`
// restent lisibles et intacts, aucune écriture ne les crédite, aucun chemin ne les débite. Aucun module `stripe` n'est chargé par v2/ (un banc le vérifie).
//   · crediterAchat      : REFUSE et le journalise (jamais d'écriture) — le chemin que le futur webhook v2 aurait appelé.
//   · creerSessionPaiement / traiterWebhookStripe : emplacements NOMMÉS, qui lèvent INDISPONIBLE.
//   · creerRecharge      : POST /api/creer-recharge côté v2 => 410 (la vente de scans est arrêtée), aucune session de paiement.
// L'abonnement Pro (Stripe, sur le site) viendra dans un lot APRÈS l'allumage, hors de celui-ci.
const { repondreErreur } = require('../erreurs');

async function crediterAchat({ compteId, reference } = {}) {
    console.error(`🔴 [v2 achat] crédit REFUSÉ (la vente de scans est arrêtée, grand livre des achats en lecture seule) — compte ${compteId}, référence ${typeof reference === 'string' ? `${reference.slice(0, 8)}…` : '?'}`);
    return { ok: false, raison: 'vente-arretee' };
}
function indisponible(quoi) { const e = new Error(`${quoi} : paiement non branché`); e.code = 'INDISPONIBLE'; e.detail = 'paiement-non-branche'; return e; }
async function creerSessionPaiement() { throw indisponible('creerSessionPaiement'); }
async function traiterWebhookStripe() { throw indisponible('traiterWebhookStripe'); }
// Un porteur v2 (posé par resoudrePorteur) reçoit le 410 ; tout autre appelant (l'ancienne extension 1.0.x, par userId) passe à la route HÉRITÉE, qui répond 410 elle aussi (index.js).
function creerRecharge(req, res, next) {
    if (!(req.v2 && req.v2.porteur)) return next();
    return repondreErreur(res, 'INDISPONIBLE', 'La vente de scans est arrêtée', { detail: 'vente-arretee' }, 410);
}
module.exports = { crediterAchat, creerSessionPaiement, traiterWebhookStripe, creerRecharge };
