'use strict';
// Emplacement du lot B4 : le transport. enTete() est appelé AVANT le cors() hérité (et avant toute route).
const cors = require('./cors');
const entetes = require('./entetes');
module.exports = {
    enTete(app, cfg) {
        app.disable('x-powered-by');                 // pas de signature du serveur sur aucune réponse
        app.use(cors.middlewareV2(cfg));             // d'abord : les en-têtes CORS figurent sur toutes les réponses, erreurs comprises
        app.use(entetes.middleware());
    },
    routes(router, cfg, deps) { }
};
