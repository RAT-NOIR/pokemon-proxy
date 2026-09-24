// node test-setlist-listes-de-deck.js — une liste de deck `{{Halfdecklist/…}}` se lit comme une Setlist, sur DEMANDE de la ligne.
// 2026-09-25 : 39 lignes refusées « aucune entrée de Setlist » portaient leurs cartes dans `{{Halfdecklist/nmentry|…}}` ou
// `{{halfdecklist/entry|…}}`. Sur les pages à UN deck, le repli sur tout le wikitext les lit dès que la ligne nomme le jeton ;
// sur les pages à PLUSIEURS decks sous un même jeton (« Battle Master Deck 1 » pour deux decks, « Stellar Tera Type Starter
// Set 1 » pour deux sets), seule la SECTION distingue les decks. Opt-in (`bulba.listesDeDeck`) : les lignes déjà collectées
// ne changent pas de chemin, par construction.
const { sectionsSetlist, entreesDeLaSetlist } = require('./collecte-cartes/wikitext');

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); }
};
const entree = (n, nom) => `{{Halfdecklist/nmentry|${n}/021|{{TCG ID|Battle Master Deck|${nom}|${Number(n)}}}|Fire||1}}`;
const deck = (titre, ...lignes) => `{{Halfdecklist/nmheader|title=${titre}|type=Fire}}\n${lignes.join('\n')}\n{{Halfdecklist/nmfooter}}`;
const page = [
    deck('Battle Master Deck Terastal Charizard ex', entree('001', 'Charmander'), entree('002', 'Charmeleon')),
    deck('Battle Master Deck Chien-Pao ex', entree('001', 'Origin Forme Palkia V'))
].join('\n');

verifier('sans opt-in : aucune section (la page se lisait par le repli, comme avant)', sectionsSetlist(page).length, 0);
verifier('avec opt-in : les deux decks sont deux sections', sectionsSetlist(page, { listesDeDeck: true }).map(s => `${s.titre}:${s.entrees.length}`), ['Battle Master Deck Terastal Charizard ex:2', 'Battle Master Deck Chien-Pao ex:1']);
const b = { expansion: 'Battle Master Deck Terastal Charizard ex', setlist: ['Battle Master Deck Terastal Charizard ex'], listesDeDeck: true };
verifier('la ligne ne lit que la section de SON deck', entreesDeLaSetlist(page, b).entrees.map(e => e.titre), ['Charmander (Battle Master Deck 1)', 'Charmeleon (Battle Master Deck 2)']);
verifier('sans opt-in, la même ligne ne distingue pas les decks (repli par jeton)', entreesDeLaSetlist(page, { ...b, listesDeDeck: false, setlist: ['Battle Master Deck'] }).entrees.length, 3);
// `deck` restreint les IMPRESSIONS de la jointure (Stellar Tera : deux sets, une expansion) ; dans une section de deck, les
// entrées sont déjà celles du deck, et leur jeton (« Stellar Tera Type Starter Set 1 ») ne commence pas par le nom du deck.
const bDeck = { ...b, deck: 'Battle Master Deck Terastal Charizard ex' };
verifier('avec opt-in et section nommée, `deck` ne refiltre pas les entrées', entreesDeLaSetlist(page, bDeck).entrees.length, 2);
verifier('une Setlist ordinaire est lue pareil avec ou sans opt-in', sectionsSetlist('{{Setlist/header|title=X}}\n{{Setlist/entry|1|J|{{TCG ID|X|Pikachu|1}}|Lightning||C}}', { listesDeDeck: true }).map(s => `${s.titre}:${s.entrees.length}`), ['X:1']);

console.log(`\n${ok} passés, ${ko} en échec`);
process.exit(ko ? 1 : 0);
