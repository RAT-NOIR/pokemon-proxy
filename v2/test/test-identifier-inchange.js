'use strict';
// Banc permanent : /api/identifier rend les MÊMES réponses qu'avant l'extraction de gererIdentifier.
// Il exige une référence (RM_REFERENCE_IDENTIFIER) écrite par capturer-identifier.js --ecrire AVANT le changement.
// Sans référence : un banc non joué n'est pas vert (CLAUDE.md §70) -> code 1.
const { spawnSync } = require('child_process'), path = require('path');
const ref = process.env.RM_REFERENCE_IDENTIFIER;
if (!ref) { console.log('⚠️ pas de référence : banc non joué'); process.exit(1); }
const r = spawnSync(process.execPath, [path.join(__dirname, 'capturer-identifier.js'), `--contre=${ref}`], { stdio: 'inherit' });
process.exit(r.status === 0 ? 0 : 1);
