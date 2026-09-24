// node test-garde-nom-seul.js — la garde BIDIRECTIONNELLE d'une jointure par le NOM seul (collecte-cartes/garde-nom-seul.js) :
// une ligne n'est gardée que si son produit est le SEUL de l'expansion à porter ce nom ET sa carte la SEULE du set à le
// porter, multiplicités comptées (§34). Calibrée par rejouer-nom-seul.js : 21 925 justes, 0 faux (2026-09-24).
const { gardeNomSeul } = require('./collecte-cartes/garde-nom-seul');

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); }
};
const produits = [{ idProduct: 1, nom: 'Blastoise' }, { idProduct: 2, nom: 'Pikachu' }, { idProduct: 3, nom: 'Pikachu' }, { idProduct: 4, nom: 'Mew' }, { idProduct: 5, nom: 'Basic Grass Energy' }, { idProduct: 6, nom: 'Arceus' }, { idProduct: 7, nom: 'Lugia' }];
const cartes = [{ _id: 10, nomEn: 'Blastoise' }, { _id: 20, nomEn: 'Pikachu' }, { _id: 40, nomEn: 'Mew' }, { _id: 41, nomEn: 'Mew' }, { _id: 50, nomEn: 'Basic Grass Energy' }, { _id: 60, nomEn: 'Arceus' }, { _id: 61, nomEn: 'Arceus' }, { _id: 70, nomEn: 'Lugia' }];
const lignes = [
    { idProduct: 1, carteId: 10, preuve: 'set+nom' },                 // unique des deux côtés : gardée
    { idProduct: 2, carteId: 20, preuve: 'set+nom+attaques' },        // « Pikachu » porté par 2 produits : refusée
    { idProduct: 3, carteId: 20, preuve: 'set+nom+attaques' },
    { idProduct: 4, carteId: 40, preuve: 'set+nom' },                 // « Mew » porté par 2 cartes : refusée
    { idProduct: 5, carteId: 50, preuve: 'set+nom' },                 // « Basic » retiré des deux côtés : gardée
    { idProduct: 6, carteId: 60, preuve: 'set+numero' },              // jointure par le NUMÉRO : jamais touchée
    { idProduct: 7, carteId: 70, preuve: 'set+nom' }, { idProduct: 7, carteId: 10, preuve: 'set+nom' }   // un produit, deux cartes : refusée
];
const G = gardeNomSeul({ lignes, produits, cartes });
verifier('gardées : unique des deux côtés, « Basic » retiré, et la ligne par le numéro intacte', G.gardees.map(l => l.idProduct).sort(), [1, 5, 6]);
verifier('refusées, avec leur raison', G.refusees.map(r => [r.idProduct, r.raison]).sort((a, b) => a[0] - b[0]),
    [[2, 'nom de produit porté par 2 produits'], [3, 'nom de produit porté par 2 produits'], [4, 'nom de carte porté par 2 cartes'], [7, 'produit joint à 2 cartes']]);
verifier('aucun produit n\'est à la fois gardé et refusé', G.gardees.filter(l => G.refusees.some(r => r.idProduct === l.idProduct)).length, 0);

console.log(`\n${ok} passés, ${ko} en échec`);
process.exit(ko ? 1 : 0);
