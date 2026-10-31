// LECTURE SEULE : pourquoi les produits sans fiche d'un Gem Pack ne reçoivent pas de ligne — l'état des cartes que le planificateur a désignées (appartenance au set, impressions).
// Usage : node diagnostic-appartenance-gempack.js   (lit simulation/resume-gempack.json écrit par simuler-gempack-sources.js ; lanceur avec le .env de main)
const fs = require('fs');
const V5 = require('./poser-fiches-voie-deux-sources');
const R = 'C:/Users/Yung/rat-market-travail/catalogue/couverture/S8/GEMPACK-SOURCES/simulation';
(async () => {
    const rs = JSON.parse(fs.readFileSync(R + '/resume-gempack.json', 'utf8'));
    const ids = new Set(), parProduit = new Map();
    for (const r of rs.refus) { const m = /la carte (\d+) n'est pas dans le set ([\w-]+)/.exec(r.raison); const c = /cartes candidates[^(]*\(([\d, ]+)\)/.exec(r.raison); if (m) { ids.add(Number(m[1])); parProduit.set(r.idProduct, { type: 'hors-set', carte: Number(m[1]), set: m[2] }); } else if (c) { const l = c[1].split(',').map(x => Number(x.trim())); l.forEach(i => ids.add(i)); parProduit.set(r.idProduct, { type: 'ambigu', cartes: l }); } }
    const cx = await V5.ouvrirLecture();
    try {
        const docs = await cx.cartes.db.collection('cartes').find({ _id: { $in: [...ids] } }, { projection: { nomEn: 1, niveau: 1, 'attaques.nom': 1, sets: 1, impressions: 1, 'liens.idProduct': 1, 'bulba.titre': 1 } }).toArray();
        const par = new Map(docs.map(d => [d._id, d]));
        const vus = new Set();
        for (const [id, info] of parProduit) {
            const cles = info.type === 'hors-set' ? [info.carte] : info.cartes;
            const k = info.type + cles.join(',');
            if (vus.has(k)) continue; vus.add(k);
            console.log(`\n${info.type} · produit ${id}${info.set ? ' · set ' + info.set : ''}`);
            for (const c of cles) { const d = par.get(c); if (!d) { console.log(`   carte ${c} : introuvable`); continue; } console.log(`   carte ${c} « ${d.nomEn} » · attaques ${(d.attaques || []).map(a => a.nom).join('|')} · sets ${JSON.stringify(d.sets || [])} · impressions ${JSON.stringify((d.impressions || []).filter(i => /gem/i.test(JSON.stringify(i)) || i.tirage === 'zh-hans').slice(0, 4))} · produits liés ${(d.liens?.idProduct || []).length}`); }
        }
    } finally { await cx.fermer(); }
})().catch(e => { console.error('❌', e.message); process.exitCode = 1; });
