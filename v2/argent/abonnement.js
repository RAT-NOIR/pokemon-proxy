'use strict';
// L'abonnement mensuel : le quota se RECHARGE au premier débit du mois civil UTC (ledger.essayerPoche), sans report. Ici on ne fait que le poser ou le couper.
// Posé à la main par script (v2/admin/poser-abonnement.js) tant que le paiement n'est pas branché.
const db = require('../db');
const col = nom => db.col(nom);
async function activerAbonnement(compteId, { quotaMensuel, jusquAu } = {}) {
    if (!Number.isInteger(quotaMensuel) || quotaMensuel < 1) throw new Error(`activerAbonnement : quotaMensuel invalide (${quotaMensuel})`);
    if (!(jusquAu instanceof Date) || Number.isNaN(jusquAu.getTime())) throw new Error('activerAbonnement : jusquAu doit être une date valide');
    // M9 : le mois ET le restant déjà écrits sont CONSERVÉS (plafonnés au nouveau quota) — relancer l'activation en cours de mois ne redonne pas un quota plein ;
    // une première activation part de moisCle null / restant 0, et le premier débit du mois recharge.
    const r = await col('comptes').updateOne({ _id: compteId }, [{ $set: { abonnement: { actif: true, quotaMensuel, jusquAu,
        moisCle: { $ifNull: ['$abonnement.moisCle', null] }, restant: { $min: [{ $ifNull: ['$abonnement.restant', 0] }, quotaMensuel] } } } }]);
    return { ok: r.matchedCount === 1 };
}
// `restant` est CONSERVÉ mais inutilisable : le débit exige actif:true.
async function desactiverAbonnement(compteId) {
    const r = await col('comptes').updateOne({ _id: compteId }, { $set: { 'abonnement.actif': false } });
    return { ok: r.matchedCount === 1 };
}
module.exports = { activerAbonnement, desactiverAbonnement };
