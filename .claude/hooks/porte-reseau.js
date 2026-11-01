// Hook PreToolUse (WebFetch, PowerShell, Bash) : LA PORTE RÉSEAU UNIQUE (décision du testeur, 2026-11-01).
// Deux écarts du 01/11 (une page lue avant son robots.txt, une requête vers un hôte fermé) venaient d'outils qui ignorent nos règles. Tout accès réseau d'un agent passe donc par
//   node collecte-cartes/porte-reseau.js lire <url> --texte --sortie=<fichier>
// qui refuse un hôte fermé et toute page tant que le robots.txt de l'hôte n'a pas été lu et respecté. Ce hook ferme les autres chemins :
//   · WebFetch : TOUJOURS refusé (WebSearch n'est pas concerné) ;
//   · PowerShell / Bash : refus d'un outil réseau (curl, wget, Invoke-WebRequest, iwr, Invoke-RestMethod, irm, Start-BitsTransfer, bitsadmin, certutil -urlcache, Net.WebClient, Net.Http,
//     WebRequest]::, Invoke-Expression avec http, python/py <script> qui importe requests/urllib/httpx/aiohttp) ; git reste permis (fetch/push vers origin) ;
//   · `node <script.js>` : le fichier est LU (≤ 2 Mo) ; s'il porte une primitive réseau (fetch(, require/import de http, https, undici, node-fetch, axios, got, puppeteer, playwright, net.connect,
//     tls.connect), il ne passe QUE s'il requiert porte-reseau, reponse-hote ou recolte-hote, OU s'il est SUIVI par git dans son dépôt (git ls-files --error-unmatch ; un échec = non suivi).
// Code 2 = refus : le message part sur stderr et revient à l'agent. Toute panne, toute entrée illisible REFUSE (une garde qui ne peut pas conclure bloque et le dit).
//
// LIMITES ÉCRITES : (1) un script SUIVI qui en appelle un autre n'est pas suivi transitivement (le script appelé passe s'il est lui-même suivi, ou n'est pas lu) ; (2) un script introuvable passe
// (ce n'est pas un script réseau qu'on peut lire) ; (3) la commande est découpée en instructions sur ; | & et sauts de ligne SANS tenir compte des guillemets : un git dont le message cite
// « curl » après un point-virgule est refusé (sens prudent) ; (4) un outil réseau lancé par un autre moyen (binaire renommé, script dans un autre langage) n'est pas vu.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const MESSAGE_WEBFETCH = 'accès réseau par la porte seulement : node collecte-cartes/porte-reseau.js lire <url> --texte --sortie=<fichier>';
const MAX_SCRIPT = 2 * 1024 * 1024;

const OUTILS = [
    { re: /\bcurl(\.exe)?\b/i, nom: 'curl' },
    { re: /\bwget(\.exe)?\b/i, nom: 'wget' },
    { re: /\bInvoke-WebRequest\b/i, nom: 'Invoke-WebRequest' },
    { re: /(^|[^\w-])iwr\b/i, nom: 'iwr' },
    { re: /\bInvoke-RestMethod\b/i, nom: 'Invoke-RestMethod' },
    { re: /(^|[^\w-])irm\b/i, nom: 'irm' },
    { re: /\bStart-BitsTransfer\b/i, nom: 'Start-BitsTransfer' },
    { re: /\bbitsadmin(\.exe)?\b/i, nom: 'bitsadmin' },
    { re: /\bcertutil(\.exe)?\b[\s\S]*-urlcache/i, nom: 'certutil -urlcache' },
    { re: /Net\.WebClient/i, nom: 'Net.WebClient' },
    { re: /Net\.Http/i, nom: 'Net.Http' },
    { re: /WebRequest\]::/i, nom: 'WebRequest]::' },
    { re: /\b(Invoke-Expression|iex)\b[\s\S]*https?:/i, nom: 'Invoke-Expression avec http' },
];
const PRIMITIVES = [
    { re: /\bfetch\s*\(/, nom: 'fetch(' },
    { re: /(?:require\s*\(\s*|from\s+|import\s*\(?\s*)['"`](?:node:)?(?:https?|http2|undici|node-fetch|axios|got|puppeteer(?:-core)?|playwright(?:-core)?)['"`]/, nom: 'module réseau' },
    { re: /\b(?:net|tls)\.connect\b/, nom: 'net/tls.connect' },
];
const AUTORISE = /['"`][^'"`\n]*(?:porte-reseau|reponse-hote|recolte-hote)(?:\.js)?['"`]/;
const PY_RESEAU = /\bimport\b[^\n]*\b(?:requests|urllib|httpx|aiohttp)\b|^\s*from\s+(?:requests|urllib|httpx|aiohttp)\b/m;

/** git, résolu comme au CLAUDE.md §3 (jamais un numéro de version en dur). Rend un chemin, ou 'git' (PATH) à défaut. */
function cheminGit() {
    try {
        const base = path.join(process.env.LOCALAPPDATA || '', 'GitHubDesktop');
        const apps = fs.readdirSync(base).filter(n => /^app-/.test(n)).sort().reverse();
        for (const a of apps) { const g = path.join(base, a, 'resources', 'app', 'git', 'cmd', 'git.exe'); if (fs.existsSync(g)) return g; }
    } catch { /* pas de GitHub Desktop : git du PATH */ }
    return 'git';
}
/** Le fichier est-il suivi par git dans son dépôt ? Un échec, quel qu'il soit, vaut « non suivi ». */
function suiviParGit(fichier) {
    try { execFileSync(cheminGit(), ['ls-files', '--error-unmatch', fichier], { cwd: path.dirname(fichier), stdio: 'ignore', timeout: 15000, windowsHide: true }); return true; }
    catch { return false; }
}

const jetons = s => (s.match(/"[^"]*"|'[^']*'|\S+/g) || []).map(t => t.replace(/^["']|["']$/g, ''));
const estGit = s => /^\s*(&\s*)?(["'][^"']*git(\.exe)?["']|\$g\b|git(\.exe)?\b)/i.test(s);

function scriptsApres(instruction, interprete, extension) {
    const t = jetons(instruction), sortie = [];
    for (let i = 0; i < t.length; i++) {
        if (!interprete.test(path.basename(t[i]))) continue;
        for (let j = i + 1; j < t.length; j++) if (!t[j].startsWith('-') && extension.test(t[j])) sortie.push(t[j]);
        break;
    }
    return sortie;
}
function lireScript(fichier) {
    try {
        const st = fs.statSync(fichier);
        if (!st.isFile()) return null;
        if (st.size > MAX_SCRIPT) return { trop: true, texte: '' };
        return { texte: fs.readFileSync(fichier, 'utf8') };
    } catch { return null; }          // introuvable : ce n'est pas un script réseau qu'on peut lire
}

function verdict(entree) {
    let e;
    try { e = JSON.parse(entree); } catch { return { refus: 'entrée du hook illisible (JSON attendu) : refusé par prudence' }; }
    const outil = e && e.tool_name;
    if (outil === 'WebFetch') return { refus: `WebFetch est fermé : ${MESSAGE_WEBFETCH}` };
    if (outil !== 'PowerShell' && outil !== 'Bash') return { refus: null };
    const cmd = e.tool_input && typeof e.tool_input.command === 'string' ? e.tool_input.command : null;
    if (cmd === null) return { refus: `commande ${outil} sans texte lisible : refusé par prudence` };
    const cwd = typeof e.cwd === 'string' && e.cwd ? e.cwd : process.cwd();
    const instructions = cmd.split(/[;|&\r\n]+/);
    const raisons = [];
    for (const ins of instructions) {
        if (!ins.trim() || estGit(ins)) continue;
        const touches = OUTILS.filter(m => m.re.test(ins)).map(m => m.nom);
        if (touches.length) raisons.push(`outil réseau (${touches.join(', ')})`);
        for (const f of scriptsApres(ins, /^python[\d.]*(\.exe)?$|^py(\.exe)?$/i, /\.py$/i)) {
            const s = lireScript(path.resolve(cwd, f));
            if (s && (s.trop || PY_RESEAU.test(s.texte))) raisons.push(`script python « ${f} » à accès réseau (requests, urllib, httpx, aiohttp)`);
        }
        for (const f of scriptsApres(ins, /^node(\.exe)?$/i, /\.[cm]?js$/i)) {
            const abs = path.resolve(cwd, f), s = lireScript(abs);
            if (!s) continue;
            const prim = s.trop ? ['fichier trop gros pour être lu'] : PRIMITIVES.filter(m => m.re.test(s.texte)).map(m => m.nom);
            if (!prim.length) continue;
            if (!s.trop && AUTORISE.test(s.texte)) continue;
            if (suiviParGit(abs)) continue;
            raisons.push(`script node « ${f} » avec accès réseau (${prim.join(', ')}), qui ne requiert ni porte-reseau, ni reponse-hote, ni recolte-hote, et n'est pas suivi par git`);
        }
    }
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
