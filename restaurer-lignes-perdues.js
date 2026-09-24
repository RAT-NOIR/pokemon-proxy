// ============================================================
// RESTAURER LES LIGNES DE JOINTURE EFFACÉES PAR UN LOT — depuis la sauvegarde prise avant lui (2026-09-24)
// ============================================================
//   node restaurer-lignes-perdues.js --depuis=backup-…            (mesure : les lignes de la sauvegarde absentes aujourd'hui)
//   node restaurer-lignes-perdues.js --depuis=backup-… --ecrire   (les réinsère À L'IDENTIQUE, et reporte leurs liens)
//
// `collecteur-texte.js --reparser` effaçait les lignes Base Set / Base Set 2 des cartes d'un set occidental ou chinois sans
// les réécrire (corrigé : la condition d'effacement est celle de la réécriture). Cet outil rend ce qu'un lot a retiré par
// accident : il n'insère QUE des lignes absentes (même `_id`), telles que la sauvegarde les porte, et n'en modifie aucune.
// `--expansions=1523,1527` borne la restauration aux expansions nommées — un lot qui a retiré une ligne VOLONTAIREMENT
// (un témoin, une correction) ne doit pas la voir revenir.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { ouvrirConnexions } = require('./collecte-cartes/garde');
const { EJSON } = require('mongodb').BSON;

const AUTORISES = [/^--depuis=backup-[\w-]+$/, /^--ecrire$/, /^--expansions=\d+(,\d+)*$/];
const inconnus = process.argv.slice(2).filter(a => !AUTORISES.some(r => r.test(a)));
const depuis = process.argv.find(a => a.startsWith('--depuis='))?.slice(9);
const exps = process.argv.find(a => a.startsWith('--expansions='))?.slice(13).split(',').map(Number) || null;
if (inconnus.length || !depuis || !exps) { console.error(`❌ ${inconnus.length ? `argument inconnu : ${inconnus.join(' ')} — ` : ''}usage : --depuis=backup-… --expansions=A,B [--ecrire]`); process.exit(2); }

(async () => {
    const ecrire = process.argv.includes('--ecrire');
    // EJSON : une Date sauvée revient Date (backup-collections.js écrit l'Extended JSON depuis le 24/09 ; lit aussi l'ancien).
    const avant = EJSON.parse(fs.readFileSync(path.join(__dirname, depuis, 'cartes_produits.json'), 'utf8'), { relaxed: true });
    if (!avant.length) throw new Error(`${depuis}/cartes_produits.json VIDE : rien ne peut s'en restaurer`);
    const { cartes: cx, fermer } = await ouvrirConnexions({ production: false, buckets: [] });
    const CP = cx.db.collection('cartes_produits');
    const presents = new Set((await CP.find({}).project({ _id: 1 }).toArray()).map(l => String(l._id)));
    const perdues = avant.filter(l => !presents.has(String(l._id)) && exps.includes(l.idExpansion));
    console.log(`\n════ ${depuis} : ${avant.length} lignes · aujourd'hui ${presents.size} · absentes dans les expansions ${exps.join(', ')} : ${perdues.length} ════`);
    for (const l of perdues) console.log(`   ${l._id} produit ${l.idProduct} → carte ${l.carteId} exp ${l.idExpansion} (${l.preuve})`);
    if (!ecrire) { console.log('\n   (mesure seule — --ecrire réinsère)'); await fermer(); return; }
    let inserees = 0;
    for (const l of perdues) {
        const r = await CP.updateOne({ _id: l._id }, { $setOnInsert: l }, { upsert: true });
        inserees += r.upsertedCount;
        await cx.db.collection('cartes').updateOne({ _id: l.carteId }, { $addToSet: { 'liens.idProduct': l.idProduct } });
    }
    const relu = await CP.countDocuments({ _id: { $in: perdues.map(l => l._id) } });
    console.log(`   RELU : ${inserees} réinsérées · ${relu}/${perdues.length} présentes ${relu === perdues.length ? '✅' : '🔴'}`);
    await fermer();
    if (relu !== perdues.length) process.exit(1);
})().catch(e => { console.error('❌', e.message); process.exit(1); });
