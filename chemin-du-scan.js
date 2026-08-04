// ============================================================
// QUELLES FONCTIONS SONT SUR LE CHEMIN D'UN SCAN RÉEL ?
// ============================================================
// La couverture dit CE QUI N'EST PAS TESTÉ. Elle ne dit pas ce qui est DANGEREUX.
// Une fonction non couverte qui ne peut pas s'exécuter pendant un scan ne peut pas casser
// un scan. Ce script sépare les deux : il part des deux routes de scan et suit les appels,
// de proche en proche, jusqu'à ne plus rien trouver de nouveau.
//
// C'est une analyse STATIQUE du texte : elle voit un appel écrit dans un corps de
// fonction. Elle ne sait pas si la branche est prise à l'exécution — donc elle SURESTIME
// le chemin, jamais l'inverse. Pour la question posée (« qu'est-ce qui peut casser la
// production »), surestimer est le bon sens de l'erreur.
//
// USAGE :  node chemin-du-scan.js

const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
const lignes = source.split('\n');

// ---- Les corps de fonction de premier niveau -----------------------------
const corps = new Map();
for (let i = 0; i < lignes.length; i++) {
    const m = lignes[i].match(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/);
    if (!m) continue;
    let j = i + 1;
    while (j < lignes.length && !/^\}/.test(lignes[j])) j++;
    corps.set(m[1], lignes.slice(i + 1, j).join('\n'));
}

// ---- Les deux routes de scan ---------------------------------------------
function corpsDeRoute(motif) {
    const i = lignes.findIndex(l => l.includes(motif));
    if (i < 0) return '';
    let j = i + 1;
    while (j < lignes.length && !/^\}\);/.test(lignes[j])) j++;
    return lignes.slice(i, j).join('\n');
}
const depart = corpsDeRoute("app.post('/api/identifier'") + '\n' + corpsDeRoute("app.post('/api/analyser'");

// ---- Fermeture transitive ------------------------------------------------
const surLeChemin = new Set();
let front = [depart];
while (front.length) {
    const suivant = [];
    for (const texte of front) {
        for (const nom of corps.keys()) {
            if (surLeChemin.has(nom)) continue;
            if (new RegExp(`\\b${nom}\\s*\\(`).test(texte)) {
                surLeChemin.add(nom);
                suivant.push(corps.get(nom));
            }
        }
    }
    front = suivant;
}
// Les middlewares du routeur : ils s'exécutent à chaque scan sans être « appelés ».
for (const m of ['verifierJeton']) if (corps.has(m)) surLeChemin.add(m);

// ---- Croisement avec les non couvertes -----------------------------------
const plancher = JSON.parse(fs.readFileSync(path.join(__dirname, 'verrou', 'couverture-plancher.json'), 'utf8'));
const couvertes = new Set(plancher.couvertes);
const nonCouvertes = [...corps.keys()].filter(n => !couvertes.has(n));

const dangereuses = nonCouvertes.filter(n => surLeChemin.has(n)).sort();
const horsChemin = nonCouvertes.filter(n => !surLeChemin.has(n)).sort();

console.log(`${corps.size} fonctions de premier niveau dans index.js`);
console.log(`${surLeChemin.size} atteignables depuis /api/identifier ou /api/analyser\n`);
console.log(`═══ NON COUVERTES **ET** SUR LE CHEMIN D'UN SCAN — ${dangereuses.length} ═══`);
console.log(`(les seules qui peuvent casser la production)\n`);
for (const n of dangereuses) console.log(`   ${n}`);
console.log(`\n═══ NON COUVERTES, HORS DU CHEMIN D'UN SCAN — ${horsChemin.length} ═══`);
console.log(`(elles attendront)\n`);
for (const n of horsChemin) console.log(`   ${n}`);
