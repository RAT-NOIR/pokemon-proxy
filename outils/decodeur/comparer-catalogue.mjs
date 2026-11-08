// Compare le décodeur Rat-Market à Pillow, au bit, sur le manifeste de references-catalogue.py (fichiers lus, jamais copiés).
// Usage : node comparer-catalogue.mjs <manifeste.json>
import fs from 'node:fs';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const D = await import(pathToFileURL(path.join(import.meta.dirname, '..', '..', 'v2', 'banc-telephone', 'public', 'decodeur.mjs')).href);
const m = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
let ok = 0, ko = 0, refus = 0, ms = 0, pixels = 0; const raisons = {};
for (const c of m.cartes) {
    const o = fs.readFileSync(c.chemin);
    const t = performance.now();
    try {
        const r = D.decoder(o, { orientation: 'aucune' });
        ms += performance.now() - t; pixels += r.largeur * r.hauteur;
        if (r.largeur === c.w && r.hauteur === c.h && crypto.createHash('sha256').update(r.rgb).digest('hex') === c.sha256) ok++;
        else { ko++; console.log('ECART', c.fichier, c.w, c.h, r.largeur, r.hauteur); }
    } catch (e) { refus++; raisons[e.code + ':' + e.detail] = (raisons[e.code + ':' + e.detail] || 0) + 1; }
}
console.log(JSON.stringify({ identiques: ok, ecarts: ko, refuses: refus, raisons, msParImage: Math.round(ms / Math.max(1, ok + ko)), mpx: Math.round(pixels / 1e5) / 10 }));
