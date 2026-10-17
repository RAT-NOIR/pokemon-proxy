// VIGN-SUITE tour 1 : un visuelSubstitut retiré ou changé fait revalider le set de la ligne, sans créer de baisse comptée.   node test-garde-lot-substituts.js
const assert = require('assert');
const { compterEtat, comparer, setsTouches } = require('./collecte-cartes/garde-lot');
let ko = 0;
const t = (nom, f) => { try { f(); console.log('  ok  ' + nom); } catch (e) { ko++; console.log('  ECHEC ' + nom + '\n     ' + String(e.message).split('\n')[0]); } };
const ligne = (vs) => ({ _id: 'l1', idExpansion: 7, idProduct: 865714, carteId: 1, slugSet: 'WCD-2016', numeroFiche: '92', preuve: 'p', ...(vs ? { visuelSubstitut: vs } : {}) });
const etat = vs => ({ cartes: [{ _id: 1, nomEn: 'X', sets: ['WCD-2016'], images: [] }], cartesProduits: [ligne(vs)], sets: [{ _id: 'WCD-2016' }] });
const SUB = { cleR2: 'tcgdex/Roaring-Skies/92-203164.webp', mention: 'm' };

t('substitut retiré : le set de la ligne est touché', () => {
    const r = setsTouches({ avant: etat(SUB), apres: etat(null) });
    assert.deepStrictEqual(r.sets, ['WCD-2016']);
});
t('substitut changé : le set de la ligne est touché', () => {
    assert.deepStrictEqual(setsTouches({ avant: etat(SUB), apres: etat({ ...SUB, cleR2: 'autre.webp' }) }).sets, ['WCD-2016']);
});
t('substitut identique (mention seule changée) : rien de touché', () => {
    assert.deepStrictEqual(setsTouches({ avant: etat(SUB), apres: etat({ ...SUB, mention: 'z' }) }).sets, []);
});
t('aucune baisse comptée ni catalogue touché par ce seul détachement', () => {
    const c = comparer(compterEtat(etat(SUB)), compterEtat(etat(null)));
    assert.strictEqual(c.baisses.length, 0); assert.strictEqual(c.nonAutorisees.length, 0);
    assert.strictEqual(setsTouches({ avant: etat(SUB), apres: etat(null) }).catalogue, false);
});
process.exit(ko ? 1 : 0);
