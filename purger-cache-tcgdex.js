// ============================================================
// PURGER UN CACHE TCGdex DES CARTES D'UN AUTRE SET — feu vert du testeur, 2026-09-27 (en/30th : 30 cartes de 30th-c)
// ============================================================
//   node purger-cache-tcgdex.js --set=30th                       (mesure : ce qui partirait, rien d'écrit)
//   node purger-cache-tcgdex.js --set=30th --attendu=30 --ecrire  (sauvegarde du document AVANT, écriture, relecture)
//
// Le filtre GraphQL de TCGdex est un « contient » : l'ancien client gardait `30th-c-001` dans `30th`. Le client et les lecteurs du
// cache filtrent désormais par `estDuSet` (collecte-cartes/tcgdex.js) ; ce geste retire du CACHE ce que la règle n'y lit plus.
// C'est une SUPPRESSION : un seul document, sauvegardé tel quel (Extended JSON) avant l'écriture, et le nombre retiré doit être
// celui qu'on a annoncé (`--attendu`) — sinon rien n'est écrit.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { EJSON } = require('bson');
const AUTORISES = [/^--set=[\w.-]+$/, /^--attendu=\d+$/, /^--ecrire$/];
const inconnus = process.argv.slice(2).filter(a => !AUTORISES.some(r => r.test(a)));
if (inconnus.length) { console.error(`❌ argument inconnu : ${inconnus.join(' ')}`); process.exit(2); }
const arg = n => process.argv.find(a => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const { ouvrirConnexions } = require('./collecte-cartes/garde');
const { estDuSet } = require('./collecte-cartes/tcgdex');

(async () => {
    const set = arg('set'), ecrire = process.argv.includes('--ecrire'), attendu = arg('attendu') != null ? Number(arg('attendu')) : null;
    if (!set) { console.error('❌ --set=<id TCGdex> obligatoire'); process.exit(2); }
    const { cartes: cx, fermer } = await ouvrirConnexions({ production: false, buckets: [] });
    const C = cx.db.collection('tcgdex_sets'), _id = `en/${set}`;
    const d = await C.findOne({ _id });
    if (!d || !Array.isArray(d.cartes)) { console.error(`❌ ${_id} : aucun document, ou pas de tableau « cartes »`); await fermer(); process.exit(1); }
    const garder = d.cartes.filter(c => estDuSet(set, c)), retirer = d.cartes.filter(c => !estDuSet(set, c));
    console.log(`DÉNOMINATEUR : ${_id} porte ${d.cartes.length} cartes · ${garder.length} du set exact · ${retirer.length} à retirer`);
    console.log(`   à retirer : ${retirer.slice(0, 10).map(c => c.id).join(', ')}${retirer.length > 10 ? ' …' : ''}`);
    if (!ecrire) { console.log(`\n   (mesure seule — --attendu=${retirer.length} --ecrire)`); await fermer(); return; }
    if (attendu !== retirer.length) { console.error(`❌ ARRÊT : ${retirer.length} cartes à retirer, ${attendu} annoncées`); await fermer(); process.exit(1); }
    // dans un dossier `backup-*/` : c'est ce que .gitignore couvre (un fichier à la racine partirait avec un commit)
    const dossier = path.join(__dirname, `backup-${new Date().toISOString().slice(0, 10)}-avant-purge-${set}`);
    fs.mkdirSync(dossier, { recursive: true });
    const sauvegarde = path.join(dossier, `tcgdex_sets-en-${set}.ejson`);
    fs.writeFileSync(sauvegarde, EJSON.stringify(d, { relaxed: false }));
    console.log(`   sauvegarde : ${sauvegarde} (${fs.statSync(sauvegarde).size} octets)`);
    // l'écriture est conditionnée au document LU (même nombre de cartes) : un cache réécrit entre-temps n'est pas touché
    const r = await C.updateOne({ _id, n: d.n, [`cartes.${d.cartes.length - 1}`]: { $exists: true }, [`cartes.${d.cartes.length}`]: { $exists: false } },
        { $set: { cartes: garder, n: garder.length, purgeLe: new Date(), purgeMotif: `${retirer.length} cartes d'un autre set (filtre « contient » de l'ancien client) — feu vert du testeur, 2026-09-27` } });
    const relu = await C.findOne({ _id });
    console.log(`   ✅ modifié ${r.modifiedCount} · RELU : ${relu.cartes.length} cartes, ${relu.cartes.filter(c => !estDuSet(set, c)).length} hors du set`);
    await fermer();
})().catch(e => { console.error(e); process.exit(1); });
