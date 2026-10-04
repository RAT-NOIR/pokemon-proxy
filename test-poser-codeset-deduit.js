// Banc de decider (poser-codeset-deduit.js) : un code ne s'écrit que si l'unanimité de l'expansion (au moins 10 lignes) ET le numéro le portent.
const assert = require('assert');
const { decider } = require('./poser-codeset-deduit');
const L = (...codes) => codes.map(codeSet => ({ codeSet }));
const N = (code, n) => Array.from({ length: n }, () => ({ codeSet: code }));
const cas = [
    ['unanimité + numéro préfixé : écrit', () => assert.strictEqual(decider({ idExpansion: 1, numero: 'SM18' }, [...N('SM', 12), ...L(null)]).code, 'SM')],
    ['unanimité seule (numéro nu) : présenté', () => assert.match(decider({ idExpansion: 1, numero: '21' }, N('20th', 83)).refus, /une seule preuve/)],
    ['sans numéro : présenté', () => assert.match(decider({ idExpansion: 1, numero: null }, N('sp4', 12)).refus, /une seule preuve/)],
    ['deux codes dans l\'expansion : présenté', () => assert.match(decider({ idExpansion: 1, numero: 'SM18' }, [...N('SM', 12), ...L('SMP')]).refus, /2 codes/)],
    ['aucun code dans l\'expansion : présenté', () => assert.match(decider({ idExpansion: 1, numero: 'SM18' }, L(null, '')).refus, /aucune autre ligne/)],
    ['unanimité trop mince (2 lignes) : présenté', () => assert.match(decider({ idExpansion: 1, numero: 'SM18' }, N('SM', 2)).refus, /trop mince/)],
    ['préfixe suivi d\'une lettre (« SMP1 » pour SM) : présenté', () => assert.ok(decider({ idExpansion: 1, numero: 'SMP1' }, N('SM', 12)).refus)],
    ['casse : « sm18 » pour SM : écrit', () => assert.strictEqual(decider({ idExpansion: 1, numero: 'sm18' }, N('SM', 12)).code, 'SM')]
];
let ok = 0;
for (const [nom, f] of cas) { try { f(); ok++; console.log(`  ✅ ${nom}`); } catch (e) { console.log(`  🔴 ${nom} : ${e.message}`); } }
console.log(`${ok}/${cas.length}`);
if (ok !== cas.length) process.exit(1);
