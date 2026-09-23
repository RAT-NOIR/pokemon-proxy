// ============================================================
// LE TÉMOIN DU NOM SUR LES JOINTURES PAR LE NUMÉRO DÉJÀ EN BASE — « une fiche fausse est un mauvais prix »
// ============================================================
//   node temoin-nom.js            (mesure seule, c'est le défaut)
//   node temoin-nom.js --detacher (retire les lignes que le témoin refuse ; sauvegarde réelle de cartes_produits d'abord)
//
// 🔑 LA RÈGLE N'EST PLUS ICI : ELLE EST DANS `joindre()` (`temoinDuNom`, collecte-cartes/jointure.js, 2026-09-23). Ce
// script lui confie les lignes DÉJÀ écrites, parce qu'`ecrireJointure` fait des upserts : une règle corrigée ne corrige
// aucune ligne existante (§32, les deux moitiés). La première version de ce script portait sa propre copie de la règle —
// « le nom désigne UNE autre carte, UNE SEULE » — et laissait passer 17 fiches fausses dont le nom désignait PLUSIEURS
// cartes (SV-P chinois : « Eevee » sur Pineco, le set a deux Eevee). §21 bis, une fois de plus : une seule définition.
//
// DEUX ISSUES POUR UNE LIGNE REFUSÉE :
//   · DÉPARTAGE — le produit est AUSSI joint par le numéro à la carte que son nom désigne (EC1 n°059 : deux cartes, un
//     numéro). Seule la ligne contredite part ; le produit garde SA carte.
//   · CONTREDITE — le produit n'a pas d'autre carte : la ligne part, et un reste `fiche-contredite-par-le-nom` le dit.
// Les écarts de FORME (le nom ne désigne aucune autre carte du set, ou les attaques confirment la carte du numéro) ne
// sont jamais touchés.
require('dotenv').config();
const { ouvrirConnexions } = require('./collecte-cartes/garde');
const { lireMongo, champSur } = require('./collecte-cartes/lecture-sure');
const { decomposerNomCardmarket, temoinDuNom } = require('./collecte-cartes/jointure');

(async () => {
    const detacher = process.argv.includes('--detacher');
    const { cartes: cx, prod, fermer } = await ouvrirConnexions({ production: true, buckets: [] });
    const liens = await lireMongo(cx.db.collection('cartes_produits'), { preuve: { $in: ['set+numero', 'setlist+numero'] } },
        { nom: 'cartes_produits (par le numéro)', projection: { idProduct: 1, carteId: 1, slugSet: 1, preuve: 1, detail: 1 } });
    const cp = await lireMongo(prod.db.collection('catalogue_produits'), { idProduct: { $in: liens.map(l => l.idProduct) } }, { nom: 'catalogue_produits', projection: { idProduct: 1, name: 1 } });
    champSur(cp, 'name', { collection: 'catalogue_produits' });
    const produitDe = new Map(cp.map(p => { const d = decomposerNomCardmarket(p.name); return [p.idProduct, { idProduct: p.idProduct, name: p.name, nom: d.nom, attaques: d.attaques }]; }));
    const cartes = await lireMongo(cx.db.collection('cartes'), {}, { nom: 'cartes', projection: { nomEn: 1, niveau: 1, attaques: 1, sets: 1 } });
    const carteDe = new Map(cartes.map(c => [c._id, c]));
    // les cartes du set, TOUTES : c'est la population que `joindre()` voit (cartes.sets, comme collecteur-texte.js:344)
    const parSet = new Map();
    for (const c of cartes) for (const s of c.sets || []) (parSet.get(s) || parSet.set(s, []).get(s)).push(c);
    const temoins = new Map();
    const temoinDe = s => { if (!temoins.has(s)) temoins.set(s, temoinDuNom(parSet.get(s) || [])); return temoins.get(s); };
    // quelles cartes chaque produit a-t-il PAR LE NUMÉRO ?
    const cartesParNumero = new Map();
    for (const l of liens) (cartesParNumero.get(l.idProduct) || cartesParNumero.set(l.idProduct, new Set()).get(l.idProduct)).add(l.carteId);

    const contredites = [], departages = [], muets = { sansSet: 0, sansProduit: 0, sansCarte: 0 };
    for (const l of liens) {
        if (!l.slugSet || !parSet.has(l.slugSet)) { muets.sansSet++; continue; }
        const p = produitDe.get(l.idProduct), c = carteDe.get(l.carteId);
        if (!p) { muets.sansProduit++; continue; }
        if (!c) { muets.sansCarte++; continue; }
        const autres = temoinDe(l.slugSet)(c, p);
        if (!autres) continue;
        const x = { ...l, produit: p.name, carte: c.nomEn, designees: autres.map(a => a._id), nomsDesignes: autres.map(a => a.nomEn) };
        if (autres.some(a => cartesParNumero.get(l.idProduct).has(a._id))) departages.push(x); else contredites.push(x);
    }
    const nSet = new Map(); for (const l of liens) nSet.set(l.slugSet, (nSet.get(l.slugSet) || 0) + 1);
    console.log(`\n════ DÉNOMINATEUR : ${liens.length} jointures par le numéro · muettes (le témoin ne peut rien lire) : ${JSON.stringify(muets)} ════`);
    console.log(`   🔴 CONTREDITES (le nom est celui d'une AUTRE carte du set, les attaques ne confirment pas) : ${contredites.length}`);
    const grouper = xs => { const m = new Map(); for (const x of xs) (m.get(x.slugSet) || m.set(x.slugSet, []).get(x.slugSet)).push(x); return [...m].sort((a, b) => b[1].length - a[1].length); };
    for (const [s, xs] of grouper(contredites))
        console.log(`      ${String(xs.length).padStart(3)} / ${String(nSet.get(s)).padStart(4)} · ${s.padEnd(42)} ${xs.slice(0, 3).map(x => `« ${x.produit} » → ${x.carte} (le nom dit ${x.nomsDesignes[0]}${x.designees.length > 1 ? ` ×${x.designees.length}` : ''})`).join(' · ')}`);
    console.log(`   ⚖️  DÉPARTAGES (le produit a AUSSI sa carte par le numéro ET le nom — seule la ligne contredite part) : ${departages.length}`);
    for (const x of departages) console.log(`      ${x.slugSet} · « ${x.produit} » : retire → ${x.carte} (${x.carteId}), garde → ${x.nomsDesignes.join(', ')}`);

    if (!detacher) { console.log(`\n   (mesure seule — --detacher retire les ${contredites.length + departages.length} lignes, après sauvegarde réelle)`); await fermer(); return; }
    const tout = [...contredites, ...departages];
    const ids = tout.map(x => `${x.carteId}|${x.idProduct}`);
    const r = await cx.db.collection('cartes_produits').deleteMany({ _id: { $in: ids } });
    // l'idProduct sort des liens dénormalisés de la carte (même geste que detacher-jointures-fausses.js)
    const parCarte = new Map();
    for (const x of tout) (parCarte.get(x.carteId) || parCarte.set(x.carteId, []).get(x.carteId)).push(x.idProduct);
    for (const [id, ps] of parCarte) await cx.db.collection('cartes').updateOne({ _id: id }, { $pull: { 'liens.idProduct': { $in: ps } } });
    for (const x of contredites) await cx.db.collection('restes').updateOne({ set: x.slugSet, type: 'fiche-contredite-par-le-nom', idProduct: x.idProduct, carteId: x.carteId },
        { $set: { detail: `${x.idProduct} « ${x.produit} » : le numéro désigne « ${x.carte} » (${x.carteId}), le nom est celui de ${x.nomsDesignes.map((n, i) => `« ${n} » (${x.designees[i]})`).join(', ')} — détachée par temoin-nom.js`, le: new Date() } }, { upsert: true });
    const reste = await cx.db.collection('cartes_produits').countDocuments({ _id: { $in: ids } });
    console.log(`\n   ✅ détachées : ${r.deletedCount} (attendu ${ids.length}) · encore présentes : ${reste} · ${parCarte.size} cartes · ${contredites.length} restes écrits avec leur motif`);
    await fermer();
})().catch(e => { console.error(e); process.exit(1); });
