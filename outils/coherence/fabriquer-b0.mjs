// TEMOIN B0 du test de coherence : les PIXELS EXACTS de la pre-reduction de la chaine A (decodeur + prereduire), ecrits en PNG sans perte, pour etre rejoues par le chemin des photos de 800 px ou moins.
//   node fabriquer-b0.mjs <population.json> <dossier-sortie>      Ecrit <dossier>\b0\<sha256>.png et b0-manifeste.json { sha256 : { b0, W, H } }
// Doit donner 0 difference avec A : si non, le banc a un defaut (decodage PNG, ecriture, orientation), a corriger avant de conclure.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
const ICI = path.dirname(fileURLToPath(import.meta.url));
const PUB = path.join(ICI, '..', '..', 'v2', 'banc-telephone', 'public');
const D = await import(pathToFileURL(path.join(PUB, 'detection.mjs')).href);
const DEC = await import(pathToFileURL(path.join(PUB, 'decodeur.mjs')).href);
const sharp = createRequire('C:\\Users\\Yung\\Desktop\\pokemon-proxy-api-v2\\package.json')('sharp');
const [fPop, dossier] = process.argv.slice(2);
const P = JSON.parse(fs.readFileSync(fPop, 'utf8'));
const liste = new Map();
for (const k of Object.keys(P).filter((x) => /^population/.test(x))) for (const p of P[k].liste) liste.set(p.sha256, p);
fs.mkdirSync(path.join(dossier, 'b0'), { recursive: true });
const man = {}, erreurs = {};
for (const [sha, p] of [...liste].sort()) {
  let dec; try { dec = DEC.decoder(new Uint8Array(fs.readFileSync(p.chemin)), D.optionsDecodeur({})); } catch (e) { man[sha] = null; erreurs[sha] = String(e.code || e.name); delete man[sha]; continue; }   // TROP_GRAND etc. : A ne sait pas lire, donc pas de temoin
  const pre = D.prereduire(dec.rgb, dec.largeur, dec.hauteur);
  if (!pre) throw new Error('photo de 800 px ou moins : ' + sha);
  const f = path.join(dossier, 'b0', sha + '.png');
  await sharp(Buffer.from(pre.rgb.buffer, pre.rgb.byteOffset, pre.rgb.byteLength), { raw: { width: pre.largeur, height: pre.hauteur, channels: 3 } }).png({ compressionLevel: 6 }).toFile(f);
  man[sha] = { b0: f, W: pre.largeur, H: pre.hauteur };
}
fs.writeFileSync(path.join(dossier, 'b0-manifeste.json'), JSON.stringify(man));
fs.writeFileSync(path.join(dossier, 'b0-erreurs.json'), JSON.stringify(erreurs));
console.log('b0', Object.keys(man).length, 'sans temoin (decodage refuse)', Object.keys(erreurs).length, JSON.stringify(erreurs).slice(0, 200));
