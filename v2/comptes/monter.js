'use strict';
// Montage du lot B2 (comptes). Les pilotes par défaut ne sont posés que s'ils ne l'ont pas été (les bancs fournissent des faux).
const registre = require('../registre'); const { routesComptes } = require('./routes');
const absent = nom => { try { registre.obtenir(nom); return false; } catch { return true; } };
module.exports = {
    enTete(app, cfg) { },
    routes(router, cfg, deps) {
        if (absent('turnstile')) {                           // pilote réel : lève « turnstile-non-configure » sans TURNSTILE_SECRET => 503
            const { verifierTurnstile } = require('./turnstile');
            registre.fournir('turnstile', { verifier: (jeton, ip) => verifierTurnstile(jeton, ip) });
        }
        if (absent('courrier') && !process.env.BREVO_API_KEY)   // sans clé : mémoire seulement ; avec clé et pilote non écrit : rien (503)
            registre.fournir('courrier', require('./courrier').creerCourrierMemoire());
        routesComptes(router, cfg, deps);
    }
};
