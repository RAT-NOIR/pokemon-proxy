'use strict';
// La liste des chemins HÉRITÉS (v2/heritage.js) doit contenir CHAQUE route que index.js déclare : sinon une route v2 pourrait
// recouvrir une route héritée sans aiguilleur. Le banc lit index.js (le MÊME fichier que la production) et compare dans les deux sens.
const fs = require('fs'), path = require('path');
const H = require('./_harnais');
const { CHEMINS_HERITES } = require('../heritage');
const src = fs.readFileSync(path.join(__dirname, '..', '..', 'index.js'), 'utf8');
const trouves = new Set();
for (const m of src.matchAll(/^app\.(?:get|post|put|delete|patch|all)\(\s*'([^']+)'/gm)) trouves.add(m[1]);
H.vrai(`index.js déclare des routes (dénominateur : ${trouves.size})`, trouves.size >= 8);
for (const c of trouves) H.vrai(`route héritée ${c} figure dans CHEMINS_HERITES`, CHEMINS_HERITES.includes(c));
for (const c of CHEMINS_HERITES) H.vrai(`CHEMINS_HERITES ${c} existe encore dans index.js`, trouves.has(c));
H.vrai('la liste est gelée', Object.isFrozen(CHEMINS_HERITES));
H.bilan();
