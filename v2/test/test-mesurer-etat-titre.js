'use strict';
// ETAT-TITRE — les fonctions pures de la mesure (v2/mesures/mesurer-etat-titre.js) : l'écart en crans, le bilan d'accord et son dénominateur, la porte de confiance, les centiles. Aucun réseau.
const H = require('./_harnais');
const M = require('../mesures/mesurer-etat-titre');

H.v('1. ecart : même état = 0, voisins = 1, NM contre PL = 4, MT contre PO = 6', [M.ecart('NM', 'NM'), M.ecart('NM', 'EX'), M.ecart('PL', 'NM'), M.ecart('MT', 'PO')], [0, 1, 4, 6]);
H.v('1. ecart : minuscules acceptées ; null, vide ou hors barème : null (jamais 0, qui dirait « même état »)', [M.ecart('nm', 'NM'), M.ecart(null, 'NM'), M.ecart('NM', undefined), M.ecart('', ''), M.ecart('Mint', 'NM')], [0, null, null, null, null]);

const b = M.bilanAccord([
    { a: 'NM', b: 'NM' }, { a: 'EX', b: 'EX' },          // même état ×2
    { a: 'NM', b: 'EX' },                                 // un cran, l'appel séparé juge PLUS ABÎMÉ (dessous)
    { a: 'GD', b: 'EX' },                                 // un cran, plus beau (dessus)
    { a: 'NM', b: 'LP' },                                 // trois crans (dessous)
    { a: 'EX', b: null },                                 // aujourd'hui seul
    { a: null, b: 'GD' },                                 // appel séparé seul
    { a: null, b: null }                                  // aucun des deux
]);
H.v('2. bilanAccord : les comptes et leur dénominateur (8 paires)', b, { paires: 8, lusTousDeux: 5, memeEtat: 2, unCran: 2, deuxCransOuPlus: 1, dessous: 2, dessus: 1, aujourdhuiSeulLu: 1, separeSeulLu: 1, aucunDesDeux: 1, plusGrandEcart: 3 });
H.v('2. bilanAccord : la somme des quatre issues vaut le nombre de paires (rien ne sort du dénominateur)', b.lusTousDeux + b.aujourdhuiSeulLu + b.separeSeulLu + b.aucunDesDeux, b.paires);
H.v('2. bilanAccord : vide', M.bilanAccord([]), { paires: 0, lusTousDeux: 0, memeEtat: 0, unCran: 0, deuxCransOuPlus: 0, dessous: 0, dessus: 0, aujourdhuiSeulLu: 0, separeSeulLu: 0, aucunDesDeux: 0, plusGrandEcart: 0 });

H.v('3. retenu : la porte de confiance de la production (haute ou moyenne), sinon null ; un état hors barème : null', [M.retenu('NM', 'haute'), M.retenu('ex', 'moyenne'), M.retenu('EX', 'basse'), M.retenu('EX', null), M.retenu('Mint', 'haute'), M.retenu(null, 'haute')], ['NM', 'EX', null, null, null, null]);

H.v('5. efficace : le plus abîmé des deux, jamais plus beau ; sans second, l\'état unique', [M.efficace('NM', 'LP'), M.efficace('EX', 'NM'), M.efficace('EX', null), M.efficace('EX', 'MINT')], ['LP', 'EX', 'EX', 'EX']);
H.v('5. retenu avec second état : la porte de confiance d\'abord (basse → null), puis le plus abîmé', [M.retenu('NM', 'haute', 'LP'), M.retenu('NM', 'basse', 'LP'), M.retenu('EX', 'moyenne', 'NM')], ['LP', null, 'EX']);
H.v('5. sens : moins abîmée (l\'appel juge MEILLEUR que la référence), plus abîmée, biais = moins − plus', M.sens([{ a: 'GD', b: 'EX' }, { a: 'GD', b: 'NM' }, { a: 'EX', b: 'GD' }, { a: 'EX', b: 'EX' }]), { moins: 2, plus: 1, biais: 1 });

const v = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
H.v('4. centiles : p50 = 50, p95 = 100, les valeurs non finies sont ignorées, vide = null', [M.pct(v, 0.5), M.pct(v, 0.95), M.pct([null, NaN, 5], 0.5), M.pct([], 0.5)], [50, 100, 5, null]);
H.v('4. moyenne : les valeurs non finies sont ignorées, vide = null', [M.moy([1, 2, null, 3]), M.moy([])], [2, null]);
H.bilan();
