// ============================================================
// RETIRER EN UN SEUL LOT LES VISUELS DE PIKAQIAN — la condition de leur ouverture (testeur, 2026-10-11 : « à mes risques, retrait possible en un seul lot »)
// ============================================================
//   node retirer-visuels-pikaqian.js                                (simulation : les clés par set, écrit l'annonce des baisses ; n'écrit rien en base)
//   node lot-additif.js --quoi="retrait des visuels pikaqian" --collections=cartes,images,sets,collecte_images_etat,file_images --annonce=<annonce> -- node retirer-visuels-pikaqian.js --ecrire [--effacer-r2]
//
// Ne s'exécute QUE sur demande de l'éditeur (une suppression attend toujours son feu vert). Il retire EXACTEMENT le lot : les entrées `cartes.images` de source
// `pikaqian` ET de lot `pikaqian-2026-10` (planRetraitPikaqian, vignettes comprises) — ni une autre source, ni un autre lot —, passe les documents `images` du
// lot à « retire » (une recollecte ne les reprend pas), nettoie le bilan `sets.visuelsPikaqian` et le bilan des unités, ferme les unités pikaqian en attente
// (`file_images`) et pose l'alerte « source-bloquee » (plus aucune requête). Les objets R2 restent (un retour arrière est un rejeu) ; `--effacer-r2` les supprime
// aussi (images ET vignettes), définitivement. `retirerLot` est la fonction que le banc (test-collecteur-pikaqian.js) rejoue sur une base en mémoire.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const P = require('./collecte-cartes/pikaqian');

const duLot = e => e?.source === P.SOURCE && e?.lot === P.LOT;

/** Les cartes qui portent une entrée du lot (la requête vise la source ; le lot se juge ici, entrée par entrée). */
async function cartesDuLot(db) {
    const cartes = await db.collection('cartes').find({ 'images.source': P.SOURCE }, { projection: { sets: 1, nomEn: 1, impressions: 1, images: 1 } }).toArray();
    return cartes.filter(c => (c.images || []).some(duLot));
}

/**
 * @param {object} db  la base `cartes`
 * @param {{ecrire?: boolean, effacerR2?: boolean, supprimer?: Function, bucket?: string, verifierBucket?: Function}} o  `supprimer(bucket, cles)` : R2 (injecté par le banc)
 */
async function retirerLot(db, { ecrire = false, effacerR2 = false, supprimer = null, bucket = process.env.R2_BUCKET_IMAGES, verifierBucket = null } = {}) {
    const C = db.collection('cartes'), I = db.collection('images'), E = db.collection('collecte_images_etat'), S = db.collection('sets'), F = db.collection('file_images');
    const cartes = await cartesDuLot(db);
    const R = P.planRetraitPikaqian(cartes);
    const docsLot = await I.find({ source: P.SOURCE, lot: P.LOT }).toArray();
    const aRetirer = docsLot.filter(d => d.etat !== 'retire');
    // les clés R2 du lot : celles des entrées de cartes, et celles des documents (image et vignette) — une seule fois chacune
    const cles = [...new Set([...R.cles, ...docsLot.flatMap(d => [d.cleR2, d.vignette?.cleR2].filter(Boolean))])];
    const parSet = {};
    for (const c of cartes) for (const e of c.images || []) if (duLot(e)) parSet[e.set] = (parSet[e.set] || 0) + 1;
    const plan = { cartes: R.cartes, entrees: R.entrees, docs: aRetirer.length, cles, parSet };
    if (!ecrire) return plan;
    if (effacerR2 && (typeof supprimer !== 'function' || typeof verifierBucket !== 'function' || !bucket)) throw new Error('retirerLot : --effacer-r2 sans client R2, sans verifierBucket ou sans nom de bucket');
    // 🔴 le bucket d'abord (juridiction UE : le point d'accès générique répond AccessDenied) : rien n'est écrit ni supprimé s'il ne répond pas
    if (effacerR2) await verifierBucket(bucket);

    const le = new Date(), motif = `retrait en un lot des visuels pikaqian (lot ${P.LOT}), sur demande de l'éditeur`;
    let nC = 0, nI = 0, nR = 0;
    // la source se FERME d'abord : plus aucune requête pendant le retrait
    await E.updateOne({ _id: P.ID_ALERTE }, { $set: { active: true, constateLe: le, motif, retrait: true }, $setOnInsert: { depuis: le } }, { upsert: true });
    for (const id of R.cartes) nC += (await C.updateOne({ _id: id }, { $pull: { images: { source: P.SOURCE, lot: P.LOT } } })).modifiedCount;
    for (const d of aRetirer) nI += (await I.updateOne({ _id: d._id }, { $set: { etat: 'retire', retireLe: le, retireMotif: motif } })).modifiedCount;
    // les bilans : celui des sets (`visuelsPikaqian`) et celui des unités (`bilan.lot`) décrivent un lot qui n'existe plus
    const setsNettoyes = [];
    for (const s of await S.find({ visuelsPikaqian: { $exists: true } }).toArray()) { await S.updateOne({ _id: s._id }, { $unset: { visuelsPikaqian: 1 } }); setsNettoyes.push(s._id); }
    for (const u of await E.find({ 'bilan.lot': P.LOT }).toArray()) await E.updateOne({ _id: u._id }, { $set: { phase: 'retire' }, $unset: { bilan: 1, restes: 1 } });
    // les unités pikaqian encore en attente sont fermées (un retrait n'est pas un arrêt passager) ; celles des autres sources ne bougent pas
    for (const u of await F.find({ source: P.SOURCE, etat: 'attente' }).toArray()) await F.updateOne({ _id: u._id }, { $set: { etat: 'refuse', resultat: 'retire-en-un-lot', fini: le, erreur: motif } });
    if (effacerR2) for (let i = 0; i < cles.length; i += 500) { await supprimer(bucket, cles.slice(i, i + 500)); nR += Math.min(500, cles.length - i); }
    const reste = (await cartesDuLot(db)).length;
    return { ...plan, nC, nI, nR, setsNettoyes, reste };
}

module.exports = { retirerLot, cartesDuLot };

// ⚠️ EXÉCUTÉ SEULEMENT EN LIGNE DE COMMANDE.
if (require.main !== module) return;

const AUTORISES = [/^--ecrire$/, /^--effacer-r2$/];
const inconnus = process.argv.slice(2).filter(a => !AUTORISES.some(r => r.test(a)));
if (inconnus.length) { console.error(`❌ argument inconnu : ${inconnus.join(' ')} — autorisés : --ecrire, --effacer-r2`); process.exit(2); }
const ecrire = process.argv.includes('--ecrire'), effacerR2 = process.argv.includes('--effacer-r2');
if (effacerR2 && !ecrire) { console.error('❌ --effacer-r2 sans --ecrire n\'a pas de sens'); process.exit(2); }

(async () => {
    const { ouvrirConnexions } = require('./collecte-cartes/garde');
    const { compterEtat, comparer } = require('./collecte-cartes/garde-lot');
    const r2 = require('./collecte-cartes/r2');
    const { cartes: cx, fermer } = await ouvrirConnexions({ production: false, buckets: effacerR2 ? ['R2_BUCKET_IMAGES'] : [] });
    const cartes = await cartesDuLot(cx.db);
    const plan = await retirerLot(cx.db, { ecrire: false });
    console.log(`\n════ DÉNOMINATEUR : source ${P.SOURCE}, lot ${P.LOT} · ${plan.cartes.length} cartes portent ${plan.entrees} entrées · ${plan.docs} documents « images » non retirés · ${plan.cles.length} clés R2 (images et vignettes) ════`);
    for (const [k, n] of Object.entries(plan.parSet).sort((a, b) => b[1] - a[1])) console.log(`   ${k.padEnd(50)} ${n}`);
    for (const c of plan.cles.slice(0, 20)) console.log(`   clé R2 : ${c}`);
    if (plan.cles.length > 20) console.log(`   … et ${plan.cles.length - 20} autres clés`);
    // l'annonce, par la fonction de la garde : ce qui baisse, groupe par groupe
    const avant = compterEtat({ cartes });
    const apres = compterEtat({ cartes: cartes.map(c => ({ ...c, images: (c.images || []).filter(e => !duLot(e)) })) });
    const { baisses } = comparer(avant, apres);
    const fichier = path.join(__dirname, 'collecte-cartes', 'rapports', `annonce-retirer-visuels-pikaqian-${new Date().toISOString().slice(0, 10)}.json`);
    fs.mkdirSync(path.dirname(fichier), { recursive: true });
    fs.writeFileSync(fichier, JSON.stringify(Object.fromEntries(baisses.map(b => [b.cle, b.baisse])), null, 1));
    console.log(`   annonce des baisses (${baisses.length} groupes) → ${fichier}`);
    if (!ecrire) { console.log('\n   (simulation — le retrait ne part que sur demande de l\'éditeur : lot-additif.js --annonce=<ce fichier> … -- node retirer-visuels-pikaqian.js --ecrire)'); await fermer(); return; }
    const r = await retirerLot(cx.db, { ecrire: true, effacerR2, supprimer: (b, cles) => r2.supprimer(b, cles), verifierBucket: b => r2.verifierBucket(b) });
    console.log(`\n   ${r.reste ? '🔴' : '✅'} cartes modifiées ${r.nC} · documents retirés ${r.nI} · objets R2 effacés ${r.nR} · bilans de sets nettoyés ${r.setsNettoyes.length} · source fermée · relu : ${r.reste} carte(s) portent encore une entrée du lot`);
    console.log(`SETS : ${Object.keys(r.parSet).join(',')}`);
    if (r.reste) process.exitCode = 1;
    await fermer();
})().catch(e => { console.error(e); process.exit(1); });
