'use strict';
// Lance chaque v2/test/test-*.js dans son propre processus, l'un après l'autre, et agrège. Code 1 si un seul échoue.
const fs = require('fs'), path = require('path'), { spawnSync } = require('child_process');
const arg = process.argv.find(a => a.startsWith('--dossier='));
const dossier = arg ? path.resolve(arg.slice('--dossier='.length)) : __dirname;   // --dossier : pour le banc du lanceur lui-même
// Exclusion EXPLICITE : bancs qui exigent une référence externe (RM_REFERENCE_IDENTIFIER) et sortent en code 1 sans elle.
// Ils se lancent à la main ; la liste est ici, nommée, jamais déduite.
const EXCLUS = ['test-identifier-inchange.js'];
const fichiers = fs.readdirSync(dossier).filter(f => /^test-.*\.js$/.test(f) && !EXCLUS.includes(f)).sort();
console.log(`exclus du lanceur : ${EXCLUS.join(', ')}`);
if (!fichiers.length) { console.error('❌ aucun test-*.js trouvé : un lanceur qui ne lance rien n\'est pas vert'); process.exit(1); }
let echecs = 0;
for (const f of fichiers) {
    console.log(`\n=== ${f} ===`);
    const r = spawnSync(process.execPath, [path.join(dossier, f)], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    process.stdout.write(r.stdout || ''); process.stderr.write(r.stderr || '');
    // Une garde s'écrit par ce qu'elle AUTORISE : vert = code 0 ET dernière ligne de bilan (format de H.bilan()) « N réussis, 0 échoués »
    // avec N > 0. Un banc dont une promesse reste en suspens sort en 0 sans bilan : il est ROUGE, pas vert.
    const bilans = [...String(r.stdout || '').matchAll(/^(\d+) réussis, (\d+) échoués\s*$/gm)];
    const dernier = bilans.length ? bilans[bilans.length - 1] : null;
    let motif = null;
    if (r.status !== 0) motif = `code ${r.status}`;
    else if (!dernier) motif = 'code 0 mais AUCUN bilan imprimé (banc sorti sans avoir tout joué ? promesse en suspens ?)';
    else if (Number(dernier[1]) === 0) motif = 'bilan à 0 réussite (aucune assertion n\'a réussi)';
    else if (Number(dernier[2]) !== 0) motif = `code 0 mais bilan avec ${dernier[2]} échec(s)`;
    if (motif) { echecs++; console.log(`🔴 ${f} : ${motif}`); }
}
console.log(`\n${fichiers.length} fichier(s), ${echecs} en échec`);
process.exit(echecs ? 1 : 0);
