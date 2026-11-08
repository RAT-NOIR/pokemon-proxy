'use strict';
// LIEN-ORDINATEUR — POST /api/lien-ordinateur { email, turnstile } : le lien de l'extension (fiche du Chrome Web Store), par courriel, à une adresse donnée par un visiteur SANS compte.
// L'ORDRE DES GARDES, chacune avant la suivante (une requête refusée tôt ne coûte rien plus loin) :
//   no-store → Origin exacte + X-Rat-Market (403 ORIGINE) → limite par IP (429) → corps lisible (400 ENTREE) → pilote de courrier qui envoie pour de vrai (503) → Turnstile, action `lien-ordinateur` (422 defi-anti-robot, 503 si
//   Cloudflare est injoignable) → l'adresse est lue (400 ENTREE si ce n'est pas du texte) → le service (service.js : marque par boîte, plafond du jour, envoi).
// RÉPONSE : 202 { success: true } dans TOUS les cas où le défi passe — adresse valide ou non, déjà servie ou non : elle ne révèle rien sur l'adresse. 429 au-delà de la limite par IP ou du plafond du jour, 503 si le service est indisponible.
// Le défi réutilise `exigerDefi` des comptes (comptes/routes.js) SANS la dispense des outils de mesure : ici Turnstile est obligatoire, sans exception.
const L = require('../transport/limites');
const registre = require('../registre');
const { repondreErreur } = require('../erreurs');
const S = require('../comptes/sessions');
const { exigerDefi, indispo, objet } = require('../comptes/routes');
const { creerService, secondesAvantMinuitParis, JOUR_MS } = require('./service');

const nomErreur = e => (e && e.name) || 'Error';   // jamais e.message
const courrierDe = () => { try { return registre.obtenir('courrier'); } catch { return null; } };

function routesLien(router, cfg) {
    const sansStocker = (req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); };
    const parIp = L.limiteur({ nom: 'lien-ordinateur-ip', max: cfg.lienOrdinateur.parIpJour, fenetreMs: JOUR_MS, cle: q => L.empreinteIp(q.ip), code: 'LIMITE_DEBIT' });
    const corpsLisible = (req, res, next) => (objet(req.body) ? next() : repondreErreur(res, 'ENTREE', 'Requête invalide'));
    // Un pilote qui ne part nulle part (mémoire, sans clé Brevo) répondrait 202 sans rien envoyer : refusé ici, AVANT de consommer un jeton Turnstile.
    const piloteReel = (req, res, next) => { const c = courrierDe(); return c && c.reel === true && typeof c.envoyerLienOrdinateur === 'function' ? next() : indispo(res); };
    const defi = exigerDefi({ ...cfg, mesure: null }, { action: 'lien-ordinateur' });

    router.post('/api/lien-ordinateur', sansStocker, S.exigerOrigineSite(cfg), parIp, corpsLisible, piloteReel, defi, async (req, res) => {
        try {
            const adresse = req.body.email;
            if (typeof adresse !== 'string') return repondreErreur(res, 'ENTREE', 'Requête invalide', { detail: 'email' });
            const r = await creerService({ cfg, courrier: courrierDe() }).demander(adresse);
            if (r.issue === 'plafond') return repondreErreur(res, 'LIMITE_DEBIT', 'Trop de requêtes, réessayez plus tard.', { reessayerDans: secondesAvantMinuitParis() });
            return res.status(202).json({ success: true });
        } catch (e) { console.error(`❌ [v2 lien-ordinateur] ${nomErreur(e)}`); return indispo(res); }
    });
}
module.exports = { routesLien };
