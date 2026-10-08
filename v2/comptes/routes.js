'use strict';
const registre = require('../registre'); const L = require('../transport/limites');
const { repondreErreur } = require('../erreurs'); const S = require('./sessions'); const svc = require('./service');
const P = require('./mots-de-passe'); const { emailCle, estJetable } = require('./email-cle');

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
}
module.exports = { routesComptes, defi, indispo, objet };
