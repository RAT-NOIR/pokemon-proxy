// node test-tpc-sets-hsm.js — API-52 L5 (25/10) : la ligne Beginning-Set / pokemon-card-com / HSm de la table TPC (Oshawott 569867 et 569868, 011/037).
// Aucune requête, aucune base : la table seule et ses invariants (une ligne ne s'ajoute qu'après une mesure, jamais sur une supposition).
const assert = require('assert');
const { TABLE_TPC, ligneTpc, uniteDeLaLigne } = require('./collecte-cartes/tpc-sets');
let n = 0, ko = 0;
const t = (nom, f) => { try { f(); n++; console.log('ok  ', nom); } catch (e) { ko++; console.log('FAIL', nom, '-', e.message); } };

t('la ligne Beginning-Set existe : pokemon-card-com, japonais, code HSm, tirage jp', () => {
    const L = ligneTpc('pokemon-card-com', 'Beginning-Set');
    assert(L, 'ligne absente');
    assert.strictEqual(L.langue, 'ja'); assert.strictEqual(L.code, 'HSm'); assert.strictEqual(L.tirage, 'jp');
});
t('elle porte sa MESURE : 2 trous (569867, 569868), 19 cartes lues pour pg=HSm, date', () => {
    const L = ligneTpc('pokemon-card-com', 'Beginning-Set');
    assert.strictEqual(L.trous, 2); assert.strictEqual(L.cartes, 19);
    assert(/19 cartes/.test(L.mesure) && /HSm/.test(L.mesure) && /2 trous sur 52 produits/.test(L.mesure) && /2026-10-25/.test(L.mesure), L.mesure);
});
t('l\'unité de file de la ligne a la forme que la garde du collecteur accepte', () => {
    assert.deepStrictEqual(uniteDeLaLigne(ligneTpc('pokemon-card-com', 'Beginning-Set')), { _id: 'pokemon-card-com/Beginning-Set', source: 'pokemon-card-com', slugSet: 'Beginning-Set', code: 'HSm', langue: 'ja', trous: 2 });
});
t('la ligne n\'est pas « sansRemplacement » : elle REMPLACE les deux basseDefinition par la voie normale', () => {
    assert.notStrictEqual(ligneTpc('pokemon-card-com', 'Beginning-Set').sansRemplacement, true);
});
t('invariants de la table : aucun doublon (site, slug), chaque ligne a un site connu, une mesure et un code ; cartes >= 1', () => {
    const cles = TABLE_TPC.map(l => `${l.site}/${l.slug}`);
    assert.strictEqual(new Set(cles).size, cles.length);
    for (const l of TABLE_TPC) { assert(['tpc-asie', 'pokemon-card-com'].includes(l.site), l.slug); assert(typeof l.mesure === 'string' && l.mesure.length > 10, l.slug); assert(l.code, l.slug); assert(l.cartes >= 1, l.slug); }
});
t('les deux autres lignes voisines (XY-Beginning-Set HXY, Beginning-Set-Pikachu HSP) ne bougent pas', () => {
    assert.strictEqual(ligneTpc('pokemon-card-com', 'XY-Beginning-Set').code, 'HXY'); assert.strictEqual(ligneTpc('pokemon-card-com', 'Beginning-Set-Pikachu').code, 'HSP');
});
console.log(`\n${n} ok, ${ko} échec(s)`); process.exit(ko ? 1 : 0);
