'use strict';
// Emplacement du lot COLLECTION : « Ma collection » du site (session du compte). Les routes sont dans routes.js, le stockage dans service.js.
const { routesCollection } = require('./routes');
module.exports = { enTete(app, cfg) { }, routes(router, cfg, deps) { routesCollection(router, cfg, deps); } };
