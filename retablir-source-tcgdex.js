// Rétablir la source d'un numéro LU par TCGdex sur une ligne que la déduction du journal 1.8 a seulement COMPLÉTÉE (xm2a, 2026-09-28).
//
//   node retablir-source-tcgdex.js                                                         # plan, lecture seule (base test)
//   node retablir-source-tcgdex.js --base=test --attendu=<N> --ecrire                       (après backup-collections.js --base=test --collections=numeros_cartes)
//
// L'HISTOIRE (XM2A-20-LIGNES-2026-09-28.md) : ces produits ont été appris par l'idProduct que porte TCGdex (`source: tcgdex`,
// `certitude: exacte`, sans slug) ; le journal 1.8 a complété leur lien (slug, numeroUrl, nomFr, variante) SANS toucher au numéro ; la
// migration des déductions a ensuite passé la ligne ENTIÈRE en `cardmarket-deduit` / `deduite` — un numéro lu devenu un numéro déduit.
// La règle d'aujourd'hui (collecte-cartes/deduire-produit.js, ligne complétée) garde la source et écrit `certitudeAvantDeduction` +
// `champsDeduits` : c'est ce que cette écriture rend à ces lignes, et rien d'autre.
//
// DÉCISION DU TESTEUR (2026-09-28) : « écris seulement les lignes à double preuve concordante, et liste les autres ». Une ligne n'est
// écrite que si TOUT concorde, chaque point imprimé :
//   1. preuve TCGdex : le numéro de la carte TCGdex qui porte l'idProduct = le numéro de la ligne ;
//   2. preuve du journal : le numéro du TITRE Cardmarket = le numéro de la ligne, et le slug finit par <code><numéro> ;
//   3. les deux preuves désignent le même NOM : la carte de la preuve TCGdex, le produit de l'export, le début du slug ;
//   4. la sauvegarde d'avant le journal montre la ligne `tcgdex` / `exacte` au même numéro, et chaque champ que la déduction a posé y
//      était VIDE (c'est ce qui fait une ligne « complétée » ; un champ réécrit sur une valeur existante n'en est pas une).
// Le filtre d'écriture reprend l'état lu (`certitude`, `source`, `numero`) : une ligne qui a bougé entre la lecture et l'écriture n'est
// pas touchée, et le compte le dit.
require('dotenv').config();
const fs = require('fs');
const path = require('path');

const AUTORISES = [/^--base=test$/, /^--attendu=\d+$/, /^--ecrire$/];
const inconnus = process.argv.slice(2).filter(a => !AUTORISES.some(r => r.test(a)));
if (inconnus.length) { console.error(`❌ argument inconnu : ${inconnus.join(' ')}`); process.exit(2); }
const ECRIRE = process.argv.includes('--ecrire');
const ATTENDU = Number((process.argv.find(a => a.startsWith('--attendu=')) || '').split('=')[1] ?? NaN);
if (ECRIRE && (!process.argv.includes('--base=test') || !Number.isInteger(ATTENDU))) { console.error('❌ --ecrire exige --base=test et --attendu=<N>'); process.exit(2); }

const EXPORT = path.join(__dirname, 'products_singles_24092026.json');
const SAUVEGARDE_AVANT_JOURNAL = path.join(__dirname, 'backup-2026-09-26-avant-journal', 'numeros_cartes.json');
const CHAMPS_DU_LIEN = ['slug', 'slugSet', 'numeroUrl', 'nomFr', 'variante', 'codeSet'];

const cle = s => String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const sansZeros = n => String(n ?? '').replace(/^0+(?=\d)/, '');
const vide = v => v == null || v === '';

/** Le jugement d'UNE ligne : { ok, champsDeduits, raisons[] } — chaque raison est un point qui ne concorde pas. */
function juger(l, nomExport, avant) {
    const raisons = [];
    const t = /TCGdex (\S+)-(\w+) \(variants/.exec(l.preuveTcgdex || '');
    if (!t) raisons.push('preuve TCGdex illisible (pas de « TCGdex <set>-<n°> (variants »)');
    else if (sansZeros(t[2]) !== sansZeros(l.numero)) raisons.push(`n° TCGdex ${t[2]} ≠ n° de la ligne ${l.numero}`);
    const d = /titre « .*\((\S+) (\w+)\) »/.exec(l.preuveDeduction || '');
    if (!d) raisons.push('preuve du journal illisible (pas de titre « … (<code> <n°>) »)');
    else {
        if (sansZeros(d[2]) !== sansZeros(l.numero)) raisons.push(`n° du titre ${d[2]} ≠ n° de la ligne ${l.numero}`);
        if (!String(l.slug || '').endsWith(`${d[1]}${d[2]}`)) raisons.push(`le slug « ${l.slug} » ne finit pas par ${d[1]}${d[2]}`);
    }
    const nomTcgdex = /nos cartes « ([^»]+) »/.exec(l.preuveTcgdex || '')?.[1];
    const nomProduit = String(nomExport ?? '').split('[')[0].trim();
    const nomSlug = String(l.slug || '').replace(/-V\d+-[^-]+$|-[^-]+$/, '');
    if (!nomExport) raisons.push('produit absent de l\'export');
    else {
        if (!nomTcgdex || cle(nomTcgdex) !== cle(nomProduit)) raisons.push(`nom de la preuve TCGdex « ${nomTcgdex ?? '—'} » ≠ produit « ${nomProduit} »`);
        if (cle(nomSlug) !== cle(nomProduit)) raisons.push(`début du slug « ${nomSlug} » ≠ produit « ${nomProduit} »`);
    }
    if (!avant) raisons.push('absente de la sauvegarde d\'avant le journal');
    else {
        if (avant.source !== 'tcgdex' || avant.certitude !== 'exacte') raisons.push(`avant le journal : ${avant.source}/${avant.certitude} (attendu tcgdex/exacte)`);
        if (sansZeros(avant.numero) !== sansZeros(l.numero)) raisons.push(`avant le journal : n° ${avant.numero} ≠ ${l.numero}`);
    }
    const champsDeduits = avant ? CHAMPS_DU_LIEN.filter(k => vide(avant[k]) && !vide(l[k])) : [];
    const reecrits = avant ? CHAMPS_DU_LIEN.filter(k => !vide(avant[k]) && !vide(l[k]) && String(avant[k]) !== String(l[k])) : [];
    if (reecrits.length) raisons.push(`champs RÉÉCRITS sur une valeur existante : ${reecrits.join(', ')}`);
    if (avant && !champsDeduits.length) raisons.push('aucun champ posé par la déduction : rien à attribuer');
    return { ok: !raisons.length, champsDeduits, raisons };
}

/** La sauvegarde d'avant le journal (Extended JSON, un document par ligne) : seulement les idProduct demandés. */
function lireSauvegarde(ids) {
    const { EJSON } = require('bson');
    const voulus = new Set(ids), trouves = new Map();
    for (const ligne of fs.readFileSync(SAUVEGARDE_AVANT_JOURNAL, 'utf8').split('\n')) {
        const m = /"idProduct":(\d+)/.exec(ligne);
        if (!m || !voulus.has(Number(m[1]))) continue;
        const doc = EJSON.parse(ligne.replace(/,\s*$/, ''));
        trouves.set(doc.idProduct, doc);
    }
    return trouves;
}

if (require.main === module) (async () => {
    const mongoose = require('mongoose');
    const { connecterMongo } = require('./mongo-connexion');
    const base = await connecterMongo({ script: 'retablir-source-tcgdex.js', ecrit: ECRIRE });
    if (base !== 'test') { console.error(`❌ ARRÊT : les numéros appris vivent dans « test », pas dans « ${base} »`); await mongoose.disconnect(); process.exit(2); }
    const N = mongoose.connection.db.collection('numeros_cartes');
    const total = await N.countDocuments({});
    const L = await N.find({ certitude: 'deduite', source: 'cardmarket-deduit', preuveTcgdex: { $exists: true } }).sort({ idExpansion: 1, numero: 1 }).toArray();
    console.log(`DÉNOMINATEUR : ${L.length} lignes « cardmarket-deduit / deduite » qui portent une preuve TCGdex, sur ${total} lignes de numeros_cartes`);
    if (!total) { console.error('❌ numeros_cartes vide : ce n\'est pas la bonne base'); await mongoose.disconnect(); process.exit(1); }
    const noms = new Map(JSON.parse(fs.readFileSync(EXPORT, 'utf8')).products.map(p => [p.idProduct, p.name]));
    const avant = lireSauvegarde(L.map(l => l.idProduct));
    console.log(`   export ${path.basename(EXPORT)} : ${noms.size} produits · sauvegarde d'avant le journal : ${avant.size}/${L.length} de ces lignes`);
    const retenues = [], refusees = [];
    for (const l of L) {
        const j = juger(l, noms.get(l.idProduct), avant.get(l.idProduct));
        (j.ok ? retenues : refusees).push({ l, j });
        console.log(`${j.ok ? '✅' : '❌'} ${l.idProduct} n°${l.numero} « ${noms.get(l.idProduct) ?? '?'} » ${j.ok ? `→ tcgdex, champs déduits : ${j.champsDeduits.join(', ')}` : `— ${j.raisons.join(' · ')}`}`);
    }
    console.log(`\nDOUBLE PREUVE CONCORDANTE : ${retenues.length}/${L.length} · À LISTER : ${refusees.length}`);
    if (!ECRIRE) { console.log(`   (plan — relancer avec --base=test --attendu=${retenues.length} --ecrire, après backup-collections.js --base=test --collections=numeros_cartes)`); await mongoose.disconnect(); return; }
    if (ATTENDU !== retenues.length) { console.error(`❌ ARRÊT : ${retenues.length} retenues contre ${ATTENDU} attendues`); await mongoose.disconnect(); process.exit(1); }
    const le = new Date();
    let n = 0;
    for (const { l, j } of retenues) {
        const r = await N.updateOne({ _id: l._id, certitude: 'deduite', source: 'cardmarket-deduit', numero: l.numero }, { $set: {
            source: 'tcgdex', certitudeAvantDeduction: 'exacte', champsDeduits: j.champsDeduits,
            sourceRetablie: { le, avant: 'cardmarket-deduit', par: 'retablir-source-tcgdex.js', decision: 'testeur 2026-09-28 : double preuve concordante (TCGdex + titre du journal 1.8)' } } });
        n += r.modifiedCount;
    }
    const relus = await N.countDocuments({ idProduct: { $in: retenues.map(r => r.l.idProduct) }, source: 'tcgdex', certitude: 'deduite', certitudeAvantDeduction: 'exacte' });
    console.log(`\n✅ ${n} lignes rétablies (attendu ${retenues.length}) · relu : ${relus}/${retenues.length} tcgdex / deduite / certitudeAvantDeduction exacte`);
    await mongoose.disconnect();
    if (n !== retenues.length || relus !== retenues.length) process.exit(1);
})().catch(async e => { console.error(e); try { await require('mongoose').disconnect(); } catch (_) {} process.exit(1); });

module.exports = { juger };
