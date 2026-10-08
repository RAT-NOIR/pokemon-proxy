// Banc PUR de la règle du taux de lignes avec prix (collecte-cartes/taux-prix-guide.js) — aucune base, aucun réseau, aucune écriture.
//   node test-taux-prix-guide.js
// Décision du testeur (2026-10-08) : 85 % fixe ET refus si le taux chute de plus de 3 points par rapport au dernier guide importé ;
// le premier import après le changement (taux dernier ABSENT) n'applique que le seuil de 85 %.
const { jugerTauxPrix, porteUnPrix, SEUIL_PCT, CHUTE_MAX_POINTS } = require('./collecte-cartes/taux-prix-guide');

let echecs = 0, n = 0;
const verifier = (nom, obtenu, attendu) => { n++; const ok = JSON.stringify(obtenu) === JSON.stringify(attendu); if (!ok) echecs++; console.log(`${ok ? '✅' : '❌'} ${nom} : ${JSON.stringify(obtenu)}${ok ? '' : ` (attendu ${JSON.stringify(attendu)})`}`); };
const passe = (...a) => jugerTauxPrix(...a).passe;

verifier('constantes de la décision', [SEUIL_PCT, CHUTE_MAX_POINTS], [85, 3]);
// le seuil fixe
verifier('85 % pile, premier import : passe', passe({ avecPrix: 85, lignes: 100 }), true);
verifier('84,99 % (8499/10000), premier import : refuse', passe({ avecPrix: 8499, lignes: 10000 }), false);
verifier('le taux réel de 89,13 % qui était refusé à 90 % : passe', passe({ avecPrix: 89130, lignes: 100000 }), true);
verifier('refus : la raison porte les chiffres', /84,99 %|8499 sur 10000/.test(jugerTauxPrix({ avecPrix: 8499, lignes: 10000 }).raison), true);
// la chute
verifier('chute de 3,01 points (89 -> 85,99) : refuse', passe({ avecPrix: 85990, lignes: 100000, tauxDernier: 89 }), false);
verifier('chute de 3 points pile (89 -> 86) : passe', passe({ avecPrix: 86, lignes: 100, tauxDernier: 89 }), true);
verifier('hausse : passe', passe({ avecPrix: 92, lignes: 100, tauxDernier: 89 }), true);
verifier('chute < 3 points mais sous 85 % : refuse (le seuil fixe reste)', passe({ avecPrix: 84, lignes: 100, tauxDernier: 86 }), false);
verifier('chute refusée : la raison nomme les deux taux', /89/.test(jugerTauxPrix({ avecPrix: 85990, lignes: 100000, tauxDernier: 89 }).raison), true);
// le premier import
verifier('tauxDernier absent (undefined) : seul le seuil de 85 % joue', passe({ avecPrix: 86, lignes: 100 }), true);
verifier('tauxDernier absent (null) : seul le seuil de 85 % joue', passe({ avecPrix: 86, lignes: 100, tauxDernier: null }), true);
// l'illisible refuse, ce n'est pas « absent »
for (const [nom, v] of [['chaîne', '89'], ['NaN', NaN], ['Infinity', Infinity], ['objet', {}], ['négatif', -1], ['> 100', 101]]) {
    verifier(`tauxDernier illisible (${nom}) : refuse`, passe({ avecPrix: 90, lignes: 100, tauxDernier: v }), false);
}
// entrées inutilisables : refuse et le dit
verifier('lignes = 0 : refuse', passe({ avecPrix: 0, lignes: 0 }), false);
verifier('avecPrix non numérique : refuse', passe({ avecPrix: '90', lignes: 100 }), false);
verifier('avecPrix > lignes : refuse', passe({ avecPrix: 101, lignes: 100 }), false);
verifier('rend le taux mesuré (en %)', jugerTauxPrix({ avecPrix: 89, lignes: 100 }).taux, 89);
// le prédicat « porte un prix » est CELUI d'avant (trend OU avg numérique fini)
verifier('porteUnPrix : trend seul', porteUnPrix({ trend: 1 }), true);
verifier('porteUnPrix : avg seul', porteUnPrix({ avg: 0 }), true);
verifier('porteUnPrix : ni l\'un ni l\'autre', porteUnPrix({ low: 3 }), false);
verifier('porteUnPrix : chaîne ou null ne comptent pas', [porteUnPrix({ trend: '1' }), porteUnPrix({ trend: null, avg: null })], [false, false]);

console.log(`\n${echecs ? `⚠️ ${echecs}/${n} en échec` : `🎉 ${n}/${n} passés`} (fonction pure : aucune base, aucun réseau)`);
process.exit(echecs ? 1 : 0);
