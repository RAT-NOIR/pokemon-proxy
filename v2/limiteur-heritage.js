'use strict';
// LE LIMITEUR HÉRITÉ (index.js, `limiteurIA` : 60 requêtes/h/IP sur /api/identifier* et /api/analyser*) ET LA v2.
// LA RÈGLE, écrite par ce qu'elle AUTORISE : le limiteur hérité ne saute QUE la requête que la v2 traite elle-même (v2 montée avec une configuration valide ; POST ;
// chemin EXACT `/api/identifier` avec `contrat === 2` strict, ou `/api/identifier/reponse`, route propre à la v2) ET dont le porteur est authentifié par la MÊME fonction
// que les routes (porteur.js : `resoudrePorteur` + une installation, ce qu'exige `exigerInstallation`). Tout le reste est compté comme avant : en-tête Bearer seul, faux
// Bearer, faux `contrat: 2` sur une route héritée voisine, chemin autrement écrit, v2 éteinte ou configuration invalide, erreur de lecture du porteur (échec fermé).
// Pourquoi c'est sûr : ces deux routes v2 n'appellent jamais `next()` vers la route héritée une fois l'aiguilleur passé (refus JETON/ENTREE/INDISPONIBLE, ou traitement) ;
// la chaîne héritée n'est appelée (deps.gererIdentifier) qu'APRÈS porteur, installation, plafond par porteur, idempotence et entrée validée.
// LE COÛT : `skip` lit la base à chaque requête candidate, et la route v2 y écrit ; un PLAFOND EN MÉMOIRE par IP (plafondIp, monté avant le limiteur hérité) les refuse sans la toucher.
const { resoudrePorteur } = require('./porteur');
const { repondreErreur } = require('./erreurs'); const { ipKeyGenerator } = require('express-rate-limit');

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
        // `req.v2` reste posé par la résolution : les deux routes candidates commencent par `resoudrePorteur`, qui le réinitialise sans le lire (porteur.js:12) avant tout autre usage ; aucune route héritée ne le lit.
        const resultat = { refuse: false };
        const fauxRes = { setHeader() { }, status() { return this; }, json() { resultat.refuse = true; return this; } };
        try {
            await new Promise((ok, ko) => { try { Promise.resolve(resoudreDe(cfg)(req, fauxRes, ok)).then(() => { if (resultat.refuse) ok(); }, ko); } catch (e) { ko(e); } });
            const porteur = req.v2 && req.v2.porteur;
            return !resultat.refuse && Boolean(porteur && porteur.installation);
        } catch { return false; }
    }
    /** `handler` d'express-rate-limit : une requête de la v2 reçoit le refus v2 (DEBIT + Retry-After) ; toute autre, le refus hérité inchangé. */
    function refuser(req, res, next, options) {
        if (actif() && requeteDeLaV2(req)) {
            const reset = req.rateLimit && req.rateLimit.resetTime instanceof Date ? req.rateLimit.resetTime.getTime() : Date.now() + options.windowMs;
            return repondreErreur(res, 'DEBIT', 'Trop de requêtes, réessayez plus tard.', { reessayerDans: Math.max(1, Math.ceil((reset - Date.now()) / 1000)) });
        }
        const { statusCode, message: corpsHerite } = options;   // le corps hérité tel que configuré dans index.js
        return res.status(statusCode).send(corpsHerite);
    }
    // ── LE PLAFOND EN MÉMOIRE PAR IP, réservé aux requêtes CANDIDATES (celles que requeteDeLaV2 admet), monté AVANT le limiteur hérité : `skip` lit la base à chaque requête
    // (express-rate-limit appelle `skip` avant de compter) et la route v2 y écrit (transport/limites.js:12) ; ce plafond refuse SANS lire ni écrire en base. Fenêtre fixe d'une heure
    // par IP, ouverte à la première candidate. Mémoire : une entrée {debut, n} par IP, au plus MAX_IPS (la plus ancienne est évincée quand la table est pleine), balayage des fenêtres écoulées toutes les 5 min.
    const maintenant = typeof o.maintenant === 'function' ? o.maintenant : Date.now;
    const fenetres = new Map();
    let balai = null;
    function purger() { const t = maintenant(); for (const [ip, w] of fenetres) if (t - w.debut >= FENETRE_MS) fenetres.delete(ip); }
    function compterIp(req, res, next, cfg) {
        const plafond = plafondDe(cfg), t = maintenant(), ip = ipKeyGenerator(String(req.ip || '?'));   // la clé du limiteur hérité (IPv6 regroupée par /56) : la MÊME fonction, importée
        let w = fenetres.get(ip);
        if (!w || t - w.debut >= FENETRE_MS) {
            if (!w && fenetres.size >= MAX_IPS) fenetres.delete(fenetres.keys().next().value);
            w = { debut: t, n: 0 }; fenetres.delete(ip); fenetres.set(ip, w);
            if (!balai) { balai = setInterval(purger, BALAYAGE_MS); if (balai.unref) balai.unref(); }
        }
        if (w.n >= plafond) return repondreErreur(res, 'DEBIT', 'Trop de requêtes, réessayez plus tard.', { reessayerDans: Math.max(1, Math.ceil((w.debut + FENETRE_MS - t) / 1000)) });
        w.n++;
        req._plafondIpCompte = true;                                                        // compté UNE fois : plafondIp ne recompte pas une requête déjà comptée par plafondGrand
        return next();
    }
    function plafondIp(req, res, next) {
        const cfg = actif();
        if (!cfg || !requeteDeLaV2(req) || req._plafondIpCompte) return next();
        return compterIp(req, res, next, cfg);
    }
    // MODELE-VISUEL-API (tour 2, I3) : le même plafond par IP, appliqué AVANT la lecture d'un GRAND corps de POST /api/identifier (le corps n'est pas encore lu : on ne sait pas s'il porte contrat 2, la route est candidate par son chemin).
    function plafondGrand(req, res, next) {
        const cfg = actif();
        if (!cfg || !req || req.method !== 'POST' || cheminDe(req) !== CHEMIN_IDENTIFIER) return repondreErreur(res, 'ENTREE', 'corps trop grand', { detail: 'corps' });
        return compterIp(req, res, next, cfg);
    }
    return { sauter, refuser, plafondIp, plafondGrand, taillePlafond: () => fenetres.size, purger };
}
// Le plafond se DÉRIVE des limites par porteur de la v2 : PORTEURS_PAR_IP porteurs derrière une même IP (foyer, petit bureau, NAT), chacun au maximum de ses deux routes
// (identifications + réponses par heure : transport/limites.js, config.js identifierParCompteHeure 120 et reponseParPorteurHeure 600) = 5 × (120 + 600) = 3600 par heure.
const PORTEURS_PAR_IP = 5, MAX_IPS = 100000, FENETRE_MS = 3600e3, BALAYAGE_MS = 5 * 60e3;
const plafondDe = cfg => PORTEURS_PAR_IP * (cfg.limites.identifierParCompteHeure + cfg.limites.reponseParPorteurHeure);
module.exports = { fabrique, requeteDeLaV2, PORTEURS_PAR_IP, MAX_IPS, plafondDe };
