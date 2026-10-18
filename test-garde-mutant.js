// Mutant : la garde est neutralisée dans une copie temporaire ; le banc DOIT échouer dessus, sinon il ne garde rien.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const src = fs.readFileSync(path.join(__dirname, 'collecte-cartes', 'garde-ecriture.js'), 'utf8');
const marque = 'if (!dedans) throw';
if (!src.includes(marque)) { console.log('ECHEC : marque de mutation absente'); process.exit(1); }
const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'garde-mutant-'));
const mutant = path.join(dossier, 'garde-ecriture.js');
fs.writeFileSync(mutant, src.replace(marque, 'if (false) throw'));
const r = spawnSync(process.execPath, [path.join(__dirname, 'test-garde-ecriture.js')], { env: { ...process.env, GARDE_MODULE: mutant }, encoding: 'utf8' });
fs.rmSync(dossier, { recursive: true, force: true });
const tue = r.status !== 0;
console.log(tue ? 'mutant tué (le banc échoue sans la garde) : OK' : 'ECHEC : le banc passe malgré la garde retirée');
process.exit(tue ? 0 : 1);
