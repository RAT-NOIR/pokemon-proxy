'use strict';
// PREUVE-CIBLE — UNE SEULE preuve de la cible (rm_essai), partagée par amorcer-essai.js et compte-essai.js : le PLUS STRICT des deux sur chaque point.
// Banc : connexions FABRIQUÉES (aucune base, aucune URI réelle). La table reprend les formes de privilèges de la relecture 3 d'AMORÇAGE (41 formes) et ajoute celles du tour 1 de COMPTE-ESSAI.
const H = require('./_harnais');
let PC = null;
try { PC = require('../migrations/preuve-cible'); } catch (e) { H.vrai(`0. le module v2/migrations/preuve-cible.js existe (${e.code || e.name})`, false); H.bilan(); }

if (PC) (async () => {
    const A = require('../migrations/amorcer-essai'), E = require('../admin/compte-essai');
    // les deux outils appellent LA MÊME fonction (pas deux copies)
    H.vrai('0. amorcer-essai.js réexporte la fonction du module partagé (pas une copie)', A.prouverCible === PC.prouverCible && A.jugerHotes === PC.jugerHotes && A.clesDHotes === PC.clesDHotes && A.ouvrirCartesParDefaut === PC.ouvrirCartesParDefaut);
    H.vrai('   compte-essai.js appelle le module partagé (mêmes fonctions exportées)', E.prouverCible === PC.prouverCible && E.jugerHotes === PC.jugerHotes);

    // 2026-10-14 : le rôle readWrite DOCUMENTÉ par MongoDB (Built-In Roles, version actuelle), 25 actions.
    const ACT_DOC = ['changeStream', 'cleanupStructuredEncryptionData', 'collStats', 'compactStructuredEncryptionData', 'convertToCapped', 'createCollection', 'createIndex', 'createSearchIndexes', 'dbHash', 'dbStats', 'dropCollection', 'dropIndex', 'dropSearchIndex', 'find', 'insert', 'killCursors', 'listCollections', 'listIndexes', 'listSearchIndexes', 'performRawDataOperations', 'planCacheRead', 'remove', 'renameCollectionSameDB', 'update', 'updateSearchIndex'];
    const MESURE = { authenticatedUsers: [{ user: 'u', db: 'admin' }], authenticatedUserRoles: [{ role: 'readWrite', db: 'rm_essai' }],
        authenticatedUserPrivileges: [{ resource: { db: 'rm_essai', collection: '' }, actions: ACT_DOC }, { resource: { db: 'rm_essai', collection: 'system.js' }, actions: ACT_DOC }] };
    const clone = o => JSON.parse(JSON.stringify(o));
    const faux = ({ info, setName = 'set-essai', statutLeve = false, helloLeve = false, sansAuthInfo = false }) => ({ admin: () => ({ command: async c => {
        if (c.connectionStatus) { if (statutLeve) throw new Error('refus'); return sansAuthInfo ? {} : { authInfo: info }; }
        if (c.hello) { if (helloLeve) throw new Error('refus'); return setName === null ? {} : { setName }; }
        throw new Error('commande inattendue');
    } }) });
    const src = id => ({ identite: async () => { if (id instanceof Error) throw id; return id; } });
    const cartes = r => async () => { if (r instanceof Error) throw r; return r; };
    const CART_OK = () => ({ ok: true, setName: 'set-cartes', fermer: async () => { } });
    const avecPriv = (extra, remplace) => i => { i.authenticatedUserPrivileges = remplace ? extra : [...i.authenticatedUserPrivileges, ...extra]; };
    const cas = [];
    const P = (nom, mod, attendu, opts = {}) => cas.push({ nom, mod, attendu, opts });
    P('1 forme DOCUMENTÉE (readWrite MongoDB, 25 actions) sur rm_essai + rm_essai.system.js', () => { }, true);
    P('2 ressource { db: "", collection: "" } (toutes bases) + écriture', avecPriv([{ resource: { db: '', collection: '' }, actions: ['find', 'insert', 'remove'] }]), false);
    P('3 { anyResource: true } + écriture', avecPriv([{ resource: { anyResource: true }, actions: ['find', 'insert'] }]), false);
    P('4 { cluster: true } + écriture (shutdown, insert)', avecPriv([{ resource: { cluster: true }, actions: ['shutdown', 'insert'] }]), false);
    P('5 écriture sur une autre base (db: "test")', avecPriv([{ resource: { db: 'test', collection: '' }, actions: ['find', 'update'] }]), false);
    P('5b écriture sur "admin"', avecPriv([{ resource: { db: 'admin', collection: 'system.users' }, actions: ['find', 'insert'] }]), false);
    P('5c écriture sur "rm_essai2"', avecPriv([{ resource: { db: 'rm_essai2', collection: '' }, actions: ['insert'] }]), false);
    P('5d écriture sur "rm_essai " (espace) / "Rm_essai"', avecPriv([{ resource: { db: 'Rm_essai', collection: '' }, actions: ['insert'] }]), false);
    P('6 rôle readWriteAnyDatabase@admin', i => { i.authenticatedUserRoles = [{ role: 'readWriteAnyDatabase', db: 'admin' }]; }, false);
    P('6b rôle dbOwner@rm_essai', i => { i.authenticatedUserRoles = [{ role: 'dbOwner', db: 'rm_essai' }]; }, false);
    P('6c rôle root@admin', i => { i.authenticatedUserRoles = [{ role: 'root', db: 'admin' }]; }, false);
    P('6d rôle atlasAdmin@admin', i => { i.authenticatedUserRoles = [{ role: 'atlasAdmin', db: 'admin' }]; }, false);
    P('6e readWrite@rm_essai + read@test (le plus strict d\'AMORÇAGE : même read doit être sur rm_essai)', i => { i.authenticatedUserRoles.push({ role: 'read', db: 'test' }); }, false);
    P('6f readWrite@test (autre base)', i => { i.authenticatedUserRoles = [{ role: 'readWrite', db: 'test' }]; }, false);
    P('6g userAdmin@rm_essai', i => { i.authenticatedUserRoles = [{ role: 'userAdmin', db: 'rm_essai' }]; }, false);
    P('6h readWrite@rm_essai + dbAdmin@rm_essai', i => { i.authenticatedUserRoles.push({ role: 'dbAdmin', db: 'rm_essai' }); }, false);
    P('6i rôle personnalisé sur rm_essai', i => { i.authenticatedUserRoles = [{ role: 'mon-role', db: 'rm_essai' }]; }, false);
    P('6j readWrite@rm_essai + read@rm_essai (les deux, sur rm_essai)', i => { i.authenticatedUserRoles.push({ role: 'read', db: 'rm_essai' }); }, true);
    P('7 liste de rôles vide', i => { i.authenticatedUserRoles = []; }, false);
    P('7b rôles absents', i => { delete i.authenticatedUserRoles; }, false);
    P('7c privilèges vides', i => { i.authenticatedUserPrivileges = []; }, false);
    P('7d privilèges absents', i => { delete i.authenticatedUserPrivileges; }, false);
    P('7e aucun utilisateur', i => { i.authenticatedUsers = []; }, false);
    P('7f authInfo absent', () => { }, false, { sansAuthInfo: true });
    P('7g connectionStatus lève', () => { }, false, { statutLeve: true });
    P('8 privilège illisible (resource absente)', avecPriv([{ actions: ['find'] }]), false);
    P('8b action non-chaîne', avecPriv([{ resource: { db: 'test', collection: '' }, actions: [42] }]), false);
    P('8c privilège sans liste d\'actions', avecPriv([{ resource: { db: 'rm_essai', collection: '' } }]), false);
    P('8d collection non chaîne sur rm_essai + écriture', avecPriv([{ resource: { db: 'rm_essai' }, actions: ['insert'] }]), false);
    P('9 C6 : { anyResource:true, db:"rm_essai", collection:"" } + écriture', avecPriv([{ resource: { anyResource: true, db: 'rm_essai', collection: '' }, actions: ['insert'] }]), false);
    P('9b { cluster:true, db:"rm_essai", collection:"" } + écriture', avecPriv([{ resource: { cluster: true, db: 'rm_essai', collection: '' }, actions: ['insert'] }]), false);
    P('9c C6 bis : anyResource seul avec une action de lecture (rien d\'écrit : admis)', avecPriv([{ resource: { anyResource: true }, actions: ['find'] }]), true);
    P('10 lecture seule sur toutes bases { db:"" } (find, listCollections)', avecPriv([{ resource: { db: '', collection: '' }, actions: ['find', 'listCollections'] }]), true);
    P('10b lecture seule { cluster:true } (listDatabases)', avecPriv([{ resource: { cluster: true }, actions: ['listDatabases'] }]), true);
    P('11 rôle read@rm_essai seul + find (le plus strict de COMPTE-ESSAI : insert et update exigés)', i => { i.authenticatedUserRoles = [{ role: 'read', db: 'rm_essai' }]; i.authenticatedUserPrivileges = [{ resource: { db: 'rm_essai', collection: '' }, actions: ['find'] }]; }, false);
    P('11b action d\'administration sur rm_essai (createUser) : liste d\'actions FERMÉE', avecPriv([{ resource: { db: 'rm_essai', collection: '' }, actions: ['createUser'] }]), false);
    P('11c dropDatabase sur rm_essai', avecPriv([{ resource: { db: 'rm_essai', collection: '' }, actions: ['dropDatabase'] }]), false);
    P('11d grantRole sur rm_essai', avecPriv([{ resource: { db: 'rm_essai', collection: '' }, actions: ['grantRole'] }]), false);
    P('11e sans insert (find, update, remove seulement)', avecPriv([{ resource: { db: 'rm_essai', collection: '' }, actions: ['find', 'update', 'remove'] }], true), false);
    P('11f sans update (find, insert seulement)', avecPriv([{ resource: { db: 'rm_essai', collection: '' }, actions: ['find', 'insert'] }], true), false);
    // 2026-10-14 : la liste fermée = le readWrite documenté par MongoDB, rien de plus, rien de moins.
    const formeDoc = (...extra) => i => { i.authenticatedUserPrivileges = [{ resource: { db: 'rm_essai', collection: '' }, actions: ACT_DOC }, { resource: { db: 'rm_essai', collection: 'system.js' }, actions: ACT_DOC }, ...extra]; };
    P('11g forme documentée seule : admise', formeDoc(), true);
    P('11h la forme documentée + createUser sur rm_essai : refusée', formeDoc({ resource: { db: 'rm_essai', collection: '' }, actions: ['createUser'] }), false);
    P('11i la forme documentée + dropDatabase hors base (db: "test") : refusée', formeDoc({ resource: { db: 'test', collection: '' }, actions: ['dropDatabase'] }), false);
    P('11j la forme documentée + cleanupStructuredEncryptionData hors base (db: "test") : refusée', formeDoc({ resource: { db: 'test', collection: '' }, actions: ['cleanupStructuredEncryptionData'] }), false);
    P('11k la forme documentée + compactStructuredEncryptionData sur { cluster: true } : refusée', formeDoc({ resource: { cluster: true }, actions: ['compactStructuredEncryptionData'] }), false);
    ['bypassDocumentValidation', 'collMod', 'compact', 'enableProfiler', 'planCacheWrite', 'reIndex'].forEach((a, k) =>
        P(`11${'lmnopq'[k]} la forme documentée + ${a} sur rm_essai (ancienne liste mesurée, hors doc) : refusée`, formeDoc({ resource: { db: 'rm_essai', collection: '' }, actions: [a] }), false));
    P('12 setName absent', () => { }, false, { setName: null });
    P('12b setName vide', () => { }, false, { setName: '' });
    P('12c setName = celui de la source (production sous un alias)', () => { }, false, { setName: 'set-prod' });
    P('12d setName = celui de cartes', () => { }, false, { setName: 'set-cartes' });
    P('12e hello lève', () => { }, false, { helloLeve: true });
    P('13 source sans identité (undefined)', () => { }, false, { source: src(undefined) });
    P('13b source identité vide', () => { }, false, { source: src('') });
    P('13c source identité lève', () => { }, false, { source: src(new Error('x')) });
    P('14 cartes injoignable (lève)', () => { }, false, { cartes: cartes(new Error('x')) });
    P('14b cartes { ok:false }', () => { }, false, { cartes: cartes({ ok: false, raison: 'x' }) });
    P('14c cartes sans setName', () => { }, false, { cartes: cartes({ ok: true, fermer: async () => { } }) });
    P('14d cartes null', () => { }, false, { cartes: cartes(null) });
    P('14e cartes ok:"true" (chaîne)', () => { }, false, { cartes: cartes({ ok: 'true', setName: 'set-cartes', fermer: async () => { } }) });
    P('14f même setName que cartes malgré une source différente', () => { }, false, { setName: 'set-cartes', source: src('set-prod') });

    let ecartsAttendu = 0, fuite = 0;
    for (const c of cas) {
        const info = clone(MESURE); c.mod(info);
        const db = faux({ info, ...c.opts });
        let r; try { r = await PC.prouverCible(db, { source: c.opts.source || src('set-prod'), ouvrirCartes: c.opts.cartes || cartes(CART_OK()), env: {} }); } catch (e) { r = { ok: 'LEVE', raison: String(e && e.message).slice(0, 60) }; }
        const passe = r.ok === true;
        if (passe !== c.attendu) ecartsAttendu++;
        H.v(`${c.nom} -> ${c.attendu ? 'passe' : 'refus'}`, passe, c.attendu);
        if (!passe && /set-prod|set-cartes|set-essai|"u"/.test(String(r.raison))) fuite++;
        if (!passe && !(typeof r.raison === 'string' && r.raison.length)) fuite++;
    }
    H.v(`   dénominateur : ${cas.length} formes jouées, écarts à l'attendu`, ecartsAttendu, 0);
    H.v('   aucune raison ne contient un setName ni un nom d\'utilisateur, toutes sont non vides', fuite, 0);

    // jugerStatut seul (pur) : la même table, sans connexion
    H.vrai('15. jugerStatut(forme mesurée) : admis', PC.jugerStatut({ authInfo: clone(MESURE) }).ok === true);
    H.vrai('16. ACTIONS_READWRITE = le readWrite documenté, exactement (25 actions)', JSON.stringify([...PC.ACTIONS_READWRITE].sort()) === JSON.stringify([...ACT_DOC].sort()));
    H.vrai('   jugerStatut(null) : refus', PC.jugerStatut(null).ok === false);
    // la connexion vers cartes est fermée après le hello (succès ET refus)
    let fermees = 0;
    await PC.prouverCible(faux({ info: clone(MESURE) }), { source: src('set-prod'), ouvrirCartes: async () => ({ ok: true, setName: 'set-cartes', fermer: async () => { fermees++; } }), env: {} });
    await PC.prouverCible(faux({ info: clone(MESURE), setName: 'set-cartes' }), { source: src('set-prod'), ouvrirCartes: async () => ({ ok: true, setName: 'set-cartes', fermer: async () => { fermees++; } }), env: {} });
    H.v('16. la connexion vers cartes est fermée après le hello (réussite et refus)', fermees, 2);

    // l'identité de la production, pour COMPTE-ESSAI : MONGODB_LECTURE_URI, un hello seulement
    {
        let cmds = [], ferme = 0;
        const connecter = async uri => ({ db: { databaseName: 'test', admin: () => ({ command: async c => { cmds.push(Object.keys(c)[0]); return { setName: 'set-prod' }; } }) }, close: async () => { ferme++; } });
        const so = await PC.ouvrirIdentiteProduction({ MONGODB_LECTURE_URI: 'mongodb+srv://r:pw@prod.abcde.mongodb.net/test' }, { connecter });
        H.v('17. ouvrirIdentiteProduction : un hello, rien d\'autre, setName rendu', [so.ok, await so.source.identite(), cmds], [true, 'set-prod', ['hello']]);
        await so.fermer(); H.v('   ... fermée', ferme, 1);
        const sans = await PC.ouvrirIdentiteProduction({}, { connecter });
        H.v('   MONGODB_LECTURE_URI absente : refus', sans.ok, false);
        const casse = await PC.ouvrirIdentiteProduction({ MONGODB_LECTURE_URI: 'mongodb+srv://r:pwsecret@prod.abcde.mongodb.net/test' }, { connecter: async () => { throw new Error('mongodb+srv://r:pwsecret@h'); } });
        H.v('   connexion impossible : refus sans le message du pilote', [casse.ok, JSON.stringify(casse).includes('pwsecret')], [false, false]);
        const sansNom = await PC.ouvrirIdentiteProduction({ MONGODB_LECTURE_URI: 'mongodb+srv://r:pw@prod.abcde.mongodb.net/test' }, { connecter: async () => ({ db: { databaseName: 'test', admin: () => ({ command: async () => ({}) }) }, close: async () => { } }) });
        H.v('   hello sans setName : refus', sansNom.ok, false);
        const autreBase = await PC.ouvrirIdentiteProduction({ MONGODB_LECTURE_URI: 'mongodb+srv://r:pw@prod.abcde.mongodb.net/test' }, { connecter: async () => ({ db: { databaseName: 'cartes', admin: () => ({ command: async () => ({ setName: 'x' }) }) }, close: async () => { } }) });
        H.v('   connexion sur une autre base que test : refus', autreBase.ok, false);
    }
    H.bilan();
})().catch(e => { console.error('❌', e); process.exit(1); });
