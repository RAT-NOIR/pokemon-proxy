// Banc de la sélection de verifier-table.js --auto : une ligne ADMISE n'est rejugée que si on la NOMME (2026-09-24).
// L'occurrence : TK1 (EX Trainer Kit), admise à la main, sans fiche `verif`, a été rejugée deux fois par un bloc qui ne la
// visait pas — `!l.verif` la prenait pour « jamais jugée » — et a perdu son admission. Sans base, sans réseau.
const assert = require('assert');
const { lignesAJuger, peutRetirerAdmission } = require('./collecte-cartes/selection-verification');

const T = [
    { code: 'TK1', verifie: { le: '2026-09-15' } },                          // admise à la main, sans verif
    { code: 'NEUVE' },                                                       // jamais jugée
    { code: 'REFUS', verif: { etat: 'À REGARDER' } },                        // jugée, refusée
    { code: 'OK', verif: { etat: 'OK' }, verifie: { le: '2026-09-20' } },    // jugée, admise
    { code: 'JP', region: 'japonais' }                                       // jamais jugée, autre région
];
let ok = 0, ko = 0;
const cas = (nom, f) => { try { f(); ok++; console.log(`✅ ${nom}`); } catch (e) { ko++; console.log(`❌ ${nom} — ${e.message}`); } };
const codes = l => l.map(x => x.code).sort().join(',');

cas('par défaut : les lignes jamais jugées, et JAMAIS une ligne admise (TK1)', () => assert.strictEqual(codes(lignesAJuger(T, {})), 'JP,NEUVE'));
cas('--rejuger : les refusées et les jamais jugées, jamais une admise', () => assert.strictEqual(codes(lignesAJuger(T, { rejuger: true })), 'JP,NEUVE,REFUS'));
cas('--codes : une ligne NOMMÉE est rejugée, admise ou non', () => assert.strictEqual(codes(lignesAJuger(T, { codes: ['TK1', 'OK'] })), 'OK,TK1'));
cas('--region filtre', () => assert.strictEqual(codes(lignesAJuger(T, { region: 'japonais' })), 'JP'));
cas('--bloc borne le nombre', () => assert.strictEqual(lignesAJuger(T, { taille: 1 }).length, 1));
cas('retirer une admission : seulement sur une ligne nommée', () => {
    assert.strictEqual(peutRetirerAdmission(T[0], {}), false);
    assert.strictEqual(peutRetirerAdmission(T[0], { rejuger: true }), false);
    assert.strictEqual(peutRetirerAdmission(T[0], { codes: ['TK1'] }), true);
    assert.strictEqual(peutRetirerAdmission(T[0], { codes: ['OK'] }), false);
});
console.log(`\n${ok} passés, ${ko} en échec`);
process.exit(ko ? 1 : 0);
