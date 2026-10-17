// node test-mutants-garde-atlas.js — UN MUTANT PAR CAS de test-garde-taille-atlas.js : chaque mutation du module DOIT faire échouer le banc.
// Les mutants s'écrivent dans le dossier temporaire (jamais dans le dépôt) ; un mutant qui survit = un cas que le banc ne garde pas.
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const { spawnSync } = require('child_process');
const SRC = path.join(__dirname, 'collecte-cartes', 'garde-taille-atlas.js');
const src = fs.readFileSync(SRC, 'utf8');
const MUTANTS = [
    ['refus à 91 au lieu de 90 (90 % passerait)', 'REFUS = 90', 'REFUS = 91'],
    ['refus strict > au lieu de >= (90,0 % passerait)', 'if (projete >= REFUS)', 'if (projete > REFUS)'],
    ['estimation ignorée', '(mesure.mo + estimationMo) / LIMITE_MO', '(mesure.mo + 0) / LIMITE_MO'],
    ['estimation négative acceptée', "if (!estNombre(estimationMo)) return", "if (false) return"],
    ['mesure impossible laisse passer', "if (!mesure || !estNombre(mesure.mo)) return { autorise: false,", "if (!mesure || !estNombre(mesure.mo)) return { autorise: true,"],
    ['verifierEcriture avale l\'erreur et autorise', "const j = juger({ mesure, estimationMo });", "const j = erreur ? { autorise: true, niveau: 'ok', raison: '' } : juger({ mesure, estimationMo });"],
    ['aucune base lue = zéro qui rassure', "if (!noms.length) throw", "if (false) throw"],
    ['I2 : le stockage décide à nouveau (maximum)', 'const mo = donnees / MO', 'const mo = Math.max(donnees, stockage) / MO'],
    ['dégagement sans annonce accepté', "return baisse ? null :", "return true ? null :"],
    ['dégagement : annonce nulle acceptée', "typeof v === 'number' && v > 0", "typeof v === 'number'"],
    ['dégagement permis jusqu\'à 101 %', 'MARGE_DEGAGEMENT = 98', 'MARGE_DEGAGEMENT = 101'],
    ['dégagement : seuls les refus sont levés (un « inconnu » le reste)', "v?.niveau === 'refus' &&", "v?.niveau !== 'ok' &&"],
    ['dégagement qui monte déclaré tenu', 'return estNombre(avantMo) && estNombre(apresMo) && apresMo <= avantMo + TOLERANCE_MO;', 'return true;'],
    ['M1 : scan sans la valeur', "/import-cardmarket/.test(String(texte)) ||", "false ||"],
    ['M1 : scan sans la constante', "/\\bESSENTIEL\\b/.test(String(texte))", "false"],
    ['M1 : scan sans .mjs/.cjs', '/\\.(js|mjs|cjs)$/', '/\\.js$/'],
    ['M1 : scan sans sous-dossiers', 'parcourir(p); continue;', 'continue;'],
    ['M4 : pas de cache', 'if (prise && maintenant() - prise.le < CACHE_MS)', 'if (false)'],
    ['M4 : cache éternel', 'maintenant() - prise.le < CACHE_MS', 'true'],
    ['M4 : cache partagé entre grappes', 'cache.get(grappe)', 'cache.get(\'unique\')'],
    ['M4 : un échec mis en cache', 'mesure = await mesurerGrappe(client, { noms }); if (grappe && !sansCache) cache.set(grappe, { le: maintenant(), mesure });', 'cache.set(grappe, { le: maintenant(), mesure: null }); mesure = await mesurerGrappe(client, { noms });'],
    ['M4 : sansCache ignoré', 'grappe && !sansCache ? cache.get(grappe) : null', 'grappe ? cache.get(grappe) : null'],
    ['M4 : la liste déjà lue est ignorée', 'Array.isArray(dejaLus) && dejaLus.length ?', 'false ?'],
    ['admin/local/config comptés', "['admin', 'local', 'config']", "[]"],
    ['import essentiel ignoré (bloqué à 95 %)', "if (essentielValide(essentiel, fichier)) return { autorise: true,", "if (false) return { autorise: true,"],
    ['import : mesure tentée avant le laissez-passer', "if (essentielValide(essentiel, fichier)) return { ...juger({ essentiel, fichier }), mesure: null };", ""],
    ['n\'importe quel fichier peut se dire essentiel', 'return FICHIERS_ESSENTIELS.includes(rel.split(path.sep).join(\'/\'));', 'return true;'],
    ['n\'importe quel drapeau est essentiel', "essentiel === ESSENTIEL &&", "!!essentiel &&"],
    ['liste fermée élargie (4 fichiers)', "'imports-quotidiens-local.js']", "'imports-quotidiens-local.js', 'lot-additif.js']"],
    ['ligne « Atlas après » absente', "`Atlas après : ${", "`Atlas : ${"],
];
let survivants = 0;
const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'mutants-atlas-'));
for (const [nom, de, vers] of MUTANTS) {
    if (!src.includes(de)) { console.log(`❓ ${nom} : motif introuvable dans le module (le mutant ne mord sur rien)`); survivants++; continue; }
    const fichier = path.join(dossier, 'garde-taille-atlas.js');
    fs.writeFileSync(fichier, src.replace(de, vers).replace("require('path')", `require(${JSON.stringify('path')})`).replace("path.join(__dirname, '..')", `path.join(${JSON.stringify(path.join(__dirname))})`), 'utf8');
    const r = spawnSync(process.execPath, ['test-garde-taille-atlas.js'], { cwd: __dirname, env: { ...process.env, GARDE_ATLAS_MODULE: fichier }, encoding: 'utf8' });
    if (r.status === 0) { survivants++; console.log(`🔴 SURVIT : ${nom}`); } else console.log(`✅ tué : ${nom}`);
}
fs.rmSync(dossier, { recursive: true, force: true });
console.log(`\n${MUTANTS.length - survivants}/${MUTANTS.length} mutants tués`);
process.exit(survivants ? 1 : 0);
