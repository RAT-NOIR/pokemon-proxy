// BANC — les règles de poser-dates-sets.js sur des valeurs RÉELLES de l'infobox (collecte-cartes/rapports/dates-sets.json, 2026-09-25) :
// une période se range à son début quand il est un jour complet, jamais à un jour fabriqué.
//   node test-poser-dates.js
const { periodeDe, isoPartiel, dateBulbapedia } = require('./poser-dates-sets');
let ok = 0, ko = 0;
const verifier = (quoi, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`  ✅ ${quoi}`); } else { ko++; console.log(`  ❌ ${quoi}\n     obtenu  ${a}\n     attendu ${b}`); }
};
const P = t => { const p = periodeDe(t); return [p.debut, p.fin, p.jourDebut, p.debutIso]; };

verifier('début au mois : pas de jour, ISO au mois', P('November 2016 - October 2019'), ['November 2016', 'October 2019', null, '2016-11']);
verifier('début au jour, fin au mois', P('November 18, 2022 - January 2026'), ['November 18, 2022', 'January 2026', 'November 18, 2022', '2022-11-18']);
verifier('« From … » : un début, pas de fin', P('From December 4, 2024'), ['December 4, 2024', null, 'December 4, 2024', '2024-12-04']);
verifier('une seule date dans `period`', P('September 26, 2025'), ['September 26, 2025', null, 'September 26, 2025', '2025-09-26']);
verifier('« - Present »', P('August 15, 2025 - Present'), ['August 15, 2025', 'Present', 'August 15, 2025', '2025-08-15']);
verifier('début SANS année : rien n\'est déduit de la fin', P('January 26 - February 24, 2002'), ['January 26', 'February 24, 2002', null, null]);
verifier('« October 1996 - Present »', P('October 1996 - Present'), ['October 1996', 'Present', null, '1996-10']);
verifier('isoPartiel : année seule', isoPartiel('2004'), '2004');
verifier('isoPartiel : texte libre', isoPartiel('Early 2004'), null);

const page = (params, titre) => [`{{TCGPromoInfobox`, ...params.map(p => `|${p}`), '}}'].join('\n');
const set = (tirage, titre, code = 'X') => ({ tirage, code, bulba: { titre } });
const d1 = dateBulbapedia(page(['period=November 2016 - October 2019']), set('jp', 'SM-P Promotional cards'));
verifier('page japonaise, période au mois : raison + période', [d1.jour ?? null, d1.periode?.debutIso, /pas un jour complet/.test(d1.raison)], [null, '2016-11', true]);
const d2 = dateBulbapedia(page(['period=November 18, 2022 - January 2026']), set('jp', 'SV-P Promotional cards'));
verifier('page japonaise, début au jour : période datable', [d2.raison, d2.periode?.jourDebut], [null, 'November 18, 2022']);
const d3 = dateBulbapedia(page(['period=August 15, 2025 - Present']), set('zh-hant', 'M-P Promotional cards (TCTCG)'));
verifier('page du tirage chinois traditionnel (TCTCG)', d3.periode?.jourDebut, 'August 15, 2025');
const d4 = dateBulbapedia(page(['period=August 15, 2025 - Present']), set('zh-hant', 'M-P Promotional cards'));
verifier('période d\'une page qui n\'est PAS celle du tirage : rien', [d4.periode ?? null, /ne désigne pas ce tirage/.test(d4.raison)], [null, true]);
const d5 = dateBulbapedia(page(['release=July 18, 2025', 'period=March 2025']), set('jp', 'Black Bolt (TCG)'));
verifier('une date de sortie passe avant une période', d5.jour, 'July 18, 2025');

console.log(`\n${ok} passés, ${ko} en échec`);
process.exitCode = ko ? 1 : 0;
