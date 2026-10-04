// ============================================================
// LE CODE DE SET D'UN PRODUIT APPRIS SANS CODE — seulement quand DEUX preuves indépendantes concordent (feu vert du testeur, 2026-10-04 :
// « les 13 produits sans code dans numeros_cartes : écris ce qui a une double preuve concordante, présente le reste »)
// ============================================================
//   node poser-codeset-deduit.js            (plan : chaque produit sans code, ses preuves, la décision — rien d'écrit)
//   node poser-codeset-deduit.js --ecrire   (base de PRODUCTION « test » ; sauvegarde AVANT :
//        node backup-collections.js --base=test --collections=numeros_cartes --dossier=backup-<date>-avant-codeset)
// LES DEUX PREUVES, et elles ne lisent pas la même donnée :
//   1. L'UNANIMITÉ DE L'EXPANSION : toutes les AUTRES lignes de numeros_cartes de la même idExpansion portent un seul et même codeSet ;
//   2. LE NUMÉRO DU PRODUIT : il commence par ce code, suivi d'un chiffre (« SM18 », « SM128 » pour SM) — le code imprimé sur la carte.
// Une seule des deux : PRÉSENTÉ, rien d'écrit. N'écrit que `codeSet` absent ou nul, et la preuve à côté (`codeSetPreuve`).
// Pourquoi (auto-banc du 2026-10-03, CLAUDE.md §71) : un produit sans code perdait contre un jumeau codé au même visuel (Lacey xPRE 175).
require('dotenv').config();
const mongoose = require('mongoose');
const AUTORISES = [/^--ecrire$/];
const inconnus = process.argv.slice(2).filter(a => !AUTORISES.some(r => r.test(a)));
if (inconnus.length) { console.error(`❌ argument inconnu : ${inconnus.join(' ')} — autorisé : --ecrire`); process.exit(2); }

/** La décision pour un produit sans code : { code, preuves } ou { refus }. Pure. */
function decider(produit, autresLignes) {
    const codes = new Set(autresLignes.map(l => l.codeSet).filter(Boolean));
    const sansCode = autresLignes.filter(l => !l.codeSet).length;
    if (codes.size !== 1) return { refus: codes.size ? `l'expansion porte ${codes.size} codes (${[...codes].join(', ')})` : 'aucune autre ligne de l\'expansion ne porte de code' };
    const code = [...codes][0];
    const unanimite = `unanimité de l'expansion ${produit.idExpansion} : ${autresLignes.length - sansCode} lignes portent « ${code} »${sansCode ? ` (${sansCode} autres sans code)` : ''}`;
    const n = String(produit.numero ?? '');
    const prefixe = n.toUpperCase().startsWith(code.toUpperCase()) && /^\d/.test(n.slice(code.length));
    if (!prefixe) return { refus: `une seule preuve — ${unanimite} ; le numéro « ${n || '—'} » ne porte pas le code` };
    return { code, preuves: [unanimite, `le numéro « ${n} » commence par le code « ${code} »`] };
}
module.exports = { decider };

if (require.main === module) (async () => {
    const ecrire = process.argv.includes('--ecrire');
    const c = await mongoose.createConnection(process.env.MONGODB_URI, { dbName: 'test' }).asPromise();
    if (c.db.databaseName !== 'test') throw new Error(`base « ${c.db.databaseName} » : numeros_cartes vit dans « test »`);
    const N = c.collection('numeros_cartes');
    const total = await N.countDocuments({});
    const sans = await N.find({ $or: [{ codeSet: null }, { codeSet: '' }] }).toArray();
    console.log(`DÉNOMINATEUR : ${total} lignes numeros_cartes · ${sans.length} sans codeSet`);
    const aEcrire = [];
    for (const p of sans) {
        const autres = await N.find({ idExpansion: p.idExpansion, idProduct: { $ne: p.idProduct } }, { projection: { codeSet: 1 } }).toArray();
        const d = decider(p, autres);
        console.log(`   ${p.idProduct} exp ${p.idExpansion} n° ${p.numero ?? '—'} « ${p.nom ?? p.nomEn ?? p.slug ?? '—'} » → ${d.code ? `✅ ${d.code} (${d.preuves.join(' ; ')})` : `présenté : ${d.refus}`}`);
        if (d.code) aEcrire.push({ p, d });
    }
    console.log(`PLAN : ${aEcrire.length} à écrire · ${sans.length - aEcrire.length} présentés`);
    if (!ecrire) { console.log('   (plan seul — --ecrire, après la sauvegarde de numeros_cartes)'); await c.close(); return; }
    let n = 0;
    for (const { p, d } of aEcrire) n += (await N.updateOne({ idProduct: p.idProduct, $or: [{ codeSet: null }, { codeSet: '' }] }, { $set: { codeSet: d.code, codeSetPreuve: { preuves: d.preuves, outil: 'poser-codeset-deduit.js', le: new Date() } } })).modifiedCount;
    const relus = await N.countDocuments({ idProduct: { $in: aEcrire.map(x => x.p.idProduct) }, codeSet: { $type: 'string', $ne: '' } });
    console.log(`${n === aEcrire.length && relus === aEcrire.length ? '✅' : '🔴'} écrits ${n}/${aEcrire.length} · RELUS ${relus}/${aEcrire.length} · restent sans code ${await N.countDocuments({ $or: [{ codeSet: null }, { codeSet: '' }] })}`);
    await c.close();
    if (relus !== aEcrire.length) process.exit(1);
})().catch(e => { console.error(e); process.exit(1); });
