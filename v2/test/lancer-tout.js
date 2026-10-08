'use strict';
// Lance chaque v2/test/test-*.js dans son propre processus, l'un après l'autre, et agrège. Code 1 si un seul échoue.
const fs = require('fs'), path = require('path'), { spawnSync } = require('child_process');

// Arguments : une garde s'écrit par ce qu'elle AUTORISE. Seul `--dossier=<chemin non vide>` existe (pour tester le lanceur lui-même),
// et ce dossier doit se trouver dans le dossier de ce fichier. Tout le reste est refusé AVANT de lancer quoi que ce soit.
const refuser = (m) => { console.error(`❌ ARRÊT : ${m} (seul argument admis : --dossier=<sous-dossier de ${__dirname}>)`); process.exit(1); };
const args = process.argv.slice(2);
let dossier = __dirname;
if (args.length > 1) refuser(`${args.length} arguments donnés`);
if (args.length === 1) {
    const m = /^--dossier=(.+)$/.exec(args[0]);
    if (!m) refuser(`argument non reconnu « ${args[0]} »`);
    dossier = path.resolve(m[1]);
    const rel = path.relative(__dirname, dossier);
    if (rel.startsWith('..') || path.isAbsolute(rel)) refuser(`dossier « ${dossier} » hors de ${__dirname}`);
}
// Exclusion EXPLICITE : bancs qui exigent une référence externe (RM_REFERENCE_IDENTIFIER) et sortent en code 1 sans elle.
// Ils se lancent à la main ; la liste est ici, nommée, jamais déduite.
const EXCLUS = ['test-identifier-inchange.js'];
for (const e of EXCLUS) if (!fs.existsSync(path.join(__dirname, e))) console.log(`⚠️ EXCLUS nomme « ${e} » qui n'existe plus : retirer l'entrée`);
const fichiers = fs.readdirSync(dossier).filter(f => /^test-.*\.js$/.test(f) && !EXCLUS.includes(f)).sort();
console.log(`exclus du lanceur : ${EXCLUS.join(', ')}`);
if (!fichiers.length) { console.error('❌ aucun test-*.js trouvé : un lanceur qui ne lance rien n\'est pas vert'); process.exit(1); }
const FORME_BILAN = /^(\d+) réussis, (\d+) échoués$/;
let echecs = 0;
for (const f of fichiers) {
    console.log(`\n=== ${f} ===`);
    const r = spawnSync(process.execPath, [path.join(dossier, f)], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    process.stdout.write(r.stdout || ''); process.stderr.write(r.stderr || '');
    // Une garde s'écrit par ce qu'elle AUTORISE : vert = code 0 ET exactement UN bilan (format de H.bilan()), qui est la dernière ligne
    // non vide de la sortie, avec N > 0 réussites et 0 échec. Un banc dont une promesse reste en suspens sort en 0 sans bilan : ROUGE.
    const lignes = String(r.stdout || '').split(/\r?\n/).map(l => l.trimEnd()).filter(l => l.trim() !== '');
    const bilans = lignes.filter(l => FORME_BILAN.test(l));
    const dernier = lignes.length ? FORME_BILAN.exec(lignes[lignes.length - 1]) : null;
    let motif = null;
    if (r.status !== 0) motif = `code ${r.status}${r.signal ? `, signal ${r.signal}` : ''}${r.error ? `, erreur ${r.error.code || r.error.message}` : ''}`;
    else if (!bilans.length) motif = 'code 0 mais AUCUN bilan imprimé (banc sorti sans avoir tout joué ? promesse en suspens ?)';
    else if (bilans.length > 1) motif = `code 0 mais ${bilans.length} bilans imprimés (il doit y en avoir exactement un)`;
    else if (!dernier) motif = 'code 0 mais le bilan n\'est pas la dernière ligne non vide de la sortie';
    else if (Number(dernier[1]) === 0) motif = 'bilan à 0 réussite (aucune assertion n\'a réussi)';
    else if (Number(dernier[2]) !== 0) motif = `code 0 mais bilan avec ${dernier[2]} échec(s)`;
    if (motif) { echecs++; console.log(`🔴 ${f} : ${motif}`); }
}
console.log(`\n${fichiers.length} fichier(s), ${echecs} en échec`);
process.exit(echecs ? 1 : 0);
