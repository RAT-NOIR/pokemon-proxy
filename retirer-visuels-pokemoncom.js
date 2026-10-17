// ============================================================
// RETIRER EN UN SEUL LOT LES VISUELS pokemon.com (lot PKMCOM-IMPORT, 2026-10-17)
// ============================================================
//   node retirer-visuels-pokemoncom.js                                  (simulation : comptes par set, écrit l'annonce des baisses)
//   node lot-additif.js --quoi="retrait des visuels pokemon.com" --collections=cartes,images,sets --annonce=<annonce> -- node retirer-visuels-pokemoncom.js --ecrire [--effacer-r2]
//
// Ne s'exécute QUE sur demande du testeur (une suppression attend toujours son feu vert). Il retire EXACTEMENT le lot : les entrées `cartes.images` de source `pokemon.com`
// ET de lot `pokemoncom-2026-10` (planRetrait, vignettes comprises) — ni une autre source, ni un autre lot —, passe les documents `images` du lot à « retire » (une recollecte
// ne les reprend pas) et nettoie le bilan `sets.visuelsPokemoncom`. Les objets R2 restent (un retour arrière est un rejeu) ; `--effacer-r2` les supprime aussi, définitivement.
// Il ne touche pas au cache local ni au fichier d'arrêt : ce sont les affaires du dossier de travail. `retirerLot` est la fonction que le banc rejoue sur une base en mémoire.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const PK = require('./collecte-cartes/pokemoncom');

const duLot = e => e?.source === PK.SOURCE && e?.lot === PK.LOT;
async function cartesDuLot(db) {
    const cartes = await db.collection('cartes').find({ 'images.source': PK.SOURCE }, { projection: { sets: 1, nomEn: 1, images: 1 } }).toArray();
    return cartes.filter(c => (c.images || []).some(duLot));
}

async function retirerLot(db, { ecrire = false, effacerR2 = false, supprimer = null, bucket = process.env.R2_BUCKET_IMAGES, verifierBucket = null } = {}) {
    const C = db.collection('cartes'), I = db.collection('images'), S = db.collection('sets');
    const cartes = await cartesDuLot(db);
    const R = PK.planRetrait(cartes);
    const docsLot = await I.find({ source: PK.SOURCE, lot: PK.LOT }).toArray();
    const aRetirer = docsLot.filter(d => d.etat !== 'retire');
    const cles = [...new Set([...R.cles, ...docsLot.flatMap(d => [d.cleR2, d.vignette?.cleR2].filter(Boolean))])];
    const parSet = {};
    for (const c of cartes) for (const e of c.images || []) if (duLot(e)) parSet[e.set] = (parSet[e.set] || 0) + 1;
    const plan = { cartes: R.cartes, entrees: R.entrees, docs: aRetirer.length, cles, parSet };
    if (!ecrire) return plan;
    if (effacerR2 && (typeof supprimer !== 'function' || typeof verifierBucket !== 'function' || !bucket)) throw new Error('retirerLot : --effacer-r2 sans client R2, sans verifierBucket ou sans nom de bucket');
    if (effacerR2) await verifierBucket(bucket);     // le bucket d'abord (juridiction UE) : rien n'est écrit ni supprimé s'il ne répond pas
    const le = new Date(), motif = `retrait en un lot des visuels pokemon.com (lot ${PK.LOT}), sur demande du testeur`;
    let nC = 0, nI = 0, nR = 0;
    for (const id of R.cartes) nC += (await C.updateOne({ _id: id }, { $pull: { images: { source: PK.SOURCE, lot: PK.LOT } } })).modifiedCount;
    for (const d of aRetirer) nI += (await I.updateOne({ _id: d._id }, { $set: { etat: 'retire', retireLe: le, retireMotif: motif } })).modifiedCount;
    const setsNettoyes = [];
    for (const s of await S.find({ visuelsPokemoncom: { $exists: true } }).toArray()) { await S.updateOne({ _id: s._id }, { $unset: { visuelsPokemoncom: 1 } }); setsNettoyes.push(s._id); }
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
    console.log(`\n════ DÉNOMINATEUR : source ${PK.SOURCE}, lot ${PK.LOT} · ${plan.cartes.length} cartes portent ${plan.entrees} entrées · ${plan.docs} documents « images » non retirés · ${plan.cles.length} clés R2 (images et vignettes) ════`);
    for (const [k, n] of Object.entries(plan.parSet).sort((a, b) => b[1] - a[1])) console.log(`   ${k.padEnd(50)} ${n}`);
    const avant = compterEtat({ cartes });
    const apres = compterEtat({ cartes: cartes.map(c => ({ ...c, images: (c.images || []).filter(e => !duLot(e)) })) });
    const { baisses } = comparer(avant, apres);
    const fichier = path.join(__dirname, 'collecte-cartes', 'rapports', `annonce-retirer-visuels-pokemoncom-${new Date().toISOString().slice(0, 10)}.json`);
    fs.mkdirSync(path.dirname(fichier), { recursive: true });
    fs.writeFileSync(fichier, JSON.stringify(Object.fromEntries(baisses.map(b => [b.cle, b.baisse])), null, 1));
    console.log(`   annonce des baisses (${baisses.length} groupes) → ${fichier}`);
    if (!ecrire) { console.log('\n   (simulation — le retrait ne part que sur demande du testeur : lot-additif.js --annonce=<ce fichier> … -- node retirer-visuels-pokemoncom.js --ecrire)'); await fermer(); return; }
    const r = await retirerLot(cx.db, { ecrire: true, effacerR2, supprimer: (b, cles) => r2.supprimer(b, cles), verifierBucket: b => r2.verifierBucket(b) });
    console.log(`\n   ${r.reste ? '🔴' : '✅'} cartes modifiées ${r.nC} · documents retirés ${r.nI} · objets R2 effacés ${r.nR} · bilans de sets nettoyés ${r.setsNettoyes.length} · relu : ${r.reste} carte(s) portent encore une entrée du lot`);
    console.log(`SETS : ${Object.keys(r.parSet).join(',')}`);
    if (r.reste) process.exitCode = 1;
    await fermer();
})().catch(e => { console.error(e); process.exit(1); });
