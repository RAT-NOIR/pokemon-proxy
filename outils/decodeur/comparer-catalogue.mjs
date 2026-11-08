// Compare le décodeur Rat-Market à Pillow, au bit, sur un manifeste de references-catalogue.py ou references-reels.py (fichiers lus, jamais copiés).
// Imprime aussi les chiffres des plafonds : nombre maximal de balayages d'un JPEG progressif du corpus et son plus grand nombre de pixels (pour montrer qu'ils ne refusent aucun fichier réel).
// Usage : node comparer-catalogue.mjs <manifeste.json>
import fs from 'node:fs';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const D = await import(pathToFileURL(path.join(import.meta.dirname, '..', '..', 'v2', 'banc-telephone', 'public', 'decodeur.mjs')).href);
const m = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
let ok = 0, ko = 0, refus = 0, ms = 0, pixels = 0, progressifs = 0, maxBalayages = 0, maxPxProgressif = 0; const raisons = {}, parFormat = {};
/** { progressif, balayages, pixels } d'un JPEG, lu dans les marqueurs seuls. */
function inspecterJpeg(o) {
    let i = 2, sos = 0, prog = false, px = 0;
    while (i + 4 <= o.length && o[i] === 0xff) {
        const mk = o[i + 1];
        if (mk === 0xd9) break;
        const n = o.readUInt16BE(i + 2);
        if (mk === 0xc2) { prog = true; px = o.readUInt16BE(i + 5) * o.readUInt16BE(i + 7); } else if (mk === 0xc0 || mk === 0xc1) px = o.readUInt16BE(i + 5) * o.readUInt16BE(i + 7);
        if (mk === 0xda) { sos++; let j = i + 2 + n; for (;;) { const k = o.indexOf(0xff, j); if (k < 0) return { progressif: prog, balayages: sos, pixels: px }; if (o[k + 1] === 0 || (o[k + 1] >= 0xd0 && o[k + 1] <= 0xd7)) { j = k + 2; continue; } i = k; break; } } else i += 2 + n;
    }
    return { progressif: prog, balayages: sos, pixels: px };
}
for (const c of m.cartes) {
    const o = fs.readFileSync(c.chemin);
    parFormat[c.format] = (parFormat[c.format] || 0) + 1;
    if (c.format === 'JPEG') { const s = inspecterJpeg(o); if (s.progressif) { progressifs++; maxBalayages = Math.max(maxBalayages, s.balayages); maxPxProgressif = Math.max(maxPxProgressif, s.pixels); } }
    const t = performance.now();
    try {
        const r = D.decoder(o, { orientation: 'aucune' });
        ms += performance.now() - t; pixels += r.largeur * r.hauteur;
        if (r.largeur === c.w && r.hauteur === c.h && crypto.createHash('sha256').update(r.rgb).digest('hex') === c.sha256) ok++;
        else { ko++; console.log('ECART', c.fichier, c.w, c.h, r.largeur, r.hauteur); }
    } catch (e) { refus++; raisons[e.code + ':' + e.detail] = (raisons[e.code + ':' + e.detail] || 0) + 1; console.log('REFUS', c.fichier, e.code, e.detail); }
}
console.log(JSON.stringify({ identiques: ok, ecarts: ko, refuses: refus, raisons, parFormat, jpegProgressifs: progressifs, maxBalayagesObserve: maxBalayages, maxPixelsProgressifObserve: maxPxProgressif, plafonds: { balayages: 64, pixelsProgressif: 4000000 }, msParImage: Math.round(ms / Math.max(1, ok + ko)), mpx: Math.round(pixels / 1e5) / 10 }));
