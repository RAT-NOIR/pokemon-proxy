// FIGE la population du test de coherence AVANT tout calcul de verdict : aucun modele, aucun index, aucune detection ici. Lit seulement les en-tetes (dimensions) et les octets (sha256).
//   node figer-population.mjs <sortie.json>
// Population 1 (stricte, celle de la demande) : les photos du BANC eBay (3 000 sha256) retrouvees sur le poste, moins toute photo du juge, plus de 800 px, triees par pixels decroissants puis sha256.
// Population 2 (SUPPLEMENT, nommee comme telle) : le lot eBay local (rubielvelasquez, memes annonces eBay) moins le juge, meme regle, 500 premieres.
// Exclusions : empreintes de contenu du juge (juge-cinq\sha256-juge.txt) ; photos que le manifeste de collecte a retirees ou jugees trop proches du juge (cosinus p8000 >= 0,93). Le juge n'est jamais ouvert.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';

const ICI = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const SEL = require('./selection.cjs');
const D = await import(pathToFileURL(path.join(ICI, '..', '..', 'v2', 'banc-telephone', 'public', 'decodeur.mjs')).href);
const API = 'C:\\Users\\Yung\\rat-market-travail\\api';
const EXT = /\.(jpe?g|png|webp)$/i;
const sortie = process.argv[2];
if (!sortie) { console.error('usage : node figer-population.mjs <sortie.json>'); process.exit(2); }
if (fs.existsSync(sortie)) { console.error('REFUS : la population est deja figee (' + sortie + ')'); process.exit(2); }

function* parcourir(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isSymbolicLink()) continue; if (e.isDirectory()) yield* parcourir(p); else if (EXT.test(e.name)) yield p; } }
const sha256 = (octets) => crypto.createHash('sha256').update(octets).digest('hex');

// ── les exclusions
const juge = new Map();
for (const l of fs.readFileSync(path.join(API, 'juge-cinq', 'sha256-juge.txt'), 'utf8').split(/\r?\n/)) { const p = l.trim().split(/\s+/); if (p[0] && p[0].length === 64) juge.set(p[0], 'juge'); }
const manif = [];
for (const f of ['manifeste-photos.jsonl', 'manifeste-retirees.jsonl']) for (const l of fs.readFileSync(path.join(API, 'collecte-photos', f), 'utf8').split(/\r?\n/)) if (l.trim()) manif.push({ ...JSON.parse(l), _retiree: f.includes('retirees') });
const exclus = new Map(juge);
let manifRetirees = 0, manifProchesJuge = 0;
for (const m of manif) {
  if (m._retiree || (m.exclusionPerceptuelle && m.exclusionPerceptuelle.statut === 'retiree')) { if (!exclus.has(m.sha256)) { exclus.set(m.sha256, 'retiree du lot (trop proche du juge ou des bancs)'); manifRetirees++; } }
  else if (typeof m.cosJuge === 'number' && m.cosJuge >= 0.93) { if (!exclus.has(m.sha256)) { exclus.set(m.sha256, 'cosinus p8000 avec le juge >= 0,93'); manifProchesJuge++; } }
}
const ebay = JSON.parse(fs.readFileSync(path.join(API, 'kaggle-v2', 'maitre-v4', 'exclusion-ebay.json'), 'utf8'));
const banc = new Set(ebay.banc.map((e) => e.sha256));
if (banc.size !== 3000 || juge.size === 0) throw new Error('listes inattendues : banc ' + banc.size + ', juge ' + juge.size);

// ── les photos du poste
const racines = [['rubiel', path.join(API, 'collecte-photos', 'brut', 'rubielvelasquez__pokemon-tcg-real-card-images-1k-subset')], ['collecte', path.join(API, 'collecte-photos', 'photos')], ['collecte-retirees', path.join(API, 'collecte-photos', 'photos_retirees')]];
const parSha = new Map(); let lues = 0, illisibles = 0;
for (const [nom, racine] of racines) {
  for (const f of parcourir(racine)) {
    const octets = fs.readFileSync(f); lues++;
    const s = sha256(octets);
    let dim; try { dim = D.lireDimensions(new Uint8Array(octets.subarray(0, 65536))); } catch { illisibles++; continue; }
    if (!parSha.has(s)) parSha.set(s, { sha256: s, pixels: dim.largeur * dim.hauteur, largeur: dim.largeur, hauteur: dim.hauteur, chemin: f, racine: nom, format: dim.format });
  }
}
const toutes = [...parSha.values()];
const rubiel = toutes.filter((p) => p.racine === 'rubiel');
const p1 = SEL.choisir(toutes, { exclus, n: 500, plusDe: 800, garder: banc, exigerExclusions: true });
const p2 = SEL.choisir(rubiel, { exclus, n: 500, plusDe: 800, exigerExclusions: true });
const vue = (r) => ({ candidates: r.candidates, horsListe: r.horsListe, petitesOuEgales800: r.petites, exclues: r.exclues, retenues: r.retenues.length, empreinteListe: SEL.empreinte(r.retenues), distributionRetenues: SEL.distribution(r.retenues), pixelsMin: r.retenues.length ? Math.min(...r.retenues.map((p) => p.pixels)) : null, pixelsMax: r.retenues.length ? Math.max(...r.retenues.map((p) => p.pixels)) : null,
  liste: r.retenues.map((p) => ({ sha256: p.sha256, pixels: p.pixels, largeur: p.largeur, hauteur: p.hauteur, chemin: p.chemin, format: p.format })) });
const doc = {
  figeLe: new Date().toISOString(), regle: 'candidates -> garder -> grand cote > 800 -> moins les exclusions (sha256 de contenu) -> pixels decroissants, sha256 croissant -> 500 premieres',
  exclusions: { juge: juge.size, retireesDuLot: manifRetirees, prochesDuJuge: manifProchesJuge, total: exclus.size },
  banc: { taille: banc.size, retrouvesSurLePoste: toutes.filter((p) => banc.has(p.sha256)).length, retrouvesParRacine: Object.fromEntries(racines.map(([n]) => [n, toutes.filter((p) => p.racine === n && banc.has(p.sha256)).length])) },
  poste: { fichiersLus: lues, illisibles, sha256Distincts: toutes.length, lotEbayLocal: rubiel.length, lotEbayLocalDistribution: SEL.distribution(rubiel) },
  population1_banc: vue(p1), population2_lotEbayLocal: vue(p2),
};
fs.writeFileSync(sortie, JSON.stringify(doc, null, 1));
fs.writeFileSync(sortie.replace(/\.json$/, '.sha256'), sha256(fs.readFileSync(sortie)) + '  ' + path.basename(sortie) + '\n');
console.log(JSON.stringify({ exclusions: doc.exclusions, banc: doc.banc, poste: doc.poste, p1: { ...doc.population1_banc, liste: undefined, exclues: doc.population1_banc.exclues.length }, p2: { ...doc.population2_lotEbayLocal, liste: undefined, exclues: doc.population2_lotEbayLocal.exclues.length } }, null, 1));
