// ============================================================
// `sets.tirage` : LA CLÉ EXACTE DES IMPRESSIONS D'UN SET (2026-09-24)
// ============================================================
//   node poser-tirage-sets.js            (simulation)
//   node lot-additif.js --quoi="…" --collections=sets -- node poser-tirage-sets.js --ecrire
//
// `sets.region` ne vaut que `jp` ou `intl` : collecteur-texte.js écrit `intl` pour tout tirage non japonais, et le site en
// fait la clé des impressions (`imp.tirage === set.region`). Pour les 82 sets chinois, indonésiens et thaïs, cette clé ne
// peut rien trouver : leurs impressions ont pour tirage `zh-hans`, `id`, `th`… (le parseur, 9f5353b ; la Setlist,
// jointure.js). Le tirage vit sur la LIGNE de table : c'est lui qu'on écrit, sans toucher `region`. Ajout pur.
// Un set dont les lignes ne disent pas le même tirage, ou dont la région contredit le tirage, n'est pas écrit : imprimé.
require('dotenv').config();
const { ouvrirConnexions } = require('./collecte-cartes/garde');
const { TABLE, TABLE_AUTO, TABLE_SANS_PAGE } = require('./collecte-cartes/table-sets');

const AUTORISES = [/^--ecrire$/];
const inconnus = process.argv.slice(2).filter(a => !AUTORISES.some(r => r.test(a)));
if (inconnus.length) { console.error(`❌ argument inconnu : ${inconnus.join(' ')} — autorisé : --ecrire`); process.exit(2); }
const ecrire = process.argv.includes('--ecrire');

(async () => {
    const { cartes: cx, fermer } = await ouvrirConnexions({ production: false, buckets: [] });
    const tirages = new Map();   // slugSet → Set des tirages de ses lignes
    for (const l of [...TABLE, ...TABLE_AUTO, ...TABLE_SANS_PAGE]) if (l.slugSet && l.bulba) (tirages.get(l.slugSet) || tirages.set(l.slugSet, new Set()).get(l.slugSet)).add(l.bulba.tirage || 'jp');
    const sets = await cx.db.collection('sets').find({}, { projection: { region: 1, tirage: 1 } }).toArray();
    const plan = [], refus = [], parTirage = {};
    let sansLigne = 0, deja = 0;
    for (const s of sets) {
        const t = tirages.get(s._id);
        if (!t) { sansLigne++; continue; }
        if (t.size > 1) { refus.push(`${s._id} : lignes de tirages différents (${[...t].join(', ')})`); continue; }
        const tirage = [...t][0];
        if ((tirage === 'jp') !== (s.region === 'jp')) { refus.push(`${s._id} : région ${s.region}, tirage de la ligne ${tirage}`); continue; }
        if (s.tirage === tirage) { deja++; continue; }
        if (s.tirage != null) { refus.push(`${s._id} : porte déjà tirage ${s.tirage}, la ligne dit ${tirage} — non réécrit`); continue; }
        plan.push({ _id: s._id, tirage });
        parTirage[tirage] = (parTirage[tirage] || 0) + 1;
    }
    console.log(`\n════ DÉNOMINATEUR : ${sets.length} sets · sans ligne de table ${sansLigne} · déjà écrits ${deja} ════`);
    console.log(`   à écrire : ${plan.length} · par tirage ${JSON.stringify(parTirage)}`);
    console.log(`   refusés : ${refus.length}${refus.length ? '\n      ' + refus.join('\n      ') : ''}`);
    if (!ecrire) { console.log('\n   (simulation — --ecrire, sous lot-additif.js)'); await fermer(); return; }
    let n = 0;
    for (const p of plan) n += (await cx.db.collection('sets').updateOne({ _id: p._id, tirage: { $exists: false } }, { $set: { tirage: p.tirage } })).modifiedCount;
    const relus = await cx.db.collection('sets').countDocuments({ tirage: { $exists: true } });
    console.log(`\n   ✅ écrits : ${n}/${plan.length} · sets portant un tirage, relu : ${relus}`);
    await fermer();
    if (n !== plan.length) process.exit(1);
})().catch(e => { console.error('❌', e.message); process.exit(1); });
