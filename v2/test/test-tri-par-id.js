'use strict';
// PERF-SCAN, tour 1, B2 — l'ORDRE des candidats décide les égalités de score : la requête d'avant rendait l'ordre NATUREL de la collection, la recherche par l'index l'ordre des _id. Sur un catalogue
// importé dans un autre ordre que celui des _id, les deux divergent (56 décisions sur 4 506 changeaient). Toutes les recherches par nom — le repli d'avant ET la voie de l'index — TRIENT donc par _id.
// Ce banc lit le CODE : chaque requête de nom (les cinq replis et les quatre requêtes de l'index) porte `.sort({ _id: 1 })`. Les décisions rejouées sur le vrai instantané sont dans
// v2/mesures/rejouer-identite-index-nom.js (--ordre=instantane).
const fs = require('fs'), path = require('path');
const racine = process.argv[2] || path.join(__dirname, '..', '..');      // un autre dossier en argument : rejouer le banc sur une copie (le rouge se voit sur la référence)
const lire = f => fs.readFileSync(path.join(racine, f), 'utf8');
let ok = 0, ko = 0;
const v = (nom, b) => { console.log(`${b ? '✅' : '❌'} ${nom}`); b ? ok++ : ko++; };


// Les sites, chacun par la FORME de sa requête : un `find(` sur un filtre de nom doit être suivi de `.sort({ _id: 1 })` avant `.lean()` / `.toArray()`.
const REQUETES = [
    ['index.js', /\?\? await CatalogueProduit\.find\(\{ name: regex \}\)(\.sort\(\{ _id: 1 \}\))?\.lean\(\)/g, 'nom court (repli)', 1],
    ['index.js', /CatalogueProduit\.find\(\{ name: regexPremierMot \}\)(\.sort\(\{ _id: 1 \}\))?\.lean\(\)/g, 'premier mot (repli)', 1],
    ['identification-locale.js', /CatalogueProduit\.find\(\{ name: regexPremierMot \}\)(\.sort\(\{ _id: 1 \}\))?\.lean\(\)/g, 'premier mot (repli)', 1],
    ['identification-locale.js', /NumeroCarte\.find\(\{ nomFr: regexFr \}, \{ idProduct: 1 \}\)(\.sort\(\{ _id: 1 \}\))?\.lean\(\)/g, 'nom français (repli)', 1],
    ['pont-cartes.js', /CP\.find\(\{ name: \{ \$in: regexDeBase \} \}, \{ projection: \{ idProduct: 1, idExpansion: 1 \} \}\)(\.sort\(\{ _id: 1 \}\))?\.toArray\(\)/g, 'homonymes « commence par » (repli)', 1],
];
for (const [fichier, re, nom, attendu] of REQUETES) {
    const t = lire(fichier), trouves = [...t.matchAll(re)];
    v(`${fichier} — ${nom} : ${attendu} requête trouvée (${trouves.length})`, trouves.length === attendu);
    v(`${fichier} — ${nom} : triée par _id`, trouves.length === attendu && trouves.every(m => m[1] !== undefined));
}
const idx = lire('v2/identifier/index-nom.js');
v('index-nom.js : les quatre requêtes de l\'index trient par _id', (idx.match(/\.sort\(\{ _id: 1 \}\)\.toArray\(\)/g) || []).length === 4);
// B1 : chaque contrôle de disponibilité du serveur porte son TÉMOIN de fraîcheur (sans lui, un produit renommé garde ses anciennes clés et l'index ment).
for (const [fichier, n] of [['index.js', 1], ['identification-locale.js', 2], ['pont-cartes.js', 1]]) {
    const t = lire(fichier), appels = t.split('\n').filter(l => l.includes('INDEX_NOM.creerDisponibilite('));
    v(`${fichier} : ${n} contrôle(s) de disponibilité, chacun avec source (${appels.length})`, appels.length === n && appels.every(l => l.includes('source: {')));
}
console.log(`\n${ok} réussis, ${ko} échoués`); process.exitCode = ko ? 1 : 0;
