'use strict';
// Banc de collecte-cartes/clones.js — lectures FABRIQUÉES à la forme du cache de l'audit (aucune base). node test-clones.js
const assert = require('assert');
const C = require('./collecte-cartes/clones');
const G = require('./collecte-cartes/garde-lot');

let ok = 0, ko = 0;
const test = (nom, f) => { try { f(); ok++; console.log('  ok  ' + nom); } catch (e) { ko++; console.log('  ÉCHEC ' + nom + '\n        ' + String(e.message).split('\n')[0]); } };

// règles du site simulées (mêmes signatures que celles que detecter-clones.js importe du site)
const normaliserNumero = n => (n == null || String(n).trim() === '' ? null : String(n).trim().toLowerCase().replace(/^0+(?=\d)/, ''));
const expansionsDuSet = s => { const e = s.bulba?.expansion; return typeof e === 'string' ? [e] : (Array.isArray(e) ? e.filter(x => typeof x === 'string') : []); };
const tirageDuSet = s => s.tirage ?? s.region;
const impressionDuSet = (imp, cible) => imp.tirage === cible.tirage && cible.expansions.includes(imp.expansion);
const regles = { impressionDuSet, normaliserNumero, expansionsDuSet, tirageDuSet };

const set = (id, o = {}) => ({ _id: id, code: id, nomAffichage: id.replace(/-/g, ' '), tirage: 'intl', region: 'intl', idExpansion: [], bulba: { expansion: [] }, ...o });
const SL = set('Shining-Legends', { idExpansion: [1], bulba: { expansion: ['Shining Legends'] } });
const SLJP = set('Shining-Legends-JP', { tirage: 'jp', region: 'jp', idExpansion: [5], bulba: { expansion: ['Shining Legends'] } });
const SMP = set('SM-Black-Star-Promos', { idExpansion: [2], bulba: { expansion: ['SM Black Star Promos'] } });
const ASC = set('Ascended-Heroes', { idExpansion: [3], bulba: { expansion: ['Ascended Heroes'] } });
const XASC = set('Ascended-Heroes-Additionals', { idExpansion: [4], bulba: { expansion: ['Ascended Heroes'] } });
const VIDE = set('Set-Vide', { idExpansion: [9], bulba: { expansion: ['Vide'] } });

const prod = (idProduct, idExpansion, name, fiche = {}, setId = null) => ({ idProduct, idExpansion, name, setId, fiche: { classe: 'FICHE_OK', motifs: [], carteId: null, numero: null, setId: null, ...fiche } });
const imp = (tirage, expansion, numero, total = null) => ({ tirage, expansion, deck: null, numero, total });
const carte = (_id, nomEn, sets, impressions = [], images = []) => ({ _id, nomEn, pv: null, attaques: [], sets, impressions, images });
const ligne = (carteId, idProduct, slugSet, numeroFiche = null) => ({ carteId, idProduct, slugSet, numeroFiche });
const lecture = (o = {}) => ({ formatCache: 2, sets: [SL, SMP], cartes: [], lignes: [], produits: [], numerosProduits: [], ...o });
const cl = (r, id) => r.clones.find(c => c.carteId === id);
// un produit rattaché à une autre carte dans Shining-Legends : le set a donc des produits
const prodSL = prod(11, 1, 'Autre', { classe: 'FICHE_OK', carteId: 'x', numero: '1', setId: 'Shining-Legends' });
const prodSMP = prod(21, 2, 'Celebi', { classe: 'FICHE_OK', carteId: 'celebi', numero: 'SM79', setId: 'SM-Black-Star-Promos' });

// ── les 4 exemples du brief
test('Shining Celebi : set Shining-Legends, ligne dans SM-Black-Star-Promos -> clone produit-ailleurs vers SM79', () => {
    const l = lecture({
        cartes: [carte('celebi', 'Shining Celebi', ['Shining-Legends'], [imp('jp', 'Shining Legends', '3')])],
        lignes: [ligne('celebi', 901, 'SM-Black-Star-Promos', 'SM79')], produits: [prodSL, prodSMP],
    });
    const r = C.classerClones(l, regles);
    assert.strictEqual(r.clones.length, 1);
    const c = cl(r, 'celebi');
    assert.strictEqual(c.motif, 'produit-ailleurs');
    assert.strictEqual(c.set, 'Shining-Legends');
    assert.deepStrictEqual(c.vraieFiche, { slugSet: 'SM-Black-Star-Promos', idProduct: 901, numeroFiche: 'SM79' });
    assert.strictEqual(r.parMotif['produit-ailleurs'], 1);
});
test('composition-autre-region : aucune impression du set, impression de l\'expansion sous un autre tirage, pas de ligne ailleurs -> set du tirage jp', () => {
    const l = lecture({
        sets: [SL, SLJP], cartes: [carte('c1', 'Xyz', ['Shining-Legends'], [imp('jp', 'Shining Legends', '3')])], produits: [prodSL, prod(51, 5, 'Autre jp', { carteId: 'y', numero: '1', setId: 'Shining-Legends-JP' })],
    });
    const c = cl(C.classerClones(l, regles), 'c1');
    assert.strictEqual(c.motif, 'composition-autre-region');
    assert.deepStrictEqual(c.vraieFiche, { slugSet: 'Shining-Legends-JP', idProduct: null, numeroFiche: null });
});
test('composition-autre-region sans set publié du tirage : vraieFiche null', () => {
    const l = lecture({ cartes: [carte('c1', 'Xyz', ['Shining-Legends'], [imp('jp', 'Shining Legends', '3')])], produits: [prodSL] });
    const c = cl(C.classerClones(l, regles), 'c1');
    assert.strictEqual(c.motif, 'composition-autre-region');
    assert.strictEqual(c.vraieFiche, null);
});
test('Ultra Ball 68A : un produit SANS_LIGNE du set porte le numéro -> jointure-a-faire, pas un clone', () => {
    const l = lecture({
        cartes: [carte('ub', 'Ultra Ball', ['Shining-Legends'], [imp('intl', 'Shining Legends', '68A')])],
        lignes: [ligne('ub', 902, 'SM-Black-Star-Promos', 'SM1')], produits: [prodSL, prod(12, 1, 'Autre nom [x]', { classe: 'SANS_LIGNE' }), prodSMP],
        numerosProduits: [{ idProduct: 12, numero: '68a' }],
    });
    const r = C.classerClones(l, regles);
    assert.strictEqual(r.clones.length, 0);
    assert.strictEqual(r.jointures.length, 1);
    assert.strictEqual(r.jointures[0].carteId, 'ub');
    assert.strictEqual(r.jointures[0].par, 'numero');
});
test('jointure-a-faire par le nom : le nom Cardmarket décomposé (attaques retirées) égale nomEn', () => {
    const l = lecture({
        cartes: [carte('ub', 'Ultra Ball', ['Shining-Legends'], [imp('intl', 'Shining Legends', '7')])],
        lignes: [ligne('ub', 902, 'SM-Black-Star-Promos', 'SM1')], produits: [prodSL, prod(12, 1, 'Ultra Ball [Fetch]', { classe: 'SANS_LIGNE' }), prodSMP],
        numerosProduits: [{ idProduct: 12, numero: '99' }],
    });
    const r = C.classerClones(l, regles);
    assert.strictEqual(r.clones.length, 0);
    assert.deepStrictEqual(r.jointures.map(j => j.par), ['nom']);
});
test('xASC : carte dont tous les produits du set sont rattachés ailleurs, ligne dans Ascended-Heroes -> clone produit-ailleurs', () => {
    const l = lecture({
        sets: [ASC, XASC], cartes: [carte('a1', 'Alpha', ['Ascended-Heroes-Additionals'], [imp('intl', 'Ascended Heroes', '5')])],
        lignes: [ligne('a1', 903, 'Ascended-Heroes', '5')],
        produits: [prod(31, 3, 'Alpha', { carteId: 'a1', numero: '5', setId: 'Ascended-Heroes' }), prod(41, 4, 'Beta', { carteId: 'b1', numero: '6', setId: 'Ascended-Heroes-Additionals' })],
    });
    const r = C.classerClones(l, regles);
    assert.strictEqual(r.clones.length, 1);
    assert.strictEqual(r.clones[0].set, 'Ascended-Heroes-Additionals');
    assert.strictEqual(r.clones[0].vraieFiche.slugSet, 'Ascended-Heroes');
    assert.strictEqual(r.parSet['Ascended-Heroes-Additionals'], 1);
});
test('une carte avec une ligne dans le set n\'est jamais un clone, même avec une autre ligne ailleurs', () => {
    const l = lecture({
        cartes: [carte('c1', 'Pika', ['Shining-Legends'], [imp('intl', 'Shining Legends', '1')])],
        lignes: [ligne('c1', 11, 'Shining-Legends', '1'), ligne('c1', 903, 'SM-Black-Star-Promos', 'SM1')], produits: [prodSL, prodSMP],
    });
    const r = C.classerClones(l, regles);
    assert.strictEqual(r.clones.length, 0); assert.strictEqual(r.jointures.length, 0); assert.strictEqual(r.orphelins.length, 0);
});
test('une carte dont un produit porte fiche {carteId, setId=set} n\'est pas un clone (même sans ligne)', () => {
    const l = lecture({ cartes: [carte('x', 'Autre', ['Shining-Legends'], [imp('intl', 'Shining Legends', '1')])], lignes: [ligne('x', 5, 'SM-Black-Star-Promos', '1')], produits: [prodSL, prodSMP] });
    assert.strictEqual(C.classerClones(l, regles).clones.length, 0);
});
test('orphelin : aucun produit nulle part, aucune impression d\'une autre région', () => {
    const l = lecture({ cartes: [carte('o', 'Orphan', ['Shining-Legends'], [imp('intl', 'Shining Legends', '9')])], produits: [prodSL] });
    const r = C.classerClones(l, regles);
    assert.strictEqual(r.clones.length, 0);
    assert.deepStrictEqual(r.orphelins.map(o => o.carteId), ['o']);
});
test('set-sans-produit : le set n\'a aucun produit -> listé, ses cartes ne sont ni clones ni orphelines', () => {
    const l = lecture({ sets: [VIDE, SMP], cartes: [carte('v', 'Vide1', ['Set-Vide'], [])], lignes: [ligne('v', 5, 'SM-Black-Star-Promos', '1')], produits: [prodSMP] });
    const r = C.classerClones(l, regles);
    assert.strictEqual(r.clones.length, 0); assert.strictEqual(r.orphelins.length, 0);
    assert.deepStrictEqual(r.setsSansProduit, [{ set: 'Set-Vide', cartes: 1 }]);
});
test('un set non publié (sans nomAffichage) n\'est jamais audité ni vraie fiche', () => {
    const NP = set('Non-Publie', { nomAffichage: null, idExpansion: [7], bulba: { expansion: ['Shining Legends'] } });
    const l = lecture({ sets: [SL, NP], cartes: [carte('c', 'Zed', ['Shining-Legends', 'Non-Publie'], [imp('intl', 'Shining Legends', '2')])], lignes: [ligne('c', 5, 'Non-Publie', '2')], produits: [prodSL] });
    const r = C.classerClones(l, regles);
    assert.strictEqual(r.clones.length, 0);
    assert.strictEqual(r.orphelins.length, 1);
});
test('la vraie fiche préfère un set du même tirage', () => {
    const SMPJ = set('SMP-JP', { tirage: 'jp', region: 'jp', idExpansion: [8], bulba: { expansion: ['SMP jp'] } });
    const l = lecture({ sets: [SL, SMPJ, SMP], cartes: [carte('c', 'Zed', ['Shining-Legends'], [])], lignes: [ligne('c', 1, 'SMP-JP', 'J1'), ligne('c', 2, 'SM-Black-Star-Promos', 'I1')], produits: [prodSL, prodSMP] });
    assert.strictEqual(cl(C.classerClones(l, regles), 'c').vraieFiche.slugSet, 'SM-Black-Star-Promos');
});
test('refus : règle injectée absente, population vide', () => {
    assert.throws(() => C.classerClones(lecture(), { impressionDuSet }), /absente/);
    assert.throws(() => C.classerClones({ sets: [], cartes: [], lignes: [], produits: [] }, regles), /population vide/);
});

// ── images
const im = (set, numero, cleR2, o = {}) => ({ set, numero, cleR2, ...o });
const celebiImages = images => lecture({ cartes: [carte('celebi', 'Shining Celebi', ['Shining-Legends'], [], images)], lignes: [ligne('celebi', 901, 'SM-Black-Star-Promos', 'SM79')], produits: [prodSL, prodSMP] });
test('images : copiée vers la vraie fiche du MÊME tirage (numéro = numeroFiche), les autres sets intouchés', () => {
    const c = cl(C.classerClones(celebiImages([im('Shining-Legends', '3', 'k/a'), im('Autre', '3', 'k/z')]), regles), 'celebi');
    assert.deepStrictEqual(c.images, [{ cleR2: 'k/a', numero: '3', action: 'copier', vers: { set: 'SM-Black-Star-Promos', numero: 'SM79' } }]);
});
test('images : retirée sans copie si la carte a déjà une entrée pour la vraie fiche', () => {
    const c = cl(C.classerClones(celebiImages([im('Shining-Legends', '3', 'k/a'), im('SM-Black-Star-Promos', 'SM79', 'k/b')]), regles), 'celebi');
    assert.deepStrictEqual(c.images, [{ cleR2: 'k/a', numero: '3', action: 'retirer', vers: null }]);
});
test('images : JAMAIS copiée entre deux tirages différents', () => {
    const SMPJ = set('SMP-JP', { tirage: 'jp', region: 'jp', idExpansion: [8], bulba: { expansion: ['SMP jp'] } });
    const l = lecture({ sets: [SL, SMPJ], cartes: [carte('c', 'Zed', ['Shining-Legends'], [], [im('Shining-Legends', '3', 'k/a')])], lignes: [ligne('c', 1, 'SMP-JP', 'J1')], produits: [prodSL, prod(61, 8, 'P', { carteId: 'q', numero: '1', setId: 'SMP-JP' })] });
    assert.deepStrictEqual(cl(C.classerClones(l, regles), 'c').images, [{ cleR2: 'k/a', numero: '3', action: 'retirer', vers: null }]);
});
test('images : plusieurs entrées dans le set -> une seule copiée, toutes comptées', () => {
    const c = cl(C.classerClones(celebiImages([im('Shining-Legends', '3', 'k/a'), im('Shining-Legends', '4', 'k/c')]), regles), 'celebi');
    assert.deepStrictEqual(c.images.map(i => i.action), ['copier', 'retirer']);
});
test('images : composition-autre-region sans vraie fiche -> retirée', () => {
    const l = lecture({ cartes: [carte('c1', 'Xyz', ['Shining-Legends'], [imp('jp', 'Shining Legends', '3')], [im('Shining-Legends', '3', 'k/a')])], produits: [prodSL] });
    assert.deepStrictEqual(cl(C.classerClones(l, regles), 'c1').images.map(i => i.action), ['retirer']);
});

// ── appliquer / vérifier / annoncer
const clonesCelebi = images => C.classerClones(celebiImages(images), regles).clones;
test('appliquer : retire le slug de sets, copie puis retire les images du set, ne touche rien d\'autre', () => {
    const doc = { _id: 'celebi', nomEn: 'Shining Celebi', sets: ['Shining-Legends', 'Autre'], impressions: [{ tirage: 'jp' }], images: [im('Shining-Legends', '3', 'k/a', { vignette: { cleR2: 'v' }, sha256: 'h' }), im('Autre', '3', 'k/z')] };
    const [c] = clonesCelebi([im('Shining-Legends', '3', 'k/a')]);
    const r = C.appliquer(doc, c);
    assert.deepStrictEqual(r.doc.sets, ['Autre']);
    assert.deepStrictEqual(r.doc.images.map(i => `${i.set}|${i.numero}|${i.cleR2}`), ['Autre|3|k/z', 'SM-Black-Star-Promos|SM79|k/a']);
    assert.strictEqual(r.doc.images[1].sha256, 'h'); assert.deepStrictEqual(r.doc.images[1].vignette, { cleR2: 'v' });
    assert.strictEqual(r.retirees.length, 1); assert.strictEqual(r.copiees.length, 1);
    assert.deepStrictEqual(doc.sets, ['Shining-Legends', 'Autre']);   // pure
    assert.deepStrictEqual(r.doc.impressions, doc.impressions);
});
test('verifierEtat : état identique -> aucune erreur', () => {
    const [c] = clonesCelebi([im('Shining-Legends', '3', 'k/a')]);
    const docs = new Map([['celebi', { _id: 'celebi', sets: ['Shining-Legends'], images: [im('Shining-Legends', '3', 'k/a')] }]]);
    assert.deepStrictEqual(C.verifierEtat({ clones: [c], docs, lignes: [ligne('celebi', 901, 'SM-Black-Star-Promos', 'SM79')], attendu: 1, attenduImages: 1 }), []);
});
test('verifierEtat refuse : nombre attendu, images attendues, set disparu, ligne apparue, ligne ailleurs disparue, entrée image changée', () => {
    const [c] = clonesCelebi([im('Shining-Legends', '3', 'k/a')]);
    const bon = () => new Map([['celebi', { _id: 'celebi', sets: ['Shining-Legends'], images: [im('Shining-Legends', '3', 'k/a')] }]]);
    const L = [ligne('celebi', 901, 'SM-Black-Star-Promos', 'SM79')];
    const err = (o) => C.verifierEtat({ clones: [c], docs: bon(), lignes: L, attendu: 1, attenduImages: 1, ...o });
    assert.ok(err({ attendu: 2 }).length);
    assert.ok(err({ attenduImages: 2 }).length);
    assert.ok(err({ docs: new Map([['celebi', { _id: 'celebi', sets: [], images: [] }]]) }).length);
    assert.ok(err({ lignes: [...L, ligne('celebi', 11, 'Shining-Legends', '3')] }).length);
    assert.ok(err({ lignes: [] }).length);
    assert.ok(err({ docs: new Map([['celebi', { _id: 'celebi', sets: ['Shining-Legends'], images: [im('Shining-Legends', '3', 'k/AUTRE')] }]]) }).length);
    assert.ok(err({ docs: new Map([['celebi', { _id: 'celebi', sets: ['Shining-Legends'], images: [im('Shining-Legends', '3', 'k/a'), im('SM-Black-Star-Promos', 'SM79', 'k/b')] }]]) }).length);
    assert.ok(err({ docs: new Map() }).length);
});
test('annoncer : les clés sont celles que la garde compare, et la garde ne trouve AUCUNE baisse non annoncée', () => {
    const doc = { _id: 'celebi', nomEn: 'Shining Celebi', categorie: 'pokemon', sets: ['Shining-Legends', 'Autre'], impressions: [], liens: { idProduct: [] },
        images: [im('Shining-Legends', '3', 'k/a', { vignette: { cleR2: 'v' }, moyen: { cleR2: 'm' } }), im('Autre', '3', 'k/z', { vignette: { cleR2: 'v2' } })] };
    const clones = clonesCelebi([im('Shining-Legends', '3', 'k/a')]);
    const { annonce, nonAutorisees } = C.annoncer(new Map([['celebi', doc]]), clones);
    assert.deepStrictEqual(annonce, { 'cartes set:Shining-Legends': 1, 'noms-cartes set:Shining-Legends': 1, 'categories-cartes set:Shining-Legends': 1, 'images set:Shining-Legends': 1, 'vignettes-set set:Shining-Legends': 1, 'moyens-set set:Shining-Legends': 1 });
    assert.deepStrictEqual(nonAutorisees, []);
    G.validerAnnonces(annonce);
});
test('annoncer : sans annonce la garde crierait (le test peut échouer)', () => {
    const doc = { _id: 'celebi', nomEn: 'Shining Celebi', sets: ['Shining-Legends'], images: [im('Shining-Legends', '3', 'k/a', { vignette: { cleR2: 'v' } })] };
    const [c] = clonesCelebi([im('Shining-Legends', '3', 'k/a')]);
    const avant = G.compterEtat({ cartes: [doc] }), apres = G.compterEtat({ cartes: [C.appliquer(doc, c).doc] });
    assert.ok(G.comparer(avant, apres, {}).nonAutorisees.length >= 3);
});

console.log(`\n${ok} passés, ${ko} en échec`);
process.exit(ko ? 1 : 0);
