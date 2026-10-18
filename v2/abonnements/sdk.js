'use strict';
// LE SEUL FICHIER DE v2/ QUI CHARGE LE SDK STRIPE (le banc test-argent-abonnement.js le sait et ne l'admet nulle part ailleurs). Chargement PARESSEUX : tant que personne ne demande un client,
// le module n'est pas lu — une v2 sans V2_ABONNEMENTS ne charge jamais Stripe. La version d'API est celle que le SDK épingle (apiVersion), jamais une version choisie à la main.
let Stripe = null;
const charger = () => (Stripe || (Stripe = require('stripe')));
/** Un client pour une clé. La clé ne sort jamais de cet appel (ni log, ni message d'erreur). */
function creerClient(cle) {
    if (typeof cle !== 'string' || !/^(sk|rk)_(test|live)_[A-Za-z0-9]+$/.test(cle)) throw new Error('sdk : clé Stripe absente ou de forme inconnue');
    return charger()(cle, { maxNetworkRetries: 2, timeout: 20000, appInfo: { name: 'rat-market-api-v2' } });
}
/** La version d'API épinglée par le SDK (pour créer l'endpoint de webhook sur la MÊME version que celle que le code lit). */
const versionApi = () => charger().API_VERSION || null;
module.exports = { creerClient, versionApi };
