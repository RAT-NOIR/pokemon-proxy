'use strict';
// Banc de collecte-cartes/popularite.js : le substitut de popularité validé par le testeur (25/10). Fonctions pures, aucune base.
//   offre en cours (low / lowHolo non nul) > activité (avg1 > avg7 > avg30 > aucune) > trend décroissant > idProduct croissant ; un produit absent du guide passe après « aucune activité ».
const P = require('./collecte-cartes/popularite');

let ok = 0, ko = 0;
function v(nom, obtenu, attendu) {
    const bon = JSON.stringify(obtenu) === JSON.stringify(attendu);
    console.log(`${bon ? 'OK ' : 'KO '} ${nom} : ${JSON.stringify(obtenu)}${bon ? '' : ` (attendu ${JSON.stringify(attendu)})`}`);
    bon ? ok++ : ko++;
}

// popDe : la lecture d'une ligne du guide
v('popDe : produit absent du guide', P.popDe(undefined), { auGuide: false, offres: false, activite: -1, trend: 0 });
v('popDe : low non nul = offre', P.popDe({ low: 0.2 }).offres, true);
v('popDe : lowHolo seul = offre', P.popDe({ lowHolo: 1.5 }).offres, true);
v('popDe : low et lowHolo nuls = pas d\'offre', P.popDe({ low: null, lowHolo: null, avg1: 3 }).offres, false);
v('popDe : champs absents (undefined) = pas d\'offre', P.popDe({ avg1: 3 }).offres, false);
v('popDe : activité avg1 = 3', P.popDe({ avg1: 1 }).activite, 3);
v('popDe : activité avg7 = 2', P.popDe({ avg7: 1 }).activite, 2);
v('popDe : activité avg30 = 1', P.popDe({ avg30: 1 }).activite, 1);
v('popDe : au guide mais sans aucune activité = 0', P.popDe({ low: 1 }).activite, 0);
v('popDe : avg1 passe devant avg7', P.popDe({ avg1: 1, avg7: 1, avg30: 1 }).activite, 3);
v('popDe : trend absent = 0', P.popDe({ avg1: 1 }).trend, 0);
v('popDe : trend numérique conservé', P.popDe({ trend: -2.5 }).trend, -2.5);
v('popDe : auGuide vrai pour une ligne', P.popDe({}).auGuide, true);

// l'ORDRE COMPLET
const g = (idProduct, ligne) => ({ idProduct, pop: P.popDe(ligne) });
const lot = [
    g(10, undefined),                                   // absent du guide
    g(11, { avg30: 1 }),                                // activité 1, sans offre
    g(12, { avg1: 1 }),                                 // activité 3, sans offre
    g(13, { low: 1 }),                                  // offre, aucune activité
    g(14, { low: 1, avg7: 1 }),                         // offre, activité 2
    g(15, { low: 1, avg1: 1, trend: 1 }),               // offre, activité 3, trend 1
    g(16, { lowHolo: 2, avg1: 1, trend: 5 }),           // offre (holo), activité 3, trend 5
    g(17, { low: 1, avg1: 1, trend: 5 }),               // égal à 16 : l'idProduct tranche (16 avant 17)
    g(18, { avg7: 1 }),                                 // activité 2, sans offre
    g(19, { low: 1, avg1: 1, trend: -3 }),              // offre, activité 3, trend négatif
    g(9, { avg1: 1, trend: 100 })                       // sans offre : malgré le trend, derrière toute offre
];
v('ordre complet', P.trier(lot).map(x => x.idProduct), [16, 17, 15, 19, 14, 13, 9, 12, 18, 11, 10]);
v('trier : ne modifie pas le tableau reçu', (() => { const c = [...lot]; P.trier(c); return c.map(x => x.idProduct); })(), lot.map(x => x.idProduct));
v('une offre sans activité passe devant une activité sans offre', P.comparer(g(13, { low: 1 }), g(12, { avg1: 1 })) < 0, true);
v('comparer : égalité parfaite = idProduct croissant', P.comparer(g(1, { low: 1 }), g(2, { low: 1 })) < 0, true);
v('comparer : le même produit = 0', P.comparer(g(1, { low: 1 }), g(1, { low: 1 })), 0);
v('absent du guide derrière « au guide sans activité »', P.comparer(g(2, { }), g(1, undefined)) < 0, true);

console.log(`\n${ok} réussis, ${ko} échoués`);
process.exit(ko ? 1 : 0);
