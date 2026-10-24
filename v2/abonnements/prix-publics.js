'use strict';
// Les montants PUBLICS de l'offre Pro (ce que le site affiche) sont ceux des PRIX Stripe, relus et mis en cache (PRIX_PUBLICS_CACHE_MS) : si un prix change chez Stripe, le site le suit sans
// redéploiement. Si la lecture échoue, les constantes d'offres.js servent de repli ET la réponse le DIT (`source: "constantes"`) ; un échec est mis en cache brièvement (ECHEC_CACHE_MS) pour ne
// pas rappeler Stripe à chaque requête pendant une panne.
const O = require('./offres');
const ECHEC_CACHE_MS = 60e3;
let cache = null;
const constantes = () => ({ pro: { mois: O.CATALOGUE.pro.prix.mois, an: O.CATALOGUE.pro.prix.an }, source: 'constantes' });
const vider = () => { cache = null; };
const montant = p => (p && p.currency === O.DEVISE && Number.isInteger(p.unit_amount) && p.unit_amount > 0 && p.recurring ? p.unit_amount : null);
async function lire(stripe, cfgAbo, maintenant = Date.now()) {
    if (cache && maintenant < cache.jusqua) return cache.valeur;
    let valeur = null;
    try {
        if (!stripe || !cfgAbo || !cfgAbo.prix.pro.mois || !cfgAbo.prix.pro.an) throw new Error('prix non configurés');
        const [m, a] = await Promise.all([stripe.prices.retrieve(cfgAbo.prix.pro.mois), stripe.prices.retrieve(cfgAbo.prix.pro.an)]);
        if (montant(m) && montant(a) && m.recurring.interval === 'month' && a.recurring.interval === 'year') valeur = { pro: { mois: montant(m), an: montant(a) }, source: 'stripe' };
    } catch (e) { console.error(`🔴 [v2 abonnements] montants publics : lecture des prix impossible (${(e && (e.code || e.type || e.name)) || 'erreur'}) — constantes en repli`); }
    const echec = valeur === null;
    cache = { valeur: valeur || constantes(), jusqua: maintenant + (echec ? ECHEC_CACHE_MS : O.PRIX_PUBLICS_CACHE_MS) };
    return cache.valeur;
}
module.exports = { lire, vider, constantes, ECHEC_CACHE_MS };
