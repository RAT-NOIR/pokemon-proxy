// ============================================================
// MESURE PTCGIO — NOS TROUS, par set et par catégorie (LECTURE SEULE, zéro requête externe) — 2026-10-08
// ============================================================
//   node mesure-ptcgio-trous.js [--ecrire=<fichier.json>]
//
// 🔑 Les prédicats sont RECOPIÉS de mesure-catalogue.js (l.37-98), pas réinventés : dénominateur = produits appris hors cartes-code
// (`estCarteCode` de jointure.js, nom lu au catalogue d'abord) ; un produit a un VISUEL quand sa carte porte une entrée `images` du
// set du produit qui n'est pas le scan japonais d'un jumeau. Un TROU = un produit sans visuel du bon tirage.
// Ajouts de cet outil : la répartition par catégorie (slugSet / type / réimpressions du set) et, pour chaque trou, son numéro et son nom
// (pour apparier à un set pokemontcg.io). Il n'écrit nulle part, sauf le fichier de sortie local demandé.
require('dotenv').config();
const fs = require('fs');
const { ouvrirConnexions } = require('./collecte-cartes/garde');
const { estCarteCode } = require('./collecte-cartes/jointure');

/** Catégorie d'un set d'après son slugSet (Cardmarket) — énumérée, la dernière case est « autres ». */
function categorieDe(slugSet, set) {
    const s = String(slugSet || '');
    if (/trainer-kit/i.test(s)) return 'Kits Dresseur';
    if (/mcdonald/i.test(s)) return "McDonald's";
    if (/^POP-Series|^POP-/i.test(s)) return 'POP';
    if (/Prize-Pack/i.test(s)) return 'Prize Packs';
    if (/Battle-Academy/i.test(s)) return 'Battle Academy';
    if (/^WCD|World-Championship/i.test(s)) return 'WCD';
    if (/Promo/i.test(s) || /^(set\w*-)?promos?$/i.test(s) || set?.type === 'promo') return 'promos (Black Star)';
    return 'autres';
}
module.exports = { categorieDe };
if (require.main !== module) return;

(async () => {
    const { cartes: cx, prod, fermer } = await ouvrirConnexions({ production: true, buckets: [] });
    const appris = await prod.db.collection('numeros_cartes').find({}, { projection: { idProduct: 1, idExpansion: 1, slugSet: 1, nom: 1, nomFr: 1, nomEn: 1, slug: 1, numero: 1 } }).toArray();
    const nomCatalogue = new Map((await prod.db.collection('catalogue_produits').find({}, { projection: { idProduct: 1, name: 1 } }).toArray()).map(p => [p.idProduct, p.name]));
    const libelle = p => nomCatalogue.get(p.idProduct) || p.nom || p.nomFr || p.nomEn || p.slug || '';
    const retenus = appris.filter(p => !estCarteCode(libelle(p)));
    if (!appris.length || !retenus.length) throw new Error('lecture vide : numeros_cartes');
    const total = retenus.length;
    const liens = await cx.db.collection('cartes_produits').find({}, { projection: { idProduct: 1, carteId: 1, slugSet: 1, 'visuelSubstitut.cleR2': 1 } }).toArray();
    const avecImages = await cx.db.collection('cartes').find({ 'images.0': { $exists: true } }, { projection: { images: 1 } }).toArray();
    const sets = await cx.db.collection('sets').find({}, { projection: { region: 1, tirage: 1, type: 1, reimpressions: 1, nomAffichage: 1, dateSortie: 1 } }).toArray();
    const setDe = new Map(sets.map(s => [s._id, s]));
    if (!sets.length || !avecImages.length || !liens.length) throw new Error(`lecture vide : sets ${sets.length}, cartes à images ${avecImages.length}, liens ${liens.length}`);
    const scanDuJumeau = i => i.langue === 'ja' && setDe.get(i.set)?.region !== 'jp';
    const setsBonTirage = new Map(avecImages.map(c => [c._id, new Set((c.images || []).filter(i => !scanDuJumeau(i)).map(i => i.set))]));
    const slugParProduit = new Map(retenus.map(p => [p.idProduct, p.slugSet]));
    const visuels = new Set(), fiches = new Set(), substitut = new Set();
    for (const l of liens) {
        if (!slugParProduit.has(l.idProduct)) continue;
        fiches.add(l.idProduct);
        if (l.visuelSubstitut?.cleR2) substitut.add(l.idProduct);
        const s = slugParProduit.get(l.idProduct) || l.slugSet;
        const bons = setsBonTirage.get(l.carteId);
        if (bons && (bons.has(l.slugSet) || bons.has(s))) visuels.add(l.idProduct);
    }
    const trous = retenus.filter(p => !visuels.has(p.idProduct));
    const parCat = new Map(), parSet = new Map();
    for (const p of retenus) {
        const set = setDe.get(p.slugSet);
        const cat = categorieDe(p.slugSet, set);
        const c = parCat.get(cat) || parCat.set(cat, { produits: 0, trous: 0, trousOccidentaux: 0, substituts: 0 }).get(cat);
        c.produits++;
        const trou = !visuels.has(p.idProduct);
        const tirage = set ? (set.tirage ?? set.region) : null;
        const occ = tirage === 'intl';
        if (trou) { c.trous++; if (occ) c.trousOccidentaux++; if (substitut.has(p.idProduct)) c.substituts++; }
        const k = p.slugSet || '(sans slugSet)';
        const s = parSet.get(k) || parSet.set(k, { slugSet: k, cat, tirage, type: set?.type ?? null, reimpressions: set?.reimpressions ?? null, produits: 0, trous: 0, numeros: [] }).get(k);
        s.produits++;
        if (trou) { s.trous++; s.numeros.push({ idProduct: p.idProduct, numero: p.numero ?? null, nom: libelle(p), fiche: fiches.has(p.idProduct) }); }
    }
    console.log(`DÉNOMINATEUR : ${total} produits (${appris.length} appris − ${appris.length - total} cartes-code) · fiches ${fiches.size} · visuels ${visuels.size} · TROUS ${trous.length} · substituts posés parmi eux ${[...substitut].filter(i => !visuels.has(i)).length}`);
    console.log(`sets en base ${sets.length} · cartes à images ${avecImages.length} · liens ${liens.length}`);
    for (const [cat, c] of [...parCat].sort((a, b) => b[1].trous - a[1].trous)) console.log(`${cat.padEnd(22)} produits ${String(c.produits).padStart(6)} · trous ${String(c.trous).padStart(6)} · dont set occidental (tirage intl) ${String(c.trousOccidentaux).padStart(6)} · substitut déjà posé ${c.substituts}`);
    // ── LE DEVENIR DE CHAQUE TROU OCCIDENTAL : comblé prouvé · substitut refusé · non apparié (et pourquoi) — par la fonction du collecteur ────
    const P = require('./collecte-cartes/ptcgio');
    const ligneDe = new Map(liens.map(l => [l.idProduct, l]));
    const carteIds = [...new Set(trous.filter(p => P.verdictDuSet(p.slugSet).verdict === 'prouve').map(p => ligneDe.get(p.idProduct)?.carteId).filter(x => x != null))];
    const cartesDoc = new Map((await cx.db.collection('cartes').find({ _id: { $in: carteIds } }, { projection: { nomEn: 1, images: 1 } }).toArray()).map(c => [c._id, c]));
    const fichesLiees = await cx.db.collection('cartes_produits').find({ idProduct: { $in: trous.map(p => p.idProduct) } }, { projection: { idProduct: 1, numeroFiche: 1 } }).toArray();
    const ficheDe = new Map(fichesLiees.map(l => [l.idProduct, l.numeroFiche ?? null]));
    const devenir = new Map();
    const dev = cat => devenir.get(cat) || devenir.set(cat, { trous: 0, horsPerimetre: 0, comble: 0, substitut: 0, nonApparie: {} }).get(cat);
    const parSetDevenir = new Map();
    for (const p of trous) {
        const set = setDe.get(p.slugSet), cat = categorieDe(p.slugSet, set), d = dev(cat);
        d.trous++;
        if ((set ? (set.tirage ?? set.region) : null) !== 'intl') { d.horsPerimetre++; continue; }
        const V = P.verdictDuSet(p.slugSet);
        let issue;
        if (V.verdict === 'substitut-interdit') { d.substitut++; issue = 'substitut refusé'; }
        else if (V.verdict !== 'prouve') { d.nonApparie['set non trouvé'] = (d.nonApparie['set non trouvé'] || 0) + 1; issue = 'non apparié : set non trouvé'; }
        else {
            const l = ligneDe.get(p.idProduct), carte = l && cartesDoc.get(l.carteId);
            if (!carte) { d.nonApparie['sans fiche'] = (d.nonApparie['sans fiche'] || 0) + 1; issue = 'non apparié : sans fiche'; }
            else {
                const r = P.planifierPtcgio({ slug: p.slugSet, trous: [{ carte, numeroFiche: ficheDe.get(p.idProduct) ?? null, numeroCm: p.numero != null && String(p.numero).trim() ? String(p.numero).trim() : null, idProduct: p.idProduct }] });
                if (r.plan.length) { d.comble++; issue = 'comblé prouvé'; }
                else { const m = r.restes[0]?.motif || 'servi-par-un-visuel-du-jumeau-(non-touché)'; d.nonApparie[m] = (d.nonApparie[m] || 0) + 1; issue = `non apparié : ${m}`; }
            }
        }
        const k = `${p.slugSet} — ${issue}`; parSetDevenir.set(k, (parSetDevenir.get(k) || 0) + 1);
    }
    console.log(`\n──── DEVENIR DES TROUS, par catégorie (dénominateur : ${trous.length} trous ; occidentaux = tirage intl) ────`);
    for (const [cat, d] of [...devenir].sort((a, b) => b[1].trous - a[1].trous)) {
        const occ = d.trous - d.horsPerimetre, na = Object.values(d.nonApparie).reduce((a, b) => a + b, 0);
        console.log(`${cat.padEnd(22)} trous ${String(d.trous).padStart(6)} · hors périmètre (jp/zh/id/th) ${String(d.horsPerimetre).padStart(6)} · OCCIDENTAUX ${String(occ).padStart(5)} = comblés prouvés ${String(d.comble).padStart(4)} + substituts refusés ${String(d.substitut).padStart(4)} + non appariés ${String(na).padStart(5)} ${JSON.stringify(d.nonApparie)}`);
    }
    for (const [k, n] of [...parSetDevenir].filter(([k]) => /comblé prouvé/.test(k)).sort()) console.log(`   ${String(n).padStart(4)} · ${k}`);
    const sortie = process.argv.find(a => a.startsWith('--ecrire='))?.slice(9);
    if (sortie) { fs.writeFileSync(sortie, JSON.stringify({ total, trous: trous.length, parCat: [...parCat], sets: [...parSet.values()].filter(s => s.trous) }, null, 1)); console.log('écrit', sortie); }
    await fermer();
})().catch(e => { console.error('❌', e.message); process.exit(1); });
