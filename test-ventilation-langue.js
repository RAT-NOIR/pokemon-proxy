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
    'Orphelin': {},                                       // set sans langue lisible (cause c)
    'Tirage-Vide': { region: 'intl', tirage: '' },        // tirage vide : `??` ne rattrape PAS par region (règle du site) => cause c
};
const setDe = s => sets[s];
// 12 produits : 3 intl, 2 jp, 2 zh-hans, 1 idth, 1 set sans langue (c), 1 sans slug (a), 1 set inexistant (b), 1 tirage vide (c)
const slug = new Map([
    [1, 'Base-Set'], [2, 'Base-Set'], [3, 'Base-Set'],
    [4, 'Expansion-Pack'], [5, 'Expansion-Pack'],
    [6, 'Chasing'], [7, 'Chasing'],
    [8, 'Mega-ID'], [9, 'Orphelin'], [10, null], [11, 'Inexistant'], [12, 'Tirage-Vide'],
]);
const ens = { fiches: new Set([1, 2, 4, 6, 9, 10]), visuels: new Set([1, 4, 6]), jumeau: new Set([5, 7]) };
const global = { produits: 12, fiches: 6, visuels: 3, jumeau: 2 };

const r = ventilerParLangue(slug, ens, setDe, global, new Set([10, 11, 12]));
const par = Object.fromEntries(r.tableau.map(l => [l.langue, l]));

t('bouclage contre la MESURE GLOBALE : produits, fiches, visuels, jumeau', () => {
    assert.deepStrictEqual(r.somme, global);
});
t('un global qui compte un produit de plus que la ventilation LÈVE', () => {
    assert.throws(() => ventilerParLangue(slug, ens, setDe, { ...global, produits: 13 }), /bouclage.*produits/);
});
t('un global qui compte une fiche de plus LÈVE', () => {
    assert.throws(() => ventilerParLangue(slug, ens, setDe, { ...global, fiches: 7 }), /bouclage.*fiches/);
});
t('une fiche du global hors dénominateur (id absent de la Map) LÈVE', () => {
    const ensEtrange = { ...ens, fiches: new Set([...ens.fiches, 999]) };
    assert.throws(() => ventilerParLangue(slug, ensEtrange, setDe, { ...global, fiches: 7 }), /bouclage.*fiches/);
});
t('comptes globaux absents : refuse (pas de bouclage sur soi-même)', () => {
    assert.throws(() => ventilerParLangue(slug, ens, setDe), /obligatoires/);
});
t('set region:intl + tirage:zh-hans rangé en zh-hans, pas en intl', () => {
    assert.strictEqual(par['zh-hans'].produits, 2);
    assert.strictEqual(par['zh-hans'].visuels, 1);
    assert.strictEqual(par['zh-hans'].jumeau, 1);
    assert.strictEqual(par.intl.produits, 3);
});
t('region seule sans tirage : jp et intl', () => {
    assert.strictEqual(par.jp.produits, 2); assert.strictEqual(par.jp.fiches, 1); assert.strictEqual(par.jp.jumeau, 1);
    assert.strictEqual(par.intl.produits, 3); assert.strictEqual(par.intl.fiches, 2); assert.strictEqual(par.intl.visuels, 1);
    assert.strictEqual(par.idth.produits, 1);
});
t('tirage: \'\' n\'est PAS rattrapé par region (`??`, règle du site) : va en « (langue inconnue) »', () => {
    assert.strictEqual(par.intl.produits, 3);              // le produit 12 n'est pas compté en intl
    assert.strictEqual(par[INCONNUE].produits, 4);
});
t('« (langue inconnue) » sous-ventilée par cause, un produit par cause, a+b+c = ligne', () => {
    assert.strictEqual(r.inconnue.a.produits, 1);
    assert.strictEqual(r.inconnue.b.produits, 1);
    assert.strictEqual(r.inconnue.c.produits, 2);          // set sans langue + tirage vide
    assert.strictEqual(r.inconnue.a.produits + r.inconnue.b.produits + r.inconnue.c.produits, par[INCONNUE].produits);
    assert.deepStrictEqual([r.inconnue.a.jamaisAppris, r.inconnue.b.jamaisAppris, r.inconnue.c.jamaisAppris], [1, 1, 1]);
    assert.strictEqual(par[INCONNUE].fiches, 2);           // 9 et 10
});
console.log(`${n}/${n} passés (12 produits fabriqués, 6 langues dont l'inconnue, 3 causes d'inconnue)`);
