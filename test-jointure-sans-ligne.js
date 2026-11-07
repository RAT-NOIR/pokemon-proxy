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

// ── voie set+nom+attaques (nom-ambigu) — 2026-11-07
const pikA = carte(50, 'Pikachu', null, ['Thunder Shock']), pikB = carte(51, 'Pikachu', null, ['Quick Attack']);
const cartesPik = [...cartesDuSet, pikA, pikB];
const pA = prod(60, 'Pikachu [Thunder Shock]', null), pB = prod(61, 'Pikachu [Quick Attack]', null);
ok('ACCEPTÉ par nom+attaques : deux cartes, deux produits, les attaques départagent', () => {
    const r = cas(pikA, [pA, pB], [], cartesPik);
    assert.ok(r.ligne, JSON.stringify(r));
    assert.strictEqual(r.ligne.preuve, 'set+nom+attaques'); assert.strictEqual(r.ligne.idProduct, 60); assert.strictEqual(r.ligne.numeroFiche, null);
    assert.ok(/2 cartes du nom/.test(r.ligne.detail) && /2 produits du nom/.test(r.ligne.detail), r.ligne.detail);
    assert.strictEqual(cas(pikB, [pA, pB], [], cartesPik).ligne.idProduct, 61);
});
ok('ACCEPTÉ par nom+attaques : un seul produit mais deux cartes (la garde du nom seul refuse)', () => assert.strictEqual(cas(pikA, [pA], [], cartesPik).ligne.preuve, 'set+nom+attaques'));
ok('REFUSÉ : une autre carte du nom porte aussi toutes les attaques (comparatif)', () => {
    const pikC = carte(52, 'Pikachu', null, ['Thunder Shock', 'Growl']);
    assert.deepStrictEqual(cas(pikA, [pA, pB], [], [...cartesPik, pikC]), { refus: 'nom-ambigu' });
});
ok('REFUSÉ : produits sans crochets (jamais par cette voie)', () => assert.deepStrictEqual(cas(pikA, [prod(62, 'Pikachu', null), prod(63, 'Pikachu', null)], [], cartesPik), { refus: 'nom-ambigu' }));
ok('REFUSÉ : un seul produit SANS crochets face à deux cartes du nom', () => assert.deepStrictEqual(cas(pikA, [prod(72, 'Pikachu', null)], [], cartesPik), { refus: 'nom-ambigu' }));
ok('REFUSÉ : un Dresseur sans attaque ne se désigne pas par cette voie', () => {
    const t1 = carte(70, 'Potion', null), t2 = carte(71, 'Potion', null);
    assert.deepStrictEqual(cas(t1, [prod(64, 'Potion', null)], [], [...cartesDuSet, t1, t2]), { refus: 'nom-ambigu' });
});
ok('REFUSÉ : les attaques du produit ne sont pas toutes dans la carte', () => assert.deepStrictEqual(cas(pikA, [prod(65, 'Pikachu [Thunder Shock | Growl]', null)], [], cartesPik), { refus: 'nom-ambigu' }));
ok('REFUSÉ : un autre produit du nom porte les mêmes attaques', () => assert.deepStrictEqual(cas(pikA, [pA, prod(66, 'Pikachu [Thunder Shock]', null)], [], cartesPik), { refus: 'nom-ambigu' }));
ok('REFUSÉ : numéro du produit contredit celui de la carte', () => {
    const cN = carte(53, 'Pikachu', '009', ['Thunder Shock']);
    assert.deepStrictEqual(cas(cN, [prod(67, 'Pikachu [Thunder Shock]', '77'), pB], [], [...cartesDuSet, cN, pikB]), { refus: 'nom-ambigu' });
});
ok('REFUSÉ : produit déjà joint (nom+attaques)', () => assert.deepStrictEqual(cas(pikA, [pA, pB], [{ carteId: 99, idProduct: 60 }], cartesPik), { refus: 'nom-ambigu' }));
ok('attaques comparées sans l\'ordre des mots (Gather Snow / Snow Gather)', () => {
    const vA = carte(54, 'Vulpix', null, ['Snow Gather']), vB = carte(55, 'Vulpix', null, ['Ember']);
    assert.strictEqual(cas(vA, [prod(68, 'Vulpix [Gather Snow]', null), prod(69, 'Vulpix [Ember]', null)], [], [...cartesDuSet, vA, vB]).ligne.idProduct, 68);
});
ok('un produit NU voisin ne bloque pas, ni ne se joint : seul le produit à crochets est désigné', () => {
    const x = carte(56, 'Raichu', null, ['Zap']);
    const r = cas(x, [prod(75, 'Raichu', null), prod(76, 'Raichu [Zap]', null)], [], [...cartesDuSet, x, carte(57, 'Raichu', null, ['Zap', 'Spark'])]);
    assert.deepStrictEqual(r, { refus: 'nom-ambigu' });   // l'autre Raichu porte aussi 'Zap' : comparatif
    const seul = cas(x, [prod(75, 'Raichu', null), prod(76, 'Raichu [Zap]', null)], [], [...cartesDuSet, x]);
    assert.strictEqual(seul.ligne.idProduct, 76);
});
ok('REFUSÉ : un homonyme du set sans aucune attaque connue', () => {
    const x = carte(58, 'Eevee', null, ['Zap']), y = carte(59, 'Eevee', null, []);
    assert.deepStrictEqual(cas(x, [prod(77, 'Eevee [Zap]', null), prod(78, 'Eevee [Bite]', null)], [], [...cartesDuSet, x, y]), { refus: 'nom-ambigu' });
});
ok('REFUSÉ : carte sans numéro dans le set, produit numéroté dont le numéro est celui d\'une AUTRE carte', () => {
    const x = carte(60, 'Meowth', null, ['Zap']), y = carte(61, 'Meowth', null, ['Bite']);
    assert.deepStrictEqual(cas(x, [prod(79, 'Meowth [Zap]', '1'), prod(80, 'Meowth [Bite]', null)], [], [...cartesDuSet, x, y]), { refus: 'nom-ambigu' });
});
// ── énergies : « Speed Lightning Energy » n'est PAS « Lightning Energy » ; « Basic X » = « X » reste joint par le nom seul
ok('Basic Water Energy / Water Energy : joint par le nom (clé « Basic » existante), pas par une voie neuve', () => {
    const e = carte(80, 'Water Energy', null); const r = cas(e, [prod(90, 'Basic Water Energy', null)], [], [...cartesDuSet, e]);
    assert.strictEqual(r.ligne.preuve, 'set+nom-seul');
});
ok('énergie spéciale : « Speed Lightning Energy » refusée face à « Lightning Energy »', () => {
    const e = carte(81, 'Speed Lightning Energy', null);
    assert.deepStrictEqual(cas(e, [prod(91, 'Lightning Energy', null)], [], [...cartesDuSet, e]), { refus: 'nom-inclus-seulement' });
});
ok('deux produits « Basic X Energy » : refusé', () => {
    const e = carte(82, 'Water Energy', null);
    assert.deepStrictEqual(cas(e, [prod(92, 'Basic Water Energy', null), prod(93, 'Basic Water Energy', null)], [], [...cartesDuSet, e]), { refus: 'nom-ambigu' });
});
ok('candidatsDuRefus : égalité ou inclusion de mots, rien d\'autre', () => {
    const { candidatsDuRefus } = require('./collecte-cartes/jointure-sans-ligne');
    const e = carte(83, 'Lightning Energy', null);
    assert.deepStrictEqual(candidatsDuRefus(e, [prod(1, 'Speed Lightning Energy', null), prod(2, 'Charizard', null)]).map(p => p.idProduct), [1]);
});

console.log(process.exitCode ? 'ÉCHEC' : `${n} OK`);
