'use strict';
// Le jeu de mutations de LOT-SANS-PRIX (v2/mesures/mutations-lot-sans-prix.js) ne doit pas pourrir : chaque ancre existe EXACTEMENT UNE fois dans le code actuel, chaque banc nommé existe.
// (Le jeu lui-même ne tourne jamais ici : lancer-tout.js ne lit que v2/test, et un mutant relance un banc entier.)
const fs = require('fs'), path = require('path');
const { v, vrai, bilan } = require('./_harnais');
const { MUTANTS, ancresCassees } = require('../mesures/mutations-lot-sans-prix');
v('chaque ancre du jeu de mutations existe exactement une fois dans le code actuel', ancresCassees(), []);
v('chaque banc nommé par le jeu existe', [...new Set(MUTANTS.map(m => m[4]))].filter(b => !fs.existsSync(path.join(__dirname, b))), []);
vrai('le jeu porte au moins 12 mutants, chacun avec un nom unique', MUTANTS.length >= 12 && new Set(MUTANTS.map(m => m[0])).size === MUTANTS.length);
v('le jeu ne déclare AUCUN équivalent (chaque mutant doit être tué par un banc)', MUTANTS.filter(m => m[5] !== undefined).map(m => m[0]), []);
bilan();
