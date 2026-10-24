// Mutants du banc test-pokipair.js : chaque mutant casse UNE garde de collecte-cartes/pokipair.js (copie temporaire à côté) ; le banc doit ÉCHOUER. Un mutant qui survit = une garde que rien ne garde.
//   node mutants-recolte.js            (sortie : tués / survivants)
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const SRC = path.join(__dirname, 'collecte-cartes', 'pokipair.js');
const COPIE = path.join(__dirname, 'collecte-cartes', 'pokipair-mutant.js');
const MUTANTS = [
    ['tuile cachée acceptée comme visible', "const visibles = l.filter(t => !t.cachee);", "const visibles = l;"],
    ['variante quelconque admise', "if (!VARIANTES_BASE.includes(visibles[0].variante))", "if (false)"],
    ['nom non comparé', "if (!memeNom(t.nom, nomJoint)) {", "if (false) {"],
    ['nom du produit non comparé', "if (nomProduit && !memeNom(t.nom, nomProduit))", "if (false)"],
    ['variantes (deux produits au même numéro) acceptées', "if (effectifs.get(cle(p)) > 1) { reste(p, 'variantes'", "if (false) { reste(p, 'variantes'"],
    ['Gem Pack lu comme simple', "if (ligne.format !== 'simple') {", "if (false) {"],
    ['tuile revendiquée deux fois gardée', "const gardees = unites.filter(u => !doubles.has(u.url));", "const gardees = unites;"],
    ['adresse hors forme acceptée', "if (!urlImageValide(t.url))", "if (false)"],
    ['miniature incohérente acceptée', "if (t.miniature !== miniatureDe(t.url))", "if (false)"],
    ['garde de titre retirée', "if (!ligne.titre.test(", "if (false && !ligne.titre.test("],
    ['garde de total retirée', "if (ligne.format === 'simple' && page.totalDominant !== ligne.total)", "if (false)"],
    ['tuile illisible acceptée', "if (t.illisible || t.n == null) continue;", "if (t.n == null) continue;"],
    ['hôte quelconque pour les images', "u.hostname === HOTE_IMAGES &&", "true &&"],
    ['page hors table acceptée', "if (!TABLE.some(l => l.page === page))", "if (false)"],
    ['produit vers plusieurs cartes accepté', "if (lignesDuProduit.get(p.idProduct) > 1) {", "if (false) {"],
    ['numéro comparé sans la clé de la jointure', "const b = baseDe.get(J.cleNumero(p.numeroFiche));", "const b = baseDe.get(String(p.numeroFiche));"]
];
let tues = 0, survivants = [];
for (const [nom, de, vers] of MUTANTS) {
    const t = fs.readFileSync(SRC, 'utf8');
    if (!t.includes(de)) { console.log(`❌ motif introuvable pour « ${nom} »`); process.exitCode = 2; continue; }
    fs.writeFileSync(COPIE, t.replace(de, vers));
    try {
        const r = spawnSync(process.execPath, ['test-pokipair.js'], { cwd: __dirname, encoding: 'utf8', env: { ...process.env, PPR_MODULE: './collecte-cartes/pokipair-mutant' }, timeout: 60000 });
        if (r.status !== 0) tues++; else survivants.push(nom);
    } finally { fs.rmSync(COPIE, { force: true }); }
}
console.log(`mutants : ${tues} tués sur ${MUTANTS.length}${survivants.length ? ` · SURVIVANTS : ${survivants.join(' ; ')}` : ''}`);
process.exitCode = survivants.length || process.exitCode ? 1 : 0;
