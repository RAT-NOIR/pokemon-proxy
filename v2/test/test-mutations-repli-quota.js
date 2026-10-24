'use strict';
// Le jeu de mutations de REPLI-QUOTA (v2/mesures/mutations-repli-quota.js) ne doit pas pourrir : chaque ancre existe EXACTEMENT UNE fois dans le code actuel, chaque banc nommé existe.
// (Le jeu lui-même ne tourne jamais ici : lancer-tout.js ne lit que v2/test, et un mutant relance un banc entier.)
const fs = require('fs'), path = require('path');
const { v, vrai, bilan } = require('./_harnais');
const { MUTANTS, ancresCassees } = require('../mesures/mutations-repli-quota');
v('chaque ancre du jeu de mutations existe exactement une fois dans le code actuel', ancresCassees(), []);
v('chaque banc nommé par le jeu existe', [...new Set(MUTANTS.map(m => m[4]))].filter(b => !fs.existsSync(path.join(__dirname, b))), []);
vrai('le jeu porte au moins 12 mutants, chacun avec un nom unique', MUTANTS.length >= 12 && new Set(MUTANTS.map(m => m[0])).size === MUTANTS.length);
vrai('un équivalent déclaré dit sa raison', MUTANTS.every(m => m[5] === undefined || (typeof m[5] === 'string' && m[5].length > 20)));
bilan();
