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

// 5. Un produit Cardmarket porte un préfixe : on ne retire rien (l'hypothèse « Cardmarket sans préfixe » tombe).
const JMX = joindre([carte(80, 'Eevee', SW, 'intl', 'SWSH042'), carte(81, 'Zacian', SW, 'intl', 'SWSH018')], [produit(90, 'Eevee', '042'), produit(91, 'Zacian', 'SWSH018')], { idExpansion: 2916, expansionBulba: SW, tirage: 'intl' });
verifier('un numéro Cardmarket préfixé : pas de retrait', JMX.lignes.filter(l => l.preuve === 'set+numero').map(l => `${l.carteId}|${l.idProduct}`), ['81|91']);

// 6. V-UNION : « SWSH215 (Top Left) » — la position entre parenthèses n'est pas le numéro. Sans la retirer, la carte tombait sur
// le repli par nom (nomEn « Morpeko ») et prenait les produits Morpeko ordinaires : 11 produits vers plusieurs cartes au rejeu.
const cVU = [carte(100, 'Morpeko', SW, 'intl', 'SWSH215 (Top Left)', 'SWSH216 (Top Right)'), carte(101, 'Morpeko', SW, 'intl', 'SWSH012')];
const pVU = [produit(110, 'Morpeko V-UNION', '215'), produit(111, 'Morpeko V-UNION', '216'), produit(112, 'Morpeko', '012')];
const JVU = joindre(cVU, pVU, { idExpansion: 2916, expansionBulba: SW, tirage: 'intl' });
verifier('V-UNION : la position est retirée, chaque pièce joint son numéro', paires(JVU), ['100|110', '100|111', '101|112']);
verifier('V-UNION : aucun produit vers plusieurs cartes', multi(JVU), 0);

console.log(`\n${ok}/${ok + ko} ${ko ? '❌' : '✅'}`);
process.exit(ko ? 1 : 0);
