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

// ── les appelants : chacun passe par largeurMinDe avec SA source, aucun ne compare à LARGEUR_MIN ──────────────────────
const lire = f => fs.readFileSync(path.join(__dirname, f), 'utf8');
const sansCommentaires = t => t.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
const APPELANTS = {
    'collecteur-images.js': "largeurMinDe('artofpkm')",
    'collecteur-images-bulba.js': "largeurMinDe('bulbapedia')",
    'collecteur-images-tcgdex.js': "largeurMinDe('tcgdex')",
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

// ── la garde du commit du worker : le collecteur TPC est un fichier du critère ──────────────────────────────────────
const regles = lire('remettre-en-file.js').match(/const REGLES = \[([\s\S]*?)\];/)?.[1] ?? '';
verifier('REGLES surveille seuils-images.js ET collecteur-images-tpc.js', ['seuils-images.js', 'collecteur-images-tpc.js'].map(x => regles.includes(`'${x}`) || regles.includes(`/${x}'`)), [true, true]);

console.log(`\n${ok} passés, ${ko} en échec (sur ${ok + ko})`);
process.exit(ko ? 1 : 0);
