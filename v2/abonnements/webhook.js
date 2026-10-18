'use strict';
// LE WEBHOOK STRIPE DE LA v2 — sa propre route (/api/webhook-stripe-v2), son propre secret, son propre registre. La route de la v1 (/api/webhook-stripe, les packs de crédits) reste INTACTE.
//   1. le corps arrive BRUT (express.raw, monté avant tout analyseur JSON) : la signature se vérifie sur les octets exacts ; sans signature valide, rien n'est lu, rien n'est écrit (400) ;
//   2. le REGISTRE par identifiant d'événement (abo_evenements, _id = evt_…, jamais purgé) : un événement déjà traité est acquitté sans rien refaire ; un événement en cours de traitement
//      ailleurs est refusé (409, Stripe réessaiera) ; un échec laisse l'événement rejouable (500) ;
//   3. le traitement est IDEMPOTENT par construction (écritures « poser une valeur » comparées à la date de l'événement, primes à clé unique, places à _id unique) ;
//   4. un événement pour un compte INCONNU est enregistré, signalé dans les journaux, et acquitté (200) : le rejouer ne le ferait pas exister. Aucun plantage.
// Les sept événements : checkout.session.completed · checkout.session.expired · customer.subscription.created|updated|deleted · invoice.paid · invoice.payment_failed. Tout autre type : enregistré, ignoré, acquitté.
const express = require('express');
const { col } = require('../db');
const Cl = require('./client'); const Et = require('./etat'); const Pr = require('./primes'); const Fo = require('./fondateurs');
const { idDe, objetId, dateDe } = Et;
const dupliquee = e => Boolean(e) && e.code === 11000;
const SIGNATURE_TOLERANCE_S = 300;
const EN_COURS_MAX_MS = 2 * 60000;                       // au-delà, un traitement « en cours » est considéré mort et repris
const CORPS_MAX = '256kb';
const FINAUX = new Set(['traite', 'ignore']);            // « rejete » (compte inconnu…) n'est PAS final : le renvoyer à la main depuis le tableau de bord, une fois la cause réglée, le retraite
const nomErreur = e => (e && (e.code || e.type || e.name)) || 'Error';   // jamais e.message : un message d'erreur Stripe peut citer un identifiant de client ou un montant
const signaler = (raison, evt, plus = '') => console.error(`🔴 [v2 abonnements] ${raison} — événement ${evt && evt.id ? evt.id : '?'} (${evt && evt.type ? evt.type : '?'})${plus ? ` ${plus}` : ''}`);

/** L'abonnement d'une facture, quelle que soit la forme de la version d'API. */
function sidDeFacture(inv) {
    return idDe(inv && inv.subscription)
        || idDe(inv && inv.parent && inv.parent.subscription_details && inv.parent.subscription_details.subscription)
        || idDe(inv && inv.lines && Array.isArray(inv.lines.data) && inv.lines.data[0] && inv.lines.data[0].parent && inv.lines.data[0].parent.subscription_item_details && inv.lines.data[0].parent.subscription_item_details.subscription) || null;
}
async function marquerFacture(compteId, champ, evtDate) {
    // monotone : une date plus ancienne n'écrase jamais une plus récente (désordre)
    await col('comptes').updateOne({ _id: compteId, $or: [{ [`abonnement.stripe.${champ}`]: null }, { [`abonnement.stripe.${champ}`]: { $lt: evtDate } }] }, { $set: { [`abonnement.stripe.${champ}`]: evtDate } });
}
async function apresApplication(res, ctx) {
    // M1 : un abonnement DÉJÀ connu (événement rejoué après une panne en milieu de traitement) reprend aussi les primes en attente
    if ((res.etat === 'applique' || (res.etat === 'ignore' && res.raison === 'deja-connu')) && res.compte) await Pr.reprendre({ stripe: ctx.stripe, cfgAbo: ctx.cfgAbo, parrainId: res.compte._id, maintenant: ctx.evtDate });
}

const GESTIONNAIRES = {
    async 'checkout.session.completed'(evt, ctx) {
        const s = evt.data.object;
        if (!s || s.mode !== 'subscription') return { etat: 'ignore', raison: 'pas-un-abonnement' };      // les packs de la v1 ne passent pas par ici
        const sid = idDe(s.subscription), compteId = objetId(s.client_reference_id);
        if (!sid) return { etat: 'ignore', raison: 'sans-abonnement' };
        if (!compteId) return { etat: 'rejete', raison: 'reference-compte-illisible', signal: true };
        const sub = await ctx.stripe.subscriptions.retrieve(sid);                       // relu : l'objet de la session ne porte pas l'abonnement
        const res = await Et.appliquer(sub, { cfgAbo: ctx.cfgAbo, version: evt.created, evtDate: ctx.evtDate, siAbsent: true, compteIdIndique: compteId });
        if (s.consent && s.consent.terms_of_service === 'accepted' && res.compte) await col('comptes').updateOne({ _id: res.compte._id, 'abonnement.stripe.cgvAccepteesLe': null }, { $set: { 'abonnement.stripe.cgvAccepteesLe': ctx.evtDate } });
        await apresApplication(res, ctx);
        return { ...res, compteId: res.compte && res.compte._id };
    },
    async abonnement(evt, ctx) {
        const brut = evt.data.object;
        const sub = evt.type === 'customer.subscription.deleted' ? { ...brut, status: 'canceled' } : brut;       // un « deleted » est une fin, quoi que dise le statut recopié
        const res = await Et.appliquer(sub, { cfgAbo: ctx.cfgAbo, version: evt.created, evtDate: ctx.evtDate });
        if (res.etat === 'rejete' && res.raison === 'compte-inconnu') await resilierOrphelin(sub, ctx, evt);
        await apresApplication(res, ctx);
        return { ...res, compteId: res.compte && res.compte._id };
    },
    // I1 : la page de paiement dont la session a expiré rend SA réservation de place — et seulement la sienne
    async 'checkout.session.expired'(evt, ctx) {
        const s = evt.data.object, compteId = Et.objetId(s && s.client_reference_id);
        if (!s || s.mode !== 'subscription' || !compteId || typeof s.id !== 'string') return { etat: 'ignore', raison: 'session-sans-reservation' };
        const r = await Fo.libererSession(compteId, s.id);
        return { etat: 'traite', raison: r.deletedCount ? 'reservation-rendue' : 'rien-a-rendre', compteId };
    },
    async 'invoice.paid'(evt, ctx) {
        const inv = evt.data.object, client = idDe(inv && inv.customer);
        const compte = client ? await col('comptes').findOne({ stripeClient: client }) : null;
        if (!compte) return { etat: 'rejete', raison: 'compte-inconnu', signal: true };
        await marquerFacture(compte._id, 'dernierPaiementLe', ctx.evtDate);
        // I3 : la place Fondateurs se CONFIRME à la première facture PAYÉE (montant > 0) ; pendant l'essai elle n'est que réservée
        if (typeof inv.amount_paid === 'number' && inv.amount_paid > 0) {
            const sid0 = sidDeFacture(inv), entree = sid0 && Et.subsDe(compte.abonnement && compte.abonnement.stripe)[sid0];
            let offre = entree ? entree.offre : null;
            if (!entree && sid0) offre = Et.lireSubscription(await ctx.stripe.subscriptions.retrieve(sid0), ctx.cfgAbo).offre;
            if (offre === 'fondateurs') await Fo.confirmer(compte._id, ctx.cfgAbo.fondateurs.places, ctx.evtDate);
        }
        let parrainId = compte.abonnement && compte.abonnement.stripe ? compte.abonnement.stripe.parrain : null;
        const montant = typeof inv.amount_paid === 'number' ? inv.amount_paid : 0;
        if (montant > 0) {
            const sid = sidDeFacture(inv);
            if (!parrainId && sid) { const sub = await ctx.stripe.subscriptions.retrieve(sid); parrainId = Et.lireSubscription(sub, ctx.cfgAbo).parrain; }
            if (parrainId) {
                const r = await Pr.ouvrir({ stripe: ctx.stripe, cfgAbo: ctx.cfgAbo, filleul: compte, parrainId, factureId: idDe(inv), maintenant: ctx.evtDate });
                if (r.signal) signaler(r.signal, evt);
            }
        }
        await Pr.reprendre({ stripe: ctx.stripe, cfgAbo: ctx.cfgAbo, parrainId: compte._id, maintenant: ctx.evtDate });
        return { etat: 'traite', compteId: compte._id };
    },
    async 'invoice.payment_failed'(evt, ctx) {
        const inv = evt.data.object, client = idDe(inv && inv.customer);
        const compte = client ? await col('comptes').findOne({ stripeClient: client }) : null;
        if (!compte) return { etat: 'rejete', raison: 'compte-inconnu', signal: true };
        // Aucun changement de droit ici : l'état Pro vient de l'ABONNEMENT (customer.subscription.updated → past_due, avec sa grâce). On ne fait que dater l'échec.
        await marquerFacture(compte._id, 'paiementEchoueLe', ctx.evtDate);
        return { etat: 'traite', compteId: compte._id };
    }
};
GESTIONNAIRES['customer.subscription.created'] = GESTIONNAIRES['customer.subscription.updated'] = GESTIONNAIRES['customer.subscription.deleted'] = GESTIONNAIRES.abonnement;
const TYPES = Object.freeze(['checkout.session.completed', 'checkout.session.expired', 'customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted', 'invoice.paid', 'invoice.payment_failed']);

/**
 * I2 : un abonnement VIVANT dont le compte n'existe plus (supprimé pendant que la page de paiement était ouverte) serait facturé pour rien. Il est RÉSILIÉ chez Stripe tout de suite, SANS prorata ni facture
 * finale, et signalé. Jamais de remboursement automatique : toute question de remboursement reste une décision humaine. Seuls les abonnements qui portent un `compteId` bien formé (les nôtres) sont visés.
 * Une panne de Stripe fait échouer l'événement (rejouable) : un orphelin n'est jamais laissé en silence ; « introuvable » veut dire qu'il n'existe déjà plus.
 */
async function resilierOrphelin(sub, ctx, evt) {
    const s = Et.lireSubscription(sub, ctx.cfgAbo);
    if (!s.sid || !Et.VIVANTS.includes(s.statut) || !s.compteMeta) return;
    try { await ctx.stripe.subscriptions.cancel(s.sid, { prorate: false, invoice_now: false }); }
    catch (e) { if (!(e && (e.code === 'resource_missing' || (e.raw && e.raw.code === 'resource_missing')))) throw e; }
    signaler('abonnement-orphelin-resilie (compte supprimé ; aucun remboursement automatique, décision humaine)', evt);
}
/** Prend l'événement dans le registre. { nouveau } | { fait } | { occupe }. */
async function reclamer(evt, maintenant) {
    const ligne = { _id: evt.id, type: evt.type, creeLe: dateDe(evt.created), recuLe: maintenant, etat: 'en-cours', tentatives: 1 };
    try { await col('abo_evenements').insertOne(ligne); return { nouveau: true }; } catch (e) { if (!dupliquee(e)) throw e; }
    const doc = await col('abo_evenements').findOne({ _id: evt.id });
    if (!doc) return { occupe: true };
    if (FINAUX.has(doc.etat)) return { fait: true };
    if (doc.etat === 'en-cours' && doc.recuLe instanceof Date && maintenant.getTime() - doc.recuLe.getTime() < EN_COURS_MAX_MS) return { occupe: true };
    // « erreur » (rejouable) ou « en-cours » périmé : reprise, sous condition (un seul des deux rejeux simultanés gagne)
    const r = await col('abo_evenements').updateOne({ _id: evt.id, etat: doc.etat, recuLe: doc.recuLe }, { $set: { etat: 'en-cours', recuLe: maintenant }, $inc: { tentatives: 1 } });
    return r.matchedCount === 1 ? { nouveau: true } : { occupe: true };
}
async function traiterEvenement(evt, cfgAbo, maintenant = new Date()) {
    const r = await reclamer(evt, maintenant);
    if (r.fait) return { statut: 200, corps: { recu: true, doublon: true } };
    if (r.occupe) return { statut: 409, corps: { recu: false, raison: 'en-cours' } };
    const evtDate = dateDe(evt.created) || maintenant;
    let resultat;
    try {
        if ((cfgAbo.mode === 'live') !== (evt.livemode === true)) resultat = { etat: 'rejete', raison: 'mode-different', signal: true };
        else if (!TYPES.includes(evt.type) || !GESTIONNAIRES[evt.type]) resultat = { etat: 'ignore', raison: 'type-non-gere' };
        else if (!evt.data || !evt.data.object) resultat = { etat: 'rejete', raison: 'objet-absent', signal: true };
        else resultat = await GESTIONNAIRES[evt.type](evt, { stripe: Cl.obtenir(cfgAbo), cfgAbo, evtDate });
    } catch (e) {
        await col('abo_evenements').updateOne({ _id: evt.id }, { $set: { etat: 'erreur', erreur: String(nomErreur(e)).slice(0, 60), majLe: new Date() } });
        console.error(`❌ [v2 abonnements] échec de traitement (${nomErreur(e)}) — événement ${evt.id} (${evt.type}), rejouable`);
        return { statut: 500, corps: { recu: false } };
    }
    const etat = resultat.etat === 'applique' ? 'traite' : resultat.etat === 'rejete' ? 'rejete' : resultat.etat === 'ignore' ? 'ignore' : 'traite';
    if (resultat.signal || resultat.raison === 'compte-inconnu') signaler(`événement mis de côté : ${resultat.raison}`, evt);
    for (const sg of resultat.signaux || []) signaler(`signal : ${sg}`, evt);
    await col('abo_evenements').updateOne({ _id: evt.id }, { $set: { etat, raison: resultat.raison || null, signaux: resultat.signaux || [], compteId: resultat.compteId || null, traiteLe: new Date() } });
    return { statut: 200, corps: { recu: true } };
}

/** Le gestionnaire Express. La requête arrive avec un corps BRUT (Buffer). */
function gestionnaire(getCfg, maintenant = () => new Date()) {
    return async function webhookStripeV2(req, res) {
        res.setHeader('Cache-Control', 'no-store');
        const cfgAbo = getCfg();
        if (!cfgAbo || !cfgAbo.actif || !cfgAbo.pret) return res.status(503).json({ recu: false });
        if (!Buffer.isBuffer(req.body)) { console.error('🔴 [v2 abonnements] webhook : corps non brut (un analyseur JSON est passé avant la route)'); return res.status(400).json({ recu: false }); }
        let evt;
        try {
            const sig = req.headers['stripe-signature'];
            if (typeof sig !== 'string' || !sig) return res.status(400).json({ recu: false });
            evt = Cl.obtenir(cfgAbo).webhooks.constructEvent(req.body, sig, cfgAbo.webhookSecret, SIGNATURE_TOLERANCE_S);
        } catch (e) { console.error(`🔴 [v2 abonnements] signature refusée (${nomErreur(e)})`); return res.status(400).json({ recu: false }); }
        if (!evt || typeof evt.id !== 'string' || typeof evt.type !== 'string') return res.status(400).json({ recu: false });
        try { const r = await traiterEvenement(evt, cfgAbo, maintenant()); return res.status(r.statut).json(r.corps); }
        catch (e) { console.error(`❌ [v2 abonnements] webhook (${nomErreur(e)})`); return res.status(500).json({ recu: false }); }
    };
}
/** La route, avec son analyseur de corps BRUT. À monter AVANT express.json() (argent/monter.js : enTete). */
function monterWebhook(app, getCfg, chemin = '/api/webhook-stripe-v2') {
    app.post(chemin, express.raw({ type: () => true, limit: CORPS_MAX }), gestionnaire(getCfg));
}
module.exports = { monterWebhook, gestionnaire, traiterEvenement, reclamer, TYPES, sidDeFacture, SIGNATURE_TOLERANCE_S };
