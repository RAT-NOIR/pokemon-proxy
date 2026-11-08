'use strict';
// GALERIE — le jugement d'un jeton Turnstile pour un signalement SANS session. Trois choses de plus que « success » (relecture 1, S-I3) :
//   · les clés FACTICES de Cloudflare (celles de TEST, qui valident tout) sont refusées quand la cible est la production (config.js) ;
//   · le `hostname` de la réponse doit être un hôte du site et l'`action` celle du widget des signalements : un jeton produit pour un AUTRE site ou une AUTRE action ne passe pas ;
//   · un jeton déjà vu est refusé (service.jetonNeuf : l'empreinte seule est gardée, dix minutes).
// Avec une clé factice (essai), Cloudflare répond `hostname: example.com` et aucune action : on ne les exige donc pas — et seulement dans ce cas.
const { lireVerdictTurnstile } = require('../comptes/turnstile');

const FACTICES = Object.freeze(['1x0000000000000000000000000000000AA', '2x0000000000000000000000000000000AA', '3x0000000000000000000000000000000AA']);
const ACTION = 'signalement';
/** Les hôtes admis pour le `hostname` d'un jeton : la liste fermée de L1 (comptes/origines-site.js : `rat-market.fr` et `www.rat-market.fr`), la MÊME que pour les comptes. Le paramètre est gardé pour les appelants existants et n'élargit rien. */
function hotesDuSiteDe() { return [...require('../comptes/origines-site').HOTES]; }

/** → true | false. Lève si le fournisseur est injoignable ou le secret absent (la route répond 503, jamais « ouvert »). */
async function jugerJeton(jeton, ip, { fetch, secret, hotesDuSite, action }) {
    const j = await lireVerdictTurnstile(jeton, ip, { fetch, secret });
    if (!j || j.success !== true) return false;
    if (FACTICES.includes(secret)) return true;     // admis seulement sur l'essai : galerie/config.js refuse de monter le lot avec une clé factice ailleurs
    // TOUR 1 (m2) : écrit par ce qu'il AUTORISE — une action attendue NON VIDE et une liste d'hôtes NON VIDE sont exigées (sinon refus), l'hôte se compare à l'octet (aucune mise en minuscules), l'action exactement.
    if (typeof action !== 'string' || action === '' || !Array.isArray(hotesDuSite) || hotesDuSite.length === 0) return false;
    return typeof j.hostname === 'string' && hotesDuSite.includes(j.hostname) && j.action === action;
}
module.exports = { FACTICES, ACTION, hotesDuSiteDe, jugerJeton };
