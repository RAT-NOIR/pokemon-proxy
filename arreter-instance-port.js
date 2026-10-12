// Arrete l'ancienne instance du serveur sur son port, et RIEN d'autre.
// Garde ecrite par ce qu'elle AUTORISE : un processus n'est arrete que si, a la fois,
//   1. il ECOUTE (LISTENING, TCP, IPv4 ou IPv6) sur le port du serveur ;
//   2. il s'appelle node.exe ;
//   3. sa ligne de commande lance index.js (premier argument non-option).
// Tout le reste : rien n'est arrete et on dit ce qu'on a vu. Impossible de conclure = rien arrete.
const { execFileSync } = require('child_process');

const PID_PROTEGES = new Set([0, 4]);

function decouper(ligneDeCommande) {
  const jetons = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m;
  while ((m = re.exec(ligneDeCommande)) !== null) jetons.push(m[1] !== undefined ? m[1] : m[2]);
  return jetons;
}

function lanceIndexJs(ligneDeCommande) {
  if (typeof ligneDeCommande !== 'string' || !ligneDeCommande.trim()) return false;
  const jetons = decouper(ligneDeCommande);
  const script = jetons.slice(1).find(j => !j.startsWith('-'));
  if (!script) return false;
  return /^(?:.*[\\/])?index\.js$/i.test(script);
}

// netstat : sortie brute de `netstat -ano` ; processus : { pid -> { nom, ligneDeCommande } }
function decider(netstat, processus, port) {
  const messages = [];
  const aArreter = [];
  if (typeof netstat !== 'string' || !/\S/.test(netstat)) {
    return { aArreter, messages: ['Je ne peux pas conclure : sortie de netstat absente ou vide. Rien n\'est arrete.'] };
  }
  const table = processus || {};
  const ecouteurs = new Set();
  for (const ligne of netstat.split(/\r?\n/)) {
    const m = /^\s*TCP\s+(\S+)\s+(\S+)\s+LISTENING\s+(\d+)\s*$/i.exec(ligne);
    if (!m) continue;
    const locale = m[1];
    const i = locale.lastIndexOf(':');
    if (i < 0 || locale.slice(i + 1) !== String(port)) continue;
    ecouteurs.add(Number(m[3]));
  }
  if (ecouteurs.size === 0) {
    return { aArreter, messages: [`port ${port} libre (aucun processus n'ecoute).`] };
  }
  for (const pid of ecouteurs) {
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
    } else if (!lanceIndexJs(p.ligneDeCommande)) {
      messages.push(`PID ${pid} (${p.nom}) ecoute sur le port ${port} mais ne lance pas index.js (${p.ligneDeCommande}) : pas arrete.`);
    } else {
      aArreter.push(pid);
      messages.push(`PID ${pid} (${p.nom}, index.js) ecoute sur le port ${port} : arret.`);
    }
  }
  return { aArreter, messages };
}

// ---- partie systeme ----
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
  const port = Number(process.env.PORT) || 3000;
  let netstat;
  try {
    netstat = execFileSync('netstat', ['-ano'], { encoding: 'utf8', windowsHide: true, timeout: 30000 });
  } catch (e) {
    console.log('Je ne peux pas conclure : netstat a echoue. Rien n\'est arrete.');
    return;
  }
  // 1re passe : qui ecoute ? (table vide -> messages ignores, on ne garde que les PID)
  const pids = [];
  for (const ligne of netstat.split(/\r?\n/)) {
    const m = /^\s*TCP\s+(\S+)\s+\S+\s+LISTENING\s+(\d+)\s*$/i.exec(ligne);
    if (m && m[1].slice(m[1].lastIndexOf(':') + 1) === String(port)) pids.push(Number(m[2]));
  }
  let table = {};
  if (pids.length) {
    try { table = lireProcessus([...new Set(pids)]); }
    catch (e) { console.log('Processus illisibles (' + e.message.split('\n')[0] + ') : je ne peux pas conclure.'); table = {}; }
  }
  const { aArreter, messages } = decider(netstat, table, port);
  for (const m of messages) console.log(m);
  for (const pid of aArreter) {
    try { process.kill(pid); console.log(`PID ${pid} arrete.`); }
    catch (e) { console.log(`PID ${pid} : arret impossible (${e.message}).`); }
  }
  if (aArreter.length) console.log('Ancienne instance fermee.');
}

module.exports = { decider, lanceIndexJs };
if (require.main === module) main();
