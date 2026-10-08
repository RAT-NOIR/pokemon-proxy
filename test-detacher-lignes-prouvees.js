// Banc de detacher-lignes-prouvees.js — SANS BASE (données fabriquées) : la décision 2026-10-08b et le rejeu de sa preuve.
const assert = require('assert');
const { DECISIONS, jugerLigne } = require('./detacher-lignes-prouvees');
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
console.log(`${ok} passés, 0 en échec`);
