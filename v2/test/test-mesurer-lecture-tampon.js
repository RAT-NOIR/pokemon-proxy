'use strict';
// F1-TAMPON — les fonctions PURES de la mesure (nature d'un cas, bilan par banc). La mesure elle-même appelle un modèle payant : elle ne se lance jamais d'un banc.
const H = require('./_harnais');
const M = require('../mesures/mesurer-lecture-tampon');

const paires = [{ special: 12, normale: 11 }, { special: 22, normale: 21 }];
H.v('1. natureDuCas : la version Staff, la normale, ou une autre carte', [M.natureDuCas(12, paires), M.natureDuCas(11, paires), M.natureDuCas(99, paires)], ['staff', 'normale', 'autre']);
H.v('2. memeEnsemble : l\'ordre ne compte pas, la taille si', [M.memeEnsemble([1, 2], [2, 1]), M.memeEnsemble([1, 2], [1, 2, 3]), M.memeEnsemble(null, [1])], [true, false, false]);
const c = (nature, lecture, declenchable = true) => ({ nature, lecture, declenchable });
const b = M.bilanDe([c('staff', 'oui'), c('staff', 'oui'), c('staff', 'oui', false), c('staff', 'non'), c('staff', 'desaccord'), c('staff', 'echec'), c('normale', 'oui'), c('normale', 'non'), c('autre', 'oui', false), c('autre', 'incertain')]);
H.v('3. bilanDe : 2 sûrs gagnés (le 3e « oui » n\'était pas la paire), 1 lu hors question, 1 non, 1 désaccord, 1 échec', [b.staff, b.surs, b.stafLusHorsQuestion, b.staffNon, b.staffIncertains, b.staffEchecs], [6, 2, 1, 1, 1, 1]);
H.v('   les FAUX : un « oui » sur une carte sans tampon (2), dont 1 qui affirmerait un produit Staff (la normale, question = la paire) ; 1 incertain sans tampon', [b.faux, b.fauxQuiAffirmeraient, b.incertainsSansTampon, b.normales, b.autres], [2, 1, 1, 2, 2]);
H.v('4. un banc vide : des zéros, jamais une erreur', Object.values(M.bilanDe([])).every(x => x === 0), true);
H.v('5. le modèle de la mesure est celui de la mesure TEMPS-CHAINE', M.MODELE, 'google/gemini-3-flash-preview');
H.bilan();
