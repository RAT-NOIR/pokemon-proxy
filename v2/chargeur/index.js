'use strict';
// COTES-VISUELS — la porte du chargeur : UN chargeur par processus (le montage le démarre ; les bancs et les mesures le retrouvent par chargeurCourant()).
const chargeur = require('./chargeur');
const etat = require('./etat');
let courant = null;
function demarrerChargeur(opts = {}) { arreterChargeur(); courant = chargeur.creerChargeur(opts); courant.demarrer(); return courant; }
function arreterChargeur() { if (courant) { courant.arreter(); courant = null; } }
module.exports = { ...chargeur, etat, demarrerChargeur, arreterChargeur, chargeurCourant: () => courant };
