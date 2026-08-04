// Combien de fonctions d'index.js AUCUN test n'exécute jamais ?
// Mesure par la couverture V8 de Node (pas une estimation) : on lance les suites avec
// NODE_V8_COVERAGE, puis on fusionne les compteurs par fonction.
//   node couverture-index.js
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const DOSSIER = path.join(os.tmpdir(), 'couv-' + Date.now());
fs.mkdirSync(DOSSIER, { recursive: true });

// Le BANC est inclus exprès, alors qu'il n'est pas une suite : c'est lui qui affichait
// vert pendant que la production était morte. La question « que couvre l'instrument »
// n'a de sens que s'il est dans la mesure.
const SUITES = ['smoke-test.js', 'scoring.js', 'test-setcode-numero.js', 'test-table-vintage.js',
    'test-pokedex.js', 'test-acces.js', 'test-journal-echecs.js', 'banc-japonais.js'];

for (const s of SUITES) {
    process.stdout.write(`  ${s} ... `);
    try {
        execFileSync(process.execPath, [s], {
            cwd: __dirname, stdio: 'pipe', timeout: 300000,
            env: { ...process.env, NODE_V8_COVERAGE: DOSSIER }
        });
        console.log('ok');
    } catch (e) { console.log(`(code ${e.status ?? '?'})`); }
}

// Fusion : pour chaque fonction d'index.js, le compteur MAX vu sur toutes les suites.
const compteur = new Map();
for (const f of fs.readdirSync(DOSSIER)) {
    if (!f.endsWith('.json')) continue;
    let data;
    try { data = JSON.parse(fs.readFileSync(path.join(DOSSIER, f), 'utf8')); } catch (_) { continue; }
    for (const script of data.result || []) {
        // ⚠️ LE FILTRE DOIT ÊTRE EXACT. `endsWith('index.js')` ramasse les centaines
        // d'index.js de node_modules (mongoose, express, stripe) et noie la mesure.
        const u = String(script.url);
        if (u.includes('node_modules')) continue;
        if (!u.endsWith('/index.js') && !u.endsWith('\\index.js')) continue;
        for (const fn of script.functions || []) {
            const nom = fn.functionName || '(anonyme)';
            if (nom === '(anonyme)' || !fn.ranges?.length) continue;
            const c = fn.ranges[0].count;
            compteur.set(nom, Math.max(compteur.get(nom) ?? 0, c));
        }
    }
}

const total = compteur.size;
const jamais = [...compteur.entries()].filter(([, c]) => c === 0).map(([n]) => n);
console.log(`\n═══ COUVERTURE D'index.js PAR TOUTES LES SUITES ═══`);
console.log(`${total} fonctions nommées observées`);
console.log(`   exécutées au moins une fois : ${total - jamais.length}`);
console.log(`   JAMAIS exécutées            : ${jamais.length}  (${(100 * jamais.length / total).toFixed(0)} %)`);
console.log(`\nles jamais exécutées :`);
for (const n of jamais.sort()) console.log(`   ${n}`);
fs.rmSync(DOSSIER, { recursive: true, force: true });
