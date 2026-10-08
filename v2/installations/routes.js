'use strict';
const { col } = require('../db'); const registre = require('../registre'); const L = require('../transport/limites');
const { repondreErreur } = require('../erreurs'); const S = require('./service');

function montrerInstallation(router, cfg, deps) {
    const entree = (req, res, next) => {
        const b = req.body;
        if (!b || typeof b !== 'object' || Array.isArray(b) || (b.versionExtension !== undefined && (typeof b.versionExtension !== 'string' || b.versionExtension.length > 20)))
            return repondreErreur(res, 'ENTREE', 'Requête invalide');
        next();
    };
    const limite = L.limiteur({ nom: 'inst-ip', max: cfg.limites.installationParIpJour, fenetreMs: 86400e3, cle: q => L.empreinteIp(q.ip) });
    router.post('/api/installation', deps.pret, entree, limite, async (req, res) => {
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
            console.error(`❌ [v2 installation] ${e.message}`);
            return repondreErreur(res, 'INDISPONIBLE', 'Service momentanément indisponible');
        }
    });
}
module.exports = { montrerInstallation };
