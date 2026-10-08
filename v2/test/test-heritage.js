'use strict';
// La liste des chemins HÉRITÉS (v2/heritage.js) doit contenir CHAQUE route que index.js déclare : sinon une route v2 pourrait
// recouvrir une route héritée sans aiguilleur. Le banc lit index.js (le MÊME fichier que la production) et compare dans les deux sens.
// ET il compte les appels BRUTS app.<méthode>( : si une forme de déclaration qu'il ne sait pas lire existe (guillemets doubles, gabarit,
// chemin en variable, tableau, app.route), les deux comptes divergent et le banc ÉCHOUE au lieu de se taire.
const fs = require('fs'), path = require('path');
const H = require('./_harnais');
const { CHEMINS_HERITES } = require('../heritage');

function analyser(src) {
    const lignes = src.split(/\r?\n/).filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l));   // hors commentaires
    const code = lignes.join('\n');
    const lus = new Set();
    for (const m of code.matchAll(/^app\.(?:get|post|put|delete|patch|all)\(\s*'([^'`"]+)'/gm)) lus.add(m[1]);
    const bruts = [...code.matchAll(/\bapp\.(?:get|post|put|delete|patch|all|route)\(/g)].length;
    const lusN = [...code.matchAll(/^app\.(?:get|post|put|delete|patch|all)\(\s*'[^'`"]+'/gm)].length;
    // app.use avec un chemin littéral (middleware ciblé) : ses chemins doivent aussi être connus
    const chemins = new Set();
    for (const m of code.matchAll(/\bapp\.use\(\s*(\[[^\]]*\]|'[^']*'|"[^"]*")/g)) for (const c of m[1].matchAll(/['"](\/[^'"]*)['"]/g)) chemins.add(c[1]);
    return { lus, lusN, bruts, chemins };
}

// 1. le détecteur SAIT crier : sur des sources fabriquées, chaque forme illisible fait diverger les deux comptes
for (const [forme, src] of [
    ['guillemets doubles', 'app.post("/api/c", x);'], ['gabarit', 'app.post(`/api/i`, x);'], ['chemin en variable', 'app.post(CHEMIN, x);'],
    ['tableau', "app.get(['/api/e','/api/f'], x);"], ['app.route', "app.route('/api/g').post(x);"]]) {
    const r = analyser(src);
    H.vrai(`forme illisible « ${forme} » : les comptes divergent (lus ${r.lusN}, bruts ${r.bruts})`, r.lusN !== r.bruts);
}
const ok = analyser("app.post('/api/a', x);\napp.get('/ping', y);\n// app.post('/api/zzz', x)\n * app.post('/api/yyy')");
H.v('forme lisible : comptes égaux, commentaires ignorés', [ok.lusN, ok.bruts, [...ok.lus]], [2, 2, ['/api/a', '/ping']]);

const nl = analyser("app.post(\n  '/api/d', x);");
H.v('chemin sur la ligne suivante : lu', [nl.lusN, nl.bruts, [...nl.lus]], [1, 1, ['/api/d']]);

// 2. index.js réel
const r = analyser(fs.readFileSync(path.join(__dirname, '..', '..', 'index.js'), 'utf8'));
H.vrai(`index.js déclare des routes (dénominateur : ${r.lus.size})`, r.lus.size >= 8);
H.v('index.js : appels bruts app.<méthode>( == routes lues (une forme non lue ferait crier)', r.bruts, r.lusN);
for (const c of r.lus) H.vrai(`route héritée ${c} figure dans CHEMINS_HERITES`, CHEMINS_HERITES.includes(c));
for (const c of CHEMINS_HERITES) H.vrai(`CHEMINS_HERITES ${c} existe encore dans index.js`, r.lus.has(c));
for (const c of r.chemins) H.vrai(`app.use ciblé sur ${c} : chemin connu de CHEMINS_HERITES`, CHEMINS_HERITES.includes(c));
H.vrai('la liste est gelée', Object.isFrozen(CHEMINS_HERITES));
H.bilan();
