// ============================================================
// DÉPLACER UNE FICHE VERS L'EXPANSION OÙ CARDMARKET A RANGÉ SON PRODUIT (2026-09-24)
// ============================================================
//   node deplacer-produits-expansion.js --produits=295674 --annonce=<fichier.json>    (simulation, écrit l'annonce des baisses)
//   node lot-additif.js --quoi="…" --collections=cartes_produits --annonce=<fichier.json> -- node deplacer-produits-expansion.js --produits=295674 --ecrire
//
// L'export du 23/09 a changé 60 `idExpansion`, des Énergies de base vers 6697 « Unnumbered Energies » (§56). La ligne de
// jointure garde l'expansion du jour où elle a été écrite : le site la montrerait sous un set auquel Cardmarket ne rattache
// plus le produit. La carte ne change pas — seul le rattachement du PRODUIT change. Cet outil modifie une donnée existante :
// il ne tourne que sur les produits NOMMÉS, un feu vert par produit.
// 🔑 La nouvelle expansion et son slug viennent de la production (catalogue_produits, numeros_cartes), et les deux doivent
// concorder : un produit dont le catalogue et l'apprentissage divergent n'est pas déplacé, il est imprimé.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { ouvrirConnexions } = require('./collecte-cartes/garde');
const { compterEtat, comparer } = require('./collecte-cartes/garde-lot');

const AUTORISES = [/^--ecrire$/, /^--annonce=.+\.json$/, /^--produits=\d+(,\d+)*$/];
const inconnus = process.argv.slice(2).filter(a => !AUTORISES.some(r => r.test(a)));
const ecrire = process.argv.includes('--ecrire');
const annonce = process.argv.find(a => a.startsWith('--annonce='))?.slice(10);
const produits = (process.argv.find(a => a.startsWith('--produits=')) || '').slice(11).split(',').filter(Boolean).map(Number);
if (inconnus.length || ecrire === !!annonce || !produits.length) { console.error(`❌ ${inconnus.length ? `argument inconnu : ${inconnus.join(' ')} — ` : ''}usage : --produits=ID[,ID] (--annonce=<fichier.json> | --ecrire)`); process.exit(2); }

(async () => {
    const { cartes: cx, prod, fermer } = await ouvrirConnexions({ buckets: [] });
    const CP = cx.db.collection('cartes_produits');
    const plan = [];
    for (const id of produits) {
        const cat = await prod.db.collection('catalogue_produits').findOne({ idProduct: id });
        const nc = await prod.db.collection('numeros_cartes').findOne({ idProduct: id });
        const lignes = await CP.find({ idProduct: id }).toArray();
        if (!cat || !nc) { console.log(`   ⛔ ${id} : ${!cat ? 'absent du catalogue' : 'jamais appris (numeros_cartes)'} — non déplacé`); continue; }
        if (cat.idExpansion !== nc.idExpansion || !nc.slugSet) { console.log(`   ⛔ ${id} : le catalogue dit ${cat.idExpansion}, l'apprentissage ${nc.idExpansion} « ${nc.slugSet} » — non déplacé`); continue; }
        if (!lignes.length) { console.log(`   ⛔ ${id} : aucune ligne de jointure`); continue; }
        for (const l of lignes) {
            if (l.idExpansion === cat.idExpansion) { console.log(`   ⚪ ${l._id} : déjà en ${cat.idExpansion}`); continue; }
            const carte = await cx.db.collection('cartes').findOne({ _id: l.carteId }, { projection: { nomEn: 1 } });
            console.log(`   ➜ ${l._id} « ${cat.name} » → carte ${l.carteId} « ${carte?.nomEn} » : exp ${l.idExpansion} ${l.slugSet} (${l.preuve}, ${l.detail}) → ${cat.idExpansion} ${nc.slugSet} (« ${nc.slug} »)`);
            plan.push({ l, vers: { idExpansion: cat.idExpansion, slugSet: nc.slugSet, slug: nc.slug } });
        }
    }
    // l'annonce : ce que la garde verra, compté par SA fonction sur les expansions touchées
    const exps = [...new Set(plan.flatMap(p => [p.l.idExpansion, p.vers.idExpansion]))];
    const avant = await CP.find({ idExpansion: { $in: exps } }).project({ idExpansion: 1, idProduct: 1 }).toArray();
    const bouge = new Map(plan.map(p => [String(p.l._id), p.vers.idExpansion]));
    const apres = avant.filter(l => !bouge.has(String(l._id))).concat(plan.map(p => ({ _id: p.l._id, idExpansion: p.vers.idExpansion, idProduct: p.l.idProduct })));
    const cmp = comparer(compterEtat({ cartesProduits: avant }), compterEtat({ cartesProduits: apres }));
    const baisses = Object.fromEntries(cmp.baisses.map(b => [b.cle, b.baisse]));
    console.log(`\n   ${plan.length} ligne(s) à déplacer · baisses que la garde verra : ${Object.entries(baisses).map(([k, v]) => `${k} −${v}`).join(' ; ') || 'aucune'}`);
    if (!ecrire) {
        fs.writeFileSync(path.resolve(annonce), JSON.stringify(baisses, null, 1));
        console.log(`   annonce écrite : ${annonce}\n   (simulation — rien n'est écrit en base)`);
        await fermer(); return;
    }
    let n = 0;
    for (const { l, vers } of plan) {
        const r = await CP.updateOne({ _id: l._id, idExpansion: l.idExpansion }, {
            $set: { idExpansion: vers.idExpansion, slugSet: vers.slugSet, slug: l.slug ?? vers.slug,
                deplace: { de: { idExpansion: l.idExpansion, slugSet: l.slugSet, detail: l.detail }, le: new Date(), motif: 'Cardmarket range désormais le produit dans cette expansion (catalogue et apprentissage concordants)' } },
            $unset: { slugSetDeLaLigne: 1 }
        });
        n += r.modifiedCount;
    }
    const relus = await CP.countDocuments({ _id: { $in: plan.map(p => p.l._id) }, 'deplace.le': { $exists: true } });
    console.log(`\n   ✅ déplacées : ${n} (attendu ${plan.length}) · relues avec leur trace : ${relus}`);
    await fermer();
    if (n !== plan.length || relus !== plan.length) process.exit(1);
})().catch(e => { console.error('❌', e.message); process.exit(1); });
