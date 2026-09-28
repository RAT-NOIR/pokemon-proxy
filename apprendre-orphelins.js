// ============================================================
// APPRENDRE LE NUMÉRO D'UN PRODUIT ORPHELIN PAR LA CARTE ORPHELINE DE SON SET — nom + attaques, sous calibration
// ============================================================
//   node apprendre-orphelins.js --sets=HP[,…]                                          (mesure, n'écrit rien)
//   node apprendre-orphelins.js --sets=HP --base=test --attendu=<N> --ecrire           (après backup-collections.js --base=test --collections=numeros_cartes)
//
// 🔑 LE CAS (2026-09-26, EX Holon Phantoms) : collecté, 101/112 produits joints par le numéro ; restent 11 produits SANS numéro —
// Pikachu ☆ (3 311 € au guide), Gyarados ☆ δ, Mewtwo ☆, les quatre Deoxys δ, les deux Rayquaza δ — en face de 10 cartes du set
// SANS produit. Cardmarket ne nous les a jamais montrés, TCGdex ne porte pas leur idProduct (ou le porte sur quatre cartes).
// `joindre()` ne les prend pas par le nom, et c'est voulu (2026-09-15) : une carte qui déclare un numéro dans un catalogue
// numéroté ne se rattache pas par son nom — ce repli prenait le produit d'une AUTRE carte du même nom (SWSH, 56 produits).
// ✅ ICI LA POPULATION EST FERMÉE DES DEUX CÔTÉS : un produit du set qu'aucune carte n'a pris, une carte du set qu'aucun produit
// n'a pris. On apparie ces deux restes par la clé NOM + ATTAQUES (collecte-cartes/cle-nom-attaques.js, `designer`, la clé et sa
// garde : aucune autre carte candidate du même nom ne partage une attaque), UN À UN, et le numéro appris est celui que la carte
// DÉCLARE pour ce set. La jointure suivante le rejugera par son témoin du nom, comme toute autre.
// Gardes (ce qui passe, tout le reste refuse) :
//   1. CALIBRATION PAR SET : sur les paires DÉJÀ jointes du set par le numéro, numéro caché, la même clé sur toutes les cartes du
//      set rend 0 faux, sur 5 paires au moins — sinon le set entier est refusé ;
//   2. le produit n'a AUCUNE ligne numeros_cartes (ajout pur ; une ligne sans numéro n'est pas complétée : c'est une modification) ;
//   3. la carte désignée est orpheline, et AUCUN autre produit orphelin ne la désigne ;
//   4. elle déclare UN numéro pour ce set (tirage et expansion de la ligne).
// Le nom se compare sans « δ », « Delta Species », « Gold Star », « ☆ » : Cardmarket écrit « Pikachu Gold Star » et « Gyarados
// Gold Star δ Delta Species », Bulbapedia nomme les cartes « Pikachu » et « Gyarados » (le ☆ est dans le titre de la page). Dans
// un set, les attaques départagent ce que ces mots distinguaient — et la calibration le vérifie sur les paires connues.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { ouvrirConnexions } = require('./collecte-cartes/garde');
const { lireMongo } = require('./collecte-cartes/lecture-sure');
const { decomposerNomCardmarket, cleNumero, estCarteCode } = require('./collecte-cartes/jointure');
const { indexer, designer } = require('./collecte-cartes/cle-nom-attaques');
const { ligne } = require('./collecte-cartes/table-sets');

const AUTORISES = [/^--sets=[\w.,/-]+$/, /^--base=test$/, /^--attendu=\d+$/, /^--ecrire$/, /^--export=.+\.json$/];
const inconnus = process.argv.slice(2).filter(a => !AUTORISES.some(r => r.test(a)));
if (inconnus.length) { console.error(`❌ argument inconnu : ${inconnus.join(' ')}`); process.exit(2); }
const arg = n => process.argv.find(a => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const CODES = (arg('sets') || '').split(',').filter(Boolean), EXPORT = arg('export') || 'products_singles_24092026.json';
const ecrire = process.argv.includes('--ecrire'), ATTENDU = arg('attendu') != null ? Number(arg('attendu')) : null;
if (!CODES.length) { console.error('❌ --sets=<CODE>[,…] obligatoire'); process.exit(2); }
const MINIMUM_CALIBRATION = 5;
const nomDansLeSet = n => String(n || '').replace(/δ\s*Delta Species\b/gi, ' ').replace(/\bGold Star\b|☆|δ/g, ' ').replace(/\s+Delta$/i, '').replace(/\s+/g, ' ').trim();
const nu = c => ({ ...c, nomEn: nomDansLeSet(c.nomEn) });

(async () => {
    const { cartes: cx, prod, fermer } = await ouvrirConnexions({ production: true, buckets: [] });
    const ex = JSON.parse(fs.readFileSync(path.join(__dirname, EXPORT), 'utf8')).products;
    const retenus = [];
    for (const code of CODES) {
        const L = ligne(code);
        if (!L || !L.verifie || !L.bulba?.tirage || !L.bulba?.expansion) { console.log(`\n■ ${code} : ligne absente ou non admise — refusé`); continue; }
        const noms = [].concat(L.bulba.expansion), tirage = L.bulba.tirage;
        const produits = ex.filter(p => p.idExpansion === L.exp && !estCarteCode(p.name)).map(p => ({ ...p, ...decomposerNomCardmarket(p.name) }));
        const nc = new Map((await prod.db.collection('numeros_cartes').find({ idProduct: { $in: produits.map(p => p.idProduct) } }, { projection: { idProduct: 1, numero: 1 } }).toArray()).map(n => [n.idProduct, n]));
        const codeSet = (await prod.db.collection('codes_set').findOne({ idExpansion: L.exp }))?.codeSet ?? null;
        const cartes = await lireMongo(cx.db.collection('cartes'), { impressions: { $elemMatch: { tirage, expansion: { $in: noms } } } }, { nom: `cartes déclarant ${noms.join(' / ')} (${tirage})`, projection: { nomEn: 1, niveau: 1, 'attaques.nom': 1, impressions: 1 } });
        const numerosDe = c => [...new Set((c.impressions || []).filter(i => i.tirage === tirage && noms.includes(i.expansion) && i.numero != null && String(i.numero).trim() !== '').map(i => String(i.numero)))];
        const lignes = await cx.db.collection('cartes_produits').find({ idProduct: { $in: produits.map(p => p.idProduct) } }, { projection: { idProduct: 1, carteId: 1, preuve: 1 } }).toArray();
        const cartesJointes = new Set(lignes.map(l => l.carteId)), produitsJoints = new Set(lignes.map(l => l.idProduct));
        console.log(`\n■ ${code} (exp ${L.exp}, « ${noms.join(' / ')} » ${tirage}, code ${codeSet ?? '—'}) · DÉNOMINATEURS : ${produits.length} produits, ${produitsJoints.size} joints · ${cartes.length} cartes déclarant le set, ${cartes.filter(c => cartesJointes.has(c._id)).length} jointes`);
        // 1. calibration sur les paires connues (jointes par un numéro), clé sur TOUTES les cartes du set
        const tout = indexer(cartes.map(nu));
        const cal = { juste: 0, faux: [], refus: 0 };
        for (const l of lignes.filter(x => /numero/.test(x.preuve || ''))) {
            const p = produits.find(x => x.idProduct === l.idProduct); if (!p) continue;
            const d = designer(tout, { nom: nomDansLeSet(p.nom), attaques: p.attaques });
            if (!d.carte) cal.refus++; else if (d.carte._id === l.carteId) cal.juste++; else cal.faux.push(`${p.idProduct} « ${p.name} » → ${d.carte._id} (vrai ${l.carteId})`);
        }
        console.log(`   1. calibration (paires jointes par le numéro, numéro caché) : justes ${cal.juste} · FAUX ${cal.faux.length} · refus ${cal.refus}${cal.faux.length ? ` · ${cal.faux.slice(0, 4).join(' ; ')}` : ''}`);
        if (cal.faux.length || cal.juste < MINIMUM_CALIBRATION) { console.log(`   🔴 set refusé : la clé ${cal.faux.length ? 'se trompe' : `ne parle que ${cal.juste} fois`} sur ce qui marche`); continue; }
        // 2-4. l'appariement des orphelins
        const orphProduits = produits.filter(p => !produitsJoints.has(p.idProduct));
        const orphCartes = cartes.filter(c => !cartesJointes.has(c._id));
        const idx = indexer(orphCartes.map(nu));
        const designations = orphProduits.map(p => ({ p, d: designer(idx, { nom: nomDansLeSet(p.nom), attaques: p.attaques }) }));
        const parCarte = new Map(); for (const x of designations) if (x.d.carte) parCarte.set(x.d.carte._id, (parCarte.get(x.d.carte._id) || 0) + 1);
        console.log(`   2. orphelins : ${orphProduits.length} produits · ${orphCartes.length} cartes (${orphCartes.map(c => `${c.nomEn} n°${numerosDe(c).join('/')}`).join(', ')})`);
        for (const { p, d } of designations) {
            const c = d.carte ? cartes.find(x => x._id === d.carte._id) : null, nums = c ? numerosDe(c) : [];
            const refus = !c ? d.raison : nc.has(p.idProduct) ? `le produit a déjà une ligne numeros_cartes (n°${nc.get(p.idProduct).numero ?? '—'}) : la compléter serait une modification` : parCarte.get(c._id) > 1 ? `${parCarte.get(c._id)} produits orphelins désignent cette carte` : nums.length !== 1 ? `la carte déclare ${nums.length} numéros pour ce set (${nums.join(', ')})` : null;
            console.log(`   ${refus ? '🔴' : '✅'} ${p.idProduct} « ${p.name} »${c ? ` → ${c._id} « ${c.nomEn} » [${(c.attaques || []).map(a => a.nom).join(' | ')}] n°${nums.join('/')}` : ''}${refus ? ` — ${refus}` : ''}`);
            if (!refus) retenus.push({ p, c, numero: nums[0], code, L, codeSet, calibre: `${cal.juste}/${cal.juste + cal.faux.length} (${cal.refus} refus)` });
        }
    }
    console.log(`\n✅ À APPRENDRE : ${retenus.length}`);
    await fermer();
    if (!ecrire) { console.log(`   (mesure seule — relancer avec --base=test --attendu=${retenus.length} --ecrire, après backup-collections.js --base=test --collections=numeros_cartes)`); return; }
    if (ATTENDU !== retenus.length) { console.error(`❌ ARRÊT : ${retenus.length} à apprendre contre ${ATTENDU} attendus`); process.exit(1); }
    const mongoose = require('mongoose');
    const { connecterMongo } = require('./mongo-connexion');
    const base = await connecterMongo({ script: 'apprendre-orphelins.js', ecrit: true });
    if (base !== 'test') { console.error(`❌ ARRÊT : les numéros appris vivent dans « test », pas dans « ${base} »`); await mongoose.disconnect(); process.exit(1); }
    const N = mongoose.connection.db.collection('numeros_cartes'), le = new Date();
    let n = 0;
    for (const r of retenus) {
        const res = await N.updateOne({ idProduct: r.p.idProduct }, { $setOnInsert: {
            idProduct: r.p.idProduct, idExpansion: r.p.idExpansion, numero: r.numero, ...(r.codeSet ? { codeSet: r.codeSet } : {}),
            source: 'orphelins-nom-attaques', certitude: 'exacte',
            preuveOrphelins: `produit orphelin du set ${r.code} apparié à la carte orpheline ${r.c._id} « ${r.c.nomEn} » (nom + attaques ${r.p.attaques.join(' | ') || '—'}, seule candidate, aucune voisine du même nom ne partage une attaque) ; numéro déclaré par la carte pour « ${[].concat(r.L.bulba.expansion).join(' / ')} » (${r.L.bulba.tirage}) ; clé calibrée sur le set ${r.calibre} · apprendre-orphelins.js`,
            apprisLe: le } }, { upsert: true });
        n += res.upsertedCount;
    }
    const relus = await N.countDocuments({ source: 'orphelins-nom-attaques' });
    console.log(`\n   ✅ ${n} produits appris (attendu ${retenus.length}) · relu : ${relus} lignes source orphelins-nom-attaques`);
    await mongoose.disconnect();
})().catch(e => { console.error(e); process.exit(1); });
