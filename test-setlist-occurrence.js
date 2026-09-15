// node test-setlist-occurrence.js — deux sections Setlist du MÊME nom sur une page (2026-09-15).
// Lignes RELEVÉES sur « Forbidden Light (TCG) » (revid de la sonde du 2026-09-15) : la section occidentale (nmheader/nmentry,
// 146 entrées) puis la japonaise (header/entry « 001/094 », 110 entrées = les 110 produits Cardmarket de sm6). Fusionnées,
// la ligne sm6 lisait 256 entrées (ratio 2,33) et une carte-échantillon occidentale : refusée. Même forme sur Shining Legends
// (sm3+) et Pokémon GO (s10b).
const { entreesDeLaSetlist } = require('./collecte-cartes/wikitext');

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); }
};
const page = [
    '{{Setlist/nmheader|title=Forbidden Light|tablecol=A65E9A|bordercol=440255|cellcol=D3D3D3|rarity=yes|symbol=yes|image=SetSymbolForbidden Light.png}}',
    '{{Setlist/nmentry|1/131|{{TCG ID|Forbidden Light|Exeggcute|1}}|Grass||Common}}',
    '{{Setlist/nmentry|2/131|{{TCG ID|Forbidden Light|Alolan Exeggutor|2}}|Grass||Rare}}',
    '{{Setlist/footer|cellcol=D3D3D3}}',
    '|}',
    '{{Setlist/header|title=Forbidden Light|tablecol=89CAC3|bordercol=262F80|cellcol=FFFAB3|rarity=yes|symbol=yes|image=SetSymbolForbiddenLight.png}}',
    '{{Setlist/entry|001/094|B|{{TCG ID|Forbidden Light|Exeggcute|1}}|Grass||C}}',
    '{{Setlist/footer|cellcol=FFFAB3}}',
    '|}'
].join('\n');

const toutes = entreesDeLaSetlist(page, { expansion: 'Forbidden Light' });
verifier('sans occurrence : les deux sections homonymes (inchangé)', [toutes.chemin, toutes.entrees.length], ['sections-nommees', 3]);
const deuxieme = entreesDeLaSetlist(page, { expansion: 'Forbidden Light', sectionOccurrence: 2 });
verifier('sectionOccurrence 2 : la seule section japonaise', [deuxieme.chemin, deuxieme.entrees.length, deuxieme.entrees[0]?.titre], ['sections-nommees', 1, 'Exeggcute (Forbidden Light 1)']);
const premiere = entreesDeLaSetlist(page, { expansion: 'Forbidden Light', sectionOccurrence: 1 });
verifier('sectionOccurrence 1 : la seule section occidentale', premiere.entrees.length, 2);
const absente = entreesDeLaSetlist(page, { expansion: 'Forbidden Light', sectionOccurrence: 3 });
verifier('occurrence absente : aucune entrée de section, jamais une autre section', absente.chemin === 'sections-nommees' ? absente.entrees.length : `chemin ${absente.chemin}`, 0);

console.log(`\n${ok}/${ok + ko} ${ko ? '❌' : '✅'}`);
process.exit(ko ? 1 : 0);
