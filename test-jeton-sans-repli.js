// Banc : la VALEUR du jeton de l'API ne figure dans aucun fichier suivi par git, et aucun .js ne porte un repli non vide pour JETON_API.
// Décision du testeur (2026-10-12) : les scripts de banc passent par la variable d'environnement, jamais par une valeur en dur.
// Exclus (hors décision) : "extension v2/", userscript-apprentissage.js.
//
// CONTRÔLE PRINCIPAL, PAR LA VALEUR : le cas craint est que la valeur de production soit dans un fichier, quelle que soit la syntaxe.
// Le banc charge l'environnement comme le dépôt (dotenv, .env de ce dossier), lit JETON_API et cherche ce littéral exact dans tous les fichiers texte
// suivis (git ls-files). JETON_API absente/vide ou trop courte : « je ne peux pas conclure » -> code 1 (une garde qui ne conclut pas bloque).
// CONTRÔLE SECOND, SYNTAXIQUE : un repli non vide (|| ou ??, même après .trim(), en début de ligne suivante, en déstructuration avec défaut, ou après '' + ...).
// Ce banc imprime fichier:ligne, JAMAIS la valeur ni un littéral.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const MIN_LONGUEUR = 16;
const EXCLUS_DOSSIERS = new Set(['node_modules', 'extension v2', '.git', '.banc-local']);
const EXCLUS_FICHIERS = new Set(['userscript-apprentissage.js']);
const EXT_BINAIRES = /\.(png|jpe?g|gif|webp|ico|pdf|zip|gz|woff2?|ttf|otf|mp4|bin|node|wasm|xlsx?)$/i;

function numeroDeLigne(texte, index) { return texte.slice(0, index).split('\n').length; }

/** Contrôle par la valeur. contenus : [{ fichier, texte }]. Rend [{ fichier, ligne }]. Lève si la valeur ne peut pas servir. */
function controleParValeur(valeur, contenus) {
    if (typeof valeur !== 'string' || !valeur.trim()) throw new Error('je ne peux pas conclure : JETON_API absente ou vide');
    if (valeur.length < MIN_LONGUEUR) throw new Error(`je ne peux pas conclure : JETON_API trop courte pour être un jeton (< ${MIN_LONGUEUR} caractères)`);
    const trouves = [];
    for (const { fichier, texte } of contenus) {
        let i = texte.indexOf(valeur);
        while (i !== -1) {
            trouves.push({ fichier, ligne: numeroDeLigne(texte, i) });
            i = texte.indexOf(valeur, i + 1);
        }
    }
    return trouves;
}

// Formes du repli non vide (guillemet ouvrant NON immédiatement refermé).
const Q = '([\'"`])(?!\\1)';
const FORMES = [
    new RegExp(`JETON_API[^\\n;]*?(?:\\|\\||\\?\\?)\\s*${Q}`),                 // même ligne, même après .trim() / ['...']
    new RegExp(`JETON_API[^;]{0,120}?\\n\\s*(?:\\|\\||\\?\\?)\\s*${Q}`),       // opérateur en début de ligne suivante
    new RegExp(`\\{[^}]*\\bJETON_API\\s*=\\s*${Q}`),                            // déstructuration avec défaut
    /JETON_API[^\n;]*?(?:\|\||\?\?)\s*(['"`])\1\s*\+\s*['"`]/                   // || '' + 'x'
];

/** Contrôle syntaxique sur le texte d'un fichier. Rend [{ ligne }]. */
function controleSyntaxe(texte) {
    const vus = new Set();
    for (const f of FORMES) {
        const m = f.exec(texte);
        if (m) vus.add(numeroDeLigne(texte, m.index));
    }
    return [...vus].sort((a, b) => a - b).map(ligne => ({ ligne }));
}

function parcourir(dossier, sortie = []) {
    for (const e of fs.readdirSync(dossier, { withFileTypes: true })) {
        if (e.isDirectory()) {
            if (EXCLUS_DOSSIERS.has(e.name)) continue;
            parcourir(path.join(dossier, e.name), sortie);
        } else if (e.isFile() && /\.(js|mjs|cjs)$/.test(e.name) && !EXCLUS_FICHIERS.has(e.name)) {
            sortie.push(path.join(dossier, e.name));
        }
    }
    return sortie;
}

function cheminGit() {
    const base = path.join(process.env.LOCALAPPDATA || '', 'GitHubDesktop');
    try {
        const apps = fs.readdirSync(base).filter(n => n.startsWith('app-')).sort().reverse();
        for (const a of apps) {
            const g = path.join(base, a, 'resources', 'app', 'git', 'cmd', 'git.exe');
            if (fs.existsSync(g)) return g;
        }
    } catch (_) { /* repli ci-dessous */ }
    return 'git';
}

function fichiersSuivis() {
    const sortie = execFileSync(cheminGit(), ['ls-files', '-z'], { cwd: __dirname, maxBuffer: 256 * 1024 * 1024 }).toString('utf8');
    return sortie.split('\0').filter(Boolean)
        .filter(f => !/^extension v2\//.test(f) && path.basename(f) !== 'userscript-apprentissage.js' && !EXT_BINAIRES.test(f));
}

let echecs = 0;
function verifier(libelle, ok) {
    if (!ok) echecs++;
    console.log(`  ${ok ? '✅' : '❌'} ${libelle}`);
}
function leve(f) { try { f(); return null; } catch (e) { return e.message; } }

function autoTests() {
    // Valeur de TEST fabriquée ici, jamais le vrai jeton. Les contenus sont en mémoire : aucun fichier écrit.
    const V = 'zz-valeur-de-test-' + '0123456789abcdef';
    const J = 'JETON' + '_API';
    const dit = (contenus) => controleParValeur(V, contenus).length;
    console.log('=== Contrôle par la valeur : sait dire NON / OUI (contenus fabriqués) ===');
    verifier('NON : forme normale (repli avec la valeur)', dit([{ fichier: 'a.js', texte: `const x = process.env.${J} || '${V}';\n` }]) === 1);
    verifier('NON : déstructuration avec défaut', dit([{ fichier: 'a.js', texte: `const { ${J} = '${V}' } = process.env;\n` }]) === 1);
    verifier('NON : valeur dans un .json', dit([{ fichier: 'c.json', texte: `{\n  "jeton": "${V}"\n}\n` }]) === 1);
    verifier('NON : valeur dans un .md, ligne rapportée', JSON.stringify(controleParValeur(V, [{ fichier: 'n.md', texte: `a\nb\n${V}\n` }])) === JSON.stringify([{ fichier: 'n.md', ligne: 3 }]));
    verifier('NON : valeur seule, coupée par rien d\'autre (fichier sans retour)', dit([{ fichier: 'x.bat', texte: V }]) === 1);
    verifier('OUI : repli vide, valeur absente', dit([{ fichier: 'a.js', texte: `const x = process.env.${J} || '';\n` }]) === 0);
    verifier('BLOQUE : variable absente', /ne peux pas conclure.*absente/.test(leve(() => controleParValeur(undefined, [])) || ''));
    verifier('BLOQUE : variable vide', /ne peux pas conclure.*absente/.test(leve(() => controleParValeur('  ', [])) || ''));
    verifier('BLOQUE : valeur trop courte', /trop courte/.test(leve(() => controleParValeur('court', [])) || ''));

    console.log('\n=== Contrôle syntaxique : sait dire NON / OUI ===');
    const non = (t) => controleSyntaxe(t).length > 0;
    const cas = (op, q, c) => `const x = process.env.${J} ${op} ${q}${c}${q};`;
    for (const op of ['||', '??']) for (const q of ["'", '"', '`']) verifier(`NON : ${op} avec ${q}`, non(cas(op, q, 'abc')));
    verifier('NON : forme process.env[...]', non(`const x = process.env['${J}'] || 'abc';`));
    verifier('NON : .trim() puis ||', non(`const x = process.env.${J}.trim() || 'abc';`));
    verifier('NON : déstructuration avec défaut', non(`const { ${J} = 'abc' } = process.env;`));
    verifier('NON : déstructuration multiple avec défaut', non(`const { A, ${J} = "abc", B } = process.env;`));
    verifier('NON : opérateur en début de ligne suivante', non(`const x = process.env.${J}\n    || 'abc';`));
    verifier('NON : ?? en début de ligne suivante', non(`const x = process.env.${J}\n    ?? "abc";`));
    verifier('NON : || \'\' + \'x\'', non(`const x = process.env.${J} || '' + 'abc';`));
    verifier('OUI : || vide', !non(cas('||', "'", '')));
    verifier('OUI : ?? vide en backtick', !non(cas('??', '`', '')));
    verifier('OUI : lecture sans repli', !non(`const x = process.env.${J};`));
    verifier('OUI : déstructuration sans défaut', !non(`const { ${J} } = process.env;`));
    verifier('OUI : rapporte la bonne ligne', JSON.stringify(controleSyntaxe(`a\nb\n${cas('||', "'", 'abc')}\n`)) === JSON.stringify([{ ligne: 3 }]));
}

autoTests();

console.log('\n=== Le dépôt ===');
require('dotenv').config({ path: path.join(__dirname, '.env'), quiet: true });
let valeur = process.env.JETON_API;
let bloque = false;
try {
    const suivis = fichiersSuivis();
    const contenus = [];
    for (const f of suivis) {
        const p = path.join(__dirname, f);
        try {
            if (!fs.existsSync(p) || fs.statSync(p).size > 8 * 1024 * 1024) continue;
            const buf = fs.readFileSync(p);
            if (buf.includes(0)) continue; // binaire
            contenus.push({ fichier: f, texte: buf.toString('utf8') });
        } catch (_) { /* supprimé entre-temps */ }
    }
    console.log(`  (${suivis.length} fichiers suivis, ${contenus.length} fichiers texte lus)`);
    verifier('le parcours a lu des fichiers', contenus.length > 100);
    const trouves = controleParValeur(valeur, contenus);
    for (const t of trouves) { echecs++; console.log(`  ❌ ${t.fichier}:${t.ligne} : la valeur du jeton figure dans ce fichier (non imprimée)`); }
    if (!trouves.length) console.log('  ✅ la valeur du jeton ne figure dans aucun fichier suivi');
} catch (e) {
    bloque = true; echecs++;
    console.log(`  ❌ ${e.message}`);
}
valeur = null;

console.log('\n=== Syntaxe : aucun repli non vide dans les .js/.mjs/.cjs ===');
const fichiers = parcourir(__dirname);
console.log(`  (${fichiers.length} fichiers parcourus)`);
verifier('le parcours a vu des fichiers', fichiers.length > 100);
let infractions = 0;
for (const f of fichiers) {
    for (const { ligne } of controleSyntaxe(fs.readFileSync(f, 'utf8'))) {
        infractions++; echecs++;
        console.log(`  ❌ ${path.relative(__dirname, f)}:${ligne} : repli non vide pour le jeton (littéral non imprimé)`);
    }
}
if (!infractions) console.log('  ✅ aucun repli non vide du jeton');

console.log(`\n${echecs ? '❌' : '✅'} ${echecs} échec(s)${bloque ? ' (je ne peux pas conclure)' : ''}`);
process.exit(echecs ? 1 : 0);
