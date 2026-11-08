'use strict';
// Montage du lot B2 (comptes). Les pilotes par défaut ne sont posés que s'ils ne l'ont pas été (les bancs fournissent des faux).
const registre = require('../registre'); const { routesComptes } = require('./routes');
const absent = nom => { try { registre.obtenir(nom); return false; } catch { return true; } };
module.exports = {
    enTete(app, cfg) { },
    routes(router, cfg, deps) {
        if (absent('turnstile')) {                           // pilote réel : lève « turnstile-non-configure » sans TURNSTILE_SECRET => 503
            const { verifierTurnstile } = require('./turnstile');
            registre.fournir('turnstile', { verifier: (jeton, ip, action) => verifierTurnstile(jeton, ip, { action }) });
        }
        // L1 : la dispense de mesure dit toujours son état au démarrage (jamais le secret) : active sur le seul service de l'essai, inactive partout ailleurs avec sa raison.
        if (cfg.mesure) console.log(cfg.mesure.actif ? '🔓 [v2] dispense de mesure : active (essai ; en-tête X-Rat-Market-Mesure, défi Turnstile seul)' : `🔒 [v2] dispense de mesure : inactive (${cfg.mesure.raison})`);
        if (absent('courrier')) {
            if (!process.env.BREVO_API_KEY) {
                registre.fournir('courrier', require('./courrier').creerCourrierMemoire());   // sans clé : mémoire seulement — mais JAMAIS en silence (tour 1) : aucune valeur de secret dans la ligne
                console.warn('⚠️ [v2] courrier : pilote mémoire, aucun courriel ne partira (BREVO_API_KEY absente)');
            }
            else {
                // BREVO : avec la clé, le pilote Brevo, sous le plafond du jour (V2_COURRIELS_JOUR). Une construction qui échoue (banc isolé, clé illisible) laisse le courrier NON fourni (503), comme avant le pilote :
                // jamais un repli sur la mémoire avec une clé posée, qui ferait croire à un envoi. Le NOM de l'erreur seul est journalisé.
                try {
                    const { creerPlafondJour } = require('./plafond-courriels');
                    registre.fournir('courrier', require('./courrier').creerCourrierBrevo({ de: cfg.courriels.de, repondreA: cfg.courriels.repondreA, plafond: creerPlafondJour({ max: cfg.courriels.jour }) }));
                } catch (e) { console.error(`❌ [v2 courrier] pilote Brevo non monté (${(e && e.name) || 'Error'}) — le courrier reste indisponible (503)`); }
            }
        }
        // PARCOURS DU SITE : sur l'essai SEUL (cfg.mesure.actif, jamais vrai hors de la garde de service), le module des parcours du site enveloppe le courrier et monte sa route d'administration. Ailleurs : rien.
        if (cfg.mesure && cfg.mesure.actif === true && typeof cfg.mesure.monter === 'function') cfg.mesure.monter({ router, registre });
        routesComptes(router, cfg, deps);
        require('./purge').demarrerPurge({ cfg, ...(deps && deps.minuteurs ? { minuteurs: deps.minuteurs } : {}) });   // O3 : purge des comptes non confirmés (passe différée puis horaire), un seul minuteur par processus
        // BREVO : la passe d'avertissement des comptes inactifs (30 jours avant la suppression). ÉTEINTE par défaut (V2_AVERTISSEMENTS_INACTIFS=1 pour l'allumer) ; elle lit le courrier à chaque passe et refuse un pilote qui n'envoie pas.
        if (cfg.courriels && cfg.courriels.avertissementsInactifs)
            require('./inactifs').demarrerAvertissements({ cfg, courrier: () => registre.obtenir('courrier'), ...(deps && deps.minuteurs ? { minuteurs: deps.minuteurs } : {}) });
    }
};
