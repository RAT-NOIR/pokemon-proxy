// Banc de la décision 2026-10-17 de detacher-lignes-prouvees.js (VIGN-AUDIT2, famille G) — SANS BASE.
const assert = require('assert');
const { DECISIONS, jugerLigne } = require('./detacher-lignes-prouvees');
let ok = 0, ko = 0;
const t = (nom, f) => { try { f(); ok++; console.log('  ok   ' + nom); } catch (e) { ko++; console.log('  ECHEC ' + nom + ' : ' + e.message); } };

const ATTENDUES = ['158475|676477', '148517|676478', '25165|676479', '158409|676480', '120958|676481', '126640|676482', '158418|676483',
    '282245|796963', '282977|796964', '255447|786632', '226932|826648', '188047|563109', '188048|563110', '196231|563111', '13686|885573'];
t('la décision 2026-10-17 existe, liste FERMÉE de 15 lignes exactement', () => {
    const D = DECISIONS['2026-10-17'];
    assert.ok(Array.isArray(D), 'décision absente');
    assert.deepStrictEqual(D.map(x => x.id).sort(), [...ATTENDUES].sort());
});
t('chaque ligne porte la preuve « nom » (les produits sans attaque ne se jugent pas par les attaques) et une phrase', () => {
    for (const x of DECISIONS['2026-10-17'] || []) { assert.strictEqual(x.preuve, 'nom', x.id); assert.ok(x.pourquoi && x.pourquoi.length > 20, x.id); assert.ok(x.type, x.id); }
});
t('le témoin « nom » contredit encore chaque cas, rejoué sur des données fabriquées', () => {
    const cas = [['Switch', 'Rare Candy'], ['Victini ex [Strafe | Victory Flame]', 'Arctibax'], ['Water Energy', 'Krabby'], ['Magikarp [Vigorous Leap]', 'Basic Fighting Energy'], ['Tornadus GX [Gust | Wild Fury | Destructive Cyclone GX]', 'Zoroark']];
    for (const [p, c] of cas) assert.ok(jugerLigne({ id: 'x|1', preuve: 'nom' }, p, { nomEn: c }, null).verdict, p);
});
t('un produit dont le nom EST celui de la carte n\'est pas contredit', () => {
    assert.strictEqual(jugerLigne({ id: 'x|1', preuve: 'nom' }, 'Arctibax [Sharp Fin | Frost Smash]', { nomEn: 'Arctibax' }, null).verdict, null);
});
t('les décisions antérieures sont intactes', () => {
    assert.strictEqual(DECISIONS['2026-09-25'].length, 26); assert.strictEqual(DECISIONS['2026-10-08c'].length, 8);
});
console.log(`${ok} passés, ${ko} en échec`);
process.exit(ko ? 1 : 0);
