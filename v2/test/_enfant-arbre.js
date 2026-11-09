'use strict';
// Enfant de test-verifier-absence-parcours.js (pas un banc : le préfixe _ l'écarte) : charge pour de VRAI le v2/index.js d'un arbre DÉRIVÉ (dossier du module absent : rien n'est simulé),
// sous l'environnement qu'on lui donne. Une ligne JSON : le module a-t-il été chargé, la configuration est-elle valide, `cfg.mesure` est-elle inerte (aucune exemption possible).
// Usage : node _enfant-arbre.js <racine de l'arbre dérivé>
const path = require('path');
const racine = process.argv[2];
const express = require(require.resolve('express', { paths: [process.env.NODE_PATH || racine] }));
const v2 = require(path.join(racine, 'v2', 'index.js'));
const { lireConfig } = require(path.join(racine, 'v2', 'config.js'));
const app = express();
v2.monterEnTete(app);
v2.monter(app);
const m = lireConfig(process.env).mesure;
const charge = Object.keys(require.cache).some(k => /essai-parcours/.test(k));
console.log(JSON.stringify({ charge, valide: Object.keys(v2.ping()).length > 0, inerte: m.actif === false && typeof m.autorise === 'undefined' && typeof m.monter === 'undefined' }));
process.exit(0);
