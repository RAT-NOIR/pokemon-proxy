// VIGN-SUITE tour 1 : le couplage entre la preuve écrite par la jointure et le déclencheur de retirer-chez-les-autres.   node test-preuve-correction.js
const assert = require('assert');
const { preuveDeCorrection, preuveEstUneCorrection } = require('./collecte-cartes/retirer-chez-les-autres');
const { CORRECTIONS } = require('./collecte-cartes/corrections-images');
let ko = 0;
const t = (nom, f) => { try { f(); console.log('  ok  ' + nom); } catch (e) { ko++; console.log('  ECHEC ' + nom + '\n     ' + String(e.message).split('\n')[0]); } };
t('la preuve fabriquée comme en production déclenche, pour chaque correction de la table', () => {
    for (const c of CORRECTIONS) assert.strictEqual(preuveEstUneCorrection(preuveDeCorrection(c)), true, c.cleR2);
});
t('aucune autre preuve de la jointure ne déclenche', () => {
    for (const p of ['numero', 'numero+nom', 'nom', 'nom+illustrateur', 'nom+rarete', 'rang+nom', null, undefined, ''])
        assert.strictEqual(preuveEstUneCorrection(p), false, String(p));
});
process.exit(ko ? 1 : 0);
