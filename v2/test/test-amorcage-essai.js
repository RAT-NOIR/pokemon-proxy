'use strict';
// Banc du lot AMORÇAGE-ESSAI (D4) : v2/migrations/amorcer-essai.js. DEUX bases EN MÉMOIRE (une « source » qui joue la production, une « cible » qui joue rm_essai) ;
// aucune base réelle n'est ouverte, aucune URI réelle n'est lue (les URI de l'environnement ici sont FABRIQUÉES et ne sont jamais utilisées pour se connecter :
// les ouvreurs sont injectés). Le banc juge ce que le script AUTORISE (sept collections, une cible vide ou reprenable, un arrêt avant le seuil) et prouve que
// chaque garde sait dire NON sur un état fabriqué.
const H = require('./_harnais');
const mongoose = require('mongoose');
const { ouvrirBanc } = require('../../collecte-cartes/base-banc');
const A = require('../migrations/amorcer-essai');

const { v, vrai } = H;
const EXE = ['--base=rm_essai'];
const ENV = Object.freeze({
    MONGODB_URI: 'mongodb+srv://prod-ecr:pw-secret-1@cluster0.abcde.mongodb.net/test',
    MONGODB_LECTURE_URI: 'mongodb+srv://prod-lect:pw-secret-2@cluster0.abcde.mongodb.net/test',
    MONGODB_CARTES_URI: 'mongodb+srv://cartes-ecr:pw-secret-3@cluster1.fghij.mongodb.net/cartes',
    MONGODB_ESSAI_URI: 'mongodb+srv://essai-amorcage:pw-secret-4@essai.zzzzz.mongodb.net/rm_essai'
});
const FRAGMENTS_SECRETS = ['pw-secret', 'mongodb+srv', 'abcde', 'zzzzz', 'fghij', 'prod-lect', 'essai-amorcage'];

async function capter(f) {
    const sortie = [], l = console.log, e = console.error, w = console.warn;
    const push = (...a) => sortie.push(a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' '));
    console.log = push; console.error = push; console.warn = push;
    try { return { r: await f(), texte: sortie.join('\n') }; } finally { console.log = l; console.error = e; console.warn = w; }
}
const tri = docs => docs.map(d => JSON.stringify(d)).sort();
const ids = (n, f) => Array.from({ length: n }, (_, i) => f(i));

// le jeu de la « production » : les sept collections autorisées, des index (dont un unique), et des leurres qui ne doivent JAMAIS être copiés
async function remplirSource(db) {
    const nb = { references_image: 23, numeros_cartes: 31, guide_prix: 17, catalogue_produits: 19, codes_set: 7, catalogue_export_meta: 1, guide_prix_meta: 2 };
    await db.collection('references_image').insertMany(ids(nb.references_image, i => ({ idProduct: 1000 + i, vecteur: 'x'.repeat(200), set: `S${i % 3}` })));
    await db.collection('numeros_cartes').insertMany(ids(nb.numeros_cartes, i => ({ _id: 500 + i, idProduct: 1000 + i, nom: `Carte ${i}` })));
    await db.collection('guide_prix').insertMany(ids(nb.guide_prix, i => ({ idProduct: 1000 + i, prix: i + 0.5 })));
    await db.collection('catalogue_produits').insertMany(ids(nb.catalogue_produits, i => ({ idProduct: 1000 + i, idMetacard: 9000 + i })));
    await db.collection('codes_set').insertMany(ids(nb.codes_set, i => ({ _id: `C${String(i).padStart(3, '0')}`, codeSet: `S${i}` })));
    await db.collection('catalogue_export_meta').insertMany([{ _id: 'dernier', fichier: 'products_singles_6.json' }]);
    await db.collection('guide_prix_meta').insertMany([{ _id: 'a', date: '2026-10-12' }, { _id: 'b', date: '2026-10-13' }]);
    await db.collection('references_image').createIndex({ idProduct: 1 }, { unique: true, name: 'idProduct_unique' });
    await db.collection('references_image').createIndex({ set: 1, idProduct: -1 }, { name: 'set_idProduct' });
    await db.collection('numeros_cartes').createIndex({ idProduct: 1 }, { name: 'idProduct_1' });
    await db.collection('guide_prix').createIndex({ idProduct: 1 }, { unique: true, name: 'gp_idProduct' });
    // les leurres : données personnelles et autres collections, qui n'ont rien à faire dans la copie
    await db.collection('credits').insertMany([{ userId: 'u1', solde: 12 }, { userId: 'u2', solde: 3 }]);
    await db.collection('journal_scans').insertMany([{ userId: 'u1', carte: 'x' }]);
    await db.collection('quotas').insertMany([{ userId: 'u1' }]);
    return nb;
}

const noms = async db => (await db.listCollections({}, { nameOnly: true }).toArray()).map(c => c.name).sort();
const compte = (db, n) => db.collection(n).countDocuments({});
const poidsReel = async db => { const s = await db.command({ dbStats: 1 }); return s.dataSize + s.indexSize; };

(async () => {
    const [bs, bc] = await Promise.all([ouvrirBanc({}), ouvrirBanc({})]);
    const cs = await mongoose.mongo.MongoClient.connect(bs.uri), cc = await mongoose.mongo.MongoClient.connect(bc.uri);
    const dbS = cs.db('test'), dbC = cc.db('rm_essai');
    const nb = await remplirSource(dbS);
    const COLS = A.COLLECTIONS_AUTORISEES;

    // l'ouvreur injecté : la source est un ADAPTATEUR de lecture (jamais la base brute), la cible la base native
    let ouverturesSource = 0, ouverturesCible = 0;
    const fermetures = { source: 0, cible: 0 };
    const deps = (extra = {}) => ({
        ouvrirSource: async () => { ouverturesSource++; return { ok: true, source: A.adapterSource(dbS), fermer: async () => { fermetures.source++; } }; },
        ouvrirCible: async () => { ouverturesCible++; return { ok: true, db: dbC, fermer: async () => { fermetures.cible++; } }; },
        journal: () => { },
        ...extra
    });
    const lancer = (args, env = ENV, d = deps()) => capter(() => A.principal(args, env, d));
    const viderCible = async () => { for (const n of await noms(dbC)) await dbC.collection(n).drop(); };

    // ══ 0. la liste, écrite par ce qu'elle AUTORISE
    v('0a. COLLECTIONS_AUTORISEES : exactement les sept du D4 §5', [...COLS].sort(), ['catalogue_export_meta', 'catalogue_produits', 'codes_set', 'guide_prix', 'guide_prix_meta', 'numeros_cartes', 'references_image']);
    v('0b. la liste est gelée', Object.isFrozen(COLS), true);
    v('0c. ARRET_DUR_MO vaut 480', A.ARRET_DUR_MO, 480);
    for (const interdite of ['credits', 'journal_scans', 'quotas', 'remboursements', 'evenements_stripe', 'questions', 'comptes', 'users', 'cartes_produits', 'system.profile'])
        v(`0d. « ${interdite} » n'est pas dans la liste`, COLS.includes(interdite), false);

    // ══ 1. les arguments (une garde s'écrit par ce qu'elle autorise)
    {
        const cas = [
            ['1a. aucun --base : REFUS', [], /--base=rm_essai/],
            ['1b. --base=test : REFUS (la production n\'est jamais une cible)', ['--base=test'], /rm_essai/],
            ['1c. --base=cartes : REFUS', ['--base=cartes'], /rm_essai/],
            ['1d. --base=rm_essai2 : REFUS', ['--base=rm_essai2'], /rm_essai/],
            ['1e. un argument inconnu : REFUS', [...EXE, '--force'], /--force/],
            ['1f. --collections=credits : REFUS, la collection est nommée', [...EXE, '--collections=credits'], /credits/],
            ['1g. --collections=guide_prix,credits : REFUS (une seule hors liste suffit)', [...EXE, '--collections=guide_prix,credits'], /credits/],
            ['1h. --reprendre sans --executer : REFUS', [...EXE, '--reprendre'], /--executer/]
        ];
        for (const [nom, args, motif] of cas) {
            const o0 = ouverturesSource, c0 = ouverturesCible;
            const { r, texte } = await lancer(args);
            v(nom, [r, motif.test(texte), ouverturesSource === o0 && ouverturesCible === c0], [1, true, true]);
        }
    }

    // ══ 2. les variables et les hôtes : refus AVANT toute connexion
    {
        const sans = n => { const e = { ...ENV }; delete e[n]; return e; };
        const refus = async (nom, env, motif) => {
            const o0 = ouverturesSource, c0 = ouverturesCible;
            const { r, texte } = await lancer(EXE, env);
            v(nom, [r, motif.test(texte), ouverturesSource === o0 && ouverturesCible === c0, FRAGMENTS_SECRETS.some(f => texte.includes(f))], [1, true, true, false]);
        };
        await refus('2a. MONGODB_ESSAI_URI absente : REFUS, nom cité, aucune connexion', sans('MONGODB_ESSAI_URI'), /MONGODB_ESSAI_URI/);
        await refus('2b. MONGODB_LECTURE_URI absente : REFUS, aucun repli sur MONGODB_URI (l\'écriture)', sans('MONGODB_LECTURE_URI'), /MONGODB_LECTURE_URI/);
        await refus('2c. MONGODB_LECTURE_URI égale à MONGODB_URI : REFUS', { ...ENV, MONGODB_LECTURE_URI: ENV.MONGODB_URI }, /MONGODB_LECTURE_URI/);
        await refus('2d. cible sur la grappe de production (même hôte, autre utilisateur) : REFUS', { ...ENV, MONGODB_ESSAI_URI: 'mongodb+srv://x:y@cluster0.abcde.mongodb.net/rm_essai' }, /hôte|grappe/i);
        await refus('2e. cible sur la production écrite en hôte de shard et en MAJUSCULES : REFUS', { ...ENV, MONGODB_ESSAI_URI: 'mongodb://x:y@CLUSTER0-SHARD-00-01.ABCDE.MONGODB.NET:27017/rm_essai' }, /hôte|grappe/i);
        await refus('2f. cible sur la grappe des cartes : REFUS', { ...ENV, MONGODB_ESSAI_URI: 'mongodb+srv://x:y@cluster1.fghij.mongodb.net/rm_essai' }, /hôte|grappe/i);
        await refus('2g. cible sur le même hôte que la SOURCE de lecture (MONGODB_URI absente, lecture seule présente) : REFUS', { MONGODB_LECTURE_URI: ENV.MONGODB_LECTURE_URI, MONGODB_ESSAI_URI: 'mongodb+srv://x:y@cluster0.abcde.mongodb.net/rm_essai' }, /hôte|grappe/i);
        await refus('2h. un jeu d\'hôtes dont UN SEUL est la production : REFUS', { ...ENV, MONGODB_ESSAI_URI: 'mongodb://x:y@127.0.0.1:27017,cluster0-shard-00-00.abcde.mongodb.net:27017/rm_essai' }, /hôte|grappe/i);
        await refus('2i. URI de cible illisible : REFUS (doute = refus)', { ...ENV, MONGODB_ESSAI_URI: 'pas-une-uri' }, /illisible|MONGODB_ESSAI_URI/);
        // la même grappe loopback sur le même port = même hôte ; deux ports = deux serveurs
        const j1 = A.jugerHotes({ MONGODB_LECTURE_URI: 'mongodb://u:p@127.0.0.1:27017/test', MONGODB_ESSAI_URI: 'mongodb://u:p@127.0.0.1:27017/rm_essai' });
        const j2 = A.jugerHotes({ MONGODB_LECTURE_URI: 'mongodb://u:p@127.0.0.1:27017/test', MONGODB_ESSAI_URI: 'mongodb://u:p@127.0.0.1:27018/rm_essai' });
        v('2j. jugerHotes : loopback même port refusé, port différent accepté', [j1.ok, j2.ok], [false, true]);
        const j3 = A.jugerHotes(ENV);
        v('2k. jugerHotes : les variables du D4 (grappes distinctes) passent', j3.ok, true);
        v('2l. jugerHotes : aucune raison ne contient un fragment d\'URI', FRAGMENTS_SECRETS.some(f => (A.jugerHotes({ ...ENV, MONGODB_ESSAI_URI: 'mongodb+srv://x:y@cluster0.abcde.mongodb.net/z' }).raison || '').includes(f)), false);
    }

    // ══ 3. la source : la base doit être `test`, les privilèges de lecture prouvés, rien d'autre que les sept collections
    {
        const faux = (s, nomBase) => ({ ok: true, source: { ...A.adapterSource(dbS), nomBase }, fermer: async () => { } });
        const r1 = await capter(() => A.principal(EXE, ENV, deps({ ouvrirSource: async () => faux(null, 'test_scratch') })));
        v('3a. source dont la base n\'est pas `test` : REFUS', [r1.r, /test/.test(r1.texte)], [1, true]);
        const r2 = await capter(() => A.principal(EXE, ENV, deps({ ouvrirCible: async () => ({ ok: true, db: cc.db('autre'), fermer: async () => { } }) })));
        v('3b. cible dont la base n\'est pas rm_essai : REFUS', [r2.r, /rm_essai/.test(r2.texte)], [1, true]);
        const S = A.adapterSource(dbS);
        for (const m of ['compter', 'poids', 'indexes']) {
            let e = null; try { await S[m]('credits'); } catch (x) { e = String(x.message); }
            v(`3c. adapterSource.${m}('credits') LÈVE`, /credits/.test(e || ''), true);
        }
        let e1 = null; try { await S.lot('journal_scans', undefined, 10); } catch (x) { e1 = String(x.message); }
        v('3d. adapterSource.lot(\'journal_scans\') LÈVE', /journal_scans/.test(e1 || ''), true);
        v('3e. l\'adaptateur n\'expose aucune méthode d\'écriture ni la base brute', Object.keys(S).filter(k => /insert|update|delete|drop|create|write|db$|raw|client/i.test(k)), []);
        const lot = await S.lot('numeros_cartes', undefined, 5);
        v('3f. lot : cinq documents, triés par _id croissant', [lot.length, lot.map(d => d._id)], [5, [500, 501, 502, 503, 504]]);
        const lot2 = await S.lot('numeros_cartes', 504, 5);
        v('3g. lot après un _id : reprend strictement après', lot2.map(d => d._id), [505, 506, 507, 508, 509]);
        // les privilèges : l'ouvreur par défaut juge connectionStatus avant de rendre la source
        const statut = actions => ({ authInfo: { authenticatedUsers: [{ user: 'lect', db: 'admin' }], authenticatedUserPrivileges: [{ resource: { db: 'test', collection: '' }, actions }] } });
        const fausseCx = actions => { let fermee = 0; return { cx: { db: { databaseName: 'test', admin: () => ({ command: async () => statut(actions) }) }, close: async () => { fermee++; } }, fermee: () => fermee }; };
        const rw = fausseCx(['find', 'insert', 'update']);
        const o1 = await A.ouvrirSourceParDefaut(ENV, { connecter: async () => rw.cx });
        v('3h. utilisateur qui peut écrire : source REFUSÉE et connexion fermée', [o1.ok, rw.fermee()], [false, 1]);
        const ro = fausseCx(['find', 'listCollections', 'listIndexes', 'collStats']);
        const o2 = await A.ouvrirSourceParDefaut(ENV, { connecter: async () => ro.cx });
        v('3i. utilisateur en lecture seule : source acceptée', [o2.ok, typeof o2.source.compter], [true, 'function']);
        const o3 = await A.ouvrirSourceParDefaut(ENV, { connecter: async () => { throw new Error('boom pw-secret-2'); } });
        v('3j. connexion impossible : refus sans le message du pilote', [o3.ok, JSON.stringify(o3).includes('pw-secret')], [false, false]);
        const ws = fausseCx(['find']); ws.cx.db.databaseName = 'cartes';
        const o4 = await A.ouvrirSourceParDefaut(ENV, { connecter: async () => ws.cx });
        v('3k. la connexion de lecture tombe sur une autre base que `test` : REFUS', [o4.ok, ws.fermee()], [false, 1]);
    }

    // ══ 4. la simulation : compte et poids à la source, RIEN n'est écrit
    {
        const avant = await noms(dbC);
        const { r, texte } = await lancer(EXE);
        v('4a. simulation : code 0', r, 0);
        v('4b. simulation : la cible n\'a reçu AUCUNE collection (pas même l\'état)', [avant, await noms(dbC)], [[], []]);
        for (const n of COLS) v(`4c. simulation : « ${n} » est imprimée avec son compte (${nb[n]})`, new RegExp(`${n}\\D+${nb[n]}\\b`).test(texte), true);
        v('4d. simulation : les leurres ne sont pas nommés', ['credits', 'journal_scans', 'quotas'].some(n => texte.includes(n)), false);
        v('4e. simulation : le poids total est imprimé contre 480 Mo, et le mode est dit', [/480/.test(texte), /simulation/i.test(texte), /--executer/.test(texte)], [true, true, true]);
        v('4f. simulation : aucune valeur d\'URI imprimée', FRAGMENTS_SECRETS.some(f => texte.includes(f)), false);
        v('4g. simulation : connexions fermées', fermetures.source > 0 && fermetures.cible > 0, true);
        // seuil franchi dès la source : refus (et --executer n'écrit rien non plus)
        const petit = { seuilOctets: 1000 };
        const s = await lancer(EXE, ENV, deps(petit));
        v('4h. simulation dont le total source dépasse le seuil : code 1', [s.r, /480|seuil|dépass/i.test(s.texte)], [1, true]);
        const x = await lancer([...EXE, '--executer'], ENV, deps(petit));
        v('4i. --executer avec un total source au-dessus du seuil : code 1 et RIEN d\'écrit', [x.r, await noms(dbC)], [1, []]);
        // une collection absente de la source : refus nommé
        await dbS.collection('guide_prix_meta').rename('guide_prix_meta_x');
        const m = await lancer(EXE);
        await dbS.collection('guide_prix_meta_x').rename('guide_prix_meta');
        v('4j. une collection autorisée absente de la source : REFUS nommé', [m.r, /guide_prix_meta/.test(m.texte)], [1, true]);
    }

    // ══ 5. la cible : vide, ou reprenable, ou refus
    {
        await dbC.collection('autre').insertOne({ a: 1 });
        const a = await lancer([...EXE, '--executer']);
        v('5a. cible avec une collection étrangère et sans état : REFUS, rien d\'écrit', [a.r, await noms(dbC)], [1, ['autre']]);
        await dbC.collection('autre').drop();
        await dbC.collection('guide_prix').insertOne({ idProduct: 1 });
        const b = await lancer([...EXE, '--executer']);
        v('5b. cible avec une collection AUTORISÉE déjà remplie, sans état : REFUS, 1 document inchangé', [b.r, await compte(dbC, 'guide_prix'), (await noms(dbC)).length], [1, 1, 1]);
        const c = await lancer([...EXE, '--executer', '--reprendre']);
        v('5c. --reprendre sans état de copie : REFUS (rien de reprenable)', [c.r, /état|reprendre/i.test(c.texte)], [1, true]);
        await viderCible();
        const d = await lancer([...EXE, '--executer', '--reprendre']);
        v('5d. --reprendre sur une cible vide : REFUS (rien à reprendre)', [d.r, await noms(dbC)], [1, []]);
    }

    // ══ 6. l'exécution juste
    {
        const jr = [];
        const { r, texte } = await lancer([...EXE, '--executer'], ENV, deps({ journal: l => jr.push(l), tailleLot: 4 }));
        v('6a. exécution : code 0', r, 0);
        for (const n of COLS) v(`6b. compte source = compte cible pour « ${n} »`, [await compte(dbS, n), await compte(dbC, n)], [nb[n], nb[n]]);
        for (const n of ['references_image', 'numeros_cartes', 'codes_set', 'guide_prix_meta'])
            v(`6c. documents IDENTIQUES (_id compris) pour « ${n} »`, tri(await dbC.collection(n).find({}).toArray()), tri(await dbS.collection(n).find({}).toArray()));
        const nc = await noms(dbC);
        v('6d. la cible porte les sept collections et l\'état, rien d\'autre (aucun leurre)', nc, [...COLS, A.ETAT].sort());
        const idx = async (db, n) => (await db.collection(n).indexes()).map(i => ({ name: i.name, key: i.key, unique: !!i.unique })).sort((p, q) => p.name < q.name ? -1 : 1);
        for (const n of ['references_image', 'numeros_cartes', 'guide_prix', 'catalogue_produits'])
            v(`6e. index à l'identique pour « ${n} » (nom, clé, unicité)`, await idx(dbC, n), await idx(dbS, n));
        v('6f. le journal : une ligne par collection, avec compte source et compte cible', jr.map(l => [l.collection, l.source, l.cible]).sort(), COLS.map(n => [n, nb[n], nb[n]]).sort());
        v('6g. aucune ligne du journal ni sortie ne contient un fragment d\'URI', FRAGMENTS_SECRETS.some(f => JSON.stringify(jr).includes(f) || texte.includes(f)), false);
        v('6h. le bilan imprime le poids total contre 480 Mo', [/Mo/.test(texte), /480/.test(texte)], [true, true]);
        v('6i. l\'état dit « terminée »', (await dbC.collection(A.ETAT).findOne({ _id: 'amorcage' })).termine, true);
        // relance sur une copie terminée
        const r2 = await lancer([...EXE, '--executer']);
        v('6j. relancer SANS --reprendre sur une copie terminée : REFUS, rien ne change', [r2.r, await compte(dbC, 'references_image')], [1, nb.references_image]);
        const r3 = await lancer([...EXE, '--executer', '--reprendre']);
        v('6k. --reprendre sur une copie terminée : code 0, aucun doublon (comptes inchangés)', [r3.r, ...(await Promise.all(COLS.map(n => compte(dbC, n))))], [0, ...COLS.map(n => nb[n])]);
        // un document étranger dans la cible déjà copiée : la reprise refuse
        await dbC.collection('credits').insertOne({ x: 1 });
        const r4 = await lancer([...EXE, '--executer', '--reprendre']);
        v('6l. --reprendre avec une collection étrangère dans la cible : REFUS', [r4.r, /credits/.test(r4.texte)], [1, true]);
        await dbC.collection('credits').drop();
    }

    // ══ 7. la reprise après un arrêt au milieu : sans doublon
    {
        await viderCible();
        let lots = 0;
        const coupure = async ({ collection }) => { if (collection === 'numeros_cartes' && ++lots === 3) throw new Error('coupure fabriquée'); };
        const a = await lancer([...EXE, '--executer'], ENV, deps({ tailleLot: 5, apresLot: coupure }));
        const partiel = await compte(dbC, 'numeros_cartes');
        v('7a. arrêt au milieu : code 1, copie PARTIELLE (15 sur 31), état non terminé', [a.r, partiel, (await dbC.collection(A.ETAT).findOne({ _id: 'amorcage' })).termine], [1, 15, false]);
        v('7b. l\'arrêt dit comment reprendre (--reprendre) sans afficher d\'URI', [/--reprendre/.test(a.texte), FRAGMENTS_SECRETS.some(f => a.texte.includes(f))], [true, false]);
        const b = await lancer([...EXE, '--executer'], ENV, deps({ tailleLot: 5 }));
        v('7c. relancer sans --reprendre sur une copie interrompue : REFUS, rien ne bouge', [b.r, await compte(dbC, 'numeros_cartes')], [1, 15]);
        const c = await lancer([...EXE, '--executer', '--reprendre'], ENV, deps({ tailleLot: 5 }));
        v('7d. --reprendre : code 0', c.r, 0);
        for (const n of COLS) v(`7e. après reprise, compte source = compte cible pour « ${n} » (aucun doublon, aucun trou)`, [await compte(dbS, n), await compte(dbC, n)], [nb[n], nb[n]]);
        v('7f. après reprise, documents identiques (numeros_cartes)', tri(await dbC.collection('numeros_cartes').find({}).toArray()), tri(await dbS.collection('numeros_cartes').find({}).toArray()));
        v('7g. la reprise dit ce qu\'elle a sauté (collections déjà faites) et ce qu\'elle a repris', [/reprise|reprend|repris/i.test(c.texte)], [true]);
    }

    // ══ 8. l'ARRÊT avant le seuil (poids de la cible mesuré, seuil injecté)
    {
        await viderCible();
        const mesures = [];
        const total = (await Promise.all(COLS.map(async n => { const s = await dbS.command({ collStats: n }); return s.size + s.totalIndexSize; }))).reduce((a, b) => a + b, 0);
        const seuil = Math.ceil(total * 1.5);
        // une cible qui porte DÉJÀ l'équivalent du total source en plus de ce qu'on y copie (une base de test déjà chargée) : le plan (source seule) passe sous le seuil, la copie le franchirait avant la fin
        const poidsCible = async db => { const p = total + await poidsReel(db); mesures.push(p); return p; };
        v('8-pré. précondition : le total source tient sous le seuil, deux fois ne tiendrait pas', [total < seuil, 2 * total > seuil], [true, true]);
        const { r, texte } = await lancer([...EXE, '--executer'], ENV, deps({ seuilOctets: seuil, poidsCible, tailleLot: 3 }));
        const partiel = (await Promise.all(COLS.map(n => compte(dbC, n)))).reduce((a, b) => a + b, 0), complet = Object.values(nb).reduce((a, b) => a + b, 0);
        v('8a. arrêt avant le seuil : code 1, copie incomplète, mention de l\'arrêt dur', [r, partiel > 0 && partiel < complet, /ARRÊT/.test(texte)], [1, true, true]);
        v('8b. AUCUNE mesure de la cible ne dépasse le seuil (on s\'arrête AVANT de le franchir)', [mesures.length > 0, Math.max(...mesures) <= seuil], [true, true]);
        v('8c. l\'état n\'est pas « terminé » et la sortie nomme le seuil', [(await dbC.collection(A.ETAT).findOne({ _id: 'amorcage' })).termine, /ARRÊT DUR avant de franchir/.test(texte)], [false, true]);
    }

    // ══ 9. la source qui bouge pendant la copie : l'égalité finale des comptes le DIT
    {
        await viderCible();
        let fait = false;
        const bouge = async ({ collection }) => { if (!fait && collection === 'codes_set') { fait = true; await dbS.collection('codes_set').insertOne({ _id: 'A000', codeSet: 'tout-premier' }); } };
        const { r, texte } = await lancer([...EXE, '--executer'], ENV, deps({ apresLot: bouge, tailleLot: 3 }));
        v('9a. un document ajouté à la source AVANT le point copié : l\'égalité finale échoue, code 1, collection nommée', [r, /codes_set/.test(texte), /🔴|écart|diff/i.test(texte)], [1, true, true]);
        await dbS.collection('codes_set').deleteOne({ _id: 'A000' });
    }

    await cs.close(); await cc.close(); await bs.arreter(); await bc.arreter();
    H.bilan();
    process.exit(process.exitCode || 0);
})().catch(async e => { console.error('❌', e); process.exit(1); });
