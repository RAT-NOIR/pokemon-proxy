'use strict';
// LIEN-ORDINATEUR : montage. Drapeau V2_LIEN_ORDINATEUR=1 (config.js::lienOrdinateur.actif) ; éteint, AUCUNE route n'est posée (404 natif) et le profil CORS du site ne nomme pas ce chemin (transport/cors.js).
module.exports = {
    enTete(app, cfg) { },
    routes(router, cfg, deps) {
        if (!cfg.lienOrdinateur || cfg.lienOrdinateur.actif !== true) return;
        require('./routes').routesLien(router, cfg);
    }
};
