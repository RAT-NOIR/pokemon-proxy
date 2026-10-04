// ============================================================
// CONSTITUER LE JEU DE PHOTOS FIXE DU VERROU — depuis les photos DÉJÀ sur ce poste, sans une requête (2026-10-04)
// ============================================================
//   node verrou/constituer-photos.js [--labo=<dossier labo-embedding>]            (plan : ce qui serait ajouté — rien d'écrit)
//   node verrou/constituer-photos.js [--labo=…] --ecrire                           (copie dans verrou/photos/, écrit index.json)
// Décision du testeur, 2026-10-04 : « le verrou travaille sur un jeu de photos fixe, conservé en local, et ne contacte jamais Vinted ».
// SOURCES (lecture seule, aucun réseau) — les photos du journal que le labo a déjà, chacune rattachée à SON URL du journal :
//   · photos-66/<idProduct>_<Lnnn>.jpg + etiquettes-66.json : la ligne Lnnn du banc, retrouvée par numeroter() de banc-seaux.js (la
//     numérotation du banc, une seule définition) ;
//   · photos-journal/<idProduct>.jpg : la PREMIÈRE ligne du journal (par date) de ce produit avec une photo — la règle de
//     pokemon-proxy-labo/temoin-rendu.js qui les a téléchargées.
// Le journal se lit dans la base de production `test`, en lecture seule. ADDITIF : une URL déjà au jeu garde son fichier ; une URL
// dont la photo locale diffère (empreinte) REFUSE tout (le jeu ne change pas en silence). Le dossier n'est pas commité.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const AUTORISES = [/^--ecrire$/, /^--labo=.+$/];
const inconnus = process.argv.slice(2).filter(a => !AUTORISES.some(r => r.test(a)));
if (inconnus.length) { console.error(`❌ argument inconnu : ${inconnus.join(' ')} — autorisés : --labo=<dossier>, --ecrire`); process.exit(2); }
const LABO = process.argv.find(a => a.startsWith('--labo='))?.slice(7) || 'C:/Users/Yung/Desktop/labo-embedding';
const mongoose = require('mongoose');
const SEAUX = require('../banc-seaux');
const { DOSSIER, INDEX, lireIndex, empreinteJeu } = require('./photos-locales');

(async () => {
    const ecrire = process.argv.includes('--ecrire');
    const c = await mongoose.createConnection(process.env.MONGODB_URI, { dbName: 'test' }).asPromise();
    if (c.db.databaseName !== 'test') throw new Error(`base « ${c.db.databaseName} » : le journal se lit dans « test »`);
    const docs = (await c.collection('journal_scans').find({}).sort({ le: 1 }).toArray()).map(d => ({ ...d, le: new Date(d.le) }));
    await c.close();
    const urls = new Set(docs.filter(d => d.imageUrl).map(d => d.imageUrl));
    console.log(`DÉNOMINATEUR : ${docs.length} lignes au journal · ${urls.size} URL de photo distinctes`);
    const parCle = new Map(SEAUX.numeroter(docs).lignes.map(l => [l.cle, l.d]));
    const candidates = [];   // { url, chemin, source, ligne }
    const f66 = path.join(LABO, 'etiquettes-66.json');
    if (fs.existsSync(f66)) {
        const et = JSON.parse(fs.readFileSync(f66, 'utf8')).etiquettes;
        let sans = 0;
        for (const e of et) {
            const d = parCle.get(e.ligne), chemin = path.join(LABO, 'photos-66', e.photo);
            if (!d?.imageUrl || !fs.existsSync(chemin)) { sans++; continue; }
            candidates.push({ url: d.imageUrl, chemin, source: 'labo photos-66', ligne: e.ligne });
        }
        console.log(`   photos-66 : ${et.length} étiquettes · ${et.length - sans} rattachées à une URL du journal · ${sans} non`);
    } else console.log(`   photos-66 : ${f66} absent`);
    const dj = path.join(LABO, 'photos-journal');
    if (fs.existsSync(dj)) {
        // LA RÈGLE QUI A NOMMÉ CES FICHIERS (pokemon-proxy-labo/temoin-rendu.js, la requête et non le seul nommage — relecture du
        // 2026-10-04) : lignes occidentales seulement (langue hors JP, ZH, KR), avec photo et produit, triées par date, la première par
        // produit
        const AS = ['JP', 'ZH', 'KR'];
        const premiere = new Map();
        for (const d of docs) if (d.imageUrl && d.idProduct != null && !AS.includes(String(d.langue ?? '').toUpperCase()) && !premiere.has(d.idProduct)) premiere.set(d.idProduct, d);
        const fichiers = fs.readdirSync(dj).filter(f => /^\d+\.jpg$/.test(f));
        let n = 0;
        for (const f of fichiers) { const d = premiere.get(Number(f.slice(0, -4))); if (d) { candidates.push({ url: d.imageUrl, chemin: path.join(dj, f), source: 'labo photos-journal', ligne: String(d._id) }); n++; } }
        console.log(`   photos-journal : ${fichiers.length} fichiers · ${n} rattachés à une URL du journal`);
    } else console.log(`   photos-journal : ${dj} absent`);

    const idx = lireIndex();
    const photos = { ...idx.photos };
    const ajouts = [], conflits = [];
    const vues = new Map();
    for (const k of candidates) {
        const buf = fs.readFileSync(k.chemin);
        const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
        if (vues.has(k.url)) { if (vues.get(k.url) !== sha256) conflits.push(`${k.url.slice(0, 80)} : deux photos locales différentes (${k.source})`); continue; }
        vues.set(k.url, sha256);
        if (photos[k.url]) { if (photos[k.url].sha256 !== sha256) conflits.push(`${k.url.slice(0, 80)} : au jeu sous ${photos[k.url].sha256.slice(0, 12)}, photo locale ${sha256.slice(0, 12)}`); continue; }
        ajouts.push({ ...k, sha256, octets: buf.length });
    }
    console.log(`PLAN : jeu actuel ${Object.keys(photos).length} photo(s) · ${ajouts.length} à ajouter · ${conflits.length} conflit(s)`);
    for (const x of conflits) console.log(`   🔴 ${x}`);
    if (conflits.length) { console.error('❌ conflits : rien n\'est écrit (le jeu fixe ne change pas en silence)'); process.exit(1); }
    if (!ecrire) { console.log('   (plan seul — --ecrire)'); return; }
    fs.mkdirSync(DOSSIER, { recursive: true });
    for (const a of ajouts) {
        const fichier = `${a.sha256.slice(0, 16)}${path.extname(a.chemin).toLowerCase() || '.jpg'}`;
        fs.copyFileSync(a.chemin, path.join(DOSSIER, fichier));
        photos[a.url] = { fichier, sha256: a.sha256, octets: a.octets, type: /\.png$/i.test(fichier) ? 'image/png' : /\.webp$/i.test(fichier) ? 'image/webp' : 'image/jpeg', source: a.source, ligne: a.ligne, ajouteLe: new Date().toISOString() };
    }
    fs.writeFileSync(INDEX, JSON.stringify({ constitueLe: idx.constitueLe ?? new Date().toISOString(), modifieLe: new Date().toISOString(), regle: 'jeu fixe, local, jamais Vinted (testeur 2026-10-04)', photos }, null, 1));
    // RELU, pas supposé : chaque fichier existe et porte son empreinte
    const relu = lireIndex();
    let ok = 0;
    for (const [u, p] of Object.entries(relu.photos)) { const b = fs.readFileSync(path.join(DOSSIER, p.fichier)); if (crypto.createHash('sha256').update(b).digest('hex') === p.sha256) ok++; else console.log(`   🔴 ${p.fichier} ne porte pas son empreinte (${u.slice(0, 60)})`); }
    console.log(`${ok === Object.keys(relu.photos).length ? '✅' : '🔴'} jeu fixe : ${Object.keys(relu.photos).length} photo(s), ${ok} relues à leur empreinte · empreinte du jeu ${empreinteJeu(relu.photos)}`);
    if (ok !== Object.keys(relu.photos).length) process.exitCode = 1;
})().catch(e => { console.error(e); process.exit(1); });
