// ============================================================
// LA FILE EN ATTENTE DE L'USERSCRIPT — intégrée depuis le journal exporté, par la fonction de la ROUTE (demande du testeur, 2026-09-27)
// ============================================================
//   node integrer-file-attente.js --journal=<rat-market-journal-*.json>                                   (mesure : rien d'écrit)
//   node integrer-file-attente.js --journal=<…> --base=test --attendu=<cartes> --sauvegarde=<dossier> --ecrire
//        (après backup-collections.js --base=test --collections=numeros_cartes,codes_set --dossier=<dossier>)
// 🔴 LE CAS (journal 1.9) : 3 envois refusés par NOTRE serveur (429 : la limite de 120 envois/h de /api/apprendre-lot) et 4 pages,
// 120 cartes lues AVEC leur image, restées dans `fileEnAttente` quand la passe s'est arrêtée. Ce sont de vraies lectures : elles
// passent par `apprendreLot` (collecte-cartes/deduire-produit.js) — EXACTEMENT ce que la route appelle, une page par appel, comme
// l'userscript les aurait envoyées ; `decoderCodeSet` et la règle de `codes_set` sont celles de la route (collecte-cartes/codes-set.js).
// LA GARDE : la sauvegarde nommée doit exister et contenir numeros_cartes ; le nombre de cartes doit être celui ANNONCÉ (`--attendu`) ;
// après écriture, AUCUNE ligne hors du lot (ids lus ∪ ids déduits rendus par la route) ne doit avoir changé — relu sur les lignes du
// lot et compté sur la table entière (lignes « exacte » : jamais en baisse).
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const AUTORISES = [/^--journal=.+\.json$/, /^--base=test$/, /^--attendu=\d+$/, /^--sauvegarde=[\w.-]+$/, /^--ecrire$/];
const inconnus = process.argv.slice(2).filter(a => !AUTORISES.some(r => r.test(a)));
if (inconnus.length) { console.error(`❌ argument inconnu : ${inconnus.join(' ')}`); process.exit(2); }
const arg = n => process.argv.find(a => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const JOURNAL = arg('journal'), ecrire = process.argv.includes('--ecrire');
if (!JOURNAL || !fs.existsSync(JOURNAL)) { console.error('❌ --journal=<fichier exporté par l\'userscript> requis'); process.exit(2); }
const { apprendreLot } = require('./collecte-cartes/deduire-produit');
const { decoderCodeSet, fabriquerMemoriserCodeSet, accesNatif } = require('./collecte-cartes/codes-set');

(async () => {
    const J = JSON.parse(fs.readFileSync(JOURNAL, 'utf8'));
    const file = Array.isArray(J.fileEnAttente) ? J.fileEnAttente : [];
    const cartes = file.flatMap(f => f.cartes || []);
    const ids = [...new Set(cartes.map(c => c.idProduct).filter(id => id != null))];
    console.log(`DÉNOMINATEUR : ${file.length} page(s) en attente · ${cartes.length} cartes (${ids.length} idProduct distincts, ${cartes.filter(c => c.idProduct == null).length} sans image) · userId ${J.userId ?? '—'}`);
    for (const f of file) console.log(`   ${String(f.cartes?.length ?? 0).padStart(3)} · ${new Date(f.le).toISOString().slice(0, 16)} · ${f.cle}`);
    if (!file.length) { console.log('rien en attente'); return; }

    if (!ecrire) {
        const { prod, fermer } = await require('./collecte-cartes/garde').ouvrirConnexions({ production: true, buckets: [] });
        const lignes = await prod.db.collection('numeros_cartes').find({ idProduct: { $in: ids } }, { projection: { idProduct: 1, source: 1, certitude: 1, slug: 1, numero: 1 } }).toArray();
        const parId = new Map(lignes.map(l => [l.idProduct, l]));
        const etat = { absente: 0, exacte: 0, deduite: 0, autre: 0 };
        for (const id of ids) { const l = parId.get(id); etat[!l ? 'absente' : l.certitude === 'deduite' ? 'deduite' : (l.source === 'cardmarket' ? 'exacte' : 'autre')]++; }
        console.log(`\nMESURE (base test, lecture seule) : ${JSON.stringify(etat)} — « absente » s'insère, « exacte » ne bouge pas (ses champs vides se complètent), « deduite »/« autre » se réécrivent`);
        console.log(`   (relancer avec --base=test --attendu=${cartes.length} --sauvegarde=<dossier> --ecrire, après backup-collections.js --base=test --collections=numeros_cartes,codes_set --dossier=<dossier>)`);
        await fermer();
        return;
    }
    if (Number(arg('attendu')) !== cartes.length) { console.error(`❌ ARRÊT : ${cartes.length} cartes dans la file contre ${arg('attendu')} attendues`); process.exit(1); }
    const sauvegarde = arg('sauvegarde');
    if (!sauvegarde || !fs.existsSync(path.join(__dirname, sauvegarde, 'numeros_cartes.json'))) { console.error(`❌ ARRÊT : --sauvegarde=<dossier> doit contenir numeros_cartes.json (backup-collections.js --base=test --collections=numeros_cartes,codes_set --dossier=…)`); process.exit(1); }
    const mongoose = require('mongoose');
    const { connecterMongo } = require('./mongo-connexion');
    const base = await connecterMongo({ script: 'integrer-file-attente.js', ecrit: true });
    if (base !== 'test') { console.error(`❌ ARRÊT : les numéros appris vivent dans « test », pas dans « ${base} »`); await mongoose.disconnect(); process.exit(1); }
    const db = mongoose.connection.db;
    const N = db.collection('numeros_cartes'), K = db.collection('catalogue_produits');
    const memoriserCodeSet = fabriquerMemoriserCodeSet({ ...accesNatif(db.collection('codes_set')), pret: () => mongoose.connection.readyState === 1 });
    const photo = async () => new Map((await N.find({}, { projection: { _id: 0 } }).toArray()).map(l => [l.idProduct, JSON.stringify(l)]));
    const avant = await photo();
    const exactesAvant = await N.countDocuments({ certitude: { $ne: 'deduite' }, source: 'cardmarket' });
    const touches = new Set(ids);
    const bilan = { nouvelles: 0, ameliorees: 0, dejaExactes: 0, completees: 0, deduites: 0, sansNumero: 0, ignorees: 0 };
    for (const f of file) {
        const r = await apprendreLot(f.cartes, { numeros: N, catalogue: K, decoderCodeSet, memoriserCodeSet, userId: J.userId || 'integrer-file-attente', journal: console });
        for (const k of Object.keys(bilan)) bilan[k] += Number(r[k] || 0);
        for (const d of r.idsDeduits || []) if (d?.idProduct != null) touches.add(d.idProduct);
        console.log(`   ✅ ${f.cartes.length} cartes · ${JSON.stringify({ nouvelles: r.nouvelles, ameliorees: r.ameliorees, dejaExactes: r.dejaExactes, completees: r.completees, deduites: r.deduites })} · ${f.cle}`);
    }
    const apres = await photo();
    const horsLot = [...new Set([...avant.keys(), ...apres.keys()])].filter(id => !touches.has(id) && avant.get(id) !== apres.get(id));
    const exactesApres = await N.countDocuments({ certitude: { $ne: 'deduite' }, source: 'cardmarket' });
    console.log(`\nBILAN : ${JSON.stringify(bilan)} · lignes ${avant.size} → ${apres.size} · « exacte » ${exactesAvant} → ${exactesApres} · lignes changées HORS du lot : ${horsLot.length}`);
    if (horsLot.length || exactesApres < exactesAvant) { console.error(`🔴 GARDE : ${horsLot.length} ligne(s) hors du lot changée(s) (${horsLot.slice(0, 5).join(', ')}) ou lignes exactes en baisse — restaurer depuis ${sauvegarde}`); process.exitCode = 1; }
    await mongoose.disconnect();
})().catch(e => { console.error(e); process.exit(1); });
