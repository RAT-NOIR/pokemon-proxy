// Banc de poser-categorie-fiches-simples.js (aucune base, aucun réseau) : la catégorie d'une fiche simple ne vient QUE d'une
// réimpression prouvée — même nom ET mêmes attaques — et jamais du nom seul.
const { categorieProuvee } = require('./poser-categorie-fiches-simples');
const { indexer } = require('./collecte-cartes/cle-nom-attaques');
let ok = 0, ko = 0;
const egal = (n, a, b) => { const sa = JSON.stringify(a), sb = JSON.stringify(b); if (sa === sb) ok++; else { ko++; console.log(`❌ ${n} : ${sa} ≠ ${sb}`); } };
const carte = (_id, nomEn, categorie, attaques) => ({ _id, nomEn, categorie, attaques: attaques.map(nom => ({ nom })) });
const origines = [
    carte(1, 'Thievul', 'pokemon', ['Skill Thief', 'Sharp Fang']),
    carte(2, 'Thievul', 'pokemon', ['Sharp Fang']),
    carte(3, 'Sylveon-GX', 'pokemon', ['Magical Ribbon', 'Fairy Wind']),
    carte(4, 'Switch', 'dresseur', []),
    carte(5, 'Mystere', 'pokemon', ['Ombre']),
    carte(6, 'Mystere', 'dresseur', ['Ombre']),   // une catégorie en désaccord sur le même nom et la même attaque (cas fabriqué)
    carte(7, 'Deoxys', 'pokemon', ['Ozone Drain']),
    carte(8, 'Homonyme', 'pokemon', ['Frappe']),
    carte(9, 'Homonyme', 'dresseur', [])          // le même nom porté par un Dresseur : le nom ne prouve plus rien
];
const index = indexer(origines);
const cat = (nomEn, attaques, o) => categorieProuvee(index, carte(-1, nomEn, null, attaques), o).categorie;
egal('1 même nom, mêmes attaques', cat('Thievul', ['Skill Thief', 'Sharp Fang']), 'pokemon');
egal('2 une voisine du même nom partage une attaque, même catégorie : prouvée', cat('Thievul', ['Sharp Fang']), 'pokemon');
egal('3 crochets Cardmarket avec l\'attaque GX en plus (forme « incluses »)', cat('Sylveon GX', ['Magical Ribbon', 'Fairy Wind', 'Plea GX']), 'pokemon');
egal('4 sans attaque : le nom seul ne prouve rien', cat('Switch', []), null);
egal('5 aucune carte du même nom à ces attaques', cat('Thievul', ['Bite']), null);
egal('6 catégories en désaccord parmi les cartes du même nom : rien', cat('Mystere', ['Ombre']), null);
egal('7 nom inconnu', cat('Inconnu', ['Tackle']), null);
egal('8 la carte elle-même retirée (calibration) : la voisine parle', categorieProuvee(index, origines[0], { sauf: 1 }).categorie, 'pokemon');
egal('9 la preuve nomme les cartes d\'origine, la mieux couvrante d\'abord', categorieProuvee(index, carte(-1, 'Thievul', null, ['Skill Thief', 'Sharp Fang'])).origines, [1, 2]);
egal('10 une attaque commune pour quatre entrées : pas une preuve', cat('Deoxys', ['Forme Change', 'Ozone Hole', 'Ozone Tornado', 'Ozone Drain']), null);
egal('11 deux entrées en plus (talent, attaque GX) : prouvée', cat('Deoxys', ['Forme Change', 'Ozone Drain', 'Ozone GX']), 'pokemon');
egal('12 un nom que porte aussi un Dresseur : rien', cat('Homonyme', ['Frappe']), null);
// LA DÉCISION D'ÉCRIRE, écrite par ce qu'elle AUTORISE (relecture du 2026-10-08) : une jointure à contre-catégorie non annoncée bloque
const { refusEcriture } = require('./poser-categorie-fiches-simples');
const sain = { parle: 2232, faux: 0, epParle: 7040, epFaux: 0, aRemplir: 809, attendu: 809, contredites: 2, contreditesAnnoncees: 2 };
egal('13 tout annoncé, rien de faux : écrire', refusEcriture(sain), null);
egal('14 une 3e jointure à contre-catégorie, non annoncée : refus', !!refusEcriture({ ...sain, contredites: 3 }), true);
egal('15 les jointures à contre-catégorie non annoncées (défaut 0) : refus', !!refusEcriture({ ...sain, contreditesAnnoncees: 0 }), true);
egal('16 épreuve muette : refus', !!refusEcriture({ ...sain, epParle: 0 }), true);
egal('17 un faux à l\'épreuve : refus', !!refusEcriture({ ...sain, epFaux: 1 }), true);
egal('18 un volume autre que l\'annoncé : refus', !!refusEcriture({ ...sain, attendu: 808 }), true);
egal('19 une valeur absente (champ mal nommé) : refus, jamais un passage', !!refusEcriture({ ...sain, contredites: undefined }), true);
console.log(`${ko ? '🔴' : '✅'} ${ok}/${ok + ko}`);
process.exitCode = ko ? 1 : 0;
