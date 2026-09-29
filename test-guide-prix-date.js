// Banc de guide-prix-date.js — aucune base ouverte.
//   node test-guide-prix-date.js
const { blocGuidePrix, iso } = require('./guide-prix-date');

let echecs = 0, n = 0;
const verifier = (nom, obtenu, attendu) => { n++; const ok = JSON.stringify(obtenu) === JSON.stringify(attendu); if (!ok) echecs++; console.log(`${ok ? '✅' : '❌'} ${nom} : ${JSON.stringify(obtenu)}${ok ? '' : ` (attendu ${JSON.stringify(attendu)})`}`); };

const D = s => new Date(s);
const maintenant = D('2026-10-05T12:00:00Z');
verifier('1. prix du dernier guide : âge en jours entiers, pas absent',
    blocGuidePrix({ guideDuGagnant: D('2026-09-27T00:44:41Z'), dernierGuide: D('2026-09-27T00:44:41Z'), maintenant }),
    { dernierGuide: '2026-09-27T00:44:41.000Z', guideDuGagnant: '2026-09-27T00:44:41.000Z', ageJours: 8, absentDuDernierGuide: false });
verifier('2. produit absent du dernier guide : son prix vient d\'un guide plus ancien, et ça se dit',
    blocGuidePrix({ guideDuGagnant: D('2026-09-01T00:00:00Z'), dernierGuide: D('2026-09-27T00:44:41Z'), maintenant }).absentDuDernierGuide, true);
verifier('3. ligne sans date (d\'avant le champ) : tout ce qui en dépend est null — jamais false ni 0',
    blocGuidePrix({ guideDuGagnant: null, dernierGuide: D('2026-09-27T00:44:41Z'), maintenant }),
    { dernierGuide: '2026-09-27T00:44:41.000Z', guideDuGagnant: null, ageJours: null, absentDuDernierGuide: null });
verifier('4. méta absente : « absent du dernier guide » ne se sait pas (null), l\'âge se sait',
    blocGuidePrix({ guideDuGagnant: D('2026-09-27T00:00:00Z'), dernierGuide: null, maintenant }), { dernierGuide: null, guideDuGagnant: '2026-09-27T00:00:00.000Z', ageJours: 8, absentDuDernierGuide: null });
verifier('5. une date invalide est une absence, pas une date', blocGuidePrix({ guideDuGagnant: D('pas une date'), dernierGuide: null, maintenant }).guideDuGagnant, null);
verifier('6. une horloge en retard ne rend pas un âge négatif', blocGuidePrix({ guideDuGagnant: D('2026-10-06T00:00:00Z'), maintenant }).ageJours, 0);
verifier('7. sans rien : quatre null', blocGuidePrix({ maintenant }), { dernierGuide: null, guideDuGagnant: null, ageJours: null, absentDuDernierGuide: null });
verifier('8. iso : une chaîne n\'est pas une Date (la base rend des Date ; une chaîne serait une ligne mal écrite)', iso('2026-09-27'), null);

console.log(`\n${echecs ? `⚠️ ${echecs}/${n} en échec` : `🎉 ${n}/${n} passés`}`);
process.exit(echecs ? 1 : 0);
