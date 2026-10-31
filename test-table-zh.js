// Banc de collecte-cartes/table-zh.js (tables de traduction de la preuve par le set). Aucune base, aucun réseau.
const assert = require('assert');
const T = require('./collecte-cartes/table-zh');
let ok = 0, ko = 0;
const t = (nom, f) => { try { f(); ok++; console.log('  ok  ' + nom); } catch (e) { ko++; console.log('  ECHEC ' + nom + '\n        ' + String(e.message).split('\n')[0]); } };

t('baseZh retire seulement le marqueur de règle latin en suffixe', () => {
    assert.strictEqual(T.baseZh('皮卡丘 ex'), '皮卡丘');
    assert.strictEqual(T.baseZh('皮卡丘VMAX'), '皮卡丘');
    assert.strictEqual(T.baseZh('吉利蛋'), '吉利蛋');
});
t('lireCarteTs lit le nom zh-tw du bloc name (pas celui d\'une attaque), le dexId, la catégorie, le cardmarket', () => {
    const ts = `const card: Card = { set: Set, name: { ja: "フシギダネ", 'zh-tw': "妙蛙種子", th: "x" }, category: "Pokemon", attacks: [ { name: { ja: "a", 'zh-tw': "寄生種子" }, damage: 20 } ], variants: [ { type: "normal", thirdParty: { cardmarket: 719442 } } ], dexId: [1], };`;
    const c = T.lireCarteTs(ts);
    assert.deepStrictEqual(c, { nomZh: '妙蛙種子', dex: [1], categorie: 'Pokemon', cardmarket: [719442] });
});
t('agregerTable : un nom qui désigne deux clés est RETIRÉ (ambigu), pas arbitré', () => {
    const r = T.agregerTable([
        { nomZh: '甲', dex: [1], categorie: 'Pokemon', cardmarket: [] }, { nomZh: '甲', dex: [2], categorie: 'Pokemon', cardmarket: [] },
        { nomZh: '乙', dex: [3], categorie: 'Pokemon', cardmarket: [] }, { nomZh: '乙 ex', dex: [3], categorie: 'Pokemon', cardmarket: [] }
    ]);
    assert.strictEqual(r.table['甲'], undefined);
    assert.strictEqual(r.table['乙'], 'D3');
    assert.strictEqual(r.stats.ambigus, 1);
});
t('agregerTable : un Dresseur prend le nom Cardmarket de son idProduct (fonction de production), sans nom trouvé il est compté « sans clé »', () => {
    const r = T.agregerTable([{ nomZh: '丙', dex: [], categorie: 'Trainer', cardmarket: [9] }, { nomZh: '丁', dex: [], categorie: 'Trainer', cardmarket: [8] }], id => (id === 9 ? 'Boss\'s Orders [Effet]' : null));
    assert.strictEqual(r.table['丙'], T.cleNom('Boss\'s Orders'));
    assert.strictEqual(r.stats.sansCle, 1);
});
t('fabriquerCleProduit : l\'espèce sous un préfixe de forme, le nom normalisé sinon', () => {
    const cle = T.fabriquerCleProduit({ pikachu: [25], growlithe: [58] });
    assert.strictEqual(cle('Captain Pikachu [Volt Tackle]'), 'D25');
    assert.strictEqual(cle('Hisuian Growlithe [Blazing Destruction | Take Down]'), 'D58');
    assert.strictEqual(cle('Boss\'s Orders'), T.cleNom('Boss\'s Orders'));
});
t('lireEspecesPokeApi : zh-Hant (4) et zh-Hans (12) vers le n° d\'espèce ; un nom partagé par deux espèces est retiré', () => {
    const csv = 'pokemon_species_id,local_language_id,name,genus\n1,4,妙蛙種子,x\n1,12,妙蛙种子,x\n1,9,Bulbasaur,x\n2,4,同名,x\n3,12,同名,x\n4,4,小火龍,x\n';
    const r = T.lireEspecesPokeApi(csv);
    assert.strictEqual(r.table['妙蛙種子'], 'D1');
    assert.strictEqual(r.table['妙蛙种子'], 'D1');
    assert.strictEqual(r.table['同名'], undefined);
    assert.strictEqual(r.table['Bulbasaur'], undefined);   // l'anglais n'est pas une entrée chinoise
    assert.strictEqual(r.stats.ambigus, 1);
});
t('fabriquerTraducteur : latin = son propre nom ; espèce par la table PokeAPI ; autres par la table TCGdex ; absent = null (jamais d\'approximation)', () => {
    const cle = T.fabriquerCleProduit({ pikachu: [25], eevee: [133] });
    const tr = T.fabriquerTraducteur({ tableEspeces: { 甲: 'D25' }, tableAutres: { 丙: T.cleNom('Boss\'s Orders') }, cleProduit: cle });
    assert.strictEqual(tr('Professor\'s Research'), T.cleNom('Professor\'s Research'));
    assert.strictEqual(tr('甲'), 'D25');
    assert.strictEqual(tr('甲 ex'), 'D25');
    assert.strictEqual(tr('丙'), T.cleNom('Boss\'s Orders'));
    assert.strictEqual(tr('丁'), null);
});
t('la table TCGdex n\'est JAMAIS utilisée pour une espèce : une entrée « D… » y est ignorée', () => {
    const tr = T.fabriquerTraducteur({ tableEspeces: {}, tableAutres: { 甲: 'D25' }, cleProduit: () => null });
    assert.strictEqual(tr('甲'), null);
});
console.log(`\n${ok} passés, ${ko} en échec`);
process.exit(ko ? 1 : 0);
