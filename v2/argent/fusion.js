'use strict';
// FUSION À LA LIAISON (PLAN-COMPTES §4.4) : les crédits ACHETÉS portés par l'installation passent au compte (additionnés), l'essai tombe à 0, et l'accueil
// éventuellement hérité n'est JAMAIS ajouté aux 25 du compte (une seule dotation). Une transaction ; l'installation est lue ET mise à zéro par UNE écriture
// (findOneAndUpdate « avant ») : deux liaisons simultanées ne peuvent pas lire toutes deux le même solde, la seconde voit zéro. Rejouée : rien ne bouge.
// Cette fonction ne pose PAS `installations.compteId` : la liaison (B2) le fait, dans sa propre transaction, en lui passant sa `session`.
const db = require('../db'); const { ObjectId } = require('mongoose').Types; const { dansUneTransaction } = require('./transaction');
const col = nom => db.col(nom);
const mouv = (base, type, delta, poche, motif, cle, cfg, le, surface) => ({ ...base, le, surface, type, delta, poche, motif, scanId: null, etat: 'debite', cleIdempotence: cle,
    expireLe: new Date(le.getTime() + cfg.retention.mouvementsMois * 30.5 * 86400e3) });

async function fusionnerALaLiaison({ compteId, installationId, maintenant = new Date(), session = null }, cfg) {
    return dansUneTransaction(async s => {
        const compte = await col('comptes').findOne({ _id: compteId }, { session: s, projection: { _id: 1 } });
        if (!compte) return { ok: false, raison: 'compte-inconnu' };
        const avant = await col('installations').findOneAndUpdate({ _id: installationId }, [{ $set: { achete: 0, essais: 0 } }], { session: s, returnDocument: 'before' });
        if (!avant) return { ok: false, raison: 'installation-inconnue' };
        const achete = Math.max(0, avant.achete ?? 0), essais = Math.max(0, avant.essais ?? 0), nonce = new ObjectId().toString();
        if (achete > 0) {
            await col('comptes').updateOne({ _id: compteId }, { $inc: { 'solde.achete': achete } }, { session: s });
            await col('mouvements').insertMany([
                mouv({ installationId }, 'migration', -achete, 'achete', 'fusion-liaison', `fusion|${installationId}|sortie|${nonce}`, cfg, maintenant, 'extension'),
                mouv({ compteId }, 'migration', achete, 'achete', 'fusion-liaison', `fusion|${installationId}|entree|${nonce}`, cfg, maintenant, 'extension')], { session: s });
        }
        if (essais > 0) await col('mouvements').insertOne(mouv({ installationId }, 'migration', -essais, 'essai', 'fusion-liaison', `fusion|${installationId}|essais|${nonce}`, cfg, maintenant, 'extension'), { session: s });
        return { ok: true, transfere: { achete, essais } };
    }, session);
}
module.exports = { fusionnerALaLiaison };
