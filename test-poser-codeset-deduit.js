// Banc de decider (poser-codeset-deduit.js) : un code ne s'écrit que si l'unanimité de l'expansion ET le numéro le portent.
const assert = require('assert');
const { decider } = require('./poser-codeset-deduit');
const L = (...codes) => codes.map(codeSet => ({ codeSet }));
const cas = [
    ['unanimité + numéro préfixé : écrit', () => assert.strictEqual(decider({ idExpansion: 1, numero: 'SM18' }, L('SM', 'SM', null)).code, 'SM')],
    ['unanimité seule (numéro nu) : présenté', () => assert.match(decider({ idExpansion: 1, numero: '21' }, L('20th', '20th')).refus, /une seule preuve/)],
    ['sans numéro : présenté', () => assert.match(decider({ idExpansion: 1, numero: null }, L('sp4')).refus, /une seule preuve/)],
    ['deux codes dans l\'expansion : présenté', () => assert.match(decider({ idExpansion: 1, numero: 'SM18' }, L('SM', 'SMP')).refus, /2 codes/)],
    ['aucun code dans l\'expansion : présenté', () => assert.match(decider({ idExpansion: 1, numero: 'SM18' }, L(null, '')).refus, /aucune autre ligne/)],
    ['préfixe suivi d\'une lettre (« SMP1 » pour SM) : présenté', () => assert.ok(decider({ idExpansion: 1, numero: 'SMP1' }, L('SM')).refus)],
    ['casse : « sm18 » pour SM : écrit', () => assert.strictEqual(decider({ idExpansion: 1, numero: 'sm18' }, L('SM')).code, 'SM')]
];
let ok = 0;
for (const [nom, f] of cas) { try { f(); ok++; console.log(`  ✅ ${nom}`); } catch (e) { console.log(`  🔴 ${nom} : ${e.message}`); } }
console.log(`${ok}/${cas.length}`);
if (ok !== cas.length) process.exit(1);
