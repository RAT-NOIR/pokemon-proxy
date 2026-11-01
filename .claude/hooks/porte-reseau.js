// Hook PreToolUse : LA PORTE RÉSEAU UNIQUE (décision du testeur, 2026-11-01 ; corrigé au tour 1 de relecture).
// Deux écarts du 01/11 (une page lue avant son robots.txt, une requête vers un hôte fermé) venaient d'outils qui ignorent nos règles. Tout accès réseau d'un agent passe donc par
//   node collecte-cartes/porte-reseau.js lire <url> --texte --sortie=<fichier>
// qui refuse un hôte fermé et toute page tant que le robots.txt de l'hôte n'a pas été lu et respecté. Ce hook ferme les autres chemins.
//
// FERMÉ PAR DÉFAUT (H6) : le nom de l'outil est comparé sans casse ; seuls PowerShell et Bash (analysés), Write/Edit/NotebookEdit (protection du dossier de la porte et des arrêts) sont
// examinés ; WebFetch, les outils de navigation (mcp__claude-in-chrome__*, mcp__Claude_Browser__*, mcp__remote-devices__*) et TOUT AUTRE outil reçu sont refusés ; une entrée qui n'est pas
// un objet à tool_name est refusée. => le matcher de .claude/settings.json ne doit nommer QUE les outils à examiner (WebFetch|PowerShell|Bash|Write|Edit|NotebookEdit|mcp__…) : un outil
// inoffensif (Read, WebSearch…) qui arriverait ici serait refusé.
// SHELL : voir les listes ci-dessous ; un script (node, python, .ps1) qui porte une primitive réseau ne passe QUE s'il est SUIVI par git DANS CE DÉPÔT et IDENTIQUE à HEAD
// (git diff --quiet HEAD) — « suivi » seul ne prouve rien (un script suivi modifié, un fichier seulement ajouté à l'index). Il n'y a PLUS de dérogation « requiert la porte ».
// Code 2 = refus : le message part sur stderr et revient à l'agent. Toute panne, toute entrée illisible REFUSE (une garde qui ne peut pas conclure bloque et le dit).
//
// LIMITE ÉCRITE (16) : ce hook est une liste de motifs pour le shell ; il arrête les erreurs d'un agent de bonne foi (le cas réel : WebFetch, curl), pas un agent qui cherche à le contourner
// (un binaire renommé, un langage non listé, un script suivi qui en appelle un autre — pas suivi transitivement). WebFetch, lui, est refusé sans exception.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const MESSAGE_WEBFETCH = 'accès réseau par la porte seulement : node collecte-cartes/porte-reseau.js lire <url> --texte --sortie=<fichier>';
const MAX_SCRIPT = 2 * 1024 * 1024;
const DEPOT = path.resolve(__dirname, '..', '..');
const PORTE_JS = path.join(DEPOT, 'collecte-cartes', 'porte-reseau.js').toLowerCase();

const mot = nom => new RegExp(`(^|[^\\w.-])${nom}(\\.exe)?(?![\\w-])`, 'i');
const OUTILS = [
    ...['curl', 'wget', 'iwr', 'irm', 'iex', 'bitsadmin', 'ssh', 'scp', 'sftp', 'nc', 'ncat', 'telnet', 'ftp', 'tftp', 'npx', 'deno', 'bun', 'ruby', 'perl', 'php', 'wsl'].map(n => ({ re: mot(n), nom: n })),
    { re: /\bInvoke-WebRequest\b/i, nom: 'Invoke-WebRequest' },
    { re: /\bInvoke-RestMethod\b/i, nom: 'Invoke-RestMethod' },
    { re: /\bInvoke-Expression\b/i, nom: 'Invoke-Expression' },
    { re: /\bStart-BitsTransfer\b/i, nom: 'Start-BitsTransfer' },
    { re: /\bcertutil(\.exe)?\b[\s\S]*-urlcache/i, nom: 'certutil -urlcache' },
    { re: /\bTest-NetConnection\b/i, nom: 'Test-NetConnection' },
    { re: /Net\.WebClient|Net\.Http|WebRequest\]::|TcpClient|UdpClient|System\.Net\.Sockets|XMLHTTP|Msxml2|WinHttp/i, nom: 'classe réseau .NET/COM' },
    { re: /\b(npm\s+exec|pnpm\s+dlx|yarn\s+dlx)\b/i, nom: 'exécution de paquet distant' },
    { re: /\b(powershell|pwsh)(\.exe)?\b[^\n]*\s-e(c|nc?\w*)?(\s|:|$)/i, nom: 'powershell -EncodedCommand' },
];
const PRIMITIVES = [
    { re: /\bfetch\s*\(/, nom: 'fetch(' },
    { re: /(?:require\s*\(\s*|from\s+|import\s*\(?\s*)['"`](?:node:)?(?:https?|http2|net|tls|dgram|child_process|undici|node-fetch|axios|got|puppeteer(?:-core)?|playwright(?:-core)?|ws)['"`]/, nom: 'module réseau ou child_process' },
    { re: /\b(?:net|tls)\.(?:connect|createConnection)\b/, nom: 'net/tls.connect' },
    { re: /\bWebSocket\b/, nom: 'WebSocket' },
    { re: /\bXMLHttpRequest\b/, nom: 'XMLHttpRequest' },
    { re: /\bimport\s*\(/, nom: 'import() dynamique' },
];
const PY_RESEAU = /\bimport\b[^\n]*\b(?:requests|urllib3?|httpx|aiohttp|socket|http\.client|ftplib|smtplib|telnetlib)\b|^\s*from\s+(?:requests|urllib3?|httpx|aiohttp|socket|http\.client|ftplib|smtplib|telnetlib)\b/m;
const PY_MODULES_REFUSES = /^(http|urllib|socket|ftplib|smtplib|telnetlib|requests|pip|ensurepip|xmlrpc)/i;
const NODE_VALEURS = new Set(['-r', '--require', '--import', '--loader', '--experimental-loader', '--env-file', '--conditions', '-c', '--stack-size', '--max-old-space-size']);
const NODE_EVAL = /^(-e|-p|-pe|--eval|--print|--input-type)/;
const G_DEFINITION = /\$g\s*=\s*\(Get-ChildItem\s+"\$env:LOCALAPPDATA\\GitHubDesktop"\s+-Filter\s+'app-\*'\s+-Directory\s*\|\s*Sort-Object\s+Name\s+-Descending\s*\|\s*Select-Object\s+-First\s+1\)\.FullName\s*\+\s*'\\resources\\app\\git\\cmd\\git\.exe'/i;
const GIT_SENSIBLES = new Set(['clone', 'fetch', 'pull', 'push', 'ls-remote', 'archive', 'submodule', 'remote', 'config']);
const GIT_HOTES_PERMIS = new Set(['github.com', 'www.github.com']);
const MODIFIE = /(^|[^\w-])(remove-item|del|erase|rm|rmdir|rd|set-content|add-content|clear-content|out-file|copy-item|cp|copy|move-item|mv|move|rename-item|ren|new-item|ni|tee|tee-object|sc|ac|ri|mi|ci|cpi)(?![\w-])|>/i;
const ECRIT_SCRIPT = /(?:>>?|(?:^|[^\w-])(?:set-content|add-content|out-file|new-item|copy-item|move-item|rename-item|tee|tee-object|sc|ac|ni|cp|mv|copy|move)(?![\w-]))[^\n;|&]{0,160}?\.(?:c?m?js|py|ps1)\b/i;
const LANCE_SCRIPT = /(^|[^\w.-])(node|python3?|py|powershell|pwsh)(\.exe)?(?![\w-])|\.ps1\b/i;
const CHANGE_DOSSIER = /(^|[;&|\r\n]\s*)(cd|chdir|sl|set-location|push-location|pushd)(?![\w-])/i;

const DEFAUT_PORTE = 'C:\\Users\\Yung\\rat-market-travail\\catalogue\\porte-reseau';
const DEFAUT_ARRETS = 'C:\\Users\\Yung\\rat-market-travail\\catalogue\\arrets-hotes';
const dossierPorte = () => (process.env.PORTE_RESEAU_DOSSIER || DEFAUT_PORTE);
const dossierArrets = () => (process.env.ARRETS_HOTES_DOSSIER || DEFAUT_ARRETS);
const bas = p => path.resolve(p).toLowerCase();
const sous = (a, d) => { const x = bas(d); return a === x || a.startsWith(x.endsWith(path.sep) ? x : x + path.sep); };

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
/** D2 : suivi par git DANS CE DÉPÔT ET identique à HEAD (ni modifié, ni seulement ajouté à l'index). Un échec, quel qu'il soit, vaut « non ». */
function identiqueAHead(fichier) {
    try {
        const dir = path.dirname(fichier);
        if (bas(git(['rev-parse', '--show-toplevel'], dir).trim()) !== bas(DEPOT)) return false;
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

function verdictGit(ins) {
    const t = jetons(ins.replace(/^\s*&\s*/, ''));
    let i = t.findIndex(x => /(^|[\\/])git(\.exe)?$/i.test(x) || x.toLowerCase() === '$g');
    if (i < 0) return null;
    for (let j = i + 1; j < t.length; j++) {
        if (t[j] === '-c' && t[j + 1] && /(sshcommand|gitproxy|fsmonitor|pager|editor|askpass|^alias\.|credential\.helper|http\.proxy|^url\.)/i.test(t[j + 1])) return `git -c ${t[j + 1]} : réglage qui lance un programme ou détourne l'adresse`;
    }
    i++;
    while (i < t.length && t[i].startsWith('-')) i += (t[i] === '-C' || t[i] === '-c') ? 2 : 1;
    const sub = (t[i] || '').toLowerCase();
    if (!GIT_SENSIBLES.has(sub)) return null;
    if (sub === 'config' && /\burl\.\S*\.(pushinsteadof|insteadof)/i.test(ins)) return 'git config url.*.insteadOf : réécriture d\'adresse';
    const adresses = ins.match(/(?:https?|git|ssh|ftps?):\/\/[^\s'"]+|[\w.-]+@[\w.-]+:[^\s'"]*/gi) || [];
    for (const m of ins.matchAll(/--remote=([^\s'"]+)/gi)) if (!/^(?:\w+:\/\/|[\w.-]+@)/.test(m[1])) adresses.push(`ssh://${m[1].split(':')[0]}/`);
    for (const a of adresses) {
        let h;
        try { h = /:\/\//.test(a) ? new URL(a).hostname : a.split('@')[1].split(':')[0]; } catch { return `git ${sub} : adresse illisible (${a})`; }
        if (!GIT_HOTES_PERMIS.has(h.toLowerCase())) return `git ${sub} vers ${h} : seul github.com est permis`;
    }
    return null;
}

function verdictScriptNode(ins, ctx) {
    const t = jetons(ins);
    const i = t.findIndex(x => /^node(\.exe)?$/i.test(path.basename(x)));
    if (i < 0) return null;
    let script = null;
    for (let j = i + 1; j < t.length; j++) {
        const o = t[j];
        if (o === '-') return 'node lit son programme sur stdin';
        if (o.startsWith('-')) {
            if (NODE_EVAL.test(o)) return `node ${o} : code en ligne`;
            if (/^(-v|--version|-h|--help)$/.test(o)) return null;
            if (NODE_VALEURS.has(o) && !o.includes('=')) j++;
            continue;
        }
        script = o; break;
    }
    if (script === null) return 'node sans script lisible (stdin ?)';
    if (nonResolu(script) || !/\.[cm]?js$/i.test(script)) return `script node « ${script} » non résolu (variable, sans extension .js) : refusé`;
    if (ctx.changeDossier && !path.isAbsolute(script)) return `script node « ${script} » relatif après un changement de dossier dans la commande : chemin incertain`;
    const abs = path.resolve(ctx.cwd, script), s = lireScript(abs);
    if (!s) return `script node « ${script} » introuvable : non résolu, refusé`;
    if (abs.toLowerCase() === PORTE_JS) ctx.estPorte = true;
    const prim = s.trop ? ['fichier trop gros pour être lu'] : PRIMITIVES.filter(m => m.re.test(s.texte)).map(m => m.nom);
    if (!prim.length) return null;
    return identiqueAHead(abs) ? null : `script node « ${script} » avec accès réseau (${prim.join(', ')}) qui n'est pas suivi par git dans ce dépôt ET identique à HEAD`;
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
        return s.trop || PY_RESEAU.test(s.texte) ? `script python « ${o} » à accès réseau (requests, urllib, httpx, aiohttp, socket, http.client…)` : null;
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
    return identiqueAHead(abs) ? null : `script PowerShell « ${cible} » avec accès réseau (${prim.join(', ')}) qui n'est pas suivi par git dans ce dépôt ET identique à HEAD`;
}

/** D4 : une écriture vers le dossier de la porte (robots\, cadence\, journal) ou vers un ARRET/LEVEE/PAUSE-HOTE est refusée. */
function cibleProtegee(abs) {
    const porte = dossierPorte(), arrets = dossierArrets();
    if (/^(arret|levee|pause)-hote-.*\.json$/i.test(path.basename(abs))) return 'fichier ARRET-HOTE / LEVEE-HOTE / PAUSE-HOTE (fermer passe par porte-reseau.js fermer)';
    if (sous(abs, path.join(porte, 'robots')) || sous(abs, path.join(porte, 'cadence')) || abs === bas(path.join(porte, 'journal.jsonl'))) return 'dossier de la porte (robots\\, cadence\\, journal.jsonl)';
    if (sous(abs, arrets)) return 'dossier des arrêts';
    return null;
}
function mentionneProtege(cmd) {
    const t = cmd.toLowerCase().replace(/\//g, '\\');
    const porte = bas(dossierPorte()), arrets = bas(dossierArrets());
    return /(arret|levee|pause)-hote-/.test(t) || t.includes(arrets) || t.includes(path.join(porte, 'robots')) || t.includes(path.join(porte, 'cadence')) || t.includes(path.join(porte, 'journal.jsonl'))
        || /porte-reseau\\(robots|cadence|journal\.jsonl)/.test(t) || /arrets-hotes/.test(t);
}

function verdictShell(cmd, cwd) {
    const raisons = [];
    if (mentionneProtege(cmd) && MODIFIE.test(cmd)) raisons.push('modification du dossier de la porte ou des arrêts (ARRET/LEVEE/PAUSE-HOTE, robots\\, cadence\\, journal)');
    // H1/H3 : l'opérateur d'appel & sur une cible non résolue ; seule la forme $g du CLAUDE.md §3 (définie dans la même commande, une seule fois) est admise
    if (/&\s*\(/.test(cmd)) raisons.push('opérateur & sur une expression (cible non résolue)');
    const gOk = G_DEFINITION.test(cmd) && (cmd.match(/\$g\s*=/gi) || []).length === 1;
    for (const m of cmd.matchAll(/&\s*["']?\$(\w+)/g)) if (!(m[1].toLowerCase() === 'g' && gOk)) raisons.push(`& $${m[1]} : cible non résolue (seul $g défini comme au CLAUDE.md §3 est admis)`);
    const ctx = { cwd, changeDossier: CHANGE_DOSSIER.test(cmd), estPorte: false };
    const hors = [];
    for (const ins of cmd.split(/[;|&\r\n]+/)) {
        if (!ins.trim()) continue;
        if (/^\s*(&\s*)?(["'][^"']*git(\.exe)?["']|\$g\b|git(\.exe)?(?![\w-]))/i.test(ins)) { const g = verdictGit(ins); if (g) raisons.push(g); continue; }
        hors.push(ins);
        const n = verdictScriptNode(ins, ctx); if (n) raisons.push(n);
        const p = verdictScriptPython(ins, ctx); if (p) raisons.push(p);
        const s = verdictScriptPs1(ins, ctx); if (s) raisons.push(s);
        if (ctx.estPorte && /^\s*(node|"?[^"\s]*node(\.exe)?"?)\b/i.test(ins)) { ctx.estPorte = false; continue; }      // la porte elle-même : l'adresse qu'on lui donne n'est pas un outil
        const touches = OUTILS.filter(m => m.re.test(ins)).map(m => m.nom);
        if (touches.length) raisons.push(`outil réseau (${touches.join(', ')})`);
    }
    const reste = hors.join(' ; ');
    if (ECRIT_SCRIPT.test(reste) && LANCE_SCRIPT.test(reste)) raisons.push('écriture d\'un script (.js, .py, .ps1) puis exécution dans la même commande');
    return raisons;
}

function verdict(entree) {
    let e;
    try { e = JSON.parse(entree); } catch { return { refus: 'entrée du hook illisible (JSON attendu) : refusé par prudence' }; }
    if (!e || typeof e !== 'object' || Array.isArray(e) || typeof e.tool_name !== 'string') return { refus: 'entrée du hook sans tool_name lisible : refusé par prudence' };
    const nom = e.tool_name.toLowerCase();
    if (nom === 'webfetch') return { refus: `WebFetch est fermé : ${MESSAGE_WEBFETCH}` };
    if (/^mcp__(claude-in-chrome|claude_browser|remote-devices)__/.test(nom)) return { refus: `outil de navigation « ${e.tool_name} » fermé : ${MESSAGE_WEBFETCH}` };
    const entreeOutil = e.tool_input && typeof e.tool_input === 'object' ? e.tool_input : {};
    const cwd = typeof e.cwd === 'string' && e.cwd ? e.cwd : process.cwd();
    if (nom === 'write' || nom === 'edit' || nom === 'notebookedit') {
        const f = entreeOutil.file_path ?? entreeOutil.notebook_path ?? entreeOutil.path;
        if (typeof f !== 'string' || !f) return { refus: `${e.tool_name} sans chemin lisible : refusé par prudence` };
        const c = cibleProtegee(bas(path.resolve(cwd, f)));
        return { refus: c ? `écriture refusée (${c}) : ${f}` : null };
    }
    if (nom !== 'powershell' && nom !== 'bash') return { refus: `outil « ${e.tool_name} » non prévu par la porte : fermé par défaut` };
    if (typeof entreeOutil.command !== 'string') return { refus: `commande ${e.tool_name} sans texte lisible : refusé par prudence` };
    const raisons = verdictShell(entreeOutil.command, cwd);
    return { refus: raisons.length ? `accès réseau refusé par la porte : ${raisons.join(' ; ')}. ${MESSAGE_WEBFETCH}` : null };
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

module.exports = { verdict, OUTILS, PRIMITIVES, MESSAGE_WEBFETCH };
