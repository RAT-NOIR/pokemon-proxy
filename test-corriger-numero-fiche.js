// Banc PUR (faux objets) de corriger-numero-fiche.js : ce que l'outil AUTORISE, et ce qu'il refuse.
//   node test-corriger-numero-fiche.js
const assert = require('assert');
const { planifier, appliquer } = require('./corriger-numero-fiche');
const { setsTouches } = require('./collecte-cartes/garde-lot');
let ok = 0;
const t = (nom, f) => { try { f(); ok++; console.log('  ok  ' + nom); } catch (e) { console.error('  ÉCHEC  ' + nom + '\n     ' + e.message); process.exitCode = 1; } };

const sets = new Map([['GB', { _id: 'GB', tirage: 'jp', bulba: { expansion: 'Gift Box' } }], ['QC', { _id: 'QC', tirage: 'jp', bulba: { expansion: 'Quick' } }]]);
const imp = (exp, numero) => ({ impressions: [{ tirage: 'jp', expansion: exp, numero }] });
const carteDoc = (id, nomEn, attaques = []) => ({ _id: id, nomEn, attaques: attaques.map(nom => ({ nom })) });
const cartes = new Map([[1, { _id: 1, ...imp('Gift Box', '007') }], [2, { _id: 2, ...imp('Gift Box', '003') }], [3, { _id: 3, ...imp('Quick', '002') }], [4, { _id: 4, ...imp('Gift Box', '009') }]]);
const L = (id, carteId, slugSet, numeroFiche, preuve = 'carte-declarante') => ({ _id: `${carteId}|${id}`, carteId, idProduct: id, slugSet, numeroFiche, preuve });
const noms = new Map([[10, 'Potion'], [11, 'Mew ex [A | B]'], [12, 'Grovyle'], [13, 'Mewtwo'], [14, 'Mew ex']]);
const cds = new Map([['GB', [carteDoc(1, 'Potion'), carteDoc(2, 'Mew ex', ['A', 'B']), carteDoc(4, 'Mewtwo')]], ['QC', [carteDoc(3, 'Grovyle')]]]);
const base = (lignes, extra = {}) => planifier({ lignes, sets, cartes, nomsProduits: noms, cartesDuSet: cds, ...extra });

t('Gift Box : « 007L » → « 007 » (le numéro de l\'impression), forme lettre finale', () => {
    const p = base([L(10, 1, 'GB', '007L'), L(11, 2, 'GB', '003M')]);
    assert.deepStrictEqual(p.reparations.map(r => [r.idProduct, r.avant, r.apres, r.forme]), [[10, '007L', '007', 'suffixe-lettres'], [11, '003M', '003', 'suffixe-lettres']]);
    assert.strictEqual(p.refus.length, 0);
});
t('Quick : « G002 » → « 002 », forme préfixe, calibrée PAR SET (les deux sets coexistent)', () => {
    const p = base([L(10, 1, 'GB', '007L'), L(12, 3, 'QC', 'G002')]);
    assert.deepStrictEqual(p.parSet.map(s => [s.slug, s.forme]), [['GB', 'suffixe-lettres'], ['QC', 'prefixe-lettres']]);
});
t('T4b : un set DECK lit les numéros de SON deck — relancer la réparation ne mélange pas les decks (le champ `deck` du set)', () => {
    const impD = (d, n) => ({ tirage: 'jp', expansion: 'Classic', deck: d, numero: n });
    const cs = new Map([[7, { _id: 7, impressions: [impD('Venusaur Deck', '022'), impD('Charizard Deck', '023')] }]]);
    const noms2 = new Map([[70, 'Rare Candy']]), cds2 = new Map([['CLF', [carteDoc(7, 'Rare Candy')]]]);
    const run = set => planifier({ lignes: [L(70, 7, 'CLF', 'G023', 'carte-declarante')], sets: new Map([['CLF', set]]), cartes: cs, nomsProduits: noms2, cartesDuSet: cds2 });
    const sansDeck = run({ _id: 'CLF', tirage: 'jp', bulba: { expansion: 'Classic' } });
    assert.deepStrictEqual(sansDeck.reparations.map(r => r.apres), ['023'], 'sans le champ, le numéro du AUTRE deck est pris (le défaut)');
    const avecDeck = run({ _id: 'CLF', tirage: 'jp', bulba: { expansion: 'Classic' }, deck: 'Venusaur Deck' });
    assert.strictEqual(avecDeck.reparations.length, 0, 'avec le champ, aucune réparation vers un autre deck');
});
t('une ligne déjà juste n\'est pas touchée et compte dans le dénominateur', () => {
    const p = base([L(10, 1, 'GB', '007L'), L(11, 2, 'GB', '3')]);
    assert.strictEqual(p.denominateur.justes, 1); assert.strictEqual(p.reparations.length, 1);
});
t('un set dont les formes diffèrent (préfixe ET suffixe) n\'est pas réparé : listé, toutes ses lignes refusées', () => {
    const p = base([L(10, 1, 'GB', '007L'), L(11, 2, 'GB', 'X003')]);
    assert.strictEqual(p.reparations.length, 0); assert.strictEqual(p.refus.length, 2); assert.ok(/set non réparé/.test(p.refus[0].raison));
});
t('TÉMOIN DU NOM : le produit « Mewtwo » sur la carte « Mew ex » (le nom désigne une autre carte du set) est refusé', () => {
    const p = base([L(11, 2, 'GB', '003M'), L(13, 2, 'GB', '003M')]);
    assert.deepStrictEqual(p.reparations.map(r => r.idProduct), [11]); assert.ok(/AUTRE carte/.test(p.refus[0].raison));
});
t('PREUVE : une jointure par le numéro n\'est pas indépendante du numéro → refus', () => {
    const p = base([L(10, 1, 'GB', '007L', 'numero'), L(11, 2, 'GB', '003M')]);
    assert.deepStrictEqual(p.reparations.map(r => r.idProduct), [11]); assert.ok(/indépendante/.test(p.refus[0].raison));
});
t('nom du produit introuvable : le témoin ne conclut pas, la ligne reste', () => {
    const p = base([L(10, 1, 'GB', '007L'), L(99, 2, 'GB', '003M')]);
    assert.deepStrictEqual(p.reparations.map(r => r.idProduct), [10]); assert.ok(/introuvable/.test(p.refus[0].raison));
});
t('« (Top Left) » : SWSH139 est rapproché par le site, donc PAS en défaut (les 6 SWSH de T0)', () => {
    const s2 = new Map([...sets, ['SW', { _id: 'SW', tirage: 'intl', bulba: { expansion: 'SWSH' } }]]);
    const c2 = new Map([...cartes, [5, { _id: 5, impressions: [{ tirage: 'intl', expansion: 'SWSH', numero: 'SWSH139 (Top Left)' }, { tirage: 'intl', expansion: 'SWSH', numero: 'SWSH140 (Top Right)' }] }]]);
    const p = planifier({ lignes: [L(10, 1, 'GB', '007L'), L(20, 5, 'SW', 'SWSH139', 'tcgdex+impression')], sets: s2, cartes: c2, nomsProduits: noms, cartesDuSet: cds });
    assert.strictEqual(p.enDefaut, 1);
});
t('§41 : zéro ligne en défaut LÈVE (au lieu d\'imprimer « 0 à réparer »)', () => {
    assert.throws(() => base([L(10, 1, 'GB', '007')]), /aucune ligne en défaut/);
});
(async () => {
    try {
        const appels = [];
        const CP = { updateOne: async (f, u) => { appels.push([f, u]); return { modifiedCount: f.numeroFiche === '007L' ? 1 : 0 }; } };
        const n = await appliquer(CP, [{ _id: 'a', avant: '007L', apres: '007' }, { _id: 'b', avant: 'Z', apres: '1' }]);
        assert.strictEqual(n, 1); assert.deepStrictEqual(appels[0][1], { $set: { numeroFiche: '007' } }); assert.deepStrictEqual(appels[0][0], { _id: 'a', numeroFiche: '007L' });
        ok++; console.log('  ok  appliquer : ne touche que numeroFiche, et seulement si la ligne porte encore l\'ancien numéro');
    } catch (e) { console.error('  ÉCHEC  appliquer\n     ' + e.message); process.exitCode = 1; }
})();
t('GARDE DE LOT : un changement de numeroFiche seul touche le set de la ligne (lot-additif lui fait revalider le site)', () => {
    const avant = [{ _id: 'a', carteId: 1, idProduct: 10, slugSet: 'GB', numeroFiche: '007L', preuve: 'carte-declarante' }];
    const apres = [{ ...avant[0], numeroFiche: '007' }];
    const r = setsTouches({ avant: { cartes: [], cartesProduits: avant, sets: [] }, apres: { cartes: [], cartesProduits: apres, sets: [] } });
    assert.deepStrictEqual(r.sets, ['GB']);
});
console.log(`\n${ok} bancs verts`);
