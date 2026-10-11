'use strict';
// COTES-VISUELS — la lecture seule de `cartes`, prouvée par ce qu'elle PEUT faire (CLAUDE.md §78). Aucune connexion réelle : une FAUSSE connexion qui enregistre ses appels.
// Chaque refus est écrit pour échouer si la garde correspondante est retirée (le banc de mutation du coordinateur le rejoue).
const H = require('./_harnais');
const LS = require('../chargeur/lecture-seule');

const SECRET = 'mot-de-passe-secret-42';
const LECTURE = `mongodb+srv://lecteur:${SECRET}@grappe-cartes.exemple.net/cartes`;
const ECRITURE = `mongodb+srv://ecrivain:${SECRET}@grappe-cartes.exemple.net/cartes`;
const LIRE_SEUL = ['find', 'listCollections', 'listIndexes', 'collStats', 'dbStats', 'killCursors'];
const statut = (actions = LIRE_SEUL, extra = {}) => ({ ok: 1, authInfo: { authenticatedUsers: [{ user: 'lecteur', db: 'admin' }], authenticatedUserRoles: [{ role: 'read', db: 'cartes' }],
    authenticatedUserPrivileges: [{ resource: { db: 'cartes', collection: '' }, actions }], ...extra } });

// une fausse connexion : tout appel est noté ; les curseurs sont de faux curseurs
function fausse(st, { leveSurStatut = false } = {}) {
    const appels = [];
    const curseur = { toArray: async () => [{ _id: 1 }], out: () => appels.push(['out']), addStage: () => appels.push(['addStage']) };
    const db = {
        databaseName: 'cartes',
        admin: () => ({ command: async c => { appels.push(['command', JSON.stringify(c)]); if (leveSurStatut) throw new Error(`échec ${SECRET}`); return st; } }),
        collection: nom => ({
            find: () => { appels.push(['find', nom]); return curseur; }, aggregate: () => { appels.push(['aggregate', nom]); return curseur; },
            insertOne: async () => appels.push(['insertOne', nom]), updateOne: async () => appels.push(['updateOne', nom]), deleteMany: async () => appels.push(['deleteMany', nom]),
            drop: async () => appels.push(['drop', nom]), createIndex: async () => appels.push(['createIndex', nom]), findOne: async () => { appels.push(['findOne', nom]); return { _id: 1 }; }
        }),
        dropDatabase: async () => appels.push(['dropDatabase'])
    };
    const vus = [];
    return { appels, vus, connecter: async uri => { vus.push(uri); appels.push(['connecter']); return { db, close: async () => { appels.push(['close']); } }; } };
}
const nb = (appels, k) => appels.filter(a => a[0] === k).length;
const env = (o = {}) => ({ MONGODB_CARTES_LECTURE_URI: LECTURE, MONGODB_CARTES_URI: ECRITURE, ...o });

(async () => {
    // ── 1. les refus AVANT toute connexion (la variable seule les décide)
    let f = fausse(statut()); let r = await LS.ouvrir({ env: env({ MONGODB_CARTES_LECTURE_URI: undefined }), connecter: f.connecter });
    H.v('variable de lecture absente : refus, aucune connexion', [r.ok, nb(f.appels, 'connecter')], [false, 0]);
    f = fausse(statut()); r = await LS.ouvrir({ env: env({ MONGODB_CARTES_LECTURE_URI: '   ' }), connecter: f.connecter });
    H.v('variable de lecture vide : refus, aucune connexion', [r.ok, nb(f.appels, 'connecter')], [false, 0]);
    f = fausse(statut()); r = await LS.ouvrir({ env: env({ MONGODB_CARTES_LECTURE_URI: ECRITURE }), connecter: f.connecter });
    H.v('variable de lecture = MONGODB_CARTES_URI (l\'écriture) : refus, aucune connexion, raison « égale »', [r.ok, /égale/.test(r.raison || ''), nb(f.appels, 'connecter')], [false, true, 0]);
    f = fausse(statut()); r = await LS.ouvrir({ env: env({ MONGODB_CARTES_LECTURE_URI: `mongodb+srv://ecrivain:autre@grappe-cartes.exemple.net/cartes` }), connecter: f.connecter });
    H.v('même UTILISATEUR que l\'écriture (autre mot de passe) : refus, aucune connexion', [r.ok, /utilisateur/.test(r.raison || ''), nb(f.appels, 'connecter')], [false, true, 0]);
    f = fausse(statut()); r = await LS.ouvrir({ env: env({ MONGODB_CARTES_LECTURE_URI: 'mongodb+srv://grappe-cartes.exemple.net/cartes' }), connecter: f.connecter });
    H.v('URI de lecture sans utilisateur lisible : refus (je ne sais pas), aucune connexion', [r.ok, nb(f.appels, 'connecter')], [false, 0]);
    f = fausse(statut()); r = await LS.ouvrir({ env: env({ MONGODB_CARTES_URI: undefined }), connecter: f.connecter });
    H.v('MONGODB_CARTES_URI absente : rien à égaler, les privilèges décident → accepté', [r.ok, nb(f.appels, 'connecter')], [true, 1]);

    // ── 2. les privilèges : connectionStatus + showPrivileges AVANT toute lecture ; une action hors de la liste de lecture = refus
    f = fausse(statut()); r = await LS.ouvrir({ env: env(), connecter: f.connecter });
    H.v('droits de lecture seulement : accepté', r.ok, true);
    H.v('   connectionStatus lu avec showPrivileges, et AVANT toute lecture', [JSON.parse(f.appels.find(a => a[0] === 'command')[1]), f.appels.findIndex(a => a[0] === 'command') < (f.appels.findIndex(a => a[0] === 'find') + 1 || 99)], [{ connectionStatus: 1, showPrivileges: true }, true]);
    H.v('   aucune lecture n\'a eu lieu à l\'ouverture', nb(f.appels, 'find') + nb(f.appels, 'aggregate'), 0);
    f = fausse(statut([...LIRE_SEUL, 'listDatabases'])); r = await LS.ouvrir({ env: env(), connecter: f.connecter });
    H.v('   `listDatabases` (rôle readAnyDatabase d\'Atlas : liste des noms, aucune écriture) : accepté', r.ok, true);
    for (const action of ['insert', 'update', 'remove', 'createIndex', 'dropCollection', 'dropDatabase', 'anyAction', 'bypassDocumentValidation', 'renameCollectionSameDB', 'createCollection', 'unAction-future']) {
        f = fausse(statut([...LIRE_SEUL, action])); r = await LS.ouvrir({ env: env(), connecter: f.connecter });
        H.v(`   action « ${action} » parmi les droits : refus, connexion fermée, aucune lecture`, [r.ok, nb(f.appels, 'close'), nb(f.appels, 'find')], [false, 1, 0]);
    }
    for (const [nom, st] of [['authInfo absent', { ok: 1 }], ['aucun utilisateur authentifié', statut(LIRE_SEUL, { authenticatedUsers: [] })], ['aucun privilège', statut(LIRE_SEUL, { authenticatedUserPrivileges: [] })],
        ['privilèges non tableau', statut(LIRE_SEUL, { authenticatedUserPrivileges: 'tout' })], ['actions non tableau', statut(LIRE_SEUL, { authenticatedUserPrivileges: [{ resource: {}, actions: 'find' }] })],
        ['réponse vide', null], ['actions vides', statut([])], ['aucun droit find (dbStats, collStats seuls)', statut(['dbStats', 'collStats'])]]) {
        f = fausse(st); r = await LS.ouvrir({ env: env(), connecter: f.connecter });
        H.v(`   « ${nom} » : je ne sais pas ⇒ refus, connexion fermée`, [r.ok, nb(f.appels, 'close')], [false, 1]);
    }
    f = fausse(null, { leveSurStatut: true }); r = await LS.ouvrir({ env: env(), connecter: f.connecter });
    H.v('connectionStatus qui échoue : refus, connexion fermée, le secret n\'est dans aucune raison', [r.ok, nb(f.appels, 'close'), JSON.stringify(r).includes(SECRET)], [false, 1, false]);
    r = await LS.ouvrir({ env: env(), connecter: async () => { throw new Error(`bad auth ${SECRET}`); } });
    H.v('connexion qui échoue (bad auth) : refus sans lever, le secret n\'est dans aucune raison', [r.ok, JSON.stringify(r).includes(SECRET), typeof r.raison], [false, false, 'string']);

    // ── 3. la façade : find et aggregate sur trois collections, RIEN d'autre
    f = fausse(statut()); r = await LS.ouvrir({ env: env(), connecter: f.connecter });
    const c = r.cartes;
    H.v('façade : find sur sets, cartes, cartes_produits', await Promise.all(['sets', 'cartes', 'cartes_produits'].map(n => c.collection(n).find({}, { projection: { _id: 1 } }).toArray())), [[{ _id: 1 }], [{ _id: 1 }], [{ _id: 1 }]]);
    const leve = (fn) => { try { const x = fn(); return x && typeof x.then === 'function' ? x.then(() => null, e => e.message) : null; } catch (e) { return e.message; } };
    const refus = async (nom, fn) => { const m = await leve(fn); H.vrai(`   refusé : ${nom}`, typeof m === 'string'); };
    await refus('aggregate (jamais appelé par l\'API : un pipeline peut lire d\'autres collections par $lookup / $unionWith / $graphLookup — revue M1)', () => c.collection('sets').aggregate([{ $match: {} }]));
    await refus('aggregate avec $lookup vers une collection hors liste', () => c.collection('sets').aggregate([{ $lookup: { from: 'images', pipeline: [], as: 'x' } }]));
    for (const nom of ['images', 'collecte_images_etat', 'numeros_cartes', 'comptes', 'system.users', '$cmd']) await refus(`collection « ${nom} » (liste fermée)`, () => c.collection(nom));
    for (const m of ['insertOne', 'updateOne', 'deleteMany', 'drop', 'createIndex', 'findOne']) await refus(`collection.${m}`, () => c.collection('sets')[m]({}));
    await refus('aggregate avec $out', () => c.collection('sets').aggregate([{ $out: 'x' }]));
    await refus('aggregate avec $merge imbriqué', () => c.collection('sets').aggregate([{ $facet: { a: [{ $merge: 'x' }] } }]));
    await refus('db.dropDatabase', () => c.dropDatabase());
    await refus('db.admin', () => c.admin());
    await refus('curseur.out', () => c.collection('sets').find({}).out('x'));
    await refus('curseur.addStage', () => c.collection('sets').find({}).addStage({ $out: 'x' }));
    const ecritures = f.appels.filter(a => /^(insertOne|updateOne|deleteMany|drop|createIndex|dropDatabase|out|addStage)$/.test(a[0]));
    H.v('   AUCUNE écriture n\'est arrivée à la fausse connexion (dénominateur : ' + f.appels.length + ' appels)', ecritures, []);
    H.vrai('   fermer() ferme la connexion', (await c.fermer(), nb(f.appels, 'close') >= 1));

    // ── 4. la liste des actions autorisées est celle d'un rôle de lecture (garde écrite par ce qu'elle autorise)
    // L6 : la liste est comparée à la liste LITTÉRALE du rôle `read` d'Atlas (plus listDatabases) — ajouter une action (collMod…) fait tomber ce banc
    H.v('ACTIONS_DE_LECTURE : égale à la liste littérale d\'un rôle de lecture', [...LS.ACTIONS_DE_LECTURE].sort(), ['changeStream', 'collStats', 'dbHash', 'dbStats', 'find', 'killCursors', 'listCollections', 'listDatabases', 'listIndexes', 'listSearchIndexes', 'planCacheRead']);
    // L1 : TOUS les privilèges sont jugés, pas le premier seulement
    const deux = { ok: 1, authInfo: { authenticatedUsers: [{ user: 'lecteur', db: 'admin' }], authenticatedUserPrivileges: [{ resource: { db: 'cartes', collection: '' }, actions: LIRE_SEUL }, { resource: { db: 'cartes', collection: 'sets' }, actions: ['find', 'update'] }] } };
    f = fausse(deux); r = await LS.ouvrir({ env: env(), connecter: f.connecter });
    H.v('deux privilèges, le SECOND écrit : refus (tous les privilèges sont jugés), connexion fermée', [r.ok, /update/.test(r.raison || ''), nb(f.appels, 'close')], [false, true, 1]);
    f = fausse({ ok: 1, authInfo: { ...deux.authInfo, authenticatedUserPrivileges: [deux.authInfo.authenticatedUserPrivileges[0], { resource: {}, actions: ['find'] }] } }); r = await LS.ouvrir({ env: env(), connecter: f.connecter });
    H.v('   deux privilèges de lecture : accepté', r.ok, true);
    // L2 : la connexion se fait par la variable de LECTURE, jamais avec celle de l'écriture
    f = fausse(statut()); await LS.ouvrir({ env: env(), connecter: f.connecter });
    H.v('la connexion est ouverte avec MONGODB_CARTES_LECTURE_URI, jamais avec MONGODB_CARTES_URI', [f.vus.length, f.vus[0] === LECTURE, f.vus.includes(ECRITURE)], [1, true, false]);
    // M3 : le mot de passe de l'URI d'écriture ne voyage pas
    H.v('sansMotDePasse : l\'adresse et l\'utilisateur restent, le mot de passe part ; absente ⇒ undefined', [LS.sansMotDePasse(ECRITURE).includes(SECRET), LS.sansMotDePasse(ECRITURE), LS.sansMotDePasse(undefined), LS.sansMotDePasse('mongodb://h1:1,h2:2/cartes?x=1')], [false, 'mongodb+srv://ecrivain@grappe-cartes.exemple.net/cartes', undefined, 'mongodb://h1:1,h2:2/cartes?x=1']);
    H.v('   la comparaison d\'utilisateur survit à la suppression du mot de passe', LS.jugerVariables({ MONGODB_CARTES_LECTURE_URI: LECTURE, MONGODB_CARTES_URI: LS.sansMotDePasse(ECRITURE) }).ok, true);
    H.v('   ... et refuse toujours le même utilisateur', LS.jugerVariables({ MONGODB_CARTES_LECTURE_URI: `mongodb+srv://ecrivain:autre@grappe-cartes.exemple.net/cartes`, MONGODB_CARTES_URI: LS.sansMotDePasse(ECRITURE) }).ok, false);
    H.v('ACTIONS_DE_LECTURE : aucune action d\'écriture connue', LS.ACTIONS_DE_LECTURE.filter(a => /^(insert|update|remove|create|drop|rename|anyAction|bypass|convert|enable|apply|setFreeMonitoring|compact)/i.test(a)), []);
    H.bilan();
})().catch(e => { console.error('❌', e); process.exit(1); });
