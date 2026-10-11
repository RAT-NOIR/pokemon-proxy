'use strict';
// COTES-VISUELS — la porte du chargeur (un seul `require` pour le montage, les mesures et les bancs).
module.exports = { ...require('./chargeur'), etat: require('./etat') };
