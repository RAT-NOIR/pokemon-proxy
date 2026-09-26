// BANC — les règles de poser-dates-sets.js sur des valeurs RÉELLES de l'infobox (collecte-cartes/rapports/dates-sets.json, 2026-09-25) :
// une période se range à son début quand il est un jour complet, jamais à un jour fabriqué.
//   node test-poser-dates.js
const { periodeDe, isoPartiel, dateBulbapedia, majorite, texteDeIso, OFFICIELLES, jourComplet } = require('./poser-dates-sets');
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

// ── La sortie EN BOUTIQUE (testeur, 2026-09-26) : valeurs réelles des pages archivées, relevées le 2026-09-26.
const d6 = dateBulbapedia(page(['date=January 14, 2007 <small>(World Hobby Fair prerelease)</small><br>July 14, 2007 <small>(Theatrical release)</small><br>August 3, 2007 <small>(Commercial release)</small>']), set('jp', '10th Movie Commemoration Set (TCG)'));
verifier('10M : la « Commercial release » en <small>, pas l\'avant-première ni la salle', d6.jour, 'August 3, 2007');
const d7 = dateBulbapedia(page(['release=September 30, 2005 (Early release)<br>October 7, 2005 (General release)']), set('jp', 'Holon Research Tower Water Quarter Deck (TCG)'));
verifier('pcgN : la « General release », pas l\'« Early release »', d7.jour, 'October 7, 2005');
const d8 = dateBulbapedia(page(['date=July 19, 2008 <small>(Theatrical release)</small>']), set('jp', '11th Movie Commemoration Set (TCG)'));
verifier('une sortie en salle SEULE n\'est pas une sortie en boutique', d8.jour ?? null, null);
const BEGINNING = 'release=October 29, 2010 <small>(Standard versions)</small><br>November 20, 2010 <small>(DX versions)</small><br>August 5, 2011 <small>(Plus version)</small><br>November 18, 2011 <small>(Pikachu version)</small>';
verifier('Beginning Set Pikachu : la « Pikachu version »', dateBulbapedia(page([BEGINNING]), { ...set('jp', 'Beginning Set (TCG)'), _id: 'Beginning-Set-Pikachu' }).jour, 'November 18, 2011');
verifier('Beginning Set : les « Standard versions »', dateBulbapedia(page([BEGINNING]), { ...set('jp', 'Beginning Set (TCG)'), _id: 'Beginning-Set' }).jour, 'October 29, 2010');
verifier('un set dont la version n\'est pas nommée : rien', dateBulbapedia(page([BEGINNING]), { ...set('jp', 'Beginning Set (TCG)'), _id: 'Beginning-Set-Plus' }).jour ?? null, null);
// ── LA MAJORITÉ DES SOURCES, LA PLUS TÔT À ÉGALITÉ (testeur, 2026-09-26 après-midi) : une date n'empêche plus rien.
const C = (params, s) => (dateBulbapedia(page(params), s).candidats || []).map(c => c.iso);
verifier('deux sorties en boutique : les deux sont candidates', C(['release=May 1, 2010 (General release)<br>May 8, 2010 (General release)'], set('jp', 'X (TCG)')), ['2010-05-01', '2010-05-08']);
verifier('« (Part 1) », « (Part 2) » : deux sorties, deux candidates', C(['release=July 18, 2025 (Part 1)<br>October 17, 2025 (Part 2)'], set('zh-hans', 'Battle Party: Shining Dream (ATCG)')), ['2025-07-18', '2025-10-17']);
verifier('IDTH : l\'indonésienne et la thaïe sont candidates', C(['release=Indonesia: March 8, 2024<br>Thailand: March 15, 2024'], set('idth', 'X (TCG)')), ['2024-03-08', '2024-03-15']);
verifier('une avant-première reste écartée quand une sortie en boutique existe', C(['release=September 30, 2005 (Early release)<br>October 7, 2005 (General release)'], set('jp', 'X (TCG)')), ['2005-10-07']);
verifier('un mois seul est candidat, à sa précision', C(['release=November 2016'], set('jp', 'X (TCG)')), ['2016-11']);
verifier('une sortie en salle seule ne l\'est toujours pas', C(['date=July 19, 2008 <small>(Theatrical release)</small>'], set('jp', 'X (TCG)')), []);
verifier('CSMYC : trois boîtes étiquetées, trois candidates', C(["release='''Sylveon Box:''' January 6, 2023<br>'''Leafeon Box:''' February 3, 2023<br>'''Glaceon Box:''' March 3, 2023"], set('zh-hans', 'Eeveelutions GX Gift Box (ATCG)')), ['2023-01-06', '2023-02-03', '2023-03-03']);
verifier('CSMYC réel : une étiquette qui nomme deux boîtes', C(["release='''Sylveon Box:''' January 6, 2023<br>'''Leafeon Box '''/''' Glaceon Box:''' January 11, 2023<br>'''Espeon Box '''/''' Umbreon Box:''' January 13, 2023"], set('zh-hans', 'Eevee-GX Gift Box Sets (ATCG)')), ['2023-01-06', '2023-01-11', '2023-01-13']);
verifier('EXS : « Series 1: … » est un sous-produit', C(['release=Series 1: March 23rd, 1998<br>Series 2: May 1998'], set('jp', 'Expansion Sheet (TCG)')), ['1998-03-23', '1998-05']);
verifier('une étiquette de RÉGION parmi elles : ce sont d\'autres tirages', C(["release='''Thai:''' June 13, 2025<br>'''Indonesian:''' May 30, 2025"], set('zh-hant', 'X (TCG)')), []);
verifier('151C : une coquille à dix ans d\'écart refuse tout, et le dit', (() => { const r = dateBulbapedia(page(['release=January 17, 2025 (Journey)<br>July 18, 2015 (Scare)']), set('zh-hans', 'Collect 151 (ATCG)')); return [r.candidats ?? null, /coquille/.test(r.raison)]; })(), [null, true]);
verifier('une annotation SEULE (« (tentative) ») ne vote pas', C(['release=July 18, 2025 (tentative)'], set('jp', 'X (TCG)')), []);
const V = (...vs) => { const r = majorite(vs.map(([source, iso]) => ({ source, iso }))); return r && [r.iso, r.precision, r.voix]; };
verifier('Champion Road : officielle et Bulbapedia (2) contre TCGdex (1)', V(['officielle', '2018-05-03'], ['bulbapedia', '2018-05-03'], ['tcgdex', '2018-05-30']), ['2018-05-03', 'jour', 2]);
verifier('une contre une : la plus tôt', V(['bulbapedia', '2008-02-13'], ['tcgdex', '2008-02-01']), ['2008-02-01', 'jour', 1]);
verifier('une source à deux dates (IDTH) : la plus tôt', V(['bulbapedia', '2024-03-15'], ['bulbapedia', '2024-03-08']), ['2024-03-08', 'jour', 1]);
verifier('une source à deux dates, une autre confirme la seconde : la majorité', V(['bulbapedia', '2024-03-08'], ['bulbapedia', '2024-03-15'], ['tcgdex', '2024-03-15']), ['2024-03-15', 'jour', 2]);
verifier('un jour connu passe avant un mois seul', V(['bulbapedia', '2016-11'], ['tcgdex', '2016-11-04']), ['2016-11-04', 'jour', 1]);
verifier('un mois seul : la précision au mois, aucun jour', V(['bulbapedia', '2016-11']), ['2016-11', 'mois', 1]);
verifier('aucune voix : rien', majorite([]), null);
verifier('la date affichable d\'un mois ne porte pas de jour', [texteDeIso('2016-11'), texteDeIso('2016-11-04')], ['November 2016', 'November 4, 2016']);
verifier('les sources officielles citent leur page', Object.values(OFFICIELLES).every(x => /^https:\/\//.test(x.url) && x.citation && x.lu && jourComplet(x.jour) === x.jour), true);

console.log(`\n${ok} passés, ${ko} en échec`);
process.exitCode = ko ? 1 : 0;
