// SONDE (lecture seule) : sur les lignes du journal dont la photo est AU JEU FIXE et qui portent un vivier, que fait le départage par
// l'image aujourd'hui ? (statut et motif) — pour savoir si la cellule « départage par l'image » peut se remplir sans Vinted.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
(async () => {
    const PHOTOS = require('./photos-locales').installer({ etiquette: 'sonde' });
    await mongoose.connect(process.env.MONGODB_URI, { dbName: 'test' });
    const IMG = require('../departage-image');
    const journal = await mongoose.connection.db.collection('journal_scans').find({}).sort({ le: -1 }).toArray();
    const lignes = journal.filter(d => d.imageUrl && d.nom && d.idProduct != null && Array.isArray(d.vivierIds) && d.vivierIds.length >= 2);
    console.log(`DÉNOMINATEUR : ${lignes.length} lignes abouties à vivier · ${lignes.filter(d => PHOTOS.aPhoto(d.imageUrl)).length} au jeu fixe`);
    for (const d of lignes.filter(d => PHOTOS.aPhoto(d.imageUrl))) {
        const avis = await IMG.departager({ imageUrl: d.imageUrl, langue: d.langue, total: d.total, classement: d.vivierIds.map(id => ({ idProduct: id, score: 0 })) });
        console.log(`   ${d._id} ${d.nom} n°${d.numero} (${d.langue}) vivier ${d.vivierIds.length} : départage ${avis.departage} · ${avis.champs.imageStatut} · ${avis.champs.imageMotif} · inliers ${avis.champs.imageInliers ?? '—'}/${avis.champs.imageInliersSecond ?? '—'}`);
    }
    await mongoose.disconnect();
})().catch(e => { console.error(e); process.exit(1); });
