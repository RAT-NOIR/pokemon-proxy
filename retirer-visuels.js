// ============================================================
// RETIRER DES VISUELS NOMMÉS — un visuel qui imprime le numéro d'une AUTRE carte (feu vert du testeur, 2026-10-04 : « les 3 faux venus du
// catalogue […] feu vert pour retirer ou remplacer ces visuels »)
// ============================================================
//   node retirer-visuels.js --cles=<cleR2>[,<cleR2>…] --motif="<ce qui a été LU sur le visuel>"                 (plan : rien d'écrit)
//   node lot-additif.js --quoi="…" --collections=images --annonce=<baisses.json> -- node retirer-visuels.js --cles=… --motif="…" --ecrire
// LA GARDE S'ÉCRIT PAR CE QU'ELLE AUTORISE : seules les clés NOMMÉES, chacune portée par exactement UNE entrée de cartes.images et UN
// document `images` ; sinon rien n'est écrit. Ce que fait l'écriture, et pourquoi elle TIENT au rejeu :
//   · l'entrée de `cartes.images` est retirée (le visuel n'est plus servi, ni au site ni à la reconnaissance) ;
//   · le document `images` passe à `etat: 'retire'` (avec `retrait: { le, motif }`) — la jointure des collecteurs ne relit que
//     `etat: 'ok'` (collecteur-images-bulba.js, étape 5), et le téléchargement saute un fichier dont l'empreinte n'a pas changé : le
//     visuel ne revient ni au rejeu ni à une recollecte ; un fichier REMPLACÉ chez la source (autre empreinte) repasse, comme il doit.
// Réversible : remettre `etat: 'ok'` et rejouer la jointure du set. Aucun fichier R2 n'est effacé.
require('dotenv').config();
const AUTORISES = [/^--cles=.+$/, /^--motif=.{10,}$/, /^--ecrire$/];
const inconnus = process.argv.slice(2).filter(a => !AUTORISES.some(r => r.test(a)));
if (inconnus.length) { console.error(`❌ argument inconnu : ${inconnus.join(' ')} — autorisés : --cles=a,b --motif="… (10 caractères au moins)" [--ecrire]`); process.exit(2); }
const CLES = process.argv.find(a => a.startsWith('--cles='))?.slice(7).split(',').filter(Boolean) ?? [];
const MOTIF = process.argv.find(a => a.startsWith('--motif='))?.slice(8);
if (!CLES.length || !MOTIF) { console.error('❌ --cles et --motif requis'); process.exit(2); }
const { ouvrirConnexions } = require('./collecte-cartes/garde');

(async () => {
    const { cartes: cx, fermer } = await ouvrirConnexions({ production: false, buckets: [] });
    const C = cx.db.collection('cartes'), I = cx.db.collection('images');
    const plan = [];
    for (const cle of CLES) {
        const cartes = await C.find({ 'images.cleR2': cle }, { projection: { nomEn: 1, images: 1 } }).toArray();
        const entrees = cartes.flatMap(c => c.images.filter(i => i.cleR2 === cle).map(i => ({ carteId: c._id, nom: c.nomEn, set: i.set, numero: i.numero, source: i.source, langue: i.langue ?? null })));
        const docs = await I.find({ cleR2: cle }, { projection: { etat: 1, set: 1, numero: 1 } }).toArray();
        const ok = entrees.length === 1 && docs.length === 1;
        plan.push({ cle, entrees, docs, ok });
        console.log(`${ok ? '✓' : '❌'} ${cle} : ${entrees.length} entrée(s) cartes.images ${JSON.stringify(entrees)} · ${docs.length} document(s) images ${JSON.stringify(docs)}`);
    }
    if (plan.some(p => !p.ok)) { console.error('❌ une clé n\'est pas portée par exactement une entrée et un document : rien n\'est écrit'); await fermer(); process.exit(1); }
    const annonce = {}; for (const p of plan) { const k = `images set:${p.entrees[0].set}`; annonce[k] = (annonce[k] ?? 0) + 1; }
    console.log(`ANNONCE des baisses (pour lot-additif --annonce) : ${JSON.stringify(annonce)}`);
    if (!process.argv.includes('--ecrire')) { console.log('(plan seul — --ecrire sous lot-additif.js)'); await fermer(); return; }
    let ecrits = 0;
    for (const p of plan) {
        const e = p.entrees[0];
        const u1 = await C.updateOne({ _id: e.carteId, 'images.cleR2': p.cle }, { $pull: { images: { cleR2: p.cle } } });
        const u2 = await I.updateOne({ _id: p.docs[0]._id, cleR2: p.cle }, { $set: { etat: 'retire', retrait: { le: new Date(), motif: MOTIF, etatAvant: p.docs[0].etat ?? null } } });
        if (u1.modifiedCount === 1 && u2.modifiedCount === 1) ecrits++; else console.log(`   ⚠️ ${p.cle} : cartes ${u1.modifiedCount}, images ${u2.modifiedCount}`);
    }
    const restent = await C.countDocuments({ 'images.cleR2': { $in: CLES } }), retires = await I.countDocuments({ cleR2: { $in: CLES }, etat: 'retire' });
    console.log(`${ecrits === plan.length && !restent && retires === plan.length ? '✅' : '🔴'} retirés ${ecrits}/${plan.length} · RELU : ${restent} entrée(s) cartes.images restante(s) à ces clés · ${retires} document(s) images à l'état « retire »`);
    console.log(`SETS : ${[...new Set(plan.map(p => p.entrees[0].set))].join(',')}`);
    if (ecrits !== plan.length || restent) process.exitCode = 1;
    await fermer();
})().catch(e => { console.error(e); process.exit(1); });
