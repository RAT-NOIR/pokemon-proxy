// ============================================================
// SAUVEGARDE CIBLÉE DE CHAMPS DE LA BASE `cartes` — LECTURE SEULE
// ============================================================
//   node sauvegarder-champs-cartes.js --collection=cartes --champs=images --dossier=backup-...
//   node sauvegarder-champs-cartes.js --collection=cartes --champs=sets,images
//
// 🔴 POURQUOI CET OUTIL EXISTE, ET C'EST UN DÉFAUT TROUVÉ LE 2026-09-21 : `backup-collections.js`
// passe par `connecterMongo`, qui ouvre la base de PRODUCTION (`test`). **Il ne sait pas sauvegarder
// la base `cartes`**, qui vit sur une autre grappe — c'est-à-dire exactement la base que toutes nos
// écritures de collecte touchent. Lancé avec `--base=cartes`, il répond « collection(s)
// introuvable(s) » ; lancé sans y penser, il aurait rendu un dossier d'apparence normale.
// ⚠️ **Une sauvegarde qu'on croit avoir est pire que pas de sauvegarde** : elle ne se découvre
// fausse qu'au moment de restaurer, c'est-à-dire trop tard — le testeur l'a déjà écrit une fois, au
// sujet du `--collections` par défaut (CLAUDE.md §3).
//
// 🔑 ET ON NE SAUVEGARDE PAS TOUT : on sauvegarde LE CHAMP QU'ON S'APPRÊTE À ÉCRIRE, avec son `_id`.
// C'est ce qui rend la restauration exacte (un `$set` du champ sauvé, rien d'autre) et le fichier
// petit assez pour être relu. Le dénominateur est imprimé, et le nombre de documents PORTEURS du
// champ aussi : un export de 0 porteur sur 40 000 est une clé fausse, pas une base vide (§41).
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { ouvrirConnexions } = require('./collecte-cartes/garde');
const { champSur } = require('./collecte-cartes/lecture-sure');

const arg = n => (process.argv.find(a => a.startsWith(`--${n}=`)) || '').split('=').slice(1).join('=');

(async () => {
    const collection = arg('collection');
    const champs = (arg('champs') || '').split(',').map(s => s.trim()).filter(Boolean);
    if (!collection || !champs.length) {
        console.error('❌ `--collection=` et `--champs=` sont obligatoires — ce script ne devine rien.');
        process.exit(1);
    }
    const dossier = arg('dossier') || `backup-cartes-${new Date().toISOString().slice(0, 10)}`;
    const { cartes: cx, fermer } = await ouvrirConnexions({ production: false, buckets: [] });
    const col = cx.db.collection(collection);
    const total = await col.countDocuments({});
    if (!total) { console.error(`❌ la collection « ${collection} » est VIDE — rien à sauvegarder, et ce n'est pas normal.`); process.exit(1); }

    const projection = { _id: 1 };
    for (const c of champs) projection[c] = 1;
    const filtre = { $or: champs.map(c => ({ [c]: { $exists: true } })) };
    const docs = await col.find(filtre, { projection }).toArray();
    console.log(`\n════ DÉNOMINATEUR : ${total} documents dans « ${collection} » ════`);
    console.log(`   portent au moins un des champs ${champs.join(', ')} : ${docs.length}`);
    for (const c of champs) champSur(docs, c, { collection: `${collection} (export)` });

    fs.mkdirSync(dossier, { recursive: true });
    const fichier = path.join(dossier, `${collection}.${champs.join('-')}.json`);
    fs.writeFileSync(fichier, JSON.stringify({
        base: cx.db.databaseName, collection, champs, le: new Date().toISOString(),
        documentsDansLaCollection: total, documentsExportes: docs.length, docs
    }));
    const o = fs.statSync(fichier).size;
    console.log(`   ✅ écrit ${fichier} — ${(o / 1048576).toFixed(1)} Mo`);
    console.log(`   🔑 pour restaurer : un $set du champ sauvé sur chaque _id, rien d'autre.`);
    await fermer();
})().catch(e => { console.error(e); process.exit(1); });
