// LECTURE SEULE (find/countDocuments uniquement) : trous zh-hans de la base `cartes` + production. Aucune ecriture.
// Usage : node collecte-cartes/mesure-pikaqian-base.js [sortie.json]
require('dotenv').config();
const fs = require('fs');
const { ouvrirConnexions } = require('./garde');
const { estCarteCode } = require('./jointure');

(async () => {
    const { cartes: cx, prod, fermer } = await ouvrirConnexions({ production: true, buckets: [] });
    const sets = await cx.db.collection('sets').find({ tirage: 'zh-hans' }, { projection: { _id: 1, tirage: 1, region: 1, nomAffichage: 1, nomEn: 1, slug: 1, slugSet: 1, codeSet: 1 } }).toArray();
    console.log('sets tirage zh-hans :', sets.length, '| cles du 1er :', Object.keys(sets[0] || {}).join(','));
    const nc = await prod.db.collection('numeros_cartes').find({}, { projection: { idProduct: 1, idExpansion: 1, slugSet: 1, codeSet: 1, numero: 1, nom: 1, nomEn: 1, slug: 1, variante: 1 } }).toArray();
    const cat = new Map((await prod.db.collection('catalogue_produits').find({}, { projection: { idProduct: 1, name: 1 } }).toArray()).map(p => [p.idProduct, p.name]));
    const slugsZh = new Set(sets.map(s => s._id));
    const liens = await cx.db.collection('cartes_produits').find({}, { projection: { idProduct: 1, carteId: 1, slugSet: 1 } }).toArray();
    const avecImages = await cx.db.collection('cartes').find({ 'images.0': { $exists: true } }, { projection: { images: 1 } }).toArray();
    const setsParCarte = new Map(avecImages.map(c => [c._id, new Set((c.images || []).map(i => i.set))]));
    const lienDe = new Map(liens.map(l => [l.idProduct, l]));
    const out = [];
    for (const p of nc) {
        if (!slugsZh.has(p.slugSet)) continue;
        const nom = cat.get(p.idProduct) || p.nom || p.nomEn || p.slug || '';
        if (estCarteCode(nom)) continue;
        const l = lienDe.get(p.idProduct);
        const aVisuel = !!(l && setsParCarte.get(l.carteId)?.has(p.slugSet));
        out.push({ idProduct: p.idProduct, slugSet: p.slugSet, codeSet: p.codeSet, numero: p.numero, nom, slug: p.slug, variante: p.variante ?? null, fiche: !!l, visuel: aVisuel });
    }
    console.log('produits zh-hans (hors cartes-code) :', out.length, '| avec visuel :', out.filter(x => x.visuel).length, '| avec fiche :', out.filter(x => x.fiche).length);
    if (process.argv[2]) fs.writeFileSync(process.argv[2], JSON.stringify({ sets, produits: out }));
    await fermer();
})().catch(e => { console.error(e); process.exit(1); });
