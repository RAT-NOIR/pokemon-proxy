'use strict';
// SAUVEGARDES : montage. AUCUNE route. Éteint sauf configuration complète (V2_SAUVEGARDE_*, voir config.js) : sans variable, aucun effet et aucune ligne ; avec une configuration incomplète ou refusée,
// une ligne NOMME les variables fautives (jamais une valeur) et rien ne démarre. Même mécanisme sur l'essai et en production : aucun code conditionné à « essai ».
const { lireConfigSauvegardes } = require('./config');
const Plan = require('./planificateur');

let etatCourant = 'eteint';
module.exports = {
    etat: () => etatCourant,
    enTete(app, cfg) { },
    routes(router, cfg, deps = {}) {
        const env = deps.env || process.env;
        const r = lireConfigSauvegardes(env);
        if (!r.ok) {
            etatCourant = r.vide ? 'eteint' : 'refuse';
            if (!r.vide) console.error(`🔴 [v2 sauvegardes] non démarrées : ${r.raison}`);
            return;
        }
        const c = r.c;
        const stockage = deps.stockageSauvegardes || require('./stockage-r2').creerStockageR2(c);
        const mongoose = deps.mongoose || require('mongoose');
        const commit = /^[0-9a-f]{7,40}$/i.test(String(env.RENDER_GIT_COMMIT || '')) ? String(env.RENDER_GIT_COMMIT).slice(0, 12).toLowerCase() : null;
        const tour = () => Plan.tourSauvegarde({ cfg: c, db: mongoose.connection && mongoose.connection.db, stockage, commit, etatMongo: () => (mongoose.connection ? mongoose.connection.readyState : 0) });
        Plan.demarrer({ tour, ...(deps.minuteurs ? { minuteurs: deps.minuteurs } : {}) });
        etatCourant = 'actif';
        console.log('🛟 [v2 sauvegardes] export quotidien chiffré armé (première passe différée)');
    },
    arreter() { Plan.arreter(); etatCourant = 'eteint'; }
};
