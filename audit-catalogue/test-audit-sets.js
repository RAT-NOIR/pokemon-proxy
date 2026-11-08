'use strict';
// Banc de audit-sets.js — lectures FABRIQUÉES (aucune base). node audit-catalogue/test-audit-sets.js
const assert = require('assert');
const A = require('./audit-sets');

let ok = 0, ko = 0;
const test = (nom, f) => { try { f(); ok++; console.log('  ok  ' + nom); } catch (e) { ko++; console.log('  ÉCHEC ' + nom + '\n        ' + String(e.message).split('\n')[0]); } };

// règles du site simulées (mêmes signatures que impressionDuSet / normaliserNumero du site)
const normaliserNumero = n => (n == null || String(n).trim() === '' ? null : String(n).trim().toLowerCase().replace(/^0+(?=\d)/, ''));
// même contrat que lib/impressionDuSet.ts : une liste d'expansions vide n'accepte AUCUNE impression
const impressionDuSet = (imp, cible) => imp.tirage === cible.tirage && cible.expansions.includes(imp.expansion);
const expansionsDuSet = s => { const e = s.bulba?.expansion; return typeof e === 'string' ? [e] : (Array.isArray(e) ? e.filter(x => typeof x === 'string') : []); };
const tirageDuSet = s => s.tirage ?? s.region;
const editionLocaleDuSet = () => null;
const visuelAdmisPourLaRegion = m => !m.refuse;
const imageDeLImpression = (images, numero) => { const v = normaliserNumero(numero); if (v === null) return images[0] ?? null; return images.find(m => normaliserNumero(m.numero) === v) ?? images.find(m => normaliserNumero(m.numero) === null) ?? null; };
const memeCodeSaufFin = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && a !== b && a.slice(0, -1) === b.slice(0, -1) && /\d/.test(a.slice(0, -1));
const exclure = (s, table = []) => {
    const exclus = [], sansObjet = [];
    for (const e of table) if (e.set === s.set) for (const n of e.numeros) (s.trous.includes(n) ? exclus : sansObjet).push(n);
    return { set: s.set, trous: s.trous.filter(n => !exclus.includes(n)), manque: Math.max(0, s.manque - exclus.length), exclus, sansObjet };
};
const regles = { impressionDuSet, normaliserNumero, memeCodeSaufFin, exclure: s => exclure(s, [{ set: 'S1', numeros: ['4'] }]), expansionsDuSet, tirageDuSet, editionLocaleDuSet, imageDeLImpression, visuelAdmisPourLaRegion };

const imp = (numero, total = 3) => ({ tirage: 'intl', expansion: 'Exp', numero, total });
const carte = (id, nom, numeros, extra = {}) => ({ _id: id, nomEn: nom, pv: '60', attaques: ['Charge'], sets: ['S1'], impressions: [].concat(numeros).map(n => imp(n)), images: [], ...extra });
const set = (o = {}) => ({ _id: 'S1', code: 'S1', nomAffichage: 'Set Un', tirage: 'intl', region: 'intl', totalImprime: 3, idExpansion: [10], bulba: { expansion: ['Exp'] }, deck: null, ...o });
const lig = (carteId, idProduct, numeroFiche = null) => ({ carteId, idProduct, slugSet: 'S1', numeroFiche });
const prod = (idProduct, o = {}) => ({ idProduct, idExpansion: 10, name: 'P' + idProduct, setId: 'S1', fiche: { classe: 'FICHE_OK', motifs: [] }, visuel: { classe: 'A_COMPARER', motifs: [] }, ...o });
const lecture = (o = {}) => ({ sets: [set()], cartes: [], lignes: [], produits: [], numerosProduits: [], offresParExpansion: { 10: 5 }, trousNommes: {}, restesParProduit: {}, ...o });
const img = (set, numero = null, o = {}) => ({ set, numero, cleR2: `k/${set}/${numero}`, ...o });
const auditer = (l, r = regles) => A.auditer(l, r);
const un = a => a.sets.find(s => s.set === 'S1');
const causes = (arr) => arr.map(x => x.cause).sort();

// ── un set complet : 0 trou
test('set complet et sain : tous compteurs à 0', () => {
    const l = lecture({
        cartes: [1, 2, 3].map(i => carte('c' + i, 'Nom' + i, String(i), { images: [img('S1', String(i))], attaques: ['A' + i] })),
        lignes: [1, 2, 3].map(i => lig('c' + i, 100 + i)),
        produits: [1, 2, 3].map(i => prod(100 + i, { fiche: { classe: 'FICHE_OK', motifs: [], carteId: 'c' + i, numero: String(i), setId: 'S1' } })),
    });
    const s = un(auditer(l));
    assert.strictEqual(s.attendu, 3); assert.strictEqual(s.affichees, 3);
    for (const k of ['sansVisuel', 'sansNumero', 'sansProduit', 'doublons', 'produitsSansFiche', 'manquants']) assert.strictEqual(s[k].n, 0, k);
    assert.strictEqual(s.trous, 0);
});

// ── sans visuel
test('sans visuel : aucune image en base', () => {
    const l = lecture({ cartes: [carte('c1', 'A', '1')], lignes: [lig('c1', 101)], produits: [prod(101, { fiche: { classe: 'FICHE_OK', carteId: 'c1', numero: '1', setId: 'S1' } })] });
    assert.deepStrictEqual(causes(un(auditer(l)).sansVisuel.items), ['aucune-image-en-base']);
});
test('sans visuel : images d un autre set seulement', () => {
    const l = lecture({ cartes: [carte('c1', 'A', '1', { images: [img('AUTRE', '1')] })] });
    assert.deepStrictEqual(causes(un(auditer(l)).sansVisuel.items), ['image-d-un-autre-set-seulement']);
});
test('sans visuel : image du set mais d un autre numéro', () => {
    const l = lecture({ cartes: [carte('c1', 'A', '1', { images: [img('S1', '9')] })] });
    assert.deepStrictEqual(causes(un(auditer(l)).sansVisuel.items), ['image-d-un-autre-numero']);
});
test('sans visuel : numéro manquant sur la fiche (images du set, pas de numéro)', () => {
    const l = lecture({ cartes: [carte('c1', 'A', [null], { images: [img('S1', '1'), img('S1', '2')] })] });
    // fiche sans numéro mais une image du set existe : elle n'est pas rattachable à un numéro → l'entrée sans numéro a l'image du set, pas de trou visuel
    assert.strictEqual(un(auditer(l)).sansVisuel.n, 0);
    const l2 = lecture({ cartes: [carte('c1', 'A', [null])] });   // et sans image du tout : cause = aucune image
    assert.deepStrictEqual(causes(un(auditer(l2)).sansVisuel.items), ['aucune-image-en-base']);
});
test('sans visuel : numéro manquant quand l image du set existe mais la fiche numérotée n en est pas', () => {
    const l = lecture({ cartes: [carte('c1', 'A', [null, '5'], { images: [img('S1', '5')] })] });
    // la fiche 5 a son image ; l entrée sans numéro est la même carte : sans numéro (un trou), pas de trou visuel supplémentaire
    const s = un(auditer(l));
    assert.strictEqual(s.sansVisuel.n, 0);
});
test('sans visuel : règle bloquante avec son motif (produits tous MANQUANT)', () => {
    const l = lecture({ cartes: [carte('c1', 'A', '1', { images: [img('S1', '1')] })], lignes: [lig('c1', 101)],
        produits: [prod(101, { fiche: { classe: 'FICHE_OK', carteId: 'c1', numero: '1', setId: 'S1' }, visuel: { classe: 'MANQUANT', motifs: ['repli-refuse:tampon'] } })] });
    assert.deepStrictEqual(causes(un(auditer(l)).sansVisuel.items), ['regle-bloquante:repli-refuse:tampon']);
});
test('sans visuel : produits MANQUANT sans motif → cause-inconnue (jamais un silence)', () => {
    const l = lecture({ cartes: [carte('c1', 'A', '1', { images: [img('S1', '1')] })], lignes: [lig('c1', 101)],
        produits: [prod(101, { fiche: { classe: 'FICHE_OK', carteId: 'c1', numero: '1', setId: 'S1' }, visuel: { classe: 'MANQUANT', motifs: [] } })] });
    assert.deepStrictEqual(causes(un(auditer(l)).sansVisuel.items), ['cause-inconnue']);
});
test('numéros normalisés : 006 et 6 sont la même entrée / image', () => {
    const l = lecture({ cartes: [carte('c1', 'A', '006', { images: [img('S1', '6')] })] });
    assert.strictEqual(un(auditer(l)).sansVisuel.n, 0);
});

test('numéros normalisés : 006 et 6 d une même carte font UNE entrée', () => {
    assert.strictEqual(un(auditer(lecture({ cartes: [carte('c1', 'A', ['006', '6'], { images: [img('S1', '6')] })] }))).affichees, 1);
});

// ── sans numéro
test('sans numéro : impression du set sans numéro', () => {
    const l = lecture({ cartes: [carte('c1', 'A', [null], { images: [img('S1')] })] });
    const s = un(auditer(l));
    assert.deepStrictEqual(causes(s.sansNumero.items), ['impression-sans-numero']);
});
test('sans numéro : aucune impression du set (carte rattachée au set, impression d un autre tirage)', () => {
    const c = carte('c1', 'A', [], { impressions: [{ tirage: 'jp', expansion: 'Exp', numero: '1', total: 3 }], images: [img('S1')] });
    assert.deepStrictEqual(causes(un(auditer(lecture({ cartes: [c] }))).sansNumero.items), ['expansion-declaree-sans-impression']);
});
test('carte sans nomEn : hors affichage (règle du site)', () => {
    const c = carte('c1', '', '1');
    assert.strictEqual(un(auditer(lecture({ cartes: [c] }))).affichees, 0);
});

// ── sans produit (jumelles orphelines)
test('sans produit : aucun produit dans l expansion', () => {
    const l = lecture({ cartes: [carte('c1', 'A', '1', { images: [img('S1', '1')] })] });
    assert.deepStrictEqual(causes(un(auditer(l)).sansProduit.items), ['expansion-sans-produit-cardmarket']);
});
test('sans produit : jumelle 101a sans produit alors que 101 en a un', () => {
    const l = lecture({ sets: [set({ totalImprime: 101 })],
        cartes: [carte('c1', 'Evoli', '101', { images: [img('S1', '101')] }), carte('c2', 'Evoli', '101a', { images: [img('S1', '101a')] })],
        lignes: [lig('c1', 500)], produits: [prod(500, { fiche: { classe: 'FICHE_OK', carteId: 'c1', numero: '101', setId: 'S1' } })] });
    const a = un(auditer(l));
    assert.deepStrictEqual(a.sansProduit.items.map(x => [x.numero, x.cause]), [['101a', 'jumelle-suffixe-sans-produit']]);
});
test('sans produit : des produits sans ligne attendent dans l expansion', () => {
    const l = lecture({ cartes: [carte('c1', 'A', '1', { images: [img('S1', '1')] })], produits: [prod(900, { fiche: { classe: 'SANS_LIGNE', motifs: [] } })], numerosProduits: [{ idProduct: 900, numero: '1' }] });
    assert.deepStrictEqual(causes(un(auditer(l)).sansProduit.items), ['produit-sans-ligne-meme-numero']);
});
test('sans produit : le produit existe via numeroFiche de la ligne (pas orpheline)', () => {
    const l = lecture({ cartes: [carte('c1', 'A', ['1', '1a'], { images: [img('S1', '1'), img('S1', '1a')] })], lignes: [lig('c1', 7, '1'), lig('c1', 8, '1a')] });
    assert.strictEqual(un(auditer(l)).sansProduit.n, 0);
});

test('sans produit : suffixe lettre SANS entrée de base pourvue → pas « jumelle »', () => {
    const l = lecture({ cartes: [carte('c2', 'Evoli', '101a', { images: [img('S1', '101a')] })], produits: [prod(500, { fiche: { classe: 'FICHE_OK', carteId: 'cX', numero: '5', setId: 'S1' } })] });
    assert.deepStrictEqual(causes(un(auditer(l)).sansProduit.items), ['tous-les-produits-deja-rattaches']);
});
test('numéros manquants : set dont aucune impression n est numérotée, le total fait foi', () => {
    const l = lecture({ cartes: [carte('c1', 'A', [null], { images: [img('S1')] })] });
    const m = un(auditer(l)).manquants;
    assert.strictEqual(m.n, 2); assert.strictEqual(m.items[0].cause, 'aucune-impression-numerotee');
});

test('annexe « Yellow A » affichée dans le set de sa carte parente : 101a entre dans les entrées, en doublon de 101, sans produit', () => {
    const c = carte('c1', 'Evoli', '101', { images: [img('S1', '101')], impressions: [imp('101'), { tirage: 'intl', expansion: 'Yellow A', numero: '101a', total: 3 }] });
    const l = lecture({ sets: [set({ totalImprime: 101 })], cartes: [c], lignes: [lig('c1', 500, '101')] });
    const avec = un(auditer(l, { ...regles, annexeDuSet: (i, id) => id === 'c1' && i.expansion === 'Yellow A' }));
    assert.strictEqual(avec.affichees, 2);
    assert.deepStrictEqual(avec.sansProduit.items.map(x => x.numero), ['101a']);
    assert.strictEqual(avec.doublons.groupes[0].cause, 'doublon-suffixe-lettre');
    assert.strictEqual(un(auditer(l)).affichees, 1);     // sans la règle injectée : l'annexe n'existe pas
});

// ── doublons de faits
test('doublon : même nom/PV/attaques/numéro de base (101 et 101a)', () => {
    const l = lecture({ sets: [set({ totalImprime: 101 })], cartes: [carte('c1', 'Evoli', '101'), carte('c2', 'Evoli', '101a')] });
    const d = un(auditer(l)).doublons;
    assert.strictEqual(d.n, 1); assert.strictEqual(d.groupes.length, 1); assert.strictEqual(d.groupes[0].cause, 'doublon-suffixe-lettre');
});
test('doublon : deux documents au même numéro', () => {
    const l = lecture({ cartes: [carte('c1', 'A', '1'), carte('c2', 'A', '1')] });
    assert.strictEqual(un(auditer(l)).doublons.groupes[0].cause, 'doublon-deux-documents');
});
test('pas un doublon : mêmes faits, numéros de base différents (réimpression secrète)', () => {
    const l = lecture({ cartes: [carte('c1', 'A', '1'), carte('c2', 'A', '90')] });
    assert.strictEqual(un(auditer(l)).doublons.n, 0);
});
test('pas un doublon : attaques différentes', () => {
    const l = lecture({ cartes: [carte('c1', 'A', '1', { attaques: ['X'] }), carte('c2', 'A', '1a', { attaques: ['Y'] })] });
    assert.strictEqual(un(auditer(l)).doublons.n, 0);
});

// ── produits sans fiche
test('produit sans fiche : SANS_LIGNE avec trou nommé, sans ligne sans rien', () => {
    const l = lecture({ produits: [prod(1, { fiche: { classe: 'SANS_LIGNE', motifs: [] } }), prod(2, { fiche: { classe: 'SANS_LIGNE', motifs: [] } })], trousNommes: { 1: 'aucune-page-bulbapedia' } });
    const s = un(auditer(l, regles));
    assert.deepStrictEqual(causes(s.produitsSansFiche.items), ['cause-inconnue', 'sans-ligne:aucune-page-bulbapedia']);
});
test('produit sans fiche : LIGNE_SANS_FICHE reprend son premier motif', () => {
    const l = lecture({ produits: [prod(1, { fiche: { classe: 'LIGNE_SANS_FICHE', motifs: ['carte-sans-nom'] } })] });
    assert.deepStrictEqual(causes(un(auditer(l)).produitsSansFiche.items), ['ligne-sans-fiche:carte-sans-nom']);
});
test('produit d une expansion sans set publié : non attribué, compté dans le dénominateur', () => {
    const a = auditer(lecture({ produits: [prod(1, { idExpansion: 99, setId: null, fiche: { classe: 'SANS_LIGNE', motifs: [] } })] }));
    assert.strictEqual(a.denominateurs.produitsSansSetPublie, 1);
});

// ── numéros manquants
test('numéros manquants dans la suite : 1..3 avec le 2 absent', () => {
    const l = lecture({ cartes: [carte('c1', 'A', '1'), carte('c3', 'B', '3')] });
    const m = un(auditer(l)).manquants;
    assert.deepStrictEqual(m.items.map(x => x.numero), ['2']);
    assert.strictEqual(m.items[0].cause, 'aucune-source-en-base');
});
test('numéro manquant : un produit Cardmarket de ce numéro existe', () => {
    const l = lecture({ cartes: [carte('c1', 'A', '1'), carte('c3', 'B', '3')], produits: [prod(55, { fiche: { classe: 'SANS_LIGNE', motifs: [] } })], numerosProduits: [{ idProduct: 55, numero: '002' }] });
    assert.strictEqual(un(auditer(l)).manquants.items[0].cause, 'produit-cardmarket-existe-sans-fiche');
});
test('numéro manquant : un reste qui désigne CE numéro est nommé', () => {
    const l = lecture({ cartes: [carte('c1', 'A', '1'), carte('c3', 'B', '3')], produits: [prod(55, { fiche: { classe: 'SANS_LIGNE', motifs: [] } })], numerosProduits: [{ idProduct: 55, numero: '2' }], restesParProduit: { 55: 'sans-page' } });
    assert.strictEqual(un(auditer(l)).manquants.items[0].cause, 'reste:sans-page');
});
test('numéro manquant : un reste d\'un AUTRE numéro ne se colle pas au numéro manquant', () => {
    const l = lecture({ cartes: [carte('c1', 'A', '1'), carte('c3', 'B', '3')], produits: [prod(55, { fiche: { classe: 'SANS_LIGNE', motifs: [] } })], numerosProduits: [{ idProduct: 55, numero: '9' }], restesParProduit: { 55: 'sans-page' } });
    assert.strictEqual(un(auditer(l)).manquants.items[0].cause, 'aucune-source-en-base');
});
test('produit sans fiche : le reste du produit (par idProduct) est nommé, après le trou nommé', () => {
    const l = lecture({ produits: [prod(1, { fiche: { classe: 'SANS_LIGNE', motifs: [] } }), prod(2, { fiche: { classe: 'LIGNE_SANS_FICHE', motifs: [] } }), prod(3, { fiche: { classe: 'SANS_LIGNE', motifs: [] } })],
        trousNommes: { 3: 'tn' }, restesParProduit: { 1: 'produit-sans-carte', 2: 'produit-vers-plusieurs-cartes', 3: 'x' } });
    assert.deepStrictEqual(causes(un(auditer(l)).produitsSansFiche.items), ['reste:produit-sans-carte', 'reste:produit-vers-plusieurs-cartes', 'sans-ligne:tn']);
});
test('sans numéro : un set sans expansion Bulbapedia (règle du site) se distingue de l\'expansion déclarée sans impression', () => {
    const c = carte('c1', 'A', [], { impressions: [{ tirage: 'jp', expansion: 'JP', numero: '9', total: 3 }, { tirage: 'intl', expansion: 'Autre nom', numero: '1', total: 3 }], images: [img('S1')] });
    const sans = un(auditer(lecture({ sets: [set({ bulba: null })], cartes: [c] })));
    assert.deepStrictEqual(causes(sans.sansNumero.items), ['set-sans-expansion-bulbapedia']);
    assert.strictEqual(sans.diagnosticExpansion, null);
    const decl = un(auditer(lecture({ cartes: [c] })));
    assert.deepStrictEqual(causes(decl.sansNumero.items), ['expansion-declaree-sans-impression']);
    assert.deepStrictEqual(decl.diagnosticExpansion.exemples[0].plusProche, { tirage: 'intl', expansion: 'Autre nom', numero: '1' });
    assert.strictEqual(A.suspectsExpansion(auditer(lecture({ cartes: [c] })))[0].set, 'S1');
});
test('sans visuel : image refusée par la garde de langue du tirage', () => {
    const l = lecture({ cartes: [carte('c1', 'A', '1', { images: [img('S1', '1', { refuse: true })] })] });
    assert.deepStrictEqual(causes(un(auditer(l)).sansVisuel.items), ['image-refusee-par-la-garde-de-langue']);
});
test('règle du site absente : lève', () => assert.throws(() => A.auditer(lecture({ cartes: [carte('c1', 'A', '1')] }), { ...regles, imageDeLImpression: undefined }), /imageDeLImpression/));
test('numéro manquant : la table des « pas un trou » retire le numéro', () => {
    const l = lecture({ sets: [set({ totalImprime: 4 })], cartes: [carte('c1', 'A', '1'), carte('c2', 'B', '2'), carte('c3', 'C', '3')] });
    const m = un(auditer(l)).manquants;     // la règle de test exclut le 4 du set S1
    assert.strictEqual(m.n, 0);
    assert.deepStrictEqual(un(auditer(l)).exclusPasUnTrou, ['4']);
});
test('set sans total imprimé : pas de suite, attendu null, aucun manquant inventé', () => {
    const l = lecture({ sets: [set({ totalImprime: null })], cartes: [carte('c1', 'A', '1')] });
    const s = un(auditer(l)); assert.strictEqual(s.attendu, null); assert.strictEqual(s.manquants.n, 0);
});
test('jumeaux : total de la paire ramené à la moitié', () => {
    const s1 = set({ _id: 'XY1x', code: 'XY1x', totalImprime: 6, bulba: { expansion: ['E1'] }, idExpansion: [10] });
    const s2 = set({ _id: 'XY1y', code: 'XY1y', totalImprime: 6, bulba: { expansion: ['E2'] }, idExpansion: [11] });
    const c = (id, set, n, e) => carte(id, 'N' + id, n, { sets: [set], impressions: [{ tirage: 'intl', expansion: e, numero: n, total: 3 }] });
    const l = lecture({ sets: [s1, s2], cartes: ['1', '2', '3'].map((n, i) => c('a' + i, 'XY1x', n, 'E1')).concat(['1', '2', '3'].map((n, i) => c('b' + i, 'XY1y', n, 'E2'))) });
    const a = auditer(l);
    assert.strictEqual(a.sets.find(s => s.set === 'XY1x').manquants.n, 0);
    assert.strictEqual(a.sets.find(s => s.set === 'XY1x').attendu, 3);
});

// ── garde de population, causes fermées
test('lecture sans set : lève (un audit sur zéro set n est pas une mesure)', () => assert.throws(() => auditer(lecture({ sets: [] })), /population vide/));
test('lecture sans carte alors qu il y a des sets : lève (§41)', () => assert.throws(() => auditer(lecture({ cartes: [], lignes: [lig('c1', 1)], produits: [] })), /cartes/));
test('lignes qui ne désignent aucune carte lue : lève (jointure vide sur populations non vides)', () => assert.throws(() => auditer(lecture({ cartes: [carte('c1', 'A', '1')], lignes: [lig('absente', 1)] })), /aucune des/));
test('pas un doublon : aucun groupe de 1 listé', () => assert.strictEqual(un(auditer(lecture({ cartes: [carte('c1', 'A', '1'), carte('c2', 'A', '90')] }))).doublons.groupes.length, 0));
test('écart : un set déjà à 100 % avant n est pas « passé à 100 % »', () => {
    const s = { set: 'A', trous: 0, causes: {} };
    const e = A.ecart({ sets: [s], parCause: {}, totaux: {}, denominateurs: {} }, { sets: [s], parCause: {}, totaux: {}, denominateurs: {} });
    assert.deepStrictEqual(e.setsPassesA100, []);
});
test('une cause hors liste fermée lève', () => assert.throws(() => A.verifierCause('sansVisuel', 'inventee'), /cause/));
test('set non publié ignoré et compté', () => {
    const a = auditer(lecture({ sets: [set(), set({ _id: 'S2', nomAffichage: null })], cartes: [carte('c1', 'A', '1')] }));
    assert.strictEqual(a.sets.length, 1); assert.strictEqual(a.denominateurs.setsNonPublies, 1);
});

// ── tri et score
test('tri : score = trous × log2(2+offres), le plus haut d abord ; à égalité, l id', () => {
    const s = (id, trous, offres) => ({ set: id, trous, offres });
    const t = A.trier([s('a', 10, 0), s('b', 10, 1000), s('c', 0, 99999), s('d', 3, 100000)]);
    assert.deepStrictEqual(t.map(x => x.set), ['b', 'd', 'a', 'c']);
    assert.ok(Math.abs(A.score(10, 6) - 30) < 1e-9);
});
test('audit : sets rendus triés par score', () => {
    const l = lecture({ sets: [set({ _id: 'S1', idExpansion: [10] }), set({ _id: 'S2', idExpansion: [11], code: 'S2' })], offresParExpansion: { 10: 0, 11: 0 },
        cartes: [carte('c1', 'A', '1'), carte('c2', 'B', '2', { sets: ['S2'] }), carte('c3', 'C', '3', { sets: ['S2'] })] });
    const a = auditer(l);
    assert.ok(a.sets[0].score >= a.sets[1].score);
});

// ── totaux par cause et écart
test('totaux par cause : somme des causes de tous les sets', () => {
    const l = lecture({ cartes: [carte('c1', 'A', '1'), carte('c2', 'B', '2')] });
    const a = auditer(l);
    assert.strictEqual(a.parCause.sansVisuel['aucune-image-en-base'], 2);
});
test('écart : par cause, sets passés à 100 %, sets nouvellement troués', () => {
    const avant = { le: 'x', sets: [{ set: 'A', trous: 3, causes: { 'sansVisuel/aucune-image-en-base': 3 } }, { set: 'B', trous: 0, causes: {} }], parCause: { sansVisuel: { 'aucune-image-en-base': 3 } }, totaux: { trous: 3 }, denominateurs: { sets: 2 } };
    const apres = { le: 'y', sets: [{ set: 'A', trous: 0, causes: {} }, { set: 'B', trous: 2, causes: { 'sansProduit/jumelle-suffixe-sans-produit': 2 } }], parCause: { sansProduit: { 'jumelle-suffixe-sans-produit': 2 } }, totaux: { trous: 2 }, denominateurs: { sets: 2 } };
    const e = A.ecart(avant, apres);
    assert.strictEqual(e.totaux.trous, -1);
    assert.deepStrictEqual(e.setsPassesA100, ['A']);
    assert.deepStrictEqual(e.setsNouvellementTroues, ['B']);
    assert.strictEqual(e.parCause['sansVisuel/aucune-image-en-base'], -3);
    assert.strictEqual(e.parCause['sansProduit/jumelle-suffixe-sans-produit'], 2);
});
test('écart : un set passé à 100 % UNIQUEMENT par les exclusions est séparé de celui qui y passe par une vraie collecte', () => {
    const ex = n => ({ 'sansNumero/numero-non-imprime:dp': Array.from({ length: n }, (_, i) => ({ carteId: i })) });
    const avant = { le: 'x', sets: [{ set: 'E', trous: 5 }, { set: 'C', trous: 4 }, { set: 'M', trous: 6 }], parCause: {}, totaux: {}, denominateurs: { sets: 3 } };
    const apres = { le: 'y', sets: [{ set: 'E', trous: 0, exclusParCause: ex(5) }, { set: 'C', trous: 0 }, { set: 'M', trous: 0, exclusParCause: ex(2) }], parCause: {}, totaux: {}, denominateurs: { sets: 3 } };
    const e = A.ecart(avant, apres);
    assert.deepStrictEqual(e.setsPassesA100.sort(), ['C', 'E', 'M']);
    assert.deepStrictEqual(e.setsPassesA100ParExclusions, ['E']);
    assert.deepStrictEqual(e.setsPassesA100ParCollecte.sort(), ['C', 'M']);     // M : 4 collectés + 2 exclus
    const md = A.formaterMd({ ...apres, denominateurs: { sets: 3, setsPublies: 3, setsNonPublies: 0, cartes: 0, cartesAffichables: 0, lignes: 0, produits: 0, produitsSansSetPublie: 0, entreesAffichees: 0 }, totaux: { trous: 0, exclus: 7, sets100: 3, setsTroues: 0, sansVisuel: 0, sansNumero: 0, sansProduit: 0, doublons: 0, produitsSansFiche: 0, manquants: 0 } }, e);
    assert.ok(/UNIQUEMENT PAR LES EXCLUSIONS \(1\)/.test(md)); assert.ok(/VRAIE COLLECTE \(2\)/.test(md));
});
test('écart : un dénominateur différent est dit', () => {
    const e = A.ecart({ sets: [], parCause: {}, totaux: { trous: 0 }, denominateurs: { sets: 2 } }, { sets: [], parCause: {}, totaux: { trous: 0 }, denominateurs: { sets: 3 } });
    assert.strictEqual(e.memeDenominateur, false);
});
test('écart sans mesure précédente : null, jamais 0', () => assert.strictEqual(A.ecart(null, { sets: [] }), null));

// ── EXCLUS DU COMPTE DES TROUS (décision du testeur 2026-11-08 : « le compte des trous doit dire la vérité ») — jamais retirés de la sortie : comptés par cause et par set
const TABLE = { S1: { famille: 'avant-dp', imprime: 'No. NNN (n° Pokédex)', cartes: ['A', 'B', 'C'], date: '2026-11-08' } };
const reglesTable = { ...regles, sansNumeroImprime: TABLE };
const sansNum = (id, nom) => carte(id, nom, [null], { images: [img('S1')], attaques: ['A' + id] });
test('exclusion « numéro non imprimé » : un set de la table sort du compte, l\'exclusion reste comptée et listée', () => {
    const a = auditer(lecture({ cartes: [sansNum('c1', 'A'), sansNum('c2', 'B')], produits: [prod(5, { fiche: { classe: 'FICHE_OK', carteId: 'cX', numero: '9', setId: 'S1' } })] }), reglesTable);
    const s = un(a);
    assert.strictEqual(s.sansNumero.n, 0);
    assert.strictEqual((s.causes['sansNumero/impression-sans-numero'] || 0), 0);
    assert.strictEqual(s.exclusParCause['sansNumero/numero-non-imprime:avant-dp'].length, 2);
    assert.strictEqual(a.exclus.total, 2);
    assert.strictEqual(a.exclus.parCause['sansNumero/numero-non-imprime:avant-dp'], 2);
    assert.strictEqual(a.exclus.parSet.S1['sansNumero/numero-non-imprime:avant-dp'], 2);
    assert.strictEqual(a.totaux.exclus, 2);
});
test('exclusion : le MÊME set hors table garde ses trous (refus)', () => {
    const a = auditer(lecture({ cartes: [sansNum('c1', 'A')] }), { ...regles, sansNumeroImprime: {} });
    assert.strictEqual(un(a).sansNumero.n, 1); assert.strictEqual(a.exclus.total, 0);
});
test('exclusion : sans table injectée, la table du dépôt s\'applique ; un set inconnu d\'elle garde son trou', () => {
    assert.strictEqual(un(auditer(lecture({ cartes: [sansNum('c1', 'A')] }))).sansNumero.n, 1);
});
test('exclusion : une impression « expansion déclarée sans impression » n\'est PAS un numéro non imprimé (refus)', () => {
    const c = carte('c1', 'A', [], { impressions: [{ tirage: 'jp', expansion: 'Exp', numero: '1', total: 3 }], images: [img('S1')] });
    const a = auditer(lecture({ cartes: [c] }), reglesTable);
    assert.strictEqual(un(a).sansNumero.n, 1); assert.strictEqual(a.exclus.total, 0);
});
test('exclusion : une entrée numérotée d\'un set de la table reste une entrée normale', () => {
    const a = auditer(lecture({ cartes: [carte('c1', 'A', '1', { images: [img('S1', '1')] }), sansNum('c2', 'B')] }), reglesTable);
    assert.strictEqual(un(a).exclusParCause['sansNumero/numero-non-imprime:avant-dp'].length, 1);
    assert.strictEqual(un(a).affichees, 2);
});
test('exclusion : une cause d\'exclusion hors liste fermée lève', () => assert.throws(() => A.verifierExclusion('sansNumero', 'inventee'), /exclusion/));
const addSet = (o = {}) => set({ _id: 'S1-Additionals', code: 'xS1', nomAffichage: 'Set Un Additionals', ...o });
const lecAdd = (cartes, produits, numerosProduits) => lecture({ sets: [addSet()], cartes: cartes.map(c => ({ ...c, sets: ['S1-Additionals'], images: [img('S1-Additionals', c.impressions[0].numero)] })), produits: produits.map(p => ({ ...p, setId: 'S1-Additionals' })), numerosProduits });
const estAdditionals = s => /-Additionals$/.test(s);
const unAdd = a => a.sets.find(s => s.set === 'S1-Additionals');
const prodSL = (id, o = {}) => prod(id, { fiche: { classe: 'SANS_LIGNE', motifs: [] }, ...o });
test('Additionals : impression du set de base à un numéro où l\'expansion n\'a AUCUN produit → exclue, comptée', () => {
    const a = auditer(lecAdd([carte('c1', 'A', '5')], [prodSL(900)], [{ idProduct: 900, numero: '7' }]), { ...regles, estAdditionals });
    const s = unAdd(a);
    assert.strictEqual(s.sansProduit.n, 0);
    assert.strictEqual(s.exclusParCause['sansProduit/impression-hors-additionals'].length, 1);
    assert.strictEqual(a.exclus.parCause['sansProduit/impression-hors-additionals'], 1);
});
test('Additionals : un produit de l\'expansion porte ce numéro (par cleNumero : 005 = 5) → vrai trou, jamais exclu', () => {
    const a = auditer(lecAdd([carte('c1', 'A', '5')], [prodSL(900)], [{ idProduct: 900, numero: '005' }]), { ...regles, estAdditionals });
    assert.strictEqual(unAdd(a).sansProduit.n, 1); assert.strictEqual(a.exclus.total, 0);
});
test('Additionals : un produit d\'une classe de fiche AUTRE que SANS_LIGNE au même numéro bloque aussi l\'exclusion (condition non redondante)', () => {
    const ok = prod(901, { fiche: { classe: 'FICHE_OK', motifs: [], carteId: 'cX', numero: '5', setId: 'S1-Additionals' } });
    const a = auditer(lecAdd([carte('c1', 'A', '5')], [prodSL(900), ok], [{ idProduct: 900, numero: '7' }, { idProduct: 901, numero: '5' }]), { ...regles, estAdditionals });
    assert.strictEqual(unAdd(a).sansProduit.n, 1); assert.strictEqual(a.exclus.total, 0);
});
test('Additionals : un produit SANS numéro au nom de la carte l\'empêche d\'être exclue ; un produit sans numéro d\'un autre nom non', () => {
    const memeNom = auditer(lecAdd([carte('c1', 'Tynamo', '5')], [prodSL(900, { name: 'Tynamo [Charge]' })], [{ idProduct: 900, numero: null }]), { ...regles, estAdditionals });
    assert.strictEqual(unAdd(memeNom).sansProduit.n, 1); assert.strictEqual(memeNom.exclus.total, 0);
    const autre = auditer(lecAdd([carte('c1', 'Tynamo', '5')], [prodSL(900, { name: 'Air Balloon' })], [{ idProduct: 900, numero: null }]), { ...regles, estAdditionals });
    assert.strictEqual(unAdd(autre).sansProduit.n, 0); assert.strictEqual(autre.exclus.total, 1);
});
test('Additionals : un set NON Additionals garde son trou (refus)', () => {
    const l = lecture({ cartes: [carte('c1', 'A', '5', { images: [img('S1', '5')] })], produits: [prodSL(900)], numerosProduits: [{ idProduct: 900, numero: '7' }] });
    const a = auditer(l, { ...regles, estAdditionals });
    assert.deepStrictEqual(causes(un(a).sansProduit.items), ['produits-sans-ligne-dans-l-expansion']); assert.strictEqual(a.exclus.total, 0);
});
test('Additionals : sans la règle du site injectée, rien n\'est exclu', () => {
    const a = auditer(lecAdd([carte('c1', 'A', '5')], [prodSL(900)], [{ idProduct: 900, numero: '7' }]));
    assert.strictEqual(unAdd(a).sansProduit.n, 1); assert.strictEqual(a.exclus.total, 0);
});
test('markdown : les exclusions sont IMPRIMÉES à part (cause, nombre, set), jamais disparues', () => {
    const a = auditer(lecture({ cartes: [sansNum('c1', 'A')] }), reglesTable);
    const md = A.formaterMd(a, null);
    assert.ok(/Exclus du compte des trous/.test(md)); assert.ok(md.includes('sansNumero/numero-non-imprime:avant-dp')); assert.ok(md.includes('S1'));
});
test('écart : les exclus ont leur propre écart (un contrôle qui rétrécit son périmètre doit le dire)', () => {
    const avant = { le: 'x', sets: [], parCause: {}, totaux: { trous: 5, exclus: 0 }, denominateurs: { sets: 1 }, exclus: { total: 0, parCause: {}, parSet: {} } };
    const apres = { le: 'y', sets: [], parCause: {}, totaux: { trous: 3, exclus: 2 }, denominateurs: { sets: 1 }, exclus: { total: 2, parCause: { 'sansNumero/numero-non-imprime:dp': 2 }, parSet: {} } };
    const e = A.ecart(avant, apres);
    assert.strictEqual(e.exclus.total, 2); assert.strictEqual(e.exclus.parCause['sansNumero/numero-non-imprime:dp'], 2);
    assert.ok(/exclus/i.test(A.formaterMd({ ...apres, le: 'y', denominateurs: { sets: 1, setsPublies: 1, setsNonPublies: 0, cartes: 0, cartesAffichables: 0, lignes: 0, produits: 0, produitsSansSetPublie: 0, entreesAffichees: 0 }, totaux: { trous: 3, exclus: 2, sets100: 0, setsTroues: 0, sansVisuel: 0, sansNumero: 0, sansProduit: 0, doublons: 0, produitsSansFiche: 0, manquants: 0 }, sets: [], parCause: {} }, e)));
});

// ── la table fermée SANS_NUMERO_IMPRIME : chaque entrée porte sa PREUVE
test('table SANS_NUMERO_IMPRIME : chaque set porte ce qui est imprimé, ≥ 3 cartes regardées, une date, une famille fermée', () => {
    const { SANS_NUMERO_IMPRIME, FAMILLES } = require('./sans-numero-imprime');
    const ids = Object.keys(SANS_NUMERO_IMPRIME);
    assert.ok(ids.length >= 1);
    for (const id of ids) {
        const e = SANS_NUMERO_IMPRIME[id];
        assert.ok(FAMILLES.includes(e.famille), `${id} : famille`);
        assert.ok(typeof e.imprime === 'string' && e.imprime.length > 10, `${id} : imprime`);
        assert.ok(Array.isArray(e.cartes) && e.cartes.length >= 3, `${id} : ≥ 3 cartes regardées`);
        assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(e.date), `${id} : date`);
    }
    // la liste EXACTE (mutation M1 : retirer ou ajouter un set sans preuve doit se voir) — 31 sets, chacun vérifié sur scans ou sur planche citée
    assert.deepStrictEqual(ids.slice().sort(), ['10th-Movie-Commemoration-Set', 'Awakening-Legends', 'Challenge-from-the-Darkness', 'Crossing-the-Ruins', 'Cry-from-the-Mysterious', 'Darkness-and-to-Light', 'Dawn-Dash', 'Dialga-LVX-Constructed-Standard-Deck', 'Expansion-Pack', 'Expansion-Sheet', 'Gold-Silver-to-a-New-World', 'Guren-Town-Gym', 'Hanada-City-Gym', 'Heatran-vs-Regigigas-Deck-Kit', 'Kuchiba-City-Gym', 'Leaders-Stadium', 'Magmortar-vs-Electivire-Deck-Kit', 'Moonlit-Pursuit', 'Mystery-of-the-Fossils', 'Nivi-City-Gym', 'Palkia-LVX-Constructed-Standard-Deck', 'Pokemon-Jungle', 'Rampardos-the-Attacker', 'Rocket-Gang', 'Secret-of-the-Lakes', 'Shining-Darkness', 'Southern-Islands-JP', 'Space-Time-Creation', 'Tamamushi-City-Gym', 'Temple-of-Anger', 'Yamabuki-City-Gym'].sort());
    for (const refuse of ['Unnumbered-Promos', 'XY-Promos', 'Entry-Pack-08', 'Bastiodon-the-Defender']) assert.ok(!ids.includes(refuse), `${refuse} ne doit pas y entrer sans preuve`);
});

// ── Markdown
test('markdown : formule du score en tête, dénominateurs, tableau trié', () => {
    const a = auditer(lecture({ cartes: [carte('c1', 'A', '1')] }));
    const md = A.formaterMd(a, null);
    assert.ok(/score/i.test(md.split('\n').slice(0, 12).join('\n')));
    assert.ok(md.includes('Set Un') && md.includes('aucune-image-en-base'));
    assert.ok(/dénominateur/i.test(md));
});

console.log(`\n${ok} ok, ${ko} en échec`);
process.exit(ko ? 1 : 0);
