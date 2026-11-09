// LA LISTE des vraies grandes photos du poste, sans verite d'idProduct : photos de collecte-photos (rapport du 07/11) de plus de 800 px de grand cote, de licence DECLAREE ou de provenance libre (MIT, CC0, Commons, jeux HF publics),
// dont l'exclusion perceptuelle est « ok » (aucun recoupement avec le juge, le banc eBay ni la calibration), hors quarantaine, cosinus au juge < 0,93 (relu seulement comme garde d'exclusion : aucun resultat du juge).
// Sont ECARTES d'office : rubielvelasquez (provenance eBay, recouvre le pool eBay), connorhoehn (cartes de sport), benjaminadedowole (scans), ongshujian (<= 800 px).
//   node liste-reelles.mjs <sortie-manifeste.json> <sortie-meta.json>
import fs from 'node:fs';
import path from 'node:path';
const RACINE = 'C:\\Users\\Yung\\rat-market-travail\\api\\collecte-photos';
const L = fs.readFileSync(path.join(RACINE, 'manifeste-photos.jsonl'), 'utf8').split('\n').filter(Boolean).map((x) => JSON.parse(x));
const SOURCES = [/Alexleplusmeilleur/, /stevelohwc/, /antokun/, /lukassvihel/, /commons\.wikimedia/];
const man = {}, meta = {}, ecart = { source: 0, petite: 0, exclusion: 0, quarantaine: 0, juge: 0 };
for (const l of L) {
  if (!SOURCES.some((r) => r.test(l.source))) { ecart.source++; continue; }
  if (Math.max(l.w, l.h) <= 800) { ecart.petite++; continue; }
  if (!l.exclusionPerceptuelle || l.exclusionPerceptuelle.statut !== 'ok') { ecart.exclusion++; continue; }
  if (l.quarantaine) { ecart.quarantaine++; continue; }
  if (!(typeof l.cosJuge === 'number' && l.cosJuge < 0.93)) { ecart.juge++; continue; }
  const id = l.sha256.slice(0, 16), f = path.join(RACINE, l.chemin);
  if (!fs.existsSync(f)) continue;
  man[id] = f; meta[id] = { source: l.source, licence: l.licence, w: l.w, h: l.h, nature: l.nature, sousDossier: l.sous_dossier || null };
}
fs.writeFileSync(process.argv[2], JSON.stringify(man)); fs.writeFileSync(process.argv[3], JSON.stringify(meta));
const par = {}; for (const m of Object.values(meta)) { const k = `${m.source} | ${m.licence}`; par[k] = (par[k] || 0) + 1; }
console.log('retenues', Object.keys(man).length, 'ecartees', JSON.stringify(ecart)); console.log(JSON.stringify(par, null, 1));
