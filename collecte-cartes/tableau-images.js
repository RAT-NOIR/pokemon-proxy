// ============================================================
// LE TABLEAU DES IMAGES — par set : entrées source, originaux, échecs par raison, dimensions, poids,
// cartes sans image avec leur dénominateur ; et la file d'attente du worker.
// ============================================================
//   node collecte-cartes/tableau-images.js   (lecture seule sur la base `cartes`)

require('dotenv').config();
const mongoose = require('mongoose');
const { TABLE } = require('./table-sets');

(async () => {
    if (process.env.MONGODB_CARTES_BASE !== 'cartes' || !process.env.MONGODB_CARTES_URI) { console.error('❌ MONGODB_CARTES_BASE=cartes et MONGODB_CARTES_URI requis.'); process.exit(1); }
    const cx = await mongoose.createConnection(process.env.MONGODB_CARTES_URI, { dbName: 'cartes' }).asPromise();
    const db = cx.db;
    const sets = new Map((await db.collection('sets').find({}).toArray()).map(s => [s._id, s]));
    const file = await db.collection('file_images').find({}).sort({ ordre: 1 }).toArray();
    const parSet = new Map((await db.collection('images').aggregate([
        { $group: { _id: { set: '$set', etat: '$etat' }, n: { $sum: 1 }, octets: { $sum: '$octets' }, wMin: { $min: '$w' }, wMax: { $max: '$w' }, hMin: { $min: '$h' }, hMax: { $max: '$h' }, erreurs: { $addToSet: '$erreur' } } }
    ]).toArray()).map(x => [`${x._id.set}|${x._id.etat}`, x]));
    const nCartes = await db.collection('cartes').countDocuments();
    const totalOk = await db.collection('images').countDocuments({ etat: 'ok' });
    const poids = (await db.collection('images').aggregate([{ $match: { etat: 'ok' } }, { $group: { _id: null, o: { $sum: '$octets' } } }]).toArray())[0]?.o || 0;
    console.log(`dénominateur : ${TABLE.length} sets, ${nCartes} cartes en base, ${totalOk} originaux ok, ${(poids / 1048576).toFixed(1)} Mo · file : ${file.map(f => `${f._id}:${f.etat}`).join(' ')}\n`);
    console.log('| set | entrées | originaux ok | échecs (raisons) | dimensions | poids | jointes | sans image / cartes | concordance |');
    console.log('|---|---|---|---|---|---|---|---|---|');
    let refuses = [];
    for (const L of TABLE) {
        const s = sets.get(L.slugSet);
        const c = s?.completImages;
        const ok = parSet.get(`${L.slugSet}|ok`), ko = parSet.get(`${L.slugSet}|echec`);
        const etatFile = file.find(f => f._id === L.code)?.etat || '—';
        if (!c) {
            if (etatFile === 'refuse') refuses.push(L.code);
            console.log(`| ${L.code} | — | ${ok?.n ?? 0} | ${ko?.n ?? 0}${ko?.erreurs?.length ? ' (' + ko.erreurs.filter(Boolean).slice(0, 2).join(' ; ') + ')' : ''} | ${ok ? `${ok.wMin}×${ok.hMin} à ${ok.wMax}×${ok.hMax}` : '—'} | ${ok ? (ok.octets / 1048576).toFixed(1) + ' Mo' : '—'} | — | — | ${etatFile} |`);
            continue;
        }
        console.log(`| ${L.code} | ${c.entreesSource} | ${c.imagesOk} | ${ko?.n ?? 0}${ko?.erreurs?.length ? ' (' + ko.erreurs.filter(Boolean).slice(0, 2).join(' ; ') + ')' : ''} | ${ok ? `${ok.wMin}×${ok.hMin} à ${ok.wMax}×${ok.hMax}` : '—'} | ${ok ? (ok.octets / 1048576).toFixed(1) + ' Mo' : '—'} | ${c.imagesJointes} | ${c.cartesSansImage ?? '—'} / ${c.cartesDuSet} | ${c.concordance ? '✅' : '❌'} |`);
    }
    const refusesRes = [...sets.values()].filter(s => s.completImages == null).map(s => s._id);
    const etatsRefus = await db.collection('collecte_images_etat').find({ phase: 'refuse-resolution' }).toArray();
    console.log(`\nsets refusés pour résolution < 560 px : ${etatsRefus.length ? etatsRefus.map(e => `${e._id} ${JSON.stringify(e.mesures)}`).join(' · ') : 'aucun'}`);
    await cx.close();
})().catch(e => { console.error(e); process.exit(1); });
