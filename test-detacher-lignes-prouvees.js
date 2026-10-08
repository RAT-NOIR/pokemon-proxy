// Banc de detacher-lignes-prouvees.js — SANS BASE (données fabriquées) : les décisions 2026-10-08b (Lumineon) et 2026-10-08c (Garchomp).
const assert = require('assert');
const { DECISIONS, jugerLigne, estInterdite } = require('./detacher-lignes-prouvees');
let ok = 0;
const t = (nom, f) => { f(); ok++; console.log('  ok', nom); };

const D = DECISIONS['2026-10-08b'];
t('la décision 2026-10-08b existe et ne contient que 262554|692805', () => {
    assert.ok(D, 'décision absente');
    assert.deepStrictEqual(D.map(x => x.id), ['262554|692805']);
    assert.strictEqual(D[0].autre, 267492);
    assert.strictEqual(D[0].type, 'fiche-contredite-par-les-attaques');
});
t('les décisions antérieures sont intactes (26 et 2 lignes)', () => {
    assert.strictEqual(DECISIONS['2026-09-25'].length, 26);
    assert.strictEqual(DECISIONS['2026-10-08'].length, 2);
});

const x = D && D[0];
const nom = 'Lumineon V [Luminous Sign | Aqua Return]';
const mareep = { nomEn: 'Mareep', attaques: [{ nom: 'Tail Whap' }] };
const lumineon = { nomEn: 'Lumineon V', attaques: [{ nom: 'Luminous Sign' }, { nom: 'Aqua Return' }] };
t('la preuve rejouée contredit la ligne quand les attaques désignent l\'autre carte ET que le nom diffère', () => {
    const r = jugerLigne(x, nom, mareep, lumineon);
    assert.ok(r.verdict, 'devrait être contredite');
});
t('la preuve rejouée REFUSE si l\'autre carte ne porte plus les attaques', () => {
    const r = jugerLigne(x, nom, mareep, { nomEn: 'Lumineon V', attaques: [] });
    assert.strictEqual(r.verdict, null);
});
t('la preuve rejouée REFUSE si le nom ne contredit plus (carte jointe = Lumineon V)', () => {
    const r = jugerLigne(x, nom, lumineon, lumineon);
    assert.strictEqual(r.verdict, null);
});
t('refuse si l\'autre carte est absente', () => {
    assert.strictEqual(jugerLigne(x, nom, mareep, null).verdict, null);
});

// ---- Garchomp SP Half Deck + Gastly (feu vert nommé du 2026-10-08) ----
const G = DECISIONS['2026-10-08c'];
const ATTENDU = ['158470|676469', '158471|676470', '157992|676471', '158472|676472', '157993|676473', '154852|676474', '158473|676476', '339431|860026'];
t('2026-10-08c : exactement les 8 lignes nommées, ni 154845|676475 ni Eldegoss', () => {
    assert.ok(G, 'décision absente');
    assert.deepStrictEqual(G.map(l => l.id).sort(), [...ATTENDU].sort());
    assert.ok(!G.some(l => /\|481749$/.test(l.id) || l.id === '154845|676475'));
});
t('Eldegoss V 481749 est interdit, même donné à l\'outil', () => {
    assert.strictEqual(estInterdite('244962|481749'), true);
    assert.strictEqual(estInterdite('999|481749'), true);
    assert.strictEqual(estInterdite('158470|676469'), false);
    const r = jugerLigne({ id: '244962|481749', preuve: 'nom', type: 'x' }, 'Eldegoss V [Happy Match | Float Up]', { nomEn: 'Gloom', attaques: [] }, null);
    assert.strictEqual(r.verdict, null, 'un produit interdit ne se juge jamais contredit');
});
const g = G && G.find(l => l.id === '158470|676469');
const milotic = 'Milotic [C] Lv.58 [Aqua Tail | Wrap]';
const magikarp = { nomEn: 'Magikarp', attaques: [{ nom: 'Soggy Rush' }] };
t('Garchomp : nom ≠ carte ET aucune attaque du produit sur la carte → contredite', () => {
    assert.ok(g && jugerLigne(g, milotic, magikarp, null).verdict);
});
t('Garchomp : REFUSE si la carte porte une attaque du produit (la preuve ne tient plus)', () => {
    assert.strictEqual(jugerLigne(g, milotic, { nomEn: 'Magikarp', attaques: [{ nom: 'Wrap' }] }, null).verdict, null);
});
t('Garchomp : REFUSE si le nom ne contredit plus (carte = Milotic)', () => {
    assert.strictEqual(jugerLigne(g, milotic, { nomEn: 'Milotic', attaques: [{ nom: 'Soggy Rush' }] }, null).verdict, null);
});
t('Garchomp : REFUSE si le produit n\'a aucune attaque entre crochets (le nom seul ne suffit pas pour cette preuve)', () => {
    assert.strictEqual(jugerLigne(g, 'Milotic', magikarp, null).verdict, null);
});
const gas = G && G.find(l => l.id === '339431|860026');
t('Gastly : nom du produit « Hole-Digging Shovel » ≠ Gastly → contredite ; REFUSE si la carte s\'appelle Hole-Digging Shovel', () => {
    assert.ok(gas && jugerLigne(gas, 'Hole-Digging Shovel', { nomEn: 'Gastly' }, null).verdict);
    assert.strictEqual(jugerLigne(gas, 'Hole-Digging Shovel', { nomEn: 'Hole-Digging Shovel' }, null).verdict, null);
});
console.log(`${ok} passés, 0 en échec`);
