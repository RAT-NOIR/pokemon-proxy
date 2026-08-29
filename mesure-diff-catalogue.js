// ============================================================================
// LE DIFF D'UN NOUVEL EXPORT CARDMARKET — AVANT DE L'IMPORTER, PAS APRÈS
// ============================================================================
// `import-catalogue.js` dit « Import terminé » et ne dit rien de ce qu'il a changé.
// Cet outil dit ce qu'il CHANGERAIT, pour qu'on décide en connaissance de cause.
//
// ⚠️ IL N'IMPORTE RIEN. Lecture seule des deux côtés, aucune écriture, aucune option
// pour en faire. L'import reste `import-catalogue.js`, lancé à la main, après.
//
// 🔴 CE QUI REND CET OUTIL NÉCESSAIRE. `import-catalogue.js` fait un `updateOne` +
// `upsert` : il n'efface jamais. Un produit RETIRÉ du catalogue Cardmarket reste donc en
// base pour toujours, et rien ne le signale. Il faut le voir avant, pas le découvrir dans
// six mois en cherchant pourquoi un vivier contient une carte qui n'existe plus.
//
// ⚠️ ET IL RELÈVE LES 26 DIVERGENCES D'idExpansion AVANT/APRÈS. `numeros_cartes` porte sa
// propre copie d'`idExpansion` et l'import ne la met pas à jour : chaque reclassement
// d'expansion chez Cardmarket creuse l'écart en silence. La liste doit être prise avant
// l'import et reprise après ; tout écart NOUVEAU est un défaut, pas une surprise.
//
// USAGE :
//   node mesure-diff-catalogue.js --base=test <nouveau.json> [ancien.json]
//     nouveau.json : l'export fraîchement téléchargé
//     ancien.json  : facultatif — products_singles_6.json, pour vérifier que la base
//                    correspond bien à l'ancien fichier avant de conclure quoi que ce soit
const fs = require('fs');
const path = require('path');
require('dotenv').config();
const { connecterMongo } = require('./mongo-connexion');
const mongoose = require('mongoose');

const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
const NOUVEAU = args[0];
const ANCIEN = args[1] || null;
const RACINE = process.env.RACINE_IMAGES || 'C:\\Users\\Yung\\Desktop\\CARDMARKET IMAGE';
const EST_CARTE = /^(\d+)\.(jpe?g|png|webp)$/i;
const pc = (n, d) => d ? `${(100 * n / d).toFixed(1)} %` : '—';

function lireExport(f) {
    const brut = JSON.parse(fs.readFileSync(f, 'utf8'));
    const produits = brut.products || [];
    return { createdAt: brut.createdAt, produits, parId: new Map(produits.map(p => [p.idProduct, p])) };
}

(async () => {
    if (!NOUVEAU) {
        console.error('Usage : node mesure-diff-catalogue.js --base=test <nouveau.json> [ancien.json]');
        process.exit(1);
    }
    if (!fs.existsSync(NOUVEAU)) { console.error(`🔴 fichier introuvable : ${NOUVEAU}`); process.exit(1); }
    const neuf = lireExport(NOUVEAU);
    console.log('═'.repeat(96));
    console.log('LE NOUVEL EXPORT');
    console.log('═'.repeat(96));
    console.log(`   fichier ....... ${path.basename(NOUVEAU)}`);
    console.log(`   créé le ....... ${neuf.createdAt}`);
    console.log(`   produits ...... ${neuf.produits.length}`);

    await connecterMongo({ script: 'mesure-diff-catalogue.js', ecrit: false });
    const CAT = mongoose.connection.collection('catalogue_produits');
    const NUM = mongoose.connection.collection('numeros_cartes');
    const enBase = new Map();
    for (const p of await CAT.find({}, { projection: { idProduct: 1, name: 1, idExpansion: 1, idMetacard: 1 } }).toArray())
        enBase.set(p.idProduct, p);
    console.log(`   en base ....... ${enBase.size}`);

    // ⚠️ CONTRÔLE PRÉALABLE : la base correspond-elle bien à l'ancien fichier ? Si elle a
    // dérivé, le diff mesurerait deux changements à la fois et on ne saurait pas lequel.
    if (ANCIEN && fs.existsSync(ANCIEN)) {
        const vieux = lireExport(ANCIEN);
        let ecart = 0;
        for (const [id, p] of vieux.parId) {
            const b = enBase.get(id);
            if (!b || b.name !== p.name || b.idExpansion !== p.idExpansion || b.idMetacard !== p.idMetacard) ecart++;
        }
        const enTrop = [...enBase.keys()].filter(id => !vieux.parId.has(id)).length;
        console.log(`\n   contrôle contre ${path.basename(ANCIEN)} (créé le ${vieux.createdAt}) :`);
        console.log(`      lignes de l'ancien fichier absentes ou différentes en base : ${ecart}`);
        console.log(`      produits en base absents de l'ancien fichier .............. ${enTrop}`);
        console.log(`      -> ${ecart === 0 && enTrop === 0 ? '✅ la base EST l\'ancien fichier. Le diff ci-dessous ne mesure qu\'une chose.'
            : '⚠️ la base a dérivé de l\'ancien fichier : le diff mêle deux changements.'}`);
    }

    // ── LE DIFF ─────────────────────────────────────────────────────────────
    const nouveaux = [], nomChange = [], expChange = [], metaChange = [];
    for (const [id, p] of neuf.parId) {
        const b = enBase.get(id);
        if (!b) { nouveaux.push(p); continue; }
        if (b.name !== p.name) nomChange.push({ id, avant: b.name, apres: p.name });
        if (b.idExpansion !== p.idExpansion) expChange.push({ id, avant: b.idExpansion, apres: p.idExpansion, nom: p.name });
        if (b.idMetacard !== p.idMetacard) metaChange.push({ id, avant: b.idMetacard, apres: p.idMetacard });
    }
    const disparus = [...enBase.values()].filter(p => !neuf.parId.has(p.idProduct));

    console.log('\n' + '═'.repeat(96));
    console.log('CE QUE L\'IMPORT CHANGERAIT');
    console.log('═'.repeat(96));
    console.log(`   produits NOUVEAUX (insérés) ............... ${nouveaux.length}`);
    console.log(`   noms CHANGÉS .............................. ${nomChange.length}`);
    console.log(`   idExpansion CHANGÉES ...................... ${expChange.length}`);
    console.log(`   idMetacard CHANGÉS ........................ ${metaChange.length}`);
    console.log(`   🔴 produits DISPARUS du catalogue Cardmarket ${disparus.length}`);
    console.log(`      (l'import NE LES SUPPRIME PAS : ils resteront en base)`);
    for (const d of disparus.slice(0, 15)) console.log(`         ${String(d.idProduct).padEnd(8)} « ${String(d.name).slice(0, 55)} »`);
    if (disparus.length > 15) console.log(`         … +${disparus.length - 15}`);
    for (const [titre, liste, format] of [
        ['les 15 premiers NOMS changés', nomChange, x => `${String(x.id).padEnd(8)} « ${String(x.avant).slice(0, 34)} » -> « ${String(x.apres).slice(0, 34)} »`],
        ['les 15 premières idExpansion changées', expChange, x => `${String(x.id).padEnd(8)} ${x.avant} -> ${x.apres}   « ${String(x.nom).slice(0, 40)} »`]
    ]) {
        if (!liste.length) continue;
        console.log(`\n   ── ${titre} ──`);
        for (const x of liste.slice(0, 15)) console.log(`      ${format(x)}`);
        if (liste.length > 15) console.log(`      … +${liste.length - 15}`);
    }

    // ── CE QUE ÇA RÉSOUT SUR LE DISQUE ──────────────────────────────────────
    if (fs.existsSync(RACINE)) {
        const surDisque = new Set();
        (function marche(d) {
            for (const e of fs.readdirSync(d, { withFileTypes: true })) {
                const p = path.join(d, e.name);
                if (e.isDirectory()) marche(p);
                else { const m = EST_CARTE.exec(e.name); if (m) surDisque.add(Number(m[1])); }
            }
        })(RACINE);
        const orphelins = [...surDisque].filter(id => !enBase.has(id));
        const resolus = orphelins.filter(id => neuf.parId.has(id));
        console.log('\n' + '═'.repeat(96));
        console.log('CE QUE ÇA RÉSOUT SUR LA COLLECTE D\'IMAGES');
        console.log('═'.repeat(96));
        console.log(`   fichiers sans produit connu, aujourd'hui .. ${orphelins.length}`);
        console.log(`   que le nouvel export identifie ............ ${resolus.length}  (${pc(resolus.length, orphelins.length)})`);
        console.log(`   qui resteraient orphelins ................. ${orphelins.length - resolus.length}`);
        // Et le déficit : les nouveaux produits arrivent SANS image.
        const nouveauxSansImage = nouveaux.filter(p => !surDisque.has(p.idProduct)).length;
        console.log(`\n   ⚠️ les produits nouveaux arrivent sans référence : ${nouveauxSansImage} de plus`);
        console.log(`      dans la population « au catalogue, sans fichier ». Le déficit MONTE avant de baisser.`);
    }

    // ── LES DIVERGENCES d'idExpansion, AVANT ────────────────────────────────
    console.log('\n' + '═'.repeat(96));
    console.log('LES DIVERGENCES numeros_cartes.idExpansion — RELEVÉ AVANT IMPORT');
    console.log('═'.repeat(96));
    const nums = await NUM.find({ idExpansion: { $ne: null } },
        { projection: { idProduct: 1, idExpansion: 1, codeSet: 1, setTcgdex: 1 } }).toArray();
    const divAvant = nums.filter(n => { const b = enBase.get(n.idProduct); return b && b.idExpansion !== n.idExpansion; });
    // Et celles que l'import CRÉERAIT en plus.
    const expApres = new Map([...neuf.parId].map(([id, p]) => [id, p.idExpansion]));
    const divApres = nums.filter(n => { const e = expApres.get(n.idProduct); return e != null && e !== n.idExpansion; });
    const cleAvant = new Set(divAvant.map(n => n.idProduct));
    const nouvellesDiv = divApres.filter(n => !cleAvant.has(n.idProduct));
    console.log(`   divergences AVANT import .................. ${divAvant.length}`);
    console.log(`   divergences APRÈS import (prévision) ...... ${divApres.length}`);
    console.log(`   🔴 divergences NOUVELLES .................. ${nouvellesDiv.length}`);
    console.log(`      dont porteuses d'un setTcgdex appris ... ${nouvellesDiv.filter(n => n.setTcgdex).length}`);
    for (const n of nouvellesDiv.slice(0, 20)) {
        const b = enBase.get(n.idProduct);
        console.log(`      ${String(n.idProduct).padEnd(8)} ${String(n.codeSet ?? '—').padEnd(10)} numeros_cartes ${n.idExpansion}` +
            ` · catalogue ${b?.idExpansion} -> ${expApres.get(n.idProduct)}`);
    }
    const parCodeAvant = new Map();
    for (const n of divAvant) parCodeAvant.set(n.codeSet ?? '(vide)', (parCodeAvant.get(n.codeSet ?? '(vide)') || 0) + 1);
    console.log(`\n   avant, par codeSet : ${[...parCodeAvant].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(' · ')}`);
    console.log(`\n   (rien n'a été écrit. L'import reste à lancer à la main.)`);
    await mongoose.disconnect();
})().catch(e => { console.error(e.stack); process.exit(1); });
