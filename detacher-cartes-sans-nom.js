// ============================================================
// DÉTACHER LES FICHES POSÉES SUR UNE PAGE SANS NOM — la reprise des lignes déjà écrites (2026-09-24)
// ============================================================
//   node detacher-cartes-sans-nom.js --annonce=<fichier.json>    (simulation : liste les lignes, écrit l'annonce des baisses)
//   node lot-additif.js --quoi="…" --collections=restes --annonce=<fichier.json> -- node detacher-cartes-sans-nom.js --ecrire
//
// `joindre()` refuse désormais toute fiche vers une carte sans nomEn (collecte-cartes/jointure.js) : les 6 documents sans nom
// sont 4 pages d'HOMONYMIE ({{tcgdisambig}}) et 2 ébauches d'Énergie. Une règle corrigée ne corrige aucune ligne déjà écrite
// (§32 : un correctif de jointure se livre en deux moitiés) : cet outil est la seconde moitié. Il retire les lignes, sort
// l'idProduct des liens de la carte, et écrit pour chaque produit le reste que la jointure écrirait (`carte-sans-nom`).
// L'annonce est calculée par compterEtat, la fonction même de la garde de lot : elle ne peut pas diverger de ce qu'elle juge.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { ouvrirConnexions } = require('./collecte-cartes/garde');
const { compterEtat, comparer } = require('./collecte-cartes/garde-lot');

const AUTORISES = [/^--ecrire$/, /^--annonce=.+\.json$/];
const inconnus = process.argv.slice(2).filter(a => !AUTORISES.some(r => r.test(a)));
const ecrire = process.argv.includes('--ecrire');
const annonce = process.argv.find(a => a.startsWith('--annonce='))?.slice(10);
if (inconnus.length || ecrire === !!annonce) { console.error(`❌ ${inconnus.length ? `argument inconnu : ${inconnus.join(' ')} — ` : ''}usage : --annonce=<fichier.json> (simulation) | --ecrire`); process.exit(2); }

(async () => {
    const { cartes: cx, fermer } = await ouvrirConnexions({ production: false, buckets: [] });
    const total = await cx.db.collection('cartes').countDocuments({});
    const sansNom = await cx.db.collection('cartes').find({ $or: [{ nomEn: { $exists: false } }, { nomEn: null }, { nomEn: '' }] }).project({ 'bulba.titre': 1 }).toArray();
    const titre = new Map(sansNom.map(c => [c._id, c.bulba?.titre ?? String(c._id)]));
    const lignes = await cx.db.collection('cartes_produits').find({ carteId: { $in: [...titre.keys()] } }).toArray();
    console.log(`\n════ ${sansNom.length} cartes sans nomEn sur ${total} · ${lignes.length} ligne(s) de jointure vers elles ════`);
    for (const l of lignes) console.log(`   ${l._id}  produit ${l.idProduct} « ${l.slug} » exp ${l.idExpansion} ${l.slugSet} → « ${titre.get(l.carteId)} » (${l.preuve})`);

    // L'annonce : ce que la garde verra, compté par SA fonction sur les expansions touchées, avant et après le retrait.
    const exps = [...new Set(lignes.map(l => l.idExpansion))];
    const avant = await cx.db.collection('cartes_produits').find({ idExpansion: { $in: exps } }).project({ idExpansion: 1, idProduct: 1 }).toArray();
    const retirees = new Set(lignes.map(l => String(l._id)));
    const cmp = comparer(compterEtat({ cartesProduits: avant }), compterEtat({ cartesProduits: avant.filter(l => !retirees.has(String(l._id))) }));
    const baisses = Object.fromEntries(cmp.baisses.map(b => [b.cle, b.baisse]));
    console.log(`   baisses que la garde verra : ${Object.entries(baisses).map(([k, v]) => `${k} −${v}`).join(' ; ') || 'aucune'}`);

    if (!ecrire) {
        fs.writeFileSync(path.resolve(annonce), JSON.stringify(baisses, null, 1));
        console.log(`   annonce écrite : ${annonce}\n   (simulation — rien n'est écrit en base)`);
        await fermer(); return;
    }
    const r = await cx.db.collection('cartes_produits').deleteMany({ _id: { $in: lignes.map(l => l._id) } });
    for (const [id] of titre) {
        const ps = lignes.filter(l => l.carteId === id).map(l => l.idProduct);
        if (ps.length) await cx.db.collection('cartes').updateOne({ _id: id }, { $pull: { 'liens.idProduct': { $in: ps } } });
    }
    for (const l of lignes) await cx.db.collection('restes').updateOne({ set: l.slugSet, type: 'carte-sans-nom', idProduct: l.idProduct, carteId: l.carteId },
        { $set: { detail: `${l.idProduct} « ${l.slug} » : joint par ${l.preuve} à « ${titre.get(l.carteId)} », une page sans nom (homonymie ou ébauche) — ce n'est pas une carte ; détachée par detacher-cartes-sans-nom.js`, le: new Date() } }, { upsert: true });
    const encore = await cx.db.collection('cartes_produits').countDocuments({ carteId: { $in: [...titre.keys()] } });
    console.log(`\n   ✅ détachées : ${r.deletedCount} (attendu ${lignes.length}) · encore présentes : ${encore} · ${lignes.length} restes « carte-sans-nom » écrits`);
    await fermer();
    if (r.deletedCount !== lignes.length || encore) process.exit(1);
})().catch(e => { console.error('❌', e.message); process.exit(1); });
