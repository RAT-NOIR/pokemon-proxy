'use strict';
// LE LIMITEUR HÉRITÉ (index.js, `limiteurIA` : 60 requêtes/h/IP sur /api/identifier* et /api/analyser*) ET LA v2.
// LA RÈGLE, écrite par ce qu'elle AUTORISE : le limiteur hérité ne saute QUE la requête que la v2 traite elle-même (v2 montée avec une configuration valide ; POST ;
// chemin EXACT `/api/identifier` avec `contrat === 2` strict, ou `/api/identifier/reponse`, route propre à la v2) ET dont le porteur est authentifié par la MÊME fonction
// que les routes (porteur.js : `resoudrePorteur` + une installation, ce qu'exige `exigerInstallation`). Tout le reste est compté comme avant : en-tête Bearer seul, faux
// Bearer, faux `contrat: 2` sur une route héritée voisine, chemin autrement écrit, v2 éteinte ou configuration invalide, erreur de lecture du porteur (échec fermé).
// Pourquoi c'est sûr : ces deux routes v2 n'appellent jamais `next()` vers la route héritée une fois l'aiguilleur passé (refus JETON/ENTREE/INDISPONIBLE, ou traitement) ;
// la chaîne héritée n'est appelée (deps.gererIdentifier) qu'APRÈS porteur, installation, plafond par porteur, idempotence et entrée validée.
const { resoudrePorteur } = require('./porteur');
const { repondreErreur } = require('./erreurs');

const CHEMIN_IDENTIFIER = '/api/identifier', CHEMIN_REPONSE = '/api/identifier/reponse';
const cheminDe = req => String(req.originalUrl || req.url || '').split('?')[0];

/** Écrite par ce qu'elle autorise : exactement ce que les routes v2 prennent (l'aiguilleur de POST /api/identifier lit `req.body.contrat === 2`). */
function requeteDeLaV2(req) {
    if (!req || req.method !== 'POST') return false;
    const chemin = cheminDe(req);
    if (chemin === CHEMIN_REPONSE) return true;
    return chemin === CHEMIN_IDENTIFIER && Boolean(req.body) && typeof req.body === 'object' && req.body.contrat === 2;
}

/**
 * @param {() => (object|null)} lireCfg la configuration v2 SI la v2 est montée et valide, sinon null
 * @param {{resoudre?: Function}} [o] `resoudre` : injection de banc (par défaut, la fonction de porteur.js)
 */
function fabrique(lireCfg, o = {}) {
    const resoudreDe = o.resoudre || resoudrePorteur;
    function actif() { try { return lireCfg() || null; } catch { return null; } }
    /** `skip` d'express-rate-limit : true seulement pour une requête de la v2 dont le porteur est authentifié. Ne lève jamais : tout doute compte la requête. */
    async function sauter(req) {
        const cfg = actif();
        if (!cfg || !requeteDeLaV2(req)) return false;
        const avant = req.v2, resultat = { refuse: false };
        const fauxRes = { setHeader() { }, status() { return this; }, json() { resultat.refuse = true; return this; } };
        try {
            await new Promise((ok, ko) => { try { Promise.resolve(resoudreDe(cfg)(req, fauxRes, ok)).then(() => { if (resultat.refuse) ok(); }, ko); } catch (e) { ko(e); } });
            const porteur = req.v2 && req.v2.porteur;
            return !resultat.refuse && Boolean(porteur && porteur.installation);
        } catch { return false; }
        finally { if (avant === undefined) delete req.v2; else req.v2 = avant; }
    }
    /** `handler` d'express-rate-limit : une requête de la v2 reçoit le refus v2 (DEBIT + Retry-After) ; toute autre, le refus hérité inchangé. */
    function refuser(req, res, next, options) {
        if (actif() && requeteDeLaV2(req)) {
            const reset = req.rateLimit && req.rateLimit.resetTime instanceof Date ? req.rateLimit.resetTime.getTime() : Date.now() + options.windowMs;
            return repondreErreur(res, 'DEBIT', 'Trop de requêtes, réessayez plus tard.', { reessayerDans: Math.max(1, Math.ceil((reset - Date.now()) / 1000)) });
        }
        return res.status(options.statusCode).send(options.message);
    }
    return { sauter, refuser };
}
module.exports = { fabrique, requeteDeLaV2 };
