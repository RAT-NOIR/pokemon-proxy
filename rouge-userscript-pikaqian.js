// node rouge-userscript-pikaqian.js — le ROUGE du userscript passif de PikaQian v2.3 (concurrence, cadence, arrêt partagé, redirections, innerHTML, diagnostic) : un script où UNE règle est
// retirée est écrit hors du dépôt (dossier temporaire du système), et test-userscript-pikaqian.js (PK_USERSCRIPT) doit ÉCHOUER dessus.
// `equivalent: true` : un mutant dont la règle retirée est DOUBLÉE par une autre garde du script (défense en profondeur) — aucun comportement observable ne change ; il n'est pas compté
// parmi les mutants à tuer, il est imprimé avec sa raison, et sa version COMBINÉE (les deux gardes retirées ensemble) est, elle, tuée.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SRC = fs.readFileSync(path.join(__dirname, 'userscript-pikaqian.js'), 'utf8').replace(/\r\n/g, '\n');   // un checkout en CRLF (core.autocrlf) ne doit pas faire manquer les motifs à retour de ligne
const GARDE_AVANT_REQUETE = 'if (lecture.arret) return Promise.reject({ arret: lecture.arret });';
const GARDE_LIRE_IMAGE = 'if (lecture.arret) throw { arret: lecture.arret };\n            return depuisLeNavigateur';
const MUTANTS = [
    // ── la cadence et la concurrence (US23)
    { nom: 'CONCURRENCE 16 au lieu de 8', de: 'var CONCURRENCE = 8;', vers: 'var CONCURRENCE = 16;' },
    { nom: 'CONCURRENCE 1 (lecture séquentielle)', de: 'var CONCURRENCE = 8;', vers: 'var CONCURRENCE = 1;' },
    { nom: 'PAUSE_MS 0', de: 'var PAUSE_MS = 150;', vers: 'var PAUSE_MS = 0;' },
    { nom: 'PAUSE_MS 500', de: 'var PAUSE_MS = 150;', vers: 'var PAUSE_MS = 500;' },
    { nom: 'plus de pause entre les paquets', de: 'if (lecture.emises > emisesAvant && i + CONCURRENCE < pretes.length) await pause(PAUSE_MS);', vers: '' },
    { nom: 'une pause même quand le paquet n\'a rien émis (canvas)', de: 'if (lecture.emises > emisesAvant && i + CONCURRENCE < pretes.length)', vers: 'if (i + CONCURRENCE < pretes.length)' },
    { nom: 'une pause après le dernier paquet', de: 'if (lecture.emises > emisesAvant && i + CONCURRENCE < pretes.length)', vers: 'if (lecture.emises > emisesAvant)' },
    // ── l'arrêt partagé lecture.arret (US23)
    { nom: 'avantRequete ne refuse plus après l\'arrêt', de: GARDE_AVANT_REQUETE, vers: '', equivalent: 'lireImage porte la même garde juste avant la voie navigateur ; la voie cache ne s\'ouvre qu\'au début d\'un paquet, et la boucle s\'arrête avant le paquet suivant' },
    { nom: 'lireImage sans le « if (lecture.arret) throw » avant la voie navigateur', de: GARDE_LIRE_IMAGE, vers: 'return depuisLeNavigateur', equivalent: 'avantRequete refuse la même requête avec le même objet { arret }' },
    { nom: 'COMBINÉ : ni avantRequete ni lireImage ne refusent plus après l\'arrêt', de: GARDE_AVANT_REQUETE, vers: '', et: { de: GARDE_LIRE_IMAGE, vers: 'return depuisLeNavigateur' } },
    { nom: 'arretDe ne pose plus lecture.arret', de: 'if (a && !lecture.arret) lecture.arret = a;', vers: '' },
    { nom: 'le catch n\'envoie plus le lot avant d\'afficher l\'arrêt', de: 'try { await envoyerLot(); } catch (e2) { /* récepteur muet */ }', vers: '' },
    { nom: 'la boucle ne s\'arrête plus sur lecture.arret après un paquet', de: 'if (lecture.arret) throw { arret: lecture.arret };\n                if (erreur) throw erreur;', vers: 'if (erreur) throw erreur;', equivalent: 'la tuile qui pose lecture.arret lève aussi { arret } : « if (erreur) throw erreur » rend le même arrêt' },
    // ── les arrêts eux-mêmes
    { nom: 'plus d\'arrêt sur 403/429/5xx', de: 'if (estArret(res.statut)) a =', vers: 'if (false) a =' },
    { nom: 'le 429 n\'arrête plus', de: 'statut === 403 || statut === 429 || statut >= 500', vers: 'statut === 403 || statut >= 500' },
    { nom: 'les 5xx n\'arrêtent plus', de: 'statut === 403 || statut === 429 || statut >= 500', vers: 'statut === 403 || statut === 429' },
    { nom: 'le 403 n\'arrête plus', de: 'statut === 403 || statut === 429 || statut >= 500', vers: 'statut === 429 || statut >= 500' },
    { nom: 'plus d\'arrêt sur le navigateur (arretDe(n) ignoré)', de: 'if (an) throw { arret: an };', vers: '' },
    { nom: 'plus d\'arrêt sur le cache (arretDe(c) ignoré)', de: 'if (ac) throw { arret: ac };', vers: '' },
    { nom: 'URL finale du fetch non vérifiée', de: 'if (!urlFinaleOk(r.url, src)) return', vers: 'if (false) return' },
    { nom: 'URL finale de GM non vérifiée', de: 'if (!urlFinaleOk(r.finalUrl, src)) resoudre', vers: 'if (false) resoudre' },
    { nom: 'URL finale : n\'importe quel hôte', de: 'u.hostname === HOTE_IMAGES && u.pathname === s.pathname', vers: 'u.pathname === s.pathname' },
    { nom: 'URL finale : n\'importe quel chemin', de: 'u.hostname === HOTE_IMAGES && u.pathname === s.pathname', vers: 'u.hostname === HOTE_IMAGES' },
    { nom: 'trois 404 de suite n\'arrêtent plus', de: 'var SUITE_404_MAX = 3;', vers: 'var SUITE_404_MAX = 9999;' },
    { nom: 'une 404 arrête dès la première', de: 'var SUITE_404_MAX = 3;', vers: 'var SUITE_404_MAX = 1;' },
    { nom: 'une image lue ne remet pas la suite de 404 à zéro', de: 'if (res.b64) lecture.suite404 = 0;', vers: '' },
    { nom: 'la voie cache n\'est jamais abandonnée', de: '++lecture.cacheEchecs >= 2', vers: '++lecture.cacheEchecs >= 9999' },
    { nom: 'redirections du navigateur suivies', de: 'timeout: 30000, redirect: \'error\',', vers: 'timeout: 30000,' },
    // ── le panneau
    { nom: 'un innerHTML avec une variable (CODE concaténé au squelette)', de: 'Apprendre cette page</div>\' +', vers: 'Apprendre cette page</div>\' + CODE +' },
    { nom: 'un second innerHTML (sous-titre)', de: 'var bar = panneau.querySelector(\'#rm-bar\');', vers: 'var bar = panneau.querySelector(\'#rm-bar\'); sous.innerHTML = \'x\';' },
    { nom: 'le message d\'un lot refusé n\'arrête plus la lecture', de: 'if (!(r.json && r.json.ok)) throw { refus:', vers: 'if (false) throw { refus:' },
    { nom: 'le sous-titre ne dit plus de faire défiler', de: '\' — fais défiler jusqu\\\'en bas\'', vers: '\'\'' },
    { nom: 'le sous-titre est muet au chargement', de: 'majSousTitre();\n    dire(', vers: 'dire(' },
    { nom: 'le survol ne rafraîchit plus le sous-titre', de: 'if (!bouton.disabled) majSousTitre();', vers: '' },
    // ── le diagnostic d'un refus de page
    { nom: 'le refus n\'affiche plus le diagnostic de la page', de: '+ lignesDeDiagnostic(j), \'#f56c6c\');', vers: ', \'#f56c6c\');' },
    { nom: 'le diagnostic affiche autre chose que des chaînes', de: '.filter(function (x) { return typeof x === \'string\'; })', vers: '' },
    { nom: 'le diagnostic n\'est plus borné à 8 lignes', de: '.slice(0, 8);', vers: ';' },
    { nom: 'une ligne de diagnostic n\'est plus tronquée à 300 caractères', de: 'gardees[i].slice(0, 300)', vers: 'gardees[i]' }
];
const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'rouge-us-'));
const lance = f => spawnSync(process.execPath, [path.join(__dirname, 'test-userscript-pikaqian.js')], { encoding: 'utf8', timeout: 120000, env: { ...process.env, PK_USERSCRIPT: f } });
let anormaux = 0, tues = 0, aTuer = 0, equivalentsVivants = 0, equivalentsTues = 0;
const temoin = lance(path.join(__dirname, 'userscript-pikaqian.js'));
console.log(`témoin (script intact) : ${temoin.status === 0 ? '✅ passe' : '❌ ÉCHOUE — le rouge ne prouve rien'}`);
if (temoin.status !== 0) anormaux++;
MUTANTS.forEach((m, i) => {
    const n = SRC.split(m.de).length - 1;
    let mut = SRC.split(m.de).join(m.vers), nEt = 1;
    if (m.et) { nEt = mut.split(m.et.de).length - 1; mut = mut.split(m.et.de).join(m.et.vers); }
    const f = path.join(dossier, `mutant-${i}.js`);
    fs.writeFileSync(f, mut);
    const r = lance(f), echoue = r.status !== 0;
    const motifOk = n >= 1 && nEt >= 1;
    const detail = (r.stdout.match(/❌ [^\n]*/) || [''])[0] ? ' — ' + (r.stdout.match(/❌ [^\n]*/) || [''])[0].slice(0, 90) : '';
    if (m.equivalent) {
        if (echoue) equivalentsTues++; else equivalentsVivants++;
        console.log(`➖ [équivalent] ${m.nom} : le banc ${echoue ? 'ÉCHOUE' : 'PASSE'} — ${m.equivalent}${motifOk ? '' : ' — ⚠️ motif introuvable'}`);
        if (!motifOk) anormaux++;
        return;
    }
    aTuer++;
    const bon = motifOk && echoue;
    if (bon) tues++; else anormaux++;
    console.log(`${bon ? '✅' : '❌'} ${m.nom} : le banc ${echoue ? 'ÉCHOUE (rouge vu)' : 'PASSE'}${motifOk ? '' : ' — ⚠️ motif introuvable'}${detail}`);
});
fs.rmSync(dossier, { recursive: true, force: true });
console.log(`\n${aTuer} mutants à tuer : ${tues} tués, ${aTuer - tues} survivants ; ${equivalentsVivants + equivalentsTues} mutants équivalents déclarés (${equivalentsVivants} survivent comme prévu, ${equivalentsTues} tués) ; ${anormaux} anormal(aux)`);
process.exit(anormaux ? 1 : 0);
