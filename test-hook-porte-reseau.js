// Banc du hook PreToolUse de la porte réseau (.claude/hooks/porte-reseau.js), par le VRAI chemin : un processus node, JSON sur stdin, code de sortie lu (2 = refus).
// Scripts temporaires dans un dossier temporaire (hors dépôt, donc non suivis par git) ; dossiers de la porte et des arrêts TEMPORAIRES (variables d'environnement) ; aucune requête réseau.
// Tour 1 de correction : les attaques de la relecture (RELECTURE-1.md) sont des cas ici.
const { spawnSync, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const HOOK = path.join(__dirname, '.claude', 'hooks', 'porte-reseau.js');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'hook-porte-'));
const PORTE = path.join(TMP, 'porte'), ARRETS = path.join(TMP, 'arrets');
fs.mkdirSync(PORTE); fs.mkdirSync(ARRETS);
const ENV = { ...process.env, PORTE_RESEAU_DOSSIER: PORTE, ARRETS_HOTES_DOSSIER: ARRETS };

function lancer(entree, preload) {
    const args = preload ? ['-r', preload, HOOK] : [HOOK];
    const r = spawnSync(process.execPath, args, { input: entree, encoding: 'utf8', env: ENV });
    return { code: r.status, err: r.stderr };
}
const ps = (command, cwd) => JSON.stringify({ tool_name: 'PowerShell', tool_input: { command }, ...(cwd ? { cwd } : {}) });
const bash = (command, cwd) => JSON.stringify({ tool_name: 'Bash', tool_input: { command }, ...(cwd ? { cwd } : {}) });
const outil = (tool_name, tool_input) => JSON.stringify({ tool_name, tool_input });
const ecrire = (nom, texte) => { const f = path.join(TMP, nom); fs.writeFileSync(f, texte); return f; };
const G = '$g = (Get-ChildItem "$env:LOCALAPPDATA\\GitHubDesktop" -Filter \'app-*\' -Directory | Sort-Object Name -Descending | Select-Object -First 1).FullName + \'\\resources\\app\\git\\cmd\\git.exe\'';

ecrire('reseau.js', "fetch('https://exemple.test/x').then(r => r.text());\n");
ecrire('http.js', "const https = require('https'); https.get('https://exemple.test');\n");
ecrire('axios.js', "import axios from 'axios';\naxios.get('https://exemple.test');\n");
ecrire('socket.js', "require('net').connect(80, 'exemple.test');\nconst net = require('net'); net.connect(80);\n");
ecrire('conn.js', "require('net').createConnection(80, 'exemple.test');\n");
ecrire('cp.js', "require('child_process').execSync('curl https://exemple.test');\n");
ecrire('ws.js', "new WebSocket('wss://exemple.test');\n");
ecrire('dyn.js', "import('node:https').then(m => m.get('https://exemple.test'));\n");
ecrire('xhr.js', "new XMLHttpRequest();\n");
ecrire('faux-autorise.js', "const _x = 'porte-reseau';\nfetch('https://evil.test');\n");
ecrire('poli.js', `const P = require(${JSON.stringify(path.join(__dirname, 'collecte-cartes', 'porte-reseau'))});\nfetch('https://exemple.test');\n`);
ecrire('poli2.js', "const RH = require('./collecte-cartes/reponse-hote');\nfetch('x');\n");
ecrire('sans.js', "console.log(1 + 1);\n");
ecrire('requetes.py', "import requests\nrequests.get('https://exemple.test')\n");
ecrire('urllib.py', "from urllib.request import urlopen\nurlopen('https://exemple.test')\n");
ecrire('urllib3.py', "import urllib3\n");
ecrire('sock.py', "import socket\n");
ecrire('hc.py', "import http.client\n");
ecrire('propre.py', "print(1)\n");
ecrire('get.ps1', "Invoke-WebRequest https://exemple.test\n");
ecrire('neutre.ps1', "Write-Output 1\n");
fs.mkdirSync(path.join(TMP, 'sous'), { recursive: true }); fs.writeFileSync(path.join(TMP, 'sous', 'net.js'), "fetch('https://exemple.test');\n");

const arret = path.join(ARRETS, 'ARRET-HOTE-x.test.json');
const CAS = [
    // [libellé, entrée, code attendu]
    // ── H6 : fermé par défaut ──
    ['WebFetch toujours refusé', outil('WebFetch', { url: 'https://exemple.test', prompt: 'x' }), 2],
    ['webfetch en minuscules', outil('webfetch', { url: 'https://exemple.test' }), 2],
    ['WEBFETCH en majuscules', outil('WEBFETCH', {}), 2],
    ['WebSearch : outil non prévu = refus', outil('WebSearch', { query: 'x' }), 2],
    ['Read : outil non prévu = refus', outil('Read', { file_path: 'x' }), 2],
    ['mcp__claude-in-chrome__', outil('mcp__claude-in-chrome__navigate', { url: 'https://x' }), 2],
    ['mcp__Claude_Browser__', outil('mcp__Claude_Browser__open', {}), 2],
    ['mcp__remote-devices__', outil('mcp__remote-devices__x', {}), 2],
    ['entrée null', 'null', 2],
    ['entrée nombre', '5', 2],
    ['entrée tableau', '[]', 2],
    ['objet sans tool_name', '{}', 2],
    ['entrée illisible', 'pas du json', 2],
    ['PowerShell sans commande', outil('PowerShell', {}), 2],
    // ── D4 : le dossier de la porte et les arrêts ne s'écrivent pas ──
    ['Write vers un ARRET-HOTE', outil('Write', { file_path: arret, content: '{}' }), 2],
    ['Edit d\'un LEVEE-HOTE n\'importe où', outil('Edit', { file_path: path.join(TMP, 'LEVEE-HOTE-a.json'), old_string: 'a', new_string: 'b' }), 2],
    ['Write vers un PAUSE-HOTE', outil('Write', { file_path: path.join(ARRETS, 'PAUSE-HOTE-a.json'), content: '{}' }), 2],
    ['Write dans robots\\ de la porte', outil('Write', { file_path: path.join(PORTE, 'robots', 'h.test.json'), content: '{}' }), 2],
    ['Write dans cadence\\ de la porte', outil('Write', { file_path: path.join(PORTE, 'cadence', 'h.json'), content: '{}' }), 2],
    ['Write du journal de la porte', outil('Write', { file_path: path.join(PORTE, 'journal.jsonl'), content: '' }), 2],
    ['NotebookEdit vers un ARRET-HOTE', outil('NotebookEdit', { notebook_path: arret }), 2],
    ['Write sans file_path', outil('Write', { content: 'x' }), 2],
    ['Write ordinaire', outil('Write', { file_path: path.join(TMP, 'notes.txt'), content: 'x' }), 0],
    ['Write dans sorties\\ de la porte', outil('Write', { file_path: path.join(PORTE, 'sorties', 'a.txt'), content: 'x' }), 0],
    ['Remove-Item d\'un ARRET', ps(`Remove-Item "${arret}"`), 2],
    ['del d\'un LEVEE', ps(`del ${path.join(TMP, 'LEVEE-HOTE-a.json')}`), 2],
    ['Set-Content dans robots\\', ps(`Set-Content ${path.join(PORTE, 'robots', 'h.test.json')} "{}"`), 2],
    ['redirection vers le journal', ps(`"x" > ${path.join(PORTE, 'journal.jsonl')}`), 2],
    ['Copy-Item vers les arrêts', ps(`Copy-Item a.json ${path.join(ARRETS, 'ARRET-HOTE-y.json')}`), 2],
    ['Move-Item vers cadence\\', ps(`Move-Item a.json ${path.join(PORTE, 'cadence', 'x.json')}`), 2],
    ['Bash : rm d\'un ARRET', bash(`rm ${arret}`), 2],
    ['lecture du dossier des arrêts', ps(`Get-ChildItem ${ARRETS}`), 0],
    // ── H1 : contournements littéraux ──
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
    ['TcpClient', ps('[System.Net.Sockets.TcpClient]::new("x", 80)'), 2],
    ['UdpClient', ps('New-Object System.Net.Sockets.UdpClient'), 2],
    ['MSXML2.XMLHTTP', ps('New-Object -ComObject MSXML2.XMLHTTP'), 2],
    ['WinHttp', ps('New-Object -ComObject WinHttp.WinHttpRequest.5.1'), 2],
    ['Test-NetConnection', ps('Test-NetConnection x -Port 80'), 2],
    ['Invoke-Expression toujours', ps('Invoke-Expression (Get-Process)'), 2],
    ['iex toujours', ps('iex (Get-Process)'), 2],
    ['-EncodedCommand', ps('powershell -EncodedCommand SQBXAFIA'), 2],
    ['pwsh -enc', ps('pwsh -enc SQBXAFIA'), 2],
    ['& (concaténation)', ps("& ('cu'+'rl.exe') https://x"), 2],
    ['$g redéfini en curl', ps("$g='curl.exe'; & $g https://x"), 2],
    ['& $x non résolu', ps('& $x https://y'), 2],
    ['& $g sans définition', ps('& $g status'), 2],
    ['& $g redéfini après la bonne définition', ps(`${G}; $g='curl.exe'; & $g https://x`), 2],
    ['Start-Process vers curl', ps('Start-Process curl -ArgumentList https://x'), 2],
    ['ssh', ps('ssh user@x'), 2],
    ['scp', ps('scp a user@x:b'), 2],
    ['nc', ps('nc x 80'), 2],
    ['telnet', ps('telnet x 80'), 2],
    ['ftp', ps('ftp x'), 2],
    ['npx', ps('npx tsx net.ts'), 2],
    ['npm exec', ps('npm exec foo'), 2],
    ['pnpm dlx', ps('pnpm dlx foo'), 2],
    ['yarn dlx', ps('yarn dlx foo'), 2],
    ['deno', ps('deno run a.ts'), 2],
    ['bun', ps('bun run a.ts'), 2],
    ['ruby', ps('ruby a.rb'), 2],
    ['perl', ps('perl a.pl'), 2],
    ['php', ps('php a.php'), 2],
    ['wsl', ps('wsl curl x'), 2],
    ['curl derrière un git (une instruction par morceau)', ps('git status; curl https://x'), 2],
    ['chaîne littérale « curl.exe »', ps('Write-Output "curl.exe"'), 2],
    ['.ps1 introuvable (non résolu)', ps('.\\get-absent.ps1'), 2],
    ['powershell -File d\'un .ps1 avec réseau, non suivi', ps(`powershell -File ${path.join(TMP, 'get.ps1')}`), 2],
    ['& .ps1 avec réseau, non suivi', ps(`& ${path.join(TMP, 'get.ps1')}`), 2],
    ['.ps1 sans réseau', ps(`powershell -File ${path.join(TMP, 'neutre.ps1')}`), 0],
    // ── H3 : python ──
    ['python script qui importe requests', ps(`python ${path.join(TMP, 'requetes.py')}`), 2],
    ['py script qui importe urllib', ps(`py -3 ${path.join(TMP, 'urllib.py')}`), 2],
    ['python urllib3', ps(`python ${path.join(TMP, 'urllib3.py')}`), 2],
    ['python socket', ps(`python ${path.join(TMP, 'sock.py')}`), 2],
    ['python http.client', ps(`python ${path.join(TMP, 'hc.py')}`), 2],
    ['python -m http.client', ps('python -m http.client'), 2],
    ['python script introuvable', ps('python absent.py'), 2],
    ['python sans réseau', ps(`python ${path.join(TMP, 'propre.py')}`), 0],
    // ── H2 : node sur stdin / eval ──
    ['node -e', ps('node -e "1"'), 2],
    ['node --eval', ps('node --eval "1"'), 2],
    ['node -p', ps('node -p "1"'), 2],
    ['node lu sur stdin (pipe)', ps('"fetch(1)" | node'), 2],
    ['node -', ps('node -'), 2],
    ['node --input-type', ps('node --input-type=module'), 2],
    ['node < fichier', ps('node < a.js'), 2],
    // ── D2 / H4 : l'exemption d'un script à primitive réseau ──
    ['script node temporaire non suivi avec fetch', ps(`node ${path.join(TMP, 'reseau.js')}`), 2],
    ['script node non suivi avec require https', ps(`node ${path.join(TMP, 'http.js')}`), 2],
    ['script node non suivi avec import axios', ps(`node ${path.join(TMP, 'axios.js')}`), 2],
    ['script node non suivi avec net.connect', ps(`node ${path.join(TMP, 'socket.js')}`), 2],
    ['script node net.createConnection', ps(`node ${path.join(TMP, 'conn.js')}`), 2],
    ['script node child_process curl', ps(`node ${path.join(TMP, 'cp.js')}`), 2],
    ['script node WebSocket', ps(`node ${path.join(TMP, 'ws.js')}`), 2],
    ['script node import() dynamique', ps(`node ${path.join(TMP, 'dyn.js')}`), 2],
    ['script node XMLHttpRequest', ps(`node ${path.join(TMP, 'xhr.js')}`), 2],
    ['chaîne « porte-reseau » sans require : ne dispense plus', ps(`node ${path.join(TMP, 'faux-autorise.js')}`), 2],
    ['script qui requiert porte-reseau : ne dispense plus', ps(`node ${path.join(TMP, 'poli.js')}`), 2],
    ['script qui requiert reponse-hote : ne dispense plus', ps('node poli2.js', TMP), 2],
    ['script relatif, par le cwd de l\'entrée', ps('node reseau.js', TMP), 2],
    ['node avec options avant le script', ps(`node --enable-source-maps ${path.join(TMP, 'reseau.js')}`), 2],
    ['Bash : script non suivi', bash(`node ${path.join(TMP, 'reseau.js')}`), 2],
    ['script node introuvable : non résolu = refus', ps(`node ${path.join(TMP, 'absent.js')}`), 2],
    ['script node sans extension', ps('node scriptsansextension'), 2],
    ['script node via variable d\'environnement', ps('node $env:TEMP\\net.js'), 2],
    ['script node via (Join-Path …)', ps("node (Join-Path $env:TEMP 'x.js')"), 2],
    ['cd puis script relatif : chemin incertain', ps('cd sous; node net.js', TMP), 2],
    ['écrire un .js puis l\'exécuter dans la même commande', ps(`Set-Content ${path.join(TMP, 'n2.js')} "fetch('https://evil')"; node ${path.join(TMP, 'n2.js')}`), 2],
    ['écrire un .py puis l\'exécuter (redirection)', ps(`"import requests" > ${path.join(TMP, 'n3.py')}; python ${path.join(TMP, 'n3.py')}`), 2],
    ['script node sans primitive réseau', ps(`node ${path.join(TMP, 'sans.js')}`), 0],
    ['script node sans primitive, sortie redirigée', ps(`node ${path.join(TMP, 'sans.js')} > ${path.join(TMP, 'out.txt')}`), 0],
    ['script SUIVI par git, identique à HEAD, avec fetch', ps('node smoke-test.js', __dirname), 0],
    // ── H5 : git avec une adresse ──
    ['git status', ps('git status'), 0],
    ['git fetch origin', ps('git fetch origin'), 0],
    ['git push', bash('git push origin main'), 0],
    ['& $g status avec la définition du CLAUDE.md', ps(`${G}; & $g status`), 0],
    ['& $g fetch origin avec la définition', ps(`${G}; & $g fetch origin`), 0],
    ['git clone vers un hôte quelconque', ps('git clone https://evil.test/r.git'), 2],
    ['git clone github.com', ps('git clone https://github.com/a/b.git'), 0],
    ['git fetch d\'une adresse', ps('git fetch https://evil.test/x'), 2],
    ['git pull d\'une adresse', ps('git pull https://evil.test/x main'), 2],
    ['git ls-remote', ps('git ls-remote https://evil.test/x'), 2],
    ['git archive --remote', ps('git archive --remote=ssh://evil.test/r HEAD'), 2],
    ['git submodule add', ps('git submodule add https://evil.test/x y'), 2],
    ['git remote add scp-like', ps('git remote add x git@evil.test:a/b.git'), 2],
    ['git remote set-url', ps('git remote set-url origin https://evil.test/x'), 2],
    ['git remote add github', ps('git remote add x git@github.com:a/b.git'), 0],
    ['git commit dont le message cite curl', ps('git commit -m "retire curl du script"'), 0],
    ['git commit dont le message cite une adresse', ps('git commit -m "voir https://evil.test"'), 0],
    // ── faux refus à éviter ──
    ['node -r dotenv/config script du dépôt', ps('node -r dotenv/config test-hook-commandes.js', __dirname), 0],
    ['la porte : lire (adresse avec « curl »)', ps('node collecte-cartes/porte-reseau.js lire https://x.test/curl-infos --texte --sortie=a.txt', __dirname), 0],
    ['la porte : verifier (adresse avec « irm »)', ps('node collecte-cartes/porte-reseau.js verifier https://x.test/irm/a', __dirname), 0],
    ['Get-ChildItem', ps('Get-ChildItem . -Filter *.js'), 0],
    ['npm test', ps('npm test'), 0],
];

let ok = 0, ko = 0;
function rendre(lib, code, attendu, err) {
    const bon = code === attendu;
    bon ? ok++ : ko++;
    console.log(`${bon ? '✅' : '🔴'} ${lib.padEnd(58)} code ${code} (attendu ${attendu})${!bon && err ? ' · ' + err.trim().slice(0, 160) : ''}`);
}
for (const [lib, entree, attendu] of CAS) { const r = lancer(entree); rendre(lib, r.code, attendu, r.err); }
{   // le message du refus WebFetch nomme la porte
    const r = lancer(outil('WebFetch', { url: 'https://x' }));
    const bon = /porte-reseau\.js lire <url> --texte --sortie=<fichier>/.test(r.err);
    bon ? ok++ : ko++;
    console.log(`${bon ? '✅' : '🔴'} ${'le refus WebFetch nomme la porte'.padEnd(58)} ${bon ? '' : r.err.trim().slice(0, 160)}`);
}
{   // D2 : « suivi » ne suffit pas, il faut IDENTIQUE à HEAD (un fichier suivi MODIFIÉ, un fichier seulement AJOUTÉ à l'index)
    const git = (() => { try { const base = path.join(process.env.LOCALAPPDATA || '', 'GitHubDesktop'); const a = fs.readdirSync(base).filter(n => /^app-/.test(n)).sort().reverse()[0]; return path.join(base, a, 'resources', 'app', 'git', 'cmd', 'git.exe'); } catch { return 'git'; } })();
    const suivi = path.join(__dirname, 'smoke-test.js'), original = fs.readFileSync(suivi);
    try {
        fs.writeFileSync(suivi, Buffer.concat([original, Buffer.from("\nfetch('https://n-importe-quoi');\n")]));
        const r = lancer(ps('node smoke-test.js', __dirname));
        rendre('D2 : script suivi mais MODIFIÉ (non commité)', r.code, 2, r.err);
    } finally { fs.writeFileSync(suivi, original); }
    const neuf = path.join(__dirname, 'zz-banc-hook-temp.js');
    try {
        fs.writeFileSync(neuf, "fetch('https://n-importe-quoi');\n");
        const avant = lancer(ps('node zz-banc-hook-temp.js', __dirname));
        execFileSync(git, ['add', 'zz-banc-hook-temp.js'], { cwd: __dirname, stdio: 'ignore' });
        const apres = lancer(ps('node zz-banc-hook-temp.js', __dirname));
        rendre('D2 : script non suivi', avant.code, 2, avant.err);
        rendre('D2 : script seulement AJOUTÉ à l\'index (git add)', apres.code, 2, apres.err);
    } finally {
        try { execFileSync(git, ['rm', '--cached', '-q', '-f', 'zz-banc-hook-temp.js'], { cwd: __dirname, stdio: 'ignore' }); } catch { /* jamais ajouté */ }
        try { fs.unlinkSync(neuf); } catch { /* déjà retiré */ }
    }
}
{   // UN HOOK QUI PLANTE DOIT REFUSER : toute RegExp.test lève
    const r = lancer(ps('curl https://x'), path.join(__dirname, 'test-hook-panne-simulee.js'));
    rendre('hook qui plante en plein verdict', r.code, 2, r.err);
    const r2 = lancer(ps('git status'), path.join(__dirname, 'test-hook-panne-simulee.js'));
    rendre('hook qui plante sur une commande innocente', r2.code, 2, r2.err);
}
console.log(`\n${ok}/${ok + ko} cas justes${ko ? ` — ${ko} en échec` : ''}`);
process.exit(ko ? 1 : 0);
