// ============================================================================
// L'ENVIRONNEMENT DU VERROU, JUGÉ AVANT TOUTE CONNEXION ET TOUT SERVEUR FILS — écrit par ce qu'il AUTORISE
// ============================================================================
// verrou-avant-push.js ouvre test_scratch par `MONGODB_URI` et lance un serveur qui HÉRITE de l'environnement. Tout y est sûr SI `banc.appliquer()` a remplacé
// chaque variable MONGODB_*URI par l'URI du banc — mais le fichier ne le constatait pas : un appliquer() oublié ou incomplet aurait fait écrire (tranche,
// comptes, journal, deleteMany) sur la grappe de PRODUCTION, sans une ligne d'alerte. Ce module est la constatation, sans dépendance, pure.
// 🔑 Le contrôle porte sur ce que le cas redouté n'a PAS : un hôte qui est celui du banc (BANC_HOTES, posé par appliquer()). Il ne se confirme pas lui-même :
// une URI de production, même au bon nom de variable, n'a pas l'hôte du banc.
// Le chemin qui passe est unique : BANC_ISOLE=1, BANC_HOTES non vide, MONGODB_URI lisible et sur l'hôte du banc, AUCUNE autre variable URI qui pointe ailleurs,
// clés R2 de production vidées. Tout le reste refuse, y compris le doute. Aucun message ne contient de valeur de variable.
const { verifierHoteBanc } = require('../collecte-cartes/garde-banc');

const ressemblePourUri = v => typeof v === 'string' && /^mongodb(\+srv)?:\/\//i.test(v.trim());

/** { ok, raison } — l'environnement (celui du verrou ET de ses fils) ne mène qu'au banc. */
function verifierEnvironnementBanc(env = process.env) {
    const ko = raison => ({ ok: false, raison: `🔴 VERROU REFUSÉ — ${raison} Aucune connexion n'a été ouverte.` });
    if (env.BANC_ISOLE !== '1') return ko('BANC_ISOLE n\'est pas posé : banc.appliquer() n\'a pas remplacé les URI de connexion, le verrou écrirait sur la grappe de production.');
    if (!String(env.BANC_HOTES || '').trim()) return ko('BANC_HOTES est vide : je ne sais pas où est le banc.');
    if (!ressemblePourUri(env.MONGODB_URI)) return ko('MONGODB_URI est absente ou illisible.');
    for (const [nom, v] of Object.entries(env)) {
        if (!/^MONGODB_/.test(nom) || typeof v !== 'string' || !v.trim()) continue;
        const estUri = ressemblePourUri(v);
        if (!estUri && /URI$/.test(nom)) return ko(`${nom} est illisible : doute = refus.`);
        if (!estUri) continue;   // MONGODB_BASE & co : un nom de base, pas une adresse
        const h = verifierHoteBanc(v, env);
        if (!h.ok) return ko(`${nom} ne pointe pas sur le banc (${h.raison.replace(/^BANC_ISOLE=1 ?:? ?/, '')}).`);
    }
    for (const k of ['R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY']) {
        if (env[k]) return ko(`${k} (clé R2 de production) est encore présente dans l'environnement que les fils héritent.`);
    }
    return { ok: true, raison: null };
}

/** L'URI du banc, ou LÈVE : jamais une URI que la garde n'a pas jugée. */
function uriDuBanc(env = process.env) {
    const v = verifierEnvironnementBanc(env);
    if (!v.ok) throw new Error(v.raison);
    return env.MONGODB_URI;
}

/** Le jeton de l'API du banc : celui de l'environnement, sinon refus (aucun repli en dur). { ok, jeton?, raison? } */
function jetonOuRefus(env = process.env) {
    const j = typeof env.JETON_API === 'string' ? env.JETON_API.trim() : '';
    if (!j) return { ok: false, raison: '🔴 VERROU REFUSÉ — JETON_API est absente ou vide dans l\'environnement du banc ; aucun jeton de repli en dur. Rien n\'a été lancé.' };
    return { ok: true, jeton: j };
}

// ── L'ENVIRONNEMENT DU CLIQUET (R8 B-I, tour 2) : UNE LISTE FERMÉE de noms transmis, et RIEN d'autre. Une garde s'écrit par ce qu'elle autorise : la version du tour 1 copiait tout
// l'environnement puis neutralisait quelques variables (clés Stripe, OpenRouter, R2_ENDPOINT, jetons passaient). Ici, seul ce qui est NOMMÉ passe ; chaque nom a sa raison.
//   · système (le processus fils ne démarre pas sans eux) : chemin, dossiers système, temporaire, profil, machine ;
//   · MONGOMS_DOWNLOAD_DIR : où les suites qui ouvrent leur banc (mongodb-memory-server) trouvent le binaire mongod déjà téléchargé ;
//   · MONGODB_LECTURE_URI, MONGODB_CARTES_LECTURE_URI : les utilisateurs Atlas en LECTURE SEULE (privilèges constatés par ouvrirBanc) ;
//   · R2_BUCKET_BANC, R2_BANC_ACCESS_KEY_ID, R2_BANC_SECRET_ACCESS_KEY : le bucket et les clés R2 de BANC (garde-banc.clesR2 n'utilise que celles-ci sous banc).
// JAMAIS transmises : MONGODB_URI / MONGODB_CARTES_URI / MONGODB_TEST_URI (écriture : ni la valeur, ni l'hôte avec un faux identifiant), R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY,
// Stripe, OpenRouter, jetons, tout nom inconnu. Aucun motif large : des noms exacts.
const VARIABLES_TRANSMISES = [
    'PATH', 'Path', 'PATHEXT', 'SystemRoot', 'SYSTEMROOT', 'SystemDrive', 'windir', 'ComSpec', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'HOMEDRIVE', 'HOMEPATH',
    'ProgramData', 'ProgramFiles', 'ProgramFiles(x86)', 'ProgramW6432', 'CommonProgramFiles', 'CommonProgramFiles(x86)', 'CommonProgramW6432', 'ALLUSERSPROFILE', 'OS',
    'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE', 'COMPUTERNAME', 'USERNAME', 'USERDOMAIN', 'NO_COLOR',
    'MONGOMS_DOWNLOAD_DIR',
    'MONGODB_LECTURE_URI', 'MONGODB_CARTES_LECTURE_URI',
    'R2_BUCKET_BANC', 'R2_BANC_ACCESS_KEY_ID', 'R2_BANC_SECRET_ACCESS_KEY'
];
/**
 * L'environnement des suites du cliquet. `nomsDotenv` : les noms que le .env remettrait (les suites font `require('dotenv').config()`, qui REMPLIT toute variable absente) :
 * ceux qui ne sont pas transmis sont posés VIDES — une variable présente, même vide, n'est jamais remise par dotenv (même raison que base-banc.appliquer()).
 */
function environnementDuCliquet(origine = process.env, nomsDotenv = []) {
    const e = {};
    for (const nom of VARIABLES_TRANSMISES) if (typeof origine[nom] === 'string') e[nom] = origine[nom];
    for (const nom of nomsDotenv) if (!VARIABLES_TRANSMISES.includes(nom)) e[nom] = '';
    return e;
}

/** Les noms que porte le .env de la racine (jamais les valeurs). Illisible ou absent : [] (rien à remettre). */
function nomsDuDotenv(fichier = require('path').join(__dirname, '..', '.env')) {
    try { return Object.keys(require('dotenv').parse(require('fs').readFileSync(fichier))); } catch (_) { return []; }
}

module.exports = { verifierEnvironnementBanc, uriDuBanc, jetonOuRefus, environnementDuCliquet, VARIABLES_TRANSMISES, nomsDuDotenv };
