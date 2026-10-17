// ============================================================
// UNE PASSE D'IMPORT POUR GITHUB ACTIONS — le guide des prix (05:00 UTC) et le catalogue (12:15 UTC) Cardmarket (testeur, 2026-10-17)
// ============================================================
//   node imports-cardmarket-ci.js [--import=guide|catalogue|auto]      (auto par défaut)
// Ce fichier ne réécrit AUCUNE garde : il appelle `collecte-cartes/imports-quotidiens.js` (mêmes horaires, mêmes essais, même journal, mêmes
// alertes), qui lance les deux scripts d'import tels qu'à la main (c'est en eux que vivent le jugement du fichier, la sauvegarde relue,
// l'insertion additive, la requête conditionnelle). Il ajoute seulement : le choix de l'import, les variables vérifiées AVANT toute
// connexion (collecte-cartes/variables-requises.js : les NOMS seuls sont dits), et le code de sortie.
// · SORTIE : 1 si un import lancé échoue (job rouge, courriel GitHub), si une variable manque ou si l'argument est invalide ; 0 sinon —
//   « rien de neuf », « déjà fait » et « rien de dû » ne sont pas des échecs.
// · IDEMPOTENT : le journal `import-quotidien/<nom>` est en base (collection `imports_ci_etat`, base `test`, la seule joignable avec le seul
//   MONGODB_URI) ; une réussite ou un « rien de neuf » clôt le jour, et les scripts jugent eux-mêmes la date du guide / du fichier.
//   Deux passes simultanées : `concurrency` du workflow. Le journal du worker (collecte_images_etat, base `cartes`) n'est PAS lu ici.
// · AUCUNE valeur de secret n'est imprimée ; les erreurs de connexion passent par un masque.
const { variablesManquantes } = require('./collecte-cartes/variables-requises');

const CHOIX = ['guide', 'catalogue', 'auto'];
const COLLECTION_JOURNAL = 'imports_ci_etat';
const masquer = m => String(m).replace(/mongodb(\+srv)?:\/\/\S+/g, '<uri masquée>').slice(0, 200);

function lireArguments(argv) {
    let choix = 'auto';
    for (const x of argv) {
        const m = /^--import=(.+)$/.exec(x);
        if (!m) return { erreur: `argument inconnu « ${String(x).slice(0, 40)} » (seul --import=guide|catalogue|auto existe)` };
        if (!CHOIX.includes(m[1])) return { erreur: `--import=${m[1].slice(0, 20)} inconnu (guide, catalogue ou auto)` };
        choix = m[1];
    }
    return { choix };
}

/** Ouvre la base `test` (journal des imports) — jamais appelée par les bancs, qui injectent `ouvrirE`. */
async function ouvrirReel(env) {
    const mongoose = require('mongoose');
    const cx = await mongoose.createConnection(env.MONGODB_URI, { dbName: 'test', serverSelectionTimeoutMS: 20000 }).asPromise();
    if (cx.db.databaseName !== 'test') { await cx.close(); throw new Error(`base connectée « ${cx.db.databaseName} », attendue « test »`); }
    return { E: cx.db.collection(COLLECTION_JOURNAL), fermer: () => cx.close() };
}

async function passeCI({ argv = process.argv.slice(2), env = process.env, ouvrirE = ouvrirReel, lancerScript, maintenant = () => new Date(), journal = console, IQ = require('./collecte-cartes/imports-quotidiens') } = {}) {
    const args = lireArguments(argv);
    if (args.erreur) { journal.error(`❌ ${args.erreur}`); return 1; }
    const manquantes = variablesManquantes(env);
    if (manquantes.length) { journal.error(`❌ ${manquantes.join(', ')} absent${manquantes.length > 1 ? 'es' : 'e'} de l'environnement (secrets du dépôt GitHub) — aucune connexion, aucune requête, rien d'écrit.`); return 1; }
    const noms = args.choix === 'auto' ? IQ.IMPORTS.map(i => i.nom) : [args.choix];
    let ouvert;
    try { ouvert = await ouvrirE(env); }
    catch (e) { journal.error(`❌ base de journal injoignable (${masquer(e.message)}) — aucune requête vers Cardmarket`); return 1; }
    const { E, fermer } = ouvert;
    try {
        // ce que l'heure et le journal rendent dû, AVANT : pour dire "rien de dû" et pour reconnaître un import lancé
        const dus = [];
        for (const nom of noms) {
            const h = IQ.IMPORTS.find(i => i.nom === nom);
            const d = IQ.aLancer(await E.findOne({ _id: `import-quotidien/${nom}` }), maintenant(), { heure: h.heure, minute: h.minute });
            journal.log(`${d.lancer ? '📥' : '⏭️'} ${nom} : ${d.lancer ? 'dû, lancement' : d.raison}`);
            if (d.lancer) dus.push(nom);
        }
        if (!dus.length) { journal.log('rien de dû : sortie 0'); return 0; }
        await IQ.importsQuotidiens({ E, ...(lancerScript ? { lancerScript } : {}), maintenant, journal, seulement: dus });
        let code = 0;
        for (const nom of dus) {
            const e = await E.findOne({ _id: `import-quotidien/${nom}` });
            if (!e || e.enCours !== false || e.dernierResultat === 'echec') { journal.error(`🔴 import « ${nom} » : ${e?.dernierResultat ?? 'sans résultat'} (code ${e?.dernierCode ?? '?'})`); code = 1; }
            else journal.log(`${e.dernierResultat === 'importe' ? '✅' : 'ℹ️'} import « ${nom} » : ${e.dernierResultat}`);
        }
        return code;
    } catch (e) { journal.error(`🔴 passe interrompue : ${masquer(e.message)}`); return 1; }
    finally { try { await fermer(); } catch { /* fermeture : sans importance pour le code de sortie */ } }
}

if (require.main === module) {
    passeCI().then(c => process.exit(c), e => { console.error(`🔴 ${masquer(e.message)}`); process.exit(1); });
}

module.exports = { passeCI, lireArguments, CHOIX, COLLECTION_JOURNAL };
