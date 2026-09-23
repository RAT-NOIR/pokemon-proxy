// node test-jointure-prefixe.js — le préfixe de numéro d'un set de promos (SWSH002 chez Bulbapedia, 002 chez Cardmarket).
// Cas fondateur, 2026-09-15 : SWSH Black Star Promos, set+numéro en échec, repli par nom, 56 produits joints à plusieurs
// cartes (Scorbunny n°002 → SWSH002 ET SWSH244), ≥ 124 lignes fausses. Contre-cas : EC1 mêle « S04 » et « 004 » dans le
// même set, et « S04 » ne doit JAMAIS joindre la carte 004 (29 jointures fausses le 2026-09-12).
const { joindre } = require('./collecte-cartes/jointure');

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); }
};
const carte = (id, nomEn, expansion, tirage, ...numeros) => ({ _id: id, nomEn, attaques: [], impressions: numeros.map(numero => ({ tirage, expansion, numero })) });
const produit = (idProduct, nom, numero) => ({ idProduct, name: nom, nom, attaques: [], numero });
const paires = J => J.lignes.map(l => `${l.carteId}|${l.idProduct}`).sort();
const multi = J => J.restes.filter(r => r.type === 'produit-vers-plusieurs-cartes').length;

// 1. SWSH : le préfixe est commun à toutes les impressions, absent de tous les numéros Cardmarket.
const SW = 'SWSH Black Star Promos';
const cSW = [carte(1, 'Scorbunny', SW, 'intl', 'SWSH002'), carte(2, 'Scorbunny', SW, 'intl', 'SWSH244'), carte(3, 'Morpeko', SW, 'intl', 'SWSH012'), carte(4, 'Morpeko', SW, 'intl', 'SWSH056')];
const pSW = [produit(10, 'Scorbunny', '002'), produit(11, 'Scorbunny', '244'), produit(12, 'Morpeko', '012'), produit(13, 'Morpeko', '056')];
const JSW = joindre(cSW, pSW, { idExpansion: 2916, expansionBulba: SW, tirage: 'intl' });
verifier('SWSH : chaque carte joint SON produit par le numéro', paires(JSW), ['1|10', '2|11', '3|12', '4|13']);
verifier('SWSH : aucun produit vers plusieurs cartes', multi(JSW), 0);
verifier('SWSH : preuve set+numero partout', [...new Set(JSW.lignes.map(l => l.preuve))], ['set+numero']);
verifier('SWSH : le détail nomme le préfixe retiré', /préfixe « SWSH »/.test(JSW.lignes[0]?.detail || ''), true);

// 2. EC1 : « S04 » et « 004 » dans le même set — préfixe NON commun, rien n'est retiré.
const E = 'Expedition Base Set';
const cEC = [carte(20, 'Ekans', E, 'jp', '004'), carte(21, 'Venusaur', E, 'jp', 'S04')];
const pEC = [produit(30, 'Ekans', '004'), produit(31, 'Venusaur', 'S04')];
const JEC = joindre(cEC, pEC, { idExpansion: 1, expansionBulba: E, tirage: 'jp' });
verifier('EC1 : S04 et 004 restent distincts', paires(JEC), ['20|30', '21|31']);
verifier('EC1 : aucun préfixe nommé', JEC.lignes.some(l => /préfixe/.test(l.detail)), false);

// 3. Cardmarket porte AUSSI le préfixe (TG01 des deux côtés) : jointure normale, rien retiré.
const T = 'Trainer Gallery';
const JTG = joindre([carte(40, 'Pikachu', T, 'intl', 'TG01')], [produit(50, 'Pikachu', 'TG01')], { idExpansion: 2, expansionBulba: T, tirage: 'intl' });
verifier('préfixe des deux côtés : joint, sans retrait nommé', [paires(JTG), JTG.lignes.some(l => /préfixe/.test(l.detail))], [['40|50'], false]);

// 4. Une seule impression sans le préfixe : le préfixe n'est plus commun, rien retiré (la carte 004 ne prend pas SM04).
const S = 'SM Black Star Promos';
const cSM = [carte(60, 'Rowlet', S, 'intl', 'SM01'), carte(61, 'Litten', S, 'intl', 'SM02'), carte(62, 'Pikachu', S, 'intl', '004')];
const pSM = [produit(70, 'Rowlet', '001'), produit(71, 'Litten', '002'), produit(72, 'Pikachu', '004')];
const JSM = joindre(cSM, pSM, { idExpansion: 3, expansionBulba: S, tirage: 'intl' });
verifier('préfixe non commun : seules les correspondances exactes par numéro', JSM.lignes.filter(l => l.preuve === 'set+numero').map(l => `${l.carteId}|${l.idProduct}`), ['62|72']);

// 5. 🔴 CARDMARKET ÉCRIT LES DEUX FORMES DANS LE MÊME SET (SM Black Star Promos, 2026-09-16) : 305 numéros nus et
// 5 préfixés (« SM240 » à côté de « 240 », deux produits de la MÊME carte). L'exigence « aucun numéro Cardmarket n'a le
// préfixe » désactivait le retrait pour tout le set : 3 jointures sur 310. L'impression est donc indexée sous ses DEUX
// écritures, et chaque produit joint la sienne. Un produit ne peut toujours aller qu'à UNE carte : deux produits pour une
// carte est le cas normal des variantes.
const JMX = joindre([carte(80, 'Eevee', SW, 'intl', 'SWSH042'), carte(81, 'Zacian', SW, 'intl', 'SWSH018')], [produit(90, 'Eevee', '042'), produit(91, 'Zacian', 'SWSH018'), produit(92, 'Zacian', '018')], { idExpansion: 2916, expansionBulba: SW, tirage: 'intl' });
verifier('les deux écritures dans le même set : chacune joint sa carte', paires(JMX), ['80|90', '81|91', '81|92']);
verifier('les deux écritures : aucun produit vers plusieurs cartes', multi(JMX), 0);

// 5 bis. SVP Black Star Promos (2026-09-16) : une carte SANS impression du set (appartenance par la Setlist seule) ne doit
// pas prendre par son NOM un produit DÉJÀ joint par son numéro à une autre carte — 7 produits vers plusieurs cartes,
// garde déclenchée. Le repli par nom ne vise que des produits encore libres.
const SVP = 'SVP Black Star Promos';
// ⚠️ Koraidon DÉCLARE l'impression sans numéro (« set+nom ») : depuis la coupure de « setlist+nom » (2026-09-19,
// jointure.js), une carte sans AUCUNE impression ne joint plus par son nom. Ce test échouait sur HEAD depuis ce jour-là.
const cSVP = [carte(200, 'Miraidon', SVP, 'intl', '013'), { _id: 201, nomEn: 'Miraidon', attaques: [], impressions: [] }, carte(202, 'Koraidon', SVP, 'intl', null)];
const pSVP = [produit(210, 'Miraidon', '013'), produit(211, 'Koraidon', null)];
const JSVP = joindre(cSVP, pSVP, { idExpansion: 5241, expansionBulba: SVP, tirage: 'intl' });
verifier('SVP : le produit déjà joint par son numéro n’est pas repris par un nom', paires(JSVP), ['200|210', '202|211']);
verifier('SVP : aucun produit vers plusieurs cartes', multi(JSVP), 0);
verifier('SVP : la carte sans impression et sans produit libre est un reste', JSVP.restes.filter(r => r.type === 'carte-sans-produit').map(r => r.carteId), [201]);

// 6. V-UNION : « SWSH215 (Top Left) » — la position entre parenthèses n'est pas le numéro. Sans la retirer, la carte tombait sur
// le repli par nom (nomEn « Morpeko ») et prenait les produits Morpeko ordinaires : 11 produits vers plusieurs cartes au rejeu.
const cVU = [carte(100, 'Morpeko', SW, 'intl', 'SWSH215 (Top Left)', 'SWSH216 (Top Right)'), carte(101, 'Morpeko', SW, 'intl', 'SWSH012')];
const pVU = [produit(110, 'Morpeko V-UNION', '215'), produit(111, 'Morpeko V-UNION', '216'), produit(112, 'Morpeko', '012')];
const JVU = joindre(cVU, pVU, { idExpansion: 2916, expansionBulba: SW, tirage: 'intl' });
verifier('V-UNION : la position est retirée, chaque pièce joint son numéro', paires(JVU), ['100|110', '100|111', '101|112']);
verifier('V-UNION : aucun produit vers plusieurs cartes', multi(JVU), 0);

// 7. SOUS-ENSEMBLE numéroté (xsv8a « Additionals ») : Cardmarket n'a que certains numéros. Leafeon n°003 n'a pas de produit
// n°003 : il ne doit PAS prendre par son nom les produits de Leafeon n°002 (36 produits vers plusieurs cartes au premier passage).
const TF = 'Terastal Fest ex';
const cTF = [carte(120, 'Leafeon', TF, 'jp', '002'), carte(121, 'Leafeon', TF, 'jp', '003', '200'), carte(122, 'Sinistcha', TF, 'jp', '018')];
const pTF = [produit(130, 'Leafeon', '002'), produit(131, 'Leafeon', '002'), produit(132, 'Sinistcha', '018')];
const JTF = joindre(cTF, pTF, { idExpansion: 6220, expansionBulba: TF, tirage: 'jp' });
verifier('sous-ensemble : seules les cartes au numéro présent joignent', paires(JTF), ['120|130', '120|131', '122|132']);
verifier('sous-ensemble : la carte au numéro absent est un reste, pas un repli par nom', JTF.restes.filter(r => r.type === 'carte-sans-produit').map(r => r.carteId), [121]);
// 8. Le repli par nom RESTE permis quand la carte ne déclare aucun numéro (énergies, pages sans impression) ou que le catalogue
// n'a aucun numéro (vintage japonais).
const JEN = joindre([carte(140, 'Basic Fire Energy', TF, 'jp', null)], [produit(150, 'Fire Energy', '')], { idExpansion: 7, expansionBulba: TF, tirage: 'jp' });
verifier('énergie sans numéro : repli par nom conservé', paires(JEN), ['140|150']);
// …et une énergie qui ne DÉCLARE rien n'a que son nom à offrir : « setlist+nom », coupé le 2026-09-19 (Bulbasaur-V1-BS44).
const JEN0 = joindre([{ _id: 141, nomEn: 'Basic Fire Energy', attaques: [], impressions: [] }], [produit(151, 'Fire Energy', '')], { idExpansion: 7, expansionBulba: TF, tirage: 'jp' });
verifier('énergie sans impression déclarée : « setlist+nom » coupé', paires(JEN0), []);
const JVI = joindre([carte(160, 'Pikachu', 'Base Set', 'jp', '025')], [produit(170, 'Pikachu', null)], { idExpansion: 8, expansionBulba: 'Base Set', tirage: 'jp' });
verifier('catalogue sans numéro : repli par nom conservé', paires(JVI), ['160|170']);

// 9. XY-P : une carte déclarée DANS le set mais SANS numéro (promo non numérotée) ne prend par son nom QUE des produits sans
// numéro. Greninja [jp:null] prenait Greninja n°073 (déjà à sa carte) : 8 produits vers plusieurs cartes, garde.
const XP = 'XY-P Promotional cards';
const cXP = [carte(180, 'Greninja', XP, 'jp', '073'), carte(181, 'Greninja', XP, 'jp', null), carte(182, 'M Absol-EX', XP, 'jp', null)];
const pXP = [produit(190, 'Greninja', '073'), produit(191, 'M Absol-EX', null)];
const JXP = joindre(cXP, pXP, { idExpansion: 4159, expansionBulba: XP, tirage: 'jp' });
verifier('XY-P : chaque produit à UNE carte', paires(JXP), ['180|190', '182|191']);
verifier('XY-P : Greninja sans numéro est un reste', JXP.restes.filter(r => r.type === 'carte-sans-produit').map(r => r.carteId), [181]);

// 10. 🔴 UN NOM QUI DÉSIGNE PLUSIEURS CARTES NE DÉSIGNE RIEN (2026-09-19). S-P/CS : le produit « Gengar » n°148 tombait
// sur TROIS pages Gengar appartenant au set par la Setlist seule, et les trois recevaient le même produit. Un produit est
// UNE carte : l'ambiguïté est un reste, pas trois jointures. Les attaques départagent d'abord, comme avant.
const G = 'S-P Promotional cards';
const sansNum = (id, nomEn, attaques = []) => ({ _id: id, nomEn, attaques: attaques.map(nom => ({ nom })), impressions: [] });
const JAMB = joindre([sansNum(300, 'Gengar'), sansNum(301, 'Gengar'), sansNum(302, 'Gengar')], [produit(310, 'Gengar', '148')], { idExpansion: 6329, expansionBulba: G, tirage: 'zh-hans' });
verifier('nom ambigu : aucune jointure', paires(JAMB), []);
verifier('nom ambigu : aucun produit vers plusieurs cartes', multi(JAMB), 0);
const pAtt = { idProduct: 320, name: 'Gengar', nom: 'Gengar', attaques: ['Shadow Room'], numero: '149' };
const JATT = joindre([sansNum(303, 'Gengar', ['Shadow Room']), sansNum(304, 'Gengar', ['Night Watch'])], [pAtt], { idExpansion: 6329, expansionBulba: G, tirage: 'zh-hans' });
verifier('nom ambigu départagé par les attaques : une seule jointure', paires(JATT), ['303|320']);

console.log(`\n${ok}/${ok + ko} ${ko ? '❌' : '✅'}`);
process.exit(ko ? 1 : 0);
