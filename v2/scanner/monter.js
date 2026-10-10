'use strict';
// Emplacement du lot B9 : le scanner du site (B9.2). Le multipart est B9.1 (multipart.js) ; les routes sont dans routes.js.
const { routesScanner } = require('./routes');
module.exports = { enTete(app, cfg) { }, routes(router, cfg, deps) { routesScanner(router, cfg, deps); } };
