// ============================================================
// PLUSIEURS COMMANDES EN UN LOT — pour lot-additif.js : une sauvegarde, une garde, N gestes
// ============================================================
//   node lot-additif.js --quoi="…" --collections=… -- node enchainer-commandes.js "node a.js --ecrire" ";;" "node b.js --ecrire"
//
// Les commandes tournent l'une après l'autre, dans le dossier du dépôt ; la PREMIÈRE qui sort en erreur arrête la suite, et
// lot-additif juge alors ce qui a été écrit (baisse non annoncée → restauration de tout le lot). Seul `node <script du dépôt>`
// est autorisé : une ligne de commande s'écrit par ce qu'elle autorise (§54).
const { spawnSync } = require('child_process');
const fs = require('fs'), path = require('path');
const commandes = process.argv.slice(2).join(' ').split(';;').map(s => s.trim()).filter(Boolean).map(c => c.split(/\s+/));
const refusees = commandes.filter(([exe, script]) => exe !== 'node' || !script || !fs.existsSync(path.join(__dirname, script)) || path.dirname(path.resolve(__dirname, script)) !== __dirname);
if (!commandes.length || refusees.length) { console.error(`❌ usage : "node <script du dépôt> …" ";;" "node …" — refusées : ${refusees.map(c => c.join(' ')).join(' | ') || '(aucune commande)'}`); process.exit(2); }
for (const [i, [exe, ...args]] of commandes.entries()) {
    console.log(`\n▶▶ ${i + 1}/${commandes.length} · ${[exe, ...args].join(' ')} · ${new Date().toISOString()}`);
    const r = spawnSync(exe, args, { cwd: __dirname, stdio: 'inherit' });
    if (r.status !== 0) { console.error(`\n⛔ commande ${i + 1} sortie avec le code ${r.status} : arrêt, non lancées : ${commandes.slice(i + 1).map(c => c.join(' ')).join(' | ') || '(aucune)'}`); process.exit(1); }
}
console.log(`\n✅ ${commandes.length} commandes passées`);
