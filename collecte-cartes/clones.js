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
const { decomposerNomCardmarket, nomJointDe, clesNom } = require('./jointure');
const { aliasDe } = require('./alias-noms');
const clesCarte = c => clesNom(nomJointDe(c));
const { compterEtat, comparer, COMPTEURS } = require('./garde-lot');

const MOTIFS = Object.freeze(['produit-ailleurs', 'composition-autre-region']);
const indexer = (xs, cle) => { const m = new Map(); for (const x of xs) { const k = cle(x); if (k === null || k === undefined) continue; (m.get(k) || m.set(k, []).get(k)).push(x); } return m; };
// mots d'un nom : minuscules, accents et ponctuation retirés (garde d'inclusion)
const motsDe = n => String(n || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
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
    // cartes « affichables » (nomEn non vide), comme audit-sets.js:67
    const affichables = cartes.filter(c => typeof c.nomEn === 'string' && c.nomEn !== '');
    const cartesParSet = indexer(affichables.flatMap(c => [...new Set(c.sets || [])].map(s => ({ s, c }))), x => x.s);

    const candidats = [], jointures = [], orphelins = [], setsSansProduit = [];
    let auditees = 0, avecProduit = 0;
    for (const s of publies) {
        const membres = (cartesParSet.get(s._id) || []).map(x => x.c);
        if (!membres.length) continue;
        const prods = prodsParSet.get(s._id);
        if (!prods.length) { setsSansProduit.push({ set: s._id, cartes: membres.length }); continue; }
        const cible = cibleDe(s);
        const sansLigne = prods.filter(p => p.fiche && p.fiche.classe === 'SANS_LIGNE');
        const clesSansLigne = new Set(sansLigne.flatMap(p => { const nom = decomposerNomCardmarket(p.name).nom, alias = aliasDe(nom, p.idExpansion); return [...clesNom(nom), ...(alias ? clesNom(alias) : [])]; }));
        const motsSansLigne = sansLigne.map(p => { const nom = decomposerNomCardmarket(p.name).nom, alias = aliasDe(nom, p.idExpansion); return new Set([...motsDe(nom), ...(alias ? motsDe(alias) : [])]); });
        const numerosSansLigne = new Set(sansLigne.map(p => numProd.get(p.idProduct)).filter(n => n !== null && n !== undefined));
        for (const c of membres) {
            auditees++;
            const lignesC = lignesParCarte.get(c._id) || [];
            // 1. un produit rattaché dans CE set : jamais un clone
            if (lignesC.some(l => l.slugSet === s._id) || (produitsParFiche.get(`${c._id}|${s._id}`) || []).length) { avecProduit++; continue; }
            // 2. un produit SANS_LIGNE du set peut être le sien : c'est une jointure à faire
            const imps = (c.impressions || []).filter(i => impressionDuSet(i, cible));
            // la clé de la PRODUCTION : clesNom(nomJointDe(carte)) (« Basic » retiré) contre clesNom(nom décomposé) ∪ clesNom(alias de l'expansion) — jointure.js:211-220
            const parNom = clesCarte(c).some(k => clesSansLigne.has(k));
            const parNumero = imps.some(i => { const n = normaliserNumero(i.numero); return n !== null && n !== undefined && numerosSansLigne.has(n); });
            // GARDE D'INCLUSION (jamais une clé d'appariement) : tous les mots du nomEn figurent dans ceux du nom décomposé d'UN produit SANS_LIGNE du set
            // (« Shellos » ⊂ « Shellos West Sea Lv.25 ») : ce produit est probablement le sien, on REFUSE de supprimer.
            // DANS LES DEUX SENS : le nom de la carte dans celui du produit, ou celui du produit dans celui de la carte (« Water Energy » ⊂ « Basic Water Energy »)
            const mots = motsDe(nomJointDe(c));
            const parInclusion = !parNom && !parNumero && mots.length > 0 && motsSansLigne.some(m => m.size > 0 && (mots.every(w => m.has(w)) || [...m].every(w => mots.includes(w))));
            if (parNom || parNumero || parInclusion) { jointures.push({ carteId: c._id, nomEn: nul(c.nomEn), set: s._id, par: parNumero ? 'numero' : parNom ? 'nom' : 'nom-inclus' }); continue; }
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
            // 4. les images du set : RETIRÉES, JAMAIS copiées (une réimpression tamponnée n'a jamais le scan du tirage normal — aucun visuel emprunté à un autre tirage)
            const images = (c.images || []).filter(i => i.set === s._id).map(i => ({ cleR2: i.cleR2, numero: nul(i.numero), action: 'retirer', vers: null }));
            candidats.push({ carteId: c._id, nomEn: nul(c.nomEn), set: s._id, tirageSet: cible.tirage, motif, vraieFiche, images, setsCarte: [...new Set(c.sets || [])] });
        }
    }
    // ── n'est SUPPRIMABLE qu'un `produit-ailleurs` dont la vraie fiche est dans cartes.sets de la carte, et qui laisse ≥ 1 set après le retrait de TOUS ses clones.
    //    Le reste (composition-autre-region : document sans aucun set) est listé « à instruire », jamais retiré.
    const retraits = new Map();
    for (const k of candidats) (retraits.get(k.carteId) || retraits.set(k.carteId, new Set()).get(k.carteId)).add(k.set);
    const clones = [], aInstruire = [];
    for (const { setsCarte, ...k } of candidats) {
        let raison = null;
        if (k.motif !== 'produit-ailleurs') raison = k.motif;
        else if (!setsCarte.includes(k.vraieFiche.slugSet)) raison = 'vraie-fiche-hors-sets';
        else if (!setsCarte.some(x => !retraits.get(k.carteId).has(x))) raison = 'aucun-set-restant';
        if (raison) aInstruire.push({ carteId: k.carteId, nomEn: k.nomEn, set: k.set, tirageSet: k.tirageSet, motif: k.motif, raison, vraieFiche: k.vraieFiche, images: k.images.length });
        else clones.push(k);
    }
    const parMotif = {}, parTirage = {}, parSet = {};
    for (const c of clones) {
        parMotif[c.motif] = (parMotif[c.motif] || 0) + 1;
        (parTirage[c.tirageSet] = parTirage[c.tirageSet] || {})[c.motif] = (parTirage[c.tirageSet][c.motif] || 0) + 1;
        parSet[c.set] = (parSet[c.set] || 0) + 1;
    }
    return { denominateurs: { sets: sets.length, setsPublies: publies.length, cartes: cartes.length, cartesAffichables: affichables.length, lignes: lignes.length, produits: produits.length, appartenancesAuditees: auditees, avecProduitDansLeSet: avecProduit },
        clones, aInstruire, jointures, orphelins, setsSansProduit, parMotif, parTirage, parSet };
}

const cleImage = i => `${i.cleR2 ?? ''}|${nul(i.numero)}`;

/** Applique UN clone à un document carte COMPLET : pure (ne modifie pas `doc`). AUCUNE copie d'image, jamais. @returns {{doc, retirees: object[]}} */
function appliquer(doc, clone) {
    const retirees = (doc.images || []).filter(i => i && i.set === clone.set);
    return { doc: { ...doc, sets: (doc.sets || []).filter(s => s !== clone.set), images: (doc.images || []).filter(i => !(i && i.set === clone.set)) }, retirees };
}

/** Les conditions de la décision, rejouées sur l'état VIVANT. Une seule qui change = refus (liste d'erreurs non vide). docs : Map carteId -> document complet ; lignes : cartes_produits vivantes des cartes de la décision. */
function verifierEtat({ clones, docs, lignes, attendu, attenduImages }) {
    const err = [];
    if (clones.length !== attendu) err.push(`nombre de clones ${clones.length} ≠ attendu ${attendu}`);
    let retirees = 0;
    const vus = new Set(), retraits = new Map();
    for (const c of clones) (retraits.get(c.carteId) || retraits.set(c.carteId, new Set()).get(c.carteId)).add(c.set);
    for (const c of clones) {
        const q = `${c.carteId} @ ${c.set}`;
        if (vus.has(q)) err.push(`${q} : doublon (carte, set) dans la décision`);
        vus.add(q);
        if (c.motif !== 'produit-ailleurs') err.push(`${q} : motif « ${c.motif} » non supprimable`);
        const d = docs.get(c.carteId);
        if (!d) { err.push(`${q} : carte introuvable`); continue; }
        if (!(d.sets || []).includes(c.set)) err.push(`${q} : la carte n'a plus ce set dans sets`);
        if (c.vraieFiche && !(d.sets || []).includes(c.vraieFiche.slugSet)) err.push(`${q} : la vraie fiche (${c.vraieFiche.slugSet}) n'est pas dans les sets vivants de la carte`);
        if (!(d.sets || []).some(x => !retraits.get(c.carteId).has(x))) err.push(`${q} : la carte n'aurait plus aucun set après le retrait`);
        if (lignes.some(l => l.carteId === c.carteId && l.slugSet === c.set)) err.push(`${q} : une ligne cartes_produits existe désormais dans ce set`);
        if (c.motif === 'produit-ailleurs' && !lignes.some(l => l.carteId === c.carteId && l.slugSet === c.vraieFiche?.slugSet)) err.push(`${q} : la ligne de la vraie fiche (${c.vraieFiche?.slugSet}) n'existe plus`);
        const vives = (d.images || []).filter(i => i && i.set === c.set);
        retirees += vives.length;
        if (vives.length !== c.images.length) err.push(`${q} : ${vives.length} entrées d'images vives, ${c.images.length} décidées`);
        for (const a of c.images) {
            if (!vives.some(i => cleImage(i) === cleImage(a))) err.push(`${q} : l'entrée d'image ${cleImage(a)} a changé`);
            if (a.action !== 'retirer') err.push(`${q} : action d'image « ${a.action} » non autorisée (aucune copie, jamais)`);
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

/** Une décision plus vieille que `maxHeures` (ou sans date lisible, ou datée du futur) est périmée : renvoie la raison, sinon null. `lectureDu` = date de la lecture (cache) qui a produit la décision. */
function decisionPerimee(lectureDu, maintenant = Date.now(), maxHeures = 24) {
    const t = Date.parse(lectureDu);
    if (!lectureDu || Number.isNaN(t)) return `lectureDu absent ou illisible (${JSON.stringify(lectureDu ?? null)})`;
    const h = (maintenant - t) / 3600000;
    if (h < 0) return `lectureDu est dans le futur (${lectureDu})`;
    if (h > maxHeures) return `la décision a été faite sur une lecture de ${Math.round(h)} h (> ${maxHeures} h) : relancer audit-sets.js puis detecter-clones.js`;
    return null;
}

/** Les opérations d'écriture en DEUX lots ordonnés : les $pull de sets, puis les $pull d'images ; plus le journal des anciennes valeurs. Aucune copie. Pure. */
function planEcriture(docs, clones) {
    const pullSets = [], pullImages = [], journal = [];
    for (const c of clones) {
        const d = docs.get(c.carteId), r = appliquer(d, c);
        journal.push({ carteId: c.carteId, set: c.set, setsAvant: d.sets, imagesRetirees: r.retirees });
        pullSets.push({ updateOne: { filter: { _id: c.carteId, sets: c.set }, update: { $pull: { sets: c.set } } } });
        if (r.retirees.length) pullImages.push({ updateOne: { filter: { _id: c.carteId }, update: { $pull: { images: { set: c.set } } } } });
    }
    return { pullSets, pullImages, journal };
}

module.exports = { classerClones, appliquer, verifierEtat, annoncer, decisionPerimee, planEcriture, MOTIFS };
