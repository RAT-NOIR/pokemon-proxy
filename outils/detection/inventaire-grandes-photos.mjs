// INVENTAIRE (lecture seule, en-tetes seulement) : combien d'images de plus de 800 px de grand cote dans les dossiers donnes ? Aucun contenu lu au-dela des 64 premiers Ko, rien n'est copie ni ecrit.
//   node inventaire-grandes-photos.mjs <dossier> [<dossier> ...]
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
const PUB = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'v2', 'banc-telephone', 'public');
const D = await import(pathToFileURL(path.join(PUB, 'decodeur.mjs')).href);
const EXT = /\.(jpe?g|png|webp|heic|heif)$/i;
function* parcourir(d, prof = 0) {
  let es; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
  for (const e of es) {
    if (e.name === 'node_modules' || e.name === '.git') continue;
    const p = path.join(d, e.name);
    if (e.isSymbolicLink()) continue;
    if (e.isDirectory()) { if (prof < 6) yield* parcourir(p, prof + 1); } else if (EXT.test(e.name)) yield p;
  }
}
for (const racine of process.argv.slice(2)) {
  let n = 0, grandes = 0, illisibles = 0, taille = 0; const formats = {}, ex = [], tailles = {};
  for (const f of parcourir(racine)) {
    n++;
    try {
      const fd = fs.openSync(f, 'r'); const b = Buffer.alloc(65536); const k = fs.readSync(fd, b, 0, 65536, 0); fs.closeSync(fd);
      const dim = D.lireDimensions(new Uint8Array(b.subarray(0, k)));
      formats[dim.format] = (formats[dim.format] || 0) + 1;
      const g = Math.max(dim.largeur, dim.hauteur);
      if (g > 800) { grandes++; if (ex.length < 3) ex.push(`${path.basename(f)} ${dim.largeur}x${dim.hauteur}`); }
      const cle = g > 4000 ? '>4000' : g > 2000 ? '2001-4000' : g > 1200 ? '1201-2000' : g > 800 ? '801-1200' : '<=800'; tailles[cle] = (tailles[cle] || 0) + 1;
    } catch { illisibles++; }
  }
  console.log(`${racine}\n   images ${n} ; formats ${JSON.stringify(formats)} ; illisibles ${illisibles} ; grand cote > 800 : ${grandes} ; classes ${JSON.stringify(tailles)} ; ex. ${ex.join(' | ')}`);
}
