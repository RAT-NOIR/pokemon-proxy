'use strict';
// Enfant de test-essai-parcours.js (pas un banc : le préfixe _ l'écarte) : le démarrage RÉEL de v2/index.js, qui lit `process.env` par défaut (index.js:20,23,29).
// Il imprime UNE ligne JSON : le module essai-parcours a-t-il été chargé, la configuration est-elle valide (/ping rend des capacités seulement si `cfg` est posé).
// ENFANT_SANS_MODULE=1 : le chargement du module échoue comme si le dossier v2/essai-parcours/ n'existait pas (le commit de production à la bascule).
const Module = require('module');
if (process.env.ENFANT_SANS_MODULE === '1') {
    const charger = Module._load;
    Module._load = function (demande, ...reste) {
        if (/essai-parcours/.test(String(demande))) { const e = new Error(`Cannot find module '${demande}'`); e.code = 'MODULE_NOT_FOUND'; throw e; }
        return charger.call(this, demande, ...reste);
    };
}
const express = require('express');
const v2 = require('../index');
const app = express();
v2.monterEnTete(app);
v2.monter(app);
const charge = Object.keys(require.cache).some(k => /[\\/]v2[\\/]essai-parcours[\\/]index\.js$/.test(k));
console.log(JSON.stringify({ charge, valide: Object.keys(v2.ping()).length > 0 }));
process.exit(0);
