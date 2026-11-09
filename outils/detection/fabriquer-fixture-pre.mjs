// Etape 1 de la fixture doree de la PRE-REDUCTION : ecrit les sources synthetiques (sourceSynthetique) en octets RGB bruts et la liste des cas { graine, w, h, W, H }.
//   node fabriquer-fixture-pre.mjs <dossier-sources>      puis      python -I fixture-pre-pillow.py <dossier-sources> v2/test/fixtures-detection/pre-pillow.json
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
const PUB = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'v2', 'banc-telephone', 'public');
const D = await import(pathToFileURL(path.join(PUB, 'detection.mjs')).href);
const sortie = process.argv[2]; fs.mkdirSync(sortie, { recursive: true });
// pas de portrait de rapport h/w >= 2 : Pillow y inverse l'ordre des passes (ecart d'un niveau, mesure dans RAPPORT-DECODEUR) ; notre ordre est fixe
const TAILLES = [[900, 675], [1000, 750], [1280, 960], [801, 600], [1234, 987], [1200, 800], [1600, 1200], [2000, 1500], [1500, 2000], [2268, 4032], [3024, 2268], [3000, 1000], [4032, 3024], [4080, 3072], [3024, 4032]];
const cas = [];
let n = 0;
for (const [w, h] of TAILLES) {
  const d = D.dimensionsPre(w, h), graine = 5000 + (++n);
  fs.writeFileSync(path.join(sortie, `${graine}.rgb`), D.sourceSynthetique(graine, w, h));
  cas.push({ graine, w, h, W: d.W, H: d.H });
}
fs.writeFileSync(path.join(sortie, 'cas.json'), JSON.stringify(cas));
console.log(cas.length, 'cas ecrits');
