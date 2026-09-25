// node test-jointure-setlist.js — le numéro porté par la SETLIST, quand la page de carte ne déclare pas le tirage (2026-09-15).
// Cas relevés : « Transfiguration Mask (ATCG) » liste `Venipede (Transfiguration Mask 115)`, qui REDIRIGE vers
// `Venipede (Twilight Masquerade 115)` ; la page de carte n'a aucune impression chinoise. Cardmarket SV6s numérote 168…229
// (62 produits, la plage des rares), CSV7C « Blade Awakening » 001…259 (259 produits pour 259 entrées).
// Liens relevés le 2026-09-15 (pages sauvées) : une carte à suffixe s'écrit en LIEN, et sa parenthèse porte le numéro chinois :
// `[[Sinistcha ex (Transfiguration Mask 23)|Sinistcha]]{{ex}}`. Sans eux, SV6s couvrait 39/62 et CS3aC 134/184.
// 🔴 2026-09-19 : une page de PROMOS liste aussi des réimpressions d'AUTRES sets — « Psyduck (Astral Radiance 28) » sur
// « S-P Promotional cards (SCTCG) ». Leur TCG ID porte le numéro dans la numérotation de l'AUTRE set : accepté tel quel,
// il donnait le n°28 du promo à Psyduck — 12 produits joints à plusieurs cartes, garde déclenchée.
const { joindre, impressionsDepuisSetlist, numeroDeSetlist, jetonsDeSetlist } = require('./collecte-cartes/jointure');

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); }
};
const cible = { idExpansion: 6597, expansionBulba: 'Transfiguration Mask', tirage: 'zh-hant' };
const entrees = [
    { titre: 'Venipede (Transfiguration Mask 115)', a: 'Transfiguration Mask', b: '115', forme: 'tcg-id' },
    { titre: 'Pinsir (Transfiguration Mask 168)', a: 'Transfiguration Mask', b: '168', forme: 'tcg-id' },
    { titre: 'Pinsir (Transfiguration Mask 201)', a: 'Transfiguration Mask', b: '201', forme: 'tcg-id' },
    { titre: 'Psyduck (Astral Radiance 28)', a: 'Astral Radiance', b: '28', forme: 'tcg-id' },
    { titre: 'Pokémon Card 151 (lien)', a: 'Pokémon Card', b: '151', forme: 'lien' },
    { titre: 'Absente (Transfiguration Mask 9)', a: 'Transfiguration Mask', b: '9', forme: 'tcg-id' },
    { titre: 'Sinistcha ex (Transfiguration Mask 23)', a: 'Transfiguration Mask', b: '23', forme: 'lien' }
];
const pages = [
    { titre: 'Venipede (Transfiguration Mask 115)', pageid: 11, etat: 'ok' },
    { titre: 'Pinsir (Transfiguration Mask 168)', pageid: 12, etat: 'ok' },
    { titre: 'Pinsir (Transfiguration Mask 201)', pageid: 12, etat: 'ok' },
    { titre: 'Pokémon Card 151 (lien)', pageid: 13, etat: 'ok' },
    { titre: 'Absente (Transfiguration Mask 9)', pageid: null, etat: 'manquant' },
    { titre: 'Psyduck (Astral Radiance 28)', pageid: 15, etat: 'ok' },
    { titre: 'Sinistcha ex (Transfiguration Mask 23)', pageid: 14, etat: 'ok' }
];
const S = impressionsDepuisSetlist(entrees, pages, cible);
verifier('Venipede : impression virtuelle n°115, tirage et expansion de la cible', S.parCarte.get(11), [{ tirage: 'zh-hant', expansion: 'Transfiguration Mask', numero: '115', total: null, deck: null, rarete: null, source: 'setlist' }]);
verifier('Pinsir listé deux fois : deux numéros sur la même carte', (S.parCarte.get(12) || []).map(i => i.numero), ['168', '201']);
verifier('un LIEN vers une autre expansion ne donne pas de numéro (le sien est indicatif)', [S.parCarte.has(13), S.sansNumero], [false, ['Psyduck (Astral Radiance 28)', 'Pokémon Card 151 (lien)']]);
verifier('un LIEN dont la parenthèse est « <expansion de la cible> N » donne N (Sinistcha ex n°23)', (S.parCarte.get(14) || []).map(i => i.numero), ['23']);
verifier('la réimpression d’un AUTRE set ne donne pas son numéro à ce set', S.parCarte.has(15), false);
const noms = ['Storming Emergence Verdant'];
verifier('numeroDeSetlist : lien du set → numéro', numeroDeSetlist({ a: 'Storming Emergence Verdant', b: '14', forme: 'lien' }, noms), '14');
verifier('numeroDeSetlist : coquille de la source (« Emergrnce ») → rien, jamais deviné', numeroDeSetlist({ a: 'Storming Emergrnce Verdant', b: '27', forme: 'lien' }, noms), null);
verifier('numeroDeSetlist : TCG ID du set → son numéro', numeroDeSetlist({ a: 'Storming Emergence Verdant', b: '7', forme: 'tcg-id' }, noms), '7');
verifier('numeroDeSetlist : TCG ID d’un AUTRE set → rien (réimpression listée sur la page)', numeroDeSetlist({ a: 'Astral Radiance', b: '28', forme: 'tcg-id' }, noms), null);
verifier('numeroDeSetlist : lien sans numéro → rien', numeroDeSetlist({ a: 'Storming Emergence Verdant', b: null, forme: 'lien' }, noms), null);
// Le JETON DOMINANT : une page de promos écrit « S-P Promo » là où la table dit « S-P Promotional cards ». Le jeton le plus
// fréquent des TCG ID est celui de la page ; tout autre est une réimpression. Mesuré : S-P/CS 154 numéros sur 294 entrées.
const entreesPromo = [
    { a: 'S-P Promo', b: '28', forme: 'tcg-id' }, { a: 'S-P Promo', b: '38', forme: 'tcg-id' }, { a: 'S-P Promo', b: '47', forme: 'tcg-id' },
    { a: 'Astral Radiance', b: '28', forme: 'tcg-id' }, { a: 'Battle Styles', b: '38', forme: 'tcg-id' }
];
const jetons = jetonsDeSetlist(entreesPromo, ['S-P Promotional cards']);
verifier('jetonsDeSetlist : le nom de la table ET le jeton dominant de la page', [...jetons].sort(), ['S-P Promo', 'S-P Promotional cards']);
verifier('jeton dominant : le numéro de la page passe', numeroDeSetlist(entreesPromo[0], jetons), '28');
verifier('jeton dominant : la réimpression est refusée', numeroDeSetlist(entreesPromo[3], jetons), null);
verifier('entrée sans page : listée', S.sansPage, ['Absente (Transfiguration Mask 9)']);
const produit = (idProduct, nom, numero) => ({ idProduct, name: nom, nom, attaques: [], numero });

// 🔑 LE PRÉFIXE PAR SECTION (2026-09-25). Un Happy Set chinois range quatre listes sur sa page, chacune sous SON jeton de
// TCG ID (« Happy Set », « Happy Set Modification Pack »…), et chacune numérotée à partir de 1. Cardmarket écrit « 001 »,
// « a001 », « e001 », « p001 » — la lettre désigne la liste. Mesuré par numéro ET nom (CSVH4C : a 21/23, e 45/49, p 6/6,
// second choix 0) : le préfixe se LIT, il ne se devine pas. Sans lui, les quatre n°1 se confondent et trois listes sortent.
const prefixes = { 'Happy Set Modification Pack': 'a', 'Happy Set Reward Pack': 'p', 'Happy Set': '' };
const jetonsHappy = jetonsDeSetlist([], ['Decidueye & Melmetal & Koraidon & Miraidon Happy Set']);
verifier('préfixe par jeton : la liste Modification Pack donne « a » + n°', numeroDeSetlist({ a: 'Happy Set Modification Pack', b: '1', forme: 'tcg-id' }, jetonsHappy, prefixes), 'a1');
verifier('préfixe par jeton : un LIEN de la liste Reward Pack aussi', numeroDeSetlist({ a: 'Happy Set Reward Pack', b: '6', forme: 'lien' }, jetonsHappy, prefixes), 'p6');
verifier('préfixe vide : le jeton est reconnu comme celui du set, numéro nu', numeroDeSetlist({ a: 'Happy Set', b: '17', forme: 'lien' }, jetonsHappy, prefixes), '17');
verifier('un jeton absent de la table des préfixes suit la règle d’avant (réimpression refusée)', numeroDeSetlist({ a: 'Astral Radiance', b: '28', forme: 'tcg-id' }, jetonsHappy, prefixes), null);
verifier('préfixe par jeton, sans numéro → rien', numeroDeSetlist({ a: 'Happy Set Reward Pack', b: null, forme: 'lien' }, jetonsHappy, prefixes), null);
verifier('sans table de préfixes, rien ne change', numeroDeSetlist({ a: 'Happy Set Modification Pack', b: '1', forme: 'tcg-id' }, jetonsHappy), null);
const SH = impressionsDepuisSetlist([{ titre: 'Chansey (Happy Set Modification Pack 1)', a: 'Happy Set Modification Pack', b: '1', forme: 'tcg-id' }],
    [{ titre: 'Chansey (Happy Set Modification Pack 1)', pageid: 31, etat: 'ok' }],
    { tirage: 'zh-hans', expansionBulba: 'Decidueye & Melmetal & Koraidon & Miraidon Happy Set', prefixesParJeton: prefixes });
verifier('impressionsDepuisSetlist lit les préfixes de la cible', (SH.parCarte.get(31) || []).map(i => `${i.expansion}|${i.numero}`), ['Decidueye & Melmetal & Koraidon & Miraidon Happy Set|a1']);
const JH = joindre([{ _id: 31, nomEn: 'Chansey', attaques: [], impressions: SH.parCarte.get(31) }],
    [produit(40, 'Chansey', 'a001'), produit(41, 'Rowlet', '001')], { idExpansion: 6543, expansionBulba: 'Decidueye & Melmetal & Koraidon & Miraidon Happy Set', tirage: 'zh-hans', prefixesParJeton: prefixes });
verifier('« a1 » de la Setlist joint « a001 » de Cardmarket, pas « 001 »', JH.lignes.map(l => `${l.carteId}|${l.idProduct}`), ['31|40']);

// 🔑 LE PRÉFIXE PAR SECTION (2026-09-25) : Tag Team Collection (ID) renumérote « Set A » et « Set B » depuis 1 SOUS LE MÊME JETON ;
// Cardmarket écrit « a001 », « b001 » (mesuré numéro+nom : a 85/308, b 79/301, second choix 0). Le jeton ne distingue rien :
// c'est la SECTION qui porte la lettre, et l'entrée garde le titre de sa section.
const { sectionsSetlist } = require('./collecte-cartes/wikitext');
const pageTT = ['{{Setlist/header|title=Set A}}', '{{Setlist/entry|1|I|{{TCG ID|Tag Team Collection|Venusaur & Snivy-GX|1}}|Grass||RR}}', '{{Setlist/footer}}',
    '{{Setlist/header|title=Set B}}', '{{Setlist/entry|1|I|{{TCG ID|Tag Team Collection|Reshiram & Charizard-GX|1}}|Fire||RR}}', '{{Setlist/footer}}'].join('\n');
const eTT = sectionsSetlist(pageTT).flatMap(s => s.entrees);
verifier('une entrée garde le titre de sa section', eTT.map(e => e.section), ['Set A', 'Set B']);
const jTT = jetonsDeSetlist(eTT, ['Tag Team Collection']);
verifier('préfixe par section : Set A → « a1 », Set B → « b1 »', eTT.map(e => numeroDeSetlist(e, jTT, null, { 'Set A': 'a', 'Set B': 'b' })), ['a1', 'b1']);
verifier('sans table par section, rien ne change', eTT.map(e => numeroDeSetlist(e, jTT)), ['1', '1']);

const carte = (id, nomEn) => ({ _id: id, nomEn, attaques: [], impressions: [{ tirage: 'intl', expansion: 'Twilight Masquerade', numero: '115' }, ...(S.parCarte.get(id) || [])] });
const J = joindre([carte(11, 'Venipede'), carte(12, 'Pinsir')], [produit(20, 'Pinsir', '168'), produit(21, 'Pinsir', '201'), produit(22, 'Scream Tail ex', '200')], cible);
verifier('SV6s : seuls les numéros présents chez Cardmarket joignent', J.lignes.map(l => `${l.carteId}|${l.idProduct}`), ['12|20', '12|21']);
verifier('preuve « setlist+numero », jamais « set+numero »', [...new Set(J.lignes.map(l => l.preuve))], ['setlist+numero']);
verifier('Venipede n°115 hors de la plage Cardmarket : reste, pas de repli par nom', J.restes.filter(r => r.type === 'carte-sans-produit').map(r => r.carteId), [11]);

console.log(`\n${ok}/${ok + ko} ${ko ? '❌' : '✅'}`);
process.exit(ko ? 1 : 0);
