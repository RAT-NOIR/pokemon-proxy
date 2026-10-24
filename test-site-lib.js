// node test-site-lib.js — où la règle R lit les fonctions du site : par défaut `../../rat-market-site/lib` (le dépôt principal, Desktop\pokemon-proxy), et pour une COPIE de travail
// (un worktree sous rat-market-travail\catalogue) `RAT_MARKET_SITE_LIB=<dossier>` — jamais une jonction (CLAUDE.md : aucune jonction, `git worktree remove` les traverse).
const path = require('path');
const { siteLib } = require('./collecte-cartes/regle-r-fiches');
let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => { const a = JSON.stringify(obtenu), b = JSON.stringify(attendu); if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); } };
const d = path.join('X:', 'depot', 'collecte-cartes');
verifier('sans variable : le dossier voisin du dépôt, comme avant', siteLib({}, d), path.join('X:', 'rat-market-site', 'lib'));
verifier('variable vide : ignorée (un vide n\'est pas un chemin)', siteLib({ RAT_MARKET_SITE_LIB: '' }, d), path.join('X:', 'rat-market-site', 'lib'));
verifier('variable posée : son dossier', siteLib({ RAT_MARKET_SITE_LIB: path.join('Y:', 'site', 'lib') }, d), path.join('Y:', 'site', 'lib'));
console.log(`\n${ok} passés, ${ko} en échec`);
process.exit(ko ? 1 : 0);
