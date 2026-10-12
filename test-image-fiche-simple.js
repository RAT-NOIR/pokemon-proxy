// node test-image-fiche-simple.js — la jointure d'une image artofpkm à une FICHE SIMPLE (collecte-cartes/image-fiche-simple.js).
// Le cas qui l'a fait écrire (T3d, 2026-10-12) : les fiches simples d'un set « sans page » portent l'impression
// { expansion: lisible(slug), source: 'cardmarket' } alors que la ligne de table nomme l'expansion PONCTUÉE (« Aura's Lucario », « Sun & Moon
// Family Pokémon Card Game ») : `impsDe` ne les voyait pas, le numéro de l'image ne désignait rien, et l'image restait sans carte.
const assert = require('assert');
const { candidatesParFicheSimple, expansionDeFicheSimple } = require('./collecte-cartes/image-fiche-simple');
const { nomImage } = require('./collecte-cartes/image-fiche-simple');
let ok = 0, ko = 0;
const t = (nom, f) => { try { f(); ok++; console.log(`✅ ${nom}`); } catch (e) { ko++; console.log(`❌ ${nom} : ${e.message}`); } };

const SLUG = 'Movie-Commemoration-VS-Pack-Auras-Lucario';
const exp = 'Movie Commemoration VS Pack Auras Lucario';
const fiche = (id, nom, numero, extra = {}) => ({ _id: id, nomEn: nom, ficheSimple: { le: 'x' }, sets: [SLUG], impressions: [{ tirage: 'jp', expansion: exp, numero, source: 'cardmarket' }], ...extra });
const kidd9 = fiche(-9, "Kidd's Weavile", '009'), kidd10 = fiche(-10, "Kidd's Weavile", '010'), grovyle = fiche(-1, "Ash's Grovyle", '001');
const cartes = [kidd9, kidd10, grovyle];
const o = { slug: SLUG, tirage: 'jp' };
const im = (numero, nomEn) => ({ numero, nomEn });

t('expansion écrite par la production : lisible(slug)', () => assert.strictEqual(expansionDeFicheSimple(SLUG), exp));
t('numéro ET nom concordent : la fiche simple est désignée (deux fiches de même nom, le numéro départage)', () => {
    assert.deepStrictEqual(candidatesParFicheSimple(im('009', "Kidd's Weavile"), cartes, o), [kidd9]);
    assert.deepStrictEqual(candidatesParFicheSimple(im('010', "Kidd's Weavile"), cartes, o), [kidd10]);
});
t('le numéro désigne une fiche simple mais le nom diffère (variante « Ash Ketchum\'s ») : rien — un nom variant reste un trou', () =>
    assert.deepStrictEqual(candidatesParFicheSimple(im('001', "Ash Ketchum's Grovyle"), cartes, o), []));
t('le nom est celui d\'une AUTRE fiche du set mais pas celle du numéro : rien', () =>
    assert.deepStrictEqual(candidatesParFicheSimple(im('001', "Kidd's Weavile"), cartes, o), []));
t('image sans nom : rien (pas de second élément)', () => assert.deepStrictEqual(candidatesParFicheSimple(im('001', null), cartes, o), []));
t('image sans numéro : rien', () => assert.deepStrictEqual(candidatesParFicheSimple(im(null, "Kidd's Weavile"), cartes, o), []));
t('une carte qui N\'EST PAS une fiche simple n\'entre pas (même impression, même nom)', () => {
    const vraie = { ...fiche(500, "Kidd's Weavile", '009'), ficheSimple: undefined };
    assert.deepStrictEqual(candidatesParFicheSimple(im('009', "Kidd's Weavile"), [vraie], o), []);
});
t('une fiche simple d\'un AUTRE set (sets ne porte pas le slug) n\'entre pas', () =>
    assert.deepStrictEqual(candidatesParFicheSimple(im('009', "Kidd's Weavile"), [{ ...kidd9, sets: ['Autre-Set'] }], o), []));
t('une impression d\'un autre tirage ou d\'une autre expansion n\'entre pas', () => {
    assert.deepStrictEqual(candidatesParFicheSimple(im('009', "Kidd's Weavile"), [fiche(-9, "Kidd's Weavile", '009', { impressions: [{ tirage: 'intl', expansion: exp, numero: '009', source: 'cardmarket' }] })], o), []);
    assert.deepStrictEqual(candidatesParFicheSimple(im('009', "Kidd's Weavile"), [fiche(-9, "Kidd's Weavile", '009', { impressions: [{ tirage: 'jp', expansion: 'Autre', numero: '009', source: 'cardmarket' }] })], o), []);
});
t('impression qui ne vient pas de Cardmarket : n\'entre pas', () =>
    assert.deepStrictEqual(candidatesParFicheSimple(im('009', "Kidd's Weavile"), [fiche(-9, "Kidd's Weavile", '009', { impressions: [{ tirage: 'jp', expansion: exp, numero: '009', source: 'bulbapedia' }] })], o), []));
t('deux fiches simples au même numéro ET au même nom : ambiguïté, les deux sont rendues (l\'appelant refuse)', () => {
    const a = fiche(-20, 'Potion', '008'), b = fiche(-21, 'Potion', '008');
    assert.strictEqual(candidatesParFicheSimple(im('008', 'Potion'), [a, b], o).length, 2);
});
t('le préfixe alphabétique du numéro est gardé (cleNumero) : « en1 » ne désigne pas « 1 »', () =>
    assert.deepStrictEqual(candidatesParFicheSimple(im('en1', "Kidd's Weavile"), [fiche(-9, "Kidd's Weavile", '1')], o), []));
t('nomImage est la normalisation du collecteur (crochets en espaces)', () => assert.strictEqual(nomImage('Foo [Bar]'), nomImage('Foo  Bar ')));
// le câblage : la voie n'est consultée QUE lorsque la clé par numéro ordinaire n'a rien désigné (additif), avec le slug et le tirage de la ligne.
// (argument optionnel : un autre collecteur-images.js à vérifier, p. ex. celui de main pour voir le test rouge)
t('collecteur-images.js appelle la voie fiche simple, seulement quand cands est vide et sans correction', () => {
    const src = require('fs').readFileSync(process.argv[2] || require('path').join(__dirname, 'collecteur-images.js'), 'utf8');
    assert.ok(/require\('\.\/collecte-cartes\/image-fiche-simple'\)/.test(src), 'le module n\'est pas importé');
    assert.ok(/if \(!corr && !cands\.length && num\) \{\s*const fsimples = candidatesParFicheSimple\(im, cartes, \{ slug, tirage: TIRAGE \}\);/.test(src), 'la voie n\'est pas câblée sous la condition « rien désigné »');
    assert.ok(!/const nomImage = n =>/.test(src), 'nomImage est encore défini en double dans le collecteur');
});
console.log(`\n${ko ? `⚠️ ${ko}/${ok + ko} en échec` : `🎉 ${ok}/${ok + ko} passés`}`);
process.exit(ko ? 1 : 0);
