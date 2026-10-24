'use strict';
// LE RÉESSAI SUR LA LIMITE DE DÉBIT DE STRIPE (HTTP 429, « StripeRateLimitError »). Le client du SDK réessaie déjà deux fois (maxNetworkRetries) avec des délais très courts ; une rafale d'événements
// (l'avance d'une horloge d'essai) les épuise. Le webhook réessaie donc AUSSI, DANS le traitement de l'événement : attente CROISSANTE, et un BUDGET d'attente par traitement (6 s en tout, partagé
// par tous les appels de l'événement — jamais 6 s par appel). Le budget épuisé, l'erreur d'origine remonte et l'événement reste « rejouable » (500) : Stripe le renverra.
// Seule la limite de débit est réessayée. Toute autre erreur (réseau, 5xx, paramètre refusé…) remonte tout de suite, comme avant. Les écritures chez Stripe portent déjà leur clé d'idempotence
// (l'avoir de la prime : `prime-<filleul>`) : rejouer un appel qui a été reçu mais dont la réponse a été limitée ne le fait pas deux fois.
const DELAIS_MS = Object.freeze([250, 500, 1000, 2000, 4000]);
const BUDGET_MS = 6000;
const dormirVraiment = ms => new Promise(r => setTimeout(r, ms));
/** Une erreur de limite de débit ? Écrit par ce qu'elle RECONNAÎT : le type du SDK, le statut 429, ou le code `rate_limit`. */
function estLimite(e) {
    if (!e || typeof e !== 'object') return false;
    const brut = e.raw && typeof e.raw === 'object' ? e.raw : {};
    return e.type === 'StripeRateLimitError' || e.statusCode === 429 || e.code === 'rate_limit' || brut.statusCode === 429 || brut.code === 'rate_limit';
}
/**
 * Enveloppe un client Stripe : chaque appel de ressource (`stripe.customers.retrieve(…)`) est réessayé sur une limite de débit. Un objet enveloppé PAR TRAITEMENT (le budget d'attente est le sien).
 * `webhooks` (la vérification de signature, synchrone) et tout ce qui n'est pas une fonction passent tels quels.
 * @param {object} stripe  le client (SDK ou faux de banc)
 * @param {{ dormir?: (ms:number)=>Promise, delaisMs?: number[], budgetMs?: number }} options
 */
function envelopper(stripe, { dormir = dormirVraiment, delaisMs = DELAIS_MS, budgetMs = BUDGET_MS, maintenantMs = Date.now } = {}) {
    // le budget borne aussi la durée RÉELLE (relecture A-M1) : les appels eux-mêmes durent (jusqu'à 20 s de délai du SDK), pas seulement les attentes planifiées. L'échéance se compte en temps réel depuis le
    // début du traitement de l'événement (cet objet est créé à son début) ; une fois passée, plus aucun nouvel essai.
    const debut = maintenantMs();
    const etat = { attenduMs: 0 };
    const reessayer = (f, cible) => async (...args) => {
        for (let essai = 0; ; essai++) {
            try { return await f.apply(cible, args); }
            catch (e) {
                const delai = delaisMs[Math.min(essai, delaisMs.length - 1)];
                if (!estLimite(e) || essai >= delaisMs.length || etat.attenduMs + delai > budgetMs) throw e;
                if ((maintenantMs() - debut) + delai > budgetMs) throw e;
                etat.attenduMs += delai;
                await dormir(delai);
            }
        }
    };
    const habiller = (cible, racine) => new Proxy(cible, {
        get(t, p) {
            const v = Reflect.get(t, p, t);
            if (racine && p === 'webhooks') return v;
            if (typeof v === 'function') return racine ? v.bind(t) : reessayer(v, t);
            if (v && typeof v === 'object' && typeof p === 'string') return habiller(v, false);
            return v;
        }
    });
    return habiller(stripe, true);
}
module.exports = { envelopper, estLimite, DELAIS_MS, BUDGET_MS };
