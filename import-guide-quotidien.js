// ============================================================================
// L'IMPORT QUOTIDIEN DU GUIDE DES PRIX — à lancer par une tâche planifiée (ordre du testeur, 2026-10-03 : « il se télécharge sans
// connexion en fenêtre privée. Automatise l'import quotidien. »)
// ============================================================================
//   node import-guide-quotidien.js --base=test --confirmer-production          (la tâche planifiée : Render Cron Job, une fois par jour)
//   node import-guide-quotidien.js --base=test_scratch --url=<fichier de test>  (le banc : test-import-guide-quotidien.js)
// CE QU'IL FAIT, DANS CET ORDRE, ET IL S'ARRÊTE AU PREMIER NON :
//   0. vérifie les variables, puis que la base et le bucket RÉPONDENT — un non ici ne coûte aucune requête à Cardmarket ;
//   1. télécharge `price_guide_6.json` (6 = Pokémon) — UNE requête CONDITIONNELLE (le guide déjà traité rend 304 sans corps : « rien de
//      neuf », aucun téléchargement — requete-conditionnelle.js), plafond de taille, délai borné ; le fichier part aussitôt sur le
//      disque temporaire (la mémoire ne garde pas le brut ET l'objet ET la sauvegarde à la fois — relecture du 2026-10-03 : ~80 000
//      lignes, une tâche Render à 512 Mo) ;
//   2. le JUGE avant d'écrire quoi que ce soit : JSON lisible, `createdAt` daté et PAS DANS LE FUTUR (un guide daté de demain poserait
//      une méta que tous les vrais guides suivants trouveraient « pas plus récente » : un import arrêté en silence), `priceGuides` non vide ;
//      PAS PLUS RÉCENT que le guide en base -> « rien de neuf », sortie 0 — la référence est CELLE de l'importeur (la méta, à défaut le
//      dernier `majAt` daté), sans quoi les deux pourraient se contredire et la tâche échouer chaque jour ; MOINS de 90 % des lignes du
//      dernier guide importé -> refus (un fichier tronqué) ; moins de 85 % des lignes avec un prix (`trend` ou `avg` numérique), ou un taux
//      qui chute de plus de 3 points sur celui du dernier guide (méta.tauxPrix) -> refus (taux-prix-guide.js) ;
//   3. SAUVEGARDE le guide en base AVANT de l'écrire : une ligne Extended JSON par document (la méta `guide_prix_meta` en tête), en flux,
//      compressée, sur R2 (`sauvegardes/guide_prix/<base>/<horodatage>.ndjson.gz`, bucket R2_BUCKET_BRUT), puis RELUE (nombre de lignes) ;
//      sauvegarde impossible ou relue fausse -> rien n'est importé. Restaurer = relire chaque ligne et la réécrire (EJSON garde les dates) ;
//   4. importe par `import-price-guide.js`, LA MÊME commande que l'import à la main (une seule définition de l'import et de ses gardes).
// ⚠️ C'EST UNE ÉCRITURE QUI MODIFIE (les prix), AUTORISÉE UNE FOIS POUR TOUTES par l'ordre du testeur ci-dessus, pour ce seul fichier.
// Le guide sert l'API et l'extension, JAMAIS le site. Aucune requête Cardmarket d'aucune autre sorte ; jamais `perSite`.
require('dotenv').config();
const fs = require('fs'), os = require('os'), path = require('path'), zlib = require('zlib');
const { spawnSync } = require('child_process');

const { jugerTauxPrix, porteUnPrix } = require('./collecte-cartes/taux-prix-guide');
const URL_GUIDE ='https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_6.json';
const TAILLE_MAX = 120 * 1024 * 1024;
const AUTORISES = [/^--base=(test|test_scratch)$/, /^--confirmer-production$/, /^--url=https?:\/\/.+$/];

/** La ligne de commande, par ce qu'elle AUTORISE. Rend { base, url } ou { erreur } — pure, testée sans lancer le script. */
function lireArguments(argv) {
    const inconnus = argv.filter(a => !AUTORISES.some(r => r.test(a)));
    const base = argv.find(a => a.startsWith('--base='))?.slice(7);
    if (inconnus.length || !base) return { erreur: `usage : node import-guide-quotidien.js --base=test --confirmer-production${inconnus.length ? ` — argument inconnu : ${inconnus.join(' ')}` : ''}` };
    if (base === 'test' && !argv.includes('--confirmer-production')) return { erreur: '--base=test exige --confirmer-production' };
    const url = argv.find(a => a.startsWith('--url='))?.slice(6) || URL_GUIDE;
    if (base === 'test' && url !== URL_GUIDE) return { erreur: 'en production, seul le fichier de Cardmarket s\'importe' };
    return { base, url };
}

const horodatage = () => new Date().toISOString().replace(/[:.]/g, '-');

async function main() {
    const A = lireArguments(process.argv.slice(2));
    if (A.erreur) { console.error(`❌ ${A.erreur}`); process.exit(2); }
    const { base: BASE, url: URL } = A;
    // 0. la configuration, AVANT la requête : une variable absente ne coûte pas un téléchargement (collecte-cartes/variables-requises.js)
    require('./collecte-cartes/variables-requises').exigerVariables('import-guide-quotidien.js');
    const axios = require('axios');
    const mongoose = require('mongoose');
    const { EJSON } = require('bson');

    // 0 bis. la base et le bucket JOIGNABLES, eux aussi avant la requête (relecture du 2026-10-08) : une variable PRÉSENTE n'est pas
    // une grappe qui répond — une adresse refusée par Atlas ou un bucket faux coûtaient encore un téléchargement par essai
    let cx;
    try { cx = await mongoose.createConnection(process.env.MONGODB_URI, { dbName: BASE }).asPromise(); }
    catch (e) { console.error(`❌ base « ${BASE} » injoignable (${String(e.message).replace(/mongodb(\+srv)?:\/\/\S+/g, '<uri masquée>').slice(0, 200)}) — aucune requête vers Cardmarket`); process.exit(1); }
    const fichier = path.join(os.tmpdir(), `price_guide_quotidien_${process.pid}.json`);
    const sortir = async code => { fs.rmSync(fichier, { force: true }); await cx.close(); process.exit(code); };
    if (cx.db.databaseName !== BASE) { console.error(`❌ base connectée « ${cx.db.databaseName} », attendue « ${BASE} »`); await sortir(2); }
    const bucket = process.env.R2_BUCKET_BRUT;
    const r2 = require('./collecte-cartes/r2');
    try { await r2.verifierBucket(bucket); }
    catch (e) { console.error(`❌ R2 : le bucket ${bucket} ne répond pas (${e.name || e.message}) — pas de sauvegarde possible, aucune requête vers Cardmarket`); await sortir(1); }

    const META = cx.db.collection('guide_prix_meta');
    const meta = await META.findOne({ _id: 'dernier' });

    // 1. le fichier, aussitôt sur le disque. Requête CONDITIONNELLE (testeur, 2026-10-08) : le guide déjà traité rend 304, sans corps —
    // aucun téléchargement (collecte-cartes/requete-conditionnelle.js)
    const RC = require('./collecte-cartes/requete-conditionnelle');
    const conditions = RC.entetesConditionnels(meta?.http);
    console.log(`téléchargement : ${URL}${Object.keys(conditions).length ? ' (conditionnel : ETag du dernier guide traité)' : ''}`);
    const r = await axios.get(URL, { responseType: 'arraybuffer', timeout: 180000, maxContentLength: TAILLE_MAX, maxBodyLength: TAILLE_MAX, validateStatus: RC.statutAccepte, headers: { 'User-Agent': 'rat-market-guide-prix/1.0 (import quotidien, une requete par jour)', ...conditions } });
    if (r.status === 304) { console.log(`ℹ️ rien de neuf : 304, le guide n'a pas changé depuis le dernier traité (guide du ${meta?.guideDu ? new Date(meta.guideDu).toISOString() : '?'}) — aucun téléchargement`); await sortir(0); }
    const http = RC.validateursDe(r.headers);
    fs.writeFileSync(fichier, Buffer.from(r.data));
    const octets = r.data.byteLength;
    // les mesures du fichier, puis l'objet est LÂCHÉ (seuls les nombres survivent)
    let guideDu, lignes, avecPrix;
    {
        let data;
        try { data = JSON.parse(fs.readFileSync(fichier, 'utf8')); } catch { console.error(`❌ fichier illisible (${octets} octets, pas du JSON) : rien n'est importé`); await sortir(1); }
        guideDu = new Date(data.createdAt);
        if (!Array.isArray(data.priceGuides) || !data.priceGuides.length || Number.isNaN(guideDu.getTime())) { console.error(`❌ pas de priceGuides ou pas de createdAt lisible (${data.createdAt}) : rien n'est importé`); await sortir(1); }
        lignes = data.priceGuides.length;
        avecPrix = data.priceGuides.filter(porteUnPrix).length;
    }
    console.log(`fichier : ${(octets / 1e6).toFixed(1)} Mo · ${lignes} lignes · ${avecPrix} avec un prix · guide du ${guideDu.toISOString()}`);
    if (guideDu.getTime() > Date.now() + 24 * 3600 * 1000) { console.error(`❌ guide daté du ${guideDu.toISOString()}, dans le FUTUR : rien n'est importé`); await sortir(1); }

    // 2. les juges, avant toute écriture
    // LA RÉFÉRENCE DE L'IMPORTEUR (import-price-guide.js) : la méta, à défaut le plus récent `majAt` DATÉ
    const dernierImport = (await cx.db.collection('guide_prix').find({ majAt: { $type: 'date' } }, { projection: { majAt: 1 } }).sort({ majAt: -1 }).limit(1).toArray())[0]?.majAt ?? null;
    const reference = meta?.guideDu ?? dernierImport;
    if (reference && guideDu <= new Date(reference)) {
        // jugé « rien de neuf » : ses validateurs se gardent sur la méta existante (jamais créée ici), le prochain passage rendra 304
        if (http && meta) await META.updateOne({ _id: 'dernier' }, { $set: { http } });
        console.log(`ℹ️ rien de neuf : le fichier est du ${guideDu.toISOString()}, la référence en base du ${new Date(reference).toISOString()}${meta?.guideDu ? '' : ' (dernier import, pas de méta)'}`); await sortir(0);
    }
    if (meta?.lignesDuFichier && lignes < 0.9 * meta.lignesDuFichier) { console.error(`❌ ${lignes} lignes contre ${meta.lignesDuFichier} au dernier guide (< 90 %) : fichier tronqué ? rien n'est importé`); await sortir(1); }
    // LA règle du taux (testeur, 2026-10-08) : 85 % fixe ET pas de chute de plus de 3 points sur le taux du dernier guide (méta.tauxPrix ;
    // absent tant qu'aucun import n'a posé le taux : seul le seuil joue) — collecte-cartes/taux-prix-guide.js
    const jugement = jugerTauxPrix({ avecPrix, lignes, tauxDernier: meta?.tauxPrix });
    if (!jugement.passe) { console.error(`❌ ${jugement.raison} : rien n'est importé`); await sortir(1); }
    console.log(`✅ taux de lignes avec un prix : ${jugement.raison}`);

    // 3. la sauvegarde, en flux : une ligne EJSON par document, la méta en tête, gzip ; puis relue (le bucket a répondu à l'étape 0 bis)
    const gz = zlib.createGzip(), morceaux = [];
    gz.on('data', c => morceaux.push(c));
    const fin = new Promise((ok, ko) => { gz.on('end', ok); gz.on('error', ko); });
    gz.write(EJSON.stringify({ _meta: meta ?? null }, { relaxed: false }) + '\n');
    let n = 0;
    for await (const d of cx.db.collection('guide_prix').find({})) { if (!gz.write(EJSON.stringify(d, { relaxed: false }) + '\n')) await new Promise(ok => gz.once('drain', ok)); n++; }
    gz.end(); await fin;
    const archive = Buffer.concat(morceaux);
    const cle = `sauvegardes/guide_prix/${BASE}/${horodatage()}.ndjson.gz`;
    await r2.deposerBinaire(bucket, cle, archive, 'application/gzip');
    let relues = -1;
    {
        const texte = zlib.gunzipSync(await r2.lireBinaire(bucket, cle)).toString('utf8');
        relues = 0; for (let i = texte.indexOf('\n'); i !== -1; i = texte.indexOf('\n', i + 1)) relues++;
        relues -= 1;   // la ligne de méta
    }
    if (relues !== n) { console.error(`❌ sauvegarde relue : ${relues} lignes pour ${n} — rien n'est importé`); await sortir(1); }
    console.log(`✅ sauvegarde : ${n} lignes + méta, ${(archive.length / 1e6).toFixed(1)} Mo -> R2 ${bucket}/${cle} (relue)`);
    await cx.close();

    // 4. l'import, par la commande de toujours
    const args = [path.join(__dirname, 'import-price-guide.js'), fichier, `--base=${BASE}`, ...(BASE === 'test' ? ['--confirmer-production'] : [])];
    const res = spawnSync(process.execPath, args, { stdio: 'inherit', env: process.env });
    fs.rmSync(fichier, { force: true });
    // 5. le guide IMPORTÉ garde ses validateurs (et lui seul : la méta doit porter CE guide) — un échec ici ne défait pas l'import,
    // il coûtera seulement un téléchargement complet au prochain passage
    if (res.status === 0 && http) {
        try {
            const cx2 = await mongoose.createConnection(process.env.MONGODB_URI, { dbName: BASE }).asPromise();
            const u = await cx2.db.collection('guide_prix_meta').updateOne({ _id: 'dernier', guideDu }, { $set: { http } });
            await cx2.close();
            console.log(`${u.matchedCount ? '✅ validateurs HTTP gardés' : '⚠️ la méta ne porte pas ce guide : validateurs NON gardés'} (prochain passage ${u.matchedCount ? 'conditionnel' : 'complet'})`);
        } catch (e) { console.error(`⚠️ validateurs HTTP non gardés (${String(e.message).replace(/mongodb(\+srv)?:\/\/\S+/g, '<uri masquée>').slice(0, 120)}) : le prochain passage retéléchargera`); }
    }
    // 6. L'HISTORIQUE DE VALEUR DES SETS (testeur, 2026-10-08) — seulement après un import RÉUSSI (un « rien de neuf » est sorti plus haut, et un
    // guide déjà historisé ne réécrit rien). Il ne peut JAMAIS faire échouer l'import : historiserApresImport ne lève pas, le code de sortie reste
    // celui de l'import. collecte-cartes/historique-valeur.js
    if (res.status === 0) {
        try { await require('./collecte-cartes/historique-valeur').historiserApresImport({ base: BASE, mongoose, r2 }); }
        catch (e) { console.error(`⚠️ historique de valeur NON écrit (l'import du guide, lui, a réussi) : ${String(e.message).slice(0, 200)}`); }
    }
    process.exit(res.status ?? 1);
}

module.exports = { lireArguments, URL_GUIDE };
if (require.main === module) main().catch(e => { console.error(`❌ ${e.response ? `HTTP ${e.response.status}` : e.message}`); process.exit(1); });
