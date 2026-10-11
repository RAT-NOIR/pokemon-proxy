'use strict';
// COTES-VISUELS, tour 3 — aide de test-chargeur-archive : dans un processus NEUF, charge ce que le serveur charge pour le chargeur (le montage, le chargeur, le module R2 privé, le scellement, le format)
// et imprime, en JSON, TOUS les fichiers du dossier v2/chargeur (ceux que le serveur peut charger, même paresseusement) plus les deux fichiers d'identifier qui le montent et le lisent, ainsi que
// les noms exportés par r2-prive. Ne lit aucune base, n'ouvre aucun réseau.
const fs = require('fs'); const path = require('path');
require('../chargeur/montage'); require('../chargeur'); require('../chargeur/scellement'); require('../chargeur/format');
const R2 = require('../chargeur/r2-prive');
require('../identifier/visuels');
const racine = path.join(__dirname, '..');
const lister = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? lister(path.join(d, e.name)) : /\.(js|mjs)$/.test(e.name) ? [path.join(d, e.name)] : []));
const fichiers = [...lister(path.join(racine, 'chargeur')), path.join(racine, 'identifier', 'monter.js'), path.join(racine, 'identifier', 'visuels.js')].sort();
console.log(JSON.stringify({ fichiers, exportsR2: Object.keys(R2), charges: Object.keys(require.cache).filter(f => f.startsWith(racine)).length }));
