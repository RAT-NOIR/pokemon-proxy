// Banc : aucun .js du dépôt ne porte un REPLI NON VIDE pour le jeton de l'API (JETON_API suivi de || ou ?? puis un littéral non vide).
// Un repli VIDE (|| '') est accepté : le serveur ferme alors les routes protégées (jeton-api.js), il n'ouvre rien.
// Décision du testeur (2026-10-12) : les scripts de banc passent par la variable d'environnement, jamais par une valeur en dur.
// Exclus : node_modules, "extension v2", userscript-apprentissage.js, .git, .banc-local (hors périmètre de la décision).
// Ce banc imprime fichier:ligne, JAMAIS le littéral.
const fs = require('fs');
const path = require('path');

const EXCLUS_DOSSIERS = new Set(['node_modules', 'extension v2', '.git', '.banc-local']);
const EXCLUS_FICHIERS = new Set(['userscript-apprentissage.js']);

// JETON_API (éventuellement entre crochets/guillemets) puis || ou ??, puis un guillemet ouvrant NON immédiatement refermé.
const MOTIF = /JETON_API['"\]\s]*(?:\|\||\?\?)\s*(['"`])(?!\1)/;

function ligneEnInfraction(ligne) { return MOTIF.test(ligne); }

function parcourir(dossier, sortie = []) {
    for (const e of fs.readdirSync(dossier, { withFileTypes: true })) {
        if (e.isDirectory()) {
            if (EXCLUS_DOSSIERS.has(e.name)) continue;
            parcourir(path.join(dossier, e.name), sortie);
        } else if (e.isFile() && e.name.endsWith('.js') && !EXCLUS_FICHIERS.has(e.name)) {
            sortie.push(path.join(dossier, e.name));
        }
    }
    return sortie;
}

let echecs = 0;
function verifier(libelle, ok) {
    if (!ok) echecs++;
    console.log(`  ${ok ? '✅' : '❌'} ${libelle}`);
}

// 1. La garde sait dire NON et OUI (cas fabriqués en mémoire, littéraux assemblés pour que CE fichier ne les porte pas).
console.log('=== La garde sait dire NON / OUI (cas fabriqués) ===');
const J = 'JETON' + '_API';
const cas = (op, q, contenu) => `const x = process.env.${J} ${op} ${q}${contenu}${q};`;
verifier('refuse || avec apostrophes', ligneEnInfraction(cas('||', "'", 'abc')));
verifier('refuse || avec guillemets', ligneEnInfraction(cas('||', '"', 'abc')));
verifier('refuse || avec backtick', ligneEnInfraction(cas('||', '`', 'abc')));
verifier('refuse ?? avec apostrophes', ligneEnInfraction(cas('??', "'", 'abc')));
verifier('refuse ?? avec guillemets', ligneEnInfraction(cas('??', '"', 'abc')));
verifier('refuse ?? avec backtick', ligneEnInfraction(cas('??', '`', 'abc')));
verifier('refuse la forme process.env[...]', ligneEnInfraction(`const x = process.env['${J}'] || 'abc';`));
verifier('accepte || vide (apostrophes)', !ligneEnInfraction(cas('||', "'", '')));
verifier('accepte || vide (guillemets)', !ligneEnInfraction(cas('||', '"', '')));
verifier('accepte ?? vide (backtick)', !ligneEnInfraction(cas('??', '`', '')));
verifier('accepte la lecture sans repli', !ligneEnInfraction(`const x = process.env.${J};`));

// 2. Le dépôt.
console.log('\n=== Le dépôt ===');
const fichiers = parcourir(__dirname);
console.log(`  (${fichiers.length} fichiers .js parcourus)`);
verifier('le parcours a vu des fichiers', fichiers.length > 100);
let infractions = 0;
for (const f of fichiers) {
    const lignes = fs.readFileSync(f, 'utf8').split('\n');
    lignes.forEach((l, i) => {
        if (ligneEnInfraction(l)) {
            infractions++;
            echecs++;
            console.log(`  ❌ ${path.relative(__dirname, f)}:${i + 1} : repli non vide pour le jeton (littéral non imprimé)`);
        }
    });
}
if (!infractions) console.log('  ✅ aucun repli non vide du jeton');

console.log(`\n${echecs ? '❌' : '✅'} ${echecs} échec(s)`);
process.exit(echecs ? 1 : 0);
