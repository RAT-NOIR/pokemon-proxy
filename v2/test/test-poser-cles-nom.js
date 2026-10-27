'use strict';
// LOT PERF-SCAN, P1 — l'outil qui POSE les clés de nom et leurs index (v2/migrations/poser-cles-nom.js). Base EN MÉMOIRE (H.ouvrirBac) : la cible de banc s'appelle « rm_essai » sur le mongod du banc (jamais une vraie base).
// Ce que le banc prouve : le refus de toute autre base que rm_essai AVANT une connexion, la simulation qui n'écrit RIEN, la pose qui n'écrit QUE le champ (le reste du document est intact), l'index qui sert,
// l'idempotence, la reprise après interruption, l'arrêt dur, et que le serveur (index-nom.js) trouve ensuite le même ensemble.
const H = require('./_harnais'); const mongoose = require('mongoose');
const M = require('../migrations/poser-cles-nom'); const CN = require('../identifier/cle-nom'); const IN = require('../identifier/index-nom');

const taire = async f => { const l = console.log, e = console.error; console.log = () => { }; console.error = () => { }; try { return await f(); } finally { console.log = l; console.error = e; } };
const sansChamp = (d, ...champs) => { const reste = { ...d }; for (const c of champs) delete reste[c]; return reste; };

const D = async d => { d.disponible(); d.oublier(); await d.controle(); return d.disponible(); };      // tour 2 : le contrôle vit en arrière-plan ; on le FORCE, puis on lit le verdict
(async () => {
    await H.ouvrirBac('test-poser-cles-nom.js');
    const client = mongoose.connection.getClient();

    // ── 1. les arguments : écrits par ce qu'ils AUTORISENT
    const A = M.lireArguments;
    H.v('--base=rm_essai seul : simulation', [A(['--base=rm_essai']).ok, A(['--base=rm_essai']).appliquer], [true, false]);
    H.v('--appliquer, --lot, --pause-ms admis', [A(['--base=rm_essai', '--appliquer', '--lot=100', '--pause-ms=50']).ok, A(['--base=rm_essai', '--lot=100']).lot], [true, 100]);
    for (const refus of [['--base=test'], ['--base=test_scratch'], ['--base=cartes'], [], ['--appliquer'], ['--base=rm_essai', '--executer'], ['--base=rm_essai', '--lot=0'], ['--base=rm_essai', '--lot=999999'], ['--base=rm_essai', '--pause-ms=99999999'], ['--base=rm_essai', 'test'],
        ['--base=rm_essai', '--base=test'], ['--base=test', '--base=rm_essai'], ['--base=rm_essai', '--base=rm_essai'], ['--base=rm_essai', '--appliquer', '--appliquer'], ['--base=rm_essai', '--lot=10', '--lot=20'], ['--base=rm_essai', '--retirer', '--retirer']])
        H.v(`refusé : ${JSON.stringify(refus)}`, A(refus).ok, false);
    H.v('I3 : --retirer admis (simulation par défaut)', [A(['--base=rm_essai', '--retirer']).ok, A(['--base=rm_essai', '--retirer']).retirer, A(['--base=rm_essai', '--retirer']).appliquer], [true, true, false]);
    H.v('I2 : un --base répété est nommé comme tel dans la raison', /répété/.test(A(['--base=test', '--base=rm_essai']).raison), true);
    H.v('…et la production est nommée dans la raison, sans valeur', /production n'est jamais une cible/.test(A(['--base=test']).raison), true);

    // ── 2. sans variables d'environnement : refus AVANT d'ouvrir quoi que ce soit (aucune connexion de repli)
    let ouvertures = 0;
    const code0 = await taire(() => M.principal(['--base=rm_essai'], {}, { ouvrirCible: undefined }));
    H.v('sans MONGODB_ESSAI_URI ni MONGODB_LECTURE_URI : code 1', code0, 1);
    const code1 = await taire(() => M.principal(['--base=rm_essai'], { MONGODB_ESSAI_URI: 'mongodb://h1.mongodb.net/', MONGODB_LECTURE_URI: 'mongodb://h1.mongodb.net/' }, {}));
    H.v('essai et lecture sur la MÊME grappe (celle de la production) : refus avant toute connexion', code1, 1);

    {   // I2 : un argument répété est refusé AVANT toute connexion (ouvrirCible n'est jamais appelée)
        let ouverts = 0;
        for (const a of [['--base=test', '--base=rm_essai'], ['--base=rm_essai', '--base=test'], ['--base=rm_essai', '--appliquer', '--appliquer']]) await taire(() => M.principal(a, {}, { ouvrirCible: async () => { ouverts++; return { ok: false, raison: 'x' }; } }));
        H.v('I2 : --base répété (dans les deux ordres) ou tout autre argument répété : refus, aucune connexion ouverte', ouverts, 0);
    }

    // ── la cible de banc : « rm_essai » sur le mongod du banc, avec un catalogue qui a des cas difficiles
    const base = client.db('rm_essai');
    const cat = base.collection('catalogue_produits'), num = base.collection('numeros_cartes');
    const NOMS = [[1, 'Pikachu [Thunder Jolt]'], [2, 'Pikachu'], [3, 'Dragonite Lv.61 [Wing Attack]'], [4, 'Milotic δ Delta Species'], [5, "Farfetch'd"], [6, 'Mr. Mime [Barrier]'], [7, null], [8, 'Flabébé'], [9, 'Eevee Online Code Card'], [10, '']];
    await cat.insertMany(NOMS.map(([idProduct, name]) => ({ idProduct, name, idExpansion: 7, idMetacard: 700 + idProduct, extra: { a: idProduct } })));
    await num.insertMany([[1, 'Pikachu'], [2, 'Éveil'], [3, null], [4, 'Carabaffe'], [5, 'Flabébé'], [6, '']].map(([idProduct, nomFr]) => ({ idProduct, nomFr, numero: String(idProduct), slug: `s${idProduct}` })));
    const avant = { cat: await cat.find({}).sort({ _id: 1 }).toArray(), num: await num.find({}).sort({ _id: 1 }).toArray(), idxCat: (await cat.indexes()).length, idxNum: (await num.indexes()).length };
    const statutOk = async () => ({ ok: true });
    const profil = { ouvrirCible: async () => ({ ok: true, db: base, fermer: async () => { } }), prouverStatut: statutOk, journal: () => { }, poidsCible: async () => 1e6 };

    // ── 3. une cible qui n'est pas rm_essai : refus (le nom de la base, lu sur la connexion)
    for (const nom of ['test', 'test_scratch', 'cartes']) {
        const autre = client.db(nom);
        const c = await taire(() => M.principal(['--base=rm_essai', '--appliquer'], {}, { ...profil, ouvrirCible: async () => ({ ok: true, db: autre, fermer: async () => { } }) }));
        H.v(`la connexion ouverte est sur « ${nom} » : refus (code 1), rien d'écrit`, [c, (await cat.find({ nomCles: { $exists: true } }).toArray()).length], [1, 0]);
    }
    // ── 4. une cible NON prouvée : refus avant toute lecture
    let lectures = 0;
    const cEspion = new Proxy(base, { get(b, p) { if (p === 'collection') return n => { lectures++; return b.collection(n); }; const v = b[p]; return typeof v === 'function' ? v.bind(b) : v; } });
    for (const pr of [async () => ({ ok: false, raison: 'non prouvé' }), async () => null, async () => { throw new Error('boum'); }, async () => ({ ok: 'oui' })]) {
        const c = await taire(() => M.principal(['--base=rm_essai', '--appliquer'], {}, { ...profil, ouvrirCible: async () => ({ ok: true, db: cEspion, fermer: async () => { } }), prouverStatut: pr }).catch(() => 1));
        H.v('preuve non conclue (faux, null, exception, pas exactement true) : refus', c, 1);
    }
    H.v('…aucune collection n\'a été lue ni écrite', lectures, 0);

    // ── 4 bis. L'ORDRE : la recherche par l'index rend les candidats dans l'ordre des _id ; le balayage d'aujourd'hui, dans l'ORDRE NATUREL de la collection. Les deux ne sont le même ordre que si la collection a été
    //    écrite en _id croissant (l'amorçage de rm_essai le fait). Un ordre différent change le gagnant d'une égalité de score (mesuré : 56 décisions sur 4 506 au rejeu) : l'outil REFUSE une collection dont l'ordre naturel
    //    n'est pas l'ordre des _id, avant toute écriture.
    {
        const { ObjectId } = require('mongodb');
        const ids3 = [new ObjectId('0000000000000000000000b3'), new ObjectId('0000000000000000000000b1'), new ObjectId('0000000000000000000000b2')];
        const mauvaise = base.collection('catalogue_produits_desordre');       // une autre collection : le plan ne la connaît pas, on la prouve par la fonction exportée
        await mauvaise.insertMany(ids3.map((_id, i) => ({ _id, idProduct: i })));
        const bonne = base.collection('catalogue_produits_ordre');
        await bonne.insertMany([...ids3].sort((x, y) => (x.toHexString() < y.toHexString() ? -1 : 1)).map((_id, i) => ({ _id, idProduct: i })));
        const vide = base.collection('catalogue_produits_vide');
        await base.createCollection('catalogue_produits_vide');
        const r1 = await M.verifierOrdreNaturel(mauvaise), r2 = await M.verifierOrdreNaturel(bonne), r3 = await M.verifierOrdreNaturel(vide);
        H.v('ordre naturel ≠ ordre des _id : la fonction le dit, avec le rang du premier écart', [r1.ok, r1.rang], [false, 1]);
        H.v('ordre naturel = ordre des _id : ok ; collection vide : ok', [r2.ok, r3.ok], [true, true]);
        // B2 (tour 1) : l'ordre ne dépend plus de l'ordre naturel (toutes les requêtes trient par _id) : le désordre n'est plus un REFUS, seulement une INFORMATION imprimée
        await base.collection('catalogue_produits').drop(); await base.collection('numeros_cartes').drop();
        const desordre = [new ObjectId('0000000000000000000000c2'), new ObjectId('0000000000000000000000c1')];
        await base.collection('catalogue_produits').insertMany(desordre.map((_id, i) => ({ _id, idProduct: 10 + i, name: `Carte ${i}`, idMetacard: 1 })));
        await base.collection('numeros_cartes').insertMany([{ idProduct: 10, nomFr: 'Carte' }]);
        const sortie = []; const l0 = console.log; console.log = (...a) => sortie.push(a.join(' '));
        let cD; try { cD = await M.principal(['--base=rm_essai', '--appliquer'], {}, profil); } finally { console.log = l0; }
        H.v('B2 : catalogue_produits écrit dans le désordre : la pose n\'est PLUS refusée (code 0), les clés sont posées, et le désordre est dit', [cD, await base.collection('catalogue_produits').countDocuments({ nomCles: { $exists: true } }), sortie.some(l => /information/i.test(l) && /≠|différent|pas l'ordre/.test(l))], [0, 2, true]);
        await base.collection('catalogue_produits').drop(); await base.collection('numeros_cartes').drop();
        for (const n of ['catalogue_produits_desordre', 'catalogue_produits_ordre', 'catalogue_produits_vide']) await base.collection(n).drop();
        // on rétablit le jeu de la suite du banc (écrit en _id croissant par insertMany)
        await cat.insertMany(NOMS.map(([idProduct, name]) => ({ idProduct, name, idExpansion: 7, idMetacard: 700 + idProduct, extra: { a: idProduct } })));
        await num.insertMany([[1, 'Pikachu'], [2, 'Éveil'], [3, null], [4, 'Carabaffe'], [5, 'Flabébé'], [6, '']].map(([idProduct, nomFr]) => ({ idProduct, nomFr, numero: String(idProduct), slug: `s${idProduct}` })));
        avant.cat = await cat.find({}).sort({ _id: 1 }).toArray(); avant.num = await num.find({}).sort({ _id: 1 }).toArray(); avant.idxCat = (await cat.indexes()).length; avant.idxNum = (await num.indexes()).length;
    }

    // ── 4 ter. I3 : un champ du même nom, de FORME ÉTRANGÈRE (un `nomCles` qui n'est pas un tableau de chaînes) : refus avant toute écriture — l'outil n'écrase pas ce qui n'est pas à lui
    {
        await cat.updateOne({ idProduct: 2 }, { $set: { nomCles: 'pas un tableau' } });
        const cF = await taire(() => M.principal(['--base=rm_essai', '--appliquer'], {}, profil));
        H.v('champ nomCles de forme étrangère : refus (code 1), aucune clé posée ailleurs', [cF, await cat.countDocuments({ nomMin: { $exists: true } })], [1, 0]);
        await cat.updateOne({ idProduct: 2 }, { $unset: { nomCles: '' } });
    }
    // ── 4 quater. I4 : l'arrêt dur mesure le plus grand de (données + index) et (stockage + index)
    {
        const fausse = { command: async () => ({ dataSize: 100e6, indexSize: 50e6, storageSize: 400e6 }) };
        const fausse2 = { command: async () => ({ dataSize: 300e6, indexSize: 50e6, storageSize: 200e6 }) };
        H.v('I4 : poids = max(données+index, stockage+index) — le stockage domine ici (450 Mo), les données là (350 Mo)', [await M.poidsCibleParDefaut(fausse), await M.poidsCibleParDefaut(fausse2)], [450e6, 350e6]);
    }

    // ── 5. la SIMULATION n'écrit rien
    let ecritures = 0;
    const espionEcritures = { ...profil, apresLot: async () => { ecritures++; } };
    const cs = await taire(() => M.principal(['--base=rm_essai'], {}, espionEcritures));
    H.v('simulation : code 0, aucun lot écrit, aucun champ, aucun index', [cs, ecritures, (await cat.find({ nomCles: { $exists: true } }).toArray()).length, (await num.find({ nomFrCle: { $exists: true } }).toArray()).length, (await cat.indexes()).length, (await num.indexes()).length], [0, 0, 0, 0, avant.idxCat, avant.idxNum]);

    // ── 6. l'ARRÊT DUR : une cible déjà trop lourde, rien n'est écrit
    const cd = await taire(() => M.principal(['--base=rm_essai', '--appliquer'], {}, { ...profil, seuilOctets: 100 }));
    H.v('poids de la cible + ajout estimé au-delà de l\'arrêt dur : refus, rien d\'écrit', [cd, (await cat.find({ nomCles: { $exists: true } }).toArray()).length], [1, 0]);

    // ── 7. une INTERRUPTION au milieu (lot de 4) puis la reprise
    const journal = [];
    let n = 0;
    const cI = await taire(() => M.principal(['--base=rm_essai', '--appliquer', '--lot=4'], {}, { ...profil, journal: l => journal.push(l), apresLot: async () => { if (++n === 2) throw Object.assign(new Error('coupure'), { code: 'COUPURE' }); } }));
    H.v('interruption après le 2e lot : code 1, journalisée « interrompue », champ posé sur une PARTIE seulement', [cI, journal.some(l => l.etat === 'interrompue'), (await cat.countDocuments({ nomCles: { $exists: true } })) > 0, (await cat.countDocuments({ nomCles: { $exists: false } })) > 0], [1, true, true, true]);
    H.v('…et l\'index n\'est PAS créé sur un champ incomplet', (await cat.indexes()).some(i => i.name === CN.INDEX_CATALOGUE), false);
    const dispoPartielle = IN.creerDisponibilite({ col: cat, champ: CN.CHAMP_CATALOGUE, nomIndex: CN.INDEX_CATALOGUE });
    H.v('…donc le serveur ne l\'utilise pas', await D(dispoPartielle), false);

    // ── 8. la POSE complète (reprise)
    const lots = [];
    const cP = await taire(() => M.principal(['--base=rm_essai', '--appliquer', '--lot=4'], {}, { ...profil, apresLot: async l => lots.push(l) }));
    H.v('pose (reprise) : code 0', cP, 0);
    const apres = { cat: await cat.find({}).sort({ _id: 1 }).toArray(), num: await num.find({}).sort({ _id: 1 }).toArray() };
    H.v('catalogue : chaque produit porte SES clés (fonction de cle-nom.js), même les noms absents ou vides', apres.cat.map(d => d.nomCles), NOMS.map(([, name]) => CN.clesDuProduit(name)));
    H.v('catalogue : le nom en minuscules sur chaque produit (« » sans nom)', apres.cat.map(d => d.nomMin), NOMS.map(([, name]) => CN.cleNomMin(name)));
    H.v('numeros_cartes : chaque ligne porte SA clé (« » sans nom français)', apres.num.map(d => d.nomFrCle), ['pikachu', 'eveil', '', 'carabaffe', 'flabebe', '']);
    H.v('B1 : les témoins de la source, écrits dans le même $set que les clés (« » sans nom)', [apres.cat.map(d => d.nomSrc), apres.num.map(d => d.nomFrSrc)], [NOMS.map(([, name]) => CN.sourceDe(name)), ['Pikachu', 'Éveil', '', 'Carabaffe', 'Flabébé', '']]);
    H.v('RIEN d\'autre n\'a bougé : tous les autres champs de chaque document, à l\'identique', JSON.stringify([apres.cat.map(d => sansChamp(d, 'nomCles', 'nomMin', 'nomSrc')), apres.num.map(d => sansChamp(d, 'nomFrCle', 'nomFrSrc'))]) === JSON.stringify([avant.cat, avant.num]), true);
    H.v('aucun document créé ni supprimé', [apres.cat.length, apres.num.length], [avant.cat.length, avant.num.length]);
    H.v('les trois index existent', [(await cat.indexes()).some(i => i.name === CN.INDEX_CATALOGUE), (await cat.indexes()).some(i => i.name === CN.INDEX_NOM_MIN), (await num.indexes()).some(i => i.name === CN.INDEX_FR)], [true, true, true]);
    const plan = async (col, f) => JSON.stringify((await col.find(f).explain('queryPlanner')).queryPlanner.winningPlan);
    H.v('…et ils servent (IXSCAN, pas de COLLSCAN)', [(await plan(cat, { nomCles: { $in: ['pikachu'] } })).includes('IXSCAN'), (await plan(num, { nomFrCle: 'eveil' })).includes('IXSCAN')], [true, true]);

    // ── 9. l'IDEMPOTENCE : une relance ne réécrit rien
    lots.length = 0;
    const cR = await taire(() => M.principal(['--base=rm_essai', '--appliquer'], {}, { ...profil, apresLot: async l => lots.push(l) }));
    H.v('relance : code 0 et AUCUN lot écrit (rien à poser)', [cR, lots.length], [0, 0]);

    // ── 10. le serveur trouve ensuite le même ensemble que la requête d'avant
    const srcCat = { champ: 'name', temoin: CN.CHAMP_SOURCE_CATALOGUE }, srcFr = { champ: 'nomFr', temoin: CN.CHAMP_SOURCE_FR };
    const dCat = IN.creerDisponibilite({ col: cat, champ: CN.CHAMP_CATALOGUE, nomIndex: CN.INDEX_CATALOGUE, source: srcCat }), dFr = IN.creerDisponibilite({ col: num, champ: CN.CHAMP_FR, nomIndex: CN.INDEX_FR, source: srcFr });
    H.v('après la pose, index-nom.js juge les deux index disponibles', [await D(dCat), await D(dFr)], [true, true]);
    const rx = /pikachu/i;
    const viaIndex = await IN.preselection({ col: cat, dispo: dCat, cles: ['pikachu'], regexPremierMot: rx });
    const viaRegex = (await cat.find({ name: rx }).sort({ _id: 1 }).toArray()).filter(d => CN.clesDuProduit(d.name).includes('pikachu'));
    H.v('présélection « pikachu » : les mêmes produits que la regex d\'avant (au filtre de clé près)', viaIndex.map(d => d.idProduct), viaRegex.map(d => d.idProduct));

    // ── 11. un produit AJOUTÉ après la pose (import quotidien) : la relance le rattrape, et seulement lui
    await cat.insertOne({ idProduct: 11, name: 'Pikachu VMAX', idExpansion: 7, idMetacard: 711 });
    lots.length = 0;
    const cN = await taire(() => M.principal(['--base=rm_essai', '--appliquer'], {}, { ...profil, apresLot: async l => lots.push(l) }));
    H.v('produit ajouté sans clé : la relance pose ses clés (un seul lot d\'un document : clés et témoin ensemble)', [cN, lots.map(l => l.lot), (await cat.findOne({ idProduct: 11 })).nomCles, (await cat.findOne({ idProduct: 11 })).nomMin, (await cat.findOne({ idProduct: 11 })).nomSrc], [0, [1], ['pikachuvmax'], 'pikachu vmax', 'Pikachu VMAX']);

    // ── 12. B1 : un produit RENOMMÉ par l'import (`$set name`, les clés restent) : le serveur refuse l'index, la simulation le COMPTE, la relance le rattrape
    {
        await cat.updateOne({ idProduct: 2 }, { $set: { name: 'Pikachu ex' } });
        dCat.oublier();
        H.v('B1 : après le renommage (clés anciennes, témoin ancien) : index indisponible côté serveur', await D(dCat), false);
        lots.length = 0;
        const simul = []; const l0 = console.log; console.log = (...a) => simul.push(a.join(' '));
        try { await M.principal(['--base=rm_essai'], {}, { ...profil, apresLot: async l => lots.push(l) }); } finally { console.log = l0; }
        H.v('B1 : la simulation compte UN produit à poser (le renommé) et n\'écrit rien', [lots.length, simul.some(l => /catalogue_produits.*à poser\s+1\b/.test(l))], [0, true]);
        const cRen = await taire(() => M.principal(['--base=rm_essai', '--appliquer'], {}, { ...profil, apresLot: async l => lots.push(l) }));
        const d2 = await cat.findOne({ idProduct: 2 });
        dCat.oublier();
        H.v('B1 : la relance réécrit ses clés ET son témoin ; l\'index redevient disponible', [cRen, lots.map(l => l.lot), d2.nomCles, d2.nomMin, d2.nomSrc, await D(dCat)], [0, [1], ['pikachuex'], 'pikachu ex', 'Pikachu ex', true]);
    }

    // ── 13. I3 : --retirer — simulation par défaut ; --appliquer retire les champs que l'outil pose et son index, sur rm_essai seulement ; rien d'autre ne bouge
    {
        const avantRet = { cat: await cat.find({}).sort({ _id: 1 }).toArray(), num: await num.find({}).sort({ _id: 1 }).toArray() };
        const champsPoses = ['nomCles', 'nomMin', 'nomSrc'];
        const cSim = await taire(() => M.principal(['--base=rm_essai', '--retirer'], {}, profil));
        H.v('I3 : --retirer sans --appliquer : simulation (code 0), rien n\'est retiré', [cSim, (await cat.countDocuments({ nomCles: { $exists: true } })) > 0, (await cat.indexes()).some(i => i.name === CN.INDEX_CATALOGUE)], [0, true, true]);
        const cAutre = await taire(() => M.principal(['--base=test', '--retirer', '--appliquer'], {}, profil));
        H.v('I3 : --retirer sur une autre base que rm_essai : refus avant toute connexion', cAutre, 1);
        const cRet = await taire(() => M.principal(['--base=rm_essai', '--retirer', '--appliquer'], {}, profil));
        const aprRet = { cat: await cat.find({}).sort({ _id: 1 }).toArray(), num: await num.find({}).sort({ _id: 1 }).toArray() };
        H.v('I3 : --retirer --appliquer : code 0, les champs de l\'outil ont disparu de TOUS les documents', [cRet, aprRet.cat.some(d => champsPoses.some(c => c in d)), aprRet.num.some(d => ['nomFrCle', 'nomFrSrc'].some(c => c in d))], [0, false, false]);
        H.v('I3 : …les trois index sont retirés, les index d\'avant (_id) restent', [(await cat.indexes()).map(i => i.name).sort(), (await num.indexes()).map(i => i.name).sort()], [['_id_'], ['_id_']]);
        H.v('I3 : …et RIEN d\'autre n\'a bougé : les autres champs sont identiques à ceux d\'avant le retrait', JSON.stringify([aprRet.cat, aprRet.num]) === JSON.stringify([avantRet.cat.map(d => sansChamp(d, ...champsPoses)), avantRet.num.map(d => sansChamp(d, 'nomFrCle', 'nomFrSrc'))]), true);
        const cRep = await taire(() => M.principal(['--base=rm_essai', '--appliquer'], {}, profil));
        H.v('I3 : on peut reposer ensuite (le retrait est réversible)', [cRep, await cat.countDocuments({ nomSrc: { $exists: true } })], [0, (await cat.countDocuments({}))]);
    }
    await H.fermerBac(); H.bilan();
})().catch(async e => { console.error('❌', e); try { await H.fermerBac(); } catch { } process.exit(1); });
