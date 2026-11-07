'use strict';
const registre = require('../registre'); const L = require('../transport/limites');
const { repondreErreur } = require('../erreurs'); const S = require('./sessions'); const svc = require('./service');
const { resoudrePorteur, exigerSession } = require('../porteur'); const liaison = require('../installations/liaison'); const J = require('./jetons'); const { emailCle, estJetable } = require('./email-cle');

// Pas de use() ici et pas de deps.pret : l'assembleur du socle pose la garde d'index sur la pile de chaque route.
const HEURE = 3600e3;
const indispo = res => repondreErreur(res, 'INDISPONIBLE', 'Service momentanément indisponible');
const objet = b => b && typeof b === 'object' && !Array.isArray(b);
const entreeInvalide = res => repondreErreur(res, 'ENTREE', 'Requête invalide');
const nomErreur = e => (e && e.name) || 'Error';   // jamais e.message : un pilote ou un driver peut y mettre une adresse

/** 'ok' | 'refuse' | 'indispo'. Fail-closed : un pilote absent ou en erreur n'est jamais un « ok ». */
async function defi(cfg, corps, ip) {
    if (cfg.turnstile === 'off') return 'ok';
    let t; try { t = registre.obtenir('turnstile'); } catch { return 'indispo'; }
    if (typeof corps.turnstile !== 'string' || !corps.turnstile) return 'refuse';
    try { return (await t.verifier(corps.turnstile, ip)) === true ? 'ok' : 'refuse'; } catch (e) { console.error(`❌ [v2 turnstile] pilote en échec (${nomErreur(e)})`); return 'indispo'; }
}
const courrierDe = () => { try { return registre.obtenir('courrier'); } catch { return null; } };
/** L1 : le défi Turnstile en garde de route (connexion, mot-de-passe-oublie, renvoyer-verification), avec la MÊME fonction `defi` et le MÊME refus que l'inscription
 *  (422 ENTREE `defi-anti-robot`, 503 si le pilote manque ou tombe). Il se place APRÈS l'origine et la limite par IP, AVANT tout budget par adresse et toute lecture de compte :
 *  un robot sans jeton ne consomme ni le budget d'un titulaire ni un hachage. `avecCourrier` : l'oubli et le renvoi n'ont pas de sens sans courrier (503 d'abord, comme l'inscription). */
/** Exemption des outils de mesure : cfg.secretMesure (essai + secret >= 32, sinon null) égal à l'en-tête X-Rat-Market-Mesure, comparaison à temps constant (SHA-256 des deux, même longueur). */
function mesureAutorisee(cfg, req) {
    const secret = cfg.secretMesure, recu = req.get('x-rat-market-mesure');
    if (typeof secret !== 'string' || secret.length < 32 || typeof recu !== 'string') return false;
    const crypto = require('crypto'), h = x => crypto.createHash('sha256').update(x).digest();
    return crypto.timingSafeEqual(h(secret), h(recu));
}
const exigerDefi = (cfg, { avecCourrier = false } = {}) => async (req, res, next) => {
    try {
        if (avecCourrier && !courrierDe()) return indispo(res);
        if (mesureAutorisee(cfg, req)) return next();   // dispense du DÉFI seulement : origine, limites et mot de passe restent
        const d = await defi(cfg, objet(req.body) ? req.body : {}, req.ip);
        if (d === 'indispo') return indispo(res);
        if (d === 'refuse') return repondreErreur(res, 'ENTREE', 'Vérification anti-robot échouée', { detail: 'defi-anti-robot' }, 422);
        return next();
    } catch (e) { console.error(`❌ [v2 defi] ${nomErreur(e)}`); return indispo(res); }
};

function routesComptes(router, cfg) {
    const site = [S.exigerOrigineSite(cfg)];                           // toute écriture du site : Origin + X-Rat-Market
    const parIp = (nom, max) => L.limiteur({ nom, max, fenetreMs: HEURE, cle: q => L.empreinteIp(q.ip) });
    const adresseDuCorps = q => (objet(q.body) && typeof q.body.email === 'string' && q.body.email.length <= 254 ? emailCle(q.body.email) : null);

    router.post('/api/compte/inscription', ...site, parIp('inscription-ip', cfg.limites.inscriptionIpHeure), async (req, res) => {
        try {
            const b = req.body;
            if (!objet(b)) return repondreErreur(res, 'ENTREE', 'Requête invalide', { detail: 'adresse-invalide' }, 422);
            // D6 : le mot de passe se choisit AU CLIC de confirmation. Un champ `motDePasse` à l'inscription est REFUSÉ (jamais ignoré en silence : l'utilisateur croirait avoir choisi un secret ; jamais lu, jamais haché, jamais stocké).
            // Le refus ne dépend que du corps de la requête, jamais de l'adresse : la réponse reste la même pour toutes les adresses.
            if (Object.prototype.hasOwnProperty.call(b, 'motDePasse')) return repondreErreur(res, 'ENTREE', 'Le mot de passe se choisit à la confirmation', { detail: 'mot-de-passe-non-attendu' }, 422);
            const cle = typeof b.email === 'string' && b.email.length <= 254 ? emailCle(b.email) : null;
            if (!cle) return repondreErreur(res, 'ENTREE', 'Adresse invalide', { detail: 'adresse-invalide' }, 422);
            if (estJetable(cle.split('@')[1])) return repondreErreur(res, 'ENTREE', 'Adresse refusée', { detail: 'adresse-refusee' }, 422);
            const courrier = courrierDe(); if (!courrier) return indispo(res);   // pas de compte qu'on ne saurait pas vérifier
            const d = await defi(cfg, b, req.ip);
            if (d === 'indispo') return indispo(res);
            if (d === 'refuse') return repondreErreur(res, 'ENTREE', 'Vérification anti-robot échouée', { detail: 'defi-anti-robot' }, 422);
            svc.inscrire({ email: b.email.normalize('NFKC').trim(), emailCle: cle, cfg, courrier });   // détaché : la réponse ne dépend pas de l'adresse
            return res.status(202).json({ success: true });
        } catch (e) { console.error(`❌ [v2 inscription] ${nomErreur(e)}`); return indispo(res); }
    });

    // Connexion : d'abord la limite par IP (une IP bloquée ne consomme pas le budget d'un compte tiers), puis 10 essais par heure et par
    // ADRESSE (clé = empreinte de l'emailCle, adresses inconnues comprises), AVANT toute vérification de mot de passe.
    const connexionIp = parIp('connexion-ip', cfg.limites.connexionIpHeure);
    const parCompte = L.limiteur({ nom: 'connexion', max: cfg.limites.connexionParCompteHeure, fenetreMs: HEURE, cle: q => {
        const e = adresseDuCorps(q);
        return e ? J.empreinte(e) : `invalide-${L.empreinteIp(q.ip)}`;
    } });
    router.post('/api/compte/connexion', ...site, connexionIp, exigerDefi(cfg), parCompte, async (req, res) => {
        try {
            const b = objet(req.body) ? req.body : {};
            const r = await svc.connecter({ email: b.email, motDePasse: b.motDePasse, cfg });
            if (!r.ok) return repondreErreur(res, 'IDENTIFIANTS', 'Adresse ou mot de passe incorrect');
            res.setHeader('Set-Cookie', S.cookieSession(r.session.token, cfg));
            res.setHeader('Cache-Control', 'no-store');
            return res.status(200).json({ success: true, compte: { email: r.compte.email, verifie: r.compte.verifie, creeLe: r.compte.creeLe } });
        } catch (e) { console.error(`❌ [v2 connexion] ${nomErreur(e)}`); return indispo(res); }
    });
    router.post('/api/compte/deconnexion', ...site, async (req, res) => {
        try {
            await svc.deconnecter(S.lireCookie(req));
            res.setHeader('Set-Cookie', S.cookieEffacement(cfg));
            return res.status(200).json({ success: true });
        } catch (e) { console.error(`❌ [v2 deconnexion] ${nomErreur(e)}`); return indispo(res); }
    });

    router.post('/api/compte/mot-de-passe-oublie', ...site, parIp('oubli-ip', cfg.limites.oubliIpHeure), exigerDefi(cfg, { avecCourrier: true }), async (req, res) => {
        try {
            const courrier = courrierDe(); if (!courrier) return indispo(res);
            svc.demanderReinit({ email: objet(req.body) ? req.body.email : undefined, cfg, courrier });   // détaché
            return res.status(202).json({ success: true });
        } catch (e) { console.error(`❌ [v2 mot-de-passe-oublie] ${nomErreur(e)}`); return indispo(res); }
    });
    router.post('/api/compte/renvoyer-verification', ...site, parIp('renvoi-ip', cfg.limites.verificationIpHeure), exigerDefi(cfg, { avecCourrier: true }), async (req, res) => {
        try {
            const courrier = courrierDe(); if (!courrier) return indispo(res);
            svc.renvoyerVerification({ email: objet(req.body) ? req.body.email : undefined, cfg, courrier });   // détaché, réponse identique dans tous les cas
            return res.status(202).json({ success: true });
        } catch (e) { console.error(`❌ [v2 renvoyer-verification] ${nomErreur(e)}`); return indispo(res); }
    });
    router.post('/api/compte/reinitialiser', ...site, parIp('reinit-ip', cfg.limites.reinitIpHeure), async (req, res) => {
        try {
            const b = objet(req.body) ? req.body : {};
            if (typeof b.motDePasse !== 'string') return entreeInvalide(res);
            const r = await svc.reinitialiser({ jeton: b.jeton, motDePasse: b.motDePasse, cfg });
            if (r.statut === 200) return res.status(200).json({ success: true });
            return repondreErreur(res, r.code, r.code === 'MOT_DE_PASSE_FAIBLE' ? 'Mot de passe trop faible' : r.code === 'CODE_EXPIRE' ? 'Lien expiré' : 'Lien invalide', r.detail ? { detail: r.detail } : {});
        } catch (e) { console.error(`❌ [v2 reinitialiser] ${nomErreur(e)}`); return indispo(res); }
    });

    // Écritures par SESSION : identité résolue, Origin + X-Rat-Market, puis session exigée.
    const parSession = [resoudrePorteur(cfg), S.exigerOrigineSite(cfg), exigerSession];
    router.post('/api/compte/code', ...parSession, async (req, res) => {
        try {
            const r = await liaison.creerCode(req.v2.porteur.id, cfg, undefined, Number.isInteger(req.v2.porteur.compte.generation) ? req.v2.porteur.compte.generation : null);   // la génération lue AVEC le porteur (O3 tour 2, I-A)
            if (r.refus) return repondreErreur(res, 'DEBIT', 'Trop de codes en cours, réessayez plus tard.', { reessayerDans: r.reessayerDans });
            res.setHeader('Cache-Control', 'no-store');
            return res.status(200).json({ success: true, code: r.code, expire: r.expire });
        } catch (e) { console.error(`❌ [v2 code] ${nomErreur(e)}`); return indispo(res); }
    });
    // O4 : un plafond horaire par porteur (la session), après la résolution de l'identité.
    const lecture = L.limiteur({ nom: 'compte-lecture', max: cfg.limites.compteParPorteurHeure, fenetreMs: HEURE, cle: q => (q.v2 && q.v2.porteur ? `${q.v2.porteur.type}:${q.v2.porteur.id}` : null) });
    router.get('/api/compte', resoudrePorteur(cfg), exigerSession, lecture, async (req, res) => {
        try {
            const argent = registre.obtenir('argent'), porteur = req.v2.porteur, compte = porteur.compte;
            // `suite` (curseur opaque) : absent = première page ; présent mais illisible (pas une chaîne, trop long, falsifié) = 400 ENTREE, une faute du client — jamais 503, ni la première page en silence
            const brut = req.query.suite;
            if (brut !== undefined && !(typeof brut === 'string' && brut.length > 0 && brut.length <= 200)) return repondreErreur(res, 'ENTREE', 'Requête invalide', { detail: 'suite' });
            const suite = brut;
            let tout;
            try { tout = await Promise.all([argent.solde(porteur), argent.historique(porteur, suite), svc.installationsDuCompte(compte._id)]); }
            catch (e) { if (e && e.code === 'SUITE_INVALIDE') return repondreErreur(res, 'ENTREE', 'Requête invalide', { detail: 'suite' }); throw e; }
            const [solde, hist, installations] = tout;
            res.setHeader('Cache-Control', 'no-store');
            return res.status(200).json({ success: true, compte: { email: compte.email, verifie: compte.verifie, creeLe: compte.creeLe }, solde, installations,
                historique: { lignes: hist.lignes, suite: hist.suite ?? null } });
        } catch (e) { console.error(`❌ [v2 compte] ${nomErreur(e)}`); return indispo(res); }
    });
    // La suppression a SON plafond (une session volée ne devine pas le mot de passe par ici) : il ne consomme pas le budget de connexion du titulaire.
    const parCompteSession = L.limiteur({ nom: 'suppression', max: cfg.limites.suppressionParCompteHeure, fenetreMs: HEURE, cle: q => J.empreinte(q.v2.porteur.compte.emailCle) });
    router.delete('/api/compte', ...parSession, parCompteSession, async (req, res) => {
        try {
            const b = objet(req.body) ? req.body : {};
            const r = await svc.supprimerCompte({ compte: req.v2.porteur.compte, motDePasse: b.motDePasse, renonciation: b.renonciation, cfg });
            if (r.statut !== 200) return repondreErreur(res, r.code, r.code === 'CREDITS_ACHETES' ? 'Des crédits achetés subsistent : renonciation requise' : r.code === 'CONFLIT' ? 'Un abonnement est en cours : résiliez-le avant de supprimer le compte' : r.code === 'INDISPONIBLE' ? 'Service momentanément indisponible' : 'Mot de passe incorrect', r.detail ? { detail: r.detail } : {});
            res.setHeader('Set-Cookie', S.cookieEffacement(cfg));
            return res.status(200).json({ success: true });
        } catch (e) { console.error(`❌ [v2 suppression] ${nomErreur(e)}`); return indispo(res); }
    });
    router.delete('/api/compte/installations/:id', ...parSession, async (req, res) => {
        try {
            if (!(await liaison.revoquer(req.v2.porteur.id, req.params.id))) return repondreErreur(res, 'CODE_INVALIDE', 'Introuvable');   // 404 aussi pour l'installation d'un autre : on ne révèle rien
            return res.status(200).json({ success: true });
        } catch (e) { console.error(`❌ [v2 revoquer] ${nomErreur(e)}`); return indispo(res); }
    });

    router.post('/api/compte/verification', ...site, parIp('verification-ip', cfg.limites.verificationIpHeure), async (req, res) => {
        try {
            // D6 : le lien ET le mot de passe choisi à ce moment (le compte n'a aucun secret avant).
            const b = objet(req.body) ? req.body : {};
            if (typeof b.motDePasse !== 'string') return entreeInvalide(res);
            const r = await svc.verifierAdresse({ jeton: b.jeton, motDePasse: b.motDePasse, cfg });
            if (r.statut !== 200) return repondreErreur(res, r.code, r.code === 'MOT_DE_PASSE_FAIBLE' ? 'Mot de passe trop faible' : r.code === 'CODE_EXPIRE' ? 'Lien expiré' : 'Lien invalide', r.detail ? { detail: r.detail } : {});
            return res.status(200).json({ success: true, verifie: true });
        } catch (e) { console.error(`❌ [v2 verification] ${nomErreur(e)}`); return indispo(res); }
    });
}
module.exports = { routesComptes, defi, exigerDefi, indispo, objet };
