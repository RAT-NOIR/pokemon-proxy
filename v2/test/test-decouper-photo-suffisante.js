'use strict';
// Le découpage « la photo suffit-elle à un expert ? » : deux chiffres, toutes les lignes et seulement les « oui ». Fonction pure, sans fichier ni base.
const H = require('./_harnais');
const { decouper, chiffrer } = require('../mesures/decouper-photo-suffisante');

const L = (rang, verite) => ({ rang, verite });
const lignes = [
    L(1, { idProduct: 10, photoSuffisante: true }),
    L(2, { idProduct: 11, photoSuffisante: false }),
    L(3, { idProduct: 12, photoSuffisante: true }),
    L(4, { idProduct: 13 }),                                                             // verdict sans réponse (saisi avant la case)
    L(5, null),                                                                          // pas de verdict
    L(6, { cartes: [{ carte: 0, idProduct: 20, photoSuffisante: true }, { carte: 1, idProduct: 21, photoSuffisante: false }] })
];
const d = decouper(lignes);
H.v('1. toutes : tous les verdicts (carte par carte), pas les lignes sans verdict', d.toutes.map(u => u.verite.idProduct), [10, 11, 12, 13, 20, 21]);
H.v('1. oui : seulement les « oui » (jamais un « non » ni une absence)', d.oui.map(u => u.verite.idProduct), [10, 12, 20]);
H.v('1. non et sans réponse sont comptés à part, pour que 3 + 2 + 1 = 6', [d.oui.length, d.non.length, d.sansReponse.length], [3, 2, 1]);
H.v('1. un « photoSuffisante » qui n\'est pas un booléen (« oui », 1) ne vaut pas oui', decouper([L(1, { photoSuffisante: 'oui' }), L(2, { photoSuffisante: 1 })]).oui.length, 0);
H.v('1. entrée vide ou absente : trois listes vides, sans exception', [decouper([]).toutes.length, decouper(undefined).toutes.length], [0, 0]);

const juste = u => u.verite.idProduct % 2 === 0;                                         // 10, 12, 20 justes ; 11, 13, 21 faux
const c = chiffrer(lignes, juste);
H.v('2. deux chiffres : toutes (3/6) et oui (3/3), avec leur dénominateur', [c.toutes, c.oui], [{ n: 6, justes: 3 }, { n: 3, justes: 3 }]);
H.v('2. le dénominateur « oui » est imprimé même à zéro (aucun taux inventé)', chiffrer([L(1, { idProduct: 11, photoSuffisante: false })], juste).oui, { n: 0, justes: 0 });
H.bilan();
process.exit(process.exitCode || 0);
