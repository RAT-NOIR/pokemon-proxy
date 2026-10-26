'use strict';
// SPI-CONTRADICTIONS — les MUTANTS : chaque règle du comparateur (identifier/comparateur-image.js) et chaque branchement (drapeau, règle SUR-PAR-IMAGE, route, configuration) retiré ou affaibli doit faire ÉCHOUER le banc test-comparateur-image.js.
//   node v2/mesures/muter-spi-comparateur.js
// Un mutant = le fichier de production modifié sur place, le temps d'UN banc, puis RESTAURÉ à l'octet (contrôle de l'empreinte avant et après, y compris si le banc plante). Hors suite (lancer-tout ne l'exécute pas : pas de test-*).
// Un mutant qui survit = une ligne du comparateur que rien ne garde.
const fs = require('fs'), path = require('path'), crypto = require('crypto'), { spawnSync } = require('child_process');
const racine = path.join(__dirname, '..', '..');
const CI = 'v2/identifier/comparateur-image.js', SPI = 'v2/identifier/sur-par-image.js', R = 'v2/identifier/sur-par-image-route.js', C = 'v2/config.js';
const T = 'v2/test/test-comparateur-image.js';
const COND = "if (st.attaque !== 'ko' || !langueNonAnglaise(lu) || st.numero !== 'ok' || st.code !== 'ok') return false;";
const MUTANTS = [
    // attaque-traduite : la langue (liste fermée de la production)
    [CI, T, 'langue : la liste fermée de la production n\'est plus exigée (toute chaîne ≠ EN)', " && langueCompatible(l, 'intl') !== null;", ';'],
    [CI, T, 'langue : une langue lue absente compte comme non anglaise', "return l !== null && l.toUpperCase()", "return l === null || l.toUpperCase()"],
    [CI, T, 'langue : l\'anglais compte comme une traduction', " && l.toUpperCase() !== 'EN' && langueCompatible", ' && langueCompatible'],
    // attaque-traduite : les conditions rigides
    [CI, T, 'attaque : la langue n\'est plus exigée', COND, COND.replace('!langueNonAnglaise(lu) || ', '')],
    [CI, T, 'attaque : le numéro n\'est plus exigé concordant', COND, COND.replace(" || st.numero !== 'ok'", '')],
    [CI, T, 'attaque : le code n\'est plus exigé concordant (numéro + total seuls)', COND, COND.replace(" || st.code !== 'ok'", '')],
    [CI, T, 'attaque : le ko de l\'attaque n\'est plus exigé', COND, COND.replace("st.attaque !== 'ko' || ", '')],
    // attaque-traduite : décidabilité du jumeau et rival
    [CI, T, 'jumeau : le désigné incomplet ou une liste absente sont admis', 'if (!complete(ligne) || !Array.isArray(autres)) return false;', ''],
    [CI, T, 'jumeau : le désigné incomplet est admis', 'if (!complete(ligne) ||', 'if ('],
    [CI, T, 'jumeau : un autre candidat sans ligne ou incomplet est ignoré', 'if (!complete(a)) return false;', ''],
    [CI, T, 'jumeau : la détection est retirée', 'if (estJumeau(ligne, a)) return false;', ''],
    [CI, T, 'rival : un autre candidat à l\'attaque concordante est ignoré', "if (statuts(lu, a).attaque === 'ok') return false;", ''],
    [CI, T, 'jumeau : les numéros se comparent à la lettre (« 077 » ≠ « 77 »)', 'S.comparerNumeros(a.numero, ligne.numero) !== null', 'a.numero === ligne.numero'],
    [CI, T, 'jumeau : le nom n\'est plus comparé', 'a.nomCardmarket === ligne.nomCardmarket && a.tirageSource', 'a.tirageSource'],
    [CI, T, 'jumeau : le tirage n\'est plus comparé', 'a.tirageSource === ligne.tirageSource && S.', 'S.'],
    [CI, T, 'jumeau : le numéro n\'est plus comparé', ' && S.comparerNumeros(a.numero, ligne.numero) !== null', ''],
    [CI, T, 'complète : le numéro de l\'autre candidat n\'est plus exigé', ' && texte(a.numero));', ');'],
    [CI, T, 'complète : le nom de l\'autre candidat n\'est plus exigé', 'texte(a.nomCardmarket) && texte(a.tirageSource)', 'texte(a.tirageSource)'],
    [CI, T, 'complète : le tirage de l\'autre candidat n\'est plus exigé', 'texte(a.tirageSource) && texte(a.numero)', 'texte(a.numero)'],
    [CI, T, 'attaque : la règle est retirée', 'if (attaqueLevable(o, lu, ligne, autres)) o.attaque = \'?\';', ''],
    // promo-prefixe
    [CI, T, 'promo : la règle est retirée', "if (o.code === 'ko' && codeParPrefixeDePromo(lu, ligne)) o.code = '?';", ''],
    [CI, T, 'promo : les chiffres ne sont plus comparés', " || S.comparerNumeros(n, ln) !== 'chiffres') return false;", ') return false;'],
    [CI, T, 'promo : un numéro du catalogue à lettre est admis', "if (!ln || /[A-Za-z]/.test(ln) ||", 'if (!ln ||'],
    [CI, T, 'promo : la famille redevient un simple préfixe (SM1, SMX passent)', '!FAMILLES_PROMO[prefixe].includes(codeCatalogue)', '!codeCatalogue.startsWith(prefixe)'],
    [CI, T, 'promo : la famille n\'est plus exigée', ' || !FAMILLES_PROMO[prefixe].includes(codeCatalogue)) return false;', ') return false;'],
    [CI, T, 'promo : le code XYPR n\'est plus celui de la famille XY', "XY: ['XYPR']", "XY: ['XYP']"],
    [CI, T, 'promo : tout code lu est admis', "return S.normaliserCodeSet(lu.setCode) === prefixe || String(lu.symboleSet || '').trim().toLowerCase() === 'promo-etoile';", 'return true;'],
    [CI, T, 'promo : le code lu égal au préfixe ne suffit plus', 'return S.normaliserCodeSet(lu.setCode) === prefixe || String', 'return String'],
    [CI, T, 'promo : l\'étoile de promo ne suffit plus', "|| String(lu.symboleSet || '').trim().toLowerCase() === 'promo-etoile';", ';'],
    // filet
    [CI, T, 'filet : une correction qui lève fait lever', 'try { return ajuster(base, lu, ligne, autres); } catch { return base; }', 'return ajuster(base, lu, ligne, autres);'],
    // branchements
    [SPI, T, 'règle : le comparateur est toujours utilisé', 'e.comparateur === true ? statutsPourImage', 'true ? statutsPourImage'],
    [SPI, T, 'règle : tout comparateur « vrai » l\'allume (chaîne, 1)', 'e.comparateur === true ? statutsPourImage', 'e.comparateur ? statutsPourImage'],
    [SPI, T, 'règle : le désigné est compté parmi ses propres jumeaux', 'ids.filter(i => i !== meilleur.id).map(i => e.produits.get(i))', 'ids.map(i => e.produits.get(i))'],
    [SPI, T, 'règle : une ligne absente est ignorée en silence (filter(Boolean))', 'ids.filter(i => i !== meilleur.id).map(i => e.produits.get(i)))', 'ids.filter(i => i !== meilleur.id).map(i => e.produits.get(i)).filter(Boolean))'],
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
