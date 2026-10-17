// ============================================================
// STAFF-ECRITURE (2026-10-17) — SÉPARER LES PAIRES BLACK STAR DONT LA VERSION ÉTIQUETÉE EST IDENTIFIÉE : `cartes_produits.variante`, et la fin du « tampon non séparable »
// ============================================================
// 🔑 DÉCISION DU TESTEUR (2026-10-17) : « 3. Les paires identifiées deviennent séparables : variante « staff » ou « normale » sur l'idProduct, partageeTamponNonSepare: false. NOTRE visuel reste l'image
// sans étiquette, avec tamponNonRepresente. 4. Site : sous la vignette, un badge « Staff » ou « Jumbo » à la place de « tampon non représenté ». SUITE 3. Jumbo (OS) : aucune confondue avec sa version normale.
// 4. Écriture des paires identifiées en essai à blanc ; écriture réelle seulement si la planche ne montre aucun douteux mal classé ; puis revérification. »
// Le coordinateur a regardé les 8 planches des 64 paires : aucun douteux mal classé. 56 paires Staff (52 « staff-identifie » + 4 rulings : SV 133 à 136, étiquette « Staff Stamped », même pastille blanche, même
// place), 5 paires Jumbo (étiquette rouge « Attention: Oversized Card / Not Tournament Legal »), 3 restent NON séparables (SV 045, SV 150, SWSH 296 : rien ne change pour elles). La version étiquetée est V2 dans les 61 paires.
//
// CE QUE CE MODULE ÉCRIT, et seulement cela, pour les 61 paires dont tout est prouvé :
//   · `cartes_produits` (chaque ligne des 2 produits) : `variante` = « normale » (V1) | « staff » | « jumbo » (V2) + `variantePreuve` ; jamais sur une ligne qui porte déjà une variante DIFFÉRENTE (la paire entière est refusée) ;
//   · l'entrée `cartes.images` qui porte la paire (BS-STAFF, marquer-partage-tampon.js) et son document `images` : `partageeTamponNonSepare: true → false` ; `produitsPartages` GARDÉ ; `tamponNonRepresente` gardé « Staff »
//     pour les Staff ; pour les Jumbo, « Play! Pokémon » → « Jumbo » (le libellé Pokumon était faux), l'ancien gardé dans `tamponNonRepresenteAvant`.
// ⚠️ Ce sont des MODIFICATIONS (true → false, correction de libellé) accordées NOMMÉMENT par la décision 3 ; l'ajout de `variante` / `variantePreuve` est additif. Le groupe `images-partagees-tampon` de la garde de lot BAISSE
// de ce fait : l'annonce est calculée par la fonction de la garde elle-même (`annonceDePlan`, compterEtat + comparer), jamais à la main.
//
// ÉCRIT PAR CE QU'IL AUTORISE : une paire n'est écrite que si TOUT est prouvé sur l'état réel (ses 2 produits ont une ligne, aucune variante contraire, UNE entrée l'a, dans l'état d'avant ou déjà dans l'état final) ;
// le reste est un refus NOMMÉ, jamais un silence. Idempotent. Aucune requête réseau.
const COMPTEURS = require('./garde-lot');

const DATE_PLANCHE = '2026-10-17';
// Les 4 rulings du coordinateur : étiquette « Staff Stamped » (même pastille blanche, même place, le mot Staff) ; l'OCR l'a lue de travers, la planche a été regardée.
const RULINGS = Object.freeze(['SV-Black-Star-Promos|133', 'SV-Black-Star-Promos|134', 'SV-Black-Star-Promos|135', 'SV-Black-Star-Promos|136']);
// Le libellé d'une entrée AVANT le lot (BS-STAFF) et APRÈS, par type de paire.
const AVANT = Object.freeze({ staff: 'Staff', jumbo: 'Play! Pokémon' });
const APRES = Object.freeze({ staff: 'Staff', jumbo: 'Jumbo' });

/** La preuve écrite sur la ligne : l'étiquette lue, le rang, la date de la planche. `role` : 'normale' (V1) ou 'etiquete' (V2). */
function variantePreuve(p, role) {
    if (role === 'normale') return `version sans étiquette : l'autre produit de la paire (V2, idProduct ${p.idEtiquete}) porte l'étiquette ${p.type === 'jumbo' ? '« Oversized Card »' : '« Staff »'} ; V1, vérifié sur planche le ${DATE_PLANCHE}`;
    if (p.type === 'jumbo') return `étiquette rouge « Attention: Oversized Card / Not Tournament Legal » lue sur la vignette Cardmarket du produit, V2, vérifiée sur planche le ${DATE_PLANCHE}`;
    if (p.ruling) return `étiquette « Staff Stamped » (même pastille blanche, même place, le mot Staff) lue sur la vignette Cardmarket du produit, V2, décision du coordinateur et planche le ${DATE_PLANCHE}`;
    return `étiquette « Staff Version » lue sur la vignette Cardmarket du produit, V2, vérifiée sur planche le ${DATE_PLANCHE}`;
}

/**
 * Les paires à séparer, depuis les verdicts de la détection et les adresses Cardmarket. Tout désaccord LÈVE (une liste qui se tait sur une incohérence écrirait sur le mauvais produit).
 * @returns {{paires: object[], exclues: object[], comptes: {staff: number, jumbo: number, exclues: number}}}
 */
function listeDesPaires(verdicts, adresses) {
    const adr = new Map(adresses.map(a => [a.n, a]));
    const paires = [], exclues = [];
    for (const v of verdicts) {
        const a = adr.get(v.n);
        if (!a) throw new Error(`verdict n°${v.n} (${v.set} ${v.numero}) : aucune adresse correspondante`);
        if (a.set !== v.set || String(a.numero) !== String(v.numero)) throw new Error(`verdict n°${v.n} : l'adresse est ${a.set} ${a.numero}, le verdict ${v.set} ${v.numero}`);
        const cle = `${v.set}|${v.numero}`;
        let type = null, ruling = false;
        if (v.verdict === 'staff-identifie') type = 'staff';
        else if (v.verdict === 'jumbo-identifie') type = 'jumbo';
        else if (v.verdict === 'douteux') { if (RULINGS.includes(cle) && v.etiqueteeEstV2 === true) { type = 'staff'; ruling = true; } }
        else throw new Error(`verdict n°${v.n} : « ${v.verdict} » n'est pas un verdict connu (staff-identifie, jumbo-identifie, douteux)`);
        if (!type) { exclues.push({ n: v.n, set: v.set, numero: v.numero, nom: v.nom, verdict: v.verdict }); continue; }
        const v1 = a.versions?.find(x => x.v === 'V1')?.idProduct, v2 = a.versions?.find(x => x.v === 'V2')?.idProduct;
        if (!Number.isInteger(v1) || !Number.isInteger(v2)) throw new Error(`verdict n°${v.n} : l'adresse ne donne pas V1 et V2`);
        if (v.idV1 !== v1 || v.idV2 !== v2) throw new Error(`verdict n°${v.n} (${cle}) : les idProduct du verdict (${v.idV1}, ${v.idV2}) ne sont pas ceux de l'adresse (${v1}, ${v2})`);
        // la version étiquetée est V2 dans les 61 paires ; pour un ruling, le verdict ne porte pas idEtiquete (douteux) : etiqueteeEstV2 le dit
        if (!ruling && (v.idEtiquete !== v2 || v.idNormale !== v1)) throw new Error(`verdict n°${v.n} (${cle}) : la version étiquetée n'est pas V2 (idEtiquete ${v.idEtiquete}, V2 ${v2}) : rien n'est écrit`);
        paires.push({ n: v.n, set: v.set, numero: v.numero, nom: v.nom, type, ruling, idNormale: v1, idEtiquete: v2 });
    }
    return { paires, exclues, comptes: { staff: paires.filter(p => p.type === 'staff').length, jumbo: paires.filter(p => p.type === 'jumbo').length, exclues: exclues.length } };
}

const memesIds = (a, b) => Array.isArray(a) && a.length === b.length && [...a].sort((x, y) => x - y).join() === [...b].sort((x, y) => x - y).join();

/** L'état d'une entrée (ou d'un document) de la paire : 'avant' (BS-STAFF), 'apres' (déjà séparée), sinon le motif. */
function etatMarquage(x, type) {
    if (x.partageeTamponNonSepare === true) return x.tamponNonRepresente === AVANT[type] ? 'avant' : 'tampon-inattendu';
    if (x.partageeTamponNonSepare === false && x.tamponNonRepresente === APRES[type] && (type !== 'jumbo' || x.tamponNonRepresenteAvant === AVANT.jumbo)) return 'apres';
    return 'entree-etat-inattendu';
}

/**
 * LE PLAN : chaque paire est PROUVÉE (ses 2 produits ont une ligne sans variante contraire, UNE entrée cartes.images porte la paire dans un état attendu) ou REFUSÉE avec son motif. Rien n'est écrit.
 * @returns {{paires: object[], refus: object[], comptes: object}}
 */
async function construirePlan({ cartesDb, paires }) {
    const ids = paires.flatMap(p => [p.idNormale, p.idEtiquete]);
    const lignes = await cartesDb.collection('cartes_produits').find({ idProduct: { $in: ids } }).toArray();
    const parProduit = new Map();
    for (const l of lignes) parProduit.set(l.idProduct, [...(parProduit.get(l.idProduct) || []), l]);
    const cartes = await cartesDb.collection('cartes').find({ 'images.produitsPartages': { $in: ids } }, { projection: { images: 1 } }).toArray();
    const docs = await cartesDb.collection('images').find({ produitsPartages: { $in: ids } }).toArray();
    const ok = [], refus = [];
    for (const p of paires) {
        const base = { n: p.n, set: p.set, numero: p.numero, nom: p.nom, type: p.type };
        const non = motif => refus.push({ ...base, motif });
        const lg = [];
        let motif = null;
        for (const [id, role] of [[p.idNormale, 'normale'], [p.idEtiquete, 'etiquete']]) {
            const ls = parProduit.get(id) || [];
            if (!ls.length) { motif = 'produit-sans-ligne'; break; }
            const cible = role === 'normale' ? 'normale' : p.type;
            for (const l of ls) {
                if (l.variante !== undefined && l.variante !== null && l.variante !== cible) { motif = 'variante-contraire'; break; }
                lg.push({ _id: l._id, idProduct: id, cible, preuve: variantePreuve(p, role), deja: l.variante === cible });
            }
            if (motif) break;
        }
        if (motif) { non(motif); continue; }
        const paire = [p.idNormale, p.idEtiquete];
        const entrees = cartes.flatMap(c => (c.images || []).filter(e => e && memesIds(e.produitsPartages, paire)).map(e => ({ c, e })));
        if (!entrees.length) { non('entree-introuvable'); continue; }
        if (entrees.length > 1) { non('entree-ambigue'); continue; }
        const { c, e } = entrees[0];
        if ((c.images || []).filter(x => x && x.set === e.set && x.cleR2 === e.cleR2).length !== 1) { non('entree-ambigue'); continue; }
        const etat = etatMarquage(e, p.type);
        if (etat !== 'avant' && etat !== 'apres') { non(etat); continue; }
        const entree = { carteId: c._id, set: e.set, cleR2: e.cleR2, avant: e.tamponNonRepresente, cible: APRES[p.type], deja: etat === 'apres' };
        const memesDocs = docs.filter(d => memesIds(d.produitsPartages, paire));
        const doc = memesDocs.filter(d => d.cleR2 === e.cleR2 && d.carteId === c._id && d.set === e.set);
        let docCible = null, docMotif = null;
        if (doc.length === 1) {
            const ed = etatMarquage(doc[0], p.type);
            if (ed === 'avant' || ed === 'apres') docCible = { _id: doc[0]._id, avant: doc[0].tamponNonRepresente, deja: ed === 'apres' };
            else docMotif = `document-${ed}`;
        } else if (!memesDocs.length) docMotif = 'document-absent';
        else docMotif = 'document-different';
        ok.push({ ...base, ruling: p.ruling, idNormale: p.idNormale, idEtiquete: p.idEtiquete, lignes: lg, entree, doc: docCible, docMotif });
    }
    ok.sort((x, y) => x.set.localeCompare(y.set) || String(x.numero).localeCompare(String(y.numero)));
    const parMotif = {};
    for (const r of refus) parMotif[r.motif] = (parMotif[r.motif] || 0) + 1;
    return { paires: ok, refus, comptes: { paires: ok.length, refus: refus.length, parMotif,
        lignesDeja: ok.reduce((n, p) => n + p.lignes.filter(l => l.deja).length, 0), entreesDeja: ok.filter(p => p.entree.deja).length,
        documentsDeja: ok.filter(p => p.doc?.deja).length, documentsAbsents: ok.filter(p => p.docMotif === 'document-absent').length } };
}

const verifierAttendu = (attendu, n) => {
    if (attendu !== undefined && attendu !== null && attendu !== n) throw new Error(`--attendu=${attendu} mais ${n} paire(s) prouvée(s) : rien n'est écrit`);
};

/** Pose les champs. `ecrire: false` (défaut) : l'essai à blanc rend les comptes. `attendu` est OBLIGATOIRE à l'écriture et refuse AVANT toute écriture. Idempotent : ce qui est déjà posé n'est pas réécrit. */
async function appliquer(cartesDb, plan, { ecrire = false, attendu } = {}) {
    if (ecrire && !Number.isInteger(attendu)) throw new Error('--ecrire exige --attendu=<N> (le nombre de paires prouvées lu à l\'essai à blanc) : rien n\'est écrit');
    verifierAttendu(attendu, plan.paires.length);
    const lignes = plan.paires.flatMap(p => p.lignes.filter(l => !l.deja)), entrees = plan.paires.filter(p => !p.entree.deja), docs = plan.paires.filter(p => p.doc && !p.doc.deja);
    const r = { paires: plan.paires.length, lignes: lignes.length, entrees: entrees.length, documents: docs.length, dejaFait: !lignes.length && !entrees.length && !docs.length };
    if (!ecrire) return r;
    const champs = (type, avant) => ({ partageeTamponNonSepare: false, tamponNonRepresente: APRES[type], ...(type === 'jumbo' ? { tamponNonRepresenteAvant: avant } : {}) });
    for (const l of lignes) {
        const res = await cartesDb.collection('cartes_produits').updateOne({ _id: l._id }, { $set: { variante: l.cible, variantePreuve: l.preuve } });
        if (!res.matchedCount || !res.modifiedCount) throw new Error(`ligne cartes_produits introuvable ou inchangée : ${l._id} — arrêt (rejouer : idempotent)`);
    }
    for (const p of entrees) {
        const set = {};
        for (const [k, v] of Object.entries(champs(p.type, p.entree.avant))) set[`images.$[e].${k}`] = v;
        const res = await cartesDb.collection('cartes').updateOne({ _id: p.entree.carteId }, { $set: set }, { arrayFilters: [{ 'e.set': p.entree.set, 'e.cleR2': p.entree.cleR2 }] });
        if (!res.matchedCount || !res.modifiedCount) throw new Error(`entrée introuvable ou inchangée : carte ${p.entree.carteId}, ${p.entree.set}, ${p.entree.cleR2} — arrêt (rejouer : idempotent)`);
    }
    for (const p of docs) {
        const res = await cartesDb.collection('images').updateOne({ _id: p.doc._id }, { $set: champs(p.type, p.doc.avant) });
        if (!res.matchedCount || !res.modifiedCount) throw new Error(`document images introuvable ou inchangé : ${p.doc._id} — arrêt (rejouer : idempotent)`);
    }
    return r;
}

/**
 * L'ANNONCE DE LOT, par la fonction de la garde : l'état des cartes touchées avant / après (compterEtat), comparé (comparer) ; chaque baisse d'un compteur connu devient une annonce « <compteur> <groupe> : n ».
 * @returns {Promise<Object<string, number>>}
 */
async function annonceDePlan(cartesDb, plan) {
    const ids = [...new Set(plan.paires.map(p => p.entree.carteId))];
    const avant = await cartesDb.collection('cartes').find({ _id: { $in: ids } }).toArray();
    const apres = structuredClone(avant);
    for (const p of plan.paires) {
        const c = apres.find(x => x._id === p.entree.carteId);
        const e = (c?.images || []).find(x => x && x.set === p.entree.set && x.cleR2 === p.entree.cleR2);
        if (!e) throw new Error(`annonce : entrée introuvable, carte ${p.entree.carteId}, ${p.entree.cleR2}`);
        e.partageeTamponNonSepare = false;
    }
    const cmp = COMPTEURS.comparer(COMPTEURS.compterEtat({ cartes: avant }), COMPTEURS.compterEtat({ cartes: apres }));
    const annonces = {};
    for (const b of cmp.baisses) if (b.compteur in COMPTEURS.COMPTEURS) annonces[b.cle] = b.baisse;
    COMPTEURS.validerAnnonces(annonces);
    return annonces;
}

/**
 * LE DIFF « SERVIS » par la règle du site IMPORTÉE (`regle` = exporter-donnees-logos-site.regleDuSite) : pour chaque set touché, la fiche que le site donne à chaque produit de l'expansion AVANT, et APRÈS l'écriture
 * simulée (lignes avec `variante` / `variantePreuve`, entrées au nouveau marquage). Aucun produit ne doit perdre sa fiche, et aucune fiche ne doit changer. Lecture seule.
 * @returns {Promise<{produits: number, servisAvant: number, servisApres: number, perdus: number[], changes: number[], parSet: object}>}
 */
async function diffServis({ cartesDb, regle, plan }) {
    const X = require('../exporter-donnees-logos-site');
    const slugs = [...new Set(plan.paires.map(p => p.set))];
    const sets = await cartesDb.collection('sets').find({ _id: { $in: slugs } }).toArray();
    const r = { produits: 0, servisAvant: 0, servisApres: 0, perdus: [], changes: [], parSet: {} };
    const cibles = new Map(plan.paires.flatMap(p => p.lignes.map(l => [l._id, l])));
    for (const s of sets) {
        const exps = [].concat(s.idExpansion ?? []);
        const parSlug = await cartesDb.collection('cartes_produits').find({ slugSet: s._id }).toArray();
        const parExp = exps.length ? await cartesDb.collection('cartes_produits').find({ idExpansion: { $in: exps } }).toArray() : [];
        const lignes = [...new Map([...parSlug, ...parExp].map(l => [l._id ?? `${l.carteId}|${l.idProduct}`, l])).values()];
        const docs = (await cartesDb.collection('cartes').find({ sets: s._id }).toArray()).filter(d => typeof d.nomEn === 'string' && d.nomEn);
        const ids = new Set(docs.map(d => d._id));
        const lig = lignes.filter(x => ids.has(x.carteId) && exps.includes(x.idExpansion));
        const avant = X.fichesDesProduits(regle, s, docs, lig).fiche;
        const docsApres = structuredClone(docs);
        for (const p of plan.paires.filter(q => q.set === s._id)) {
            const e = (docsApres.find(d => d._id === p.entree.carteId)?.images || []).find(x => x && x.set === p.entree.set && x.cleR2 === p.entree.cleR2);
            if (e) { e.partageeTamponNonSepare = false; e.tamponNonRepresente = p.entree.cible; }
        }
        const ligApres = lig.map(l => { const c = cibles.get(l._id); return c ? { ...l, variante: c.cible, variantePreuve: c.preuve } : l; });
        const apres = X.fichesDesProduits(regle, s, docsApres, ligApres).fiche;
        const touches = new Set(plan.paires.filter(q => q.set === s._id).flatMap(q => [q.idNormale, q.idEtiquete]));
        const perdus = [...avant.keys()].filter(id => !apres.has(id)), changes = [...avant.keys()].filter(id => apres.has(id) && JSON.stringify(avant.get(id)) !== JSON.stringify(apres.get(id)));
        r.produits += touches.size; r.servisAvant += [...touches].filter(id => avant.has(id)).length; r.servisApres += [...touches].filter(id => apres.has(id)).length;
        r.perdus.push(...perdus); r.changes.push(...changes);
        r.parSet[s._id] = { produitsDuSet: avant.size, touches: touches.size, perdus: perdus.length, changes: changes.length };
    }
    return r;
}

const chiffres = s =>{ const m = /(\d+)/.exec(String(s ?? '')); return m ? Number(m[1]) : null; };

/**
 * SUITE 3 — JUMBO : un produit Jumbo partage-t-il la fiche ou l'image de sa version normale SANS marquage ? (lecture seule)
 * « Marqué » : le produit est dans le `produitsPartages` d'une entrée, ou sa ligne porte une `variante`. « Par la fiche » : un produit non Jumbo est sur la même fiche (carte, set, numéro de fiche).
 * « Par l'image » : le fichier d'image que sa carte sert pour ce numéro est aussi servi par une AUTRE carte du set, dont un produit non Jumbo est sur ce numéro.
 */
async function controleJumbo({ cartesDb, jumboIds }) {
    const jumbo = new Set(jumboIds);
    const lignes = await cartesDb.collection('cartes_produits').find({ idProduct: { $in: jumboIds } }).toArray();
    const marquesPaire = new Set();
    for (const c of await cartesDb.collection('cartes').find({ 'images.produitsPartages': { $in: jumboIds } }, { projection: { images: 1 } }).toArray())
        for (const e of c.images || []) for (const id of e?.produitsPartages || []) if (jumbo.has(id)) marquesPaire.add(id);
    const cartesIds = [...new Set(lignes.map(l => l.carteId))];
    const voisines = cartesIds.length ? await cartesDb.collection('cartes_produits').find({ carteId: { $in: cartesIds } }).toArray() : [];
    const docsCartes = cartesIds.length ? await cartesDb.collection('cartes').find({ _id: { $in: cartesIds } }, { projection: { images: 1 } }).toArray() : [];
    const parCarte = new Map(docsCartes.map(c => [c._id, c]));
    // les entrées servant le numéro de chaque ligne Jumbo, puis les autres cartes qui servent les mêmes fichiers
    const cles = new Set();
    const servies = l => (parCarte.get(l.carteId)?.images || []).filter(e => e && e.set === l.slugSet && e.cleR2 && chiffres(e.numero) !== null && chiffres(e.numero) === chiffres(l.numeroFiche));
    for (const l of lignes) for (const e of servies(l)) cles.add(e.cleR2);
    const autres = cles.size ? await cartesDb.collection('cartes').find({ 'images.cleR2': { $in: [...cles] } }, { projection: { images: 1 } }).toArray() : [];
    const lignesAutres = autres.length ? await cartesDb.collection('cartes_produits').find({ carteId: { $in: autres.map(c => c._id) } }).toArray() : [];
    const r = { total: jumboIds.length, marques: 0, seuls: 0, sansLigne: 0, entreJumbo: 0, confondus: [] };
    for (const id of jumboIds) {
        const ls = lignes.filter(l => l.idProduct === id);
        if (!ls.length) { r.sansLigne++; continue; }
        if (marquesPaire.has(id) || ls.some(l => l.variante)) { r.marques++; continue; }
        let confondu = null, entreJumbo = false;
        for (const l of ls) {
            const memeFiche = x => x.carteId === l.carteId && x.slugSet === l.slugSet && x.numeroFiche === l.numeroFiche && x.idProduct !== id;
            const sib = voisines.filter(memeFiche);
            const normaux = sib.filter(x => !jumbo.has(x.idProduct)).map(x => x.idProduct);
            if (normaux.length) { confondu = confondu || { idProduct: id, carteId: l.carteId, slugSet: l.slugSet, numeroFiche: l.numeroFiche, par: 'fiche', normaux }; continue; }
            if (sib.length) entreJumbo = true;
            const fichiers = new Set(servies(l).map(e => e.cleR2));
            const memesCartes = autres.filter(c => c._id !== l.carteId && (c.images || []).some(e => e && e.set === l.slugSet && fichiers.has(e.cleR2))).map(c => c._id);
            const nImg = lignesAutres.filter(x => memesCartes.includes(x.carteId) && x.slugSet === l.slugSet && chiffres(x.numeroFiche) === chiffres(l.numeroFiche) && !jumbo.has(x.idProduct)).map(x => x.idProduct);
            if (nImg.length) confondu = confondu || { idProduct: id, carteId: l.carteId, slugSet: l.slugSet, numeroFiche: l.numeroFiche, par: 'image', normaux: nImg };
        }
        if (confondu) r.confondus.push(confondu); else if (entreJumbo) r.entreJumbo++; else r.seuls++;
    }
    return r;
}

module.exports = { RULINGS, AVANT, APRES, DATE_PLANCHE, variantePreuve, listeDesPaires, construirePlan, appliquer, annonceDePlan, diffServis, controleJumbo };
