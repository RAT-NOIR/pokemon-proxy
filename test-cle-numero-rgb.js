// node test-cle-numero-rgb.js — la clé de numéro « R/RGB » (Mew rouge/vert/bleu du 30th Celebration, 909509-909511).
// Cardmarket écrit « R/RGB », « G/RGB », « B/RGB » ; la carte (358696) porte les impressions « R », « G », « B ». LIMITÉE à cette forme exacte : tout le reste
// de la clé est inchangé (mesuré sur toute la base : simulation POP2, 0 autre valeur modifiée).
const { cleNumero, joindre } = require('./collecte-cartes/jointure');
let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); }
};
verifier('R/RGB -> R, G/RGB -> G, B/RGB -> B', ['R/RGB', 'G/RGB', 'B/RGB'].map(cleNumero), ['R', 'G', 'B']);
verifier('minuscules et espaces : même clé', [' r/rgb ', 'g/Rgb'].map(cleNumero), ['R', 'G']);
verifier('les impressions R, G, B sont déjà leur propre clé', ['R', 'G', 'B'].map(cleNumero), ['R', 'G', 'B']);
verifier('une autre lettre avant /RGB n\'est PAS normalisée (forme limitée)', ['X/RGB', 'RG/RGB', 'R/RGBX', '1/RGB'].map(cleNumero), ['X/RGB', 'RG/RGB', 'R/RGBX', '1/RGB']);
verifier('les clés ordinaires ne bougent pas', ['063', '63', 'SWSH002', 'TG01', '001N', 'S04', '', null, '098/091', 'A053'].map(cleNumero), ['63', '63', 'SWSH2', 'TG1', '1N', 'S4', null, null, '098/091', 'A53']);

const E = '30th Celebration';
const carte = { _id: 358696, nomEn: 'Mew', attaques: [{ nom: 'Psychic' }], impressions: ['R', 'G', 'B'].map(numero => ({ tirage: 'intl', expansion: E, numero })) };
const produit = (idProduct, numero) => ({ idProduct, name: 'Mew [Psychic | 30C]', nom: 'Mew', attaques: ['Psychic', '30C'], numero });
const J = joindre([carte], [produit(909509, 'R/RGB'), produit(909510, 'G/RGB'), produit(909511, 'B/RGB')], { idExpansion: 6601, expansionBulba: E, tirage: 'intl' });
verifier('jointure : les trois Mew joignent la carte par leur lettre (set+numero)', [J.lignes.map(l => `${l.carteId}|${l.idProduct}|${l.preuve}`).sort(), J.restes.length], [['358696|909509|set+numero', '358696|909510|set+numero', '358696|909511|set+numero'], 0]);
console.log(`\n${ok} passés, ${ko} en échec`);
process.exitCode = ko ? 1 : 0;
