// ============================================================
// LIRE DES SETS TCGdex DANS LE CACHE — les cartes (et leurs images déclarées) de sets nommés, sous le verrou TCGdex (2026-09-26)
// ============================================================
//   node lire-sets-tcgdex.js --sets=pl4,sma,tk-xy-n        (lit ce qui n'est pas en cache ; un set lu ne se redemande pas)
//
// Pourquoi : l'audit occidental range en « à confirmer » les cartes des sets que TCGdex porte sous un AUTRE découpage (Arceus
// `pl4`, Shiny Vault `sma`, demi-decks des Trainer Kits `tk-*`) : leurs cartes n'ont jamais été lues. Une lecture tranche
// b (TCGdex déclare le scan) ou c (TCGdex n'a pas d'image). Aucune image n'est téléchargée ici — le worker est le seul
// collecteur. Le client est celui de la production (collecte-cartes/tcgdex.js : cadence, un réessai, garde fermée sans
// verrou) et l'écriture est celle du cache (`cartesEn`, tcgdex_sets) : un document neuf par set, additif.
require('dotenv').config();
const arg = (process.argv.find(a => a.startsWith('--sets=')) || '').slice(7);
const inconnus = process.argv.slice(2).filter(a => !/^--sets=[\w.,-]+$/.test(a));
if (inconnus.length || !arg) { console.error(`❌ usage : node lire-sets-tcgdex.js --sets=pl4,sma — reçu : ${process.argv.slice(2).join(' ') || '(rien)'}`); process.exit(2); }
const { ouvrirConnexions } = require('./collecte-cartes/garde');
const { modeles } = require('./collecte-cartes/schemas');
const { fabriquerVerrou } = require('./collecte-cartes/verrou-source');
const { fabriquerClient, VERROU_GLOBAL, VERROU_GLOBAL_MS } = require('./collecte-cartes/tcgdex');
const { cartesEn } = require('./collecte-cartes/tcgdex-cache');

(async () => {
    const ids = [...new Set(arg.split(',').filter(Boolean))];
    const { cartes: cx, fermer } = await ouvrirConnexions({ production: false, buckets: [] });
    const M = modeles(cx), db = cx.db;
    const liste = (await db.collection('tcgdex_sets').findOne({ _id: 'en/__liste__' }))?.sets || [];
    const inconnusListe = ids.filter(id => !liste.some(s => s.id === id));
    if (inconnusListe.length) { console.error(`❌ absents de la liste TCGdex en cache (${liste.length} sets) : ${inconnusListe.join(', ')}`); await fermer(); process.exit(1); }
    const deja = new Set((await db.collection('tcgdex_sets').find({ _id: { $in: ids.map(i => `en/${i}`) }, cartes: { $type: 'array' } }, { projection: { _id: 1 } }).toArray()).map(d => d._id.slice(3)));
    const aLire = ids.filter(i => !deja.has(i));
    console.log(`DÉNOMINATEUR : ${ids.length} sets demandés · ${deja.size} déjà en cache · ${aLire.length} à lire`);
    if (aLire.length) {
        const vt = fabriquerVerrou({ Modele: M.EtatImages, id: VERROU_GLOBAL, dureeMs: VERROU_GLOBAL_MS, surInsertion: { phase: 'lecture-sets' }, nom: 'verrou global tcgdex (lecture de sets)' });
        for (let essai = 0; ; essai++) {
            const t = await vt.prendre();
            if (!t) break;
            if (essai === 0) console.log(`⏳ verrou tcgdex tenu par pid ${t.pid} sur ${t.hote} — j'attends (2 s entre deux essais, 20 min au plus).`);
            if (essai > 600) { console.error('❌ verrou tcgdex non obtenu en 20 min — rien lu'); await fermer(); process.exit(1); }
            await new Promise(r => setTimeout(r, 2000));
        }
        const client = fabriquerClient({ verrou: vt });
        try { for (const id of aLire) { const r = await cartesEn(db, client, id); console.log(`   ${id} : ${r.cartes.length} cartes lues`); } }
        finally { await vt.rendre(); }
    }
    for (const id of ids) {
        const d = await db.collection('tcgdex_sets').findOne({ _id: `en/${id}` }, { projection: { cartes: 1 } });
        const c = d?.cartes || [];
        console.log(`   ${id.padEnd(12)} ${c.length} cartes · ${c.filter(x => x.image).length} déclarent une image`);
    }
    await fermer();
})().catch(e => { console.error(e); process.exit(1); });
