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
t('deux Arceus au même nom : les attaques de la carte, toutes présentes dans les crochets du produit, départagent', () => {
    const decl = [arceusPlante, arceusFeu, arceusLvX];
    assert.deepStrictEqual(declarantesDuProduit(decl, 'Arceus', produit('Arceus', ['Grass', 'Leaf Refresh']), clesNom).map(c => c._id), [78932]);
    assert.deepStrictEqual(declarantesDuProduit(decl, 'Arceus', produit('Arceus', ['Fire', 'Bright Flame']), clesNom).map(c => c._id), [78140]);
});
t('Arceus LV.X ne se confond pas avec Arceus', () => assert.deepStrictEqual(declarantesDuProduit([arceusPlante, arceusFeu, arceusLvX], 'Arceus LV.X', produit('Arceus LV.X', ['Multitype', 'Meteor Blast']), clesNom).map(c => c._id), [78145]));
t('l\'ambiguïté RESTE quand les attaques ne départagent pas (aucune ou deux cartes les portent)', () => {
    const decl = [arceusPlante, arceusFeu];
    assert.strictEqual(declarantesDuProduit(decl, 'Arceus', produit('Arceus', ['Splash']), clesNom).length, 2);
    assert.strictEqual(declarantesDuProduit([arceusPlante, { ...arceusPlante, _id: 9 }], 'Arceus', produit('Arceus', ['Leaf Refresh']), clesNom).length, 2);
});
t('une carte sans attaque ne se départage jamais par les attaques', () => assert.strictEqual(attaquesDeLaCarteDansLeProduit({ attaques: [] }, produit('X', ['A'])), false));
t('un produit sans attaque ne désigne pas une carte à attaques', () => assert.strictEqual(attaquesDeLaCarteDansLeProduit(arceusPlante, produit('Arceus', [])), false));
console.log(process.exitCode ? `\n${ok} ok, ÉCHECS ci-dessus` : `\n${ok}/${ok} passés, 0 échec`);
