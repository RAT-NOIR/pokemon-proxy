'use strict';
// Banc de la règle pure slugAPoser (collecte-cartes/slug-produit.js) : un cas par règle, sans Mongo.
const assert = require('assert');
const { slugAPoser, consolider, RAISONS } = require('./collecte-cartes/slug-produit');

let n = 0;
const ok = (nom, f) => { f(); n++; };
const ligne = (o = {}) => ({ slug: null, slugSet: 'SWSH-Black-Star-Promos', idExpansion: 1234, ...o });
const appris = (o = {}) => ({ slug: 'Pikachu-V1-SWSH260', slugSet: 'SWSH-Black-Star-Promos', idExpansion: 1234, ...o });

ok('cas nominal : pose le slug', () => assert.deepStrictEqual(slugAPoser(ligne(), appris()), { set: { slug: 'Pikachu-V1-SWSH260' } }));
ok('(a) slug déjà posé', () => assert.deepStrictEqual(slugAPoser(ligne({ slug: 'X-1' }), appris()), { refus: 'slug-deja-pose' }));
ok('(a) slug vide = non posé', () => assert.ok(slugAPoser(ligne({ slug: '' }), appris()).set));
ok('(b) produit non appris', () => assert.deepStrictEqual(slugAPoser(ligne(), undefined), { refus: 'produit-non-appris' }));
ok('(b) produit non appris (null)', () => assert.deepStrictEqual(slugAPoser(ligne(), null), { refus: 'produit-non-appris' }));
ok('(c) slug non appris absent', () => assert.deepStrictEqual(slugAPoser(ligne(), appris({ slug: undefined })), { refus: 'slug-non-appris' }));
ok('(c) slug non appris vide', () => assert.deepStrictEqual(slugAPoser(ligne(), appris({ slug: '' })), { refus: 'slug-non-appris' }));
ok('(c) slug non appris null', () => assert.deepStrictEqual(slugAPoser(ligne(), appris({ slug: null })), { refus: 'slug-non-appris' }));
ok('(d) slug avec ?', () => assert.deepStrictEqual(slugAPoser(ligne(), appris({ slug: 'A-1?language=2' })), { refus: 'slug-pollue' }));
ok('(d) slug avec espace', () => assert.deepStrictEqual(slugAPoser(ligne(), appris({ slug: 'A 1' })), { refus: 'slug-pollue' }));
ok('(d) slug avec /', () => assert.deepStrictEqual(slugAPoser(ligne(), appris({ slug: 'Set/A-1' })), { refus: 'slug-pollue' }));
ok('(e) expansion différente', () => assert.deepStrictEqual(slugAPoser(ligne(), appris({ idExpansion: 99 })), { refus: 'expansion-differente' }));
ok('(e) expansion apprise absente : pas de refus', () => assert.ok(slugAPoser(ligne(), appris({ idExpansion: undefined })).set));
ok('(f) slugSet différent', () => assert.deepStrictEqual(slugAPoser(ligne(), appris({ slugSet: 'Autre-Set' })), { refus: 'slugSet-different' }));
ok('(g) pose aussi le slugSet quand la ligne n\'en a pas', () => assert.deepStrictEqual(slugAPoser(ligne({ slugSet: null }), appris()), { set: { slug: 'Pikachu-V1-SWSH260', slugSet: 'SWSH-Black-Star-Promos' } }));
ok('(g) ne touche pas au slugSet existant', () => assert.deepStrictEqual(slugAPoser(ligne(), appris()).set.slugSet, undefined));
ok('(g) pas de slugSet appris : slug seul', () => assert.deepStrictEqual(slugAPoser(ligne({ slugSet: null }), appris({ slugSet: null })), { set: { slug: 'Pikachu-V1-SWSH260' } }));
ok('RAISONS gelée et fermée', () => {
    assert.ok(Object.isFrozen(RAISONS));
    for (const r of ['slug-deja-pose', 'produit-non-appris', 'slug-non-appris', 'slug-pollue', 'expansion-differente', 'slugSet-different']) assert.ok(RAISONS.includes(r), r);
});
ok('chaque refus est dans RAISONS', () => {
    for (const a of [undefined, appris({ slug: '' }), appris({ slug: 'a b' }), appris({ idExpansion: 7 }), appris({ slugSet: 'Z' })]) {
        const r = slugAPoser(ligne(), a); assert.ok(r.refus && RAISONS.includes(r.refus));
    }
});

// ── relecture : forme autorisée, ambiguïté, types, slugSet
ok('(2) forme réelle acceptée', () => {
    for (const s of ['Bosss-Orders-Cyrus-SWSH251', 'Charizard-V-V2-s12a211']) assert.deepStrictEqual(slugAPoser(ligne(), appris({ slug: s })), { set: { slug: s } });
});
ok('(2) formes hors liste blanche refusées', () => {
    for (const s of ['A?1', 'A-1?', 'A/1', 'A#1','A-1.', 'é-1', '-A', 'A-', 'A--1', 'A\t1', 'A%201', 'A&b']) assert.deepStrictEqual(slugAPoser(ligne(), appris({ slug: s })), { refus: 'slug-pollue' }, s);
});
ok('(1) consolider : un seul doc', () => assert.deepStrictEqual(consolider([appris()]), appris()));
ok('(1) consolider : deux docs au même slug, pas ambigu', () => assert.strictEqual(consolider([appris(), appris()]).ambigu, undefined));
ok('(1) consolider : slugs distincts = ambigu', () => assert.deepStrictEqual(consolider([appris(), appris({ slug: 'Autre-1' })]), { ambigu: true }));
ok('(1) consolider : slugSets distincts = ambigu', () => assert.deepStrictEqual(consolider([appris(), appris({ slugSet: 'Z' })]), { ambigu: true }));
ok('(1) consolider : un doc sans slug + un avec slug = celui avec slug', () => assert.strictEqual(consolider([appris({ slug: null }), appris()]).slug, 'Pikachu-V1-SWSH260'));
ok('(1) produit ambigu refusé', () => assert.deepStrictEqual(slugAPoser(ligne(), { ambigu: true }), { refus: 'produit-ambigu' }));
ok('(1) RAISONS contient produit-ambigu', () => assert.ok(RAISONS.includes('produit-ambigu')));
ok('(6) idExpansion nombre contre chaîne : refus (strict voulu)', () => assert.deepStrictEqual(slugAPoser(ligne({ idExpansion: 1234 }), appris({ idExpansion: '1234' })), { refus: 'expansion-differente' }));
ok('(6) ligne avec slugSet, appris sans slugSet : slug seul', () => assert.deepStrictEqual(slugAPoser(ligne(), appris({ slugSet: undefined })), { set: { slug: 'Pikachu-V1-SWSH260' } }));

console.log(`${n} OK`);
