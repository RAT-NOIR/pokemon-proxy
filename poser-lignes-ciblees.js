// ============================================================
// UNE LIGNE DE JOINTURE PROUVÉE, POSÉE SANS REPARSE (lot POP2, 2026-10-13)
// ============================================================
//   node poser-lignes-ciblees.js --code=PAL --produits=872163                                    (simulation : rien n'est écrit)
//   node poser-lignes-ciblees.js --code=x30C --produits=909373,909374 --cartes-du-parent         (un Additionals jamais collecté : cartes du parent)
//   node lot-additif.js --quoi="…" --collections=cartes,cartes_produits -- node poser-lignes-ciblees.js --code=PAL --produits=872163 --attendu=1 --ecrire
//
// POURQUOI : `collecteur-texte.js --set=X --reparser` rejoue TOUTE la jointure d'un set, et son upsert `$set` réécrit chaque ligne que joindre() refabrique —
// y compris celles qu'un AUTRE outil avait posées sous le même _id (mesuré POP2 : PAL, 25 lignes `tcgdex+pont` passent à `set+numero` ; 30C, 6 lignes
// `metacarte+nom+attaques` passent à `setlist+nom+attaques`). Quand le gain d'un set est UN produit appris après la jointure (PAL Ghetsis V5, MEP Paradise Resort
// ×2, 30C Mew R/G/B), la ligne que joindre() PRODUIT pour lui est la seule à poser. Cet outil rejoue joindre() à blanc (les cartes du set, tels qu'elles sont en
// base, et les produits de l'expansion), garde les lignes des produits NOMMÉS, et les écrit en `$setOnInsert` : jamais une ligne existante réécrite, quelle que soit sa preuve.
// ADDITIF : la ligne (upsert $setOnInsert), `liens.idProduct` et `liens.idMetacards` de la carte en `$addToSet` — l'idProduct s'ajoute EN FIN, le repère d'adresse
// du site (liens.idProduct[0]) ne bouge pas. Aucune impression, aucune image, aucun `sets` (la carte est déjà membre : c'est joindre() qui l'a trouvée dans le set).
// REFUS : produit non nommé par le catalogue de l'expansion · produit que joindre() ne joint pas (nom/numéro ambigus, témoin du nom, aucune carte) · ligne déjà là.
const { joindre } = require('./collecte-cartes/jointure');

function planifier({ cartes, produits, optionsJoindre, existants, visees }) {
    const J = joindre(cartes, produits, optionsJoindre);
    const parId = new Map(), plusieurs = new Set();
    for (const l of J.lignes) { if (parId.has(l.idProduct)) plusieurs.add(l.idProduct); parId.set(l.idProduct, l); }
    for (const r of J.restes) if (r.type === 'produit-vers-plusieurs-cartes') { const m = /^(\d+)/.exec(String(r.detail || '')); if (m) plusieurs.add(Number(m[1])); }
    const connus = new Set(produits.map(p => p.idProduct));
    const lignes = [], refus = [], deja = [];
    for (const id of visees) {
        if (!connus.has(id)) { refus.push({ idProduct: id, raison: `produit ${id} absent du catalogue de l'expansion` }); continue; }
        if (plusieurs.has(id)) { refus.push({ idProduct: id, raison: `joindre() rattache le produit ${id} à plusieurs cartes : on ne choisit pas` }); continue; }
        const l = parId.get(id);
        if (!l) { const r = J.restes.find(x => x.idProduct === id || String(x.detail || '').startsWith(String(id))); refus.push({ idProduct: id, raison: `joindre() ne joint pas le produit ${id}${r ? ` (${r.type})` : ''}` }); continue; }
        const e = existants.get(l._id);
        if (e) { deja.push({ _id: l._id, preuve: e.preuve }); continue; }
        lignes.push(l);
    }
    return { lignes, refus, deja };
}

function verifierAttendu(plan, attendu) {
    if (!Number.isInteger(attendu)) return { ok: false, raison: '--attendu=N obligatoire pour écrire' };
    if (plan.lignes.length !== attendu) return { ok: false, raison: `le plan compte ${plan.lignes.length} ligne(s), attendu ${attendu}` };
    return { ok: true };
}

/** `metaDe` : idProduct -> idMetacard. Rend { lignes, cartes } = ce qui a réellement été modifié. */
async function ecrireLignes(db, lignes, metaDe) {
    let n = 0, c = 0;
    for (const l of lignes) n += (await db.collection('cartes_produits').updateOne({ _id: l._id }, { $setOnInsert: l }, { upsert: true })).upsertedCount;
    const parCarte = new Map();
    for (const l of lignes) { const w = parCarte.get(l.carteId) || parCarte.set(l.carteId, { ids: [], metas: new Set() }).get(l.carteId); w.ids.push(l.idProduct); if (metaDe.get(l.idProduct) != null) w.metas.add(metaDe.get(l.idProduct)); }
    for (const [carteId, w] of parCarte) c += (await db.collection('cartes').updateOne({ _id: carteId }, { $addToSet: { 'liens.idProduct': { $each: w.ids }, 'liens.idMetacards': { $each: [...w.metas] } } })).modifiedCount;
    return { lignes: n, cartes: c };
}

/**
 * Les cartes que joindre() reçoit. Par défaut, celles qui portent le slug de la ligne. `--cartes-du-parent` (lot X30C, 2026-10-13) : un ADDITIONALS dont le
 * slug n'est porté que par ses fiches simples (aucune collecte du slug n'a eu lieu) joint les cartes de son PARENT — celui que la ligne déclare (`additionalsDe`),
 * jamais une fiche simple (elle serait « jointe » à elle-même). La ligne reste écrite sous le slug de l'Additionals.
 */
function filtreDesCartes(L, duParent, ligneDe) {
    if (!duParent) return { sets: L.slugSet || L.code };
    if (!L.additionalsDe) throw new Error(`${L.code} : --cartes-du-parent exige une ligne Additionals (additionalsDe)`);
    const P = ligneDe(L.additionalsDe);
    if (!P || !P.slugSet) throw new Error(`${L.code} : le parent déclaré (${L.additionalsDe}) est absent de la table`);
    return { sets: P.slugSet, ficheSimple: { $exists: false } };
}

async function executer({ argv, ouvrirConnexions, log = console.log, err = console.error }) {
    const AUTORISES = [/^--code=[\w.\/-]+$/, /^--produits=\d+(,\d+)*$/, /^--attendu=\d+$/, /^--ecrire$/, /^--cartes-du-parent$/];
    const inconnus = argv.filter(a => !AUTORISES.some(r => r.test(a)));
    const arg = n => argv.find(a => a.startsWith(`--${n}=`))?.slice(n.length + 3);
    if (inconnus.length || !arg('code') || !arg('produits')) { err(`❌ ${inconnus.length ? `argument inconnu : ${inconnus.join(' ')} — ` : ''}--code=<code de la table> et --produits=<idProduct,…> obligatoires`); return 2; }
    const ecrire = argv.includes('--ecrire');
    const { ligne: ligneDeTable } = require('./collecte-cartes/table-sets');
    const { produitsDeLExpansion } = require('./collecte-cartes/jointure');
    const L = ligneDeTable(arg('code'));
    if (!L || !L.verifie) { err(`❌ ${arg('code')} : absent de la table ou non vérifié`); return 2; }
    if (L.bulba.numerosDepuisSetlist || L.bulba.sansPage || L.bulba.nomSeul) { err(`❌ ${arg('code')} : ligne à numéros de Setlist / sans page / nom seul — le rejeu à blanc de cet outil ne les couvre pas`); return 2; }
    const slug = L.slugSet || L.code, TIRAGE = L.bulba.tirage || 'jp';
    const { cartes: cx, prod, fermer } = await ouvrirConnexions({ production: true, buckets: [] });
    try {
        const cartes = await cx.db.collection('cartes').find(filtreDesCartes(L, argv.includes('--cartes-du-parent'), ligneDeTable)).toArray();
        const produits = await produitsDeLExpansion(prod, L.exp);
        const visees = arg('produits').split(',').map(Number);
        const existants = new Map((await cx.db.collection('cartes_produits').find({ idProduct: { $in: visees } }, { projection: { preuve: 1, idProduct: 1 } }).toArray()).map(l => [l._id, l]));
        const plan = planifier({ cartes, produits, optionsJoindre: { idExpansion: L.exp, expansionBulba: L.bulba.expansion, deck: L.bulba.deck || null, suffixesParDeck: L.bulba.suffixesParDeck || null, prefixesParDeck: L.bulba.prefixesParDeck || null, prefixesParJeton: L.bulba.prefixesParJeton || null, prefixesParSection: L.bulba.prefixesParSection || null, tirage: TIRAGE, slugSet: L.slugSet || null }, existants, visees });
        log(`   ${L.code} (${slug}) : ${cartes.length} cartes du set · ${produits.length} produits de l'expansion · ${visees.length} visé(s)`);
        for (const l of plan.lignes) log(`   + ${l._id} preuve ${l.preuve} numeroFiche ${l.numeroFiche ?? '—'} · ${String(l.detail || '').slice(0, 110)}`);
        for (const r of plan.refus) log(`   - REFUS ${r.idProduct} : ${r.raison}`);
        for (const d of plan.deja) log(`   = déjà là ${d._id} (${d.preuve}) : jamais réécrite`);
        log(`\n   PLAN : ${plan.lignes.length} ligne(s) à poser · ${plan.refus.length} refus · ${plan.deja.length} déjà`);
        if (!ecrire) { log('   (simulation — lot-additif.js … -- node poser-lignes-ciblees.js … --attendu=N --ecrire)'); return 0; }
        const v = verifierAttendu(plan, arg('attendu') === undefined ? undefined : Number(arg('attendu')));
        if (!v.ok) { err(`❌ ARRÊT : ${v.raison} — rien n'est écrit`); return 1; }
        const r = await ecrireLignes(cx.db, plan.lignes, new Map(produits.map(p => [p.idProduct, p.idMetacard])));
        const relues = await cx.db.collection('cartes_produits').countDocuments({ _id: { $in: plan.lignes.map(l => l._id) } });
        log(`\n   ✅ lignes posées ${r.lignes}/${plan.lignes.length} · relu : ${relues}/${plan.lignes.length}`);
        return r.lignes === plan.lignes.length && relues === plan.lignes.length ? 0 : 1;
    } finally { await fermer(); }
}

module.exports = { planifier, verifierAttendu, ecrireLignes, executer, filtreDesCartes };

if (require.main === module) {
    require('dotenv').config();
    executer({ argv: process.argv.slice(2), ouvrirConnexions: require('./collecte-cartes/garde').ouvrirConnexions }).then(c => { process.exitCode = c; }).catch(e => { console.error('❌', e.message); process.exitCode = 1; });
}
