'use strict';
// FUITE-INLIERS — les MUTANTS : un `.delete()` retiré de departage-image.js (inliers ou decrire) doit faire ÉCHOUER le banc v2/test/test-fuite-inliers.js. Un mutant qui survit = un `.delete()` que rien ne garde.
//   node v2/mesures/muter-fuite-inliers.js
// Chaque mutant est une COPIE de departage-image.js (fichier temporaire à la racine, supprimé ensuite) : le source du dépôt n'est jamais touché. Hors suite (lancer-tout ne l'exécute pas : pas de test-*).
const fs = require('fs'), path = require('path'), { spawnSync } = require('child_process');
const racine = path.join(__dirname, '..', '..');
const source = fs.readFileSync(path.join(racine, 'departage-image.js'), 'utf8');
const MUTANTS = [
    ['inliers : le DMatchVector rendu par mm.get(i) n\'est plus libéré (la fuite d\'origine)', '} finally { liberer(m); }', '} finally { }'],
    ['inliers : mm (DMatchVectorVector) retiré de la libération finale', 'liberer(H, masque, md, ms, mm, bf, A, B);', 'liberer(H, masque, md, ms, bf, A, B);'],
    ['inliers : bf (BFMatcher) retiré de la libération finale', 'liberer(H, masque, md, ms, mm, bf, A, B);', 'liberer(H, masque, md, ms, mm, A, B);'],
    ['inliers : A et B (descripteurs) retirés de la libération finale', 'liberer(H, masque, md, ms, mm, bf, A, B);', 'liberer(H, masque, md, ms, mm, bf);'],
    ['inliers : ms et md (points du RANSAC) retirés de la libération finale', 'liberer(H, masque, md, ms, mm, bf, A, B);', 'liberer(H, masque, mm, bf, A, B);'],
    ['inliers : H et masque (RANSAC) retirés de la libération finale', 'liberer(H, masque, md, ms, mm, bf, A, B);', 'liberer(md, ms, mm, bf, A, B);'],
    ['decrire : le masque vide de detectAndCompute n\'est plus libéré', '[kp, des, m, orb, masque]', '[kp, des, m, orb]'],
    ['decrire : les points clés (KeyPointVector) ne sont plus libérés', '[kp, des, m, orb, masque]', '[des, m, orb, masque]'],
    ['decrire : la matrice des descripteurs n\'est plus libérée', '[kp, des, m, orb, masque]', '[kp, m, orb, masque]'],
    ['decrire : l\'image (Mat) n\'est plus libérée', '[kp, des, m, orb, masque]', '[kp, des, orb, masque]'],
    ['decrire : l\'ORB n\'est plus libéré', '[kp, des, m, orb, masque]', '[kp, des, m, masque]']
];
const tmp = path.join(racine, 'departage-image-MUTANT.tmp.js');
let survivants = 0;
try {
    for (const [nom, de, vers] of MUTANTS) {
        const n = source.split(de).length - 1;
        if (n !== 1) { console.log(`🔴 mutant non applicable (${n} occurrences de « ${de} ») : ${nom}`); survivants++; continue; }
        fs.writeFileSync(tmp, source.replace(de, () => vers));
        const r = spawnSync(process.execPath, [path.join(racine, 'v2', 'test', 'test-fuite-inliers.js')], { env: { ...process.env, FUITE_INLIERS_MODULE: '../../departage-image-MUTANT.tmp.js' }, encoding: 'utf8' });
        const tue = r.status !== 0 && /❌ 3\./.test(r.stdout || '');          // tué PAR le compte des objets vivants, pas par un plantage sans rapport
        console.log(`${tue ? '✅ tué' : '🔴 SURVIT'} : ${nom}`);
        if (!tue) survivants++;
    }
} finally { try { fs.unlinkSync(tmp); } catch { /* absent */ } }
console.log(`${MUTANTS.length - survivants}/${MUTANTS.length} mutants tués`);
process.exit(survivants ? 1 : 0);
