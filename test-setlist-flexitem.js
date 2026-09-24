// node test-setlist-flexitem.js — une Setlist rangée dans une colonne de mise en page `{{Flexitem|…}}` est une Setlist.
// « 30th Celebration (TCG) » (2026-09-24) range ses listes par langue dans quatre colonnes : sectionsSetlist, qui ne lisait que
// les gabarits de premier niveau, n'y voyait qu'une section de 2 entrées sur 750. Mesuré sur les 338 pages de set archivées :
// aucune autre n'a cette forme — le chemin n'est atteint que par elle.
const { sectionsSetlist, entreesDeLaSetlist } = require('./collecte-cartes/wikitext');

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); }
};
const entree = (n, nom) => `{{Setlist/entry|${n}/128|J|{{TCG ID|30th Celebration|${nom}|${Number(n)}}}|Grass||Common}}`;
const section = (titre, ...lignes) => `{{Setlist/header|title=${titre}|tablecol=FC0}}\n${lignes.join('\n')}\n{{Setlist/footer|cellcol=FF9}}`;
const page = [
    section('Additional Cards', '{{Setlist/entry|R|J|{{TCG ID|30th Celebration|Mew|R}}|Psychic||Rare}}'),
    '==Card list==', '{{Flexheader|justify-content=start}}',
    `{{Flexitem|extra-style=flex: 1|\n===English===\n${section('30th Celebration', entree('001', 'Exeggcute'), entree('002', 'Alolan Exeggutor'))}\n${section('30th Celebration Classic Collection', entree('003', 'Volbeat'))}\n}}`,
    `{{Flexitem|extra-style=flex: 1|\n===Japanese===\n${section('30th Celebration', entree('001', 'Exeggcute'), entree('002', 'Alolan Exeggutor'), entree('004', 'Illumise'))}\n}}`,
    '{{Flexfooter}}'
].join('\n');

const S = sectionsSetlist(page);
verifier('les sections des colonnes Flexitem sont lues, dans l\'ordre du texte', S.map(s => `${s.titre}:${s.entrees.length}`), ['Additional Cards:1', '30th Celebration:2', '30th Celebration Classic Collection:1', '30th Celebration:3']);
verifier('sectionOccurrence choisit la colonne : 2 = la liste japonaise', entreesDeLaSetlist(page, { expansion: '30th Celebration', sectionOccurrence: 2 }).entrees.map(e => e.titre), ['Exeggcute (30th Celebration 1)', 'Alolan Exeggutor (30th Celebration 2)', 'Illumise (30th Celebration 4)']);
verifier('une page sans Flexitem est lue comme avant', sectionsSetlist(section('Base Set', entree('001', 'Alakazam'))).map(s => `${s.titre}:${s.entrees.length}`), ['Base Set:1']);
verifier('un gabarit qui n\'est pas une colonne de mise en page n\'est pas ouvert', sectionsSetlist(`{{Autre|${section('X', entree('001', 'Pikachu'))}}}`).length, 0);

console.log(`\n${ok} passés, ${ko} en échec`);
process.exit(ko ? 1 : 0);
