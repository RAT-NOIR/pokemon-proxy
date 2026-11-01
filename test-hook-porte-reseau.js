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
const PRINCIPALE = path.join(TMP, 'principale');     // I3 : la « copie principale » du banc (variable COPIE_PRINCIPALE)
const ENV = { ...process.env, PORTE_RESEAU_DOSSIER: PORTE, ARRETS_HOTES_DOSSIER: ARRETS, COPIE_PRINCIPALE: PRINCIPALE };
const GIT = (() => { try { const base = path.join(process.env.LOCALAPPDATA || '', 'GitHubDesktop'); const a = fs.readdirSync(base).filter(n => /^app-/.test(n)).sort().reverse()[0]; return path.join(base, a, 'resources', 'app', 'git', 'cmd', 'git.exe'); } catch { return 'git'; } })();

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
fs.writeFileSync(path.join(TMP, 'sous', 'ok.js'), "console.log('ok');\n");
ecrire('sub.py', "import subprocess\n"); ecrire('fh.py', "from http import client\n"); ecrire('rq2.py', "import requests as r\n"); ecrire('hx.py', "import httpx\n");
ecrire('alias1.js', "const get = fetch;\nget('https://exemple.test');\n"); ecrire('alias2.js', "globalThis.fetch('https://exemple.test');\n"); ecrire('alias3.js', "globalThis[\"fetch\"]('https://exemple.test');\n");
ecrire('verrou-a.js', "console.log('a');\n"); ecrire('verrou-b.js', "console.log('b');\n"); ecrire('sonde.js', "const { MongoClient } = require('mongodb');\n"); ecrire('lignes-zh.js', "console.log('zh');\n"); ecrire('eveil.ps1', "Start-Sleep 1\n");
// C3 : un VRAI worktree temporaire du dépôt (checkout réduit à trois fichiers suivis) et un dépôt ÉTRANGER
const WT = path.join(TMP, 'wt'), ETR = path.join(TMP, 'etranger');
execFileSync(GIT, ['worktree', 'add', '-q', '--no-checkout', '--detach', WT, 'HEAD'], { cwd: __dirname, stdio: 'ignore' });
execFileSync(GIT, ['checkout', 'HEAD', '--', 'smoke-test.js', 'test-hook-commandes.js', 'test-hook-panne-simulee.js'], { cwd: WT, stdio: 'ignore' });
fs.mkdirSync(ETR); execFileSync(GIT, ['init', '-q'], { cwd: ETR, stdio: 'ignore' });
fs.writeFileSync(path.join(ETR, 'etr.js'), "fetch('https://exemple.test');\n");
execFileSync(GIT, ['add', 'etr.js'], { cwd: ETR, stdio: 'ignore' });
execFileSync(GIT, ['-c', 'user.name=banc', '-c', 'user.email=banc@exemple.test', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'x'], { cwd: ETR, stdio: 'ignore' });
function nettoyerWorktree() {      // règle commune : jamais de suppression récursive sur un dossier qui contient une jonction ou un lien
    const liens = []; const marcher = d => { for (const n of fs.readdirSync(d)) { const p = path.join(d, n), s = fs.lstatSync(p); if (s.isSymbolicLink()) liens.push(p); else if (s.isDirectory()) marcher(p); } };
    try { marcher(WT); } catch { /* déjà retiré */ }
    if (liens.length) { console.log(`⚠️ worktree temporaire laissé en place (liens : ${liens.join(', ')})`); return; }
    try { fs.rmSync(WT, { recursive: true, force: true }); } catch { /* déjà retiré */ }
    try { execFileSync(GIT, ['worktree', 'prune'], { cwd: __dirname, stdio: 'ignore' }); } catch { /* rien à élaguer */ }
}
const alias = dir => {      // M1 : un nom court 8.3 réel si le système en fournit un, sinon une jonction temporaire vers un dossier SANS données (retirée par rmdir non récursif)
    const r = spawnSync('cmd', ['/d', '/c', `for %I in ("${dir}") do @echo %~sI`], { encoding: 'utf8', windowsVerbatimArguments: true });
    const court = (r.stdout || '').trim();
    if (court && court.toLowerCase() !== dir.toLowerCase() && court.includes('~')) return { chemin: court, nettoyer() {} };
    const lien = `${dir}-lien`; spawnSync('cmd', ['/d', '/c', 'mklink', '/J', lien, dir], { encoding: 'utf8' });
    return { chemin: lien, nettoyer() { spawnSync('cmd', ['/d', '/c', 'rmdir', lien]); } };
};
const T = TMP;

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
    ['I1 : chaîne en position de COMMANDE & \'curl.exe\'', ps("& 'curl.exe' https://x"), 2],
    ['I1 : chaîne en position de commande & "wget"', ps('& "wget" https://x'), 2],
    ['I1 : chaîne en position de commande ."curl"', ps('."curl" https://x'), 2],
    ['I1 : chaîne ARGUMENT contenant curl.exe : passe', ps('Write-Output "curl.exe"'), 0],
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
    // ═══ TOUR 2 ═══
    // ── C1 : seuls ARRET/LEVEE/PAUSE-HOTE sont protégés dans le dossier des arrêts ──
    ['C1 : Write de arrets\\JOURNAL-HOTES.md', outil('Write', { file_path: path.join(ARRETS, 'JOURNAL-HOTES.md'), content: 'x' }), 0],
    ['C1 : Edit de arrets\\JOURNAL-HOTES.md', outil('Edit', { file_path: path.join(ARRETS, 'JOURNAL-HOTES.md'), old_string: 'a', new_string: 'b' }), 0],
    ['C1 : Add-Content de arrets\\JOURNAL-HOTES.md', ps(`Add-Content ${path.join(ARRETS, 'JOURNAL-HOTES.md')} "ligne"`), 0],
    ['C1 : listage du dossier des arrêts redirigé vers un fichier ordinaire', ps(`Get-ChildItem ${ARRETS} > ${T}\\liste.txt`), 0],
    ['C1 : Get-ChildItem du dossier des arrêts', ps(`Get-ChildItem ${ARRETS}`), 0],
    // ── C2 : cd résolu en tête d'instruction ──
    ['C2 : cd absolu puis script sans primitive', ps(`cd ${path.join(T, 'sous')}; node ok.js`), 0],
    ['C2 : cd relatif (cwd de l\'entrée) puis script', ps('cd sous; node ok.js', T), 0],
    ['C2 : Set-Location -Path', ps('Set-Location -Path sous; node ok.js', T), 0],
    ['C2 : pushd', ps('pushd sous; node ok.js', T), 0],
    ['C2 : cd entre guillemets', ps('cd "sous"; node ok.js', T), 0],
    ['C2 : cd résolu puis script à primitive non suivi', ps('cd sous; node net.js', T), 2],
    ['C2 : cd vers un dossier inexistant + script à primitive', ps('cd absent; node reseau.js', T), 2],
    ['C2 : cd vers un dossier inexistant + script sans primitive', ps('cd absent; node sans.js', T), 0],
    ['C2 : cd dans un bloc & { }', ps('& { cd sous; node net.js }', T), 2],
    ['C2 : cd dans un if { }', ps('if ($true) { cd sous }; node reseau.js', T), 2],
    ['C2 : cd -', ps('cd -; node reseau.js', T), 2],
    ['C2 : cd par variable', ps('cd $env:TEMP; node reseau.js', T), 2],
    ['C2 : Pop-Location', ps('Pop-Location; node reseau.js', T), 2],
    ['C2 : cd caché dans un if + script SUIVI du cwd : dossier incertain', ps('if ($true) { cd sous }; node smoke-test.js', WT), 2],
    ['C2 : cd vers un dossier inexistant + script SUIVI du cwd', ps('cd absent; node smoke-test.js', WT), 2],
    ['C2 : cd caché par cmd /c + script SUIVI du cwd', ps('cmd /c "cd sous"; node smoke-test.js', WT), 2],
    ['C2 : cmd /c "cd … && node …"', ps('cmd /c "cd sous && node net.js"', T), 2],
    // ── C3 : worktree du même dépôt ──
    ['C3 : script du worktree (suivi, identique à son HEAD), cwd = worktree', ps('node smoke-test.js', WT), 0],
    ['C3 : script du worktree par chemin absolu', ps(`node ${path.join(WT, 'smoke-test.js')}`, T), 0],
    ['C3 : cd vers le worktree puis script à child_process', ps(`cd ${WT}; node -r dotenv/config test-hook-commandes.js`), 0],
    ['C3 : script d\'un dépôt ÉTRANGER (suivi, identique à son HEAD)', ps('node etr.js', ETR), 2],
    // ── I1 : les chaînes qui sont des arguments ne sont pas des commandes ──
    ['I1 : message de commit en here-string multi-lignes', ps(`${G}; & $g commit -q -m @'\nCorrige le curl\nssh et nc cités ici\n'@`), 0],
    ['I1 : here-string double', ps(`git commit -m @"\nwget partout\n"@`), 0],
    ['I1 : -m "a; curl; b"', ps('git commit -m "a; curl; b"'), 0],
    ['I1 : argument entre guillemets simples', ps("Write-Output 'nc et ssh'"), 0],
    ['I1 : l\'outil réel après la chaîne reste vu', ps('Write-Output "x"; curl https://x'), 2],
    // ── I3 : la copie principale (hook, porte, reponse-hote) ne se réécrit pas ──
    ['I3 : Write de .claude\\hooks\\porte-reseau.js (copie principale)', outil('Write', { file_path: path.join(PRINCIPALE, '.claude', 'hooks', 'porte-reseau.js'), content: 'x' }), 2],
    ['I3 : Edit de .claude\\hooks\\* quelconque', outil('Edit', { file_path: path.join(PRINCIPALE, '.claude', 'hooks', 'autre.js'), old_string: 'a', new_string: 'b' }), 2],
    ['I3 : Write de collecte-cartes\\porte-reseau.js', outil('Write', { file_path: path.join(PRINCIPALE, 'collecte-cartes', 'porte-reseau.js'), content: 'x' }), 2],
    ['I3 : Write de collecte-cartes\\reponse-hote.js', outil('Write', { file_path: path.join(PRINCIPALE, 'collecte-cartes', 'reponse-hote.js'), content: 'x' }), 2],
    ['I3 : NotebookEdit sous .claude\\hooks', outil('NotebookEdit', { notebook_path: path.join(PRINCIPALE, '.claude', 'hooks', 'n.ipynb') }), 2],
    ['I3 : casse différente', outil('Write', { file_path: path.join(PRINCIPALE, '.CLAUDE', 'HOOKS', 'x.js'), content: 'x' }), 2],
    ['I3 : .claude\\settings.json N\'est PAS protégé', outil('Write', { file_path: path.join(PRINCIPALE, '.claude', 'settings.json'), content: '{}' }), 0],
    ['I3 : .claude\\settings.local.json non protégé', outil('Write', { file_path: path.join(PRINCIPALE, '.claude', 'settings.local.json'), content: '{}' }), 0],
    ['I3 : un autre fichier de la copie principale', outil('Write', { file_path: path.join(PRINCIPALE, 'collecte-cartes', 'autre.js'), content: 'x' }), 0],
    ['I3 : le hook d\'un worktree reste modifiable', outil('Write', { file_path: path.join(WT, '.claude', 'hooks', 'porte-reseau.js'), content: 'x' }), 0],
    // ── M4 ──
    ['M4 : pip install', ps('pip install requests'), 2],
    ['M4 : pip3 download', ps('pip3 download x'), 2],
    ['M4 : python -m pip install', ps('python -m pip install x'), 2],
    ['M4 : gh api', ps('gh api repos/x/y'), 2],
    ['M4 : gh pr list', ps('gh pr list'), 2],
    ['M4 : gh --version passe', ps('gh --version'), 0],
    ['M4 : docker pull', ps('docker pull x'), 2],
    ['M4 : docker run', ps('docker run x'), 2],
    ['M4 : docker build', ps('docker build .'), 2],
    ['M4 : winget', ps('winget install x'), 2],
    ['M4 : choco', ps('choco install x'), 2],
    ['M4 : scoop', ps('scoop install x'), 2],
    ['M4 : Start-Process avec adresse', ps('Start-Process https://x'), 2],
    ['M4 : saps avec adresse', ps('saps "https://x"'), 2],
    ['M4 : Invoke-Item avec adresse', ps('Invoke-Item https://x'), 2],
    ['M4 : ii avec adresse', ps('ii https://x'), 2],
    ['M4 : Resolve-DnsName', ps('Resolve-DnsName x.test'), 2],
    ['M4 : nslookup', ps('nslookup x.test'), 2],
    ['M4 : ping', ps('ping x.test'), 2],
    ['M4 : python subprocess', ps(`python ${path.join(T, 'sub.py')}`), 2],
    ['M4 : python from http import', ps(`python ${path.join(T, 'fh.py')}`), 2],
    ['M4 : python import requests as r', ps(`python ${path.join(T, 'rq2.py')}`), 2],
    ['M4 : python import httpx', ps(`python ${path.join(T, 'hx.py')}`), 2],
    ['M4 : node alias de fetch (= fetch)', ps(`node ${path.join(T, 'alias1.js')}`), 2],
    ['M4 : node globalThis.fetch', ps(`node ${path.join(T, 'alias2.js')}`), 2],
    ['M4 : node globalThis["fetch"]', ps(`node ${path.join(T, 'alias3.js')}`), 2],
    ['M4 : git pull sans adresse passe', ps('git pull'), 0],
    ['M4 : git submodule update sans adresse passe', ps('git submodule update --init'), 0],
    ['M4 : npm run passe', ps('npm run test'), 0],
    ['M4 : git fetch origin passe', ps('git fetch origin'), 0],
    // ── 12. LES DIX COMMANDES RÉELLES DU COORDINATEUR (COMMANDES-REELLES.txt) : TOUTES doivent PASSER ──
    ['RÉELLE 1 : fetch / log / push avec $g et cd', ps(`${G}; cd ${__dirname}; & $g fetch -q origin; & $g log --oneline main..origin/main; & $g push origin main; "push $LASTEXITCODE"`), 0],
    ['RÉELLE 2 : cd worktree; node -r dotenv/config <script à child_process>', ps(`cd ${WT}; $env:NODE_PATH='C:\\x\\node_modules'; $env:DOTENV_CONFIG_PATH='C:\\x\\.env'; node -r dotenv/config test-hook-commandes.js --quoi="logos preuve lue" --collections=sets -- node poser-niveau-logos.js --preuve-lue=collecte-cartes/logos-preuves-lues.json --ecrire --attendu=148; "exit $LASTEXITCODE"`), 0],
    ['RÉELLE 3 : cd; verrou-charges | verrou-avant-push', ps(`cd ${T}; $env:NODE_PATH='C:\\x\\node_modules'; node verrou-a.js --base=test | Select-Object -Last 3; "charges exit=$LASTEXITCODE"; node verrou-b.js | Select-Object -Last 5`), 0],
    ['RÉELLE 4 : sonde Mongo du scratchpad', ps(`cd ${__dirname}; $env:NODE_PATH='C:\\x\\node_modules'; $env:DOTENV_CONFIG_PATH='C:\\x\\.env'; node -r dotenv/config ${path.join(T, 'sonde.js')} 6704 6922`), 0],
    ['RÉELLE 5 : script du scratchpad', ps(`node ${path.join(T, 'lignes-zh.js')}`), 0],
    ['RÉELLE 6 : cd worktree; test; git add; git commit', ps(`${G}; cd ${WT}; $env:NODE_PATH='C:\\x\\node_modules'; node test-hook-panne-simulee.js | Select-Object -Last 3; & $g add creer-sets-sans-page.js JOURNAL-LOTS.md; & $g commit -q -m "Sets ... (signal du site)"`), 0],
    ['RÉELLE 7 : git worktree add', ps(`${G}; & $g worktree add -q -b catalogue/x ${path.join(T, 'c-x')} main`), 0],
    ['RÉELLE 8 : powershell -File eveil.ps1', ps(`powershell -NoProfile -ExecutionPolicy Bypass -File ${path.join(T, 'eveil.ps1')} -Heures 8`), 0],
    ['RÉELLE 9 : git clone github.com', ps(`${G}; & $g clone --depth 1 --quiet https://github.com/tcgdex/cards-database.git ${path.join(T, 'cards-database')}`), 0],
    ['RÉELLE 10 : la porte lire', ps(`node collecte-cartes/porte-reseau.js lire https://www.example.org/page --texte --sortie=${path.join(PORTE, 'sorties', 'x.txt')}`, __dirname), 0],
    ['RÉELLE : Write de RAPPORT-CATALOGUE.md (sous catalogue\\)', outil('Write', { file_path: path.join(T, 'catalogue-fictif', 'RAPPORT-CATALOGUE.md'), content: 'x' }), 0],
    ['RÉELLE : Write de DEMANDE-CATALOGUE.md (site)', outil('Write', { file_path: path.join(T, 'rat-market-site', 'DEMANDE-CATALOGUE.md'), content: 'x' }), 0],
    ['RÉELLE : Write dans le scratchpad', outil('Write', { file_path: path.join(T, 'scratchpad', 'a.js'), content: 'x' }), 0],
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
{   // C3 : dans le worktree, « suivi » ne suffit pas non plus : modifié = refusé
    const f = path.join(WT, 'smoke-test.js'), original = fs.readFileSync(f);
    try {
        fs.writeFileSync(f, Buffer.concat([original, Buffer.from("\nfetch('https://n-importe-quoi');\n")]));
        const r = lancer(ps('node smoke-test.js', WT));
        rendre('C3 : script du worktree MODIFIÉ (non commité)', r.code, 2, r.err);
    } finally { fs.writeFileSync(f, original); }
}
{   // M1 : noms courts / jonction : la protection juge le chemin RÉEL
    const ap = alias(PORTE), aa = alias(ARRETS);
    try {
        rendre(`M1 : Write dans robots\\ par ${ap.chemin}`, lancer(outil('Write', { file_path: path.join(ap.chemin, 'robots', 'h.test.json'), content: '{}' })).code, 2);
        rendre('M1 : Write dans cadence\\ par un nom court/lien', lancer(outil('Write', { file_path: path.join(ap.chemin, 'cadence', 'h.json'), content: '{}' })).code, 2);
        rendre('M1 : Write du journal par un nom court/lien', lancer(outil('Write', { file_path: path.join(ap.chemin, 'journal.jsonl'), content: '' })).code, 2);
        rendre('M1 : Write de JOURNAL-HOTES.md par un nom court/lien reste permis', lancer(outil('Write', { file_path: path.join(aa.chemin, 'JOURNAL-HOTES.md'), content: 'x' })).code, 0);
    } finally { ap.nettoyer(); aa.nettoyer(); }
}
{   // UN HOOK QUI PLANTE DOIT REFUSER : toute RegExp.test lève
    const r = lancer(ps('curl https://x'), path.join(__dirname, 'test-hook-panne-simulee.js'));
    rendre('hook qui plante en plein verdict', r.code, 2, r.err);
    const r2 = lancer(ps('git status'), path.join(__dirname, 'test-hook-panne-simulee.js'));
    rendre('hook qui plante sur une commande innocente', r2.code, 2, r2.err);
}
nettoyerWorktree();
console.log(`\n${ok}/${ok + ko} cas justes${ko ? ` — ${ko} en échec` : ''}`);
process.exit(ko ? 1 : 0);
