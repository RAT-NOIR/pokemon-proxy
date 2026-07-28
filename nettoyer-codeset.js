// ============================================================
// NETTOYAGE DES codeSet URL-ENCODÉS — script autonome
// ============================================================
// Problème corrigé : le codeSet est extrait de l'URL d'image Cardmarket
//   .../product-images.s3.cardmarket.com/51/SV-P%2FCS/851878/851878.jpg
// et a été stocké TEL QUEL, donc encodé : "SV-P%2FCS" au lieu de "SV-P/CS",
// "K%2BK" au lieu de "K+K". Deux séquences en cause : %2F (/) et %2B (+).
//
// Conséquence mesurée : après normalisation (majuscules + retrait des caractères
// non alphanumériques), "SV-P%2FCS" devient "SVP2FCS" au lieu de "SVPCS". Le "2F"
// parasite empêchait le critère "set" du scoring de rapprocher le code lu par l'IA
// ("SV-P") du code du candidat — c'est un des mécanismes du bug Magikarp 024.
//
// ⚠️ Ce script ne touche QUE MongoDB. Il ne contacte JAMAIS Cardmarket : aucun
//    navigateur, aucune requête HTTP, donc aucun risque de bannissement.
//
// ⚠️ Il ne RÉAPPREND rien. Les cartes concernées sont déjà source:'cardmarket'
//    (lecture exacte), et /api/apprendre-lot saute justement celles-là : les
//    réapprendre ne corrigerait rien et rechargerait des pages Cardmarket pour rien.
//
// Idempotent : après un passage, plus aucune valeur ne contient de "%", donc les
// requêtes de sélection ne ramènent plus rien. Relançable sans effet.
//
// USAGE (la base doit être NOMMÉE explicitement, le script refuse de la deviner) :
//   node nettoyer-codeset.js --base=test   (SIMULATION : affiche tout, n'écrit rien)
//   node nettoyer-codeset.js --base=test --ecrire --confirmer-production
//                                          (écrit vraiment — double verrou en prod)
//
// ⚠️ "test" est bien la base de PRODUCTION de ce projet — c'est le nom par défaut de
//    Mongoose, et c'est là que vivent les vraies données. Le bac à sable est
//    "test_scratch". Voir mongo-connexion.js.

require('dotenv').config();
const mongoose = require('mongoose');
const { connecterMongo } = require('./mongo-connexion');

const ECRIRE = process.argv.includes('--ecrire');

// Collections visées. `codes_set` est alimentée par memoriserCodeSet (serveur) et par
// apprendreUnSet (scripts locaux) ; `numeros_cartes` par les mêmes chemins. Les deux
// sont donc polluées de la même façon, et nettoyer une seule laisserait le scoring
// incohérent selon la source du code (voir index.js : `codeSet || infoNum.codeSet`).
const numeroCarteSchema = new mongoose.Schema({}, { strict: false });
const codeSetSchema = new mongoose.Schema({}, { strict: false });
const NumeroCarte = mongoose.model('NumeroCarte', numeroCarteSchema, 'numeros_cartes');
const CodeSet = mongoose.model('CodeSet', codeSetSchema, 'codes_set');

// Décodage prudent. decodeURIComponent lève une URIError sur une séquence malformée
// (un "%" littéral, "100%" par exemple) : dans ce cas on NE TOUCHE PAS la valeur.
// Mieux vaut laisser un document sale qu'écrire une valeur corrompue.
function decoderPrudemment(valeur) {
    try {
        const decode = decodeURIComponent(valeur);
        return { ok: true, decode, change: decode !== valeur };
    } catch (e) {
        return { ok: false, decode: valeur, change: false, erreur: e.message };
    }
}

async function main() {
    // Base nommée explicitement, affichée, et refus si elle ne correspond pas.
    await connecterMongo({ script: 'nettoyer-codeset.js', ecrit: ECRIRE, confirmationProduction: true });
    console.log(ECRIRE
        ? "\n✍️  MODE ÉCRITURE — les documents vont être modifiés.\n"
        : "\n👀 MODE SIMULATION (dry-run) — aucune écriture. Ajoute --ecrire pour appliquer.\n");

    let totalDocs = 0, totalEcrits = 0, malformes = 0;

    for (const { modele, nom } of [{ modele: NumeroCarte, nom: 'numeros_cartes' }, { modele: CodeSet, nom: 'codes_set' }]) {
        console.log('='.repeat(78));
        console.log(`COLLECTION ${nom}`);
        console.log('='.repeat(78));

        // Un seul aller-retour pour la liste des codes concernés, puis un compte par
        // code : c'est ce qui permet d'afficher les sets un par un plutôt qu'un total
        // opaque, et de faire ensuite UN updateMany par code (au lieu d'un par document).
        const codes = await modele.distinct('codeSet', { codeSet: /%/ });

        if (codes.length === 0) {
            console.log("  ✨ Aucun codeSet encodé — rien à faire (déjà nettoyée ?).\n");
            continue;
        }

        console.log(`  ${codes.length} code(s) distinct(s) contenant un "%" :\n`);
        console.log('   ' + 'AVANT'.padEnd(16) + 'APRÈS'.padEnd(16) + 'DOCS   EXEMPLE');
        console.log('   ' + '-'.repeat(70));

        const aEcrire = [];
        for (const code of codes.sort()) {
            const nb = await modele.countDocuments({ codeSet: code });
            const { ok, decode, change, erreur } = decoderPrudemment(code);
            totalDocs += nb;

            // Un exemple concret par code, pour que le résultat soit vérifiable à l'œil
            // avant d'écrire (c'est tout l'intérêt du dry-run).
            const ex = await modele.findOne({ codeSet: code }).lean();
            const apercu = nom === 'codes_set'
                ? `idExpansion ${ex?.idExpansion}`
                : `idProduct ${ex?.idProduct}${ex?.slug ? ` (${ex.slug})` : ''}`;

            if (!ok) {
                malformes++;
                console.log(`   ${code.padEnd(16)}${'⚠️ MALFORMÉ'.padEnd(16)}${String(nb).padEnd(7)}${apercu}`);
                console.log(`      -> ignoré : ${erreur}`);
                continue;
            }
            if (!change) {
                console.log(`   ${code.padEnd(16)}${'(inchangé)'.padEnd(16)}${String(nb).padEnd(7)}${apercu}`);
                continue;
            }

            console.log(`   ${code.padEnd(16)}${decode.padEnd(16)}${String(nb).padEnd(7)}${apercu}`);
            // Double encodage éventuel : on ne boucle PAS le décodage (comportement
            // imprévisible), on le signale — un second passage le finira proprement.
            if (decode.includes('%')) {
                console.log(`      ℹ️ contient encore un "%" après décodage (double encodage ?) — relancer le script le finira.`);
            }
            aEcrire.push({ code, decode, nb });
        }

        const docsAChanger = aEcrire.reduce((s, x) => s + x.nb, 0);
        console.log(`\n  -> ${aEcrire.length} code(s) à corriger, ${docsAChanger} document(s) concerné(s).`);

        if (!ECRIRE) {
            console.log("  (simulation : rien n'a été écrit)\n");
            continue;
        }

        // Un updateMany par code. Pas de risque de collision de clé unique : la clé de
        // `numeros_cartes` est idProduct, celle de `codes_set` est idExpansion — le
        // codeSet n'est unique dans aucune des deux, on ne fait que réécrire un champ.
        for (const { code, decode, nb } of aEcrire) {
            const r = await modele.updateMany({ codeSet: code }, { $set: { codeSet: decode } });
            const n = r.modifiedCount ?? r.nModified ?? 0;
            totalEcrits += n;
            const alerte = n !== nb ? `  ⚠️ ${nb} attendu(s)` : '';
            console.log(`  ✍️  ${code} -> ${decode} : ${n} document(s) modifié(s)${alerte}`);
        }

        // Contrôle immédiat : la collection ne doit plus contenir que d'éventuels
        // malformés. Sinon quelque chose a échoué en silence.
        const restants = await modele.countDocuments({ codeSet: /%/ });
        console.log(`  ✅ Reste ${restants} document(s) avec "%" (attendu : les malformés uniquement).\n`);
    }

    console.log('='.repeat(78));
    console.log(`RÉSUMÉ : ${totalDocs} document(s) inspecté(s)${ECRIRE ? `, ${totalEcrits} modifié(s)` : ' (aucune écriture)'}${malformes ? `, ${malformes} code(s) malformé(s) ignoré(s)` : ''}.`);
    if (!ECRIRE) console.log("Relance avec --ecrire pour appliquer.");
    console.log('='.repeat(78));

    await mongoose.disconnect();
}

main().catch(async e => {
    console.error("❌ Erreur :", e.message);
    try { await mongoose.disconnect(); } catch (_) { }
    process.exit(1);
});
