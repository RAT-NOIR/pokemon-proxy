'use strict';
// Emplacement du lot B3 — réécrit par son lot, et par lui seul.
const paiement = require('./paiement');
module.exports = {
    enTete(app, cfg) { },
    routes(router, cfg, deps) {
        router.post('/api/creer-recharge', paiement.creerRecharge);
    }
};
