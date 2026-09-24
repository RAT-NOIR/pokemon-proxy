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
//
// 🔴 2026-09-24 : L'ÉTAT ET LES RESTES ÉTAIENT CHERCHÉS PAR LE CODE (`_id: 'HSP'`, `set: 'HSP'`), ET ILS VIVENT SOUS LE SLUG.
// collecteur-texte.js écrit `collecte_etat._id` et `restes.set` = `L.slugSet || L.code` (sa ligne 75, « l'IDENTITÉ »). Le
// filtre ne mordait sur rien : « état absent, 0 restes », et la remise à zéro n'en était pas une — le set restait « verifie »
// avec ses titres, donc « déjà fait » à la recollecte suivante. Même identité ici, recopiée de la production.
//
// `--page-fausse` (2026-09-24, HSP) : la ligne a pointé une AUTRE page (HGSS Black Star Promos pour Beginning Set Pikachu).
// Les cartes de cette page portent le slug du set sans en DÉCLARER l'expansion : le site les affichait dans ce set. Elles
// perdent le slug — celles qui déclarent l'expansion le gardent. Et le document `sets` oublie ce que la mauvaise page lui a
// écrit ; la recollecte réécrit la page, le type et le logo se recalculent depuis l'archive (zéro requête).
const CHAMPS_DE_LA_PAGE = ['bulba', 'nomEn', 'nomJa', 'nomJaTraduit', 'dateSortieJa', 'dateSortieEn', 'totalImprime', 'cartesEnInfobox',
    'complet', 'entreesSetlist', 'denominateurs', 'type', 'typeLe', 'typePreuve', 'typeSource', 'logo', 'logoRefus', 'symbole', 'symboleRefus'];
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { ouvrirConnexions } = require('./collecte-cartes/garde');
const { ligne: ligneDeTable } = require('./collecte-cartes/table-sets');

(async () => {
    const AUTORISES = [/^--set=[^\s]+$/, /^--ecrire$/, /^--page-fausse$/];
    const inconnus = process.argv.slice(2).filter(a => !AUTORISES.some(r => r.test(a)));
    if (inconnus.length) { console.error(`❌ argument inconnu : ${inconnus.join(' ')} — autorisés : --set=CODE, --ecrire, --page-fausse`); process.exit(2); }
    const code = (process.argv.find(a => a.startsWith('--set=')) || '').slice(6);
    const ecrire = process.argv.includes('--ecrire');
    const pageFausse = process.argv.includes('--page-fausse');
    if (!code) { console.error('usage : node retirer-collecte-set.js --set=CODE [--page-fausse] [--ecrire]'); process.exit(2); }
    const L = ligneDeTable(code);
    if (!L) { console.error(`🔴 ${code} : aucune ligne de table. Je ne retire rien d'un set que je ne sais pas nommer.`); process.exit(2); }
    const slug = L.slugSet || L.code;   // l'IDENTITÉ de collecteur-texte.js : collecte_etat._id, restes.set, cartes.sets

    const { cartes: cx, fermer } = await ouvrirConnexions({ production: false, buckets: [] });
    const CP = cx.db.collection('cartes_produits');
    const lignes = await CP.find({ slugSet: L.slugSet }).toArray();
    const produits = new Set(lignes.map(l => l.idProduct));
    const cartes = new Set(lignes.map(l => l.carteId));
    const restes = await cx.db.collection('restes').countDocuments({ set: slug });
    const etat = await cx.db.collection('collecte_etat').findOne({ _id: slug });
    // les cartes qui portent le slug : celles qui DÉCLARENT l'expansion de la ligne (tirage + nom) et les autres
    const tirage = L.bulba?.tirage || 'jp', noms = [].concat(L.bulba?.expansion || []);
    const porteuses = await cx.db.collection('cartes').find({ sets: slug }, { projection: { 'bulba.titre': 1, impressions: 1 } }).toArray();
    const nonDeclarantes = porteuses.filter(c => !(c.impressions || []).some(i => i.tirage === tirage && noms.includes(i.expansion)));

    console.log(`\n════ ${code} « ${L.nom || L.slugSet} » · slugSet « ${L.slugSet} » ════`);
    console.log(`   ligne de table : ${L.verifie ? '✅ VÉRIFIÉE' : `🔴 REFUSÉE — ${String(L.refus || '').slice(0, 150)}`}`);
    console.log(`   à retirer : ${lignes.length} lignes de jointure · ${produits.size} produits · ${cartes.size} cartes touchées · ${restes} restes · état ${etat ? `« ${etat.phase} »` : 'absent'}`);
    // combien de ces produits perdent leur SEULE carte — le vrai coût, pas le compte de lignes
    const ailleurs = await CP.aggregate([
        { $match: { idProduct: { $in: [...produits] }, slugSet: { $ne: L.slugSet } } },
        { $group: { _id: '$idProduct' } }
    ]).toArray();
    console.log(`   ${produits.size - ailleurs.length} produit(s) perdent leur SEULE carte (les ${ailleurs.length} autres restent fichés par un autre set)`);
    console.log(`   cartes portant sets:${slug} : ${porteuses.length} · dont ne déclarant PAS (${tirage}, ${JSON.stringify(noms)}) : ${nonDeclarantes.length}${nonDeclarantes.length ? ` — ${nonDeclarantes.slice(0, 4).map(c => c.bulba?.titre).join(' · ')}${nonDeclarantes.length > 4 ? ' …' : ''}` : ''}`);
    if (pageFausse) console.log(`   --page-fausse : ${nonDeclarantes.length} carte(s) perdent le slug · champs de la page effacés du set : ${CHAMPS_DE_LA_PAGE.join(', ')}`);

    if (!ecrire) { console.log(`\n   (à blanc — relancer avec --ecrire)`); await fermer(); return; }

    const dossier = path.join(__dirname, 'collecte-cartes', 'rapports');
    fs.mkdirSync(dossier, { recursive: true });
    const fichier = path.join(dossier, `collecte-retiree-${code}-${new Date().toISOString().slice(0, 10)}.json`);
    const setDoc = await cx.db.collection('sets').findOne({ _id: slug });
    fs.writeFileSync(fichier, JSON.stringify({ code, slugSet: L.slugSet, motif: L.refus || null, le: new Date(), lignes, etat,
        restes: await cx.db.collection('restes').find({ set: slug }).toArray(),
        pageFausse: pageFausse ? { cartesDetachees: nonDeclarantes.map(c => ({ _id: c._id, titre: c.bulba?.titre })), set: setDoc } : null }, null, 1));
    console.log(`\n   💾 sauvegarde écrite AVANT toute suppression : ${fichier}`);

    const d = await CP.deleteMany({ slugSet: L.slugSet });
    const p = await cx.db.collection('cartes').updateMany({ _id: { $in: [...cartes] } }, { $pull: { 'liens.idProduct': { $in: [...produits] } } });
    const r = await cx.db.collection('restes').deleteMany({ set: slug });
    const e = await cx.db.collection('collecte_etat').deleteOne({ _id: slug });
    console.log(`   RETIRÉ : ${d.deletedCount} lignes · ${p.modifiedCount} cartes dépointées · ${r.deletedCount} restes · ${e.deletedCount} état`);
    if (pageFausse) {
        const c = await cx.db.collection('cartes').updateMany({ _id: { $in: nonDeclarantes.map(x => x._id) }, sets: slug }, { $pull: { sets: slug } });
        const s = await cx.db.collection('sets').updateOne({ _id: slug }, { $unset: Object.fromEntries(CHAMPS_DE_LA_PAGE.map(k => [k, ''])) });
        const reste = await cx.db.collection('cartes').countDocuments({ sets: slug });
        console.log(`   --page-fausse : ${c.modifiedCount}/${nonDeclarantes.length} cartes détachées · set ${s.modifiedCount ? 'oublié de sa page' : 'inchangé'} · RELU : ${reste} carte(s) portent encore sets:${slug} (attendu ${porteuses.length - nonDeclarantes.length}) ${reste === porteuses.length - nonDeclarantes.length ? '✅' : '🔴'}`);
        if (reste !== porteuses.length - nonDeclarantes.length) process.exitCode = 1;
    }
    await fermer();
})().catch(e => { console.error(e); process.exit(1); });
