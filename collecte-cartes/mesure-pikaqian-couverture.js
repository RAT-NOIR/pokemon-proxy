// Lecture locale : quels de nos sets zh-hans ont une page de set pikaqian (par le code, minuscule). Usage : node mesure-pikaqian-couverture.js <base.json> <sets.html>
'use strict';
const fs = require('fs');
const [fb, fh] = process.argv.slice(2);
const B = JSON.parse(fs.readFileSync(fb, 'utf8'));
const h = fs.readFileSync(fh, 'utf8');
const pk = new Set([...h.matchAll(/href="\/sets\/([^"]+)"/g)].map(m => m[1]));
const PROMOS = { 'SV-P/CS': 'promo-sv-p', 'S-P/CS': 'promo-s-p', 'SM-P/CS': 'promo-sm-p', 'M-P/CS': 'promo-m-p', '30th-P': 'promo-30th-p' };
const par = new Map();
for (const p of B.produits) (par.get(p.codeSet) || par.set(p.codeSet, []).get(p.codeSet)).push(p);
let nSet = 0, nProd = 0, tSet = 0, tProd = 0; const sans = [];
for (const [c, l] of par) {
  tSet++; tProd += l.length;
  const k = PROMOS[c] || String(c).toLowerCase();
  if (pk.has(k)) { nSet++; nProd += l.length; } else sans.push(c + ' (' + l.length + ')');
}
console.log('pages de set pikaqian listees :', pk.size);
console.log('nos sets zh-hans (codeSet) :', tSet, '| produits :', tProd);
console.log('sets dont le code a une page pikaqian :', nSet, '| produits :', nProd);
console.log('sans page pikaqian :', sans.join(', '));
