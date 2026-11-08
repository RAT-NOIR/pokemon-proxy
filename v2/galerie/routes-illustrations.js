'use strict';
// GALERIE L10 — les routes de la bibliothèque d'ILLUSTRATIONS PRIVÉES : GET /api/illustrations, PUT et DELETE /api/illustrations/{id}, POST et DELETE /api/illustrations/{id}/publication.
// Montées par routes.js avec SES gardes. Ordre des refus d'une écriture : SESSION, ORIGINE, VERIFICATION, LIMITE_DEBIT ; puis le pseudo (publication seulement), puis le corps, puis l'écriture.
// Le quota de publications (5 par jour et par compte) est UN compteur partagé avec les classeurs. Une illustration d'autrui, absente ou mal nommée : le même INTROUVABLE. `facturation: null` partout.
const { repondreErreur } = require('../erreurs');
const I = require('./illustrations');

function routesIllustrations(router, x) {
    const { li, SESSION, ECRITURE, exigerPseudo, lim, HEURE, compteDe, ipSalee, protege, entree, introuvable, indispo, privee, maintenant, limitePublications, stockage } = x;
    const ECRIT = [...ECRITURE, lim('ecriture-compte', li.ecrituresCompteHeure, HEURE, compteDe), lim('ecriture-ip', li.ecrituresIpHeure, HEURE, ipSalee)];
    const PUBLIER = [...ECRITURE, limitePublications, exigerPseudo];
    const conflitEtat = res => repondreErreur(res, 'CONFLIT', 'L\'illustration n\'est pas dans l\'état attendu', { detail: 'etat' });
    const stock = () => { try { return stockage(); } catch { return null; } };           // sans stockage, les URL se lisent null : jamais une exception sur une simple lecture

    router.get('/api/illustrations', ...SESSION, lim('lecture-compte', li.lectureIpHeure, HEURE, compteDe), protege('illustrations-liste', async (req, res) => {
        if (Object.keys(req.query).length) return entree(res, 'parametre');
        const illustrations = await I.lister({ compteId: req.v2.porteur.id, stockage: stock() });
        privee(res);
        return res.status(200).json({ success: true, illustrations, suite: null });
    }));
    router.put('/api/illustrations/:id', ...ECRIT, protege('illustration-modifier', async (req, res) => {
        const r = await I.modifier({ compteId: req.v2.porteur.id, id: req.params.id, corps: req.body, stockage: stock() });
        if (r.introuvable) return introuvable(res);
        if (r.detail) return entree(res, r.detail);
        if (r.conflit) return conflitEtat(res);
        privee(res);
        return res.status(200).json({ success: true, illustration: r.illustration });
    }));
    router.delete('/api/illustrations/:id', ...ECRIT, protege('illustration-supprimer', async (req, res) => {
        const r = await I.supprimer({ compteId: req.v2.porteur.id, id: req.params.id, stockage: stockage() });
        if (r.introuvable) return introuvable(res);
        privee(res);
        return res.status(200).json({ success: true });
    }));
    router.post('/api/illustrations/:id/publication', ...PUBLIER, protege('illustration-publier', async (req, res) => {
        const r = await I.publier({ compteId: req.v2.porteur.id, pseudo: req.galerie.pseudo, id: req.params.id, corps: req.body, stockage: stock(), reserver: x.reserverPublication, rendre: x.rendrePublication, maintenant: maintenant() });
        if (r.introuvable) return introuvable(res);
        if (r.detail) return entree(res, r.detail);
        if (r.conflit) return conflitEtat(res);
        if (r.limite !== undefined) return repondreErreur(res, 'LIMITE_DEBIT', 'Trop de requêtes, réessayez plus tard.', { reessayerDans: r.limite });
        privee(res);
        return res.status(200).json({ success: true, illustration: r.illustration });
    }));
    router.delete('/api/illustrations/:id/publication', ...ECRIT, protege('illustration-depublier', async (req, res) => {
        const r = await I.depublier({ compteId: req.v2.porteur.id, id: req.params.id, stockage: stockage(), maintenant: maintenant() });
        if (r.introuvable) return introuvable(res);
        if (r.indispo) return indispo(res, { reessayerDans: 30 });
        privee(res);
        return res.status(200).json({ success: true, illustration: r.illustration });
    }));
}
module.exports = { routesIllustrations };
