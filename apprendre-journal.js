// ============================================================
// APPRENDRE LES PRODUITS QUE L'USERSCRIPT A ÉCARTÉS — depuis le JOURNAL exporté, zéro requête Cardmarket
// ============================================================
//   node apprendre-journal.js --journal=<rat-market-journal-*.json>                                  (mesure, 20 tirés au sort)
//   node apprendre-journal.js --journal=<…> --base=test --attendu=<N> --ecrire                        (après backup-collections.js --base=test --collections=numeros_cartes)
//
// 🔴 LE CAS (testeur, 2026-09-26, journal 1.8) : l'userscript lit l'idProduct dans l'URL de l'IMAGE de la vignette ; une vignette
// « cardImageNotAvailable » n'en a pas, et le produit était ÉCARTÉ — alors que son lien et son titre portent le slug et le numéro
// (« /Sun-Moon/Shiinotic-V2-SUM17 », « Lampignon (SUM 17) »). Le journal les a gardés (`detailEcartees`, 25 par page au plus).
// 🔑 SANS idProduct, IL FAUT LE RETROUVER — et c'est la seule chose qui se déduit ; tout le reste est LU chez Cardmarket. Les règles
// (expansion par le slugSet, produit par le nom du slug, gardes contre le vol d'un slug, numéro par scoring.js) et l'écriture sont
// celles de collecte-cartes/deduire-produit.js, décrites là-bas une fois. Une ligne déduite porte `source: 'cardmarket-deduit'`,
// `certitude: 'deduite'` et `preuveDeduction` ; une vraie lecture de l'userscript (avec l'id) la réécrit toujours.
// ⚠️ 2026-09-26 (soir) : les 171 lignes écrites le matin par la première version (`cardmarket-journal`, `exacte`, `preuveJournal`) ont
// été rejugées sous les gardes de la relecture — 171/171 tiennent — et migrées au marquage unique (migrer-deductions-journal.js).
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { ouvrirConnexions } = require('./collecte-cartes/garde');
const { lireMongo } = require('./collecte-cartes/lecture-sure');
const { vignettesDuJournal, deduireLot, appliquerDeductions, cleDuSlug, apprisDeLExpansion } = require('./collecte-cartes/deduire-produit');

const AUTORISES = [/^--journal=.+\.json$/, /^--base=test$/, /^--attendu=\d+$/, /^--ecrire$/, /^--export=.+\.json$/];
const inconnus = process.argv.slice(2).filter(a => !AUTORISES.some(r => r.test(a)));
if (inconnus.length) { console.error(`❌ argument inconnu : ${inconnus.join(' ')}`); process.exit(2); }
const arg = n => process.argv.find(a => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const JOURNAL = arg('journal'), EXPORT = arg('export') || 'products_singles_24092026.json';
const ecrire = process.argv.includes('--ecrire'), ATTENDU = arg('attendu') != null ? Number(arg('attendu')) : null;
if (!JOURNAL || !fs.existsSync(JOURNAL)) { console.error('❌ --journal=<fichier exporté par l\'userscript> requis'); process.exit(2); }
// La lecture de la vignette, la déduction de l'idProduct ET son écriture vivent dans collecte-cartes/deduire-produit.js, que le
// serveur appelle aussi (/api/apprendre-lot, userscript 1.9) : une seule règle, une seule écriture, un seul marquage
// (`cardmarket-deduit`, `certitude: 'deduite'`, `preuveDeduction`) — §21 bis. Comme l'userscript 1.9, seule une image
// « cardImageNotAvailable » vaut « sans image » : toute autre image illisible reste écartée.
// 🔴 SECONDE RELECTURE (2026-09-26, nuit) : l'outil ne lisait que `detailEcartees` — un journal 1.9 porte ses sans-image dans
// `detailSansImage` ; les deux sont lues par `vignettesDuJournal` (le module) et COMPTÉES chacune. La garde « slug déjà appris »
// (slugSet|slug), que seuls cet outil et la migration appliquaient, vit dans le module : la route l'applique aussi ; comme la garde
// « catalogue en retard », dont le catalogue est ici l'EXPORT.

(async () => {
    const j = JSON.parse(fs.readFileSync(JOURNAL, 'utf8'));
    const { pages, vignettes: ecartees, comptes } = vignettesDuJournal(j);
    const { prod, fermer } = await ouvrirConnexions({ production: true, buckets: [] });
    const nc = await lireMongo(prod.db.collection('numeros_cartes'), {}, { nom: 'numeros_cartes', projection: { idProduct: 1, idExpansion: 1, slug: 1, slugSet: 1, numero: 1, source: 1, codeSet: 1 } });
    const parId = new Map(nc.map(n => [n.idProduct, n])), slugsConnus = new Set(nc.filter(n => n.slug).map(n => cleDuSlug(n.slugSet, n.slug)));
    const expDuSlugSet = new Map(); for (const n of nc) if (n.slugSet) (expDuSlugSet.get(n.slugSet) || expDuSlugSet.set(n.slugSet, new Set()).get(n.slugSet)).add(n.idExpansion);
    // L'export BRUT (cartes-code comprises) : le module retire les cartes-code des candidats, et la garde « catalogue en retard »
    // demande si un idProduct appris est au catalogue — une carte-code apprise y est.
    const tous = JSON.parse(fs.readFileSync(path.join(__dirname, EXPORT), 'utf8')).products;
    const auCatalogue = new Set(tous.map(p => p.idProduct));
    const parExp = new Map(); for (const p of tous) (parExp.get(p.idExpansion) || parExp.set(p.idExpansion, []).get(p.idExpansion)).push(p);
    const nomDe = new Map(tous.map(p => [p.idProduct, p.name]));
    console.log(`DÉNOMINATEURS : journal ${pages} pages · sans image distinctes ${ecartees.length} — detailEcartees « cardImageNotAvailable » ${comptes.detailEcartees} (1.8), detailSansImage ${comptes.detailSansImage} (1.9), doublons ${comptes.doublons} (≤ 25 gardées par page ; ${comptes.autresImages} autre(s) image(s) illisible(s) laissée(s) de côté, ${comptes.sansLien ?? 0} sans lien) · avec numéro au titre ${ecartees.filter(e => e.numero).length} · numeros_cartes ${nc.length} · export ${tous.length}`);

    const aDeduire = ecartees.map(e => ({ idProduct: null, slug: e.slug, slugSet: e.slugSet, codeSet: e.code, numero: e.numero, nomFr: e.nomFr, href: e.href, sansImage: true }));
    const r = await deduireLot(aDeduire, {
        expansionsDuSlugSet: async s => [...(expDuSlugSet.get(s) || [])],
        produitsDe: async e => parExp.get(e) || [],
        apprisDe: async ids => new Map(ids.filter(id => parId.has(id)).map(id => [id, parId.get(id)])),
        slugsPortes: async paires => new Set(paires.map(([s, g]) => cleDuSlug(s, g)).filter(k => slugsConnus.has(k))),
        idsApprisDeLExpansion: async (e, s) => nc.filter(n => apprisDeLExpansion(n, e, s)).map(n => n.idProduct),
        idsAuCatalogue: async ids => new Set(ids.filter(id => auCatalogue.has(id)))
    });
    const parRaison = {};
    for (const x of r.refus) { const k = x.raison.replace(/«[^»]*»/g, '«…»').replace(/\d+/g, '#'); parRaison[k] = (parRaison[k] || 0) + 1; }
    const parExpR = {}; for (const d of r.deduites) parExpR[d.idExpansion] = (parExpR[d.idExpansion] || 0) + 1;
    console.log(`\n✅ À APPRENDRE : ${r.deduites.length} (nouvelles ${r.deduites.filter(d => !parId.has(d.idProduct)).length}, lignes existantes complétées ${r.deduites.filter(d => parId.has(d.idProduct)).length}) · par expansion ${JSON.stringify(parExpR)}`);
    console.log('🔴 NON APPRISES, par raison :'); for (const [k, v] of Object.entries(parRaison).filter(([, v]) => v).sort((a, b) => b[1] - a[1])) console.log(`   ${String(v).padStart(4)} · ${k}`);
    for (const x of r.refus.slice(0, 25)) console.log(`      ${x.carte.href} « ${x.carte.nomFr} » (${x.carte.codeSet ?? '—'} ${x.carte.numero ?? '—'}) : ${x.raison}`);
    let g = 20260926; const hasard = () => (g = (g * 1103515245 + 12345) % 2147483648) / 2147483648;
    console.log('\n20 TIRÉS AU SORT parmi les appris :');
    for (const d of [...r.deduites].sort(() => hasard() - 0.5).slice(0, 20)) console.log(`   ${d.carte.href} « ${d.carte.nomFr} » (${d.carte.codeSet} ${d.carte.numero}) → ${d.idProduct} « ${nomDe.get(d.idProduct)} » (exp ${d.idExpansion})${parId.has(d.idProduct) ? ` · ligne ${parId.get(d.idProduct).source} n°${parId.get(d.idProduct).numero ?? '—'}` : ''}`);
    await fermer();
    if (!ecrire) { console.log(`\n   (mesure seule — relancer avec --base=test --attendu=${r.deduites.length} --ecrire, après backup-collections.js --base=test --collections=numeros_cartes)`); return; }
    if (ATTENDU !== r.deduites.length) { console.error(`❌ ARRÊT : ${r.deduites.length} à apprendre contre ${ATTENDU} attendus`); process.exit(1); }
    const mongoose = require('mongoose');
    const { connecterMongo } = require('./mongo-connexion');
    const base = await connecterMongo({ script: 'apprendre-journal.js', ecrit: true });
    if (base !== 'test') { console.error(`❌ ARRÊT : les numéros appris vivent dans « test », pas dans « ${base} »`); await mongoose.disconnect(); process.exit(1); }
    const N = mongoose.connection.db.collection('numeros_cartes');
    const w = await appliquerDeductions(r.deduites, N, { origine: `sans image au journal ${path.basename(JOURNAL)} (image « cardImageNotAvailable »)` });
    console.log(`\n   ✅ insérées ${w.inserees} · complétées ${w.completees} (attendu ${r.deduites.length}) · relu : ${await N.countDocuments({ certitude: 'deduite' })} lignes « deduite » en base`);
    // `appliquerDeductions` ne lève plus : ce qui n'a pas été écrit se DIT, ligne par ligne (seconde relecture du 2026-09-26).
    for (const x of w.sansEffet) console.log(`   ⚠️ non écrite : ${x.d.idProduct} ${x.d.carte.slugSet}/${x.d.carte.slug} — ${x.raison}`);
    if (w.erreur) { console.error(`   ❌ écriture interrompue au produit ${w.erreur.idProduct} (${w.erreur.message}) : ${w.ecrites.length} écrite(s), ${w.nonTentees.length} non tentée(s)`); await mongoose.disconnect(); process.exit(1); }
    await mongoose.disconnect();
})().catch(e => { console.error(e); process.exit(1); });
