// Banc de poser-h-fix.js (lot H-FIX) : purs, aucune base. node test-h-fix.js
const assert = require('assert');
const { planifier, operationsVersMongo, LISTE, SOURCE } = require('./collecte-cartes/h-fix');
const { SOURCES_POSEES_APRES } = require('./collecte-cartes/impressions-posees');
let n = 0, ko = 0;
const t = (nom, f) => { try { f(); n++; console.log('ok  ', nom); } catch (e) { ko++; console.log('FAIL', nom, '-', e.message); } };

const op = { carteId: 1, set: 'S', tirage: 'th', expansion: 'SV-P Promotional cards', numero: '54', produit: 10 };
const ligne = (o = {}) => ({ idProduct: 10, carteId: 1, slugSet: 'S', numeroFiche: '54', slug: 'X-V1-SV-PTH054', detail: "n°54, 131 dans l'expansion 6128", ...o });
const carte = (imps = []) => ({ _id: 1, impressions: imps });
const base = (o = {}) => ({ liste: [op], cartes: new Map([[1, carte()]]), lignes: [ligne()], ...o });

t('la source posée est conservée par impressions-posees.js', () => assert(SOURCES_POSEES_APRES.includes(SOURCE)));
t('deux éléments concordants : une impression posée', () => { const p = planifier(base()); assert.strictEqual(p.operations.length, 1); assert.strictEqual(p.operations[0].impression.numero, '54'); assert.strictEqual(p.refus.length, 0); });
t('le numéro du slug contredit : refus', () => { const p = planifier(base({ lignes: [ligne({ slug: 'X-V1-SV-PTH055' })] })); assert.strictEqual(p.operations.length, 0); assert.strictEqual(p.refus.length, 1); });
t('la Setlist (detail) ne donne pas le numéro : refus', () => { const p = planifier(base({ lignes: [ligne({ detail: "n°131 dans l'expansion 6128" })] })); assert.strictEqual(p.operations.length, 0); assert.strictEqual(p.refus.length, 1); });
t('numeroFiche de la ligne différent : refus (la ligne a changé)', () => { const p = planifier(base({ lignes: [ligne({ numeroFiche: '60' })] })); assert.strictEqual(p.refus.length, 1); });
t('impression déjà là (même numéro, 054 = 54) : rien à poser, jamais deux fois', () => { const p = planifier(base({ cartes: new Map([[1, carte([{ tirage: 'th', expansion: 'SV-P Promotional cards', numero: '054' }])]]) })); assert.strictEqual(p.operations.length, 0); assert.strictEqual(p.deja.length, 1); });
t('carte introuvable : refus', () => { const p = planifier(base({ cartes: new Map() })); assert.strictEqual(p.refus.length, 1); });
t('ligne introuvable : refus', () => { const p = planifier(base({ lignes: [] })); assert.strictEqual(p.refus.length, 1); });
t('écriture : un $push gardé par un filtre, jamais un écrasement', () => { const m = operationsVersMongo(planifier(base()).operations[0]); assert(m.maj.$push.impressions); assert(!m.maj.$set); assert(m.filtre.impressions.$not.$elemMatch.numero === '54'); });
t('la liste gelée : 6 impressions, clés uniques, chacune avec ses preuves', () => {
    assert.strictEqual(LISTE.length, 6);
    assert.strictEqual(new Set(LISTE.map(o => `${o.carteId}|${o.tirage}|${o.numero}`)).size, 6);
    for (const o of LISTE) { assert(o.produit && o.numero && o.expansion && o.vu); assert(Object.isFrozen(o)); }
});
console.log(`\n${n} ok, ${ko} échec(s)`); process.exit(ko ? 1 : 0);
