// node test-lot-garde-scratch.js — la garde de lot-additif.js DE BOUT EN BOUT, sur des effacements SIMULÉS, dans test_scratch.
// Un vrai lot : sauvegarde (backup-collections.js), commande, comparaison set par set, restauration, relecture, journal.
// La commande du lot est ce fichier lui-même, appelé avec --effacer=<cas> : il efface comme l'ont fait xASC et HSP (§59),
// et joue le worker qui écrit des images pendant ce temps. Aucune écriture hors de test_scratch ; tout est retiré en sortant
// (collections, sauvegardes, journal) : un banc qui laisse des traces n'est pas reproductible (§3).
require('dotenv').config();
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const mongoose = require('mongoose');

const COLLS = ['cartes', 'cartes_produits', 'sets', 'collecte_images_etat'];
const effacer = process.argv.find(a => a.startsWith('--effacer='))?.slice(10);

async function ouvrir() {
    const cx = await mongoose.createConnection(process.env.MONGODB_URI, { dbName: 'test_scratch' }).asPromise();
    if (cx.db.databaseName !== 'test_scratch') { await cx.close(); throw new Error(`base « ${cx.db.databaseName} » : je n'écris que dans test_scratch`); }
    return cx;
}

const JOUR = new Date('2026-09-20T10:00:00Z');
const semer = async db => {
    await db.collection('cartes').insertMany([
        { _id: 1, nomEn: 'Blastoise', sets: ['Set-A'], collecteLe: JOUR, impressions: [{ tirage: 'intl', expansion: 'Set A', numero: '2', illustrateur: 'Ken Sugimori', illustrateurPreuve: 'tcgdex:a-2' }], images: [{ set: 'Set-A', numero: '2', cleR2: 'a/2', jointeLe: JOUR }] },
        { _id: 2, nomEn: 'Pikachu', sets: ['Set-A', 'Set-B'], collecteLe: JOUR, impressions: [{ tirage: 'intl', expansion: 'Set A', numero: '58', illustrateur: null }, { tirage: 'jp', expansion: 'Set B', numero: '25' }], images: [{ set: 'Set-B', numero: '25', cleR2: 'b/25', jointeLe: JOUR }] }
    ]);
    await db.collection('cartes_produits').insertMany([
        { _id: '100-1', idProduct: 100, idExpansion: 11, carteId: 1, verifieLe: JOUR },
        { _id: '101-2', idProduct: 101, idExpansion: 11, carteId: 2, verifieLe: JOUR },
        { _id: '200-2', idProduct: 200, idExpansion: 12, carteId: 2, verifieLe: JOUR }
    ]);
    await db.collection('sets').insertMany([{ _id: 'Set-A', nomAffichage: 'Set A', collecteLe: JOUR }, { _id: 'Set-B', nomAffichage: 'Set B', completImages: { le: JOUR } }]);
};

// ── LA COMMANDE DU LOT : ce que le lot (et le worker, en même temps) écrivent
async function jouer(cas) {
    const cx = await ouvrir(), db = cx.db;
    const C = db.collection('cartes'), P = db.collection('cartes_produits');
    const worker = async (op) => { await C.updateOne({ _id: 2 }, op); await db.collection('collecte_images_etat').updateOne({ _id: 'tcgdex/Set-B' }, { $set: { debute: new Date(), fini: new Date() } }, { upsert: true }); };
    if (cas === 'illustrateur') {                          // §59 : +1 fiche annoncée, un illustrateur effacé à côté ; le worker joint une image
        await P.insertOne({ _id: '300-1', idProduct: 300, idExpansion: 13, carteId: 1, verifieLe: new Date() });
        await C.updateOne({ _id: 1 }, { $unset: { 'impressions.0.illustrateur': 1, 'impressions.0.illustrateurPreuve': 1 } });
        await worker({ $push: { images: { set: 'Set-B', numero: '26', cleR2: 'b/26', jointeLe: new Date() } } });
    } else if (cas === 'image-lot') {                      // le lot retire une image hors des sets du worker, et un nom de set
        await C.updateOne({ _id: 1 }, { $pull: { images: { set: 'Set-A' } } });
        await db.collection('sets').updateOne({ _id: 'Set-A' }, { $unset: { nomAffichage: 1 } });
    } else if (cas === 'image-worker') {                   // le worker retire une image de SON set (il la remettra)
        await worker({ $pull: { images: { set: 'Set-B', numero: '25' } } });
    } else if (cas === 'additif') {
        await P.insertOne({ _id: '400-1', idProduct: 400, idExpansion: 14, carteId: 1, verifieLe: new Date() });
    } else throw new Error(`cas inconnu : ${cas}`);
    await cx.close();
}

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); }
};

async function main() {
    const cx = await ouvrir(), db = cx.db;
    const presentes = (await db.listCollections().toArray()).map(c => c.name).filter(n => COLLS.includes(n));
    if (presentes.length) { await cx.close(); throw new Error(`test_scratch porte déjà ${presentes.join(', ')} : je ne les écrase pas (ce ne sont pas les miennes)`); }
    const journal = path.join(os.tmpdir(), `journal-test-lot-${Date.now()}.md`);
    const annonce = path.join(os.tmpdir(), `annonce-test-lot-${Date.now()}.json`);
    fs.writeFileSync(annonce, JSON.stringify({ 'illustrateurs imp:intl|Set A': 1, 'illustrateurs-nommes imp:intl|Set A': 1 }));
    const lot = (cas, extra = []) => {
        const r = spawnSync(process.execPath, ['lot-additif.js', '--base=test_scratch', `--journal=${journal}`, '--confirmation=1', `--quoi=banc ${cas}`, '--collections=cartes', ...extra, '--', 'node', 'test-lot-garde-scratch.js', `--effacer=${cas}`], { cwd: __dirname, encoding: 'utf8' });
        const ligne = fs.readFileSync(journal, 'utf8').trim().split('\n').at(-1);
        return { code: r.status, ligne, sortie: r.stdout + r.stderr };
    };
    const remettre = async () => { for (const n of COLLS) await db.collection(n).drop().catch(() => { }); await semer(db); await new Promise(r => setTimeout(r, 1100)); };
    try {
        // ── A. le cas du §59, pas annoncé : ARRÊT, l'illustrateur revient, la fiche ajoutée repart, l'image du worker reste
        await remettre();
        let r = lot('illustrateur');
        let c1 = await db.collection('cartes').findOne({ _id: 1 }), c2 = await db.collection('cartes').findOne({ _id: 2 });
        verifier('A. §59 non annoncé : le lot s\'arrête (code 3)', r.code, 3);
        verifier('A. l\'illustrateur effacé revient, avec sa preuve', [c1.impressions[0].illustrateur, c1.impressions[0].illustrateurPreuve], ['Ken Sugimori', 'tcgdex:a-2']);
        verifier('A. la fiche ajoutée par le lot arrêté repart', await db.collection('cartes_produits').countDocuments({ _id: '300-1' }), 0);
        verifier('A. l\'image que le worker a jointe pendant le lot reste', c2.images.map(i => i.numero), ['25', '26']);
        verifier('A. les Date restaurées sont des Date (la sauvegarde est en Extended JSON)', [c1.collecteLe instanceof Date, c1.images[0].jointeLe instanceof Date], [true, true]);
        verifier('A. le journal dit l\'arrêt, la baisse et la relecture', [/🔴 ARRÊT/.test(r.ligne), /illustrateurs imp:intl\\\|Set A 2→1/.test(r.ligne), /relu ✅/.test(r.ligne)], [true, true, true]);
        if (r.code !== 3) console.log(r.sortie);

        // ── B. le même effacement, ANNONCÉ par la simulation : le lot passe, rien n'est restauré
        await remettre();
        r = lot('illustrateur', [`--annonce=${annonce}`]);
        c1 = await db.collection('cartes').findOne({ _id: 1 });
        verifier('B. annoncé : le lot passe (code 0) et garde son effet', [r.code, 'illustrateur' in c1.impressions[0]], [0, false]);
        verifier('B. le journal dit la baisse autorisée', /garde ✅.*\[annoncée\]/.test(r.ligne), true);

        // ── C. le lot retire une image hors des sets du worker, et un nom de set : ARRÊT, les deux reviennent
        await remettre();
        r = lot('image-lot');
        c1 = await db.collection('cartes').findOne({ _id: 1 });
        verifier('C. image et nom effacés par le lot : arrêt, et les deux reviennent', [r.code, c1.images.map(i => i.cleR2), (await db.collection('sets').findOne({ _id: 'Set-A' })).nomAffichage], [3, ['a/2'], 'Set A']);

        // ── D. le worker retire une image de SON set pendant le lot : autorisé, et dit « worker »
        await remettre();
        r = lot('image-worker');
        verifier('D. baisse d\'images dans un set du worker : le lot passe, la baisse est nommée', [r.code, /\[worker\]/.test(r.ligne)], [0, true]);

        // ── E. purement additif
        await remettre();
        r = lot('additif');
        verifier('E. additif : le lot passe, la hausse est comptée', [r.code, /hausses fiches \+1/.test(r.ligne)], [0, true]);
    } finally {
        for (const n of COLLS) await db.collection(n).drop().catch(() => { });
        await cx.close();
        const dossiers = fs.existsSync(journal) ? [...fs.readFileSync(journal, 'utf8').matchAll(/\| (backup-\d{4}-\d\d-\d\d-lot-\d{6}) \|/g)].map(m => m[1]) : [];
        for (const d of dossiers) fs.rmSync(path.join(__dirname, d), { recursive: true, force: true });
        fs.rmSync(journal, { force: true }); fs.rmSync(annonce, { force: true });
        console.log(`   nettoyé : ${COLLS.length} collections de test_scratch, ${dossiers.length} sauvegardes, le journal du banc`);
    }
    console.log(`\n${ok} passés, ${ko} en échec`);
    process.exit(ko ? 1 : 0);
}

(effacer ? jouer(effacer) : main()).catch(e => { console.error('❌', e.message); process.exit(1); });
