// node test-faits-deck.js — les impressions de DECK japonaises (`jpdeck=` sans `jpexpansion=`), 2026-09-15.
// Entrées RELEVÉES telles quelles sur Bulbapedia (pages sauvées : Alolan Persian (Sun & Moon 79), Onix (Battle Styles 68),
// Duraludon (Stellar Crown 106)). Jusqu'ici elles tombaient dans `entreesNonRendues` : les 4 lignes de decks (sI100, svM,
// smH, sD, 863 produits) étaient « tirage non établi (vus : aucun) », et une collecte aurait joint 0 produit.
const { faitsDeCarte } = require('./collecte-cartes/wikitext');

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); }
};
const imps = t => faitsDeCarte(t).impressions.map(i => [i.tirage, i.expansion, i.deck, i.numero, i.total]);
const nonRendues = t => faitsDeCarte(t).controle?.entreesNonRendues ?? faitsDeCarte(t).entreesNonRendues;

const persian = '{{PokémoncardInfobox/Expansion|type=Darkness|jpdeck={{TCG|GX Starter Decks|Darkness Yveltal-GX Deck}}|jpcardno=066/131}}';
verifier('jpdeck à deux paramètres : expansion + deck + numéro', imps(persian), [['jp', 'GX Starter Decks', 'Darkness Yveltal-GX Deck', '066', '131']]);

const onix = '{{PokémoncardInfobox/Expansion|type=Fighting|jpdeck={{TCG|Start Deck 100}}|jpcardno=212/414}}';
verifier('jpdeck à un paramètre : expansion, deck nul', imps(onix), [['jp', 'Start Deck 100', null, '212', '414']]);

const duraludon = '{{PokémoncardInfobox/Expansion|type=Metal|jpdeck={{TCG|Generations Start Deck Zacian ex & Alcremie ex}}|jpcardno=088/175}}\n{{PokémoncardInfobox/Expansion|type=Metal|jpdeck={{TCG|Start Deck 100 Battle Collection}}|jpcardno=524/742}}';
verifier('deux entrées de deck : deux impressions', imps(duraludon), [['jp', 'Generations Start Deck Zacian ex & Alcremie ex', null, '088', '175'], ['jp', 'Start Deck 100 Battle Collection', null, '524', '742']]);

// Contre-cas : l'ancien comportement ne bouge pas quand `jpexpansion` est présent (deck en texte simple).
const intro = '{{PokémoncardInfobox/Expansion|type=Grass|jpexpansion={{TCG|Intro Pack}}|jpdeck=Bulbasaur Deck|jpcardno=3}}';
verifier('jpexpansion présent : inchangé, deck en texte', imps(intro), [['jp', 'Intro Pack', 'Bulbasaur Deck', '3', null]]);

// Le jeu vidéo reste hors impressions ; une entrée de deck n'est plus « non rendue ».
const gb = '{{PokémoncardInfobox/Expansion|gbset=Colosseum|gbcardno=12}}';
verifier('gbset : aucune impression', imps(gb), []);

console.log(`\n${ok}/${ok + ko} ${ko ? '❌' : '✅'}`);
process.exit(ko ? 1 : 0);
