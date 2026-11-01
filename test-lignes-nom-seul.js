// Banc de poser-lignes-nom-seul.js — VRAIES données (fixtures/nom-seul/*.json : documents lus en base le 2026-11-01, outils-chasse-dump-fixture.js).
// node test-lignes-nom-seul.js  (NODE_PATH = node_modules du dépôt principal)
const assert = require('assert');
const fs = require('fs'), path = require('path');
const { planifier, verifierAttendu, ARGUMENTS_AUTORISES } = require('./poser-lignes-nom-seul');
const F = c => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'nom-seul', c + '.json'), 'utf8'));
let ok = 0, ko = 0;
const t = (nom, f) => { try { f(); ok++; console.log('  ✅', nom); } catch (e) { ko++; console.log('  ❌', nom, '\n     ', e.message.split('\n')[0]); } };
const plan = (c, opt) => { const d = F(c); const log = console.log; console.log = () => {}; try { return planifier({ cartes: d.cartes, produits: d.produits, L: d.L, existants: new Map(d.lignes.map(l => [l.idProduct, l])), interdits: new Set(), ...opt }); } finally { console.log = log; } };
const paire = p => Object.fromEntries(p.lignes.map(l => [l.idProduct, l.carteId]));
const COTES_IPNT = [654306, 654309, 654310, 654311, 654315, 654316, 654320, 654317, 654321, 654322];

console.log('— IPNT (Intro Pack Neo Totodile), mode forcé, produits sans numéro');
t('les 7 produits à nom unique dans le set sont désignés, chacun vers SA carte', () => {
    const p = plan('IPNT', { visees: COTES_IPNT, forcerNomSeul: true, cles: ['attaques-exactes'] });
    assert.deepStrictEqual(paire(p), { 654310: 24171, 654311: 24495, 654315: 23634, 654316: 15386, 654320: 24680, 654321: 11393, 654322: 24006 });
});
t('les 3 sans carte du set (Pichu, Abra, Gust of Wind) sont des refus NOMMÉS, pas des silences', () => {
    const p = plan('IPNT', { visees: COTES_IPNT, forcerNomSeul: true, cles: ['attaques-exactes'] });
    assert.deepStrictEqual(p.refus.map(r => r.idProduct).sort(), [654306, 654309, 654317]);
    assert.ok(p.refus.every(r => r.raison && r.raison.length > 10));
});
t('une Énergie de base (aucune carte du set) est refusée', () => {
    const p = plan('IPNT', { visees: [832369], forcerNomSeul: true, cles: [] });
    assert.strictEqual(p.lignes.length, 0); assert.strictEqual(p.refus.length, 1);
});
t('le mode forcé REFUSE un produit qui porte un numéro (Water Energy n°5, sans ligne) : il a sa clé par le numéro', () => {
    const p = plan('IPNT', { visees: [832369], forcerNomSeul: true, cles: [] });
    assert.strictEqual(p.lignes.length, 0); assert.match(p.refus[0].raison, /num[ée]ro 5/i);
});
t('un produit déjà joint (Pikachu n°1) ne se repose jamais : « déjà là »', () => {
    const p = plan('IPNT', { visees: [654305], forcerNomSeul: true, cles: [] });
    assert.strictEqual(p.lignes.length, 0); assert.strictEqual(p.deja.length, 1);
});
t('sans --nom-seul, une ligne à Setlist (IPNT) est refusée en bloc : l’outil ne devine pas son périmètre', () => {
    assert.throws(() => plan('IPNT', { visees: [654310], forcerNomSeul: false, cles: [] }), /nomSeul/);
});
t('un produit hors du catalogue de l’expansion est refusé', () => {
    const p = plan('IPNT', { visees: [1], forcerNomSeul: true, cles: [] });
    assert.strictEqual(p.lignes.length, 0); assert.match(p.refus[0].raison, /absent/);
});

console.log('— IPNC (Intro Pack Neo Chikorita)');
t('les 7 produits désignés sont ceux de la simulation', () => {
    const ids = [654290, 654292, 654294, 654291, 654293, 654295, 654296, 654298, 654299, 832368];
    const p = plan('IPNC', { visees: ids, forcerNomSeul: true, cles: ['attaques-exactes'] });
    assert.deepStrictEqual(paire(p), { 654292: 24321, 654294: 24679, 654295: 15388, 654296: 15381, 654298: 11392, 654299: 23946, 832368: 23634 });
});

console.log('— UNP (Unnumbered Promos), ligne sansPage de la table');
const TOUS_UNP = () => F('UNP').produits.map(p => p.idProduct);
t('sans clé ouverte : les 4 produits à nom unique seulement (garde calibrée 21 925 / 0)', () => {
    const p = plan('UNP', { visees: TOUS_UNP(), forcerNomSeul: false, cles: [] });
    assert.deepStrictEqual(paire(p), { 914411: 23400, 914410: 23399, 914412: 23901, 914413: 29759 });
});
t('clé « nom + attaques exactes » ouverte : 25 produits, preuve marquée', () => {
    const p = plan('UNP', { visees: TOUS_UNP(), forcerNomSeul: false, cles: ['attaques-exactes'] });
    assert.strictEqual(p.lignes.length, 25);
    assert.strictEqual(p.lignes.filter(l => /attaques-exactes/.test(l.preuve)).length, 21);
    assert.strictEqual(paire(p)[557927], 15274);
});
t('les homonymes à mêmes attaques (6 Pikachu [Growl | Thundershock]) ne sont JAMAIS désignés', () => {
    const p = plan('UNP', { visees: TOUS_UNP(), forcerNomSeul: false, cles: ['attaques-exactes'] });
    for (const id of [571763, 606006, 841985, 882119]) assert.ok(!(id in paire(p)), 'désigné à tort : ' + id);
});
t('les 74 produits déjà joints sont « déjà là » et ne sont pas réécrits', () => {
    const p = plan('UNP', { visees: TOUS_UNP(), forcerNomSeul: false, cles: ['attaques-exactes'] });
    assert.strictEqual(p.deja.length, 74);
});
t('une ligne détachée (interdite) ne se repose pas, même visée', () => {
    const d = F('UNP');
    const log = console.log; console.log = () => {};
    let p; try { p = planifier({ cartes: d.cartes, produits: d.produits, L: d.L, existants: new Map(), interdits: new Set(['23901|914412']), visees: [914412], forcerNomSeul: false, cles: [] }); } finally { console.log = log; }
    assert.strictEqual(p.lignes.length, 0); assert.match(p.refus[0].raison, /détachée|interdite/);
});

console.log('— garde de l’outil');
t('une clé inconnue lève', () => { assert.throws(() => plan('UNP', { visees: [914412], forcerNomSeul: false, cles: ['au-hasard'] }), /cl[ée]/i); });
t('--attendu obligatoire et exact', () => {
    assert.strictEqual(verifierAttendu({ lignes: [1, 2] }, undefined).ok, false);
    assert.strictEqual(verifierAttendu({ lignes: [1, 2] }, 3).ok, false);
    assert.strictEqual(verifierAttendu({ lignes: [1, 2] }, 2).ok, true);
});
t('la liste des arguments est fermée', () => {
    assert.ok(ARGUMENTS_AUTORISES.some(r => r.test('--code=UNP')) && !ARGUMENTS_AUTORISES.some(r => r.test('--force')));
});
console.log(`\n${ok} passés, ${ko} en échec`);
process.exitCode = ko ? 1 : 0;
