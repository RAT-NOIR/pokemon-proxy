// Banc de calibrer-tcgcsv.js — la calibration de bout en bout sur de petites fixtures : justes / lâches / faux / faux relus / muets, retenue à 0 faux, ensemble vide. Aucune requête, aucune base.
'use strict';
const assert = require('assert');
const D = require('./collecte-cartes/tcgcsv-donnees');
const K = require('./calibrer-tcgcsv');

let ok = 0, ko = 0;
const test = async (nom, f) => { try { await f(); ok++; } catch (e) { ko++; console.log(`ECHEC ${nom}\n   ${(e.stack || e.message).split('\n').slice(0, 5).join('\n   ')}`); } };
const NOMS = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta'];
const cartes = (change = {}) => NOMS.map((n, i) => ({ _id: 100 + i, nomEn: change[i]?.nomEn ?? n, impressions: [{ numero: String(i + 1), total: '6' }], images: [{ set: 'Set-A', source: 'x' }] }));
const monde = o => D.assemblerCm({ sets: [{ _id: 'Set-A', tirage: 'intl' }], cartes: cartes(o), cp: NOMS.map((n, i) => ({ idProduct: 1 + i, carteId: 100 + i, slugSet: 'Set-A', numeroFiche: String(i + 1) })),
    nc: NOMS.map((n, i) => ({ idProduct: 1 + i, idExpansion: 10, slugSet: 'Set-A', codeSet: 'A', numero: String(i + 1), slug: `${n}-A${i + 1}` })), cat: NOMS.map((n, i) => ({ idProduct: 1 + i, name: n })) });
const rel = tcgNoms => ({ categories: { pokemon: 3, japon: 85 }, listes: { 3: [{ groupId: 1, name: 'Set A' }], 85: [] },
    1: { categoryId: 3, produits: tcgNoms.map((n, i) => ({ productId: 500 + i, name: `${n} - ${i + 1}/6`, number: `${i + 1}/6`, groupId: 1, rarity: 'Rare', imageUrl: `https://tcgplayer-cdn.tcgplayer.com/product/${500 + i}_200w.jpg` })) } });

(async () => {
    await test('calibrerTout : tout concorde = 6 justes, 0 faux, clé retenue', () => {
        const r = K.calibrerTout({ rel: rel(NOMS), cm: monde(), minCommuns: 1 });
        assert.deepStrictEqual([r.calibration.population, r.calibration.justes, r.calibration.faux, r.calibration.muets, r.calibration.retenue], [6, 6, 0, 0, true]);
        assert.strictEqual(r.table.lignes[0].statut, 'apparie');
    });
    await test('calibrerTout : une fiche dont le nom contredit = un FAUX, clé NON retenue ; relu à l\'œil il est compté à part et la clé est retenue', () => {
        const cm = monde({ 1: { nomEn: 'Autre' } });
        const brut = K.calibrerTout({ rel: rel(NOMS), cm });
        assert.deepStrictEqual([brut.calibration.faux, brut.calibration.retenue, brut.calibration.fauxDetail[0].idProduct], [1, false, 2]);
        const lu = K.calibrerTout({ rel: rel(NOMS), cm, fauxLus: { 2: 'la fiche nomme la carte autrement (alias Bulbapedia)' } });
        assert.deepStrictEqual([lu.calibration.faux, lu.calibration.fauxLus, lu.calibration.retenue, lu.calibration.fauxLusDetail[0].lu], [0, 1, true, 'la fiche nomme la carte autrement (alias Bulbapedia)']);
    });
    await test('calibrerTout : un produit absent du marché est MUET (compté, motif dit) ; une population sans visuel ne calibre rien (vide = non retenu)', () => {
        const r = K.calibrerTout({ rel: rel(NOMS.slice(0, 5)), cm: monde() });
        assert.strictEqual(r.calibration.muets, 1); assert.strictEqual(r.calibration.muetsParMotif['absent-de-la-source'], 1);
        const sansVisuel = D.assemblerCm({ sets: [{ _id: 'Set-A', tirage: 'intl' }], cartes: cartes().map(c => ({ ...c, images: [] })), cp: NOMS.map((n, i) => ({ idProduct: 1 + i, carteId: 100 + i, slugSet: 'Set-A', numeroFiche: String(i + 1) })),
            nc: NOMS.map((n, i) => ({ idProduct: 1 + i, idExpansion: 10, slugSet: 'Set-A', codeSet: 'A', numero: String(i + 1), slug: n })), cat: NOMS.map((n, i) => ({ idProduct: 1 + i, name: n })) });
        const v = K.calibrerTout({ rel: rel(NOMS), cm: sansVisuel });
        assert.deepStrictEqual([v.calibration.population, v.calibration.retenue], [0, false]);
    });
    await test('nom seul (calibration) : les numéros sont cachés à la clé et rendus au témoin ; 6 produits, 6 justes', () => {
        const r = K.calibrerTout({ rel: rel(NOMS), cm: monde() });
        assert.deepStrictEqual([r.nomSeul.lignes, r.nomSeul.justes, r.nomSeul.faux, r.nomSeul.retenue], [1, 6, 0, true]);
    });
    console.log(`${ok} passés, ${ko} en échec`);
    process.exitCode = ko ? 1 : 0;
})();
