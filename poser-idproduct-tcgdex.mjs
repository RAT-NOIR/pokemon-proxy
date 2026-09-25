// ============================================================
// LES idProduct CARDMARKET QUE PORTE TCGDEX — corriger ce qu'ils contredisent, poser ce qu'ils départagent
// ============================================================
//   node poser-idproduct-tcgdex.mjs --clone=<clone tcgdex/cards-database>                         (mesure + 20 tirés au sort par geste)
//   node poser-idproduct-tcgdex.mjs --clone=<…> --attendu=corriger:N,detacher:N,fiche:N --ecrire     (par lot-additif.js)
//
// 🔑 LA DEMANDE (testeur, 2026-09-25, point 3) : TCGdex écrit l'idProduct Cardmarket de chaque variante
// (`variants[].thirdParty.cardmarket`). Le site l'a mesuré (scripts/mesurer-idproduct-tcgdex.mjs) : des jointures le contredisent —
// des prix FAUX servis (Staryu 103/104 échangés dans Skyridge) — et des produits « sans source » (document à plusieurs fiches, que
// la lecture du slug ne place pas) seraient départagés par un idProduct unique. Consigne : corriger quand TCGdex et le numéro de la
// carte concordent, sinon détacher ; poser les départagés qui ne contredisent pas le slug. Mesure, 20 regardés, puis écriture.
//
// LES RÈGLES, ÉCRITES AVANT LA MESURE :
// • Le PONT TCGdex → notre document est celui du site : l'identifiant TCGdex que nos impressions portent en preuve d'illustrateur
//   (`illustrateurPreuve` « TCGdex sv03-223 »). Un idProduct sans pont ne dit rien de nos documents : il n'est pas lu.
// • CONTRADICTION : la ligne joint le produit au document A, TCGdex le donne au document B (et à aucun document A).
//   CORRIGER (la ligne passe de A à B) seulement si les TROIS tiennent : B est UN seul document ; le numéro TCGdex (localId) est
//   le numéro Cardmarket du produit ; B est membre du set de la ligne et son nom est celui du produit (témoin du nom, §53).
//   Sinon DÉTACHER : la ligne est retirée, un reste `idproduct-contredit-par-tcgdex` la nomme. Deux sources qui se contredisent
//   ne font pas un prix.
// • SANS SOURCE (règles du site importées) : le produit est joint à un document à ≥ 2 fiches et la lecture du slug ne le place
//   sur aucune ; TCGdex donne des numéros dont UN SEUL est une fiche du document ; le slug ne désigne pas une autre fiche.
//   → `numeroFiche` posé, preuve `tcgdex-idproduct` — seulement là où il est ABSENT ; une valeur déjà posée qui diffère est LISTÉE.
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
const R = 'C:/Users/Yung/Desktop/pokemon-proxy', S = 'C:/Users/Yung/Desktop/rat-market-site';
const require = createRequire(`${R}/package.json`);
process.chdir(R);
require('dotenv').config({ path: `${R}/.env` });
const site = async f => import(pathToFileURL(`${S}/lib/${f}`).href);
const { fichesDuDocument } = await site('impressionsDuSet.ts');
const { ficheDuProduit, produitsDeLaFiche, segmentApresLeCode } = await site('cardmarket.ts');
const { ouvrirConnexions } = require('./collecte-cartes/garde');
const { lireMongo } = require('./collecte-cartes/lecture-sure');
const { cleNumero, normaliserNom, decomposerNomCardmarket } = require('./collecte-cartes/jointure');

const arg = n => process.argv.find(a => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const CLONE = arg('clone'), ecrire = process.argv.includes('--ecrire');
const ATTENDUS = Object.fromEntries((arg('attendu') || '').split(',').filter(Boolean).map(x => { const [k, v] = x.split(':'); return [k, Number(v)]; }));
if (!CLONE || !fs.existsSync(path.join(CLONE, 'data'))) { console.error('❌ --clone=<chemin du clone tcgdex/cards-database> requis'); process.exit(2); }

// ── 1. Le dépôt : idProduct → cartes TCGdex (lecture au motif, comme le script du site)
const parIdProduct = new Map();
let fichiers = 0;
for (const monde of ['data', 'data-asia']) {
    for (const serie of fs.readdirSync(path.join(CLONE, monde))) {
        const dS = path.join(CLONE, monde, serie); if (!fs.statSync(dS).isDirectory()) continue;
        for (const e of fs.readdirSync(dS)) {
            const dSet = path.join(dS, e); if (!fs.statSync(dSet).isDirectory()) continue;
            let setId = null; try { setId = /\bid:\s*["']([^"']+)["']/.exec(fs.readFileSync(path.join(dS, `${e}.ts`), 'utf8'))?.[1] ?? null; } catch { /* pas de fichier de set */ }
            for (const f of fs.readdirSync(dSet)) {
                if (!f.endsWith('.ts')) continue; fichiers++;
                const src = fs.readFileSync(path.join(dSet, f), 'utf8');
                for (const id of new Set([...src.matchAll(/cardmarket:\s*(\d+)/g)].map(m => Number(m[1]))))
                    (parIdProduct.get(id) || parIdProduct.set(id, []).get(id)).push({ id: `${setId}-${f.slice(0, -3)}`, localId: f.slice(0, -3), monde });
            }
        }
    }
}
console.log(`TCGdex (clone) : ${fichiers} fichiers de carte · ${parIdProduct.size} idProduct distincts`);

// ── 2. Notre base
const { cartes: cx, prod, fermer } = await ouvrirConnexions({ production: true, buckets: [] });
const sets = new Map((await lireMongo(cx.db.collection('sets'), { nomAffichage: { $type: 'string' } }, { nom: 'sets publiés', projection: { region: 1, tirage: 1, code: 1, 'bulba.expansion': 1 } }))
    .map(s => [s._id, { ...s, tirage: s.tirage ?? s.region, exps: [].concat(s.bulba?.expansion ?? []) }]));
const docs = new Map(), pont = new Map();
for (const d of await lireMongo(cx.db.collection('cartes'), { nomEn: { $type: 'string', $ne: '' } }, { nom: 'cartes', projection: { nomEn: 1, sets: 1, impressions: 1, 'attaques.nom': 1 } })) {
    docs.set(d._id, d);
    for (const i of d.impressions ?? []) { const id = /TCGdex ([a-z0-9]+(?:\.[0-9]+)?[a-z]*-[A-Za-z0-9]+)/i.exec(i.illustrateurPreuve ?? '')?.[1]; if (id) pont.set(id, { docId: d._id, numero: i.numero, expansion: i.expansion }); }
}
const lignes = await lireMongo(cx.db.collection('cartes_produits'), {}, { nom: 'cartes_produits', projection: { carteId: 1, slugSet: 1, slug: 1, idProduct: 1, idExpansion: 1, numeroFiche: 1, preuve: 1 } });
const ncNum = new Map((await lireMongo(prod.db.collection('numeros_cartes'), { idProduct: { $in: [...new Set(lignes.map(l => l.idProduct))] } }, { nom: 'numeros_cartes', projection: { idProduct: 1, numero: 1 } })).map(n => [n.idProduct, n.numero]));
const nomCat = new Map((await lireMongo(prod.db.collection('catalogue_produits'), { idProduct: { $in: [...new Set(lignes.map(l => l.idProduct))] } }, { nom: 'catalogue_produits', projection: { idProduct: 1, name: 1 } })).map(p => [p.idProduct, p.name]));
console.log(`DÉNOMINATEUR : ${lignes.length} lignes de jointure · ${docs.size} documents nommés · ${pont.size} identifiants TCGdex portés (le pont)`);
const nu = s => normaliserNom(String(s || '').replace(/δ/g, 'delta'));

// ── 3. Contradictions
const cpt = { communs: 0, concordent: 0, sansPont: 0 };
const corriger = [], detacher = [];
const lignesDuProduit = new Map(); for (const l of lignes) (lignesDuProduit.get(l.idProduct) || lignesDuProduit.set(l.idProduct, []).get(l.idProduct)).push(l);
for (const l of lignes) {
    const tc = parIdProduct.get(l.idProduct); if (!tc) continue;
    cpt.communs++;
    const cibles = tc.map(c => ({ ...c, ...pont.get(c.id) })).filter(c => c.docId != null);
    if (!cibles.length) { cpt.sansPont++; continue; }
    if (cibles.some(c => c.docId === l.carteId)) { cpt.concordent++; continue; }
    const docsB = [...new Set(cibles.map(c => c.docId))];
    const B = docsB.length === 1 ? docs.get(docsB[0]) : null;
    const numCm = ncNum.get(l.idProduct), locaux = [...new Set(cibles.map(c => cleNumero(c.localId)))];
    const nomProduit = decomposerNomCardmarket(nomCat.get(l.idProduct) || '').nom;
    const raisons = [];
    if (!B) raisons.push(`TCGdex désigne ${docsB.length} documents (${docsB.join('/')})`);
    if (!numCm || !locaux.includes(cleNumero(numCm))) raisons.push(`numéro Cardmarket ${numCm ?? '—'} ≠ TCGdex ${locaux.join('/')}`);
    if (B && !(B.sets || []).includes(l.slugSet)) raisons.push(`le document TCGdex ${B._id} n'est pas membre de ${l.slugSet}`);
    if (B && nu(B.nomEn) !== nu(nomProduit)) raisons.push(`nom « ${B.nomEn} » ≠ produit « ${nomProduit} »`);
    // TÉMOIN DES ATTAQUES (indépendant des deux numéros) : les attaques que Cardmarket écrit entre crochets désignent-elles
    // notre document (A) ou celui de TCGdex (B) ? Un détachement ne se justifie que si notre ligne est FAUSSE ; si les attaques
    // confirment A, c'est TCGdex qui se trompe de produit, et détacher retirerait une fiche juste.
    const attaques = decomposerNomCardmarket(nomCat.get(l.idProduct) || '').attaques.map(nu).filter(Boolean);
    const score = d => (d?.attaques || []).filter(a => attaques.includes(nu(a.nom))).length;
    const [sA, sB] = [score(docs.get(l.carteId)), B ? score(B) : 0];
    const temoin = !attaques.length ? 'sans attaque' : sA > sB ? 'A (notre ligne)' : sB > sA ? 'B (TCGdex)' : 'égalité';
    const x = { ligne: l, A: docs.get(l.carteId)?.nomEn, B: B?._id, nomB: B?.nomEn, tcgdex: cibles.map(c => c.id).join('/'), numCm, nomProduit, raisons, temoin };
    (raisons.length ? detacher : corriger).push(x);
}
// ── 4. Sans source (règles du site) → numeroFiche
const groupes = new Map(); for (const l of lignes) { const k = `${l.carteId}|${l.slugSet}`; (groupes.get(k) || groupes.set(k, []).get(k)).push(l); }
const fiche = [], ficheConflit = [], ficheContredit = [];
let sansSource = 0, ficheDejaEgale = 0;
for (const [k, ps] of groupes) {
    const [carteId, slugSet] = k.split('|'); const set = sets.get(slugSet), d = docs.get(Number(carteId));
    if (!set || !d || !(d.sets ?? []).includes(slugSet)) continue;
    const fs_ = fichesDuDocument((d.impressions ?? []).filter(i => i.tirage === set.tirage && set.exps.includes(i.expansion)));
    if (fs_.length < 2) continue;
    const numeros = fs_.map(f => f.numero);
    const places = new Set(); for (const [rang] of fs_.entries()) for (const p of produitsDeLaFiche(ps, rang, numeros, set.code)) places.add(p.idProduct);
    for (const p of ps) {
        if (places.has(p.idProduct)) continue;
        sansSource++;
        const tc = parIdProduct.get(p.idProduct); if (!tc) continue;
        const locaux = tc.map(c => cleNumero(c.localId));
        const rangs = numeros.map((n, i) => (locaux.includes(cleNumero(n)) ? i : -1)).filter(i => i >= 0);
        if (rangs.length !== 1) continue;
        const lu = ficheDuProduit(p.slug, numeros, set.code);
        if (lu !== null && lu !== rangs[0]) { ficheContredit.push({ p, numero: numeros[rangs[0]], lu: numeros[lu] }); continue; }
        const x = { p, numero: numeros[rangs[0]], tcgdex: tc.map(c => c.id).join('/'), nom: d.nomEn, seg: segmentApresLeCode(p.slug, set.code) };
        if (p.numeroFiche != null && cleNumero(p.numeroFiche) !== cleNumero(x.numero)) ficheConflit.push({ ...x, deja: p.numeroFiche });
        else if (p.numeroFiche == null) fiche.push(x);
        else ficheDejaEgale++;   // la jointure l'avait déjà posé, et TCGdex le confirme
    }
}
console.log(`\nidProduct communs ${cpt.communs} · concordent ${cpt.concordent} · sans pont ${cpt.sansPont} · CONTREDISENT ${corriger.length + detacher.length} → corriger ${corriger.length}, détacher ${detacher.length}`);
const raisonsD = {}; for (const x of detacher) for (const r of x.raisons) { const k = r.replace(/\d+/g, '#').replace(/«[^»]*»/g, '«…»'); raisonsD[k] = (raisonsD[k] || 0) + 1; }
console.log('   raisons de détacher :', JSON.stringify(raisonsD));
const tem = {}; for (const x of [...corriger, ...detacher]) tem[x.temoin] = (tem[x.temoin] || 0) + 1;
console.log(`   TÉMOIN DES ATTAQUES sur les ${corriger.length + detacher.length} contradictions : ${JSON.stringify(tem)}`);
console.log(`sans source (règles du site) ${sansSource} · départagés par TCGdex : numeroFiche à poser ${fiche.length} · déjà posé par la jointure et CONFIRMÉ par TCGdex ${ficheDejaEgale} · déjà posé et DIFFÉRENT (listé, non touché) ${ficheConflit.length} · le slug désigne une autre fiche (non posé) ${ficheContredit.length}`);
let g = 20260925; const hasard = () => (g = (g * 1103515245 + 12345) % 2147483648) / 2147483648;
const tirer = l => [...l].sort(() => hasard() - 0.5).slice(0, 20);
console.log('\n20 CORRECTIONS tirées au sort :'); for (const x of tirer(corriger)) console.log(`   ${x.ligne.slug} « ${nomCat.get(x.ligne.idProduct)} » n°${x.numCm} (${x.ligne.slugSet}) : ${x.ligne.carteId} « ${x.A} » → ${x.B} « ${x.nomB} » · TCGdex ${x.tcgdex}`);
console.log('\n20 DÉTACHEMENTS tirés au sort :'); for (const x of tirer(detacher)) console.log(`   ${x.ligne.slug} « ${nomCat.get(x.ligne.idProduct)} » (${x.ligne.slugSet}) : chez nous ${x.ligne.carteId} « ${x.A} » · TCGdex ${x.tcgdex} → ${x.B ?? '?'} « ${x.nomB ?? '?'} » · ${x.raisons.join(' ; ')} · attaques → ${x.temoin}`);
console.log('\n20 numeroFiche tirés au sort :'); for (const x of tirer(fiche)) console.log(`   ${x.p.slug} « ${nomCat.get(x.p.idProduct)} » (${x.p.slugSet}) → carte ${x.p.carteId} « ${x.nom} » fiche n°${x.numero} · TCGdex ${x.tcgdex} · segment du slug « ${x.seg ?? '—'} »`);
fs.writeFileSync(`${R}/collecte-cartes/rapports/idproduct-tcgdex.json`, JSON.stringify({ corriger: corriger.map(x => ({ ...x, ligne: x.ligne._id })), detacher: detacher.map(x => ({ ...x, ligne: x.ligne._id })), fiche: fiche.map(x => ({ _id: x.p._id, numero: x.numero, tcgdex: x.tcgdex })), ficheConflit: ficheConflit.map(x => ({ _id: x.p._id, numero: x.numero, deja: x.deja })), ficheContredit: ficheContredit.map(x => ({ _id: x.p._id, numero: x.numero, lu: x.lu })) }, null, 1));

// L'annonce de la garde : un détachement fait baisser « fiches exp:N » quand le produit n'a plus AUCUNE ligne dans son expansion.
const annonce = {};
const retirees = new Set(detacher.map(x => String(x.ligne._id)));
for (const x of detacher) { const restent = (lignesDuProduit.get(x.ligne.idProduct) || []).filter(l => !retirees.has(String(l._id)) && l.idExpansion === x.ligne.idExpansion); if (!restent.length) { const k = `fiches exp:${x.ligne.idExpansion}`; annonce[k] = (annonce[k] || 0) + 1; } }
// une correction retire une ligne et en pose une autre sur le même produit : aucune fiche ne baisse
fs.writeFileSync(`${R}/collecte-cartes/rapports/annonce-idproduct.json`, JSON.stringify(annonce, null, 1));
console.log(`\nannonce de la garde (baisses attendues) : ${Object.values(annonce).reduce((a, b) => a + b, 0)} fiches sur ${Object.keys(annonce).length} expansions → collecte-cartes/rapports/annonce-idproduct.json`);

if (!ecrire) { console.log(`\n   (mesure seule — relancer avec --attendu=corriger:${corriger.length},detacher:${detacher.length},fiche:${fiche.length} --ecrire, par lot-additif.js --annonce=collecte-cartes/rapports/annonce-idproduct.json)`); await fermer(); process.exit(0); }
for (const [k, l] of [['corriger', corriger], ['detacher', detacher], ['fiche', fiche]]) if (ATTENDUS[k] !== l.length) { console.error(`❌ ARRÊT : ${k} ${l.length} contre ${ATTENDUS[k]} attendus — la base ou la règle a bougé depuis la mesure regardée`); await fermer(); process.exit(1); }

// ── 5. Écriture
const L = cx.db.collection('cartes_produits'), C = cx.db.collection('cartes'), RS = cx.db.collection('restes');
const maintenant = new Date();
for (const x of corriger) {
    const a = x.ligne, id = `${x.B}|${a.idProduct}`;
    await L.updateOne({ _id: id }, { $set: { carteId: x.B, idProduct: a.idProduct, idExpansion: a.idExpansion, slugSet: a.slugSet, slug: a.slug, preuve: 'tcgdex-idproduct', numeroFiche: x.numCm, detail: `TCGdex ${x.tcgdex} porte l'idProduct ${a.idProduct} ; numéro Cardmarket ${x.numCm} = numéro TCGdex ; nom « ${x.nomB} » ; remplace la ligne ${a._id} (« ${x.A} », preuve ${a.preuve})`, verifieLe: maintenant } }, { upsert: true });
    await L.deleteOne({ _id: a._id });
    await C.updateOne({ _id: a.carteId }, { $pull: { 'liens.idProduct': a.idProduct } });
    await C.updateOne({ _id: x.B }, { $addToSet: { 'liens.idProduct': a.idProduct } });
}
for (const x of detacher) {
    const a = x.ligne;
    await L.deleteOne({ _id: a._id });
    if (!(lignesDuProduit.get(a.idProduct) || []).some(l => l.carteId === a.carteId && String(l._id) !== String(a._id))) await C.updateOne({ _id: a.carteId }, { $pull: { 'liens.idProduct': a.idProduct } });
    await RS.insertOne({ set: a.slugSet, idProduct: a.idProduct, type: 'idproduct-contredit-par-tcgdex', detail: `ligne ${a._id} (« ${x.A} », preuve ${a.preuve}) détachée : TCGdex ${x.tcgdex} → ${x.B ?? '?'} « ${x.nomB ?? '?'} » ; ${x.raisons.join(' ; ')}`, le: maintenant });
}
let poses = 0;
for (const x of fiche) poses += (await L.updateOne({ _id: x.p._id, numeroFiche: null }, { $set: { numeroFiche: x.numero, numeroFichePreuve: `tcgdex-idproduct ${x.tcgdex}` } })).modifiedCount;
console.log(`\n   ✅ corrigées ${corriger.length} · détachées ${detacher.length} · numeroFiche posés ${poses}/${fiche.length}`);
await fermer();
