'use strict';
// CACHE-ZONES — les MUTANTS : un réglage ignoré, une borne mal lue, une éviction faussée, un branchement retiré doivent faire ÉCHOUER v2/test/test-cache-zones.js.
//   node v2/mesures/muter-cache-zones.js
// Chaque mutant est une COPIE (fichier .tmp à côté de l'original, supprimée ensuite) que le test juge à la place de l'original par CACHE_ZONES_MODULE / CACHE_ZONES_REGLAGE / CACHE_ZONES_INDEX :
// le source du dépôt n'est jamais touché. Hors suite (lancer-tout ne l'exécute pas : pas de test-*).
const fs = require('fs'), path = require('path'), { spawnSync } = require('child_process');
const racine = path.join(__dirname, '..', '..');
const CIBLES = {
    zones: { fichier: path.join(racine, 'ratmarket', 'zones.js'), env: 'CACHE_ZONES_MODULE', tmp: path.join(racine, 'ratmarket', 'zones-MUTANT.tmp.js'), rel: '../../ratmarket/zones-MUTANT.tmp.js' },
    reglage: { fichier: path.join(racine, 'v2', 'reglage-sharp.js'), env: 'CACHE_ZONES_REGLAGE', tmp: path.join(racine, 'v2', 'reglage-sharp-MUTANT.tmp.js'), rel: '../reglage-sharp-MUTANT.tmp.js' },
    index: { fichier: path.join(racine, 'v2', 'index.js'), env: 'CACHE_ZONES_INDEX', tmp: path.join(racine, 'v2', 'index-MUTANT.tmp.js'), rel: path.join(racine, 'v2', 'index-MUTANT.tmp.js') }
};
const MUTANTS = [
    ['zones', 'RM_CACHE_SCANS et RM_CACHE_PAIRES ignorés (la variable n\'est jamais lue)', 'if (brut == null) return defaut;', 'return defaut;'],
    ['zones', 'CACHE_PAIRES lit RM_CACHE_SCANS', 'tailleCache(\'RM_CACHE_PAIRES\', 32)', 'tailleCache(\'RM_CACHE_SCANS\', 32)'],
    ['zones', 'CACHE_SCANS lit RM_CACHE_PAIRES', 'tailleCache(\'RM_CACHE_SCANS\', 32, 2)', 'tailleCache(\'RM_CACHE_PAIRES\', 32, 2)'],
    ['zones', 'défaut des scans 32 → 16', 'tailleCache(\'RM_CACHE_SCANS\', 32, 2)', 'tailleCache(\'RM_CACHE_SCANS\', 16, 2)'],
    ['zones', 'défaut des paires 32 → 16', 'tailleCache(\'RM_CACHE_PAIRES\', 32)', 'tailleCache(\'RM_CACHE_PAIRES\', 16)'],
    ['zones', 'borne basse : 0 admis (n < min → n < min - 1)', 'n < min) throw', 'n < min - 1) throw'],
    ['zones', 'borne basse : la valeur minimale est refusée (n < min → n <= min)', 'n < min) throw', 'n <= min) throw'],
    ['zones', 'borne basse des scans 2 → 1 (le défaut de min)', 'tailleCache(\'RM_CACHE_SCANS\', 32, 2)', 'tailleCache(\'RM_CACHE_SCANS\', 32, 1)'],
    ['zones', 'borne basse des scans 2 → 3', 'tailleCache(\'RM_CACHE_SCANS\', 32, 2)', 'tailleCache(\'RM_CACHE_SCANS\', 32, 3)'],
    ['zones', 'borne basse des paires imposée aussi aux scans et inversement (min = 1 par défaut → 2)', 'function tailleCache(nom, defaut, min = 1)', 'function tailleCache(nom, defaut, min = 2)'],
    // (les mutants « le motif accepte le point / zéro chiffre » et « Number(brut) sans trim » sont ÉQUIVALENTS : isSafeInteger, n < 1 et Number() couvrent déjà ces cas — deux gardes pour une valeur, par construction)
    ['zones', 'les espaces autour ne sont plus tolérés (le motif ne reçoit plus la valeur rognée)', '/^[0-9]+$/.test(brut.trim())', '/^[0-9]+$/.test(brut)'],
    ['zones', 'l\'illisible passe (NaN n\'est plus refusé)', '!Number.isSafeInteger(n) || n < min', 'n < min'],
    ['zones', 'l\'entier géant passe (isSafeInteger retiré)', '!Number.isSafeInteger(n) || n < min', '!(n >= min)'],
    ['zones', 'cache des scans : une entrée de trop (> CACHE_SCANS → > CACHE_SCANS + 1)', 'while (_scans.size > CACHE_SCANS)', 'while (_scans.size > CACHE_SCANS + 1)'],
    ['zones', 'cache des paires : une entrée de trop (> CACHE_PAIRES → > CACHE_PAIRES + 1)', 'while (_paires.size > CACHE_PAIRES)', 'while (_paires.size > CACHE_PAIRES + 1)'],
    ['zones', 'le scan servi n\'est plus rafraîchi (FIFO au lieu du moins récemment servi)', 'return servir(_scans, source.cle);', 'return _scans.get(source.cle);'],
    ['reglage', 'V2_SHARP_CACHE=false ignoré', 'if (v === \'false\') return false;', 'if (v === \'false\') return null;'],
    ['reglage', 'V2_SHARP_CACHE=true ignoré', 'if (v === \'true\') return true;', 'if (v === \'true\') return null;'],
    ['reglage', 'memoire:<Mo> décalé d\'un Mo', 'Number(m[1])', 'Number(m[1]) + 1'],
    ['reglage', 'V2_SHARP_CACHE vide accepté', 'if (brut == null) return null;', 'if (!brut) return null;'],
    ['reglage', 'sharp.cache appelé même sans réglage', 'if (r === null) return null;', ''],
    ['reglage', 'valeur inconnue acceptée (ne lève plus)', 'throw new Error(`V2_SHARP_CACHE', 'return null; throw new Error(`V2_SHARP_CACHE'],
    ['index', 'le réglage de sharp n\'est plus branché au démarrage de l\'API v2', 'require(\'./reglage-sharp\').appliquer(require(\'sharp\'), process.env);', '']
];
let survivants = 0;
try {
    for (const [cle, nom, de, vers] of MUTANTS) {
        const C = CIBLES[cle], source = fs.readFileSync(C.fichier, 'utf8');
        const n = source.split(de).length - 1;
        if (n !== 1) { console.log(`🔴 mutant non applicable (${n} occurrences de « ${de} ») : ${nom}`); survivants++; continue; }
        fs.writeFileSync(C.tmp, source.replace(de, () => vers));
        const r = spawnSync(process.execPath, [path.join(racine, 'v2', 'test', 'test-cache-zones.js')], { env: { ...process.env, [C.env]: C.rel }, encoding: 'utf8', timeout: 600000 });
        const tue = r.status !== 0 && /❌/.test(r.stdout || '');          // tué PAR une assertion, pas par un plantage sans rapport
        const par = ((r.stdout || '').match(/❌ ([0-9a-z]+\.?)/) || [])[1] || '?';
        console.log(`${tue ? '✅ tué' : '🔴 SURVIT'} (${par}) : ${nom}`);
        if (!tue) survivants++;
        fs.unlinkSync(C.tmp);
    }
} finally { for (const C of Object.values(CIBLES)) { try { fs.unlinkSync(C.tmp); } catch { /* absent */ } } }
console.log(`${MUTANTS.length - survivants}/${MUTANTS.length} mutants tués`);
process.exit(survivants ? 1 : 0);
