// Banc de collecte-cartes/ventilation-langue.js — données fabriquées, aucune base.
const assert = require('assert');
const { ventilerParLangue, INCONNUE } = require('./collecte-cartes/ventilation-langue');

let n = 0;
const t = (nom, f) => { f(); n++; console.log(`  ok ${nom}`); };

const sets = {
    'Base-Set': { region: 'intl' },
    'Expansion-Pack': { region: 'jp' },
    'Chasing': { region: 'intl', tirage: 'zh-hans' },     // le piège : region 'intl', tirage chinois
    'Mega-ID': { region: 'intl', tirage: 'idth' },
    'Orphelin': {},                                       // set sans langue lisible
};
const setDe = s => sets[s];
// 9 produits : 3 intl, 2 jp, 2 zh-hans, 1 idth, 1 set sans langue + 1 sans slugSet = 10
const slug = new Map([
    [1, 'Base-Set'], [2, 'Base-Set'], [3, 'Base-Set'],
    [4, 'Expansion-Pack'], [5, 'Expansion-Pack'],
    [6, 'Chasing'], [7, 'Chasing'],
    [8, 'Mega-ID'], [9, 'Orphelin'], [10, null], [11, 'Inexistant'],
]);
const ens = { fiches: new Set([1, 2, 4, 6, 9, 10, 99]), visuels: new Set([1, 4, 6]), jumeau: new Set([5, 7]) };

const r = ventilerParLangue(slug, ens, setDe);
const par = Object.fromEntries(r.tableau.map(l => [l.langue, l]));

t('bouclage exact : produits, fiches, visuels, jumeau', () => {
    assert.strictEqual(r.somme.produits, 11); assert.strictEqual(r.attendu.produits, 11);
    assert.strictEqual(r.somme.fiches, 6); assert.strictEqual(r.attendu.fiches, 6);   // le 99 est hors dénominateur
    assert.strictEqual(r.somme.visuels, 3); assert.strictEqual(r.somme.jumeau, 2);
});
t('set region:intl + tirage:zh-hans rangé en zh-hans, pas en intl', () => {
    assert.strictEqual(par['zh-hans'].produits, 2);
    assert.strictEqual(par['zh-hans'].visuels, 1);
    assert.strictEqual(par['zh-hans'].jumeau, 1);
    assert.strictEqual(par.intl.produits, 3);
});
t('region seule sans tirage : jp et intl', () => {
    assert.strictEqual(par.jp.produits, 2); assert.strictEqual(par.jp.fiches, 1); assert.strictEqual(par.jp.jumeau, 1);
    assert.strictEqual(par.idth.produits, 1);
});
t('sans langue lisible (set vide, slug null, set inexistant) : « (langue inconnue) », jamais perdu', () => {
    assert.strictEqual(par[INCONNUE].produits, 3);
    assert.strictEqual(par[INCONNUE].fiches, 2);
});
t('le bouclage LÈVE s\'il échoue (setDe qui jette un produit)', () => {
    // un Map-like truqué : itération qui saute un produit => somme != global
    const truque = new Map(slug); const it = truque[Symbol.iterator].bind(truque);
    truque[Symbol.iterator] = function* () { let i = 0; for (const e of it()) if (i++ !== 0) yield e; };
    assert.throws(() => ventilerParLangue(truque, ens, setDe), /bouclage/);
});
console.log(`${n}/${n} passés (11 produits fabriqués, 5 langues dont l'inconnue)`);
