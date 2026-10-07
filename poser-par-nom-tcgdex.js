// ============================================================
// LES PRODUITS SANS NUMÉRO APPRIS D'UN SET RELIÉ À TCGDEX — la clé par le NOM, calibrée, deux sources d'accord (2026-10-07)
// ============================================================
//   node poser-par-nom-tcgdex.js --clone=<clone> --export=<products_singles_*.json>              (calibration + plan : rien d'écrit)
//   node lot-additif.js --quoi="…" --collections=cartes,cartes_produits -- node poser-par-nom-tcgdex.js --clone=… --export=… --attendu=<n> --ecrire
//
// 🔑 LA DEMANDE (testeur, 2026-10-07) : « Pour les 513 par le nom, calibre la clé et n'écris que ce qui atteint 0 faux, avec deux sources
// concordantes. » Les 513 : des produits « produit-sans-carte » d'une expansion reliée à un set TCGdex, dont le numéro n'a jamais été appris
// (Cardmarket ne l'a pas donné). Il ne reste que le NOM — et le §22 a mesuré ce que vaut une clé par nom (31 gagnées contre 364 dérangées).
// LA CLÉ, ÉCRITE AVANT LA CALIBRATION, PAR CE QU'ELLE AUTORISE : pour un produit p de l'expansion X, set S chez nous (seul set de X) :
//   · SOURCE 1, TCGdex : parmi les cartes des sets TCGdex reliés à X, celles dont le nom anglais a une clé commune avec le nom du produit
//     (clesNom, la règle de la jointure) — elles doivent toutes porter le MÊME numéro (cleNumero) : nT ; sinon, rien ;
//   · SOURCE 2, notre base : parmi les cartes qui portent une impression du set S (tirage du set, son nom d'expansion), celles dont le nom
//     a une clé commune avec le produit — UNE seule carte C, et son numéro dans S est nB ; sinon, rien ;
//   · nT = nB : p est joint à C, `numeroFiche` = nB. Le nom est DANS la clé des deux côtés : le témoin indépendant est le NUMÉRO, que
//     chaque source donne sans l'autre. Un désaccord n'écrit rien.
// LA CALIBRATION (`--calibrer`, toujours jouée avant le plan) : la même clé sur les produits de ces expansions DÉJÀ JOINTS par le numéro
// (vérité : la ligne `cartes_produits` et son numéro), numéro caché. Faux = la clé désigne une autre carte, ou le même document à un autre
// numéro. L'ÉCRITURE EST REFUSÉE si la calibration rend un seul faux (consigne : 0 faux).
require('dotenv').config();
const fs = require('fs');
const path = require('path');
// la ligne de commande n'est lue que si ce fichier est LANCÉ (le banc test-poser-cartes-tcgdex.js importe designer)
const arg = n => process.argv.find(a => a.startsWith(`--${n}=`))?.slice(n.length + 3);
let CLONE, EXPORT, ECRIRE, ATTENDU;
if (require.main === module) {
    const AUTORISES = [/^--clone=.+$/, /^--export=.+\.json$/, /^--attendu=\d+$/, /^--ecrire$/];
    const inconnus = process.argv.slice(2).filter(a => !AUTORISES.some(r => r.test(a)));
    if (inconnus.length) { console.error(`❌ argument inconnu : ${inconnus.join(' ')} — autorisés : --clone=, --export=, --attendu=<n>, --ecrire`); process.exit(2); }
    CLONE = arg('clone'); EXPORT = arg('export'); ECRIRE = process.argv.includes('--ecrire'); ATTENDU = arg('attendu') ? Number(arg('attendu')) : null;
    if (!CLONE || !EXPORT) { console.error('❌ --clone= et --export= requis'); process.exit(2); }
    if (ECRIRE && ATTENDU == null) { console.error('❌ --ecrire exige --attendu=<n>'); process.exit(2); }
}
const { ouvrirConnexions } = require('./collecte-cartes/garde');
const { lireMongo } = require('./collecte-cartes/lecture-sure');
const { estCarteCode, cleNumero, clesNom, nomJointDe } = require('./collecte-cartes/jointure');
const { lireClone, nomDuProduit } = require('./poser-cartes-tcgdex');
const ROUTE = 'tcgdex-nom:2026-10-07';
const RESTES_EXCLUS = new Set(['fiche-contredite-par-le-nom', 'fiche-contredite-par-la-metacarte', 'fiche-contredite-par-les-attaques', 'produit-vers-plusieurs-cartes', 'nom-ambigu', 'carte-sans-nom', 'idproduct-contredit-par-tcgdex']);
const aCle = (a, b) => { const A = clesNom(a); return clesNom(b).some(k => A.includes(k)); };

/** La clé, pure. ctx : lies(exp) → dossiers TCGdex, parDossier, setDe(exp) → [sets], cartesDuSet(S) → [{ carte, numero }]. */
function designer(p, ctx) {
    const sets = ctx.setDe(p.idExpansion); if (sets.length !== 1) return { refus: 'set' };
    const S = sets[0], nom = nomDuProduit(p);
    // (calibration du 2026-10-07 : 3 faux sur 14 045, tous de cette forme) une MARQUE DE VERSION entre crochets, à côté des attaques
    // (« Hippowdon [4] Lv.52 [Sand Armor | …] », « Drifblim [FB] ») distingue deux cartes du même nom : la clé ne la lit pas, elle se tait
    const groupes = [...String(p.name ?? '').matchAll(/\[([^\]]*)\]/g)].map(m => m[1].trim()).filter(g => !/^[MF]$/i.test(g));
    if (groupes.length > 1) return { refus: 'marque de version entre crochets que la clé ne lit pas' };
    const t = [...ctx.lies(p.idExpansion)].flatMap(d => (ctx.parDossier.get(d) || []).filter(c => c.en && aCle(c.en, nom)));
    const nT = [...new Set(t.map(c => cleNumero(c.localId)))];
    if (nT.length !== 1) return { refus: nT.length ? 'TCGdex : plusieurs numéros pour ce nom' : 'TCGdex : aucun nom' };
    const b = ctx.cartesDuSet(S).filter(x => aCle(nomJointDe(x.carte), nom));
    const docs = [...new Map(b.map(x => [x.carte._id, x])).values()];
    if (docs.length !== 1) return { refus: docs.length ? 'base : plusieurs cartes de ce nom dans le set' : 'base : aucune carte de ce nom dans le set' };
    const nums = [...new Set(b.map(x => cleNumero(x.numero)))];
    if (nums.length !== 1) return { refus: 'base : la carte porte plusieurs numéros dans le set' };
    if (nums[0] !== nT[0]) return { refus: `désaccord : TCGdex n°${nT[0]}, base n°${nums[0]}` };
    return { S, C: docs[0].carte, numeroFiche: b[0].numero, nT: nT[0], tcgdex: t[0].tcgdexId };
}
module.exports = { designer };

if (require.main === module) (async () => {
    const { sets: setsT, cartes: cartesT } = lireClone(CLONE);
    const E = JSON.parse(fs.readFileSync(EXPORT, 'utf8')).products;
    const expDe = new Map(E.map(p => [p.idProduct, p.idExpansion]));
    const lies = new Map(); const lier = (exp, d) => (lies.get(exp) || lies.set(exp, new Set()).get(exp)).add(d);
    for (const c of cartesT) for (const id of c.ids) { const e = expDe.get(id); if (e) lier(e, c.dossier); }
    for (const [d, s] of setsT) if (s.exp) lier(s.exp, d);
    const parDossier = new Map(); for (const c of cartesT) (parDossier.get(c.dossier) || parDossier.set(c.dossier, []).get(c.dossier)).push(c);
    const { cartes: cx, prod, fermer } = await ouvrirConnexions({ production: true, buckets: [] });
    const lignes = await lireMongo(cx.db.collection('cartes_produits'), {}, { nom: 'cartes_produits', projection: { idProduct: 1, carteId: 1, numeroFiche: 1, slugSet: 1 } });
    const lignesDe = new Map(); for (const l of lignes) (lignesDe.get(l.idProduct) || lignesDe.set(l.idProduct, []).get(l.idProduct)).push(l);
    const restes = await lireMongo(cx.db.collection('restes'), {}, { nom: 'restes', projection: { idProduct: 1, type: 1 } });
    const typesDe = new Map(); for (const r of restes) (typesDe.get(r.idProduct) || typesDe.set(r.idProduct, new Set()).get(r.idProduct)).add(r.type);
    const nums = new Map((await lireMongo(prod.db.collection('numeros_cartes'), {}, { nom: 'numeros_cartes', projection: { idProduct: 1, numero: 1, slug: 1, slugSet: 1 } })).map(n => [n.idProduct, n]));
    const setsB = await lireMongo(cx.db.collection('sets'), {}, { nom: 'sets', projection: { idExpansion: 1, tirage: 1, region: 1, 'bulba.expansion': 1 } });
    const setDe = new Map(); for (const s of setsB) for (const e of [].concat(s.idExpansion ?? [])) (setDe.get(e) || setDe.set(e, []).get(e)).push(s);
    const cartesB = await lireMongo(cx.db.collection('cartes'), {}, { nom: 'cartes', projection: { nomEn: 1, niveau: 1, ficheSimple: 1, impressions: 1 } });
    // les cartes de chaque set (par son tirage et son nom d'expansion) — les PAGES seulement : une fiche simple n'est pas une source
    const parTE = new Map();
    for (const c of cartesB) if (!c.ficheSimple && c._id > 0 && c.nomEn) for (const i of c.impressions || []) if (i?.tirage && typeof i.expansion === 'string' && i.numero) {
        const k = `${i.tirage}|${i.expansion}`; (parTE.get(k) || parTE.set(k, []).get(k)).push({ carte: c, numero: i.numero });
    }
    const cartesDuSet = S => [].concat(S.bulba?.expansion ?? []).filter(e => typeof e === 'string').flatMap(e => parTE.get(`${S.tirage ?? S.region}|${e}`) || []);
    const ctx = { lies: e => lies.get(e) || new Set(), parDossier, setDe: e => setDe.get(e) || [], cartesDuSet };
    const exps = new Set(lies.keys());
    // ── LA CALIBRATION : produits de ces expansions joints à UNE carte, numéro connu ; le numéro caché
    const cal = { juste: 0, faux: 0, silence: 0 }, fauxEx = [], silences = {};
    for (const p of E) {
        if (!exps.has(p.idExpansion) || estCarteCode(p.name ?? '')) continue;
        const ls = lignesDe.get(p.idProduct); if (!ls || ls.length !== 1 || !nums.get(p.idProduct)?.numero) continue;
        const d = designer(p, ctx);
        if (d.refus) { cal.silence++; silences[d.refus.replace(/n°\S+/g, 'n°…')] = (silences[d.refus.replace(/n°\S+/g, 'n°…')] || 0) + 1; continue; }
        const v = ls[0];
        const ok = d.C._id === v.carteId && (v.numeroFiche == null || cleNumero(v.numeroFiche) === cleNumero(d.numeroFiche));
        if (ok) cal.juste++; else { cal.faux++; if (fauxEx.length < 12) fauxEx.push(`${p.idProduct} « ${p.name} » : vérité ${v.carteId} n°${v.numeroFiche ?? '—'} · clé ${d.C._id} « ${d.C.nomEn} » n°${d.numeroFiche}`); }
    }
    const ncal = cal.juste + cal.faux + cal.silence;
    console.log(`CALIBRATION (produits joints à une carte, numéro connu puis CACHÉ, dans ${exps.size} expansions reliées) : ${ncal} · justes ${cal.juste} · FAUX ${cal.faux} · silences ${cal.silence}${cal.juste + cal.faux ? ` · précision ${(100 * cal.juste / (cal.juste + cal.faux)).toFixed(2)} %` : ''}`);
    for (const [k, n] of Object.entries(silences).sort((a, b) => b[1] - a[1]).slice(0, 6)) console.log(`   silence ${n} : ${k}`);
    for (const f of fauxEx) console.log(`   🔴 ${f}`);
    // ── LE PLAN : les produits sans ligne, reste « produit-sans-carte », numéro jamais appris, d'une expansion reliée
    const cibles = E.filter(p => exps.has(p.idExpansion) && !estCarteCode(p.name ?? '') && !lignesDe.has(p.idProduct) && !nums.get(p.idProduct)?.numero
        && typesDe.get(p.idProduct)?.has('produit-sans-carte') && ![...typesDe.get(p.idProduct)].some(t => RESTES_EXCLUS.has(t)));
    const plan = cibles.map(p => ({ p, n: nums.get(p.idProduct), ...designer(p, ctx) }));
    const ok = plan.filter(d => !d.refus), refus = {}; for (const d of plan.filter(d => d.refus)) refus[d.refus.replace(/n°\S+/g, 'n°…')] = (refus[d.refus.replace(/n°\S+/g, 'n°…')] || 0) + 1;
    console.log(`PLAN : ${cibles.length} produits (sans ligne, sans numéro appris, expansion reliée) → joints ${ok.length} · refusés ${cibles.length - ok.length}`);
    for (const [k, n] of Object.entries(refus).sort((a, b) => b[1] - a[1]).slice(0, 8)) console.log(`   ✗ ${n} : ${k}`);
    let g = 20261007; const hasard = () => (g = (g * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (const d of [...ok].sort(() => hasard() - 0.5).slice(0, 12)) console.log(`   ${d.p.idProduct} « ${d.p.name} » (${d.S._id}) → ${d.C._id} « ${d.C.nomEn} » n°${d.numeroFiche} · TCGdex ${d.tcgdex}`);
    if (!ECRIRE) { console.log('(plan seul — --attendu=<n> --ecrire sous lot-additif.js, refusé si la calibration a un seul faux)'); await fermer(); return; }
    if (cal.faux > 0) { console.error(`❌ ARRÊT : la calibration rend ${cal.faux} faux — consigne : 0 faux`); await fermer(); process.exit(1); }
    if (ok.length !== ATTENDU) { console.error(`❌ ARRÊT : le plan rend ${ok.length}, attendu ${ATTENDU}`); await fermer(); process.exit(1); }
    const le = new Date(), C = cx.db.collection('cartes'), CP = cx.db.collection('cartes_produits');
    const metaDe = new Map((await prod.db.collection('catalogue_produits').find({ idProduct: { $in: ok.map(d => d.p.idProduct) } }, { projection: { idProduct: 1, idMetacard: 1 } }).toArray()).map(x => [x.idProduct, x.idMetacard ?? null]));
    await C.bulkWrite(ok.map(d => ({ updateOne: { filter: { _id: d.C._id }, update: { $addToSet: { sets: d.S._id, 'liens.idProduct': d.p.idProduct, ...(metaDe.get(d.p.idProduct) != null ? { 'liens.idMetacards': metaDe.get(d.p.idProduct) } : {}) } } } })), { ordered: false });
    const r = await CP.bulkWrite(ok.map(d => ({ updateOne: { filter: { _id: `${d.C._id}|${d.p.idProduct}` }, update: { $setOnInsert: {
        carteId: d.C._id, idProduct: d.p.idProduct, idExpansion: d.p.idExpansion, tirage: d.S.tirage ?? d.S.region, preuve: 'nom+tcgdex+base', slug: d.n?.slug ?? null, slugSet: d.n?.slugSet ?? d.S._id,
        numeroFiche: d.numeroFiche, detail: `« ${d.p.name} » (numéro jamais appris) : le nom désigne dans TCGdex ${d.tcgdex} (n°${d.nT}) et chez nous ${d.C._id} « ${d.C.nomEn} » (n°${d.numeroFiche} de ${d.S._id}) — deux sources, même numéro ; clé calibrée ${cal.juste} justes / ${cal.faux} faux`,
        verifieLe: le, route: ROUTE } }, upsert: true } })), { ordered: false });
    const relu = await CP.countDocuments({ route: ROUTE });
    console.log(`${relu === ok.length ? '✅' : '🔴'} lignes posées ${r.upsertedCount} · RELU ${relu} « ${ROUTE} » (attendu ${ok.length})`);
    console.log(`SETS : ${[...new Set(ok.map(d => d.S._id))].join(',')}`);
    if (relu !== ok.length) process.exitCode = 1;
    await fermer();
})().catch(e => { console.error(e); process.exit(1); });
