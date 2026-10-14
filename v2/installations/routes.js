'use strict';
const { col } = require('../db'); const registre = require('../registre'); const L = require('../transport/limites');
const { repondreErreur } = require('../erreurs'); const S = require('./service'); const liaison = require('./liaison');
const { resoudrePorteur, exigerInstallation } = require('../porteur');

function montrerInstallation(router, cfg, deps) {
    const entree = (req, res, next) => {
        const b = req.body;
        if (!b || typeof b !== 'object' || Array.isArray(b) || (b.versionExtension !== undefined && (typeof b.versionExtension !== 'string' || b.versionExtension.length > 20)))
            return repondreErreur(res, 'ENTREE', 'Requête invalide');
        next();
    };
    const limite = L.limiteur({ nom: 'inst-ip', max: cfg.limites.installationParIpJour, fenetreMs: 86400e3, cle: q => L.empreinteIp(q.ip) });
    router.post('/api/installation', entree, limite, async (req, res) => {
        try {
            const argent = registre.obtenir('argent');     // avant toute écriture : jamais d'installation sans de quoi dire son solde
            const { installation, jeton } = await S.creerInstallation({ libelle: req.body.libelle, cfg });
            const h = req.body.userIdHerite;
            if (typeof h === 'string' && h.length > 0 && h.length <= 80) await argent.reprendreHeritage({ userId: h, installation });
            const rechargee = await col('installations').findOne({ _id: installation._id });
            const solde = await argent.solde({ type: 'installation', id: rechargee._id, compte: null, installation: rechargee, surface: 'extension', administrateur: false });
            res.setHeader('Cache-Control', 'no-store');
            return res.status(201).json({ success: true, installationId: installation._id, jetonInstallation: jeton, solde });
        } catch (e) {
            console.error(`❌ [v2 installation] ${(e && e.name) || 'Error'}`);   // jamais e.message : il peut venir de B3 (héritage) et contenir le userId
            return repondreErreur(res, 'INDISPONIBLE', 'Service momentanément indisponible');
        }
    });
}
/** Routes de l'extension (Bearer) : lier / délier. */
function routesLiaison(router, cfg, deps) {
    const base = [resoudrePorteur(cfg), exigerInstallation];
    // chaque TENTATIVE compte, bonne ou fausse : la 6e d'une installation (la 21e d'une IP) dans l'heure est refusée même avec le bon code
    const parInstallation = L.limiteur({ nom: 'lier-inst', max: cfg.limites.codeEssaisInstallationHeure, fenetreMs: 3600e3, cle: q => q.v2.porteur.installation._id });
    const parIp = L.limiteur({ nom: 'lier-ip', max: cfg.limites.codeEssaisIpHeure, fenetreMs: 3600e3, cle: q => L.empreinteIp(q.ip) });
    const argentDe = res => { try { return registre.obtenir('argent'); } catch { repondreErreur(res, 'INDISPONIBLE', 'Service momentanément indisponible'); return null; } };
    const nom = { CODE_INVALIDE: 'Code invalide', CODE_EXPIRE: 'Code expiré', DEJA_LIE: 'Cette installation est déjà liée à un compte', INDISPONIBLE: 'Service momentanément indisponible' };

    router.post('/api/compte/lier', ...base, parInstallation, parIp, async (req, res) => {
        try {
            const argent = argentDe(res); if (!argent) return;
            const inst = req.v2.porteur.installation;
            const r = await liaison.lier({ installation: inst, code: req.body && req.body.code, argent });
            if (!r.ok) return repondreErreur(res, r.code, nom[r.code]);
            const apres = await col('installations').findOne({ _id: inst._id });
            const porteurLie = { type: 'compte', id: r.compte._id, compte: r.compte, installation: apres, surface: 'extension', administrateur: r.compte.role === 'administrateur' };
            const solde = await argent.solde(porteurLie), offre = await argent.offre(porteurLie);      // OFFRE-QUOTA : l'offre du COMPTE lié (gratuit, ou pro), relue en base
            res.setHeader('Cache-Control', 'no-store');
            return res.status(200).json({ success: true, compte: { emailMasque: r.emailMasque, verifie: r.compte.verifie, administrateur: Boolean(solde && solde.compte && solde.compte.administrateur === true) }, jetonInstallation: r.jeton, solde, offre });
        } catch (e) { console.error(`❌ [v2 lier] ${(e && e.name) || 'Error'}`); return repondreErreur(res, 'INDISPONIBLE', 'Service momentanément indisponible'); }
    });
    router.post('/api/compte/delier', ...base, async (req, res) => {
        try {
            const argent = argentDe(res); if (!argent) return;
            const inst = req.v2.porteur.installation;
            await liaison.delier(inst);
            const apres = await col('installations').findOne({ _id: inst._id });
            const porteurSeul = { type: 'installation', id: apres._id, compte: null, installation: apres, surface: 'extension', administrateur: false };
            const solde = await argent.solde(porteurSeul), offre = await argent.offre(porteurSeul);      // OFFRE-QUOTA : déliée, l'installation redevient « sans-compte »
            res.setHeader('Cache-Control', 'no-store');
            return res.status(200).json({ success: true, solde, offre });
        } catch (e) { console.error(`❌ [v2 delier] ${(e && e.name) || 'Error'}`); return repondreErreur(res, 'INDISPONIBLE', 'Service momentanément indisponible'); }
    });
}
module.exports = { montrerInstallation, routesLiaison };
