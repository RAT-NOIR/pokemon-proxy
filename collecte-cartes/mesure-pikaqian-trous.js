// Lecture locale du JSON de mesure-pikaqian-base.js : trous par set. Usage : node mesure-pikaqian-trous.js <base.json> [<code-set-pikaqian> ...]
'use strict';
const fs = require('fs');
const [f, ...codes] = process.argv.slice(2);
const B = JSON.parse(fs.readFileSync(f, 'utf8'));
const par = new Map();
for (const p of B.produits) { (par.get(p.slugSet) || par.set(p.slugSet, []).get(p.slugSet)).push(p); }
const rows = [...par].map(([s, l]) => ({ s, n: l.length, codes: [...new Set(l.map(x => x.codeSet))].join('|'), nbNum: l.filter(x => x.numero != null && x.numero !== '').length })).sort((a, b) => b.n - a.n);
if (!codes.length) { for (const r of rows) console.log(r.n, r.nbNum, r.codes, r.s); }
for (const c of codes) {
  const l = B.produits.filter(p => (p.codeSet || '').toLowerCase() === c.toLowerCase());
  console.log('=== ', c, l.length, 'produits');
  for (const p of l.slice(0, 14)) console.log(JSON.stringify([p.idProduct, p.numero, p.nom, p.slug, p.variante, p.fiche]));
}
