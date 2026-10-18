// ============================================================
// RETIRER EN UNE COMMANDE TOUTE LA SOURCE `pkc` (lot PKMNCARDS, doctrine de collecte du testeur du 2026-10-17)
// ============================================================
//   node retirer-visuels-pkmncards.js                                  À BLANC (plan sans écriture : comptes par set, écrit l'annonce des baisses) — à lancer AVANT le premier lot
//   node lot-additif.js --quoi="retrait des visuels pkc" --collections=cartes,images,sets --annonce=<annonce> -- node retirer-visuels-pkmncards.js --ecrire [--effacer-r2]
//
// Ne s'exécute QUE sur demande du testeur (une suppression attend toujours son feu vert). Il retire TOUT ce qui vient de la source `pkc`, tous lots confondus (chaque image écrite porte `retirable: true`,
// son adresse d'origine et sa date de collecte) : les entrées `cartes.images` (vignettes comprises), puis RÉTABLIT les entrées qu'un remplacement avait sorties (l'historique complet est sur le document de
// la remplaçante : `remplaceDes`) et repasse leur document à « ok ». Les documents `images` de la source passent à « retire » (une recollecte ne les reprend pas) et le bilan `sets.visuelsPkc` est nettoyé.
// Les objets R2 restent (un retour arrière est un rejeu) ; `--effacer-r2` les supprime aussi, définitivement. `retirerLot` est la fonction que le banc rejoue sur une base en mémoire.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const P = require('./collecte-cartes/pkmncards');

const duneSource = e => e?.source === P.SOURCE;
async function cartesDeLaSource(db) {
    const cartes = await db.collection('cartes').find({ 'images.source': P.SOURCE }, { projection: { sets: 1, nomEn: 1, images: 1 } }).toArray();
    return cartes.filter(c => (c.images || []).some(duneSource));
}
/** Les entrées à rétablir : celles que les remplacements de la source ont sorties (documents `images` de la source, champ remplaceDes), une fois par (carte, set, cleR2). */
function entreesARetablir(docs) {
    const vues = new Set(), liste = [];
    for (const d of docs) for (const e of d.remplaceDes || []) { const k = `${d.carteId}|${e.set}|${e.cleR2}`; if (!vues.has(k)) { vues.add(k); liste.push({ carteId: d.carteId, entree: e }); } }
    return liste;
}

async function retirerLot(db, { ecrire = false, effacerR2 = false, supprimer = null, bucket = process.env.R2_BUCKET_IMAGES, verifierBucket = null } = {}) {
    const C = db.collection('cartes'), I = db.collection('images'), S = db.collection('sets');
    const cartes = await cartesDeLaSource(db);
    const R = P.planRetrait(cartes);
    const docs = await I.find({ source: P.SOURCE }).toArray();
    const aRetirer = docs.filter(d => d.etat !== 'retire');
    const retablir = entreesARetablir(docs);
    const cles = [...new Set([...R.cles, ...docs.flatMap(d => [d.cleR2, d.vignette?.cleR2].filter(Boolean))])];
    const parSet = {};
    for (const c of cartes) for (const e of c.images || []) if (duneSource(e)) parSet[e.set] = (parSet[e.set] || 0) + 1;
    const plan = { cartes: R.cartes, entrees: R.entrees, docs: aRetirer.length, cles, parSet, retablies: retablir.length };
    if (!ecrire) return plan;
    if (effacerR2 && (typeof supprimer !== 'function' || typeof verifierBucket !== 'function' || !bucket)) throw new Error('retirerLot : --effacer-r2 sans client R2, sans verifierBucket ou sans nom de bucket');
    if (effacerR2) await verifierBucket(bucket);     // le bucket d'abord (juridiction UE) : rien n'est écrit ni supprimé s'il ne répond pas
    const le = new Date(), motif = `retrait en une commande de toute la source ${P.SOURCE}, sur demande du testeur`;
    let nC = 0, nI = 0, nR = 0, nRet = 0;
    for (const id of R.cartes) nC += (await C.updateOne({ _id: id }, { $pull: { images: { source: P.SOURCE } } })).modifiedCount;
    for (const { carteId, entree } of retablir) {
        const c = await C.findOne({ _id: carteId });
        if (!c || (c.images || []).some(x => x.set === entree.set && x.cleR2 === entree.cleR2)) continue;
        await C.updateOne({ _id: carteId }, { $push: { images: entree } });
        await I.updateOne({ source: entree.source, set: entree.set, carteId, cleR2: entree.cleR2, 'remplacePar.source': P.SOURCE }, { $set: { etat: 'ok' }, $unset: { remplacePar: 1, remplaceLe: 1 } });
        nRet++;
    }
    for (const d of aRetirer) nI += (await I.updateOne({ _id: d._id }, { $set: { etat: 'retire', retireLe: le, retireMotif: motif } })).modifiedCount;
    const setsNettoyes = [];
    for (const s of await S.find({ visuelsPkc: { $exists: true } }).toArray()) { await S.updateOne({ _id: s._id }, { $unset: { visuelsPkc: 1 } }); setsNettoyes.push(s._id); }
    if (effacerR2) for (let i = 0; i < cles.length; i += 500) { await supprimer(bucket, cles.slice(i, i + 500)); nR += Math.min(500, cles.length - i); }
    const reste = (await cartesDeLaSource(db)).length;
    return { ...plan, nC, nI, nR, nRet, setsNettoyes, reste };
}

module.exports = { retirerLot, cartesDeLaSource, entreesARetablir };

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
        console.log(`\n════ DÉNOMINATEUR : source ${P.SOURCE} (tous lots) · ${plan.cartes.length} cartes portent ${plan.entrees} entrées · ${plan.docs} documents « images » non retirés · ${plan.retablies} entrée(s) remplacée(s) à rétablir · ${plan.cles.length} clés R2 (images et vignettes) ════`);
        for (const [k, n] of Object.entries(plan.parSet).sort((a, b) => b[1] - a[1])) console.log(`   ${k.padEnd(50)} ${n}`);
        const docs = await cx.db.collection('images').find({ source: P.SOURCE }).toArray();
        const retablies = entreesARetablir(docs);
        const avant = compterEtat({ cartes });
        const apres = compterEtat({ cartes: cartes.map(c => ({ ...c, images: [...(c.images || []).filter(e => !duneSource(e)), ...retablies.filter(x => x.carteId === c._id).map(x => x.entree)] })) });
        const { baisses } = comparer(avant, apres);
        const fichier = path.join(P.DOSSIER_LOT, `annonce-retirer-visuels-pkc-${new Date().toISOString().slice(0, 10)}.json`);
        fs.mkdirSync(path.dirname(fichier), { recursive: true });
        fs.writeFileSync(fichier, JSON.stringify(Object.fromEntries(baisses.map(b => [b.cle, b.baisse])), null, 1));
        console.log(`   annonce des baisses (${baisses.length} groupes) → ${fichier}`);
        if (!ecrire) { console.log('\n   (À BLANC — le retrait ne part que sur demande du testeur : lot-additif.js --annonce=<ce fichier> … -- node retirer-visuels-pkmncards.js --ecrire)'); return; }
        const r = await retirerLot(cx.db, { ecrire: true, effacerR2, supprimer: (b, cles) => r2.supprimer(b, cles), verifierBucket: b => r2.verifierBucket(b) });
        console.log(`\n   ${r.reste ? '🔴' : '✅'} cartes modifiées ${r.nC} · entrées rétablies ${r.nRet} · documents retirés ${r.nI} · objets R2 effacés ${r.nR} · bilans de sets nettoyés ${r.setsNettoyes.length} · relu : ${r.reste} carte(s) portent encore une entrée de la source`);
        console.log(`SETS : ${Object.keys(r.parSet).join(',')}`);
        if (r.reste) process.exitCode = 1;
    } finally { await fermer(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
