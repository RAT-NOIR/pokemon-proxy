// node test-cm-passif-liste.js — la LISTE des adresses des 64 paires Black Star (collecte-cartes/cm-passif.js). Pur : aucune base, aucun réseau, aucun chemin du testeur.
const fs = require('fs');
const path = require('path');
const L = require('./collecte-cartes/cm-passif');

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); }
};
const leve = (f) => { try { f(); return null; } catch (e) { return e.message; } };

const paire = (set, numero, nom, ids, slugs, entrees, dates = ['2026-06-18T17:16:41.000Z', '2026-08-14T07:22:08.000Z']) =>
    ({ set, numero, nom, idProduct: ids, slugs, variantes: ['V1', 'V2'], dateAdded: dates, entrees: entrees.map(titre => ({ titre })) });
const EXCLUS = [
    paire('SV-Black-Star-Promos', '006', 'Pawmot [X]', [11, 12], ['Pawmot-SVP006', 'Pawmot-V2-SVP006'], ['Pawmot (SVP006 English Promo)', 'Staff Pawmot (SVP006 English Promo)']),
    paire('MEP-Black-Star-Promos', '083', 'Slowbro [Y]', [21, 22], ['Slowbro-MEP083', 'Slowbro-V2-MEP083'], ['Slowbro (MEP083 English Promo)', 'Staff Slowbro (MEP083 English Promo)']),
    paire('SV-Black-Star-Promos', '010', 'Dedenne [Z]', [31, 32], ['Dedenne-SVP010', 'Dedenne-V2-SVP010'], ['Dedenne (SVP010 English Promo)', 'Staff Dedenne (SVP010 English Promo)']),
    paire('SWSH-Black-Star-Promos', '195', 'Leafeon VSTAR [W]', [41, 42], ['Leafeon-VSTAR-SWSH195', 'Leafeon-VSTAR-V2-SWSH195'], ['Leafeon VSTAR (SWSH195 English Promo)', 'Holofoil Play Pokemon Leafeon VSTAR (SWSH195 English Promo)'])
];
const NUMEROS = new Map([
    [11, { slug: 'Pawmot-SVP006', slugSet: 'SV-Black-Star-Promos' }], [12, { slug: 'Pawmot-V2-SVP006', slugSet: 'SV-Black-Star-Promos' }],
    [21, { slug: 'Slowbro-MEP083', slugSet: 'MEP-Black-Star-Promos' }], [22, { slug: 'Slowbro-V2-MEP083', slugSet: 'MEP-Black-Star-Promos' }],
    [31, { slug: 'Dedenne-SVP010', slugSet: 'SV-Black-Star-Promos' }], [32, { slug: 'Dedenne-V2-SVP010', slugSet: 'SV-Black-Star-Promos' }],
    [41, { slug: 'Leafeon-VSTAR-SWSH195', slugSet: 'SWSH-Black-Star-Promos' }], [42, { slug: 'Leafeon-VSTAR-V2-SWSH195', slugSet: 'SWSH-Black-Star-Promos' }]
]);

verifier('urlFiche : la forme prouvée par candidats-fiche.js, en /en/', L.urlFiche('SV-Black-Star-Promos', 'Pawmot-SVP006'), 'https://www.cardmarket.com/en/Pokemon/Products/Singles/SV-Black-Star-Promos/Pawmot-SVP006');
verifier('cleDeAdresse : « set/slug », indépendante de la langue (/fr/ = /en/)', [L.cleDeAdresse('https://www.cardmarket.com/fr/Pokemon/Products/Singles/SV-Black-Star-Promos/Pawmot-SVP006'), L.cleDeAdresse('https://www.cardmarket.com/en/Pokemon/Products/Singles/SV-Black-Star-Promos/Pawmot-SVP006')], ['SV-Black-Star-Promos/Pawmot-SVP006', 'SV-Black-Star-Promos/Pawmot-SVP006']);
verifier('cleDeAdresse : une page de LISTE (un seul segment) n\'a pas de clé', L.cleDeAdresse('https://www.cardmarket.com/en/Pokemon/Products/Singles/SV-Black-Star-Promos'), null);
verifier('cleDeAdresse : un autre hôte n\'a pas de clé', L.cleDeAdresse('https://evil.example/en/Pokemon/Products/Singles/A/B'), null);
verifier('cleDeAdresse : hors de /Pokemon/Products/Singles/ : pas de clé', L.cleDeAdresse('https://www.cardmarket.com/en/Magic/Products/Singles/A/B'), null);
verifier('tampon : « Staff X » → Staff', L.tamponAttendu([{ titre: 'Pawmot (SVP006 English Promo)' }, { titre: 'Staff Pawmot (SVP006 English Promo)' }]), 'Staff');
verifier('tampon : « Holofoil Play Pokemon X » → Play! Pokémon', L.tamponAttendu([{ titre: 'Leafeon VSTAR (SWSH195 English Promo)' }, { titre: 'Holofoil Play Pokemon Leafeon VSTAR (SWSH195 English Promo)' }]), 'Play! Pokémon');
verifier('tampon : ni l\'un ni l\'autre → erreur (jamais un tampon inventé)', /tampon/.test(leve(() => L.tamponAttendu([{ titre: 'A' }, { titre: 'B' }])) || ''), true);

const R = L.construireListe(EXCLUS, NUMEROS);
verifier('tri : set puis numéro (MEP, SV 006, SV 010, SWSH), # de 1 à 4', R.map(p => [p.n, p.set, p.numero]), [[1, 'MEP-Black-Star-Promos', '083'], [2, 'SV-Black-Star-Promos', '006'], [3, 'SV-Black-Star-Promos', '010'], [4, 'SWSH-Black-Star-Promos', '195']]);
verifier('chaque paire : V1 puis V2, adresse construite depuis slugSet/slug de la BASE', R[1].versions.map(v => [v.v, v.idProduct, v.url]), [['V1', 11, 'https://www.cardmarket.com/en/Pokemon/Products/Singles/SV-Black-Star-Promos/Pawmot-SVP006'], ['V2', 12, 'https://www.cardmarket.com/en/Pokemon/Products/Singles/SV-Black-Star-Promos/Pawmot-V2-SVP006']]);
verifier('tampon attendu porté par la paire', R.map(p => p.tampon), ['Staff', 'Staff', 'Staff', 'Play! Pokémon']);
verifier('numéros triés comme des nombres (6 avant 10, pas « 010 » avant « 006 »)', R.filter(p => p.set === 'SV-Black-Star-Promos').map(p => p.numero), ['006', '010']);
verifier('produit absent de la base → erreur nommée', /21/.test(leve(() => L.construireListe(EXCLUS, new Map([...NUMEROS].filter(([k]) => k !== 21)))) || ''), true);
verifier('slug de la base ≠ slug du plan → erreur', /slug/.test(leve(() => L.construireListe(EXCLUS, new Map([...NUMEROS, [11, { slug: 'Autre-SVP006', slugSet: 'SV-Black-Star-Promos' }]]))) || ''), true);
verifier('V2 pas plus récente que V1 → erreur', /date/.test(leve(() => L.construireListe([paire('A', '001', 'x', [11, 12], ['Pawmot-SVP006', 'Pawmot-V2-SVP006'], ['a', 'Staff a'], ['2026-08-14T07:22:08.000Z', '2026-06-18T17:16:41.000Z'])], NUMEROS)) || ''), true);
verifier('adresses uniques (aucun doublon dans la liste)', new Set(R.flatMap(p => p.versions.map(v => v.url))).size, 8);
verifier('index : adresse → paire, version, tampon', L.indexer(R)['SV-Black-Star-Promos/Pawmot-V2-SVP006'], { n: 2, v: 'V2', idProduct: 12, tampon: 'Staff', set: 'SV-Black-Star-Promos', numero: '006', nom: 'Pawmot [X]' });

// la liste LIVRÉE (si générée) : 64 paires, 128 adresses distinctes, V1/V2
const livree = path.join(__dirname, 'collecte-cartes', 'cm-passif-liste.json');
if (fs.existsSync(livree)) {
    const J = JSON.parse(fs.readFileSync(livree, 'utf8'));
    verifier('liste livrée : 64 paires, 128 adresses distinctes', [J.length, new Set(J.flatMap(p => p.versions.map(v => v.url))).size], [64, 128]);
    verifier('liste livrée : MEP 20, SV 40, SWSH 4', ['MEP', 'SV-', 'SWSH'].map(s => J.filter(p => p.set.startsWith(s)).length), [20, 40, 4]);
    verifier('liste livrée : chaque V1 est plus ancienne que sa V2', J.every(p => Date.parse(p.versions[0].dateAdded) < Date.parse(p.versions[1].dateAdded)), true);
    verifier('liste livrée : triée (set, numéro), # continus', J.every((p, i) => p.n === i + 1), true);
}
console.log(`\n${ok} réussis, ${ko} en échec`);
process.exit(ko ? 1 : 0);
