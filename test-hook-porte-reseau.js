// Banc du hook PreToolUse de la porte réseau (.claude/hooks/porte-reseau.js), par le VRAI chemin : un processus node, JSON sur stdin, code de sortie lu (2 = refus).
// Scripts temporaires dans un dossier temporaire (hors dépôt, donc non suivis par git) ; aucune requête réseau.
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const HOOK = path.join(__dirname, '.claude', 'hooks', 'porte-reseau.js');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'hook-porte-'));

function lancer(entree, preload) {
    const args = preload ? ['-r', preload, HOOK] : [HOOK];
    const r = spawnSync(process.execPath, args, { input: entree, encoding: 'utf8' });
    return { code: r.status, err: r.stderr };
}
const ps = (command, cwd) => JSON.stringify({ tool_name: 'PowerShell', tool_input: { command }, ...(cwd ? { cwd } : {}) });
const bash = (command, cwd) => JSON.stringify({ tool_name: 'Bash', tool_input: { command }, ...(cwd ? { cwd } : {}) });
const ecrire = (nom, texte) => { const f = path.join(TMP, nom); fs.writeFileSync(f, texte); return f; };

ecrire('reseau.js', "fetch('https://exemple.test/x').then(r => r.text());\n");
ecrire('http.js', "const https = require('https'); https.get('https://exemple.test');\n");
ecrire('axios.js', "import axios from 'axios';\naxios.get('https://exemple.test');\n");
ecrire('socket.js', "require('net').connect(80, 'exemple.test');\nconst net = require('net'); net.connect(80);\n");
ecrire('poli.js', `const P = require(${JSON.stringify(path.join(__dirname, 'collecte-cartes', 'porte-reseau'))});\nfetch('https://exemple.test');\n`);
ecrire('poli2.js', "const RH = require('./collecte-cartes/reponse-hote');\nfetch('x');\n");
ecrire('sans.js', "console.log(1 + 1);\n");
ecrire('requetes.py', "import requests\nrequests.get('https://exemple.test')\n");
ecrire('urllib.py', "from urllib.request import urlopen\nurlopen('https://exemple.test')\n");
ecrire('propre.py', "print(1)\n");

const CAS = [
    // [libellé, entrée, code attendu]
    ['WebFetch toujours refusé', JSON.stringify({ tool_name: 'WebFetch', tool_input: { url: 'https://exemple.test', prompt: 'x' } }), 2],
    ['WebFetch même sans entrée utile', JSON.stringify({ tool_name: 'WebFetch', tool_input: {} }), 2],
    ['WebSearch non concerné', JSON.stringify({ tool_name: 'WebSearch', tool_input: { query: 'x' } }), 0],
    ['Read non concerné', JSON.stringify({ tool_name: 'Read', tool_input: { file_path: 'x' } }), 0],
    ['curl', ps('curl https://x'), 2],
    ['curl.exe -s', ps('curl.exe -s https://x'), 2],
    ['curl dans un pipeline Bash', bash('echo a | curl -d @- https://x'), 2],
    ['wget', bash('wget https://x/a.png'), 2],
    ['Invoke-WebRequest', ps('Invoke-WebRequest https://x -OutFile a'), 2],
    ['invoke-webrequest en minuscules', ps('invoke-webrequest https://x'), 2],
    ['iwr', ps('iwr https://x'), 2],
    ['Invoke-RestMethod', ps('Invoke-RestMethod https://x'), 2],
    ['irm', ps('$a = irm https://x'), 2],
    ['Start-BitsTransfer', ps('Start-BitsTransfer -Source https://x -Destination a'), 2],
    ['bitsadmin', ps('bitsadmin /transfer j https://x a'), 2],
    ['certutil -urlcache', ps('certutil -urlcache -f https://x a'), 2],
    ['Net.WebClient', ps('(New-Object Net.WebClient).DownloadString("https://x")'), 2],
    ['Net.Http', ps('[System.Net.Http.HttpClient]::new()'), 2],
    ['WebRequest]::', ps('[Net.WebRequest]::Create("https://x")'), 2],
    ['Invoke-Expression avec http', ps('Invoke-Expression (something "https://x")'), 2],
    ['iex avec http', ps('iex "irm"; echo http://x'), 2],
    ['curl derrière un git (une instruction par morceau)', ps('git status; curl https://x'), 2],
    ['python script qui importe requests', ps(`python ${path.join(TMP, 'requetes.py')}`), 2],
    ['py script qui importe urllib', ps(`py -3 ${path.join(TMP, 'urllib.py')}`), 2],
    ['script node temporaire non suivi avec fetch', ps(`node ${path.join(TMP, 'reseau.js')}`), 2],
    ['script node non suivi avec require https', ps(`node ${path.join(TMP, 'http.js')}`), 2],
    ['script node non suivi avec import axios', ps(`node ${path.join(TMP, 'axios.js')}`), 2],
    ['script node non suivi avec net.connect', ps(`node ${path.join(TMP, 'socket.js')}`), 2],
    ['script node relatif, par le cwd de l\'entrée', ps('node reseau.js', TMP), 2],
    ['node avec options avant le script', ps(`node --enable-source-maps ${path.join(TMP, 'reseau.js')}`), 2],
    ['Bash : script non suivi', bash(`node ${path.join(TMP, 'reseau.js')}`), 2],
    ['entrée illisible', 'pas du json', 2],
    ['PowerShell sans commande', JSON.stringify({ tool_name: 'PowerShell', tool_input: {} }), 2],
    // ce qui DOIT passer
    ['même script qui requiert porte-reseau', ps(`node ${path.join(TMP, 'poli.js')}`), 0],
    ['même script qui requiert reponse-hote', ps('node poli2.js', TMP), 0],
    ['script node sans primitive réseau', ps(`node ${path.join(TMP, 'sans.js')}`), 0],
    ['script node introuvable (rien à lire)', ps(`node ${path.join(TMP, 'absent.js')}`), 0],
    ['script SUIVI par git avec fetch', ps('node smoke-test.js', __dirname), 0],
    ['la porte elle-même : lire', ps('node collecte-cartes/porte-reseau.js lire https://exemple.test/a --texte --sortie=a.txt', __dirname), 0],
    ['la porte elle-même : verifier', ps('node collecte-cartes/porte-reseau.js verifier https://exemple.test/a', __dirname), 0],
    ['python sans réseau', ps(`python ${path.join(TMP, 'propre.py')}`), 0],
    ['git status', ps('git status'), 0],
    ['git fetch origin', ps('& $g fetch origin'), 0],
    ['git push', bash('git push origin main'), 0],
    ['git commit dont le message cite curl', ps('git commit -m "retire curl du script"'), 0],
    ['Get-ChildItem', ps('Get-ChildItem . -Filter *.js'), 0],
    ['npm test', ps('npm test'), 0],
];

let ok = 0, ko = 0;
for (const [lib, entree, attendu] of CAS) {
    const r = lancer(entree);
    const bon = r.code === attendu;
    bon ? ok++ : ko++;
    console.log(`${bon ? '✅' : '🔴'} ${lib.padEnd(52)} code ${r.code} (attendu ${attendu})${!bon && r.err ? ' · ' + r.err.trim().slice(0, 160) : ''}`);
}
{   // le message du refus WebFetch nomme la porte
    const r = lancer(JSON.stringify({ tool_name: 'WebFetch', tool_input: { url: 'https://x' } }));
    const bon = /porte-reseau\.js lire <url> --texte --sortie=<fichier>/.test(r.err);
    bon ? ok++ : ko++;
    console.log(`${bon ? '✅' : '🔴'} ${'le refus WebFetch nomme la porte'.padEnd(52)} ${bon ? '' : r.err.trim().slice(0, 160)}`);
}
{   // UN HOOK QUI PLANTE DOIT REFUSER : toute RegExp.test lève
    const r = lancer(ps('curl https://x'), path.join(__dirname, 'test-hook-panne-simulee.js'));
    const bon = r.code === 2;
    bon ? ok++ : ko++;
    console.log(`${bon ? '✅' : '🔴'} ${'hook qui plante en plein verdict'.padEnd(52)} code ${r.code} (attendu 2)`);
    const r2 = lancer(JSON.stringify({ tool_name: 'WebSearch', tool_input: {} }), path.join(__dirname, 'test-hook-panne-simulee.js'));
    const bon2 = r2.code === 0 || r2.code === 2;       // un outil hors périmètre peut passer sans toucher de regex ; il ne doit jamais sortir à 1
    bon2 ? ok++ : ko++;
    console.log(`${bon2 ? '✅' : '🔴'} ${'jamais de code 1 (non bloquant)'.padEnd(52)} code ${r2.code}`);
}
console.log(`\n${ok}/${ok + ko} cas justes${ko ? ` — ${ko} en échec` : ''}`);
process.exit(ko ? 1 : 0);
