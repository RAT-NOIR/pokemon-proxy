// ============================================================
// LE JOURNAL DES IMPORTS QUOTIDIENS, LU LÀ OÙ IL EST ÉCRIT — file-a-l-arret.js (2026-10-24)
// ============================================================
// 🔴 LA CAUSE : le journal a DEUX écrivains, dans DEUX bases sur DEUX grappes, et le lecteur n'en lisait qu'un.
//   · le worker Render (suspendu le 17/10) et imports-quotidiens-local.js : `collecte_images_etat` de la base `cartes` ;
//   · GitHub Actions (imports-cardmarket-ci.js, depuis le 17/10) : `imports_ci_etat` de la base de PRODUCTION `test`
//     (COLLECTION_JOURNAL, imports-cardmarket-ci.js — la seule joignable avec le seul MONGODB_URI du dépôt GitHub).
//   file-a-l-arret.js ne lisait que le premier : « dernier passage 2026-10-17 » alors que la production portait le 24/10.
// 🔑 CE MODULE LIT LES DEUX et, par import, garde le passage le plus RÉCENT (`dernierEssai`) en disant d'où il vient (`source`).
//   Une lecture de production qui échoue est DITE (`erreurProd`) : « je ne sais pas » n'est jamais « tout va bien ».
// Lecture seule : aucune écriture, aucune URI imprimée.
const COLLECTION_WORKER = 'collecte_images_etat';   // base `cartes`
const COLLECTION_CI = 'imports_ci_etat';            // base de production `test`
const RE_IMPORT = /^import-quotidien\//, RE_ALERTE = /^alerte\/import-/;
const EN_COURS_MAX_MS = 45 * 60000;

const ms = v => { const t = v ? new Date(v).getTime() : NaN; return Number.isNaN(t) ? -Infinity : t; };

/** Par `_id`, le document le plus récent selon `cle`, marqué de sa source. Égalité : la CI (le journal vivant depuis le 17/10). */
function plusRecents(docsWorker, docsCI, cle) {
    const m = new Map();
    for (const [docs, source] of [[docsWorker, 'worker'], [docsCI, 'ci']])
        for (const doc of docs || []) {
            const avant = m.get(doc._id);
            if (!avant || cle(doc) >= cle(avant)) m.set(doc._id, { ...doc, source });
        }
    return [...m.values()];
}

/** Lit les deux journaux. @param cartes base `cartes` ; @param prod base de production `test` (ou null). Ne lève pas pour la production. */
async function lireJournauxImports({ cartes, prod }) {
    const lire = async (db, nom, re) => db.collection(nom).find({ _id: re }).toArray();
    const worker = [...await lire(cartes, COLLECTION_WORKER, RE_IMPORT), ...await lire(cartes, COLLECTION_WORKER, RE_ALERTE)];
    let ci = [], erreurProd = null;
    if (!prod) erreurProd = 'production non ouverte : le journal des imports de GitHub Actions n\'est PAS lu';
    else {
        try { ci = [...await lire(prod, COLLECTION_CI, RE_IMPORT), ...await lire(prod, COLLECTION_CI, RE_ALERTE)]; }
        catch (e) { erreurProd = String(e.message).replace(/mongodb(\+srv)?:\/\/\S+/g, '<uri masquée>').slice(0, 200); }
    }
    const imports = plusRecents(worker.filter(x => RE_IMPORT.test(x._id)), ci.filter(x => RE_IMPORT.test(x._id)), x => ms(x.dernierEssai));
    // une alerte : la plus récente constatation décide ; on ne garde que les ACTIVES
    const alertes = plusRecents(worker.filter(x => RE_ALERTE.test(x._id)), ci.filter(x => RE_ALERTE.test(x._id)), x => ms(x.constateLe ?? x.depuis)).filter(a => a.active);
    return { imports, alertes, erreurProd };
}

/** Un import « en cours » depuis moins de 45 min est du travail : la base de production bouge. */
function importEnCours(imports, maintenant = new Date()) {
    return imports.some(i => i.enCours && maintenant.getTime() - ms(i.dernierEssai) < EN_COURS_MAX_MS);
}

/** La ligne imprimée par file-a-l-arret.js (même forme qu'avant, plus la source). */
function ligneImport(imp, maintenant = new Date()) {
    const dernier = imp.dernierEssai ? new Date(imp.dernierEssai).toISOString() : '—';
    const interrompu = imp.enCours && maintenant.getTime() - ms(imp.dernierEssai) > EN_COURS_MAX_MS;
    return `import quotidien ${imp._id.slice(17)} : dernier passage ${dernier} · ${imp.dernierResultat ?? '—'} (code ${imp.dernierCode ?? '—'}) · dernier import ${imp.succesLe ?? 'jamais'} · source ${imp.source ?? '?'}`
        + (imp.enCours ? (interrompu ? ' · 🔴 « en cours » depuis plus de 45 min : interrompu (conteneur ou job tué ?)' : ' · EN COURS') : '');
}

module.exports = { lireJournauxImports, importEnCours, ligneImport, COLLECTION_WORKER, COLLECTION_CI };
