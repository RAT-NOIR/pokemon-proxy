// ============================================================
// RETIRER LE LIEN base1 -> EXP (Expansion Pack japonais)
// ============================================================
// LE DÉFAUT. `base1` est l'identifiant TCGdex du Base Set OCCIDENTAL. Il est posé sur
// l'expansion 4169, qui est l'« Expansion Pack » JAPONAIS de 1996 — deux sets différents,
// deux régions différentes. Ce n'est pas un lien imprécis comme les 69 identifiants
// partagés : c'est un lien franchement faux, et il est ISOLÉ (base1 ne pointe que là).
// L'expansion BS, le vrai Base Set occidental (exp 1523), n'a AUCUN lien aujourd'hui.
//
// ON RETIRE, ON NE REMPLACE PAS. Deux raisons :
//   1. je ne sais pas quel identifiant TCGdex japonais correspond réellement à EXP. Le
//      poser au jugé referait exactement le défaut qu'on corrige ;
//   2. le principe des sources perdues (voir scoring.js) : « inconnu » est un état
//      légitime, « faux » ne l'est pas. Retirer ramène à inconnu, ce qui est un progrès.
//
// CE QUE ÇA CHANGE POUR CES DOCUMENTS, EN ATTENDANT :
//   - `expansionsDuSetTCGdex('base1')` ne rendra plus l'expansion japonaise. Aujourd'hui,
//     une carte du Base Set occidental identifiée par TCGdex se voit proposer un périmètre
//     de recherche JAPONAIS — c'est le mécanisme même qui a produit les faux verdicts.
//   - aucune identification ne perd de périmètre : EXP reste atteignable par son nom, son
//     code et sa région, qui sont tous les trois renseignés et vérifiés.
//   - le champ `setTcgdex` passe de "base1" à absent sur ces documents. Rien d'autre n'est
//     touché : ni numero, ni slug, ni nomFr, ni idProduct.
//
// PROTOCOLE. Dry-run par défaut. L'écriture exige --confirmer ET --base=test.
// ⚠️ FAIS TA SAUVEGARDE AVANT (backup-collections.js --collections=numeros_cartes).
// Je ne lance pas ce script moi-même.
//
// USAGE :
//   node corriger-lien-base1.js --base=test                 (dry-run, aucune écriture)
//   node corriger-lien-base1.js --base=test --confirmer     (écriture)

require('dotenv').config();
const mongoose = require('mongoose');

const args = process.argv.slice(2);
const base = (args.find(a => a.startsWith('--base=')) || '').split('=')[1];
const confirmer = args.includes('--confirmer');

if (!base) {
    console.error('❌ REFUS : --base=<nom> est obligatoire. Aucune base par défaut.');
    process.exit(1);
}

const NumeroCarte = mongoose.model('NumeroCarte', new mongoose.Schema({}, { strict: false }), 'numeros_cartes');
const CodeSet = mongoose.model('CodeSet', new mongoose.Schema({}, { strict: false }), 'codes_set');

const ID_FAUX = 'base1';
const EXP_JAPONAISE = 4169;   // Expansion-Pack [EXP], région japonais

(async () => {
    await mongoose.connect(process.env.MONGODB_URI, { dbName: base });
    const reelle = mongoose.connection.db.databaseName;
    if (reelle !== base) {
        console.error(`❌ REFUS : connecté à « ${reelle} », pas à « ${base} ».`);
        process.exit(1);
    }
    console.log(`\nbase : ${reelle}${confirmer ? '' : '   (DRY-RUN, aucune écriture)'}\n`);

    // CONTRÔLE AVANT : le lien est-il bien celui qu'on croit, et bien isolé ?
    const porteurs = await NumeroCarte.distinct('idExpansion', { setTcgdex: ID_FAUX });
    console.log(`=== Contrôle avant ===`);
    for (const e of porteurs) {
        const cs = await CodeSet.findOne({ idExpansion: e }).lean();
        const n = await NumeroCarte.countDocuments({ idExpansion: e, setTcgdex: ID_FAUX });
        console.log(`   « ${ID_FAUX} » posé sur exp ${e} [${cs?.codeSet ?? '?'} / ${cs?.region ?? 'INCONNUE'}] — ${n} document(s)`);
    }
    if (porteurs.length !== 1 || Number(porteurs[0]) !== EXP_JAPONAISE) {
        console.error(`❌ REFUS : « ${ID_FAUX} » devait être posé sur la SEULE expansion ${EXP_JAPONAISE}. Situation différente de celle mesurée -> on ne touche à rien.`);
        process.exit(1);
    }

    const cible = { idExpansion: EXP_JAPONAISE, setTcgdex: ID_FAUX };
    const aTraiter = await NumeroCarte.countDocuments(cible);
    console.log(`\n=== Ce qui serait modifié ===`);
    console.log(`   ${aTraiter} document(s) : $unset du seul champ setTcgdex (valeur « ${ID_FAUX} »)`);
    console.log(`   AUCUN autre champ touché — ni numero, ni slug, ni nomFr, ni idProduct.`);
    const echantillon = await NumeroCarte.find(cible, { idProduct: 1, numero: 1, slug: 1, setTcgdex: 1 }).limit(5).lean();
    for (const d of echantillon) console.log(`     ${d.idProduct}  n°${d.numero ?? '—'}  ${d.slug ?? ''}  setTcgdex=${d.setTcgdex}`);

    if (!confirmer) {
        console.log(`\n🔎 DRY-RUN terminé. Rien n'a été écrit.`);
        console.log(`   Pour écrire : node corriger-lien-base1.js --base=${base} --confirmer`);
        await mongoose.disconnect();
        return;
    }

    const r = await NumeroCarte.updateMany(cible, { $unset: { setTcgdex: '' } });
    console.log(`\n✍️  ${r.modifiedCount ?? r.nModified ?? 0} document(s) modifié(s).`);

    // CONTRÔLE APRÈS, et idempotence : un second passage doit trouver zéro.
    const restants = await NumeroCarte.countDocuments(cible);
    const totalExp = await NumeroCarte.countDocuments({ idExpansion: EXP_JAPONAISE });
    const autresLiens = (await NumeroCarte.distinct('setTcgdex', { idExpansion: EXP_JAPONAISE })).filter(Boolean);
    console.log(`\n=== Contrôle après ===`);
    console.log(`   documents encore porteurs de « ${ID_FAUX} » : ${restants}   ${restants === 0 ? '✅' : '❌'}`);
    console.log(`   documents de l'expansion ${EXP_JAPONAISE} : ${totalExp} (inchangé)`);
    console.log(`   liens restants sur cette expansion : ${autresLiens.join(', ') || 'aucun — état « inconnu », qui est le but'}`);

    await mongoose.disconnect();
})().catch(async e => { console.error('❌ ERREUR', e.message); try { await mongoose.disconnect(); } catch (_) { } process.exit(1); });
