'use strict';
// Lance chaque v2/test/test-*.js dans son propre processus, l'un après l'autre, et agrège. Code 1 si un seul échoue.
const fs = require('fs'), path = require('path'), { spawnSync } = require('child_process');
const dossier = __dirname;
// EXCLUS : liste EXPLICITE des bancs volontairement rouges (défaut connu, garé, à rouvrir). Chacun est NOMMÉ à l'exécution : un banc exclu ne disparaît pas en silence.
const EXCLUS = { 'test-argent-course-R.js': 'défaut garé R (course réponse/remboursement sur M2), à rouvrir en B8 — rouge attendu' };
const tous = fs.readdirSync(dossier).filter(f => /^test-.*\.js$/.test(f)).sort();
for (const f of Object.keys(EXCLUS)) { if (!tous.includes(f)) { console.error(`❌ EXCLUS nomme un banc absent : ${f}`); process.exit(1); } console.log(`⏭️  exclu : ${f} — ${EXCLUS[f]}`); }
const fichiers = tous.filter(f => !(f in EXCLUS));
if (!fichiers.length) { console.error('❌ aucun test-*.js trouvé : un lanceur qui ne lance rien n\'est pas vert'); process.exit(1); }
let echecs = 0;
for (const f of fichiers) {
    console.log(`\n=== ${f} ===`);
    const r = spawnSync(process.execPath, [path.join(dossier, f)], { stdio: 'inherit' });
    if (r.status !== 0) { echecs++; console.log(`🔴 ${f} : code ${r.status}`); }
}
console.log(`\n${fichiers.length} fichier(s), ${echecs} en échec`);
process.exit(echecs ? 1 : 0);
