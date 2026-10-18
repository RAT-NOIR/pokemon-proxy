// A charger EN PREMIER par tout banc qui peut toucher un client ou un collecteur : les arrets et pauses durables d'hotes vivent HORS de l'arbre du code (voir reponse-hote.js, ARRETS_HOTES_DOSSIER) ;
// un banc n'ecrit JAMAIS dans le vrai dossier : il prend un dossier TEMPORAIRE (sauf si le banc en a deja choisi un).
const fs = require('fs'), os = require('os'), path = require('path');
if (!process.env.ARRETS_HOTES_DOSSIER) process.env.ARRETS_HOTES_DOSSIER = fs.mkdtempSync(path.join(os.tmpdir(), 'arrets-hotes-banc-'));
module.exports = process.env.ARRETS_HOTES_DOSSIER;
// le bandeau « ARRET DEFINITIF » (reponse-hote.js, arretHote) est imprime en gros en production ; un banc le tait (il fait des centaines d'arrets simules) - sauf s'il le capture lui-meme.
const erreurOrigine = console.error.bind(console);
console.error = (...a) => { if (typeof a[0] === 'string' && a[0].includes('\u2588'.repeat(20))) return; erreurOrigine(...a); };
