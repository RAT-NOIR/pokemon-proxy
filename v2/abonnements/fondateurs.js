'use strict';
// LES PLACES FONDATEURS — comptées de façon ATOMIQUE en base, sans compteur qui dérive.
// Le principe : une place est un DOCUMENT dont l'_id est « place:k » (k de 0 à max-1). Réserver, c'est INSÉRER un _id : la base garantit qu'un seul des deux acheteurs simultanés gagne
// (clé dupliquée pour l'autre). Il n'y a donc ni compteur à incrémenter ni course entre « lire le reste » et « prendre ». Un index unique sur compteId limite chaque compte à UNE place.
//   · « reservee » : prise à la création de la session Checkout, jusqu'à `expireLe` (durée de la session + 5 minutes). Passé ce délai, un autre acheteur peut la reprendre (mise à jour
//     conditionnée à l'expiration, donc atomique aussi).
//   · « prise »    : confirmée quand l'abonnement Fondateurs existe vraiment (webhook). Définitive : elle ne retourne jamais au pool, même si l'abonné résilie (il garde son prix s'il revient).
// Si le nombre de places est AUGMENTÉ plus tard, les nouvelles places (k plus grands) apparaissent d'elles-mêmes ; s'il est DIMINUÉ, rien n'est retiré à personne (seules les nouvelles réservations
// sont refusées, par le contrôle du nombre de places occupées).
const { col } = require('../db');
const { SESSION_MINUTES, MARGE_RESERVATION_MINUTES } = require('./offres');
const COL = 'abo_places';
const dupliquee = e => Boolean(e) && e.code === 11000;
const expiration = maintenant => new Date(maintenant.getTime() + (SESSION_MINUTES + MARGE_RESERVATION_MINUTES) * 60000);

/** Combien de places sont occupées à `maintenant` (prises + réservations vivantes). */
async function occupees(maintenant = new Date()) {
    return col(COL).countDocuments({ $or: [{ etat: 'prise' }, { etat: 'reservee', expireLe: { $gt: maintenant } }] });
}
/** @returns {{ok: true, deja?: 'prise'|'reservee', place: string} | {ok: false, raison: 'epuisees'}} */
async function reserver(compteId, max, maintenant = new Date()) {
    const proprio = await col(COL).findOne({ compteId });
    if (proprio) {
        if (proprio.etat === 'prise') return { ok: true, deja: 'prise', place: proprio._id };
        // une réservation vivante est PROLONGÉE ; une réservation expirée (que personne n'a reprise) est reprise par son propriétaire, sous la même condition d'atomicité
        const r = await col(COL).updateOne({ _id: proprio._id, compteId, etat: 'reservee' }, { $set: { expireLe: expiration(maintenant) } });
        if (r.matchedCount === 1) return { ok: true, deja: 'reservee', place: proprio._id };
        const apres = await col(COL).findOne({ compteId });
        if (apres && apres.etat === 'prise') return { ok: true, deja: 'prise', place: apres._id };
        return reserver(compteId, max, maintenant);       // la place a bougé entre deux lectures : on recommence (borné par la récursion naturelle des cas rares)
    }
    if ((await occupees(maintenant)) >= max) return { ok: false, raison: 'epuisees' };
    for (let k = 0; k < max; k++) {
        const _id = `place:${k}`;
        try { await col(COL).insertOne({ _id, compteId, etat: 'reservee', expireLe: expiration(maintenant), creeLe: maintenant }); return { ok: true, place: _id }; }
        catch (e) {
            if (!dupliquee(e)) throw e;
            // la clé en double peut être celle de l'index sur compteId (ce compte a gagné une place entre-temps) : il la possède déjà
            const moi = await col(COL).findOne({ compteId });
            if (moi) return { ok: true, deja: moi.etat, place: moi._id };
            // sinon la place k est occupée : si sa réservation est EXPIRÉE, la reprendre (atomique : la condition porte sur l'expiration)
            const r = await col(COL).updateOne({ _id, etat: 'reservee', expireLe: { $lte: maintenant } }, { $set: { compteId, expireLe: expiration(maintenant), creeLe: maintenant } }).catch(x => { if (dupliquee(x)) return { modifiedCount: 0 }; throw x; });
            if (r.modifiedCount === 1) return { ok: true, place: _id };
        }
    }
    const final = await col(COL).findOne({ compteId });          // une reprise concurrente a pu nous la donner pendant la boucle
    if (final) return { ok: true, deja: final.etat, place: final._id };
    return { ok: false, raison: 'epuisees' };
}
/** Le webhook confirme : l'abonnement Fondateurs existe. Idempotent. Si la réservation a expiré et qu'une autre personne a repris la place, le client PAYANT est servi quand même
 *  (le plus prudent pour lui) : on cherche une place libre ; s'il n'y en a plus, on enregistre un DÉPASSEMENT visible (jamais refuser un client qui a payé). */
async function confirmer(compteId, max, maintenant = new Date()) {
    const r = await col(COL).updateOne({ compteId, etat: 'reservee' }, { $set: { etat: 'prise', priseLe: maintenant }, $unset: { expireLe: '' } });
    if (r.modifiedCount === 1) return { ok: true };
    const existante = await col(COL).findOne({ compteId });
    if (existante && existante.etat === 'prise') return { ok: true, deja: true };
    const n = await reserver(compteId, max, maintenant);
    if (n.ok) { await col(COL).updateOne({ compteId, etat: 'reservee' }, { $set: { etat: 'prise', priseLe: maintenant }, $unset: { expireLe: '' } }); return { ok: true, repris: true }; }
    // plus de place : dépassement ASSUMÉ et tracé (place hors plage), le client est honoré
    try { await col(COL).insertOne({ _id: `depassement:${String(compteId)}`, compteId, etat: 'prise', depassement: true, priseLe: maintenant }); } catch (e) { if (!dupliquee(e)) throw e; }
    return { ok: true, depassement: true };
}
/** Libère une RÉSERVATION (jamais une place prise) : session abandonnée. */
async function liberer(compteId) { return col(COL).deleteOne({ compteId, etat: 'reservee' }); }
module.exports = { reserver, confirmer, liberer, occupees, COL };
