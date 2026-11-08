'use strict';
// LIEN-ORDINATEUR — POST /api/lien-ordinateur { email, turnstile } : le lien de l'extension (fiche du Chrome Web Store), par courriel, à une adresse donnée par un visiteur SANS compte.
// L'ORDRE DES GARDES, chacune avant la suivante (une requête refusée tôt ne coûte rien plus loin) :
//   no-store → Origin exacte + X-Rat-Market (403 ORIGINE) → limite par IP (429) → corps lisible (400 ENTREE) → pilote de courrier qui envoie pour de vrai (503) → Turnstile, action `lien-ordinateur` (422 defi-anti-robot, 503 si
//   Cloudflare est injoignable) → plafond du jour LU (429 pour tout le monde s'il est plein) → l'adresse est lue (400 ENTREE si ce n'est pas du texte) → le service DÉTACHÉ (service.js : marque par boîte, plafond consommé, envoi).
// RÉPONSE : 202 { success: true } dans TOUS les cas où le défi passe et où le plafond n'est pas plein — adresse valide ou non, déjà servie ou non, Brevo en panne ou non : ni le corps, ni le statut, ni la durée (le travail est
// détaché) ne disent quoi que ce soit de l'adresse. 429 au-delà de la limite par IP ou du plafond du jour ; 503 seulement avant l'adresse (Turnstile injoignable, courrier ou base absents).
// Le défi réutilise `exigerDefi` des comptes (comptes/routes.js) SANS la dispense des outils de mesure : ici Turnstile est obligatoire, sans exception.
const crypto = require('crypto');
const L = require('../transport/limites');
const { ipKeyGenerator } = require('express-rate-limit');
const registre = require('../registre');
const { repondreErreur } = require('../erreurs');
const S = require('../comptes/sessions');
const { exigerDefi, indispo, objet } = require('../comptes/routes');
const { creerService, secondesAvantMinuitParis, JOUR_MS } = require('./service');

const nomErreur = e => (e && e.name) || 'Error';   // jamais e.message
const courrierDe = () => { try { return registre.obtenir('courrier'); } catch { return null; } };

function routesLien(router, cfg) {
    const sansStocker = (req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); };
    // La clé est un HMAC-SHA256 À CLÉ (V2_SECRET_EMPREINTE, domaine « lien-ordinateur-ip », différent de celui de la boîte) de l'IP REGROUPÉE comme celle du limiteur hérité (`ipKeyGenerator` : un IPv6 compte par bloc /56).
    // `L.empreinteIp` (SHA-256 sans secret, partagé avec d'autres routes) n'est PAS utilisé ici : une IPv4 s'y retrouve par dictionnaire.
    const secret = cfg.empreinte && cfg.empreinte.secret;
    if (typeof secret !== 'string' || secret.length < 16) throw new Error('lien-ordinateur : secret d\'empreinte absent');   // fail-closed : jamais d'empreinte sans secret
    const cleIp = q => crypto.createHmac('sha256', secret).update(`lien-ordinateur-ip|${ipKeyGenerator(String(q.ip || '?'))}`).digest('hex').slice(0, 32);
    const parIp = L.limiteur({ nom: 'lien-ordinateur-ip', max: cfg.lienOrdinateur.parIpJour, fenetreMs: JOUR_MS, cle: cleIp, code: 'LIMITE_DEBIT' });
    const corpsLisible = (req, res, next) => (objet(req.body) ? next() : repondreErreur(res, 'ENTREE', 'Requête invalide'));
    // Un pilote qui ne part nulle part (mémoire, sans clé Brevo) répondrait 202 sans rien envoyer : refusé ici, AVANT de consommer un jeton Turnstile.
    const piloteReel = (req, res, next) => { const c = courrierDe(); return c && c.reel === true && typeof c.envoyerLienOrdinateur === 'function' ? next() : indispo(res); };
    const defi = exigerDefi({ ...cfg, mesure: null }, { action: 'lien-ordinateur' });

    router.post('/api/lien-ordinateur', sansStocker, S.exigerOrigineSite(cfg), parIp, corpsLisible, piloteReel, defi, async (req, res) => {
        try {
            const service = creerService({ cfg, courrier: courrierDe() });
            // Le plafond du jour est LU avant toute étape liée à l'adresse : plein, il refuse tout le monde (adresse neuve, servie, invalide ou jetable : la même réponse).
            if (await service.plein()) return repondreErreur(res, 'LIMITE_DEBIT', 'Trop de requêtes, réessayez plus tard.', { reessayerDans: secondesAvantMinuitParis() });
            const adresse = req.body.email;
            if (typeof adresse !== 'string') return repondreErreur(res, 'ENTREE', 'Requête invalide', { detail: 'email' });
            service.lancer(adresse);      // DÉTACHÉ : la réponse ne dépend ni de l'adresse ni de la durée de Brevo
            return res.status(202).json({ success: true });
        } catch (e) { console.error(`❌ [v2 lien-ordinateur] ${nomErreur(e)}`); return indispo(res); }
    });
}
module.exports = { routesLien };
