// Banc de lecture-de-secours.js — node test-lecture-de-secours.js (sort 1 au premier échec)
const { classerPanneIA, panneDansLeCorps, lectureDuTitre } = require('./lecture-de-secours');
let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => { const a = JSON.stringify(obtenu), b = JSON.stringify(attendu); if (a === b) ok++; else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); } };
// la panne du SERVICE, et ce qui n'en est pas une
verifier('402 = crédit', classerPanneIA({ response: { status: 402 } }), 'credit');
verifier('429 = quota', classerPanneIA({ response: { status: 429 } }), 'quota');
verifier('401 = clé', classerPanneIA({ response: { status: 401 } }), 'cle');
verifier('503 = serveur', classerPanneIA({ response: { status: 503 } }), 'serveur');
verifier('délai dépassé = réseau', classerPanneIA({ code: 'ECONNABORTED', message: 'timeout of 30000ms exceeded' }), 'reseau');
verifier('ENOTFOUND = réseau', classerPanneIA({ code: 'ENOTFOUND' }), 'reseau');
verifier('400 n\'est PAS une panne', classerPanneIA({ response: { status: 400 } }), null);
verifier('JSON illisible n\'est PAS une panne', classerPanneIA(new SyntaxError('Unexpected token')), null);
verifier('403 (modération) n\'est PAS une panne de clé', classerPanneIA({ response: { status: 403 } }), null);
verifier('200 au corps d\'erreur 402 = crédit', panneDansLeCorps({ error: { code: 402, message: 'Insufficient credits' } }), 'credit');
verifier('200 au corps d\'erreur 502 = serveur', panneDansLeCorps({ error: { code: 502 } }), 'serveur');
verifier('200 normal : pas de panne', panneDansLeCorps({ choices: [{ message: { content: '{}' } }] }), null);
// le titre
const L = t => { const r = lectureDuTitre(t); return r && [r.name, r.number, r.total, r.language]; };
verifier('X/Y simple', L('Carte Pokémon Dracaufeu 4/102 Set de Base'), ['Dracaufeu', '4', '102', 'EN']);
verifier('nom long', L('Combat Final de Gladio Alt Dresseur 118/084'), ['Combat Final de Gladio Alt Dresseur', '118', '084', 'EN']);
verifier('code après', L('Roaring Moon ex 262/182 PAR'), ['Roaring Moon ex', '262', '182', 'EN']);
verifier('galerie', L('Pikachu TG05/TG30'), ['Pikachu', 'TG05', 'TG30', 'EN']);
verifier('promo collée', L('Lugia V SWSH186 promo'), ['Lugia V', 'SWSH186', null, 'EN']);
verifier('promo espacée', L('Pikachu SVP 049'), ['Pikachu', 'SVP049', null, 'EN']);
verifier('promo japonaise', L('Carte pokemon japonaise Pikachu 001/SM-P'), ['Pikachu', '001', 'SM-P', 'JP']);
// relecture du 2026-10-05 : les notes et les mots d'état ne sont ni un numéro ni un nom
verifier('note 10/10', L('Dracaufeu 10/10 mint'), null);
verifier('état 9/10', L('Pikachu état 9/10'), null);
verifier('une note PSA devant un vrai numéro', L('PSA 10 Pikachu 58/102'), ['Pikachu', '58', '102', 'EN']);
verifier('PSA après le nom, promo', L('Pikachu PSA 10 SM 12'), ['Pikachu', 'SM12', null, 'EN']);
verifier('une année dans le nom', L('Pikachu 2023 25/165'), ['Pikachu', '25', '165', 'EN']);
verifier('une année n\'est pas un numéro', L('Carte Pokémon Dracaufeu 1999 Set de Base'), null);
verifier('un prix ou une note PSA non plus', L('Dracaufeu PSA 9 150€'), null);
verifier('sans nom', L('4/102'), null);
verifier('vide', L(''), null);
verifier('absent', L(undefined), null);
verifier('lot', L('Lot de 10 cartes pokémon'), null);
const r = lectureDuTitre('Mew ex 151/165 FR');
verifier('forme d\'une réponse IA, confiance basse, marquée', [r.nomConfiance, r.lectureDeSecours, r.symboleSet, r.motif, r.nomBrut], ['basse', true, 'illisible', 'indetermine', null]);
console.log(`${ko ? '🔴' : '✅'} lecture-de-secours : ${ok}/${ok + ko}`);
process.exit(ko ? 1 : 0);
