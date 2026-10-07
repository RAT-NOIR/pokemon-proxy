// ============================================================
// LES PRODUITS NUMÉROTÉS « <LETTRE>-<TOTAL> » (2026-10-07). Cardmarket numérote les Unown d'EX Unseen Forces « B-28 » ; la page de carte
// déclare l'impression « B », total « 28 ». La clé par le numéro (cleNumero, creer-sets-par-pages-de-cartes.js) exige un chiffre : elle
// ne voit ni l'un ni l'autre, et ces produits restaient « produit-sans-carte » alors que la carte est chez nous, MEMBRE du set.
// ============================================================
//   node poser-numeros-lettre-total.js                                                        (plan : rien d'écrit)
//   node lot-additif.js --quoi="…" --collections=cartes_produits,cartes -- node poser-numeros-lettre-total.js --attendu=<lignes> --ecrire
// UNE GARDE S'ÉCRIT PAR CE QU'ELLE AUTORISE. Une ligne ne s'écrit que si TOUT ceci tient :
//   · le produit n'a AUCUNE ligne de jointure, et ses restes sont tous « produit-sans-carte » (un autre reste = une décision déjà prise :
//     ARRÊT du plan entier, comme creer-sets-par-pages-de-cartes.js --existants) ;
//   · son numéro appris a la forme exacte « <une lettre, ! ou ?>-<entier> » ;
//   · UN SEUL set porte son expansion, et ce set a un tirage et un nom d'expansion Bulbapedia (bulba.expansion) ;
//   · UNE SEULE vraie carte (pas une fiche simple) déclare une impression (tirage du set, un nom d'expansion du set, numéro = la lettre,
//     total = l'entier) — un numéro qui désigne plusieurs cartes n'en désigne aucune ;
//   · cette carte est DÉJÀ membre du set (cartes.sets) : rien n'entre dans un set ici, donc aucune fiche ne naît vide ;
//   · TÉMOIN (hors de la clé) : le nom Cardmarket porte la lettre entre crochets (« Unown [B] ») ET son nom nu est celui de la carte ;
//   · la carte ne reçoit qu'UN produit de ce plan (deux produits vers une carte : refusés tous les deux, rien ne se mélange).
// La ligne : `preuve: 'set+lettre+total'`, `numeroFiche` = le numéro de l'impression (« B »), `route: 'lettre-total:<slugSet>'` ; la
// carte reçoit l'idProduct et la métacarte dans `liens` ($addToSet). Rien d'autre n'est touché.
require('dotenv').config();
const AUTORISES = [/^--attendu=\d+$/, /^--ecrire$/];
const inconnus = process.argv.slice(2).filter(a => !AUTORISES.some(r => r.test(a)));
if (inconnus.length) { console.error(`❌ argument inconnu : ${inconnus.join(' ')} — autorisés : --attendu=<lignes>, --ecrire`); process.exit(2); }
const ECRIRE = process.argv.includes('--ecrire');
const ATTENDU = Number(process.argv.find(a => a.startsWith('--attendu='))?.slice(10) ?? NaN);
if (ECRIRE && !Number.isInteger(ATTENDU)) { console.error('❌ --ecrire exige --attendu=<lignes> (le compte du plan, relu)'); process.exit(2); }
const { ouvrirConnexions } = require('./collecte-cartes/garde');
const { lireMongo } = require('./collecte-cartes/lecture-sure');
const { produitsDeLExpansion } = require('./collecte-cartes/jointure');

const FORME = /^([A-Z!?])-(\d+)$/i;
const plat = s => String(s ?? '').normalize('NFKC').toLowerCase().replace(/[^a-z0-9]+/g, '');

(async () => {
    const { cartes: cx, prod, fermer } = await ouvrirConnexions({ production: true, buckets: [] });
    const appris = await lireMongo(prod.db.collection('numeros_cartes'), { numero: { $regex: '^[A-Za-z!?]-[0-9]+$' } }, { nom: 'numeros_cartes (forme lettre-total)', projection: { idProduct: 1 }, videAutorise: 'aucun produit de cette forme : rien à poser' });
    const catalogue = await prod.db.collection('catalogue_produits').find({ idProduct: { $in: appris.map(a => a.idProduct) } }, { projection: { idProduct: 1, idExpansion: 1 } }).toArray();
    if (appris.length && !catalogue.length) throw new Error(`${appris.length} produits appris de cette forme et 0 au catalogue : clé fausse, je ne conclus pas`);
    const exps = [...new Set(catalogue.map(p => p.idExpansion).filter(e => e != null))];
    const lignes = new Set(await cx.db.collection('cartes_produits').distinct('idProduct'));
    if (!lignes.size) throw new Error('cartes_produits vide : je ne conclus pas');
    // (relecture) LA REPRISE : les produits que CET outil a déjà posés restent au plan (upserts idempotents) — --attendu ne bouge pas d'un
    // lancement à l'autre, et la relecture finale les compte
    const nosLignes = new Set(await cx.db.collection('cartes_produits').distinct('idProduct', { route: /^lettre-total:/ }));
    const sets = await cx.db.collection('sets').find({ idExpansion: { $in: exps } }, { projection: { idExpansion: 1, tirage: 1, region: 1, bulba: 1 } }).toArray();
    if (exps.length && !sets.length) throw new Error(`${exps.length} expansions et 0 set lu : clé fausse, je ne conclus pas`);
    console.log(`DÉNOMINATEUR : ${appris.length} produits appris de forme « lettre-total » · ${catalogue.length} au catalogue · ${exps.length} expansions · ${sets.length} sets les portent`);
    const plan = [], refus = [];
    const log = console.log;
    for (const exp of exps) {
        const S = sets.filter(s => [].concat(s.idExpansion ?? []).includes(exp));
        console.log = () => { }; const P = await produitsDeLExpansion(prod, exp); console.log = log;
        const aJoindre = P.filter(p => FORME.test(String(p.numero ?? '')) && (!lignes.has(p.idProduct) || nosLignes.has(p.idProduct)));
        if (!aJoindre.length) continue;
        if (S.length !== 1) { for (const p of aJoindre) refus.push(`${p.idProduct} exp ${exp} : ${S.length} set(s) portent l'expansion`); continue; }
        const s = S[0], T = s.tirage ?? s.region, noms = [].concat(s.bulba?.expansion ?? []).filter(Boolean);
        if (!T || !noms.length) { for (const p of aJoindre) refus.push(`${p.idProduct} ${s._id} : set sans tirage ou sans bulba.expansion`); continue; }
        for (const p of aJoindre) {
            const [, L, total] = String(p.numero).match(FORME); const lettre = L.toUpperCase();
            const cs = await cx.db.collection('cartes').find({ _id: { $gt: 0 }, ficheSimple: { $exists: false }, impressions: { $elemMatch: { tirage: T, expansion: { $in: noms }, numero: lettre, total } } }, { projection: { nomEn: 1, sets: 1, impressions: 1 } }).toArray();
            if (cs.length !== 1) { refus.push(`${p.idProduct} ${s._id} n°${p.numero} « ${p.name} » : ${cs.length} carte(s) déclarent ${lettre}/${total}`); continue; }
            const c = cs[0];
            if (!(c.sets || []).includes(s._id)) { refus.push(`${p.idProduct} ${s._id} n°${p.numero} → ${c._id} : la carte n'est pas membre du set`); continue; }
            // le témoin lit le nom Cardmarket BRUT : decomposerNomCardmarket fait de « Unown [B] » le nom « Unown B », et de « [M] »/« [F] »
            // un sexe (§56) — son nom nu ne se compare donc pas à la carte. Ici : le préfixe avant le PREMIER crochet, et la lettre de ce crochet.
            const brut = String(p.name).match(/^(.*?)\s*\[([A-Z!?])\]/i);
            const crochet = brut?.[2], base = brut?.[1];
            if (!crochet || crochet.toUpperCase() !== lettre || !plat(c.nomEn) || plat(base) !== plat(c.nomEn)) { refus.push(`${p.idProduct} ${s._id} « ${p.name} » → ${c._id} « ${c.nomEn} » : témoin du nom en désaccord (crochet [${crochet ?? '—'}], nom « ${base ?? '—'} »)`); continue; }
            const imp = c.impressions.find(i => i.tirage === T && noms.includes(i.expansion) && i.numero === lettre && i.total === total);
            plan.push({ p, c, slug: s._id, T, E: imp.expansion, numeroFiche: imp.numero });
        }
    }
    // une carte, un produit : deux produits vers la même carte sont refusés tous les deux — et (relecture) une ligne DÉJÀ en base de la
    // carte dans ce set, posée par une autre route, compte aussi : elle ferait du second produit une fiche mélangée
    const parCarte = new Map(); for (const x of plan) parCarte.set(x.c._id, (parCarte.get(x.c._id) || 0) + 1);
    const dejaDansLeSet = await cx.db.collection('cartes_produits').find({ carteId: { $in: [...parCarte.keys()] }, route: { $not: /^lettre-total:/ } }, { projection: { carteId: 1, slugSet: 1 } }).toArray();
    // une ligne sans slugSet ne dit pas son set : elle compte comme une ligne du set (une garde qui ne sait pas bloque)
    for (const l of dejaDansLeSet) if (plan.some(x => x.c._id === l.carteId && (l.slugSet == null || x.slug === l.slugSet))) parCarte.set(l.carteId, (parCarte.get(l.carteId) || 0) + 1);
    for (const x of plan.filter(x => parCarte.get(x.c._id) > 1)) refus.push(`${x.p.idProduct} → ${x.c._id} : la carte recevrait ${parCarte.get(x.c._id)} produits`);
    const retenus = plan.filter(x => parCarte.get(x.c._id) === 1);
    const autres = await cx.db.collection('restes').aggregate([{ $match: { idProduct: { $in: retenus.map(x => x.p.idProduct) } } }, { $group: { _id: '$type', n: { $sum: 1 } } }]).toArray();
    console.log(`PLAN : ${retenus.length} lignes · refusés ${refus.length} · restes de ces produits : ${autres.map(a => `${a._id} ${a.n}`).join(' · ') || 'aucun'}`);
    for (const x of retenus) console.log(`   ${x.slug} n°${x.p.numero} « ${x.p.name} » → ${x.c._id} « ${x.c.nomEn} » (${x.E} ${x.numeroFiche}, ${x.T})`);
    for (const r of refus) console.log(`   ✗ ${r}`);
    if (autres.some(a => a._id !== 'produit-sans-carte')) { console.error('🔴 ARRÊT : un produit du plan porte un reste autre que « produit-sans-carte »'); await fermer(); process.exit(1); }
    if (!ECRIRE) { console.log(`(plan seul — --attendu=${retenus.length} --ecrire sous lot-additif.js)`); await fermer(); return; }
    if (ATTENDU !== retenus.length) { console.error(`❌ ARRÊT : le plan rend ${retenus.length} lignes, attendu ${ATTENDU}`); await fermer(); process.exit(1); }
    const le = new Date(), CP = cx.db.collection('cartes_produits'), C = cx.db.collection('cartes');
    if (retenus.length) await C.bulkWrite(retenus.map(x => ({ updateOne: { filter: { _id: x.c._id }, update: { $addToSet: { 'liens.idProduct': x.p.idProduct, ...(x.p.idMetacard != null ? { 'liens.idMetacards': x.p.idMetacard } : {}) } } } })), { ordered: false });
    const posees = retenus.length ? (await CP.bulkWrite(retenus.map(x => ({ updateOne: { filter: { _id: `${x.c._id}|${x.p.idProduct}` }, update: { $setOnInsert: {
        carteId: x.c._id, idProduct: x.p.idProduct, idExpansion: x.p.idExpansion, tirage: x.T, preuve: 'set+lettre+total', slug: x.p.slug ?? null, slugSet: x.slug, numeroFiche: x.numeroFiche,
        detail: `exp ${x.p.idExpansion} n°${x.p.numero} « ${x.p.name} » → « ${x.c.nomEn} » : la page de carte déclare « ${x.E} » ${x.numeroFiche} (${x.T}), seule carte à cette lettre et ce total, membre du set ; témoin : la lettre entre crochets et le nom`,
        verifieLe: le, route: `lettre-total:${x.slug}` } }, upsert: true } })), { ordered: false })).upsertedCount : 0;
    const relu = await CP.countDocuments({ _id: { $in: retenus.map(x => `${x.c._id}|${x.p.idProduct}`) } });
    console.log(`${relu === retenus.length ? '✅' : '🔴'} lignes posées ${posees} · RELU ${relu} lignes du plan présentes (attendu ${retenus.length})`);
    await fermer(); process.exit(relu === retenus.length ? 0 : 1);
})().catch(e => { console.error('🔴', e); process.exit(1); });
