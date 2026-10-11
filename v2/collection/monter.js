'use strict';
// Emplacement du lot COLLECTION : « Ma collection » du site (session du compte). Les routes sont dans routes.js, le stockage dans service.js.
// Au MONTAGE, le compteur global d'OCTETS est recompté depuis `collStats` des deux collections (service.js) ; un échec (base pas prête) se rejoue à la première écriture.
const { routesCollection } = require('./routes');
const service = require('./service');
module.exports = {
    enTete(app, cfg) { },
    routes(router, cfg, deps) {
        routesCollection(router, cfg, deps);
        service.initialiser(cfg).catch(e => console.error(`❌ [v2 collection] recompte du compteur global à rejouer à la première écriture (${(e && (e.code || e.name)) || 'erreur'})`));
    }
};
