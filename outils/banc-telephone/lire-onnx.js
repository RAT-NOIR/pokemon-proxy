'use strict';
// Lit un modèle ONNX (protobuf, sans dépendance) et dit ce qui compte pour la mémoire WebGPU : les initialiseurs (octets bruts, forme, type) triés par taille, les types de noeuds,
// et le total FP32 que donnerait la déquantification de tous les poids int8/uint8 (4 octets par élément) — comparé aux limites WebGPU (maxBufferSize, maxStorageBufferBindingSize).
//   node outils\banc-telephone\lire-onnx.js <modele.onnx>
const fs = require('fs');
const buf = fs.readFileSync(process.argv[2]);
function varint(b, p) { let r = 0n, s = 0n; for (;;) { const x = b[p.i++]; r |= BigInt(x & 0x7f) << s; if (!(x & 0x80)) return r; s += 7n; } }
function* champs(b, d = 0, f = b.length) {
    const p = { i: d };
    while (p.i < f) { const k = Number(varint(b, p)), no = k >> 3, t = k & 7; if (t === 0) yield [no, t, varint(b, p)]; else if (t === 2) { const n = Number(varint(b, p)); yield [no, t, b.subarray(p.i, p.i + n)]; p.i += n; } else if (t === 1) { yield [no, t, b.subarray(p.i, p.i + 8)]; p.i += 8; } else if (t === 5) { yield [no, t, b.subarray(p.i, p.i + 4)]; p.i += 4; } else throw new Error('type ' + t); }
}
const TYPES = { 1: 'float32', 2: 'uint8', 3: 'int8', 6: 'int32', 7: 'int64', 10: 'float16', 11: 'float64' };
const init = [], noeuds = {};
for (const [no, , v] of champs(buf)) if (no === 7) for (const [n2, , w] of champs(v)) {
    if (n2 === 5) { const t = { dims: [], type: 0, nom: '', octets: 0 }; for (const [n3, tt, x] of champs(w)) { if (n3 === 1 && tt === 0) t.dims.push(Number(x)); else if (n3 === 1 && tt === 2) { const p = { i: 0 }; while (p.i < x.length) t.dims.push(Number(varint(x, p))); } else if (n3 === 2) t.type = Number(x); else if (n3 === 8) t.nom = Buffer.from(x).toString(); else if (n3 === 9) t.octets = x.length; else if (n3 === 4) t.octets += x.length; else if (n3 === 5) t.octets += x.length; } init.push(t); }
    if (n2 === 1) { for (const [n3, , x] of champs(w)) if (n3 === 4) { const o = Buffer.from(x).toString(); noeuds[o] = (noeuds[o] || 0) + 1; } }
}
const elems = t => t.dims.reduce((a, b) => a * b, 1);
const total = init.reduce((s, t) => s + t.octets, 0);
console.log(`fichier : ${buf.length} octets ; initialiseurs : ${init.length}, ${total} octets bruts (${(total / 1048576).toFixed(1)} Mo)`);
const parType = {}; for (const t of init) { const k = TYPES[t.type] || String(t.type); parType[k] = parType[k] || { n: 0, octets: 0, elems: 0 }; parType[k].n++; parType[k].octets += t.octets; parType[k].elems += elems(t); }
console.log('par type :', JSON.stringify(parType));
const q = init.filter(t => t.type === 2 || t.type === 3);
const fp32Q = q.reduce((s, t) => s + elems(t) * 4, 0);
console.log(`poids int8/uint8 : ${q.length}, ${q.reduce((s, t) => s + t.octets, 0)} octets ; ils pèseraient ${fp32Q} octets (${(fp32Q / 1048576).toFixed(1)} Mo) en float32 (déquantifiés)`);
const gros = init.map(t => ({ nom: t.nom.slice(0, 60), type: TYPES[t.type] || t.type, dims: t.dims.join('x'), octets: t.octets, fp32: elems(t) * 4 })).sort((a, b) => b.fp32 - a.fp32).slice(0, 8);
console.log('les 8 plus gros (taille FP32 équivalente) :'); for (const g of gros) console.log(`  ${g.type} ${g.dims} brut ${g.octets} fp32 ${g.fp32} (${(g.fp32 / 1048576).toFixed(2)} Mo)  ${g.nom}`);
console.log('noeuds :', JSON.stringify(Object.entries(noeuds).sort((a, b) => b[1] - a[1]).slice(0, 14)));
console.log('plus gros tampon FP32 :', gros[0] ? gros[0].fp32 : 0, 'octets ; limites WebGPU par défaut : maxBufferSize 268435456 (256 Mo), maxStorageBufferBindingSize 134217728 (128 Mo)');
