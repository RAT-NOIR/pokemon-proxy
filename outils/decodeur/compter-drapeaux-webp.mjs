// Compte, sur les en-têtes de TOUS les WebP du catalogue local (p8000-quant\images), les drapeaux VP8 que les 42 WebP synthétiques et le générateur ne garantissent pas d'exercer :
// filtre simple, plusieurs partitions de jetons, netteté > 0, deltas de filtre, segmentation (carte, données absolues), niveau de filtre 0. Lecture seule : seul l'en-tête de la première partition est décodé.
//   node outils\decodeur\compter-drapeaux-webp.mjs [dossier]
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const W = await import(pathToFileURL(path.join(import.meta.dirname, '..', '..', 'v2', 'banc-telephone', 'public', 'decodeur-webp.mjs')).href);
const dir = process.argv[2] || 'C:/Users/Yung/rat-market-travail/api/p8000-quant/images';
const c = { fichiers: 0, illisibles: 0, simple: 0, plusieursPartitions: 0, nettete: 0, deltasFiltre: 0, segmentation: 0, segmentsAbsolus: 0, carteSegments: 0, niveauZero: 0, skipDesactive: 0, tous_les_drapeaux_rares: 0 };
const raisons = {};
for (const nom of fs.readdirSync(dir)) {
    if (!nom.endsWith('.webp')) continue;
    c.fichiers++;
    try {
        const b = fs.readFileSync(path.join(dir, nom));
        let i = 12, f = null;
        while (i + 8 <= b.length) { const t = b.toString('latin1', i, i + 4), n = b.readUInt32LE(i + 4); if (t === 'VP8 ') { f = b.subarray(i + 8, i + 8 + n); break; } i += 8 + n + (n & 1); }
        if (!f) throw new Error('pas de chunk VP8');
        const part0 = ((f[0] | (f[1] << 8) | (f[2] << 16)) >>> 5);
        const br = new W.Lecteur(f, 10, 10 + part0);
        const r = W.lireEntetesBruts(br);
        if (br.eof) throw new Error('en-tête tronqué');
        const { seg, lf } = r;
        if (lf.simple) c.simple++;
        if (r.nparts > 1) c.plusieursPartitions++;
        if (lf.nettete > 0) c.nettete++;
        if (lf.deltas) c.deltasFiltre++;
        if (seg.actif) c.segmentation++;
        if (seg.actif && seg.abs) c.segmentsAbsolus++;
        if (seg.actif && seg.majMap) c.carteSegments++;
        if (lf.niveau === 0) c.niveauZero++;
        if (!r.utiliseSkip) c.skipDesactive++;
        if (lf.simple || r.nparts > 1 || lf.nettete > 0 || lf.deltas || (seg.actif && seg.abs)) c.tous_les_drapeaux_rares++;
    } catch (e) { c.illisibles++; raisons[e.message] = (raisons[e.message] || 0) + 1; }
}
console.log(JSON.stringify({ ...c, raisons }, null, 1));
