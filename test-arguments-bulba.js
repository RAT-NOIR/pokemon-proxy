// node test-arguments-bulba.js — la ligne de commande de collecteur-images-bulba.js s'écrit par ce qu'elle AUTORISE.
// L'occurrence (2026-09-23) : `--plan=SHF` n'est pas `--plan`. Le drapeau ne mordait pas, le script est passé en
// COLLECTE, sans `--sets=`, donc sur TOUS les sets occidentaux, verrou global Bulbapedia pris — en local, où le dépôt
// l'interdit (« le worker Render est le seul collecteur »). Zéro requête par chance (PBL était en cache), un set rejoint.
// Un argument qu'on ne connaît pas REFUSE, avant toute connexion ; une collecte sans `--sets=` REFUSE.
const { spawnSync } = require('child_process');

let ok = 0, ko = 0;
const lancer = (...args) => spawnSync(process.execPath, ['collecteur-images-bulba.js', ...args], { encoding: 'utf8', timeout: 20000, env: { ...process.env, MONGODB_CARTES_URI: 'mongodb://127.0.0.1:1/refuse-avant-connexion' } });
const verifier = (nom, r, codeAttendu, motif) => {
    const sortie = `${r.stdout}${r.stderr}`;
    const bon = r.status === codeAttendu && motif.test(sortie);
    if (bon) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   code ${r.status} (attendu ${codeAttendu})\n   ${sortie.slice(0, 400)}`); }
};

verifier('--plan=SHF est refusé (argument inconnu), avant toute connexion', lancer('--plan=SHF'), 2, /argument inconnu.*--plan=SHF/s);
verifier('--sets sans valeur est refusé', lancer('--sets'), 2, /argument inconnu.*--sets/s);
verifier('une collecte sans --sets= est refusée', lancer('--attendre'), 2, /--sets=/);
verifier('aucun argument : refusé (ce serait une collecte de tout)', lancer(), 2, /--sets=/);

console.log(`\n${ok} passés, ${ko} en échec`);
process.exit(ko ? 1 : 0);
