// ============================================================
// PLUSIEURS SETS EN UN LOT — collecteur-texte.js, un set après l'autre, dans UNE commande pour lot-additif.js
// ============================================================
//   node lot-additif.js --quoi="…" --collections=restes,collecte_etat -- node collecter-plusieurs.js --sets=A,B,C [--reparser]
//
// 🔑 POURQUOI (2026-09-25) : un lot = une sauvegarde COMPLÈTE de cartes, cartes_produits et sets (≈ 80 Mo). Un lot par set, c'était
// 41 sauvegardes, ≈ 3 Go sortis d'une grappe partagée au débit bridé (le site y lit aussi), et 10 à 15 min par set. Un lot pour
// N sets garde TOUT ce que la garde garantit : elle compte chaque groupe (fiches par expansion, impressions, images, noms) avant
// et après, et une baisse non annoncée n'importe où arrête le lot et le restaure — tous ses sets avec.
// S'arrête au PREMIER set en échec (code ≠ 0) : la garde juge alors ce qui a été écrit jusque-là, et le reste n'est pas lancé.
const { spawnSync } = require('child_process');
const sets = (process.argv.find(a => a.startsWith('--sets=')) || '').slice(7).split(',').map(s => s.trim()).filter(Boolean);
const extra = process.argv.includes('--reparser') ? ['--reparser'] : [];
// `--nommer` : en fin de lot, rapatrier-noms-sets.js --ecrire (il ne nomme QUE les sets sans nom, §57) — un set créé sans
// `nomAffichage` n'est pas publié, et le nommer dans le même lot évite une sauvegarde de plus.
const nommer = process.argv.includes('--nommer');
const inconnus = process.argv.slice(2).filter(a => !/^--sets=/.test(a) && !['--reparser', '--nommer'].includes(a));
if (!sets.length || inconnus.length) { console.error(`❌ usage : --sets=A,B,C [--reparser]${inconnus.length ? ` — argument inconnu : ${inconnus.join(' ')}` : ''}`); process.exit(2); }
let i = 0;
for (const code of sets) {
    i++;
    console.log(`\n──── ${i}/${sets.length} · ${code} · ${new Date().toISOString()} ────`);
    const r = spawnSync('node', ['collecteur-texte.js', `--set=${code}`, '--attendre', ...extra], { cwd: __dirname, stdio: 'inherit' });
    if (r.status !== 0) { console.error(`\n⛔ ${code} sorti avec le code ${r.status} : arrêt, non lancés : ${sets.slice(i).join(',') || '(aucun)'}`); process.exit(1); }
}
console.log(`\n✅ ${sets.length} sets collectés dans ce lot`);
if (nommer) {
    const r = spawnSync('node', ['rapatrier-noms-sets.js', '--ecrire'], { cwd: __dirname, stdio: 'inherit' });
    if (r.status !== 0) { console.error(`⛔ nommage sorti avec le code ${r.status}`); process.exit(1); }
}
