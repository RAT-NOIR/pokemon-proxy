// Banc PUR (aucune base) de collecte-cartes/declarantes.js : la jointure d'un produit à sa carte DÉCLARANTE (creer-sets-sans-page.js, DECLARANTES).
//   node test-declarantes.js
const assert = require('assert');
const { nomsDeclarante, attaquesDeLaCarteDansLeProduit, declarantesDuProduit } = require('./collecte-cartes/declarantes');
const { clesNom } = require('./collecte-cartes/jointure');
let ok = 0;
const t = (nom, f) => { try { f(); ok++; console.log('  ok  ' + nom); } catch (e) { console.error('  ÉCHEC  ' + nom + '\n     ' + e.message); process.exitCode = 1; } };

// des cartes de la forme réelle (cartes : nomEn, niveau, bulba.titre, attaques[].nom)
const arceusPlante = { _id: 78932, nomEn: 'Arceus', bulba: { titre: 'Arceus (Arceus AR2)' }, attaques: [{ nom: 'Leaf Refresh' }] };
const arceusFeu = { _id: 78140, nomEn: 'Arceus', bulba: { titre: 'Arceus (Arceus AR3)' }, attaques: [{ nom: 'Bright Flame' }] };
const arceusLvX = { _id: 78145, nomEn: 'Arceus LV.X', bulba: { titre: 'Arceus LV.X (Arceus 95)' }, attaques: [{ nom: 'Meteor Blast' }] };
const pikachuEtoile = { _id: 45923, nomEn: 'Pikachu', bulba: { titre: 'Pikachu ☆ (EX Holon Phantoms 104)' }, attaques: [{ nom: 'Thundershock' }, { nom: 'Spring Back' }] };
const mewtwoEtoile = { _id: 45922, nomEn: 'Mewtwo', bulba: { titre: 'Mewtwo ☆ (EX Holon Phantoms 103)' }, attaques: [{ nom: 'Energy Absorption' }, { nom: 'Psychic Star' }] };
const pikachuOrdinaire = { _id: 1, nomEn: 'Pikachu', bulba: { titre: 'Pikachu (Jungle 60)' }, attaques: [{ nom: 'Gnaw' }] };
const produit = (nom, attaques) => ({ nom, attaques });

t('une carte ordinaire se joint sous son nom', () => assert.deepStrictEqual(nomsDeclarante(pikachuOrdinaire), ['Pikachu']));
t('une carte ☆ (le ☆ est dans le TITRE) se joint sous « … Gold Star », jamais sous le nom nu', () => assert.deepStrictEqual(nomsDeclarante(pikachuEtoile), ['Pikachu Gold Star']));
t('le ☆ d\'une parenthèse de titre ne compte pas (« (Set ☆ 4) »)', () => assert.deepStrictEqual(nomsDeclarante({ nomEn: 'Eevee', bulba: { titre: 'Eevee (Set ☆ 4)' } }), ['Eevee']));
t('le produit « Pikachu Gold Star » désigne la Pikachu ☆ et elle seule', () => {
    const d = declarantesDuProduit([pikachuEtoile, mewtwoEtoile, pikachuOrdinaire], 'Pikachu Gold Star', produit('Pikachu Gold Star', ['Thundershock', 'Spring Back']), clesNom);
    assert.deepStrictEqual(d.map(c => c._id), [45923]);
});
t('le produit « Pikachu » ordinaire ne désigne pas la Pikachu ☆', () => {
    const d = declarantesDuProduit([pikachuEtoile], 'Pikachu', produit('Pikachu', ['Gnaw']), clesNom);
    assert.deepStrictEqual(d, []);
});
t('départage STRICT : A[X] / B[X,Y] — produit [X,Y] => B, produit [X] => A, produit [X,Z] ou [Y] => ambiguïté qui reste', () => {
    const A = { _id: 1, nomEn: 'Zubat', bulba: { titre: 'Zubat (S 1)' }, attaques: [{ nom: 'X' }] };
    const B = { _id: 2, nomEn: 'Zubat', bulba: { titre: 'Zubat (S 2)' }, attaques: [{ nom: 'X' }, { nom: 'Y' }] };
    assert.deepStrictEqual(declarantesDuProduit([A, B], 'Zubat', produit('Zubat', ['X', 'Y']), clesNom).map(c => c._id), [2]);
    assert.deepStrictEqual(declarantesDuProduit([A, B], 'Zubat', produit('Zubat', ['X']), clesNom).map(c => c._id), [1]);
    assert.strictEqual(declarantesDuProduit([A, B], 'Zubat', produit('Zubat', ['X', 'Z']), clesNom).length, 2);
    assert.strictEqual(declarantesDuProduit([A, B], 'Zubat', produit('Zubat', ['Y']), clesNom).length, 2);
});
t('l\'égalité est celle des ENSEMBLES normalisés (casse, espaces, ordre, doublons)', () => {
    assert.strictEqual(attaquesDeLaCarteDansLeProduit({ attaques: [{ nom: 'Leaf  Refresh' }, { nom: 'Cut' }] }, produit('X', ['cut', 'leaf refresh', 'Cut'])), true);
});
t('Arceus : un produit dont les crochets portent aussi un type (« Grass ») NE départage PAS — le set est refusé, pas forcé', () => {
    const decl = [arceusPlante, arceusFeu];
    assert.strictEqual(declarantesDuProduit(decl, 'Arceus', produit('Arceus', ['Grass', 'Leaf Refresh']), clesNom).length, 2);
    assert.deepStrictEqual(declarantesDuProduit(decl, 'Arceus', produit('Arceus', ['Leaf Refresh']), clesNom).map(c => c._id), [78932]);
});
t('Arceus LV.X ne se confond pas avec Arceus', () => assert.deepStrictEqual(declarantesDuProduit([arceusPlante, arceusFeu, arceusLvX], 'Arceus LV.X', produit('Arceus LV.X', ['Multitype', 'Meteor Blast']), clesNom).map(c => c._id), [78145]));
t('l\'ambiguïté RESTE quand les attaques ne départagent pas (aucune ou deux cartes les portent)', () => {
    const decl = [arceusPlante, arceusFeu];
    assert.strictEqual(declarantesDuProduit(decl, 'Arceus', produit('Arceus', ['Splash']), clesNom).length, 2);
    assert.strictEqual(declarantesDuProduit([arceusPlante, { ...arceusPlante, _id: 9 }], 'Arceus', produit('Arceus', ['Leaf Refresh']), clesNom).length, 2);
});
t('une carte sans attaque ne se départage jamais par les attaques', () => assert.strictEqual(attaquesDeLaCarteDansLeProduit({ attaques: [] }, produit('X', ['A'])), false));
t('un produit sans attaque ne désigne pas une carte à attaques', () => assert.strictEqual(attaquesDeLaCarteDansLeProduit(arceusPlante, produit('Arceus', [])), false));
// ── T4b (2026-10-12) : le deck, le numéro témoin, le départage d'Arceus par le numéro, la passe « - » ──────────────────────────────────
const D = require('./collecte-cartes/declarantes');
const SET_AGF = { tirage: 'jp', expansion: 'Arceus LV.X Deck: Grass & Fire' };
const imp = (numero, deck = null, expansion = SET_AGF.expansion) => ({ tirage: 'jp', expansion, deck, numero });
const arcP = { ...arceusPlante, impressions: [imp('005')] }, arcF = { ...arceusFeu, impressions: [imp('008')] };
t('deck : les déclarantes d\'un deck ne contiennent pas celles d\'un autre deck du même nom d\'expansion', () => {
    const a = { _id: 1, nomEn: 'Rare Candy', impressions: [imp('022', 'Venusaur Deck', 'Classic'), imp('023', 'Charizard Deck', 'Classic')] };
    const b = { _id: 2, nomEn: 'Dragonite', impressions: [imp('003', 'Charizard Deck', 'Classic')] };
    assert.deepStrictEqual(D.declarantesDuSet([a, b], { tirage: 'jp', expansion: 'Classic', deck: 'Venusaur Deck' }).map(c => c._id), [1]);
    assert.deepStrictEqual(D.declarantesDuSet([a, b], { tirage: 'jp', expansion: 'Classic', deck: ' charizard  deck' }).map(c => c._id), [1, 2]);
    assert.deepStrictEqual(D.declarantesDuSet([a, b], { tirage: 'jp', expansion: 'Classic' }).map(c => c._id), [1, 2]);
});
t('Arceus par le NUMÉRO : produit n°005 [Grass | Leaf Refresh] => la Plante, n°008 [Fire | Bright Flame] => la Feu', () => {
    const o = { set: SET_AGF };
    assert.deepStrictEqual(declarantesDuProduit([arcP, arcF], 'Arceus', { nom: 'Arceus', numero: '005', attaques: ['Grass', 'Leaf Refresh'] }, clesNom, o).map(c => c._id), [78932]);
    assert.deepStrictEqual(declarantesDuProduit([arcP, arcF], 'Arceus', { nom: 'Arceus', numero: '008', attaques: ['Fire', 'Bright Flame'] }, clesNom, o).map(c => c._id), [78140]);
});
t('Arceus par le numéro : le numéro SEUL ne suffit pas (attaques non incluses => l\'ambiguïté reste)', () => {
    assert.strictEqual(declarantesDuProduit([arcP, arcF], 'Arceus', { nom: 'Arceus', numero: '005', attaques: ['Splash'] }, clesNom, { set: SET_AGF }).length, 2);
});
t('Arceus par le numéro : sans `o.set`, rien ne change (le comportement des 7 sets du lot 6)', () => {
    assert.strictEqual(declarantesDuProduit([arcP, arcF], 'Arceus', { nom: 'Arceus', numero: '005', attaques: ['Grass', 'Leaf Refresh'] }, clesNom).length, 2);
});
t('témoin du numéro : 003 chez nous / 004 chez Cardmarket => contredit ; absent d\'un côté => ne contredit rien', () => {
    const sceptile = { _id: 78071, nomEn: 'Sceptile', impressions: [imp('003')] };
    assert.strictEqual(D.numeroContredit(sceptile, { numero: '004' }, SET_AGF), true);
    assert.strictEqual(D.numeroContredit(sceptile, { numero: '003' }, SET_AGF), false);
    assert.strictEqual(D.numeroContredit(sceptile, { numero: '03' }, SET_AGF), false);
    assert.strictEqual(D.numeroContredit(sceptile, { numero: null }, SET_AGF), false);
    assert.strictEqual(D.numeroContredit({ _id: 1, nomEn: 'X', impressions: [imp(null)] }, { numero: '004' }, SET_AGF), false);
});
const boss = { _id: 248285, nomEn: 'Boss\'s Orders', bulba: { titre: 'Boss\'s Orders (Rocket 1)' }, impressions: [imp('029', 'Venusaur & Lugia ex Deck', 'Classic')] };
const SET_CL = { tirage: 'jp', expansion: 'Classic', deck: 'Venusaur & Lugia ex Deck' };
t('passe « - » : « Boss\'s Orders - Giovanni » n°029 => la déclarante « Boss\'s Orders » n°029 (séparateur « - » ET même numéro)', () => {
    assert.strictEqual(D.declarantePrefixeMemeNumero([boss], 'Boss\'s Orders - Giovanni', { numero: '029' }, SET_CL)?._id, 248285);
});
t('passe « - » : refus sans le séparateur (Burmy Trash Cloak), autre numéro, ou deux candidates', () => {
    const burmy = { _id: 5, nomEn: 'Burmy', impressions: [imp('010', null, 'AoA')] };
    assert.strictEqual(D.declarantePrefixeMemeNumero([burmy], 'Burmy Trash Cloak Lv.11', { numero: '010' }, { tirage: 'jp', expansion: 'AoA' }), null);
    assert.strictEqual(D.declarantePrefixeMemeNumero([boss], 'Boss\'s Orders - Giovanni', { numero: '030' }, SET_CL), null);
    assert.strictEqual(D.declarantePrefixeMemeNumero([boss, { ...boss, _id: 9 }], 'Boss\'s Orders - Giovanni', { numero: '029' }, SET_CL), null);
    assert.strictEqual(D.declarantePrefixeMemeNumero([boss], 'Boss\'s Orders - Giovanni', { numero: null }, SET_CL), null);
});
console.log(process.exitCode ? `\n${ok} ok, ÉCHECS ci-dessus` : `\n${ok}/${ok} passés, 0 échec`);
