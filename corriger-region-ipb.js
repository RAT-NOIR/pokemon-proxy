// ============================================================
// ATTESTER LA RÉGION DE L'EXPANSION 5059 — Intro Pack (Bulbasaur)
// ============================================================
// LE DÉFAUT, MESURÉ SUR UN CAS RÉEL. Le Raichu du testeur est
// Intro-Pack-Bulbasaur/Raichu-IPB3, produit 654243, expansion 5059. Dans le périmètre
// fermé des sets vintage, il obtient un score de 0 pendant que huit concurrents sont à 45 :
//     654243  exp 5059 IPB   score 0   detail.region = "0 (région indéterminée)"
// Les huit autres touchent +45 pour la région japonaise. La région INCONNUE de l'IPB lui
// coûte donc EXACTEMENT les 45 points qui l'éliminent. La bonne carte est dans le
// périmètre, et elle perd contre un critère qu'on a ajouté pour l'aider.
//
// POURQUOI codes_set ET PAS LA TABLE CLOSE. sets-vintage-japonais.js porte déjà
// `regionSource` pour cette ligne — mais le scoring ne lit pas cette table : il lit
// `codes_set.region` (voir lireRegions dans index.js). Tant que ce document n'est pas
// corrigé, l'admission dans la table close reste décorative pour le classement.
//
// LES ATTESTATIONS, ET LEUR STATUT. La dérivation automatique ne peut rien conclure : le
// nom de l'expansion n'existe pas au catalogue international, d'où
// `regionSource: 'nom-hors-catalogue'`. Quatre sources concordantes, rapportées par le
// testeur — je n'ai pu en vérifier AUCUNE moi-même, chartmon m'ayant répondu HTTP 403 :
//   1. chartmon.com/pokemon/jp/sets — page qui ne liste QUE des sets japonais
//   2. TCGplayer — classe « Intro Pack (Bulbasaur) » sous la gamme Pokemon Japan
//   3. TCG Collector — le référence comme set japonais
//   4. Coleka — 41 cartes, 1999
// La quatrième est la seule que je puisse recouper : notre base compte EXACTEMENT
// 41 produits sur l'expansion 5059. C'est une concordance indépendante, pas une preuve
// de région, et c'est écrit comme tel.
// D'où `regionSource: 'sources-multiples-concordantes-rapportees-par-testeur'` : la valeur
// dit d'où elle vient, pour qu'un lecteur dans six mois sache ce qu'elle vaut.
//
// PROTOCOLE : dry-run par défaut, --base obligatoire, --confirmer pour écrire, contrôle
// avant et après, refus si la situation diffère de celle mesurée.
//
// USAGE :
//   node corriger-region-ipb.js --base=test
//   node corriger-region-ipb.js --base=test --confirmer

require('dotenv').config();
const mongoose = require('mongoose');

const args = process.argv.slice(2);
const base = (args.find(a => a.startsWith('--base=')) || '').split('=')[1];
const confirmer = args.includes('--confirmer');
if (!base) { console.error('❌ REFUS : --base=<nom> est obligatoire.'); process.exit(1); }

const CodeSet = mongoose.model('CodeSet', new mongoose.Schema({}, { strict: false }), 'codes_set');
const NumeroCarte = mongoose.model('NumeroCarte', new mongoose.Schema({}, { strict: false }), 'numeros_cartes');

const EXP = 5059;
const CODE_ATTENDU = 'IPB';
const PRODUITS_ATTENDUS = 41;
const SOURCE = 'sources-multiples-concordantes-rapportees-par-testeur';

(async () => {
    await mongoose.connect(process.env.MONGODB_URI, { dbName: base });
    const reelle = mongoose.connection.db.databaseName;
    if (reelle !== base) { console.error(`❌ REFUS : connecté à « ${reelle} ».`); process.exit(1); }
    console.log(`\nbase : ${reelle}${confirmer ? '' : '   (DRY-RUN, aucune écriture)'}\n`);

    const doc = await CodeSet.findOne({ idExpansion: EXP }).lean();
    if (!doc) { console.error(`❌ REFUS : aucune ligne codes_set pour l'expansion ${EXP}.`); process.exit(1); }

    console.log('=== Contrôle avant ===');
    console.log(`   exp ${EXP} · code=${doc.codeSet} · region=${doc.region ?? 'INCONNUE'} · regionSource=${doc.regionSource ?? '—'}`);
    if (doc.codeSet !== CODE_ATTENDU) {
        console.error(`❌ REFUS : code « ${doc.codeSet} », attendu « ${CODE_ATTENDU} ».`); process.exit(1);
    }
    if (doc.region) {
        console.error(`❌ REFUS : la région vaut déjà « ${doc.region} ». On ne réécrit pas une région existante.`); process.exit(1);
    }
    // La seule attestation recoupable de mon côté : le compte de cartes annoncé par Coleka.
    const nb = await NumeroCarte.countDocuments({ idExpansion: EXP });
    console.log(`   documents numeros_cartes sur cette expansion : ${nb}`);
    console.log(`   concordance avec l'attestation Coleka (41 cartes, 1999) : ${nb === PRODUITS_ATTENDUS ? '✅ exacte' : `⚠️ ${nb} contre ${PRODUITS_ATTENDUS} annoncés`}`);

    console.log(`\n=== Ce qui serait modifié ===`);
    console.log(`   1 document : region -> "japonais", regionSource -> "${SOURCE}"`);
    console.log(`   AUCUN autre champ touché — ni codeSet, ni idExpansion, ni apprisLe.`);
    console.log(`\n   Effet mesuré sur le classement : le produit 654243 (Raichu-IPB3) passe de`);
    console.log(`   0 point (« région indéterminée ») à +45 (« région japonaise »), ce qui le fait`);
    console.log(`   gagner contre les huit concurrents actuellement à 45.`);

    if (!confirmer) {
        console.log(`\n🔎 DRY-RUN terminé. Rien n'a été écrit.`);
        console.log(`   Pour écrire : node corriger-region-ipb.js --base=${base} --confirmer`);
        await mongoose.disconnect();
        return;
    }

    const r = await CodeSet.updateOne(
        { idExpansion: EXP, codeSet: CODE_ATTENDU, region: { $in: [null, ''] } },
        { $set: { region: 'japonais', regionSource: SOURCE, regionDeriveeLe: new Date() } }
    );
    console.log(`\n✍️  ${r.modifiedCount ?? r.nModified ?? 0} document(s) modifié(s).`);
    const apres = await CodeSet.findOne({ idExpansion: EXP }).lean();
    console.log(`\n=== Contrôle après ===`);
    console.log(`   exp ${EXP} · code=${apres.codeSet} · region=${apres.region} · regionSource=${apres.regionSource}`);
    console.log(`   ${apres.region === 'japonais' ? '✅' : '❌'} région écrite`);
    await mongoose.disconnect();
})().catch(async e => { console.error('❌ ERREUR', e.message); try { await mongoose.disconnect(); } catch (_) { } process.exit(1); });
