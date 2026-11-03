'use strict';
// ============================================================
// CLONES — fiches hors composition (agent catalogue, 2026-11-03). Module PUR : aucune base, aucun réseau.
// ============================================================
// La composition d'un set est celle des PRODUITS CARDMARKET de CE set ; une fiche ne vit que dans le set de sa région.
// Un CLONE est une appartenance `cartes.sets` (carte x set publié) sans aucun produit rattaché dans ce set, qu'aucun produit SANS_LIGNE du set ne peut
// revendiquer (ni par le nom, ni par le numéro), et dont la carte a sa vraie fiche ailleurs :
//   • `produit-ailleurs`            : la carte a une ligne cartes_produits dans un AUTRE set publié (de préférence du même tirage) ;
//   • `composition-autre-region`    : la carte n'a AUCUNE impression de ce set, mais une impression de l'expansion du set sous un AUTRE tirage.
// Tout le reste n'est pas un clone et se compte à part : jointures (jointure-a-faire), orphelins, setsSansProduit (on ne vide jamais un set entier).
// 🔑 Les règles du site sont INJECTÉES (`regles`, importées par l'appelant, jamais recopiées) : impressionDuSet, normaliserNumero, expansionsDuSet, tirageDuSet.
//    Le nom Cardmarket se décompose par la fonction de PRODUCTION (jointure.js::decomposerNomCardmarket) et se normalise comme elle (normaliserNom).
//    La règle « produits d'un set » est celle de audit-catalogue/audit-sets.js:76-83 (par idExpansion, à défaut par setId), recopiée sur ordre du brief.
// Hors périmètre : les annexes (« Yellow A »), qui viennent d'une liste fermée du site et non de cartes.sets.
const { decomposerNomCardmarket, normaliserNom } = require('./jointure');
const { compterEtat, comparer, COMPTEURS } = require('./garde-lot');

const MOTIFS = Object.freeze(['produit-ailleurs', 'composition-autre-region']);
const indexer = (xs, cle) => { const m = new Map(); for (const x of xs) { const k = cle(x); if (k === null || k === undefined) continue; (m.get(k) || m.set(k, []).get(k)).push(x); } return m; };
const nul = x => (x === undefined ? null : x);

function classerClones(lecture, regles) {
    const { impressionDuSet, normaliserNumero, expansionsDuSet, tirageDuSet } = regles || {};
    for (const [k, f] of Object.entries({ impressionDuSet, normaliserNumero, expansionsDuSet, tirageDuSet })) if (typeof f !== 'function') throw new Error(`classerClones : règle injectée absente (${k}) — jamais de repli`);
    const sets = lecture.sets || [], cartes = lecture.cartes || [], lignes = lecture.lignes || [], produits = lecture.produits || [];
    if (!sets.length || !cartes.length) throw new Error(`classerClones : population vide (${sets.length} sets, ${cartes.length} cartes) — une détection sur zéro n'est pas une mesure (§41)`);
    if (lignes.length && !lignes.some(l => cartes.some(c => c._id === l.carteId))) throw new Error('classerClones : aucune ligne ne désigne une carte lue — jointure vide sur populations non vides (§41)');
    const publies = sets.filter(s => s.nomAffichage !== null && s.nomAffichage !== undefined && String(s.nomAffichage).trim() !== '');
    const setPublie = new Map(publies.map(s => [s._id, s]));
    const setsParExpansion = indexer(publies.flatMap(s => [].concat(s.idExpansion ?? []).map(e => ({ e, s }))), x => x.e);
    const numProd = new Map((lecture.numerosProduits || []).map(n => [n.idProduct, normaliserNumero(n.numero)]));
    const lignesParCarte = indexer(lignes, l => l.carteId);
    const produitsParFiche = indexer(produits.filter(p => p.fiche && p.fiche.carteId != null), p => `${p.fiche.carteId}|${p.fiche.setId}`);
    // ── produits attribués aux sets publiés (règle d'audit-sets.js:76-83)
    const prodsParSet = new Map(publies.map(s => [s._id, []]));
    for (const p of produits) {
        const cands = (setsParExpansion.get(p.idExpansion) || []).map(x => x.s);
        const s = cands.length ? (cands.find(x => x._id === p.setId) || cands[0]) : (p.setId && setPublie.get(p.setId) ? setPublie.get(p.setId) : null);
        if (s) prodsParSet.get(s._id).push(p);
    }
    const cibleDe = s => ({ tirage: tirageDuSet(s), expansions: expansionsDuSet(s), deck: s.deck ?? null });
    const cartesParSet = indexer(cartes.flatMap(c => [...new Set(c.sets || [])].map(s => ({ s, c }))), x => x.s);

    const clones = [], jointures = [], orphelins = [], setsSansProduit = [];
    let auditees = 0, avecProduit = 0;
    for (const s of publies) {
        const membres = (cartesParSet.get(s._id) || []).map(x => x.c);
        if (!membres.length) continue;
        const prods = prodsParSet.get(s._id);
        if (!prods.length) { setsSansProduit.push({ set: s._id, cartes: membres.length }); continue; }
        const cible = cibleDe(s);
        const sansLigne = prods.filter(p => p.fiche && p.fiche.classe === 'SANS_LIGNE');
        const nomsSansLigne = new Set(sansLigne.map(p => normaliserNom(decomposerNomCardmarket(p.name).nom)));
        const numerosSansLigne = new Set(sansLigne.map(p => numProd.get(p.idProduct)).filter(n => n !== null && n !== undefined));
        for (const c of membres) {
            auditees++;
            const lignesC = lignesParCarte.get(c._id) || [];
            // 1. un produit rattaché dans CE set : jamais un clone
            if (lignesC.some(l => l.slugSet === s._id) || (produitsParFiche.get(`${c._id}|${s._id}`) || []).length) { avecProduit++; continue; }
            // 2. un produit SANS_LIGNE du set peut être le sien : c'est une jointure à faire
            const imps = (c.impressions || []).filter(i => impressionDuSet(i, cible));
            const parNom = typeof c.nomEn === 'string' && c.nomEn !== '' && nomsSansLigne.has(normaliserNom(c.nomEn));
            const parNumero = imps.some(i => { const n = normaliserNumero(i.numero); return n !== null && n !== undefined && numerosSansLigne.has(n); });
            if (parNom || parNumero) { jointures.push({ carteId: c._id, nomEn: nul(c.nomEn), set: s._id, par: parNumero ? 'numero' : 'nom' }); continue; }
            // 3. sa vraie fiche ailleurs
            let motif = null, vraieFiche = null;
            const ailleurs = lignesC.filter(l => l.slugSet && l.slugSet !== s._id && setPublie.has(l.slugSet));
            if (ailleurs.length) {
                const tri = [...ailleurs].sort((a, b) => ((tirageDuSet(setPublie.get(a.slugSet)) === cible.tirage ? 0 : 1) - (tirageDuSet(setPublie.get(b.slugSet)) === cible.tirage ? 0 : 1)) || (a.slugSet < b.slugSet ? -1 : a.slugSet > b.slugSet ? 1 : 0));
                const l = tri[0];
                motif = 'produit-ailleurs'; vraieFiche = { slugSet: l.slugSet, idProduct: nul(l.idProduct), numeroFiche: nul(l.numeroFiche) };
            } else if (!imps.length) {
                const autre = (c.impressions || []).find(i => i.tirage !== cible.tirage && cible.expansions.includes(i.expansion));
                if (autre) {
                    const vs = publies.find(x => x._id !== s._id && tirageDuSet(x) === autre.tirage && expansionsDuSet(x).includes(autre.expansion));
                    motif = 'composition-autre-region'; vraieFiche = vs ? { slugSet: vs._id, idProduct: null, numeroFiche: null } : null;
                }
            }
            if (!motif) { orphelins.push({ carteId: c._id, nomEn: nul(c.nomEn), set: s._id }); continue; }
            // 4. les images du set : copiées vers la vraie fiche du MÊME tirage (une seule entrée), sinon retirées
            const entrees = (c.images || []).filter(i => i.set === s._id);
            const copiable = vraieFiche && setPublie.has(vraieFiche.slugSet) && tirageDuSet(setPublie.get(vraieFiche.slugSet)) === cible.tirage && !(c.images || []).some(i => i.set === vraieFiche.slugSet);
            const images = entrees.map((i, k) => (copiable && k === 0
                ? { cleR2: i.cleR2, numero: nul(i.numero), action: 'copier', vers: { set: vraieFiche.slugSet, numero: vraieFiche.numeroFiche } }
                : { cleR2: i.cleR2, numero: nul(i.numero), action: 'retirer', vers: null }));
            clones.push({ carteId: c._id, nomEn: nul(c.nomEn), set: s._id, tirageSet: cible.tirage, motif, vraieFiche, images });
        }
    }
    const parMotif = {}, parTirage = {}, parSet = {};
    for (const c of clones) {
        parMotif[c.motif] = (parMotif[c.motif] || 0) + 1;
        (parTirage[c.tirageSet] = parTirage[c.tirageSet] || {})[c.motif] = (parTirage[c.tirageSet][c.motif] || 0) + 1;
        parSet[c.set] = (parSet[c.set] || 0) + 1;
    }
    return { denominateurs: { sets: sets.length, setsPublies: publies.length, cartes: cartes.length, lignes: lignes.length, produits: produits.length, appartenancesAuditees: auditees, avecProduitDansLeSet: avecProduit },
        clones, jointures, orphelins, setsSansProduit, parMotif, parTirage, parSet };
}

const cleImage = i => `${i.cleR2 ?? ''}|${nul(i.numero)}`;

/** Applique UN clone à un document carte COMPLET : pure (ne modifie pas `doc`). @returns {{doc, retirees: object[], copiees: object[]}} */
function appliquer(doc, clone) {
    const retirees = (doc.images || []).filter(i => i && i.set === clone.set);
    const copiees = [];
    for (const a of clone.images || []) {
        if (a.action !== 'copier') continue;
        const e = retirees.find(i => cleImage(i) === cleImage(a));
        if (!e) throw new Error(`appliquer : l'entrée ${cleImage(a)} du set ${clone.set} n'existe plus sur la carte ${clone.carteId}`);
        copiees.push({ ...structuredClone(e), set: a.vers.set, numero: a.vers.numero });
    }
    return { doc: { ...doc, sets: (doc.sets || []).filter(s => s !== clone.set), images: [...(doc.images || []).filter(i => !(i && i.set === clone.set)), ...copiees] }, retirees, copiees };
}

/** Les conditions de la décision, rejouées sur l'état VIVANT. Une seule qui change = refus (liste d'erreurs non vide). docs : Map carteId -> document complet ; lignes : cartes_produits vivantes des cartes de la décision. */
function verifierEtat({ clones, docs, lignes, attendu, attenduImages }) {
    const err = [];
    if (clones.length !== attendu) err.push(`nombre de clones ${clones.length} ≠ attendu ${attendu}`);
    let retirees = 0;
    for (const c of clones) {
        const q = `${c.carteId} @ ${c.set}`;
        const d = docs.get(c.carteId);
        if (!d) { err.push(`${q} : carte introuvable`); continue; }
        if (!(d.sets || []).includes(c.set)) err.push(`${q} : la carte n'a plus ce set dans sets`);
        if (lignes.some(l => l.carteId === c.carteId && l.slugSet === c.set)) err.push(`${q} : une ligne cartes_produits existe désormais dans ce set`);
        if (c.motif === 'produit-ailleurs' && !lignes.some(l => l.carteId === c.carteId && l.slugSet === c.vraieFiche?.slugSet)) err.push(`${q} : la ligne de la vraie fiche (${c.vraieFiche?.slugSet}) n'existe plus`);
        const vives = (d.images || []).filter(i => i && i.set === c.set);
        retirees += vives.length;
        if (vives.length !== c.images.length) err.push(`${q} : ${vives.length} entrées d'images vives, ${c.images.length} décidées`);
        for (const a of c.images) {
            if (!vives.some(i => cleImage(i) === cleImage(a))) err.push(`${q} : l'entrée d'image ${cleImage(a)} a changé`);
            if (a.action === 'copier' && (d.images || []).some(i => i && i.set === a.vers.set)) err.push(`${q} : la carte a désormais une entrée d'image pour ${a.vers.set}`);
        }
    }
    if (retirees !== attenduImages) err.push(`entrées d'images retirées ${retirees} ≠ attendu ${attenduImages}`);
    return err;
}

/** L'annonce pour lot-additif.js --annonce= : fabriquée par la FONCTION DE LA GARDE (compterEtat/comparer) sur les documents avant et après, puis rejouée avec cette annonce. */
function annoncer(docs, clones) {
    const avantDocs = [], apresDocs = [];
    const parCarte = indexer(clones, c => c.carteId);
    for (const [id, cs] of parCarte) {
        const d = docs.get(id);
        if (!d) throw new Error(`annoncer : carte ${id} absente des documents lus`);
        avantDocs.push(d);
        apresDocs.push(cs.reduce((x, c) => appliquer(x, c).doc, d));
    }
    const avant = compterEtat({ cartes: avantDocs }), apres = compterEtat({ cartes: apresDocs });
    const annonce = {};
    for (const b of comparer(avant, apres, {}).baisses) if (b.compteur in COMPTEURS) annonce[b.cle] = b.baisse;
    const verdict = comparer(avant, apres, { annonces: annonce });
    return { annonce, nonAutorisees: verdict.nonAutorisees, annoncesNonRealisees: verdict.annoncesNonRealisees };
}

module.exports = { classerClones, appliquer, verifierEtat, annoncer, MOTIFS };
