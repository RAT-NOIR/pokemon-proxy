// ============================================================
// RETIRER UN LOT DE LA RÉCOLTE EN UNE COMMANDE (sources « ppr » et « tcs ») — À BLANC PAR DÉFAUT
// ============================================================
//   node retirer-visuels-recolte.js --source=ppr                        (À BLANC : comptes par set, écrit l'annonce des baisses ; rien n'est modifié)
//   node lot-additif.js --quoi="retrait de la source ppr" --collections=cartes,images,sets --annonce=<annonce> -- node retirer-visuels-recolte.js --source=ppr --ecrire [--effacer-r2]
//
// Ne s'exécute QUE sur demande du testeur (une suppression attend son feu vert ; les visuels sont retirables à la demande du détenteur des droits). Le retrait est EXACT : les entrées
// `cartes.images` de la source ET du lot (`source` et `lot`, jamais l'un sans l'autre), vignettes comprises ; les documents `images` du lot passent à « retire » (une recollecte ne les reprend pas) ;
// le bilan de set est nettoyé. Les objets R2 restent (un retour arrière est un rejeu) ; `--effacer-r2` les supprime définitivement.
// ✅ Ce que le lot a REMPLACÉ (une basse définition d'une autre source) est REMIS : l'écriture garde les entrées remplacées telles quelles sur le document du lot (`remplaceEntrees`) et l'état de leurs
// documents (`remplaceDocuments`) ; le retrait remet l'entrée sur la carte (si elle n'y est pas) et repasse le document de « remplace » à son état d'AVANT (jamais « ok » par défaut).
require('dotenv').config();
const fs = require('fs');
const path = require('path');

const SOURCES = Object.freeze({ ppr: () => require('./collecte-cartes/pokipair').SRC, tcs: () => require('./collecte-cartes/tcgcsv').SRC });
const DOSSIER = 'C:\\Users\\Yung\\rat-market-travail\\catalogue\\couverture\\S8\\RECOLTE';

const delaSource = (SRC, e) => e?.source === SRC.SOURCE && e.lot === SRC.LOT;
async function cartesDeLaSource(db, SRC) {
    return (await db.collection('cartes').find({ 'images.source': SRC.SOURCE }, { projection: { sets: 1, nomEn: 1, images: 1 } }).toArray()).filter(c => (c.images || []).some(e => delaSource(SRC, e)));
}
/** Le plan (pur sur ce qu'on lui donne) : cartes, entrées, clés R2 (images et vignettes), par set. */
function planDeRetrait(cartes, docs, SRC) {
    const parSet = {}, cles = new Set();
    let entrees = 0;
    for (const c of cartes) for (const e of c.images || []) if (delaSource(SRC, e)) { entrees++; parSet[e.set] = (parSet[e.set] || 0) + 1; for (const k of [e.cleR2, e.vignette?.cleR2]) if (k) cles.add(k); }
    for (const d of docs) if (delaSource(SRC, d)) for (const k of [d.cleR2, d.vignette?.cleR2]) if (k) cles.add(k);
    return { cartes: cartes.filter(c => (c.images || []).some(e => delaSource(SRC, e))).map(c => c._id), entrees, docs: docs.filter(d => delaSource(SRC, d) && d.etat !== 'retire').length, cles: [...cles], parSet, aRemettre: aRemettre(docs, SRC).length };
}
/**
 * D1 — CE QUE LE LOT A REMPLACÉ ET QUE LE RETRAIT REMET. L'écriture garde, sur le document du lot, les entrées remplacées TELLES QUELLES (`remplaceEntrees`, vignette comprise) et l'état exact de leurs
 * documents (`remplaceDocuments`). Un document déjà « retire » ne remet plus rien (le retrait a eu lieu). @returns {{carteId, entree, avant: object|null, lot: object}[]}
 */
function aRemettre(docs, SRC) {
    const l = [];
    for (const d of docs) {
        if (!delaSource(SRC, d) || d.etat === 'retire' || !Array.isArray(d.remplaceEntrees)) continue;
        for (const e of d.remplaceEntrees) l.push({ carteId: d.carteId, entree: e, avant: (d.remplaceDocuments || []).find(x => x.source === e.source && x.set === e.set && x.cleR2 === e.cleR2) ?? null, lot: d });
    }
    return l;
}
/** L'état des cartes APRÈS le retrait (pur) : les entrées du lot sortent, les entrées remplacées reviennent (si absentes). Sert à l'annonce des baisses : un échange 1 pour 1 n'est pas une baisse. */
function cartesApresRetrait(cartes, docs, SRC) {
    const remises = aRemettre(docs, SRC);
    return cartes.map(c => {
        const gardees = (c.images || []).filter(e => !delaSource(SRC, e));
        const ajout = remises.filter(r => r.carteId === c._id && !gardees.some(e => e.source === r.entree.source && e.set === r.entree.set && e.cleR2 === r.entree.cleR2)).map(r => r.entree);
        return { ...c, images: [...gardees, ...ajout] };
    });
}
/** Le plan lu dans la base (lecture seule). */
async function planLu(db, SRC) {
    const cartes = await cartesDeLaSource(db, SRC);
    const docs = await db.collection('images').find({ source: SRC.SOURCE, lot: SRC.LOT }).toArray();
    return { cartesLues: cartes, documentsLus: docs, ...planDeRetrait(cartes, docs, SRC) };
}

async function retirerLot(db, SRC, { ecrire = false, effacerR2 = false, supprimer = null, bucket = process.env.R2_BUCKET_IMAGES, verifierBucket = null } = {}) {
    const C = db.collection('cartes'), I = db.collection('images'), S = db.collection('sets');
    const { cartesLues, documentsLus: docs, ...plan } = await planLu(db, SRC);
    void cartesLues;
    if (!ecrire) return plan;
    if (effacerR2 && (typeof supprimer !== 'function' || typeof verifierBucket !== 'function' || !bucket)) throw new Error('retirerLot : --effacer-r2 sans client R2, sans verifierBucket ou sans nom de bucket');
    if (effacerR2) await verifierBucket(bucket);
    const le = new Date(), motif = `retrait en un lot (${SRC.LOT}), sur demande du testeur`;
    let nC = 0, nI = 0, nR = 0, nRemises = 0, nDocsRestaures = 0, nDocsNonRestaures = 0;
    // D1 — D'ABORD remettre ce que le lot avait remplacé (une carte n'est jamais sans visuel entre les deux gestes) : l'entrée telle qu'elle était, si elle n'est pas déjà là ; son document à l'état d'AVANT
    for (const r of aRemettre(docs, SRC)) {
        const e = r.entree;
        nRemises += (await C.updateOne({ _id: r.carteId, images: { $not: { $elemMatch: { source: e.source, set: e.set, cleR2: e.cleR2 } } } }, { $push: { images: e } })).modifiedCount;
        if (!r.avant || r.avant.etat == null) { nDocsNonRestaures++; continue; }          // pas d'état d'avant écrit : on ne devine pas « ok »
        const set = { etat: r.avant.etat }, unset = {};
        if (r.avant.remplacePar) set.remplacePar = r.avant.remplacePar; else unset.remplacePar = 1;
        if (r.avant.remplaceLe) set.remplaceLe = r.avant.remplaceLe; else unset.remplaceLe = 1;
        nDocsRestaures += (await I.updateOne({ source: e.source, set: e.set, cleR2: e.cleR2, etat: 'remplace', 'remplacePar.source': SRC.SOURCE, 'remplacePar.cleR2': r.lot.cleR2 }, { $set: set, $unset: unset })).modifiedCount;
    }
    for (const id of plan.cartes) nC += (await C.updateOne({ _id: id }, { $pull: { images: { source: SRC.SOURCE, lot: SRC.LOT } } })).modifiedCount;
    for (const d of docs.filter(d => d.etat !== 'retire')) nI += (await I.updateOne({ _id: d._id }, { $set: { etat: 'retire', retireLe: le, retireMotif: motif } })).modifiedCount;
    const setsNettoyes = [];
    for (const s of await S.find({ [SRC.CHAMP_BILAN]: { $exists: true } }).toArray()) { await S.updateOne({ _id: s._id }, { $unset: { [SRC.CHAMP_BILAN]: 1, [`${SRC.CHAMP_BILAN}Basse`]: 1 } }); setsNettoyes.push(s._id); }
    if (effacerR2) for (let i = 0; i < plan.cles.length; i += 500) { await supprimer(bucket, plan.cles.slice(i, i + 500)); nR += Math.min(500, plan.cles.length - i); }
    return { ...plan, nC, nI, nR, nRemises, nDocsRestaures, nDocsNonRestaures, setsNettoyes, reste: (await cartesDeLaSource(db, SRC)).length };
}

module.exports = { retirerLot, cartesDeLaSource, planDeRetrait, planLu, aRemettre, cartesApresRetrait, SOURCES };

// ⚠️ EXÉCUTÉ SEULEMENT EN LIGNE DE COMMANDE.
if (require.main !== module) return;

const args = process.argv.slice(2);
const AUTORISES = [/^--ecrire$/, /^--effacer-r2$/, /^--source=(ppr|tcs)$/];
const inconnus = args.filter(a => !AUTORISES.some(r => r.test(a)));
const code = args.find(a => a.startsWith('--source='))?.slice(9);
const ecrire = args.includes('--ecrire'), effacerR2 = args.includes('--effacer-r2');
if (inconnus.length || !code) { console.error(`❌ ${inconnus.length ? `argument inconnu : ${inconnus.join(' ')} — ` : ''}--source=ppr|tcs est obligatoire ; autorisés : --ecrire, --effacer-r2`); process.exitCode = 2; }
else if (effacerR2 && !ecrire) { console.error('❌ --effacer-r2 sans --ecrire n\'a pas de sens'); process.exitCode = 2; }

if (process.exitCode !== 2) (async () => {
    const SRC = SOURCES[code]();
    const { ouvrirConnexions } = require('./collecte-cartes/garde');
    const { ouvrirLecture } = require('./collecte-cartes/ouvrir-lecture');
    const { compterEtat, comparer } = require('./collecte-cartes/garde-lot');
    const r2 = require('./collecte-cartes/r2');
    let lecture = null, cx = null;
    if (ecrire) {
        require('./collecte-cartes/images-empruntees').garderSousLot(process.env, process.ppid);
        cx = await ouvrirConnexions({ production: false, buckets: effacerR2 ? ['R2_BUCKET_IMAGES'] : [] });
    } else {
        lecture = await ouvrirLecture();
        if (!lecture) throw new Error('MONGODB_CARTES_LECTURE_URI absente : le retrait à blanc ne lit que par la connexion de lecture seule');
    }
    const db = ecrire ? cx.cartes.db : lecture.cartes.db;
    const fermer = ecrire ? cx.fermer : lecture.fermer;
    try {
        const { cartesLues: cartes, documentsLus: docs, ...plan } = await planLu(db, SRC);
        console.log(`\n════ DÉNOMINATEUR : source ${SRC.SOURCE} lot ${SRC.LOT} · ${plan.cartes.length} cartes portent ${plan.entrees} entrées · ${plan.docs} documents « images » non retirés · ${plan.cles.length} clés R2 (images et vignettes) · ${plan.aRemettre} entrée(s) REMPLACÉE(S) par le lot, remises en ligne par le retrait ════`);
        for (const [k, n] of Object.entries(plan.parSet).sort((a, b) => b[1] - a[1])) console.log(`   ${k.padEnd(50)} ${n}`);
        const avant = compterEtat({ cartes });
        const apres = compterEtat({ cartes: cartesApresRetrait(cartes, docs, SRC) });          // D1 : l'état APRÈS inclut ce que le retrait remet (sinon, de fausses baisses)
        const { baisses } = comparer(avant, apres);
        const fichier = path.join(DOSSIER, `annonce-retirer-${SRC.SOURCE}-${new Date().toISOString().slice(0, 10)}.json`);
        fs.mkdirSync(path.dirname(fichier), { recursive: true });
        fs.writeFileSync(fichier, JSON.stringify(Object.fromEntries(baisses.map(b => [b.cle, b.baisse])), null, 1));
        console.log(`   annonce des baisses (${baisses.length} groupes) → ${fichier}`);
        if (!ecrire) { console.log(`\n   (À BLANC — le retrait ne part que sur demande du testeur : lot-additif.js --annonce=<ce fichier> … -- node retirer-visuels-recolte.js --source=${SRC.SOURCE} --ecrire)`); return; }
        const r = await retirerLot(db, SRC, { ecrire: true, effacerR2, supprimer: (b, cles) => r2.supprimer(b, cles), verifierBucket: b => r2.verifierBucket(b) });
        console.log(`\n   ${r.reste ? '🔴' : '✅'} entrées remises ${r.nRemises} (documents rendus à leur état d'avant ${r.nDocsRestaures}, sans état d'avant ${r.nDocsNonRestaures}) · cartes modifiées ${r.nC} · documents retirés ${r.nI} · objets R2 effacés ${r.nR} · bilans de sets nettoyés ${r.setsNettoyes.length} · relu : ${r.reste} carte(s) portent encore une entrée du lot`);
        if (r.reste) process.exitCode = 1;
    } finally { await fermer(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
