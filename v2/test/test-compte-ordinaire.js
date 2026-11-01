'use strict';
// COMPTE-TEST (01/11) — `compte-essai.js --base=rm_essai --banc --ordinaire` : le compte de test ORDINAIRE de l'essai (non administrateur, confirmé, marqué banc + bancOrdinaire, SANS rôle), ses deux identifiants
// ajoutés au .env par AJOUT SEUL (V2_ESSAI_ORDINAIRE_IDENTIFIANT / V2_ESSAI_ORDINAIRE_MOT_DE_PASSE), jamais affichés. Base EN MÉMOIRE, saisie et connexion injectées, .env FACTICE : l'outil n'est JAMAIS lancé contre une base
// ni un fichier réels (le chemin réel du .env n'est jamais cité par ce banc).
const fs = require('fs'), os = require('os'), path = require('path');
const H = require('./_harnais'); const M = require('../modeles'); const P = require('../comptes/mots-de-passe'); const { emailCle } = require('../comptes/email-cle');
const roleAdmin = require('../admin/poser-role'); const db = require('../db'); const { col } = db;

const ACT_RW = ['collStats', 'createCollection', 'createIndex', 'dbHash', 'dbStats', 'dropCollection', 'dropIndex', 'find', 'insert', 'killCursors', 'listCollections', 'listIndexes', 'remove', 'renameCollectionSameDB', 'update', 'changeStream', 'planCacheRead'];
const priv = (b, actions, collection = '') => ({ resource: { db: b, collection }, actions });
const statutBon = () => ({ ok: 1, authInfo: { authenticatedUsers: [{ user: 'essai', db: 'admin' }], authenticatedUserRoles: [{ role: 'readWrite', db: 'rm_essai' }], authenticatedUserPrivileges: [priv('rm_essai', ACT_RW), priv('rm_essai', ACT_RW, 'system.js')] } });
const ENV = { MONGODB_URI: 'mongodb+srv://ecr:pw@prod.abcde.mongodb.net/test', MONGODB_LECTURE_URI: 'mongodb+srv://lec:pw@prod.abcde.mongodb.net/test',
    MONGODB_CARTES_URI: 'mongodb+srv://ecr:pw@cartes.fghij.mongodb.net/cartes', MONGODB_CARTES_LECTURE_URI: 'mongodb+srv://lec:pw@cartes.fghij.mongodb.net/cartes',
    MONGODB_ESSAI_URI: 'mongodb+srv://essai:pw@essai.klmno.mongodb.net/rm_essai' };
const vue = base => new Proxy(base, { get(t, p) {
    if (p === 'admin') return () => ({ command: async c => (c && c.connectionStatus ? statutBon() : c && c.hello ? { setName: 'essai-rs' } : t.admin().command(c)) });
    const x = t[p]; return typeof x === 'function' ? x.bind(t) : x; } });

(async () => {
    await H.ouvrirBac('test-compte-ordinaire.js'); await M.creerIndex();
    const essai = require('../admin/compte-essai');
    const ADR = 'banc-ordinaire@rat-market.invalid', CLE = emailCle(ADR);
    const NOM_ID = 'V2_ESSAI_ORDINAIRE_IDENTIFIANT', NOM_MDP = 'V2_ESSAI_ORDINAIRE_MOT_DE_PASSE';

    const sorties = [];
    async function jouer(argv, extra = {}) {
        const sortie = [], brut = []; const so = process.stdout.write, se = process.stderr.write;
        process.stdout.write = c => { brut.push(String(c)); return true; }; process.stderr.write = c => { brut.push(String(c)); return true; };
        let connexions = 0, questions = 0, code, leve = null;
        const saisie = { ligne: async () => { questions++; throw new Error('aucune question attendue'); }, secret: async () => { questions++; throw new Error('aucune question attendue'); } };
        const deps = { saisie, ecrire: l => sortie.push(String(l)), ecrireErreur: l => sortie.push(String(l)), env: ENV,
            ouvrirSource: async () => ({ ok: true, source: { identite: async () => 'prod-rs' }, fermer: async () => { } }), ouvrirCartes: async () => ({ ok: true, setName: 'cartes-rs', fermer: async () => { } }),
            connecter: async () => { connexions++; return { base: 'rm_essai', db: vue(db.base()) }; }, ...extra };
        try { code = await essai.main(argv, deps); } catch (e) { leve = e; code = 'LEVE'; } finally { process.stdout.write = so; process.stderr.write = se; }
        const texte = [...sortie, ...brut].join('\n'); sorties.push(texte);
        if (leve) console.log(`   ⚠️ exception : ${leve.name} ${String(leve.message).slice(0, 120)}`);
        return { code, texte, connexions, questions };
    }
    const espions = { poserRole: [], creerCode: [] }; const orig = { poserRole: roleAdmin.poserRole, creerCode: require('../installations/liaison').creerCode };
    roleAdmin.poserRole = async (...a) => { espions.poserRole.push(a); return orig.poserRole(...a); };
    require('../installations/liaison').creerCode = async (...a) => { espions.creerCode.push(a); return orig.creerCode(...a); };
    const compterTout = async () => { const r = {}; for (const n of ['comptes', 'codes_liaison', 'mouvements', 'sessions', 'installations']) { const c = await col(n).countDocuments({}); if (c) r[n] = c; } return r; };

    const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'compte-ordinaire-env-')), fichier = path.join(dossier, '.env');
    const AVANT = ['# environnement factice', 'AUTRE_VARIABLE=garde-moi', 'V2_ESSAI_BANC_IDENTIFIANT=banc-mesure@rat-market.invalid', 'V2_ESSAI_BANC_MOT_DE_PASSE=secret-du-compte-de-mesure', 'DERNIERE=fin', ''].join('\n');
    fs.writeFileSync(fichier, AVANT);
    const lit = () => fs.readFileSync(fichier, 'utf8');
    const val = nom => { const m = new RegExp(`^${nom}=(.*)$`, 'm').exec(lit()); return m ? m[1] : null; };
    const base0 = await compterTout();

    // ── 1. les arguments : --ordinaire n'existe qu'avec --banc, sur rm_essai seulement ──
    H.v('1a. lireArgs : --banc --ordinaire admis sur rm_essai', [essai.lireArgs(['--base=rm_essai', '--banc', '--ordinaire']).ordinaire, essai.lireArgs(['--base=rm_essai', '--banc', '--ordinaire']).ok], [true, true]);
    H.v('   --ordinaire SANS --banc : refus (jamais un compte ordinaire ordinaire)', essai.lireArgs(['--base=rm_essai', '--ordinaire']).ok, false);
    H.v('   --banc seul : ordinaire false (le compte de mesure ne change pas)', essai.lireArgs(['--base=rm_essai', '--banc']).ordinaire, false);
    for (const argv of [['--base=test', '--banc', '--ordinaire'], ['--banc', '--ordinaire'], ['--base=cartes', '--banc', '--ordinaire'], ['--base=test_scratch', '--banc', '--ordinaire'], ['--base=rm_essai', '--ordinaire'], ['--base=rm_essai', '--banc', '--ordinaire', '--code'],
        ['--base=rm_essai', '--banc', '--ordinaire', '--admin'], ['--base=rm_essai', '--banc', '--ordinaire', '--role=administrateur'], ['--base=rm_essai', '--banc', '--ordinaire', '--email=x@y.fr']]) {
        const r = await jouer(argv, { fichierEnv: fichier });
        H.v(`1b. refus avant toute connexion : ${JSON.stringify(argv)}`, [r.code, r.connexions, r.questions, lit() === AVANT, await compterTout()], [1, 0, 0, true, base0]);
    }
    { const r = await jouer(['--base=rm_essai', '--banc', '--ordinaire']);
      H.v('1c. sans fichier d\'environnement factice injecté : refus (un banc ne réécrit jamais le .env réel), aucun compte', [r.code, await compterTout(), /factice/.test(r.texte)], [1, base0, true]); }

    // ── 2. la création ──
    const apresEnvCree = async () => lit();
    const r2 = await jouer(['--base=rm_essai', '--banc', '--ordinaire'], { fichierEnv: fichier });
    const c = await col('comptes').findOne({ emailCle: CLE });
    H.v('2a. création : code 0, AUCUNE question, aucun code de liaison, le rôle n\'est JAMAIS posé', [r2.code, r2.questions, espions.creerCode.length, espions.poserRole.length], [0, 0, 0, 0]);
    H.vrai('   le compte « banc-ordinaire » : adresse réservée .invalid, confirmé, marqué banc ET bancOrdinaire', !!c && c.email === ADR && /\.invalid$/.test(c.email) && c.verifie === true && c.banc === true && c.bancOrdinaire === true);
    H.v('   NON administrateur : aucun champ de rôle', [c.role, 'role' in c], [undefined, false]);
    H.v('   generation 0, solde à zéro, aucun abonnement, un seul compte créé et rien d\'autre', [c.generation, c.solde, c.abonnement.actif, await compterTout()], [0, { accueil: 0, achete: 0 }, false, { ...base0, comptes: (base0.comptes || 0) + 1 }]);
    const mdp = val(NOM_MDP);
    H.vrai('   le mot de passe écrit au .env est GÉNÉRÉ (32 caractères URL-sûrs), conforme à la politique, et il ouvre le compte', typeof mdp === 'string' && /^[A-Za-z0-9_-]{32}$/.test(mdp) && P.politique(mdp, CLE) === null && await P.verifier(mdp, c.motDePasse));
    H.v('   l\'identifiant écrit au .env est l\'adresse du compte', val(NOM_ID), ADR);
    H.v('   les noms des variables sont ceux du cahier des charges', [essai.NOM_ORDINAIRE_IDENTIFIANT, essai.NOM_ORDINAIRE_MOT_DE_PASSE, essai.ADRESSE_ORDINAIRE], [NOM_ID, NOM_MDP, ADR]);
    const apres = lit();
    H.vrai('2b. .env : AJOUT SEUL — le fichier d\'avant est un PRÉFIXE exact du fichier d\'après (octet pour octet)', apres.startsWith(AVANT));
    H.v('   ... et ce qui suit est exactement les deux nouvelles lignes', apres.slice(AVANT.length).split('\n').filter(Boolean).map(l => l.split('=')[0]), [NOM_ID, NOM_MDP]);
    H.v('   ... les identifiants du compte de MESURE sont intacts', [val('V2_ESSAI_BANC_IDENTIFIANT'), val('V2_ESSAI_BANC_MOT_DE_PASSE')], ['banc-mesure@rat-market.invalid', 'secret-du-compte-de-mesure']);
    H.vrai('2c. le mot de passe (et son début) n\'est dans aucune sortie ni aucun document', sorties.every(t => !t.includes(mdp) && !t.includes(mdp.slice(0, 8))) && !JSON.stringify(await col('comptes').find({}).toArray()).includes(mdp));
    H.vrai('   la sortie dit où sont les identifiants sans les montrer (ni l\'adresse)', /écrits dans le fichier d'environnement/.test(r2.texte) && r2.texte.includes(NOM_MDP) && !r2.texte.includes(ADR));

    // ── 3. existant ──
    { const env1 = lit(), h1 = JSON.stringify(c.motDePasse);
      const r = await jouer(['--base=rm_essai', '--banc', '--ordinaire'], { fichierEnv: fichier });
      H.v('3a. le compte existe, sans --reprendre : refus, ni .env ni hachage ne bougent', [r.code, lit() === env1, JSON.stringify((await col('comptes').findOne({ emailCle: CLE })).motDePasse) === h1, /--banc --ordinaire --reprendre/.test(r.texte)], [1, true, true, true]); }
    { const env1 = lit(), g1 = (await col('comptes').findOne({ emailCle: CLE })).generation;
      const r = await jouer(['--base=rm_essai', '--banc', '--ordinaire', '--reprendre'], { fichierEnv: fichier });
      const c2 = await col('comptes').findOne({ emailCle: CLE }), mdp2 = val(NOM_MDP);
      H.v('3b. --reprendre : code 0, mot de passe régénéré (valide, l\'ancien non), generation +1, toujours sans rôle', [r.code, mdp2 !== mdp, await P.verifier(mdp2, c2.motDePasse), await P.verifier(mdp, c2.motDePasse), c2.generation, 'role' in c2, espions.poserRole.length], [0, true, true, false, g1 + 1, false, 0]);
      H.v('   ... le .env : seule la ligne du mot de passe a changé', lit().replace(/^V2_ESSAI_ORDINAIRE_MOT_DE_PASSE=.*$/m, '#'), env1.replace(/^V2_ESSAI_ORDINAIRE_MOT_DE_PASSE=.*$/m, '#'));
      H.vrai('   ... aucune sortie ne contient ni l\'ancien ni le nouveau mot de passe', sorties.every(t => !t.includes(mdp) && !t.includes(mdp2))); }
    { const r = await jouer(['--base=rm_essai', '--banc', '--reprendre'], { fichierEnv: fichier });      // le compte de MESURE n'existe pas dans ce banc : refus
      H.v('3c. --banc --reprendre (le compte de mesure) ne touche pas le compte ordinaire', [r.code, (await col('comptes').findOne({ emailCle: CLE })).bancOrdinaire], [1, true]); }
    { await col('comptes').updateOne({ emailCle: CLE }, { $set: { role: 'administrateur' } }); const env1 = lit();
      const r = await jouer(['--base=rm_essai', '--banc', '--ordinaire', '--reprendre'], { fichierEnv: fichier });
      H.v('3d. le compte porte un RÔLE : refus (un compte ordinaire de test n\'est jamais repris administrateur), .env intact', [r.code, lit() === env1, /rôle/.test(r.texte)], [1, true, true]);
      await col('comptes').updateOne({ emailCle: CLE }, { $unset: { role: '' } }); }
    for (const [nom, retire] of [['sans la marque banc', { banc: '' }], ['sans la marque bancOrdinaire', { bancOrdinaire: '' }]]) {
        await col('comptes').updateOne({ emailCle: CLE }, { $unset: retire }); const env1 = lit();
        const r = await jouer(['--base=rm_essai', '--banc', '--ordinaire', '--reprendre'], { fichierEnv: fichier });
        H.v(`3e. un compte de cette adresse ${nom} : refus (on ne reprend pas le compte d'un autre), .env intact`, [r.code, lit() === env1], [1, true]);
        await col('comptes').updateOne({ emailCle: CLE }, { $set: { banc: true, bancOrdinaire: true } });
    }

    // ── 4. la vérification « ajout seul » : pure, et câblée ──
    const V = essai.verifierAjoutSeul;
    H.vrai('4a. verifierAjoutSeul : un ajout en fin passe', V('A=1\n', 'A=1\nX=2\nY=3\n', ['X', 'Y']) === true);
    H.vrai('   un ajout à un fichier sans fin de ligne passe aussi', V('A=1', 'A=1\nX=2\nY=3\n', ['X', 'Y']) === true);
    H.vrai('   un remplacement en place des deux seuls noms passe (le reste identique)', V('A=1\nX=old\nB=2\nY=old\n', 'A=1\nX=new\nB=2\nY=new\n', ['X', 'Y']) === true);
    for (const [nom, av, ap] of [['une autre ligne modifiée', 'A=1\nB=2\n', 'A=9\nB=2\nX=2\nY=3\n'], ['une ligne retirée', 'A=1\nB=2\n', 'A=1\nX=2\nY=3\n'], ['une ligne ajoutée en plus', 'A=1\n', 'A=1\nX=2\nY=3\nZ=4\n'], ['une ligne ajoutée AVANT', 'A=1\n', 'Z=4\nA=1\nX=2\nY=3\n'],
        ['un fichier vidé', 'A=1\n', ''], ['les fins de ligne changées', 'A=1\r\n', 'A=1\nX=2\nY=3\n'], ['un nom qui manque', 'A=1\n', 'A=1\nX=2\n'], ['un nom doublé', 'A=1\n', 'A=1\nX=2\nX=3\nY=3\n']])
        H.vrai(`   refusée : ${nom}`, V(av, ap, ['X', 'Y']) === false);
    H.vrai('   des entrées illisibles : false, jamais une exception', V(null, 'a', ['X']) === false && V('a', undefined, ['X']) === false && V('a', 'a', []) === false);
    {   // câblage : si l'écriture produit autre chose qu'un ajout, l'outil RESTAURE le fichier d'avant et refuse
        const sauve = lit();
        const r = await jouer(['--base=rm_essai', '--banc', '--ordinaire', '--reprendre'], { fichierEnv: fichier, ecrireEnv: (f, paires) => { fs.writeFileSync(f, 'AUTRE_VARIABLE=ECRASEE\n' + Object.entries(paires).map(([k, v]) => `${k}=${v}`).join('\n') + '\n'); return { remplacees: 0, ajoutees: 2 }; } });
        H.v('4b. une écriture qui toucherait une autre ligne : refus, le fichier d\'avant est RESTAURÉ octet pour octet', [r.code, lit() === sauve, /autre ligne|ajout seul/.test(r.texte)], [1, true, true]);
    }
    {   // l'écriture qui échoue avant d'écrire : le compte est écrit mais l'outil le dit et dit comment reprendre
        const fAbsent = path.join(dossier, 'absent.env'); const nb = (await compterTout()).comptes;
        await col('comptes').deleteOne({ emailCle: CLE });
        const r = await jouer(['--base=rm_essai', '--banc', '--ordinaire'], { fichierEnv: fAbsent });
        H.v('4c. fichier d\'environnement absent : refus qui dit comment reprendre, le fichier n\'est pas créé', [r.code, fs.existsSync(fAbsent), /--banc --ordinaire --reprendre/.test(r.texte)], [1, false, true]);
        H.vrai('   (le compte écrit sans identifiants se reprend : --reprendre régénère le mot de passe)', (await compterTout()).comptes === nb);
    }

    // ── 5. le compte de mesure et le compte ordinaire cohabitent, chacun sa paire ──
    { const sauve = lit(); const envPlein = ['A=1', 'V2_ESSAI_ORDINAIRE_IDENTIFIANT=ancien@rat-market.invalid', 'V2_ESSAI_ORDINAIRE_IDENTIFIANT_X=ne-me-touche-pas', '# V2_ESSAI_ORDINAIRE_MOT_DE_PASSE=commentaire', 'V2_ESSAI_BANC_MOT_DE_PASSE=mesure', ''].join('\n');
      fs.writeFileSync(fichier, envPlein);
      await col('comptes').updateOne({ emailCle: CLE }, { $set: { verifie: true } });
      const r = await jouer(['--base=rm_essai', '--banc', '--ordinaire', '--reprendre'], { fichierEnv: fichier });
      const t = lit();
      H.vrai('5a. un .env qui porte déjà un nom, un préfixe voisin et un commentaire : seules les deux lignes nommées bougent', r.code === 0 && t.includes('V2_ESSAI_ORDINAIRE_IDENTIFIANT_X=ne-me-touche-pas') && t.includes('# V2_ESSAI_ORDINAIRE_MOT_DE_PASSE=commentaire') && t.includes('V2_ESSAI_BANC_MOT_DE_PASSE=mesure') && t.includes('A=1') && !t.includes('ancien@'));
      fs.writeFileSync(fichier, sauve); }

    roleAdmin.poserRole = orig.poserRole; require('../installations/liaison').creerCode = orig.creerCode;
    H.vrai('6. aucune sortie du banc ne contient de schéma mongodb:// ni de mot de passe de base', sorties.every(t => !t.includes('mongodb://') && !t.includes('pw@')));
    console.log(`   dénominateur : ${sorties.length} exécutions de main() capturées`);
    try { fs.rmSync(dossier, { recursive: true, force: true }); } catch { /* temporaire */ }
    await H.fermerBac(); H.bilan();
})().catch(e => { console.error('❌', e); process.exit(1); });
