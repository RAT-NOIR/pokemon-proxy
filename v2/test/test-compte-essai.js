'use strict';
// COMPTE-ESSAI — l'outil local qui crée le compte administrateur du testeur sur la base de TEST `rm_essai` et lui donne un code de liaison.
// Banc : base en mémoire (harnais), saisie injectée (jamais un vrai terminal), connexions et statut de privilèges injectés. L'outil n'est JAMAIS lancé contre une base réelle.
const H = require('./_harnais');
const M = require('../modeles');
const P = require('../comptes/mots-de-passe');
const J = require('../comptes/jetons');
const { emailCle } = require('../comptes/email-cle');
const liaison = require('../installations/liaison');
const roleAdmin = require('../admin/poser-role');
const db = require('../db');
const { col } = db;

const MDP = 'Zr7!pamplemousse-essai-Q4';
const EMAIL = 'Quentin.Essai+tests@Example.org';
const CLE = emailCle(EMAIL);
const ACT_RW = ['collStats', 'createCollection', 'createIndex', 'dbHash', 'dbStats', 'dropCollection', 'dropIndex', 'find', 'insert', 'killCursors', 'listCollections', 'listIndexes', 'remove', 'renameCollectionSameDB', 'update', 'changeStream', 'planCacheRead'];
const priv = (base, actions, collection = '') => ({ resource: { db: base, collection }, actions });
const statut = (roles, privileges, users = [{ user: 'essai', db: 'admin' }]) => ({ ok: 1, authInfo: { authenticatedUsers: users, authenticatedUserRoles: roles, authenticatedUserPrivileges: privileges } });
const statutBon = () => statut([{ role: 'readWrite', db: 'rm_essai' }], [priv('rm_essai', ACT_RW), priv('rm_essai', ACT_RW, 'system.js')]);
const PC = require('../migrations/preuve-cible');
// des URI FABRIQUÉES (hôtes d'exemple, jamais réels) : la production, cartes (écriture et lecture), la source de lecture et la cible d'essai sont quatre grappes
const ENV = { MONGODB_URI: 'mongodb+srv://ecr:pw@prod.abcde.mongodb.net/test', MONGODB_LECTURE_URI: 'mongodb+srv://lec:pw@prod.abcde.mongodb.net/test',
    MONGODB_CARTES_URI: 'mongodb+srv://ecr:pw@cartes.fghij.mongodb.net/cartes', MONGODB_CARTES_LECTURE_URI: 'mongodb+srv://lec:pw@cartes.fghij.mongodb.net/cartes',
    MONGODB_ESSAI_URI: 'mongodb+srv://essai:pw@essai.klmno.mongodb.net/rm_essai' };
// la cible est la base du banc, enveloppée d'une VUE qui répond à connectionStatus et à hello comme le ferait Atlas (la base en mémoire n'a ni utilisateur ni jeu de réplicas)
const vue = (base, { statut = statutBon(), hello = { setName: 'essai-rs' } } = {}) => new Proxy(base, {
    get(t, p) {
        if (p === 'admin') return () => ({ command: async c => {
            if (c && c.connectionStatus) { if (statut instanceof Error) throw statut; return statut; }
            if (c && c.hello) { if (hello instanceof Error) throw hello; return hello; }
            return t.admin().command(c);
        } });
        const x = t[p]; return typeof x === 'function' ? x.bind(t) : x;
    }
});

(async () => {
    await H.ouvrirBac('test-compte-essai.js'); await M.creerIndex();
    let essai;
    try { essai = require('../admin/compte-essai'); } catch (e) { H.vrai(`0. le module v2/admin/compte-essai.js existe (${e.code || e.name})`, false); H.bilan(); await H.fermerBac(); return; }

    // ---- 0. la table des bases : rm_essai vit derrière MONGODB_ESSAI_URI
    H.v('0. mongo-connexion : rm_essai -> MONGODB_ESSAI_URI', require('../../mongo-connexion').BASES.rm_essai, 'MONGODB_ESSAI_URI');

    // ---- outillage : sortie capturée à TROIS niveaux (ecrire injecté, process.stdout/stderr, console), saisie scriptée
    const toutesSorties = [];
    const lignesSaisie = [];
    function saisie(lignes, secrets) {
        const questions = [];
        const s = { questions,
            ligne: async q => { questions.push(q); if (!lignes.length) throw new Error('saisie épuisée (ligne)'); return lignes.shift(); },
            secret: async q => { questions.push(q); if (!secrets.length) throw new Error('saisie épuisée (secret)'); return secrets.shift(); } };
        lignesSaisie.push(s); return s;
    }
    async function jouer(argv, s, extra = {}) {
        const sortie = [], brut = [];
        const so = process.stdout.write, se = process.stderr.write;
        process.stdout.write = (c, ...r) => { brut.push(String(c)); return true; };
        process.stderr.write = (c, ...r) => { brut.push(String(c)); return true; };
        let connexions = 0, code, leve = null;
        const cx = { base: 'rm_essai', db: vue(db.base()) };
        const deps = { saisie: s, ecrire: l => sortie.push(String(l)), ecrireErreur: l => sortie.push(String(l)), env: ENV,
            ouvrirSource: async () => ({ ok: true, source: { identite: async () => 'prod-rs' }, fermer: async () => { } }),
            ouvrirCartes: async () => ({ ok: true, setName: 'cartes-rs', fermer: async () => { } }),
            connecter: async () => { connexions++; return cx; }, ...extra };
        try { code = await essai.main(argv, deps); } catch (e) { leve = e; code = 'LEVE'; }
        finally { process.stdout.write = so; process.stderr.write = se; }
        const texte = [...sortie, ...brut].join('\n'); toutesSorties.push(texte);
        if (leve) console.log(`   ⚠️ exception : ${leve.name} ${String(leve.message).slice(0, 120)}`);
        return { code, texte, connexions, sortie };
    }
    const comptes = () => col('comptes'), codes = () => col('codes_liaison');
    async function compterTout() {
        const noms = (await db.base().listCollections({}, { nameOnly: true }).toArray()).map(c => c.name).filter(n => n.startsWith(db.prefixeCourant()));
        const r = {}; for (const n of noms.sort()) { const c = await db.base().collection(n).countDocuments({}); if (c) r[n.slice(db.prefixeCourant().length)] = c; } return r;
    }
    // espions qui appellent l'original
    const espions = { nouveauCompte: [], hacher: [], politique: [], poserRole: [], creerCode: [] };
    const orig = { nouveauCompte: M.nouveauCompte, hacher: P.hacher, politique: P.politique, poserRole: roleAdmin.poserRole, creerCode: liaison.creerCode };
    M.nouveauCompte = (...a) => { espions.nouveauCompte.push(a[0]); return { ...orig.nouveauCompte(...a), _viaService: true }; };
    P.hacher = async (...a) => { espions.hacher.push(1); return { ...(await orig.hacher(...a)), _viaService: true }; };
    P.politique = (...a) => { espions.politique.push(a); return orig.politique(...a); };
    roleAdmin.poserRole = async (...a) => { espions.poserRole.push(a); return orig.poserRole(...a); };
    liaison.creerCode = async (...a) => { const r = await orig.creerCode(...a); espions.creerCode.push({ args: a, r }); return r; };
    const raz = () => { for (const k of Object.keys(espions)) espions[k].length = 0; };

    // ---- 1. refus AVANT toute connexion
    let base0 = await compterTout();
    for (const argv of [['--base=test'], ['--base=test_scratch'], ['--base=cartes'], ['--base=rm_essai2'], ['--base=RM_ESSAI'], ['--base=rm_essai '], [], ['--base='], ['--base=rm_essai', '--confirmer-production'],
        ['--base=rm_essai', '--motdepasse=SecretDeLigneDeCommande1'], ['--base=rm_essai', '--mdp=SecretDeLigneDeCommande1'], ['--base=rm_essai', '--password=SecretDeLigneDeCommande1'], ['--base=rm_essai', '--code', '--reprendre'], ['--base=rm_essai', '--base=test'], ['--base=test', '--base=rm_essai'], ['--base=rm_essai', '--email=a@b.fr']]) {
        const s = saisie([], []); const r = await jouer(argv, s);
        H.v(`1. refus avant toute connexion : ${JSON.stringify(argv.map(a => a.startsWith('--motdepasse') ? '--motdepasse=…' : a))}`, [r.code, r.connexions, s.questions.length], [1, 0, 0]);
        H.vrai('   ... l\'argument refusé n\'est pas répété à l\'écran', !r.texte.includes('SecretDeLigneDeCommande1'));
    }
    H.v('   ... rien n\'a été écrit', await compterTout(), base0);

    // ---- 2. la preuve de privilèges, CÔTÉ SERVEUR : le jugement (pur)
    // (la table COMPLÈTE de formes — 41 d'AMORÇAGE plus celles de ce tour — vit dans test-preuve-cible.js ; ici, que l'outil juge avec LE module partagé)
    const juge = s => essai.jugerStatut(s);
    H.vrai('2. l\'outil juge avec le module partagé (même fonction que amorcer-essai.js)', essai.jugerStatut === PC.jugerStatut && require('../migrations/amorcer-essai').prouverCible === essai.prouverCible);
    H.vrai('   readWrite sur rm_essai seul : admis', juge(statutBon()).ok === true);
    H.vrai('   + read sur une autre base : REFUSÉ (le plus strict d\'AMORÇAGE)', juge(statut([{ role: 'readWrite', db: 'rm_essai' }, { role: 'read', db: 'cartes' }], [priv('rm_essai', ACT_RW), priv('cartes', ['find', 'listCollections'])])).ok === false);
    H.vrai('   + listDatabases de grappe (lecture) : admis', juge(statut([{ role: 'readWrite', db: 'rm_essai' }], [priv('rm_essai', ACT_RW), { resource: { cluster: true }, actions: ['listDatabases'] }])).ok === true);
    const refuses = {
        'statut null': null, 'sans authInfo': { ok: 1 }, 'aucun utilisateur': statut([{ role: 'readWrite', db: 'rm_essai' }], [priv('rm_essai', ACT_RW)], []),
        'aucun privilège': statut([{ role: 'readWrite', db: 'rm_essai' }], []), 'aucun rôle': statut([], [priv('rm_essai', ACT_RW)]),
        'écriture sur une autre base (test)': statut([{ role: 'readWrite', db: 'rm_essai' }], [priv('rm_essai', ACT_RW), priv('test', ['find', 'insert'])]),
        'rôle readWrite sur test': statut([{ role: 'readWrite', db: 'test' }], [priv('rm_essai', ACT_RW)]),
        'rôle de grappe atlasAdmin': statut([{ role: 'atlasAdmin', db: 'admin' }], [priv('rm_essai', ACT_RW)]),
        'rôle dbAdmin sur rm_essai': statut([{ role: 'readWrite', db: 'rm_essai' }, { role: 'dbAdmin', db: 'rm_essai' }], [priv('rm_essai', [...ACT_RW, 'dropDatabase'])]),
        'action d\'administration (createUser) sur rm_essai': statut([{ role: 'readWrite', db: 'rm_essai' }], [priv('rm_essai', [...ACT_RW, 'createUser'])]),
        'privilège de grappe (serverStatus)': statut([{ role: 'readWrite', db: 'rm_essai' }], [priv('rm_essai', ACT_RW), { resource: { cluster: true }, actions: ['serverStatus'] }]),
        'écriture de grappe (shutdown)': statut([{ role: 'readWrite', db: 'rm_essai' }], [priv('rm_essai', ACT_RW), { resource: { cluster: true }, actions: ['shutdown'] }]),
        'privilège marqué cluster sur rm_essai': statut([{ role: 'readWrite', db: 'rm_essai' }], [priv('rm_essai', ACT_RW), { resource: { db: 'rm_essai', collection: '', cluster: true }, actions: ['insert', 'update'] }]),
        'anyResource':statut([{ role: 'readWrite', db: 'rm_essai' }], [{ resource: { anyResource: true }, actions: ['find', 'insert'] }]),
        'lecture seule (aucun insert)': statut([{ role: 'read', db: 'rm_essai' }], [priv('rm_essai', ['find', 'listCollections'])]),
        'action illisible': statut([{ role: 'readWrite', db: 'rm_essai' }], [priv('rm_essai', [...ACT_RW, 42])]),
        'privilège sans actions': statut([{ role: 'readWrite', db: 'rm_essai' }], [priv('rm_essai', ACT_RW), { resource: { db: 'rm_essai', collection: '' } }])
    };
    for (const [nom, st] of Object.entries(refuses)) { const j = juge(st); H.vrai(`   refusé : ${nom}`, j.ok === false && typeof j.raison === 'string' && j.raison.length > 0); }
    H.vrai('   le jugement ne répète pas le nom de l\'utilisateur du statut', !JSON.stringify(Object.values(refuses).map(juge)).includes('"essai"') && !JSON.stringify(Object.values(refuses).map(juge)).includes('admin"'));

    // ---- 3. la preuve de privilèges, dans main : avant toute saisie, avant toute écriture
    const avecCible = (opts) => ({ connecter: async () => ({ base: 'rm_essai', db: vue(db.base(), opts) }) });
    for (const [nom, opts] of [['trop larges (atlasAdmin)', { statut: refuses['rôle de grappe atlasAdmin'] }], ['illisible (null)', { statut: null }], ['la commande échoue', { statut: new Error('connectionStatus a échoué (adresse secrète mongodb://u:p@h)') }],
        ['rôle read sur une autre base (le plus strict d\'AMORÇAGE)', { statut: statut([{ role: 'readWrite', db: 'rm_essai' }, { role: 'read', db: 'cartes' }], [priv('rm_essai', ACT_RW)]) }],
        ['action hors de la liste fermée sur rm_essai', { statut: statut([{ role: 'readWrite', db: 'rm_essai' }], [priv('rm_essai', [...ACT_RW, 'createUser'])]) }],
        ['anyResource avec db rm_essai (C6)', { statut: statut([{ role: 'readWrite', db: 'rm_essai' }], [priv('rm_essai', ACT_RW), { resource: { anyResource: true, db: 'rm_essai', collection: '' }, actions: ['insert'] }]) }],
        ['même jeu de réplicas que la production (setName)', { hello: { setName: 'prod-rs' } }], ['même jeu de réplicas que cartes', { hello: { setName: 'cartes-rs' } }],
        ['setName absent', { hello: {} }], ['hello refusé', { hello: new Error('boom mongodb://u:p@h') }]]) {
        const s = saisie([EMAIL], [MDP, MDP]);
        const r = await jouer(['--base=rm_essai'], s, avecCible(opts));
        H.v(`3. cible ${nom} : refus, aucune saisie, rien d'écrit`, [r.code, s.questions.length, await compterTout()], [1, 0, base0]);
        H.vrai('   ... ni message du pilote, ni URI, ni setName à l\'écran', !r.texte.includes('mongodb://') && !r.texte.includes('secrète') && !/prod-rs|cartes-rs|essai-rs/.test(r.texte));
    }
    {   // aucun accès au statut : jamais de repli (la base de banc réelle n'a aucun utilisateur authentifié)
        const s = saisie([EMAIL], [MDP, MDP]); const r = await jouer(['--base=rm_essai'], s, { connecter: async () => ({ base: 'rm_essai', db: db.base() }) });
        H.v('   statut réel d\'une base sans authentification (aucun utilisateur) : refus', [r.code, s.questions.length, await compterTout()], [1, 0, base0]);
    }
    {   // la production, la cartes : sources injoignables ou muettes
        for (const [nom, extra] of [['identité de la production inconnue (ok:false)', { ouvrirSource: async () => ({ ok: false, raison: 'injoignable' }) }],
            ['identité de la production : la source lève', { ouvrirSource: async () => ({ ok: true, source: { identite: async () => { throw new Error('x'); } }, fermer: async () => { } }) }],
            ['cartes injoignable', { ouvrirCartes: async () => ({ ok: false, raison: 'injoignable' }) }], ['cartes lève', { ouvrirCartes: async () => { throw new Error('ECONNREFUSED'); } }]]) {
            const s = saisie([EMAIL], [MDP, MDP]); const r = await jouer(['--base=rm_essai'], s, extra);
            H.v(`   ${nom} : refus, aucune saisie, rien d'écrit`, [r.code, s.questions.length, await compterTout()], [1, 0, base0]);
        }
        // les hôtes, avant toute connexion
        for (const [nom, env] of [['MONGODB_ESSAI_URI sur la grappe de la production', { ...ENV, MONGODB_ESSAI_URI: 'mongodb+srv://essai:pw@prod.abcde.mongodb.net/rm_essai' }],
            ['MONGODB_ESSAI_URI sur la grappe de cartes', { ...ENV, MONGODB_ESSAI_URI: 'mongodb+srv://essai:pw@cartes.fghij.mongodb.net/rm_essai' }], ['MONGODB_LECTURE_URI absente', { ...ENV, MONGODB_LECTURE_URI: undefined }], ['MONGODB_ESSAI_URI absente', { ...ENV, MONGODB_ESSAI_URI: undefined }]]) {
            const s = saisie([EMAIL], [MDP, MDP]); const r = await jouer(['--base=rm_essai'], s, { env });
            H.v(`   hôtes : ${nom} : refus AVANT toute connexion`, [r.code, r.connexions, s.questions.length], [1, 0, 0]);
            H.vrai('      ... aucune URI à l\'écran', !r.texte.includes('mongodb+srv://') && !r.texte.includes('pw@'));
        }
        // l'outil appelle LE module partagé (pas une copie) : une espionne sur l'export le voit
        let appels = 0; const vraie = PC.prouverCible; PC.prouverCible = async (...a) => { appels++; return vraie(...a); };
        const s = saisie([], []); await jouer(['--base=rm_essai'], s, { saisie: { ligne: async () => { throw new Error('arrêt du banc après la preuve'); }, secret: async () => { throw new Error('non'); } } });
        PC.prouverCible = vraie;
        H.v('   la preuve de la cible est celle du module partagé (appelée une fois)', appels, 1);
    }

    {   // une exception du pilote (message chargé d'une URI) : jamais répétée
        const s = saisie([EMAIL], [MDP, MDP]); const r = await jouer(['--base=rm_essai'], s, { connecter: async () => { throw Object.assign(new Error('failed mongodb://u:motdepassedebase@hote.secret/rm_essai'), { name: 'MongoServerError' }); } });
        H.v('3 bis. connexion en échec : refus, aucune saisie, rien d\'écrit', [r.code, s.questions.length, await compterTout()], [1, 0, base0]);
        H.vrai('   ... le message du pilote (URI, mot de passe de base) n\'est jamais à l\'écran', !r.texte.includes('mongodb://') && !r.texte.includes('motdepassedebase') && !r.texte.includes('hote.secret') && r.texte.includes('MongoServerError'));
    }

    // ---- 4. base vide : refus (le filet du §50), avant toute saisie
    {
        const vide = { base: 'rm_essai', db: { databaseName: 'rm_essai', listCollections: () => ({ toArray: async () => [] }), admin: () => ({ command: async () => statutBon() }) } };
        const s = saisie([EMAIL], [MDP, MDP]); const r = await jouer(['--base=rm_essai'], s, { connecter: async () => vide });
        H.v('4. base vide : refus, aucune saisie, rien d\'écrit', [r.code, s.questions.length, await compterTout()], [1, 0, base0]);
        const s2 = saisie([EMAIL], [MDP, MDP]); const r2 = await jouer(['--base=rm_essai'], s2, { connecter: async () => ({ base: 'test', db: db.base() }) });
        H.v('   connexion qui rend une autre base que rm_essai : refus', [r2.code, s2.questions.length, await compterTout()], [1, 0, base0]);
    }

    // ---- 5. la création
    raz();
    const avant = Date.now();
    const s5 = saisie([EMAIL], [MDP, MDP]);
    const r5 = await jouer(['--base=rm_essai'], s5);
    H.v('5. création : code de sortie 0', r5.code, 0);
    H.v('   la saisie a demandé 1 adresse (visible) et 2 mots de passe (masqués), dans cet ordre', [s5.questions.length], [3]);
    const cpt = await comptes().findOne({ emailCle: CLE });
    H.vrai('   le compte existe sous la clé d\'adresse normalisée du service', cpt && cpt.emailCle === CLE && CLE === 'quentin.essai+tests@example.org' && cpt.email === EMAIL);
    H.v('   verifie:true, date de vérification posée', [cpt.verifie, cpt.verifieLe instanceof Date && cpt.verifieLe.getTime() >= avant - 1000], [true, true]);
    H.v('   rôle administrateur (posé par poserRole, appelée avec la clé)', [cpt.role, espions.poserRole.map(a => a)], ['administrateur', [[CLE, 'administrateur']]]);
    H.v('   generation 0, solde et abonnement tels que nouveauCompte les fait', [cpt.generation, cpt.solde, cpt.abonnement.actif], [0, { accueil: 0, achete: 0 }, false]);
    H.vrai('   le document vient de M.nouveauCompte (la marque du service y est) et du hachage P.hacher (idem)', cpt._viaService === true && cpt.motDePasse._viaService === true && espions.nouveauCompte.length === 1 && espions.hacher.length === 1);
    H.v('   le mot de passe est haché en scrypt et se vérifie', [cpt.motDePasse.algo, await P.verifier(MDP, cpt.motDePasse), await P.verifier(MDP + 'x', cpt.motDePasse)], ['scrypt', true, false]);
    H.vrai('   la politique de mot de passe de la route (P.politique) a été appelée avec l\'adresse normalisée', espions.politique.length >= 1 && espions.politique.every(a => a[0] === MDP && a[1] === CLE));
    H.v('   aucun octroi : solde à zéro, aucun mouvement, aucune empreinte d\'adresse', [await col('mouvements').countDocuments({}), await col('adresses_octroyees').countDocuments({})], [0, 0]);
    const cd = await codes().find({}).toArray();
    H.v('   UN code de liaison, compteId du compte, génération du compte, non utilisé', [cd.length, cd[0] && String(cd[0].compteId) === String(cpt._id), cd[0] && cd[0].generation, cd[0] && cd[0].utiliseLe], [1, true, 0, null]);
    H.v('   le code vient de liaison.creerCode (appelée avec compteId, cfg, undefined, génération du compte)', [espions.creerCode.length, espions.creerCode[0] && String(espions.creerCode[0].args[0]) === String(cpt._id), espions.creerCode[0] && espions.creerCode[0].args[2], espions.creerCode[0] && espions.creerCode[0].args[3]], [1, true, undefined, 0]);
    const codeVu = espions.creerCode[0].r.code, expVue = espions.creerCode[0].r.expire;
    H.vrai('   6 caractères A-Z0-9, empreinte en base = empreinte du code rendu', /^[A-Z0-9]{6}$/.test(codeVu) && cd[0].codeEmpreinte === J.empreinte(codeVu));
    H.vrai('   expiration = 10 minutes après la création', Math.abs(cd[0].expireLe.getTime() - (cd[0].creeLe.getTime() + 10 * 60e3)) < 1000 && cd[0].expireLe.toISOString() === expVue);
    H.v('   le code s\'affiche UNE fois à l\'écran', r5.texte.split(codeVu).length - 1, 1);
    H.vrai('   ... avec son heure d\'expiration', r5.texte.includes(expVue));
    H.vrai('   l\'adresse est masquée à l\'écran (ni entière ni son début)', !r5.texte.includes(EMAIL) && !r5.texte.includes('Quentin') && !r5.texte.toLowerCase().includes('quentin'));
    H.v('   seules deux collections ont reçu un document : comptes et codes_liaison', await compterTout(), { codes_liaison: 1, comptes: 1 });

    // ---- 6. le mot de passe n'apparaît nulle part
    const tousDocs = JSON.stringify(await Promise.all(['comptes', 'codes_liaison', 'liens_email', 'sessions', 'mouvements'].map(n => col(n).find({}).toArray())));
    H.vrai('6. le mot de passe n\'est dans aucun document', !tousDocs.includes(MDP));
    H.vrai('   ... ni dans aucune sortie (ecrire, stdout, stderr)', toutesSorties.every(t => !t.includes(MDP)));
    H.vrai('   ... ni dans une question posée (les questions ne l\'incluent pas)', lignesSaisie.every(s => s.questions.every(q => !q.includes(MDP))));
    H.vrai('   ... hors du hachage, le document ne porte que hachage + sel : le hash n\'est pas le mot de passe', JSON.stringify(cpt.motDePasse).indexOf(MDP) < 0);

    // ---- 7. adresse déjà prise
    raz();
    const hashAvant = JSON.stringify((await comptes().findOne({ emailCle: CLE })).motDePasse);
    const s7 = saisie([EMAIL], ['Autre-mot-de-passe-9!x', 'Autre-mot-de-passe-9!x']);
    const r7 = await jouer(['--base=rm_essai'], s7);
    H.v('7. adresse déjà prise sans --reprendre : refus, rien ne bouge', [r7.code, await compterTout(), JSON.stringify((await comptes().findOne({ emailCle: CLE })).motDePasse) === hashAvant, espions.creerCode.length], [1, { codes_liaison: 1, comptes: 1 }, true, 0]);
    H.vrai('   ... et la sortie dit comment reprendre', r7.texte.includes('--reprendre'));

    // ---- 8. mot de passe : politique, deux saisies identiques
    for (const [nom, mdps, attendu] of [['trop court', ['abc12', 'abc12'], 'trop-court'], ['égal à l\'adresse', ['autre@example.org', 'autre@example.org'], 'egal-a-l-adresse'], ['trop long', ['x'.repeat(201), 'x'.repeat(201)], 'trop-long']]) {
        raz();
        const adr = nom.startsWith('égal') ? 'autre@example.org' : 'nouveau.compte@example.org';
        const s = saisie([adr], mdps); const r = await jouer(['--base=rm_essai'], s);
        H.v(`8. mot de passe ${nom} : refus, rien créé`, [r.code, (await compterTout()).comptes], [1, 1]);
        H.vrai(`   ... le motif de la fonction de la route est dit (${attendu}) sans afficher le mot de passe`, r.texte.includes(attendu) && !r.texte.includes(mdps[0]) || attendu === 'trop-long' && r.texte.includes(attendu));
    }
    {
        raz();
        const s = saisie(['nouveau.compte@example.org'], [MDP, MDP + 'différent']); const r = await jouer(['--base=rm_essai'], s);
        H.v('   deux saisies différentes : refus, rien créé', [r.code, (await compterTout()).comptes, espions.hacher.length], [1, 1, 0]);
        const s2 = saisie(['pas une adresse'], [MDP, MDP]); const r2 = await jouer(['--base=rm_essai'], s2);
        H.v('   adresse illisible : refus avant tout mot de passe', [r2.code, s2.questions.length, (await compterTout()).comptes], [1, 1, 1]);
    }

    // ---- 8 bis. tour 1 : le mot de passe d'espaces seulement (la règle de la vérification d'adresse : !motDePasse.trim()) ; un refus de saisie dit sa cause
    {
        raz();
        for (const [nom, mdp] of [['10 espaces', ' '.repeat(10)], ['10 tabulations', '\t'.repeat(10)]]) {
            const s = saisie(['nouveau.compte@example.org'], [mdp, mdp]); const r = await jouer(['--base=rm_essai'], s);
            H.v(`8b. mot de passe de ${nom} : refus « espaces-seulement », rien créé, hacher non appelé`, [r.code, /espaces-seulement/.test(r.texte), (await compterTout()).comptes, espions.hacher.length], [1, true, 1, 0]);
        }
        const s1 = { questions: [], ligne: async () => 'nouveau.compte@example.org', secret: async () => { throw new essai.ErreurSaisie('pas de terminal interactif : le mot de passe ne se saisit que masqué, jamais lu en clair'); } };
        const r1 = await jouer(['--base=rm_essai'], s1);
        H.v('   refus de saisie « pas de terminal interactif » : la cause est dite, code 1, rien créé', [r1.code, /pas de terminal interactif/.test(r1.texte), (await compterTout()).comptes], [1, true, 1]);
        const s2 = { questions: [], ligne: async () => 'nouveau.compte@example.org', secret: async () => { throw new essai.ErreurSaisie('saisie interrompue'); } };
        const r2 = await jouer(['--base=rm_essai'], s2);
        H.v('   « saisie interrompue » : la cause est dite', [r2.code, /saisie interrompue/.test(r2.texte)], [1, true]);
        const s3 = { questions: [], ligne: async () => 'nouveau.compte@example.org', secret: async () => { throw new Error('boom mongodb://u:pwderreur@hote'); } };
        const r3 = await jouer(['--base=rm_essai'], s3);
        H.v('   une erreur ordinaire garde son message pour elle (seul le nom sort)', [r3.code, r3.texte.includes('pwderreur') || r3.texte.includes('mongodb://'), /Error/.test(r3.texte)], [1, false, true]);
        H.vrai('   une ErreurSaisie est de classe sûre (name, sure)', new essai.ErreurSaisie('x').sure === true && new essai.ErreurSaisie('x').name === 'ErreurSaisie');
    }

    // ---- 9. --reprendre
    {
        raz();
        const hash0 = JSON.stringify((await comptes().findOne({ emailCle: CLE })).motDePasse);
        await comptes().updateOne({ emailCle: CLE }, { $unset: { role: '' } });                                   // le compte perd son rôle : --reprendre le rend
        const s = saisie([EMAIL], [MDP]); const r = await jouer(['--base=rm_essai', '--reprendre'], s);
        const c = await comptes().findOne({ emailCle: CLE });
        H.v('9. --reprendre, bon mot de passe : code 0, rôle rendu, mot de passe inchangé, un seul mot de passe demandé', [r.code, c.role, JSON.stringify(c.motDePasse) === hash0, s.questions.length], [0, 'administrateur', true, 2]);
        H.v('   ... un nouveau code (2 vivants), un seul compte, hacher non appelé', [(await compterTout()).codes_liaison, (await compterTout()).comptes, espions.hacher.length, espions.nouveauCompte.length, espions.creerCode.length], [2, 1, 0, 0, 1]);
        H.v('   ... le code s\'affiche une fois', r.texte.split(espions.creerCode[0].r.code).length - 1, 1);
        raz();
        const sMauvais = saisie([EMAIL], ['Mauvais-mot-de-passe-1!']); const rMauvais = await jouer(['--base=rm_essai', '--reprendre'], sMauvais);
        H.v('   --reprendre, mauvais mot de passe : refus, aucun code', [rMauvais.code, (await compterTout()).codes_liaison, espions.creerCode.length, espions.poserRole.length], [1, 2, 0, 0]);
        const sInconnu = saisie(['inconnu@example.org'], [MDP]); const rInconnu = await jouer(['--base=rm_essai', '--reprendre'], sInconnu);
        H.v('   --reprendre, adresse inconnue : refus, rien créé', [rInconnu.code, (await compterTout()).comptes], [1, 1]);
        const nv = M.nouveauCompte({ email: 'attente@example.org', emailCle: 'attente@example.org', motDePasse: await orig.hacher(MDP) }); await comptes().insertOne(nv);
        raz();
        const sNv = saisie(['attente@example.org'], [MDP]); const rNv = await jouer(['--base=rm_essai', '--reprendre'], sNv);
        H.v('   --reprendre sur un compte NON vérifié : refus, pas de rôle, pas de code', [rNv.code, (await comptes().findOne({ emailCle: 'attente@example.org' })).role, espions.creerCode.length], [1, undefined, 0]);
        await comptes().deleteOne({ emailCle: 'attente@example.org' });
    }

    // ---- 10. --code seul
    {
        raz();
        const s = saisie([EMAIL], [MDP]); const r = await jouer(['--base=rm_essai', '--code'], s);
        H.v('10. --code, bon mot de passe : un code neuf (3 vivants), rien d\'autre ne bouge', [r.code, (await compterTout()).codes_liaison, (await compterTout()).comptes, espions.hacher.length, espions.poserRole.length, espions.creerCode.length], [0, 3, 1, 0, 0, 1]);
        H.v('   ... il s\'affiche une fois, avec son heure d\'expiration', [r.texte.split(espions.creerCode[0].r.code).length - 1, r.texte.includes(espions.creerCode[0].r.expire)], [1, true]);
        raz();
        const r4 = await jouer(['--base=rm_essai', '--code'], saisie([EMAIL], [MDP]));
        H.v('   quatrième code vivant : refus dit (même règle que la route), code 1, aucun code affiché', [r4.code, (await compterTout()).codes_liaison, /\b[A-Z0-9]{6}\b/.test(r4.texte.replace(/rm_essai|--reprendre|TEMPS|ÉCRAN/g, ''))], [1, 3, false]);
        raz();
        const rm = await jouer(['--base=rm_essai', '--code'], saisie([EMAIL], ['Mauvais-mot-de-passe-1!']));
        H.v('   --code, mauvais mot de passe : refus, aucun code', [rm.code, (await compterTout()).codes_liaison, espions.creerCode.length], [1, 3, 0]);
        const ri = await jouer(['--base=rm_essai', '--code'], saisie(['inconnu@example.org'], [MDP]));
        H.v('   --code, adresse inconnue : refus identique à un mauvais mot de passe', [ri.code, ri.sortie.join('\n') === rm.sortie.join('\n')], [1, true]);
    }

    // ---- 11. la saisie réelle : jamais sans terminal, jamais d'écho
    {
        const sansTerminal = essai.saisieTerminal({ entree: { isTTY: false }, sortie: { write() { } } });
        let leve = null; try { await sansTerminal.secret('Mot de passe : '); } catch (e) { leve = e; }
        H.vrai('11. sans terminal (stdin non interactif), le mot de passe est REFUSÉ, jamais lu en clair', leve && /terminal/i.test(leve.message));
    }

    // ---- 11 bis. --banc : le compte de MESURE (non interactif ; deux identifiants écrits dans un .env FACTICE, jamais le vrai)
    {
        const fs = require('fs'), os = require('os'), path = require('path');
        const dossierEnv = fs.mkdtempSync(path.join(os.tmpdir(), 'compte-essai-env-'));
        const fichier = path.join(dossierEnv, '.env');
        const AVANT = ['# environnement factice', 'AUTRE_VARIABLE=garde-moi', 'V2_ESSAI_BANC_IDENTIFIANT=ancien@rat-market.invalid', 'V2_ESSAI_BANC_IDENTIFIANT_X=ne-me-touche-pas', '# V2_ESSAI_BANC_MOT_DE_PASSE=commentaire', 'V2_ESSAI_BANC_MOT_DE_PASSE=ancien-secret', 'V2_ESSAI_BANC_MOT_DE_PASSE=doublon', 'DERNIERE=fin', ''];
        const ecritEnv = (lignes, fin = '\n') => fs.writeFileSync(fichier, lignes.join(fin));
        const lit = () => fs.readFileSync(fichier, 'utf8');
        const valeurEnv = nom => { const m = new RegExp(`^${nom}=(.*)$`, 'm').exec(lit()); return m ? m[1] : null; };
        const ADR = essai.ADRESSE_BANC, CLE_B = emailCle(ADR);
        ecritEnv(AVANT);
        const envAvant = lit();
        const nbComptes0 = (await compterTout()).comptes;

        // (a) la base : seule rm_essai ; avant toute connexion, avant toute écriture (comptes et .env)
        for (const argv of [['--base=test', '--banc'], ['--banc'], ['--base=cartes', '--banc'], ['--base=test_scratch', '--banc'], ['--base=rm_essai2', '--banc'], ['--base=RM_ESSAI', '--banc'], ['--base=', '--banc'], ['--banc', '--base=test', '--base=rm_essai'], ['--base=rm_essai', '--base=test', '--banc'], ['--base=rm_essai', '--banc', '--code']]) {
            const s = saisie([], []); const r = await jouer(argv, s, { fichierEnv: fichier });
            H.v(`11b-a. --banc refusé avant toute connexion : ${JSON.stringify(argv)}`, [r.code, r.connexions, s.questions.length, lit() === envAvant, (await compterTout()).comptes], [1, 0, 0, true, nbComptes0]);
        }
        H.v('11b-a. lireArgs : --banc admis avec la seule base rm_essai', [essai.lireArgs(['--base=rm_essai', '--banc']).banc, essai.lireArgs(['--base=test', '--banc']).ok], [true, false]);
        {   // un banc ne réécrit JAMAIS le .env réel : sans fichier factice injecté, refus (BANC_ISOLE=1 est posé par le harnais)
            const s = saisie([], []); const r = await jouer(['--base=rm_essai', '--banc'], s);
            H.v('11b-a. sans fichier d\'environnement factice injecté : refus, aucun compte créé', [r.code, (await compterTout()).comptes, /factice/.test(r.texte)], [1, nbComptes0, true]);
        }
        // (b) --reprendre sans compte : refus
        { const r = await jouer(['--base=rm_essai', '--banc', '--reprendre'], saisie([], []), { fichierEnv: fichier });
          H.v('11b-b. --banc --reprendre sans compte existant : refus, rien d\'écrit', [r.code, lit() === envAvant, (await compterTout()).comptes], [1, true, nbComptes0]); }

        // (c) la création
        raz();
        const sB = saisie([], []); const rB = await jouer(['--base=rm_essai', '--banc'], sB, { fichierEnv: fichier });
        const cb = await comptes().findOne({ emailCle: CLE_B });
        const mdpB = valeurEnv('V2_ESSAI_BANC_MOT_DE_PASSE');
        H.v('11b-c. création : code 0, AUCUNE question posée (non interactif), aucun code de liaison', [rB.code, sB.questions.length, (await compterTout()).codes_liaison, espions.creerCode.length], [0, 0, 3, 0]);
        H.vrai('   le compte « banc-mesure » : adresse réservée .invalid, confirmé, administrateur, marqué banc', cb && cb.email === 'banc-mesure@rat-market.invalid' && /\.invalid$/.test(cb.email) && cb.verifie === true && cb.role === 'administrateur' && cb.banc === true);
        H.vrai('   le document vient de nouveauCompte et du hachage du service (scrypt), rôle posé par poserRole', cb._viaService === true && cb.motDePasse._viaService === true && cb.motDePasse.algo === 'scrypt' && espions.poserRole.length === 1 && espions.poserRole[0][0] === CLE_B);
        H.vrai('   le mot de passe écrit au .env est GÉNÉRÉ : 32 caractères URL-sûrs, conforme à la politique, et il ouvre le compte', typeof mdpB === 'string' && /^[A-Za-z0-9_-]{32}$/.test(mdpB) && P.politique(mdpB, CLE_B) === null && await P.verifier(mdpB, cb.motDePasse));
        H.v('   l\'identifiant écrit au .env est l\'adresse du compte', valeurEnv('V2_ESSAI_BANC_IDENTIFIANT'), ADR);
        const apresC = lit();
        H.v('11b-d. le .env : SEULES les deux lignes nommées changent (remplacées en place, doublon retiré) ; toute autre ligne identique', apresC.split('\n').filter(l => !/^V2_ESSAI_BANC_(IDENTIFIANT|MOT_DE_PASSE)=/.test(l)).join('\n'), AVANT.filter(l => !/^V2_ESSAI_BANC_(IDENTIFIANT|MOT_DE_PASSE)=/.test(l)).join('\n'));
        H.vrai('   ... y compris la variable au préfixe voisin et le commentaire qui cite le nom', /^V2_ESSAI_BANC_IDENTIFIANT_X=ne-me-touche-pas$/m.test(apresC) && /^# V2_ESSAI_BANC_MOT_DE_PASSE=commentaire$/m.test(apresC));
        H.v('   ... chaque nom une seule fois (le doublon est retiré)', [apresC.split('\n').filter(l => l.startsWith('V2_ESSAI_BANC_IDENTIFIANT=')).length, apresC.split('\n').filter(l => l.startsWith('V2_ESSAI_BANC_MOT_DE_PASSE=')).length], [1, 1]);
        H.vrai('   ... l\'ancien secret a disparu', !apresC.includes('ancien-secret') && !apresC.includes('doublon'));
        H.v('   ... position conservée : la première ligne du nom est remplacée en place', apresC.split('\n').findIndex(l => l.startsWith('V2_ESSAI_BANC_IDENTIFIANT=')), 2);
        // (e) le mot de passe n'apparaît dans AUCUNE sortie
        H.vrai('11b-e. le mot de passe (et son début) n\'apparaît dans aucune sortie (ecrire, stdout, stderr)', !rB.texte.includes(mdpB) && !rB.texte.includes(mdpB.slice(0, 8)) && toutesSorties.every(t => !t.includes(mdpB)));
        H.vrai('   ... ni dans un document de la base', !JSON.stringify(await Promise.all(['comptes', 'codes_liaison', 'sessions', 'mouvements'].map(n => col(n).find({}).toArray()))).includes(mdpB));
        H.vrai('   ... et la sortie dit où sont les identifiants sans les montrer', /écrits dans le fichier d'environnement/.test(rB.texte) && !rB.texte.includes(ADR) && rB.texte.includes('V2_ESSAI_BANC_MOT_DE_PASSE'));
        // (f) existant sans --reprendre : refus, rien ne bouge
        { const hashAvant = JSON.stringify(cb.motDePasse), env1 = lit(); raz();
          const r = await jouer(['--base=rm_essai', '--banc'], saisie([], []), { fichierEnv: fichier });
          const c1 = await comptes().findOne({ emailCle: CLE_B });
          H.v('11b-f. le compte existe déjà, sans --reprendre : refus, le .env et le hachage ne bougent pas', [r.code, lit() === env1, JSON.stringify(c1.motDePasse) === hashAvant, espions.hacher.length], [1, true, true, 0]);
          H.vrai('   ... et la sortie dit comment reprendre', r.texte.includes('--banc --reprendre')); }
        // (g) --reprendre : mot de passe régénéré, generation + 1, .env mis à jour, le reste intact
        { const env1 = lit(), mdp1 = valeurEnv('V2_ESSAI_BANC_MOT_DE_PASSE'), g1 = (await comptes().findOne({ emailCle: CLE_B })).generation; raz();
          await comptes().updateOne({ emailCle: CLE_B }, { $unset: { role: '' } });
          const r = await jouer(['--base=rm_essai', '--banc', '--reprendre'], saisie([], []), { fichierEnv: fichier });
          const c2 = await comptes().findOne({ emailCle: CLE_B }), mdp2 = valeurEnv('V2_ESSAI_BANC_MOT_DE_PASSE');
          H.v('11b-g. --banc --reprendre : code 0, mot de passe régénéré (autre valeur), généré, valide pour le compte', [r.code, mdp2 !== mdp1, /^[A-Za-z0-9_-]{32}$/.test(mdp2), await P.verifier(mdp2, c2.motDePasse), await P.verifier(mdp1, c2.motDePasse)], [0, true, true, true, false]);
          H.v('   ... generation +1 (les sessions d\'avant tombent), rôle rendu, marque banc gardée, un seul compte', [c2.generation, c2.role, c2.banc, (await compterTout()).comptes], [g1 + 1, 'administrateur', true, nbComptes0 + 1]);
          H.v('   ... le .env : seule la ligne du mot de passe a changé', env1.split('\n').filter((l, i) => l !== apresC.split('\n')[i] || true).map(l => l.replace(/^V2_ESSAI_BANC_MOT_DE_PASSE=.*/, 'V2_ESSAI_BANC_MOT_DE_PASSE=#')).join('\n'), lit().split('\n').map(l => l.replace(/^V2_ESSAI_BANC_MOT_DE_PASSE=.*/, 'V2_ESSAI_BANC_MOT_DE_PASSE=#')).join('\n'));
          H.vrai('   ... aucune sortie ne contient ni l\'ancien ni le nouveau mot de passe', toutesSorties.every(t => !t.includes(mdp1) && !t.includes(mdp2))); }
        // (h) un compte de cette adresse SANS la marque banc : refus (on ne reprend pas le compte d'un autre)
        { await comptes().updateOne({ emailCle: CLE_B }, { $unset: { banc: '' } }); const env1 = lit(); const hash1 = JSON.stringify((await comptes().findOne({ emailCle: CLE_B })).motDePasse);
          const r = await jouer(['--base=rm_essai', '--banc', '--reprendre'], saisie([], []), { fichierEnv: fichier });
          H.v('11b-h. --reprendre sur un compte sans marque banc : refus, rien ne bouge', [r.code, lit() === env1, JSON.stringify((await comptes().findOne({ emailCle: CLE_B })).motDePasse) === hash1], [1, true, true]);
          await comptes().updateOne({ emailCle: CLE_B }, { $set: { banc: true } }); }
        // (i) ecrireEnv, seul : ajout, fins de ligne, fichier absent, atomicité
        { const f2 = path.join(dossierEnv, 'autre.env');
          fs.writeFileSync(f2, 'A=1\r\nB=2'); const r1 = essai.ecrireEnv(f2, { V2_ESSAI_BANC_IDENTIFIANT: 'x@y.invalid', V2_ESSAI_BANC_MOT_DE_PASSE: 'pw' });
          H.v('11b-i. ecrireEnv : deux noms absents ajoutés en fin, fins de ligne CRLF gardées, autres lignes intactes', [fs.readFileSync(f2, 'utf8'), r1], ['A=1\r\nB=2\r\nV2_ESSAI_BANC_IDENTIFIANT=x@y.invalid\r\nV2_ESSAI_BANC_MOT_DE_PASSE=pw\r\n', { remplacees: 0, ajoutees: 2 }]);
          fs.writeFileSync(f2, 'V2_ESSAI_BANC_MOT_DE_PASSE=a\nZ=9\n'); const r2 = essai.ecrireEnv(f2, { V2_ESSAI_BANC_IDENTIFIANT: 'i', V2_ESSAI_BANC_MOT_DE_PASSE: 'b' });
          H.v('   un nom présent remplacé en place, l\'autre ajouté, le fichier finit par une fin de ligne', [fs.readFileSync(f2, 'utf8'), r2], ['V2_ESSAI_BANC_MOT_DE_PASSE=b\nZ=9\nV2_ESSAI_BANC_IDENTIFIANT=i\n', { remplacees: 1, ajoutees: 1 }]);
          H.vrai('   un fichier absent est REFUSÉ (on ne crée pas l\'environnement d\'un autre)', (() => { try { essai.ecrireEnv(path.join(dossierEnv, 'nexiste-pas.env'), { A: '1' }); return false; } catch (e) { return e.sure === true && !fs.existsSync(path.join(dossierEnv, 'nexiste-pas.env')); } })());
          H.v('   aucun fichier temporaire ne reste', fs.readdirSync(dossierEnv).filter(n => n.endsWith('.tmp')), []);
          H.vrai('   genererMotDePasse : 32 caractères URL-sûrs, différents à chaque appel', /^[A-Za-z0-9_-]{32}$/.test(essai.genererMotDePasse()) && essai.genererMotDePasse() !== essai.genererMotDePasse()); }
        H.v('   le compte de mesure n\'a reçu ni solde ni mouvement', [await col('mouvements').countDocuments({}), (await comptes().findOne({ emailCle: CLE_B })).solde], [0, { accueil: 0, achete: 0 }]);
        try { fs.rmSync(dossierEnv, { recursive: true, force: true }); } catch { /* temporaire */ }
    }

    // ---- 11 ter. les scans du compte de mesure sont marqués « banc » au journal et EXCLUS des statistiques d'usage
    {
        const mongoose = require('mongoose'), JS = require('../../journal-scans'), HB = require('../../journal-hors-banc'), fs = require('fs'), path = require('path');
        const banc = await comptes().findOne({ emailCle: emailCle(essai.ADRESSE_BANC) });
        const normal = await comptes().findOne({ emailCle: CLE });
        H.v('11t. estBanc : le compte de mesure oui ; un compte ordinaire, une installation, un identifiant illisible, un compte inconnu : non', [await JS.estBanc(`v2:compte:${banc._id}`), await JS.estBanc(`v2:compte:${normal._id}`), await JS.estBanc(`v2:installation:${banc._id}`), await JS.estBanc('v2:compte:pas-un-id'), await JS.estBanc(`v2:compte:${new mongoose.Types.ObjectId()}`), await JS.estBanc(undefined), await JS.estBanc(null)], [true, false, false, false, false, false, false]);
        H.v('   estBanc ne lève jamais (la lecture du compte échoue : faux)', await JS.estBanc(`v2:compte:${banc._id}`, async () => { throw new Error('boum'); }), false);
        H.v('   `banc` doit valoir EXACTEMENT true (truthy refusé)', await JS.estBanc(`v2:compte:${banc._id}`, async () => ({ banc: 'oui' })), false);
        // de bout en bout : la ligne que la chaîne écrit pour un scan, par la VRAIE fonction, dans la VRAIE collection du journal
        const attendre = async id => { for (let i = 0; i < 100; i++) { const d = await JS.JournalScan.findById(id).lean(); if (d) return d; await new Promise(r => setTimeout(r, 50)); } return null; };
        const idB = JS.enregistrerScan({ route: 'identifier', userId: `v2:compte:${banc._id}`, nom: 'Statistique banc' });
        const idN = JS.enregistrerScan({ route: 'identifier', userId: `v2:compte:${normal._id}`, nom: 'Statistique ordinaire' });
        const idI = JS.enregistrerScan({ route: 'identifier', userId: 'v2:installation:abc', nom: 'Statistique installation' });
        const [lB, lN, lI] = [await attendre(idB), await attendre(idN), await attendre(idI)];
        H.v('11t. la ligne du journal d\'un scan « banc » porte banc:true ; celles des autres n\'ont pas le champ', [lB && lB.banc, lN && 'banc' in lN, lI && 'banc' in lI], [true, false, false]);
        const J = mongoose.connection.db.collection('journal_scans');
        const vus = async filtre => (await J.find({ ...filtre, nom: { $in: ['Statistique banc', 'Statistique ordinaire', 'Statistique installation'] } }).toArray()).map(d => d.nom).sort();
        H.v('   la lecture HORS BANC (le filtre des statistiques) exclut le scan « banc » et garde les autres', await vus(HB.FILTRE_HORS_BANC), ['Statistique installation', 'Statistique ordinaire']);
        H.v('   avecHorsBanc fusionne le filtre dans une requête existante', await vus(HB.avecHorsBanc({ route: 'identifier' })), ['Statistique installation', 'Statistique ordinaire']);
        H.v('   sans le filtre, le scan « banc » existe bien (le filtre est ce qui l\'exclut)', await vus({}), ['Statistique banc', 'Statistique installation', 'Statistique ordinaire']);
        H.v('   horsBanc (lignes en mémoire) : seul banc === true est exclu', [{ banc: true }, {}, { banc: false }, { banc: null }, { banc: 'true' }, null].map(HB.horsBanc), [false, true, true, true, true, true]);
        // les lecteurs d'usage du journal de l'essai passent par le filtre (une lecture qui l'oublie recompte le banc)
        const racine = path.join(__dirname, '..', '..');
        for (const f of ['v2/mesures/projeter-p95.js', 'v2/mesures/mesurer-index-premier-mot.js'])
            H.vrai(`   ${f} lit le journal à travers avecHorsBanc`, /journal_scans'\)\.find\(require\('\.\.\/\.\.\/journal-hors-banc'\)\.avecHorsBanc\(/.test(fs.readFileSync(path.join(racine, f), 'utf8')));
        H.vrai('   la ligne `analyses` d\'un scan du compte de mesure porte banc:true (route d\'identification)', /porteur\.compte && porteur\.compte\.banc === true \? \{ banc: true \}/.test(fs.readFileSync(path.join(racine, 'v2/identifier/routes.js'), 'utf8')));
        await J.deleteMany({ nom: { $in: ['Statistique banc', 'Statistique ordinaire', 'Statistique installation'] } });
    }

    // ---- 12. aucune erreur de pilote, aucune URI dans une sortie, quoi qu'il arrive
    H.vrai('12. aucune sortie du banc ne contient de schéma mongodb:// ni le mot de passe', toutesSorties.every(t => !t.includes('mongodb://') && !t.includes(MDP) && !t.includes('Autre-mot-de-passe') && !t.includes('SecretDeLigneDeCommande1')));
    console.log(`   dénominateur : ${toutesSorties.length} exécutions de main() capturées (ecrire + stdout + stderr), ${lignesSaisie.reduce((n, s) => n + s.questions.length, 0)} questions posées`);

    M.nouveauCompte = orig.nouveauCompte; P.hacher = orig.hacher; P.politique = orig.politique; roleAdmin.poserRole = orig.poserRole; liaison.creerCode = orig.creerCode;
    await H.fermerBac(); H.bilan();
})().catch(e => { console.error('❌', e); process.exit(1); });
