// node rouge-userscript-pikaqian.js — le ROUGE du userscript passif de PikaQian (cadence, arrêt, annonce, redirections) : un script où UNE règle est retirée est écrit hors du dépôt,
// et test-userscript-pikaqian.js (PK_USERSCRIPT) doit ÉCHOUER dessus.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SRC = fs.readFileSync(path.join(__dirname, 'userscript-pikaqian.js'), 'utf8');
const MUTANTS = [
    { nom: 'plus de pause entre deux requêtes', de: 'var attente = lecture.emises > 0 ? pause(PAUSE_MS) : Promise.resolve();', vers: 'var attente = Promise.resolve();' },
    { nom: 'pause de 100 ms au lieu de 500', de: 'var PAUSE_MS = 500;', vers: 'var PAUSE_MS = 100;' },
    { nom: 'plus d\'arrêt sur le navigateur (403/429/5xx)', de: "if (estArret(n.statut)) throw", vers: "if (false) throw" },
    { nom: 'plus d\'arrêt sur le cache (403/429/5xx)', de: "if (estArret(c.statut)) throw", vers: "if (false) throw" },
    { nom: 'le 429 n\'arrête plus', de: 'statut === 403 || statut === 429 || statut >= 500', vers: 'statut === 403 || statut >= 500' },
    { nom: 'les 5xx n\'arrêtent plus', de: 'statut === 403 || statut === 429 || statut >= 500', vers: 'statut === 403 || statut === 429' },
    { nom: 'la voie cache n\'est jamais abandonnée', de: '++lecture.cacheEchecs >= 2', vers: '++lecture.cacheEchecs >= 9999' },
    { nom: 'redirections du navigateur suivies', de: "timeout: 30000, redirect: 'error',", vers: 'timeout: 30000,' },
    { nom: 'annonce muette avant le clic', de: 'etat.textContent = annonce();\n', vers: '\n' },
    { nom: 'annonce sans le maximum de requêtes', de: "', soit au plus ' + (2 * reste) + ' pour '", vers: "' pour '" },
    { nom: 'le panneau n\'affiche pas le compte réel', de: "' · tuiles sans image ' + sansImage + compteReel();", vers: "' · tuiles sans image ' + sansImage;" }
];
const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'rouge-us-'));
const lance = f => spawnSync(process.execPath, [path.join(__dirname, 'test-userscript-pikaqian.js')], { encoding: 'utf8', timeout: 120000, env: { ...process.env, PK_USERSCRIPT: f } });
let anormaux = 0;
const temoin = lance(path.join(__dirname, 'userscript-pikaqian.js'));
console.log(`témoin (script intact) : ${temoin.status === 0 ? '✅ passe' : '❌ ÉCHOUE — le rouge ne prouve rien'}`);
if (temoin.status !== 0) anormaux++;
MUTANTS.forEach((m, i) => {
    const n = SRC.split(m.de).length - 1;
    const f = path.join(dossier, `mutant-${i}.js`);
    fs.writeFileSync(f, SRC.split(m.de).join(m.vers));
    const r = lance(f), echoue = r.status !== 0, bon = n >= 1 && echoue;
    if (!bon) anormaux++;
    console.log(`${bon ? '✅' : '❌'} ${m.nom} : le banc ${echoue ? 'ÉCHOUE (rouge vu)' : 'PASSE'}${n < 1 ? ' — ⚠️ motif introuvable' : ''}${(r.stdout.match(/❌ [^\n]*/) || [''])[0] ? ' — ' + (r.stdout.match(/❌ [^\n]*/) || [''])[0].slice(0, 90) : ''}`);
});
fs.rmSync(dossier, { recursive: true, force: true });
console.log(`\n${MUTANTS.length} mutants, ${anormaux} anormal(aux)`);
process.exit(anormaux ? 1 : 0);
