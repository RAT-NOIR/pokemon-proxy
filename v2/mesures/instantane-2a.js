'use strict';
// MESURE-2A — L'INSTANTANÉ EN LECTURE SEULE de ce que la chaîne d'identification lit. Un processus À PART de la mesure : lui seul voit les URI de lecture
// (utilisateur Atlas « prod-lecture », qui REFUSE l'écriture) ; le processus de mesure n'en voit AUCUNE (il refuse de démarrer s'il en trouve une).
//   node v2/mesures/instantane-2a.js [--mesurer-seulement] [--sortie=<dossier>]
// Les URI sont lues dans le .env par dotenv.parse (jamais dans process.env) ; aucune valeur n'est affichée, seulement des noms de variables et des comptes.
// Écrit sous C:\Users\Yung\rat-market-travail\api\donnees-2a\instantane-<horodatage>\ : une ligne d'Extended JSON par document, + les index, + manifeste.
// LISTE FERMÉE des collections, établie en lisant le code (index.js, pont-cartes.js, departage-image.js, identification-locale.js, v2/identifier/catalogue.js) :
//   base `test`   : catalogue_produits · numeros_cartes · codes_set · guide_prix · guide_prix_meta · references_image (index d'images du départage) · cardprices (cache)
//   base `cartes` : le pont (pont-cartes.js) ne lit que `cartes` (champs nomEn nomJa niveau ndex attaques impressions sets, sets non vide) et `cartes_produits`
//                   (tirage jp, expansions couvertes) — on copie EXACTEMENT ces projections, recopiées de la production ; le reste de `cartes` n'est pas lu par la chaîne.
//   + `jugement.json` : toutes les lignes cartes_produits (idProduct, carteId, slugSet, numeroFiche) — lu par le JUGE de la mesure, jamais par la chaîne.
// ARRÊT À 450 Mo : la taille des données copiées est MESURÉE avant la première copie ; au-delà, rien n'est copié (code de sortie 3).
const fs = require('fs');
const path = require('path');
const RACINE = path.join(__dirname, '..', '..');
const dotenv = require(path.join(RACINE, 'node_modules', 'dotenv'));
const { MongoClient } = require(path.join(RACINE, 'node_modules', 'mongodb'));
const { EJSON } = require(path.join(RACINE, 'node_modules', 'bson'));
const { EXPANSIONS_COUVERTES } = require(path.join(RACINE, 'pont-cartes'));        // les constantes de la PRODUCTION, pas une copie

const PLAFOND_MO = 450;
const DOSSIER_PAR_DEFAUT = 'C:/Users/Yung/rat-market-travail/api/donnees-2a';
const arg = nom => { const a = process.argv.find(x => x.startsWith(`--${nom}=`)); return a ? a.slice(nom.length + 3) : null; };
const MESURER_SEULEMENT = process.argv.includes('--mesurer-seulement');

const PROJECTION_CARTES = { nomEn: 1, nomJa: 1, niveau: 1, ndex: 1, attaques: 1, impressions: 1, sets: 1 };    // pont-cartes.js l. 84 : .select('nomEn nomJa niveau ndex attaques impressions sets')
const FILTRE_CARTES = { sets: { $exists: true, $ne: [] } };                                                     // pont-cartes.js l. 84
const FILTRE_LIENS = () => ({ tirage: 'jp', idExpansion: { $in: [...EXPANSIONS_COUVERTES] } });                // pont-cartes.js l. 105
const PROJECTION_LIENS = { carteId: 1, idProduct: 1, idExpansion: 1, tirage: 1 };

const SPECS = () => ([
    { base: 'test', nom: 'catalogue_produits' }, { base: 'test', nom: 'numeros_cartes' }, { base: 'test', nom: 'codes_set' }, { base: 'test', nom: 'guide_prix' },
    { base: 'test', nom: 'guide_prix_meta' }, { base: 'test', nom: 'references_image' }, { base: 'test', nom: 'cardprices' },
    { base: 'cartes', nom: 'cartes', filtre: FILTRE_CARTES, projection: PROJECTION_CARTES },
    { base: 'cartes', nom: 'cartes_produits', filtre: FILTRE_LIENS(), projection: PROJECTION_LIENS }
]);

async function taille(coll, spec) {
    if (!spec.filtre) { const s = await coll.s.db.command({ collStats: spec.nom }); return { docs: s.count, octets: s.size }; }
    const r = await coll.aggregate([{ $match: spec.filtre }, { $project: spec.projection }, { $group: { _id: null, n: { $sum: 1 }, o: { $sum: { $bsonSize: '$$ROOT' } } } }]).toArray();
    return { docs: r[0] ? r[0].n : 0, octets: r[0] ? r[0].o : 0 };
}

async function ecrireLignes(flux, ligne) { if (!flux.write(ligne + '\n')) await new Promise(r => flux.once('drain', r)); }

(async () => {
    const env = dotenv.parse(fs.readFileSync(path.join(RACINE, '.env')));
    const URIS = { test: 'MONGODB_LECTURE_URI', cartes: 'MONGODB_CARTES_LECTURE_URI' };
    for (const [b, n] of Object.entries(URIS)) if (!env[n]) { console.error(`🔴 ${n} absente du .env : pas de lecture seule pour la base ${b}, rien n'est lu`); process.exit(2); }
    const base = { test: 'test', cartes: env.MONGODB_CARTES_BASE || 'cartes' };
    const horodatage = new Date();
    console.log(`INSTANTANÉ — début ${horodatage.toISOString()} (UTC) · variables lues : ${Object.values(URIS).join(', ')} (jamais leurs valeurs)`);
    const clients = {};
    for (const [b, n] of Object.entries(URIS)) clients[b] = await MongoClient.connect(env[n], { serverSelectionTimeoutMS: 20000 });
    try {
        const specs = SPECS();
        let total = 0;
        console.log('\nTAILLE DES DONNÉES À COPIER (collStats pour une collection entière, $bsonSize de la projection sinon) :');
        for (const s of specs) {
            const coll = clients[s.base].db(base[s.base]).collection(s.nom);
            Object.assign(s, await taille(coll, s));
            total += s.octets;
            console.log(`  ${(s.base + '.' + s.nom).padEnd(34)} ${String(s.docs).padStart(8)} documents  ${(s.octets / 1048576).toFixed(1).padStart(7)} Mo${s.filtre ? '  (projection de la chaîne)' : ''}`);
        }
        console.log(`  ${'TOTAL'.padEnd(34)} ${''.padStart(8)}            ${(total / 1048576).toFixed(1).padStart(7)} Mo  (plafond ${PLAFOND_MO} Mo)`);
        if (total / 1048576 > PLAFOND_MO) { console.error(`🔴 ${(total / 1048576).toFixed(1)} Mo > ${PLAFOND_MO} Mo : rien n'est copié (NEEDS_CONTEXT)`); process.exit(3); }
        if (MESURER_SEULEMENT) { console.log('--mesurer-seulement : fin, rien n\'est copié.'); return; }

        const stamp = horodatage.toISOString().replace(/[-:]/g, '').replace(/\..*/, '').replace('T', '-');
        const sortie = path.join(arg('sortie') || DOSSIER_PAR_DEFAUT, `instantane-${stamp}`);
        fs.mkdirSync(sortie, { recursive: true });
        const manifeste = { debutUTC: horodatage.toISOString(), bases: base, plafondMo: PLAFOND_MO, collections: [] };
        for (const s of specs) {
            const coll = clients[s.base].db(base[s.base]).collection(s.nom);
            const fichier = path.join(sortie, `${s.base}.${s.nom}.ejson`);
            const flux = fs.createWriteStream(fichier);
            let n = 0;
            const curseur = coll.find(s.filtre || {}, s.projection ? { projection: s.projection } : {});
            for await (const d of curseur) { await ecrireLignes(flux, EJSON.stringify(d, { relaxed: false })); n++; }
            await new Promise(r => flux.end(r));
            const index = (await coll.indexes()).filter(i => i.name !== '_id_').map(i => { const { v, ns, ...reste } = i; return reste; });
            fs.writeFileSync(path.join(sortie, `${s.base}.${s.nom}.indexes.json`), JSON.stringify(index));
            manifeste.collections.push({ base: s.base, nom: s.nom, documents: n, octetsDonnees: s.octets, fichierOctets: fs.statSync(fichier).size, indexes: index.length, filtre: s.filtre ? 'projection de la chaîne' : 'entière' });
            console.log(`  copié ${(s.base + '.' + s.nom).padEnd(34)} ${String(n).padStart(8)} documents (attendu ${s.docs}) · ${index.length} index`);
        }
        // le juge : toutes les lignes cartes_produits (carte, set, numéro de fiche) — pour dire « même impression / même carte » entre deux produits
        const liens = clients.cartes.db(base.cartes).collection('cartes_produits');
        const lignes = await liens.find({}, { projection: { _id: 0, idProduct: 1, carteId: 1, slugSet: 1, numeroFiche: 1 } }).toArray();
        fs.writeFileSync(path.join(sortie, 'jugement.json'), JSON.stringify(lignes));
        manifeste.jugement = { lignes: lignes.length };
        manifeste.finUTC = new Date().toISOString();
        fs.writeFileSync(path.join(sortie, 'manifeste.json'), JSON.stringify(manifeste, null, 1));
        console.log(`\nINSTANTANÉ ÉCRIT : ${sortie}\n  début ${manifeste.debutUTC} · fin ${manifeste.finUTC} · jugement ${lignes.length} lignes`);
    } finally { for (const c of Object.values(clients)) await c.close(); }
})().catch(e => { console.error('🔴', String(e && e.message || e).replace(/mongodb(\+srv)?:\/\/[^\s'"]+/gi, '<uri masquée>')); process.exit(1); });
