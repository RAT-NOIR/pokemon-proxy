'use strict';
// Le montage des abonnements, appelé par argent/monter.js (UNE ligne dans enTete, UNE dans routes). Tout est derrière V2_ABONNEMENTS (éteint par défaut) : éteint, aucune route n'existe,
// le SDK n'est jamais chargé, rien ne change pour la v1 ni pour le reste de la v2.
const { monterWebhook } = require('./webhook');
const { routesAbonnements } = require('./routes');
module.exports = {
    /** AVANT express.json() : le webhook reçoit le corps BRUT (la signature se calcule sur les octets exacts). */
    enTete(app, cfg) {
        if (!cfg.abonnements || !cfg.abonnements.actif) return;
        for (const a of cfg.abonnements.avertissements) console.error(`🔴 [v2 abonnements] ${a}`);
        monterWebhook(app, () => cfg.abonnements);
    },
    routes(router, cfg) {
        if (!cfg.abonnements || !cfg.abonnements.actif) return;
        routesAbonnements(router, cfg);
    }
};
