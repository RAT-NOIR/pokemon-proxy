// LECTURE SEULE : produits Cardmarket (catalogue_produits + numeros_cartes) des expansions chinoises demandées, et état des fiches (cartes_produits) — écrit un JSON de travail.
// Usage : node lire-produits-gempack.js [--exp=6447,6544] [--liste]   (lancé par un lanceur qui charge le .env de main ; NODE_PATH = node_modules de main)
const fs = require('fs'), path = require('path');
const ARGS = Object.fromEntries(process.argv.slice(2).map(a => { const m = /^--([^=]+)=?(.*)$/.exec(a); return [m[1], m[2] === '' ? true : m[2]]; }));
const { ouvrirConnexions } = require('./collecte-cartes/garde');
const { produitsDeLExpansion } = require('./collecte-cartes/jointure');
const SORTIE = 'C:/Users/Yung/rat-market-travail/catalogue/couverture/S8/GEMPACK-SOURCES/produits';
(async () => {
    const cx = await ouvrirConnexions({ production: true, buckets: [], lectureSeule: true });
    try {
        fs.mkdirSync(SORTIE, { recursive: true });
        if (ARGS.liste) {
            const NC = cx.prod.db.collection('numeros_cartes');
            const re = new RegExp(ARGS.liste === true ? '^Gem-Pack' : ARGS.liste);
            const g = await NC.aggregate([{ $match: { slugSet: re } }, { $group: { _id: { exp: '$idExpansion', slugSet: '$slugSet' }, n: { $sum: 1 } } }, { $sort: { '_id.exp': 1 } }]).toArray();
            console.log(JSON.stringify(g.map(x => ({ exp: x._id.exp, slugSet: x._id.slugSet, n: x.n }))));
            return;
        }
        for (const exp of String(ARGS.exp).split(',').map(Number)) {
            const brut = await produitsDeLExpansion(cx.prod, exp);
            const CPr = cx.cartes.db.collection('cartes_produits');
            const nFiches = await CPr.countDocuments({ idExpansion: exp });
            const idsFiches = await CPr.distinct('idProduct', { idExpansion: exp });
            const lignes = await CPr.find({ idExpansion: exp }, { projection: { _id: 0, idProduct: 1, carteId: 1, preuve: 1, numeroFiche: 1, tirage: 1, source: 1 } }).toArray();
            const parProd = new Map(lignes.map(l => [l.idProduct, l]));
            const produits = brut.map(p => ({ idProduct: p.idProduct, name: p.name, numero: p.numero ?? null, slug: p.slug ?? null, slugSet: p.slugSet ?? null, variante: p.variante ?? null, idMetacard: p.idMetacard ?? null, fiche: parProd.get(p.idProduct) ?? null }));
            fs.writeFileSync(path.join(SORTIE, `exp-${exp}.json`), JSON.stringify({ exp, le: new Date().toISOString(), lignesCartesProduits: nFiches, produitsAvecFiche: idsFiches.length, produits }, null, 1));
            console.log(`exp ${exp} : ${produits.length} produits, ${produits.filter(p => p.numero).length} numérotés, fiches (cartes_produits) lignes ${nFiches} / produits distincts ${idsFiches.length}`);
        }
    } finally { await cx.fermer(); }
})().catch(e => { console.error('❌', e.message); process.exitCode = 1; });
