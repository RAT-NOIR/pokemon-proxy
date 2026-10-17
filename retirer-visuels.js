// ============================================================
// RETIRER DES VISUELS NOMMÉS — un visuel qui imprime le numéro d'une AUTRE carte (feu vert du testeur, 2026-10-04 : « les 3 faux venus du
// catalogue […] feu vert pour retirer ou remplacer ces visuels »)
// ============================================================
//   node retirer-visuels.js --cles=<cleR2>[,<cleR2>…] --motif="<ce qui a été LU sur le visuel>"                 (plan : rien d'écrit)
//   node lot-additif.js --quoi="…" --collections=images,cartes,cartes_produits --annonce=<baisses.json> -- node retirer-visuels.js --cles=… --motif="…" --ecrire --attendu-substituts=N
//   node retirer-visuels.js --deja-retirees --motif="…"                                                         (plan : substituts qui visent une clé DÉJÀ retirée)
//   node lot-additif.js --quoi="…" --collections=cartes_produits -- node retirer-visuels.js --deja-retirees --motif="…" --ecrire --attendu-substituts=N
// LA GARDE S'ÉCRIT PAR CE QU'ELLE AUTORISE : seules les clés NOMMÉES, chacune portée par exactement UNE entrée de cartes.images et UN
// document `images` ; sinon rien n'est écrit. Ce que fait l'écriture, et pourquoi elle TIENT au rejeu :
//   · l'entrée de `cartes.images` est retirée (le visuel n'est plus servi, ni au site ni à la reconnaissance) ;
//   · le document `images` passe à `etat: 'retire'` (avec `retrait: { le, motif }`) — la jointure des collecteurs ne relit que
//     `etat: 'ok'` (collecteur-images-bulba.js, étape 5), et le téléchargement saute un fichier dont l'empreinte n'a pas changé : le
//     visuel ne revient ni au rejeu ni à une recollecte ; un fichier REMPLACÉ chez la source (autre empreinte) repasse, comme il doit.
//   · (VIGN-SUITE, 2026-10-17) toute ligne `cartes_produits` dont `visuelSubstitut.cleR2` est EXACTEMENT une de ces clés perd son substitut
//     (collecte-cartes/retrait-substituts.js : trace `visuelSubstitutRetrait`) — le second chemin qui sert une image. Le compte s'imprime et
//     se tient par `--attendu-substituts=N` (obligatoire avec --ecrire). `--deja-retirees` rattrape les clés déjà à l'état « retire ».
// Réversible : remettre `etat: 'ok'` et rejouer la jointure du set ; remettre `visuelSubstitutRetrait.avant` dans `visuelSubstitut`. Aucun fichier R2 n'est effacé.
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '.env') });
if (!process.env.MONGODB_CARTES_URI) dotenv.config({ path: 'C:/Users/Yung/Desktop/pokemon-proxy/.env' });
const AUTORISES = [/^--cles=.+$/, /^--motif=.{10,}$/, /^--ecrire$/, /^--deja-retirees$/, /^--attendu-substituts=\d+$/];
const inconnus = process.argv.slice(2).filter(a => !AUTORISES.some(r => r.test(a)));
if (inconnus.length) { console.error(`❌ argument inconnu : ${inconnus.join(' ')} — autorisés : --cles=a,b | --deja-retirees  --motif="… (10 caractères au moins)" [--ecrire --attendu-substituts=N]`); process.exit(2); }
const DEJA = process.argv.includes('--deja-retirees');
const CLES = process.argv.find(a => a.startsWith('--cles='))?.slice(7).split(',').filter(Boolean) ?? [];
const MOTIF = process.argv.find(a => a.startsWith('--motif='))?.slice(8);
const ECRIRE = process.argv.includes('--ecrire');
const att = process.argv.find(a => a.startsWith('--attendu-substituts='));
const ATTENDU = att ? Number(att.slice(21)) : null;
if (!MOTIF || (DEJA ? CLES.length : !CLES.length)) { console.error('❌ --motif requis, et --cles OU --deja-retirees (jamais les deux)'); process.exit(2); }
if (ECRIRE && ATTENDU === null) { console.error('❌ --ecrire exige --attendu-substituts=N (le compte des substituts regardé en simulation, 0 compris)'); process.exit(2); }
const { ouvrirConnexions } = require('./collecte-cartes/garde');
const RS = require('./collecte-cartes/retrait-substituts');

(async () => {
    const { cartes: cx, fermer } = await ouvrirConnexions({ production: false, buckets: [] });
    const C = cx.db.collection('cartes'), I = cx.db.collection('images');
    const plan = [];
    if (!DEJA) for (const cle of CLES) {
        const cartes = await C.find({ 'images.cleR2': cle }, { projection: { nomEn: 1, images: 1 } }).toArray();
        const entrees = cartes.flatMap(c => c.images.filter(i => i.cleR2 === cle).map(i => ({ carteId: c._id, nom: c.nomEn, set: i.set, numero: i.numero, source: i.source, langue: i.langue ?? null })));
        const docs = await I.find({ cleR2: cle }, { projection: { etat: 1, set: 1, numero: 1 } }).toArray();
        const ok = entrees.length === 1 && docs.length === 1;
        plan.push({ cle, entrees, docs, ok });
        console.log(`${ok ? '✓' : '❌'} ${cle} : ${entrees.length} entrée(s) cartes.images ${JSON.stringify(entrees)} · ${docs.length} document(s) images ${JSON.stringify(docs)}`);
    }
    if (plan.some(p => !p.ok)) { console.error('❌ une clé n\'est pas portée par exactement une entrée et un document : rien n\'est écrit'); await fermer(); process.exit(1); }
    // le second chemin : les substituts qui visent EXACTEMENT ces clés (ou, avec --deja-retirees, les clés déjà retirées)
    const clesVisees = DEJA ? await RS.clesDejaRetirees(cx.db) : CLES;
    if (DEJA) console.log(`${clesVisees.length} clé(s) déjà à l'état « retire » dans images`);
    const substituts = await RS.planPourCles(cx.db, clesVisees);
    for (const s of substituts) console.log(`   SUBSTITUT à détacher : ligne ${s._id} (produit ${s.idProduct}, carte ${s.carteId}, ${s.slugSet}) vise ${s.cleR2}${s.lot ? ` · lot ${s.lot}` : ''}`);
    console.log(`SUBSTITUTS : ${substituts.length} ligne(s) cartes_produits à détacher (pour --attendu-substituts)`);
    const annonce = {}; for (const p of plan) { const k = `images set:${p.entrees[0].set}`; annonce[k] = (annonce[k] ?? 0) + 1; }
    if (!DEJA) console.log(`ANNONCE des baisses (pour lot-additif --annonce) : ${JSON.stringify(annonce)}`);
    if (!ECRIRE) { console.log('(plan seul — --ecrire --attendu-substituts=N sous lot-additif.js)'); await fermer(); return; }
    if (ATTENDU !== substituts.length) { console.error(`❌ ARRÊT : ${substituts.length} substitut(s) à détacher contre ${ATTENDU} attendus — la base a bougé depuis la simulation. Rien n'est écrit.`); await fermer(); process.exit(1); }
    let ecrits = 0;
    for (const p of plan) {
        const e = p.entrees[0];
        const u1 = await C.updateOne({ _id: e.carteId, 'images.cleR2': p.cle }, { $pull: { images: { cleR2: p.cle } } });
        const u2 = await I.updateOne({ _id: p.docs[0]._id, cleR2: p.cle }, { $set: { etat: 'retire', retrait: { le: new Date(), motif: MOTIF, etatAvant: p.docs[0].etat ?? null } } });
        if (u1.modifiedCount === 1 && u2.modifiedCount === 1) ecrits++; else console.log(`   ⚠️ ${p.cle} : cartes ${u1.modifiedCount}, images ${u2.modifiedCount}`);
    }
    const detaches = await RS.detacher(cx.db, substituts, { motif: MOTIF });
    const restent = DEJA ? 0 : await C.countDocuments({ 'images.cleR2': { $in: CLES } }), retires = DEJA ? 0 : await I.countDocuments({ cleR2: { $in: CLES }, etat: 'retire' });
    const substitutsRestants = (await RS.planPourCles(cx.db, clesVisees)).length;
    console.log(`${ecrits === plan.length && !restent && retires === plan.length ? '✅' : '🔴'} retirés ${ecrits}/${plan.length} · RELU : ${restent} entrée(s) cartes.images restante(s) à ces clés · ${retires} document(s) images à l'état « retire »`);
    console.log(`${detaches === ATTENDU && !substitutsRestants ? '✅' : '🔴'} substituts détachés ${detaches}/${ATTENDU} · RELU : ${substitutsRestants} ligne(s) visent encore ces clés`);
    if (!DEJA) console.log(`SETS : ${[...new Set(plan.map(p => p.entrees[0].set))].join(',')}`);
    if (ecrits !== plan.length || restent || detaches !== ATTENDU || substitutsRestants) process.exitCode = 1;
    await fermer();
})().catch(e => { console.error(e); process.exit(1); });
