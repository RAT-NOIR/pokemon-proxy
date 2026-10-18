'use strict';
// LA PRIME DU PARRAIN : un mois offert (coupon 100 %, `duration: once`) posé sur SON abonnement quand la première facture PAYÉE (montant > 0) de son filleul arrive.
// Une ligne par filleul dans `abo_primes` (_id = compte du filleul) : le crédit ne se donne qu'une fois, quoi qu'il arrive (webhook rejoué, deux factures, reprise après panne).
// États : a-appliquer → applique | en-attente-parrain (le parrain n'a pas d'abonnement vivant) | en-attente-remise (le parrain a déjà une remise non consommée : on n'en empile pas une
// qui se perdrait sur la même facture) | refusee (garde-fou) | parrain-disparu. Les états « en attente » sont REPRIS à chaque événement du parrain (reprendre()).
const { col } = require('../db');
const Pa = require('./parrainage');
const dupliquee = e => Boolean(e) && e.code === 11000;
const couponDe = d => (d && (d.coupon && (typeof d.coupon === 'string' ? d.coupon : d.coupon.id))) || (d && d.source && (typeof d.source.coupon === 'string' ? d.source.coupon : d.source.coupon && d.source.coupon.id)) || null;
const VIVANTS = ['trialing', 'active', 'past_due'];
const idCoupon = filleulId => `rm-parrainage-${String(filleulId)}`;

/** Crée la prime d'un filleul si les garde-fous passent. Idempotent : la ligne existe déjà → on la REPREND seulement. */
async function ouvrir({ stripe, filleul, parrainId, factureId, maintenant }) {
    const parrain = parrainId ? await col('comptes').findOne({ _id: parrainId }) : null;
    if (!parrain) return { etat: 'ignore', raison: 'parrain-inconnu' };
    if (!Pa.parrainageAdmis(parrain, filleul)) {
        try { await col('abo_primes').insertOne({ _id: filleul._id, parrainId: parrain._id, etat: 'refusee', raison: 'auto-parrainage', creeLe: maintenant, factureId }); } catch (e) { if (!dupliquee(e)) throw e; }
        return { etat: 'ignore', raison: 'auto-parrainage', signal: 'auto-parrainage' };
    }
    try { await col('abo_primes').insertOne({ _id: filleul._id, parrainId: parrain._id, etat: 'a-appliquer', creeLe: maintenant, factureId }); }
    catch (e) { if (!dupliquee(e)) throw e; }                                           // déjà ouverte : une seule prime par filleul, on ne fait que la reprendre
    return appliquer({ stripe, filleulId: filleul._id, maintenant });
}
async function attente(filleulId, etat) { await col('abo_primes').updateOne({ _id: filleulId, etat: { $in: ['a-appliquer', 'en-attente-parrain', 'en-attente-remise'] } }, { $set: { etat, majLe: new Date() } }); return { etat: 'en-attente', raison: etat }; }
/** Pose le coupon de la prime d'un filleul sur l'abonnement du parrain, si c'est possible MAINTENANT. */
async function appliquer({ stripe, filleulId, maintenant = new Date() }) {
    const prime = await col('abo_primes').findOne({ _id: filleulId });
    if (!prime || !['a-appliquer', 'en-attente-parrain', 'en-attente-remise'].includes(prime.etat)) return { etat: 'ignore', raison: prime ? prime.etat : 'absente' };
    const parrain = await col('comptes').findOne({ _id: prime.parrainId });
    if (!parrain) { await col('abo_primes').updateOne({ _id: filleulId }, { $set: { etat: 'parrain-disparu', majLe: maintenant } }); return { etat: 'ignore', raison: 'parrain-disparu' }; }
    const st = parrain.abonnement && parrain.abonnement.stripe;
    if (!(st && st.sid && VIVANTS.includes(st.statut) && st.jusquAu instanceof Date && st.jusquAu.getTime() > maintenant.getTime())) return attente(filleulId, 'en-attente-parrain');
    const sub = await stripe.subscriptions.retrieve(st.sid, { expand: ['discounts'] });
    if (!sub || !VIVANTS.includes(sub.status)) return attente(filleulId, 'en-attente-parrain');
    const coupon = idCoupon(filleulId), remises = Array.isArray(sub.discounts) ? sub.discounts : [];
    const dejaPosee = remises.some(d => couponDe(d) === coupon);
    if (!dejaPosee) {
        if (remises.length > 0 || sub.discount) return attente(filleulId, 'en-attente-remise');
        try { await stripe.coupons.create({ id: coupon, percent_off: 100, duration: 'once', name: 'Parrainage — 1 mois offert', metadata: { filleul: String(filleulId), parrain: String(parrain._id) } }); }
        catch (e) { if (!(e && (e.code === 'resource_already_exists' || (e.raw && e.raw.code === 'resource_already_exists')))) throw e; }
        await stripe.subscriptions.update(st.sid, { discounts: [{ coupon }] }, { idempotencyKey: `prime-${String(filleulId)}` });
    }
    await col('abo_primes').updateOne({ _id: filleulId, etat: { $ne: 'applique' } }, { $set: { etat: 'applique', appliqueLe: maintenant, coupon, sid: st.sid, majLe: maintenant } });
    return { etat: 'applique' };
}
/** Reprend les primes en attente d'un parrain (appelé quand son abonnement change ou qu'une de ses factures est payée). Au plus UNE par passage : la remise doit être consommée avant la suivante. */
async function reprendre({ stripe, parrainId, maintenant = new Date() }) {
    const prime = await col('abo_primes').find({ parrainId, etat: { $in: ['a-appliquer', 'en-attente-parrain', 'en-attente-remise'] } }).sort({ creeLe: 1 }).limit(1).next();
    if (!prime) return { etat: 'ignore', raison: 'rien-en-attente' };
    return appliquer({ stripe, filleulId: prime._id, maintenant });
}
module.exports = { ouvrir, appliquer, reprendre, idCoupon, couponDe, VIVANTS };
