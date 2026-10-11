// Banc PUR de collecte-cartes/preuves-tirage.js : la liste FERMÉE des preuves de tirage de creer-sets-sans-page.js.
const assert = require('assert');
const { TYPES, typeDePreuve, verifierTirages } = require('./collecte-cartes/preuves-tirage');
let ok = 0;
const t = (nom, f) => { try { f(); ok++; console.log('  ok  ' + nom); } catch (e) { console.error('  ÉCHEC  ' + nom + '\n     ' + e.message); process.exitCode = 1; } };
const refuse = (T, motif) => assert.throws(() => verifierTirages(T), motif);

t('la liste fermée nomme les deux preuves ajoutées le 2026-10-11', () => { assert.ok(TYPES.includes('declarations')); assert.ok(TYPES.includes('page')); });
t('les types historiques se lisent par leur préfixe', () => {
    for (const [txt, ty] of [['codes_set : japonais (sA)', 'codes_set'], ['famille : MA1 sont idth', 'famille'], ['nom : « X »', 'nom'], ['CS…C : CSCC', 'CS…C'], ['asymétrie : désignés en jp 1', 'asymétrie'], ['set : X existe (zh-hans)', 'set'], ['declarations : 6 cartes', 'declarations'], ['pages de cartes : 6 cartes', 'declarations']])
        assert.strictEqual(typeDePreuve(txt), ty, txt);
});
t('REFUS : un type absent de la liste', () => refuse({ 1: ['jp', 'intuition : ça ressemble à du japonais'] }, /type de preuve/));
t('REFUS : une preuve vide', () => refuse({ 1: ['jp', ''] }, /type de preuve/));
t('REFUS : un tirage hors liste', () => refuse({ 1: ['klingon', 'codes_set : japonais (X)'] }, /tirage/));
t('REFUS : « page » seule, sans citation ni copie datée', () => refuse({ 1: ['intl', 'page : la page dit English'] }, /page/));
t('REFUS : « page » avec copie et citation mais sans seconde preuve ni citation qui nomme le produit', () => refuse({ 1: ['intl', 'page : « English cards » (copie Wayback 20260804035231)'] }, /page/));
t('OK : « page » + seconde preuve admise', () => verifierTirages({ 1: ['jp', 'page : « Japanese promotional cards » (copie Wayback 20260710090618) ; famille : S-P est jp'] }));
t('OK : « page » + citation qui nomme le produit', () => verifierTirages({ 1: ['intl', 'page : « English … cards » (copie Wayback 20260804035231) ; citation nomme le produit : « 2008 Burger King promotional Pokémon toys »'] }));
t('OK : un type historique seul', () => verifierTirages({ 1: ['jp', 'codes_set : japonais (pcgG)'] }));
t('REFUS : « declarations » sans nombre de cartes', () => refuse({ 1: ['jp', 'declarations : des cartes'] }, /declarations/));
console.log(process.exitCode ? `\n${ok} ok, ÉCHECS ci-dessus` : `\n${ok}/${ok} passés, 0 échec`);
