'use strict';
// PROBABLE — la règle (identifier/probable.js, signal A) sur des états fabriqués, y compris ceux qui doivent dire NON.
const H = require('./_harnais'); const P = require('../identifier/probable'); const GC = require('../identifier/garde-contradiction');
const ligne = (o = {}) => ({ numero: '12', total: '102', set: { code: 'BS' }, tirageSource: 'intl', setTcgdex: 'base1', nomCardmarket: 'Machop', ...o });
const lu = (o = {}) => GC.lectureDe({ success: true, carte: {}, lectureGarde: { numero: '12', total: '102', langue: 'EN', carteTcgdexId: 'base1-12', ...o } });
const mapDe = o => new Map(Object.entries(o).map(([k, v]) => [+k, v]));
(async () => {
    // numéro et total : 1 concorde (ok), les autres contredits (ko)
    const A = mapDe({ 1: ligne(), 2: ligne({ numero: '13' }), 3: ligne({ numero: '14', total: '64' }) });
    const d = P.decider({ ids: [1, 2, 3], produits: A, lu: lu() });
    H.v('un candidat concorde, les deux autres sont contredits : probable', d && d.idProduct, 1);
    H.v('   signal A, les contredits nommés', [d.signal, d.contredits], ['A', [2, 3]]);
    H.v('   l\'ordre des ids n\'y change rien', P.decider({ ids: [3, 2, 1], produits: A, lu: lu() }).idProduct, 1);
    // NON : un rival non contredit
    H.v('un rival non contredit (même numéro, total) : rien', P.decider({ ids: [1, 2], produits: mapDe({ 1: ligne(), 2: ligne({ set: { code: 'B2' } }) }), lu: lu() }), null);
    H.v('un seul des deux rivaux contredit : rien', P.decider({ ids: [1, 2, 3], produits: mapDe({ 1: ligne(), 2: ligne({ numero: '13' }), 3: ligne() }), lu: lu() }), null);
    // NON : le premier n'est pas concordant, ou est contredit
    H.v('le 1er n\'a aucun champ concordant (lecture sans numéro ni total) : rien', P.decider({ ids: [1, 2], produits: A, lu: lu({ numero: null, total: null, langue: null, carteTcgdexId: null }) }), null);
    H.v('tous contredits : rien', P.decider({ ids: [1, 2], produits: mapDe({ 1: ligne({ numero: '99' }), 2: ligne({ numero: '98' }) }), lu: lu() }), null);
    // l'image décide du premier ; la lecture doit le confirmer
    const cos = m => id => (m[id] ?? null);
    H.v('l\'image met en tête un candidat que la lecture contredit : rien', P.decider({ ids: [1, 2], produits: mapDe({ 1: ligne(), 2: ligne({ numero: '13' }) }), lu: lu(), cosinus: cos({ 1: 0.5, 2: 0.9 }) }), null);
    H.v('l\'image et la lecture désignent le même : probable', (P.decider({ ids: [1, 2], produits: mapDe({ 1: ligne(), 2: ligne({ numero: '13' }) }), lu: lu(), cosinus: cos({ 1: 0.9, 2: 0.5 }) }) || {}).idProduct, 1);
    // GROUPE : l'image ne tranche jamais ; la lecture seule, si elle contredit l'autre version
    H.v('groupe : l\'image seule (cosinus) ne rend rien quand la lecture ne sépare pas', P.decider({ ids: [1, 2], produits: mapDe({ 1: ligne(), 2: ligne() }), lu: lu(), cosinus: cos({ 1: 0.9, 2: 0.2 }), groupe: true }), null);
    H.v('groupe : la lecture contredit l\'autre version : probable', (P.decider({ ids: [1, 2], produits: mapDe({ 1: ligne(), 2: ligne({ numero: '13' }) }), lu: lu(), cosinus: cos({ 1: 0.2, 2: 0.9 }), groupe: true }) || {}).idProduct, 1);
    // ex aequo exact (même cosinus, même lecture) : rien
    H.v('ex aequo exact : rien', P.decider({ ids: [1, 2], produits: mapDe({ 1: ligne(), 2: ligne({ numero: '13' }) }), lu: lu({ numero: null }), cosinus: cos({ 1: 0.7, 2: 0.7 }) }), null);
    // formes : une ligne absente, un id en double, 1 ou 4 candidats, pas de lecture, produits pas une Map
    H.v('candidat sans ligne de catalogue : rien', P.decider({ ids: [1, 2], produits: mapDe({ 1: ligne() }), lu: lu() }), null);
    H.v('un seul candidat (confirmation) : rien', P.decider({ ids: [1], produits: A, lu: lu() }), null);
    H.v('quatre candidats : rien', P.decider({ ids: [1, 2, 3, 4], produits: A, lu: lu() }), null);
    H.v('doublon : rien', P.decider({ ids: [1, 1], produits: A, lu: lu() }), null);
    H.v('pas de lecture : rien', P.decider({ ids: [1, 2], produits: A, lu: null }), null);
    H.v('produits pas une Map : rien', P.decider({ ids: [1, 2], produits: {}, lu: lu() }), null);
    H.v('une fonction de cosinus qui lève : rien, sans exception', P.decider({ ids: [1, 2], produits: A, lu: lu(), cosinus: () => { throw new Error('x'); } }), null);
    // versions
    H.v('2.0.1 sert', P.versionAuMoins('2.0.1'), true);
    H.v('2.0.0 ne sert pas', P.versionAuMoins('2.0.0'), false);
    H.v('2.1.0 et 10.0.0 servent', [P.versionAuMoins('2.1.0'), P.versionAuMoins('10.0.0')], [true, true]);
    H.v('illisible, absent, nombre : pas servi', [P.versionAuMoins('abc'), P.versionAuMoins(undefined), P.versionAuMoins(2.1), P.versionAuMoins('2.0.1-beta')], [false, false, false, false]);
    // cosinusDes
    const sim = cles => cles.map(c => ({ a: 0.9, b: 0.4 })[c]);
    const f = P.cosinusDes({ ids: [1, 2], cles: new Map([[1, 'a'], [2, 'b']]), similarites: sim, redressee: true });
    H.v('cosinusDes : redressée', [f(1), f(2), f(3)], [0.9, 0.4, null]);
    H.v('cosinusDes : non redressée : aucun', [P.cosinusDes({ ids: [1], cles: new Map([[1, 'a']]), similarites: sim, redressee: false })(1)], [null]);
    H.bilan();
})().catch(e => { console.error('❌', e); process.exit(1); });
