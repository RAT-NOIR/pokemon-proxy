// Banc de la LECTURE SEULE (décision 6 du testeur, 2026-10-08) — AUCUNE connexion réelle : faux environnement, faux mongoose, faux client.
//   node test-lecture-seule.js
// Un banc qui lit la production exige MONGODB_LECTURE_URI (grappe test) ou MONGODB_CARTES_LECTURE_URI (grappe cartes) et REFUSE avant toute
// connexion si elle manque : plus de repli sur l'URI d'écriture. Une URI « de lecture » qui est en fait l'URI d'écriture est refusée, et un
// utilisateur qui porte un privilège d'écriture est refusé à la connexion (connectionStatus + showPrivileges). Un banc qui écrit sur R2 exige R2_BUCKET_BANC.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const B = require('./collecte-cartes/base-banc');

let echecs = 0, n = 0;
const verifier = (nom, obtenu, attendu) => { n++; const ok = JSON.stringify(obtenu) === JSON.stringify(attendu); if (!ok) echecs++; console.log(`${ok ? '✅' : '❌'} ${nom} : ${JSON.stringify(obtenu)}${ok ? '' : ` (attendu ${JSON.stringify(attendu)})`}`); };
const leve = async f => { try { await f(); return null; } catch (e) { return String(e.message); } };

// valeurs FABRIQUÉES (jamais celles du .env) ; les secrets servent à prouver qu'aucun message ne fuit une valeur
const ECRIT = 'mongodb+srv://ecrivain:SECRET-ECRIT@cluster0.abcde.mongodb.net/test';
const ECRIT_CARTES = 'mongodb+srv://ecrivain2:SECRET-CARTES@cluster1.fghij.mongodb.net/cartes';
const LECT = 'mongodb+srv://lecteur:SECRET-LECT@cluster0.abcde.mongodb.net/test';
const LECT_CARTES = 'mongodb+srv://lecteur2:SECRET-LECT2@cluster1.fghij.mongodb.net/cartes';
const BASE = { MONGODB_URI: ECRIT, MONGODB_CARTES_URI: ECRIT_CARTES, MONGODB_TEST_URI: 'mongodb://127.0.0.1:1/x' };
const sansFuite = (...msgs) => msgs.some(m => /SECRET|ecrivain|lecteur/.test(m || ''));

(async () => {
    // ── 1. jugerLecture : l'URI de lecture est exigée, et ne se confond pas avec l'URI d'écriture
    const J = (env, quoi) => B.jugerLecture ? B.jugerLecture({ ...BASE, ...env }, quoi) : { ok: true, raison: 'jugerLecture absente' };
    for (const [quoi, variable, lect, ecrit] of [['production', 'MONGODB_LECTURE_URI', LECT, ECRIT], ['cartes', 'MONGODB_CARTES_LECTURE_URI', LECT_CARTES, ECRIT_CARTES]]) {
        const absent = J({}, quoi);
        verifier(`${quoi} : ${variable} absente : REFUS qui nomme la variable et dit que c'est attendu`, [absent.ok, absent.raison.includes(variable), /attendu/.test(absent.raison)], [false, true, true]);
        verifier(`${quoi} : ${variable} vide : REFUS`, J({ [variable]: '' }, quoi).ok, false);
        verifier(`${quoi} : URI illisible : REFUS`, J({ [variable]: 'pas une uri' }, quoi).ok, false);
        const egale = J({ [variable]: ecrit }, quoi);
        verifier(`${quoi} : URI de lecture = URI d'ÉCRITURE (même valeur) : REFUS, sans fuite de valeur`, [egale.ok, /écriture/.test(egale.raison), sansFuite(egale.raison)], [false, true, false]);
        const memeUtilisateur = J({ [variable]: ecrit.replace('SECRET-ECRIT', 'autre').replace('SECRET-CARTES', 'autre') + '?retryWrites=true' }, quoi);
        verifier(`${quoi} : même UTILISATEUR que l'écriture (autre mot de passe ou options) : REFUS`, memeUtilisateur.ok, false);
        verifier(`${quoi} : sans identifiants : REFUS`, J({ [variable]: lect.replace(/\/\/[^@]*@/, '//') }, quoi).ok, false);
        const autreGrappe = J({ [variable]: quoi === 'production' ? LECT_CARTES : LECT }, quoi);
        verifier(`${quoi} : l'URI de lecture de l'AUTRE grappe : REFUS (mauvaise grappe)`, autreGrappe.ok, false);
        verifier(`${quoi} : variable d'écriture absente : on ne peut pas comparer, REFUS`, (B.jugerLecture ? B.jugerLecture({ [variable]: lect }, quoi) : { ok: true }).ok, false);
        const bonne = J({ [variable]: lect }, quoi);
        verifier(`${quoi} : un utilisateur distinct sur la bonne grappe : accepté (l'uri est rendue, aucun message)`, [bonne.ok, bonne.uri === lect, bonne.raison], [true, true, null]);
    }
    verifier('production : MONGODB_LECTURE_URI valant l\'URI d\'écriture de la grappe CARTES : REFUS', J({ MONGODB_LECTURE_URI: ECRIT_CARTES }, 'production').ok, false);

    // ── 2. les privilèges, constatés SANS écrire (connectionStatus + showPrivileges) sur un faux client
    const fauxDb = (reponse, { leveur = null } = {}) => { const commandes = []; return { commandes, admin: () => ({ command: async c => { commandes.push(c); if (leveur) throw new Error(leveur); return reponse; } }) }; };
    const statut = (privileges, { users = [{ user: 'lecteur', db: 'admin' }] } = {}) => ({ ok: 1, authInfo: { authenticatedUsers: users, authenticatedUserRoles: [], authenticatedUserPrivileges: privileges } });
    const LIRE = ['find', 'listCollections', 'listIndexes', 'collStats', 'dbStats', 'dbHash', 'killCursors', 'changeStream'];
    const V = async (rep, base = 'test', opts) => { const d = fauxDb(rep, opts); const r = B.verifierPrivilegesLecture ? await B.verifierPrivilegesLecture(d, base) : { ok: true, raison: 'absente' }; return { ...r, commandes: d.commandes }; };
    const lectureSeule = await V(statut([{ resource: { db: 'test', collection: '' }, actions: LIRE }]));
    verifier('privilèges : un rôle read (find, listCollections…) : accepté', lectureSeule.ok, true);
    verifier('   ... la SEULE commande envoyée est connectionStatus avec showPrivileges (aucune écriture)', lectureSeule.commandes, [{ connectionStatus: 1, showPrivileges: true }]);
    const refuses = {
        'readWrite (insert, update, remove sur la base lue)': [{ resource: { db: 'test', collection: '' }, actions: [...LIRE, 'insert', 'update', 'remove'] }],
        'dbAdmin (createCollection, dropCollection, createIndex)': [{ resource: { db: 'test', collection: '' }, actions: [...LIRE, 'createCollection', 'dropCollection', 'createIndex'] }],
        'écriture sur toutes les bases (db vide)': [{ resource: { db: '', collection: '' }, actions: [...LIRE, 'insert'] }],
        'écriture sur une AUTRE base de la grappe': [{ resource: { db: 'test', collection: '' }, actions: LIRE }, { resource: { db: 'cartes', collection: '' }, actions: ['insert'] }],
        'une action inconnue (doute = refus)': [{ resource: { db: 'test', collection: '' }, actions: [...LIRE, 'actionDeDemain'] }],
        'anyResource': [{ resource: { anyResource: true }, actions: LIRE }],
        'cluster avec une action hors liste': [{ resource: { db: 'test', collection: '' }, actions: LIRE }, { resource: { cluster: true }, actions: ['shutdown'] }],
        'aucun droit find sur la base lue': [{ resource: { db: 'autre', collection: '' }, actions: LIRE }],
        'aucun privilège': []
    };
    const mal = [];
    for (const [nom, privs] of Object.entries(refuses)) { const r = await V(statut(privs)); if (r.ok !== false) mal.push(nom); }
    verifier(`privilèges : ${Object.keys(refuses).length} utilisateurs qui portent un droit d'écriture, un droit inconnu, ou aucun droit de lecture : TOUS refusés`, mal, []);
    verifier('privilèges : aucun utilisateur authentifié (connexion anonyme) : refus', (await V(statut([{ resource: { db: 'test', collection: '' }, actions: LIRE }], { users: [] }))).ok, false);
    verifier('privilèges : réponse sans authInfo : refus (je ne peux pas conclure)', (await V({ ok: 1 })).ok, false);
    verifier('privilèges : null : refus', (await V(null)).ok, false);
    const panne = await V(null, 'test', { leveur: 'connexion SECRET coupée' });
    verifier('privilèges : la commande échoue : refus, et le message ne reprend pas le texte de l\'erreur du pilote', [panne.ok, sansFuite(panne.raison)], [false, false]);
    verifier('privilèges : cluster listDatabases + find sur la base : accepté', (await V(statut([{ resource: { db: 'test', collection: '' }, actions: LIRE }, { resource: { cluster: true }, actions: ['listDatabases'] }]))).ok, true);

    // ── 3. ouvrirBanc : les lectures et les écritures R2 DÉCLARÉES sont exigées AVANT tout démarrage (aucune base de mémoire lancée)
    const ouvrir = (extra, opts = {}) => B.ouvrirBanc({ env: { ...BASE, ...extra }, memoireDisponible: false, ...opts });
    const r0 = await leve(() => ouvrir({}, { lit: { production: 'le journal des scans' } }));
    verifier('ouvrirBanc({ lit: production }) sans MONGODB_LECTURE_URI : REFUS qui nomme la variable, ce que le banc aurait lu, et « attendu »', [!!r0, /MONGODB_LECTURE_URI/.test(r0 || ''), /journal des scans/.test(r0 || ''), /attendu/.test(r0 || ''), sansFuite(r0)], [true, true, true, true, false]);
    const r1 = await leve(() => ouvrir({}, { lit: { cartes: 'des cartes réelles' } }));
    verifier('ouvrirBanc({ lit: cartes }) sans MONGODB_CARTES_LECTURE_URI : REFUS qui nomme la variable', [!!r1, /MONGODB_CARTES_LECTURE_URI/.test(r1 || '')], [true, true]);
    const r2 = await leve(() => ouvrir({ MONGODB_LECTURE_URI: ECRIT }, { lit: { production: 'x' } }));
    verifier('ouvrirBanc({ lit }) avec une « URI de lecture » qui est l\'URI d\'écriture : REFUS', [!!r2, sansFuite(r2)], [true, false]);
    verifier('ouvrirBanc({ lit }) avec une vraie URI de lecture : démarre', await leve(() => ouvrir({ MONGODB_LECTURE_URI: LECT, MONGODB_CARTES_LECTURE_URI: LECT_CARTES }, { lit: { production: 'x', cartes: 'y' } })), null);
    verifier('ouvrirBanc() sans lit : un banc qui ne lit pas la production tourne sans ces variables', await leve(() => ouvrir({})), null);
    const w0 = await leve(() => ouvrir({}, { ecritR2: 'les sauvegardes d\'import' }));
    verifier('ouvrirBanc({ ecritR2 }) sans R2_BUCKET_BANC : REFUS qui nomme la variable, le bucket attendu et ce que le banc aurait écrit', [!!w0, /R2_BUCKET_BANC/.test(w0 || ''), /rat-market-banc/.test(w0 || ''), /sauvegardes d'import/.test(w0 || ''), /attendu/.test(w0 || '')], [true, true, true, true, true]);
    const w1 = await leve(() => ouvrir({ R2_BUCKET_BANC: 'prod-brut', R2_BUCKET_BRUT: 'prod-brut' }, { ecritR2: 'x' }));
    verifier('ouvrirBanc({ ecritR2 }) avec R2_BUCKET_BANC égal à un bucket de production : REFUS avant tout démarrage', [!!w1, /production/.test(w1 || '')], [true, true]);
    verifier('ouvrirBanc({ ecritR2 }) avec R2_BUCKET_BANC distinct : démarre', await leve(() => ouvrir({ R2_BUCKET_BANC: 'rat-market-banc', R2_BUCKET_BRUT: 'prod-brut' }, { ecritR2: 'x' })), null);

    // ── 4. connexionProduction / connexionCartes / connecterLecture : refus SANS ouvrir de connexion, puis privilèges contrôlés
    const fauxMongoose = (rep, { leveur } = {}) => {
        const vu = { createConnection: 0, connect: 0, ferme: 0, disconnect: 0 };
        const db = fauxDb(rep, { leveur }); const dbNatif = { databaseName: 'test', admin: db.admin, collection: () => ({}), listCollections: () => ({}) };
        const cx = { db: dbNatif, close: async () => { vu.ferme++; } };
        return { vu, commandes: db.commandes, createConnection: () => { vu.createConnection++; return { asPromise: async () => cx }; }, connect: async () => { vu.connect++; }, disconnect: async () => { vu.disconnect++; }, connection: { db: dbNatif } };
    };
    const lecturesOk = statut([{ resource: { db: 'test', collection: '' }, actions: LIRE }]);
    const lecturesCartesOk = statut([{ resource: { db: 'cartes', collection: '' }, actions: LIRE }]);
    const ecritureOk = statut([{ resource: { db: 'test', collection: '' }, actions: [...LIRE, 'insert'] }]);
    const banc = extra => B.ouvrirBanc({ env: { ...BASE, ...extra }, memoireDisponible: false });
    const sans = await banc({});
    for (const [nom, f, base] of [['connexionProduction', m => sans.connexionProduction(m, 'test'), 'test'], ['connexionCartes', m => sans.connexionCartes(m, 'cartes'), 'cartes'], ['connecterLecture', m => sans.connecterLecture(m, 'test'), 'test']]) {
        const m = fauxMongoose(lecturesOk), e = await leve(() => f(m));
        verifier(`${nom} sans variable de lecture : REFUS, 0 connexion ouverte, aucun repli sur l'URI d'écriture`, [!!e, /LECTURE_URI/.test(e || ''), m.vu.createConnection + m.vu.connect, sansFuite(e)], [true, true, 0, false]);
    }
    const egal = await banc({ MONGODB_LECTURE_URI: ECRIT, MONGODB_CARTES_LECTURE_URI: ECRIT_CARTES });
    for (const [nom, f] of [['connexionProduction', m => egal.connexionProduction(m, 'test')], ['connexionCartes', m => egal.connexionCartes(m, 'cartes')], ['connecterLecture', m => egal.connecterLecture(m, 'test')]]) {
        const m = fauxMongoose(lecturesOk), e = await leve(() => f(m));
        verifier(`${nom} avec une URI de lecture = URI d'écriture : REFUS, 0 connexion ouverte`, [!!e, m.vu.createConnection + m.vu.connect], [true, 0]);
    }
    const bon = await banc({ MONGODB_LECTURE_URI: LECT, MONGODB_CARTES_LECTURE_URI: LECT_CARTES });
    for (const [nom, f, ok, ko] of [['connexionProduction', (m) => bon.connexionProduction(m, 'test'), lecturesOk, ecritureOk], ['connexionCartes', (m) => bon.connexionCartes(m, 'cartes'), lecturesCartesOk, statut([{ resource: { db: 'cartes', collection: '' }, actions: [...LIRE, 'dropCollection'] }])]]) {
        const mOk = fauxMongoose(ok), r = await f(mOk);
        verifier(`${nom} avec un utilisateur en lecture seule : une façade est rendue (jamais le Db brut), connectionStatus lu`, [typeof r.collection, r.db === r, mOk.commandes.length, mOk.vu.ferme], ['function', true, 1, 0]);
        const mKo = fauxMongoose(ko), e = await leve(() => f(mKo));
        verifier(`${nom} avec un utilisateur qui PEUT ÉCRIRE : REFUS, connexion refermée, aucune façade`, [!!e, /écriture/.test(e || ''), mKo.vu.ferme], [true, true, 1]);
    }
    { const m = fauxMongoose(lecturesOk); await bon.connecterLecture(m, 'test'); verifier('connecterLecture (connexion par défaut) avec un utilisateur en lecture seule : connecté une fois, privilèges lus', [m.vu.connect, m.commandes.length, m.vu.disconnect], [1, 1, 0]); }
    { const m = fauxMongoose(ecritureOk), e = await leve(() => bon.connecterLecture(m, 'test')); verifier('connecterLecture avec un utilisateur qui PEUT ÉCRIRE : REFUS et connexion par défaut refermée', [!!e, m.vu.disconnect], [true, 1]); }
    verifier('le handle n\'expose plus uriProduction ni uriCartes (aucun banc ne peut ouvrir la production lui-même)', [bon.uriProduction, bon.uriCartes], [undefined, undefined]);
    for (const nomBase of ['test_scratch', 'cartes', 'autre', undefined]) {
        const m = fauxMongoose(lecturesOk), e = await leve(() => bon.connexionProduction(m, nomBase));
        verifier(`connexionProduction refuse encore la base « ${nomBase} » avant toute connexion`, [/seule la base « test »/.test(e || ''), m.vu.createConnection], [true, 0]);
    }

    // ── 5. le code des bancs : plus aucun accès direct à l'URI de production, et chaque lecteur / écrivain R2 déclare ce qu'il lit ou écrit
    const code = f => fs.readFileSync(path.join(__dirname, f), 'utf8').replace(/\/\/.*$/gm, '');
    const LECTEURS = { 'test-table-vintage.js': 'production', 'verrou-cellules.js': 'production', [path.join('verrou', 'constituer-photos.js')]: 'production', 'verrou-charges.js': 'production',
        'verrou-avant-push.js': 'production', 'test-identification-locale.js': 'production', 'test-vignette-scratch.js': 'cartes' };
    verifier(`${Object.keys(LECTEURS).length} lecteurs de la production : déclarent \`lit\` pour la bonne grappe`, Object.entries(LECTEURS).filter(([f, q]) => !new RegExp(`ouvrirBanc\\(\\s*\\{[^}]*lit:\\s*\\{[^}]*\\b${q}:`).test(code(f))).map(([f]) => f), []);
    const tous = fs.readdirSync(__dirname).filter(f => f.endsWith('.js')).concat(fs.readdirSync(path.join(__dirname, 'verrou')).filter(f => f.endsWith('.js')).map(f => path.join('verrou', f)));
    verifier(`${tous.length} fichiers .js (racine et verrou/) : plus aucun \`.uriProduction\` ni \`.uriCartes\` (hors ce banc et base-banc.js)`, tous.filter(f => f !== 'test-lecture-seule.js' && f !== 'test-base-banc.js' && /\.uri(Production|Cartes)\b/.test(code(f))), []);
    const ECRIVAINS = ['test-import-catalogue-quotidien.js', 'test-import-guide-quotidien.js'];
    verifier(`${ECRIVAINS.length} bancs qui écrivent sur R2 : déclarent \`ecritR2\` à l'ouverture (refus avant tout démarrage)`, ECRIVAINS.filter(f => !/ouvrirBanc\(\s*\{[^}]*ecritR2:/.test(code(f))), []);

    // ── 6. EXÉCUTION RÉELLE (processus enfant), variables de lecture et de bucket ABSENTES (vides : dotenv n'écrase pas une variable présente)
    const env = { ...process.env, MONGODB_LECTURE_URI: '', MONGODB_CARTES_LECTURE_URI: '', R2_BUCKET_BANC: '', MONGODB_TEST_URI: '' };
    const lances = ['test-table-vintage.js', 'verrou-cellules.js', path.join('verrou', 'constituer-photos.js'), 'test-vignette-scratch.js'].map(f => {
        const r = spawnSync(process.execPath, [path.join(__dirname, f), ...(f === 'verrou-cellules.js' ? ['--base=test'] : [])], { encoding: 'utf8', timeout: 60000, env, cwd: __dirname });
        return [f, r.status !== 0, /LECTURE_URI/.test((r.stderr || '') + (r.stdout || '')), /attendu/.test((r.stderr || '') + (r.stdout || ''))];
    });
    verifier('4 lecteurs LANCÉS sans variable de lecture : sortie en échec, message qui nomme la variable et dit « attendu »', lances, [['test-table-vintage.js', true, true, true], ['verrou-cellules.js', true, true, true], [path.join('verrou', 'constituer-photos.js'), true, true, true], ['test-vignette-scratch.js', true, true, true]]);
    console.log(`\n${echecs ? `⚠️ ${echecs}/${n} en échec` : `🎉 ${n}/${n} passés`} (aucune connexion réelle)`);
    process.exit(echecs ? 1 : 0);
})().catch(e => { console.error(e.message); process.exit(1); });
