// MUTATIONS de grandes-page.mjs : une ligne changee a la fois, le banc v2/test/test-detection-depot.js rejoue contre la copie (RM_DETECTION_PUB). Chaque mutation doit le mettre ROUGE.
//   node mutations-page.mjs <dossier-de-travail>      (cree et REUTILISE : aucune suppression)
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const RACINE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PUB = path.join(RACINE, 'v2', 'banc-telephone', 'public');
const W = process.argv[2];
fs.mkdirSync(path.join(W, 'opencv'), { recursive: true });
for (const f of fs.readdirSync(PUB)) if (/^decodeur.*\.mjs$|^lot-detection\.json$|^empreinte\.js$|^detection(-page)?\.mjs$/.test(f)) fs.copyFileSync(path.join(PUB, f), path.join(W, f));
for (const f of ['opencv.js', 'opencv_js.wasm']) fs.copyFileSync(path.join(PUB, 'opencv', f), path.join(W, 'opencv', f));
const source = fs.readFileSync(path.join(PUB, 'grandes-page.mjs'), 'utf8');
const MUT = [
  ['verdict constant CONCORDANT', 'verdict: verdictDepot(photos)', "verdict: 'CONCORDANT'"],
  ['verdict IDENTIQUE reutilise pour une concordance de quadrilatere', "return 'CONCORDANT';", "return 'IDENTIQUE';"],
  ['memeQuad absent entre deux redressees : plus ECART', '(p.rm.redressee && p.memeQuad !== true)', 'false'],
  ['la chaine du navigateur tourne meme hors bornes', 'const n = bornes.ok ? await chaine(cv, octets) :', 'const n = true ? await chaine(cv, octets) :'],
  ['un depot refuse n\'est pas garde', 'if (!r.ok) refuses.push(doc);', ''],
  ['seuil « meme quadrilatere » 3 % -> 30 %', 'rec.memeQuad = rec.ecartQuadPct < 3;', 'rec.memeQuad = rec.ecartQuadPct < 30;'],
  ['limite de taille de fichier 64 -> 640 Mio', 'TAILLE_MAX_FICHIER = 64 * 1048576', 'TAILLE_MAX_FICHIER = 640 * 1048576'],
  ['une redressee par un seul moteur ne fait plus ECART', 'p.rm.redressee !== p.nav.redressee || ', ''],
  ['un moteur en erreur seul ne fait plus ECART', 'if (p.rm.ok !== p.nav.ok) return \'ECART\';', ''],
  ['zero photo lue : plus ERREUR', "if (!photos.length || !photos.some((p) => p.rm.ok || p.nav.ok)) return 'ERREUR';", ''],
];
let vivantes = 0;
for (const [nom, de, vers] of MUT) {
  if (!source.includes(de)) { console.log('MUTATION INAPPLICABLE (texte absent) :', nom); vivantes++; continue; }
  fs.writeFileSync(path.join(W, 'grandes-page.mjs'), source.replace(de, vers));
  const r = spawnSync(process.execPath, [path.join(RACINE, 'v2', 'test', 'test-detection-depot.js')], { env: { ...process.env, RM_DETECTION_PUB: W }, encoding: 'utf8', maxBuffer: 1 << 26 });
  const ko = (r.stdout.match(/(\d+) échoués/) || [])[1], rouge = r.status !== 0;
  if (!rouge) vivantes++;
  console.log(`${rouge ? 'ROUGE  ' : 'VIVANTE'} ${nom} : ${ko === undefined ? 'sortie ' + r.status : ko + ' assertion(s) en echec'}`);
}
fs.writeFileSync(path.join(W, 'grandes-page.mjs'), source);
const t = spawnSync(process.execPath, [path.join(RACINE, 'v2', 'test', 'test-detection-depot.js')], { env: { ...process.env, RM_DETECTION_PUB: W }, encoding: 'utf8', maxBuffer: 1 << 26 });
console.log(`temoin non mute : ${t.status === 0 ? 'VERT' : 'ROUGE (anormal)'}`);
console.log(`${MUT.length} mutations, ${MUT.length - vivantes} tuees, ${vivantes} vivante(s)`);
process.exit(vivantes || t.status !== 0 ? 1 : 0);
