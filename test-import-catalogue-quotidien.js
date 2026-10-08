// Banc de import-catalogue-quotidien.js — base `test_scratch` UNIQUEMENT, collection de banc à part (`catalogue_banc_quotidien` : la
// tranche `catalogue_produits` du bac appartient au verrou), fichiers servis par un serveur HTTP LOCAL (aucune requête à Cardmarket),
// collection, méta et préfixes R2 du banc vidés avant et après.
//   node test-import-catalogue-quotidien.js
process.argv.push('--base=test_scratch');
require('dotenv').config();
const http = require('http');
const crypto = require('crypto');
const path = require('path');
const { spawn } = require('child_process');
const mongoose = require('mongoose');
const { connecterMongo } = require('./mongo-connexion');
const { viderBac } = require('./verrou/bac');
const { ouvrirBanc } = require('./collecte-cartes/base-banc');

const COLL = 'catalogue_banc_quotidien';
let echecs = 0, n = 0;
const verifier = (nom, obtenu, attendu) => { n++; const ok = JSON.stringify(obtenu) === JSON.stringify(attendu); if (!ok) echecs++; console.log(`${ok ? '✅' : '❌'} ${nom} : ${JSON.stringify(obtenu)}${ok ? '' : ` (attendu ${JSON.stringify(attendu)})`}`); };
const produits = (k, debut = 0, nom = i => `Carte ${i}`) => Array.from({ length: k }, (_, j) => { const i = debut + j; return { idProduct: 1000 + i, name: nom(i), idCategory: 51, categoryName: 'Pokémon Single', idExpansion: 10 + (i % 3), idMetacard: 500 + i, dateAdded: '2026-09-01 10:00:00' }; });
const FICHIERS = {
    '/A.json': JSON.stringify({ version: 1, createdAt: '2026-10-01T02:00:00+0200', products: produits(100) }),
    // B : 10 nouveaux, 5 noms changés (les ids 1000-1004), une idExpansion changée (1005)
    '/B.json': JSON.stringify({ version: 1, createdAt: '2026-10-02T02:00:00+0200', products: produits(110, 0, i => i < 5 ? `Carte ${i} [renommée]` : `Carte ${i}`).map(p => p.idProduct === 1005 ? { ...p, idExpansion: 99 } : p) }),
    '/tronque.json': JSON.stringify({ version: 1, createdAt: '2026-10-03T02:00:00+0200', products: produits(50) }),
    '/informe.json': JSON.stringify({ version: 1, createdAt: '2026-10-03T02:00:00+0200', products: [...produits(100), ...Array.from({ length: 20 }, (_, i) => ({ idProduct: 9000 + i }))] }),
    '/pasjson.json': '<html>Cloudflare</html>',
    '/futur.json': JSON.stringify({ version: 1, createdAt: '2099-01-01T02:00:00+0200', products: produits(120) }),
    '/C.json': JSON.stringify({ version: 1, createdAt: '2026-10-04T02:00:00+0200', products: produits(130) }),
    '/ancien.json': JSON.stringify({ version: 1, createdAt: '2026-09-30T02:00:00+0200', products: produits(100) }),
    // D : 20 nouveaux, plus UNE ligne informe (< 1 %, tolérée mais jamais écrite) et UN idProduct en double (la première ligne fait foi)
    '/D.json': JSON.stringify({ version: 1, createdAt: '2026-10-05T02:00:00+0200', products: [...produits(130), { ...produits(1, 129)[0], name: 'Doublon' }, { idProduct: 'x', name: '' }] }),
    '/nul.json': 'null'
};
const lancer = (...args) => lancerAvec({}, ...args);
const lancerAvec = (env, ...args) => new Promise(resolve => {
    const p = spawn(process.execPath, [path.join(__dirname, 'import-catalogue-quotidien.js'), '--base=test_scratch', `--collection=${COLL}`, ...args], { env: { ...process.env, ...env } });
    let out = '', err = '';
    p.stdout.on('data', d => out += d); p.stderr.on('data', d => err += d);
    p.on('close', status => resolve({ status, out, err }));
});

(async () => {
    // BASE DE BANC (2026-10-08) : plus jamais la production — base mémoire, ou MONGODB_TEST_URI hors production, sinon REFUS (base-banc.js).
    // Les imports lancés en sous-processus héritent de cet environnement.
    // R2 (2026-10-08) : ce banc ÉCRIT sur R2 (archives, sauvegardes) via les imports lancés en sous-processus — il n'écrit jamais dans un bucket de production.
    // R2_BUCKET_BANC (le bucket de banc dédié) est EXIGÉ par ouvrirBanc({ ecritR2 }) : sans lui, REFUS avant tout démarrage ; appliquer() y redirige ensuite R2_BUCKET_BRUT.
    (await ouvrirBanc({ ecritR2: 'les archives et sauvegardes de l\'import du catalogue' })).appliquer();
    const base = await connecterMongo({ script: 'test-import-catalogue-quotidien.js', ecrit: true });
    if (base !== 'test_scratch') { console.error(`❌ banc sur « ${base} » : refusé, test_scratch seulement`); process.exit(1); }
    const db = mongoose.connection.db;
    const C = db.collection(COLL), M = db.collection('catalogue_export_meta');
    const META = `dernier:${COLL}`;
    // `drop`, pas `deleteMany` (FUITE-MAIN, 2026-10-08) : deleteMany laissait les deux collections (fichier + index) sur la grappe de production
    const vider = async () => { await viderBac(db, { noms: [COLL, 'catalogue_export_meta'], log: () => { } }); };
    await vider();
    const r2 = require('./collecte-cartes/r2');
    const B = process.env.R2_BUCKET_BRUT;
    await r2.verifierBucket(B);
    const PREFIXES = ['exports-cardmarket/test_scratch/', `sauvegardes/${COLL}/test_scratch/`];
    const viderR2 = async () => { for (const p of PREFIXES) { const l = await r2.listerPrefixe(B, p); if (l.length) await r2.supprimer(B, l); } };
    await viderR2();
    // le serveur local se comporte comme S3 : un ETag par contenu, 304 SANS CORPS à une requête conditionnelle qui le cite
    let requetes = 0, nonModifies = 0;
    const etagDe = f => `"${crypto.createHash('sha1').update(f).digest('hex')}"`;
    const srv = http.createServer((req, res) => {
        requetes++; const f = FICHIERS[req.url]; if (!f) { res.writeHead(404); return res.end(); }
        if (req.headers['if-none-match'] === etagDe(f)) { nonModifies++; res.writeHead(304, { etag: etagDe(f) }); return res.end(); }
        res.writeHead(200, { 'content-type': 'application/json', etag: etagDe(f), 'last-modified': 'Wed, 07 Oct 2026 11:31:05 GMT' }); res.end(f);
    });
    await new Promise(r => srv.listen(0, '127.0.0.1', r));
    const url = f => `--url=http://127.0.0.1:${srv.address().port}${f}`;
    try {
        const rA = await lancer(url('/A.json'));
        verifier('export A sur une collection vide : archivé, 100 nouveaux insérés', [rA.status, await C.countDocuments({}), (await M.findOne({ _id: META }))?.nouveauxInseres], [0, 100, 100]);
        verifier('les validateurs HTTP du fichier importé sont gardés dans la méta', (await M.findOne({ _id: META }))?.http?.etag, etagDe(FICHIERS['/A.json']));
        // (testeur, 2026-10-08) « si l'export du jour a la même date que la veille, aucun téléchargement » : requête conditionnelle, 304
        const n0 = nonModifies;
        const rA2 = await lancer(url('/A.json'));
        verifier('le même export une seconde fois : 304 sans corps (AUCUN téléchargement), « rien de neuf », sortie 0', [rA2.status, /rien de neuf/.test(rA2.out), nonModifies - n0], [0, true, 1]);
        const rF = await lancer(url('/futur.json'));
        verifier('un export daté du FUTUR : refusé, rien d\'inséré', [rF.status, /FUTUR/.test(rF.err), await C.countDocuments({})], [1, true, 100]);
        const rT = await lancer(url('/tronque.json'));
        verifier('fichier tronqué (50 contre 100) : refusé', [rT.status, /tronqué/.test(rT.err), await C.countDocuments({})], [1, true, 100]);
        verifier('un fichier REFUSÉ ne laisse pas ses validateurs : la méta garde ceux de A (le suivant sera retéléchargé)', (await M.findOne({ _id: META }))?.http?.etag, etagDe(FICHIERS['/A.json']));
        const rI = await lancer(url('/informe.json'));
        verifier('plus de 1 % de lignes informes : refusé', [rI.status, /forme attendue/.test(rI.err), await C.countDocuments({})], [1, true, 100]);
        const rJ = await lancer(url('/pasjson.json'));
        verifier('une page HTML à la place du fichier : refusée', [rJ.status, /illisible/.test(rJ.err)], [1, true]);
        const r404 = await lancer(url('/absent.json'));
        verifier('fichier absent (404) : sortie 1, le statut est dit', [r404.status, /HTTP 404/.test(r404.err)], [1, true]);
        const rB = await lancer(url('/B.json'));
        const m = await M.findOne({ _id: META });
        verifier('export B : les 10 nouveaux insérés, les 5 noms et l\'expansion changés NE SONT PAS écrits, comptés en attente',
            [rB.status, await C.countDocuments({}), (await C.findOne({ idProduct: 1000 })).name, (await C.findOne({ idProduct: 1005 })).idExpansion, m.nouveauxInseres, m.enAttente],
            [0, 110, 'Carte 0', 12, 10, { noms: 5, expansions: 1, metacards: 0, disparus: 0 }]);
        // (2026-10-07, nuit) une variable absente se constate AVANT la requête : le worker sans MONGODB_URI a téléchargé six fichiers pour rien
        const q0 = requetes;
        const rS0 = await lancerAvec({ R2_BUCKET_BRUT: '' }, url('/C.json'));
        verifier('archive impossible (bucket absent) : sortie 1, rien d\'inséré, AUCUNE requête', [rS0.status, /R2_BUCKET_BRUT absent/.test(rS0.err), await C.countDocuments({}), requetes - q0], [1, true, 110, 0]);
        const q1 = requetes;
        const rU0 = await lancerAvec({ MONGODB_URI: '' }, url('/C.json'));
        verifier('MONGODB_URI absent : sortie 1, la variable est NOMMÉE, AUCUNE requête', [rU0.status, /MONGODB_URI absente/.test(rU0.err), requetes - q1], [1, true, 0]);
        // (relecture, 2026-10-08) présente n'est pas JOIGNABLE : la base et le bucket se vérifient eux aussi avant la requête
        const q2 = requetes;
        const rU1 = await lancerAvec({ MONGODB_URI: 'mongodb://127.0.0.1:1/?serverSelectionTimeoutMS=1500' }, url('/C.json'));
        verifier('base injoignable : sortie 1, AUCUNE requête', [rU1.status, requetes - q2], [1, 0]);
        const q3 = requetes;
        const rS1 = await lancerAvec({ R2_BUCKET_BRUT: 'banc-bucket-qui-n-existe-pas' }, url('/C.json'));
        verifier('bucket qui ne répond pas : sortie 1, rien d\'inséré, AUCUNE requête', [rS1.status, await C.countDocuments({}), requetes - q3], [1, 110, 0]);
        const rAn = await lancer(url('/ancien.json'));
        verifier('un export PLUS ANCIEN que le dernier archivé : « rien de neuf », rien d\'écrit', [rAn.status, /rien de neuf/.test(rAn.out), await C.countDocuments({})], [0, true, 110]);
        const rN = await lancer(url('/nul.json'));
        verifier('un JSON `null` : refusé comme illisible', [rN.status, /illisible/.test(rN.err)], [1, true]);
        const rD = await lancer(url('/D.json'));
        const mD = await M.findOne({ _id: META });
        verifier('export D : 20 nouveaux insérés ; la ligne informe et le doublon ne sont jamais écrits, et sont comptés',
            [rD.status, await C.countDocuments({}), await C.countDocuments({ idProduct: { $not: { $type: 'int' } } }), (await C.findOne({ idProduct: 1129 })).name, mD.informes, mD.doublons, mD.nouveauxInseres],
            [0, 130, 0, 'Carte 129', 1, 1, 20]);
        // l'archive : une par export accepté (A, B, D), relisible ; une sauvegarde par export qui insère (A, B, D)
        const archives = (await r2.listerPrefixe(B, PREFIXES[0])).filter(k => k.endsWith('.json.gz'));
        const sauvegardes = await r2.listerPrefixe(B, PREFIXES[1]);
        verifier('trois archives du fichier brut et trois sauvegardes, aucune pour les refus', [archives.length, sauvegardes.length], [3, 3]);
        // LES ARGUMENTS et LE JUGE DE LA COLLECTION : testés SANS lancer le script (fonctions pures) — aucun cas ne peut atteindre
        // la base de production ni Cardmarket
        const { lireArguments, diffExport, jugerCollection, URL_EXPORT } = require('./import-catalogue-quotidien');
        verifier('production, collection VIDE : refusée (une base réelle n\'est jamais vide)', !!jugerCollection({ base: 'test', enCollection: 0, lignesFichier: 74000, meta: null }), true);
        verifier('collection amputée (50 contre 100 au dernier export) : refusée', !!jugerCollection({ base: 'test', enCollection: 50, lignesFichier: 100, meta: { lignesDuFichier: 100 } }), true);
        verifier('fichier tronqué contre la collection, sans méta : refusé', !!jugerCollection({ base: 'test', enCollection: 74000, lignesFichier: 60000, meta: null }), true);
        verifier('production saine : passe', jugerCollection({ base: 'test', enCollection: 74188, lignesFichier: 74620, meta: { lignesDuFichier: 74620 } }), null);
        verifier('argument inconnu : refusé', !!lireArguments(['--base=test_scratch', '--vite']).erreur, true);
        verifier('production sans --confirmer-production : refusée', !!lireArguments(['--base=test']).erreur, true);
        verifier('production avec une autre URL : refusée', !!lireArguments(['--base=test', '--confirmer-production', '--url=http://127.0.0.1:1/B.json']).erreur, true);
        verifier('production avec une autre collection : refusée', !!lireArguments(['--base=test', '--confirmer-production', '--collection=autre']).erreur, true);
        verifier('production avec la confirmation : l\'URL de Cardmarket et catalogue_produits, eux seuls', lireArguments(['--base=test', '--confirmer-production']), { base: 'test', url: URL_EXPORT, sortie: null, collection: 'catalogue_produits' });
        const d = diffExport([{ idProduct: 1, name: 'a', idExpansion: 1, idMetacard: 1 }, { idProduct: 3, name: 'c', idExpansion: 1, idMetacard: 1 }], new Map([[1, { name: 'a', idExpansion: 2, idMetacard: 1 }], [2, { name: 'b', idExpansion: 1, idMetacard: 1 }]]));
        verifier('diffExport : un nouveau, une expansion changée, un disparu', [d.nouveaux.map(p => p.idProduct), d.expansions.length, d.noms.length, d.disparus], [[3], 1, 0, [2]]);
        const dd = diffExport([{ idProduct: 3, name: 'c', idExpansion: 1, idMetacard: 1 }, { idProduct: 3, name: 'c2', idExpansion: 1, idMetacard: 1 }], new Map());
        verifier('diffExport : un idProduct en double n\'est inséré qu\'une fois', [dd.nouveaux.length, dd.nouveaux[0].name, dd.doublons], [1, 'c', 1]);
    } finally {
        await vider();
        await viderR2();
        srv.close();
        await mongoose.disconnect();
    }
    console.log(`\n${echecs ? `⚠️ ${echecs}/${n} en échec` : `🎉 ${n}/${n} passés`} (test_scratch et préfixes R2 du banc vidés, aucune requête hors de la machine)`);
    process.exit(echecs ? 1 : 0);
})().catch(async e => { console.error(e); try { await mongoose.disconnect(); } catch (_) {} process.exit(1); });
