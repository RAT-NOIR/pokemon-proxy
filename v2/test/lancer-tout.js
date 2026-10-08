'use strict';
// Lance chaque v2/test/test-*.js dans son propre processus, l'un après l'autre, et agrège. Code 1 si un seul échoue.
const fs = require('fs'), path = require('path'), { spawnSync } = require('child_process');
const dossier = __dirname;
const fichiers = fs.readdirSync(dossier).filter(f => /^test-.*\.js$/.test(f)).sort();
if (!fichiers.length) { console.error('❌ aucun test-*.js trouvé : un lanceur qui ne lance rien n\'est pas vert'); process.exit(1); }
let echecs = 0;
for (const f of fichiers) {
    console.log(`\n=== ${f} ===`);
    const r = spawnSync(process.execPath, [path.join(dossier, f)], { stdio: 'inherit' });
    if (r.status !== 0) { echecs++; console.log(`🔴 ${f} : code ${r.status}`); }
}
console.log(`\n${fichiers.length} fichier(s), ${echecs} en échec`);
process.exit(echecs ? 1 : 0);
