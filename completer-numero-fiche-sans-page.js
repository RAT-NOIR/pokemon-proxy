// ============================================================
// `numeroFiche` DES RÉIMPRESSIONS DÉSIGNÉES DANS LES SETS SANS PAGE CRÉÉS — le numéro Cardmarket du produit, là où il est nul
// ============================================================
//   node completer-numero-fiche-sans-page.js --sets=A,B            (simulation)
//   node lot-additif.js --quoi="…" --collections=cartes_produits -- node completer-numero-fiche-sans-page.js --sets=A,B --ecrire
//
// POURQUOI (2026-10-07) : creer-sets-sans-page.js écrivait `numeroFiche: null` sur les réimpressions désignées. Le site lit alors le
// numéro dans le slug (lib/lienCardmarket.ts, numeroDuLien) : « Caterpie-V1-MCD19F2 » dit 2, « Caterpie-V2 » ne dit rien — et un lien
// sans numéro compte pour une AUTRE carte. McDonald's 2019-2 a ainsi ajouté 14 fiches « à plusieurs cartes » au cliquet du site
// (145 → 159), pour des produits qui sont la même carte (V1/V2, même numéro chez Cardmarket). Le créateur pose désormais ce numéro ;
// cet outil le pose sur les lignes déjà écrites.
// CE QUI EST ÉCRIT, ET SEULEMENT ÇA : `numeroFiche` = le numéro que Cardmarket donne au produit (numeros_cartes.numero), sur une ligne
// `metacarte+nom+attaques` des sets nommés, là où il est NUL (jamais une valeur remplacée) — et seulement si TOUS les produits de la carte
// dans ce set ont le MÊME numéro Cardmarket (sinon la fiche resterait mélangée : la ligne n'est pas touchée, elle est comptée).
require('dotenv').config();
const { ouvrirConnexions } = require('./collecte-cartes/garde');
const AUTORISES = [/^--sets=[\w.,-]+$/, /^--ecrire$/];
const inconnus = process.argv.slice(2).filter(a => !AUTORISES.some(r => r.test(a)));
const SETS = (process.argv.find(a => a.startsWith('--sets=')) || '').slice(7).split(',').filter(Boolean);
if (inconnus.length || !SETS.length) { console.error(`❌ ${inconnus.length ? `argument inconnu : ${inconnus.join(' ')} — ` : ''}usage : --sets=A,B [--ecrire]`); process.exit(2); }
const ECRIRE = process.argv.includes('--ecrire');
const nu = n => String(n ?? '').trim().toUpperCase().replace(/^0+(?=\d)/, '') || null;

(async () => {
    const { cartes: cx, prod, fermer } = await ouvrirConnexions({ production: true, buckets: [] });
    const L = cx.db.collection('cartes_produits');
    const lignes = await L.find({ slugSet: { $in: SETS }, preuve: 'metacarte+nom+attaques' }, { projection: { carteId: 1, idProduct: 1, slugSet: 1, numeroFiche: 1 } }).toArray();
    const NC = new Map((await prod.db.collection('numeros_cartes').find({ idProduct: { $in: lignes.map(l => l.idProduct) } }, { projection: { idProduct: 1, numero: 1 } }).toArray()).map(n => [n.idProduct, n.numero]));
    const groupes = new Map(); for (const l of lignes) { const k = `${l.slugSet}|${l.carteId}`; (groupes.get(k) || groupes.set(k, []).get(k)).push(l); }
    // 🔴 (2026-10-07) UNE CARTE QUI A DES FICHES NUMÉROTÉES DANS LE SET N'EST PAS TOUCHÉE : le site y PLACE le produit par son numeroFiche
    // (lib/cardmarket.ts, placementParNumeroFiche) — un numéro Cardmarket qui ne serait aucune de ces fiches (« sans-fiche ») ferait
    // DISPARAÎTRE le produit de la page, en silence (le cliquet des fiches mélangées ne le verrait pas). Ici, seulement les cartes sans
    // aucune impression de l'expansion du set : le site ne s'y sert du champ que pour l'étiquette du lien.
    const sets = new Map((await cx.db.collection('sets').find({ _id: { $in: SETS } }, { projection: { tirage: 1, region: 1, 'bulba.expansion': 1 } }).toArray()).map(s => [s._id, s]));
    const impsDe = new Map((await cx.db.collection('cartes').find({ _id: { $in: [...new Set(lignes.map(l => l.carteId))] } }, { projection: { 'impressions.tirage': 1, 'impressions.expansion': 1 } }).toArray()).map(c => [c._id, c.impressions || []]));
    // (relecture) un set SANS nom d'expansion (Gem Packs) : le site y rapproche les impressions à expansion NULLE — la garde les compte
    const aImpressionsDansLeSet = l => { const s = sets.get(l.slugSet); if (!s) return true; const t = s.tirage ?? s.region, e = [].concat(s.bulba?.expansion ?? []).filter(Boolean); return (impsDe.get(l.carteId) || []).some(i => i && i.tirage === t && (e.length ? e.includes(i.expansion) : i.expansion == null)); };
    const aPoser = [], causes = {};
    for (const [k, ls] of groupes) {
        if (aImpressionsDansLeSet(ls[0])) { causes['la carte a des fiches numérotées dans le set (le site y placerait le produit)'] = (causes['la carte a des fiches numérotées dans le set (le site y placerait le produit)'] || 0) + ls.length; continue; }
        const nums = new Set(ls.map(l => nu(NC.get(l.idProduct))));
        if (nums.has(null)) { causes['un produit sans numéro Cardmarket'] = (causes['un produit sans numéro Cardmarket'] || 0) + ls.length; continue; }
        // (relecture) un « numéro » sans chiffre n'en est pas un (Traditional-Chinese-Products : « SV-P », un code de set) — la règle du site
        // (porteUnChiffre) ne le lirait pas non plus comme un numéro
        if ([...nums].some(n => !/\d/.test(n))) { causes['numéro Cardmarket sans chiffre'] = (causes['numéro Cardmarket sans chiffre'] || 0) + ls.length; continue; }
        if (nums.size > 1) { causes['la carte a plusieurs numéros dans le set'] = (causes['la carte a plusieurs numéros dans le set'] || 0) + ls.length; continue; }
        for (const l of ls) if (l.numeroFiche == null || l.numeroFiche === '') aPoser.push({ _id: l._id, numeroFiche: String(NC.get(l.idProduct)).trim(), set: l.slugSet });
    }
    console.log(`DÉNOMINATEUR : ${lignes.length} lignes « metacarte+nom+attaques » sur ${SETS.length} sets · ${groupes.size} cartes · à poser ${aPoser.length} · non touchées ${JSON.stringify(causes)}`);
    for (const a of aPoser.slice(0, 6)) console.log(`   ${a._id} (${a.set}) → numeroFiche ${a.numeroFiche}`);
    if (!ECRIRE) { console.log('(simulation — --ecrire sous lot-additif.js)'); await fermer(); return; }
    let n = 0;
    for (const a of aPoser) n += (await L.updateOne({ _id: a._id, numeroFiche: { $in: [null, ''] } }, { $set: { numeroFiche: a.numeroFiche, numeroFicheSource: 'completer-numero-fiche-sans-page (2026-10-07) : numéro Cardmarket du produit' } })).modifiedCount;
    const reste = await L.countDocuments({ _id: { $in: aPoser.map(a => a._id) }, numeroFiche: { $in: [null, ''] } });
    console.log(`✅ posés ${n}/${aPoser.length} · relu : ${reste} encore nul(s)`);
    await fermer();
    if (n !== aPoser.length || reste) process.exitCode = 1;
})().catch(e => { console.error('❌', e.message); process.exitCode = 1; });
