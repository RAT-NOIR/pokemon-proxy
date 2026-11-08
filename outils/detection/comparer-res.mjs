// INVARIANCE : deux sorties de la chaine (node, Chrome, un telephone) sont-elles identiques ? Octet pour octet sur chaque etage, photo par photo.
//   node comparer-res.mjs <a.json> <b.json> [--etiquette=...]
// Etages compares (du moins au plus cher a obtenir) : voie de reduction, dimensions 640, empreinte du RGB 640 (SHA-256 de tous les octets), empreinte des quadrilateres (coordonnees telles que rendues par OpenCV),
// quadrilatere retenu (coordonnees), empreinte de la carte redressee, vecteur (256 flottants, egalite binaire) et cosinus minimal.
// Sort 0 si TOUT est identique, 1 sinon. Imprime les denominateurs : photos communes, redressees, avec vecteur.
import fs from 'node:fs';
const [fa, fb] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const A = JSON.parse(fs.readFileSync(fa, 'utf8')), B = JSON.parse(fs.readFileSync(fb, 'utf8'));
if (!A.photos || !B.photos) { console.error('une des sorties n\'a pas de photos :', A.erreur || B.erreur); process.exit(2); }
const ids = Object.keys(A.photos).filter((k) => k in B.photos).sort();
const diff = { voie: [], dim640: [], rgb640: [], quads: [], quad: [], carte: [], redressee: [], emb: [] };
let nRed = 0, nEmb = 0, cosMin = 1;
const cos = (x, y) => { let s = 0, a = 0, b = 0; for (let i = 0; i < x.length; i++) { s += x[i] * y[i]; a += x[i] * x[i]; b += y[i] * y[i]; } return s / Math.sqrt(a * b); };
for (const id of ids) {
  const a = A.photos[id], b = B.photos[id];
  if (a.voie !== b.voie) diff.voie.push(id);
  if (JSON.stringify(a.dim640) !== JSON.stringify(b.dim640)) diff.dim640.push(id);
  if (a.empreintes.rgb640 !== b.empreintes.rgb640) diff.rgb640.push(id);
  if (a.empreintes.quads !== b.empreintes.quads) diff.quads.push(id);
  if (a.redressee !== b.redressee) diff.redressee.push(id);
  if (JSON.stringify(a.quad) !== JSON.stringify(b.quad)) diff.quad.push(id);
  if (a.empreintes.carte !== b.empreintes.carte) diff.carte.push(id);
  if (a.redressee) nRed++;
  if (a.emb && b.emb) { nEmb++; if (JSON.stringify(a.emb) !== JSON.stringify(b.emb)) diff.emb.push(id); cosMin = Math.min(cosMin, cos(a.emb, b.emb)); }
}
console.log(`A : ${A.parametres && A.parametres.moteur}\nB : ${B.parametres && B.parametres.moteur}`);
console.log(`photos communes ${ids.length} (A ${Object.keys(A.photos).length}, B ${Object.keys(B.photos).length}) ; redressees ${nRed} ; avec vecteur des deux cotes ${nEmb}`);
let tout = ids.length > 0;
for (const [k, v] of Object.entries(diff)) { console.log(`  ${k.padEnd(10)} differentes : ${v.length}${v.length ? '  ex. ' + v.slice(0, 4).join(' ') : ''}`); if (v.length) tout = false; }
console.log(`  cosinus minimal des vecteurs : ${nEmb ? cosMin.toFixed(10) : '-'}`);
console.log(tout ? 'IDENTIQUES a chaque etage' : 'DIFFERENTES');
process.exit(tout ? 0 : 1);
