// ============================================================
// `numeroFiche` SUR LES LIGNES EXISTANTES — le rejeu de la jointure, sans rien réécrire d'autre
// ============================================================
//   node poser-numero-fiche.js [--sets=A,B]            (mesure seule)
//   node poser-numero-fiche.js [--sets=A,B] --ecrire   (par lot-additif.js)
//
// 🔑 POURQUOI (2026-09-25) : la jointure sait QUELLE impression elle a retenue pour un produit ; le site, lui, la devinait en lisant
// le slug, et ne savait lire ni les affixes de demi-deck (« 20S », « R30 » : 409 produits de kits joints, 0 servi) ni un slug que
// le titre contredit (174). `joindre()` écrit désormais `numeroFiche` sur chaque ligne (jointure.js) ; cet outil le pose sur les
// lignes écrites AVANT, en rejouant `joindre()` — la fonction de production elle-même, jamais une copie de sa règle (§21 bis) —
// sur les cartes et produits en base, et les impressions virtuelles de Setlist relues depuis la page de set archivée (R2).
// ⚠️ IL NE POSE QUE CE CHAMP, et seulement sur une ligne dont (carte, produit) est IDENTIQUE dans le rejeu : une jointure qui
// diffère aujourd'hui n'est ni corrigée ni supprimée ici, elle est COMPTÉE. `$exists: false` : un champ déjà posé ne bouge pas.
require('dotenv').config();
const { ouvrirConnexions } = require('./collecte-cartes/garde');
const { modeles } = require('./collecte-cartes/schemas');
const r2 = require('./collecte-cartes/r2');
const { TABLE } = require('./collecte-cartes/table-sets');
const { entreesDeLaSetlist } = require('./collecte-cartes/wikitext');
const { joindre, produitsDeLExpansion, impressionsDepuisSetlist, cleNumero } = require('./collecte-cartes/jointure');

(async () => {
    const ecrire = process.argv.includes('--ecrire');
    const filtre = (process.argv.find(a => a.startsWith('--sets=')) || '').slice(7).split(',').filter(Boolean);
    const { cartes: cx, prod, fermer } = await ouvrirConnexions({ production: true, buckets: [] });
    const M = modeles(cx);
    await r2.verifierBucket(process.env.R2_BUCKET_BRUT);
    const lignesTable = TABLE.filter(l => !filtre.length || filtre.includes(l.code));
    const bilan = { sets: 0, sansEtat: 0, lignesRejouees: 0, identiques: 0, aPoser: 0, poses: 0, differentes: 0, sansNumero: 0 };
    const vus = new Set();
    for (const L of lignesTable) {
        const slug = L.slugSet || L.code;
        if (vus.has(`${slug}|${L.exp}`)) continue; vus.add(`${slug}|${L.exp}`);
        const TIRAGE = L.bulba.tirage || 'jp';
        let cartesDuSet;
        if (L.bulba.sansPage) cartesDuSet = await M.Carte.find({ impressions: { $elemMatch: { tirage: TIRAGE, expansion: { $in: [].concat(L.bulba.expansion) } } } }).lean();
        else cartesDuSet = await M.Carte.find({ sets: slug }).lean();
        if (!cartesDuSet.length) { bilan.sansEtat++; continue; }
        if (L.bulba.numerosDepuisSetlist) {
            const set = await cx.db.collection('sets').findOne({ _id: slug }, { projection: { 'bulba.cleR2': 1 } });
            const etatPages = (await M.Etat.findById(slug).select('pages').lean())?.pages || [];
            if (!set?.bulba?.cleR2) { bilan.sansEtat++; continue; }
            const texte = await r2.lireTexte(process.env.R2_BUCKET_BRUT, set.bulba.cleR2);
            const V = impressionsDepuisSetlist(entreesDeLaSetlist(texte, L.bulba).entrees, etatPages, { tirage: TIRAGE, expansionBulba: L.bulba.expansion, prefixesParJeton: L.bulba.prefixesParJeton || null, prefixesParSection: L.bulba.prefixesParSection || null });
            const cleImp = i => `${i.tirage}|${i.expansion}|${cleNumero(String(i.numero ?? ''))}`;
            cartesDuSet = cartesDuSet.map(c => { const v = V.parCarte.get(c._id); if (!v) return c; const deja = new Set((c.impressions || []).map(cleImp)); return { ...c, impressions: [...(c.impressions || []), ...v.filter(i => !deja.has(cleImp(i)))] }; });
        }
        const produits = await produitsDeLExpansion(prod, L.exp);
        const J = joindre(cartesDuSet, produits, { idExpansion: L.exp, expansionBulba: L.bulba.expansion, deck: L.bulba.deck || null, suffixesParDeck: L.bulba.suffixesParDeck || null, prefixesParDeck: L.bulba.prefixesParDeck || null, prefixesParJeton: L.bulba.prefixesParJeton || null, prefixesParSection: L.bulba.prefixesParSection || null, tirage: TIRAGE, slugSet: L.slugSet || null });
        bilan.sets++; bilan.lignesRejouees += J.lignes.length;
        const existantes = new Set((await cx.db.collection('cartes_produits').find({ _id: { $in: J.lignes.map(l => l._id) } }, { projection: { _id: 1 } }).toArray()).map(x => x._id));
        const ops = [];
        for (const l of J.lignes) {
            if (!existantes.has(l._id)) { bilan.differentes++; continue; }
            bilan.identiques++;
            if (l.numeroFiche == null) { bilan.sansNumero++; continue; }
            bilan.aPoser++;
            ops.push({ updateOne: { filter: { _id: l._id, numeroFiche: { $exists: false } }, update: { $set: { numeroFiche: l.numeroFiche } } } });
        }
        if (ecrire && ops.length) bilan.poses += (await cx.db.collection('cartes_produits').bulkWrite(ops, { ordered: false })).modifiedCount;
    }
    console.log(`\n════ ${lignesTable.length} lignes de table · ${bilan.sets} sets rejoués (${bilan.sansEtat} sans cartes ou sans page archivée) ════`);
    console.log(`   lignes rejouées ${bilan.lignesRejouees} · identiques en base ${bilan.identiques} · absentes de la base (jointure différente aujourd'hui, NON touchées) ${bilan.differentes}`);
    console.log(`   numeroFiche : à poser ${bilan.aPoser} · jointure sans numéro (nom, attaques) ${bilan.sansNumero}${ecrire ? ` · POSÉS ${bilan.poses}` : ' — (mesure seule, relancer avec --ecrire)'}`);
    const relus = await cx.db.collection('cartes_produits').countDocuments({ numeroFiche: { $exists: true } });
    console.log(`   RELU : ${relus} lignes portent numeroFiche sur ${await cx.db.collection('cartes_produits').estimatedDocumentCount()}`);
    await fermer();
})().catch(e => { console.error(e); process.exit(1); });
