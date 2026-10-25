'use strict';
// LOT TEMPS-CHAINE-2 — le gain d'un index pour la présélection par le premier mot de `trouverProduitsLocaux` (index.js), MESURÉ sur une COPIE dans un mongod en mémoire.
//   node v2/mesures/mesurer-index-premier-mot.js --env=<.env d'api-v2>
// SÛRETÉ : la source est lue par MONGODB_ESSAI_LECTURE_URI (compte de lecture, rm_essai.catalogue_produits : find seulement) ; TOUTES les écritures vont dans le mongod en mémoire du banc
// (collecte-cartes/base-banc.js refuse sinon). Aucun index, aucune écriture sur la production.
// La requête mesurée est RECOPIÉE de la production (index.js::trouverProduitsLocaux) : `CatalogueProduit.find({ name: new RegExp(echapperRegex(premierMot), 'i') }).lean()`.
const fs = require('fs');
const path = require('path');
const arg = (nom, d) => { const a = process.argv.find(x => x.startsWith(`--${nom}=`)); return a ? a.slice(nom.length + 3) : d; };
const echapperRegex = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');                      // la fonction de la production (index.js)
const premierMotDe = n => n.replace(/^(M|Mega)[\s-]*/i, '').split(/[\s&-]/)[0];                  // idem, la ligne de la production
const pct = (v, p) => { const s = [...v].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))]; };
const lireEnv = (f, nom) => { for (const l of fs.readFileSync(f, 'utf8').split(/\r?\n/)) { const m = l.match(new RegExp(`^\\s*${nom}\\s*=\\s*(.*)\\s*$`)); if (m) return m[1].replace(/^["']|["']$/g, ''); } return null; };

(async () => {
    const racine = path.join(__dirname, '..', '..');
    const uriLecture = lireEnv(arg('env', 'C:/Users/Yung/Desktop/pokemon-proxy-api-v2/.env'), 'MONGODB_ESSAI_LECTURE_URI');
    if (!uriLecture) throw new Error('MONGODB_ESSAI_LECTURE_URI absente');
    const { MongoClient } = require(path.join(racine, 'node_modules', 'mongodb'));
    const src = new MongoClient(uriLecture, { serverSelectionTimeoutMS: 20000 }); await src.connect();
    const catalogue = await src.db('rm_essai').collection('catalogue_produits').find({}, { projection: { idProduct: 1, name: 1, idExpansion: 1, idMetacard: 1 } }).toArray();
    // les noms réellement scannés (mots de départ du trafic de l'essai), pour mesurer ce que le trafic demande
    const noms = (await src.db('rm_essai').collection('journal_scans').find(require('../../journal-hors-banc').avecHorsBanc({ nom: { $type: 'string' } }), { projection: { nom: 1 } }).toArray()).map(x => x.nom);
    await src.close();
    console.log(`copie : ${catalogue.length} produits (dénominateur) · ${noms.length} noms scannés du journal`);
    const mots = [...new Set(noms.map(premierMotDe).filter(m => m && m.length >= 3))];
    console.log(`premiers mots distincts du trafic : ${mots.length}`);

    const { ouvrirBanc } = require(path.join(racine, 'collecte-cartes', 'base-banc.js'));
    const banc = await ouvrirBanc();
    const cl = new MongoClient(banc.uri); await cl.connect();
    try {
        const db = cl.db('banc_index'); const col = db.collection('catalogue_produits');
        await col.drop().catch(() => { });
        for (let i = 0; i < catalogue.length; i += 5000) await col.insertMany(catalogue.slice(i, i + 5000).map(({ _id, ...d }) => d), { ordered: false });
        console.log(`copie en mémoire : ${await col.countDocuments({})} documents`);
        await col.createIndex({ idExpansion: 1 });                                                  // l'index déjà déclaré par la production (index.js:394)
        const requete = m => ({ name: new RegExp(echapperRegex(m), 'i') });
        const mesurer = async nom => {
            const t = []; let retenus = 0, examines = 0, etape = '';
            for (const m of mots) {
                const e = await col.find(requete(m)).explain('executionStats');
                examines += e.executionStats.totalDocsExamined; etape = JSON.stringify(e.queryPlanner.winningPlan).match(/COLLSCAN|IXSCAN/g)?.join('+') || '?';
                retenus += e.executionStats.nReturned;
                const s = process.hrtime.bigint(); await col.find(requete(m)).toArray(); t.push(Number(process.hrtime.bigint() - s) / 1e6);
            }
            console.log(`  ${nom.padEnd(34)} plan ${etape.padEnd(14)} p50 ${pct(t, .5).toFixed(1)} ms · p95 ${pct(t, .95).toFixed(1)} ms · moy ${(t.reduce((a, b) => a + b, 0) / t.length).toFixed(1)} ms · docs examinés/requête ${(examines / mots.length).toFixed(0)} · retenus/requête ${(retenus / mots.length).toFixed(0)}`);
            return t;
        };
        await mesurer('sans index sur name (production)'); await mesurer('sans index sur name (2e passe, chaud)');
        const tailleAvant = (await db.command({ collStats: 'catalogue_produits' }));
        await col.createIndex({ name: 1 }, { name: 'name_1' });
        await mesurer('index { name: 1 }'); await mesurer('index { name: 1 } (2e passe)');
        const s1 = await db.command({ collStats: 'catalogue_produits' });
        console.log(`taille : données ${(s1.size / 1048576).toFixed(1)} Mo (stockage ${(s1.storageSize / 1048576).toFixed(1)} Mo) · index : ${Object.entries(s1.indexSizes).map(([k, v]) => `${k} ${(v / 1024).toFixed(0)} Ko`).join(', ')} · total index ${(s1.totalIndexSize / 1024).toFixed(0)} Ko (avant : ${(tailleAvant.totalIndexSize / 1024).toFixed(0)} Ko)`);
        // L'ALTERNATIVE SANS ÉCRITURE : les noms en mémoire du processus (idProduct + nom en minuscules), filtrés en JS. Mesure du filtre seul (le rechargement et la fraîcheur sont une décision de l'éditeur).
        {
            const noms = catalogue.map(p => [p.idProduct, String(p.name || '').toLowerCase()]);
            const octets = noms.reduce((a, [, n]) => a + n.length * 2 + 40, 0);
            const t = []; let divergences = 0;
            for (const m of mots) {
                const bas = m.toLowerCase();
                const s = process.hrtime.bigint(); const ids = []; for (const [id, n] of noms) if (n.includes(bas)) ids.push(id); t.push(Number(process.hrtime.bigint() - s) / 1e6);
                const ref = (await col.find(requete(m), { projection: { idProduct: 1 } }).toArray()).map(x => x.idProduct).sort((a, b) => a - b).join(',');
                if (ref !== ids.sort((a, b) => a - b).join(',')) divergences++;
            }
            console.log(`  noms en mémoire du processus (filtre JS)  p50 ${pct(t, .5).toFixed(1)} ms · p95 ${pct(t, .95).toFixed(1)} ms · ~${(octets / 1048576).toFixed(1)} Mo de tas · mots dont le résultat diffère de la regex /i : ${divergences}/${mots.length}`);
        }
        // même résultat avec et sans l'index (le pré-filtre ne change pas les produits retenus)
        let diff = 0;
        for (const m of mots.slice(0, 200)) {
            const a = (await col.find(requete(m)).hint({ $natural: 1 }).toArray()).map(x => x.idProduct).sort((x, y) => x - y).join(',');
            const b = (await col.find(requete(m)).hint('name_1').toArray()).map(x => x.idProduct).sort((x, y) => x - y).join(',');
            if (a !== b) diff++;
        }
        console.log(`mêmes produits retenus avec et sans index : ${mots.slice(0, 200).length - diff}/${mots.slice(0, 200).length}`);
    } finally { await cl.close(); await banc.arreter(); }
})().catch(e => { console.error('❌', e.message); process.exit(1); });
