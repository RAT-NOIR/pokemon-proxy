// ============================================================
// RÉTABLIR LE TYPE Date D'UN CHAMP ÉCRIT EN CHAÎNE PAR UNE RESTAURATION (2026-09-24)
// ============================================================
//   node retablir-dates.js --collection=cartes_produits --champ=verifieLe            (mesure)
//   node retablir-dates.js --collection=cartes_produits --champ=verifieLe --ecrire
//
// backup-collections.js écrivait `JSON.stringify` jusqu'au 24/09 : une Date sauvée revenait CHAÎNE, et
// restaurer-lignes-perdues.js a réinséré 24 lignes avec `verifieLe: "2026-09-20T00:31:12.743Z"`. Même instant, autre type :
// un tri, un `$gte` ou un `$type: 'date'` ne les voit plus. Cet outil ne rend que le type : il n'écrit que des chaînes qui
// se relisent en une date ISO exacte (aller-retour identique), et rien d'autre.
require('dotenv').config();
const { ouvrirConnexions } = require('./collecte-cartes/garde');

const AUTORISES = [/^--collection=(cartes_produits|cartes|sets|restes|collecte_etat)$/, /^--champ=[\w.]+$/, /^--ecrire$/];
const inconnus = process.argv.slice(2).filter(a => !AUTORISES.some(r => r.test(a)));
const val = n => process.argv.find(a => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const coll = val('collection'), champ = val('champ');
if (inconnus.length || !coll || !champ || champ.includes('.')) { console.error(`❌ ${inconnus.length ? `argument inconnu : ${inconnus.join(' ')} — ` : ''}usage : --collection=… --champ=<champ de premier niveau> [--ecrire]`); process.exit(2); }

(async () => {
    const { cartes: cx, fermer } = await ouvrirConnexions({ production: false, buckets: [] });
    const C = cx.db.collection(coll);
    const total = await C.countDocuments({ [champ]: { $exists: true } });
    const docs = await C.find({ [champ]: { $type: 'string' } }).project({ [champ]: 1 }).toArray();
    const sures = docs.filter(d => { const t = new Date(d[champ]); return !isNaN(t) && t.toISOString() === d[champ]; });
    console.log(`\n════ ${coll}.${champ} : ${docs.length} en chaîne sur ${total} documents qui portent le champ · ${sures.length} se relisent en une date ISO exacte ════`);
    if (sures.length !== docs.length) console.log(`   ⚠️ ${docs.length - sures.length} ne sont pas des dates ISO exactes : non touchées (${docs.filter(d => !sures.includes(d)).slice(0, 5).map(d => JSON.stringify(d[champ])).join(', ')})`);
    if (!process.argv.includes('--ecrire')) { console.log('   (mesure seule — --ecrire rétablit le type)'); await fermer(); return; }
    let n = 0;
    for (const d of sures) n += (await C.updateOne({ _id: d._id, [champ]: d[champ] }, { $set: { [champ]: new Date(d[champ]) } })).modifiedCount;
    const encore = await C.countDocuments({ [champ]: { $type: 'string' } });
    console.log(`   ✅ ${n} rétablis en Date (attendu ${sures.length}) · encore en chaîne : ${encore}`);
    await fermer();
    if (n !== sures.length) process.exit(1);
})().catch(e => { console.error('❌', e.message); process.exit(1); });
