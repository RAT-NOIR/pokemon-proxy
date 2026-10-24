// ============================================================
// LANCER UN OUTIL DU DÉPÔT « À BLANC » — lecture seule, par construction (PHASE 3a, 2026-10-24)
// ============================================================
//   $env:NODE_PATH='C:\Users\Yung\Desktop\pokemon-proxy\node_modules'
//   node lancer-a-blanc.js <outil.js> [arguments de l'outil]
//
// Pourquoi : des outils de pose (poser-wcd.js, poser-pps.js, poser-reimpressions.js…) SIMULENT par défaut, mais ouvrent la base par
// `ouvrirConnexions` (collecte-cartes/garde.js), c'est-à-dire par la connexion d'ÉCRITURE. Ce lanceur lance l'outil dans un processus fils, comme module
// principal, avec `-r a-blanc-precharge.js` :
//   1. l'environnement du fils ne garde que les deux URI de LECTURE SEULE (utilisateurs Atlas de lecture) et les clés R2 de l'archive ;
//      toute autre variable (MONGODB_URI, MONGODB_CARTES_URI, Stripe, Render…) est SUPPRIMÉE avant que l'outil ne soit chargé ;
//   2. `ouvrirConnexions` est remplacé par une ouverture des mêmes connexions mongoose sur ces URI de lecture : même forme rendue
//      ({ cartes, prod, fermer }), donc l'outil tourne tel quel, sans une ligne recopiée ;
//   3. tout argument qui écrit (--ecrire, --retirer, --arreter-et-effacer, --completer…) est REFUSÉ : « à blanc » ne se négocie pas ;
//   4. même sans ce refus, une écriture serait rejetée par Atlas (l'utilisateur de lecture n'a pas le droit d'écrire).
// Aucune URI, aucune clé n'est imprimée.
const path = require('path');
const { spawnSync } = require('child_process');
require('dotenv').config({ path: 'C:/Users/Yung/Desktop/pokemon-proxy/.env', quiet: true });   // seul ce .env est LU
const GARDEES = new Set(['MONGODB_LECTURE_URI', 'MONGODB_CARTES_LECTURE_URI', 'R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_BRUT']);
const env = { ...process.env };
for (const k of Object.keys(env)) if (/^(MONGODB|R2_|V2_|STRIPE|RENDER|RUNPOD|OPENROUTER|JETON|REVALIDATION|CODE_|LIMITE)/.test(k) && !GARDEES.has(k)) delete env[k];
const manque = [...GARDEES].filter(k => !env[k]);
if (manque.length) { console.error(`❌ variable(s) absente(s) : ${manque.join(', ')}`); process.exit(2); }
env.MONGODB_CARTES_BASE = 'cartes';
const [, , outil, ...args] = process.argv;
if (!outil) { console.error('usage : node lancer-a-blanc.js <outil.js> [arguments]'); process.exit(2); }
const INTERDITS = /^--(ecrire|retirer|arreter-et-effacer|completer|confirmer-production|lecture-via-ecriture|liberer-verrou|enfiler|ecrire-.*)$/;
const ecritures = args.filter(a => INTERDITS.test(a.split('=')[0]));
if (ecritures.length) { console.error(`❌ REFUS : argument d'écriture ${ecritures.join(' ')} — ce lanceur ne tourne qu'à blanc`); process.exit(2); }
const r = spawnSync(process.execPath, ['-r', path.resolve(__dirname, 'a-blanc-precharge.js'), path.resolve(__dirname, outil), ...args], { env, stdio: 'inherit', cwd: __dirname });
process.exit(r.status ?? 1);
