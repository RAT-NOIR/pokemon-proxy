'use strict';
const registre = require('../registre'); const L = require('../transport/limites');
const { repondreErreur } = require('../erreurs'); const S = require('./sessions'); const svc = require('./service');
const J = require('./jetons'); const P = require('./mots-de-passe'); const { emailCle, estJetable } = require('./email-cle');

const HEURE = 3600e3;
const indispo = res => repondreErreur(res, 'INDISPONIBLE', 'Service momentanément indisponible');
const objet = b => b && typeof b === 'object' && !Array.isArray(b);

/** 'ok' | 'refuse' | 'indispo'. Fail-closed : un pilote absent ou en erreur n'est jamais un « ok ». */
async function defi(cfg, corps, ip) {
    if (cfg.turnstile === 'off') return 'ok';
    let t; try { t = registre.obtenir('turnstile'); } catch { return 'indispo'; }
    if (typeof corps.turnstile !== 'string' || !corps.turnstile) return 'refuse';
    try { return (await t.verifier(corps.turnstile, ip)) === true ? 'ok' : 'refuse'; } catch (e) { console.error(`❌ [v2 turnstile] ${e.message}`); return 'indispo'; }
}

function routesComptes(router, cfg, deps) {
    const site = [deps.pret, S.exigerOrigineSite(cfg)];                 // toute écriture du site : index prêts, Origin + X-Rat-Market
    const parIp = (nom, max) => L.limiteur({ nom, max, fenetreMs: HEURE, cle: q => L.empreinteIp(q.ip) });

    router.post('/api/compte/inscription', ...site, parIp('inscription-ip', 10), async (req, res) => {
        try {
            const b = req.body;
            if (!objet(b)) return repondreErreur(res, 'ENTREE', 'Requête invalide', { detail: 'adresse-invalide' }, 422);
            const cle = typeof b.email === 'string' && b.email.length <= 254 ? emailCle(b.email) : null;
            if (!cle) return repondreErreur(res, 'ENTREE', 'Adresse invalide', { detail: 'adresse-invalide' }, 422);
            if (estJetable(cle.split('@')[1])) return repondreErreur(res, 'ENTREE', 'Adresse refusée', { detail: 'adresse-refusee' }, 422);
            const faute = P.politique(b.motDePasse, cle);
            if (faute) return repondreErreur(res, 'MOT_DE_PASSE_FAIBLE', 'Mot de passe trop faible', { detail: faute });
            let courrier; try { courrier = registre.obtenir('courrier'); } catch { return indispo(res); }   // pas de compte qu'on ne saurait pas vérifier
            const d = await defi(cfg, b, req.ip);
            if (d === 'indispo') return indispo(res);
            if (d === 'refuse') return repondreErreur(res, 'ENTREE', 'Vérification anti-robot échouée', { detail: 'defi-anti-robot' }, 422);
            await svc.inscrire({ email: b.email.normalize('NFKC').trim(), emailCle: cle, motDePasse: b.motDePasse, cfg, courrier });
            return res.status(202).json({ success: true });
        } catch (e) { console.error(`❌ [v2 inscription] ${e.message}`); return indispo(res); }
    });

    // 10 essais par heure et par ADRESSE (clé = empreinte de l'emailCle, adresses inconnues comprises), AVANT toute vérification de mot de passe.
    const parCompte = L.limiteur({ nom: 'connexion', max: cfg.limites.connexionParCompteHeure, fenetreMs: HEURE, cle: q => {
        const e = objet(q.body) && typeof q.body.email === 'string' && q.body.email.length <= 254 ? emailCle(q.body.email) : null;
        return e ? J.empreinte(e) : `invalide-${L.empreinteIp(q.ip)}`;
    } });
    router.post('/api/compte/connexion', ...site, parCompte, async (req, res) => {
        try {
            const b = objet(req.body) ? req.body : {};
            const r = await svc.connecter({ email: b.email, motDePasse: b.motDePasse, cfg });
            if (!r.ok) return repondreErreur(res, 'IDENTIFIANTS', 'Adresse ou mot de passe incorrect');
            res.setHeader('Set-Cookie', S.cookieSession(r.session.token, cfg));
            res.setHeader('Cache-Control', 'no-store');
            return res.status(200).json({ success: true, compte: { email: r.compte.email, verifie: r.compte.verifie, creeLe: r.compte.creeLe } });
        } catch (e) { console.error(`❌ [v2 connexion] ${e.message}`); return indispo(res); }
    });
    router.post('/api/compte/deconnexion', ...site, async (req, res) => {
        try {
            await svc.deconnecter(S.lireCookie(req));
            res.setHeader('Set-Cookie', S.cookieEffacement(cfg));
            return res.status(200).json({ success: true });
        } catch (e) { console.error(`❌ [v2 deconnexion] ${e.message}`); return indispo(res); }
    });

    router.post('/api/compte/mot-de-passe-oublie', ...site, parIp('oubli-ip', 10), async (req, res) => {
        try {
            let courrier; try { courrier = registre.obtenir('courrier'); } catch { return indispo(res); }
            await svc.demanderReinit({ email: objet(req.body) ? req.body.email : undefined, cfg, courrier });
            return res.status(202).json({ success: true });
        } catch (e) { console.error(`❌ [v2 mot-de-passe-oublie] ${e.message}`); return indispo(res); }
    });
    router.post('/api/compte/reinitialiser', ...site, parIp('reinit-ip', 10), async (req, res) => {
        try {
            const b = objet(req.body) ? req.body : {};
            const r = await svc.reinitialiser({ jeton: b.jeton, motDePasse: b.motDePasse });
            if (r.statut === 200) return res.status(200).json({ success: true });
            return repondreErreur(res, r.code, r.code === 'MOT_DE_PASSE_FAIBLE' ? 'Mot de passe trop faible' : r.code === 'CODE_EXPIRE' ? 'Lien expiré' : 'Lien invalide', r.detail ? { detail: r.detail } : {});
        } catch (e) { console.error(`❌ [v2 reinitialiser] ${e.message}`); return indispo(res); }
    });

    router.post('/api/compte/verification', ...site, parIp('verification-ip', 30), async (req, res) => {
        try {
            const r = await svc.verifierAdresse({ jeton: objet(req.body) ? req.body.jeton : undefined, cfg });
            if (r.statut !== 200) return repondreErreur(res, r.code, r.code === 'CODE_EXPIRE' ? 'Lien expiré' : 'Lien invalide');
            return res.status(200).json({ success: true, verifie: true });
        } catch (e) { console.error(`❌ [v2 verification] ${e.message}`); return indispo(res); }
    });
}
module.exports = { routesComptes, defi, indispo, objet };
