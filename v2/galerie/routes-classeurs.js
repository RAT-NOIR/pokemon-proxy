'use strict';
// GALERIE L9 — les routes des CLASSEURS privés de l'Atelier : GET/POST /api/classeurs, GET/PUT/DELETE /api/classeurs/{id}, POST/DELETE /api/classeurs/{id}/publication. Montées par routes.js avec SES gardes (pas des copies).
// L'ORDRE des refus d'une écriture est celui du contrat : SESSION, ORIGINE, VERIFICATION, LIMITE_DEBIT ; puis le pseudo (INTERDIT, publication seulement), puis le corps (taille, forme), puis l'écriture.
// Un classeur d'autrui, absent ou mal nommé répond le même INTROUVABLE (jamais un 403). Toutes les réponses portent `facturation: null` (aucune route ne facture).
const { repondreErreur } = require('../erreurs');
const { resoudrePorteur } = require('../porteur');
const C = require('./classeurs');
const F = require('./forme');

function routesClasseurs(router, x) {
    const { cfg, li, dispo, SESSION, ECRITURE, exigerPseudo, lim, HEURE, JOUR, compteDe, ipSalee, protege, entree, introuvable, privee, maintenant } = x;
    const ECRIT = [...ECRITURE, lim('ecriture-compte', li.ecrituresCompteHeure, HEURE, compteDe), lim('ecriture-ip', li.ecrituresIpHeure, HEURE, ipSalee)];
    // le quota de PUBLICATIONS est partagé avec celui des illustrations (« 5 par jour » par compte, classeur ou illustration : UN compteur, posé par routes.js)
    const PUBLIER = [...ECRITURE, x.limitePublications, exigerPseudo];
    const estSession = q => Boolean(q.v2 && q.v2.porteur && q.v2.porteur.type === 'compte' && q.v2.porteur.surface === 'scanner');
    // 64 Ko : la longueur DÉCLARÉE puis la longueur LUE (le corps a déjà été lu par le parseur, borné à 100 Ko par le serveur : au-delà, c'est le parseur qui refuse)
    const tropGros = req => Number(req.headers['content-length']) > C.OCTETS_MAX || Buffer.byteLength(JSON.stringify(req.body === undefined ? {} : req.body)) > C.OCTETS_MAX;
    const refuserTaille = res => repondreErreur(res, 'ENTREE', 'Corps trop volumineux (64 Ko au plus)', { detail: 'corps-trop-gros' }, 413);
    const refuserBorne = (res, borne, max) => repondreErreur(res, 'CONFLIT', borne === 'borne-classeurs' ? `Au plus ${max} classeurs par compte` : 'Au plus 50 doubles pages (100 pages) par classeur', { detail: borne });

    router.get('/api/classeurs', ...SESSION, lim('lecture-compte', li.lectureIpHeure, HEURE, compteDe), protege('classeurs-liste', async (req, res) => {
        if (Object.keys(req.query).some(k => k !== 'suite')) return entree(res, 'parametre');
        const suite = F.lireSuite(req.query.suite);
        if (suite.detail) return entree(res, suite.detail);
        const r = await C.lister({ compteId: req.v2.porteur.id, o: suite.o });
        privee(res);
        return res.status(200).json({ success: true, classeurs: r.classeurs, suite: r.suite });
    }));
    router.post('/api/classeurs', ...ECRIT, protege('classeur-creer', async (req, res) => {
        if (tropGros(req)) return refuserTaille(res);
        const l = C.lireCorps(req.body, { ecriture: false });
        if (l.borne) return refuserBorne(res, l.borne);
        if (l.detail) return entree(res, l.detail);
        const r = await C.creer({ compteId: req.v2.porteur.id, champs: l.champs, max: li.classeursMax, maintenant: maintenant() });
        if (r.borne) return refuserBorne(res, r.borne, r.max);
        if (r.detail) return entree(res, r.detail);
        privee(res);
        return res.status(201).json({ success: true, classeur: r.classeur });
    }));
    // la lecture n'exige PAS de session : l'auteur (cookie valide) lit sa copie de travail, tout autre lecteur la version publique acceptée ; un cache partagé ne mélange jamais les deux (Vary: Cookie)
    router.get('/api/classeurs/:id', dispo, resoudrePorteur(cfg), lim('lecture-ip', li.lectureIpHeure, HEURE, ipSalee), protege('classeur-lire', async (req, res) => {
        if (Object.keys(req.query).length) return entree(res, 'parametre');
        const r = await C.lire({ id: req.params.id, compteId: estSession(req) ? req.v2.porteur.id : null });
        if (r.introuvable) { privee(res); return introuvable(res); }
        res.vary('Cookie');
        // resoudrePorteur a posé req.v2, ce qui ferait forcer `no-store` à l'envoi (transport/entetes.js) : la vue PUBLIQUE ne porte aucune donnée du lecteur, elle se met en cache comme les autres lectures publiques
        if (r.auteur) privee(res); else { req.v2 = null; res.setHeader('Cache-Control', 'public, max-age=60'); }
        return res.status(200).json({ success: true, classeur: r.classeur });
    }));
    router.put('/api/classeurs/:id', ...ECRIT, protege('classeur-ecrire', async (req, res) => {
        if (tropGros(req)) return refuserTaille(res);
        const l = C.lireCorps(req.body, { ecriture: true });
        if (l.borne) return refuserBorne(res, l.borne);
        if (l.detail) return entree(res, l.detail);
        const r = await C.ecrire({ compteId: req.v2.porteur.id, id: req.params.id, champs: l.champs, version: l.version, maintenant: maintenant() });
        if (r.introuvable) return introuvable(res);
        if (r.detail) return entree(res, r.detail);
        if (r.conflit) return repondreErreur(res, 'CONFLIT', 'Le classeur a été modifié depuis votre lecture', { detail: 'version', versionActuelle: r.conflit.versionActuelle });
        privee(res);
        return res.status(200).json({ success: true, classeur: r.classeur });
    }));
    router.delete('/api/classeurs/:id', ...ECRIT, protege('classeur-supprimer', async (req, res) => {
        const r = await C.supprimer({ compteId: req.v2.porteur.id, id: req.params.id });
        if (r.introuvable) return introuvable(res);
        privee(res);
        return res.status(200).json({ success: true });
    }));
    router.post('/api/classeurs/:id/publication', ...PUBLIER, protege('classeur-publier', async (req, res) => {
        const r = await C.publier({ compteId: req.v2.porteur.id, pseudo: req.galerie.pseudo, id: req.params.id, corps: req.body, maintenant: maintenant() });
        if (r.introuvable) return introuvable(res);
        if (r.refus) return entree(res, r.refus);
        privee(res);
        return res.status(200).json({ success: true, classeur: await C.vueDe(req.v2.porteur.id, req.params.id) });
    }));
    router.delete('/api/classeurs/:id/publication', ...ECRIT, protege('classeur-depublier', async (req, res) => {
        const r = await C.depublier({ compteId: req.v2.porteur.id, id: req.params.id });
        if (r.introuvable) return introuvable(res);
        privee(res);
        return res.status(200).json({ success: true, classeur: await C.vueDe(req.v2.porteur.id, req.params.id) });
    }));
}
module.exports = { routesClasseurs };
