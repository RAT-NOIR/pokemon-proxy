// node test-ptcgio-sets.js — le lot PTCGIO-SETS (2026-10-17) : les sets de nos trous occidentaux que le serveur d'images prouve. Pur : aucune requête, aucune base.
// Ce que le banc garde : chaque set prouvé n'adresse que ses numéros couverts par un témoin, par ce qu'il AUTORISE ; les formes qu'il n'a pas vues (« 143a », sans numéro) restent des trous ;
// les McDonald's 2014/15/17/18 ne sont PAS des lignes (scans scrydex de 320 px pour la plupart, sous le seuil de 350 ; mcd18 numérote autrement que Cardmarket).
const P = require('./collecte-cartes/ptcgio');
let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); }
};
const carte = (id, nom) => ({ _id: id, nomEn: nom, images: [] });
const trou = (c, numeroCm, idProduct, fiche = numeroCm) => ({ carte: c, numeroCm, numeroFiche: fiche, idProduct });
const H = 'https://images.pokemontcg.io/';
const L1 = slug => P.lignesDe(slug)[0];

// Forbidden Light (sm6) : 82, 90, 122, 134, 140 ouverts à l'œil (numéro imprimé /131 et nom = nos produits)
const fli = [[82, 'Dialga-GX'], [90, 'Xerneas-GX'], [122, 'Lucario-GX'], [134, 'Naganadel-GX'], [140, 'Ultra Necrozma-GX']];
verifier('Forbidden Light : prouvé, les 5 numéros ouverts sont adressés', [P.verdictDuSet('Forbidden-Light').verdict, P.planifierPtcgio({ slug: 'Forbidden-Light', trous: fli.map(([n, nom], i) => trou(carte(10 + i, nom), String(n), 100 + i)) }).plan.map(p => p.url)],
    ['prouve', fli.map(([n]) => `${H}sm6/${n}_hires.png`)]);
verifier('Forbidden Light : un numéro non ouvert (83), une alternative (112a) et un produit sans numéro restent des trous nommés',
    P.planifierPtcgio({ slug: 'Forbidden-Light', trous: [trou(carte(30, 'Cynthia'), '83', 130), trou(carte(31, 'Metal Frying Pan'), '112a', 131, null), trou(carte(32, 'Beast Ring'), null, 132, null)] }).restes.map(r => r.motif),
    ['non-couvert-par-un-temoin', 'numero-hors-set', 'sans-numero']);
verifier('Guardians Rising : 143 adressé, 144 non couvert, 92a hors set', ['143', '144', '92a'].map(n => P.adresseDe(L1('Guardians-Rising'), n)), [143, null, null]);
verifier('Shining Legends : 76 et 77 couverts, 78 et 77a non', ['76', '77', '78', '77a'].map(n => P.adresseDe(L1('Shining-Legends'), n)), [76, 77, null, null]);
verifier('Lost Origin : TG02 adressé, TG01 non', ['TG02', 'TG01'].map(n => P.adresseDe(L1('Lost-Origin'), n)), [2, null]);
verifier('Lost Origin : l\'adresse de TG02', P.planifierPtcgio({ slug: 'Lost-Origin', trous: [trou(carte(40, 'Roserade'), 'TG02', 140)] }).plan.map(p => p.url), [`${H}swsh11tg/TG02_hires.png`]);
verifier('McDonald\'s 2014, 2015, 2017, 2018 : refusés (aucune ligne)', ['McDonalds-Collection-2014', 'McDonalds-Collection-2015', 'McDonalds-Collection-2017', 'McDonalds-Collection-2018'].map(s => P.verdictDuSet(s).verdict), ['non-apparie', 'non-apparie', 'non-apparie', 'non-apparie']);
verifier('scrydex : seuls me55c, clb, clv, clc sont autorisés, et chacun a sa ligne ACTIVE (date de lecture) — un serveur autorisé sans ligne ne s\'adresse à rien', [[...P.SETS_SCRYDEX], P.TABLE_PTCGIO.filter(l => l.hote && P.ligneActive(l)).map(l => l.idServeur)], [['me55c', 'clb', 'clv', 'clc'], ['me55c', 'clb', 'clv', 'clc']]);
console.log(`\n${ok} passés, ${ko} en échec`);
process.exit(ko ? 1 : 0);
