// FIGE la population 3 (vraies photos de telephone, jusqu'a 12 Mpx) AVANT tout verdict. Meme filtre que outils/detection/liste-reelles.mjs (sources a licence declaree ou libre, exclusion perceptuelle « ok », hors quarantaine, cosinus au juge < 0,93,
// grand cote > 800) PLUS le retrait des photos a licence « non declaree » (comparer-grandes.mjs, filtre par defaut) et l'exclusion du juge par sha256 de contenu. Le juge n'est jamais ouvert.
//   node figer-population3.mjs <sortie.json>   (ecrit aussi <sortie>.sha256 ; refuse d'ecraser)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
const ICI = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const SEL = require('./selection.cjs');
const D = await import(pathToFileURL(path.join(ICI, '..', '..', 'v2', 'banc-telephone', 'public', 'decodeur.mjs')).href);
const API = 'C:\\Users\\Yung\\rat-market-travail\\api', RACINE = path.join(API, 'collecte-photos');
const sortie = process.argv[2];
if (fs.existsSync(sortie)) { console.error('REFUS : deja figee'); process.exit(2); }
const juge = new Map();
for (const l of fs.readFileSync(path.join(API, 'juge-cinq', 'sha256-juge.txt'), 'utf8').split(/\r?\n/)) { const p = l.trim().split(/\s+/); if (p[0] && p[0].length === 64) juge.set(p[0], 'juge'); }
const SOURCES = [/Alexleplusmeilleur/, /stevelohwc/, /antokun/, /lukassvihel/, /commons\.wikimedia/];
const L = fs.readFileSync(path.join(RACINE, 'manifeste-photos.jsonl'), 'utf8').split('\n').filter(Boolean).map((x) => JSON.parse(x));
const ecart = { source: 0, petite: 0, exclusion: 0, quarantaine: 0, juge: 0, sansLicence: 0, fichierAbsent: 0, doublon: 0 }, photos = [], vus = new Set();
for (const l of L) {
  if (!SOURCES.some((r) => r.test(l.source))) { ecart.source++; continue; }
  if (Math.max(l.w, l.h) <= 800) { ecart.petite++; continue; }
  if (!l.exclusionPerceptuelle || l.exclusionPerceptuelle.statut !== 'ok') { ecart.exclusion++; continue; }
  if (l.quarantaine) { ecart.quarantaine++; continue; }
  if (!(typeof l.cosJuge === 'number' && l.cosJuge < 0.93)) { ecart.juge++; continue; }
  if (/non declaree/.test(l.licence)) { ecart.sansLicence++; continue; }
  const f = path.join(RACINE, l.chemin);
  if (!fs.existsSync(f)) { ecart.fichierAbsent++; continue; }
  const octets = fs.readFileSync(f), sha = crypto.createHash('sha256').update(octets).digest('hex');
  if (vus.has(sha)) { ecart.doublon++; continue; } vus.add(sha);
  const dim = D.lireDimensions(new Uint8Array(octets.subarray(0, 65536)));
  photos.push({ sha256: sha, pixels: dim.largeur * dim.hauteur, largeur: dim.largeur, hauteur: dim.hauteur, chemin: f, format: dim.format, source: l.source, licence: l.licence });
}
const r = SEL.choisir(photos, { exclus: juge, n: Infinity, plusDe: 800, exigerExclusions: true });
const par = {}; for (const p of r.retenues) { const k = `${p.source} | ${p.licence}`; par[k] = (par[k] || 0) + 1; }
const prog = r.retenues.filter((p) => p.format === 'jpeg').length;
const doc = { figeLe: new Date().toISOString(), regle: 'filtre de liste-reelles.mjs + licence declaree + juge exclu par sha256 ; pixels decroissants, sha256 croissant ; toute la liste', ecartsDuFiltre: ecart, jugeExclusions: juge.size, candidates: r.candidates, exclues: r.exclues, retenues: r.retenues.length, parSource: par, empreinteListe: SEL.empreinte(r.retenues), distribution: SEL.distribution(r.retenues),
  pixelsMin: Math.min(...r.retenues.map((p) => p.pixels)), pixelsMax: Math.max(...r.retenues.map((p) => p.pixels)), dimensions: Object.entries(r.retenues.reduce((o, p) => { const k = `${p.largeur}x${p.hauteur}`; o[k] = (o[k] || 0) + 1; return o; }, {})).sort((a, b) => b[1] - a[1]),
  population3_reelles: { liste: r.retenues } };
fs.writeFileSync(sortie, JSON.stringify(doc, null, 1));
fs.writeFileSync(sortie.replace(/\.json$/, '.sha256'), crypto.createHash('sha256').update(fs.readFileSync(sortie)).digest('hex') + '  ' + path.basename(sortie) + '\n');
console.log(JSON.stringify({ ...doc, population3_reelles: undefined, exclues: doc.exclues.length, dimensions: doc.dimensions.slice(0, 25), nbFormesDeDimensions: doc.dimensions.length, jpeg: prog }, null, 1));
