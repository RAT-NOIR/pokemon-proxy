'use strict';
// ============================================================
// POSER-DATES-PROUVEES (chasse du 2026-11-07) — pose les dates de sets PROUVÉES par PREUVES.json, par collecte-cartes/date-prouvee.js.
//   node poser-dates-prouvees.js --preuves=<PREUVES.json> --simuler [--etat=<sets.json>]     LECTURE SEULE : par set, ce qui serait posé ou refusé
//                                                                                              (sans --etat : lit `sets` de la base cartes en lecture seule ; avec : un tableau de documents sets, hors base)
//   node poser-dates-prouvees.js --preuves=<PREUVES.json> --ecrire --attendu=<N>               SOUS lot-additif.js (LOT_ADDITIF_PID) : relit l'état vivant, refuse si le compte ≠ N
// Ligne attendue : node lot-additif.js --quoi="dates prouvées : N sets" --collections=sets ... -- node poser-dates-prouvees.js --preuves=<f> --ecrire --attendu=N
// Additif strict : updateOne({_id, dateSortie:null, dateSortieEn:null, dateSortieJa:null, dateSortieMois absent [, periodeDistribution absente]}, {$set}) ; jamais d'upsert.
// Une garde s'écrit par ce qu'elle autorise : argument inconnu = refus AVANT toute connexion.
// ============================================================
const fs = require('fs');
const AUTORISES = [/^--preuves=.+\.json$/, /^--simuler$/, /^--ecrire$/, /^--attendu=\d+$/, /^--etat=.+\.json$/];
const args = process.argv.slice(2);
const inconnus = args.filter(a => !AUTORISES.some(r => r.test(a)));
const val = nom => args.find(a => a.startsWith(`--${nom}=`))?.slice(nom.length + 3);
const simuler = args.includes('--simuler'), ecrire = args.includes('--ecrire');
const attendu = val('attendu') !== undefined ? Number(val('attendu')) : null;
if (inconnus.length || !val('preuves') || simuler === ecrire || (ecrire && (attendu === null || val('etat') !== undefined)) || (simuler && attendu !== null)) {
    console.error(`❌ ${inconnus.length ? `argument inconnu : ${inconnus.join(' ')} — ` : ''}usage : --preuves=<f.json> --simuler [--etat=<sets.json>]  |  --preuves=<f.json> --ecrire --attendu=<N> (exactement un des deux modes). Rien n'a été ouvert.`);
    process.exit(2);
}
if (ecrire && !process.env.LOT_ADDITIF_PID) { console.error('❌ --ecrire refusé hors lot-additif.js (LOT_ADDITIF_PID absent) : sauvegarde, garde et journal passent par le lot. Rien n\'a été ouvert.'); process.exit(2); }

const { planDesDates } = require('./collecte-cartes/date-prouvee');
const masquer = e => String(e && e.stack || e).replace(/mongodb(\+srv)?:\/\/\S+/g, '<uri masquée>');
const PROJECTION = { _id: 1, region: 1, tirage: 1, dateSortie: 1, dateSortieEn: 1, dateSortieJa: 1, dateSortieMois: 1, periodeDistribution: 1 };

function lirePreuves() {
    const p = JSON.parse(fs.readFileSync(val('preuves'), 'utf8'));
    if (!Array.isArray(p) || !p.length) throw new Error('fichier de preuves vide ou non-tableau : un zéro n\'est pas une instruction');
    return p;
}
function imprimer(plan) {
    console.log(`entrées du fichier : ${plan.entrees} · à poser ${plan.posees.length} · refusées ${plan.refus.length}`);
    for (const d of plan.posees) console.log(`   POSÉ   ${d.slugSet} → ${d.champs.join(',')} = ${JSON.stringify(d.set[d.champs[0]])} · ${d.set.dateSortiePreuves.filter(x => !x.note).map(x => x.code).join('+')}${d.set.dateSortiePreuves.some(x => x.note) ? ` · notes : ${d.set.dateSortiePreuves.filter(x => x.note).map(x => `${x.code} « ${x.note} »`).join(' ; ')}` : ''}`);
    for (const r of plan.refus) console.log(`   REFUS  ${r.slugSet} : ${r.refus}${r.detail ? ` (${r.detail})` : ''}`);
}
async function lireEtat(cx, preuves) {
    const { lireMongo } = require('./collecte-cartes/lecture-sure');
    const ids = [...new Set(preuves.map(p => p.slugSet))];
    const docs = await lireMongo(cx.cartes.db.collection('sets'), { _id: { $in: ids } }, { nom: 'sets (preuves)', videAutorise: 'un slugSet du fichier peut ne pas exister : refus set-introuvable', projection: PROJECTION });
    console.log(`état vivant relu : ${docs.length} sets sur ${ids.length} slugSet du fichier`);
    return new Map(docs.map(d => [d._id, d]));
}

async function principal() {
    const preuves = lirePreuves();
    if (simuler) {
        let etat;
        if (val('etat')) { const t = JSON.parse(fs.readFileSync(val('etat'), 'utf8')); etat = new Map(t.map(d => [d._id, d])); }
        else {
            const { ouvrirConnexions } = require('./collecte-cartes/garde');
            const cx = await ouvrirConnexions({ production: false, buckets: [], lectureSeule: true });
            try { etat = await lireEtat(cx, preuves); } finally { await cx.fermer(); }
        }
        imprimer(planDesDates(preuves, etat));
        return;
    }
    const { ouvrirConnexions } = require('./collecte-cartes/garde');
    const cx = await ouvrirConnexions({ production: false, buckets: [], lectureSeule: false });
    try {
        const plan = planDesDates(preuves, await lireEtat(cx, preuves));
        imprimer(plan);
        if (plan.posees.length !== attendu) { console.error(`❌ REFUS (code 1, rien d'écrit) : ${plan.posees.length} date(s) à poser ≠ attendu ${attendu}`); process.exitCode = 1; return; }
        const col = cx.cartes.db.collection('sets');
        // region/tirage de l'état VIVANT relus juste avant d'écrire, comparés à ceux du plan (le champ de date dépend de la région)
        const { ecartsRegionTirage, filtreEcriture, SOURCE_LOT } = require('./collecte-cartes/date-prouvee');
        const ecarts = ecartsRegionTirage(plan, await lireEtat(cx, plan.posees.map(d => ({ slugSet: d.slugSet }))));
        if (ecarts.length) { console.error(`❌ REFUS (code 1, rien d'écrit) : ${ecarts.length} écart(s) region/tirage\n   ${ecarts.join('\n   ')}`); process.exitCode = 1; return; }
        let ok = 0;
        for (const d of plan.posees) {
            const filtre = filtreEcriture(d.set, d);
            const r = await col.updateOne(filtre, { $set: d.set });
            ok += r.modifiedCount;
        }
        const relus = await col.countDocuments({ _id: { $in: plan.posees.map(d => d.slugSet) }, dateSortieSource: SOURCE_LOT });
        console.log(`modifiés ${ok} (attendu ${attendu}) · relus avec la source du lot : ${relus}`);
        if (ok !== attendu || relus !== attendu) { console.error('❌ ÉCART entre modifiedCount, attendu et relecture — à ouvrir'); process.exitCode = 1; return; }
        console.log('ÉCRIT : dates posées, relues ✅');
    } finally { await cx.fermer(); }
}
principal().catch(e => { console.error(masquer(e)); process.exit(1); });
