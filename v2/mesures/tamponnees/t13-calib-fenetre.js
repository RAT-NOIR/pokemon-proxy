'use strict';
const DONNEES = 'C:\\Users\\Yung\\rat-market-travail\\api\\archives\\essais-repli';      // dossier des données de mesure (hors dépôt)
// GUICHET (tour 2, I3a) — CALIBRATION de la jambe « fenêtre ORB >= 30 » (et de la règle durcie : fenêtre >= 30 ET cosinus non contraire, OU cosinus >= 0,9) sur des paires dont la vérité est LUE À L'ŒIL
// (e12-calib.json : `eye` = « same » / « differ » ; `fen` = inliers de la fenêtre d'illustration, mesurés avec departage-image.js ; le cosinus p8000 est lu dans le libellé de la paire, ech-*.json).
// Elle doit rendre 0 fausse concordance sur les paires « dessin différent ».
const fs = require('fs'), path = require('path');
const calib = new Map(JSON.parse(fs.readFileSync(path.join(DONNEES, 'e12-calib.json'), 'utf8')).map(x => [x.id, x]));
const cosDe = new Map();
for (const f of ['ech-meme.json', 'ech-different.json', 'ech-indec.json', 'ech-soeurMeme.json', 'ech-soeurDiff.json']) for (const x of JSON.parse(fs.readFileSync(path.join(DONNEES, f), 'utf8'))) { const m = /cos ([0-9.]+)/.exec(x.label || ''); if (m && !cosDe.has(x.id)) cosDe.set(x.id, +m[1]); }
const lignes = [...calib.values()].filter(c => ['same', 'differ'].includes(c.eye) && Number.isFinite(c.fen)).map(c => ({ id: c.id, eye: c.eye, fen: c.fen, cos: cosDe.has(c.id) ? cosDe.get(c.id) : null }));
const same = lignes.filter(l => l.eye === 'same'), diff = lignes.filter(l => l.eye === 'differ');
console.log('paires lues à l\'œil avec une fenêtre mesurée :', lignes.length, '| même dessin', same.length, '| dessin différent', diff.length, '| dont un cosinus connu : même', same.filter(l => l.cos !== null).length, ', différent', diff.filter(l => l.cos !== null).length);
const R = {
    'fenêtre >= 30 (jambe seule)': l => l.fen >= 30,
    'cosinus >= 0,9 (jambe seule)': l => l.cos !== null && l.cos >= 0.9,
    'ANCIENNE règle : fenêtre >= 30 OU cosinus >= 0,9': l => l.fen >= 30 || (l.cos !== null && l.cos >= 0.9),
    'RÈGLE DURCIE : (fenêtre >= 30 OU cosinus >= 0,9) ET cosinus non contraire (>= 0,7 ou inconnu)': l => (l.fen >= 30 || (l.cos !== null && l.cos >= 0.9)) && !(l.cos !== null && l.cos < 0.7)
};
for (const [nom, f] of Object.entries(R)) console.log(nom.padEnd(95), 'même dessin acceptées', f.name, same.filter(f).length + '/' + same.length, '| FAUSSES CONCORDANCES (dessin différent accepté)', diff.filter(f).length + '/' + diff.length);
console.log('fenêtre des paires « dessin différent » :', diff.map(l => l.fen).sort((a, b) => a - b).join(' '));
console.log('cosinus des paires « dessin différent » (connus) :', diff.filter(l => l.cos !== null).map(l => l.cos).sort((a, b) => a - b).join(' '));
console.log('fenêtre des paires « même dessin » :', same.map(l => l.fen).sort((a, b) => a - b).join(' '));
console.log('fausses concordances de la jambe fenêtre >= 30 :', JSON.stringify(diff.filter(l => l.fen >= 30)));
