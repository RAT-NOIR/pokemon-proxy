// ============================================================================
// LE TÉLÉCHARGEMENT QUOTIDIEN DE L'EXPORT CARDMARKET — à lancer par une tâche planifiée (ordre du testeur, 2026-10-05 :
// « l'export du 04/10 n'est PAS sur mon disque : le site l'a téléchargé lui-même. Automatise son téléchargement quotidien,
// comme pour le guide des prix. »)
// ============================================================================
//   node import-catalogue-quotidien.js --base=test --confirmer-production [--sortie=<fichier.json>]   (la tâche : Render Cron Job, 1×/jour)
//   node import-catalogue-quotidien.js --base=test_scratch --collection=<nom> --url=<fichier de test>   (le banc : test-import-catalogue-quotidien.js)
// L'adresse est celle que le site lit lui-même (rat-market-site/scripts/mesurer-expansions-cardmarket.mjs:41). Une requête par jour,
// ce fichier et lui seul : c'est l'unique exception à « aucune requête de ma part vers Cardmarket » (accord du testeur, 2026-10-05).
// CE QU'IL FAIT, DANS CET ORDRE, ET IL S'ARRÊTE AU PREMIER NON (sortie 1, rien d'écrit après le non) :
//   0. vérifie les variables, puis que la base et le bucket RÉPONDENT — un non ici ne coûte aucune requête à Cardmarket ;
//   1. télécharge `products_singles_6.json` (6 = Pokémon) — UNE requête, aucune redirection suivie, plafond de taille, délai borné ;
//      CONDITIONNELLE : le fichier déjà traité rend 304 sans corps -> « rien de neuf », aucun téléchargement (requete-conditionnelle.js) ;
//   2. le JUGE avant d'écrire quoi que ce soit : JSON objet lisible, `createdAt` daté et pas dans le futur (2 h de marge),
//      `products` dont 99 % des lignes ont la forme attendue — les autres sont COMPTÉES et jamais écrites ; PAS PLUS RÉCENT que le
//      dernier export archivé -> « rien de neuf », sortie 0 ; plus ancien que les produits déjà en collection -> refus ;
//   3. juge la COLLECTION (jugerCollection, pure) : en production elle n'est jamais vide, et elle porte au moins 90 % du dernier
//      export archivé ; le fichier porte au moins 90 % de la collection (ou du dernier export) — sinon : tronqué, mauvaise grappe ;
//   4. ARCHIVE le fichier brut sur R2 (`exports-cardmarket/<base>/products_singles_6/<createdAt>.json.gz`), RELU OCTET POUR OCTET :
//      l'export ne manque plus jamais, et §56 (integrer-export.js) l'intègre depuis là ;
//   5. le DIFF contre la collection : nouveaux, noms changés, idExpansion changées, idMetacard changés, disparus — archivé à côté ;
//   6. s'il y a des NOUVEAUX : SAUVEGARDE de la collection sur R2, relue, puis INSERTION des seuls nouveaux (`$setOnInsert`), une
//      écriture ADDITIVE (feu vert permanent). Le compte inséré doit tomber juste, sinon sortie 1 et la méta n'avance pas : le
//      lendemain refait le diff et reprend (l'insertion est idempotente). ⚠️ UN NOM, UNE EXPANSION, UNE MÉTACARTE CHANGÉS NE
//      S'ÉCRIVENT PAS ICI : ce sont des écritures qui MODIFIENT, elles attendent le feu vert du testeur et passent par
//      integrer-export.js (§56). Elles sont comptées dans `catalogue_export_meta.enAttente` ;
//   7. la méta (`catalogue_export_meta`), écrite EN DERNIER — seul ce qui a réussi la fait avancer ;
//   8. imprime les expansions qui reçoivent des produits (l'apprentissage du slug et des numéros n'est PAS fait ici : c'est une
//      navigation sur les pages de Cardmarket, hors de l'exception accordée).
require('dotenv').config();
const fs = require('fs'), path = require('path'), zlib = require('zlib'), crypto = require('crypto');

const URL_EXPORT = 'https://downloads.s3.cardmarket.com/productCatalog/productList/products_singles_6.json';
const TAILLE_MAX = 80 * 1024 * 1024;
const MARGE_FUTUR_MS = 2 * 3600 * 1000;
const AUTORISES = [/^--base=(test|test_scratch)$/, /^--confirmer-production$/, /^--url=https?:\/\/.+$/, /^--sortie=.+$/, /^--collection=[a-z_]+$/];

/** La ligne de commande, par ce qu'elle AUTORISE. Rend { base, url, sortie, collection } ou { erreur } — pure, testée sans lancer le script. */
function lireArguments(argv) {
    const inconnus = argv.filter(a => !AUTORISES.some(r => r.test(a)));
    const base = argv.find(a => a.startsWith('--base='))?.slice(7);
    if (inconnus.length || !base) return { erreur: `usage : node import-catalogue-quotidien.js --base=test --confirmer-production [--sortie=<fichier>]${inconnus.length ? ` — argument inconnu : ${inconnus.join(' ')}` : ''}` };
    if (base === 'test' && !argv.includes('--confirmer-production')) return { erreur: '--base=test exige --confirmer-production' };
    const url = argv.find(a => a.startsWith('--url='))?.slice(6) || URL_EXPORT;
    if (base === 'test' && url !== URL_EXPORT) return { erreur: 'en production, seul le fichier de Cardmarket se télécharge' };
    const collection = argv.find(a => a.startsWith('--collection='))?.slice(13) || 'catalogue_produits';
    if (base === 'test' && collection !== 'catalogue_produits') return { erreur: 'en production, la collection est catalogue_produits et elle seule' };
    const sortie = argv.find(a => a.startsWith('--sortie='))?.slice(9) || null;
    return { base, url, sortie, collection };
}

/** Une ligne de l'export a-t-elle la forme que l'import lit ? */
const ligneValide = p => p != null && typeof p === 'object' && Number.isInteger(p.idProduct) && typeof p.name === 'string' && p.name.length > 0 && Number.isInteger(p.idExpansion) && Number.isInteger(p.idMetacard);

/**
 * La collection et le fichier sont-ils dignes d'une écriture ? Pure. Une garde écrite par ce qu'elle AUTORISE : rend null (passe)
 * ou la raison du refus.
 * 🔑 « Une base réelle n'est jamais vide » (§50) : en production, une collection vide est une mauvaise grappe ou une collection
 * vidée, jamais un premier jour — et y insérer 75 000 produits en croyant ajouter les nouveaux serait le pire des replis.
 */
function jugerCollection({ base, enCollection, lignesFichier, meta }) {
    if (base === 'test' && !(enCollection > 0)) return `collection vide en production (${enCollection}) : mauvaise grappe ou collection vidée`;
    if (meta?.lignesDuFichier && enCollection < 0.9 * meta.lignesDuFichier) return `${enCollection} produits en collection contre ${meta.lignesDuFichier} au dernier export archivé (< 90 %) : collection amputée ?`;
    const reference = Math.max(meta?.lignesDuFichier ?? 0, enCollection);
    if (reference && lignesFichier < 0.9 * reference) return `${lignesFichier} produits valides contre ${reference} ${reference === enCollection ? 'en collection' : 'au dernier export'} (< 90 %) : fichier tronqué ?`;
    return null;
}

/** Le diff de l'export contre la collection — pur. `produits` : lignes VALIDES ; `enBase` : Map idProduct -> { name, idExpansion, idMetacard }. */
function diffExport(produits, enBase) {
    const nouveaux = new Map(), noms = [], expansions = [], metacards = [];
    const vus = new Set();
    let doublons = 0;
    for (const p of produits) {
        if (vus.has(p.idProduct)) { doublons++; continue; }   // un idProduct deux fois dans le fichier : la première ligne fait foi
        vus.add(p.idProduct);
        const b = enBase.get(p.idProduct);
        if (!b) { nouveaux.set(p.idProduct, p); continue; }
        if (b.name !== p.name) noms.push({ idProduct: p.idProduct, avant: b.name, apres: p.name, idExpansion: p.idExpansion });
        if (b.idExpansion !== p.idExpansion) expansions.push({ idProduct: p.idProduct, avant: b.idExpansion, apres: p.idExpansion, nom: p.name });
        if (b.idMetacard !== p.idMetacard) metacards.push({ idProduct: p.idProduct, avant: b.idMetacard, apres: p.idMetacard });
    }
    const disparus = [...enBase.keys()].filter(id => !vus.has(id));
    return { nouveaux: [...nouveaux.values()], noms, expansions, metacards, disparus, doublons };
}

const horodatage = d => d.toISOString().replace(/[:.]/g, '-');
const sha256 = b => crypto.createHash('sha256').update(b).digest('hex');

async function main() {
    const A = lireArguments(process.argv.slice(2));
    if (A.erreur) { console.error(`❌ ${A.erreur}`); process.exit(2); }
    const { base: BASE, url: URL, sortie: SORTIE, collection: COLL } = A;
    // 0. la configuration, AVANT la requête : une variable absente ne coûte pas un téléchargement (collecte-cartes/variables-requises.js)
    require('./collecte-cartes/variables-requises').exigerVariables('import-catalogue-quotidien.js');
    const axios = require('axios');
    const mongoose = require('mongoose');
    const { EJSON } = require('bson');
    const { estDateValide } = require('./import-catalogue');

    // 0 bis. la base et le bucket JOIGNABLES, eux aussi avant la requête (relecture du 2026-10-08) : une variable PRÉSENTE n'est pas
    // une grappe qui répond — une adresse refusée par Atlas ou un bucket faux coûtaient encore un téléchargement par essai
    let cx;
    try { cx = await mongoose.createConnection(process.env.MONGODB_URI, { dbName: BASE }).asPromise(); }
    catch (e) { console.error(`❌ base « ${BASE} » injoignable (${String(e.message).replace(/mongodb(\+srv)?:\/\/\S+/g, '<uri masquée>').slice(0, 200)}) — aucune requête vers Cardmarket`); process.exit(1); }
    const sortir = async code => { await cx.close(); process.exit(code); };
    const bucket = process.env.R2_BUCKET_BRUT;
    const r2 = require('./collecte-cartes/r2');
    try { await r2.verifierBucket(bucket); }
    catch (e) { console.error(`❌ R2 : le bucket ${bucket} ne répond pas (${e.name || e.message}) — ni archive ni sauvegarde possibles, aucune requête vers Cardmarket`); return await sortir(1); }

    const C = cx.db.collection(COLL), META = cx.db.collection('catalogue_export_meta');
    const metaId = COLL === 'catalogue_produits' ? 'dernier' : `dernier:${COLL}`;
    const meta = await META.findOne({ _id: metaId });

    // 1. le fichier — aucune redirection suivie : seule l'adresse autorisée répond. Requête CONDITIONNELLE (testeur, 2026-10-08) :
    // le fichier déjà traité rend 304, sans corps — aucun téléchargement (collecte-cartes/requete-conditionnelle.js)
    const RC = require('./collecte-cartes/requete-conditionnelle');
    const conditions = RC.entetesConditionnels(meta?.http);
    console.log(`téléchargement : ${URL}${Object.keys(conditions).length ? ' (conditionnel : ETag du dernier fichier traité)' : ''}`);
    const r = await axios.get(URL, { responseType: 'arraybuffer', timeout: 180000, maxRedirects: 0, maxContentLength: TAILLE_MAX, maxBodyLength: TAILLE_MAX, validateStatus: RC.statutAccepte, headers: { 'User-Agent': 'rat-market-catalogue/1.0 (export quotidien, une requete par jour)', ...conditions } });
    if (r.status === 304) { console.log(`ℹ️ rien de neuf : 304, le fichier n'a pas changé depuis le dernier traité (export du ${meta?.exportDu ? new Date(meta.exportDu).toISOString() : '?'}) — aucun téléchargement`); return await sortir(0); }
    const http = RC.validateursDe(r.headers);
    const brut = Buffer.isBuffer(r.data) ? r.data : Buffer.from(r.data);
    const empreinte = sha256(brut);

    // 2. les juges du fichier, avant toute écriture
    let data;
    try { data = JSON.parse(brut.toString('utf8')); } catch { data = null; }
    if (!data || typeof data !== 'object' || Array.isArray(data)) { console.error(`❌ fichier illisible (${brut.length} octets, pas un objet JSON) : rien n'est écrit`); return await sortir(1); }
    const exportDu = new Date(data.createdAt);
    const tous = Array.isArray(data.products) ? data.products : [];
    if (!tous.length || Number.isNaN(exportDu.getTime())) { console.error(`❌ pas de products ou pas de createdAt lisible (${data.createdAt}) : rien n'est écrit`); return await sortir(1); }
    const produits = tous.filter(ligneValide);
    const informes = tous.length - produits.length;
    data = null;   // seules les lignes valides survivent (mémoire : une tâche Render à 512 Mo)
    console.log(`fichier : ${(brut.length / 1e6).toFixed(1)} Mo · ${tous.length} lignes · ${produits.length} à la forme attendue${informes ? ` · ${informes} INFORMES, jamais écrites` : ''} · export du ${exportDu.toISOString()}`);
    if (exportDu.getTime() > Date.now() + MARGE_FUTUR_MS) { console.error(`❌ export daté du ${exportDu.toISOString()}, dans le FUTUR : rien n'est écrit`); return await sortir(1); }
    if (informes > 0.01 * tous.length) { console.error(`❌ ${informes} lignes sur ${tous.length} n'ont pas la forme attendue (> 1 %) : rien n'est écrit`); return await sortir(1); }
    if (SORTIE) { fs.writeFileSync(SORTIE, brut); console.log(`   copie locale : ${SORTIE}`); }

    try {
        if (meta?.exportDu && exportDu <= new Date(meta.exportDu)) {
            // jugé « rien de neuf » : ses validateurs se gardent, le prochain passage rendra 304 sans corps
            if (http) await META.updateOne({ _id: metaId }, { $set: { http } });
            console.log(`ℹ️ rien de neuf : le fichier est du ${exportDu.toISOString()}, le dernier export archivé du ${new Date(meta.exportDu).toISOString()}`); return await sortir(0);
        }
        // plus ancien que ce que la collection porte déjà (une intégration à la main d'un export plus récent, qui n'écrit pas la
        // méta) : la dernière entrée datée de la collection ne peut pas être postérieure de plus de 2 jours à l'export
        const derniereEntree = (await C.find({ dateAdded: { $type: 'date' } }, { projection: { dateAdded: 1 } }).sort({ dateAdded: -1 }).limit(1).toArray())[0]?.dateAdded ?? null;
        if (derniereEntree && exportDu.getTime() < derniereEntree.getTime() - 2 * 86400000) { console.error(`❌ export du ${exportDu.toISOString()} plus ancien que la dernière entrée de la collection (${derniereEntree.toISOString()}) : rien n'est écrit`); return await sortir(1); }

        // 3. le juge de la collection
        const enCollection = await C.countDocuments({});
        const refus = jugerCollection({ base: BASE, enCollection, lignesFichier: produits.length, meta });
        if (refus) { console.error(`❌ ${refus} — rien n'est écrit`); return await sortir(1); }

        // 4. l'archive du fichier brut, relue octet pour octet (le bucket a répondu à l'étape 0 bis)
        const prefixe = `exports-cardmarket/${BASE}/products_singles_6/${horodatage(exportDu)}`;
        await r2.deposerBinaire(bucket, `${prefixe}.json.gz`, zlib.gzipSync(brut), 'application/gzip');
        if (sha256(zlib.gunzipSync(await r2.lireBinaire(bucket, `${prefixe}.json.gz`))) !== empreinte) { console.error('❌ archive relue : contenu différent du fichier téléchargé — rien n\'est écrit'); return await sortir(1); }
        console.log(`✅ archive : R2 ${bucket}/${prefixe}.json.gz (relue, sha256 ${empreinte.slice(0, 12)}…)`);

        // 5. le diff
        const enBase = new Map();
        for await (const d of C.find({}, { projection: { _id: 0, idProduct: 1, name: 1, idExpansion: 1, idMetacard: 1 } })) enBase.set(d.idProduct, d);
        const D = diffExport(produits, enBase);
        console.log(`diff contre ${COLL} (${enBase.size}) : ${D.nouveaux.length} nouveaux · ${D.noms.length} noms changés · ${D.expansions.length} idExpansion changées · ${D.metacards.length} idMetacard changés · ${D.disparus.length} disparus${D.doublons ? ` · ${D.doublons} idProduct en double dans le fichier (première ligne retenue)` : ''}`);
        await r2.deposerTexte(bucket, `${prefixe}.diff.json`, JSON.stringify({ exportDu, collection: COLL, informes, doublons: D.doublons, nouveaux: D.nouveaux.map(p => p.idProduct), noms: D.noms, expansions: D.expansions, metacards: D.metacards, disparus: D.disparus }), 'application/json');

        // 6. la sauvegarde puis l'insertion des seuls nouveaux
        let inseres = 0, cleSauvegarde = null;
        if (D.nouveaux.length) {
            const gz = zlib.createGzip(), morceaux = [];
            gz.on('data', c => morceaux.push(c));
            const fin = new Promise((ok, ko) => { gz.on('end', ok); gz.on('error', ko); });
            let n = 0;
            for await (const d of C.find({})) { if (!gz.write(EJSON.stringify(d, { relaxed: false }) + '\n')) await new Promise(ok => gz.once('drain', ok)); n++; }
            gz.end(); await fin;
            if (n !== enCollection) { console.error(`❌ sauvegarde : ${n} documents lus pour ${enCollection} comptés — rien n'est inséré`); return await sortir(1); }
            cleSauvegarde = `sauvegardes/${COLL}/${BASE}/${horodatage(new Date())}.ndjson.gz`;
            await r2.deposerBinaire(bucket, cleSauvegarde, Buffer.concat(morceaux), 'application/gzip');
            // relue en flux : seules les fins de ligne sont comptées, le texte n'est jamais tenu en entier
            let relues = 0;
            await new Promise((ok, ko) => { const g = zlib.createGunzip(); g.on('data', c => { for (const o of c) if (o === 10) relues++; }); g.on('end', ok); g.on('error', ko); r2.lireBinaire(bucket, cleSauvegarde).then(b => g.end(b), ko); });
            if (relues !== n) { console.error(`❌ sauvegarde relue : ${relues} lignes pour ${n} — rien n'est inséré`); return await sortir(1); }
            console.log(`✅ sauvegarde : ${n} documents -> R2 ${bucket}/${cleSauvegarde} (relue)`);
            for (let i = 0; i < D.nouveaux.length; i += 2000) {
                const ops = D.nouveaux.slice(i, i + 2000).map(p => ({ updateOne: { filter: { idProduct: p.idProduct }, update: { $setOnInsert: { idProduct: p.idProduct, name: p.name, idExpansion: p.idExpansion, idMetacard: p.idMetacard, ...(estDateValide(p.dateAdded) ? { dateAdded: new Date(p.dateAdded) } : {}) } }, upsert: true } }));
                inseres += (await C.bulkWrite(ops, { ordered: false })).upsertedCount;
            }
            console.log(`${inseres === D.nouveaux.length ? '✅' : '❌'} ${inseres} produits nouveaux insérés sur ${D.nouveaux.length}`);
            if (inseres !== D.nouveaux.length) { console.error(`❌ ${D.nouveaux.length - inseres} nouveaux non insérés (un autre écrivain ?) : la méta n'avance pas, le prochain passage reprendra`); return await sortir(1); }
        }

        // 7. la méta, en dernier
        await META.updateOne({ _id: metaId }, { $set: { exportDu, lignesDuFichier: produits.length, informes, doublons: D.doublons, sha256: empreinte, cleArchive: `${prefixe}.json.gz`, cleDiff: `${prefixe}.diff.json`, cleSauvegarde, archiveLe: new Date(), nouveauxInseres: inseres, enAttente: { noms: D.noms.length, expansions: D.expansions.length, metacards: D.metacards.length, disparus: D.disparus.length }, http: http ?? null } }, { upsert: true });

        // 8. les expansions qui reçoivent des produits
        const parExp = new Map();
        for (const p of D.nouveaux) parExp.set(p.idExpansion, (parExp.get(p.idExpansion) ?? 0) + 1);
        if (parExp.size) {
            const connues = new Set([...enBase.values()].map(b => b.idExpansion));
            const codes = new Map((await cx.db.collection('codes_set').find({ idExpansion: { $in: [...parExp.keys()] } }, { projection: { idExpansion: 1, codeSet: 1 } }).toArray()).map(c => [c.idExpansion, c.codeSet]));
            console.log(`expansions qui reçoivent des produits : ${parExp.size} (dont ${[...parExp.keys()].filter(id => !connues.has(id)).length} entièrement nouvelles) — l'apprentissage Cardmarket n'est pas fait ici`);
            for (const [id, n] of [...parExp].sort((a, b) => b[1] - a[1])) console.log(`   ${String(id).padEnd(6)} ${String(codes.get(id) ?? '—').padEnd(9)} +${n}${connues.has(id) ? '' : ' · NOUVELLE'}`);
        }
        if (D.noms.length + D.expansions.length + D.metacards.length) console.log(`⏸️ en attente du feu vert (écritures qui MODIFIENT, §56 : node integrer-export.js <fichier> --ecrire --confirmer-production) : ${D.noms.length} noms · ${D.expansions.length} expansions · ${D.metacards.length} métacartes`);
        return await sortir(0);
    } catch (e) {
        console.error(`❌ ${e.message}`);
        return await sortir(1);
    }
}

module.exports = { lireArguments, diffExport, ligneValide, jugerCollection, URL_EXPORT };
if (require.main === module) main().catch(e => { console.error(`❌ ${e.response ? `HTTP ${e.response.status}` : e.message}`); process.exit(1); });
