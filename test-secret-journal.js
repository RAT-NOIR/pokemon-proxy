// Banc SECRET-JOURNAL : aucune partie d'une valeur secrète n'apparaît dans ce que le démarrage écrit.
// Les valeurs sont FABRIQUÉES ici (aléatoires, jamais lues du .env). Le démarrage réel (require de
// index.js) tourne dans un processus enfant, environnement minimal, sans base ; on capte stdout + stderr.
// Règle : aucune sous-chaîne de 4 caractères ou plus d'une valeur secrète (hors préfixe fixe) ne doit y figurer.
const { spawnSync } = require('child_process');
const crypto = require('crypto');
const path = require('path');

if (process.argv[2] === 'enfant') {
    require(path.join(__dirname, 'index.js'));
    setTimeout(() => process.exit(0), 300);
    return;
}

const alea = n => { let s = ''; while (s.length < n) s += crypto.randomBytes(48).toString('base64').replace(/[^A-Za-z0-9]/g, ''); return s.slice(0, n); };
const SECRETS = {
    STRIPE_WEBHOOK_SECRET: { prefixe: 'whsec_', valeur: null },
    STRIPE_WEBHOOK_SECRET_ANCIEN: { prefixe: 'whsec_', valeur: null },   // secret de transition (WEBHOOK-MULTI)
    STRIPE_SECRET_KEY: { prefixe: 'sk_live_', valeur: null },
};
for (const k of Object.keys(SECRETS)) SECRETS[k].valeur = SECRETS[k].prefixe + alea(40);

const env = {
    PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, PORT: '0', NODE_ENV: 'test',
    STRIPE_PRICE_P20: 'price_factice_20', STRIPE_PRICE_P50: 'price_factice_50',
    STRIPE_PRICE_P100: 'price_factice_100', STRIPE_PRICE_P200: 'price_factice_200',
};
for (const [k, v] of Object.entries(SECRETS)) env[k] = v.valeur;

const r = spawnSync(process.execPath, [__filename, 'enfant'], { cwd: __dirname, env, encoding: 'utf8', timeout: 60000 });
const sortie = `${r.stdout || ''}\n${r.stderr || ''}`;

let echecs = 0;
const verifier = (ok, msg) => { console.log(`${ok ? '✅' : '🔴'} ${msg}`); if (!ok) echecs++; };

verifier(/\[stripe\]/.test(sortie), 'le démarrage a bien écrit sa ligne [stripe] (le banc mord sur le chemin)');
verifier(/clé LIVE/.test(sortie), 'le mode (LIVE) se déduit du préfixe fixe');
verifier(/secret webhook : présent/.test(sortie), 'la présence du secret de webhook est dite');
verifier(/secret de transition : présent/.test(sortie), 'la présence du secret de transition est dite (posé)');

// Second démarrage SANS le secret de transition : « absent ».
const envSans = { ...env }; delete envSans.STRIPE_WEBHOOK_SECRET_ANCIEN;
const r2 = spawnSync(process.execPath, [__filename, 'enfant'], { cwd: __dirname, env: envSans, encoding: 'utf8', timeout: 60000 });
verifier(/secret de transition : absent/.test(`${r2.stdout || ''}\n${r2.stderr || ''}`), 'son absence est dite (non posé)');

for (const [nom, { prefixe, valeur }] of Object.entries(SECRETS)) {
    const fuites = [];
    for (let i = 0; i + 4 <= valeur.length; i++) {
        if (i + 4 <= prefixe.length) continue;            // fenêtre entièrement dans le préfixe fixe
        const f = valeur.slice(i, i + 4);
        if (sortie.includes(f)) fuites.push(i);
    }
    verifier(fuites.length === 0, `${nom} : aucune sous-chaîne de 4 caractères dans le journal (${fuites.length} fenêtre(s) trouvée(s), positions ${fuites.slice(0, 5).join(',') || '—'})`);
}

console.log(echecs ? `\n🔴 ${echecs} échec(s)` : '\n✅ test-secret-journal : tout passe');
process.exit(echecs ? 1 : 0);
