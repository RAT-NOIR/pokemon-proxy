// Arrete l'ancienne instance du serveur sur son port, et RIEN d'autre.
// Garde ecrite par ce qu'elle AUTORISE : un processus n'est arrete que si, a la fois,
//   1. il ECOUTE (LISTENING, TCP, IPv4 ou IPv6) sur le port du serveur ;
//   2. il s'appelle node.exe ;
//   3. sa ligne de commande a EXACTEMENT deux jetons : l'executable, puis le script, qui vaut
//      `index.js`, `.\index.js`, `./index.js` ou le chemin absolu de l'index.js de CE dossier.
//      Toute option (-r, --require, --inspect...) et tout argument en plus : pas arrete.
// Tout le reste : rien n'est arrete, on dit ce qu'on a vu. Impossible de conclure = rien arrete.
// Le PID est relu dans netstat juste avant l'arret : il doit ecouter TOUJOURS sur le port.
//
// RESIDU ACCEPTE : la forme nue `node index.js` ne dit pas son dossier (la ligne de commande ne
// porte pas le cwd). Elle reste arretee, puisque c'est exactement ce que lance le .bat. Une autre
// copie lancee en forme nue sur le meme port depuis un autre dossier serait donc arretee : en
// pratique c'est le meme serveur (main, api-v2 ou un worktree).
const path = require('path');
const { execFileSync } = require('child_process');

const PID_PROTEGES = new Set([0, 4]);

function decouper(ligneDeCommande) {
  const jetons = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m;
  while ((m = re.exec(ligneDeCommande)) !== null) jetons.push(m[1] !== undefined ? m[1] : m[2]);
  return jetons;
}

function normaliser(p) { return path.win32.normalize(p).toLowerCase(); }

// Exactement deux jetons : [executable, script]. `dossier` = dossier de CE script.
function lanceIndexJs(ligneDeCommande, dossier) {
  if (typeof ligneDeCommande !== 'string' || !ligneDeCommande.trim()) return false;
  const jetons = decouper(ligneDeCommande);
  if (jetons.length !== 2) return false;
  const script = jetons[1];
  if (script === 'index.js' || script === '.\\index.js' || script === './index.js') return true;
  if (!path.win32.isAbsolute(script)) return false;
  return normaliser(script) === normaliser(path.win32.join(dossier || __dirname, 'index.js'));
}

// Port du serveur, comme index.js:110 (`process.env.PORT || 3000`). null = invalide.
function portDuServeur(valeur) {
  if (valeur === undefined || valeur === null || valeur === '') return 3000;
  if (!/^\d+$/.test(String(valeur))) return null;
  const n = Number(valeur);
  return n >= 1 && n <= 65535 ? n : null;
}

// Seule lecture des ecouteurs : { pids (sur le port), nbEcoute (lignes LISTENING de toute la sortie) }
function ecouteurs(netstat, port) {
  const pids = new Set();
  let nbEcoute = 0;
  if (typeof netstat !== 'string') return { pids: [], nbEcoute };
  for (const ligne of netstat.split(/\r?\n/)) {
    const m = /^\s*TCP\s+(\S+)\s+(\S+)\s+LISTENING\s+(\d+)\s*$/i.exec(ligne);
    if (!m) continue;
    nbEcoute++;
    const locale = m[1];
    const i = locale.lastIndexOf(':');
    if (i >= 0 && locale.slice(i + 1) === String(port)) pids.add(Number(m[3]));
  }
  return { pids: [...pids], nbEcoute };
}

// netstat : sortie brute de `netstat -ano` ; processus : { pid -> { nom, ligneDeCommande } }
function decider(netstat, processus, port, dossier) {
  const messages = [];
  const aArreter = [];
  if (typeof netstat !== 'string' || !/\S/.test(netstat)) {
    return { aArreter, messages: ['Je ne peux pas conclure : sortie de netstat absente ou vide. Rien n\'est arrete.'] };
  }
  const table = processus || {};
  const { pids, nbEcoute } = ecouteurs(netstat, port);
  if (nbEcoute === 0) {
    return { aArreter, messages: ['Je ne peux pas conclure : aucun ecouteur lisible dans la sortie de netstat. Rien n\'est arrete.'] };
  }
  if (pids.length === 0) {
    return { aArreter, messages: [`port ${port} libre (aucun processus n'ecoute).`] };
  }
  for (const pid of pids) {
    const p = table[pid];
    const nom = p && p.nom ? p.nom : 'nom inconnu';
    if (PID_PROTEGES.has(pid)) {
      messages.push(`PID ${pid} (${nom}) ecoute sur le port ${port} : processus systeme, pas arrete.`);
    } else if (!p || !p.nom) {
      messages.push(`PID ${pid} ecoute sur le port ${port} : nom inconnu, je ne peux pas conclure, pas arrete.`);
    } else if (String(p.nom).toLowerCase() !== 'node.exe') {
      messages.push(`PID ${pid} (${p.nom}) ecoute sur le port ${port} : ce n'est pas node.exe, pas arrete.`);
    } else if (typeof p.ligneDeCommande !== 'string' || !p.ligneDeCommande.trim()) {
      messages.push(`PID ${pid} (${p.nom}) ecoute sur le port ${port} : ligne de commande inconnue, je ne peux pas conclure, pas arrete.`);
    } else if (!lanceIndexJs(p.ligneDeCommande, dossier)) {
      messages.push(`PID ${pid} (${p.nom}) ecoute sur le port ${port} mais sa ligne de commande n'est pas la forme exacte "node index.js" : pas arrete.`);
    } else {
      aArreter.push(pid);
      messages.push(`PID ${pid} (${p.nom}, index.js) ecoute sur le port ${port} : arret.`);
    }
  }
  return { aArreter, messages };
}

// ---- partie systeme ----
function lireNetstat() {
  return execFileSync('netstat', ['-ano'], { encoding: 'utf8', windowsHide: true, timeout: 30000 });
}

function lireProcessus(pids) {
  const filtre = pids.map(p => `ProcessId=${Number(p)}`).join(' OR ');
  const cmd = `$ErrorActionPreference='Stop'; @(Get-CimInstance Win32_Process -Filter '${filtre}' | ` +
    `Select-Object ProcessId,Name,CommandLine) | ConvertTo-Json -Compress`;
  const sortie = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', cmd],
    { encoding: 'utf8', windowsHide: true, timeout: 30000 }).trim();
  const table = {};
  if (!sortie) return table;
  let liste = JSON.parse(sortie);
  if (!Array.isArray(liste)) liste = [liste];
  for (const e of liste) table[e.ProcessId] = { nom: e.Name, ligneDeCommande: e.CommandLine };
  return table;
}

function main() {
  const port = portDuServeur(process.env.PORT);
  if (port === null) {
    console.log('PORT n\'est pas un entier de 1 a 65535 : je ne peux pas conclure. Rien n\'est arrete.');
    return;
  }
  let netstat;
  try { netstat = lireNetstat(); }
  catch (e) { console.log('Je ne peux pas conclure : netstat a echoue. Rien n\'est arrete.'); return; }
  const { pids } = ecouteurs(netstat, port);
  let table = {};
  if (pids.length) {
    try { table = lireProcessus(pids); }
    catch (e) { console.log('Processus illisibles (' + e.message.split('\n')[0] + ') : je ne peux pas conclure.'); table = {}; }
  }
  const { aArreter, messages } = decider(netstat, table, port, __dirname);
  for (const m of messages) console.log(m);
  let arretes = 0;
  for (const pid of aArreter) {
    let encore = false;
    try { encore = ecouteurs(lireNetstat(), port).pids.includes(pid); } catch (e) { encore = false; }
    if (!encore) { console.log(`PID ${pid} : n'ecoute plus avec certitude sur le port ${port}, pas arrete.`); continue; }
    try { process.kill(pid); arretes++; console.log(`PID ${pid} arrete.`); }
    catch (e) { console.log(`PID ${pid} : arret impossible (${e.message}).`); }
  }
  if (arretes) console.log('Ancienne instance fermee.');
}

module.exports = { decider, lanceIndexJs, ecouteurs, portDuServeur };
if (require.main === module) main();
