// ============================================================
// RETIRER LES FICHES SIMPLES PROUVÉES EN DOUBLE D'UNE VRAIE CARTE (lot X30C, décision du testeur 2026-10-13)
// ============================================================
//   node retirer-fiches-simples-doublons.js --code=x30C --produits=909373,909374                       (simulation : rien n'est écrit)
//   node lot-additif.js --quoi="…" --collections=cartes,cartes_produits --annonce=<json> -- node retirer-fiches-simples-doublons.js --code=x30C --produits=909373,909374 --attendu=2 --ecrire
//
// « x30C : supprime les 2 fiches simples SI elles sont prouvées en double d'une fiche existante » (§77 : un feu vert autorise un geste, il ne prouve pas sa
// prémisse). La prémisse est REJOUÉE ici, produit par produit, au moment d'écrire — avec des données que la clé de jointure (le numéro) n'a PAS utilisées :
//   · le nom, les attaques (texte), la MÉTACARTE Cardmarket (le produit, le parent et un produit FRÈRE du parent à la même métacarte), puis le numéro d'origine ;
//   · la fiche est une fiche simple et rien d'autre (un seul produit, une seule impression, une seule ligne `fiche-simple`, aucune image, aucun document `images`) ;
//   · une ligne du MÊME produit vers la vraie carte existe déjà (sans elle, le retrait laisserait le produit sans fiche).
// Une seule fiche non prouvée ARRÊTE tout : rien n'est écrit (« une seule non prouvée = on ne la touche pas » — et les autres attendent avec elle).
// ÉCRIT : la ligne de la fiche, puis la fiche — et rien d'autre. Aucune autre ligne, aucune autre carte, aucun set.
require('dotenv').config();

const plat = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const numPlat = n => String(n ?? '').trim().toUpperCase().replace(/^0+(?=\d)/, '');
const nomsAttaques = a => (a || []).map(x => plat(x?.nom)).filter(Boolean);

/**
 * La preuve, pure. @returns {{ ok: boolean, preuves: {nom, ok, detail}[], refus: string[] }}
 * Chaque preuve est jugée même si une précédente a échoué : tous les refus sont nommés d'un coup.
 */
function prouver({ produit, slug, fiche, lignesFiche, nImagesDocs, parent, ligneParent, catalogue, freres, expansionParent }) {
    const preuves = [];
    const poser = (nom, ok, detail) => preuves.push({ nom, ok: !!ok, detail });
    const F = fiche || {}, C = parent || {};
    // 1. la fiche est UNE fiche simple, et rien d'autre
    const imps = (F.impressions || []).filter(Boolean);
    const seule = F.ficheSimple && F._id === -produit && imps.length === 1 && (F.liens?.idProduct || []).length === 1 && F.liens.idProduct[0] === produit
        && (F.sets || []).length === 1 && F.sets[0] === slug && !(F.images || []).length && !nImagesDocs
        && (lignesFiche || []).length === 1 && lignesFiche[0].idProduct === produit && lignesFiche[0].preuve === 'fiche-simple' && lignesFiche[0].carteId === F._id;
    poser('fiche-simple', seule, seule ? `${F._id} : un produit, une impression, une ligne fiche-simple, aucune image` : `${F._id ?? '?'} n'est pas une fiche simple isolée (ficheSimple, _id = −produit, 1 produit, 1 impression, set ${slug}, 0 image, 0 document images, 1 ligne fiche-simple)`);
    // 2. la vraie carte porte déjà le produit, par une ligne
    const lp = ligneParent && C._id != null && ligneParent.carteId === C._id && ligneParent.idProduct === produit && !C.ficheSimple && (C.liens?.idProduct || []).includes(produit);
    poser('ligne-du-parent', lp, lp ? `${ligneParent._id} (${ligneParent.preuve}) ; la carte ${C._id} porte le produit` : `aucune ligne ${produit} → une vraie carte qui porte le produit : le retrait laisserait le produit sans fiche`);
    // 3. le nom
    const nomOk = plat(F.nomEn) !== '' && plat(F.nomEn) === plat(C.nomEn);
    poser('nom', nomOk, `« ${F.nomEn} » / « ${C.nomEn} »`);
    // 4. les attaques (au moins une : un nom seul ne prouve rien)
    const aF = nomsAttaques(F.attaques), aC = nomsAttaques(C.attaques);
    const attOk = aF.length > 0 && JSON.stringify(aF) === JSON.stringify(aC);
    poser('attaques', attOk, `[${(F.attaques || []).map(a => a.nom).join(' | ')}] / [${(C.attaques || []).map(a => a.nom).join(' | ')}]`);
    // 5. la métacarte Cardmarket : celle du produit (catalogue), celle de la fiche, celle du parent, et un frère du parent (autre produit, expansion du parent) qui la porte
    const M = catalogue?.idMetacard ?? null;
    const freresMeme = (freres || []).filter(f => f.idProduct !== produit && (C.liens?.idProduct || []).includes(f.idProduct) && f.idExpansion === expansionParent?.idExpansion && f.idMetacard === M);
    const metaOk = M != null && (F.liens?.idMetacards || []).includes(M) && (C.liens?.idMetacards || []).includes(M) && freresMeme.length > 0;
    poser('metacarte', metaOk, `métacarte ${M ?? '—'} ; fiche ${JSON.stringify(F.liens?.idMetacards || [])} ; parent ${JSON.stringify(C.liens?.idMetacards || [])} ; frères du parent à la même métacarte : ${freresMeme.map(f => f.idProduct).join(', ') || 'aucun'}`);
    // 6. le numéro d'origine : le parent déclare l'impression (tirage, expansion du parent) à ce numéro, et le frère le porte aussi chez Cardmarket
    const n = numPlat(imps[0]?.numero);
    const impP = (C.impressions || []).filter(i => i && i.tirage === expansionParent?.tirage && plat(i.expansion) === plat(expansionParent?.nom) && numPlat(i.numero) === n);
    const numOk = n !== '' && impP.length === 1 && freresMeme.some(f => numPlat(f.numero) === n);
    poser('numero', numOk, `n°${imps[0]?.numero ?? '—'} ; impressions du parent (${expansionParent?.tirage} « ${expansionParent?.nom} ») à ce numéro : ${impP.length} ; frère(s) au même numéro : ${freresMeme.filter(f => numPlat(f.numero) === n).map(f => f.idProduct).join(', ') || 'aucun'}`);
    const refus = preuves.filter(p => !p.ok).map(p => `${p.nom} : ${p.detail}`);
    return { ok: refus.length === 0, preuves, refus };
}

/** Écrit les retraits : la ligne de la fiche, puis la fiche. Le filtre porte la garde (une carte qui n'est pas une fiche simple n'est jamais supprimée). */
async function ecrireRetraits(db, items) {
    let lignes = 0, fiches = 0;
    for (const { fiche, lignesFiche } of items) {
        for (const l of lignesFiche) lignes += (await db.collection('cartes_produits').deleteOne({ _id: l._id, carteId: fiche._id })).deletedCount;
        fiches += (await db.collection('cartes').deleteOne({ _id: fiche._id, ficheSimple: { $exists: true } })).deletedCount;
    }
    return { lignes, fiches };
}

/**
 * Lit ce que la preuve exige, puis la juge. `lignesVirtuelles` : des lignes du produit vers une vraie carte qui n'existent pas encore en base (la simulation
 * d'un lot qui les pose juste avant) — jamais passées en écriture.
 * @returns {{ produit, erreur?, fiche?, lignesFiche?, parent?, ligneParent?, verdict? }}
 */
async function instruire({ C, CP, images, catalogueProd, numerosProd, L, expansionParent, produit, lignesVirtuelles = [] }) {
    const fiches = await C.find({ 'liens.idProduct': produit, sets: L.slugSet, ficheSimple: { $exists: true } }).toArray();
    if (fiches.length !== 1) return { produit, erreur: `${fiches.length} fiche(s) simple(s) du set ${L.slugSet} portent le produit ${produit} (une seule attendue)` };
    const fiche = fiches[0];
    const lignesFiche = await CP.find({ carteId: fiche._id }).toArray();
    const nImagesDocs = await images.countDocuments({ carteId: fiche._id });
    const autres = [...await CP.find({ idProduct: produit, carteId: { $ne: fiche._id } }).toArray(), ...lignesVirtuelles.filter(l => l.idProduct === produit && l.carteId !== fiche._id)];
    if (autres.length !== 1) return { produit, fiche, lignesFiche, erreur: `${autres.length} ligne(s) du produit ${produit} vers une autre carte (une seule attendue)` };
    const parent = await C.findOne({ _id: autres[0].carteId });
    const catalogue = await catalogueProd.findOne({ idProduct: produit });
    const ids = (parent?.liens?.idProduct || []).filter(x => x !== produit);
    const cat = await catalogueProd.find({ idProduct: { $in: ids } }, { projection: { idProduct: 1, idMetacard: 1, idExpansion: 1 } }).toArray();
    const nums = new Map((await numerosProd.find({ idProduct: { $in: ids } }, { projection: { idProduct: 1, numero: 1 } }).toArray()).map(n => [n.idProduct, n.numero]));
    const freres = cat.map(c => ({ idProduct: c.idProduct, idMetacard: c.idMetacard, idExpansion: c.idExpansion, numero: nums.get(c.idProduct) ?? null }));
    // le produit lui-même doit être porté par le parent AU MOMENT D'ÉCRIRE ; une ligne virtuelle suppose que poser-lignes-ciblees a aussi ajouté l'idProduct à la carte
    const parentVu = lignesVirtuelles.length && parent && !(parent.liens?.idProduct || []).includes(produit) ? { ...parent, liens: { ...parent.liens, idProduct: [...(parent.liens?.idProduct || []), produit] } } : parent;
    const verdict = prouver({ produit, slug: L.slugSet, fiche, lignesFiche, nImagesDocs, parent: parentVu, ligneParent: autres[0], catalogue, freres, expansionParent });
    return { produit, fiche, lignesFiche, parent: parentVu, ligneParent: autres[0], verdict };
}

async function executer({ argv, ouvrirConnexions, log = console.log, err = console.error }) {
    const AUTORISES = [/^--code=[\w.\/-]+$/, /^--produits=\d+(,\d+)*$/, /^--attendu=\d+$/, /^--ecrire$/];
    const inconnus = argv.filter(a => !AUTORISES.some(r => r.test(a)));
    const arg = n => argv.find(a => a.startsWith(`--${n}=`))?.slice(n.length + 3);
    if (inconnus.length || !arg('code') || !arg('produits')) { err(`❌ ${inconnus.length ? `argument inconnu : ${inconnus.join(' ')} — ` : ''}--code=<Additionals de la table> et --produits=<idProduct,…> obligatoires`); return 2; }
    const ecrire = argv.includes('--ecrire');
    if (ecrire && arg('attendu') === undefined) { err('❌ --ecrire exige --attendu=<n>'); return 2; }
    const { ligne: ligneDeTable } = require('./collecte-cartes/table-sets');
    const L = ligneDeTable(arg('code'));
    if (!L || !L.verifie || !L.additionalsDe || !L.slugSet) { err(`❌ ${arg('code')} : ligne absente, non vérifiée, ou qui n'est pas un Additionals (additionalsDe, slugSet)`); return 2; }
    const P = ligneDeTable(L.additionalsDe);
    if (!P || !P.bulba?.expansion) { err(`❌ le parent ${L.additionalsDe} est absent de la table`); return 2; }
    const expansionParent = { nom: [].concat(P.bulba.expansion)[0], tirage: P.bulba.tirage || 'intl', idExpansion: P.exp };
    const { cartes: cx, prod, fermer } = await ouvrirConnexions({ production: true, buckets: [] });
    try {
        const C = cx.db.collection('cartes'), CP = cx.db.collection('cartes_produits');
        const visees = arg('produits').split(',').map(Number);
        const items = [];
        for (const produit of visees) items.push(await instruire({ C, CP, images: cx.db.collection('images'), catalogueProd: prod.db.collection('catalogue_produits'), numerosProd: prod.db.collection('numeros_cartes'), L, expansionParent, produit }));
        log(`   ${L.code} (${L.slugSet}) — parent ${P.code} « ${expansionParent.nom} » (${expansionParent.tirage}, exp ${expansionParent.idExpansion}) · ${visees.length} produit(s) visé(s)`);
        for (const it of items) {
            if (it.erreur) { log(`   ✗ ${it.produit} : NON — ${it.erreur}`); continue; }
            log(`   ${it.verdict.ok ? '✔' : '✗'} ${it.produit} fiche ${it.fiche._id} « ${it.fiche.nomEn} » → carte ${it.parent?._id} : ${it.verdict.ok ? 'DOUBLE PROUVÉ' : 'NON PROUVÉ'}`);
            for (const p of it.verdict.preuves) log(`        ${p.ok ? 'ok ' : 'KO '} ${p.nom} — ${p.detail}`);
        }
        const prouves = items.filter(i => i.verdict?.ok);
        log(`\n   PLAN : ${prouves.length} fiche(s) simple(s) à retirer sur ${visees.length} visée(s) — ${prouves.map(i => i.fiche._id).join(', ') || 'aucune'}`);
        if (!ecrire) { log('   (simulation — lot-additif.js … -- node retirer-fiches-simples-doublons.js … --attendu=N --ecrire)'); return prouves.length === visees.length ? 0 : 1; }
        if (prouves.length !== visees.length) { err(`❌ ARRÊT : ${prouves.length} prouvée(s) sur ${visees.length} — une seule non prouvée = on ne touche à aucune, rien n'est écrit`); return 1; }
        if (prouves.length !== Number(arg('attendu'))) { err(`❌ ARRÊT : ${prouves.length} fiche(s) à retirer, attendu ${arg('attendu')} — rien n'est écrit`); return 1; }
        const r = await ecrireRetraits(cx.db, prouves);
        const reste = (await Promise.all(prouves.map(async i => (await C.countDocuments({ _id: i.fiche._id })) + (await CP.countDocuments({ carteId: i.fiche._id })) + (1 - (await CP.countDocuments({ _id: i.ligneParent._id })))))).reduce((a, b) => a + b, 0);
        log(`\n   ${r.fiches === prouves.length && r.lignes === prouves.length && !reste ? '✅' : '🔴'} fiches retirées ${r.fiches}/${prouves.length} · lignes retirées ${r.lignes}/${prouves.length} · relu : ${reste} écart(s) (fiche ou ligne restante, ligne du parent absente)`);
        return r.fiches === prouves.length && r.lignes === prouves.length && !reste ? 0 : 1;
    } finally { await fermer(); }
}

module.exports = { prouver, instruire, ecrireRetraits, executer };

if (require.main === module) {
    executer({ argv: process.argv.slice(2), ouvrirConnexions: require('./collecte-cartes/garde').ouvrirConnexions }).then(c => { process.exitCode = c; }).catch(e => { console.error('❌', e.message); process.exitCode = 1; });
}
