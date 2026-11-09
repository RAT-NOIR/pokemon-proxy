'use strict';
// Recupere les scans d'archive MANQUANTS sur le disque depuis NOTRE bucket R2 d'images, en LECTURE SEULE (verifierBucket, lireBinaire ; aucune ecriture), un par un. Aucun autre hote.
//   NODE_PATH=<node_modules de l'API> node recuperer-scans.cjs <dossier-donnees> <dossier-sortie>
// Les identifiants sont lus du .env de l'API DANS ce script et ne sont jamais imprimes. Sortie : <sortie>\<sha1(cle)>.webp, et recuperation.json { recuperees, introuvables }.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const [dossier, sortie] = process.argv.slice(2);
for (const l of fs.readFileSync('C:\\Users\\Yung\\Desktop\\pokemon-proxy-api-v2\\.env', 'utf8').split(/\r?\n/)) {
    const m = /^(R2_ACCOUNT_ID|R2_ACCESS_KEY_ID|R2_SECRET_ACCESS_KEY|R2_BUCKET_IMAGES|R2_ENDPOINT)=(.*)$/.exec(l);
    if (m) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
}
for (const k of ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_IMAGES']) if (!process.env[k]) throw new Error('variable absente : ' + k);
const r2 = require(path.join(__dirname, '..', '..', 'collecte-cartes', 'r2.js'));
const cles = new Set();
for (const f of fs.readdirSync(dossier).filter((x) => /^cles-manquantes-.*\.json$/.test(x))) for (const c of JSON.parse(fs.readFileSync(path.join(dossier, f), 'utf8'))) cles.add(c);
// --toutes : TOUTES les cles de l'index d'empreintes dont le scan manque sur le disque (p8000-quant\images) : un seul passage, plus de tours « une cle de plus a chaque fois »
if (process.argv.includes('--toutes')) {
    const IM = 'C:\\Users\\Yung\\rat-market-travail\\api\\p8000-quant\\images';
    for (const c of JSON.parse(fs.readFileSync('C:\\Users\\Yung\\rat-market-travail\\api\\index-empreintes-essai\\sortie\\cles.json', 'utf8'))) if (!fs.existsSync(path.join(IM, crypto.createHash('sha1').update(c).digest('hex') + '.webp'))) cles.add(c);
}
fs.mkdirSync(sortie, { recursive: true });
(async () => {
    await r2.verifierBucket(process.env.R2_BUCKET_IMAGES);
    const recuperees = [], introuvables = [];
    for (const cle of [...cles].sort()) {
        const nom = crypto.createHash('sha1').update(cle).digest('hex') + '.webp';
        if (fs.existsSync(path.join(sortie, nom))) { recuperees.push(cle); continue; }
        try { const b = await r2.lireBinaire(process.env.R2_BUCKET_IMAGES, cle); if (b && b.length) { fs.writeFileSync(path.join(sortie, nom), b); recuperees.push(cle); } else introuvables.push(cle); }
        catch (e) { introuvables.push(cle + ' (' + String(e.name || e.code || 'erreur').slice(0, 30) + ')'); }
    }
    fs.writeFileSync(path.join(sortie, 'recuperation.json'), JSON.stringify({ cles: cles.size, recuperees, introuvables }, null, 1));
    console.log('cles manquantes', cles.size, 'recuperees', recuperees.length, 'introuvables', introuvables.length, introuvables.slice(0, 5));
    process.exit(0);
})().catch((e) => { console.error('ERREUR', String(e.message || e).slice(0, 200)); process.exit(1); });
