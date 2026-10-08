'use strict';
// Vérification Cloudflare Turnstile. `fetch` et `secret` sont INJECTABLES : les bancs n'émettent aucune requête réelle.
const URL_VERIF = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
async function verifierTurnstile(jeton, ip, { fetch = globalThis.fetch, secret = process.env.TURNSTILE_SECRET } = {}) {
    if (!secret) throw new Error('turnstile-non-configure');           // fail-closed : la route répond 503
    if (typeof jeton !== 'string' || !jeton) return false;
    const corps = new URLSearchParams({ secret, response: jeton });
    if (ip) corps.set('remoteip', ip);
    const r = await fetch(URL_VERIF, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: corps });
    if (!r || !r.ok) return false;
    const j = await r.json();
    return j && j.success === true;
}
module.exports = { verifierTurnstile };
