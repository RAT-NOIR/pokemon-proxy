'use strict';
// Montage du lot B2 (installations). Les en-têtes CORS sont ceux du lot transport (B4) ; ici, seulement les routes.
const { montrerInstallation } = require('./routes');
module.exports = { enTete(app, cfg) { }, routes(router, cfg, deps) { montrerInstallation(router, cfg, deps); } };
