// BANC — D1 (relecture v2) : une recollecte ne REPOSE PAS une ligne `cartes_produits` détachée par la décision « vu » (reste `fiche-contredite-par-la-vue`).
//   node test-lignes-detachees.js        (NODE_PATH = node_modules du dépôt principal ; mongod local en mémoire, BANC_ISOLE ; documents fabriqués)
// Le reste interdit une LIGNE (carte|produit), pas un produit : le même produit joint à une AUTRE carte n'est jamais refusé (la phase 3 lui en refera une juste).
const fs = require('fs');
const path = require('path');
const LD = require('./collecte-cartes/lignes-detachees');
const { ouvrirBanc } = require('./collecte-cartes/base-banc');
const { joindre } = require('./collecte-cartes/jointure');

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`  ✅ ${nom}`); } else { ko++; console.log(`  ❌ ${nom}\n     obtenu  ${a}\n     attendu ${b}`); }
};
const leve = async (f, motif) => { try { await f(); return 'ne lève pas'; } catch (e) { return motif.test(e.message) ? 'lève' : `lève autre chose : ${e.message}`; } };
const RESTE = (carteId, idProduct, o = {}) => ({ type: LD.TYPE_RESTE, set: 'Set-A', carteId, idProduct, detail: 'x', ...o });

(async () => {
    console.log('1. pur : lire les restes, filtrer des lignes, reconnaître ce qu\'une écriture CRÉERAIT');
    const I = LD.interditsDe([RESTE(1, 11), { type: 'produit-sans-carte', idProduct: 12 }, RESTE(2, 13), { type: LD.TYPE_RESTE, idProduct: 14 }]);
    verifier('interditsDe : seulement le type « fiche-contredite-par-la-vue » AVEC carte ET produit', [...I].sort(), ['1|11', '2|13']);
    const f = LD.filtrerLignes([{ _id: '1|11', carteId: 1, idProduct: 11 }, { _id: '3|11', carteId: 3, idProduct: 11 }, { _id: '1|12', carteId: 1, idProduct: 12 }], I);
    verifier('filtrerLignes : la ligne 1|11 est refusée ; le MÊME produit 11 vers une AUTRE carte (3|11) et un autre produit passent', [f.gardees.map(l => l._id), f.refusees.map(l => l._id)], [['3|11', '1|12'], ['1|11']]);
    const cree = (m, a) => LD.idsCreesPar(m, a);
    verifier('updateOne upsert, filtre _id : la ligne créée', cree('updateOne', [{ _id: '1|11' }, { $setOnInsert: { a: 1 } }, { upsert: true }]), ['1|11']);
    verifier('updateOne SANS upsert : ne crée rien (un numéro de fiche posé sur une ligne existante est permis)', cree('updateOne', [{ _id: '1|11' }, { $set: { numeroFiche: '3' } }]), []);
    verifier('updateOne upsert, filtre carteId + idProduct : l\'id est reconstruit', cree('updateOne', [{ carteId: 1, idProduct: 11, numeroFiche: null }, { $set: { a: 1 } }, { upsert: true }]), ['1|11']);
    verifier('updateOne upsert dont l\'id ne se détermine pas : null (« je ne sais pas » — jamais « rien »)', cree('updateOne', [{ idProduct: 11 }, { $set: { a: 1 } }, { upsert: true }]), null);
    verifier('replaceOne upsert : l\'_id du remplacement', cree('replaceOne', [{ _id: '1|11' }, { _id: '1|11', a: 1 }, { upsert: true }]), ['1|11']);
    verifier('insertOne / insertMany : les _id', [cree('insertOne', [{ _id: '1|11' }]), cree('insertMany', [[{ _id: '1|11' }, { _id: '1|12' }]])], [['1|11'], ['1|11', '1|12']]);
    verifier('bulkWrite : seulement ce qui crée (insertOne, replaceOne/updateOne upsert)', cree('bulkWrite', [[{ updateOne: { filter: { _id: '1|11' }, update: { $set: { a: 1 } } } }, { updateOne: { filter: { _id: '1|12' }, update: { $setOnInsert: { a: 1 } }, upsert: true } }, { insertOne: { document: { _id: '1|13' } } }, { replaceOne: { filter: { _id: '1|14' }, replacement: { _id: '1|14' }, upsert: true } }, { deleteOne: { filter: { _id: '1|15' } } }]]), ['1|12', '1|13', '1|14']);
    verifier('findOneAndUpdate upsert : comme updateOne', cree('findOneAndUpdate', [{ _id: '1|11' }, { $set: { a: 1 } }, { upsert: true }]), ['1|11']);
    verifier('verifierEcriture : une ligne interdite créée LÈVE, en nommant la ligne et le reste', await leve(() => LD.verifierEcriture('updateOne', [{ _id: '1|11' }, { $setOnInsert: {} }, { upsert: true }], I), /1\|11.*fiche-contredite-par-la-vue/s), 'lève');
    verifier('verifierEcriture : la même ligne SANS upsert passe (rien n\'est créé)', await leve(() => LD.verifierEcriture('updateOne', [{ _id: '1|11' }, { $set: { numeroFiche: '3' } }], I), /./), 'ne lève pas');
    verifier('verifierEcriture : le même produit vers une AUTRE carte passe', await leve(() => LD.verifierEcriture('updateOne', [{ _id: '3|11' }, { $setOnInsert: {} }, { upsert: true }], I), /./), 'ne lève pas');
    verifier('verifierEcriture : une création dont l\'id est indéterminable LÈVE (fail-closed)', await leve(() => LD.verifierEcriture('updateOne', [{ idProduct: 11 }, { $set: {} }, { upsert: true }], I), /indéterminable|ne sait pas/i), 'lève');
    verifier('verifierEcriture : une méthode inconnue de la liste fermée n\'est pas jugée (pas de création possible)', await leve(() => LD.verifierEcriture('countDocuments', [{}], I), /./), 'ne lève pas');

    console.log('2. le MÊME produit, la même carte, sous la voie de joindre() : la ligne interdite n\'est pas proposée');
    const E = 'Set A';
    const carte = (id, nomEn, numero) => ({ _id: id, nomEn, attaques: [], impressions: [{ tirage: 'intl', expansion: E, numero }], liens: { idProduct: [], idMetacards: [] } });
    const produit = (idProduct, nom, numero) => ({ idProduct, name: nom, nom, attaques: [], numero, idMetacard: 5, idExpansion: 100, slug: `${nom}-V${idProduct}`, slugSet: 'Set-A' });
    const cible = (extra = {}) => ({ idExpansion: 100, expansionBulba: E, tirage: 'intl', slugSet: 'Set-A', ...extra });
    const cartes = [carte(1, 'Duo', '001')], produits = [produit(10, 'Duo', '001'), produit(11, 'Duo', '001')];
    const J0 = joindre(cartes, produits, cible());
    verifier('SANS interdit : les deux produits sont joints à la carte 1 (le défaut que la recollecte referait)', J0.lignes.map(l => l._id).sort(), ['1|10', '1|11']);
    const J1 = joindre(cartes, produits, cible({ lignesInterdites: new Set(['1|11']) }));
    verifier('AVEC « 1|11 » interdit : seule 1|10 est posée', J1.lignes.map(l => l._id), ['1|10']);
    verifier('… et le produit 11 devient un reste « produit-sans-carte » qui le DIT (le trou est nommé)', J1.restes.filter(r => r.idProduct === 11).map(r => [r.type, /interdite/.test(r.detail)]), [['produit-sans-carte', true]]);
    const cartes2 = [carte(1, 'Duo', '001'), carte(2, 'Duo', '001')];
    const J2 = joindre(cartes2, [produit(11, 'Duo', '001')], cible({ lignesInterdites: new Set(['1|11']) }));
    verifier('le produit 11 interdit vers la carte 1 reste libre vers la carte 2 quand la jointure la prouve (une AUTRE carte n\'est pas refusée)', J2.lignes.map(l => l._id).sort(), ['2|11']);
    verifier('un `lignesInterdites` qui n\'est pas un Set : lève (jamais ignoré en silence)', await leve(() => joindre(cartes, produits, cible({ lignesInterdites: ['1|11'] })), /lignesInterdites/), 'lève');

    console.log('3. mongod local : la garde du point d\'écriture (collection cartes_produits)');
    const banc = await ouvrirBanc();
    const { MongoClient } = require('mongodb');
    const client = new MongoClient(banc.uri);
    const mongoose = require('mongoose');
    let conn, conn2;
    try {
        await client.connect();
        const db = client.db('banc_lignes_detachees');
        await db.collection('restes').insertMany([RESTE(1, 11), { type: 'produit-sans-carte', set: 'Set-A', idProduct: 12 }]);
        const lire = () => LD.lireInterdits(db.collection('restes'));
        verifier('lireInterdits (collection native) : « 1|11 »', [...await lire()], ['1|11']);
        const g = LD.garderCollectionLignes(db.collection('cartes_produits'), lire);
        verifier('updateOne upsert de la ligne interdite : REFUSÉ', await leve(() => g.updateOne({ _id: '1|11' }, { $setOnInsert: { carteId: 1, idProduct: 11 } }, { upsert: true }), /1\|11/), 'lève');
        verifier('… et rien n\'a été écrit', await db.collection('cartes_produits').countDocuments({}), 0);
        verifier('bulkWrite dont UNE ligne est interdite : refusé en entier, y compris la ligne permise (un lot ne s\'écrit pas à moitié)', await leve(() => g.bulkWrite([{ updateOne: { filter: { _id: '1|12' }, update: { $setOnInsert: { carteId: 1, idProduct: 12 } }, upsert: true } }, { updateOne: { filter: { _id: '1|11' }, update: { $setOnInsert: { carteId: 1, idProduct: 11 } }, upsert: true } }]), /1\|11/), 'lève');
        verifier('… et rien n\'a été écrit (ni 1|12)', await db.collection('cartes_produits').countDocuments({}), 0);
        verifier('insertOne de la ligne interdite : refusé', await leve(() => g.insertOne({ _id: '1|11', carteId: 1, idProduct: 11 }), /1\|11/), 'lève');
        await g.updateOne({ _id: '3|11' }, { $setOnInsert: { carteId: 3, idProduct: 11 } }, { upsert: true });
        await g.bulkWrite([{ updateOne: { filter: { _id: '1|12' }, update: { $setOnInsert: { carteId: 1, idProduct: 12 } }, upsert: true } }]);
        verifier('le même produit 11 vers la carte 3, et un autre produit vers la carte 1 : posés', (await db.collection('cartes_produits').find({}).sort({ _id: 1 }).toArray()).map(l => l._id), ['1|12', '3|11']);
        await db.collection('cartes_produits').insertOne({ _id: '1|11', carteId: 1, idProduct: 11, numeroFiche: null });   // une ligne qui existerait déjà (écrite hors garde) : sa MISE À JOUR reste permise
        verifier('une mise à jour sans upsert (numéro de fiche) sur la ligne interdite PASSE : seule la CRÉATION est refusée', (await g.updateOne({ _id: '1|11' }, { $set: { numeroFiche: '9' } })).modifiedCount, 1);
        await db.collection('cartes_produits').deleteOne({ _id: '1|11' });
        verifier('lecture : find / countDocuments passent par la garde sans être touchées', [await g.countDocuments({}), (await g.find({}).toArray()).length], [2, 2]);
        verifier('si les restes ne se lisent pas : la création est REFUSÉE (« je ne sais pas » bloque)', await leve(() => LD.garderCollectionLignes(db.collection('cartes_produits'), async () => { throw new Error('panne de lecture'); }).updateOne({ _id: '9|9' }, { $setOnInsert: {} }, { upsert: true }), /lire les restes|panne de lecture|ne peux pas conclure/), 'lève');
        process.env.LIGNES_DETACHEES_RETABLIR = 'x';
        verifier('LIGNES_DETACHEES_RETABLIR trop courte (moins de 20 caractères) : la garde reste fermée', await leve(() => g.updateOne({ _id: '1|11' }, { $setOnInsert: { carteId: 1, idProduct: 11 } }, { upsert: true }), /1\|11/), 'lève');
        process.env.LIGNES_DETACHEES_RETABLIR = 'restauration du lot D depuis la sauvegarde (2026-10-24)';
        await g.updateOne({ _id: '1|11' }, { $setOnInsert: { carteId: 1, idProduct: 11 } }, { upsert: true });
        verifier('avec une PHRASE (≥ 20 caractères : la restauration d\'un lot) la ligne se rétablit, et c\'est dit', await db.collection('cartes_produits').countDocuments({ _id: '1|11' }), 1);
        delete process.env.LIGNES_DETACHEES_RETABLIR;
        await db.collection('cartes_produits').deleteMany({});

        console.log('3 bis. les poser-* qui écrivent en BOUCLE (une ligne après l\'autre) refusent AVANT la première écriture — jamais à moitié');
        const PL = require('./poser-lignes-ciblees');
        const plan1 = PL.planifier({ cartes: [carte(1, 'Duo', '001')], produits: [produit(10, 'Duo', '001'), produit(11, 'Duo', '001')], optionsJoindre: cible(), existants: new Map(), visees: [10, 11], interdits: new Set(['1|11']) });
        verifier('poser-lignes-ciblees.planifier : le produit visé dont la ligne est détachée est REFUSÉ avec sa raison ; l\'autre est retenu', [plan1.lignes.map(l => l._id), plan1.refus.map(r => [r.idProduct, /détachée|interdite/.test(r.raison)])], [['1|10'], [[11, true]]]);
        const plan2 = PL.planifier({ cartes: [carte(1, 'Duo', '001'), carte(2, 'Duo', '001')], produits: [produit(11, 'Duo', '001')], optionsJoindre: cible({ lignesInterdites: undefined }), existants: new Map(), visees: [11], interdits: new Set(['1|11']) });
        verifier('… le même produit 11 reste refusé là (carte 1, ambiguë avec la carte 2 : joindre() ne choisit pas) mais le refus n\'est PAS dû au reste de la carte 2', plan2.refus.every(r => !/2\|11/.test(r.raison)), true);
        const baseBoucle = client.db('banc_lignes_detachees_boucle');
        await baseBoucle.collection('restes').insertOne(RESTE(1, 11));
        const lignesBoucle = [{ _id: '1|10', carteId: 1, idProduct: 10 }, { _id: '1|11', carteId: 1, idProduct: 11 }, { _id: '1|12', carteId: 1, idProduct: 12 }];
        verifier('ecrireLignes (boucle) : une ligne interdite au milieu → LÈVE', await leve(() => PL.ecrireLignes(baseBoucle, lignesBoucle, new Map()), /1\|11/), 'lève');
        verifier('… et RIEN n\'a été écrit (ni 1|10 avant, ni 1|12 après)', await baseBoucle.collection('cartes_produits').countDocuments({}), 0);
        const PF = require('./poser-fiches-prouvees');
        verifier('ecrireFiches (poser-fiches-prouvees, boucle) : de même', [await leve(() => PF.ecrireFiches(baseBoucle, lignesBoucle, new Map()), /1\|11/), await baseBoucle.collection('cartes_produits').countDocuments({})], ['lève', 0]);
        verifier('preverifierLignes (le contrôle commun des boucles, dont completer-set-partiel) : même refus, avant toute écriture', typeof LD.preverifierLignes === 'function' && await leve(() => LD.preverifierLignes(baseBoucle, lignesBoucle), /1\|11/), 'lève');
        const { appliquerComplement } = require('./collecte-cartes/completer-set-partiel');
        verifier('appliquerComplement (completer-set-partiel, boucle) : de même, rien d\'écrit', [await leve(() => appliquerComplement(baseBoucle, { neuves: lignesBoucle.map(l => ({ ligne: l, carteId: l.carteId, meta: null })) }, 'Set-A', {}, [], new Date()), /1\|11/), await baseBoucle.collection('cartes_produits').countDocuments({})], ['lève', 0]);
        verifier('preverifierLignes : des lignes permises passent', await leve(() => LD.preverifierLignes(baseBoucle, [lignesBoucle[0], lignesBoucle[2]]), /./), 'ne lève pas');

        console.log('4. la voie de la COLLECTE (ecrireJointure, modèles mongoose, joindre() d\'un appelant qui ne connaît pas encore l\'interdit)');
        conn = await mongoose.createConnection(banc.uri, { dbName: 'banc_lignes_detachees_m' }).asPromise();
        const dbM = conn.db;
        await dbM.collection('restes').insertOne(RESTE(1, 11));
        await dbM.collection('cartes').insertOne({ _id: 1, nomEn: 'Duo', sets: ['Set-A'], liens: { idProduct: [], idMetacards: [] } });
        const { modeles } = require('./collecte-cartes/schemas');
        const { ecrireJointure } = require('./collecte-cartes/ecrire-jointure');
        const M = modeles(conn);
        const bilan = await ecrireJointure(M, { slug: 'Set-A', J: J0, produits });
        verifier('ecrireJointure d\'un J qui propose 1|10 ET 1|11 : seule 1|10 est écrite, le bilan DIT 1 ligne refusée', [bilan.lignes, bilan.refusees], [1, 1]);
        verifier('… en base : la ligne 1|11 n\'existe pas, 1|10 oui', (await dbM.collection('cartes_produits').find({}).sort({ _id: 1 }).toArray()).map(l => l._id), ['1|10']);
        verifier('… le lien du produit 11 n\'est pas posé sur la carte (liens.idProduct = [10])', (await dbM.collection('cartes').findOne({ _id: 1 })).liens.idProduct, [10]);
        verifier('… et le reste « fiche-contredite-par-la-vue » SURVIT à la recollecte (la liste des restes remplacés ne le contient pas)', await dbM.collection('restes').countDocuments({ type: LD.TYPE_RESTE, idProduct: 11 }), 1);
        await ecrireJointure(M, { slug: 'Set-A', J: J0, produits });
        verifier('rejouée (2e recollecte) : toujours 1 ligne, toujours 1 reste interdit', [await dbM.collection('cartes_produits').countDocuments({}), await dbM.collection('restes').countDocuments({ type: LD.TYPE_RESTE })], [1, 1]);
        verifier('la ligne du produit 11 vers la carte 2 (une autre carte) passe par ecrireJointure', (await ecrireJointure(M, { slug: 'Set-A', J: { lignes: [{ _id: '2|11', carteId: 2, idProduct: 11, idExpansion: 100, tirage: 'intl', preuve: 'set+numero', slugSet: 'Set-A' }], restes: [] }, produits }), await dbM.collection('cartes_produits').countDocuments({ _id: '2|11' })), 1);

        console.log('5. le FILET : la garde installée sur la connexion (db.collection) couvre aussi les voies qui écrivent par `cx.db.collection(\'cartes_produits\')` ET par les modèles mongoose');
        // comme ouvrirConnexions : la garde est posée sur la connexion AVANT que les modèles ne soient créés (un modèle déjà créé a déjà pris sa collection native)
        conn2 = await mongoose.createConnection(banc.uri, { dbName: 'banc_lignes_detachees_m' }).asPromise();
        const dbM2 = conn2.db;
        LD.installerGardeLignes(dbM2);
        verifier('installerGardeLignes est idempotente', LD.installerGardeLignes(dbM2) === dbM2, true);
        verifier('voie native `cx.db.collection(\'cartes_produits\')` (les poser-*, creer-sets-*) : la ligne interdite est refusée', await leve(() => dbM2.collection('cartes_produits').bulkWrite([{ updateOne: { filter: { _id: '1|11' }, update: { $setOnInsert: { carteId: 1, idProduct: 11 } }, upsert: true } }]), /1\|11/), 'lève');
        const M2 = modeles(conn2);
        verifier('voie mongoose `M.CarteProduit.updateOne(… upsert)` (collecteur-texte.js, bonus intl) : la ligne interdite est refusée', await leve(() => M2.CarteProduit.updateOne({ _id: '1|11' }, { $set: { carteId: 1, idProduct: 11 } }, { upsert: true }), /1\|11/), 'lève');
        verifier('… et une ligne permise passe par la même voie', (await M2.CarteProduit.updateOne({ _id: '1|12' }, { $set: { carteId: 1, idProduct: 12 } }, { upsert: true })).upsertedCount, 1);
    } finally { if (conn2) await conn2.close(); if (conn) await conn.close(); await client.close(); await banc.arreter(); }

    console.log('6. COUVERTURE : tout outil qui CRÉE des lignes passe par une connexion gardée, ou nomme pourquoi non (liste fermée)');
    const garde = fs.readFileSync(path.join(__dirname, 'collecte-cartes', 'garde.js'), 'utf8');
    verifier('collecte-cartes/garde.js (ouvrirConnexions) installe la garde sur la connexion « cartes »', /installerGardeLignes/.test(garde), true);
    const racine = __dirname;
    const fichiers = [...fs.readdirSync(racine).filter(f => f.endsWith('.js') && !f.startsWith('test-')).map(f => path.join(racine, f)), ...fs.readdirSync(path.join(racine, 'collecte-cartes')).filter(f => f.endsWith('.js') && !f.startsWith('test-')).map(f => path.join(racine, 'collecte-cartes', f))];
    const CREE = /(cartes_produits|CarteProduit|\bCP\b)[^\n]{0,160}(bulkWrite|insertMany|insertOne|upsert|\.create\()/;
    const creeurs = fichiers.filter(f => fs.readFileSync(f, 'utf8').split('\n').some(l => CREE.test(l) && !/^\s*(\/\/|\*)/.test(l))).map(f => path.relative(racine, f).replace(/\\/g, '/'));
    // les outils qui créent des lignes SANS ouvrir eux-mêmes la connexion (une fonction reçoit `db`) ou qui ne créent rien dans `cartes_produits`, nommés un à un
    const HORS_CONNEXION = {
        'collecte-cartes/ecrire-jointure.js': 'reçoit les modèles de l\'appelant (collecteur-texte.js, connexion gardée) ET filtre elle-même (filtrerLignes, testé en section 4)',
        'collecte-cartes/completer-set-partiel.js': 'reçoit `db` de l\'appelant (creer-set-partiel.js / completer-*.js)',
        'collecte-cartes/historique-valeur.js': 'écrit dans la collection `historique_valeur` (un nom proche, aucune ligne de jointure)',
        'collecte-cartes/lignes-detachees.js': 'la garde elle-même'
    };
    const sansGarde = creeurs.filter(f => !HORS_CONNEXION[f] && !/ouvrirConnexions|require\(['"]\.\/(collecte-cartes\/)?garde['"]\)/.test(fs.readFileSync(path.join(racine, f), 'utf8')));
    console.log(`     ${creeurs.length} fichiers créent des lignes ; sans connexion gardée : ${sansGarde.length ? sansGarde.join(', ') : 'aucun'}`);
    verifier('aucun outil qui crée des lignes n\'échappe à ouvrirConnexions (donc à la garde) sans être nommé dans la liste fermée', sansGarde, []);
    const retirerSet = fs.readFileSync(path.join(racine, 'retirer-collecte-set.js'), 'utf8');
    verifier('les voies qui SUPPRIMENT des restes en bloc ne purgent pas le reste interdit : retirer-collecte-set.js exclut son type (sinon retirer la collecte d\'un set rendrait ses lignes détachées reposables)', /collection\('restes'\)\.deleteMany\(\{ set: slug, type: \{ \$ne: TYPE_RESTE \} \}\)/.test(retirerSet), true);
    const ecrJ = fs.readFileSync(path.join(racine, 'collecte-cartes', 'ecrire-jointure.js'), 'utf8');
    verifier('ecrire-jointure.js ne remplace pas ce type (la liste des restes remplacés ne le contient pas)', /deleteMany\(\{ set: slug, type: \{ \$in: \[[^\]]*\] \} \}\)/.test(ecrJ) && !/deleteMany\(\{ set: slug, type: \{ \$in: \[[^\]]*fiche-contredite-par-la-vue/.test(ecrJ), true);
    verifier('la liste des créateurs inclut les voies nommées par la relecture (joindre/collecteur-texte, poser-*, creer-sets-*)', ['collecteur-texte.js', 'poser-lignes-ciblees.js', 'poser-cartes-tcgdex.js', 'poser-par-nom-tcgdex.js', 'creer-sets-par-pages-de-cartes.js', 'collecte-cartes/ecrire-jointure.js'].every(f => creeurs.includes(f)), true);
    console.log(`\n${ok} passés, ${ko} en échec`);
    process.exitCode = ko ? 1 : 0;
})().catch(e => { console.error(e); process.exitCode = 1; });
