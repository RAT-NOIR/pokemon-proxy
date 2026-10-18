// ============================================================
// RETIRER TOUTE LA SOURCE « pokedata » EN UNE COMMANDE (lot POKEDATA, 2026-10-17) — À BLANC PAR DÉFAUT
// ============================================================
//   node retirer-visuels-pokedata.js                                   (À BLANC : comptes par set, écrit l'annonce des baisses ; rien n'est modifié)
//   node lot-additif.js --quoi="retrait des visuels de la source" --collections=cartes,images,sets --annonce=<annonce> -- node retirer-visuels-pokedata.js --ecrire [--effacer-r2]
//
// Ne s'exécute QUE sur demande du testeur (une suppression attend son feu vert ; les visuels sont retirables à la demande de The Pokémon Company). Il retire TOUTE la source :
// les entrées `cartes.images` de source `pdt`, quel que soit le lot (planRetrait ne filtre que la source ici), vignettes comprises, passe les documents `images` de la source à
// « retire » (une recollecte ne les reprend pas) et nettoie le bilan de set. Les objets R2 restent (un retour arrière est un rejeu) ; `--effacer-r2` les supprime définitivement.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const P = require('./collecte-cartes/pokedata');

const delaSource = e => e?.source === P.SOURCE;
async function cartesDeLaSource(db) {
    const cartes = await db.collection('cartes').find({ 'images.source': P.SOURCE }, { projection: { sets: 1, nomEn: 1, images: 1 } }).toArray();
    return cartes.filter(c => (c.images || []).some(delaSource));
}

async function retirerLot(db, { ecrire = false, effacerR2 = false, supprimer = null, bucket = process.env.R2_BUCKET_IMAGES, verifierBucket = null } = {}) {
    const C = db.collection('cartes'), I = db.collection('images'), S = db.collection('sets');
    const cartes = await cartesDeLaSource(db);
    const R = P.planRetrait(cartes.map(c => ({ ...c, images: (c.images || []).map(e => (delaSource(e) ? { ...e, lot: P.LOT } : e)) })));      // (toute la source : le lot est ramené au lot courant pour le dénombrement)
    const docs = await I.find({ source: P.SOURCE }).toArray();
    const aRetirer = docs.filter(d => d.etat !== 'retire');
    const cles = [...new Set([...R.cles, ...docs.flatMap(d => [d.cleR2, d.vignette?.cleR2].filter(Boolean))])];
    const parSet = {};
    for (const c of cartes) for (const e of c.images || []) if (delaSource(e)) parSet[e.set] = (parSet[e.set] || 0) + 1;
    const plan = { cartes: R.cartes, entrees: R.entrees, docs: aRetirer.length, cles, parSet };
    if (!ecrire) return plan;
    if (effacerR2 && (typeof supprimer !== 'function' || typeof verifierBucket !== 'function' || !bucket)) throw new Error('retirerLot : --effacer-r2 sans client R2, sans verifierBucket ou sans nom de bucket');
    if (effacerR2) await verifierBucket(bucket);
    const le = new Date(), motif = 'retrait en un lot de toute la source, sur demande du testeur';
    let nC = 0, nI = 0, nR = 0;
    for (const id of R.cartes) nC += (await C.updateOne({ _id: id }, { $pull: { images: { source: P.SOURCE } } })).modifiedCount;
    for (const d of aRetirer) nI += (await I.updateOne({ _id: d._id }, { $set: { etat: 'retire', retireLe: le, retireMotif: motif } })).modifiedCount;
    const setsNettoyes = [];
    for (const s of await S.find({ bilanLotPdt: { $exists: true } }).toArray()) { await S.updateOne({ _id: s._id }, { $unset: { bilanLotPdt: 1 } }); setsNettoyes.push(s._id); }
    if (effacerR2) for (let i = 0; i < cles.length; i += 500) { await supprimer(bucket, cles.slice(i, i + 500)); nR += Math.min(500, cles.length - i); }
    const reste = (await cartesDeLaSource(db)).length;
    return { ...plan, nC, nI, nR, setsNettoyes, reste };
}

module.exports = { retirerLot, cartesDeLaSource };

// ⚠️ EXÉCUTÉ SEULEMENT EN LIGNE DE COMMANDE.
if (require.main !== module) return;

const AUTORISES = [/^--ecrire$/, /^--effacer-r2$/];
const inconnus = process.argv.slice(2).filter(a => !AUTORISES.some(r => r.test(a)));
if (inconnus.length) { console.error(`❌ argument inconnu : ${inconnus.join(' ')} — autorisés : --ecrire, --effacer-r2`); process.exitCode = 2; }
const ecrire = process.argv.includes('--ecrire'), effacerR2 = process.argv.includes('--effacer-r2');
if (effacerR2 && !ecrire) { console.error('❌ --effacer-r2 sans --ecrire n\'a pas de sens'); process.exitCode = 2; }

if (process.exitCode !== 2) (async () => {
    const { ouvrirConnexions } = require('./collecte-cartes/garde');
    const { compterEtat, comparer } = require('./collecte-cartes/garde-lot');
    const r2 = require('./collecte-cartes/r2');
    const { cartes: cx, fermer } = await ouvrirConnexions({ production: false, buckets: effacerR2 ? ['R2_BUCKET_IMAGES'] : [] });
    try {
        const cartes = await cartesDeLaSource(cx.db);
        const plan = await retirerLot(cx.db, { ecrire: false });
        console.log(`\n════ DÉNOMINATEUR : source ${P.SOURCE} · ${plan.cartes.length} cartes portent ${plan.entrees} entrées · ${plan.docs} documents « images » non retirés · ${plan.cles.length} clés R2 (images et vignettes) ════`);
        for (const [k, n] of Object.entries(plan.parSet).sort((a, b) => b[1] - a[1])) console.log(`   ${k.padEnd(50)} ${n}`);
        const avant = compterEtat({ cartes });
        const apres = compterEtat({ cartes: cartes.map(c => ({ ...c, images: (c.images || []).filter(e => !delaSource(e)) })) });
        const { baisses } = comparer(avant, apres);
        const fichier = path.join(P.DOSSIER_LOT, `annonce-retirer-source-${new Date().toISOString().slice(0, 10)}.json`);
        fs.mkdirSync(path.dirname(fichier), { recursive: true });
        fs.writeFileSync(fichier, JSON.stringify(Object.fromEntries(baisses.map(b => [b.cle, b.baisse])), null, 1));
        console.log(`   annonce des baisses (${baisses.length} groupes) → ${fichier}`);
        if (!ecrire) { console.log('\n   (À BLANC — le retrait ne part que sur demande du testeur : lot-additif.js --annonce=<ce fichier> … -- node retirer-visuels-pokedata.js --ecrire)'); return; }
        const r = await retirerLot(cx.db, { ecrire: true, effacerR2, supprimer: (b, cles) => r2.supprimer(b, cles), verifierBucket: b => r2.verifierBucket(b) });
        console.log(`\n   ${r.reste ? '🔴' : '✅'} cartes modifiées ${r.nC} · documents retirés ${r.nI} · objets R2 effacés ${r.nR} · bilans de sets nettoyés ${r.setsNettoyes.length} · relu : ${r.reste} carte(s) portent encore une entrée de la source`);
        if (r.reste) process.exitCode = 1;
    } finally { await fermer(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
