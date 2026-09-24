// node test-corrections-impressions.js — les numéros de page CONTREDITS, corrigés par une table lue et appliqués par le
// PARSEUR (collecte-cartes/corrections-impressions.js), pour qu'une recollecte ne les refasse pas. Cas réel : la page
// d'Alomomola déclare Alolan Moonlight 011 — le numéro de Wailord.
const { faitsDeCarte } = require('./collecte-cartes/wikitext');
const { corrigerImpressions, CORRECTIONS } = require('./collecte-cartes/corrections-impressions');

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); }
};
const TITRE = 'Alomomola (Guardians Rising 36)';
const page = '{{PokémoncardInfobox/Expansion|type=Water|expansion={{TCG|Guardians Rising}}|cardno=36/145}}\n{{PokémoncardInfobox/Expansion|type=Water|jpexpansion={{TCG|Alolan Moonlight}}|jpcardno=011/050|jprarity=U}}';
const f = faitsDeCarte(page, TITRE);
const jp = f.impressions.find(i => i.tirage === 'jp');
verifier('le parseur rend le BON numéro (011 → 012)', jp.numero, '012');
verifier('et l\'illustrateur lu, avec la preuve de la table', [jp.illustrateur, /corrections-impressions/.test(jp.illustrateurPreuve)], ['Aya Kusube', true]);
verifier('l\'impression porte la trace de la correction (le numéro de la page)', jp.correction?.numeroPage, '011');
verifier('l\'impression occidentale n\'est pas touchée', f.impressions.find(i => i.tirage === 'intl'), { tirage: 'intl', expansion: 'Guardians Rising', deck: null, numero: '36', total: '145', rarete: null });
verifier('une autre page au même numéro n\'est pas touchée (Wailord garde 011)', faitsDeCarte(page, 'Wailord (Guardians Rising 35)').impressions.find(i => i.tirage === 'jp').numero, '011');
// La page CORRIGÉE à la source : la table devient inerte et le dit, elle ne réécrit rien.
const R = corrigerImpressions(TITRE, [{ tirage: 'jp', expansion: 'Alolan Moonlight', deck: null, numero: '012', total: '050' }]);
verifier('page déjà juste : rien n\'est réécrit, la correction est INERTE', [R.impressions[0].numero, 'correction' in R.impressions[0], R.inertes.length], ['012', false, 1]);
verifier('la table porte 4 lignes, chacune avec deux preuves indépendantes au moins', CORRECTIONS.map(c => c.preuves.length >= 2), [true, true, true, true]);

console.log(`\n${ok} passés, ${ko} en échec`);
process.exit(ko ? 1 : 0);
