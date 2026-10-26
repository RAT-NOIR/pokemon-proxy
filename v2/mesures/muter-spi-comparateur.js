'use strict';
// SPI-CONTRADICTIONS — les MUTANTS : chaque règle du comparateur (identifier/comparateur-image.js) et chaque branchement (drapeau, règle SUR-PAR-IMAGE, route, configuration) retiré ou affaibli doit faire ÉCHOUER le banc test-comparateur-image.js.
//   node v2/mesures/muter-spi-comparateur.js
// Un mutant = le fichier de production modifié sur place, le temps d'UN banc, puis RESTAURÉ à l'octet (contrôle de l'empreinte avant et après, y compris si le banc plante). Hors suite (lancer-tout ne l'exécute pas : pas de test-*).
// Un mutant qui survit = une ligne du comparateur que rien ne garde.
const fs = require('fs'), path = require('path'), crypto = require('crypto'), { spawnSync } = require('child_process');
const racine = path.join(__dirname, '..', '..');
const CI = 'v2/identifier/comparateur-image.js', SPI = 'v2/identifier/sur-par-image.js', R = 'v2/identifier/sur-par-image-route.js', C = 'v2/config.js';
const T = 'v2/test/test-comparateur-image.js';
const MUTANTS = [
    // attaque-traduite
    [CI, T, 'attaque : une langue lue absente compte comme non anglaise', "return l !== null && l.toUpperCase() !== 'EN';", "return l === null || l.toUpperCase() !== 'EN';"],
    [CI, T, 'attaque : l\'anglais compte comme une traduction', " && l.toUpperCase() !== 'EN';", ';'],
    [CI, T, 'attaque : le numéro n\'est plus exigé concordant', "langueNonAnglaise(lu) && numeroOk && (totalOk || o.code === 'ok')", "langueNonAnglaise(lu) && (totalOk || o.code === 'ok')"],
    [CI, T, 'attaque : ni total ni code ne sont plus exigés', "langueNonAnglaise(lu) && numeroOk && (totalOk || o.code === 'ok')", 'langueNonAnglaise(lu) && numeroOk'],
    [CI, T, 'attaque : le code concordant ne suffit plus (total seul)', "(totalOk || o.code === 'ok')", 'totalOk'],
    [CI, T, 'attaque : le total concordant ne suffit plus (code seul)', "(totalOk || o.code === 'ok')", "o.code === 'ok'"],
    [CI, T, 'attaque : la garde du jumeau est retirée', " && !(Array.isArray(autres) ? autres : []).some(a => estJumeau(ligne, a))", ''],
    [CI, T, 'jumeau : le numéro n\'est plus comparé', " && texte(a.numero) && a.numero === ligne.numero", ''],
    [CI, T, 'jumeau : le tirage n\'est plus comparé', " && texte(a.tirageSource) && a.tirageSource === ligne.tirageSource", ''],
    [CI, T, 'jumeau : le nom n\'est plus comparé', "texte(a.nomCardmarket) && a.nomCardmarket === ligne.nomCardmarket && ", ''],
    [CI, T, 'attaque : la règle est retirée', "&& !(Array.isArray(autres) ? autres : []).some(a => estJumeau(ligne, a))) o.attaque = '?';", "&& false) o.attaque = '?';"],
    // promo-prefixe
    [CI, T, 'promo : la règle est retirée', "if (o.code === 'ko' && codeParPrefixeDePromo(lu, ligne)) o.code = '?';", ''],
    [CI, T, 'promo : les chiffres ne sont plus comparés', " || S.comparerNumeros(n, ln) !== 'chiffres') return false;", ') return false;'],
    [CI, T, 'promo : un numéro du catalogue à lettre est admis', "if (!ln || /[A-Za-z]/.test(ln) ||", 'if (!ln ||'],
    [CI, T, 'promo : la famille du code n\'est plus exigée', "!(codeCatalogue === prefixe || codeCatalogue.startsWith(prefixe))", 'false'],
    [CI, T, 'promo : le code XYPR ne dérive plus de XY', 'codeCatalogue.startsWith(prefixe)', 'false'],
    [CI, T, 'promo : tout code lu est admis', "return S.normaliserCodeSet(lu.setCode) === prefixe || String(lu.symboleSet || '').trim().toLowerCase() === 'promo-etoile';", 'return true;'],
    [CI, T, 'promo : le code lu égal au préfixe ne suffit plus', 'return S.normaliserCodeSet(lu.setCode) === prefixe || String', 'return String'],
    [CI, T, 'promo : l\'étoile de promo ne suffit plus', "|| String(lu.symboleSet || '').trim().toLowerCase() === 'promo-etoile';", ';'],
    // symbole-isole
    [CI, T, 'symbole : la règle est retirée', "if (o.symbole === 'ko' && numeroOk && totalOk) o.symbole = '?';", ''],
    [CI, T, 'symbole : le total n\'est plus exigé', "o.symbole === 'ko' && numeroOk && totalOk", "o.symbole === 'ko' && numeroOk"],
    [CI, T, 'symbole : le numéro n\'est plus exigé', "o.symbole === 'ko' && numeroOk && totalOk", "o.symbole === 'ko' && totalOk"],
    // filet
    [CI, T, 'filet : une correction qui lève fait lever', 'try { return ajuster(base, lu, ligne, autres); } catch { return base; }', 'return ajuster(base, lu, ligne, autres);'],
    // branchements
    [SPI, T, 'règle : le comparateur est toujours utilisé', 'e.comparateur === true ? statutsPourImage', 'true ? statutsPourImage'],
    [SPI, T, 'règle : tout comparateur « vrai » l\'allume (chaîne, 1)', 'e.comparateur === true ? statutsPourImage', 'e.comparateur ? statutsPourImage'],
    [SPI, T, 'règle : le désigné est compté parmi ses propres jumeaux', 'ids.filter(i => i !== meilleur.id).map(i => e.produits.get(i))', 'ids.map(i => e.produits.get(i))'],
    [R, T, 'route : le comparateur est toujours allumé', 'comparateur: cfg.spiComparateur === true', 'comparateur: true'],
    [R, T, 'route : le comparateur n\'est jamais passé', 'comparateur: cfg.spiComparateur === true', 'comparateur: false'],
    [C, T, 'configuration : allumé par défaut', "booleen('V2_SPI_COMPARATEUR', env.V2_SPI_COMPARATEUR, false)", "booleen('V2_SPI_COMPARATEUR', env.V2_SPI_COMPARATEUR, true)"]
];
const sha = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
let survivants = 0;
const avant = {};
for (const f of new Set(MUTANTS.map(m => m[0]))) avant[f] = { chemin: path.join(racine, f), octets: fs.readFileSync(path.join(racine, f)), sha: sha(path.join(racine, f)) };
try {
    for (const [fichier, banc, nom, de, vers] of MUTANTS) {
        const a = avant[fichier], src = a.octets.toString('utf8'), n = src.split(de).length - 1;
        if (n !== 1) { console.log(`🔴 mutant non applicable (${n} occurrences de « ${de} ») : ${nom}`); survivants++; continue; }
        try {
            fs.writeFileSync(a.chemin, src.replace(de, () => vers));
            const r = spawnSync(process.execPath, [path.join(racine, banc)], { cwd: racine, encoding: 'utf8', timeout: 240000, env: { ...process.env } });
            const tue = r.status !== 0 && /❌/.test(r.stdout || '');                 // tué par une assertion, pas par un plantage sans rapport
            console.log(`${tue ? '✅ tué' : '🔴 SURVIT'} (${path.basename(banc)}) : ${nom}`);
            if (!tue) survivants++;
        } finally { fs.writeFileSync(a.chemin, a.octets); }
    }
} finally {
    for (const [f, a] of Object.entries(avant)) { fs.writeFileSync(a.chemin, a.octets); if (sha(a.chemin) !== a.sha) { console.log(`🔴 ${f} N'EST PAS RESTAURÉ`); survivants++; } }
}
console.log(`${MUTANTS.length - survivants}/${MUTANTS.length} mutants tués`);
process.exit(survivants ? 1 : 0);
