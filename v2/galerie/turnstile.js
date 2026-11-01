'use strict';
// GALERIE — le jugement d'un jeton Turnstile pour un signalement SANS session. Trois choses de plus que « success » (relecture 1, S-I3) :
//   · les clés FACTICES de Cloudflare (celles de TEST, qui valident tout) sont refusées quand la cible est la production (config.js) ;
//   · le `hostname` de la réponse doit être un hôte du site et l'`action` celle du widget des signalements : un jeton produit pour un AUTRE site ou une AUTRE action ne passe pas ;
//   · un jeton déjà vu est refusé (service.jetonNeuf : l'empreinte seule est gardée, dix minutes).
// Avec une clé factice (essai), Cloudflare répond `hostname: example.com` et aucune action : on ne les exige donc pas — et seulement dans ce cas.
const { lireVerdictTurnstile } = require('../comptes/turnstile');

const FACTICES = Object.freeze(['1x0000000000000000000000000000000AA', '2x0000000000000000000000000000000AA', '3x0000000000000000000000000000000AA']);
const ACTION = 'signalement';
/** Les hôtes admis pour le `hostname` d'un jeton : celui de l'origine du site et son `www.`. */
function hotesDuSiteDe(origineSite) { const h = new URL(origineSite).hostname.toLowerCase(); return [h, h.startsWith('www.') ? h.slice(4) : `www.${h}`]; }

/** → true | false. Lève si le fournisseur est injoignable ou le secret absent (la route répond 503, jamais « ouvert »). */
async function jugerJeton(jeton, ip, { fetch, secret, hotesDuSite, action = ACTION }) {
    const j = await lireVerdictTurnstile(jeton, ip, { fetch, secret });
    if (!j || j.success !== true) return false;
    if (FACTICES.includes(secret)) return true;
    const attendus = { hostname: hotesDuSite, action };
    if (attendus.hostname && !attendus.hostname.includes(String(j.hostname || '').toLowerCase())) return false;
    if (attendus.action && j.action !== attendus.action) return false;
    return true;
}
module.exports = { FACTICES, ACTION, hotesDuSiteDe, jugerJeton };
