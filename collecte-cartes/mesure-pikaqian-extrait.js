// Lecture locale : extrait autour de la n-ieme occurrence d'un motif. Usage : node mesure-pikaqian-extrait.js <fichier> <motif-texte> <avant> <apres> [n=1]
'use strict';
const fs = require('fs');
const [f, m, a, b, n] = process.argv.slice(2);
const t = fs.readFileSync(f, 'utf8');
let i = -1;
for (let k = 0; k < (Number(n) || 1); k++) { i = t.indexOf(m, i + 1); if (i < 0) break; }
console.log(i < 0 ? 'ABSENT' : t.slice(Math.max(0, i - Number(a)), i + Number(b)));
console.log('--- occurrences totales :', t.split(m).length - 1);
