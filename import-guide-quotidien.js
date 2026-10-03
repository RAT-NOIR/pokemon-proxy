// ============================================================================
// L'IMPORT QUOTIDIEN DU GUIDE DES PRIX — à lancer par une tâche planifiée (ordre du testeur, 2026-10-03 : « il se télécharge sans
// connexion en fenêtre privée. Automatise l'import quotidien. »)
// ============================================================================
//   node import-guide-quotidien.js --base=test --confirmer-production          (la tâche planifiée : Render Cron Job, une fois par jour)
//   node import-guide-quotidien.js --base=test_scratch --url=<fichier de test>  (le banc : test-import-guide-quotidien.js)
// CE QU'IL FAIT, DANS CET ORDRE, ET IL S'ARRÊTE AU PREMIER NON :
//   1. télécharge `price_guide_6.json` (6 = Pokémon) — UNE requête, plafond de taille, délai borné ;
//   2. le JUGE avant d'écrire quoi que ce soit : JSON lisible, `createdAt` daté, `priceGuides` non vide ; PAS PLUS RÉCENT que le guide en
//      base -> « rien de neuf », sortie 0 (une tâche quotidienne qui tourne deux fois le même jour n'est pas en panne) ; MOINS de 90 % des
//      lignes du dernier guide importé -> refus (un fichier tronqué réécrirait des prix sur une partie du catalogue et laisserait le reste
//      daté d'hier sans rien dire) ; moins de 90 % des lignes avec un prix (`trend` ou `avg` numérique) -> refus ;
//   3. SAUVEGARDE le guide en base AVANT de l'écrire : tout `guide_prix` en Extended JSON compressé, sur R2
//      (`sauvegardes/guide_prix/<base>/<horodatage>.json.gz`, bucket R2_BUCKET_BRUT) — une tâche planifiée n'a pas de disque qui survive ;
//      sauvegarde impossible -> rien n'est importé. Restaurer = relire ce fichier et réécrire chaque ligne (EJSON garde les dates) ;
//   4. importe par `import-price-guide.js`, LA MÊME commande que l'import à la main (lancée telle quelle : une seule définition de
//      l'import, ses gardes comprises — refus d'un guide pas plus récent, méta posée seulement si la relecture concorde).
// ⚠️ C'EST UNE ÉCRITURE QUI MODIFIE (les prix), AUTORISÉE UNE FOIS POUR TOUTES par l'ordre du testeur ci-dessus, pour ce seul fichier.
// Le guide sert l'API et l'extension, JAMAIS le site. Aucune requête Cardmarket d'aucune autre sorte ; jamais `perSite`.
require('dotenv').config();
const fs = require('fs'), os = require('os'), path = require('path'), zlib = require('zlib');
const { spawnSync } = require('child_process');
const axios = require('axios');
const mongoose = require('mongoose');
const { EJSON } = require('bson');

const URL_GUIDE = 'https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_6.json';
const TAILLE_MAX = 120 * 1024 * 1024;
const AUTORISES = [/^--base=(test|test_scratch)$/, /^--confirmer-production$/, /^--url=https?:\/\/.+$/];
const inconnus = process.argv.slice(2).filter(a => !AUTORISES.some(r => r.test(a)));
const BASE = process.argv.find(a => a.startsWith('--base='))?.slice(7);
if (inconnus.length || !BASE) { console.error(`Usage : node import-guide-quotidien.js --base=test --confirmer-production${inconnus.length ? `\n❌ argument inconnu : ${inconnus.join(' ')}` : ''}`); process.exit(2); }
if (BASE === 'test' && !process.argv.includes('--confirmer-production')) { console.error('❌ --base=test exige --confirmer-production'); process.exit(2); }
const URL = process.argv.find(a => a.startsWith('--url='))?.slice(6) || URL_GUIDE;
if (BASE === 'test' && URL !== URL_GUIDE) { console.error('❌ en production, seul le fichier de Cardmarket s\'importe'); process.exit(2); }

const horodatage = () => new Date().toISOString().replace(/[:.]/g, '-');

async function main() {
    // 1. le fichier
    console.log(`téléchargement : ${URL}`);
    const r = await axios.get(URL, { responseType: 'arraybuffer', timeout: 180000, maxContentLength: TAILLE_MAX, maxBodyLength: TAILLE_MAX, headers: { 'User-Agent': 'rat-market-guide-prix/1.0 (import quotidien, une requete par jour)' } });
    const brut = Buffer.from(r.data);
    let data;
    try { data = JSON.parse(brut.toString('utf8')); } catch { console.error(`❌ fichier illisible (${brut.length} octets, pas du JSON) : rien n'est importé`); process.exit(1); }
    const guides = data.priceGuides, guideDu = new Date(data.createdAt);
    if (!Array.isArray(guides) || !guides.length || Number.isNaN(guideDu.getTime())) { console.error(`❌ pas de priceGuides ou pas de createdAt lisible (${data.createdAt}) : rien n'est importé`); process.exit(1); }
    const avecPrix = guides.filter(g => Number.isFinite(g.trend) || Number.isFinite(g.avg)).length;
    console.log(`fichier : ${(brut.length / 1e6).toFixed(1)} Mo · ${guides.length} lignes · ${avecPrix} avec un prix · guide du ${guideDu.toISOString()}`);

    // 2. les juges, avant toute écriture
    const cx = await mongoose.createConnection(process.env.MONGODB_URI, { dbName: BASE }).asPromise();
    if (cx.db.databaseName !== BASE) { console.error(`❌ base connectée « ${cx.db.databaseName} », attendue « ${BASE} »`); process.exit(2); }
    const meta = await cx.db.collection('guide_prix_meta').findOne({ _id: 'dernier' });
    if (meta?.guideDu && guideDu <= new Date(meta.guideDu)) { console.log(`ℹ️ rien de neuf : le fichier est du ${guideDu.toISOString()}, le guide en base du ${new Date(meta.guideDu).toISOString()}`); await cx.close(); process.exit(0); }
    if (meta?.lignesDuFichier && guides.length < 0.9 * meta.lignesDuFichier) { console.error(`❌ ${guides.length} lignes contre ${meta.lignesDuFichier} au dernier guide (< 90 %) : fichier tronqué ? rien n'est importé`); await cx.close(); process.exit(1); }
    if (avecPrix < 0.9 * guides.length) { console.error(`❌ ${avecPrix} lignes sur ${guides.length} portent un prix (< 90 %) : rien n'est importé`); await cx.close(); process.exit(1); }

    // 3. la sauvegarde du guide en base, sur R2 — obligatoire, et faite AUSSI sur test_scratch (sous son préfixe) pour que le banc
    //    exerce ce chemin : une sauvegarde qu'aucun banc ne fait tourner est une sauvegarde qu'on croit avoir (§47).
    {
        const r2 = require('./collecte-cartes/r2');
        const bucket = process.env.R2_BUCKET_BRUT;
        if (!bucket) { console.error('❌ R2_BUCKET_BRUT absent : pas de sauvegarde possible, rien n\'est importé'); await cx.close(); process.exit(1); }
        await r2.verifierBucket(bucket);
        const docs = await cx.db.collection('guide_prix').find({}).toArray();
        const gz = zlib.gzipSync(Buffer.from(EJSON.stringify(docs, { relaxed: false })));
        const cle = `sauvegardes/guide_prix/${BASE}/${horodatage()}.json.gz`;
        await r2.deposerBinaire(bucket, cle, gz, 'application/gzip');
        const relu = await r2.lireBinaire(bucket, cle);
        const nRelu = EJSON.parse(zlib.gunzipSync(relu).toString('utf8')).length;
        if (nRelu !== docs.length) { console.error(`❌ sauvegarde relue : ${nRelu} lignes pour ${docs.length} — rien n'est importé`); await cx.close(); process.exit(1); }
        console.log(`✅ sauvegarde : ${docs.length} lignes, ${(gz.length / 1e6).toFixed(1)} Mo -> R2 ${bucket}/${cle} (relue)`);
    }
    await cx.close();

    // 4. l'import, par la commande de toujours
    const fichier = path.join(os.tmpdir(), `price_guide_${guideDu.toISOString().slice(0, 10)}.json`);
    fs.writeFileSync(fichier, brut);
    const args = [path.join(__dirname, 'import-price-guide.js'), fichier, `--base=${BASE}`, ...(BASE === 'test' ? ['--confirmer-production'] : [])];
    const res = spawnSync(process.execPath, args, { stdio: 'inherit', env: process.env });
    fs.rmSync(fichier, { force: true });
    process.exit(res.status ?? 1);
}

main().catch(e => { console.error(`❌ ${e.response ? `HTTP ${e.response.status}` : e.message}`); process.exit(1); });
