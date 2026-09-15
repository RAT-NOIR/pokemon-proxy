// node test-coherence-ligne.js — la garde de cohérence d'une ligne automatique (verifier-table.js --auto).
// Cas fondateur, 2026-09-15 : `20th` « BREAK Starter Pack » (codes_set japonais) admis sur « Generations (TCG) » en
// tirage intl, par une redirection suivie : 84 produits joints à des cartes FAUSSES (Rapidash n°013 → Ninetales).
const { raisonsDeCoherence, concordanceDesNoms } = require('./collecte-cartes/coherence-ligne');

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); }
};
const ligne = (slugSet, cle, nomBulbapedia, regionCodesSet) => ({ slugSet, auto: { cle, nomBulbapedia, regionCodesSet } });

const r20th = raisonsDeCoherence(ligne('BREAK-Starter-Pack', 'page (TCG)', 'Generations', 'japonais'), 'intl');
verifier('20th : deux raisons (redirection, région contredite)', r20th.length, 2);
verifier('20th : la redirection nomme les deux noms', /« BREAK Starter Pack \(TCG\) ».*« Generations »/.test(r20th[0] || ''), true);
verifier('20th : la région nomme codes_set et le tirage', /japonais.*intl/.test(r20th[1] || ''), true);
verifier('sv4M redirigée, tirage jp : redirection seule',
    raisonsDeCoherence(ligne('Future-Flash', 'page (TCG)', 'Paradox Rift', 'japonais'), 'jp').length, 1);
verifier('page (TCG) non redirigée, jp/japonais : aucune raison',
    raisonsDeCoherence(ligne('Crimson-Haze', 'page (TCG)', 'Crimson Haze', 'japonais'), 'jp'), []);
verifier('slug exact : jamais lu comme une redirection',
    raisonsDeCoherence(ligne('Shiny-Treasure-ex', 'slug exact', 'Shiny Treasure ex', 'japonais'), 'jp'), []);
verifier('ponctuation et accents ne font pas une redirection',
    raisonsDeCoherence(ligne('Pokemon-Card-VS', 'page (TCG)', 'Pokémon Card★VS', 'japonais'), 'jp'), []);
verifier('regionCodesSet absent : pas de raison de région',
    raisonsDeCoherence(ligne('Kalos-Starter-Set', 'slug exact', 'Kalos Starter Set', null), 'intl'), []);
verifier('tirage non établi (null) : pas de raison de région',
    raisonsDeCoherence(ligne('Some-Set', 'slug exact', 'Some Set', 'japonais'), null), []);
verifier('occidental lu en jp : raison de région',
    raisonsDeCoherence(ligne('Base-Set', 'slug exact', 'Base Set', 'occidental'), 'jp').length, 1);

// concordanceDesNoms : part des jointures dont le nom du produit (slug Cardmarket) concorde avec le nom de la carte.
const c20 = concordanceDesNoms([['Rapidash', 'Ninetales'], ['Hitmonchan', 'Meowstic'], ['Blastoise-EX', 'Team Flare Grunt'], ['Venusaur-EX', 'Venusaur']]);
verifier('20th : 1 concordant sur 4 évaluables', [c20.concordants, c20.evaluables], [1, 4]);
const cok = concordanceDesNoms([['Haunter-20th025', 'Haunter'], ['Pikachu-V1', 'Pikachu'], ['Mega-Lucario-ex-M2a-123', 'Mega Lucario ex'], ['Poke-Ball', 'Poké Ball'], ['Lightning-Energy-V1-IPB6', 'Basic Lightning Energy']]);
verifier('suffixes Cardmarket (n° de set, V1, accents, énergie de base) : 5 sur 5', [cok.concordants, cok.evaluables], [5, 5]);
const cnul = concordanceDesNoms([['', 'Pikachu'], ['Pikachu', null]]);
verifier('nom absent : non évaluable, jamais compté discordant', [cnul.concordants, cnul.evaluables, cnul.nonEvaluables], [0, 0, 2]);
verifier('exemples de discordance rendus', c20.exemples.slice(0, 1), ['Rapidash → Ninetales']);

console.log(`\n${ok}/${ok + ko} ${ko ? '❌' : '✅'}`);
process.exit(ko ? 1 : 0);
