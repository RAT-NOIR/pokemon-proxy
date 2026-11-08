'use strict';
// ESSAI-PARCOURS — tests automatiques d'un parcours réel du site sur l'ESSAI (inscription, confirmation, connexion). UN SEUL module, retirable d'un geste : supprimer ce dossier et, dans v2/config.js,
// la ligne qui le charge (`require('./essai-parcours')`) ; rien d'autre ne le nomme (comptes/routes.js et comptes/monter.js lisent seulement `cfg.mesure`).
//
// IL N'EST JAMAIS CHARGÉ hors de l'essai : v2/config.js ne le `require` que si v2/garde-essai.js prouve l'essai (base rm_essai ET service Render de l'essai ET V2_CIBLE=essai). Sous tout autre environnement
// (production comprise), ce fichier n'est pas exécuté (prouvé par require.cache dans test-essai-parcours.js), la route n'est pas montée (404 natif) et `cfg.mesure.autorise` n'existe pas.
//
// Il porte DEUX choses, et rien d'autre :
//  1. l'exemption du seul DÉFI Turnstile (inscription, connexion, mot de passe oublié, renvoi de confirmation) pour la requête qui porte le secret (en-tête X-Rat-Market-Mesure, comparé en temps constant)
//     ET l'adresse EXACTE du compte de test. Origine, limites par IP et par adresse, mot de passe restent ;
//  2. la route d'administration POST /api/essai/lien-confirmation (même secret, même adresse) qui rend le dernier lien de confirmation du compte de test, UNE fois, pendant 15 minutes.
//     Le lien n'est gardé qu'EN MÉMOIRE de ce processus (jamais en base, jamais journalisé), et seulement pour cette adresse : le chemin normal (jetons hachés dans liens_email) n'est pas touché.
const crypto = require('crypto');

const ADRESSE_TEST = 'ratmarket.contact+essai@gmail.com';
const ENTETE = 'x-rat-market-mesure';
const CHEMIN_LIEN = '/api/essai/lien-confirmation';
const DUREE_LIEN_MS = 15 * 60e3;

/** Forme comparée : la même normalisation de base que emailCle (NFKC, espaces, minuscules) mais SANS l'effacement des points ni des « + » de Gmail : l'adresse doit être EXACTEMENT celle du compte de test. */
const forme = s => (typeof s === 'string' && s.length <= 254 ? s.normalize('NFKC').trim().toLowerCase() : null);
const estAdresseTest = s => forme(s) === ADRESSE_TEST;
const adresseDuCorps = req => (req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body.email : undefined);

/** Temps constant : deux condensés SHA-256 de même longueur. */
function secretEgal(sha, recu) {
    if (typeof sha !== 'string' || typeof recu !== 'string') return false;
    return crypto.timingSafeEqual(Buffer.from(sha, 'hex'), crypto.createHash('sha256').update(recu).digest());
}

/**
 * Construit `cfg.mesure` pour un environnement DÉJÀ prouvé essai par la garde. Le secret n'est jamais gardé : seul son condensé l'est, non énumérable (ni la sérialisation JSON ni l'inspection de l'objet ne l'impriment).
 * `maintenant` : l'horloge (injectable pour les bancs).
 */
function depuis(env, { maintenant = () => Date.now() } = {}) {
    const secret = env.V2_SECRET_MESURE;
    const mesure = { actif: false, raison: '' };
    if (typeof secret !== 'string' || !secret) mesure.raison = 'V2_SECRET_MESURE absent';
    else if (secret.length < 32) mesure.raison = 'V2_SECRET_MESURE trop court (moins de 32 caractères)';
    else { mesure.actif = true; mesure.raison = 'essai'; }
    const sha = mesure.actif ? crypto.createHash('sha256').update(secret).digest('hex') : null;
    let garde = null;   // { lien, expireA } : le dernier lien de confirmation du compte de test, un seul

    const autorise = req => mesure.actif === true && secretEgal(sha, req.get(ENTETE)) && estAdresseTest(adresseDuCorps(req));
    const retenir = lien => { if (typeof lien === 'string' && lien) garde = { lien, expireA: maintenant() + DUREE_LIEN_MS }; };
    const prendre = () => {   // usage unique : lu, il disparaît ; expiré, il disparaît aussi
        const g = garde; garde = null;
        return g && maintenant() <= g.expireA ? g : null;
    };

    /** Appelé par comptes/monter.js, une fois le courrier fourni : enveloppe le pilote (le lien n'est retenu que pour l'adresse de test) et monte la route d'administration. */
    function monter({ router, registre }) {
        try {
            const c = registre.obtenir('courrier');
            if (!c.dejaSurveille) {
                const w = Object.create(c);
                w.dejaSurveille = true;
                w.envoyerVerification = (email, lien, options) => { if (estAdresseTest(email)) retenir(lien); return c.envoyerVerification(email, lien, options); };
                registre.fournir('courrier', w);
            }
        } catch { /* pas de courrier : aucun lien ne sera retenu, la route répondra « introuvable » */ }
        router.post(CHEMIN_LIEN, (req, res, next) => {
            if (!autorise(req)) return next();   // sans le secret, ou une autre adresse : la route n'existe pas (404 natif d'Express, octet pour octet)
            const g = prendre();
            res.setHeader('Cache-Control', 'no-store');
            if (!g) return res.status(404).json({ success: false, erreur: { code: 'INTROUVABLE', message: 'Aucun lien de confirmation en attente' } });
            return res.status(200).json({ success: true, lien: g.lien, expire: new Date(g.expireA).toISOString() });
        });
    }

    Object.defineProperty(mesure, 'sha', { value: sha, enumerable: false, writable: false, configurable: false });
    Object.defineProperty(mesure, 'autorise', { value: autorise, enumerable: false, writable: false, configurable: false });
    Object.defineProperty(mesure, 'monter', { value: monter, enumerable: false, writable: false, configurable: false });
    return mesure;
}

module.exports = { depuis, ADRESSE_TEST, ENTETE, CHEMIN_LIEN, DUREE_LIEN_MS, estAdresseTest };
