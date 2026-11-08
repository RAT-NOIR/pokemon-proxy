'use strict';
// LIEN-ORDINATEUR : le jeu de mutations (v2/mesures/mutations-lien-ordinateur.js) reste rejouable — chaque ancre existe EXACTEMENT UNE fois dans le code actuel, et chaque garde de la route a son mutant.
// Le rejeu lui-même (long : un banc par mutant) se lance à la main et n'est pas dans le verrou.
const H = require('./_harnais'); const M = require('../mesures/mutations-lien-ordinateur');
H.v('aucune ancre cassée (le jeu n\'a pas pourri)', M.ancresCassees(), []);
const noms = M.MUTANTS.map(m => m[0]);
H.vrai(`le jeu compte ${noms.length} mutants (au moins 30)`, noms.length >= 30);
H.v('aucun nom en double', noms.filter((x, i) => noms.indexOf(x) !== i), []);
for (const garde of ['Turnstile', 'origine', 'limite par IP', 'no-store', 'marque', 'plafond', 'SHA-256', 'boîte', '48 h', 'CORS', 'drapeau', 'jetable', 'invalide'])
    H.vrai(`une garde a son mutant : ${garde}`, noms.some(x => x.toLowerCase().includes(garde.toLowerCase())));
H.bilan();
