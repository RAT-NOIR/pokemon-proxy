// ============================================================
// LES IMPORTS QUOTIDIENS, EN LOCAL — UNE passe, lancée chaque heure par le Planificateur de tâches de Windows
// ============================================================
//   node imports-quotidiens-local.js          (via imports-quotidiens-local.cmd, qui redirige la sortie vers journaux-locaux\)
//
// 🔑 CONTEXTE (testeur, 2026-10-17) : le worker Render qui lançait les imports (collecte-cartes/imports-quotidiens.js, IMPORTS_QUOTIDIENS=1) est
// SUSPENDU. Sans relève, le guide des prix (que l'API lit) n'est plus mis à jour dès le 18/10 05:00 UTC et les nouveaux produits ne sont plus importés.
// CE QUE CE FICHIER FAIT, ET RIEN D'AUTRE : il appelle `importsQuotidiens` de collecte-cartes/imports-quotidiens.js TEL QUEL — horaires par import,
// trois essais par jour, « rien de neuf » qui clôt le jour, journal `import-quotidien/<nom>`, alertes `alerte/import-<nom>` — une seule définition
// (§21 bis), aucune garde de l'import réécrite. Il y ajoute : le verrou par PID (jamais deux passes), la variable IMPORTS_QUOTIDIENS=1 posée
// explicitement, et un journal local horodaté.
// Hors passe : les scripts d'import font la requête Cardmarket conditionnelle (ETag) ; une passe horaire sans import dû n'en fait AUCUNE.
const path = require('path');
const fs = require('fs');
const VP = require('./collecte-cartes/verrou-pid');
const IQ = require('./collecte-cartes/imports-quotidiens');

// secours manuel, ou réutilisable par un workflow : JOURNAUX_LOCAUX redirige le dossier du verrou ; la connexion vient de l'ENVIRONNEMENT
// (MONGODB_CARTES_URI…, dotenv n'est qu'un repli si un .env existe) — aucune valeur en dur.
const DOSSIER_JOURNAUX = process.env.JOURNAUX_LOCAUX || 'C:\\Users\\Yung\\rat-market-travail\\catalogue\\journaux-locaux';
const VERROU = path.join(DOSSIER_JOURNAUX, 'imports-quotidiens-local.pid');

/** Le lanceur local pose lui-même la règle « IMPORTS_QUOTIDIENS=1 » : il n'attend pas qu'un environnement l'ait posée. */
function poserEnvironnement(env = process.env) { env.IMPORTS_QUOTIDIENS = '1'; return env; }

/** Un journal qui préfixe chaque ligne de son horodatage UTC ; `ecrire` reçoit la ligne (stdout par défaut, que le .cmd redirige). */
function journalHorodate({ ecrire = m => process.stdout.write(m + '\n'), maintenant = () => new Date() } = {}) {
    const f = niveau => (...m) => ecrire(`${maintenant().toISOString()} ${niveau}${m.map(x => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')}`);
    return { log: f(''), warn: f('⚠️ '), error: f('') };
}

/**
 * Une passe. Rend { etat: 'verrou-tenu' | 'rien-a-faire' | 'passe' } ; lève si la base est illisible (le verrou est rendu dans tous les cas).
 * @param E la collection `collecte_images_etat` ; @param lancerScript injectable pour les bancs (défaut : lancerEnfant du module existant)
 */
async function passe({ E, verrouFichier = VERROU, lancerScript = IQ.lancerEnfant, maintenant = () => new Date(), journal = journalHorodate(), pid = process.pid, vivant = VP.pidVivant } = {}) {
    poserEnvironnement();
    if (!IQ.actif()) throw new Error('IMPORTS_QUOTIDIENS=1 non pris en compte : je ne lance rien');
    const prise = VP.prendre(verrouFichier, { pid, maintenant: maintenant(), vivant });
    if (!prise.ok) { journal.log(`⏭️ passe abandonnée : ${prise.raison}`); return { etat: 'verrou-tenu' }; }
    try {
        if (!await IQ.aFaire({ E, maintenant })) { journal.log('ℹ️ aucun import dû à cette heure (déjà faits, avant l\'horaire, ou échecs du jour épuisés)'); return { etat: 'rien-a-faire' }; }
        await IQ.importsQuotidiens({ E, lancerScript, maintenant, journal });
        return { etat: 'passe' };
    } finally { VP.rendre(verrouFichier, pid); }
}

async function principal() {
    require('dotenv').config({ path: path.join(__dirname, '.env') });
    const journal = journalHorodate();
    fs.mkdirSync(DOSSIER_JOURNAUX, { recursive: true });
    const { ouvrirConnexions } = require('./collecte-cartes/garde');
    // la base `cartes` seule (là où vit `collecte_images_etat`) ; l'écriture en production est faite par les scripts d'import eux-mêmes (--base=test --confirmer-production)
    const { cartes, fermer } = await ouvrirConnexions({ production: false, essentiel: 'import-cardmarket', fichier: __filename });   // GARDE-ATLAS : le journal des imports est essentiel, jamais bloqué
    try {
        const r = await passe({ E: cartes.db.collection('collecte_images_etat'), journal });
        journal.log(`fin de passe : ${r.etat}`);
    } finally { await fermer(); }
}

module.exports = { passe, poserEnvironnement, journalHorodate, DOSSIER_JOURNAUX, VERROU };

if (require.main === module) principal().then(() => process.exit(0)).catch(e => { console.error(`${new Date().toISOString()} 🔴 passe en échec : ${e.message}`); process.exit(1); });
