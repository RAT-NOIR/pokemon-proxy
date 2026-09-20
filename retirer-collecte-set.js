// ============================================================
// RETIRER LA COLLECTE D'UN SET — la SECONDE MOITIÉ d'un correctif de jointure (§23)
// ============================================================
//   node retirer-collecte-set.js --set=LED           (à blanc — le défaut)
//   node retirer-collecte-set.js --set=LED --ecrire  (sauvegarde puis retire)
//
// 🔑 UNE RÈGLE CORRIGÉE NE CORRIGE AUCUNE LIGNE DÉJÀ ÉCRITE, et `ecrireJointure` fait des upserts :
// rien n'efface une ligne devenue fausse. Quand une ligne de table passe de VÉRIFIÉE à REFUSÉE, ses
// jointures survivent et le site continue d'afficher ce que la règle vient d'interdire. Cet outil est
// la moitié manquante : il retire les lignes de `cartes_produits` du set, les `liens.idProduct` qu'elles
// ont posés, ses `restes`, et son `collecte_etat` — pour que le set redevienne NON COLLECTÉ et non
// « collecté avec des lignes qu'on a décidé de ne plus croire ».
//
// ⚠️ LE SET SE DÉSIGNE PAR SON `slugSet`, PAS PAR LE CODE : `cartes_produits.slugSet` est le set du
// PRODUIT (dette nommée le 2026-09-19 — aucune colonne ne dit quel set a ÉCRIT la ligne). Pour un set
// dont tous les produits sont de son expansion, les deux coïncident ; l'outil IMPRIME le compte avant
// d'écrire, et refuse si le set n'est pas dans la table.
//
// ⚠️ La sauvegarde s'écrit AVANT toute suppression, jamais après (§31).
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { ouvrirConnexions } = require('./collecte-cartes/garde');
const { ligne: ligneDeTable } = require('./collecte-cartes/table-sets');

(async () => {
    const code = (process.argv.find(a => a.startsWith('--set=')) || '').slice(6);
    const ecrire = process.argv.includes('--ecrire');
    if (!code) { console.error('usage : node retirer-collecte-set.js --set=CODE [--ecrire]'); process.exit(2); }
    const L = ligneDeTable(code);
    if (!L) { console.error(`🔴 ${code} : aucune ligne de table. Je ne retire rien d'un set que je ne sais pas nommer.`); process.exit(2); }

    const { cartes: cx, fermer } = await ouvrirConnexions({ production: false, buckets: [] });
    const CP = cx.db.collection('cartes_produits');
    const lignes = await CP.find({ slugSet: L.slugSet }).toArray();
    const produits = new Set(lignes.map(l => l.idProduct));
    const cartes = new Set(lignes.map(l => l.carteId));
    const restes = await cx.db.collection('restes').countDocuments({ set: code });
    const etat = await cx.db.collection('collecte_etat').findOne({ _id: code });

    console.log(`\n════ ${code} « ${L.nom || L.slugSet} » · slugSet « ${L.slugSet} » ════`);
    console.log(`   ligne de table : ${L.verifie ? '✅ VÉRIFIÉE' : `🔴 REFUSÉE — ${String(L.refus || '').slice(0, 150)}`}`);
    console.log(`   à retirer : ${lignes.length} lignes de jointure · ${produits.size} produits · ${cartes.size} cartes touchées · ${restes} restes · état ${etat ? `« ${etat.phase} »` : 'absent'}`);
    // combien de ces produits perdent leur SEULE carte — le vrai coût, pas le compte de lignes
    const ailleurs = await CP.aggregate([
        { $match: { idProduct: { $in: [...produits] }, slugSet: { $ne: L.slugSet } } },
        { $group: { _id: '$idProduct' } }
    ]).toArray();
    console.log(`   ${produits.size - ailleurs.length} produit(s) perdent leur SEULE carte (les ${ailleurs.length} autres restent fichés par un autre set)`);

    if (!ecrire) { console.log(`\n   (à blanc — relancer avec --ecrire)`); await fermer(); return; }

    const dossier = path.join(__dirname, 'collecte-cartes', 'rapports');
    fs.mkdirSync(dossier, { recursive: true });
    const fichier = path.join(dossier, `collecte-retiree-${code}-${new Date().toISOString().slice(0, 10)}.json`);
    fs.writeFileSync(fichier, JSON.stringify({ code, slugSet: L.slugSet, motif: L.refus || null, le: new Date(), lignes }, null, 1));
    console.log(`\n   💾 sauvegarde écrite AVANT toute suppression : ${fichier}`);

    const d = await CP.deleteMany({ slugSet: L.slugSet });
    const p = await cx.db.collection('cartes').updateMany({ _id: { $in: [...cartes] } }, { $pull: { 'liens.idProduct': { $in: [...produits] } } });
    const r = await cx.db.collection('restes').deleteMany({ set: code });
    const e = await cx.db.collection('collecte_etat').deleteOne({ _id: code });
    console.log(`   RETIRÉ : ${d.deletedCount} lignes · ${p.modifiedCount} cartes dépointées · ${r.deletedCount} restes · ${e.deletedCount} état`);
    await fermer();
})().catch(e => { console.error(e); process.exit(1); });
