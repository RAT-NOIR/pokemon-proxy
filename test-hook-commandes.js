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

// LE CHEMIN DE LA CONFIGURATION (2026-10-08). Le banc ci-dessus lance node directement ; Claude Code, lui, lançait la commande
// par PowerShell (pas de Git Bash sur ce poste : c'est le shell par défaut des hooks), et `powershell -Command` rend 1 pour un
// refus à 2 — or 1 ne bloque pas. Le hook refusait, le refus se perdait, et le banc était vert. On relance donc le hook TEL QUE
// .claude/settings.json le décrit : forme exec (`args`) → l'exécutable directement ; forme shell → `powershell -Command`.
// `--reglages=<fichier>` rejoue une autre version du fichier (ex. celle d'avant le correctif, pour voir ce banc échouer).
const fs = require('fs');
const argReglages = process.argv.find(a => a.startsWith('--reglages='));
const REGLAGES = argReglages ? argReglages.slice('--reglages='.length) : path.join(__dirname, '.claude', 'settings.json');
// Le PATH est VIDÉ pour ce lancement (relecture du 2026-10-08) : un processus Claude Code lancé avec un PATH sans node verrait
// le hook échouer au démarrage — erreur non bloquante, tout passe. La commande doit donc nommer l'exécutable en chemin absolu.
function lancerCommeConfigure(h, entree) {
    const env = { ...process.env, PATH: '', Path: '' };
    const r = Array.isArray(h.args)
        ? spawnSync(h.command, h.args, { input: entree, encoding: 'utf8', env })
        : spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', h.command], { input: entree, encoding: 'utf8' });
    return { code: r.status, err: r.stderr, erreur: r.error && r.error.code };
}
// Le matcher se lit comme Claude Code le lit : « * » ou vide couvre tout, sinon une expression sur le nom de l'outil.
const couvre = (matcher, outil) => !matcher || matcher === '*' || new RegExp(`^(?:${matcher})$`).test(outil);
const groupes = JSON.parse(fs.readFileSync(REGLAGES, 'utf8')).hooks?.PreToolUse || [];
const bash = command => JSON.stringify({ tool_name: 'Bash', tool_input: { command } });
for (const [outil, enJson] of [['PowerShell', ps], ['Bash', bash]]) {
    const hooks = groupes.filter(g => couvre(g.matcher, outil)).flatMap(g => g.hooks || []).filter(h => h.type === 'command');
    if (!hooks.length) { ko++; console.log(`🔴 ${REGLAGES} : aucun hook PreToolUse de type command ne couvre ${outil}`); continue; }
    const cas = [[`${outil} Get-Content, par la config`, enJson('Get-Content fichier.txt'), 2],
        [`${outil} node script.js, par la config`, enJson('node mesure-catalogue.js'), 0]];
    for (const h of hooks) for (const [lib, entree, attendu] of cas) {
        const r = lancerCommeConfigure(h, entree);
        const bon = r.code === attendu;
        bon ? ok++ : ko++;
        console.log(`${bon ? '✅' : '🔴'} ${lib.padEnd(40)} code ${r.code} (attendu ${attendu}, forme ${Array.isArray(h.args) ? 'exec' : 'shell'})${r.erreur ? ` · lancement : ${r.erreur}` : ''}`);
    }
}

// UN HOOK QUI PLANTE DOIT REFUSER (relecture du 2026-10-08) : une exception non rattrapée sort à 1, non bloquant — le défaut
// de forme corrigé plus haut, par une autre cause. On fait lever toutes les RegExp (préchargement) et on attend 2.
{
    const r = spawnSync(process.execPath, ['-r', path.join(__dirname, 'test-hook-panne-simulee.js'), HOOK], { input: ps('Get-Content x'), encoding: 'utf8' });
    const bon = r.status === 2;
    bon ? ok++ : ko++;
    console.log(`${bon ? '✅' : '🔴'} ${'hook qui plante en plein verdict'.padEnd(40)} code ${r.status} (attendu 2)`);
}
console.log(`\n${ok}/${ok + ko} cas justes${ko ? ` — ${ko} en échec` : ''}`);
process.exit(ko ? 1 : 0);
