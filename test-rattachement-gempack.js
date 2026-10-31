// Banc de collecte-cartes/rattachement-gempack.js (décision de l'éditeur, 2026-10-31) : rattacher au set Gem Pack les cartes que la preuve par le set désigne, SEULEMENT là où l'association produit <-> carte <-> numéro est
// UNIQUE et prouvée. AUCUNE connexion : des cartes, un set et des produits fabriqués ; la règle de production (voie-deux-sources.planifierVoie) tourne pour de vrai.
const assert = require('assert');
const { decomposerNomCardmarket } = require('./collecte-cartes/jointure');
const RG = require('./collecte-cartes/rattachement-gempack');
let ok = 0, ko = 0;
const t = (nom, f) => { try { f(); ok++; console.log('  ok  ' + nom); } catch (e) { ko++; console.log('  ECHEC ' + nom + '\n        ' + String(e.stack || e.message).split('\n').slice(0, 3).join('\n        ')); } };

const SET = 'Gem-Pack-Vol-T', EXPANSION = 'Gem Pack Vol. T', EXP = 9;
const carte = (id, nomEn, attaques, meta, extra = {}) => ({ _id: id, nomEn, niveau: null, attaques: attaques.map(nom => ({ nom })), impressions: [], sets: ['Autre-Set'], liens: { idProduct: [-id], idMetacards: [meta] }, ...extra });
const produit = (idProduct, name, numero, idMetacard) => { const d = decomposerNomCardmarket(name); return { idProduct, idExpansion: EXP, idMetacard, name, nom: d.nom, attaques: d.attaques, niveau: d.niveau, numero, slug: `${d.nom.replace(/\s+/g, '-')}-V${idProduct}-GPT${numero}`, slugSet: SET }; };
const conc = (p) => ({ source: 'preuve-par-set', ref: `liste:T#${p.numero}`, set: SET, numero: String(p.numero), nom: p.nom, par: 'set' });   // le nom de la liste = le nom du produit (la preuve par le set l'a établi)
const entree = p => ({ idProduct: p.idProduct, idExpansion: EXP, slugSet: SET, secondeSource: { concordantes: [conc(p)], refusees: [] } });
const set = { _id: SET, tirage: 'zh-hans', idExpansion: [EXP], bulba: { expansion: EXPANSION } };
const lecture = (cartes, prods, lignes = []) => ({ cartes, sets: new Map([[SET, set]]), produits: new Map([[EXP, prods]]), NC: new Map(prods.map(p => [p.idProduct, { numero: p.numero }])), lignes });
const LE = new Date('2026-10-31T00:00:00Z');
const R = (cartes, prods, opts = {}) => RG.planifierRattachement({ entrees: (opts.entrees || prods).map(entree), lecture: lecture(cartes, prods, opts.lignes || []), le: LE, ...(opts.variantes ? { variantes: opts.variantes } : {}) });

const ponyta = carte(10, 'Ponyta', ['Double Headbutt'], 500), pinsir = carte(11, 'Pinsir', ['Slow Crunch'], 501), eevee = carte(12, 'Eevee', ['Ascension'], 502);
const prodsPonyta = [1, 2, 3].map(i => produit(100 + i, 'Ponyta [Double Headbutt]', '01', 500));       // un groupe de 3 variantes indiscernables
const prodPinsir = produit(200, 'Pinsir [Slow Crunch]', '02', 501);                                    // un groupe d'UN seul produit : unique

t('un groupe de variantes dont la carte n\'est pas membre : fiche de groupe + appartenance + impression ; les 3 variantes sont « indiscernables » (trou nommé), aucune n\'est « unique »', () => {
    const p = R([ponyta], prodsPonyta);
    assert.strictEqual(p.lignes.length, 3, JSON.stringify(p.refus));
    assert.deepStrictEqual([...p.ajoutsSets], [[10, [SET]]]);
    assert.strictEqual(p.impressions.length, 1); assert.strictEqual(p.impressions[0].imp.numero, '01');
    assert.deepStrictEqual(p.denominateurs, { produits: 3, dejaFichees: 0, aRattacher: 3, fiches: 3, uniques: 0, variantesIndiscernables: 3, refuses: 0, refusParMotif: {} });
    assert.deepStrictEqual(p.trous.map(x => x.idProduct).sort(), [101, 102, 103]);
    assert.ok(p.trous.every(x => x.motif === 'variantes-indiscernables'));
    assert.ok(p.lignes.every(l => l.numeroFiche === '01'));   // le numéro de GROUPE de Cardmarket, jamais un rang V1..V7
});
t('un groupe d\'UN produit : fiche « unique », aucun trou', () => {
    const p = R([pinsir], [prodPinsir]);
    assert.strictEqual(p.lignes.length, 1); assert.strictEqual(p.denominateurs.uniques, 1); assert.strictEqual(p.denominateurs.variantesIndiscernables, 0); assert.strictEqual(p.trous.length, 0);
});
t('la lecture reçue n\'est JAMAIS modifiée (l\'appartenance est simulée sur une copie)', () => {
    const l = lecture([ponyta], prodsPonyta); const avant = JSON.stringify(l.cartes);
    RG.planifierRattachement({ entrees: prodsPonyta.map(entree), lecture: l, le: LE });
    assert.strictEqual(JSON.stringify(l.cartes), avant);
});
t('une carte DÉJÀ membre du set : rien à rattacher (aucun ajout d\'appartenance), la fiche passe par la voie ordinaire', () => {
    const p = R([{ ...ponyta, sets: [SET] }], prodsPonyta);
    assert.strictEqual(p.lignes.length, 3); assert.strictEqual(p.ajoutsSets.size, 0); assert.strictEqual(p.denominateurs.aRattacher, 0);
});
t('NON : deux cartes candidates pour un même nom (Eevee) — un doute est un refus, rien n\'est rattaché', () => {
    const eevee2 = carte(13, 'Eevee', ['Ascension'], 502);
    const p = R([eevee, eevee2], [produit(300, 'Eevee [Ascension]', '03', 502)]);
    assert.strictEqual(p.lignes.length, 0); assert.strictEqual(p.ajoutsSets.size, 0); assert.strictEqual(p.denominateurs.refuses, 1);
    assert.match(Object.keys(p.denominateurs.refusParMotif)[0], /candidates/);
});
t('NON : une carte désignée par DEUX groupes du set (même Pokémon aux groupes 01 et 05) — les deux groupes sont refusés', () => {
    const autres = [1, 2].map(i => produit(400 + i, 'Ponyta [Double Headbutt]', '05', 500));
    const p = R([ponyta], [...prodsPonyta, ...autres]);
    assert.strictEqual(p.lignes.length, 0); assert.strictEqual(p.ajoutsSets.size, 0);
    assert.ok(p.refus.every(r => /deux groupes|plusieurs groupes/.test(r.raison)), JSON.stringify(p.refus.map(r => r.raison)));
    assert.strictEqual(p.denominateurs.refuses, 5);
});
t('NON : un groupe dont un produit a DÉJÀ une fiche d\'une AUTRE carte — le groupe est incohérent, refusé en entier', () => {
    const ligne = { _id: '99|101', carteId: 99, idProduct: 101, slugSet: SET, numeroFiche: '01' };
    const p = R([ponyta, carte(99, 'Ponyta', ['Autre'], 500)], prodsPonyta, { lignes: [ligne], entrees: prodsPonyta.slice(1) });
    assert.strictEqual(p.lignes.length, 0);
    assert.ok(p.refus.some(r => /autre carte/.test(r.raison)), JSON.stringify(p.refus.map(r => r.raison)));
});
t('OUI : un groupe dont certains produits ont DÉJÀ la fiche de la MÊME carte — les autres la reçoivent (le groupe se complète)', () => {
    const ligne = { _id: '10|101', carteId: 10, idProduct: 101, slugSet: SET, numeroFiche: '01' };
    const p = R([{ ...ponyta, sets: [SET], liens: { idProduct: [101], idMetacards: [500] } }], prodsPonyta, { lignes: [ligne] });
    assert.strictEqual(p.lignes.length, 2); assert.strictEqual(p.denominateurs.dejaFichees, 1);
});
t('NON : un produit refusé pour une AUTRE raison que l\'appartenance (nom contredit) n\'est jamais « rattrapé » par le rattachement', () => {
    const faux = produit(500, 'Pinsir [Autre Attaque]', '04', 501);
    const p = R([pinsir], [faux]);
    assert.strictEqual(p.lignes.length, 0); assert.strictEqual(p.ajoutsSets.size, 0);
});
t('NON : un groupe dont UN produit est refusé pour une autre raison se refuse en entier (un groupe se pose entier ou pas du tout)', () => {
    const intrus = produit(104, 'Ponyta [Autre Attaque]', '01', 500);   // même groupe, attaque inconnue de la carte
    const p = R([ponyta], [...prodsPonyta, intrus]);
    assert.strictEqual(p.lignes.length, 0); assert.strictEqual(p.ajoutsSets.size, 0);
});
t('NON : un refus à DEUX causes (l\'appartenance ET une métacarte contredite) n\'est jamais levé : l\'appartenance doit être la SEULE cause', () => {
    const p = R([pinsir], [produit(700, 'Pinsir [Slow Crunch]', '04', 999)]);
    assert.strictEqual(p.lignes.length, 0); assert.strictEqual(p.ajoutsSets.size, 0);
    assert.ok(p.refus.length === 1 && p.refus[0].categorie === 'preuves', JSON.stringify(p.refus));
});
t('NON : un groupe dont les produits désignent DEUX cartes (attaques différentes, même numéro de groupe) est refusé en entier', () => {
    const a = carte(21, 'Eevee', ['Ascension'], 502), b = carte(22, 'Eevee', ['Quick Attack'], 503);
    const p = R([a, b], [produit(801, 'Eevee [Ascension]', '06', 502), produit(802, 'Eevee [Quick Attack]', '06', 503)]);
    assert.strictEqual(p.lignes.length, 0); assert.strictEqual(p.ajoutsSets.size, 0);
    assert.ok(p.refus.every(r => /désigne 2 cartes/.test(r.raison)), JSON.stringify(p.refus));
});
// ── le set Gem Pack réel n'a PAS de `bulba.expansion` (null) : l'impression n'a aucun nom d'expansion à porter ──
const setSansNom = { ...set, bulba: { expansion: null } };
const lectureSansNom = (cartes, prods) => ({ ...lecture(cartes, prods), sets: new Map([[SET, setSansNom]]) });
t('un set SANS nom d\'expansion (bulba.expansion null) : sans nom donné, l\'impression n\'est pas posable — refus tel quel (la production dit non)', () => {
    const p = RG.planifierRattachement({ entrees: prodsPonyta.map(entree), lecture: lectureSansNom([ponyta], prodsPonyta), le: LE });
    assert.strictEqual(p.lignes.length, 0); assert.strictEqual(p.ajoutsSets.size, 0);
    assert.ok(p.refus.every(r => /nom d'expansion/.test(r.raison)), JSON.stringify(p.refus.map(r => r.raison)));
});
t('avec `expansionDe` : le nom est posé sur une COPIE du set (le set réel ne bouge pas), l\'impression porte ce nom, et il est dit dans le plan', () => {
    const l = lectureSansNom([ponyta], prodsPonyta);
    const p = RG.planifierRattachement({ entrees: prodsPonyta.map(entree), lecture: l, le: LE, expansionDe: s => (s._id === SET ? 'Gem Pack Vol. T' : null) });
    assert.strictEqual(p.lignes.length, 3, JSON.stringify(p.refus));
    assert.strictEqual(p.impressions[0].imp.expansion, 'Gem Pack Vol. T');
    assert.deepStrictEqual(p.expansionsNommees, { [SET]: 'Gem Pack Vol. T' });
    assert.strictEqual(l.sets.get(SET).bulba.expansion, null);        // le set de la lecture est INTACT
});
t('`expansionDe` ne remplace JAMAIS un nom d\'expansion déjà porté par le set', () => {
    const p = RG.planifierRattachement({ entrees: prodsPonyta.map(entree), lecture: lecture([ponyta], prodsPonyta), le: LE, expansionDe: () => 'Autre Nom' });
    assert.strictEqual(p.impressions[0].imp.expansion, EXPANSION); assert.deepStrictEqual(p.expansionsNommees, {});
});
t('nomExpansionGemPack : « Gem Pack Vol 4 » (nom d\'affichage Cardmarket) -> « Gem Pack Vol. 4 » (forme des impressions déjà au catalogue) ; rien d\'autre ne se devine', () => {
    assert.strictEqual(RG.nomExpansionGemPack({ nomAffichage: 'Gem Pack Vol 4' }), 'Gem Pack Vol. 4');
    assert.strictEqual(RG.nomExpansionGemPack({ nomAffichage: 'Gem Pack Vol 6', bulba: { expansion: null } }), 'Gem Pack Vol. 6');
    assert.strictEqual(RG.nomExpansionGemPack({ nomAffichage: 'Gem Pack Vol5' }), 'Gem Pack Vol. 5');   // la graphie réelle du set de Vol. 5 (slug « Gem-Pack-Vol5 »)
    assert.strictEqual(RG.nomExpansionGemPack({ nomAffichage: 'Gem Pack Volume 5' }), null);
    assert.strictEqual(RG.nomExpansionGemPack({ nomAffichage: 'Collect 151' }), null);
    assert.strictEqual(RG.nomExpansionGemPack({ nomAffichage: 'Gem Pack Vol 12' }), 'Gem Pack Vol. 12');
    assert.strictEqual(RG.nomExpansionGemPack({}), null);
});
t('option « refuser les variantes » : un groupe de plusieurs produits est refusé (« variantes indiscernables »), le produit unique passe', () => {
    const p = R([ponyta, pinsir], [...prodsPonyta, prodPinsir], { variantes: 'refuser' });
    assert.deepStrictEqual(p.lignes.map(l => l.idProduct), [200]);
    assert.ok(p.refus.filter(r => r.idProduct !== 200).every(r => /variantes indiscernables/.test(r.raison)));
});
t('mélange : unique + variantes — les dénominateurs se recomptent (uniques, variantes indiscernables, refusés)', () => {
    const p = R([ponyta, pinsir], [...prodsPonyta, prodPinsir]);
    assert.strictEqual(p.denominateurs.produits, 4); assert.strictEqual(p.denominateurs.fiches, 4);
    assert.strictEqual(p.denominateurs.uniques, 1); assert.strictEqual(p.denominateurs.variantesIndiscernables, 3);
});
t('la liste des produits sans variante connue vient de TOUS les produits du set (pas seulement ceux du lot) : un groupe de 2 dont 1 déjà fiché reste « variantes indiscernables »', () => {
    const deux = [produit(601, 'Pinsir [Slow Crunch]', '02', 501), produit(602, 'Pinsir [Slow Crunch]', '02', 501)];
    const ligne = { _id: '11|601', carteId: 11, idProduct: 601, slugSet: SET, numeroFiche: '02' };
    const p = R([{ ...pinsir, sets: [SET], liens: { idProduct: [601], idMetacards: [501] } }], deux, { lignes: [ligne] });
    assert.strictEqual(p.lignes.length, 1); assert.strictEqual(p.denominateurs.uniques, 0); assert.strictEqual(p.denominateurs.variantesIndiscernables, 1);
});

console.log(`\n${ok} passés, ${ko} en échec`);
process.exitCode = ko ? 1 : 0;
