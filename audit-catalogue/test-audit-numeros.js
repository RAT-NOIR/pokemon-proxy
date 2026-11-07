'use strict';
// Banc de la règle des numéros attendus (sous-séries à numéro préfixé) — lectures FABRIQUÉES, aucune base. node audit-catalogue/test-audit-numeros.js
const assert = require('assert');
const { numerosAttendus } = require('./numeros-attendus');
const A = require('./audit-sets');

let ok = 0, ko = 0;
const test = (nom, f) => { try { f(); ok++; console.log('  ok  ' + nom); } catch (e) { ko++; console.log('  ÉCHEC ' + nom + '\n        ' + String(e.message).split('\n')[0]); } };

const suite = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => String(a + i));
const pref = (p, n, largeur = 2) => Array.from({ length: n }, (_, i) => p + String(i + 1).padStart(largeur, '0'));

// ── cas réels (comptes mesurés, PLAN-SERIES-0711)
test('BRS : 186 + 30 TG, total 216 → 0 manquant', () => {
    const r = numerosAttendus({ totalImprime: 216, numerosPresents: [...suite(1, 186), ...pref('TG', 30)] });
    assert.deepStrictEqual(r.manquants, []); assert.strictEqual(r.principaux, 186); assert.strictEqual(r.prefixes, 30);
});
test('CRZ : 160 + 70 GG, total 230 → 0 manquant', () => {
    assert.deepStrictEqual(numerosAttendus({ totalImprime: 230, numerosPresents: [...suite(1, 160), ...pref('GG', 70)] }).manquants, []);
});
test('HIF : 73 + 94 SV, total 167 → 0 manquant', () => {
    assert.deepStrictEqual(numerosAttendus({ totalImprime: 167, numerosPresents: [...suite(1, 73), ...pref('SV', 94, 1)] }).manquants, []);
});
test('UF : 115 + 28 Unown (A-Z ! ?), total 143 → 0 manquant', () => {
    const unown = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].concat(['!', '?']);
    assert.deepStrictEqual(numerosAttendus({ totalImprime: 143, numerosPresents: [...suite(1, 115), ...unown] }).manquants, []);
});
// ── de vrais manquants restent
test('vrai manquant principal : n° 50 absent sur 1..100', () => {
    const r = numerosAttendus({ totalImprime: 100, numerosPresents: suite(1, 100).filter(n => n !== '50') });
    assert.deepStrictEqual(r.manquants, ['50']);
});
test('vrai manquant avec préfixés : BRS sans le n° 186 → seul 186 manque', () => {
    const r = numerosAttendus({ totalImprime: 216, numerosPresents: [...suite(1, 185), ...pref('TG', 30)] });
    assert.deepStrictEqual(r.manquants, ['186']);
});
test('vrai manquant au milieu avec préfixés : n° 50 absent', () => {
    const r = numerosAttendus({ totalImprime: 216, numerosPresents: [...suite(1, 186).filter(n => n !== '50'), ...pref('TG', 30)] });
    assert.deepStrictEqual(r.manquants, ['50']);
});
test('total qui ne contient pas les préfixés (P + Q > T) : N = T, secrètes au-delà ne manquent pas', () => {
    const r = numerosAttendus({ totalImprime: 195, numerosPresents: [...suite(1, 215), ...pref('TG', 30)] });
    assert.deepStrictEqual(r.manquants, []); assert.strictEqual(r.attendu, 195);
});
test('total principal seul, un principal dépasse T, trou au milieu : compté sur 1..T', () => {
    const r = numerosAttendus({ totalImprime: 100, numerosPresents: [...suite(1, 105).filter(n => n !== '40'), ...pref('RC', 15)] });
    assert.deepStrictEqual(r.manquants, ['40']);
});
test('GEN : 83 principaux + 34 préfixés dont 2 hors total, total 115 → 0 manquant', () => {
    assert.deepStrictEqual(numerosAttendus({ totalImprime: 115, numerosPresents: [...suite(1, 83), ...pref('RC', 34)] }).manquants, []);
});
test('GEN avec le n° 82 absent (au-dessus de T − Q) : il est compté', () => {
    assert.deepStrictEqual(numerosAttendus({ totalImprime: 115, numerosPresents: [...suite(1, 83).filter(n => n !== '82'), ...pref('RC', 34)] }).manquants, ['82']);
});
test('le n° 1 absent est un manquant', () => {
    assert.deepStrictEqual(numerosAttendus({ totalImprime: 5, numerosPresents: ['2', '3', '4', '5'] }).manquants, ['1']);
});
test('un préfixé dont le suffixe est numérique (« TG01 », « SV94 ») n\'est pas un principal', () => {
    const r = numerosAttendus({ totalImprime: 4, numerosPresents: ['1', '2', 'TG01', 'SV94'] });
    assert.strictEqual(r.principaux, 2); assert.strictEqual(r.prefixes, 2);
});
test('témoin annexes : T=100, principaux 1..95, 5 annexes « 101a » → 96..100 manquent, annexes ni P ni Q', () => {
    const r = numerosAttendus({ totalImprime: 100, numerosPresents: [...suite(1, 95), '101A', '102A', '12A', '13A', '14A'] });
    assert.deepStrictEqual(r.manquants, suite(96, 100)); assert.strictEqual(r.prefixes, 0); assert.strictEqual(r.annexes, 5); assert.strictEqual(r.principaux, 95);
    assert.ok(r.libelle.includes('5 annexes ignorées'));
});
test('témoin Q partiel : 10 TG présents sur 30 (T 216) → numéros en queue signalés, et le libellé le dit', () => {
    const r = numerosAttendus({ totalImprime: 216, numerosPresents: [...suite(1, 186), ...pref('TG', 10)] });
    assert.strictEqual(r.attendu, 206); assert.deepStrictEqual(r.manquants, suite(187, 206));
    assert.ok(r.libelle.includes('signalés à tort') && r.libelle.includes('ne sont pas surveillés'), r.libelle);
});
test('libellé m6 : « 110 principaux dont 34 au-delà du total 76 »', () => {
    const r = numerosAttendus({ totalImprime: 76, numerosPresents: suite(1, 110) });
    assert.ok(r.libelle.includes('110 principaux dont 34 au-delà du total 76'), r.libelle);
});
test('formes de sous-série : TG01 GG70 SV94 H1 RC3 SH4 RT6 A ! ? comptent ; « 12A » non', () => {
    const r = numerosAttendus({ totalImprime: 20, numerosPresents: ['TG01', 'GG70', 'SV94', 'H1', 'RC3', 'SH4', 'RT6', 'A', '!', '?', '12A'] });
    assert.strictEqual(r.prefixes, 10); assert.strictEqual(r.annexes, 1);
});
test('TM / UD : un numéro de lettres seules (« FOUR », « THREE ») est une sous-série → 0 manquant', () => {
    assert.deepStrictEqual(numerosAttendus({ totalImprime: 103, numerosPresents: [...suite(1, 102), 'FOUR'] }).manquants, []);
    assert.deepStrictEqual(numerosAttendus({ totalImprime: 91, numerosPresents: [...suite(1, 90), 'THREE'] }).manquants, []);
});
test('m6 : secrètes au-delà du total (1..110, total 76), 72/74/76 absents → restent manquants', () => {
    const r = numerosAttendus({ totalImprime: 76, numerosPresents: suite(1, 110).filter(n => !['72', '74', '76'].includes(n)) });
    assert.deepStrictEqual(r.manquants, ['72', '74', '76']);
});
test('limite écrite : fin de suite absente sans principal au-delà de T avec préfixés → non vue', () => {
    assert.deepStrictEqual(numerosAttendus({ totalImprime: 100, numerosPresents: [...suite(1, 90), ...pref('RC', 15)] }).manquants, []);
});
test('zéros de tête : « 006 » et « 6 » ne sont pas deux numéros (déjà normalisés par le site : « 6 »)', () => {
    assert.deepStrictEqual(numerosAttendus({ totalImprime: 3, numerosPresents: ['1', '2', '3'] }).manquants, []);
});
// ── sans total
test('set sans total imprimé : rien d\'attendu, rien de manquant', () => {
    const r = numerosAttendus({ totalImprime: null, numerosPresents: suite(1, 10) });
    assert.strictEqual(r.attendu, null); assert.deepStrictEqual(r.manquants, []);
});
test('total non entier / nul : traité comme sans total', () => {
    assert.strictEqual(numerosAttendus({ totalImprime: 0, numerosPresents: ['1'] }).attendu, null);
    assert.strictEqual(numerosAttendus({ totalImprime: NaN, numerosPresents: ['1'] }).attendu, null);
});
test('aucun préfixé : comportement d\'avant (1..T)', () => {
    assert.deepStrictEqual(numerosAttendus({ totalImprime: 5, numerosPresents: ['1', '2', '4'] }).manquants, ['3', '5']);
});
test('le libellé dit T = P principaux + Q préfixés', () => {
    const r = numerosAttendus({ totalImprime: 216, numerosPresents: [...suite(1, 186), ...pref('TG', 30)] });
    assert.ok(r.libelle.includes('total imprimé 216 = 186 principaux + 30 préfixés'), r.libelle);
});

// ── intégration : l'audit lui-même n'invente plus de manquants (lecture fabriquée, BRS en miniature : 5 + 3 TG, total 8)
const normaliserNumero = n => (n == null || String(n).trim() === '' ? null : String(n).trim().toUpperCase().replace(/^0+(?=\d)/, ''));
const regles = {
    impressionDuSet: (imp, c) => imp.tirage === c.tirage && c.expansions.includes(imp.expansion), normaliserNumero,
    memeCodeSaufFin: () => false, exclure: s => ({ set: s.set, trous: s.trous, manque: s.manque, exclus: [], sansObjet: [] }),
    expansionsDuSet: s => [s.bulba.expansion], tirageDuSet: s => s.tirage, editionLocaleDuSet: () => null,
    imageDeLImpression: () => null, visuelAdmisPourLaRegion: () => true,
};
const carteN = (n) => ({ _id: 'c' + n, nomEn: 'Nom' + n, pv: '60', attaques: ['A' + n], sets: ['S1'], images: [], impressions: [{ tirage: 'intl', expansion: 'Exp', numero: n, total: '5' }] });
const lectureDe = nums => ({ sets: [{ _id: 'S1', code: 'S1', nomAffichage: 'Set Un', tirage: 'intl', region: 'intl', totalImprime: 8, idExpansion: [10], bulba: { expansion: 'Exp' }, deck: null }],
    cartes: nums.map(carteN), lignes: [], produits: [], numerosProduits: [], offresParExpansion: {}, trousNommes: {}, restesParProduit: {} });
test('audit : 5 principaux + 3 TG, total 8 → 0 manquant et libellé porté', () => {
    const s = A.auditer(lectureDe(['1', '2', '3', '4', '5', 'TG01', 'TG02', 'TG03']), regles).sets[0];
    assert.strictEqual(s.manquants.n, 0, JSON.stringify(s.manquants.items));
    assert.ok(/total imprimé 8 = 5 principaux \+ 3 préfixés/.test(s.attenduDetail.libelle));
});
test('audit : le n° 3 absent reste un manquant, avec ses préfixés présents', () => {
    const s = A.auditer(lectureDe(['1', '2', '4', '5', 'TG01', 'TG02', 'TG03']), regles).sets[0];
    assert.deepStrictEqual(s.manquants.items.map(m => m.numero), ['3']);
});

console.log(`\n${ok} passés, ${ko} en échec`);
process.exit(ko ? 1 : 0);
