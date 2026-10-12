// Banc de la fonction PURE de decision de arreter-instance-port.js.
// Il n'arrete aucun processus et n'ouvre aucun port : sorties de netstat ecrites en dur.
const { decider } = require('./arreter-instance-port.js');

let ok = 0, ko = 0;
function verifier(nom, cond, detail) {
  if (cond) { ok++; console.log('  ok   ' + nom); }
  else { ko++; console.log('  ECHEC ' + nom + (detail ? ' -> ' + detail : '')); }
}
const EN_TETE = 'Connexions actives\r\n\r\n  Proto  Adresse locale         Adresse distante       Etat           PID\r\n';
const ecoute4 = (p, pid) => `  TCP    0.0.0.0:${p}           0.0.0.0:0              LISTENING       ${pid}\r\n`;
const ecoute6 = (p, pid) => `  TCP    [::]:${p}              [::]:0                 LISTENING       ${pid}\r\n`;
const etablie = (p, pid) => `  TCP    127.0.0.1:52000        127.0.0.1:${p}          ESTABLISHED     ${pid}\r\n`;
const NODE_INDEX = { nom: 'node.exe', ligneDeCommande: '"C:\\Program Files\\nodejs\\node.exe" index.js' };
const NODE_NEXT = { nom: 'node.exe', ligneDeCommande: '"C:\\Program Files\\nodejs\\node.exe" C:\\site\\node_modules\\next\\dist\\bin\\next dev' };
const dit = (r, re) => r.messages.some(m => re.test(m));

// 1. port libre
let r = decider(EN_TETE + ecoute4(8080, 10), {}, 3000);
verifier('port libre : rien a arreter', r.aArreter.length === 0);
verifier('port libre : le dit', dit(r, /port 3000 libre/));

// 2. notre node index.js
r = decider(EN_TETE + ecoute4(3000, 1234), { 1234: NODE_INDEX }, 3000);
verifier('node index.js qui ecoute : arrete', r.aArreter.length === 1 && r.aArreter[0] === 1234);
r = decider(EN_TETE + ecoute4(3000, 1234), { 1234: { nom: 'node.exe', ligneDeCommande: 'node index.js' } }, 3000);
verifier('"node index.js" nu : arrete', r.aArreter.join() === '1234');
r = decider(EN_TETE + ecoute4(3000, 1234), { 1234: { nom: 'NODE.EXE', ligneDeCommande: 'C:\\x\\node.exe C:\\proj\\index.js' } }, 3000);
verifier('chemin complet vers index.js : arrete', r.aArreter.join() === '1234');

// 3. next dev
r = decider(EN_TETE + ecoute4(3000, 55), { 55: NODE_NEXT }, 3000);
verifier('node next dev : pas arrete', r.aArreter.length === 0);
verifier('node next dev : PID et nom imprimes', dit(r, /55/) && dit(r, /node\.exe/) && dit(r, /pas arrete/i));

// 4. autre executable
r = decider(EN_TETE + ecoute4(3000, 77), { 77: { nom: 'java.exe', ligneDeCommande: 'java -jar index.js' } }, 3000);
verifier('autre executable : pas arrete', r.aArreter.length === 0 && dit(r, /java\.exe/));
r = decider(EN_TETE + ecoute4(3000, 78), { 78: { nom: 'notnode.exe', ligneDeCommande: 'notnode.exe index.js' } }, 3000);
verifier('nom proche de node.exe : pas arrete', r.aArreter.length === 0);

// 5. ports voisins
r = decider(EN_TETE + ecoute4(30000, 1234) + ecoute4(13000, 1235), { 1234: NODE_INDEX, 1235: NODE_INDEX }, 3000);
verifier(':30000 et :13000 ne passent pas pour :3000', r.aArreter.length === 0 && dit(r, /libre/));

// 6. ESTABLISHED
r = decider(EN_TETE + etablie(3000, 1234), { 1234: NODE_INDEX }, 3000);
verifier('connexion ESTABLISHED : pas un ecouteur', r.aArreter.length === 0 && dit(r, /libre/));

// 7. ligne de commande inconnue
r = decider(EN_TETE + ecoute4(3000, 1234), { 1234: { nom: 'node.exe', ligneDeCommande: null } }, 3000);
verifier('ligne de commande inconnue : pas arrete', r.aArreter.length === 0 && dit(r, /ne peux pas conclure/i));
r = decider(EN_TETE + ecoute4(3000, 1234), {}, 3000);
verifier('PID absent de la table : pas arrete', r.aArreter.length === 0);
r = decider(EN_TETE + ecoute4(3000, 1234), { 1234: { nom: 'node.exe', ligneDeCommande: '' } }, 3000);
verifier('ligne de commande vide : pas arrete', r.aArreter.length === 0);

// 8. IPv6
r = decider(EN_TETE + ecoute6(3000, 1234), { 1234: NODE_INDEX }, 3000);
verifier('IPv6 [::]:3000 reconnu', r.aArreter.join() === '1234');

// 9. PID 0 et 4
r = decider(EN_TETE + ecoute4(3000, 4) + ecoute6(3000, 0), { 4: NODE_INDEX, 0: NODE_INDEX }, 3000);
verifier('PID 0 et 4 jamais arretes', r.aArreter.length === 0);

// 10. plusieurs ecouteurs : seulement ceux qui passent
r = decider(EN_TETE + ecoute4(3000, 1234) + ecoute6(3000, 1234) + ecoute4(3000, 55), { 1234: NODE_INDEX, 55: NODE_NEXT }, 3000);
verifier('plusieurs PID : seul le bon, une fois', r.aArreter.join() === '1234');

// 11. sortie illisible / vide : ne conclut pas
r = decider('', {}, 3000);
verifier('netstat vide : ne conclut pas, rien arrete', r.aArreter.length === 0 && dit(r, /ne peux pas conclure/i));
r = decider(null, {}, 3000);
verifier('netstat absent : rien arrete', r.aArreter.length === 0 && dit(r, /ne peux pas conclure/i));

// 12. script autre que index.js
r = decider(EN_TETE + ecoute4(3000, 9), { 9: { nom: 'node.exe', ligneDeCommande: 'node monindex.js' } }, 3000);
verifier('monindex.js : pas arrete', r.aArreter.length === 0);
r = decider(EN_TETE + ecoute4(3000, 9), { 9: { nom: 'node.exe', ligneDeCommande: 'node other.js index.js' } }, 3000);
verifier('index.js simple argument d\'un autre script : pas arrete', r.aArreter.length === 0);

console.log(`\n${ok} reussis, ${ko} en echec (sur ${ok + ko})`);
process.exit(ko ? 1 : 0);
