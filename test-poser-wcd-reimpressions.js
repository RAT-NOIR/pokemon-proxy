// node test-poser-wcd-reimpressions.js — poser-wcd.js ET poser-reimpressions.js sur un mongod LOCAL (deux serveurs en mémoire, loopback seulement : `cartes` d'un côté, `test` de l'autre).
// AUCUNE base de production : les URI de l'enfant sont celles des deux mongod du banc, rien d'autre ne lui est transmis (ni .env : le dossier de travail n'en a pas, ni clé réelle).
// Le paquet mongodb-memory-server et le binaire mongod vivent dans le `.banc-local` du dépôt principal (BANC_LOCAL=<dossier> pour en changer) ; ils ne sont pas dans ce worktree.
// TOOL_DIR=<dossier> rejoue le banc contre une copie MUTÉE des outils (le rouge se voit en cassant le code).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const DIR = process.env.TOOL_DIR || __dirname;
const BANC_LOCAL = process.env.BANC_LOCAL || 'C:/Users/Yung/Desktop/pokemon-proxy/.banc-local';
const MONGOD = path.join(BANC_LOCAL, 'cache-mongod', 'mongod-x64-win32-8.2.6.exe');
const { verifierPose } = require(path.join(DIR, 'collecte-cartes', 'verif-pose-lot.js'));

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => { const a = JSON.stringify(obtenu), b = JSON.stringify(attendu); if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); } };

// ── la vérification d'après-écriture (pure) ──
const saine = { avant: 10, apres: 12, inserees: 2, retrouvees: 0, posees: 2, cartesAttendues: 2, cartesRetrouvees: 2 };
verifier('verifierPose : un état sain passe', verifierPose(saine).ok, true);
verifier('verifierPose : le compte de la base ne colle pas (apres ≠ avant + insérées) → rouge', verifierPose({ ...saine, apres: 11 }).ok, false);
verifier('verifierPose : insérées + retrouvées ≠ lignes du plan → rouge', verifierPose({ ...saine, inserees: 1 }).ok, false);
verifier('verifierPose : une carte non retrouvée (liens.idProduct) → rouge', verifierPose({ ...saine, cartesRetrouvees: 1 }).ok, false);
verifier('verifierPose : un nombre illisible (undefined) → je ne peux pas conclure, rouge', [verifierPose({ ...saine, apres: undefined }).ok, verifierPose({ ...saine, avant: -1 }).ok], [false, false]);
verifier('verifierPose : retrouvées sans insertion (reprise) → passe', verifierPose({ avant: 5, apres: 5, inserees: 0, retrouvees: 2, posees: 2, cartesAttendues: 1, cartesRetrouvees: 1 }).ok, true);

(async () => {
    const { MongoMemoryServer } = require(path.join(BANC_LOCAL, 'node_modules', 'mongodb-memory-server'));
    const { MongoClient } = require('mongodb');
    const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'rat-banc-wcd-'));
    const serveurs = [];
    const demarrer = async nom => { const dbPath = path.join(racine, nom); fs.mkdirSync(dbPath); const s = await MongoMemoryServer.create({ binary: { systemBinary: MONGOD, checkMD5: false }, instance: { dbPath, ip: '127.0.0.1' } }); serveurs.push(s); return s; };
    try {
        const sCartes = await demarrer('cartes'), sProd = await demarrer('test');
        const uriCartes = sCartes.getUri(), uriProd = sProd.getUri();
        for (const u of [uriCartes, uriProd]) if (!/^mongodb:\/\/127\.0\.0\.1:\d+/.test(u)) throw new Error('le banc n\'est pas en loopback : arrêt');
        const cC = await MongoClient.connect(uriCartes), cP = await MongoClient.connect(uriProd);
        const dbC = cC.db('cartes'), dbP = cP.db('test');

        // ── le monde ──
        async function monde() {
            for (const d of [dbC, dbP]) for (const c of await d.listCollections().toArray()) await d.collection(c.name).drop();
            await dbP.collection('codes_set').insertMany([{ codeSet: 'HP', idExpansion: 100 }, { codeSet: 'PRE', idExpansion: 200 }]);
            const np = (idProduct, idExpansion, o = {}) => ({ idProduct, idExpansion, idMetacard: 1000 + idProduct, ...o });
            await dbP.collection('numeros_cartes').insertMany([
                np(1, 9001, { slug: 'Rare-Candy-WCD06HP-090', slugSet: 'WCD-2006' }), np(2, 9002, { slug: 'Choice-Belt-WCD22HP-091', slugSet: 'WCD-2022' }),
                np(3, 9001, { slug: 'Zzz-WCD06HP-092', slugSet: 'WCD-2006' }), np(4, 9001, { slug: 'Foo-WCD25001', slugSet: 'WCD-2025' }),
                np(11, 100, { numero: '090', slugSet: 'Holon-Phantoms' }), np(12, 100, { numero: '091', slugSet: 'Holon-Phantoms' }), np(13, 100, { numero: '092', slugSet: 'Holon-Phantoms' }),
                np(5, 9001, { slug: 'Holon-Adventurer-WCD06HP-093', slugSet: 'WCD-2006' }), np(14, 100, { numero: '093', slugSet: 'Holon-Phantoms' }),
                np(21, 9100, { slug: 'Budew-V3-SEAPRE-004', slugSet: 'Southeast-Asia-Promos', codeSet: 'SEA' }), np(22, 9100, { slug: 'Fan-Rotom-V2-SEAPRE-005', slugSet: 'Southeast-Asia-Promos', codeSet: 'SEA' }),
                np(23, 9100, { slug: 'Pikachu-SEAPRE-006', slugSet: 'Southeast-Asia-Promos', codeSet: 'SEA' }), np(33, 200, { numero: '006', slugSet: 'Prismatic' }),
                np(31, 200, { numero: '004', slugSet: 'Prismatic' }), np(32, 200, { numero: '005', slugSet: 'Prismatic' })]);
            await dbP.collection('catalogue_produits').insertMany([1, 2, 3, 4, 5, 11, 12, 13, 14, 21, 22, 23, 31, 32, 33].map(id => ({ idProduct: id, idExpansion: ({ 1: 9001, 2: 9002, 3: 9001, 4: 9001, 5: 9001, 21: 9100, 22: 9100, 23: 9100, 31: 200, 32: 200, 33: 200 })[id] ?? 100, idMetacard: 1000 + id, name: `Produit ${id}` })));
            await dbC.collection('cartes').insertMany([{ _id: 25165, nomEn: 'Rare Candy', attaques: [], impressions: [], liens: { idProduct: [11], idMetacards: [] } }, { _id: 267648, nomEn: 'Cinccino', attaques: [], impressions: [], liens: { idProduct: [12], idMetacards: [] } },
                { _id: 25154, nomEn: 'Holon Adventurer', attaques: [], impressions: [], liens: { idProduct: [14], idMetacards: [] } }, { _id: 30003, nomEn: 'Pikachu', attaques: [], impressions: [], liens: { idProduct: [33], idMetacards: [] } },
                { _id: 30001, nomEn: 'Budew', attaques: [{ nom: 'Itchy Pollen' }], impressions: [{ tirage: 'intl', expansion: 'Prismatic', numero: '004' }], liens: { idProduct: [31], idMetacards: [] } }]);
            await dbC.collection('cartes_produits').insertMany([{ _id: '25165|11', carteId: 25165, idProduct: 11 }, { _id: '267648|12', carteId: 267648, idProduct: 12 }, { _id: '25165|13', carteId: 25165, idProduct: 13 }, { _id: '25154|14', carteId: 25154, idProduct: 14 }, { _id: '30003|33', carteId: 30003, idProduct: 33 },
                { _id: '25165|3', carteId: 25165, idProduct: 3, preuve: 'autre' }, { _id: '30001|31', carteId: 30001, idProduct: 31 }, { _id: '267648|32', carteId: 267648, idProduct: 32 }]);
        }
        const etat = async () => JSON.stringify([await dbC.collection('cartes_produits').find({}).sort({ _id: 1 }).toArray(), await dbC.collection('cartes').find({}).sort({ _id: 1 }).toArray()]);
        const env = {
            PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, NODE_PATH: process.env.NODE_PATH, TEMP: process.env.TEMP, TMP: process.env.TMP,
            MONGODB_CARTES_URI: uriCartes, MONGODB_URI: uriProd, MONGODB_CARTES_BASE: 'cartes', R2_ACCOUNT_ID: 'banc', R2_ACCESS_KEY_ID: 'banc', R2_SECRET_ACCESS_KEY: 'banc'
        };
        const tmpJson = (nom, contenu) => { const f = path.join(racine, nom); fs.writeFileSync(f, typeof contenu === 'string' ? contenu : JSON.stringify(contenu)); return f; };
        const lancer = (outil, args) => { const r = spawnSync(process.execPath, [path.join(DIR, outil), ...args], { cwd: __dirname, env, encoding: 'utf8', timeout: 120000 }); return { code: r.status, sortie: `${r.stdout}\n${r.stderr}` }; };
        const lignesWcd = async () => (await dbC.collection('cartes_produits').find({ preuve: 'wcd+origine+numero' }).toArray()).map(l => l._id).sort();
        const lignesSea = async () => (await dbC.collection('cartes_produits').find({ preuve: 'reimpression+origine+numero' }).toArray()).map(l => `${l._id}:${l.route}`).sort();

        // ════ poser-wcd.js ════
        await monde(); let avant = await etat();
        // le plan : produits 1 (Rare Candy) et 5 (Holon Adventurer) passent le témoin du nom ; 2 (Choice Belt → carte Cinccino) est refusé ; 3 a déjà une ligne ; 4 ne se décode pas → la sonde (avant témoin) est 3
        let r = lancer('poser-wcd.js', ['--sonde=3']);
        verifier('WCD mesure seule : exit 0, 2 fiches à poser, 1 refusée par le témoin du nom, RIEN d\'écrit', [r.code, /✅ +2 fiches à poser/.test(r.sortie), /🔴 +1 REFUSÉS par le témoin du nom/.test(r.sortie), await etat() === avant], [0, true, true, true]);
        r = lancer('poser-wcd.js', ['--sonde=3', '--ecrire']);
        verifier('WCD : --ecrire SANS --attendu → exit 2, rien d\'écrit', [r.code, /exige --attendu/.test(r.sortie), await etat() === avant], [2, true, true]);
        r = lancer('poser-wcd.js', ['--sonde=3', '--attendu=3', '--ecrire']);
        verifier('WCD : --attendu faux (3 pour 2) → exit 1, RIEN d\'écrit', [r.code, /--attendu=3/.test(r.sortie), await etat() === avant], [1, true, true]);
        r = lancer('poser-wcd.js', ['--sonde=3', '--force']);
        verifier('WCD : un argument inconnu → exit 2', [r.code, /argument inconnu/.test(r.sortie)], [2, true]);
        r = lancer('poser-wcd.js', ['--sonde=3', '--attendu=2', '--ecrire']);
        verifier('WCD : --attendu=2 → exit 0, DEUX lignes posées (25154|5, 25165|1), les cartes reçoivent leur produit dans liens.idProduct, relues', [r.code, await lignesWcd(), (await dbC.collection('cartes').findOne({ _id: 25165 })).liens.idProduct, /relu : 2 lignes posées/.test(r.sortie)], [0, ['25154|5', '25165|1'], [11, 1], true]);
        const apres1 = await etat();
        r = lancer('poser-wcd.js', ['--sonde=3', '--attendu=2', '--ecrire']);
        verifier('WCD : relancer le lot déjà écrit → exit 1 (la sonde ne retrouve plus ses 3), AUCUNE ligne en double ni modifiée', [r.code, await etat() === apres1, (await lignesWcd()).length], [1, true, 2]);
        // --seulement : la liste des SEULS à écrire (ici 1 sur les 2 du plan)
        await monde(); avant = await etat();
        r = lancer('poser-wcd.js', ['--sonde=3', `--seulement=${tmpJson('s1.json', [1])}`, '--attendu=1', '--ecrire']);
        verifier('WCD --seulement=[1] : exit 0, la ligne 1 SEULE (la 5, du plan, n\'est pas écrite)', [r.code, await lignesWcd(), /1 retenues/.test(r.sortie)], [0, ['25165|1'], true]);
        await monde(); avant = await etat();
        r = lancer('poser-wcd.js', ['--sonde=3', `--seulement=${tmpJson('s1b.json', [1])}`, '--attendu=2', '--ecrire']);
        verifier('WCD --seulement=[1] avec --attendu=2 (le plan entier) → exit 1 : l\'attendu est celui du plan RETENU, rien d\'écrit', [r.code, await etat() === avant], [1, true]);
        r = lancer('poser-wcd.js', ['--sonde=3', `--seulement=${tmpJson('s2.json', [999])}`, '--attendu=1', '--ecrire']);
        verifier('WCD --seulement avec un idProduct qui n\'est pas dans le plan (999) → exit 1, rien d\'écrit', [r.code, /ne sont pas dans le plan/.test(r.sortie), await etat() === avant], [1, true, true]);
        r = lancer('poser-wcd.js', ['--sonde=3', `--seulement=${tmpJson('s3.json', [])}`, '--attendu=1', '--ecrire']);
        verifier('WCD --seulement=[] (fichier vide) → exit 2, rien d\'écrit', [r.code, /NON VIDE/.test(r.sortie), await etat() === avant], [2, true, true]);
        r = lancer('poser-wcd.js', ['--sonde=3', `--seulement=${tmpJson('s4.json', [1, 2])}`, '--attendu=1', '--ecrire']);
        verifier('WCD --seulement=[1,2] : 2 est dans le plan brut mais refusé par le témoin → exit 1 (il n\'est pas dans le plan retenu), rien d\'écrit', [r.code, await etat() === avant], [1, true]);
        // une écriture que la base REFUSE (validateur) : exit 1, jamais un succès silencieux
        await monde(); await dbC.command({ collMod: 'cartes', validator: { 'liens.idProduct': { $not: { $in: [1] } } }, validationLevel: 'strict', validationAction: 'error' }).catch(async () => { await dbC.createCollection('cartes_x'); });
        r = lancer('poser-wcd.js', ['--sonde=3', '--attendu=2', '--ecrire']);
        verifier('WCD : une écriture refusée par la base (validateur sur cartes) → exit ≠ 0, jamais « relu »', [r.code !== 0, /relu : 2 lignes/.test(r.sortie)], [true, false]);

        // la garde ROUGE d'après-écriture, de bout en bout : une ligne déjà là sous le même _id, d'une AUTRE preuve et sans idProduct (la jointure ne la voit pas), est CONVERTIE par l'upsert :
        // les lignes de la preuve passent de 0 à 1 sans qu'aucune ne soit insérée → le compte ne colle pas → exit 1 (avant : un simple console.log, exit 0)
        await monde(); await dbC.collection('cartes_produits').insertOne({ _id: '25165|1', preuve: 'autre' });
        r = lancer('poser-wcd.js', ['--sonde=3', '--attendu=2', '--ecrire']);
        verifier('WCD : une ligne d\'une autre preuve CONVERTIE par l\'upsert → la garde rouge SORT en code 1 et le dit', [r.code, /LE COMPTE RÉEL NE COLLE PAS/.test(r.sortie)], [1, true]);

        // ════ poser-reimpressions.js ════
        await monde(); avant = await etat();
        r = lancer('poser-reimpressions.js', ['--codes=SEA']);
        verifier('SEA mesure seule : exit 0, 2 résolues (Budew, Pikachu), 1 refusée par le témoin (Fan Rotom → Cinccino), RIEN d\'écrit', [r.code, /resolu 2/.test(r.sortie), /nomDiscordant 1/.test(r.sortie), await etat() === avant], [0, true, true, true]);
        r = lancer('poser-reimpressions.js', ['--codes=SEA', '--ecrire']);
        verifier('SEA : --ecrire SANS --attendu → exit 2, rien d\'écrit', [r.code, /exige --attendu=CODE:N/.test(r.sortie), await etat() === avant], [2, true, true]);
        r = lancer('poser-reimpressions.js', ['--codes=SEA', '--attendu=SEA:3', '--ecrire']);
        verifier('SEA : --attendu faux (3 pour 2) → exit 1, RIEN d\'écrit', [r.code, /3 attendus/.test(r.sortie), await etat() === avant], [1, true, true]);
        r = lancer('poser-reimpressions.js', ['--codes=SEA', '--force']);
        verifier('SEA : un argument inconnu → exit 2', [r.code, /argument inconnu/.test(r.sortie)], [2, true]);
        r = lancer('poser-reimpressions.js', ['--codes=SEA', '--attendu=SEA:2', '--ecrire']);
        verifier('SEA : --attendu=SEA:2 → exit 0, DEUX lignes (30001|21, 30003|23, route SEA), les cartes reçoivent leur produit, relues', [r.code, await lignesSea(), (await dbC.collection('cartes').findOne({ _id: 30001 })).liens.idProduct, /relu : 2 lignes posées/.test(r.sortie)], [0, ['30001|21:SEA', '30003|23:SEA'], [31, 21], true]);
        await monde(); avant = await etat();
        r = lancer('poser-reimpressions.js', ['--codes=SEA', `--seulement=${tmpJson('r1.json', [21])}`, '--attendu=SEA:1', '--ecrire']);
        verifier('SEA --seulement=[21] : exit 0, la ligne 21 SEULE (la 23, du plan, n\'est pas écrite)', [r.code, await lignesSea()], [0, ['30001|21:SEA']]);
        await monde(); avant = await etat();
        r = lancer('poser-reimpressions.js', ['--codes=SEA', `--seulement=${tmpJson('r2.json', [21, 999])}`, '--attendu=SEA:1', '--ecrire']);
        verifier('SEA --seulement avec un idProduct hors plan (999) → exit 1, rien d\'écrit', [r.code, /ne sont dans le plan d'aucun code/.test(r.sortie), await etat() === avant], [1, true, true]);
        r = lancer('poser-reimpressions.js', ['--codes=SEA', `--seulement=${tmpJson('r3.json', [])}`, '--attendu=SEA:1', '--ecrire']);
        verifier('SEA --seulement=[] (fichier vide) → exit 2, rien d\'écrit', [r.code, await etat() === avant], [2, true]);
        r = lancer('poser-reimpressions.js', ['--codes=SEA', `--seulement=${tmpJson('r4.json', [22])}`, '--attendu=SEA:0', '--ecrire']);
        verifier('SEA --seulement=[22] (22 refusé par le témoin : hors du plan) → exit 1, rien d\'écrit', [r.code, await etat() === avant], [1, true]);
        await monde(); await dbC.collection('cartes_produits').insertOne({ _id: '30001|21', preuve: 'autre', route: 'SEA' });
        r = lancer('poser-reimpressions.js', ['--codes=SEA', '--attendu=SEA:2', '--ecrire']);
        verifier('SEA : une ligne d\'une autre preuve CONVERTIE par l\'upsert → la garde rouge SORT en code 1 et le dit', [r.code, /LE COMPTE RÉEL NE COLLE PAS/.test(r.sortie)], [1, true]);
        await cC.close(); await cP.close();
    } finally {
        for (const s of serveurs) { try { await s.stop({ doCleanup: false }); } catch { } }
        try { fs.rmSync(racine, { recursive: true, force: true }); } catch { }
    }
    console.log(`\n${ok} passés, ${ko} en échec`);
    process.exit(ko ? 1 : 0);
})().catch(e => { console.error('❌ ERREUR DU BANC', e); process.exit(1); });
