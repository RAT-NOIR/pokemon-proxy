'use strict';
// LE PAIEMENT — EMPLACEMENTS SEULEMENT. Aucun module `stripe` n'est chargé par v2/ (un banc le vérifie) : le branchement est une décision du testeur.
//   · crediterAchat      : ce que le webhook appellera — idempotent par RÉFÉRENCE (un webhook rejoué ne crédite qu'une fois).
//   · creerSessionPaiement / traiterWebhookStripe : emplacements NOMMÉS, qui lèvent INDISPONIBLE tant que rien n'est branché.
//   · creerRecharge      : POST /api/creer-recharge côté v2 => 501 INDISPONIBLE (paiement-non-branche).
const db = require('../db'); const { dansUneTransaction } = require('./transaction'); const { repondreErreur } = require('../erreurs');
const col = nom => db.col(nom);
const PACKS = Object.freeze([20, 50, 100, 200]);        // ceux de index.js:6751 — liste FERMÉE (absente de config.js : à y ajouter à l'intégration)

async function crediterAchat({ compteId, scans, reference, maintenant = new Date() } = {}, cfg) {
    if (!PACKS.includes(scans)) throw new Error(`crediterAchat : pack hors liste fermée (${JSON.stringify(scans)})`);
    if (typeof reference !== 'string' || !reference.trim()) throw new Error('crediterAchat : référence obligatoire (la clé d\'idempotence)');
    try {
        return await dansUneTransaction(async s => {
            // le mouvement ET le crédit dans la MÊME transaction : ni crédit sans trace, ni trace sans crédit ; la clé unique tranche le rejeu
            await col('mouvements').insertOne({ compteId, le: maintenant, surface: 'scanner', type: 'achat', delta: scans, poche: 'achete', motif: 'achat', scanId: null, etat: 'debite',
                cleIdempotence: `achat|${reference}`, expireLe: new Date(maintenant.getTime() + cfg.retention.mouvementsMois * 30.5 * 86400e3) }, { session: s });
            const r = await col('comptes').updateOne({ _id: compteId }, { $inc: { 'solde.achete': scans } }, { session: s });
            if (r.matchedCount !== 1) { const e = new Error('compte-inconnu'); e.compteInconnu = true; throw e; }
            return { ok: true, rejoue: false, credite: scans };
        });
    } catch (e) {
        if (e && e.code === 11000) return { ok: true, rejoue: true, credite: 0 };
        if (e && e.compteInconnu) return { ok: false, raison: 'compte-inconnu' };
        throw e;
    }
}
function indisponible(quoi) { const e = new Error(`${quoi} : paiement non branché`); e.code = 'INDISPONIBLE'; e.detail = 'paiement-non-branche'; return e; }
async function creerSessionPaiement() { throw indisponible('creerSessionPaiement'); }
async function traiterWebhookStripe() { throw indisponible('traiterWebhookStripe'); }
// Un porteur v2 (posé par resoudrePorteur) reçoit le 501 ; tout autre appelant (l'ancienne extension 1.0.x, par userId) passe à la route HÉRITÉE, inchangée.
function creerRecharge(req, res, next) {
    if (!(req.v2 && req.v2.porteur)) return next();
    return repondreErreur(res, 'INDISPONIBLE', 'Le paiement n\'est pas encore disponible', { detail: 'paiement-non-branche' }, 501);
}
module.exports = { crediterAchat, creerSessionPaiement, traiterWebhookStripe, creerRecharge, PACKS };
