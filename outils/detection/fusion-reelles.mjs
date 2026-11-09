// Apres le relevement du plafond des JPEG progressifs : rejoue SEULEMENT les photos refusees TROP_GRAND dont la taille tient dans les bornes de photo (<= 16 Mpx, 4 608 px), puis FUSIONNE les resultats dans les sorties completes.
//   node fusion-reelles.mjs manifeste <manifeste.json> <chrome-ancien.json> <meta.json> <sortie-manifeste.json>
//   node fusion-reelles.mjs fusion <chrome-ancien.json> <node-ancien.json> <chrome-sous.json> <node-sous.json> <chrome-final.json> <node-final.json>
import fs from 'node:fs';
const [mode, ...a] = process.argv.slice(2);
const lire = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
if (mode === 'manifeste') {
  const [fMan, fChrome, fMeta, fOut] = a, man = lire(fMan), C = lire(fChrome), M = lire(fMeta), sous = {};
  for (const [id, p] of Object.entries(C.photos)) { const m = M[id]; if (p.erreur === 'TROP_GRAND' && m.w * m.h <= 16000000 && Math.max(m.w, m.h) <= 4608) sous[id] = man[id]; }
  fs.writeFileSync(fOut, JSON.stringify(sous)); console.log('a rejouer', Object.keys(sous).length, 'photos (refusees TROP_GRAND mais dans les bornes de photo)');
} else if (mode === 'fusion') {
  const [fC, fN, fCs, fNs, fCo, fNo] = a, C = lire(fC), N = lire(fN), Cs = lire(fCs), Ns = lire(fNs);
  for (const id of Object.keys(Cs.photos)) { C.photos[id] = Cs.photos[id]; C.B[id] = Cs.B[id]; N.photos[id] = Ns.photos[id]; }
  fs.writeFileSync(fCo, JSON.stringify(C)); fs.writeFileSync(fNo, JSON.stringify(N)); console.log('fusionnees', Object.keys(Cs.photos).length);
}
