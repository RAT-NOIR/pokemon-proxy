// ============================================================
// `cartes.sets` DEPUIS LA JOINTURE : une carte jointe à un produit d'un set est membre de ce set (2026-09-24)
// ============================================================
//   node rattacher-sets-depuis-jointure.js            (simulation)
//   node lot-additif.js --quoi="…" --collections=cartes -- node rattacher-sets-depuis-jointure.js --ecrire
//
// Le site construit un set depuis `cartes.sets` : une ligne de `cartes_produits` dont la carte ne porte pas le set n'est
// servie nulle part. Le critère est celui du §47 — `cartes_produits` dit « ce produit, du set S, est cette carte » — et il
// ne touche qu'un set qui EXISTE dans `sets`. Mesuré le 2026-09-24 : 75 produits d'Unnumbered Promos (4170), joints par
// le nom seul (e9e84ab) sans que l'outil pose l'appartenance. Ajout pur ($addToSet).
require('dotenv').config();
const { ouvrirConnexions } = require('./collecte-cartes/garde');

const AUTORISES = [/^--ecrire$/];
const inconnus = process.argv.slice(2).filter(a => !AUTORISES.some(r => r.test(a)));
if (inconnus.length) { console.error(`❌ argument inconnu : ${inconnus.join(' ')} — autorisé : --ecrire`); process.exit(2); }
const ecrire = process.argv.includes('--ecrire');

(async () => {
    const { cartes: cx, fermer } = await ouvrirConnexions({ production: false, buckets: [] });
    const setsConnus = new Set(await cx.db.collection('sets').distinct('_id'));
    const setsDe = new Map((await cx.db.collection('cartes').find({}, { projection: { sets: 1 } }).toArray()).map(c => [c._id, new Set(c.sets || [])]));
    const lignes = await cx.db.collection('cartes_produits').find({}, { projection: { carteId: 1, slugSet: 1, preuve: 1 } }).toArray();
    const aPoser = new Map(), parSet = {}, parPreuve = {};
    let horsSets = 0, sansCarte = 0;
    for (const l of lignes) {
        if (!l.slugSet || !setsConnus.has(l.slugSet)) { horsSets++; continue; }
        const s = setsDe.get(l.carteId); if (!s) { sansCarte++; continue; }
        if (s.has(l.slugSet)) continue;
        const k = `${l.carteId}|${l.slugSet}`; if (aPoser.has(k)) continue;
        aPoser.set(k, l); parSet[l.slugSet] = (parSet[l.slugSet] || 0) + 1; parPreuve[l.preuve] = (parPreuve[l.preuve] || 0) + 1;
    }
    console.log(`\n════ DÉNOMINATEUR : ${lignes.length} lignes de jointure · set absent de sets ${horsSets} · carte absente ${sansCarte} ════`);
    console.log(`   appartenances à poser : ${aPoser.size} · par set ${JSON.stringify(parSet)} · par preuve ${JSON.stringify(parPreuve)}`);
    if (!ecrire) { console.log('\n   (simulation — --ecrire, sous lot-additif.js)'); await fermer(); return; }
    let n = 0;
    for (const l of aPoser.values()) n += (await cx.db.collection('cartes').updateOne({ _id: l.carteId }, { $addToSet: { sets: l.slugSet } })).modifiedCount;
    console.log(`\n   ✅ posées : ${n}/${aPoser.size}`);
    await fermer();
    if (n !== aPoser.size) process.exit(1);
})().catch(e => { console.error('❌', e.message); process.exit(1); });
