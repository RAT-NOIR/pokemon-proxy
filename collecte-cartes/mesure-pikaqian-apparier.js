// Lecture locale : apparie nos produits zh-hans (base.json) aux tuiles pikaqian (set.json) par set + numero + variante.
// Variante : seule la tuile SANS suffixe de foil (Reverse Holo, Pokeball Holo, Master Ball Holo...) est une candidate ; les autres sont
// d'AUTRES produits. Preuve : numero egal, nom egal (apres retrait des crochets d'attaques), une seule tuile candidate, un seul produit.
// Usage : node mesure-pikaqian-apparier.js <base.json> <CODE nos> <tuiles.json>
'use strict';
const fs = require('fs');
const [fb, code, ft] = process.argv.slice(2);
const B = JSON.parse(fs.readFileSync(fb, 'utf8'));
const T = JSON.parse(fs.readFileSync(ft, 'utf8'));
const dec = s => s.replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"');
const norm = s => dec(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const SUFFIXE = /\s+(reverse holo|pokeball holo|master ball holo|poke ball holo|holo|cosmos holo|[a-z ]+ holo)$/i;
const nosProduits = B.produits.filter(p => (p.codeSet || '').toLowerCase() === code.toLowerCase());
const parNum = new Map();
for (const t of T) (parNum.get(t.numero) || parNum.set(t.numero, []).get(t.numero)).push(t);
const nbParNumNos = new Map();
for (const p of nosProduits) nbParNumNos.set(p.numero, (nbParNumNos.get(p.numero) || 0) + 1);
let ok = 0, sansTuile = 0, ambigu = 0, nomDiff = 0, doublonNos = 0;
const diffs = [];
for (const p of nosProduits) {
  if (nbParNumNos.get(p.numero) > 1) { doublonNos++; continue; }
  const ts = (parNum.get(p.numero) || []);
  const bases = ts.filter(t => !SUFFIXE.test(dec(t.nom)));
  if (!ts.length) { sansTuile++; continue; }
  if (bases.length !== 1) { ambigu++; diffs.push(['ambigu', p.numero, p.nom, ts.map(t => t.nom)]); continue; }
  const nomNos = norm(p.nom.replace(/\s*\[.*$/, ''));
  const nomPk = norm(bases[0].nom);
  if (nomNos === nomPk) ok++; else { nomDiff++; diffs.push(['nom', p.numero, p.nom, bases[0].nom]); }
}
console.log(code, '| nos produits sans visuel :', nosProduits.length, '| tuiles pikaqian :', T.length);
console.log('  apparies (set+numero+nom+base unique) :', ok, '| numero sans tuile :', sansTuile, '| base ambigue :', ambigu, '| nom different :', nomDiff, '| numero en double chez nous :', doublonNos);
for (const d of diffs.slice(0, 12)) console.log('  ', JSON.stringify(d));
