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
// ➕ 2026-10-04 (demande du testeur : « les 13 rattachements » du cliquet du site, LISTE-EXPANSIONS-SANS-PAGE.json) :
//   --sets=A,B   seulement ces sets ;
//   LE TÉMOIN — une seconde preuve, indépendante de la jointure : la carte DÉCLARE une impression de ce set (même tirage que le set,
//   expansion au nom du set : bulba.expansion, nomEn, nomCardmarket ou nomAffichage). Imprimé par set ; --exiger-temoin n'écrit que les
//   appartenances que les DEUX preuves portent (la jointure seule a été mesurée juste au §47 ; le témoin la confirme sans la remplacer).
require('dotenv').config();
const { ouvrirConnexions } = require('./collecte-cartes/garde');

const AUTORISES = [/^--ecrire$/, /^--sets=[\w.,-]+$/, /^--exiger-temoin$/];
const inconnus = process.argv.slice(2).filter(a => !AUTORISES.some(r => r.test(a)));
if (inconnus.length) { console.error(`❌ argument inconnu : ${inconnus.join(' ')} — autorisés : --ecrire, --sets=A,B, --exiger-temoin`); process.exit(2); }
const ecrire = process.argv.includes('--ecrire');
const SEULS = process.argv.find(a => a.startsWith('--sets='))?.slice(7).split(',').filter(Boolean) ?? null;
const EXIGER = process.argv.includes('--exiger-temoin');
const plat = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');

(async () => {
    const { cartes: cx, fermer } = await ouvrirConnexions({ production: false, buckets: [] });
    const docsSets = new Map((await cx.db.collection('sets').find({}, { projection: { tirage: 1, region: 1, nomEn: 1, nomAffichage: 1, nomCardmarket: 1, 'bulba.expansion': 1 } }).toArray()).map(s => [s._id, s]));
    const setsConnus = new Set(docsSets.keys());
    if (SEULS) { const absents = SEULS.filter(s => !setsConnus.has(s)); if (absents.length) { console.error(`❌ --sets : absents de la base : ${absents.join(', ')}`); await fermer(); process.exit(2); } }
    const cartes = new Map((await cx.db.collection('cartes').find({}, { projection: { sets: 1, 'impressions.tirage': 1, 'impressions.expansion': 1 } }).toArray()).map(c => [c._id, c]));
    const lignes = await cx.db.collection('cartes_produits').find({}, { projection: { carteId: 1, slugSet: 1, preuve: 1 } }).toArray();
    const temoin = (carte, slug) => {
        const s = docsSets.get(slug), tirage = s.tirage ?? s.region;
        const noms = new Set([s.bulba?.expansion, s.nomEn, s.nomCardmarket, s.nomAffichage].filter(Boolean).map(plat));
        return (carte.impressions || []).some(i => i.tirage === tirage && noms.has(plat(i.expansion)));
    };
    const aPoser = new Map(), parSet = {}, parPreuve = {}, temoins = {};
    let horsSets = 0, sansCarte = 0, horsPerimetre = 0;
    for (const l of lignes) {
        if (!l.slugSet || !setsConnus.has(l.slugSet)) { horsSets++; continue; }
        if (SEULS && !SEULS.includes(l.slugSet)) { horsPerimetre++; continue; }
        const c = cartes.get(l.carteId); if (!c) { sansCarte++; continue; }
        if ((c.sets || []).includes(l.slugSet)) continue;
        const k = `${l.carteId}|${l.slugSet}`; if (aPoser.has(k)) continue;
        const t = temoin(c, l.slugSet);
        (temoins[l.slugSet] ??= { avec: 0, sans: 0 })[t ? 'avec' : 'sans']++;
        if (EXIGER && !t) continue;
        aPoser.set(k, l); parSet[l.slugSet] = (parSet[l.slugSet] || 0) + 1; parPreuve[l.preuve] = (parPreuve[l.preuve] || 0) + 1;
    }
    console.log(`\n════ DÉNOMINATEUR : ${lignes.length} lignes de jointure · set absent de sets ${horsSets} · carte absente ${sansCarte}${SEULS ? ` · hors des ${SEULS.length} sets demandés ${horsPerimetre}` : ''} ════`);
    console.log(`   TÉMOIN (la carte déclare une impression de ce set) : ${Object.entries(temoins).map(([s, t]) => `${s} ${t.avec}/${t.avec + t.sans}`).join(' · ')}`);
    console.log(`   appartenances à poser${EXIGER ? ' (jointure ET témoin)' : ''} : ${aPoser.size} · par set ${JSON.stringify(parSet)} · par preuve ${JSON.stringify(parPreuve)}`);
    if (!ecrire) { console.log('\n   (simulation — --ecrire, sous lot-additif.js)'); await fermer(); return; }
    let n = 0;
    for (const l of aPoser.values()) n += (await cx.db.collection('cartes').updateOne({ _id: l.carteId }, { $addToSet: { sets: l.slugSet } })).modifiedCount;
    // RELU, pas supposé : chaque appartenance posée est en base
    const relues = (await Promise.all([...aPoser.values()].map(l => cx.db.collection('cartes').countDocuments({ _id: l.carteId, sets: l.slugSet })))).reduce((a, b) => a + b, 0);
    console.log(`\n   ${n === aPoser.size && relues === aPoser.size ? '✅' : '🔴'} posées : ${n}/${aPoser.size} · RELUES en base : ${relues}/${aPoser.size}`);
    if (relues !== aPoser.size) process.exitCode = 1;
    await fermer();
    if (n !== aPoser.size) process.exit(1);
})().catch(e => { console.error('❌', e.message); process.exit(1); });
