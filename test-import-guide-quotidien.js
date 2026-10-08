// Banc de import-guide-quotidien.js — base `test_scratch` UNIQUEMENT, fichiers servis par un serveur HTTP LOCAL (aucune requête à
// Cardmarket), collections du guide vidées avant et après.
//   node test-import-guide-quotidien.js
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

let echecs = 0, n = 0;
const verifier = (nom, obtenu, attendu) => { n++; const ok = JSON.stringify(obtenu) === JSON.stringify(attendu); if (!ok) echecs++; console.log(`${ok ? '✅' : '❌'} ${nom} : ${JSON.stringify(obtenu)}${ok ? '' : ` (attendu ${JSON.stringify(attendu)})`}`); };
const lignes = (k, prix = true) => Array.from({ length: k }, (_, i) => ({ idProduct: 1000 + i, ...(prix ? { trend: 1 + i / 100, avg: 1 } : {}) }));
const FICHIERS = {
    '/A.json': JSON.stringify({ version: 1, createdAt: '2026-10-01T02:00:00+0200', priceGuides: lignes(100) }),
    '/B.json': JSON.stringify({ version: 1, createdAt: '2026-10-02T02:00:00+0200', priceGuides: lignes(100) }),
    '/tronque.json': JSON.stringify({ version: 1, createdAt: '2026-10-03T02:00:00+0200', priceGuides: lignes(50) }),
    '/sansprix.json': JSON.stringify({ version: 1, createdAt: '2026-10-03T02:00:00+0200', priceGuides: [...lignes(30), ...lignes(80, false).map((l, i) => ({ idProduct: 5000 + i }))] }),
    '/pasjson.json': '<html>Cloudflare</html>',
    '/futur.json': JSON.stringify({ version: 1, createdAt: '2099-01-01T02:00:00+0200', priceGuides: lignes(100) }),
    '/C.json': JSON.stringify({ version: 1, createdAt: '2026-10-04T02:00:00+0200', priceGuides: lignes(100) })
};
const lancer = (...args) => lancerAvec({}, ...args);
const lancerAvec = (env, ...args) => new Promise(resolve => {
    const p = spawn(process.execPath, [path.join(__dirname, 'import-guide-quotidien.js'), ...args], { env: { ...process.env, ...env } });
    let out = '', err = '';
    p.stdout.on('data', d => out += d); p.stderr.on('data', d => err += d);
    p.on('close', status => resolve({ status, out, err }));
});

(async () => {
    // BASE DE BANC (2026-10-08) : plus jamais la production — base mémoire, ou MONGODB_TEST_URI hors production, sinon REFUS (base-banc.js).
    // Les imports lancés en sous-processus héritent de cet environnement.
    (await ouvrirBanc()).appliquer();
    // R2 (2026-10-08, tour 3) : ce banc ÉCRIT sur R2 (sauvegardes) via les imports lancés en sous-processus — il n'écrit jamais dans un bucket
    // de production. R2_BUCKET_BANC (un bucket de banc dédié) est obligatoire ; appliquer() y redirige alors R2_BUCKET_BRUT pour le processus et ses enfants.
    if (!process.env.R2_BUCKET_BANC) { console.error('❌ REFUS : ce banc écrit sur R2 et aucun bucket de banc n\'est défini (R2_BUCKET_BANC absent). Rien n\'a été écrit.'); process.exit(1); }
    const base = await connecterMongo({ script: 'test-import-guide-quotidien.js', ecrit: true });
    if (base !== 'test_scratch') { console.error(`❌ banc sur « ${base} » : refusé, test_scratch seulement`); process.exit(1); }
    const db = mongoose.connection.db;
    // `drop`, pas `deleteMany` (FUITE-MAIN, 2026-10-08) : deleteMany laissait guide_prix et guide_prix_meta (fichier + index) sur la grappe de production
    const vider = async () => { await viderBac(db, { noms: ['guide_prix', 'guide_prix_meta'], log: () => { } }); };
    await vider();
    // le préfixe R2 du banc, vidé AVANT aussi : un passage interrompu laisse ses sauvegardes, et le compte suivant serait faux
    const r2 = require('./collecte-cartes/r2');
    await r2.verifierBucket(process.env.R2_BUCKET_BRUT);   // fixe le point d'accès UE — sans lui, « AccessDenied » (§52)
    const PREFIXE = 'sauvegardes/guide_prix/test_scratch/';
    const restes = await r2.listerPrefixe(process.env.R2_BUCKET_BRUT, PREFIXE);
    if (restes.length) await r2.supprimer(process.env.R2_BUCKET_BRUT, restes);
    // le serveur local se comporte comme S3 : un ETag par contenu, 304 SANS CORPS à une requête conditionnelle qui le cite
    let requetes = 0, nonModifies = 0;
    const etagDe = f => `"${crypto.createHash('sha1').update(f).digest('hex')}"`;
    const srv = http.createServer((req, res) => {
        requetes++; const f = FICHIERS[req.url]; if (!f) { res.writeHead(404); return res.end(); }
        if (req.headers['if-none-match'] === etagDe(f)) { nonModifies++; res.writeHead(304, { etag: etagDe(f) }); return res.end(); }
        res.writeHead(200, { 'content-type': 'application/json', etag: etagDe(f), 'last-modified': 'Wed, 07 Oct 2026 00:49:50 GMT' }); res.end(f);
    });
    await new Promise(r => srv.listen(0, '127.0.0.1', r));
    const url = f => `--url=http://127.0.0.1:${srv.address().port}${f}`;
    try {
        const G = db.collection('guide_prix'), M = db.collection('guide_prix_meta');
        const rA = await lancer('--base=test_scratch', url('/A.json'));
        verifier('guide A : téléchargé et importé par la commande de toujours', [rA.status, await G.countDocuments({}), (await M.findOne({ _id: 'dernier' }))?.lignesDuFichier], [0, 100, 100]);
        verifier('les validateurs HTTP du guide importé sont gardés dans la méta', (await M.findOne({ _id: 'dernier' }))?.http?.etag, etagDe(FICHIERS['/A.json']));
        const majAtA = (await G.findOne({ idProduct: 1000 })).majAt.toISOString();
        // (testeur, 2026-10-08) le même fichier ne se retélécharge pas : requête conditionnelle, 304 sans corps
        const n0 = nonModifies;
        const rA2 = await lancer('--base=test_scratch', url('/A.json'));
        verifier('le même guide une seconde fois : 304 sans corps (AUCUN téléchargement), « rien de neuf », sortie 0, rien d\'écrit', [rA2.status, /rien de neuf/.test(rA2.out), nonModifies - n0, (await G.findOne({ idProduct: 1000 })).majAt.toISOString() === majAtA], [0, true, 1, true]);
        const rF = await lancer('--base=test_scratch', url('/futur.json'));
        verifier('un guide daté du FUTUR : refusé, la méta ne bouge pas', [rF.status, /FUTUR/.test(rF.err), (await M.findOne({ _id: 'dernier' })).guideDu.toISOString()], [1, true, '2026-10-01T00:00:00.000Z']);
        const rT = await lancer('--base=test_scratch', url('/tronque.json'));
        verifier('fichier tronqué (50 lignes contre 100) : refusé, la méta ne bouge pas', [rT.status, /tronqué/.test(rT.err), (await M.findOne({ _id: 'dernier' })).guideDu.toISOString()], [1, true, '2026-10-01T00:00:00.000Z']);
        verifier('un fichier REFUSÉ ne laisse pas ses validateurs : la méta garde ceux de A', (await M.findOne({ _id: 'dernier' }))?.http?.etag, etagDe(FICHIERS['/A.json']));
        const rS = await lancer('--base=test_scratch', url('/sansprix.json'));
        verifier('fichier où moins de 90 % des lignes ont un prix : refusé', [rS.status, /portent un prix/.test(rS.err)], [1, true]);
        const rJ = await lancer('--base=test_scratch', url('/pasjson.json'));
        verifier('une page HTML à la place du fichier : refusée', [rJ.status, /illisible/.test(rJ.err)], [1, true]);
        const r404 = await lancer('--base=test_scratch', url('/absent.json'));
        verifier('fichier absent (404) : sortie 1, le statut est dit', [r404.status, /HTTP 404/.test(r404.err)], [1, true]);
        const rB = await lancer('--base=test_scratch', url('/B.json'));
        verifier('guide B, plus récent : importé', [rB.status, (await M.findOne({ _id: 'dernier' })).guideDu.toISOString()], [0, '2026-10-02T00:00:00.000Z']);
        // la SAUVEGARDE IMPOSSIBLE (bucket absent) : RIEN n'est importé — le cœur de l'ordre, vérifié sur la base et la méta
        // (2026-10-07, nuit) le bucket absent se constate AVANT la requête — et MONGODB_URI aussi (le worker l'avait oubliée : six fichiers
        // téléchargés pour rien)
        const q0 = requetes;
        const rS0 = await lancerAvec({ R2_BUCKET_BRUT: '' }, '--base=test_scratch', url('/C.json'));
        verifier('sauvegarde impossible : sortie 1, le guide C n\'est PAS importé, AUCUNE requête', [rS0.status, /R2_BUCKET_BRUT absent/.test(rS0.err), (await M.findOne({ _id: 'dernier' })).guideDu.toISOString(), await G.countDocuments({ guideDu: new Date('2026-10-04T00:00:00Z') }), requetes - q0], [1, true, '2026-10-02T00:00:00.000Z', 0, 0]);
        const q1 = requetes;
        const rU0 = await lancerAvec({ MONGODB_URI: '' }, '--base=test_scratch', url('/C.json'));
        verifier('MONGODB_URI absent : sortie 1, la variable est NOMMÉE, AUCUNE requête', [rU0.status, /MONGODB_URI absente/.test(rU0.err), requetes - q1], [1, true, 0]);
        // (relecture, 2026-10-08) présente n'est pas JOIGNABLE : la base et le bucket se vérifient eux aussi avant la requête
        const q2 = requetes;
        const rU1 = await lancerAvec({ MONGODB_URI: 'mongodb://127.0.0.1:1/?serverSelectionTimeoutMS=1500' }, '--base=test_scratch', url('/C.json'));
        verifier('base injoignable : sortie 1, AUCUNE requête', [rU1.status, requetes - q2], [1, 0]);
        const q3 = requetes;
        const rS1 = await lancerAvec({ R2_BUCKET_BRUT: 'banc-bucket-qui-n-existe-pas' }, '--base=test_scratch', url('/C.json'));
        verifier('bucket qui ne répond pas : sortie 1, le guide C n\'est PAS importé, AUCUNE requête', [rS1.status, (await M.findOne({ _id: 'dernier' })).guideDu.toISOString(), requetes - q3], [1, '2026-10-02T00:00:00.000Z', 0]);
        // LES ARGUMENTS : testés SANS lancer le script (lireArguments est pure) — aucun cas ne peut atteindre la base de production ni
        // Cardmarket, même si une garde régressait (relecture du 2026-10-03)
        const { lireArguments, URL_GUIDE } = require('./import-guide-quotidien');
        verifier('argument inconnu : refusé', !!lireArguments(['--base=test_scratch', '--vite']).erreur, true);
        verifier('production sans --confirmer-production : refusée', !!lireArguments(['--base=test']).erreur, true);
        verifier('production avec une autre URL que celle de Cardmarket : refusée', !!lireArguments(['--base=test', '--confirmer-production', '--url=http://127.0.0.1:1/B.json']).erreur, true);
        verifier('production avec la confirmation : l\'URL de Cardmarket, et elle seule', lireArguments(['--base=test', '--confirmer-production']), { base: 'test', url: URL_GUIDE });
        verifier('sans base : refusé', !!lireArguments(['--confirmer-production']).erreur, true);
        // la SAUVEGARDE : une par import arrivé à l'étape 3 (A et B), relisible, sous le préfixe de la base du banc
        const cles = await r2.listerPrefixe(process.env.R2_BUCKET_BRUT, PREFIXE);
        verifier('deux sauvegardes écrites sur R2 (une avant chaque écriture), aucune pour les refus', cles.length, 2);
        if (cles.length) await r2.supprimer(process.env.R2_BUCKET_BRUT, cles);
    } finally {
        await vider();
        srv.close();
        await mongoose.disconnect();
    }
    console.log(`\n${echecs ? `⚠️ ${echecs}/${n} en échec` : `🎉 ${n}/${n} passés`} (test_scratch vidé, aucune requête hors de la machine)`);
    process.exit(echecs ? 1 : 0);
})().catch(async e => { console.error(e); try { await mongoose.disconnect(); } catch (_) {} process.exit(1); });
