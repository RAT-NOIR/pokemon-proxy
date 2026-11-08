// La chaine de detection deterministe sous NODE sur un manifeste de photos { id: fichier } : decoder -> reduction 640 -> OpenCV.js (build de l'extension) -> redresser -> tenseur -> modele (onnxruntime-web WASM).
//   node chaine-node.mjs <manifeste.json> <sortie.json> [--voie=auto|pillow] [--limite=N] [--sans-modele] [--fils=4] [--cartes=<dossier>] [--hypot]
// Sortie : le MEME format que la sortie de la page de calcul (ecart-safari\res\res-*.json) : photos[id] = { redressee, nCartes, quad, dim640, emb } + les empreintes SHA-256 (rgb640, quads, carte) et la voie de reduction.
// Aucun reseau, aucune ecriture hors de <sortie> et du dossier de cartes demande.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';

const ICI = path.dirname(fileURLToPath(import.meta.url));
const PUB = process.env.RM_DETECTION_PUB || path.join(ICI, '..', '..', 'v2', 'banc-telephone', 'public');   // RM_DETECTION_PUB : une copie modifiee des modules (variantes, mutations)
const args = process.argv.slice(2), pos = args.filter((a) => !a.startsWith('--')), opt = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => { const [k, v] = a.slice(2).split('='); return [k, v === undefined ? true : v]; }));
const [fMan, fOut] = pos;
const MODELE = process.env.MODELE_ONNX || 'C:\\Users\\Yung\\rat-market-travail\\api\\etude-sans-service\\onnx\\p8000-poids8s.onnx';
const SHA_MODELE = '857105e3eb0035c5e0b6eab88f898a134d171321eb00e90452f4d37f7df28ec2';

export async function chargerCv() {
  globalThis.Module = { wasmBinary: fs.readFileSync(path.join(PUB, 'opencv', 'opencv_js.wasm')) };
  const cv = await createRequire(import.meta.url)(path.join(PUB, 'opencv', 'opencv.js'));
  if (!cv || typeof cv.Mat !== 'function') throw new Error('opencv non initialise');
  return cv;
}

async function main() {
  const D = await import(pathToFileURL(path.join(PUB, 'detection.mjs')).href);
  const E = await import(pathToFileURL(path.join(PUB, 'empreinte.js')).href);
  const man = JSON.parse(fs.readFileSync(fMan, 'utf8'));
  const ids = Object.keys(man).sort().slice(0, Number(opt.limite || 1e9));
  const cv = await chargerCv();
  let session = null, ort = null;
  if (!opt['sans-modele']) {
    const crypto = await import('node:crypto');
    const octets = fs.readFileSync(MODELE);
    if (crypto.createHash('sha256').update(octets).digest('hex') !== SHA_MODELE) throw new Error('le modele local n\'est pas le servi');
    ort = await import(pathToFileURL(path.join(PUB, 'ort', 'ort.wasm.bundle.min.mjs')).href);
    ort.env.wasm.wasmBinary = new Uint8Array(fs.readFileSync(path.join(PUB, 'ort', 'ort-wasm-simd-threaded.wasm')));
    ort.env.wasm.numThreads = Number(opt.fils || 1); ort.env.wasm.proxy = false; // node : les fils d'ORT (Worker de module) ne demarrent pas ici ; 1 fil

    session = await ort.InferenceSession.create(new Uint8Array(octets), { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
    await session.run({ pixel_values: new ort.Tensor('float32', new Float32Array(3 * 224 * 224), [1, 3, 224, 224]) });
  }
  if (opt.cartes) fs.mkdirSync(opt.cartes, { recursive: true });
  const res = { parametres: { moteur: 'node ' + process.version, voie: opt.voie || 'auto', version: D.VERSION_DETECTION, fils: Number(opt.fils || 1) }, photos: {} };
  const t0 = Date.now();
  for (const id of ids) {
    const octets = new Uint8Array(fs.readFileSync(man[id]));
    const t1 = performance.now();
    const r = D.detecter(cv, octets, { voie: opt.voie || 'auto' });
    const ms = Math.round(performance.now() - t1);
    const p = { redressee: r.redressee, nCartes: r.nCartes, quad: r.quad, dim640: r.dim640, voie: r.voie, src: [r.largeur, r.hauteur], empreintes: r.empreintes, ms, emb: null };
    if (r.redressee && session) {
      const t = E.versTenseur(r.carte, D.L_RED, D.H_RED);
      const out = await session.run({ pixel_values: new ort.Tensor('float32', t, [1, 3, 224, 224]) });
      const e = Array.from(out.emb.data); let s = 0; for (let j = 0; j < 256; j++) s += e[j] ** 2; s = Math.sqrt(s); for (let j = 0; j < 256; j++) e[j] /= s;
      p.emb = e;
      p.embSha = crypto_sha(new Uint8Array(new Float32Array(out.emb.data).buffer));
    }
    if (opt.cartes && r.carte) fs.writeFileSync(path.join(opt.cartes, id + '.rgb'), r.carte);
    if (opt['rgb640']) { fs.mkdirSync(opt['rgb640'], { recursive: true }); fs.writeFileSync(path.join(opt['rgb640'], id + '.rgb'), r.rgb640); }
    res.photos[id] = p;
  }
  res.parametres.totalMs = Date.now() - t0;
  fs.writeFileSync(fOut, JSON.stringify(res));
  console.log('fini', ids.length, 'photos,', res.parametres.totalMs, 'ms ; redressees', Object.values(res.photos).filter((x) => x.redressee).length, '; voies', JSON.stringify(Object.values(res.photos).reduce((a, x) => { a[x.voie] = (a[x.voie] || 0) + 1; return a; }, {})));
  process.exit(0);
}
let crypto_ = null;
function crypto_sha(o) { return crypto_.createHash('sha256').update(o).digest('hex'); }
crypto_ = (await import('node:crypto')).default;
if (process.argv[1] && path.basename(process.argv[1]) === 'chaine-node.mjs') await main().catch((e) => { console.error('ERREUR', String(e && (e.stack || e.message) || e).slice(0, 700)); process.exit(1); });
