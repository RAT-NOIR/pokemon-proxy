// ============================================================
// METTRE EN FILE LE REMPLACEMENT TCGdex DE LA STRATE À RISQUE (2026-09-23)
// ============================================================
//   node enfiler-tcgdex.js            (mesure, zéro requête : le cache `tcgdex_sets` suffit)
//   node enfiler-tcgdex.js --ecrire   (insère les unités `tcgdex/<code>` — SEULEMENT si la garde du commit passe)
//
// LA STRATE À RISQUE N'EST PAS UNE LISTE ÉCRITE À LA MAIN : ce sont les sets non jp qui portent au moins un visuel
// `langue: 'ja'` (le scan du jumeau, prouvé). Tirés au hasard hors formats japonais, 9 sur 36 de leurs autres visuels
// étaient japonais aussi (§54) : c'est le SET qu'on remplace, pas le fichier.
// L'appariement set → set TCGdex s'imprime paire par paire (§31 : une clé d'appariement se LIT avant de servir).
// La garde est celle de remettre-en-file.js (`etatDuWorker`, la même fonction, jamais une copie) : un worker qui ne porte
// pas le collecteur TCGdex sortirait chaque unité `refuse` pour toujours.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { ouvrirConnexions } = require('./collecte-cartes/garde');
const { lireMongo } = require('./collecte-cartes/lecture-sure');
const { modeles } = require('./collecte-cartes/schemas');
const { TABLE, TABLE_AUTO, TABLE_SANS_PAGE } = require('./collecte-cartes/table-sets');
const { fabriquerAppariement, setDeLaLigne } = require('./collecte-cartes/tcgdex-cache');
const { planifier } = require('./collecteur-images-tcgdex');
const { etatDuWorker } = require('./remettre-en-file');

(async () => {
    const ecrire = process.argv.includes('--ecrire');
    const { cartes: cx, fermer } = await ouvrirConnexions({ production: false, buckets: [] });
    const M = modeles(cx);
    const W = await etatDuWorker(cx);
    console.log(`\n════ LE COMMIT DU WORKER ════\n   ${W.phrase}`);

    const regionDe = new Map((await lireMongo(cx.db.collection('sets'), {}, { nom: 'sets', projection: { region: 1 } })).map(s => [s._id, s.region]));
    const ja = await cx.db.collection('cartes').aggregate([{ $unwind: '$images' }, { $match: { 'images.langue': 'ja' } },
        { $project: { _id: 0, carteId: '$_id', set: '$images.set', numero: '$images.numero' } }]).toArray();
    const strate = new Map();
    for (const e of ja) if (regionDe.get(e.set) !== 'jp') (strate.get(e.set) || strate.set(e.set, []).get(e.set)).push(e);
    console.log(`\n════ LA STRATE À RISQUE : ${strate.size} sets non jp, ${[...strate.values()].reduce((s, l) => s + l.length, 0)} visuels « ja » (sur ${ja.length} entrées ja lues) ════`);

    const liste = (await cx.db.collection('tcgdex_sets').findOne({ _id: 'en/__liste__' }))?.sets || [];
    if (!liste.length) throw new Error('liste TCGdex absente du cache — construire-illustrateurs.js --lire-tcgdex la lit');
    const apparier = fabriquerAppariement(liste);
    const parSlug = new Map(); for (const L of [...TABLE, ...TABLE_AUTO, ...TABLE_SANS_PAGE]) if (L.slugSet && !parSlug.has(L.slugSet)) parSlug.set(L.slugSet, L);
    const unites = [], refus = [], sansScan = [];
    let couverts = 0, total = 0, aTelecharger = 0;
    for (const [slug, entrees] of [...strate].sort((a, b) => b[1].length - a[1].length)) {
        const L = parSlug.get(slug);
        total += entrees.length;
        if (!L) { refus.push(`${slug} : aucune ligne de table`); sansScan.push(...entrees.map(e => ({ ...e, motif: 'set sans ligne' }))); continue; }
        const d = setDeLaLigne(L, apparier);
        if (!d.set) { refus.push(`${L.code} ${slug} : ${d.motif}`); sansScan.push(...entrees.map(e => ({ ...e, motif: d.motif }))); continue; }
        const P = await planifier(M, cx.db, null, L, d.set);
        if (!P) { refus.push(`${L.code} → ${d.set.id} : cartes TCGdex absentes du cache`); sansScan.push(...entrees.map(e => ({ ...e, motif: 'cartes TCGdex non lues' }))); continue; }
        const servis = new Set(P.plan.map(p => `${p.carte._id}|${p.numero}`));
        const pasServis = entrees.filter(e => !servis.has(`${e.carteId}|${e.numero}`));
        couverts += entrees.length - pasServis.length; aTelecharger += P.plan.length;
        const motifDe = new Map(P.restes.map(r => [`${r.carteId}|${r.numero}`, r.motif]));
        sansScan.push(...pasServis.map(e => ({ ...e, code: L.code, motif: motifDe.get(`${e.carteId}|${e.numero}`) || 'hors du plan' })));
        console.log(`   ${L.code.padEnd(8)} ${slug.padEnd(28)} → ${d.set.id.padEnd(9)} « ${d.set.name} » · ja couverts ${String(entrees.length - pasServis.length).padStart(4)}/${String(entrees.length).padStart(4)} · scans à prendre ${P.plan.length}/${P.impressions}`);
        unites.push({ code: L.code, slug, tcgdexSet: d.set.id, tcgdexNom: d.set.name, ja: entrees.length, plan: P.plan.length });
    }
    console.log(`\n   ✅ visuels japonais qui recevront le scan anglais : ${couverts} / ${total} · scans à télécharger (strate entière) : ${aTelecharger} ≈ ${Math.round(aTelecharger * 2 / 3600 * 10) / 10} h à 2 s`);
    const parMotif = {}; for (const s of sansScan) { const k = `${s.set} — ${s.motif}`; parMotif[k] = (parMotif[k] || 0) + 1; }
    console.log(`   🕳️ restent SANS scan anglais : ${sansScan.length}`);
    for (const [k, n] of Object.entries(parMotif).sort((a, b) => b[1] - a[1])) console.log(`      ${String(n).padStart(4)} · ${k}`);
    for (const r of refus) console.log(`   ⛔ ${r}`);
    fs.mkdirSync(path.join(__dirname, 'collecte-cartes', 'rapports'), { recursive: true });
    const fichier = path.join(__dirname, 'collecte-cartes', 'rapports', 'restes-scan-anglais.json');   // rapports : jamais versionnés
    fs.writeFileSync(fichier, JSON.stringify({ le: new Date(), definition: 'visuels langue ja sous un set non jp que TCGdex ne remplace pas', n: sansScan.length, restes: sansScan }, null, 1));
    console.log(`   (liste complète : ${path.basename(fichier)})`);

    if (!ecrire) { console.log('\n   (mesure seule — --ecrire insère les unités si la garde passe)'); await fermer(); return; }
    if (W.bloque) { console.error('\n❌ ÉCRITURE REFUSÉE : la garde du commit bloque — enfiler maintenant fabriquerait des refus.'); await fermer(); process.exit(1); }
    const F = cx.db.collection('file_images');
    const dernier = (await F.find({}).sort({ ordre: -1 }).limit(1).toArray())[0]?.ordre ?? 0;
    let inseres = 0;
    for (const [i, u] of unites.entries()) {
        const r = await F.updateOne({ _id: `tcgdex/${u.code}` }, { $setOnInsert: { code: u.code, source: 'tcgdex', tcgdexSet: u.tcgdexSet, tcgdexNom: u.tcgdexNom, ordre: dernier + 1 + i, etat: 'attente', ajouteLe: new Date(), motif: `strate à risque : ${u.ja} scans japonais sous ce set, remplacés par le scan anglais de TCGdex` } }, { upsert: true });
        inseres += r.upsertedCount;
    }
    const enFile = await F.countDocuments({ source: 'tcgdex', etat: 'attente' });
    console.log(`\n   ✅ insérées : ${inseres} sur ${unites.length} · unités tcgdex en attente, RELU : ${enFile}`);
    await fermer();
})().catch(e => { console.error('❌', e.message); process.exit(1); });
