// ============================================================
// LE TABLEAU DES 28 — les quatre nombres de complétude par set, et les restes par type
// ============================================================
//   node collecte-cartes/tableau-completude.js   (lecture seule sur la base `cartes`)
// Imprime en Markdown, dénominateurs en tête, depuis `sets.complet` écrit par collecteur-texte.js.

require('dotenv').config();
const mongoose = require('mongoose');
const { TABLE } = require('./table-sets');

(async () => {
    if (process.env.MONGODB_CARTES_BASE !== 'cartes' || !process.env.MONGODB_CARTES_URI) { console.error('❌ MONGODB_CARTES_BASE=cartes et MONGODB_CARTES_URI requis.'); process.exit(1); }
    const cx = await mongoose.createConnection(process.env.MONGODB_CARTES_URI, { dbName: 'cartes' }).asPromise();
    const sets = new Map((await cx.db.collection('sets').find({}).toArray()).map(s => [s._id, s]));
    const restes = await cx.db.collection('restes').find({}).toArray();
    const nCartes = await cx.db.collection('cartes').countDocuments();
    const nLignes = await cx.db.collection('cartes_produits').countDocuments({ tirage: 'jp' });
    const nIntl = await cx.db.collection('cartes_produits').countDocuments({ tirage: 'intl' });
    console.log(`dénominateur : ${TABLE.length} sets dans la table, ${sets.size} collectés, ${nCartes} cartes en base, ${nLignes} lignes de jointure japonaises, ${nIntl} occidentales en bonus\n`);
    console.log('| set | Setlist | pages | cartes | produits = joints + restes | concordance | preuves | restes |');
    console.log('|---|---|---|---|---|---|---|---|');
    let concordants = 0, totalProduits = 0, totalJoints = 0;
    for (const L of TABLE) {
        const s = sets.get(L.slugSet);
        const c = s?.complet;
        if (!c) { console.log(`| ${L.code} | — | — | — | ${L.prod} = — | non collecté | | |`); continue; }
        const produitsRestes = c.restes?.['produit-sans-carte'] || 0;
        if (c.concordance) concordants++;
        totalProduits += c.produits; totalJoints += c.produitsJoints;
        const preuves = Object.entries(c.preuves || {}).map(([k, v]) => `${k} ${v}`).join(', ');
        const r = Object.entries(c.restes || {}).map(([k, v]) => `${k} ${v}`).join(', ') || '—';
        console.log(`| ${L.code} | ${c.setlist ?? c.titresLies} (jacards ${c.infobox ?? '—'}) | ${c.pagesDistinctes} | ${c.cartesEcrites} | ${c.produits} = ${c.produitsJoints} + ${produitsRestes} | ${c.concordance ? '✅' : '❌'} | ${preuves} | ${r} |`);
    }
    console.log(`\n${concordants} sets concordants sur ${sets.size} collectés ; produits joints ${totalJoints} / ${totalProduits}\n`);
    const parSetType = {};
    for (const r of restes) { const k = `${r.set} · ${r.type}`; (parSetType[k] = parSetType[k] || []).push(r.detail); }
    if (Object.keys(parSetType).length) {
        console.log('## Restes, listés, jamais résolus\n');
        for (const [k, l] of Object.entries(parSetType).sort()) { console.log(`- **${k}** (${l.length})`); for (const d of l.slice(0, 12)) console.log(`  - ${d}`); if (l.length > 12) console.log(`  - … ${l.length - 12} de plus`); }
    } else console.log('Aucun reste.');
    await cx.close();
})().catch(e => { console.error(e); process.exit(1); });
