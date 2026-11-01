// LECTURE SEULE : les visuels que nous servons déjà pour les Gem Pack (largeurs, source, basseDefinition) — pour comparer à ce que les listes SC / PC offrent. Usage : node lire-visuels-gempack.js
const V5 = require('./poser-fiches-voie-deux-sources');
(async () => {
    const cx = await V5.ouvrirLecture();
    try {
        const db = cx.cartes.db;
        for (const slug of ['Gem-Pack-Vol-1', 'Gem-Pack-Vol-2', 'Gem-Pack-Vol-3', 'Gem-Pack-Vol-4', 'Gem-Pack-Vol5', 'Gem-Pack-Vol-6']) {
            const cartes = await db.collection('cartes').find({ sets: slug }, { projection: { images: 1 } }).toArray();
            const im = cartes.flatMap(c => (c.images || []).filter(i => i.set === slug));
            const w = im.map(i => i.w).filter(Number.isFinite).sort((a, b) => a - b);
            const par = {}; for (const i of im) par[(i.source || '?').split('/')[0] + (i.basseDefinition ? '+basseDef' : '')] = (par[(i.source || '?').split('/')[0] + (i.basseDefinition ? '+basseDef' : '')] || 0) + 1;
            console.log(`${slug} : cartes ${cartes.length} · visuels de ce set ${im.length} · largeur min/médiane/max ${w[0]}/${w[Math.floor(w.length / 2)]}/${w[w.length - 1]} · sources ${JSON.stringify(par)}`);
        }
        const images = db.collection('images');
        const ex = await images.findOne({ set: 'Gem-Pack-Vol-4' });
        console.log('exemple de document images :', ex ? JSON.stringify(Object.keys(ex)) : 'aucun');
        const n = await images.countDocuments({ set: /Gem-Pack/ });
        console.log('documents images Gem Pack :', n);
    } finally { await cx.fermer(); }
})().catch(e => { console.error('❌', e.message); process.exitCode = 1; });
