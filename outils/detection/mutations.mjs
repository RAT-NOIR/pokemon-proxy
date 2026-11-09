// MUTATIONS de detection.mjs : une ligne changee a la fois, le banc v2/test/test-detection.js rejoue contre la copie (RM_DETECTION_PUB). Chaque mutation doit le mettre ROUGE.
//   node mutations.mjs <dossier-de-travail>      (le dossier est cree et REUTILISE : aucune suppression ; il recoit une copie des modules, d'OpenCV et du lot)
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const ICI = path.dirname(fileURLToPath(import.meta.url));
const RACINE = path.join(ICI, '..', '..');
const PUB = path.join(RACINE, 'v2', 'banc-telephone', 'public');
const W = process.argv[2];
fs.mkdirSync(path.join(W, 'opencv'), { recursive: true });
for (const f of fs.readdirSync(PUB)) if (/^decodeur.*\.mjs$|^lot-detection\.json$|^empreinte\.js$/.test(f)) fs.copyFileSync(path.join(PUB, f), path.join(W, f));
for (const f of ['opencv.js', 'opencv_js.wasm']) fs.copyFileSync(path.join(PUB, 'opencv', f), path.join(W, 'opencv', f));
const source = fs.readFileSync(path.join(PUB, 'detection.mjs'), 'utf8');
const MUT = [
  ['fma32 sans la parade du double arrondi', 'if ((BAS[0] & 0x1fffffff) !== 0x10000000) return f32(s);', 'return f32(s);'],
  ['coordonnees d\'echantillonnage en double (inverse non arrondi en float32)', 'const inv = f32(1 / f32(dst / src));', 'const inv = src / dst;'],
  ['un des quatre cumuls non fusionne', 'acc = fma32(w10, LUT[rgb[b + k]], acc);', 'acc = f32(acc + f32(w10 * LUT[rgb[b + k]]));'],
  ['arrondi final « demi vers le haut » au lieu du pair', 'return d < 0.5 ? f : d > 0.5 ? f + 1 : (f % 2 === 0 ? f : f + 1);', 'return d < 0.5 ? f : f + 1;'],
  ['ordre des cumuls (w10 et w01 echanges)', 'acc = fma32(w10, LUT[rgb[b + k]], acc);\n        acc = fma32(w01, LUT[rgb[c + k]], acc);', 'acc = fma32(w01, LUT[rgb[c + k]], acc);\n        acc = fma32(w10, LUT[rgb[b + k]], acc);'],
  ['domaine du canvas elargi a 2', 'w < W * Math.SQRT2 && h < H * Math.SQRT2', 'w < W * 2 && h < H * 2'],
  ['ratio de carte accepte a 2 % au lieu de 15 %', '/ RATIO > 0.15', '/ RATIO > 0.02'],
  ['redressement au plus proche voisin', 'cv.INTER_LINEAR, cv.BORDER_REPLICATE', 'cv.INTER_NEAREST, cv.BORDER_REPLICATE'],
  ['quasi-doublon a 30 % de la diagonale', '< 0.03 * diag', '< 0.3 * diag'],
  ['quasi-doublon a 0,3 % de la diagonale', '< 0.03 * diag', '< 0.003 * diag'],
  ['ratio de carte accepte a 30 % au lieu de 15 %', '/ RATIO > 0.15', '/ RATIO > 0.30'],
  ['aire maximale 0,985 portee a 1', 'if (c.aire > 0.985) continue;', 'if (c.aire > 1.0) continue;'],
  ['dist : Math.hypot au lieu de la racine (le seul ecart voulu)', 'return Math.sqrt(dx * dx + dy * dy); };', 'return Math.hypot(dx, dy); };'],
  ['diagonale : Math.hypot au lieu de la racine', 'Math.sqrt(W * W + Ht * Ht);', 'Math.hypot(W, Ht);'],
  ['seuil de pre-reduction 800 -> 1000', 'export const COTE_PRE = 800;', 'export const COTE_PRE = 1000;'],
  ['dimensions de pre-reduction tronquees au lieu d\'arrondies', '(2 * c * COTE_PRE + g) / (2 * g)', '(2 * c * COTE_PRE) / (2 * g)'],
  ['limite de pixels des photos 16 M -> 12 M (un iPhone est refuse)', 'PIXELS_MAX_PHOTO = 16000000', 'PIXELS_MAX_PHOTO = 12000000'],
  ['cote maximal des photos 4608 -> 4096', 'COTE_MAX_PHOTO = 4608', 'COTE_MAX_PHOTO = 4096'],
  ['pre-reduction jamais appliquee', 'options.pre !== false && Math.max(w, h) > COTE_PRE', 'false'],
  ['pre-reduction : hauteur et largeur cibles echangees', 'redimRgb(rgb, w, h, d.W, d.H)', 'redimRgb(rgb, w, h, d.H, d.W)'],
  ['plafond des JPEG progressifs des photos remis a 4 Mpx', 'pixelsMaxProgressif: options.pixelsMaxProgressif || PIXELS_MAX_PHOTO', 'pixelsMaxProgressif: options.pixelsMaxProgressif || 4000000'],
  ['orientation EXIF non appliquee aux photos', "orientation: options.orientation || 'exif'", "orientation: options.orientation || 'aucune'"],
  ['bord bas du domaine retire (agrandissement admis)', 'return W <= w && H <= h && w <', 'return w < W * 100 && w <'],
];
let vivantes = 0;
for (const [nom, de, vers] of MUT) {
  if (!source.includes(de)) { console.log('MUTATION INAPPLICABLE (texte absent) :', nom); vivantes++; continue; }
  fs.writeFileSync(path.join(W, 'detection.mjs'), source.replace(de, vers));
  const r = spawnSync(process.execPath, [path.join(RACINE, 'v2', 'test', 'test-detection.js')], { env: { ...process.env, RM_DETECTION_PUB: W }, encoding: 'utf8', maxBuffer: 1 << 26 });
  const ko = (r.stdout.match(/(\d+) en echec/) || [])[1];
  const rouge = r.status !== 0;
  if (!rouge) vivantes++;
  console.log(`${rouge ? 'ROUGE  ' : 'VIVANTE'} ${nom} : ${ko === undefined ? 'sortie ' + r.status : ko + ' assertion(s) en echec'}`);
}
// temoin : le texte non mute doit passer
fs.writeFileSync(path.join(W, 'detection.mjs'), source);
const t = spawnSync(process.execPath, [path.join(RACINE, 'v2', 'test', 'test-detection.js')], { env: { ...process.env, RM_DETECTION_PUB: W }, encoding: 'utf8', maxBuffer: 1 << 26 });
console.log(`temoin non mute : ${t.status === 0 ? 'VERT' : 'ROUGE (anormal)'}`);
console.log(`${MUT.length} mutations, ${MUT.length - vivantes} tuees, ${vivantes} vivante(s)`);
process.exit(vivantes || t.status !== 0 ? 1 : 0);
