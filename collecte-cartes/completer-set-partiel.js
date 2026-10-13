// ============================================================
// COMPLÉTER UN SET PARTIEL EXISTANT PAR DES LIGNES NEUVES SEULEMENT (COURTS2, 2026-10-13 — creer-set-partiel.js --completer)
// ============================================================
// Le set Promos (2107) existe (53/93, posé le 2026-10-12) ; `formeCollee` (S6) y prouve un produit de plus, Rainbow-Energy-TR17 (275578 = Team Rocket
// n°17, Rainbow Energy, carte 60335). creer-set-partiel.js refusait : un complément est une MODIFICATION. Cette option NOMMÉE pose la ligne ET laisse
// le set dans un état VRAI (décision 3 du testeur « applique ta recommandation si elle est réversible », tour 1) :
//   · cartes_produits : `$setOnInsert` en upsert — une ligne qui existe déjà n'est JAMAIS réécrite (identique : ignorée ; différente : refus) ;
//   · cartes : `$addToSet` du slug du set, de l'idProduct et de l'idMetacard — ajoute à la FIN, ne retire ni ne réordonne rien. 🔑 Le premier élément
//     de liens.idProduct est le repère d'adresse du site (défaut latent vu en S3) : une carte SANS liens.idProduct ferait du nouveau produit ce repère
//     → refus ;
//   · sets.partiel : les CHAMPS du compteur seulement (prouves, total, restes, contredits, dejaJoints, horsDenominateur, mention, tiragePreuve), RECALCULÉS
//     par la fonction qui les a écrits à la création (set-partiel.js : partielDe) ; refus si le recalcul ne colle pas aux compteurs d'avant
//     (lignes posées par la création = prouves d'avant, total inchangé, restes d'avant − lignes neuves, dejaJoints inchangé) ;
//   · restes : le document du produit n'est PAS supprimé, il est MARQUÉ résolu (resoluLe, resoluPar, resoluLigne, resoluCarteId) — réversible
//     par un $unset de ces quatre champs.
// Une écriture exige `--attendu=N` (le nombre de lignes neuves de la simulation) ; il ne colle plus → rien ne s'écrit.
const SP = require('./set-partiel');
const CLES = ['carteId', 'idProduct', 'preuve', 'slug', 'slugSet'];
const memeLigne = (a, b) => CLES.every(k => JSON.stringify(a?.[k] ?? null) === JSON.stringify(b?.[k] ?? null));
const CHAMPS_PARTIEL = ['prouves', 'total', 'restes', 'contredits', 'dejaJoints', 'horsDenominateur', 'mention', 'tiragePreuve'];
const CHAMPS_RESOLU = ['resoluLe', 'resoluPar', 'resoluLigne', 'resoluCarteId'];
const PAR = 'completer-set-partiel';

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

/**
 * Pur. Le compteur `sets.partiel` d'APRÈS la pose, par partielDe (la fonction de la création), sur la classification courante : celle-ci voit les lignes
 * posées par la création comme « déjà jointes » (posees d'entre elles) ; elles redeviennent des prouvés. Refuse si le recalcul ne colle pas aux compteurs d'avant.
 * @returns {{ partiel?: object, erreur?: string }}
 */
function recalculerPartiel({ classement: C, partielAvant: A, posees, nbNeuves, chemin }) {
    if (!A) return { erreur: 'le set n\'a pas de compteur partiel : ce n\'est pas un set partiel' };
    if (posees !== A.prouves) return { erreur: `${posees} ligne(s) posées par la création en base, ${A.prouves} prouvés au compteur : le compteur ne décrit pas la base` };
    const dejaJoints = C.deja.length - posees;
    const Cp = { prouves: new Array(posees + nbNeuves), restes: C.restes, contredits: C.contredits, deja: new Array(Math.max(dejaJoints, 0)), horsDenominateur: C.horsDenominateur };
    const P = SP.partielDe(Cp, chemin ? { chemin } : undefined);
    const attendu = { total: A.total, restes: A.restes - nbNeuves, dejaJoints: A.dejaJoints, contredits: A.contredits, horsDenominateur: A.horsDenominateur };
    for (const [k, v] of Object.entries(attendu)) if (P[k] !== v) return { erreur: `le recalcul donne ${k} = ${P[k]}, le compteur d'avant impose ${v} : le classement a bougé autrement que par la pose — refusé` };
    return { partiel: Object.fromEntries(CHAMPS_PARTIEL.map(k => [k, P[k]])) };
}

/** Écrit le plan : $setOnInsert (ligne), $addToSet (carte), $set des champs du compteur, $set des 4 champs « résolu » du reste. Rend les comptes ; LÈVE si une ligne annoncée neuve existait déjà. */
async function appliquerComplement(db, plan, slug, partiel, restesAMarquer, le) {
    let inserees = 0, cartesModifiees = 0, restesMarques = 0;
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
    const champs = {}; for (const [k, v] of Object.entries(partiel)) champs[`partiel.${k}`] = v;
    const rs = await db.collection('sets').updateOne({ _id: slug }, { $set: champs });
    for (const x of restesAMarquer) {
        const n = plan.neuves.find(m => m.ligne.idProduct === x.idProduct);
        const r = await db.collection('restes').updateOne({ _id: x._id }, { $set: { resoluLe: le, resoluPar: PAR, resoluLigne: n.ligne._id, resoluCarteId: n.carteId } });
        restesMarques += r.modifiedCount;
    }
    return { inserees, cartesModifiees, setModifie: rs.modifiedCount, restesMarques };
}

/** La relecture, à l'ATTENDU du plan. Rend la liste des écarts ([] = juste). `avant` : { cartes: Map<id, doc>, nbLignes, set, restes: doc[], nbRestes }. */
async function relire(db, plan, avant, slug, partiel, restesAMarquer) {
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
    // le set : le document d'avant, dont SEULS les champs du compteur ont changé, à la valeur recalculée
    const set = (await db.collection('sets').find({ _id: slug }).toArray())[0];
    const attSet = structuredClone(avant.set); for (const [k, v] of Object.entries(partiel)) attSet.partiel[k] = v;
    if (JSON.stringify(set) !== JSON.stringify(attSet)) e.push('le document du set n\'est pas celui d\'avant + les seuls champs du compteur');
    // les restes : aucun supprimé ; les marqués portent les 4 champs ; tous les autres champs et tous les autres documents sont inchangés
    if (await db.collection('restes').countDocuments({}) !== avant.nbRestes) e.push('restes : le nombre de documents a changé (aucune suppression permise)');
    const apres = new Map((await db.collection('restes').find({ set: slug }).toArray()).map(d => [d._id, d]));
    const marques = new Set(restesAMarquer.map(x => x._id));
    for (const a of avant.restes) {
        const d = apres.get(a._id);
        if (!d) { e.push(`reste ${a._id} disparu`); continue; }
        const { resoluLe, resoluPar, resoluLigne, resoluCarteId, ...reste } = d;
        if (JSON.stringify(reste) !== JSON.stringify(a)) e.push(`reste ${a._id} : un champ autre que « résolu » a changé`);
        if (marques.has(a._id) ? resoluPar !== PAR : resoluPar !== undefined) e.push(`reste ${a._id} : ${marques.has(a._id) ? 'non marqué résolu' : 'marqué à tort'}`);
    }
    return e;
}

async function completer({ db, slug, lignes, metaDe, attendu, ecrire, classement, code, chemin, le = new Date(), log = console.log, err = console.error }) {
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
    // le compteur du set, recalculé par partielDe, et les restes à marquer résolus
    const posees = await db.collection('cartes_produits').countDocuments({ preuve: SP.PREUVE, route: code, slugSet: slug });
    const R = recalculerPartiel({ classement, partielAvant: set.partiel, posees, nbNeuves: plan.neuves.length, chemin });
    if (R.erreur) { err(`❌ ${R.erreur} — rien n'est écrit`); return 1; }
    const A = set.partiel;
    log(`   sets.partiel (champs du compteur seuls, recalculés par partielDe) : prouvés ${A.prouves}→${R.partiel.prouves} · restes ${A.restes}→${R.partiel.restes} · total ${A.total}→${R.partiel.total} · dejaJoints ${A.dejaJoints}→${R.partiel.dejaJoints}`);
    const restesDuSet = await db.collection('restes').find({ set: slug }).toArray();
    const restesAMarquer = restesDuSet.filter(x => plan.neuves.some(n => n.ligne.idProduct === x.idProduct) && /^partiel-/.test(x.type ?? '') && !x.resoluPar);
    log(`   restes marqués RÉSOLUS (jamais supprimés ; champs ${CHAMPS_RESOLU.join(', ')}) : ${restesAMarquer.length ? restesAMarquer.map(x => `${x.idProduct} (${x.type})`).join(', ') : 'aucun'}`);
    if (attendu != null && attendu !== plan.neuves.length) { err(`❌ le plan a ${plan.neuves.length} ligne(s) neuve(s), ${attendu} attendue(s) (--attendu=${attendu}) : le plan diffère, RIEN ne s'écrit`); return 1; }
    if (!ecrire) { log('(simulation — rien n\'est écrit)'); return 0; }
    const avant = { cartes: new Map([...cartes].map(([id, c]) => [id, structuredClone(c)])), nbLignes: await db.collection('cartes_produits').countDocuments({}), set: structuredClone(set), restes: structuredClone(restesDuSet), nbRestes: await db.collection('restes').countDocuments({}) };
    const r = await appliquerComplement(db, plan, slug, R.partiel, restesAMarquer, le);
    log(`   écrit : ${r.inserees} ligne(s) insérée(s), ${r.cartesModifiees} carte(s) modifiée(s), set ${r.setModifie}, ${r.restesMarques} reste(s) marqué(s)`);
    const ecarts = await relire(db, plan, avant, slug, R.partiel, restesAMarquer);
    log(`   RELECTURE : ${ecarts.length ? '🔴 ' + ecarts.join(' ; ') : '✅ comme attendu'}`);
    if (ecarts.length) { err('❌ la relecture ne retrouve pas l\'état attendu'); return 1; }
    log('   ✅ écrit et relu');
    return 0;
}

module.exports = { planComplement, recalculerPartiel, appliquerComplement, relire, completer, memeLigne, CHAMPS_PARTIEL, CHAMPS_RESOLU };
