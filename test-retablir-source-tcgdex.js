// Banc de retablir-source-tcgdex.js : le juge d'une ligne SAIT-IL refuser (§41) ? Aucune base ouverte.
//   node test-retablir-source-tcgdex.js
const { juger } = require('./retablir-source-tcgdex');

let echecs = 0, n = 0;
const verifier = (nom, obtenu, attendu) => { n++; const ok = JSON.stringify(obtenu) === JSON.stringify(attendu); if (!ok) echecs++; console.log(`${ok ? '✅' : '❌'} ${nom} : ${JSON.stringify(obtenu)}${ok ? '' : ` (attendu ${JSON.stringify(attendu)})`}`); };

const ligne = (o = {}) => ({ idProduct: 861527, numero: '001', slug: 'Ethans-Pinsir-V2-xm2a001', slugSet: 'MEGA-Dream-ex-Additionals', numeroUrl: '001', nomFr: 'Scarabrute de Luth', variante: 'V2',
    preuveTcgdex: 'idProduct porté par TCGdex M2a-001 (variants[].thirdParty.cardmarket) · nom japonais « ヒビキのカイロス » → nos cartes « Ethan\'s Pinsir » · attaques Vise Grip | Rallying Horn ✅',
    preuveDeduction: 'titre « Scarabrute de Luth (xm2a 001) » ; idProduct DÉDUIT : seul produit non appris de l\'expansion 6409 au nom « Ethan\'s Pinsir » · apprendre-journal.js', ...o });
const avant = (o = {}) => ({ idProduct: 861527, numero: '001', source: 'tcgdex', certitude: 'exacte', slugSet: 'MEGA-Dream-ex-Additionals', ...o });
const NOM = 'Ethan\'s Pinsir [Vise Grip | Rallying Horn]';

const bon = juger(ligne(), NOM, avant());
verifier('1. tout concorde : retenue, champs déduits = ceux qui étaient VIDES avant (slugSet déjà là : non attribué)', [bon.ok, bon.champsDeduits], [true, ['slug', 'numeroUrl', 'nomFr', 'variante']]);
verifier('2. n° TCGdex différent : refusée', juger(ligne({ preuveTcgdex: ligne().preuveTcgdex.replace('M2a-001', 'M2a-002') }), NOM, avant()).ok, false);
verifier('3. n° du titre différent : refusée', juger(ligne({ preuveDeduction: ligne().preuveDeduction.replace('xm2a 001', 'xm2a 011') }), NOM, avant()).ok, false);
verifier('4. slug d\'un autre numéro : refusée', juger(ligne({ slug: 'Ethans-Pinsir-V2-xm2a011' }), NOM, avant()).ok, false);
verifier('5. la preuve TCGdex nomme une autre carte : refusée', juger(ligne({ preuveTcgdex: ligne().preuveTcgdex.replace('« Ethan\'s Pinsir »', '« Pinsir »') }), NOM, avant()).ok, false);
verifier('6. le slug nomme une autre carte : refusée', juger(ligne({ slug: 'Pinsir-V2-xm2a001' }), NOM, avant()).ok, false);
verifier('7. avant le journal : cardmarket, pas tcgdex — refusée', juger(ligne(), NOM, avant({ source: 'cardmarket' })).ok, false);
verifier('8. avant le journal : un autre numéro — refusée', juger(ligne(), NOM, avant({ numero: '002' })).ok, false);
verifier('9. un nomFr RÉÉCRIT sur une valeur existante : refusée', juger(ligne(), NOM, avant({ nomFr: 'Scarabrute' })).ok, false);
verifier('10. absente de la sauvegarde : refusée', juger(ligne(), NOM, undefined).ok, false);
verifier('11. absente de l\'export : refusée', juger(ligne(), undefined, avant()).ok, false);
verifier('12. preuves illisibles : refusée, deux raisons', juger(ligne({ preuveTcgdex: 'x', preuveDeduction: 'y' }), NOM, avant()).raisons.filter(r => /illisible/.test(r)).length, 2);

console.log(`\n${echecs ? `⚠️ ${echecs}/${n} en échec` : `🎉 ${n}/${n} passés`}`);
process.exit(echecs ? 1 : 0);
