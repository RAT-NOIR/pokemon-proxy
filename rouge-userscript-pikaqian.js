// node rouge-userscript-pikaqian.js — le ROUGE du userscript passif de PikaQian (cadence, arrêt, annonce, redirections) : un script où UNE règle est retirée est écrit hors du dépôt,
// et test-userscript-pikaqian.js (PK_USERSCRIPT) doit ÉCHOUER dessus.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SRC = fs.readFileSync(path.join(__dirname, 'userscript-pikaqian.js'), 'utf8').replace(/\r\n/g, '\n');   // un checkout en CRLF (core.autocrlf) ne doit pas faire manquer les motifs à retour de ligne
const MUTANTS = [
    { nom: 'plus de pause entre deux requêtes', de: 'var attente = lecture.emises > 0 ? pause(PAUSE_MS) : Promise.resolve();', vers: 'var attente = Promise.resolve();' },
    { nom: 'pause de 100 ms au lieu de 500', de: 'var PAUSE_MS = 500;', vers: 'var PAUSE_MS = 100;' },
    { nom: 'plus d\'arrêt sur 403/429/5xx (les deux voies passent par arretDe)', de: "if (estArret(res.statut)) return", vers: "if (false) return" },
    { nom: 'plus d\'arrêt sur le navigateur (arretDe(n) ignoré)', de: "if (an) throw { arret: an };", vers: "" },
    { nom: 'plus d\'arrêt sur le cache (arretDe(c) ignoré)', de: "if (ac) throw { arret: ac };", vers: "" },
    { nom: 'URL finale du fetch non vérifiée', de: 'if (!urlFinaleOk(r.url, src)) return', vers: 'if (false) return' },
    { nom: 'URL finale de GM non vérifiée', de: 'if (!urlFinaleOk(r.finalUrl, src)) resoudre', vers: 'if (false) resoudre' },
    { nom: 'URL finale : n\'importe quel hôte', de: "u.hostname === HOTE_IMAGES && u.pathname === s.pathname", vers: "u.pathname === s.pathname" },
    { nom: 'URL finale : n\'importe quel chemin', de: "u.hostname === HOTE_IMAGES && u.pathname === s.pathname", vers: "u.hostname === HOTE_IMAGES" },
    { nom: 'trois 404 de suite n\'arrêtent plus', de: 'var SUITE_404_MAX = 3;', vers: 'var SUITE_404_MAX = 9999;' },
    { nom: 'une 404 arrête dès la première', de: 'var SUITE_404_MAX = 3;', vers: 'var SUITE_404_MAX = 1;' },
    { nom: 'une image lue ne remet pas la suite de 404 à zéro', de: 'if (res.b64) lecture.suite404 = 0;', vers: '' },
    { nom: 'le maximum n\'est plus recalculé au clic', de: 'var annonceDuClic = annonce(tuiles);', vers: 'var annonceDuClic = "";' },
    { nom: 'le 429 n\'arrête plus', de: 'statut === 403 || statut === 429 || statut >= 500', vers: 'statut === 403 || statut >= 500' },
    { nom: 'les 5xx n\'arrêtent plus', de: 'statut === 403 || statut === 429 || statut >= 500', vers: 'statut === 403 || statut === 429' },
    { nom: 'la voie cache n\'est jamais abandonnée', de: '++lecture.cacheEchecs >= 2', vers: '++lecture.cacheEchecs >= 9999' },
    { nom: 'redirections du navigateur suivies', de: "timeout: 30000, redirect: 'error',", vers: 'timeout: 30000,' },
    { nom: 'annonce muette avant le clic', de: 'etat.textContent = annonce();\n', vers: '\n' },
    { nom: 'annonce sans le maximum de requêtes', de: "', soit au plus ' + (2 * reste) + ' pour '", vers: "' pour '" },
    { nom: 'le refus n\'affiche plus le diagnostic de la page', de: "|| 'réponse illisible du récepteur') + lignesDeDiagnostic(j);", vers: "|| 'réponse illisible du récepteur');" },
    { nom: 'le diagnostic affiche autre chose que des chaînes', de: ".filter(function (x) { return typeof x === 'string'; })", vers: '' },
    { nom: 'le diagnostic n\'est plus borné à 8 lignes', de: '.slice(0, 8);', vers: ';' },
    { nom: 'une ligne de diagnostic n\'est plus tronquée à 300 caractères', de: 'gardees[i].slice(0, 300)', vers: 'gardees[i]' },
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
