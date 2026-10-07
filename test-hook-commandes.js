// Banc du hook PreToolUse (.claude/hooks/refuser-commandes.js) : il doit dire NON aux commandes interdites et OUI aux autres,
// par le VRAI chemin (un processus node lancé comme Claude Code le lance, JSON sur stdin, code de sortie lu).
const { spawnSync } = require('child_process');
const path = require('path');
const HOOK = path.join(__dirname, '.claude', 'hooks', 'refuser-commandes.js');

function lancer(entree) {
    const r = spawnSync(process.execPath, [HOOK], { input: entree, encoding: 'utf8' });
    return { code: r.status, err: r.stderr };
}
const ps = command => JSON.stringify({ tool_name: 'PowerShell', tool_input: { command } });

const CAS = [
    // [libellé, entrée, code attendu]
    ['Get-Content', ps('Get-Content fichier.txt -TotalCount 3'), 2],
    ['get-content en minuscules', ps('get-content x.json | Measure-Object -Line'), 2],
    ['Get-Content dans un pipeline', ps('$a = 1; Get-Content x | Out-Null'), 2],
    ['alias gc', ps('gc .env'), 2],
    ['alias cat après un ;', ps('cd x; cat package.json'), 2],
    ['alias type', ps('type README.md'), 2],
    ['Out-File', ps('"x" | Out-File a.txt -Encoding utf8'), 2],
    ['python -c', ps('python -c "print(1)"'), 2],
    ['python3 -c', ps('python3 -c "import os"'), 2],
    ['py -c', ps('py -c "1"'), 2],
    ['python -I -c', ps('python -I -c "1"'), 2],
    ['node -e', ps('node -e "console.log(1)"'), 2],
    ['node.exe -e', ps('node.exe -e 1'), 2],
    ['node --eval', ps('node --eval "1"'), 2],
    ['node -p', ps('node -p "1+1"'), 2],
    ['Bash : node -e', JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'node -e "1"' } }), 2],
    ['entrée illisible', 'pas du json', 2],
    ['PowerShell sans commande', JSON.stringify({ tool_name: 'PowerShell', tool_input: {} }), 2],
    // ce qui DOIT passer
    ['node script.js', ps('node mesure-catalogue.js --export=x.json'), 0],
    ['node avec --enable-source-maps', ps('node --enable-source-maps lot-additif.js'), 0],
    ['git commit -F', ps('& $g commit -q -F msg.txt'), 0],
    ['Get-ChildItem', ps('Get-ChildItem "$env:LOCALAPPDATA\\GitHubDesktop" -Filter app-*'), 0],
    ['Set-Location ailleurs que la tête', ps('Write-Output category'), 0],
    ['npm test', ps('npm test'), 0],
    ['outil Read (hors périmètre)', JSON.stringify({ tool_name: 'Read', tool_input: { file_path: 'x' } }), 0],
];

let ok = 0, ko = 0;
for (const [lib, entree, attendu] of CAS) {
    const r = lancer(entree);
    const bon = r.code === attendu;
    bon ? ok++ : ko++;
    console.log(`${bon ? '✅' : '🔴'} ${lib.padEnd(34)} code ${r.code} (attendu ${attendu})${!bon && r.err ? ' · ' + r.err.trim() : ''}`);
}
console.log(`\n${ok}/${CAS.length} cas justes${ko ? ` — ${ko} en échec` : ''}`);
process.exit(ko ? 1 : 0);
