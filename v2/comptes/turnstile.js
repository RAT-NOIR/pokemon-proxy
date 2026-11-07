'use strict';
// Vérification Cloudflare Turnstile. `fetch` et `secret` sont INJECTABLES : les bancs n'émettent aucune requête réelle.
const { HOTES } = require('./origines-site');
const URL_VERIF = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const TIMEOUT_MS = 5000;
async function verifierTurnstile(jeton, ip, { fetch = globalThis.fetch, secret = process.env.TURNSTILE_SECRET, action } = {}) {
    if (!secret) throw new Error('turnstile-non-configure');           // fail-closed : la route répond 503
    if (typeof jeton !== 'string' || !jeton) return false;
    const corps = new URLSearchParams({ secret, response: jeton });
    if (ip) corps.set('remoteip', ip);
    // B8.1 : ni redirection suivie (le secret est dans le corps : il ne suit pas un 307 vers un autre hôte), ni attente sans fin (une panne de Cloudflare tenait l'inscription ~5 min)
    const r = await fetch(URL_VERIF, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: corps, redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS) });
    // L1 (F3) : une réponse non 2xx de siteverify (5xx, mais aussi 4xx : notre secret ou notre requête) n'est PAS un refus du défi mais une panne du vérificateur : on LÈVE, la route répond 503
    // (jamais 422 « defi-anti-robot », qui ferait croire à l'utilisateur qu'il a échoué le défi). Une panne réseau lève déjà (fetch).
    if (!r || !r.ok) throw new Error(`turnstile-http-${r ? r.status : 'aucune-reponse'}`);
    const j = await r.json();
    // L1 : un jeton émis pour un autre site n'est pas un jeton du nôtre. Écrit par ce qu'il AUTORISE : `hostname` doit être l'un des deux hôtes du site (liste fermée, à l'octet) ;
    // absent, non texte ou autre => refusé. `action` (quand la route en demande une) : celle que le widget a posée pour CE formulaire, exactement (inscription, connexion, oubli, renvoi).
    return !!j && j.success === true && typeof j.hostname === 'string' && HOTES.includes(j.hostname) && (action === undefined || (typeof j.action === 'string' && j.action === action));
}
module.exports = { verifierTurnstile };
