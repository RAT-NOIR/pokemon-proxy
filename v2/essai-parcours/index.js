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
// LISTE FERMÉE des adresses que l'exemption du défi peut dispenser (arbitrage du coordinateur, 2026-11-08) : le compte de test du site et les DEUX comptes de mesure de l'essai (v2/admin/compte-essai.js :
// ADRESSE_BANC ; installations/exemption-banc.js : ADRESSE_ORDINAIRE), pour que les outils de mesure (connexion-essai, parcours-test, juge en un clic) gardent l'exemption qu'ils avaient. Rien d'autre :
// toute autre adresse passe le contrôle normal. La route du lien de confirmation ne vaut que pour l'adresse de test (les deux autres sont en `.invalid` : aucun courriel n'en part).
const ADRESSE_MESURE = 'banc-mesure@rat-market.invalid', ADRESSE_MESURE_ORDINAIRE = 'banc-ordinaire@rat-market.invalid';
const ADRESSES_EXEMPTEES = Object.freeze([ADRESSE_TEST, ADRESSE_MESURE, ADRESSE_MESURE_ORDINAIRE]);
const estAdresseExemptee = s => { const f = forme(s); return f !== null && ADRESSES_EXEMPTEES.includes(f); };

// ADRESSES DÉCLARÉES (arbitrage du coordinateur, tour 2) : les comptes de `parcours-test` (v2/admin/abonnements/parcours-test.js) sont déclarés, côté serveur, dans `V2_ESSAI_ADRESSES_MESURE` : une liste d'ADRESSES séparées par des virgules,
// et rien d'autre (les identifiants de l'outil restent côté outil : le serveur ne lit JAMAIS la variable qui porte leurs mots de passe, un banc le vérifie).
// Cette variable n'est lue QU'ICI, donc seulement après la garde de service ; comparaison EXACTE, jamais par domaine ni motif, rien d'imprimé.
// Une entrée vide ou qui n'a pas la forme d'une adresse est ignorée ; une variable absente ne déclare rien (les trois adresses de la liste fermée seulement) ; 50 adresses au plus.
const FORME_ADRESSE = /^[^\s@<>"',;\\()[\]]{1,64}@[^\s@<>"',;\\()[\]]+\.[a-z0-9-]{2,}$/;
function adressesDeclarees(brut) {
    if (typeof brut !== 'string' || brut.length > 20000) return [];
    const sortie = [];
    for (const e of brut.split(',').slice(0, 200)) {
        const f = forme(e);
        if (f !== null && FORME_ADRESSE.test(f) && !sortie.includes(f)) sortie.push(f);
        if (sortie.length >= 50) break;
    }
    return sortie;
}
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

    const liste = Object.freeze([...ADRESSES_EXEMPTEES, ...adressesDeclarees(env.V2_ESSAI_ADRESSES_MESURE).filter(a => !ADRESSES_EXEMPTEES.includes(a))]);
    const exemptee = s => { const f = forme(s); return f !== null && liste.includes(f); };
    const autorise = req => mesure.actif === true && secretEgal(sha, req.get(ENTETE)) && exemptee(adresseDuCorps(req));
    // Une requête dispensée du défi ne doit JAMAIS faire partir un courriel vers une adresse hors de la liste : le compte est retrouvé par `emailCle` (qui efface points et « +… » de Gmail), donc l'adresse
    // STOCKÉE du compte trouvé peut être celle d'une autre boîte réelle de même clé. Le pilote restreint n'envoie que si le destinataire (l'adresse stockée) est EXACTEMENT dans la liste.
    const restreindreCourrier = c => {
        const w = Object.create(c);
        w.envoyerVerification = (email, ...r) => (exemptee(email) ? c.envoyerVerification(email, ...r) : Promise.resolve());
        w.envoyerReinitialisation = (email, ...r) => (exemptee(email) ? c.envoyerReinitialisation(email, ...r) : Promise.resolve());
        return w;
    };
    const autoriseLien = req => mesure.actif === true && secretEgal(sha, req.get(ENTETE)) && estAdresseTest(adresseDuCorps(req));   // la route du lien : l'adresse de test SEULE
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
                // le lien n'est retenu qu'APRÈS un envoi réussi, et seulement pour l'adresse STOCKÉE exactement égale à celle de test (un échec d'envoi, ou un compte de même clé écrit autrement, ne retient rien)
                w.envoyerVerification = async (email, lien, options) => { const r = await c.envoyerVerification(email, lien, options); if (estAdresseTest(email)) retenir(lien); return r; };
                registre.fournir('courrier', w);
            }
        } catch { /* pas de courrier : aucun lien ne sera retenu, la route répondra « introuvable » */ }
        router.post(CHEMIN_LIEN, (req, res, next) => {
            if (!autoriseLien(req)) return next();   // sans le secret, ou une autre adresse : la route n'existe pas (404 natif d'Express, octet pour octet)
            const g = prendre();
            res.setHeader('Cache-Control', 'no-store');
            if (!g) return res.status(404).json({ success: false, erreur: { code: 'INTROUVABLE', message: 'Aucun lien de confirmation en attente' } });
            return res.status(200).json({ success: true, lien: g.lien, expire: new Date(g.expireA).toISOString() });
        });
    }

    Object.defineProperty(mesure, 'sha', { value: sha, enumerable: false, writable: false, configurable: false });
    Object.defineProperty(mesure, 'autorise', { value: autorise, enumerable: false, writable: false, configurable: false });
    Object.defineProperty(mesure, 'restreindreCourrier', { value: restreindreCourrier, enumerable: false, writable: false, configurable: false });
    Object.defineProperty(mesure, 'monter', { value: monter, enumerable: false, writable: false, configurable: false });
    return mesure;
}

module.exports = { depuis, ADRESSE_TEST, ADRESSES_EXEMPTEES, ENTETE, CHEMIN_LIEN, DUREE_LIEN_MS, estAdresseTest, estAdresseExemptee };
