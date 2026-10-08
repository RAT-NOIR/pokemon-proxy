// node test-seuils-images.js — la règle de largeur minimale PAR SOURCE (décision 4 du testeur, 2026-10-08) :
// 300 px pour les sources OFFICIELLES (liste fermée), 350 px pour toute autre, y compris inconnue ou absente.
// Deuxième moitié : aucun collecteur ne garde sa copie du nombre (§21 bis) — chacun appelle largeurMinDe(sa source).
const fs = require('fs');
const path = require('path');
const S = require('./collecte-cartes/seuils-images');

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); }
};

verifier('largeurMinDe est exportée', typeof S.largeurMinDe, 'function');
if (typeof S.largeurMinDe === 'function') {
    const f = S.largeurMinDe;
    for (const s of ['tpc-asie', 'pokemon-card-com', 'pokemon-com']) verifier(`officielle ${s} → 300`, f(s), 300);
    for (const s of ['bulbapedia', 'artofpkm', 'tcgdex']) verifier(`${s} → 350`, f(s), 350);
    verifier('source inconnue → 350', f('quelque-part'), 350);
    verifier('undefined → 350', f(undefined), 350);
    verifier('null → 350', f(null), 350);
    verifier('chaîne vide → 350', f(''), 350);
    verifier('casse différente (« TPC-ASIE ») → 350 : liste fermée, comparaison exacte', f('TPC-ASIE'), 350);
    verifier('propriété héritée (« constructor », « __proto__ ») → 350', [f('constructor'), f('__proto__'), f('toString')], [350, 350, 350]);
}

// ── §21 bis : la liste officielle est DÉRIVÉE de la source unique des sites TPC, pas recopiée ───────────────────────────
const TPC = require('./collecte-cartes/tpc');
verifier('chaque site de SITES (tpc.js) est à 300 : une source TPC ajoutée ne peut pas rester à 350',
    TPC.SOURCES_TPC.map(s => S.largeurMinDe(s)), TPC.SOURCES_TPC.map(() => 300));
verifier('la liste officielle = SOURCES_TPC + pokemon-com, rien d\'autre', [...(S.SOURCES_OFFICIELLES || [])].sort(), [...TPC.SOURCES_TPC, 'pokemon-com'].sort());

// ── une décision de seuil se relit (§23) : aRejuger(document trop-petit, source) ───────────────────────────────────────
verifier('aRejuger est exportée', typeof S.aRejuger, 'function');
if (typeof S.aRejuger === 'function') {
    const r = S.aRejuger;
    verifier('tpc-asie, 320 px, sans seuilApplique (jugé à 350) → à rejuger', r({ wOriginal: 320 }, 'tpc-asie'), true);
    verifier('tpc-asie, 290 px, sans seuilApplique → reste trop petit', r({ wOriginal: 290 }, 'tpc-asie'), false);
    verifier('artofpkm, 320 px, sans seuilApplique → reste trop petit (350)', r({ w: 320 }, 'artofpkm'), false);
    verifier('tpc-asie, 320 px, jugé à 300 → rien à relire', r({ wOriginal: 320, seuilApplique: 300 }, 'tpc-asie'), false);
    verifier('tpc-asie, largeur inconnue, sans seuilApplique → à rejuger (on ne sait pas conclure)', r({}, 'tpc-asie'), true);
    verifier('source inconnue, 320 px → pas de rejugement', r({ wOriginal: 320 }, 'quelque-part'), false);
}

// ── les appelants : chacun passe par largeurMinDe avec SA source, aucun ne compare à LARGEUR_MIN ──────────────────────
const lire = f => fs.readFileSync(path.join(__dirname, f), 'utf8');
const sansCommentaires = t => t.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
const APPELANTS = {
    'collecteur-images.js': "largeurMinDe('artofpkm')",
    'collecteur-images-bulba.js': "largeurMinDe('bulbapedia')",
    'collecteur-images-tcgdex.js': 'largeurMinDe(SOURCE)',
    'collecteur-images-tpc.js': 'largeurMinDe(site)',
    'collecte-cartes/preparer-images-auto.js': "largeurMinDe('artofpkm')",
    'remettre-en-file.js': 'largeurMinDe(',
    'reste-visuels.js': 'largeurMinDe('
};
for (const [f, appel] of Object.entries(APPELANTS)) {
    const t = sansCommentaires(lire(f));
    verifier(`${f} appelle ${appel}`, t.includes(appel), true);
    verifier(`${f} ne compare plus à LARGEUR_MIN (aucune copie du nombre)`, /\bLARGEUR_MIN\b/.test(t), false);
}

// ── la médiane est indexée par `source/slug`, pas par slug seul (deux sources, un même slug) ──────────────────────────
for (const f of ['remettre-en-file.js', 'reste-visuels.js']) {
    const t = sansCommentaires(lire(f));
    verifier(`${f} indexe les médianes par source/slug`, /\.set\(`\$\{src\}\/\$\{slug\}`/.test(t) && !/medSource/.test(t), true);
}
verifier('collecteur-images-tcgdex.js : SOURCE est la constante de la source', /const SOURCE = 'tcgdex'/.test(lire('collecteur-images-tcgdex.js')), true);

// ── la garde du commit du worker : le collecteur TPC est un fichier du critère ──────────────────────────────────────
const regles = lire('remettre-en-file.js').match(/const REGLES = \[([\s\S]*?)\];/)?.[1] ?? '';
verifier('REGLES surveille seuils-images.js ET collecteur-images-tpc.js', ['seuils-images.js', 'collecteur-images-tpc.js'].map(x => regles.includes(`'${x}`) || regles.includes(`/${x}'`)), [true, true]);

// §44 — « si la règle changeait demain, quel fichier bougerait ? » : tout fichier que seuils-images.js charge (donc dont dépend
// largeurMinDe : la liste des sites TPC vient de tpc.js) doit figurer dans REGLES, sinon la garde du commit ne le voit pas.
const chargesParSeuils = [...lire('collecte-cartes/seuils-images.js').matchAll(/require\('\.\/([^']+)'\)/g)].map(m => `collecte-cartes/${m[1]}.js`);
verifier('seuils-images.js charge bien au moins tpc.js (le test ne tourne pas à vide)', chargesParSeuils.includes('collecte-cartes/tpc.js'), true);
for (const f of chargesParSeuils) verifier(`REGLES surveille ${f} (dépendance de largeurMinDe)`, regles.includes(`'${f}'`), true);

// ── la source d'une unité de file_images : le champ `source` quand il existe, sinon le préfixe de l'_id, sinon le défaut ──
verifier('sourceDeUnite est exportée', typeof S.sourceDeUnite, 'function');
if (typeof S.sourceDeUnite === 'function') {
    const s = S.sourceDeUnite;
    verifier('champ source présent → il fait foi', s({ _id: 'PBL', source: 'bulbapedia' }, 'artofpkm'), 'bulbapedia');
    verifier('tpc-asie/<slug> sans champ source → préfixe de l\'_id', s({ _id: 'tpc-asie/Sword-Shield-Indonesian-Promos' }, 'artofpkm'), 'tpc-asie');
    verifier('pokemon-card-com/<slug> → préfixe', s({ _id: 'pokemon-card-com/M-P' }, 'bulbapedia'), 'pokemon-card-com');
    verifier('tcgdex/<code> → préfixe', s({ _id: 'tcgdex/sv1' }, 'artofpkm'), 'tcgdex');
    verifier('code nu (ancienne unité artofpkm, sans champ source) → le défaut', s({ _id: 'PBL' }, 'artofpkm'), 'artofpkm');
    verifier('aucune unité → le défaut', s(null, 'bulbapedia'), 'bulbapedia');
}
for (const f of ['remettre-en-file.js', 'reste-visuels.js']) verifier(`${f} déduit la source de l'unité par sourceDeUnite`, sansCommentaires(lire(f)).includes('sourceDeUnite('), true);

console.log(`\n${ok} passés, ${ko} en échec (sur ${ok + ko})`);
process.exit(ko ? 1 : 0);
