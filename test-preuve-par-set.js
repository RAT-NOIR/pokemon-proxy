// Banc de collecte-cartes/preuve-par-set.js — « FICHES CHINOISES : PREUVE PAR LE SET » (décision du testeur, 2026-10-31).
// Lancer : node test-preuve-par-set.js   (aucune base, aucun réseau)
const assert = require('assert');
let ok = 0, ko = 0;
const t = (nom, f) => { try { f(); ok++; console.log('  ok  ' + nom); } catch (e) { ko++; console.log('  ECHEC ' + nom + '\n        ' + String(e.message).split('\n')[0]); } };

let M;
try { M = require('./collecte-cartes/preuve-par-set'); } catch (e) { console.log('ECHEC : module absent — ' + e.message.split('\n')[0]); process.exit(1); }
const { prouverParSet } = M;

// table de traduction de BANC : sinogrammes inventés pour le banc (aucun nom réel n'est supposé), clé = nom anglais normalisé
const TABLE = { '甲': 'vulpix', '乙': 'eevee', '丙': 'ponyta', '丁': 'abra' };
const traduire = z => TABLE[z] ?? null;
const S = (numero, nomZh) => ({ numero, nomZh });
const P = (idProduct, name, numero) => (numero === undefined ? { idProduct, name } : { idProduct, name, numero });

console.log('— concordance totale');
t('un set entier qui concorde nom pour nom est admis, chaque carte reçoit le numéro de la source', () => {
    const r = prouverParSet({ source: [S('001', '甲'), S('002', '乙'), S('003', '丙')], produits: [P(1, 'Vulpix [Super Singe]'), P(2, 'Eevee'), P(3, 'Ponyta [Double Headbutt]')], traduire });
    assert.strictEqual(r.admis, true, r.raison);
    assert.deepStrictEqual(r.attributions.map(a => [a.idProduct, a.numero]).sort(), [[1, '001'], [2, '002'], [3, '003']]);
    assert.strictEqual(r.discordances.length, 0);
});
t('les crochets Cardmarket sont retirés par la fonction de production (aucune copie)', () => {
    const r = prouverParSet({ source: [S('001', '甲')], produits: [P(1, 'Vulpix [Super Singe | Queue]')], traduire });
    assert.strictEqual(r.admis, true, r.raison);
});

console.log('— une seule discordance ferme le set');
t('un orphelin côté SOURCE (carte que Cardmarket n\'a pas) : set refusé, aucune attribution', () => {
    const r = prouverParSet({ source: [S('001', '甲'), S('002', '乙'), S('003', '丙')], produits: [P(1, 'Vulpix'), P(2, 'Eevee')], traduire });
    assert.strictEqual(r.admis, false);
    assert.deepStrictEqual(r.attributions, []);
    assert.ok(r.discordances.some(d => d.type === 'effectif' && d.source === 1 && d.produits === 0), JSON.stringify(r.discordances));
});
t('un orphelin côté PRODUITS : set refusé', () => {
    const r = prouverParSet({ source: [S('001', '甲')], produits: [P(1, 'Vulpix'), P(2, 'Abra')], traduire });
    assert.strictEqual(r.admis, false);
    assert.ok(r.discordances.some(d => d.type === 'effectif' && d.source === 0 && d.produits === 1));
});
t('un nom INTRADUISIBLE est une discordance : le set échoue, il ne se rattrape pas', () => {
    const r = prouverParSet({ source: [S('001', '甲'), S('002', '？？')], produits: [P(1, 'Vulpix'), P(2, 'Eevee')], traduire });
    assert.strictEqual(r.admis, false);
    assert.ok(r.discordances.some(d => d.type === 'intraduisible' && d.numero === '002' && d.nomZh === '？？'));
    assert.deepStrictEqual(r.attributions, []);
});
t('MULTIPLICITÉS : A,A,B contre A,B,B a le même nombre et les mêmes noms distincts — refusé (un Set l\'admettrait)', () => {
    const r = prouverParSet({ source: [S('1', '甲'), S('2', '甲'), S('3', '乙')], produits: [P(1, 'Vulpix'), P(2, 'Eevee'), P(3, 'Eevee')], traduire });
    assert.strictEqual(r.admis, false);
    assert.strictEqual(r.discordances.filter(d => d.type === 'effectif').length, 2);
});
t('une liste vide (source ou produits) n\'admet rien et le dit', () => {
    assert.strictEqual(prouverParSet({ source: [], produits: [P(1, 'Vulpix')], traduire }).admis, false);
    const r = prouverParSet({ source: [S('1', '甲')], produits: [], traduire });
    assert.strictEqual(r.admis, false);
    assert.match(r.raison, /vide/);
});
t('un numéro de la source qui apparaît deux fois est une discordance', () => {
    const r = prouverParSet({ source: [S('1', '甲'), S('1', '甲')], produits: [P(1, 'Vulpix'), P(2, 'Vulpix')], traduire });
    assert.strictEqual(r.admis, false);
    assert.ok(r.discordances.some(d => d.type === 'numero-double'));
});

console.log('— deux produits du même nom (V1/V2, groupes de Gem Pack)');
t('même nom ×2 des deux côtés : set admis, mais AUCUNE attribution devinée — le groupe est rendu en ambigu', () => {
    const r = prouverParSet({ source: [S('1', '甲'), S('2', '甲'), S('3', '乙')], produits: [P(1, 'Vulpix'), P(2, 'Vulpix'), P(3, 'Eevee')], traduire });
    assert.strictEqual(r.admis, true, r.raison);
    assert.deepStrictEqual(r.attributions.map(a => [a.idProduct, a.numero]), [[3, '3']]);
    assert.strictEqual(r.ambigus.length, 1);
    assert.deepStrictEqual(r.ambigus[0].produits.sort(), [1, 2]);
    assert.deepStrictEqual(r.ambigus[0].numeros.sort(), ['1', '2']);
});
const groupeDe = n => String(n).slice(0, 2);
t('GROUPE (Gem Pack) : numéro de groupe Cardmarket et groupe de la source concordent -> attribution de niveau groupe', () => {
    const source = [S('0101', '甲'), S('0102', '甲'), S('0201', '乙'), S('0202', '乙')];
    const produits = [P(1, 'Vulpix', '01'), P(2, 'Vulpix', '01'), P(3, 'Eevee', '02'), P(4, 'Eevee', '02')];
    const r = prouverParSet({ source, produits, traduire, groupeDe });
    assert.strictEqual(r.admis, true, r.raison);
    assert.strictEqual(r.attributions.length, 4);
    assert.ok(r.attributions.every(a => a.niveau === 'groupe'));
    assert.deepStrictEqual(r.attributions.filter(a => a.idProduct === 1)[0].candidats.sort(), ['0101', '0102']);
    assert.strictEqual(r.attributions.filter(a => a.idProduct === 3)[0].numero, '02');
});
t('GROUPE : mêmes effectifs globaux mais un produit rangé dans le mauvais groupe -> refusé', () => {
    const source = [S('0101', '甲'), S('0102', '甲'), S('0201', '乙'), S('0202', '乙')];
    const produits = [P(1, 'Vulpix', '01'), P(2, 'Vulpix', '02'), P(3, 'Eevee', '02'), P(4, 'Eevee', '01')];
    const r = prouverParSet({ source, produits, traduire, groupeDe });
    assert.strictEqual(r.admis, false);
    assert.ok(r.discordances.some(d => d.type === 'groupe'));
});

t('GROUPE sans numéro Cardmarket (calibration : on le cache) : le groupe est lu sur la source', () => {
    const source = [S('0101', '甲'), S('0102', '甲'), S('0201', '乙'), S('0202', '乙')];
    const r = prouverParSet({ source, produits: [P(1, 'Vulpix'), P(2, 'Vulpix'), P(3, 'Eevee'), P(4, 'Eevee')], traduire, groupeDe });
    assert.strictEqual(r.admis, true, r.raison);
    assert.deepStrictEqual(r.attributions.map(a => [a.idProduct, a.numero, a.niveau]), [[1, '01', 'groupe'], [2, '01', 'groupe'], [3, '02', 'groupe'], [4, '02', 'groupe']]);
});
t('GROUPE : une espèce présente dans DEUX groupes ne se range pas — ambigu, aucune attribution devinée', () => {
    const source = [S('0101', '甲'), S('0201', '甲'), S('0301', '乙')];
    const r = prouverParSet({ source, produits: [P(1, 'Vulpix'), P(2, 'Vulpix'), P(3, 'Eevee')], traduire, groupeDe });
    assert.strictEqual(r.admis, true, r.raison);
    assert.deepStrictEqual(r.attributions.map(a => a.idProduct), [3]);
    assert.strictEqual(r.ambigus.length, 1);
});

console.log('— un nom latin déjà anglais n\'a pas besoin de table, une clé nulle côté produit est une discordance');
t('cleProduit injectable ; une clé nulle côté produit est une discordance', () => {
    const r = prouverParSet({ source: [S('1', '甲')], produits: [P(1, 'Vulpix')], traduire, cleProduit: () => null });
    assert.strictEqual(r.admis, false);
    assert.ok(r.discordances.some(d => d.type === 'produit-sans-cle'));
});

console.log('— CALIBRATION : la règle SAIT dire non (numéro Cardmarket caché, vérité connue) — un set fabriqué faux doit tomber');
// set de calibration : 4 groupes de 2 variantes ; la vérité (numéro Cardmarket) est connue puis CACHÉE à la règle, puis confrontée à ce qu'elle rend
const VRAI = [['0101', '甲', 1, '01'], ['0102', '甲', 2, '01'], ['0201', '乙', 3, '02'], ['0202', '乙', 4, '02'], ['0301', '丙', 5, '03'], ['0302', '丙', 6, '03'], ['0401', '丁', 7, '04'], ['0402', '丁', 8, '04']];
const NOMEN = { 甲: 'Vulpix', 乙: 'Eevee', 丙: 'Ponyta', 丁: 'Abra' };
const produitsConnus = VRAI.map(([, z, id, g]) => P(id, NOMEN[z], g));
const cache = produitsConnus.map(p => ({ idProduct: p.idProduct, name: p.name }));
const groupe = n => String(n).slice(0, 2);
t('calibration : set vrai, numéros cachés -> admis ET chaque attribution égale la vérité connue (0 faux)', () => {
    const r = prouverParSet({ source: VRAI.map(([n, z]) => S(n, z)), produits: cache, traduire, groupeDe: groupe });
    assert.strictEqual(r.admis, true, r.raison);
    let faux = 0; for (const a of r.attributions) { const v = produitsConnus.find(p => p.idProduct === a.idProduct); if (a.numero !== v.numero) faux++; }
    assert.strictEqual(r.attributions.length, 8); assert.strictEqual(faux, 0);
});
t('calibration : set FABRIQUÉ FAUX (un nom changé dans la source) -> tombe, numéros cachés ou non', () => {
    const faux = VRAI.map(([n, z]) => S(n, n === '0302' ? '丁' : z));
    assert.strictEqual(prouverParSet({ source: faux, produits: cache, traduire, groupeDe: groupe }).admis, false);
    assert.strictEqual(prouverParSet({ source: faux, produits: produitsConnus, traduire, groupeDe: groupe }).admis, false);
});
t('calibration : set FABRIQUÉ FAUX (deux groupes échangés dans la source) -> tombe SEULEMENT avec le numéro Cardmarket en témoin : limite écrite, le témoin reste obligatoire', () => {
    const echange = VRAI.map(([n, z]) => S(n.startsWith('02') ? '03' + n.slice(2) : n.startsWith('03') ? '02' + n.slice(2) : n, z));
    // les noms de la source sont inchangés, seuls les numéros de groupe sont échangés : le nom seul ne voit rien
    assert.strictEqual(prouverParSet({ source: echange, produits: cache, traduire, groupeDe: groupe }).admis, true);
    // avec le numéro Cardmarket en témoin, le groupe échangé est refusé
    assert.strictEqual(prouverParSet({ source: echange, produits: produitsConnus, traduire, groupeDe: groupe }).admis, false);
});

console.log(`\n${ok} passés, ${ko} en échec`);
process.exit(ko ? 1 : 0);
