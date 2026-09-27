// ============================================================
// LES 171 LIGNES APPRISES DEPUIS LE JOURNAL 1.8 — rejugées par les gardes de la relecture, puis marquées « deduite »
// ============================================================
//   node migrer-deductions-journal.js                                    (mesure : chaque ligne rejugée, rien d'écrit)
//   node migrer-deductions-journal.js --base=test --attendu=<N> --ecrire  (après backup-collections.js --base=test --collections=numeros_cartes)
//
// 🔴 POURQUOI (testeur, 2026-09-26 soir, après la relecture par sous-agent) : « une déduction n'est JAMAIS exacte ». Les 171 lignes du
// journal ont été écrites par apprendre-journal.js avec `source: 'cardmarket-journal'`, `certitude: 'exacte'`, `preuveJournal` — AVANT
// les gardes anti-vol de slug (slug déjà porté, variante déjà portée, rang au-delà de la famille, famille sans variante). Deux noms
// pour la même règle, et une certitude fausse.
// Ce que fait l'outil :
//   1. chaque ligne est REJUGÉE par `deduireProduit` d'aujourd'hui (collecte-cartes/deduire-produit.js), comme si elle n'était pas
//      apprise : le module doit redésigner le MÊME idProduct ;
//   2. une ligne redésignée passe à `source: 'cardmarket-deduit'`, `certitude: 'deduite'`, `preuveDeduction` (le texte de preuveJournal),
//      `preuveJournal` retiré — le nom unique, et une vraie lecture la réécrira ;
//   3. une ligne qui NE passe PLUS est marquée `certitude: 'deduite'` aussi (une vraie lecture la corrigera), et LISTÉE : la retirer est
//      une suppression, elle attend le feu vert du testeur.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { ouvrirConnexions } = require('./collecte-cartes/garde');
const { lireMongo } = require('./collecte-cartes/lecture-sure');
const { estCarteCode } = require('./collecte-cartes/jointure');
const { deduireProduit, cleDuSlug, apprisDeLExpansion } = require('./collecte-cartes/deduire-produit');

const AUTORISES = [/^--base=test$/, /^--attendu=\d+$/, /^--ecrire$/, /^--export=.+\.json$/];
const inconnus = process.argv.slice(2).filter(a => !AUTORISES.some(r => r.test(a)));
if (inconnus.length) { console.error(`❌ argument inconnu : ${inconnus.join(' ')}`); process.exit(2); }
const arg = n => process.argv.find(a => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const EXPORT = arg('export') || 'products_singles_24092026.json', ecrire = process.argv.includes('--ecrire'), ATTENDU = arg('attendu') != null ? Number(arg('attendu')) : null;

(async () => {
    const { prod, fermer } = await ouvrirConnexions({ production: true, buckets: [] });
    const nc = await lireMongo(prod.db.collection('numeros_cartes'), {}, { nom: 'numeros_cartes', projection: { idProduct: 1, idExpansion: 1, slug: 1, slugSet: 1, numero: 1, codeSet: 1, variante: 1, source: 1, certitude: 1, preuveJournal: 1 } });
    const lignes = nc.filter(n => n.preuveJournal);
    const tous = JSON.parse(fs.readFileSync(path.join(__dirname, EXPORT), 'utf8')).products;
    const auCatalogue = new Set(tous.map(p => p.idProduct));
    const ex = tous.filter(p => !estCarteCode(p.name));
    const parExp = new Map(); for (const p of ex) (parExp.get(p.idExpansion) || parExp.set(p.idExpansion, []).get(p.idExpansion)).push(p);
    const parId = new Map(nc.map(n => [n.idProduct, n]));
    // Les porteurs de chaque slugSet|slug : la garde GLOBALE du module (seconde relecture du 2026-09-26 — elle ne vivait qu'ici et dans
    // l'outil du journal) reçoit les clés portées par un AUTRE produit que la ligne rejugée, qui porte forcément la sienne.
    const porteurs = new Map(); for (const n of nc) if (n.slug) porteurs.set(cleDuSlug(n.slugSet, n.slug), (porteurs.get(cleDuSlug(n.slugSet, n.slug)) || 0) + 1);
    console.log(`DÉNOMINATEURS : numeros_cartes ${nc.length} · lignes du journal (preuveJournal) ${lignes.length} · sources ${JSON.stringify(lignes.reduce((o, l) => (o[`${l.source}/${l.certitude}`] = (o[`${l.source}/${l.certitude}`] || 0) + 1, o), {}))}`);
    const tiennent = [], tombent = [];
    for (const l of lignes) {
        const produits = parExp.get(l.idExpansion) || [];
        // la ligne rejugée comme NON apprise : ses frères restent ce qu'ils sont en base
        const appris = new Map(produits.map(p => [p.idProduct, parId.get(p.idProduct)]).filter(([, n]) => n));
        appris.set(l.idProduct, { numero: null, slug: null });
        const cleL = cleDuSlug(l.slugSet, l.slug);
        const slugsPortes = { has: k => (porteurs.get(k) || 0) - (k === cleL ? 1 : 0) > 0 };
        // « catalogue en retard » : les lignes apprises de l'expansion (idExpansion OU slugSet) absentes de l'export (cartes-code comprises)
        const horsCatalogue = nc.filter(n => apprisDeLExpansion(n, l.idExpansion, l.slugSet || null) && !auCatalogue.has(n.idProduct)).map(n => n.idProduct);
        // la variante se relit du slug dans le module (une seule règle)
        const v = { slug: l.slug, slugSet: l.slugSet, code: l.codeSet ?? null, numero: l.numero ?? null };
        const d = deduireProduit(v, { produits, appris, slugsPortes, horsCatalogue });
        if (d.idProduct === l.idProduct) tiennent.push(l);
        else tombent.push({ l, raison: d.idProduct ? `le module désigne aujourd'hui ${d.idProduct}` : d.raison });
    }
    console.log(`\n✅ TIENNENT sous les gardes de la relecture : ${tiennent.length}`);
    console.log(`🔴 NE TIENNENT PLUS : ${tombent.length}`);
    for (const t of tombent) console.log(`   ${t.l.idProduct} exp ${t.l.idExpansion} ${t.l.slugSet}/${t.l.slug} n°${t.l.numero} : ${t.raison}`);
    await fermer();
    if (!ecrire) { console.log(`\n   (mesure seule — relancer avec --base=test --attendu=${lignes.length} --ecrire, après la sauvegarde de numeros_cartes)`); return; }
    if (ATTENDU !== lignes.length) { console.error(`❌ ARRÊT : ${lignes.length} lignes contre ${ATTENDU} attendues`); process.exit(1); }
    const mongoose = require('mongoose');
    const { connecterMongo } = require('./mongo-connexion');
    const base = await connecterMongo({ script: 'migrer-deductions-journal.js', ecrit: true });
    if (base !== 'test') { console.error(`❌ ARRÊT : numeros_cartes vit dans « test », pas dans « ${base} »`); await mongoose.disconnect(); process.exit(1); }
    const N = mongoose.connection.db.collection('numeros_cartes'), le = new Date();
    let n = 0;
    for (const { l, raison } of [...tiennent.map(l => ({ l, raison: null })), ...tombent]) {
        const r = await N.updateOne({ idProduct: l.idProduct, preuveJournal: { $exists: true } }, {
            $set: { source: 'cardmarket-deduit', certitude: 'deduite', preuveDeduction: l.preuveJournal + (raison ? ` · REJUGÉE le ${le.toISOString().slice(0, 10)} : ne tient plus (${raison}) — à retirer sur feu vert` : ''), deduitLe: le },
            $unset: { preuveJournal: '' } });
        n += r.modifiedCount;
    }
    const relus = await N.countDocuments({ preuveJournal: { $exists: true } }), deduites = await N.countDocuments({ certitude: 'deduite' });
    console.log(`\n   ✅ ${n} lignes migrées (attendu ${lignes.length}) · relu : ${relus} portent encore preuveJournal · ${deduites} lignes « deduite » en base`);
    await mongoose.disconnect();
})().catch(e => { console.error(e); process.exit(1); });
