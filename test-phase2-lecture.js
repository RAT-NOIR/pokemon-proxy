// BANC — la relecture de la PHASE 2 (collecte-cartes/phase2-lecture.js) : le défaut de l'écriture réelle du lot A (24/10/2026) était
// « MongoNotConnectedError: Client must be connected before running operations » — `imagesRetirees` lisait avec un client déjà fermé.
//   node test-phase2-lecture.js          (NODE_PATH = node_modules du dépôt principal ; mongod local en mémoire, BANC_ISOLE ; aucune base distante)
const { ouvrirBanc } = require('./collecte-cartes/base-banc');
const { lireEtat } = require('./collecte-cartes/phase2-lecture');

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`  ✅ ${nom}`); } else { ko++; console.log(`  ❌ ${nom}\n     obtenu  ${a}\n     attendu ${b}`); }
};

(async () => {
    const banc = await ouvrirBanc();
    const { MongoClient } = require('mongodb');
    const client = new MongoClient(banc.uri);
    try {
        await client.connect();
        const db = client.db('banc_phase2_lecture');
        await db.collection('sets').insertMany([{ _id: 'Set-A', idExpansion: 1 }]);
        await db.collection('cartes').insertMany([{ _id: 1, nomEn: 'A', sets: ['Set-A'], images: [{ set: 'Set-A', cleR2: 'g/a.webp' }] }]);
        await db.collection('cartes_produits').insertMany([{ _id: '1|10', carteId: 1, idProduct: 10, idExpansion: 1 }]);
        await db.collection('images').insertMany([{ _id: 'i1', cleR2: 'g/a.webp', etat: 'retire' }, { _id: 'i2', cleR2: 'g/b.webp', etat: 'ok' }]);
        const o = { uri: banc.uri, dbName: 'banc_phase2_lecture', projectionsCartes: { nomEn: 1, sets: 1, images: 1 }, projectionsLignes: { carteId: 1, idProduct: 1, idExpansion: 1 } };
        console.log('lecture de l\'état puis relecture des documents images, APRÈS la fermeture du client de lecture');
        const e = await lireEtat({ ...o, clesImages: ['g/a.webp', 'g/b.webp', 'g/zzz.webp'] });
        verifier('l\'état est lu (1 set, 1 carte, 1 ligne)', [e.sets.length, e.cartes.length, e.cartesProduits.length], [1, 1, 1]);
        const docs = await e.imagesRetirees(['g/a.webp']).then(d => d.map(x => [x.cleR2, x.etat]), x => `ÉCHEC : ${x.message}`);
        verifier('imagesRetirees lit avec une connexion OUVERTE (le défaut du lot A : client fermé)', docs, [['g/a.webp', 'retire']]);
        verifier('… et rend l\'état « ok » d\'une clé non retirée', (await e.imagesRetirees(['g/b.webp'])).map(x => x.etat), ['ok']);
        verifier('… et rien pour une clé absente de la base (un vide n\'est pas deviné)', (await e.imagesRetirees(['g/zzz.webp'])).length, 0);
        const sans = await lireEtat({ ...o }).then(x => x.imagesRetirees(['g/a.webp']).then(() => 'rendu', er => er.message), er => er.message);
        verifier('une clé qu\'on n\'a pas annoncée à la lecture : refus NOMMÉ (jamais une erreur de pilote)', /annoncée|clesImages/.test(sans), true);
        // L1 : la marque de lot du lot B (`images[].imageEmprunteeLot`) n'est PAS dans la projection de l'API (ni du site) : sans elle la relecture d'un `--annuler` (ou d'un lot B) ne peut pas la voir
        await db.collection('cartes').insertOne({ _id: 2, nomEn: 'B', sets: ['Set-A'], images: [{ set: 'Set-A', numero: '5', cleR2: 'g/m.webp', imageEmprunteeTirage: true, imageEmprunteeLot: 'phase2-2026-10-24' }] });
        await db.collection('cartes_produits').insertOne({ _id: '2|20', carteId: 2, idProduct: 20, idExpansion: 1 });
        const projApi = { nomEn: 1, sets: 1, 'images.set': 1, 'images.cleR2': 1, 'images.numero': 1, 'images.imageEmprunteeTirage': 1 };   // la forme de l'union API + site : sans la marque
        const e2 = await lireEtat({ ...o, projectionsCartes: projApi });
        const m = e2.cartes.find(c => c._id === 2).images[0];
        verifier('L1 : la relecture lit la marque de lot, même quand la projection de l\'API ne la contient pas', [m.imageEmprunteeTirage, m.imageEmprunteeLot], [true, 'phase2-2026-10-24']);
        verifier('… et elle ne rend PAS d\'autre champ que ceux de la projection + la marque (le reste de l\'entrée n\'est pas lu)', Object.keys(m).sort(), ['cleR2', 'imageEmprunteeLot', 'imageEmprunteeTirage', 'numero', 'set']);
        const E = require('./collecte-cartes/phase2-lecture');
        verifier('avecMarqueDeLot : une projection qui porte déjà « images » entier n\'est pas touchée (Mongo refuse un chemin et son parent)', [E.avecMarqueDeLot({ images: 1, nomEn: 1 }), E.avecMarqueDeLot({ 'images.set': 1 })], [{ images: 1, nomEn: 1 }, { 'images.set': 1, 'images.imageEmprunteeLot': 1 }]);
        verifier('une base sans cartes : lève (base fausse)', await lireEtat({ ...o, dbName: 'banc_vide' }).then(() => 'ne lève pas', er => /VIDE/.test(er.message) ? 'lève' : er.message), 'lève');
    } finally { await client.close(); await banc.arreter(); }
    console.log(`\n${ok} passés, ${ko} en échec`);
    process.exitCode = ko ? 1 : 0;
})().catch(e => { console.error(e); process.exitCode = 1; });
