'use strict';
// Vérification Cloudflare Turnstile. `fetch` et `secret` sont INJECTABLES : les bancs n'émettent aucune requête réelle.
const { HOTES } = require('./origines-site');
const URL_VERIF = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const TIMEOUT_MS = 5000;
async function verifierTurnstile(jeton, ip, { fetch = globalThis.fetch, secret = process.env.TURNSTILE_SECRET } = {}) {
    if (!secret) throw new Error('turnstile-non-configure');           // fail-closed : la route répond 503
    if (typeof jeton !== 'string' || !jeton) return false;
    const corps = new URLSearchParams({ secret, response: jeton });
    if (ip) corps.set('remoteip', ip);
    // B8.1 : ni redirection suivie (le secret est dans le corps : il ne suit pas un 307 vers un autre hôte), ni attente sans fin (une panne de Cloudflare tenait l'inscription ~5 min)
    const r = await fetch(URL_VERIF, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: corps, redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!r || !r.ok) return false;
    const j = await r.json();
    // L1 : un jeton émis pour un autre site n'est pas un jeton du nôtre. Écrit par ce qu'il AUTORISE : `hostname` doit être l'un des deux hôtes du site (liste fermée, à l'octet) ;
    // absent, non texte ou autre => refusé.
    return !!j && j.success === true && typeof j.hostname === 'string' && HOTES.includes(j.hostname);
}
module.exports = { verifierTurnstile };
