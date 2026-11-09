// LE CALCUL du test de coherence : une variante de photo (A, B, BB, B0) -> decodage, (pre-reduction), detection, redressement, modele (sha256 857105e3...), index, garde des zones, regle G. Reprenable : une photo deja ecrite n'est pas refaite.
//   set NODE_PATH=<node_modules de l'API> ; node coherence.mjs <population.json> <dossier-donnees> <A|B|BB|B0> [--limite=N] [--serie=i/n]
// Sortie : <dossier>\verdicts-<variante>[-i].jsonl, une ligne par photo. AUCUNE verite lue, aucun compte de juste ou de faux.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
const ICI = path.dirname(fileURLToPath(import.meta.url));
const PUB = path.join(ICI, '..', '..', 'v2', 'banc-telephone', 'public');
const require = createRequire(import.meta.url);
const CMP = require('./comparateur.cjs');
const { creerDecideur } = require('./decideur.cjs');
const sharp = createRequire('C:\\Users\\Yung\\Desktop\\pokemon-proxy-api-v2\\package.json')('sharp');
const args = process.argv.slice(2), pos = args.filter((a) => !a.startsWith('--')), opt = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => { const [k, v] = a.slice(2).split('='); return [k, v === undefined ? true : v]; }));
const [fPop, dossier, variante] = pos;
if (!['A', 'B', 'BB', 'B0'].includes(variante)) { console.error('variante : A | B | BB | B0'); process.exit(2); }
const MODELE_ONNX = process.env.MODELE_ONNX || 'C:\\Users\\Yung\\rat-market-travail\\api\\etude-sans-service\\onnx\\p8000-poids8s.onnx';
const SHA_MODELE = '857105e3eb0035c5e0b6eab88f898a134d171321eb00e90452f4d37f7df28ec2';

const D = await import(pathToFileURL(path.join(PUB, 'detection.mjs')).href);
const E = await import(pathToFileURL(path.join(PUB, 'empreinte.js')).href);
const P = JSON.parse(fs.readFileSync(fPop, 'utf8'));
const liste = new Map();
for (const k of ['population1_banc', 'population2_lotEbayLocal']) for (const p of P[k].liste) liste.set(p.sha256, p);
const manB = fs.existsSync(path.join(dossier, 'b-manifeste.json')) ? JSON.parse(fs.readFileSync(path.join(dossier, 'b-manifeste.json'), 'utf8')) : {};
const manB0 = fs.existsSync(path.join(dossier, 'b0-manifeste.json')) ? JSON.parse(fs.readFileSync(path.join(dossier, 'b0-manifeste.json'), 'utf8')) : {};
const fichierDe = (sha) => variante === 'A' ? liste.get(sha).chemin : variante === 'B' ? manB[sha].b : variante === 'BB' ? manB[sha].bb : manB0[sha].b0;
let shas = [...liste.keys()].sort();
if (opt.serie) { const [i, n] = opt.serie.split('/').map(Number); shas = shas.filter((_, k) => k % n === i); }
if (opt.limite) shas = shas.slice(0, Number(opt.limite));
const sortie = path.join(dossier, `verdicts-${variante}${opt.serie ? '-' + opt.serie.split('/')[0] : ''}.jsonl`);
const faits = new Set(fs.existsSync(sortie) ? fs.readFileSync(sortie, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).sha256) : []);

// modele
const octetsModele = fs.readFileSync(MODELE_ONNX);
if (crypto.createHash('sha256').update(octetsModele).digest('hex') !== SHA_MODELE) throw new Error('le modele local n\'est pas le servi');
globalThis.Module = { wasmBinary: fs.readFileSync(path.join(PUB, 'opencv', 'opencv_js.wasm')) };
const cv = await require(path.join(PUB, 'opencv', 'opencv.js'));
if (!cv || typeof cv.Mat !== 'function') throw new Error('opencv non initialise');
const ort = await import(pathToFileURL(path.join(PUB, 'ort', 'ort.wasm.bundle.min.mjs')).href);
ort.env.wasm.wasmBinary = new Uint8Array(fs.readFileSync(path.join(PUB, 'ort', 'ort-wasm-simd-threaded.wasm')));
ort.env.wasm.numThreads = 1; ort.env.wasm.proxy = false;
const session = await ort.InferenceSession.create(new Uint8Array(octetsModele), { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
const { decider, gel, manque } = await creerDecideur();
gel.versionDetection = D.VERSION_DETECTION; gel.variante = variante; gel.population = path.basename(fPop);
fs.writeFileSync(sortie.replace(/\.jsonl$/, '.gel.json'), JSON.stringify(gel, null, 1));
console.log(`variante ${variante} : ${shas.length} photos, ${faits.size} deja faites ; sortie ${sortie}`);

let n = 0;
for (const sha of shas) {
  if (faits.has(sha)) continue;
  const t0 = performance.now();
  const rec = { sha256: sha, variante, fichier: path.basename(fichierDe(sha)), redressee: false, nCartes: 0, quad: null, dim640: null, src: null, pre: null, voie: null, emb: null, score: null, marge: null, nCandidats: null, top: null, decision: null, nMesures: null, erreur: null };
  try {
    const octets = new Uint8Array(fs.readFileSync(fichierDe(sha)));
    const r = D.detecter(cv, octets, {});
    Object.assign(rec, { redressee: r.redressee, nCartes: r.nCartes, quad: r.quad, dim640: r.dim640, src: [r.largeur, r.hauteur], pre: r.prereduction, voie: r.voie, candidats: r.candidats, empreintes: r.empreintes });
    if (r.redressee) {
      const out = await session.run({ pixel_values: new ort.Tensor('float32', E.versTenseur(r.carte, D.L_RED, D.H_RED), [1, 3, 224, 224]) });
      const e = Array.from(out.emb.data); let s = 0; for (let j = 0; j < e.length; j++) s += e[j] ** 2; s = Math.sqrt(s); for (let j = 0; j < e.length; j++) e[j] /= s;
      rec.emb = e;
      const jpeg = await sharp(Buffer.from(r.carte.buffer, r.carte.byteOffset, r.carte.byteLength), { raw: { width: D.L_RED, height: D.H_RED, channels: 3 } }).jpeg({ quality: 92 }).toBuffer();
      rec.carteJpegSha256 = crypto.createHash('sha256').update(jpeg).digest('hex');
      const res = await decider(e, jpeg.toString('base64'));
      rec.top = res.top; rec.nMesures = res.nMesures;
      const d = res.decision;
      rec.decision = d.muette ? d : { affirme: d.affirme === true, produit: d.produit ?? null, reponseCommune: d.reponseCommune ?? null, question: d.question ?? null, raison: d.raison, concurrents: d.concurrents ?? null, margeCarte: d.margeCarte ?? null, visuel: d.visuel ?? null, premier: d.premier ?? null, zones: d.zones ?? null, zonesVisuel: d.zonesVisuel ?? null };
      rec.verdict = CMP.issueDe(d.muette ? d : d);
      rec.score = res.top ? res.top[0][1] : null; rec.marge = d.muette ? null : (d.margeCarte ?? null);
      rec.nCandidats = d.muette ? null : 1 + (Array.isArray(d.concurrents) ? d.concurrents.length : 0);
    } else rec.verdict = CMP.issueDe({ muette: 'non-redressee' });
  } catch (e) { rec.erreur = String((e && (e.code || e.name || e.message)) || e).slice(0, 80); rec.verdict = CMP.issueDe({ muette: 'erreur:' + rec.erreur }); }
  rec.ms = Math.round(performance.now() - t0);
  fs.appendFileSync(sortie, JSON.stringify(rec) + '\n');
  if (++n % 25 === 0) console.log(`  ${n} faites (${Math.round(rec.ms)} ms la derniere), scans manquants ${manque.scans}`);
}
console.log(`FINI variante ${variante} : ${n} photos calculees ; scans manquants ${manque.scans}`);
process.exit(0);
