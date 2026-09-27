// node test-codes-set.js — la règle de `codes_set` (collecte-cartes/codes-set.js), sans base : un accès fabriqué qui note ses écritures.
const { decoderCodeSet, fabriquerMemoriserCodeSet } = require('./collecte-cartes/codes-set');
let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => { const a = JSON.stringify(obtenu), b = JSON.stringify(attendu); if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); } };
const muet = { log() {}, warn() {}, error() {} };
function acces(existants = {}, pret = true) {
    const ecrits = [], journal = { ...muet, avert: [], err: [] };
    journal.warn = m => journal.avert.push(m); journal.error = (...a) => journal.err.push(a.join(' '));
    const m = fabriquerMemoriserCodeSet({ lire: async id => (id in existants ? { codeSet: existants[id] } : null), ecrire: async (id, cs) => ecrits.push([id, cs]), pret: () => pret, journal });
    return { m, ecrits, journal };
}
(async () => {
    verifier('décodage : « SV-P%2FCS » → « SV-P/CS », « K%2BK » → « K+K », « 100% » malformé reste tel quel, vide reste vide',
        [decoderCodeSet('SV-P%2FCS'), decoderCodeSet('K%2BK'), decoderCodeSet('100%'), decoderCodeSet(null), decoderCodeSet('SUM')], ['SV-P/CS', 'K+K', '100%', null, 'SUM']);
    let a = acces({ 1745: 'SUM' }); await a.m(1745, 'SMP');
    verifier('un code DIFFÉRENT pour une expansion apprise : rien écrit, refus tracé', [a.ecrits.length, a.journal.avert.length], [0, 1]);
    a = acces({ 1745: 'SUM' }); await a.m(1745, 'SUM');
    verifier('le MÊME code : réécrit (apprisLe se rafraîchit)', a.ecrits, [[1745, 'SUM']]);
    a = acces({}); await a.m(6673, 'S-P%2FID');
    verifier('une expansion neuve : écrite, le code DÉCODÉ', a.ecrits, [[6673, 'S-P/ID']]);
    a = acces({}, false); await a.m(6673, 'S-P/ID');
    verifier('Mongo pas prêt : rien écrit, l\'erreur est DITE (jamais un return muet)', [a.ecrits.length, a.journal.err.length], [0, 1]);
    a = acces({}); await a.m(null, 'SUM'); await a.m(1745, null);
    verifier('une carte sans code ou sans expansion : rien écrit, rien à signaler', [a.ecrits.length, a.journal.err.length, a.journal.avert.length], [0, 0, 0]);
    let leve = null; try { fabriquerMemoriserCodeSet({ lire: async () => null }); } catch (e) { leve = e.message; }
    verifier('un accès sans `ecrire` LÈVE à la fabrication', /obligatoires/.test(leve || ''), true);
    console.log(`\n${ok} passés, ${ko} en échec`);
    process.exit(ko ? 1 : 0);
})();
