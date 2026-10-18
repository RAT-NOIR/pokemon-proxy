'use strict';
// LA SUPPRESSION D'UN COMPTE et Stripe. Appelé par comptes/service.js (supprimerCompte), AVEC OU SANS le drapeau V2_ABONNEMENTS : un abonnement vivant chez Stripe continuerait de facturer sans compte.
//   1. un abonnement vivant (essai, actif, impayé, suspendu), sauf résiliation programmée, REFUSE la suppression (409 CONFLIT « abonnement-actif ») — en base, et chez Stripe pour le client du compte
//      (le webhook peut ne pas être arrivé) : on résilie d'abord par le portail ;
//   2. TOUTES les sessions Checkout OUVERTES du client sont expirées (une page de paiement ouverte donnerait, après la suppression, un abonnement orphelin facturé pour rien) ;
//   3. le client Stripe est ANONYMISÉ — adresse e-mail, nom, téléphone, adresses et lien avec le compte effacés — et NON supprimé : supprimer un client résilie ses abonnements sans prorata et fait
//      perdre les factures et paiements que la comptabilité doit conserver ; l'anonymisation efface les données personnelles et garde les pièces (les adresses figées dans les factures déjà émises
//      restent chez Stripe, durée légale de conservation) ;
//   4. Stripe en panne pendant ce nettoyage : la suppression est REFUSÉE (503, à rejouer) — jamais un compte supprimé avec un client intact. Stripe PAS CONFIGURÉ du tout (aucune clé, aucun faux) :
//      la suppression passe (c'est un droit) et le dit (`client-stripe-non-anonymise`) pour une reprise à la main.
const { col } = require('../db'); const Cl = require('./client'); const Et = require('./etat');
const BLOQUANTS = Object.freeze(['trialing', 'active', 'past_due', 'unpaid', 'paused', 'incomplete']);
const signaler = m => console.error(`🔴 [v2 abonnements] ${m}`);
const nomErreur = e => (e && (e.code || e.type || e.name)) || 'Error';

/** @returns {{ ok: true, finaliser?: Function } | { ok: false, statut: number, code: string, detail: string }} */
async function avant(compte, cfg) {
    const st = compte.abonnement && compte.abonnement.stripe;
    if (Object.values(Et.subsDe(st)).some(e => BLOQUANTS.includes(e.statut) && !e.resiliation)) return { ok: false, statut: 409, code: 'CONFLIT', detail: 'abonnement-actif' };
    const local = async () => { await col('abo_parrainage').deleteMany({ compteId: compte._id }); await require('./fondateurs').liberer(compte._id); };    // le code de parrainage s'en va ; une réservation de place est rendue (une place PRISE reste)
    const client = compte.stripeClient;
    if (!client) return { ok: true, finaliser: local };
    let stripe;
    try { stripe = Cl.obtenir(cfg && cfg.abonnements); }
    catch { signaler(`client-stripe-non-anonymise : Stripe n'est pas configuré, le client ${client.slice(0, 8)}… garde l'adresse e-mail du compte supprimé (reprise à la main)`); return { ok: true, finaliser: local }; }
    try {
        const abos = await stripe.subscriptions.list({ customer: client, status: 'all', limit: 10 });
        if (abos && Array.isArray(abos.data) && abos.data.some(s => BLOQUANTS.includes(s.status) && !s.cancel_at_period_end)) return { ok: false, statut: 409, code: 'CONFLIT', detail: 'abonnement-actif' };
        const ouvertes = await stripe.checkout.sessions.list({ customer: client, status: 'open', limit: 100 });
        for (const o of (ouvertes && ouvertes.data) || []) await stripe.checkout.sessions.expire(o.id);
    } catch (e) { console.error(`❌ [v2 abonnements] suppression : nettoyage Stripe impossible (${nomErreur(e)}) — suppression refusée, à rejouer`); return { ok: false, statut: 503, code: 'INDISPONIBLE', detail: 'paiement-indisponible' }; }
    return { ok: true, finaliser: async () => { await stripe.customers.update(client, { email: '', name: '', phone: '', address: '', shipping: '', description: 'compte supprimé', metadata: { compteId: '' } }); await local(); } };
}
module.exports = { avant, BLOQUANTS };
