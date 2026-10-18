// ============================================================
// POSER LES SECRETS DES IMPORTS GITHUB ACTIONS — lit le .env, n'imprime que des NOMS (jamais une valeur)
// ============================================================
//   node poser-secrets-imports.js [--env=.env] [--repo=RAT-NOIR/pokemon-proxy] [--a-blanc]
// Pour chaque secret, la valeur passe par l'ENTRÉE STANDARD de `gh secret set NOM --repo …` : ni dans les arguments (visibles dans la liste
// des processus), ni dans la sortie. MONGODB_URI_IMPORTS vient de MONGODB_URI du .env (à défaut d'une MONGODB_URI_IMPORTS propre).
// Obligatoires : MONGODB_URI_IMPORTS, R2_BUCKET_BRUT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, et R2_ACCOUNT_ID ou R2_ENDPOINT (au moins un).
const fs = require('fs');
const { spawnSync } = require('child_process');

const SECRETS = [
    { nom: 'MONGODB_URI_IMPORTS', sources: ['MONGODB_URI_IMPORTS', 'MONGODB_URI'], obligatoire: true },
    { nom: 'R2_BUCKET_BRUT', sources: ['R2_BUCKET_BRUT'], obligatoire: true },
    { nom: 'R2_ACCESS_KEY_ID', sources: ['R2_ACCESS_KEY_ID'], obligatoire: true },
    { nom: 'R2_SECRET_ACCESS_KEY', sources: ['R2_SECRET_ACCESS_KEY'], obligatoire: true },
    { nom: 'R2_ACCOUNT_ID', sources: ['R2_ACCOUNT_ID'], obligatoire: false },
    { nom: 'R2_ENDPOINT', sources: ['R2_ENDPOINT'], obligatoire: false }
];

function lireEnv(texte) {
    const env = {};
    for (const ligne of String(texte).split(/\r?\n/)) {
        const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(ligne);
        if (!m || ligne.trim().startsWith('#')) continue;
        let v = m[2];
        if ((v.startsWith('"') && v.endsWith('"') || v.startsWith("'") && v.endsWith("'")) && v.length >= 2) v = v.slice(1, -1);
        env[m[1]] = v;
    }
    return env;
}

const ghReel = (args, valeur) => spawnSync('gh', args, { input: valeur, stdio: ['pipe', 'ignore', 'ignore'], shell: false });

async function poser({ texteEnv, repo, gh = ghReel, journal = console, aBlanc = false }) {
    const env = lireEnv(texteEnv), aPoser = [];
    const manquants = [];
    for (const s of SECRETS) {
        const source = s.sources.find(n => String(env[n] ?? '').trim());
        if (source) aPoser.push({ nom: s.nom, valeur: env[source] });
        else if (s.obligatoire) manquants.push(s.nom);
    }
    if (!aPoser.some(x => x.nom === 'R2_ACCOUNT_ID' || x.nom === 'R2_ENDPOINT')) manquants.push('R2_ACCOUNT_ID ou R2_ENDPOINT');
    if (manquants.length) { journal.error(`❌ absent du .env : ${manquants.join(', ')} — aucun secret posé.`); return 1; }
    let code = 0;
    for (const { nom, valeur } of aPoser) {
        if (aBlanc) { journal.log(`à blanc : ${nom} serait posé sur ${repo}`); continue; }
        const r = gh(['secret', 'set', nom, '--repo', repo], valeur);
        if (r.status === 0) journal.log(`✅ ${nom} posé sur ${repo}`);
        else { journal.error(`🔴 ${nom} : échec de gh secret set (code ${r.status ?? 'inconnu'})`); code = 1; }
    }
    return code;
}

if (require.main === module) {
    const arg = (n, d) => (process.argv.find(a => a.startsWith(`--${n}=`)) || '').slice(n.length + 3) || d;
    const fichier = arg('env', '.env'), repo = arg('repo', 'RAT-NOIR/pokemon-proxy');
    let texte;
    try { texte = fs.readFileSync(fichier, 'utf8'); } catch { console.error(`❌ ${fichier} illisible`); process.exit(1); }
    poser({ texteEnv: texte, repo, aBlanc: process.argv.includes('--a-blanc') }).then(c => process.exit(c));
}

module.exports = { poser, lireEnv, SECRETS };
