// Le decodeur et la chaine sur de grandes photos : temps par etage, memoire, orientation EXIF, profil ICC, limites de pixels, HEIC.
//   node --expose-gc mesurer-12mpx.mjs <dossier-de-jpeg>  (le dossier de outils/detection/fabriquer-12mpx.py ; fichiers .jpg lus, rien ecrit)
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { chargerCv } from './chaine-node.mjs';
const PUB = process.env.RM_DETECTION_PUB || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'v2', 'banc-telephone', 'public');
const D = await import(pathToFileURL(path.join(PUB, 'detection.mjs')).href);
const DEC = await import(pathToFileURL(path.join(PUB, 'decodeur.mjs')).href);
const cv = await chargerCv();
const mo = (x) => Math.round(x / 1048576);
const code = (f) => { try { return f(); } catch (e) { return `${e.name}:${e.code || ''}:${String(e.message).slice(0, 60)}`; } };
const dossier = process.argv[2];
for (const nom of fs.readdirSync(dossier).filter((f) => /\.jpe?g$/i.test(f)).sort()) {
  const octets = new Uint8Array(fs.readFileSync(path.join(dossier, nom)));
  global.gc && global.gc(); const m0 = process.memoryUsage();
  let t = performance.now(), dec = null, e1 = null;
  try { dec = DEC.decoder(octets, { orientation: 'exif', pixelsMax: D.PIXELS_MAX_PHOTO, coteMax: D.COTE_MAX_PHOTO }); } catch (e) { e1 = `${e.code}:${String(e.message).slice(0, 60)}`; }
  const msDec = Math.round(performance.now() - t);
  const defaut = code(() => DEC.decoder(octets, {}).largeur);
  if (!dec) { console.log(`${nom} : refus avec pixelsMax 16 M : ${e1} | defaut : ${defaut}`); continue; }
  const m1 = process.memoryUsage();
  t = performance.now(); const r = D.detecter(cv, octets, {}); const msTot = Math.round(performance.now() - t);
  const m2 = process.memoryUsage();
  console.log(`${nom} : ${dec.largeur}x${dec.hauteur} (${(dec.largeur * dec.hauteur / 1e6).toFixed(1)} Mpx) EXIF lu ${dec.orientationLue} appliquee ${dec.orientationAppliquee} | decodeur ${msDec} ms | chaine complete ${msTot} ms (pre ${JSON.stringify(r.prereduction)} -> 640 ${r.dim640.join('x')}, voie ${r.voie}, redressee ${r.redressee}, cartes ${r.nCartes}) | RSS +${mo(m1.rss - m0.rss)} Mo apres decodage, ${mo(m2.rss)} Mo en fin, tampons ${mo(m1.arrayBuffers)} Mo | limite par defaut : ${defaut}`);
}
// HEIC : l'en-tete d'une boite ftyp « heic » (ce que livre un iPhone en HEIC), et AVIF
const ftyp = (marque) => { const b = new Uint8Array(64); b.set([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70], 0); b.set(new TextEncoder().encode(marque), 8); b.set(new TextEncoder().encode('mif1heic'), 16); return b; };
for (const m of ['heic', 'heix', 'mif1', 'avif']) console.log(`en-tete ftyp « ${m} » : ${code(() => DEC.decoder(ftyp(m), {}).largeur)}`);
process.exit(0);
