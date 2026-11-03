'use strict';
// Banc de collecte-cartes/jointure-sans-ligne.js (agent catalogue, 2026-11-03). Aucune base, aucun réseau.
// Les formes (carte {_id,nomEn,sets,impressions,attaques}, produit {idProduct,idExpansion,name,numero}, ligne {carteId,idProduct}) sont celles du cache de l'audit (lecture.json).
// ⚠️ Les 4 règles du site sont ici des DOUBLURES fidèles dans leur effet (tirage + expansion + deck ; numéro nettoyé) : le banc ne lit pas le dossier du site.
const assert = require('assert');
const { jugerJointure, RAISONS } = require('./collecte-cartes/jointure-sans-ligne');

const regles = {
    impressionDuSet: (i, cible) => i.tirage === cible.tirage && cible.expansions.includes(i.expansion) && (!cible.deck || i.deck === cible.deck),
    normaliserNumero: n => (n === null || n === undefined || String(n).trim() === '' ? null : String(n).trim()),
    expansionsDuSet: s => [].concat(s.bulba && s.bulba.expansion || []),
    tirageDuSet: s => s.tirage
};
const SET = { _id: 'Test-Set', code: 'TS', nomAffichage: 'Test Set', tirage: 'intl', region: 'intl', idExpansion: [111], deck: null, bulba: { expansion: 'Test Set' } };
const imp = numero => ({ tirage: 'intl', expansion: 'Test Set', deck: null, numero, total: '100' });
const carte = (id, nomEn, numero, attaques = []) => ({ _id: id, nomEn, sets: ['Test-Set'], impressions: numero === null ? [] : [imp(numero)], attaques });
const prod = (idProduct, name, numero, idExpansion = 111) => ({ idProduct, idExpansion, name, numero, slug: null, slugSet: null });

const bulbi = carte(1, 'Bulbasaur', '001', ['Vine Whip']), ivy = carte(2, 'Ivysaur', '002', ['Razor Leaf']), venu = carte(3, 'Venusaur', null);
const cartesDuSet = [bulbi, ivy, venu];
const cas = (c, produits, lignesDuSet = [], cartes = cartesDuSet, produitsDuSet) => jugerJointure({ carte: c, set: SET, produitsSansLigne: produits, produitsDuSet, cartesDuSet: cartes, lignesDuSet, regles });

let n = 0;
const ok = (nom, f) => { try { f(); n++; } catch (e) { console.error(`ECHEC ${nom} : ${e.message}`); process.exitCode = 1; } };

ok('liste fermée des raisons', () => assert.deepStrictEqual([...RAISONS].sort(), ['aucun-produit', 'carte-deja-jointe-dans-le-set', 'nom-ambigu', 'nom-contredit', 'nom-contredit-numero', 'nom-inclus-seulement', 'plusieurs-produits-au-numero', 'produit-deja-joint'].sort()));

ok('ACCEPTÉ par le numéro : forme de production exacte', () => {
    const r = cas(bulbi, [prod(10, 'Bulbasaur', '1')]);
    assert.ok(r.ligne, JSON.stringify(r));
    const l = r.ligne;
    assert.deepStrictEqual(Object.keys(l).sort(), ['_id', 'carteId', 'detail', 'idExpansion', 'idProduct', 'numeroFiche', 'preuve', 'slug', 'slugSet', 'tirage', 'verifieLe'].sort());
    assert.strictEqual(l._id, '1|10'); assert.strictEqual(l.carteId, 1); assert.strictEqual(l.idProduct, 10); assert.strictEqual(l.idExpansion, 111); assert.strictEqual(l.tirage, 'intl');
    assert.strictEqual(l.preuve, 'set+numero'); assert.strictEqual(l.numeroFiche, '001'); assert.strictEqual(l.slugSet, 'Test-Set'); assert.strictEqual(l.slug, null);
    assert.ok(l.verifieLe instanceof Date);
    assert.ok(/n°001 parmi les 1 produits sans ligne de l'expansion 111/.test(l.detail) && /nom ne désignant aucune autre carte du set/.test(l.detail), l.detail);
});
ok('le slug du produit voyage avec la ligne', () => {
    const p = { ...prod(10, 'Bulbasaur', '1'), slug: 'Bulbasaur-V1-TS001', slugSet: 'Test-Set-Cm' };
    const l = cas(bulbi, [p]).ligne; assert.strictEqual(l.slug, 'Bulbasaur-V1-TS001'); assert.strictEqual(l.slugSet, 'Test-Set-Cm');
});
ok('ACCEPTÉ par le nom seul', () => {
    const r = cas(venu, [prod(12, 'Venusaur', null)]);
    assert.ok(r.ligne, JSON.stringify(r));
    assert.strictEqual(r.ligne.preuve, 'set+nom-seul'); assert.strictEqual(r.ligne.numeroFiche, null); assert.strictEqual(r.ligne._id, '3|12');
    assert.ok(/nom/.test(r.ligne.detail) && /expansion 111/.test(r.ligne.detail), r.ligne.detail);
});
ok('carte-deja-jointe-dans-le-set', () => assert.deepStrictEqual(cas(bulbi, [prod(10, 'Bulbasaur', '1')], [{ carteId: 1, idProduct: 99 }]), { refus: 'carte-deja-jointe-dans-le-set' }));
ok('produit-deja-joint (numéro)', () => assert.deepStrictEqual(cas(bulbi, [prod(10, 'Bulbasaur', '1')], [{ carteId: 77, idProduct: 10 }]), { refus: 'produit-deja-joint' }));
ok('produit-deja-joint (nom seul)', () => assert.deepStrictEqual(cas(venu, [prod(12, 'Venusaur', null)], [{ carteId: 77, idProduct: 12 }]), { refus: 'produit-deja-joint' }));
ok('produit déjà joint dans un AUTRE set : absent des sans-ligne, présent dans le set -> refusé (numéro)', () => assert.deepStrictEqual(cas(bulbi, [], [], cartesDuSet, [prod(10, 'Bulbasaur', '1')]), { refus: 'produit-deja-joint' }));
ok('nom-contredit-numero : le produit porte un autre numéro que celui de la carte', () => assert.deepStrictEqual(cas(bulbi, [prod(10, 'Bulbasaur', '5')]), { refus: 'nom-contredit-numero' }));
ok('nom seul accepté si la carte n\'a aucune impression numérotée dans le set', () => assert.ok(cas(venu, [prod(12, 'Venusaur', '9')]).ligne));
ok('le détail du numéro dit « ne désignant aucune autre carte »', () => assert.ok(/nom ne désignant aucune autre carte du set/.test(cas(bulbi, [prod(10, 'Bulbasaur', '1')]).ligne.detail)));
ok('plusieurs-produits-au-numero',() => assert.deepStrictEqual(cas(bulbi, [prod(10, 'Bulbasaur', '1'), prod(11, 'Bulbasaur [Vine Whip]', '001')]), { refus: 'plusieurs-produits-au-numero' }));
ok('plusieurs produits au numéro, dont un déjà joint ailleurs : toujours refusé', () => assert.deepStrictEqual(cas(bulbi, [prod(10, 'Bulbasaur', '1')], [{ carteId: 77, idProduct: 11 }], cartesDuSet, [prod(10, 'Bulbasaur', '1'), prod(11, 'Bulbasaur', '001')]), { refus: 'plusieurs-produits-au-numero' }));
ok('nom-contredit : le numéro désigne Bulbasaur, le nom désigne Ivysaur', () => assert.deepStrictEqual(cas(bulbi, [prod(10, 'Ivysaur', '1')]), { refus: 'nom-contredit' }));
ok('le témoin laisse passer un nom que les attaques départagent', () => {
    const r = cas(bulbi, [prod(10, 'Ivysaur [Vine Whip]', '1')]); assert.ok(r.ligne, JSON.stringify(r));
});
ok('nom-ambigu : deux cartes du même nom dans le set', () => {
    const p1 = carte(5, 'Pikachu', null), p2 = carte(6, 'Pikachu', null);
    assert.deepStrictEqual(cas(p1, [prod(20, 'Pikachu', null)], [], [...cartesDuSet, p1, p2]), { refus: 'nom-ambigu' });
});
ok('nom-ambigu : deux produits du même nom', () => assert.deepStrictEqual(cas(venu, [prod(12, 'Venusaur', null), prod(13, 'Venusaur', null)]), { refus: 'nom-ambigu' }));
ok('nom-inclus-seulement', () => assert.deepStrictEqual(cas(carte(7, 'Shellos', null), [prod(30, 'Shellos West Sea Lv.25', null)], [], [...cartesDuSet, carte(7, 'Shellos', null)]), { refus: 'nom-inclus-seulement' }));
ok('aucun-produit', () => assert.deepStrictEqual(cas(venu, [prod(40, 'Charizard', null)]), { refus: 'aucun-produit' }));
ok('un produit d\'une autre expansion ne compte pas, même au bon numéro', () => assert.deepStrictEqual(cas(bulbi, [prod(10, 'Bulbasaur', '1', 999)]), { refus: 'aucun-produit' }));
ok('une impression d\'un autre set ne désigne pas le numéro', () => {
    const c = { ...carte(8, 'Bulbasaur', null), impressions: [{ tirage: 'jp', expansion: 'Autre', deck: null, numero: '001' }] };
    assert.deepStrictEqual(cas(c, [prod(10, 'Pikachu', '1')], [], [...cartesDuSet, c]), { refus: 'aucun-produit' });
});
ok('règle injectée absente : lève, jamais de repli', () => assert.throws(() => jugerJointure({ carte: bulbi, set: SET, produitsSansLigne: [], cartesDuSet, lignesDuSet: [], regles: {} }), /règle injectée absente/));
ok('les attaques en chaînes du cache sont lues', () => {
    // forme du cache : attaques = ['Vine Whip'] (chaînes) ; le témoin attend {nom}
    assert.ok(cas(bulbi, [prod(10, 'Ivysaur [Vine Whip]', '1')]).ligne);
});

console.log(process.exitCode ? 'ÉCHEC' : `${n} OK`);
