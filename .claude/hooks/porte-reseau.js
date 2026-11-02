// Hook PreToolUse : LA PORTE RÉSEAU UNIQUE (décision du testeur, 2026-11-01 ; corrigé aux tours 1 et 2 de relecture).
// Deux écarts du 01/11 (une page lue avant son robots.txt, une requête vers un hôte fermé) venaient d'outils qui ignorent nos règles. Tout accès réseau d'un agent passe donc par
//   node collecte-cartes/porte-reseau.js lire <url> --texte --sortie=<fichier>
// qui refuse un hôte fermé et toute page tant que le robots.txt de l'hôte n'a pas été lu et respecté. Ce hook ferme les autres chemins.
//
// FERMÉ PAR DÉFAUT (H6) : le nom de l'outil est comparé sans casse ; seuls PowerShell et Bash (analysés), Write/Edit/NotebookEdit (protection du dossier de la porte, des arrêts
// ARRET/LEVEE/PAUSE-HOTE et, dans la COPIE PRINCIPALE, du hook et des deux modules de la porte) sont examinés ; WebFetch, les outils de navigation (mcp__claude-in-chrome__*,
// mcp__Claude_Browser__*, mcp__remote-devices__*) et TOUT AUTRE outil reçu sont refusés ; une entrée qui n'est pas un objet à tool_name est refusée. => le matcher de .claude/settings.json ne
// doit nommer QUE les outils à examiner (WebFetch|PowerShell|Bash|Write|Edit|NotebookEdit|mcp__…) : un outil inoffensif (Read, WebSearch…) qui arriverait ici serait refusé.
// SHELL : un script (node, python, .ps1) qui porte une primitive réseau ne passe QUE s'il est SUIVI par git dans CE dépôt OU un de ses worktrees (même git-common-dir) et IDENTIQUE au
// HEAD de ce worktree (git diff --quiet HEAD) — « suivi » seul ne prouve rien. Il n'y a PLUS de dérogation « requiert la porte ».
//   · `cd`/`Set-Location`/`pushd` en TÊTE d'instruction, avec un seul argument littéral qui est un dossier existant : le dossier courant est mis à jour pour la suite de la commande. Toute
//     autre forme (variable, `cd -`, Pop-Location, cd dans un bloc { }, if, cmd /c) rend le dossier INCERTAIN : un script relatif qui porte une primitive est alors refusé.
//   · les chaînes littérales qui sont des ARGUMENTS (après -m, here-strings, entre guillemets hors position de commande) ne sont pas cherchées comme des outils ; une chaîne en position de
//     COMMANDE (& 'curl.exe', ."wget") ou donnée à -Command / -c / /c reste lue.
// 2026-11-02 (git/npm/pip) : git clone et git submodule sont refusés quelle que soit l'adresse ; fetch/pull/push/ls-remote/archive/remote add|set-url/config url ne sont admis que vers le dépôt d'origine
// EXACT https://github.com/RAT-NOIR/pokemon-proxy (nom de dépôt `origin` ou sans nom) ; tout autre nom de dépôt distant est refusé. npm/pnpm/yarn n'admettent que test, run, start… ; pip/pipx/uv n'installent rien.
// Les données ouvertes (TCGdex…) passent par la porte, pas par git. Les dossiers de DOSSIERS_LIBRES (API) gardent leur régime.
// Code 2 = refus : le message part sur stderr et revient à l'agent. Toute panne, toute entrée illisible REFUSE (une garde qui ne peut pas conclure bloque et le dit).
//
// TOUR 3 : (B2) dossiers de la porte et des arrêts FIXES — le hook ne lit aucune variable d'environnement, le banc passe --banc=<json> en argument ; une commande qui pose ARRETS_HOTES_DOSSIER,
// PORTE_RESEAU_DOSSIER, PORTE_RESEAU_BANC ou NODE_OPTIONS est refusée. (B3) un agent ne lève ni ne supprime un arrêt : `porte-reseau.js lever`, toute écriture / suppression / déplacement / renommage
// visant arrets-hotes\ (JOURNAL-HOTES.md excepté), `-Recurse` sur ce dossier ou un parent, et un flux « nom:flux » sont refusés ; la levée est une action de l'utilisateur, à la main dans son terminal.
// (I3, limite ACCEPTÉE par le coordinateur) la détection des primitives réseau est une liste de motifs de texte : elle vise l'erreur d'un agent, pas un adversaire qui obscurcit son code.
// LIMITE ÉCRITE (16) : ce hook est une liste de motifs pour le shell ; il arrête les erreurs d'un agent de bonne foi (le cas réel : WebFetch, curl), pas un agent qui cherche à le contourner
// (un binaire renommé, un langage non listé, un script suivi qui en appelle un autre — pas suivi transitivement ; un worktree d'agent dont le script a été commité). WebFetch, lui, est refusé
// sans exception. Faux refus connus et acceptés : `rg curl`, `Select-String "curl"` (utiliser l'outil Grep).
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// PORTÉE PAR DOSSIER (décision de l'utilisateur, 01/11) : la garde s'applique à TOUTE session et tout sous-agent (reprise comprise, aucun identifiant à ajouter). Écrite par ce qu'elle
// AUTORISE : seuls les dossiers de la liste fermée DOSSIERS_LIBRES (ceux de l'API) en sont libres — un appel dont le « dossier effectif » y est entièrement passe sans autre examen (code 0).
// Dossier effectif : shell = le dossier courant calculé ici (cwd de l'entrée, mis à jour par un cd littéral en tête d'instruction) pour CHAQUE instruction autre qu'un cd, et une commande
// n'est libre que si toutes le sont (un dossier incertain n'est pas libre) ; Write/Edit/NotebookEdit = le fichier visé ; tout autre outil = le cwd. cwd absent, vide, non textuel ou
// relatif => pas libre. La comparaison est sans casse, sur le chemin résolu ET le chemin réel (jonctions, noms courts 8.3), par dossier (« …\api-v2-bis » n'est pas dans « …\api-v2 »).
// « Libre » ne lève QUE les raisons RÉSEAU : les protections de la porte (écriture/suppression/déplacement dans arrets-hotes\ et le dossier de la porte, ARRET/LEVEE/PAUSE-HOTE même placés dans
// un dossier de l'API, `porte-reseau.js lever`, hook et modules de la copie principale, variables interdites) valent pour tout le monde. Start-Process/saps/start -WorkingDirectory rend le dossier incertain
// sauf littéral dans un dossier libre.
// LIMITES CONNUES : un agent qui fait `cd` vers un dossier de l'API sort de la garde (elle vise l'erreur d'un agent de bonne foi, comme la limite 16 ci-dessous). Une jonction ou un nom court qui mène
// DANS l'API reste refusé (décision du coordinateur : plus strict, fermé par défaut).
const DOSSIERS_LIBRES = ['C:\\Users\\Yung\\Desktop\\pokemon-proxy-api-v2', 'C:\\Users\\Yung\\rat-market-travail\\api'];
const MESSAGE_WEBFETCH ='accès réseau par la porte seulement : node collecte-cartes/porte-reseau.js lire <url> --texte --sortie=<fichier>';
const MAX_SCRIPT = 2 * 1024 * 1024;
const DEPOT = path.resolve(__dirname, '..', '..');
const PORTE_JS = path.join(DEPOT, 'collecte-cartes', 'porte-reseau.js').toLowerCase();

const mot = nom => new RegExp(`(^|[^\\w.-])${nom}(\\.exe)?(?![\\w-])`, 'i');
const OUTILS = [
    ...['curl', 'wget', 'iwr', 'irm', 'iex', 'bitsadmin', 'ssh', 'scp', 'sftp', 'nc', 'ncat', 'telnet', 'ftp', 'tftp', 'npx', 'deno', 'bun', 'ruby', 'perl', 'php', 'wsl',
        'winget', 'choco', 'scoop', 'nslookup', 'ping'].map(n => ({ re: mot(n), nom: n })),
    { re: /\bInvoke-WebRequest\b/i, nom: 'Invoke-WebRequest' },
    { re: /\bInvoke-RestMethod\b/i, nom: 'Invoke-RestMethod' },
    { re: /\bInvoke-Expression\b/i, nom: 'Invoke-Expression' },
    { re: /\bStart-BitsTransfer\b/i, nom: 'Start-BitsTransfer' },
    { re: /\bcertutil(\.exe)?\b[\s\S]*-urlcache/i, nom: 'certutil -urlcache' },
    { re: /\bTest-NetConnection\b/i, nom: 'Test-NetConnection' },
    { re: /\bResolve-DnsName\b/i, nom: 'Resolve-DnsName' },
    { re: /Net\.WebClient|Net\.Http|WebRequest\]::|TcpClient|UdpClient|System\.Net\.Sockets|XMLHTTP|Msxml2|WinHttp/i, nom: 'classe réseau .NET/COM' },
    { re: /\b(npm\s+exec|pnpm\s+dlx|yarn\s+dlx)\b/i, nom: 'exécution de paquet distant' },
    { re: /\b(powershell|pwsh)(\.exe)?\b[^\n]*\s-e(c|nc?\w*)?(\s|:|$)/i, nom: 'powershell -EncodedCommand' },
    { re: /(^|[^\w.-])pip3?(\.exe)?\s+(install|download)\b/i, nom: 'pip install/download' },
    { re: /(^|[^\w.-])docker(\.exe)?\s+(pull|run|build|compose)\b/i, nom: 'docker pull/run/build' },
    { re: mot('gh'), nom: 'gh', sauf: /(^|[^\w.-])gh(\.exe)?\s+--version\s*$/i },
    // tour 3 (I1, M-a) : outils hors des premières listes
    ...['aria2c', 'lynx', 'w3m', 'rsync', 'mshta', 'Install-Module', 'Update-Help', 'Test-Connection'].map(n => ({ re: mot(n), nom: n })),
    { re: /(^|[^\w.-])openssl(\.exe)?\s+s_client\b/i, nom: 'openssl s_client' },
    { re: /\/dev\/(tcp|udp)\//i, nom: '/dev/tcp' },
    { re: /\[scriptblock\]::Create/i, nom: '[scriptblock]::Create (commande construite)' },
    { re: /(^|[^\w.-])msiexec(\.exe)?[^\n]*https?:\/\//i, nom: 'msiexec vers une adresse' },
    { re: /\bWebClient\b/i, nom: 'WebClient' },
];
const PRIMITIVES = [
    { re: /\bfetch\s*\(/, nom: 'fetch(' },
    { re: /=\s*fetch\b(?!\s*\()/, nom: 'alias de fetch' },
    { re: /\b(?:globalThis|global|self|window)\s*(?:\.\s*fetch\b|\[\s*['"`]fetch['"`]\s*\])/, nom: 'globalThis.fetch' },
    { re: /(?:require\s*\(\s*|from\s+|import\s*\(?\s*)['"`](?:node:)?(?:https?|http2|net|tls|dgram|child_process|undici|node-fetch|axios|got|puppeteer(?:-core)?|playwright(?:-core)?|ws)['"`]/, nom: 'module réseau ou child_process' },
    { re: /\b(?:net|tls)\.(?:connect|createConnection)\b/, nom: 'net/tls.connect' },
    { re: /\bWebSocket\b/, nom: 'WebSocket' },
    { re: /\bXMLHttpRequest\b/, nom: 'XMLHttpRequest' },
    { re: /\bimport\s*\(/, nom: 'import() dynamique' },
];
const PY_RESEAU = /\bimport\b[^\n]*\b(?:requests|urllib3?|httpx|aiohttp|socket|http\.client|ftplib|smtplib|telnetlib|subprocess)\b|^\s*from\s+(?:requests|urllib3?|httpx|aiohttp|socket|http(?:\.client)?|ftplib|smtplib|telnetlib|subprocess)\b|\bos\.(?:system|popen)\b|__import__\s*\(/m;
const PY_MODULES_REFUSES = /^(http|urllib|socket|ftplib|smtplib|telnetlib|requests|pip|ensurepip|xmlrpc|uv$|poetry|pdm|pipenv)/i;
const NODE_VALEURS = new Set(['-r', '--require', '--import', '--loader', '--experimental-loader', '--env-file', '--conditions', '-c', '--stack-size', '--max-old-space-size']);
const NODE_EVAL = /^(-e|-p|-pe|--eval|--print|--input-type)/;
const G_DEFINITION = /\$g\s*=\s*\(Get-ChildItem\s+"\$env:LOCALAPPDATA\\GitHubDesktop"\s+-Filter\s+'app-\*'\s+-Directory\s*\|\s*Sort-Object\s+Name\s+-Descending\s*\|\s*Select-Object\s+-First\s+1\)\.FullName\s*\+\s*'\\resources\\app\\git\\cmd\\git\.exe'/i;
const GIT_SENSIBLES = new Set(['fetch', 'pull', 'push', 'ls-remote', 'archive', 'remote', 'config']);
// 2026-11-02 (A) : seul le dépôt d'origine exact est un dépôt distant admis ; clone et submodule sont refusés quelle que soit l'adresse (les données ouvertes passent par la porte).
const GIT_TOUJOURS_REFUSES = new Set(['clone', 'submodule', 'fetch-pack', 'send-pack', 'svn', 'p4', 'imap-send', 'http-fetch', 'http-push', 'remote-http', 'remote-https', 'lfs', 'daemon']);
const GIT_ORIGINE = 'https://github.com/RAT-NOIR/pokemon-proxy';
const GIT_ORIGINE_CHEMIN = '/RAT-NOIR/pokemon-proxy';
const GIT_OPTIONS_A_VALEUR = new Set(['--depth', '--deepen', '--jobs', '-j', '-o', '--push-option', '--server-option', '--refmap', '--negotiation-tip', '--shallow-since', '--shallow-exclude', '-s', '--strategy', '-X', '--strategy-option']);
const MODIFIE = /(^|[^\w-])(remove-item|del|erase|rm|rmdir|rd|set-content|add-content|clear-content|out-file|copy-item|cp|copy|move-item|mv|move|rename-item|ren|new-item|ni|tee|tee-object|sc|ac|ri|mi|ci|cpi)(?![\w-])|>/i;
const MODIFIE_VERBE = /(^|[^\w-])(remove-item|del|erase|rm|rmdir|rd|set-content|add-content|clear-content|out-file|copy-item|cp|copy|move-item|mv|move|rename-item|ren|new-item|ni|tee|tee-object|sc|ac|ri|mi|ci|cpi)(?![\w-])/i;
const ECRIT_SCRIPT = /(?:>>?|(?:^|[^\w-])(?:set-content|add-content|out-file|new-item|copy-item|move-item|rename-item|tee|tee-object|sc|ac|ni|cp|mv|copy|move)(?![\w-]))[^\n;|&]{0,160}?\.(?:c?m?js|py|ps1)\b/i;
const LANCE_SCRIPT = /(^|[^\w.-])(node|python3?|py|powershell|pwsh)(\.exe)?(?![\w-])|\.ps1\b/i;
const CD_TETE = /^\s*(?:cd|chdir|sl|set-location|pushd|push-location)(?![\w-])\s*(.*?)\s*$/i;
const CD_PARTOUT = /(^|[^\w-])(cd|chdir|sl|set-location|pushd|push-location|popd|pop-location)(?![\w-])/i;
const OUVRE_ADRESSE = /(^|[^\w.-])(start-process|invoke-item|saps|ii|start|explorer)(\.exe)?(?![\w-])[^\n]*https?:\/\//i;
const POSITION_COMMANDE = /(^|[;|&\r\n{(]|\.)\s*$/;
const ARGUMENT_DE_SHELL = /(^|\s)(-c(?:o\w*)?|-command|\/c|\/k|-lc|-ec|-ic)\b:?\s*$/i;        // PowerShell accepte tout préfixe de -Command (-Com), et -Command:"…"
const LANCEUR_DE_SHELL = /(^|[\s&(])(powershell|pwsh|cmd|bash|sh|zsh|dash)(\.exe)?(?=\s|$)/i;     // I1 : toute chaîne d'une instruction qui lance un autre shell reste lue
const REFUS_NODE_PRECHARGE = new Set(['--import', '--loader', '--experimental-loader']);
const VARIABLES_FIXES = /(ARRETS_HOTES_DOSSIER|PORTE_RESEAU_DOSSIER|PORTE_RESEAU_BANC|PORTE_HOOK_BANC)/gi;
const VERBES_SUPPR = /^(remove-item|ri|del|erase|rm|rmdir|rd)$/i;
const VERBES_DEPL = /^(move-item|mi|mv|move|rename-item|ren|rni)$/i;
const DRAPEAU_RECURSIF = /^(-r|-rf|-fr|-rec\w*|\/s)$/i;

const DEFAUT_PORTE = 'C:\\Users\\Yung\\rat-market-travail\\catalogue\\porte-reseau';
const DEFAUT_ARRETS = 'C:\\Users\\Yung\\rat-market-travail\\catalogue\\arrets-hotes';
const DEFAUT_PRINCIPALE = 'C:\\Users\\Yung\\Desktop\\pokemon-proxy';
// B2 : les dossiers sont FIXES. Aucune variable d'environnement ne les change ; le banc les passe par l'ARGUMENT --banc=<json> de la commande du hook, que seule la configuration du hook peut poser.
const BANC = (() => {
    const a = process.argv.slice(2).find(x => x.startsWith('--banc='));
    if (!a) return null;
    try { const j = JSON.parse(a.slice(7)); return j && typeof j === 'object' && !Array.isArray(j) ? j : null; } catch { return null; }
})();
const dossierPorte = () => (BANC && typeof BANC.porte === 'string' && BANC.porte ? BANC.porte : DEFAUT_PORTE);
const dossierArrets = () => (BANC && typeof BANC.arrets === 'string' && BANC.arrets ? BANC.arrets : DEFAUT_ARRETS);
const copiePrincipale = () => (BANC && typeof BANC.principale === 'string' && BANC.principale ? BANC.principale : DEFAUT_PRINCIPALE);
const bas = p => path.resolve(p).toLowerCase();
const sous = (a, d) => { const x = bas(d); return a === x || a.startsWith(x.endsWith(path.sep) ? x : x + path.sep); };
/** M1 : le chemin RÉEL natif du parent existant le plus proche (développe les noms courts 8.3 et les jonctions), le reste du chemin recollé. */
function reel(abs) {
    let reste = '', cur = path.resolve(abs);
    for (;;) {
        try { return path.join(fs.realpathSync.native(cur), reste); } catch { /* inexistant : on remonte */ }
        const parent = path.dirname(cur);
        if (parent === cur) return path.resolve(abs);
        reste = path.join(path.basename(cur), reste); cur = parent;
    }
}

/** Un chemin est libre s'il est ABSOLU et que son chemin résolu ET son chemin réel sont chacun sous un dossier libre (résolu ou réel). Toute autre chose : non. */
function estLibre(p) {
    if (typeof p !== 'string' || !p || !path.isAbsolute(p)) return false;
    const libres = DOSSIERS_LIBRES.flatMap(d => [path.resolve(d), reel(d)]);
    return [bas(p), bas(reel(p))].every(c => libres.some(d => sous(c, d)));
}

/** git, résolu comme au CLAUDE.md §3 (jamais un numéro de version en dur). */
let gitMemo = null;
function cheminGit() {
    if (gitMemo) return gitMemo;
    try {
        const base = path.join(process.env.LOCALAPPDATA || '', 'GitHubDesktop');
        for (const a of fs.readdirSync(base).filter(n => /^app-/.test(n)).sort().reverse()) { const g = path.join(base, a, 'resources', 'app', 'git', 'cmd', 'git.exe'); if (fs.existsSync(g)) return (gitMemo = g); }
    } catch { /* pas de GitHub Desktop : git du PATH */ }
    return (gitMemo = 'git');
}
const git = (args, cwd) => execFileSync(cheminGit(), args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 15000, windowsHide: true });
let communDepot = null;
const dirCommun = dir => bas(fs.realpathSync.native(path.resolve(dir, git(['rev-parse', '--git-common-dir'], dir).trim())));
/** D2/C3 : suivi par git dans CE dépôt ou un de ses worktrees (même git-common-dir) ET identique au HEAD de ce worktree (ni modifié, ni seulement ajouté à l'index). Un échec vaut « non ». */
function identiqueAHead(fichier) {
    try {
        const dir = path.dirname(fichier);
        if (dirCommun(dir) !== (communDepot ||= dirCommun(DEPOT))) return false;
        git(['ls-files', '--error-unmatch', '--', fichier], dir);
        git(['diff', '--quiet', 'HEAD', '--', fichier], dir);
        return true;
    } catch { return false; }
}

const jetons = s => (s.match(/"[^"]*"|'[^']*'|\S+/g) || []).map(t => t.replace(/^["']|["']$/g, ''));
const nonResolu = t => /[$(%`]/.test(t);
function lireScript(fichier) {
    try {
        const st = fs.statSync(fichier);
        if (!st.isFile()) return null;
        if (st.size > MAX_SCRIPT) return { trop: true, texte: '' };
        return { texte: fs.readFileSync(fichier, 'utf8') };
    } catch { return null; }
}
/** I1 : retire les chaînes qui sont des ARGUMENTS ; garde celles en position de commande et celles données à -Command / -c / /c. */
function sansChaines(cmd) {
    const s = cmd.replace(/@'[\s\S]*?'@/g, '""').replace(/@"[\s\S]*?"@/g, '""');
    return s.replace(/"(?:[^"`]|`[\s\S])*"|'(?:[^']|'')*'/g, (m, idx) => {
        const avant = s.slice(0, idx), dernier = avant.split(/[;|&\r\n]/).pop();
        return POSITION_COMMANDE.test(avant) || ARGUMENT_DE_SHELL.test(avant) || LANCEUR_DE_SHELL.test(dernier) ? m : '""';
    });
}

/** 2026-11-02 : le SEUL dépôt distant admis est l'origine exacte (https, github.com sans casse, sans identifiant ni port, avec ou sans .git). */
function adresseOrigine(a) {
    try {
        const u = new URL(a);
        return u.protocol === 'https:' && !u.username && !u.password && !u.port && !u.search && !u.hash && u.hostname === 'github.com' && (u.pathname === GIT_ORIGINE_CHEMIN || u.pathname === GIT_ORIGINE_CHEMIN + '.git');
    } catch { return false; }
}
/** Un nom de dépôt distant ou une adresse : admis seulement `origin` ou l'adresse d'origine exacte (tout autre nom : on ne sait pas où il pointe). */
const depotAdmis = x => (/:\/\//.test(x) || /^[\w.-]+@[\w.-]+:/.test(x)) ? adresseOrigine(x) : x === 'origin';
/** Arguments positionnels d'une sous-commande git ; les options à valeur séparée sont sautées. */
function positionnelsGit(args) {
    const p = [];
    for (let k = 0; k < args.length; k++) {
        const a = args[k];
        if (a === '--') { p.push(...args.slice(k + 1)); break; }
        if (a.startsWith('-')) { if (!a.includes('=') && GIT_OPTIONS_A_VALEUR.has(a)) k++; continue; }
        p.push(a);
    }
    return p;
}
function verdictGit(ins) {
    const t = jetons(ins.replace(/^\s*&\s*/, ''));
    let i = t.findIndex(x => /(^|[\\/])git(\.exe)?$/i.test(x) || x.toLowerCase() === '$g');
    if (i < 0) return null;
    for (let j = i + 1; j < t.length; j++) {
        if (t[j] === '-c' && t[j + 1] && /(sshcommand|gitproxy|fsmonitor|pager|editor|askpass|^alias\.|credential\.helper|http\.proxy|^url\.)/i.test(t[j + 1])) return `git -c ${t[j + 1]} : réglage qui lance un programme ou détourne l'adresse`;
    }
    i++;
    while (i < t.length && t[i].startsWith('-')) i += (t[i] === '-C' || t[i] === '-c' || t[i] === '--git-dir' || t[i] === '--work-tree' || t[i] === '--namespace') ? 2 : 1;
    const sub = (t[i] || '').toLowerCase();
    if (GIT_TOUJOURS_REFUSES.has(sub)) return `git ${sub} : refusé quelle que soit l'adresse (données ouvertes : node collecte-cartes/porte-reseau.js lire <url>)`;
    if (!GIT_SENSIBLES.has(sub)) return null;
    if (sub === 'config' && /\burl\.\S*\.(pushinsteadof|insteadof)/i.test(ins)) return 'git config url.*.insteadOf : réécriture d\'adresse';
    const args = t.slice(i + 1), pos = positionnelsGit(args);
    const refus = m => `git ${sub} : ${m} (seul le dépôt d'origine ${GIT_ORIGINE} est admis)`;
    // toute adresse écrite dans la commande doit être l'origine exacte
    const adresses = ins.match(/(?:\w+):\/\/[^\s'"]+|[\w.-]+@[\w.-]+:[^\s'"]*/gi) || [];
    for (const a of adresses) if (!adresseOrigine(a)) return refus(`adresse ${a}`);
    for (const a of args) if (/^--(upload-pack|receive-pack|exec)\b/i.test(a)) return refus(`option ${a} qui lance un programme`);
    if (sub === 'fetch' || sub === 'pull' || sub === 'push') {
        if (sub !== 'push' && args.some(a => /^--(all|multiple)$/i.test(a))) return refus('--all / --multiple vise tous les dépôts distants');
        for (const a of args) { const m = /^--repo=(.*)$/i.exec(a); if (m && !depotAdmis(m[1])) return refus(`--repo=${m[1]}`); }
        if (pos.length && !depotAdmis(pos[0])) return refus(`dépôt « ${pos[0]} »`);
    } else if (sub === 'ls-remote') {
        if (pos.length && !depotAdmis(pos[0])) return refus(`dépôt « ${pos[0]} »`);
    } else if (sub === 'archive') {
        for (const a of args) { const m = /^--remote=(.*)$/i.exec(a); if (m && !depotAdmis(m[1])) return refus(`--remote=${m[1]}`); }
        if (args.some((a, k) => a === '--remote' && args[k + 1] !== undefined && !depotAdmis(args[k + 1]))) return refus('--remote vers un autre dépôt');
    } else if (sub === 'remote') {
        if (/^(add|set-url)$/i.test(pos[0] || '') && !pos.slice(1).some(x => /:\/\//.test(x) || /^[\w.-]+@[\w.-]+:/.test(x))) return refus(`remote ${pos[0]} sans adresse littérale`);
    } else if (sub === 'config') {
        const k = pos.findIndex(x => /^(remote\.[^.\s]+\.(url|pushurl)|url\..*)$/i.test(x));
        if (k >= 0 && pos[k + 1] !== undefined && !depotAdmis(pos[k + 1])) return refus(`${pos[k]} réglé sur une valeur non admise`);
    }
    return null;
}
/** 2026-11-02 : npm/pnpm/yarn, pip/pipx/uv — fermé par défaut : seules les sous-commandes locales listées passent. */
const PM_LOCAL = new Set(['test', 't', 'tst', 'run', 'run-script', 'start', 'stop', 'restart', 'help', 'ls', 'list']);
const PM_ENVELOPPES = /^(&|\.|call|start|cmd|cmd\.exe|powershell|pwsh|powershell\.exe|pwsh\.exe|bash|sh|\/c|\/k|-c|-lc|-command|-noprofile|-noninteractive|-nologo|-executionpolicy|bypass|-windowstyle|hidden)$/i;
function verdictPaquets(ins) {
    const flat = ins.replace(/["'`]/g, ' ').split(/\s+/).filter(Boolean);
    let k = 0;
    while (k < flat.length && PM_ENVELOPPES.test(flat[k])) k++;
    if (k >= flat.length) return null;
    const base = c => c.split(/[\\/]/).pop().toLowerCase().replace(/\.(exe|cmd|ps1|bat)$/, '');
    let cand = flat[k], e = k;
    while (/[\\/]/.test(cand) && !/^(npm|pnpm|yarn|pip3?(\.\d+)?|pipx|uv)$/.test(base(cand)) && e + 1 < flat.length) cand += ' ' + flat[++e];      // chemin avec espaces (C:\Program Files\nodejs\npm.cmd)
    const nom = base(cand);
    const reste = flat.slice(e + 1);
    const sub = reste.find(x => !x.startsWith('-'));
    const info = reste.some(x => /^(-v|--version|-h|--help)$/i.test(x));
    if (/^(npm|pnpm|yarn)$/.test(nom)) {
        if (sub === undefined) return info ? null : `${nom} sans sous-commande locale (yarn seul = install) : refusé`;
        return PM_LOCAL.has(sub.toLowerCase()) ? null : `${nom} ${sub} : installation ou accès au registre, refusé (seuls test, run, start… sont admis)`;
    }
    if (/^pip3?(\.\d+)?$/.test(nom)) {
        if (sub === undefined) return info ? null : `${nom} sans sous-commande : refusé`;
        return /^(list|show|freeze|check|help)$/i.test(sub) ? null : `${nom} ${sub} : accès au registre, refusé`;
    }
    if (nom === 'pipx' || nom === 'uv') return info && sub === undefined ? null : `${nom} ${sub || ''} : accès au registre, refusé`;
    return null;
}

function verdictScriptNode(ins, ctx) {
    const t = jetons(ins);
    const i = t.findIndex(x => /^node(\.exe)?$/i.test(path.basename(x)));
    if (i < 0) return null;
    let script = null;
    const precharges = [];
    for (let j = i + 1; j < t.length; j++) {
        const o = t[j];
        if (o === '-') return 'node lit son programme sur stdin';
        if (o.startsWith('-')) {
            if (NODE_EVAL.test(o)) return `node ${o} : code en ligne`;
            if (/^(-v|--version|-h|--help)$/.test(o)) return null;
            const eq = o.indexOf('='), nom = eq < 0 ? o : o.slice(0, eq), val = eq < 0 ? null : o.slice(eq + 1);
            if (REFUS_NODE_PRECHARGE.has(nom)) return `node ${nom} : chargeur de code préalable refusé`;      // I2
            if (nom === '-r' || nom === '--require') { precharges.push(val !== null ? val : (t[++j] ?? '')); continue; }
            if (NODE_VALEURS.has(nom) && val === null) j++;
            continue;
        }
        script = o; break;
    }
    // I2 : un module préchargé (-r / --require) est du code qui s'exécute avant le script : même règle de contenu ; seul un module de PAQUET (dotenv/config) est admis sans lecture
    for (const v of precharges) {
        if (!v || nonResolu(v)) return `node -r « ${v} » non résolu : refusé`;
        if (/^(?![.\/\\])(?![a-z]:)[@\w][\w@./-]*$/i.test(v) && !/\.[cm]?js$/i.test(v)) continue;
        const r = jugerFichierNode(v, ctx, `module préchargé « ${v} »`);
        if (r) return r;
    }
    if (script === null) return 'node sans script lisible (stdin ?)';
    if (nonResolu(script) || !/\.[cm]?js$/i.test(script)) return `script node « ${script} » non résolu (variable, sans extension .js) : refusé`;
    return jugerFichierNode(script, ctx, `script node « ${script} »`);
}
/** La règle de contenu d'un fichier node qui va s'exécuter : lisible ; sans primitive réseau ; sinon suivi par git ET identique à HEAD. */
function jugerFichierNode(fichier, ctx, etiquette) {
    let abs = path.resolve(ctx.cwd, fichier);
    let s = lireScript(abs);
    if (!s && !/\.[cm]?js$/i.test(fichier)) { s = lireScript(abs + '.js'); if (s) abs += '.js'; }
    if (!s) return `${etiquette} introuvable : non résolu, refusé`;
    if (abs.toLowerCase() === PORTE_JS) ctx.estPorte = true;
    const prim = s.trop ? ['fichier trop gros pour être lu'] : PRIMITIVES.filter(m => m.re.test(s.texte)).map(m => m.nom);
    if (!prim.length) return null;
    if (ctx.incertain && !path.isAbsolute(fichier)) return `${etiquette} avec accès réseau (${prim.join(', ')}) lu depuis un dossier incertain (cd non résolu) : refusé`;
    return identiqueAHead(abs) ? null : `${etiquette} avec accès réseau (${prim.join(', ')}) qui n'est pas suivi par git dans ce dépôt (ou un de ses worktrees) ET identique à HEAD`;
}
function verdictScriptPython(ins, ctx) {
    const t = jetons(ins);
    const i = t.findIndex(x => /^(python[\d.]*|py)(\.exe)?$/i.test(path.basename(x)));
    if (i < 0) return null;
    for (let j = i + 1; j < t.length; j++) {
        const o = t[j];
        if (o === '-') return 'python lit son programme sur stdin';
        if (o === '-m') return PY_MODULES_REFUSES.test(t[j + 1] || '') || !t[j + 1] ? `python -m ${t[j + 1] || ''} : module réseau` : null;
        if (/^-c/.test(o)) return 'python -c : code en ligne';
        if (/^(-V|--version|-h|--help)$/.test(o)) return null;
        if (o.startsWith('-')) { if (o === '-W' || o === '-X') j++; continue; }
        if (nonResolu(o) || !/\.py$/i.test(o)) return `script python « ${o} » non résolu : refusé`;
        const s = lireScript(path.resolve(ctx.cwd, o));
        if (!s) return `script python « ${o} » introuvable : non résolu, refusé`;
        return s.trop || PY_RESEAU.test(s.texte) ? `script python « ${o} » à accès réseau (requests, urllib, httpx, aiohttp, socket, http.client, subprocess…)` : null;
    }
    return 'python sans script lisible (stdin ?)';
}
function verdictScriptPs1(ins, ctx) {
    const sans = ins.replace(/^\s*&\s*/, '');
    const t = jetons(sans);
    let cible = null;
    if (t.length && /\.ps1$/i.test(t[0])) cible = t[0];
    else {
        const m = /\b(?:powershell|pwsh)(?:\.exe)?\b[\s\S]*?\s-(?:file|f)\s+("[^"]+"|'[^']+'|\S+)/i.exec(sans);
        if (m) cible = m[1].replace(/^["']|["']$/g, '');
    }
    if (cible === null) return null;
    if (nonResolu(cible)) return `script PowerShell « ${cible} » non résolu : refusé`;
    const abs = path.resolve(ctx.cwd, cible), s = lireScript(abs);
    if (!s) return `script PowerShell « ${cible} » introuvable : non résolu, refusé`;
    const prim = s.trop ? ['fichier trop gros'] : OUTILS.filter(m => m.re.test(s.texte)).map(m => m.nom);
    if (!prim.length) return null;
    return identiqueAHead(abs) ? null : `script PowerShell « ${cible} » avec accès réseau (${prim.join(', ')}) qui n'est pas suivi par git dans ce dépôt (ou un de ses worktrees) ET identique à HEAD`;
}

/** D4/C1/I3 : refus d'écrire vers le dossier de la porte (robots\, cadence\, journal), un ARRET/LEVEE/PAUSE-HOTE, ou — copie principale seulement — le hook et les deux modules de la porte. */
function cibleProtegee(abs) {
    const porte = path.resolve(dossierPorte()), porteR = reel(porte), princ = path.resolve(copiePrincipale()), princR = reel(princ);
    const arrets = path.resolve(dossierArrets()), arretsR = reel(arrets);
    if (abs.slice(2).includes(':')) return 'flux alternatif NTFS (« nom:flux ») : refusé';
    for (const a of [bas(abs), bas(reel(abs))]) {
        if (/^(arret|levee|pause)-hote-.*\.json$/i.test(path.basename(a))) return 'fichier ARRET-HOTE / LEVEE-HOTE / PAUSE-HOTE : un agent ne ferme, ne lève ni ne supprime un arrêt (la levée est une action de l\'utilisateur, à la main dans son terminal)';
        // B3 : le dossier des arrêts n'est écrit par aucun agent — seul JOURNAL-HOTES.md (un journal, il n'ouvre ni ne ferme aucun hôte) s'écrit
        if ((a.split(path.sep).includes('arrets-hotes') || sous(a, arrets) || sous(a, arretsR)) && path.basename(a) !== 'journal-hotes.md') return 'dossier des arrêts (arrets-hotes\\) : un agent n\'y écrit rien ; la levée d\'un arrêt est une action de l\'utilisateur, à la main dans son terminal';
        for (const p of [porte, porteR]) if (sous(a, path.join(p, 'robots')) || sous(a, path.join(p, 'cadence')) || a === bas(path.join(p, 'journal.jsonl'))) return 'dossier de la porte (robots\\, cadence\\, journal.jsonl)';
        for (const p of [princ, princR]) {
            if (sous(a, path.join(p, '.claude', 'hooks')) || a === bas(path.join(p, 'collecte-cartes', 'porte-reseau.js')) || a === bas(path.join(p, 'collecte-cartes', 'reponse-hote.js'))) return 'hook ou module de la porte dans la copie principale (ils changent par une branche et une fusion)';
        }
    }
    return null;
}
/** Les chemins du dossier des arrêts (le fixe, son chemin réel, le nom littéral arrets-hotes) ; les mentions de JOURNAL-HOTES.md seul en sont retirées (il s'écrit). */
function mentionneArrets(cmd) {
    let t = cmd.toLowerCase().replace(/\//g, '\\');
    const noms = [bas(dossierArrets()), bas(reel(path.resolve(dossierArrets()))), 'arrets-hotes'];
    for (const n of noms) t = t.split(`${n}\\journal-hotes.md`).join('');
    return noms.some(n => t.includes(n));
}
function mentionneProtege(cmd) {
    const t = cmd.toLowerCase().replace(/\//g, '\\');
    const porte = bas(dossierPorte());
    return /(arret|levee|pause)-hote-/.test(t) || t.includes(path.join(porte, 'robots')) || t.includes(path.join(porte, 'cadence')) || t.includes(path.join(porte, 'journal.jsonl'))
        || /porte-reseau\\(robots|cadence|journal\.jsonl)/.test(t);
}

/** B3 : suppression ou déplacement qui TOUCHE le dossier des arrêts (lui, un de ses fichiers, ou — si récursif ou déplacé — un de ses parents), jugé sur les chemins RÉSOLUS (cwd compris). */
function verdictArrets(ins, ctx) {
    const t = jetons(ins.replace(/^\s*(&|\.)\s*/, ''));
    if (!t.length) return null;
    const verbe = path.basename(t[0]).replace(/\.exe$/i, '');
    const suppr = VERBES_SUPPR.test(verbe), depl = VERBES_DEPL.test(verbe);
    if (!suppr && !depl) return null;
    const arrets = bas(dossierArrets()), arretsR = bas(reel(path.resolve(dossierArrets())));
    const rec = t.slice(1).some(x => DRAPEAU_RECURSIF.test(x));
    const lieu = 'la levée ou la suppression d\'un arrêt est une action de l\'utilisateur, à la main dans son terminal';
    let nChemins = 0;
    for (const x of t.slice(1)) {
        if (/^-/.test(x) || /^\/[a-z]$/i.test(x)) continue;
        for (const part of x.split(',')) {
            if (!part) continue;
            nChemins++;
            if (nonResolu(part)) { if (rec || depl) return `${verbe} sur « ${part} » (cible non résolue) : refusé ; ${lieu}`; continue; }
            const a = bas(path.resolve(ctx.cwd, part)), ar = bas(reel(path.resolve(ctx.cwd, part)));
            for (const c of [a, ar]) for (const d of [arrets, arretsR]) {
                if (sous(c, d)) return `${verbe} ${part} vise le dossier des arrêts ou l'un de ses fichiers ; ${lieu}`;
                if ((rec || depl) && sous(d, c)) return `${verbe} ${part} vise un PARENT du dossier des arrêts (${rec ? 'récursif' : 'déplacement'}) ; ${lieu}`;
            }
        }
    }
    if (suppr && rec && nChemins === 0) return `${verbe} récursif sans chemin lisible (entrée de pipeline) : refusé, on ne sait pas ce qui est visé ; ${lieu}`;
    if (suppr || depl) { const c = bas(path.resolve(ctx.cwd)); if (sous(c, arrets) || sous(c, arretsR)) return `${verbe} depuis le dossier des arrêts ; ${lieu}`; }
    return null;
}
/** I1 : le contenu de chaque groupe ( ) / $( ) — une sous-expression s'exécute même dans la commande git qui l'enveloppe. */
function sousExpressions(texte) {
    const pile = [], res = [];
    for (let i = 0; i < texte.length; i++) {
        if (texte[i] === '(') pile.push(i);
        else if (texte[i] === ')' && pile.length) res.push(texte.slice(pile.pop() + 1, i));
    }
    return res;
}

function verdictShell(cmd, cwd) {
    cmd = cmd.replace(/`(?=[A-Za-z0-9_])/g, '');        // I1 : l'accent grave PowerShell (Invoke-Web`Request) ne cache rien
    const raisons = [];
    const protections = [];      // « libre » ne lève QUE les raisons réseau : celles-ci (porte, arrêts, variables fixes, levée) restent pour tout le monde
    const prot = r => { raisons.push(r); protections.push(r); };
    // B2 : une commande ne pose ni le dossier des arrêts, ni celui de la porte, ni le module de banc ; I2 : NODE_OPTIONS précharge du code
    for (const m of cmd.matchAll(VARIABLES_FIXES)) {
        const avant = cmd.slice(Math.max(0, m.index - 40), m.index), apres = cmd.slice(m.index + m[0].length, m.index + m[0].length + 10);
        if (/^["'`\]\)]*\s*[=,]/.test(apres) || /(env:|\bset|\bexport|\bsetx|environment\w*\(?|\benv)\s*["'(]?\s*$/i.test(avant)) prot(`${m[0]} : les dossiers des arrêts et de la porte sont FIXES, une commande ne les change pas`);
    }
    if (/NODE_OPTIONS/i.test(cmd)) prot('NODE_OPTIONS précharge du code node : refusé');
    // I1 : dot-source d'une variable ou d'une expression (équivalent de &)
    if (/(^|[;|&\r\n{(])\s*\.\s+[$(]/.test(cmd)) raisons.push('dot-source (. $x, . (…)) : cible non résolue');
    if (mentionneProtege(cmd) && MODIFIE.test(cmd)) prot('modification du dossier de la porte ou des arrêts (robots\\, cadence\\, journal, arrets-hotes\\, ARRET/LEVEE/PAUSE-HOTE) : la levée ou la suppression d\'un arrêt est une action de l\'utilisateur, à la main dans son terminal');
    // H1/H3 : l'opérateur d'appel & sur une cible non résolue ; seule la forme $g du CLAUDE.md §3 (définie dans la même commande, une seule fois) est admise
    if (/&\s*\(/.test(cmd)) raisons.push('opérateur & sur une expression (cible non résolue)');
    const gOk = G_DEFINITION.test(cmd) && (cmd.match(/\$g\s*=/gi) || []).length === 1;
    for (const m of cmd.matchAll(/&\s*["']?\$(\w+)/g)) if (!(m[1].toLowerCase() === 'g' && gOk)) raisons.push(`& $${m[1]} : cible non résolue (seul $g défini comme au CLAUDE.md §3 est admis)`);
    const ctx = { cwd, incertain: false, estPorte: false };
    const hors = [];
    let executees = 0, horsLibre = 0;       // instructions autres qu'un cd, et parmi elles celles dont le dossier n'est pas libre
    // boucle A : sur le texte ORIGINAL (cd, git, scripts, ouverture d'adresse)
    for (const ins of cmd.split(/[;|&\r\n]+/)) {
        if (!ins.trim()) continue;
        const cd = CD_TETE.exec(ins);
        if (cd) {
            const jt = jetons(cd[1].replace(/^-(?:path|literalpath)(?::|\s+)/i, ''));
            if (jt.length === 1 && !nonResolu(jt[0])) {
                const cible = path.resolve(ctx.cwd, jt[0]);
                let dossier = false; try { dossier = fs.statSync(cible).isDirectory(); } catch { /* inexistant */ }
                if (dossier) ctx.cwd = cible; else ctx.incertain = true;
            } else ctx.incertain = true;
            continue;
        }
        if (CD_PARTOUT.test(ins)) ctx.incertain = true;
        // Start-Process/saps/start -WorkingDirectory <x> : l'instruction s'exécute dans <x> ; libre seulement si <x> est un littéral dans un dossier libre, sinon dossier incertain
        let dirIns = ctx.cwd, incIns = ctx.incertain;
        if (/(^|[^\w.-])(start-process|saps|start)(\.exe)?(?![\w-])/i.test(ins)) {
            const wd = /\s-wo\w*(?::|\s+)\s*("[^"]*"|'[^']*'|[^\s;|&]+)/i.exec(ins);
            if (wd) { const v = wd[1].replace(/^["']|["']$/g, ''); if (nonResolu(v)) incIns = true; else dirIns = path.resolve(ctx.cwd, v); }
        }
        executees++; if (incIns || !estLibre(dirIns)) horsLibre++;
        if (/^\s*(&\s*)?(["'][^"']*git(\.exe)?["']|\$g\b|git(\.exe)?(?![\w-]))/i.test(ins)) { const g = verdictGit(ins); if (g) raisons.push(g); continue; }
        hors.push(ins);
        const tl = jetons(ins.replace(/^\s*&\s*/, '')), ip = tl.findIndex(x => /^porte-reseau(\.js)?$/i.test(path.basename(x)));       // B3 : `lever` est une action de l'utilisateur
        if (ip >= 0 && tl.slice(ip + 1).some(x => x.toLowerCase() === 'lever')) prot('porte-reseau.js lever : un agent ne lève pas un arrêt ; la levée est une action de l\'utilisateur, à la main dans son terminal');
        const ar = verdictArrets(ins, ctx); if (ar) prot(ar);
        // B3 : un verbe d'écriture sur le dossier des arrêts, ou une redirection dont la CIBLE y est (lister vers un autre fichier reste permis)
        if (mentionneArrets(ins) && (MODIFIE_VERBE.test(ins) || [...ins.matchAll(/>>?\s*("[^"]*"|'[^']*'|[^\s"'>]+)/g)].some(r => mentionneArrets(r[1])))) prot('écriture dans le dossier des arrêts (arrets-hotes\\) : un agent n\'y écrit rien ; la levée ou la suppression d\'un arrêt est une action de l\'utilisateur, à la main dans son terminal');
        if (OUVRE_ADRESSE.test(ins)) raisons.push('Start-Process / Invoke-Item / saps / ii avec une adresse http(s)');
        if (/(^|[^\w.-])(start-process|saps)(?![\w-])/i.test(ins)) { const t = OUTILS.filter(m => m.re.test(ins) && !(m.sauf && m.sauf.test(ins))).map(m => m.nom); if (t.length) raisons.push(`Start-Process vers un outil réseau (${t.join(', ')})`); }
        const pk = verdictPaquets(ins); if (pk) raisons.push(pk);
        const n = verdictScriptNode(ins, ctx); if (n) raisons.push(n);
        const p = verdictScriptPython(ins, ctx); if (p) raisons.push(p);
        const s = verdictScriptPs1(ins, ctx); if (s) raisons.push(s);
    }
    // boucle B : outils réseau, cherchés sur le texte SANS les chaînes-arguments (I1)
    const sans = sansChaines(cmd);
    for (const inner of sousExpressions(sans)) {            // I1 : une sous-expression s'exécute même enveloppée par une commande git
        const touches = OUTILS.filter(m => m.re.test(inner) && !(m.sauf && m.sauf.test(inner))).map(m => m.nom);
        if (touches.length) raisons.push(`outil réseau dans une sous-expression (${touches.join(', ')})`);
    }
    for (const ins of sans.split(/[;|&\r\n]+/)) {
        if (!ins.trim()) continue;
        if (/^\s*(&\s*)?(["'][^"']*git(\.exe)?["']|\$g\b(?!\s*=)|git(\.exe)?(?![\w-]))/i.test(ins)) continue;
        if (/(^|[^\w.-])node(\.exe)?\s[^\n]*porte-reseau\.js(\s|$)/i.test(ins) && ctx.estPorte) continue;        // la porte elle-même : l'adresse qu'on lui donne n'est pas un outil
        const touches = OUTILS.filter(m => m.re.test(ins) && !(m.sauf && m.sauf.test(ins))).map(m => m.nom);
        if (touches.length) raisons.push(`outil réseau (${touches.join(', ')})`);
    }
    const reste = hors.join(' ; ');
    if (ECRIT_SCRIPT.test(reste) && LANCE_SCRIPT.test(reste)) raisons.push('écriture d\'un script (.js, .py, .ps1) puis exécution dans la même commande');
    raisons.libre = executees > 0 && horsLibre === 0;
    raisons.protections = protections;
    return raisons;
}

function verdict(entree) {
    let e;
    try { e = JSON.parse(entree); } catch { return { refus: 'entrée du hook illisible (JSON attendu) : refusé par prudence' }; }
    if (!e || typeof e !== 'object' || Array.isArray(e)) return { refus: 'entrée du hook sans tool_name lisible : refusé par prudence' };
    if (typeof e.tool_name !== 'string') return { refus: 'entrée du hook sans tool_name lisible : refusé par prudence' };
    const nom = e.tool_name.toLowerCase();
    if (nom === 'webfetch' && !estLibre(typeof e.cwd === 'string' ? e.cwd : null)) return { refus: `WebFetch est fermé : ${MESSAGE_WEBFETCH}` };
    if (/^mcp__(claude-in-chrome|claude_browser|remote-devices)__/.test(nom) && !estLibre(typeof e.cwd === 'string' ? e.cwd : null)) return { refus: `outil de navigation « ${e.tool_name} » fermé : ${MESSAGE_WEBFETCH}` };
    const entreeOutil = e.tool_input && typeof e.tool_input === 'object' ? e.tool_input : {};
    const cwd = typeof e.cwd === 'string' && e.cwd ? e.cwd : process.cwd();
    const cwdLu = typeof e.cwd === 'string' && path.isAbsolute(e.cwd) ? e.cwd : null;      // le seul cwd qui peut rendre un appel libre ; absent, vide, non textuel ou relatif : jamais
    if (nom === 'write' || nom === 'edit' || nom === 'notebookedit') {
        const f = entreeOutil.file_path ?? entreeOutil.notebook_path ?? entreeOutil.path;
        if (typeof f !== 'string' || !f) return { refus: `${e.tool_name} sans chemin lisible : refusé par prudence` };
        const c = cibleProtegee(path.resolve(cwd, f));
        return { refus: c ? `écriture refusée (${c}) : ${f}` : null };
    }
    if (nom !== 'powershell' && nom !== 'bash') return estLibre(cwdLu) ? { refus: null } : { refus: `outil « ${e.tool_name} » non prévu par la porte : fermé par défaut` };
    if (typeof entreeOutil.command !== 'string') return { refus: `commande ${e.tool_name} sans texte lisible : refusé par prudence` };
    const raisons = verdictShell(entreeOutil.command, cwdLu || cwd);
    const aRaisons = cwdLu && raisons.libre ? raisons.protections : raisons;      // chaque instruction dans un dossier de l'API : les raisons RÉSEAU tombent, les protections de la porte restent
    return { refus: aRaisons.length ? `accès réseau refusé par la porte : ${aRaisons.join(' ; ')}. ${MESSAGE_WEBFETCH}` : null };
}

if (require.main === module) {
    // Un hook qui PLANTE sortirait à 1, que Claude Code traite comme non bloquant : tout passerait. Toute erreur refuse (code 2).
    const refuserSurPanne = err => { process.stderr.write(`hook en panne, refusé par prudence : ${err && err.message}\n`); process.exit(2); };
    process.on('uncaughtException', refuserSurPanne);
    process.stdin.on('error', refuserSurPanne);
    let entree = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', d => { entree += d; });
    process.stdin.on('end', () => {
        const v = verdict(entree);
        if (v.refus) { process.stderr.write(v.refus + '\n'); process.exit(2); }
        process.exit(0);
    });
}

module.exports = { verdict, OUTILS, PRIMITIVES, MESSAGE_WEBFETCH, DOSSIERS_LIBRES };
