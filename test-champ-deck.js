// Banc PUR (T4b fix1) : le DECK d'un set est ÉCRIT sur son document (champ `deck`) et RELU par corriger-numero-fiche.js — une citation sans ligne exécutable n'est pas une garde.
const assert = require('assert');
const { CHAMP_DECK, champsDeck } = require('./collecte-cartes/set-deck');
const { PROJECTION_SETS } = require('./corriger-numero-fiche');
let ok = 0;
const t = (nom, f) => { try { f(); ok++; console.log('  ok  ' + nom); } catch (e) { console.error('  ÉCHEC  ' + nom + '\n     ' + e.message); process.exitCode = 1; } };
t('le champ s\'appelle `deck` (sets.deck, chaîne)', () => assert.strictEqual(CHAMP_DECK, 'deck'));
t('un set deck écrit { deck } ; un set sans deck n\'écrit RIEN (les 7 sets du lot 6 restent tels quels)', () => {
    assert.deepStrictEqual(champsDeck({ deck: 'Dialga Half Deck' }), { deck: 'Dialga Half Deck' });
    assert.deepStrictEqual(champsDeck({ deck: null }), {}); assert.deepStrictEqual(champsDeck({}), {});
});
t('corriger-numero-fiche.js RELIT le champ : il est dans la projection des sets', () => assert.strictEqual(PROJECTION_SETS[CHAMP_DECK], 1));
console.log(process.exitCode ? `\n${ok} ok, ÉCHECS ci-dessus` : `\n${ok}/${ok} passés, 0 échec`);
