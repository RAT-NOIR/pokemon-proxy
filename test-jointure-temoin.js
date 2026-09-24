// node test-jointure-temoin.js — le témoin du NOM dans la jointure par le NUMÉRO (2026-09-23).
// « 0 ambigu ne veut pas dire 0 faux » : une clé sans doublon peut désigner la MAUVAISE carte. Le nom n'entre pas dans la
// clé par le numéro, c'est ce qui en fait un témoin. `temoin-nom.js` l'a rejoué APRÈS coup et détaché 62 fiches fausses ;
// tant qu'il n'était pas DANS `joindre()`, la prochaine collecte les recréait. Cas réels :
//   · EX Battle Boost : « White Kyurem EX » joint par le numéro à Black Kyurem-EX, et l'inverse ;
//   · EC1 n°059 : Energy Restore et Pokémon Reversal portent le même numéro sur la page du set (§24) ;
//   · SV-P chinois : « Ninetales » joint par le numéro à Murkrow.
const { joindre } = require('./collecte-cartes/jointure');

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); }
};
const carte = (id, nomEn, expansion, tirage, ...numeros) => ({ _id: id, nomEn, attaques: [], impressions: numeros.map(numero => ({ tirage, expansion, numero })) });
const produit = (idProduct, nom, numero) => ({ idProduct, name: nom, nom, attaques: [], numero });
const paires = J => J.lignes.map(l => `${l.carteId}|${l.idProduct}`).sort();
const contredites = J => J.restes.filter(r => r.type === 'fiche-contredite-par-le-nom').map(r => `${r.carteId}|${r.idProduct}`).sort();
const concordance = (J, produits) => produits.length === J.compte.produitsJoints + J.restes.filter(r => r.type === 'produit-sans-carte').length;

// 1. Deux numéros croisés : chaque produit porte le nom de l'AUTRE carte du set. Aucune fiche.
const BB = 'EX Battle Boost';
const cBB = [carte(1, 'White Kyurem-EX', BB, 'jp', '044'), carte(2, 'Black Kyurem-EX', BB, 'jp', '045')];
const pBB = [produit(10, 'White Kyurem EX', '045'), produit(11, 'Black Kyurem EX', '044')];
const JBB = joindre(cBB, pBB, { idExpansion: 1, expansionBulba: BB, tirage: 'jp' });
verifier('numéros croisés : aucune fiche posée', paires(JBB), []);
verifier('numéros croisés : les deux contradictions sont des restes nommés', contredites(JBB), ['1|11', '2|10']);
verifier('numéros croisés : produits = joints + restes', concordance(JBB, pBB), true);

// 2. EC1 n°059 : deux cartes portent le même numéro, deux produits aussi. Le nom départage, chaque produit va à SA carte.
const E = 'Expedition Base Set';
const cEC = [carte(20, 'Energy Restore', E, 'jp', '059'), carte(21, 'Pokémon Reversal', E, 'jp', '059')];
const pEC = [produit(30, 'Energy Restore', '059'), produit(31, 'Pokémon Reversal', '059')];
const JEC = joindre(cEC, pEC, { idExpansion: 2, expansionBulba: E, tirage: 'jp' });
verifier('EC1 : chaque produit à la carte qui porte son nom', paires(JEC), ['20|30', '21|31']);
verifier('EC1 : aucun produit vers plusieurs cartes', JEC.restes.filter(r => r.type === 'produit-vers-plusieurs-cartes').length, 0);

// 3. Un produit contredit n'est PAS repris par le repli par nom : le numéro et le nom se contredisent, personne ne le prend.
const cRN = [carte(40, 'Murkrow', 'SV-P', 'zh-hans', '012'), { _id: 41, nomEn: 'Ninetales', attaques: [], impressions: [] }];
const pRN = [produit(50, 'Ninetales', '012')];
const JRN = joindre(cRN, pRN, { idExpansion: 3, expansionBulba: 'SV-P', tirage: 'zh-hans' });
verifier('contredit : pas de fiche par le numéro, ni par le nom', paires(JRN), []);
verifier('contredit : le reste le dit', contredites(JRN), ['40|50']);

// 4. ÉCART DE FORME : le nom diffère sans être celui d'une AUTRE carte du set. La fiche reste — une traduction différente
// n'est pas une fiche fausse (« Pokémon Reverse » / « Pokémon Reversal », « Mystery Plate alpha » / « α »).
const JF = joindre([carte(60, 'Pokémon Reversal', E, 'jp', '060'), carte(61, 'Bill', E, 'jp', '061')], [produit(70, 'Pokemon Reverse', '060')], { idExpansion: 2, expansionBulba: E, tirage: 'jp' });
verifier('écart de forme : la fiche reste', paires(JF), ['60|70']);
verifier('écart de forme : aucune contradiction', contredites(JF), []);

// 5. Le nom de la carte INCLUT celui d'une autre carte : « Mew » joint par le numéro à Mewtwo, dans un set qui a Mew.
// L'inclusion ne protège pas : le nom du produit EST celui d'une autre carte du set.
const JM = joindre([carte(80, 'Mewtwo', 'X', 'intl', '010'), carte(81, 'Mew', 'X', 'intl', '011')], [produit(90, 'Mew', '010'), produit(91, 'Mew', '011')], { idExpansion: 4, expansionBulba: 'X', tirage: 'intl' });
verifier('inclusion : « Mew » ne va pas à Mewtwo', paires(JM), ['81|91']);
verifier('inclusion : la contradiction est nommée', contredites(JM), ['80|90']);

// 5 bis. 🔑 LES ATTAQUES DÉPARTAGENT LE NOM ET LE NUMÉRO. Cardmarket écrit « Vulpix [Gather Snow | Gnaw] » pour Alolan
// Vulpix (SM Promos), « Drifblim [FB] » pour Drifblim FB : le nom tombe sur une AUTRE carte du set (Vulpix, Drifblim), mais
// les attaques sont celles de la carte que le numéro désigne. Deux données contre une : c'est une forme, la fiche reste.
// Premier rejeu sur la base, 2026-09-23 : 4 fiches justes de cette forme auraient été refusées sans ce départage.
// ⚠️ ET LES ATTAQUES ONT LEURS PROPRES ÉCARTS DE FORME, mesurés sur ces cas : « Gather Snow » (Cardmarket) contre
// « Snow Gather » (Bulbapedia) ; « Pump Up », « Sand Armor » sont des Poké-Power/Poké-Body que Cardmarket met entre les
// crochets et que Bulbapedia ne range pas dans `attaques`. La règle est donc COMPARATIVE : les attaques du produit doivent
// désigner la carte du numéro PLUS que chacune des cartes du nom — mots comparés sans leur ordre.
const att = (id, nomEn, n, attaques) => ({ ...carte(id, nomEn, 'SM', 'intl', n), attaques: attaques.map(nom => ({ nom })) });
const pAtt = (idProduct, nom, numero, attaques) => ({ ...produit(idProduct, nom, numero), attaques });
const JA = joindre([att(140, 'Alolan Vulpix', '147', ['Snow Gather', 'Gnaw']), att(141, 'Vulpix', '146', ['Gather Fallen Leaves', 'Gnaw'])],
    [pAtt(150, 'Vulpix', '147', ['Gather Snow', 'Gnaw']), pAtt(152, 'Vulpix', '146', ['Gather Fallen Leaves', 'Gnaw'])], { idExpansion: 5, expansionBulba: 'SM', tirage: 'intl' });
verifier('Alolan Vulpix : « Gather Snow » = « Snow Gather », la fiche reste', paires(JA), ['140|150', '141|152']);
verifier('Alolan Vulpix : aucune contradiction', contredites(JA), []);
const JD = joindre([att(180, 'Drifblim FB', '3', ['Shadow Ball']), att(181, 'Drifblim', '57', ['Ram', 'Gust'])],
    [pAtt(190, 'Drifblim', '3', ['Pump Up', 'Shadow Ball'])], { idExpansion: 6, expansionBulba: 'SM', tirage: 'intl' });
verifier('Drifblim [FB] : le Poké-Power en plus ne fait pas tomber la fiche', paires(JD), ['180|190']);
// Égalité : les attaques désignent AUTANT la carte du nom — elles ne départagent rien, le nom contredit toujours.
const JE = joindre([att(200, 'Raichu', '10', ['Gnaw']), att(201, 'Pikachu', '11', ['Gnaw'])],
    [pAtt(210, 'Pikachu', '10', ['Gnaw'])], { idExpansion: 7, expansionBulba: 'SM', tirage: 'intl' });
verifier('attaques à égalité : le nom contredit toujours', [paires(JE), contredites(JE)], [[], ['200|210']]);
const JA2 = joindre([att(160, 'Pineco', '061', ['Ram']), att(161, 'Eevee', '062', ['Call for Family', 'Tackle'])],
    [pAtt(170, 'Eevee', '061', ['Call for Family', 'Tackle'])], { idExpansion: 5, expansionBulba: 'SM', tirage: 'intl' });
verifier('« Eevee [Call for Family | Tackle] » par le numéro sur Pineco : refusée', [paires(JA2), contredites(JA2)], [[], ['160|170']]);

// 6. Les écritures normales ne bougent pas : Basic, LV.X, alias de sexe.
const JN = joindre([
    { _id: 100, nomEn: 'Basic Fire Energy', attaques: [], impressions: [{ tirage: 'jp', expansion: E, numero: '100' }] },
    { _id: 101, nomEn: 'Magmortar', niveau: 'X', attaques: [], impressions: [{ tirage: 'jp', expansion: E, numero: '101' }] },
    { _id: 102, nomEn: 'Nidoran♂', attaques: [], impressions: [{ tirage: 'jp', expansion: E, numero: '102' }] }
], [produit(110, 'Fire Energy', '100'), produit(111, 'Magmortar LV.X', '101'), produit(112, 'Nidoran♂', '102')], { idExpansion: 2, expansionBulba: E, tirage: 'jp' });
verifier('écritures normales : les trois fiches restent', paires(JN), ['100|110', '101|111', '102|112']);

// 7. La carte sans nom n'est PAS une carte (2026-09-24) : les 6 documents sans nomEn de la base sont 4 pages d'homonymie
// ({{tcgdisambig}} : Clefairy M-P 60, Pikachu SV-P 1 et 120, Eevee S-P 23) et 2 ébauches d'Énergie. Le témoin s'y tait, et
// le numéro de la Setlist y posait 5 fiches (Clefairy TH/ID, Pikachu ID ×2, Eevee CS) sur des pages que le site n'affiche
// jamais. Le cas disait jusqu'ici « le numéro seul décide » ; il dit désormais : aucune fiche, un reste nommé.
const JS = joindre([{ _id: 120, nomEn: null, attaques: [], impressions: [{ tirage: 'jp', expansion: E, numero: '120' }] }, carte(121, 'Bill', E, 'jp', '121')], [produit(130, 'Bill', '120')], { idExpansion: 2, expansionBulba: E, tirage: 'jp' });
verifier('carte sans nom : aucune fiche', paires(JS), []);
verifier('carte sans nom : un reste qui la nomme, et le produit reste sans carte', JS.restes.map(r => `${r.type}|${r.carteId ?? r.idProduct}`).sort(), ['carte-sans-nom|120', 'carte-sans-produit|121', 'produit-sans-carte|130']);
verifier('carte sans nom : produits = joints + restes', concordance(JS, [produit(130, 'Bill', '120')]), true);

console.log(`\n${ok}/${ok + ko} ${ko ? '❌' : '✅'}`);
process.exit(ko ? 1 : 0);
