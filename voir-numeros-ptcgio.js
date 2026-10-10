// Outil de mesure (LECTURE SEULE) : numeroFiche + carte + visuels des produits d'un set, pour confronter à la numérotation prouvée.
require('dotenv').config();
const { ouvrirConnexions } = require('./collecte-cartes/garde');
(async () => {
    const { cartes: cx, fermer } = await ouvrirConnexions({ production: false, buckets: [] });
    for (const slug of process.argv.slice(2)) {
        const lignes = await cx.db.collection('cartes_produits').find({ slugSet: slug }, { projection: { carteId: 1, idProduct: 1, numeroFiche: 1 } }).toArray();
        const cartes = new Map((await cx.db.collection('cartes').find({ _id: { $in: lignes.map(l => l.carteId) } }, { projection: { nomEn: 1, images: 1 } }).toArray()).map(c => [c._id, c]));
        console.log(`\n## ${slug} : ${lignes.length} lignes`);
        console.log(lignes.map(l => { const c = cartes.get(l.carteId); const v = (c?.images || []).filter(i => i.set === slug).map(i => `${i.source}:${i.numero ?? '-'}`).join('+'); return `${l.numeroFiche ?? 'null'}:${(c?.nomEn || '?').slice(0, 18)}${v ? ` [${v}]` : ''}`; }).sort().join(' | '));
    }
    await fermer();
})().catch(e => { console.error(e.message); process.exit(1); });
