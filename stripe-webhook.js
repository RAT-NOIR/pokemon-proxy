// Vérification de la signature des webhooks Stripe — UNE SEULE définition (WEBHOOK-MULTI, 2026-10-25).
//
// Pendant une rotation de secret, deux points d'arrivée Stripe envoient chacun chaque événement à la même adresse, chacun signé de
// SON secret. On accepte donc une liste : STRIPE_WEBHOOK_SECRET (le principal) puis STRIPE_WEBHOOK_SECRET_ANCIEN (optionnel ;
// vide ou d'espaces = absent). L'événement est authentique s'il est signé par L'UN d'eux ; sinon la fonction lève.
//
// 🔑 Ce que cette fonction ne fait PAS : dédupliquer. Un même event.id livré par les deux points est crédité UNE fois par la marque
// d'idempotence (`EvenementStripe`, index unique sur eventId) de gererWebhookStripe — la seule garde anti-double crédit.
// 🔑 L'erreur levée est celle du PREMIER essai (le principal), comme avant : le corps du 400 garde sa forme d'aujourd'hui et ne dit
// ni combien de secrets sont configurés, ni lequel a échoué. Aucun secret n'est jamais écrit.

/** Les secrets de signature acceptés, dans l'ordre d'essai (principal d'abord), sans vide ni doublon. */
function secretsWebhook(env = process.env) {
    const liste = [];
    for (const nom of ['STRIPE_WEBHOOK_SECRET', 'STRIPE_WEBHOOK_SECRET_ANCIEN']) {
        const s = String(env[nom] || '').trim();
        if (s && !liste.includes(s)) liste.push(s);
    }
    return liste;
}

/** Rend l'événement authentifié, ou LÈVE (aucun secret → lève aussi : jamais d'acceptation sans signature vérifiée). */
function verifierEvenementStripe(stripe, corps, signature, env = process.env) {
    const secrets = secretsWebhook(env);
    let premiere = null;
    for (const secret of secrets) {
        try { return stripe.webhooks.constructEvent(corps, signature, secret); }
        catch (e) { if (!premiere) premiere = e; }
    }
    throw premiere || new Error('Aucun secret de webhook configuré');
}

/** Ce qu'on écrit d'une erreur Stripe : son type, son code et son statusCode — JAMAIS son message (il peut porter 4 caractères de la clé). */
function resumeErreurStripe(e) {
    const sur = x => (typeof x === 'string' && /^[A-Za-z0-9_.-]{1,40}$/.test(x)) ? x : (typeof x === 'number' && Number.isFinite(x) ? String(x) : '-');
    return `type=${sur(e && e.type)} code=${sur(e && e.code)} statusCode=${sur(e && e.statusCode)}`;
}

module.exports = { secretsWebhook, verifierEvenementStripe, resumeErreurStripe };
