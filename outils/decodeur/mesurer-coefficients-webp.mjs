// Mesure, sur les WebP du catalogue local, le plus grand |coefficient déquantifié| rencontré par visuel, AU MÊME POINT du calcul que la borne du générateur (lireCoeffs : valeur signée x facteur de quantification,
// avant l'écriture dans le bloc, Y2 compris). La borne prouvée contre Pillow est 300 (generateur-webp.mjs) ; au-delà, libwebp SIMD peut différer du C reproduit ici.
//   node mesurer-coefficients-webp.mjs [reste] [modulo] [limite] : traite les fichiers d'indice i avec i % modulo == reste (deux processus possibles) ; limite = nombre maximal de fichiers
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const PUB = path.join(import.meta.dirname, '..', '..', 'v2', 'banc-telephone', 'public');
const W = await import(pathToFileURL(path.join(PUB, 'decodeur-webp.mjs')).href);
const D = await import(pathToFileURL(path.join(PUB, 'decodeur.mjs')).href);
const [, , reste = '0', modulo = '1', limite = '0'] = process.argv;
const dir = process.argv[5] || 'C:/Users/Yung/rat-market-travail/api/p8000-quant/images';
let maxFichier = 0;
W.definirCrochetCoeff(v => { const a = v < 0 ? -v : v; if (a > maxFichier) maxFichier = a; });
// RM_MANIFESTE=<manifeste de references-catalogue.py> : ne mesure QUE les visuels de ce manifeste (les 1 500 prouvés contre Pillow)
const noms = process.env.RM_MANIFESTE ? JSON.parse(fs.readFileSync(process.env.RM_MANIFESTE, 'utf8')).cartes.map(c => c.fichier).sort() : fs.readdirSync(dir).filter(x => x.endsWith('.webp')).sort();
const seuils = [100, 200, 300, 400, 600, 1000, 2048];
const comptes = Object.fromEntries(seuils.map(s => [`>${s}`, 0]));
const depassent = [];
let n = 0, max = 0, illisibles = 0;
for (let i = 0; i < noms.length; i++) {
    if (i % Number(modulo) !== Number(reste)) continue;
    if (Number(limite) && n >= Number(limite)) break;
    maxFichier = 0;
    try { D.decoder(fs.readFileSync(path.join(dir, noms[i])), { orientation: 'aucune' }); } catch { illisibles++; continue; }
    n++; if (maxFichier > max) max = maxFichier;
    for (const s of seuils) if (maxFichier > s) comptes[`>${s}`]++;
    if (maxFichier > 300 && depassent.length < 50) depassent.push([noms[i], maxFichier]);
}
console.log(JSON.stringify({ reste, modulo, visuels: n, illisibles, maximumObserve: max, visuelsAuDessusDe: comptes, premiersDepassantLa300: depassent }));
