// Le decodeur sur un JPEG PROGRESSIF de 12 Mpx (le plafond progressif par defaut est 4 Mpx : 92 des 386 vraies grandes photos du poste, 3000x4000, sont refusees TROP_GRAND) : temps, memoire.
//   node --expose-gc mesurer-progressif.mjs <fichier.jpg> [plafond-px]
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
const PUB = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'v2', 'banc-telephone', 'public');
const DEC = await import(pathToFileURL(path.join(PUB, 'decodeur.mjs')).href);
const o = new Uint8Array(fs.readFileSync(process.argv[2])), plafond = Number(process.argv[3] || 16000000);
global.gc(); const m0 = process.memoryUsage();
let pic = 0; const iv = setInterval(() => { pic = Math.max(pic, process.memoryUsage().rss); }, 5);
const t = performance.now();
try { const r = DEC.decoder(o, { pixelsMax: 16000000, coteMax: 4608, pixelsMaxProgressif: plafond }); console.log(`${path.basename(process.argv[2])} : ${r.largeur}x${r.hauteur} decode en ${Math.round(performance.now() - t)} ms ; RSS avant ${Math.round(m0.rss / 1048576)} Mo, apres ${Math.round(process.memoryUsage().rss / 1048576)} Mo, tampons ${Math.round(process.memoryUsage().arrayBuffers / 1048576)} Mo`); }
catch (e) { console.log('refus', e.code, e.message); }
clearInterval(iv); process.exit(0);
