'use strict';
// Compare deux fichiers d'empreintes (30 x 256 float32, écrits par pilote-memoire.js --vecs=) OCTET PAR OCTET. Sortie 0 si identiques au bit près, 1 sinon (avec le premier écart).
//   node outils\banc-telephone\comparer-empreintes.js a.bin b.bin [--attendu=30]
const fs = require('fs');
const [a, b] = process.argv.slice(2).filter(x => !x.startsWith('--'));
const attendu = Number((process.argv.find(x => x.startsWith('--attendu=')) || '--attendu=30').slice(10));
if (!a || !b) { console.log('usage : comparer-empreintes.js a.bin b.bin'); process.exit(2); }
const A = fs.readFileSync(a), B = fs.readFileSync(b);
const octets = attendu * 256 * 4;
if (A.length !== octets || B.length !== octets) { console.log(`TAILLE INATTENDUE : ${A.length} / ${B.length} octets, ${octets} attendus (${attendu} x 256 float32)`); process.exit(1); }
let diff = 0, premier = -1;
for (let i = 0; i < octets; i++) if (A[i] !== B[i]) { diff++; if (premier < 0) premier = i; }
if (!diff) { console.log(`IDENTIQUES AU BIT PRÈS : ${attendu} empreintes, ${octets} octets comparés, 0 différent`); process.exit(0); }
console.log(`DIFFÉRENTES : ${diff} octets sur ${octets} ; premier écart à l'octet ${premier} (empreinte ${Math.floor(premier / 1024)}, composante ${Math.floor((premier % 1024) / 4)})`);
process.exit(1);
