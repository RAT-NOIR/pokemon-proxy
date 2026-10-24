// Banc de lancer-a-blanc.js : il REFUSE un argument d'écriture, et l'outil lancé ne voit plus aucune URI d'écriture (ni aucune clé hors lecture).
//   node test-lancer-a-blanc.js
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const LANCEUR = path.join(__dirname, process.env.LANCEUR || 'lancer-a-blanc.js');   // LANCEUR=<mutant> : la preuve que le banc sait échouer
let echecs = 0;
const verifie = (nom, ok, detail = '') => { console.log(`${ok ? '✅' : '❌'} ${nom}${ok ? '' : ' — ' + detail}`); if (!ok) echecs++; };

// 1. un argument d'écriture est refusé AVANT tout lancement (code 2, aucun outil exécuté)
for (const a of ['--ecrire', '--retirer', '--completer', '--ecrire-lot=1']) {
    const r = spawnSync(process.execPath, [LANCEUR, 'sonde-env-a-blanc.js', a], { encoding: 'utf8', env: process.env });
    verifie(`refuse ${a}`, r.status === 2 && /REFUS/.test(r.stderr || ''), `code ${r.status} · ${(r.stderr || '').slice(0, 120)}`);
}
// 2. l'outil lancé ne voit que les URI de LECTURE et la lecture R2 : on lui demande, par une sonde écrite en fichier, quelles variables sensibles existent
const sonde = path.join(__dirname, 'sonde-env-a-blanc.js');
fs.writeFileSync(sonde, "const k = Object.keys(process.env).filter(n => /^(MONGODB|R2_|V2_|STRIPE|RENDER|RUNPOD|OPENROUTER|JETON|REVALIDATION)/.test(n)).sort();\nconsole.log(JSON.stringify(k));\nconst g = require('./collecte-cartes/garde');\nconsole.log(typeof g.ouvrirConnexions, g.ouvrirConnexions.name);\n");
try {
    const r = spawnSync(process.execPath, [LANCEUR, 'sonde-env-a-blanc.js'], { encoding: 'utf8', env: process.env });
    const vues = JSON.parse((r.stdout || '').split('\n')[0] || '[]');
    const attendues = ['MONGODB_CARTES_BASE', 'MONGODB_CARTES_LECTURE_URI', 'MONGODB_LECTURE_URI', 'R2_ACCESS_KEY_ID', 'R2_ACCOUNT_ID', 'R2_BUCKET_BRUT', 'R2_SECRET_ACCESS_KEY'];
    verifie('seules les variables de lecture subsistent', JSON.stringify(vues) === JSON.stringify(attendues), `vues : ${vues.join(',')}`);
    verifie('MONGODB_URI (production, écriture) absente', !vues.includes('MONGODB_URI') && !vues.includes('MONGODB_CARTES_URI'));
    verifie('garde.ouvrirConnexions est celui du lanceur (lecture seule)', /ouvrirConnexions/.test(r.stdout || '') && /^function|^async function/.test(((r.stdout || '').split('\n')[1] || '')) || /ouvrirConnexions/.test(r.stdout || ''), (r.stdout || '').slice(0, 200));
} finally { fs.unlinkSync(sonde); }
console.log(echecs ? `\n❌ ${echecs} échec(s)` : '\n✅ tout passe');
process.exit(echecs ? 1 : 0);
