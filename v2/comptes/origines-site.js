'use strict';
// UNE définition des origines du site (L1) : l'apex et `www`, rien d'autre. Liste FERMÉE, comparaison à l'octet (ni majuscules, ni port,
// ni http, ni autre sous-domaine). Le CORS (transport/cors.js), le contrôle d'origine des écritures (sessions.js, exemption-banc.js)
// et le `hostname` de Turnstile (turnstile.js) lisent tous cette liste : une règle, un fichier.
const APEX = 'https://rat-market.fr', WWW = 'https://www.rat-market.fr';
const HOTES = Object.freeze(['rat-market.fr', 'www.rat-market.fr']);          // les `hostname` que Turnstile peut rendre pour ces deux origines

/** Les origines admises, tirées de la configuration (cfg.origines.site / siteWww). */
function originesSite(cfg) {
    const o = (cfg && cfg.origines) || {};
    return [o.site, o.siteWww].filter(x => typeof x === 'string' && x);
}
const estOrigineSite = (cfg, origine) => typeof origine === 'string' && originesSite(cfg).includes(origine);
module.exports = { APEX, WWW, HOTES, originesSite, estOrigineSite };
