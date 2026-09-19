// ============================================================
// DÉTACHER LES LIGNES DE JOINTURE EN TROP — un produit est UNE carte
// ============================================================
//   node detacher-jointures-fausses.js              (à blanc, c'est le défaut)
//   node detacher-jointures-fausses.js --ecrire
//
// LE DÉFAUT, MESURÉ LE 2026-09-19 : 279 produits Cardmarket sont rattachés à PLUSIEURS cartes, soit
// 1 993 lignes fausses au minimum. C'est ce que le site montre — une fiche avec plusieurs liens
// Cardmarket dont certains pointent ailleurs, et un illustrateur qui vient de la mauvaise carte.
//
// LA CAUSE est corrigée dans collecteur-texte.js (le bonus « jumeau occidental » testait qu'UNE carte
// du set déclare Base Set puis joignait TOUTES les cartes du set à ses produits). Mais une règle
// corrigée ne corrige aucune ligne déjà écrite (§23), et `ecrireJointure` fait des upserts : rien
// n'efface une ligne devenue fausse. Cet outil est l'autre moitié du correctif.
//
// 🔑 LA RÈGLE DE DÉPARTAGE, ET ELLE NE DEVINE RIEN : parmi les cartes candidates, on garde CELLE QUI
// DÉCLARE L'IMPRESSION — même tirage, même nom d'expansion, même numéro. C'est la donnée de la source,
// pas une préférence. Si AUCUNE ne la déclare, ou si PLUSIEURS la déclarent, on ne touche à rien : un
// survivant unique après restriction est une désignation, plusieurs ou zéro sont un arbitrage (§8).
//
// ⚠️ Les lignes retirées sont ÉCRITES DANS UN FICHIER avant de l'être en base, et un reste
// `produit-vers-plusieurs-cartes` reste en base pour que le trou soit nommé et non silencieux.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { ouvrirConnexions } = require('./collecte-cartes/garde');
const { modeles } = require('./collecte-cartes/schemas');
const { cleNumero } = require('./collecte-cartes/jointure');
const { TABLE, TABLE_AUTO, TABLE_SANS_PAGE, EXPANSIONS_INTL } = require('./collecte-cartes/table-sets');

(async () => {
    const ecrire = process.argv.includes('--ecrire');
    const { cartes: cx, prod, fermer } = await ouvrirConnexions();
    const M = modeles(cx);

    // le nom d'expansion de chaque idExpansion cible : la table d'abord, le bonus intl ensuite
    const nomDeLExp = new Map(Object.entries(EXPANSIONS_INTL).map(([n, e]) => [e, n]));
    for (const l of [...TABLE, ...TABLE_AUTO, ...TABLE_SANS_PAGE]) if (l.exp && !nomDeLExp.has(l.exp)) nomDeLExp.set(l.exp, [].concat(l.bulba?.expansion || [])[0]);

    const liens = await cx.db.collection('cartes_produits').find({}).toArray();
    const parProduit = new Map();
    for (const l of liens) (parProduit.get(l.idProduct) || (parProduit.set(l.idProduct, []), parProduit.get(l.idProduct))).push(l);
    const multi = [...parProduit].filter(([, ls]) => new Set(ls.map(l => l.carteId)).size > 1);
    console.log(`\n════ DÉNOMINATEUR : ${liens.length} lignes de jointure · ${parProduit.size} produits joints ════`);
    console.log(`   produits rattachés à PLUSIEURS cartes : ${multi.length} (${(multi.length / parProduit.size * 100).toFixed(2)} %)`);

    const P = new Map((await prod.db.collection('numeros_cartes')
        .find({ idProduct: { $in: multi.map(([id]) => id) } }, { projection: { idProduct: 1, numero: 1, slug: 1, slugSet: 1 } }).toArray()).map(p => [p.idProduct, p]));
    const ids = [...new Set(multi.flatMap(([, ls]) => ls.map(l => l.carteId)))];
    const C = new Map((await cx.db.collection('cartes').find({ _id: { $in: ids } }, { projection: { nomEn: 1, impressions: 1, 'bulba.titre': 1 } }).toArray()).map(c => [c._id, c]));

    const aRetirer = [], laisses = { aucune: [], plusieurs: [] };
    for (const [idp, ls] of multi) {
        const p = P.get(idp);
        const num = cleNumero(p?.numero);
        const exp = ls[0].idExpansion, tirage = ls[0].tirage || 'intl', nomExp = nomDeLExp.get(exp);
        const declare = id => (C.get(id)?.impressions || []).some(i =>
            i.tirage === tirage && (!nomExp || i.expansion === nomExp) && cleNumero(i.numero) === num);
        const cand = [...new Set(ls.map(l => l.carteId))];
        const gardees = cand.filter(declare);
        const ligne = `${idp} « ${p?.slug ?? '—'} » n°${p?.numero ?? '—'} (${p?.slugSet}) · exp ${exp} « ${nomExp ?? '?'} » · ${cand.length} cartes`;
        if (gardees.length !== 1) { (gardees.length ? laisses.plusieurs : laisses.aucune).push(`${ligne} · ${gardees.length} déclarent l'impression`); continue; }
        for (const l of ls) if (l.carteId !== gardees[0]) aRetirer.push({ l, garde: gardees[0], p });
    }
    console.log(`\n   ✅ DÉPARTAGÉS — une seule carte déclare l'impression : ${multi.length - laisses.aucune.length - laisses.plusieurs.length} produits · ${aRetirer.length} lignes à retirer`);
    console.log(`   ⚠️ LAISSÉS — aucune carte ne déclare l'impression : ${laisses.aucune.length}`);
    for (const x of laisses.aucune.slice(0, 10)) console.log(`      ${x}`);
    console.log(`   ⚠️ LAISSÉS — plusieurs la déclarent : ${laisses.plusieurs.length}`);
    for (const x of laisses.plusieurs.slice(0, 10)) console.log(`      ${x}`);

    const parCarteRetiree = {};
    for (const x of aRetirer) parCarteRetiree[C.get(x.l.carteId)?.bulba?.titre || x.l.carteId] = (parCarteRetiree[C.get(x.l.carteId)?.bulba?.titre || x.l.carteId] || 0) + 1;
    console.log(`\n   les cartes qui PERDENT le plus de liens faux :`);
    for (const [k, v] of Object.entries(parCarteRetiree).sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`      ${String(v).padStart(4)} — ${k}`);
    console.log(`\n   douze lignes retirées, telles quelles :`);
    for (const x of aRetirer.slice(0, 12))
        console.log(`      « ${x.p?.slug} » n°${x.p?.numero} : ${x.l.carteId} « ${C.get(x.l.carteId)?.bulba?.titre} » RETIRÉE — gardée ${x.garde} « ${C.get(x.garde)?.bulba?.titre} » (${x.l.preuve})`);

    if (!ecrire) { console.log(`\n   (à blanc — relancer avec --ecrire)`); await fermer(); return; }

    // la sauvegarde AVANT la suppression : un retour en arrière doit coûter une commande, pas une collecte
    const sauvegarde = path.join(__dirname, 'collecte-cartes', 'rapports', `jointures-detachees-${new Date().toISOString().slice(0, 10)}.json`);
    fs.mkdirSync(path.dirname(sauvegarde), { recursive: true });
    fs.writeFileSync(sauvegarde, JSON.stringify(aRetirer.map(x => x.l), null, 1));
    console.log(`   sauvegarde : ${sauvegarde} (${aRetirer.length} lignes)`);

    let n = 0;
    for (let i = 0; i < aRetirer.length; i += 500) {
        const lot = aRetirer.slice(i, i + 500);
        await cx.db.collection('cartes_produits').deleteMany({ _id: { $in: lot.map(x => x.l._id) } });
        // le lien dénormalisé porté par la carte suit, sinon la fiche garde le produit par un autre chemin
        for (const x of lot) await M.Carte.updateOne({ _id: x.l.carteId }, { $pull: { 'liens.idProduct': x.l.idProduct } });
        n += lot.length;
    }
    const restant = (await cx.db.collection('cartes_produits').aggregate([
        { $group: { _id: '$idProduct', k: { $addToSet: '$carteId' } } }, { $match: { 'k.1': { $exists: true } } }, { $count: 'n' }
    ]).toArray())[0]?.n || 0;
    console.log(`   RETIRÉ : ${n} lignes · relu en base : ${restant} produits encore multi-cartes (attendu ${laisses.aucune.length + laisses.plusieurs.length})`);
    await fermer();
})().catch(e => { console.error(e); process.exit(1); });
