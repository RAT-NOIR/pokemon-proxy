// node test-pages-du-rang.js — banc de collecte-cartes/pages-du-rang.js : la page d'un produit dans une liste Cardmarket plafonnée à 300
const { pagesDuRang } = require('./collecte-cartes/pages-du-rang');
let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => { const a = JSON.stringify(obtenu), b = JSON.stringify(attendu); if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); } };
const A = s => ({ tri: 'name_asc', site: s }), D = s => ({ tri: 'name_desc', site: s });

// 1. le cas d'avant : petite liste, milieu de page — une page, croissante
verifier('1. rang 44 sur 120, marge 3 : croissant p.2 seule', pagesDuRang(44, 120, 3), { principale: A(2), pages: [A(2)] });
// 2. bord de page : la voisine s'ajoute (comme la marge d'avant : pos < m → p−1, pos ≥ 30−m → p+1)
verifier('2. rang 30 (1er de p.2), marge 3 : p.2 et p.1', pagesDuRang(30, 120, 3), { principale: A(2), pages: [A(1), A(2)] });
verifier('   rang 58 (29e de p.2), marge 3 : p.2 et p.3', pagesDuRang(58, 120, 3), { principale: A(2), pages: [A(2), A(3)] });
// 3. dernière page de la liste : pas de voisine au-delà de la fin (n−1)
verifier('3. rang 119 sur 120, marge 3 : p.4 seule (pas de p.5 hors liste)', pagesDuRang(119, 120, 3), { principale: A(4), pages: [A(4)] });
// 4. LE CAS DU JOURNAL 1.10 : Sun-Moon-Promos, 422 produits — un rang au-delà de 300 se lit en décroissant
verifier('4. rang 350 sur 422 : décroissant, n−1−r = 71 → ↓p.3', pagesDuRang(350, 422, 3), { principale: D(3), pages: [D(3)] });
verifier('   rang 421 (dernier) sur 422 : ↓p.1', pagesDuRang(421, 422, 3), { principale: D(1), pages: [D(1)] });
// 5. JAMAIS au-delà de la page 10, dans aucun tri
const toutes = []; for (const n of [299, 300, 301, 422, 600, 601, 774]) for (let r = 0; r < n; r++) { const x = pagesDuRang(r, n, 3); toutes.push(...x.pages, ...(x.principale ? [x.principale] : [])); }
verifier(`5. sur ${[299, 300, 301, 422, 600, 601, 774].reduce((a, b) => a + b, 0)} rangs (listes de 299 à 774) : aucune page au-delà de 10, aucune page 0 (pages vues : ${toutes.length})`, toutes.filter(p => p.site > 10 || p.site < 1).length, 0);
// 6. frontière du plafond, liste de 422 : la fenêtre croissante déborde → le décroissant, dont la fenêtre tient
verifier('6. rang 298 sur 422, marge 3 : la fenêtre [295, 301] déborde de 300 → décroissant (n−1−r = 123 → ↓p.5)', pagesDuRang(298, 422, 3), { principale: D(5), pages: [D(5)] });
verifier('   rang 296 sur 422, marge 3 : fenêtre [293, 299] entière → croissant p.10', pagesDuRang(296, 422, 3), { principale: A(10), pages: [A(10)] });
// 7. au milieu d'une liste de plus de 600 (mC, 774) : ni l'un ni l'autre → principale null (recherche), rien au-delà de 10
verifier('7. rang 400 sur 774 : aucune page atteignable, principale null', pagesDuRang(400, 774, 3), { principale: null, pages: [] });
// 8. bord du plafond dans une liste de plus de 600 : les pages atteignables des deux fenêtres, principale = celle du rang s'il est atteignable
verifier('8. rang 299 sur 774, marge 3 : croissant p.10 (rang atteignable), décroissant hors d\'atteinte', pagesDuRang(299, 774, 3), { principale: A(10), pages: [A(10)] });
verifier('   rang 301 sur 774, marge 3 : rang hors d\'atteinte → principale null, p.10 croissante en voisine', pagesDuRang(301, 774, 3), { principale: null, pages: [A(10)] });
// 9. marge 0 : la page du rang, rien d'autre
verifier('9. marge 0, rang 30 sur 120 : p.2 seule', pagesDuRang(30, 120, 0), { principale: A(2), pages: [A(2)] });
// 10. entrées hors bornes : une exception, jamais une page inventée
let leve = 0; for (const a of [[-1, 10, 3], [10, 10, 3], [1.5, 10, 3], [1, 10, 30]]) { try { pagesDuRang(...a); } catch (_) { leve++; } }
verifier('10. rang négatif, rang = n, rang non entier, marge ≥ 30 : 4 exceptions', leve, 4);

console.log(`\n${ok} passés, ${ko} en échec`);
process.exit(ko ? 1 : 0);
