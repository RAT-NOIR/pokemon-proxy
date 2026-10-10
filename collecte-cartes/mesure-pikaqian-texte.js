// Lecture locale (aucune requete) : texte visible d'une page HTML enregistree. Usage : node mesure-pikaqian-texte.js <html> <sortie.txt>
'use strict';
const fs = require('fs');
const [src, dst] = process.argv.slice(2);
const h = fs.readFileSync(src, 'utf8')
  .replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]+>/g, '\n').replace(/&amp;/g, '&').replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"');
fs.writeFileSync(dst, h.split('\n').map(s => s.trim()).filter(Boolean).join('\n'));
