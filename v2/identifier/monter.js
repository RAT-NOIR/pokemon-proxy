'use strict';
// Emplacement du lot B1b. B1b.3 monte POST /api/identifier (contrat 2). B1b.5 (reponse, retour-live, solde) et B1b.7 (règle G, tâches périodiques, registre
// annonce/visuels/taux) complètent ce fichier.
const { aiguilleur } = require('../heritage');
const { resoudrePorteur, exigerInstallation } = require('../porteur');
const L = require('../transport/limites');
const { idempotente } = require('../transport/idempotence');
const { validerEntree, traiterIdentifier } = require('./routes');

module.exports = {
    enTete(app, cfg) { },
    routes(router, cfg, deps) {
        // Sans `contrat: 2` la requête sort du routeur v2 SANS qu'un octet soit lu ni écrit : la route héritée répond comme aujourd'hui.
        // L'aiguilleur EN TÊTE (registre d'A0), prédicat strictement booléen. Puis : porteur, installation exigée, limiteur par COMPTE/installation (120/h),
        // idempotence (clé obligatoire : le débit en exige une), entrée validée AVANT tout débit, traitement.
        const parPorteur = L.limiteur({ nom: 'identifier', max: cfg.limites.identifierParCompteHeure, fenetreMs: 3600e3, cle: q => (q.v2 && q.v2.porteur ? `${q.v2.porteur.type}:${q.v2.porteur.id}` : null) });
        router.post('/api/identifier',
            aiguilleur(req => Boolean(req.body && typeof req.body === 'object' && req.body.contrat === 2)),
            resoudrePorteur(cfg), exigerInstallation, parPorteur, idempotente('identifier', {}, cfg), validerEntree(cfg), traiterIdentifier(cfg, deps));
    }
};
