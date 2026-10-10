// ============================================================
// RETIRER EN UN SEUL LOT LES VISUELS D'images.pokemontcg.io — la condition de leur ouverture (testeur, 2026-10-08)
// ============================================================
//   node retirer-visuels-ptcgio.js                                  (simulation : comptes par set, écrit l'annonce des baisses)
//   node lot-additif.js --quoi="retrait des visuels pokemontcg.io" --collections=cartes,images --annonce=<annonce> -- node retirer-visuels-ptcgio.js --ecrire
//
// Ne s'exécute QUE sur demande de l'éditeur (une suppression attend toujours son feu vert). Il retire EXACTEMENT le lot : les entrées
// `cartes.images` de source `pokemontcg.io` ET de lot `ptcgio-2026-10` (planRetraitPtcgio) — ni une autre source, ni un autre lot —, passe les
// documents `images` du lot à « retire » (une recollecte ne les reprend pas), et pose l'alerte « source-bloquee » (plus aucune requête).
// Les objets R2 restent (un retour arrière est un rejeu) ; `--effacer-r2` les supprime aussi (vignettes comprises), définitivement.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { ouvrirConnexions } = require('./collecte-cartes/garde');
const { compterEtat, comparer } = require('./collecte-cartes/garde-lot');
const P = require('./collecte-cartes/ptcgio');
const r2 = require('./collecte-cartes/r2');

const AUTORISES = [/^--ecrire$/, /^--effacer-r2$/];
const inconnus = process.argv.slice(2).filter(a => !AUTORISES.some(r => r.test(a)));
if (inconnus.length) { console.error(`❌ argument inconnu : ${inconnus.join(' ')} — autorisés : --ecrire, --effacer-r2`); process.exit(2); }
const ecrire = process.argv.includes('--ecrire');
if (process.argv.includes('--effacer-r2') && !ecrire) { console.error('❌ --effacer-r2 sans --ecrire n\'a pas de sens'); process.exit(2); }
const duLot = e => e.source === P.SOURCE && e.lot === P.LOT;

(async () => {
    const { cartes: cx, fermer } = await ouvrirConnexions({ production: false, buckets: [] });
    const C = cx.db.collection('cartes'), I = cx.db.collection('images'), E = cx.db.collection('collecte_images_etat');
    const cartes = await C.find({ images: { $elemMatch: { source: P.SOURCE, lot: P.LOT } } }, { projection: { sets: 1, nomEn: 1, impressions: 1, images: 1 } }).toArray();
    const R = P.planRetraitPtcgio(cartes);
    const docs = await I.countDocuments({ source: P.SOURCE, lot: P.LOT, etat: { $ne: 'retire' } });
    const parSet = {};
    for (const c of cartes) for (const e of c.images || []) if (duLot(e)) parSet[e.set] = (parSet[e.set] || 0) + 1;
    console.log(`\n════ DÉNOMINATEUR : source ${P.SOURCE}, lot ${P.LOT} · ${R.cartes.length} cartes portent ${R.entrees} entrées · ${docs} documents « images » non retirés · ${R.cles.length} clés R2 ════`);
    for (const [k, n] of Object.entries(parSet).sort((a, b) => b[1] - a[1])) console.log(`   ${k.padEnd(50)} ${n}`);
    const avant = compterEtat({ cartes });
    const apres = compterEtat({ cartes: cartes.map(c => ({ ...c, images: (c.images || []).filter(e => !duLot(e)) })) });
    const { baisses } = comparer(avant, apres);
    const fichier = path.join(__dirname, 'collecte-cartes', 'rapports', `annonce-retirer-visuels-ptcgio-${new Date().toISOString().slice(0, 10)}.json`);
    fs.mkdirSync(path.dirname(fichier), { recursive: true });
    fs.writeFileSync(fichier, JSON.stringify(Object.fromEntries(baisses.map(b => [b.cle, b.baisse])), null, 1));
    console.log(`   annonce des baisses (${baisses.length} groupes) → ${fichier}`);
    if (!ecrire) { console.log('\n   (simulation — le retrait ne part que sur demande de l\'éditeur : lot-additif.js --annonce=<ce fichier> … -- node retirer-visuels-ptcgio.js --ecrire)'); await fermer(); return; }

    const le = new Date(), motif = 'retrait en un lot des visuels images.pokemontcg.io (lot ' + P.LOT + '), sur demande de l\'éditeur';
    const nC = (await C.updateMany({ 'images.source': P.SOURCE, 'images.lot': P.LOT }, { $pull: { images: { source: P.SOURCE, lot: P.LOT } } })).modifiedCount;
    const nI = (await I.updateMany({ source: P.SOURCE, lot: P.LOT, etat: { $ne: 'retire' } }, { $set: { etat: 'retire', retireLe: le, retireMotif: motif } })).modifiedCount;
    await E.updateOne({ _id: P.ID_ALERTE }, { $set: { active: true, constateLe: le, motif, retrait: true }, $setOnInsert: { depuis: le } }, { upsert: true });
    let nR = 0;
    if (process.argv.includes('--effacer-r2')) { for (let i = 0; i < R.cles.length; i += 500) { await r2.supprimer(process.env.R2_BUCKET_IMAGES, R.cles.slice(i, i + 500)); nR += Math.min(500, R.cles.length - i); } }
    const reste = await C.countDocuments({ images: { $elemMatch: { source: P.SOURCE, lot: P.LOT } } });
    console.log(`\n   ${reste ? '🔴' : '✅'} cartes modifiées ${nC} · documents retirés ${nI} · objets R2 effacés ${nR} · source fermée · relu : ${reste} carte(s) portent encore une entrée du lot`);
    console.log(`SETS : ${Object.keys(parSet).join(',')}`);
    if (reste) process.exitCode = 1;
    await fermer();
})().catch(e => { console.error(e); process.exit(1); });
