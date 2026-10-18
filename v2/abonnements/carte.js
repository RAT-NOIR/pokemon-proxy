'use strict';
// UNE CARTE EST-ELLE ENREGISTRÉE PENDANT L'ESSAI ? — `true`, `false`, ou `null` quand on ne sait pas : JAMAIS une affirmation fausse.
// LE CHOIX (dit au contrat, avec son coût) : une LECTURE Stripe bornée, en cache, faite par le statut public pendant un essai seulement — et non un événement de plus au webhook.
//   · un événement de plus (`customer.updated`, `payment_method.attached`…) changerait la liste des sept événements : provisionnement de l'endpoint à refaire en Test PUIS en Live, pour un
//     champ d'affichage ; et un événement qui arrive dans le désordre ou ne vient pas (portail qui pose la carte de façon différente) ferait AFFIRMER « sans carte » à tort ;
//   · la lecture dit l'état ACTUEL chez Stripe : un seul appel, `subscriptions.retrieve(sid, { expand: ['customer'] })` — la carte qui sera prélevée à la fin de l'essai est celle que Stripe
//     utilise lui-même : le moyen de paiement par défaut de l'ABONNEMENT, à défaut celui du CLIENT (`invoice_settings.default_payment_method`), à défaut une source par défaut.
//     Aucune permission de plus pour la clé restreinte (abonnements et clients en lecture, déjà demandés).
// COÛT : au plus UN appel Stripe par compte et par fenêtre de 30 s, et seulement tant qu'un essai est en cours ; deux lectures simultanées d'un même compte partagent le même appel ; la table est
// bornée (MAX) ; une panne de Stripe rend `null` (jamais `false`), mémorisé 10 s pour ne pas marteler un Stripe en panne.
const TTL_MS = 30e3, TTL_ECHEC_MS = 10e3, MAX = 2000;
const memoire = new Map();                         // sid → { valeur, jusqua } | { promesse }
const vider = () => memoire.clear();
const present = v => (v && typeof v === 'object' ? typeof v.id === 'string' && v.id.length > 0 : typeof v === 'string' && v.length > 0);

/** Pure : la carte qui sera prélevée existe-t-elle ? Une forme qu'on ne sait pas lire rend null (on ne sait pas). */
function carteDe(sub) {
    if (!sub || typeof sub !== 'object') return null;
    const c = sub.customer;
    if (!c || typeof c !== 'object') return null;                                  // le client n'a pas été déplié : on ne SAIT pas
    if ('default_payment_method' in sub && present(sub.default_payment_method)) return true;
    if ('default_source' in sub && present(sub.default_source)) return true;
    if (c.deleted === true) return null;
    const regles = c.invoice_settings;
    if (!regles || typeof regles !== 'object' || !('default_payment_method' in regles)) return null;
    if (present(regles.default_payment_method) || present(c.default_source)) return true;
    // ni l'abonnement ni le client ne portent de moyen par défaut ; les deux champs sont lisibles : il n'y a pas de carte à prélever
    if (!('default_payment_method' in sub)) return null;
    return false;
}
/** @returns true | false | null */
async function enregistree(stripe, sid, maintenant = Date.now()) {
    if (!stripe || typeof sid !== 'string' || !sid) return null;
    const m = memoire.get(sid);
    if (m && m.promesse) return m.promesse;
    if (m && maintenant < m.jusqua) return m.valeur;
    const promesse = (async () => {
        let valeur = null;
        try { valeur = carteDe(await stripe.subscriptions.retrieve(sid, { expand: ['customer'] })); }
        catch (e) { console.error(`🔴 [v2 abonnements] carte pendant l'essai : lecture impossible (${(e && (e.code || e.type || e.name)) || 'erreur'}) — inconnue`); }
        if (memoire.size >= MAX) memoire.clear();
        memoire.set(sid, { valeur, jusqua: Date.now() + (valeur === null ? TTL_ECHEC_MS : TTL_MS) });
        return valeur;
    })();
    memoire.set(sid, { promesse });
    return promesse;
}
module.exports = { enregistree, carteDe, vider, TTL_MS, TTL_ECHEC_MS };
