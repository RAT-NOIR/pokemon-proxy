// ============================================================
// LES VARIABLES D'ENVIRONNEMENT D'UN IMPORT QUOTIDIEN — vérifiées AVANT la requête vers Cardmarket (2026-10-07, nuit)
// ============================================================
// 🔴 L'OCCURRENCE : le 2026-10-07, le worker a lancé trois fois chaque import (08:54, 09:54, 10:58 UTC). Chaque essai a TÉLÉCHARGÉ son
// fichier, l'a jugé, puis s'est arrêté sur « The `uri` parameter to `openUri()` must be a string, got "undefined" » : `MONGODB_URI`
// n'existe pas dans l'environnement du worker. Six requêtes à Cardmarket pour zéro écriture — l'exception accordée est UNE par jour —,
// et un message qui ne nommait pas la variable. Une configuration incomplète se constate sans réseau : elle se vérifie en premier,
// et le message dit QUOI ajouter (§6 : un refus nomme la sortie).
// La liste s'écrit par ce que les deux scripts LISENT (import-catalogue-quotidien.js, import-guide-quotidien.js, collecte-cartes/r2.js) :
// la base, le bucket des sauvegardes et des archives, les identifiants R2 et son hôte (R2_ENDPOINT, à défaut R2_ACCOUNT_ID).
const VARIABLES_IMPORT = ['MONGODB_URI', 'R2_BUCKET_BRUT', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'];

/** Les variables qu'un import exige : sous BANC_ISOLE=1 les clés R2 sont celles de BANC (R2_BANC_*, comme clesR2) — les clés de production
 *  sont vidées par le harnais et un banc ne les utilise jamais. Hors banc : la liste de toujours. */
function variablesImport(env = process.env) {
    return env.BANC_ISOLE === '1' ? ['MONGODB_URI', 'R2_BUCKET_BRUT', 'R2_BANC_ACCESS_KEY_ID', 'R2_BANC_SECRET_ACCESS_KEY'] : VARIABLES_IMPORT;
}

/** Les variables absentes ou vides — pure. @returns {string[]} */
function variablesManquantes(env = process.env, noms = variablesImport(env)) {
    const vide = n => !String(env[n] ?? '').trim();
    const manquantes = noms.filter(vide);
    if (vide('R2_ENDPOINT') && vide('R2_ACCOUNT_ID')) manquantes.push('R2_ENDPOINT ou R2_ACCOUNT_ID');
    return manquantes;
}

/** Arrête le script (sortie 1) avant toute requête si une variable manque ; le nom des variables est dit, jamais leur valeur. */
function exigerVariables(script, env = process.env) {
    const m = variablesManquantes(env);
    if (!m.length) return;
    console.error(`❌ ${script} : ${m.join(', ')} absent${m.length > 1 ? 'es' : 'e'} de l'environnement — aucune requête, rien d'écrit. À ajouter aux variables du service qui lance l'import (le worker Render).`);
    process.exit(1);
}

module.exports = { VARIABLES_IMPORT, variablesImport, variablesManquantes, exigerVariables };
