'use strict';
// ADMIN-DRAPEAU (B8) — `compte.administrateur` : un booléen que l'extension LIT, jamais un droit. Il reflète la MÊME règle que le motif « administrateur » de la facturation
// (offre.estAdministrateur : le porteur le déclare ET le rôle est relu en base). Banc : base en mémoire, la VRAIE fonction solde/offre, le faux de fusion fidèle de test-liaison.js.
// A1 : le code émis par l'outil local compte-essai lie bien une installation, et le drapeau vaut true ensuite.
const H = require('./_harnais'); const A = require('./_b2-aide'); const db = require('../db'); const M = require('../modeles');
const { lireConfig } = require('../config'); const J = require('../comptes/jetons'); const S = require('../comptes/sessions');
const { emailCle } = require('../comptes/email-cle');
(async () => {
    await H.ouvrirBac('test-admin-drapeau.js'); await M.creerIndex();
    H.fixerHorlogeMilieu();
    const cfg = lireConfig({ MONGODB_BASE: 'test_scratch' });
    const express = require('express'); const pret = require('../pret'); const { creerCourrierMemoire } = require('../comptes/courrier'); const { dansUnScan } = require('../../sources');
    const cors = require('../transport/cors'); const { assembler } = require('../index');
    A.registre.fournir('courrier', creerCourrierMemoire()); A.registre.fournir('turnstile', { verifier: async () => true });
    const app = express(); app.set('trust proxy', true); app.use(cors.middlewareV2(cfg)); app.use(express.json()); app.use((q, s, nx) => dansUnScan(nx));
    pret.armer(M.verifierIndex);
    app.use(assembler([require('../argent/monter'), require('../installations/monter'), require('../comptes/monter'), require('../identifier/monter')], cfg, { gererIdentifier: async () => { throw new Error('non'); }, gererRetourLive: async (q, s) => s.json({ success: true }) }));
    const srv = await H.serveur(app);
    const SITE = { origin: cfg.origines.site, 'x-rat-market': '1' }, EXT = { origin: cfg.origines.extension };
    let n = 0;
    const creerCompte = async (email, o = {}) => { const c = Object.assign(M.nouveauCompte({ email, emailCle: email, motDePasse: {} }), { verifie: true }, o); await db.col('comptes').insertOne(c); const s = await S.creerSession(c._id); return { c, cookie: `rm_session=${s.token}` }; };
    const creerInst = async (o = {}) => { const jeton = J.genererJeton(); const i = Object.assign(M.nouvelleInstallation({ jetonEmpreinte: J.empreinte(jeton), essais: 0, libelle: 'Chrome' }), o); await db.col('installations').insertOne(i); return { i, jeton }; };
    const bearer = jeton => ({ authorization: `Bearer ${jeton}`, ...EXT, ...A.ip(++n) });
    const site = cookie => ({ ...SITE, ...A.ip(++n), cookie });
    const code = async cookie => (await H.appel(srv.url, '/api/compte/code', { methode: 'POST', corps: {}, entetes: site(cookie) })).json.code;
    const lier = async (jeton, c, corps = {}) => H.appel(srv.url, '/api/compte/lier', { methode: 'POST', corps: { code: c, ...corps }, entetes: bearer(jeton) });
    const solde = (jeton, corps = {}, plus = {}) => H.appel(srv.url, '/api/solde', { methode: 'POST', corps, entetes: { ...bearer(jeton), ...plus } });
    // 1. installation non liée : la forme actuelle de `compte` (objet présent, lie:false) porte administrateur:false
    const nl = await creerInst();
    const s0 = await solde(nl.jeton);
    H.v('1. installation non liée : solde.compte = { lie:false, emailMasque:null, verifie:false, administrateur:false }', [s0.statut, s0.json.solde.compte], [200, { lie: false, emailMasque: null, verifie: false, administrateur: false }]);

    // 2. compte ordinaire lié : false, dans lier ET dans solde
    const ord = await creerCompte('ordinaire@exemple.fr');
    const iO = await creerInst();
    const rO = await lier(iO.jeton, await code(ord.cookie));
    H.v('2. compte ordinaire : lier.compte.administrateur=false et lier.solde.compte.administrateur=false', [rO.statut, rO.json.compte.administrateur, rO.json.solde.compte.administrateur], [200, false, false]);
    const sO = await solde(rO.json.jetonInstallation);
    H.v('   ... solde.compte.administrateur=false', [sO.statut, sO.json.solde.compte.administrateur, sO.json.solde.compte.lie], [200, false, true]);

    // 3. administrateur lié : true partout
    const adm = await creerCompte('admin@exemple.fr', { role: 'administrateur' });
    const iA = await creerInst();
    const rA = await lier(iA.jeton, await code(adm.cookie));
    H.v('3. administrateur : lier.compte.administrateur=true, lier.solde.compte.administrateur=true', [rA.statut, rA.json.compte.administrateur, rA.json.solde.compte.administrateur], [200, true, true]);
    const sA = await solde(rA.json.jetonInstallation);
    H.v('   ... solde.compte.administrateur=true (et l\'offre est pro : le drapeau reflète le rôle déjà jugé)', [sA.json.solde.compte.administrateur, rA.json.offre.nom], [true, 'pro']);
    const gA = await H.appel(srv.url, '/api/compte', { entetes: site(adm.cookie) });
    H.v('   ... GET /api/compte (site) : solde.compte.administrateur=true', [gA.statut, gA.json.solde && gA.json.solde.compte.administrateur], [200, true]);

    // 4. délier : retour à l'installation seule, false
    const dl = await H.appel(srv.url, '/api/compte/delier', { methode: 'POST', corps: {}, entetes: bearer(rA.json.jetonInstallation) });
    H.v('4. délier : solde.compte.administrateur=false (installation seule)', [dl.statut, dl.json.solde.compte.administrateur], [200, false]);

    // 5. un corps qui porte administrateur:true ne change rien (jamais lu du client)
    const ord2 = await creerCompte('ordinaire2@exemple.fr'); const iO2 = await creerInst();
    const rP = await lier(iO2.jeton, await code(ord2.cookie), { administrateur: true, role: 'administrateur', compte: { administrateur: true } });
    H.v('5. lier avec administrateur:true dans le corps : toujours false', [rP.statut, rP.json.compte.administrateur, rP.json.solde.compte.administrateur], [200, false, false]);
    const sP = await solde(rP.json.jetonInstallation, { administrateur: true, compte: { administrateur: true } }, { 'x-administrateur': 'true' });
    H.v('   solde avec administrateur:true (corps et en-tête) : toujours false', [sP.statut, sP.json.solde.compte.administrateur], [200, false]);
    const sN = await solde(nl.jeton, { administrateur: true }, { 'x-administrateur': 'true' });
    H.v('   installation non liée + administrateur:true : toujours false', [sN.json.solde.compte.administrateur], [false]);

    // 6. la règle est UNE : le drapeau suit le rôle relu en base (rôle retiré => false, sans nouvelle liaison)
    await db.col('comptes').updateOne({ _id: adm.c._id }, { $unset: { role: '' } });
    const iA2 = await creerInst(); const r6 = await lier(iA2.jeton, await code(adm.cookie));
    H.v('6. rôle retiré en base : false (lu en base, pas figé à la liaison)', [r6.statut, r6.json.compte.administrateur], [200, false]);
    await db.col('comptes').updateOne({ _id: adm.c._id }, { $set: { role: 'administrateur' } });
    const s6 = await solde(r6.json.jetonInstallation);
    H.v('   rôle rendu : true sans nouvelle liaison', [s6.json.solde.compte.administrateur], [true]);

    // 7. la source unique : estAdministrateur est exporté par offre.js et solde/offre l'appliquent
    const Of = require('../argent/offre');
    H.v('7. offre.estAdministrateur : porteur déclaré ET rôle en base', [Of.estAdministrateur({ administrateur: true }, { role: 'administrateur' }), Of.estAdministrateur({ administrateur: true }, { role: 'x' }), Of.estAdministrateur({ administrateur: false }, { role: 'administrateur' }), Of.estAdministrateur({}, null), Of.estAdministrateur({ administrateur: 'true' }, { role: 'administrateur' })], [true, false, false, false, false]);

    // 8. A1 : le code émis par l'OUTIL (compte-essai) lie une installation ; ensuite compte.administrateur vaut true
    {
        const essai = require('../admin/compte-essai');
        const MDP = 'Zr7!pamplemousse-essai-Q4', EMAIL = 'Quentin.Essai+drapeau@Example.org';
        const ACT = ['collStats', 'createCollection', 'createIndex', 'dbHash', 'dbStats', 'dropCollection', 'dropIndex', 'find', 'insert', 'killCursors', 'listCollections', 'listIndexes', 'remove', 'renameCollectionSameDB', 'update', 'changeStream', 'planCacheRead'];
        const priv = (collection = '') => ({ resource: { db: 'rm_essai', collection }, actions: ACT });
        const statut = { ok: 1, authInfo: { authenticatedUsers: [{ user: 'essai', db: 'admin' }], authenticatedUserRoles: [{ role: 'readWrite', db: 'rm_essai' }], authenticatedUserPrivileges: [priv(), priv('system.js')] } };
        const vue = new Proxy(db.base(), { get(t, p) { if (p === 'admin') return () => ({ command: async c => (c && c.connectionStatus ? statut : c && c.hello ? { setName: 'essai-rs' } : t.admin().command(c)) }); const x = t[p]; return typeof x === 'function' ? x.bind(t) : x; } });
        const ENV = { MONGODB_URI: 'mongodb+srv://ecr:pw@prod.abcde.mongodb.net/test', MONGODB_LECTURE_URI: 'mongodb+srv://lec:pw@prod.abcde.mongodb.net/test', MONGODB_CARTES_URI: 'mongodb+srv://ecr:pw@cartes.fghij.mongodb.net/cartes', MONGODB_CARTES_LECTURE_URI: 'mongodb+srv://lec:pw@cartes.fghij.mongodb.net/cartes', MONGODB_ESSAI_URI: 'mongodb+srv://essai:pw@essai.klmno.mongodb.net/rm_essai' };
        const lignes = [EMAIL], secrets = [MDP, MDP], sortie = [];
        const so = process.stdout.write; process.stdout.write = () => true;
        let rc;
        try {
            rc = await essai.main(['--base=rm_essai'], { saisie: { ligne: async () => lignes.shift(), secret: async () => secrets.shift() }, ecrire: l => sortie.push(String(l)), ecrireErreur: l => sortie.push(String(l)), env: ENV,
                ouvrirSource: async () => ({ ok: true, source: { identite: async () => 'prod-rs' }, fermer: async () => { } }), ouvrirCartes: async () => ({ ok: true, setName: 'cartes-rs', fermer: async () => { } }), connecter: async () => ({ base: 'rm_essai', db: vue }) });
        } finally { process.stdout.write = so; }
        const vu = sortie.join('\n').match(/\b[A-Z0-9]{6}\b/g) || [];
        const cpt = await db.col('comptes').findOne({ emailCle: emailCle(EMAIL) });
        const codeOutil = (await db.col('codes_liaison').find({ compteId: cpt && cpt._id }).toArray()).map(d => vu.find(v => d.codeEmpreinte === J.empreinte(v))).find(Boolean);
        H.vrai('8. A1 : l\'outil crée l\'administrateur et affiche un code de 6 caractères', rc === 0 && cpt && cpt.role === 'administrateur' && typeof codeOutil === 'string');
        const iE = await creerInst();
        const rE = await lier(iE.jeton, codeOutil);
        H.v('   ... ce code lie l\'installation (POST /api/compte/lier : 200)', [rE.statut, rE.json.success], [200, true]);
        const apresE = await db.col('installations').findOne({ _id: iE.i._id });
        H.vrai('   ... l\'installation porte le compte de l\'outil', apresE && String(apresE.compteId) === String(cpt._id));
        const sE = await solde(rE.json.jetonInstallation);
        H.v('   ... après liaison : lier.compte.administrateur, lier.solde.compte.administrateur, solde.compte.administrateur valent true', [rE.json.compte.administrateur, rE.json.solde.compte.administrateur, sE.json.solde.compte.administrateur], [true, true, true]);
    }

    await srv.fermer(); await H.fermerBac(); H.bilan();
})().catch(e => { console.error('❌', e); process.exit(1); });
