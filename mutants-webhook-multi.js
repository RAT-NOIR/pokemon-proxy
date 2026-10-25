// Mutants de WEBHOOK-MULTI : chaque mutation casse UNE propriété de la vérification par liste ou de l'idempotence ;
// test-webhook-multi.js doit ÉCHOUER (code ≠ 0) sur chacune. Le fichier muté est restauré dans un finally (octet pour octet),
// et l'état final est revérifié. USAGE : node mutants-webhook-multi.js
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const SW = path.join(__dirname, 'stripe-webhook.js');
const IDX = path.join(__dirname, 'index.js');

const MUTANTS = [
    { nom: '(a) ignorer _ANCIEN', fichier: SW,
      de: "for (const nom of ['STRIPE_WEBHOOK_SECRET', 'STRIPE_WEBHOOK_SECRET_ANCIEN']) {",
      vers: "for (const nom of ['STRIPE_WEBHOOK_SECRET']) {" },
    { nom: '(b) accepter sans signature quand _ANCIEN est vide', fichier: SW,
      de: "    throw premiere || new Error('Aucun secret de webhook configuré');",
      vers: "    if (!signature && secrets.length < 2) return JSON.parse(String(corps));\n    throw premiere || new Error('Aucun secret de webhook configuré');" },
    { nom: '(c) retirer la marque d\'idempotence pour la seconde livraison (eventId unique par livraison)', fichier: IDX,
      de: "eventId: event.id, type: event.type, userId, scans, dette: dette || null",
      vers: "eventId: event.id + '-' + Math.random(), type: event.type, userId, scans, dette: dette || null" },
    { nom: '(d) accepter sans vérifier (aucune signature contrôlée)', fichier: SW,
      de: "try { return stripe.webhooks.constructEvent(corps, signature, secret); }",
      vers: "try { stripe.webhooks.constructEvent(corps, signature, secret); return JSON.parse(String(corps)); }\n        catch (e0) { try { return JSON.parse(String(corps)); } catch (_) { /* inchangé */ } }\n        try { return stripe.webhooks.constructEvent(corps, signature, secret); }" },
    // (e) « l'erreur du dernier essai au lieu du premier » est ÉQUIVALENT : Stripe écrit le même message pour tout secret refusé
    // (aucun secret dedans) — retiré, un mutant équivalent ne prouve rien.
    { nom: '(f) le résumé d\'erreur Stripe recopie le message', fichier: SW,
      de: "    return `type=${sur(e && e.type)} code=${sur(e && e.code)} statusCode=${sur(e && e.statusCode)}`;",
      vers: "    return `type=${sur(e && e.type)} code=${sur(e && e.code)} statusCode=${sur(e && e.statusCode)} ${e && e.message}`;" },
    { nom: '(g) un journal Stripe de index.js réimprime e.message', fichier: IDX,
      de: "${idCharge} illisible : ${resumeErreurStripe(e)}`",
      vers: "${idCharge} illisible : ${e.message}`" },
    { nom: '(h) le journal de creer-recharge réimprime e.message', fichier: IDX,
      de: 'console.error("❌ [creer-recharge]", resumeErreurStripe(e));',
      vers: 'console.error("❌ [creer-recharge]", e.message);' },
    { nom: '(i) le 503 « non configuré » ne regarde plus le secret principal (accepte _ANCIEN seul)', fichier: IDX,
      de: "if (!stripe || !process.env.STRIPE_WEBHOOK_SECRET) {",
      vers: "if (!stripe || !(process.env.STRIPE_WEBHOOK_SECRET || process.env.STRIPE_WEBHOOK_SECRET_ANCIEN)) {" },
];

const originaux = new Map([[SW, fs.readFileSync(SW)], [IDX, fs.readFileSync(IDX)]]);
const restaurer = () => { for (const [f, b] of originaux) fs.writeFileSync(f, b); };
process.on('SIGINT', () => { restaurer(); process.exit(130); });

let survivants = 0;
try {
    // témoin : le banc est vert sans mutation
    const t = spawnSync(process.execPath, [path.join(__dirname, 'test-webhook-multi.js')], { cwd: __dirname, encoding: 'utf8', timeout: 300000 });
    console.log(`témoin (sans mutation) : code ${t.status} — ${t.status === 0 ? 'vert, attendu' : 'ROUGE : mutants non interprétables'}`);
    if (t.status !== 0) process.exit(2);
    for (const m of MUTANTS) {
        const brut = originaux.get(m.fichier).toString('utf8');
        const n = brut.split(m.de).length - 1;
        if (n !== 1) { console.log(`❌ ${m.nom} : motif trouvé ${n} fois (attendu 1) — mutant invalide`); survivants++; continue; }
        fs.writeFileSync(m.fichier, brut.replace(m.de, () => m.vers));
        const r = spawnSync(process.execPath, [path.join(__dirname, 'test-webhook-multi.js')], { cwd: __dirname, encoding: 'utf8', timeout: 300000 });
        restaurer();
        const echecs = ((r.stdout || '').match(/^❌ .* : /gm) || []).length;
        const tue = r.status !== 0;
        if (!tue) survivants++;
        console.log(`${tue ? '☠️  TUÉ' : '🔴 SURVIVANT'} ${m.nom} (code ${r.status}, ${echecs} assertion(s) en échec)`);
    }
} finally {
    restaurer();
    for (const [f, b] of originaux) if (!fs.readFileSync(f).equals(b)) { console.error(`🔴 ${f} NON restauré`); process.exitCode = 3; }
}
console.log(survivants ? `\n🔴 ${survivants} mutant(s) survivant(s)` : `\n✅ ${MUTANTS.length} mutants, tous tués`);
process.exit(survivants || process.exitCode ? 1 : 0);
