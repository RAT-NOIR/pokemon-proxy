// Lecture locale (aucune requete) : tuiles d'une page de set pikaqian enregistree. Usage : node mesure-pikaqian-set.js <html> [sortie.json]
'use strict';
const fs = require('fs');
const [src, dst] = process.argv.slice(2);
const h = fs.readFileSync(src, 'utf8');
const re = /<a class="w-full group" data-discover="true" href="\/cards\/([0-9a-f-]{36})">[\s\S]*?alt="([^"]*)" src="([^"]+)"[\s\S]*?<h2[^>]*>([^<]*)<\/h2><p[^>]*>([^<]*)<!-- --> · ([^<]*)<\/p>/g;
const tuiles = [];
let m;
while ((m = re.exec(h))) tuiles.push({ id: m[1], alt: m[2], img: m[3], nom: m[4], set: m[5], numero: m[6] });
const parNum = {};
for (const t of tuiles) (parNum[t.numero] = parNum[t.numero] || []).push(t.nom);
const multi = Object.entries(parNum).filter(([, v]) => v.length > 1);
console.log('tuiles :', tuiles.length, '| numeros distincts :', Object.keys(parNum).length, '| numeros a plusieurs tuiles :', multi.length);
console.log('sans image :', tuiles.filter(t => !/^https:\/\/images\.pikaqian\.com\//.test(t.img)).length);
console.log('exemples multi :', JSON.stringify(multi.slice(0, 5)));
console.log('foiliness dans le flux :', [...new Set([...h.matchAll(/foiliness\\",\\"([a-z_]+)/g)].map(x => x[1]))].join(','));
if (dst) fs.writeFileSync(dst, JSON.stringify(tuiles));
