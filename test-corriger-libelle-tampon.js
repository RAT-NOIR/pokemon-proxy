// Banc PUR de corriger-libelle-tampon.js : aucune base, aucun réseau, aucun chemin réel.
const assert = require('assert');
const M = require('./corriger-libelle-tampon');

let ok = 0, ko = 0;
function cas(nom, f) { try { f(); ok++; console.log(`  ok   ${nom}`); } catch (e) { ko++; console.log(`  ECHEC ${nom} : ${e.message}`); } }

const L = M.CORRECTIONS_LIBELLE[0];
const ligne = (o = {}) => ({ ...L, ...o });
const entree = (o = {}) => ({ set: L.set, numero: L.numero, cleR2: L.cleR2, tamponNonRepresente: L.avant, ...o });
const carte = (images) => ({ _id: L.carteId, images });
const doc = (o = {}) => ({ _id: L.docId, cleR2: L.cleR2, tamponNonRepresente: L.avant, ...o });

cas('la vraie table est valide, une ligne, 78 -> League', () => {
    M.validerTable(M.CORRECTIONS_LIBELLE);
    assert.strictEqual(M.CORRECTIONS_LIBELLE.length, 1);
    assert.strictEqual(L.avant.length, 78);
    assert.strictEqual(L.apres, 'League');
    assert.ok(Object.isFrozen(M.CORRECTIONS_LIBELLE));
});
cas('validerTable lève sur apres vide', () => { assert.throws(() => M.validerTable([ligne({ apres: '  ' })])); assert.throws(() => M.validerTable([ligne({ apres: 5 })])); });
cas('validerTable lève sur 41 caractères, accepte 40', () => {
    assert.throws(() => M.validerTable([ligne({ apres: 'x'.repeat(41) })]));
    M.validerTable([ligne({ apres: 'x'.repeat(40) })]);
});
cas('validerTable lève sur apres === avant', () => assert.throws(() => M.validerTable([ligne({ apres: L.avant })])));
cas('validerTable lève sur un doublon', () => assert.throws(() => M.validerTable([ligne(), ligne()])));
cas('planifier : ecrire sur avant', () => {
    const p = M.planifier(carte([entree()]), doc(), L);
    assert.strictEqual(p.entree.action, 'ecrire'); assert.strictEqual(p.document.action, 'ecrire');
});
cas('planifier : deja sur apres', () => {
    const p = M.planifier(carte([entree({ tamponNonRepresente: L.apres })]), doc({ tamponNonRepresente: L.apres }), L);
    assert.strictEqual(p.entree.action, 'deja'); assert.strictEqual(p.document.action, 'deja');
});
cas('planifier : refus sur valeur inattendue', () => {
    const p = M.planifier(carte([entree({ tamponNonRepresente: 'autre' })]), doc({ tamponNonRepresente: 'autre' }), L);
    assert.strictEqual(p.entree.action, 'refus'); assert.match(p.entree.motif, /valeur inattendue/);
    assert.strictEqual(p.document.action, 'refus'); assert.match(p.document.motif, /valeur inattendue/);
});
cas('planifier : refus si entrée absente (autre cleR2) ou deux entrées', () => {
    assert.strictEqual(M.planifier(carte([entree({ cleR2: 'ailleurs' })]), doc(), L).entree.action, 'refus');
    assert.strictEqual(M.planifier(carte([]), doc(), L).entree.action, 'refus');
    assert.strictEqual(M.planifier(carte([entree(), entree()]), doc(), L).entree.action, 'refus');
});
cas('planifier : refus si document au mauvais cleR2, mauvais _id ou absent', () => {
    assert.strictEqual(M.planifier(carte([entree()]), doc({ cleR2: 'autre.webp' }), L).document.action, 'refus');
    assert.strictEqual(M.planifier(carte([entree()]), doc({ _id: 'autre' }), L).document.action, 'refus');
    assert.strictEqual(M.planifier(carte([entree()]), null, L).document.action, 'refus');
});
cas('analyserArguments : défaut plan, --ecrire exige --attendu, inconnu refusé', () => {
    assert.deepStrictEqual(M.analyserArguments([]), { ecrire: false, attendu: undefined });
    assert.deepStrictEqual(M.analyserArguments(['--plan']), { ecrire: false, attendu: undefined });
    assert.deepStrictEqual(M.analyserArguments(['--ecrire', '--attendu=2']), { ecrire: true, attendu: 2 });
    assert.throws(() => M.analyserArguments(['--ecrire']));
    assert.throws(() => M.analyserArguments(['--plan', '--bidule']));
    assert.throws(() => M.analyserArguments(['--attendu=x']));
});

console.log(`\n${ok} passés, ${ko} en échec`);
process.exit(ko ? 1 : 0);
