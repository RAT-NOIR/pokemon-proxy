// ============================================================
// METTRE EN FILE LES UNITÉS PIKAQIAN — l'alimentateur n'en insère AUCUNE (2026-10-11)
// ============================================================
//   node enfiler-pikaqian.js                                    (mesure seule, c'est le défaut : zéro requête, zéro écriture)
//   node enfiler-pikaqian.js --ecrire --sets=<slug>[,…]         (insère ces unités `pikaqian/<slug>`, en QUEUE de file — basse priorité)
//   node enfiler-pikaqian.js --ecrire --tous                    (insère toutes les lignes de collecte-cartes/pikaqian-sets.js, plus gros d'abord)
//   node enfiler-pikaqian.js --ecrire --reprendre --sets=…      (remet en file des unités ARRÊTÉES — source bloquée, base pleine, erreurs passagères épuisées)
//   sous lot-additif.js : node lot-additif.js --quoi="enfilage pikaqian" --collections=file_images -- node enfiler-pikaqian.js --ecrire --tous
//
// 🔑 DÉCISION DU TESTEUR (2026-10-11) : « Commence par un set test, puis enfile le reste. » Le set test (`Dynamax-Clash-Flame`, CS1bC) se collecte en LOCAL
// (collecteur-images-pikaqian.js --ecrire --sets=…) ; ce fichier refuse d'enfiler quoi que ce soit d'autre tant que son bilan (`sets.visuelsPikaqian`) n'est
// pas « concordant » — une garde écrite par ce qu'elle AUTORISE : un bilan absent, illisible ou non concordant bloque et le DIT.
// 🔴 ET LA GARDE DU COMMIT DU WORKER EST CELLE DE remettre-en-file.js (`etatDuWorker`, la même fonction, jamais une copie) : une unité enfilée pour un worker
// qui ne porte pas le collecteur, la table et la preuve sortirait `refuse-table` ou `source-inconnue`. La liste de ses règles (REGLES) contient maintenant
// collecteur-images-pikaqian.js, collecte-cartes/pikaqian.js, pikaqian-sets.js et pikaqian-sets.json, en plus de seuils-images.js (le seuil de 300 px) et
// collecteur-images.js (l'aiguillage). L'alerte « source-bloquee/pikaqian » (défi, retrait) interdit d'enfiler : l'arrêt ne se lève que par une décision.
require('dotenv').config();
const P = require('./collecte-cartes/pikaqian');
const { estPassive, motifPassif } = require('./collecte-cartes/source-passive');
const { TABLE_PIKAQIAN, uniteDeLaLigne } = require('./collecte-cartes/pikaqian-sets');

const SET_TEST = 'Dynamax-Clash-Flame';                 // CS1bC, 199 produits, une page : le set test de la décision du 2026-10-11
// un arrêt n'est pas un verdict (§17, §58) : ces résultats-là reviennent en file par une DÉCISION (`--reprendre`), jamais d'eux-mêmes
const ARRETS = new Set(['refuse-source-bloquee', 'refuse-taille-base']);

/**
 * Pur. Quelles unités insérer, lesquelles reprendre, lesquelles écarter (et pourquoi).
 * @param {{table: object[], unites: Map<string, object>, voulus: string[]|null, reprendre?: boolean, bloquee?: boolean}} o  `voulus` null = toute la table
 */
function choisirUnitesPikaqian({ table = TABLE_PIKAQIAN, unites, voulus, reprendre = false, bloquee = false, passive = estPassive(P.SOURCE) }) {
    const inserer = [], repris = [], ecartes = [];
    // ➖ 2026-10-13 : SOURCE PASSIVE — aucune unité ne s'insère ni ne se reprend, quoi qu'on demande (decision du testeur ; collecte-cartes/source-passive.js).
    // `passive` n'est surchargé que par le banc, pour garder la mécanique d'enfilage testée le jour où la source serait rouverte par une décision.
    if (passive) return { inserer, repris, ecartes: [{ slug: '*', raison: `${motifPassif(P.SOURCE)} : aucune unité ne s'enfile (les visites du testeur envoient les images à recepteur-pikaqian.js)` }] };
    if (bloquee) return { inserer, repris, ecartes: [{ slug: '*', raison: `la source est bloquée ou retirée (alerte ${P.ID_ALERTE} active) : aucune unité ne s'enfile` }] };
    const lignes = (voulus ? voulus.map(s => table.find(l => l.slug === s) ?? { slug: s, inconnue: true }) : [...table].sort((a, b) => (b.trous ?? 0) - (a.trous ?? 0)));
    for (const L of lignes) {
        if (L.inconnue) { ecartes.push({ slug: L.slug, raison: 'absent de collecte-cartes/pikaqian-sets.js' }); continue; }
        const u = uniteDeLaLigne(L), deja = unites.get(u._id);
        if (!deja) { if (reprendre) ecartes.push({ slug: L.slug, raison: 'aucune unité à reprendre' }); else inserer.push({ ...u, ajouteMotif: `pikaqian (${L.codePk}) : ${L.trous} produits joints le 2026-10-11, visuels zh-hans manquants — décision du testeur, basse priorité` }); continue; }
        if (reprendre && deja.etat === 'refuse' && (ARRETS.has(deja.resultat) || deja.resultat === 'incomplet-transitoire' || deja.resultat === 'incomplet')) { repris.push({ _id: u._id, slug: L.slug, resultatAvant: deja.resultat }); continue; }
        ecartes.push({ slug: L.slug, raison: `déjà en file (état ${deja.etat}${deja.resultat ? `, ${deja.resultat}` : ''})${reprendre ? ' et pas une unité arrêtée' : ''}` });
    }
    return { inserer, repris, ecartes };
}

/** Le set test est-il passé ? Lecture du bilan écrit par collecterSet — par ce qu'il AUTORISE : concordance === true, sinon non. */
async function setTestPasse(db) {
    const s = await db.collection('sets').findOne({ _id: SET_TEST }, { projection: { visuelsPikaqian: 1 } });
    const b = s?.visuelsPikaqian;
    if (b?.concordance === true && b.garde?.ok === true && b.prouves > 0) return { ok: true, phrase: `✅ set test ${SET_TEST} : concordant, ${b.prouves} prouvés, ${b.joints} joints (${b.verifieLe ? new Date(b.verifieLe).toISOString() : '?'})` };
    return { ok: false, phrase: `🔴 set test ${SET_TEST} : ${b ? `bilan non concordant (concordance ${b.concordance}, garde ${b.garde?.ok}, prouvés ${b.prouves})` : 'aucun bilan'} — le set test d'abord (collecteur-images-pikaqian.js --ecrire --sets=${SET_TEST}, local, sous lot-additif.js)` };
}

/**
 * @param {object} db  la base `cartes`
 * @param {{ecrire?: boolean, voulus?: string[]|null, reprendre?: boolean, worker: {bloque: boolean, phrase: string}, maintenant?: Date}} o
 */
async function enfiler(db, { ecrire = false, voulus = null, reprendre = false, worker, maintenant = new Date(), passive = estPassive(P.SOURCE) }) {
    const F = db.collection('file_images'), E = db.collection('collecte_images_etat');
    const bloquee = !!(await E.findOne({ _id: P.ID_ALERTE, active: true }));
    const existantes = await F.find({}).toArray();
    const unites = new Map(existantes.map(u => [u._id, u]));
    const C = choisirUnitesPikaqian({ unites, voulus, reprendre, bloquee, passive });
    const rapport = { ...C, ecrit: false, refus: null, worker: worker.phrase };
    if (!ecrire) return rapport;
    // ── les gardes de l'ÉCRITURE : chacune bloque et le dit ──
    if (worker.bloque) return { ...rapport, refus: 'la garde du commit du worker bloque — enfiler maintenant fabriquerait des refus' };
    const autresQueLeTest = (voulus ?? TABLE_PIKAQIAN.map(l => l.slug)).some(s => s !== SET_TEST);
    if (autresQueLeTest) { const t = await setTestPasse(db); rapport.setTest = t.phrase; if (!t.ok) return { ...rapport, refus: t.phrase }; }
    if (!C.inserer.length && !C.repris.length) return { ...rapport, refus: 'rien à écrire' };
    const dernier = existantes.reduce((m, u) => Math.max(m, u.ordre ?? 0), 0);
    let inseres = 0, remises = 0;
    for (const [i, u] of C.inserer.entries()) {
        const { ajouteMotif, ...unite } = u;
        inseres += (await F.updateOne({ _id: u._id }, { $setOnInsert: { ...unite, ordre: dernier + 1 + i, etat: 'attente', ajouteLe: maintenant, motif: ajouteMotif } }, { upsert: true })).upsertedCount ?? 0;
    }
    for (const [i, r] of C.repris.entries()) {
        remises += (await F.updateOne({ _id: r._id, etat: 'refuse' }, { $set: { etat: 'attente', ordre: dernier + C.inserer.length + 1 + i, remisEnFileLe: maintenant, remisEnFileMotif: `reprise décidée (--reprendre) après « ${r.resultatAvant} »` }, $unset: { pris: 1, erreur: 1 } })).modifiedCount ?? 0;
    }
    return { ...rapport, ecrit: true, inseres, remises };
}

module.exports = { choisirUnitesPikaqian, setTestPasse, enfiler, SET_TEST, ARRETS };

// ⚠️ EXÉCUTÉ SEULEMENT EN LIGNE DE COMMANDE.
if (require.main !== module) return;

const AUTORISES = [/^--ecrire$/, /^--tous$/, /^--reprendre$/, /^--sets=[A-Za-z0-9][A-Za-z0-9-]*(,[A-Za-z0-9][A-Za-z0-9-]*)*$/];
const args = process.argv.slice(2);
const inconnus = args.filter(a => !AUTORISES.some(r => r.test(a)));
const voulus = args.find(a => a.startsWith('--sets='))?.slice(7).split(',') ?? null;
if (inconnus.length || (args.includes('--tous') && voulus) || (args.includes('--ecrire') && !args.includes('--tous') && !voulus) || (args.includes('--reprendre') && !voulus)) {
    console.error(`❌ ${inconnus.length ? `argument inconnu : ${inconnus.join(' ')} — ` : ''}autorisés : (rien) = mesure ; --ecrire --sets=<slug>,… ; --ecrire --tous ; --ecrire --reprendre --sets=<slug>,… (jamais --tous avec --sets, jamais --ecrire sans l'un ou l'autre).`);
    process.exit(2);
}
(async () => {
    const { ouvrirConnexions } = require('./collecte-cartes/garde');
    const { etatDuWorker } = require('./remettre-en-file');
    const { cartes: cx, fermer } = await ouvrirConnexions({ production: false, buckets: [] });
    const worker = await etatDuWorker(cx);
    console.log(`\n════ LE COMMIT DU WORKER ════\n   ${worker.phrase}`);
    const r = await enfiler(cx.db, { ecrire: args.includes('--ecrire'), voulus: args.includes('--tous') ? null : voulus, reprendre: args.includes('--reprendre'), worker });
    console.log(`\n   à insérer : ${r.inserer.length} · à reprendre : ${r.repris.length} · écartées : ${r.ecartes.length}`);
    for (const u of r.inserer.slice(0, 15)) console.log(`      + ${u._id.padEnd(60)} ${u.trous} produits joints`);
    if (r.inserer.length > 15) console.log(`      … et ${r.inserer.length - 15} autres`);
    for (const u of r.repris) console.log(`      ↩ ${u._id} (${u.resultatAvant})`);
    for (const e of r.ecartes.slice(0, 15)) console.log(`      ⏸️ ${e.slug} : ${e.raison}`);
    if (r.setTest) console.log(`   ${r.setTest}`);
    if (!args.includes('--ecrire')) console.log('\n   (mesure seule — --ecrire insère, sous lot-additif.js, si le set test est passé et si la garde du commit du worker passe)');
    else if (r.refus) { console.error(`\n❌ ÉCRITURE REFUSÉE : ${r.refus}`); await fermer(); process.exit(1); }
    else console.log(`\n   ✅ insérées : ${r.inseres} · remises : ${r.remises}`);
    await fermer();
})().catch(e => { console.error('❌', e.message); process.exit(1); });
