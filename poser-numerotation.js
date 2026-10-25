// ============================================================
// LA NUMÉROTATION DES FICHES SANS NUMÉRO — PRÉPARÉE, JAMAIS ÉCRITE SANS LE FEU VERT NOMMÉ DU TESTEUR (PHASE 3a-SUITE, paquet 2, 2026-10-24)
// ============================================================
//   node poser-numerotation.js [--sets=<slug>,…] [--plan=<f>.json]                        (mesure : le plan brut, chaque refus nommé ; rien n'est écrit)
//   node poser-numerotation.js --seulement=<liste>.json [--sets=…] [--plan=<f>.json]     (le plan RESTREINT aux produits confirmés par deux sources)
//   node lot-additif.js --quoi="…" --collections=cartes,cartes_produits -- node poser-numerotation.js --sets=… --seulement=<liste>.json --attendu=<N produits> --ecrire
//
// POURQUOI : `sans-numero` (compteur B) = une fiche servie SANS numéro dans un set qui a des fiches numérotées, alors que le numéro Cardmarket du produit est connu. Poser un numéro sur une fiche qui existe est une
// MODIFICATION de ce que le site affiche : cet outil ne s'exécute pas en écriture sans le feu vert nommé du testeur (la commande est prête, le coordinateur le lui demande). Il fait deux choses, additives :
//   · une impression `source: 'numero-cardmarket'` sur la carte (tirage et nom d'expansion du set, numéro = celui de Cardmarket tel qu'il est imprimé) quand la carte n'en a aucune dans ce set ;
//   · `numeroFiche` sur la ligne de jointure quand il est nul ou absent (jamais une valeur remplacée).
// ÉCRIT PAR CE QU'IL AUTORISE (une carte × tirage × expansion = un GROUPE ; tout le groupe passe ou rien) :
//   · le numéro vient de Cardmarket (numeros_cartes.numero) ET une seconde source indépendante l'a confirmé : `--seulement` = la liste de scanner-deux-sources.js --plans (Cardmarket + au moins une source
//     non-Bulbapedia sur (set, numéro, nom)). Sans liste, rien ne s'écrit. La Setlist de Bulbapedia ne compte pas ;
//   · la preuve « setlist+numero » (impression chinoise virtuelle) passe ici aussi, et c'est un SUR-ENSEMBLE de poser-impressions-setlist.js (qui exige un numéro d'URL : 725 lignes sans) : son numeroFiche (celui de la
//     Setlist) doit être le numéro Cardmarket, sinon « contredit » ; l'impression posée n'a que la marque `numero-cardmarket` ; la carte n'a AUCUNE impression dans ce set (une impression sans numéro, ou à un autre
//     numéro = fiches mélangées : poser-impressions-par-numero.js) ; aucune VRAIE carte ne déclare déjà (tirage, expansion, numéro) (le cas 565029 / 196300) ; aucune image de la carte dans ce set sans numéro (le site repasserait le set
//     ENTIER en « une fiche par document ») ni à un autre numéro (elle ne retrouverait aucune fiche) ;
//   · deux CARTES différentes au même numéro dans le plan : aucune n'est écrite (« 0 ambigu » ne veut pas dire « 0 faux ») ;
//   · le GROUPE : le site montre l'impression dans TOUT set de la carte au même tirage et au même nom d'expansion ; chaque autre produit de la carte dans ces sets doit avoir un numéro connu que les fiches
//     couvrent, sinon il ne serait plus montré nulle part : la carte est refusée ;
//   · le nom d'expansion du set est une chaîne, non synthétique, unique ; le tirage est connu ; la matière spéciale (table fermée) est refusée.
require('dotenv').config();
const fs = require('fs');
const { cleNumero } = require('./collecte-cartes/jointure');
const { estNomSynthetique } = require('./collecte-cartes/nom-synthetique');
const LOT = require('./collecte-cartes/lot-seulement');
const { normaliserNumero } = require('./mesurer-fiches-melangees');

const TIRAGES = new Set(['jp', 'intl', 'zh-hans', 'zh-hant', 'id', 'th', 'idth', 'ko']);
const k = n => cleNumero(String(n ?? ''));
const vide = n => n == null || String(n).trim() === '';

/**
 * Pur. @param {{lignes: object[], NC: Map, cartes: Map, sets: Map, declarants: Map<string, Set<number>>, lignesParCarte: Map<number, object[]>}} e
 *   `lignes` : les lignes candidates ; `declarants` : `${tirage}|${expansion}|${cleNumero}` → les cartes qui déclarent cette impression ; `lignesParCarte` : TOUTES les lignes de jointure de chaque carte.
 * @returns {{aPoser: Map<number, object[]>, numerosFiche: object[], groupes: Map<string, {carteId:number, tirage:string, expansion:string, produits:Set<number>}>, refus: Array<{idProduct:number, motif:string}>}}
 */
function planifier({ lignes, NC, cartes, sets, declarants, lignesParCarte }) {
    const refus = [], bons = new Map();     // groupe → { carteId, tirage, expansion, lignes: [{l, numero}], numeros: Map(cle → numero), imps }
    for (const l of lignes) {
        const refuser = motif => refus.push({ idProduct: l.idProduct, motif });
        const s = sets.get(l.slugSet), c = cartes.get(l.carteId), nc = NC.get(l.idProduct);
        if (!s) { refuser('set absent de la base'); continue; }
        const tirage = s.tirage ?? s.region, exps = [].concat(s.bulba?.expansion ?? []);
        if (exps.length !== 1 || typeof exps[0] !== 'string' || !exps[0]) { refuser('le set n\'a pas UN nom d\'expansion (une impression s\'y afficherait dans tout set sans nom, ou ne désignerait pas le sien)'); continue; }
        if (estNomSynthetique(exps)) { refuser('le nom d\'expansion du set est synthétique (reimpressions/…), pas une expansion Bulbapedia'); continue; }
        if (!TIRAGES.has(tirage)) { refuser(`tirage « ${tirage} » inconnu`); continue; }
        if (!c) { refuser('carte absente'); continue; }
        if (!nc || vide(nc.numero) || !/\d/.test(String(nc.numero))) { refuser('aucun numéro Cardmarket'); continue; }
        const numero = String(nc.numero), expansion = exps[0];
        if (!vide(l.numeroFiche) && k(l.numeroFiche) !== k(numero)) { refuser(`le numeroFiche de la ligne (${l.numeroFiche}) contredit le numéro Cardmarket (${numero})`); continue; }
        const imps = (c.impressions || []).filter(i => i && i.tirage === tirage && i.expansion === expansion);
        if (imps.some(i => vide(i.numero))) { refuser('la carte porte une impression SANS numéro dans ce set (fiche déjà ambiguë : un autre outil)'); continue; }
        const dejaCeNumero = imps.some(i => k(i.numero) === k(numero));
        if (imps.length && !dejaCeNumero) { refuser('la carte porte déjà un autre numéro dans ce set (fiches mélangées : poser-impressions-par-numero.js)'); continue; }
        if (!dejaCeNumero) {
            const autres = [...(declarants.get(`${tirage}|${expansion}|${k(numero)}`) || [])].filter(id => id !== l.carteId);
            if (autres.length) { refuser(`une vraie carte (${autres.slice(0, 3).join(', ')}) déclare déjà l'impression de ce set au numéro ${numero} : un doublon`); continue; }
        }
        const fiches = new Set([...imps.map(i => normaliserNumero(i.numero)), normaliserNumero(numero)]);
        const imgSans = (c.images || []).find(m => m && m.set === l.slugSet && normaliserNumero(m.numero) === null);
        if (imgSans) { refuser('une image de la carte dans ce set est SANS numéro (le set entier basculerait en une fiche par document)'); continue; }
        const orph = (c.images || []).find(m => m && m.set === l.slugSet && !fiches.has(normaliserNumero(m.numero)));
        if (orph) { refuser(`l'image n°${orph.numero} de la carte dans ce set ne retrouverait aucune fiche`); continue; }
        const g = `${l.carteId}|${tirage}|${expansion}`;
        const e = bons.get(g) || bons.set(g, { carteId: l.carteId, tirage, expansion, lignes: [], numeros: new Map(), imps }).get(g);
        e.lignes.push({ l, numero }); e.numeros.set(k(numero), numero);
    }
    // deux CARTES différentes au même (tirage, expansion, numéro) : ambigu, aucune n'est écrite
    const parNumero = new Map();
    for (const [g, e] of bons) for (const cle of e.numeros.keys()) { const kk = `${e.tirage}|${e.expansion}|${cle}`; (parNumero.get(kk) || parNumero.set(kk, new Set()).get(kk)).add(g); }
    const ambigus = new Set(); for (const gs of parNumero.values()) if (gs.size > 1) for (const g of gs) ambigus.add(g);
    for (const g of ambigus) { for (const { l, numero } of bons.get(g).lignes) refus.push({ idProduct: l.idProduct, motif: `une autre carte du plan prend aussi le numéro ${numero} dans ce set : ambigu, aucune n'est écrite` }); bons.delete(g); }
    // le GROUPE de sets (même tirage, même nom d'expansion) : chaque autre produit de la carte doit retrouver une fiche
    const setsDuGroupe = new Map();
    for (const s of sets.values()) { const t = s.tirage ?? s.region, ex = [].concat(s.bulba?.expansion ?? []); if (ex.length === 1) { const kk = `${t}|${ex[0]}`; (setsDuGroupe.get(kk) || setsDuGroupe.set(kk, new Set()).get(kk)).add(s._id); } }
    const aPoser = new Map(), numerosFiche = [], groupes = new Map();
    for (const [g, e] of bons) {
        const slugs = setsDuGroupe.get(`${e.tirage}|${e.expansion}`) || new Set();
        const couverts = new Set([...e.numeros.keys(), ...e.imps.map(i => k(i.numero))]);
        const dansLePlan = new Set(e.lignes.map(x => x.l.idProduct));
        const orphelin = (lignesParCarte.get(e.carteId) || []).find(m => slugs.has(m.slugSet) && !dansLePlan.has(m.idProduct) && (() => { const n = !vide(m.numeroFiche) ? m.numeroFiche : NC.get(m.idProduct)?.numero; return vide(n) || !couverts.has(k(n)); })());
        if (orphelin) { for (const { l } of e.lignes) refus.push({ idProduct: l.idProduct, motif: `un autre produit de la carte (${orphelin.idProduct}, set ${orphelin.slugSet}) ne retrouverait aucune fiche : la carte est refusée` }); continue; }
        for (const [cle, numero] of e.numeros) {
            if (e.imps.some(i => k(i.numero) === cle)) continue;
            (aPoser.get(e.carteId) || aPoser.set(e.carteId, []).get(e.carteId)).push({ tirage: e.tirage, expansion: e.expansion, numero, total: null, deck: null, rarete: null, source: 'numero-cardmarket' });
        }
        for (const { l, numero } of e.lignes) if (vide(l.numeroFiche)) numerosFiche.push({ _id: l._id, carteId: l.carteId, idProduct: l.idProduct, numeroFiche: numero });
        groupes.set(g, { carteId: e.carteId, tirage: e.tirage, expansion: e.expansion, produits: dansLePlan, lignes: e.lignes.map(x => ({ l: x.l, numero: x.numero })) });
    }
    return { aPoser, numerosFiche, groupes, refus };
}

/** @returns {number[]} les idProduct de la liste qu'aucun produit du plan ne porte */
function horsPlan(P, seulement) {
    const vus = new Set(); for (const g of P.groupes.values()) for (const id of g.produits) vus.add(id);
    return LOT.horsPlan(seulement, vus);
}

/** Un groupe ne s'écrit que si TOUS ses produits sont dans la liste. @returns {{aPoser: Map, numerosFiche: object[], groupes: Map, ecartees: Array<{groupe: string, motif: string}>}} */
function restreindre(P, seulement) {
    if (!seulement) return { aPoser: P.aPoser, numerosFiche: P.numerosFiche, groupes: P.groupes, ecartees: [] };
    const groupes = new Map(), ecartees = [], garde = new Set();
    for (const [g, e] of P.groupes) {
        const ids = [...e.produits], oui = ids.filter(id => seulement.has(id));
        if (oui.length !== ids.length) { ecartees.push({ groupe: g, motif: `${oui.length ? 'pas tous les produits' : 'aucun produit'} confirmés par deux sources (${oui.length}/${ids.length})` }); continue; }
        groupes.set(g, e); garde.add(e.carteId);
    }
    const aPoser = new Map();
    for (const [id, imps] of P.aPoser) { const kept = imps.filter(i => [...groupes.values()].some(e => e.carteId === id && e.tirage === i.tirage && e.expansion === i.expansion)); if (kept.length) aPoser.set(id, kept); }
    const prods = new Set(); for (const e of groupes.values()) for (const id of e.produits) prods.add(id);
    return { aPoser, numerosFiche: P.numerosFiche.filter(n => prods.has(n.idProduct)), groupes, ecartees };
}

/** Le plan que scanner-deux-sources.js (--plans) et simuler-abc.js lisent : une LIGNE par produit (existante : `_id` identique, jamais ajoutée), les impressions, les numeroFiche. */
function construirePlan(R, codeParProduit, ligneParProduit) {
    const lignes = [], impressions = [];
    for (const [carteId, imps] of R.aPoser) for (const i of imps) impressions.push({ carteId, imp: i });
    for (const e of R.groupes.values()) for (const { l, numero } of e.lignes) {
        const x = ligneParProduit.get(l.idProduct) || l;
        lignes.push({ _id: x._id, carteId: x.carteId, idProduct: x.idProduct, idExpansion: x.idExpansion, tirage: x.tirage, preuve: x.preuve, slugSet: x.slugSet, numeroFiche: numero, code: codeParProduit.get(x.idProduct) ?? null });
    }
    lignes.sort((a, b) => a.idProduct - b.idProduct);
    return { outil: 'poser-numerotation', lignes, impressions, numerosFiche: R.numerosFiche };
}

module.exports = { planifier, restreindre, horsPlan, construirePlan };

async function principal() {
    const { ouvrirConnexions } = require('./collecte-cartes/garde');
    const { garderMatiereSpeciale } = require('./collecte-cartes/matiere-speciale');
    const AUTORISES = [/^--ecrire$/, /^--seulement=.+\.json$/, /^--plan=.+\.json$/, /^--attendu=\d+$/, /^--sets=[\w.,-]+$/];
    const inconnus = process.argv.slice(2).filter(a => !AUTORISES.some(r => r.test(a)));
    if (inconnus.length) { console.error(`❌ argument inconnu : ${inconnus.join(' ')} — autorisé : --ecrire, --seulement=<f>.json, --plan=<f>.json, --attendu=<N>, --sets=<slug>,…`); process.exit(2); }
    const arg = n => process.argv.slice(2).find(a => a.startsWith(`--${n}=`))?.slice(n.length + 3);
    const ecrire = process.argv.includes('--ecrire');
    const SETS = arg('sets') ? new Set(arg('sets').split(',')) : null;
    let SEULEMENT = null;
    if (arg('seulement')) { try { SEULEMENT = LOT.lireFichier('--seulement', arg('seulement')); } catch (e) { console.error(`❌ ${e.message} — rien n'est écrit`); process.exit(2); } }
    if (ecrire && (!SEULEMENT || !arg('attendu'))) { console.error('❌ --ecrire exige --seulement=<liste>.json ET --attendu=<N produits> : numéroter une fiche existante est une modification, la liste des produits confirmés par deux sources la borne — rien n\'est écrit'); process.exit(2); }

    const { cartes: cx, prod, fermer } = await ouvrirConnexions({ buckets: [] });
    try {
        const sets = new Map((await cx.db.collection('sets').find({}, { projection: { tirage: 1, region: 1, 'bulba.expansion': 1 } }).toArray()).map(s => [s._id, s]));
        const toutes = await cx.db.collection('cartes_produits').find({}, { projection: { carteId: 1, idProduct: 1, idExpansion: 1, slugSet: 1, numeroFiche: 1, preuve: 1, tirage: 1 } }).toArray();
        const cartesDocs = await cx.db.collection('cartes').find({}, { projection: { nomEn: 1, impressions: 1, 'images.set': 1, 'images.numero': 1, sets: 1 } }).toArray();
        const NC = new Map((await prod.db.collection('numeros_cartes').find({}, { projection: { idProduct: 1, numero: 1, codeSet: 1 } }).toArray()).map(n => [n.idProduct, n]));
        for (const [n, l] of [['sets', sets], ['cartes_produits', toutes], ['cartes', cartesDocs], ['numeros_cartes', NC]]) if (!(l.size ?? l.length)) throw new Error(`« ${n} » est VIDE : une planification sur du vide ne mesure rien (§41)`);
        const cartes = new Map(cartesDocs.map(c => [c._id, c]));
        const declarants = new Map();
        for (const c of cartesDocs) for (const i of c.impressions || []) if (i && i.expansion != null && !vide(i.numero)) { const kk = `${i.tirage}|${i.expansion}|${k(i.numero)}`; (declarants.get(kk) || declarants.set(kk, new Set()).get(kk)).add(c._id); }
        const lignesParCarte = new Map(); for (const l of toutes) (lignesParCarte.get(l.carteId) || lignesParCarte.set(l.carteId, []).get(l.carteId)).push(l);
        // les CANDIDATES : une ligne dont la carte n'a pas l'impression (tirage, expansion, numéro Cardmarket) du set de la ligne — c'est elle, et elle seule, qui rend la fiche « sans numéro »
        const candidates = [];
        for (const l of toutes) {
            if (SETS && !SETS.has(l.slugSet)) continue;
            const s = sets.get(l.slugSet), c = cartes.get(l.carteId), nc = NC.get(l.idProduct); if (!s || !c || !nc || vide(nc.numero)) continue;
            const exps = [].concat(s.bulba?.expansion ?? []), t = s.tirage ?? s.region;
            if (exps.length !== 1) continue;
            const impsDuSet = (c.impressions || []).filter(i => i && i.tirage === t && i.expansion === exps[0]);
            if (impsDuSet.some(i => k(i.numero) === k(nc.numero))) continue;
            // la ligne est DÉJÀ placée sur une fiche numérotée (son numeroFiche est une impression du set : « SWSH146 » pour le numéro Cardmarket « 146 ») : elle n'est pas « sans numéro »
            if (!vide(l.numeroFiche) && impsDuSet.some(i => k(i.numero) === k(l.numeroFiche))) continue;
            candidates.push(l);
        }
        console.log(`\n════ DÉNOMINATEUR : ${toutes.length} lignes de jointure · ${candidates.length} candidates (la carte n'a pas l'impression du numéro Cardmarket dans le set de la ligne)${SETS ? ` dans ${[...SETS].join(', ')}` : ''} ════`);
        const P = planifier({ lignes: candidates, NC, cartes, sets, declarants, lignesParCarte });
        const motifs = {}; for (const r of P.refus) { const m = r.motif.replace(/\(.*?\)/g, '(…)').replace(/\d+/g, '#').slice(0, 130); motifs[m] = (motifs[m] || 0) + 1; }
        for (const [m, n] of Object.entries(motifs).sort((a, b) => b[1] - a[1])) console.log(`${String(n).padStart(6)} · refusé : ${m}`);
        const hors = horsPlan(P, SEULEMENT);
        if (hors.length) { console.error(`❌ ARRÊT : ${hors.length} idProduct de --seulement ne sont dans aucun groupe du plan (${hors.slice(0, 8).join(', ')}) — la liste ne correspond pas à l'état de la base, rien n'est écrit`); process.exit(1); }
        const R = restreindre(P, SEULEMENT);
        const nProduits = [...R.groupes.values()].reduce((t, g) => t + g.produits.size, 0), nImp = [...R.aPoser.values()].flat().length;
        const brut = [...P.groupes.values()].reduce((t, g) => t + g.produits.size, 0);
        console.log(`\n   🔑 plan brut : ${P.groupes.size} groupes, ${brut} produits${SEULEMENT ? ` · retenus par la liste : ${R.groupes.size} groupes, ${nProduits} produits · écartés : ${R.ecartees.length} groupes` : ' (sans liste : rien ne s\'écrit)'}`);
        console.log(`   ${nImp} impressions à poser sur ${R.aPoser.size} cartes · ${R.numerosFiche.length} numeroFiche à poser`);
        const parSet = {}; for (const e of R.groupes.values()) for (const x of e.lignes) parSet[x.l.slugSet] = (parSet[x.l.slugSet] || 0) + 1;
        console.log(`   par set : ${Object.entries(parSet).sort((a, b) => b[1] - a[1]).slice(0, 25).map(([s, n]) => `${s} ${n}`).join(' · ')}`);
        try { garderMatiereSpeciale([...R.groupes.values()].flatMap(g => [...g.produits]), 'poser-numerotation'); } catch (e) { console.error(e.message); process.exit(1); }
        if (arg('plan')) fs.writeFileSync(arg('plan'), JSON.stringify(construirePlan(R, new Map([...NC].map(([id, n]) => [id, n.codeSet])), new Map(toutes.map(l => [l.idProduct, l])))));
        if (!ecrire) { console.log('\n   (simulation — l\'écriture exige le feu vert NOMMÉ du testeur, --seulement et --attendu, sous lot-additif.js)'); return; }
        const v = LOT.verifierAttendu({ retenus: nProduits, attendu: Number(arg('attendu')) });
        if (!v.ok) { console.error(`❌ ARRÊT : ${v.motif} — rien n'est écrit`); process.exit(1); }

        // ── l'écriture, en AJOUT : une impression par (carte, numéro) absent ; un numeroFiche nul ou absent seulement ──
        const avantL = await cx.db.collection('cartes_produits').countDocuments({}), avantC = await cx.db.collection('cartes').countDocuments({});
        const preuve = `liste de lot ${require('path').basename(arg('seulement'))} (Cardmarket + au moins une source indépendante non-Bulbapedia)`;
        let nc = 0, nl = 0;
        for (const [id, imps] of R.aPoser) for (const i of imps) nc += (await cx.db.collection('cartes').updateOne({ _id: id, impressions: { $not: { $elemMatch: { tirage: i.tirage, expansion: i.expansion, numero: i.numero } } } }, { $push: { impressions: { ...i, preuveNumero: preuve } } })).modifiedCount;
        for (const n of R.numerosFiche) nl += (await cx.db.collection('cartes_produits').updateOne({ _id: n._id, numeroFiche: { $in: [null, ''] } }, { $set: { numeroFiche: n.numeroFiche, numeroFicheSource: 'poser-numerotation (2026-10-24)' } })).modifiedCount;
        const apresL = await cx.db.collection('cartes_produits').countDocuments({}), apresC = await cx.db.collection('cartes').countDocuments({});
        const relues = await cx.db.collection('cartes').aggregate([{ $match: { _id: { $in: [...R.aPoser.keys()] } } }, { $unwind: '$impressions' }, { $match: { 'impressions.source': 'numero-cardmarket', 'impressions.preuveNumero': preuve } }, { $count: 'n' }]).toArray();
        const lignesRelues = R.numerosFiche.length ? await cx.db.collection('cartes_produits').countDocuments({ _id: { $in: R.numerosFiche.map(n => n._id) }, numeroFicheSource: 'poser-numerotation (2026-10-24)' }) : 0;
        console.log(`\n   RELECTURE : impressions ${nc}/${nImp} écrites · relues ${relues[0]?.n ?? 0} · numeroFiche ${nl}/${R.numerosFiche.length} écrits · relus ${lignesRelues} · cartes_produits ${avantL} → ${apresL} · cartes ${avantC} → ${apresC}`);
        if (nc !== nImp || (relues[0]?.n ?? 0) < nImp || nl !== R.numerosFiche.length || lignesRelues < R.numerosFiche.length || apresL !== avantL || apresC !== avantC) { console.error('❌ la relecture ne retrouve pas tout ce qui devait être écrit'); process.exit(1); }
        console.log('   ✅ écrit et relu');
    } finally { await fermer(); }
}
if (require.main === module) principal().catch(e => { console.error('❌', e.message); process.exit(1); });
