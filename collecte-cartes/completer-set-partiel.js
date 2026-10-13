// ============================================================
// COMPLÉTER UN SET PARTIEL EXISTANT PAR DES LIGNES NEUVES SEULEMENT (COURTS2, 2026-10-13 — creer-set-partiel.js --completer)
// ============================================================
// Le set Promos (2107) existe (53/93, posé le 2026-10-12) ; `formeCollee` (S6) y prouve un produit de plus, Rainbow-Energy-TR17 (275578 = Team Rocket
// n°17, Rainbow Energy, carte 60335). creer-set-partiel.js refusait : un complément est une MODIFICATION. Cette option NOMMÉE ne fait que de l'AJOUT :
//   · cartes_produits : `$setOnInsert` en upsert — une ligne qui existe déjà n'est JAMAIS réécrite (identique : ignorée ; différente : refus) ;
//   · cartes : `$addToSet` du slug du set, de l'idProduct et de l'idMetacard — ajoute à la FIN, ne retire ni ne réordonne rien. 🔑 Le premier élément
//     de liens.idProduct est le repère d'adresse du site (défaut latent vu en S3) : une carte SANS liens.idProduct ferait du nouveau produit ce repère
//     → refus ; un `$set` ou un `$push` avec tri qui réordonnerait le tableau n'existe pas ici.
// ⚠️ CE QUE LE COMPLÉMENT NE TOUCHE PAS, ET DIT : `sets.partiel` (compteurs prouvés / restes) et le document `restes` du produit (« sans code d'origine »,
// périmé une fois la ligne posée) — les modifier est une MODIFICATION et une SUPPRESSION, elles attendent un feu vert nommé ; la simulation les nomme.
// Une écriture exige `--attendu=N` (le nombre de lignes neuves de la simulation) ; il ne colle plus → rien ne s'écrit.
const CLES = ['carteId', 'idProduct', 'preuve', 'slug', 'slugSet'];
const memeLigne = (a, b) => CLES.every(k => JSON.stringify(a?.[k] ?? null) === JSON.stringify(b?.[k] ?? null));

/**
 * Pur. lignes : les lignes que la classification produirait ; existantes : Map<_id, document> (celles qui existent déjà) ; set : le document du set
 * (null = il n'existe pas) ; cartes : Map<carteId, { liens, sets }> ; metaDe : Map<idProduct, idMetacard>.
 * @returns {{ neuves: object[], identiques: string[], erreurs: string[] }}
 */
function planComplement({ lignes, existantes, set, cartes, metaDe }) {
    const erreurs = [], neuves = [], identiques = [];
    if (!set) erreurs.push('le set n\'existe pas : le créer est un autre geste (creer-set-partiel.js sans --completer)');
    for (const l of lignes) {
        const ex = existantes.get(l._id);
        if (ex) { if (memeLigne(ex, l)) identiques.push(l._id); else erreurs.push(`la ligne ${l._id} existe avec un contenu qui diverge (slug « ${ex.slug} », preuve « ${ex.preuve} ») : une ligne existante n'est JAMAIS réécrite`); continue; }
        const c = cartes.get(l.carteId);
        if (!c) { erreurs.push(`la carte ${l.carteId} de la ligne ${l._id} est introuvable`); continue; }
        const liens = c.liens?.idProduct;
        if (!Array.isArray(liens) || !liens.length) { erreurs.push(`la carte ${l.carteId} n'a pas de liens.idProduct : le produit ${l.idProduct} y deviendrait le premier élément, le repère d'adresse du site — refusé`); continue; }
        neuves.push({ ligne: l, carteId: l.carteId, ajoutLien: !liens.includes(l.idProduct), ajoutSet: !(c.sets || []).includes(l.slugSet), meta: metaDe?.get(l.idProduct) ?? null });
    }
    return { neuves, identiques, erreurs };
}

/** Écrit le plan : uniquement $setOnInsert (ligne) et $addToSet (carte). Rend { inserees, cartesModifiees } ; LÈVE si une ligne annoncée neuve existait déjà. */
async function appliquerComplement(db, plan, slug) {
    let inserees = 0, cartesModifiees = 0;
    for (const n of plan.neuves) {
        const { _id, ...corps } = n.ligne;
        const r = await db.collection('cartes_produits').updateOne({ _id }, { $setOnInsert: corps }, { upsert: true });
        if (r.upsertedCount !== 1) throw new Error(`la ligne ${_id} existait déjà au moment d'écrire (insérées : ${r.upsertedCount}) — la base a bougé depuis le plan ; arrêt`);
        inserees += r.upsertedCount;
        const ajout = { sets: slug, 'liens.idProduct': n.ligne.idProduct };
        if (n.meta != null) ajout['liens.idMetacards'] = n.meta;
        const rc = await db.collection('cartes').updateOne({ _id: n.carteId }, { $addToSet: ajout });
        cartesModifiees += rc.modifiedCount;
    }
    return { inserees, cartesModifiees };
}

/** La relecture, à l'ATTENDU du plan. Rend la liste des écarts ([] = juste). `avant` : { cartes: Map<id, doc>, nbLignes, set, nbRestes }. */
async function relire(db, plan, avant, slug) {
    const e = [];
    const lignes = await db.collection('cartes_produits').find({ _id: { $in: plan.neuves.map(n => n.ligne._id) } }).toArray();
    const nbLignes = await db.collection('cartes_produits').countDocuments({});
    if (nbLignes !== avant.nbLignes + plan.neuves.length) e.push(`cartes_produits : ${nbLignes}, attendu ${avant.nbLignes + plan.neuves.length}`);
    for (const n of plan.neuves) {
        if (!memeLigne(lignes.find(l => l._id === n.ligne._id), n.ligne)) e.push(`la ligne ${n.ligne._id} n'est pas celle du plan`);
        const c = (await db.collection('cartes').find({ _id: n.carteId }).toArray())[0], a = avant.cartes.get(n.carteId);
        const attLiens = [...a.liens.idProduct, ...(n.ajoutLien ? [n.ligne.idProduct] : [])], attSets = [...(a.sets || []), ...(n.ajoutSet ? [slug] : [])];
        if (JSON.stringify(c?.liens?.idProduct) !== JSON.stringify(attLiens)) e.push(`carte ${n.carteId} : liens.idProduct ${JSON.stringify(c?.liens?.idProduct)}, attendu les anciens dans leur ordre + le nouveau à la fin`);
        if (JSON.stringify(c?.sets) !== JSON.stringify(attSets)) e.push(`carte ${n.carteId} : sets ${JSON.stringify(c?.sets)}, attendu ${JSON.stringify(attSets)}`);
        if (n.meta != null && !(c?.liens?.idMetacards || []).includes(n.meta)) e.push(`carte ${n.carteId} : idMetacard ${n.meta} absent`);
    }
    const set = (await db.collection('sets').find({ _id: slug }).toArray())[0];
    if (JSON.stringify(set) !== JSON.stringify(avant.set)) e.push('le document du set a changé');
    if (await db.collection('restes').countDocuments({}) !== avant.nbRestes) e.push('restes a changé');
    return e;
}

async function completer({ db, slug, lignes, metaDe, attendu, ecrire, log = console.log, err = console.error }) {
    if (ecrire && (attendu == null || !Number.isInteger(attendu))) { err('❌ --ecrire exige --attendu=N (le nombre de lignes neuves de la simulation)'); return 2; }
    const set = (await db.collection('sets').find({ _id: slug }).toArray())[0] ?? null;
    const existantes = new Map((await db.collection('cartes_produits').find({ _id: { $in: lignes.map(l => l._id) } }).toArray()).map(d => [d._id, d]));
    const ids = [...new Set(lignes.map(l => l.carteId))];
    const cartes = new Map((await db.collection('cartes').find({ _id: { $in: ids } }).toArray()).map(c => [c._id, c]));
    const plan = planComplement({ lignes, existantes, set, cartes, metaDe });
    log(`COMPLÉMENT du set « ${slug} » : ${plan.neuves.length} ligne(s) NEUVE(S), 0 modifiée(s), ${plan.identiques.length} identique(s) déjà en base`);
    if (plan.erreurs.length) { for (const m of plan.erreurs) err(`❌ ${m} — rien n'est écrit`); return 1; }
    if (!plan.neuves.length) { err('❌ rien à faire : aucune ligne neuve'); return 1; }
    for (const n of plan.neuves) {
        const c = cartes.get(n.carteId);
        log(`   + ${n.ligne._id} (${n.ligne.slug}, preuve ${n.ligne.preuve}) — carte « ${c.nomEn} » : liens.idProduct ${c.liens.idProduct.length} → ${c.liens.idProduct.length + (n.ajoutLien ? 1 : 0)} (le nouveau à la fin ; premier élément ${c.liens.idProduct[0]} inchangé) · slug du set ${n.ajoutSet ? 'AJOUTÉ à cartes.sets' : 'déjà présent'}`);
    }
    const restes = await db.collection('restes').find({ set: slug }).toArray();
    log(`   NON touchés, à décider par un feu vert nommé : sets.partiel (prouvés ${set.partiel?.prouves}→${(set.partiel?.prouves ?? 0) + plan.neuves.length}, restes ${set.partiel?.restes}→${(set.partiel?.restes ?? 0) - plan.neuves.length} si ces produits y figurent) ; restes périmés : ${plan.neuves.map(n => { const r = restes.filter(x => x.set === slug && x.idProduct === n.ligne.idProduct); return `${n.ligne.idProduct} (${r.length ? r.map(x => x.type).join(',') : 'aucun'})`; }).join(', ')}`);
    if (attendu != null && attendu !== plan.neuves.length) { err(`❌ le plan a ${plan.neuves.length} ligne(s) neuve(s), ${attendu} attendue(s) (--attendu=${attendu}) : le plan diffère, RIEN ne s'écrit`); return 1; }
    if (!ecrire) { log('(simulation — rien n\'est écrit)'); return 0; }
    const avant = { cartes: new Map([...cartes].map(([id, c]) => [id, structuredClone(c)])), nbLignes: await db.collection('cartes_produits').countDocuments({}), set: structuredClone(set), nbRestes: await db.collection('restes').countDocuments({}) };
    const r = await appliquerComplement(db, plan, slug);
    log(`   écrit : ${r.inserees} ligne(s) insérée(s), ${r.cartesModifiees} carte(s) modifiée(s)`);
    const ecarts = await relire(db, plan, avant, slug);
    log(`   RELECTURE : ${ecarts.length ? '🔴 ' + ecarts.join(' ; ') : '✅ comme attendu'}`);
    if (ecarts.length) { err('❌ la relecture ne retrouve pas l\'état attendu'); return 1; }
    log('   ✅ écrit et relu');
    return 0;
}

module.exports = { planComplement, appliquerComplement, relire, completer, memeLigne };
