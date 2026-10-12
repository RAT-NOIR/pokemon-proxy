'use strict';
// Lot JA, tour 1 (2026-10-13) — une image SANS numéro ne se joint PAS par le nom à une carte qui porte au moins 2 numéros dans le set.
// Cas réels : sm1+ Basic Grass Energy (carte 60754, numéros ∅ et 068), sm2+ Basic Darkness Energy (carte 23485, numéros 066 et ∅) : l'image sans numéro rendait le
// document « ambigu » pour la règle du site et faisait basculer tout le set « par document » (68 → 53 fiches, 66 → 52). Sans réseau, sans base : joindreImages en simulation.
//   node test-garde-sans-numero.js
const assert = require('assert');
const { joindreImages } = require('./collecteur-images.js');
let ok = 0, ko = 0;
const t = async (nom, f) => { try { await f(); ok++; console.log('  ✅', nom); } catch (e) { ko++; console.log('  ❌', nom, '—', e.message); } };
const lean = v => ({ lean: async () => v, select() { return this; } });
const L = { code: 'XT', exp: 1, nom: 'Set test', slugSet: 'Set-test', bulba: { tirage: 'jp', expansion: 'Set test', sansPage: true } };
const S = { source: 'artofpkm', code: 'XT', ids: [7], noms: ['Set test'], gardeSansNumero: true };   // tour 2 : la parade est DÉCLARÉE par la ligne (IPB, déjà servi, ne la déclare pas)
const S_IPB = { source: 'artofpkm', code: 'IPB', ids: [7], noms: ['Set test'] };
const imp = numero => ({ tirage: 'jp', expansion: 'Set test', numero });
const carte = (id, nomEn, numeros) => ({ _id: id, nomEn, sets: ['Set-test'], impressions: numeros.map(imp), images: [] });
const image = (n, nomEn, numero, sha) => ({ _id: `artofpkm/7/${n}`, source: 'artofpkm', sourceSetId: 7, n, titre: `${nomEn}, Set test`, cleR2: `artofpkm/7/${n}.webp`, sha256: sha, w: 600, h: 840, fmt: 'webp', urlOriginal: 'x', numero, nomEn, etat: 'ok', set: 'Set-test' });
const fauxM = (cartes, images) => ({
    Carte: { find(q) { return lean(JSON.parse(JSON.stringify(q.sets ? cartes.filter(c => c.sets.includes(q.sets)) : cartes))); } },
    Image: { find() { return lean(images); } }
});
const rejouer = async (cartes, images, Sx = S) => joindreImages(fauxM(cartes, images), L, 'Set-test', Sx, { 7: images.map(i => ({ n: i.n, sourceSetId: 7, titre: i.titre })) }, {}, __dirname + '/rapports-sim', { silencieux: true, simuler: true });

(async () => {
    await t('(sm1+) une image sans numéro d\'une Énergie aux numéros ∅ et 068 : refusée, NOMMÉE ; l\'image numérotée 068 reste jointe', async () => {
        const r = await rejouer([carte(60754, 'Basic Grass Energy', [null, '068'])], [image(68, 'Basic Grass Energy', '068', 'a'), image(69, 'Basic Grass Energy', null, 'b')]);
        assert.deepStrictEqual(r.nouvelles.map(n => n.cleR2), ['artofpkm/7/68.webp']);
        assert.strictEqual(r.restes['image-sans-numero-carte-numerotee'], 1, JSON.stringify(r.restes));
    });
    await t('(sm2+) idem avec les numéros 066 et ∅ : seule l\'image 066 reste', async () => {
        const r = await rejouer([carte(23485, 'Basic Darkness Energy', ['066', null])], [image(66, 'Basic Darkness Energy', '066', 'a'), image(67, 'Basic Darkness Energy', null, 'b')]);
        assert.deepStrictEqual(r.nouvelles.map(n => n.cleR2), ['artofpkm/7/66.webp']);
        assert.strictEqual(r.restes['image-sans-numero-carte-numerotee'], 1);
    });
    await t('une carte à deux numéros réels (052 et 059) dont l\'image n\'a pas de numéro : refusée aussi (le nom ne dit pas laquelle)', async () => {
        const r = await rejouer([carte(1, 'Rowlet', ['052', '059'])], [image(1, 'Rowlet', null, 'a')]);
        assert.strictEqual(r.nouvelles.length, 0); assert.strictEqual(r.restes['image-sans-numero-carte-numerotee'], 1);
    });
    await t('RIEN NE CHANGE hors du cas : une carte à UN numéro (ou aucun, les Gym) reçoit toujours l\'image sans numéro par le nom', async () => {
        const r = await rejouer([carte(1, 'Misty', []), carte(2, 'Brock', ['003'])], [image(1, 'Misty', null, 'a'), image(2, 'Brock', null, 'b')]);
        assert.deepStrictEqual(r.nouvelles.map(n => n.carteId).sort(), [1, 2]); assert.strictEqual(r.restes['image-sans-numero-carte-numerotee'], undefined);
    });
    await t('INERTE sur une ligne qui ne la déclare pas (IPB : Énergies à numéro nul déjà servies) : les deux images se joignent comme avant, aucun reste', async () => {
        const r = await rejouer([carte(60754, 'Basic Grass Energy', [null, '068'])], [image(68, 'Basic Grass Energy', '068', 'a'), image(69, 'Basic Grass Energy', null, 'b')], S_IPB);
        assert.deepStrictEqual(r.nouvelles.map(n => n.cleR2).sort(), ['artofpkm/7/68.webp', 'artofpkm/7/69.webp']); assert.strictEqual(r.restes['image-sans-numero-carte-numerotee'], undefined);
        assert.strictEqual(r.sansNumeroRefusees.length, 0);
    });
    await t('une image NUMÉROTÉE n\'est jamais touchée, même sur une carte à deux numéros', async () => {
        const r = await rejouer([carte(1, 'Rowlet', ['052', '059'])], [image(1, 'Rowlet', '052', 'a'), image(2, 'Rowlet', '059', 'b')]);
        assert.strictEqual(r.nouvelles.length, 2); assert.strictEqual(r.restes['image-sans-numero-carte-numerotee'], undefined);
    });
    console.log(`\n${ok} réussi(s), ${ko} en échec`);
    process.exit(ko ? 1 : 0);
})();
