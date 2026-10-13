'use strict';
// Lot JA-2 (2026-10-13) — deux déclarations de ligne de source, chacune bornée à ce qui a été MESURÉ, et inertes partout ailleurs. Sans réseau, sans base : joindreImages en simulation.
//   node test-plage-rangs.js
// 1. `plageDeRangs: [début, fin]` (Intro Pack Neo, liste artofpkm 42 : DEUX decks sous UN id, aucun numéro imprimé). Mesuré 2026-10-13 : le rang de l'entrée dans son deck (n − début + 1)
//    est EXACTEMENT le numéro Cardmarket du produit, 35 produits sur 35 (Chikorita : 1…30 aux rangs 1…30 ; Totodile : 1…30 aux rangs 41…70). La ligne ne traite que les entrées de sa plage
//    (mesure, téléchargement, jointure), le rang-dans-le-deck tient lieu de numéro quand la source n'en imprime pas, et la jointure exige le NOM en plus (numéro ET nom).
// 2. `numerosPartages: true` (Quick Construction Packs : six listes numérotées chacune depuis 1) : la règle des clés partagées s'étend aux numéros chiffrés, comme pour `sousSection`.
const assert = require('assert');
const { joindreImages } = require('./collecteur-images.js');
const { entreesDeLaLigne } = require('./collecte-cartes/echantillon-mesure');
let ok = 0, ko = 0;
const t = async (nom, f) => { try { await f(); ok++; console.log('  ✅', nom); } catch (e) { ko++; console.log('  ❌', nom, '—', e.message); } };
const lean = v => ({ lean: async () => v, select() { return this; } });

const LC = { code: 'IPNC', exp: 5061, nom: 'Intro Pack Neo Chikorita', slugSet: 'Intro-Pack-Neo-Chikorita', bulba: { tirage: 'jp', expansion: 'Intro Pack Neo', deck: 'Chikorita Half Deck' } };
const LT = { code: 'IPNT', exp: 5062, nom: 'Intro Pack Neo Totodile', slugSet: 'Intro-Pack-Neo-Totodile', bulba: { tirage: 'jp', expansion: 'Intro Pack Neo', deck: 'Totodile Half Deck' } };
const SC = { source: 'artofpkm', code: 'IPNC', ids: [42], noms: ['Intro Pack Neo'], plageDeRangs: [1, 40] };
const ST = { source: 'artofpkm', code: 'IPNT', ids: [42], noms: ['Intro Pack Neo'], plageDeRangs: [41, 80] };
const imp = (deck, numero) => ({ tirage: 'jp', expansion: 'Intro Pack Neo', deck, numero });
const CH = 'Chikorita Half Deck', TO = 'Totodile Half Deck';
const carte = (id, nomEn, sets, impressions) => ({ _id: id, nomEn, sets, impressions, images: [] });
const POTION = carte(1, 'Potion', ['Intro-Pack-Neo-Chikorita', 'Intro-Pack-Neo-Totodile'], [imp(CH, '15'), imp(TO, '20')]);
const CHIKO = carte(2, 'Chikorita', ['Intro-Pack-Neo-Chikorita'], [imp(CH, '1'), imp(CH, '30')]);
const PIKA = carte(3, 'Pikachu', ['Intro-Pack-Neo-Totodile'], [imp(TO, '1')]);
const AUTRE = carte(4, 'Berry', ['Intro-Pack-Neo-Chikorita'], [imp(CH, '16')]);   // n°16 chez nous : un nom qui n'est pas celui de l'image 16
const image = (n, nomEn, sha, extra = {}) => ({ _id: `artofpkm/42/${n}`, source: 'artofpkm', sourceSetId: 42, n, titre: `${nomEn}, Intro Pack Neo`, cleR2: `artofpkm/42/${n}.webp`, sha256: sha, w: 593, h: 834, fmt: 'webp', urlOriginal: 'x', numero: null, nomEn, etat: 'ok', set: 'sim', ...extra });
const IMAGES = [image(1, 'Chikorita', 'a1'), image(15, 'Potion', 'a15'), image(16, 'Potion', 'a16'), image(30, 'Chikorita', 'a30'), image(41, 'Pikachu', 'b41'), image(60, 'Potion', 'b60')];
const fauxM = (cartes, images) => ({
    Carte: { find(q) {
        const cp = a => JSON.parse(JSON.stringify(a));
        if (q.sets) return lean(cp(cartes.filter(c => c.sets.includes(q.sets))));
        return lean(cp(cartes));   // la requête des témoins ($or) : toutes les cartes du banc
    } },
    Image: { find() { return lean(images); } }
});
const entreesDe = images => ({ 42: images.map(i => ({ n: i.n, sourceSetId: 42, titre: i.titre })) });
const rejouer = (L, slug, S, cartes = [POTION, CHIKO, PIKA, AUTRE], images = IMAGES) => joindreImages(fauxM(cartes, images), L, slug, S, entreesDe(images), {}, __dirname + '/rapports-sim', { silencieux: true, simuler: true });
const cles = r => r.nouvelles.map(n => `${n.cleR2.replace('artofpkm/42/', '').replace('.webp', '')}→${n.carteId}#${n.numero}`).sort();

(async () => {
    await t('entreesDeLaLigne : une ligne qui déclare sa plage ne garde que les entrées dont le rang y tombe (bornes comprises)', () => {
        const liste = Array.from({ length: 80 }, (_, i) => ({ n: i + 1, sourceSetId: 42 }));
        assert.deepStrictEqual(entreesDeLaLigne(liste, SC).map(e => e.n).filter((n, i, a) => i === 0 || i === a.length - 1), [1, 40]);
        assert.strictEqual(entreesDeLaLigne(liste, SC).length, 40);
        assert.deepStrictEqual(entreesDeLaLigne(liste, ST).map(e => e.n).filter((n, i, a) => i === 0 || i === a.length - 1), [41, 80]);
        assert.strictEqual(entreesDeLaLigne(liste, { ids: [42] }).length, 80, 'sans déclaration : la liste entière, comme avant');
    });
    await t('une plage INVALIDE (pas deux entiers début ≤ fin) LÈVE : une garde qui ne peut pas conclure bloque', () => {
        for (const mauvaise of [[1], [40, 1], ['a', 'b'], [1.5, 3], 'x', [1, 2, 3]]) assert.throws(() => entreesDeLaLigne([{ n: 1 }], { plageDeRangs: mauvaise }), /plageDeRangs/, JSON.stringify(mauvaise));
    });
    await t('IPNC : seules les images de SA plage sont jointes ; le rang tient lieu de numéro (Potion 15 → carte 1 au n°15, Chikorita 1 et 30 → deux numéros) ; Pikachu (rang 41) et Potion (rang 60) ne sont pas à elle', async () => {
        const r = await rejouer(LC, 'Intro-Pack-Neo-Chikorita', SC);
        assert.deepStrictEqual(cles(r), ['15→1#15', '1→2#1', '30→2#30']);
    });
    await t('IPNT : sa plage seule, rang − 40 comme numéro (Potion 60 → carte 1 au n°20, Pikachu 41 → n°1) ; Potion du rang 15 n\'est pas à elle', async () => {
        const r = await rejouer(LT, 'Intro-Pack-Neo-Totodile', ST);
        assert.deepStrictEqual(cles(r), ['41→3#1', '60→1#20']);
    });
    await t('numéro ET nom : le rang 16 (« Potion ») désigne chez nous le n°16 « Berry » — le nom diffère, refusée et NOMMÉE, jamais jointe', async () => {
        const r = await rejouer(LC, 'Intro-Pack-Neo-Chikorita', SC);
        assert.ok(!r.nouvelles.some(n => n.cleR2.endsWith('/16.webp')));
        assert.strictEqual(Object.values(r.restes).reduce((a, b) => a + b, 0) >= 1, true, JSON.stringify(r.restes));
    });
    await t('SANS la déclaration (témoin : le comportement d\'avant), la liste entière se joint par le nom : la Potion du deck Totodile (60) et celle du Chikorita (15) tombent sur la MÊME carte — c\'est la raison d\'être de la plage', async () => {
        const r = await rejouer(LC, 'Intro-Pack-Neo-Chikorita', { source: 'artofpkm', code: 'IPNC', ids: [42], noms: ['Intro Pack Neo'] });
        const potions = r.nouvelles.filter(n => n.carteId === 1);
        assert.strictEqual(potions.length, 1, JSON.stringify(r.nouvelles)); assert.strictEqual(potions[0].numero, null, 'sans plage, aucun numéro dérivé du rang n\'est posé');
        assert.strictEqual(potions[0].preuve, 'nom');
    });
    // ---- numerosPartages ----
    const L2 = { code: 'XQ', exp: 1, nom: 'Quick test', slugSet: 'Quick-test', bulba: { tirage: 'jp', expansion: 'Quick test', sansPage: true } };
    const imp2 = numero => ({ tirage: 'jp', expansion: 'Quick test', numero });
    const POT = { _id: 12098, nomEn: 'Potion', sets: ['Quick-test'], impressions: [imp2('008')], images: [] };
    const q = (sid, n, sha) => ({ _id: `artofpkm/${sid}/${n}`, source: 'artofpkm', sourceSetId: sid, n, titre: 'Potion, Quick', cleR2: `artofpkm/${sid}/${n}.webp`, sha256: sha, w: 593, h: 834, fmt: 'webp', urlOriginal: 'x', numero: '008', nomEn: 'Potion', etat: 'ok', set: 'Quick-test' });
    const imgs = [q(103, 8, 'x'), q(106, 8, 'y'), q(108, 8, 'z')];
    const rejouerQ = S => joindreImages(fauxM([POT], imgs), L2, 'Quick-test', S, { 103: [{ n: 8, sourceSetId: 103 }], 106: [{ n: 8, sourceSetId: 106 }], 108: [{ n: 8, sourceSetId: 108 }] }, {}, __dirname + '/rapports-sim', { silencieux: true, simuler: true });
    await t('numerosPartages : trois images DIFFÉRENTES au même numéro 008 pour la même carte (Potion de trois packs) : aucune ne la désigne — refusées et nommées', async () => {
        const r = await rejouerQ({ source: 'artofpkm', code: 'XQ', ids: [103, 106, 108], noms: ['q'], numerosPartages: true });
        assert.strictEqual(r.nouvelles.length, 0);   // (en simulation le reste `image-cle-partagee` n'est pas écrit : seul « ce qui serait posé » se lit)
    });
    await t('numerosPartages : trois images IDENTIQUES (même sha256) ne forment pas une clé partagée — la carte reçoit son visuel', async () => {
        imgs.forEach(i => { i.sha256 = 'meme'; });
        const r = await rejouerQ({ source: 'artofpkm', code: 'XQ', ids: [103, 106, 108], noms: ['q'], numerosPartages: true });
        assert.strictEqual(r.nouvelles.length, 1); assert.strictEqual(r.restes['image-cle-partagee'], undefined);
        imgs[0].sha256 = 'x'; imgs[1].sha256 = 'y'; imgs[2].sha256 = 'z';
    });
    await t('INERTE sans la déclaration : la même situation se joint comme avant (la dernière lue l\'emporte, aucun reste)', async () => {
        const r = await rejouerQ({ source: 'artofpkm', code: 'XQ', ids: [103, 106, 108], noms: ['q'] });
        assert.strictEqual(r.nouvelles.length, 1); assert.strictEqual(r.restes['image-cle-partagee'], undefined);
    });
    console.log(`\n${ok} réussi(s), ${ko} en échec`);
    process.exit(ko ? 1 : 0);
})();
