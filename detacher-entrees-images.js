// ============================================================
// DÉTACHER 5 ENTRÉES cartes.images (carte, set, cleR2) — lot VIGN-SUITE, point 6 (2026-10-17), liste FERMÉE
// ============================================================
//   node detacher-entrees-images.js                                   (simulation : lecture seule, n'écrit rien)
//   node lot-additif.js --quoi="…" --collections=cartes --annonce=<baisses.json> -- node detacher-entrees-images.js --ecrire --attendu=5
// Code de sortie : 0 ok · 1 le compte diffère de --attendu (ou un refus à l'écriture) · 2 --attendu manquant avec --ecrire, ou argument inconnu.
// Toute la décision vit dans collecte-cartes/detacher-entrees-images.js (testée par test-detacher-entrees-images.js).
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '.env') });
if (!process.env.MONGODB_CARTES_URI) dotenv.config({ path: 'C:/Users/Yung/Desktop/pokemon-proxy/.env' });
const { ouvrirConnexions } = require('./collecte-cartes/garde');
const DE = require('./collecte-cartes/detacher-entrees-images');

const AUTORISES = [/^--ecrire$/, /^--attendu=\d+$/];
const inconnus = process.argv.slice(2).filter(a => !AUTORISES.some(r => r.test(a)));
if (inconnus.length) { console.error(`❌ argument inconnu : ${inconnus.join(' ')} — autorisés : --ecrire, --attendu=N`); process.exit(2); }
const ecrire = process.argv.includes('--ecrire');
const att = process.argv.find(a => a.startsWith('--attendu='));
const ATTENDU = att ? Number(att.slice(10)) : null;
if (ecrire && ATTENDU === null) { console.error('❌ --ecrire exige --attendu=N (le compte regardé en simulation)'); process.exit(2); }

(async () => {
    const { cartes: cx, fermer } = await ouvrirConnexions({ production: false, buckets: [] });
    let code = 0;
    try {
        console.log(`LISTE FERMÉE : ${DE.LISTE.length} entrée(s)`);
        const plan = await DE.simuler(cx.db);
        const annonce = {}, vign = {};
        for (const x of plan.aDetacher) {
            const e = x.entree;
            console.log(`   À DÉTACHER : carte ${e.carteId} (${e.set}) entrée ${e.cleFausse}${x.avecVignette ? ' [avec vignette]' : ''} · garde ${e.cleJuste} · le LV.X ${e.carteLvx} garde ${e.cleFausse}`);
            annonce[`images set:${e.set}`] = (annonce[`images set:${e.set}`] ?? 0) + 1;
            if (x.avecVignette) vign[`vignettes-set set:${e.set}`] = (vign[`vignettes-set set:${e.set}`] ?? 0) + 1;
        }
        for (const x of plan.refus) console.log(`   REFUS carte ${x.entree.carteId} : ${x.raison}`);
        console.log(`   ${plan.aDetacher.length} à détacher · ${plan.refus.length} refus`);
        console.log(`ANNONCE des baisses (pour lot-additif --annonce) : ${JSON.stringify({ ...annonce, ...vign })}`);
        if (!ecrire) console.log(`   (simulation : rien écrit — relancer avec --ecrire --attendu=${plan.aDetacher.length}, par lot-additif.js --collections=cartes)`);
        else if (ATTENDU !== plan.aDetacher.length) { console.error(`❌ ARRÊT : ${plan.aDetacher.length} à détacher contre ${ATTENDU} attendus — la base a bougé depuis la simulation`); code = 1; }
        else {
            const n = await DE.detacher(cx.db, plan);
            const reste = (await DE.simuler(cx.db)).aDetacher.length;
            console.log(`   ✅ ${n} détachée(s) (attendu ${ATTENDU}) · relu : ${reste} entrée(s) fausse(s) restante(s)`);
            if (n !== ATTENDU || reste !== 0) code = 1;
        }
    } catch (e) { console.error(`❌ ${e.message}`); code = 1; }
    await fermer();
    process.exit(code);
})();
