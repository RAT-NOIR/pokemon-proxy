'use strict';
// Emplacement du lot B4 : le transport. enTete() est appelé AVANT le cors() hérité (et avant toute route).
const cors = require('./cors');
module.exports = {
    enTete(app, cfg) {
        app.use(cors.middlewareV2(cfg));
    },
    routes(router, cfg, deps) { }
};
