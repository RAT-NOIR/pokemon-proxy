'use strict';
// Emplacement du lot B6. B6.3 monte POST /api/banc/correction ; B6.4 y ajoutera l'effacement par jeton et la purge.
// Le banc est fabriqué ici (stockage réel paresseux : rien n'est chargé, aucun réseau, tant qu'une écriture consentie n'a pas lieu) et fourni au registre
// SEULEMENT si personne ne l'a fourni avant (un banc de test injecte le sien). Le câblage du crochet dans /api/identifier est B6.4.
const registre = require('../registre');
const { resoudrePorteur, exigerInstallation } = require('../porteur');
const { creerBanc, traiterCorrection } = require('./routes');

module.exports = {
    enTete(app, cfg) { },
    routes(router, cfg, deps = {}) {
        const banc = deps.banc || creerBanc({ cfg });
        try { registre.obtenir('banc'); } catch { registre.fournir('banc', banc); }
        router.post('/api/banc/correction', resoudrePorteur(cfg), exigerInstallation, traiterCorrection(cfg, banc));
    }
};
