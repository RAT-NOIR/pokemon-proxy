// ============================================================
// UNE PASSE D'IMPORT POUR GITHUB ACTIONS — le guide des prix (dû dès 04:45 UTC, cron 04:47 + secours 06:47) et le catalogue (dû dès 12:15 UTC, cron 12:17 + secours 14:17) Cardmarket (testeur, 2026-10-17)
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

const VARIABLES_SECRETES = ['MONGODB_URI', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_ENDPOINT', 'R2_ACCOUNT_ID', 'R2_BUCKET_BRUT'];
/** Remplace tout motif `mongodb(+srv)://…` par « mongodb://*** » et toute valeur des variables secrètes (4 caractères au moins) par « *** ». */
function masquerSecrets(texte, env = process.env) {
    let s = String(texte).replace(/mongodb(?:\+srv)?:\/\/\S+/g, 'mongodb://***');
    const valeurs = VARIABLES_SECRETES.map(n => String(env[n] ?? '').trim()).filter(v => v.length >= 4).sort((x, y) => y.length - x.length);
    for (const v of valeurs) s = s.split(v).join('***');
    // défense : un reste d'URI dont le préfixe a été coupé (« …:mot@hôte ») — identifiants avant un @
    s = s.replace(/[^\s@/]*:[^\s@/]*@[^\s/]+/g, '***');
    // dernier filet : tout mot contenant « @ » suivi d'un nom d'hôte (le début de l'URI peut avoir été coupé DANS le mot de passe, sans « : »)
    return s.replace(/\S*@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\S*/g, '***');
}
/** Masque le texte ENTIER, puis tronque (jamais l'inverse : une coupure dans « mongodb+srv:// » cacherait l'URI à la regex), puis masque encore. */
const extraitSur = (texte, env, n = 1500) => masquerSecrets(masquerSecrets(texte, env).slice(-n), env);

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
        let dejaEnEchec = false;
        for (const nom of noms) {
            const h = IQ.IMPORTS.find(i => i.nom === nom);
            const etat = await E.findOne({ _id: `import-quotidien/${nom}` });
            const d = IQ.aLancer(etat, maintenant(), { heure: h.heure, minute: h.minute });
            journal.log(`${d.lancer ? '📥' : '⏭️'} ${nom} : ${d.lancer ? 'dû, lancement' : d.raison}`);
            if (d.lancer) dus.push(nom);
            // un échec du jour que la règle n'autorise pas encore à rejouer (moins d'1 h, ou 3 échecs) : la passe reste ROUGE
            else if (etat?.jour === IQ.jourUTC(maintenant()) && etat.dernierResultat === 'echec') { journal.error(`🔴 ${nom} : en échec aujourd'hui (code ${etat.dernierCode ?? '?'}), pas rejouable pour l'instant`); dejaEnEchec = true; }
        }
        if (!dus.length) { journal.log(`rien de dû : sortie ${dejaEnEchec ? 1 : 0}`); return dejaEnEchec ? 1 : 0; }
        await IQ.importsQuotidiens({ E, ...(lancerScript ? { lancerScript } : {}), maintenant, journal, seulement: dus });
        let code = dejaEnEchec ? 1 : 0;
        for (const nom of dus) {
            const e = await E.findOne({ _id: `import-quotidien/${nom}` });
            if (!e || e.enCours !== false || e.dernierResultat === 'echec') {
                journal.error(`🔴 import « ${nom} » : ${e?.dernierResultat ?? 'sans résultat'} (code ${e?.dernierCode ?? '?'})`);
                // la cause, dans le journal de la CI : fin de la sortie de l'enfant (déjà bornée par le module), valeurs secrètes masquées
                if (e?.dernierExtrait) journal.error(`--- fin de la sortie de « ${nom} » ---\n${extraitSur(String(e.dernierExtrait), env)}\n--- fin ---`);
                code = 1;
            }
            else journal.log(`${e.dernierResultat === 'importe' ? '✅' : 'ℹ️'} import « ${nom} » : ${e.dernierResultat}`);
        }
        return code;
    } catch (e) { journal.error(`🔴 passe interrompue : ${masquer(e.message)}`); return 1; }
    finally { try { await fermer(); } catch { /* fermeture : sans importance pour le code de sortie */ } }
}

if (require.main === module) {
    passeCI().then(c => process.exit(c), e => { console.error(`🔴 ${masquer(e.message)}`); process.exit(1); });
}

module.exports = { passeCI, masquerSecrets, lireArguments, CHOIX, COLLECTION_JOURNAL };
