// BANC — la ligne Additionals x30C (30th Celebration Additionals, exp 6767) : MÊME page, MÊME tirage, MÊME nom d'expansion que sa base 30C.
//   node test-ligne-x30c.js
// Pur (la table est un module de données) : aucune base, aucun réseau.
const { ligne, TABLE } = require('./collecte-cartes/table-sets');
let ok = 0, ko = 0;
const verifier = (quoi, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`  ✅ ${quoi}`); } else { ko++; console.log(`  ❌ ${quoi}\n     obtenu  ${a}\n     attendu ${b}`); }
};
const X = ligne('x30C'), B = ligne('30C');
verifier('la base 30C existe et est vérifiée (la ligne x30C se lit sur SA page)', [!!B, !!B?.verifie], [true, true]);
verifier('x30C existe, vérifiée', [!!X, !!X?.verifie], [true, true]);
verifier('identité : exp 6767, slugSet du set qui existe déjà en base', [X?.exp, X?.slugSet, X?.nom], [6767, '30th-Celebration-Additionals', '30th Celebration Additionals']);
verifier('région occidentale, produits 9 (2 cartes + 7 cartes-code), attendu 9', [X?.region, X?.prod, X?.attendu], ['occidental', 9, 9]);
verifier('additionalsDe désigne la base 30C', X?.additionalsDe, '30C');
verifier('MÊME page que la base (titre, tirage, nom d\'expansion, section lue)', X && B && JSON.stringify(X.bulba) === JSON.stringify(B.bulba), true);
verifier('la section lue est celle de la base (30th Celebration, n°1) : sans elle la ligne joindrait la section japonaise', [X?.bulba?.setlist, X?.bulba?.sectionOccurrence], [['30th Celebration'], 1]);
verifier('le relevé cite la page et les 161 entrées de la base', [X?.verifie?.page, X?.verifie?.entrees], ['30th Celebration (TCG)', { '30th Celebration': 161 }]);
verifier('une seule ligne x30C (la table ne se contredit pas)', TABLE.filter(l => l.code === 'x30C').length, 1);
verifier('aucune autre ligne ne réclame l\'expansion 6767 ni le slugSet', TABLE.filter(l => l.exp === 6767 || l.slugSet === '30th-Celebration-Additionals').map(l => l.code), ['x30C']);
console.log(`\n${ok} passés, ${ko} en échec`);
process.exitCode = ko ? 1 : 0;
