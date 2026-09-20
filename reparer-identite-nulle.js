// ============================================================
// RÉPARER UN SET COLLECTÉ SOUS UNE IDENTITÉ NULLE — one-shot daté, 2026-09-20
// ============================================================
//   node reparer-identite-nulle.js            (à blanc)
//   node reparer-identite-nulle.js --ecrire   (sauvegarde puis répare)
//
// 🔴 L'OCCURRENCE. `collecteur-texte.js` nommait le set par `L.slugSet`, qui est FACULTATIF : l'expansion
// Cardmarket `AQ` (Aquapolis, 177 produits) n'en porte sur aucune de ses lignes. Le set a donc été
// collecté correctement — 177 produits joints, 150 cartes — mais écrit sous `_id: null` dans `sets` et
// dans `collecte_etat`, avec ses restes sous `set: null`. Le lancement suivant (mC) s'est arrêté sur
// « un collecteur tient déjà null » : deux sets différents partageaient une identité vide.
//
// Le code est corrigé (l'identité est `slugSet || code`). Reste la SECONDE MOITIÉ (§23) : les documents
// déjà écrits ne se renomment pas tout seuls. Cet outil les déplace sous leur vrai code.
// ⚠️ Rien n'est supprimé avant que la sauvegarde ne soit écrite sur disque.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { ouvrirConnexions } = require('./collecte-cartes/garde');

(async () => {
    const ecrire = process.argv.includes('--ecrire');
    const { cartes: cx, fermer } = await ouvrirConnexions({ production: false, buckets: [] });
    const set = await cx.db.collection('sets').findOne({ _id: null });
    const etat = await cx.db.collection('collecte_etat').findOne({ _id: null });
    const restes = await cx.db.collection('restes').find({ set: null }).toArray();

    if (!set && !etat && !restes.length) { console.log('✅ aucun document d\'identité nulle — rien à réparer.'); await fermer(); return; }
    const code = set?.code || etat?.code || null;
    console.log(`\n════ IDENTITÉ NULLE ════`);
    console.log(`   sets._id null        : ${set ? `oui — code « ${set.code} », expansion « ${set.bulba?.expansion} », idExpansion ${JSON.stringify(set.idExpansion)}` : 'non'}`);
    console.log(`   collecte_etat._id null : ${etat ? `oui — phase « ${etat.phase} », ${etat.joints} joints, restes ${JSON.stringify(etat.restes)}` : 'non'}`);
    console.log(`   restes set null      : ${restes.length}`);
    console.log(`   → destination : « ${code} »`);
    if (!code) { console.error('🔴 ARRÊT : aucun code lisible sur ces documents. Je ne devine pas une identité.'); await fermer(); process.exit(2); }
    const dejaLa = await cx.db.collection('sets').findOne({ _id: code });
    if (dejaLa) { console.error(`🔴 ARRÊT : « ${code} » existe déjà dans sets. Deux documents pour un set, ça se regarde à la main.`); await fermer(); process.exit(2); }
    if (!ecrire) { console.log(`\n   (à blanc — relancer avec --ecrire)`); await fermer(); return; }

    const dossier = path.join(__dirname, 'collecte-cartes', 'rapports');
    fs.mkdirSync(dossier, { recursive: true });
    const fichier = path.join(dossier, `identite-nulle-${code}-${new Date().toISOString().slice(0, 10)}.json`);
    fs.writeFileSync(fichier, JSON.stringify({ code, set, etat, restes, le: new Date() }, null, 1));
    console.log(`\n   💾 sauvegarde écrite AVANT toute suppression : ${fichier}`);

    if (set) { await cx.db.collection('sets').insertOne({ ...set, _id: code }); await cx.db.collection('sets').deleteOne({ _id: null }); }
    if (etat) { const { verrou, ...reste } = etat; await cx.db.collection('collecte_etat').insertOne({ ...reste, _id: code }); await cx.db.collection('collecte_etat').deleteOne({ _id: null }); }
    const r = await cx.db.collection('restes').updateMany({ set: null }, { $set: { set: code } });
    // les cartes rattachées au set null, s'il y en a
    const c = await cx.db.collection('cartes').updateMany({ sets: null }, { $set: { 'sets.$': code } });
    console.log(`   RÉPARÉ : sets ${set ? 1 : 0} · collecte_etat ${etat ? 1 : 0} (verrou non recopié) · restes ${r.modifiedCount} · cartes ${c.modifiedCount}`);
    await fermer();
})().catch(e => { console.error(e); process.exit(1); });
