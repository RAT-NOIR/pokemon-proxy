'use strict';
// FUITE-INLIERS — la chaîne OpenCV complète d'un scan (decrire x2 + inliers, scoresZones, comparerPaire) sur des cartes FABRIQUÉES toutes différentes : les caches de zones se remplissent puis tournent, comme en production.
//   node v2/mesures/mesurer-fuite-chaine.js [--scans=500] [--sortie=f.json]
// Relevés aux scans 1, 10, 25, 50, 100, 200, 500… : RSS, tas JS, mémoire externe (Buffers), mémoire WASM, objets C++ vivants (attendu : 3 par scan en cache + la photo en cours, jamais plus).
const path = require('path'), fs = require('fs'), { spawnSync } = require('child_process');
const arg = (n, d) => { const a = process.argv.find(x => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
if (!global.gc) { const r = spawnSync(process.execPath, ['--expose-gc', __filename, ...process.argv.slice(2)], { stdio: 'inherit' }); process.exit(r.status === null ? 1 : r.status); }
// ⚠️ L'INSTRUMENT FABRIQUE UNE PARTIE DE CE QU'IL MESURE : _embind-vivants tient dans un Set TOUT objet embind créé jusqu'au prochain `vivants()` — des milliers d'enveloppes JS (tas et RSS gonflés, d'autant plus que les relevés sont espacés).
// `--sans-instrument` ne l'arme pas : seuls RSS, tas et mémoire externe sont relevés (la mémoire WASM et les vivants ne sont plus mesurés). Les pentes de RSS se lisent dans CE mode.
const V = process.argv.includes('--sans-instrument') ? { octetsWasm: () => 0, vivants: () => ({ n: -1 }) } : require('../test/_embind-vivants').armer();            // AVANT tout require d'opencv
const sharp = require('sharp');
require('../reglage-sharp').appliquer(sharp, process.env);                                          // CACHE-ZONES : V2_SHARP_CACHE=false|true|memoire:<Mo> ; RM_CACHE_SCANS / RM_CACHE_PAIRES se lisent dans zones.js
const Z = require('../../ratmarket/zones');
const D = require('../../departage-image');
const N = Number(arg('scans', 500)), SORTIE = arg('sortie', null);
if (process.argv.includes('--sans-cache-sharp')) { sharp.cache(false); sharp.concurrency(1); }   // diagnostic : le cache libvips et ses fils sont-ils la pente ?
const SANS_ZONES = process.argv.includes('--sans-zones');                                          // diagnostic : decrire + inliers seuls
const graine = s => { let x = s >>> 0; return () => { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; return x / 4294967296; }; };
function fabriquer(seed, l = 420, h = 587) {
    const r = graine(seed), b = Buffer.alloc(l * h * 3, 128);
    for (let k = 0; k < 260; k++) {
        const x0 = Math.floor(r() * (l - 20)), y0 = Math.floor(r() * (h - 20)), w = 8 + Math.floor(r() * 70), hh = 8 + Math.floor(r() * 70), c = Math.floor(r() * 256);
        for (let y = y0; y < Math.min(h, y0 + hh); y++) for (let x = x0; x < Math.min(l, x0 + w); x++) { const o = (y * l + x) * 3; b[o] = b[o + 1] = b[o + 2] = c; }
    }
    return b;
}
const png = (buf, l = 420, h = 587) => sharp(buf, { raw: { width: l, height: h, channels: 3 } }).png().toBuffer();
const mo = x => +(x / 1048576).toFixed(1);
const POINTS = new Set([1, 10, 25, 50, 100, 200, 300, 500, 1000, 2000, 5000]);
(async () => {
    const releves = [];
    const base = await png(fabriquer(7));
    const { cv } = await (async () => { await D.decrire(base); return D.outils(); })();
    let precedent = base;
    for (let i = 1; i <= N; i++) {
        const oct = await png(fabriquer(1000 + i));
        const a = await D.decrire(oct), b = await D.decrire(precedent);
        D.inliers(cv, a, b);
        const photo = SANS_ZONES ? { delete() { } } : await Z.photoGrise(oct, 420, 587);
        try {
            if (!SANS_ZONES) {
                await Z.scoresZones(photo, { cle: 'c/' + i, octets: oct });
                await Z.comparerPaire(photo, { cle: 'c/' + i, octets: oct }, { cle: 'c/' + (i - 1), octets: precedent });
            }
        } finally { photo.delete(); }
        precedent = oct;
        if (POINTS.has(i) || i === N) {
            global.gc();
            const m = process.memoryUsage();
            releves.push({ scans: i, rssMo: mo(m.rss), tasMo: mo(m.heapUsed), externeMo: mo(m.external), wasmMo: mo(V.octetsWasm() || 0), vivants: V.vivants().n, enCache: Z._scans.size, paires: Z._paires.size });
            console.log(JSON.stringify(releves[releves.length - 1]));
        }
    }
    if (SORTIE) fs.writeFileSync(SORTIE, JSON.stringify(releves, null, 1));
    process.exit(0);
})().catch(e => { console.log('ERREUR', e.stack); process.exit(1); });
