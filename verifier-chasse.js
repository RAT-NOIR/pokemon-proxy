'use strict';
// L'« orchestrateur » de la chasse : node verifier-chasse.js <dossier de chasse>
// Lit <dossier>\chasse.json, juge chaque extension (collecte-cartes/verdict-chasse.js).
// Code 0 : tout accepté ; 1 : au moins un verdict refusé ; 2 : pas de chasse.json lisible.
const fs = require('fs');
const path = require('path');
const { jugerFichier, MIN_REQUETES, MIN_LANGUES } = require('./collecte-cartes/verdict-chasse');

const dossier = process.argv[2];
if (!dossier) {
  console.log('Usage : node verifier-chasse.js <dossier de chasse>  (le dossier contient chasse.json)');
  process.exit(2);
}
const fichier = path.join(dossier, 'chasse.json');
if (!fs.existsSync(fichier)) {
  console.log('Pas de chasse.json dans ' + dossier + '. Rendu obligatoire : { "extensions": [ { "code", "set", "verdict": "trouve|introuvable", "requetes": [ { "texte", "langue", "moteur", "resultatsOuverts": [url] } ], "sources": [] } ] }.');
  console.log('Un introuvable exige au moins ' + MIN_REQUETES + ' requêtes distinctes dans au moins ' + MIN_LANGUES + ' langues. Renvoyer le dossier au chasseur.');
  process.exit(2);
}
let donnees;
try { donnees = JSON.parse(fs.readFileSync(fichier, 'utf8').replace(/^﻿/, '')); } catch (e) {
  console.log('chasse.json illisible : ' + e.message);
  process.exit(2);
}
const r = jugerFichier(donnees);
if (r.motifs.length) console.log('REFUSÉ (fichier) : ' + r.motifs.join(' ; '));
r.resultats.forEach((x, i) => {
  const code = x.code || '(extension ' + (i + 1) + ')';
  console.log((x.accepte ? 'ACCEPTÉ ' : 'REFUSÉ  ') + code + (x.motifs.length ? ' : ' + x.motifs.join(' ; ') : ''));
});
console.log('Dénominateur : ' + r.acceptes + ' acceptées / ' + r.total + ' extensions.');
if (!r.accepte) console.log('Les introuvables refusés sont renvoyés au chasseur.');
process.exit(r.accepte ? 0 : 1);
