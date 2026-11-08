'use strict';
// ============================================================
// AUDIT AUTOMATIQUE PAR SET — module PUR (aucune base, aucun réseau) — agent catalogue, 2026-11-03
// ============================================================
// Ce que le testeur faisait à l'œil, set par set : nombre de cartes attendu / affiché, fiches sans visuel, fiches sans numéro, fiches sans produit
// Cardmarket (jumelles orphelines), doublons de faits, produits Cardmarket sans fiche, numéros manquants dans la suite — et, pour CHAQUE trou, sa cause.
// 🔑 Règles du site INJECTÉES (`regles`, importées par l'appelant, jamais réécrites ici) : impressionDuSet, normaliserNumero, expansionsDuSet, tirageDuSet, editionLocaleDuSet,
// imageDeLImpression, visuelAdmisPourLaRegion, annexeDuSet (facultative) ; plus memeCodeSaufFin et la table « pas un trou » (trous-outils, hors dépôt).
// Les classes de fiche et de visuel des produits viennent de compteurs-abc.js::mesurer.
// ⚠️ Ce qui est RÉÉCRIT ici, faute d'export du site (les sets « jumeaux » et la suite 1..N viennent de mesure-trous.js, pas du site) : le groupement des doublons de faits
// (nom + PV + attaques + numéro de base) et le total ramené de moitié pour les jumeaux ; les fiches « affichées » sont une approximation (carte, numéro normalisé) de
// calculerEntreesDuSet, qui est asynchrone et lit la base — non importable sur une lecture en mémoire.
// 🔑 Les causes sont une liste FERMÉE (CAUSES) : une cause hors liste LÈVE ; « cause-inconnue » est la seule réponse quand rien ne désigne la cause (jamais un silence).
// Entrée `lecture` (objets simples, JSON-compatibles) :
//   sets[{_id,code,nomAffichage,tirage,region,totalImprime,idExpansion[],bulbaExpansion,deck,type}], cartes[{_id,nomEn,pv,attaques[],sets[],impressions[{tirage,expansion,deck,numero,total}],images[{set,numero}]}],
//   lignes[{carteId,idProduct,slugSet,numeroFiche}], produits[{idProduct,idExpansion,name,setId,fiche{classe,motifs,carteId,numero,setId},visuel{classe,motifs}}],
//   numerosProduits[{idProduct,numero}], offresParExpansion{idExpansion:n}, trousNommes{idProduct:motif}, restesParSet{set:{type:n}}

const { numerosAttendus } = require('./numeros-attendus');
const { SANS_NUMERO_IMPRIME, familleSansNumero } = require('./sans-numero-imprime');
const { cleNumero } = require('../collecte-cartes/jointure');   // LA clé de numéro de la production (préfixe et suffixe gardés, zéros retirés) — jamais une copie
const TYPES = Object.freeze(['sansVisuel', 'sansNumero', 'sansProduit', 'doublons', 'produitsSansFiche', 'manquants']);
const CAUSES = Object.freeze({
    sansVisuel: ['regle-bloquante', 'aucune-image-en-base', 'image-d-un-autre-set-seulement', 'image-refusee-par-la-garde-de-langue', 'image-d-un-autre-numero', 'cause-inconnue'],
    sansNumero: ['impression-sans-numero', 'set-sans-expansion-bulbapedia', 'expansion-declaree-sans-impression', 'cause-inconnue'],
    sansProduit: ['expansion-sans-produit-cardmarket', 'produit-sans-ligne-meme-numero', 'jumelle-suffixe-sans-produit', 'produits-sans-ligne-dans-l-expansion', 'tous-les-produits-deja-rattaches', 'cause-inconnue'],
    doublons: ['doublon-suffixe-lettre', 'doublon-deux-documents', 'doublon-numeros-distincts', 'cause-inconnue'],
    produitsSansFiche: ['sans-ligne', 'ligne-sans-fiche', 'reste', 'cause-inconnue'],
    manquants: ['produit-cardmarket-existe-sans-fiche', 'reste', 'aucune-source-en-base', 'aucune-impression-numerotee', 'cause-inconnue'],
});
// 🔑 EXCLUS DU COMPTE DES TROUS (testeur, 2026-11-08 : « le compte des trous doit dire la vérité »). Liste FERMÉE, par type de trou. Une entrée exclue ne disparaît JAMAIS de la sortie :
// elle est comptée par cause et par set (`exclusParCause` du set, `audit.exclus`, `totaux.exclus`, section du Markdown, écart) — un contrôle qui s'améliore en rétrécissant son périmètre l'imprime.
//  · sansNumero/numero-non-imprime:<famille> : la carte n'imprime aucun numéro de collection ; le set est dans la table fermée SANS_NUMERO_IMPRIME (preuve sur scans), et seule une entrée
//    « impression-sans-numero » y entre (jamais « expansion-declaree-sans-impression »).
//  · sansProduit/impression-hors-additionals : set Additionals (règle du SITE `estAdditionals`, injectée) dont l'expansion n'a AUCUN produit à ce numéro (cleNumero de la production) : l'impression
//    est celle du set de base, pas un produit manquant. Un produit de l'expansion sans numéro lisible empêche l'exclusion des entrées qui portent son nom (on ne sait pas à quel numéro il est).
const EXCLUSIONS = Object.freeze({
    sansNumero: ['numero-non-imprime'],
    sansProduit: ['impression-hors-additionals'],
});
function verifierExclusion(type, cause) {
    const base = String(cause).split(':')[0];
    if (!EXCLUSIONS[type] || !EXCLUSIONS[type].includes(base)) throw new Error(`exclusion « ${cause} » hors de la liste fermée de ${type} (${(EXCLUSIONS[type] || []).join(', ')})`);
    return cause;
}
const TITRES = Object.freeze({ sansVisuel: 'sans visuel', sansNumero: 'sans numéro', sansProduit: 'sans produit CM', doublons: 'doublons', produitsSansFiche: 'produits CM sans fiche', manquants: 'numéros manquants' });

/** Une cause porte un préfixe de la liste fermée, suivi éventuellement de « :détail ». Hors liste : LÈVE. */
function verifierCause(type, cause) {
    const base = String(cause).split(':')[0];
    if (!CAUSES[type] || !CAUSES[type].includes(base)) throw new Error(`cause « ${cause} » hors de la liste fermée de ${type} (${(CAUSES[type] || []).join(', ')})`);
    return cause;
}

const nonVide = x => x !== null && x !== undefined && String(x).trim() !== '';
const score = (trous, offres) => trous * Math.log2(2 + (offres || 0));
/** Tri : score décroissant, puis identifiant. Lit `trous` et `offres` de chaque ligne. */
const trier = lignes => lignes.map(l => ({ ...l, score: score(l.trous, l.offres) })).sort((a, b) => (b.score - a.score) || (a.set < b.set ? -1 : a.set > b.set ? 1 : 0));

const indexer = (xs, cle) => { const m = new Map(); for (const x of xs) { const k = cle(x); if (k === null || k === undefined) continue; (m.get(k) || m.set(k, []).get(k)).push(x); } return m; };
const baseNumero = n => { const m = /(\d+)/.exec(String(n ?? '')); return m ? String(Number(m[1])) : String(n ?? ''); };
const suffixeLettre = n => /\d[a-z]+$/i.test(String(n ?? ''));

function auditer(lecture, regles) {
    const { impressionDuSet, normaliserNumero, memeCodeSaufFin, exclure, expansionsDuSet, tirageDuSet, editionLocaleDuSet, imageDeLImpression, visuelAdmisPourLaRegion, annexeDuSet = null, estAdditionals = null, sansNumeroImprime = SANS_NUMERO_IMPRIME } = regles || {};   // annexeDuSet (lib/annexes.ts) et estAdditionals (lib/additionals.ts) : facultatifs, règles du site ; sans eux, aucune exclusion de ce genre
    for (const [k, f] of Object.entries({ impressionDuSet, normaliserNumero, memeCodeSaufFin, exclure, expansionsDuSet, tirageDuSet, editionLocaleDuSet, imageDeLImpression, visuelAdmisPourLaRegion })) if (typeof f !== 'function') throw new Error(`auditer : règle injectée absente (${k}) — jamais de repli`);
    const sets = lecture.sets || [], cartes = lecture.cartes || [], lignes = lecture.lignes || [], produits = lecture.produits || [];
    if (!sets.length) throw new Error('auditer : population vide (0 set) — un audit sur zéro set n\'est pas une mesure (§41)');
    if (lignes.length && !cartes.length) throw new Error('auditer : lecture des cartes vide alors que des lignes cartes_produits existent — clé ou lecture fausse (§41)');
    if (lignes.length && cartes.length) {
        const ids = new Set(cartes.map(c => c._id));
        if (!lignes.some(l => ids.has(l.carteId))) throw new Error(`auditer : aucune des ${lignes.length} lignes ne désigne une des ${cartes.length} cartes lues — jointure vide sur populations non vides (§41)`);
    }
    const publies = sets.filter(s => nonVide(s.nomAffichage));
    const offresDe = lecture.offresParExpansion || {};
    const trousNommes = lecture.trousNommes || {}, restesParProduit = lecture.restesParProduit || {};   // restes NON résolus, un type par idProduct
    const numProd = new Map((lecture.numerosProduits || []).map(n => [n.idProduct, normaliserNumero(n.numero)]));
    const produitDe = new Map(produits.map(p => [p.idProduct, p]));
    const lignesParCarte = indexer(lignes, l => l.carteId);
    const produitsParFiche = indexer(produits.filter(p => p.fiche && p.fiche.carteId != null), p => `${p.fiche.carteId}|${p.fiche.setId}`);
    const setsParExpansion = indexer(publies.flatMap(s => [].concat(s.idExpansion ?? []).map(e => ({ e, s }))), x => x.e);
    const setPublie = new Map(publies.map(s => [s._id, s]));
    const expansionsDe = s => expansionsDuSet(s);          // règle du site (lib/entreesDuSet.ts), injectée
    const cibleDe = s => ({ tirage: tirageDuSet(s), expansions: expansionsDe(s), deck: s.deck ?? null });
    const affichables = cartes.filter(c => typeof c.nomEn === 'string' && c.nomEn !== '');
    const docsParSet = indexer(affichables.flatMap(c => [...new Set(c.sets || [])].map(s => ({ s, c }))), x => x.s);

    // ── jumeaux (règle de mesure-trous : même tirage + même total, expansions Bulbapedia différentes, codes identiques sauf la fin)
    const groupesTotal = indexer(sets.filter(s => Number(s.totalImprime) > 0), s => `${tirageDuSet(s)}|${Number(s.totalImprime)}`);
    const exp1 = s => JSON.stringify(expansionsDe(s));
    const jumeaux = new Set();
    for (const g of groupesTotal.values()) for (const a of g) if (g.some(b => b !== a && exp1(b) !== exp1(a) && memeCodeSaufFin(a.code, b.code))) jumeaux.add(a._id);

    // ── produits attribués aux sets publiés (par expansion ; à défaut par le set du produit)
    const prodsParSet = new Map(publies.map(s => [s._id, []]));
    let produitsSansSetPublie = 0;
    for (const p of produits) {
        const cands = (setsParExpansion.get(p.idExpansion) || []).map(x => x.s);
        const s = cands.length ? (cands.find(x => x._id === p.setId) || cands[0]) : (p.setId && setPublie.get(p.setId) ? setPublie.get(p.setId) : null);
        if (s) prodsParSet.get(s._id).push(p); else produitsSansSetPublie++;
    }

    const resultats = [];
    for (const s of publies) {
        const cible = cibleDe(s);
        const docs = (docsParSet.get(s._id) || []).map(x => x.c);
        const prods = prodsParSet.get(s._id);
        // ── les entrées affichées : (carte, numéro normalisé) ; une carte sans impression numérotée du set = une entrée sans numéro
        const entrees = [];
        const denoms = {};
        for (const c of docs) {
            const imps = (c.impressions || []).filter(i => impressionDuSet(i, cible));
            // les ANNEXES (« Yellow A », 101a) : le site les affiche dans le set de leur carte parente (lib/annexes.ts) ; sans cette règle injectée, elles sont ignorées
            const annexes = annexeDuSet ? (c.impressions || []).filter(i => !impressionDuSet(i, cible) && annexeDuSet(i, c._id, cible)) : [];
            for (const i of imps) if (nonVide(i.total)) { const t = Number(String(i.total).replace(/\D/g, '')); if (t) denoms[t] = (denoms[t] || 0) + 1; }
            const nums = [...new Set(imps.concat(annexes).map(i => normaliserNumero(i.numero)).filter(n => n !== null))];
            if (nums.length) for (const n of nums) entrees.push({ c, numero: n, nEntreesCarte: nums.length });
            else entrees.push({ c, numero: null, nEntreesCarte: 1, causeSansNumero: imps.length ? 'impression-sans-numero' : (cible.expansions.length ? 'expansion-declaree-sans-impression' : 'set-sans-expansion-bulbapedia') });
        }
        const nums = new Set(entrees.filter(e => e.numero !== null).map(e => e.numero));
        const sansVisuel = [], sansNumero = [], sansProduit = [];
        const exclusParCause = {};   // { 'type/cause': [{carteId, nom, numero}] } — sortis du compte, JAMAIS de la sortie
        const exclure1 = (type, cause, c, numero) => { const k = `${type}/${verifierExclusion(type, cause)}`; (exclusParCause[k] = exclusParCause[k] || []).push({ carteId: c._id, nom: c.nomEn, numero }); };
        const familleNumero = familleSansNumero(s._id, sansNumeroImprime);
        const numerosDeLExpansion = estAdditionals && estAdditionals(s._id) ? new Set(prods.map(p => numProd.get(p.idProduct)).filter(n => n != null && n !== '').map(cleNumero)) : null;
        // un produit de l'expansion SANS numéro lisible ne dit pas à quel numéro il est : il bloque l'exclusion des seules entrées qui portent SON nom (Air Balloon sans numéro ne protège pas Tynamo)
        const nomBase = n => String(n ?? '').replace(/\s*\[.*$/, '').trim().toLowerCase();
        const nomsSansNumero = numerosDeLExpansion ? new Set(prods.filter(p => !nonVide(numProd.get(p.idProduct))).map(p => nomBase(p.name))) : null;
        for (const e of entrees) {
            const { c } = e;
            const memeNumero = x => x == null ? (e.nEntreesCarte === 1 || e.numero === null) : (e.numero === null || normaliserNumero(x) === e.numero);
            const liés = new Set();
            for (const p of produitsParFiche.get(`${c._id}|${s._id}`) || []) if (memeNumero(p.fiche.numero)) liés.add(p.idProduct);
            for (const l of lignesParCarte.get(c._id) || []) if (l.slugSet === s._id && memeNumero(l.numeroFiche)) liés.add(l.idProduct);
            const ps = [...liés].map(id => produitDe.get(id)).filter(Boolean);
            const imgsSet = (c.images || []).filter(i => i.set === s._id);
            // « image présente » = celle que le site choisirait : garde de langue du tirage du set PUIS image de l'impression (règles du site injectées)
            const admises = imgsSet.filter(m => visuelAdmisPourLaRegion(m, cible.tirage, editionLocaleDuSet(s)));
            const aImage = !!imageDeLImpression(admises, e.numero);
            const bloque = ps.length > 0 && ps.every(p => p.visuel && p.visuel.classe === 'MANQUANT');
            if (!aImage || bloque) {
                let cause;
                if (bloque) {
                    const motif = ps.map(p => (p.visuel.motifs || []).filter(m => m !== 'basse-definition')[0]).find(Boolean);
                    cause = motif ? `regle-bloquante:${motif}` : 'cause-inconnue';
                } else if (!(c.images || []).length) cause = 'aucune-image-en-base';
                else if (!imgsSet.length) cause = 'image-d-un-autre-set-seulement';
                else if (!admises.length) cause = 'image-refusee-par-la-garde-de-langue';
                else cause = 'image-d-un-autre-numero';
                sansVisuel.push({ carteId: c._id, nom: c.nomEn, numero: e.numero, cause: verifierCause('sansVisuel', cause) });
            }
            if (e.numero === null) {
                if (familleNumero && e.causeSansNumero === 'impression-sans-numero') exclure1('sansNumero', `numero-non-imprime:${familleNumero}`, c, null);
                else sansNumero.push({ carteId: c._id, nom: c.nomEn, numero: null, cause: verifierCause('sansNumero', e.causeSansNumero) });
            }
            if (!liés.size) {
                let cause;
                const sansLigne = prods.filter(p => p.fiche && p.fiche.classe === 'SANS_LIGNE');
                const baseOk = entrees.some(x => x !== e && x.numero !== null && e.numero !== null && baseNumero(x.numero) === baseNumero(e.numero) && !suffixeLettre(x.numero) && x.c.nomEn === c.nomEn &&
                    ((produitsParFiche.get(`${x.c._id}|${s._id}`) || []).length || (lignesParCarte.get(x.c._id) || []).some(l => l.slugSet === s._id)));
                if (!prods.length) cause = 'expansion-sans-produit-cardmarket';
                else if (e.numero !== null && sansLigne.some(p => numProd.get(p.idProduct) === e.numero)) cause = 'produit-sans-ligne-meme-numero';
                else if (e.numero !== null && suffixeLettre(e.numero) && baseOk) cause = 'jumelle-suffixe-sans-produit';
                else if (numerosDeLExpansion && e.numero !== null && !numerosDeLExpansion.has(cleNumero(e.numero)) && !nomsSansNumero.has(nomBase(c.nomEn))) cause = 'impression-hors-additionals';
                else if (sansLigne.length) cause = 'produits-sans-ligne-dans-l-expansion';
                else cause = 'tous-les-produits-deja-rattaches';
                if (cause === 'impression-hors-additionals') exclure1('sansProduit', cause, c, e.numero);
                else sansProduit.push({ carteId: c._id, nom: c.nomEn, numero: e.numero, cause: verifierCause('sansProduit', cause) });
            }
        }
        // ── doublons de faits : même nom + PV + attaques + numéro de base, dans le set
        const parFaits = indexer(entrees.filter(e => e.numero !== null), e => JSON.stringify([e.c.nomEn, e.c.pv ?? null, (e.c.attaques || []).join('|'), baseNumero(e.numero)]));
        const groupes = [];
        for (const g of parFaits.values()) {
            if (g.length < 2) continue;
            const numeros = new Set(g.map(e => e.numero)), cartesIds = new Set(g.map(e => e.c._id));
            let cause;
            if (numeros.size === 1 && cartesIds.size > 1) cause = 'doublon-deux-documents';
            else if (g.some(e => suffixeLettre(e.numero)) || numeros.size > 1) cause = g.some(e => suffixeLettre(e.numero)) ? 'doublon-suffixe-lettre' : 'doublon-numeros-distincts';
            else cause = 'cause-inconnue';
            groupes.push({ nom: g[0].c.nomEn, base: baseNumero(g[0].numero), cause: verifierCause('doublons', cause), membres: g.map(e => ({ carteId: e.c._id, numero: e.numero })) });
        }
        const doublonsN = groupes.reduce((a, g) => a + g.membres.length - 1, 0);
        // ── produits Cardmarket sans fiche
        const produitsSansFiche = [];
        for (const p of prods) {
            const cl = p.fiche && p.fiche.classe;
            if (cl !== 'SANS_LIGNE' && cl !== 'LIGNE_SANS_FICHE') continue;
            let cause;
            const reste = restesParProduit[p.idProduct];
            if (cl === 'SANS_LIGNE') cause = trousNommes[p.idProduct] ? `sans-ligne:${trousNommes[p.idProduct]}` : (reste ? `reste:${reste}` : 'cause-inconnue');
            else cause = (p.fiche.motifs || [])[0] ? `ligne-sans-fiche:${p.fiche.motifs[0]}` : (reste ? `reste:${reste}` : 'cause-inconnue');
            produitsSansFiche.push({ idProduct: p.idProduct, nom: p.name, classe: cl, cause: verifierCause('produitsSansFiche', cause) });
        }
        // ── attendu et numéros manquants (suite 1..attendu) — logique de mesure-trous, règles injectées
        const total = nonVide(s.totalImprime) && !isNaN(Number(s.totalImprime)) && Number(s.totalImprime) > 0 ? Number(s.totalImprime) : null;
        const parNumeros = nums.size > 0;
        const portes = parNumeros ? nums.size : docs.length;
        const modal = Object.entries(denoms).sort((a, b) => b[1] - a[1])[0];
        const denominateurModal = modal ? Number(modal[0]) : null;
        let attendu = total;
        if (total && portes < total && jumeaux.has(s._id)) {
            if (total % 2 === 0 && (denominateurModal === null || denominateurModal <= total / 2)) attendu = total / 2; else attendu = null;
        }
        const manquants = []; let exclusPasUnTrou = [];
        // le total imprimé compte les sous-séries à numéro préfixé (TG, GG, SV, H, RC…) : règle pure numeros-attendus.js, les préfixés présents ne sont jamais « manquants »
        const attenduDetail = numerosAttendus({ totalImprime: attendu, numerosPresents: nums });
        if (attendu && parNumeros) {
            const liste = attenduDetail.manquants;
            const ex = exclure({ set: s._id, trous: liste, manque: liste.length });
            exclusPasUnTrou = ex.exclus;
            const numerosProdSansFiche = new Set(produitsSansFiche.map(p => numProd.get(p.idProduct)).filter(Boolean));
            // un reste ne se nomme que s'il désigne CE numéro (le produit du reste porte ce numéro) — jamais le type dominant du set
            const resteDuNumero = n => { const p = prods.find(x => restesParProduit[x.idProduct] && numProd.get(x.idProduct) === n); return p ? restesParProduit[p.idProduct] : null; };
            for (const n of ex.trous) {
                const r = resteDuNumero(n);
                const cause = r ? `reste:${r}` : numerosProdSansFiche.has(n) ? 'produit-cardmarket-existe-sans-fiche' : 'aucune-source-en-base';
                manquants.push({ numero: n, nombre: 1, cause: verifierCause('manquants', cause) });
            }
        } else if (attendu && !parNumeros && attendu > portes) {
            manquants.push({ numero: null, nombre: attendu - portes, cause: verifierCause('manquants', 'aucune-impression-numerotee') });
        }
        const manquantsN = manquants.reduce((a, m) => a + m.nombre, 0);
        const offres = [].concat(s.idExpansion ?? []).reduce((a, e) => a + (offresDe[e] || 0), 0);
        const entree = { sansVisuel: { n: sansVisuel.length, items: sansVisuel }, sansNumero: { n: sansNumero.length, items: sansNumero }, sansProduit: { n: sansProduit.length, items: sansProduit },
            doublons: { n: doublonsN, groupes }, produitsSansFiche: { n: produitsSansFiche.length, items: produitsSansFiche }, manquants: { n: manquantsN, items: manquants } };
        const causes = {};
        for (const t of TYPES) for (const it of (entree[t].items || entree[t].groupes)) { const k = `${t}/${it.cause}`; causes[k] = (causes[k] || 0) + (t === 'doublons' ? it.membres.length - 1 : (it.nombre || 1)); }
        const trous = TYPES.reduce((a, t) => a + entree[t].n, 0);
        // diagnostic du vrai suspect : l'expansion DÉCLARÉE par le set ne se retrouve dans aucune impression de la carte — l'impression la plus proche (même tirage d'abord) dit si c'est un décalage de nom
        const suspects = sansNumero.filter(x => x.cause === 'expansion-declaree-sans-impression');
        const diagnosticExpansion = suspects.length ? { n: suspects.length, expansionsDeclarees: cible.expansions, exemples: suspects.slice(0, 3).map(x => {
            const imps = (cartes.find(c => c._id === x.carteId)?.impressions) || [];
            const p = imps.find(i => i.tirage === cible.tirage) || imps[0] || null;
            return { carteId: x.carteId, nom: x.nom, plusProche: p ? { tirage: p.tirage ?? null, expansion: p.expansion ?? null, numero: p.numero ?? null } : null };
        }) } : null;
        resultats.push({ set: s._id, code: s.code ?? null, nom: s.nomAffichage, tirage: cible.tirage, type: s.type ?? null, attendu, attenduDetail, totalImprime: total, affichees: entrees.length, cartesDocuments: docs.length, produitsCardmarket: prods.length, offres,
            ...entree, exclusPasUnTrou, exclusParCause, diagnosticExpansion, trous, causes });
    }
    const sorted = trier(resultats);
    const parCause = {}; const totaux = { trous: 0, setsTroues: 0, sets100: 0, exclus: 0 };
    const exclus = { total: 0, parCause: {}, parSet: {} };
    for (const t of TYPES) { parCause[t] = {}; totaux[t] = 0; }
    for (const r of sorted) {
        for (const [k, liste] of Object.entries(r.exclusParCause)) { exclus.total += liste.length; exclus.parCause[k] = (exclus.parCause[k] || 0) + liste.length; (exclus.parSet[r.set] = exclus.parSet[r.set] || {})[k] = liste.length; }
        totaux.trous += r.trous; if (r.trous > 0) totaux.setsTroues++; else totaux.sets100++;
        for (const t of TYPES) totaux[t] += r[t].n;
        for (const [k, n] of Object.entries(r.causes)) { const [t, ...c] = k.split('/'); const cause = c.join('/'); parCause[t][cause] = (parCause[t][cause] || 0) + n; }
    }
    totaux.exclus = exclus.total;
    return { exclus, denominateurs: { sets: sets.length, setsPublies: publies.length, setsNonPublies: sets.length - publies.length, cartes: cartes.length, cartesAffichables: affichables.length, lignes: lignes.length, produits: produits.length, produitsSansSetPublie, entreesAffichees: sorted.reduce((a, r) => a + r.affichees, 0) },
        sets: sorted, parCause, totaux };
}

// ── L'ÉCART entre deux audits (le courant `apres`, la référence `avant`)
const aplatir = pc => { const o = {}; for (const [t, m] of Object.entries(pc || {})) for (const [c, n] of Object.entries(m)) o[`${t}/${c}`] = n; return o; };
function ecart(avant, apres) {
    if (!avant) return null;
    const a = aplatir(avant.parCause), b = aplatir(apres.parCause), parCause = {};
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) { const d = (b[k] || 0) - (a[k] || 0); if (d !== 0) parCause[k] = d; }
    const av = new Map((avant.sets || []).map(s => [s.set, s]));
    const setsPassesA100 = [], setsNouvellementTroues = [], setsPassesA100ParCollecte = [], setsPassesA100ParExclusions = [];
    const nEx = s => Object.values(s.exclusParCause || {}).reduce((a, l) => a + (Array.isArray(l) ? l.length : Number(l) || 0), 0);
    for (const s of apres.sets || []) {
        const x = av.get(s.set);
        if (x && x.trous > 0 && s.trous === 0) {
            setsPassesA100.push(s.set);
            // 🔑 un set qui ne passe à 100 % que parce que des fiches sont sorties du compte n'a rien gagné : la baisse de trous moins la hausse des exclus, si elle est nulle, n'est pas une collecte
            (x.trous - s.trous - (nEx(s) - nEx(x)) > 0 ? setsPassesA100ParCollecte : setsPassesA100ParExclusions).push(s.set);
        }
        if (x && x.trous === 0 && s.trous > 0) setsNouvellementTroues.push(s.set); }
    const d1 = avant.denominateurs || {}, d2 = apres.denominateurs || {};
    const totaux = {};
    for (const k of new Set([...Object.keys(avant.totaux || {}), ...Object.keys(apres.totaux || {})])) totaux[k] = ((apres.totaux || {})[k] || 0) - ((avant.totaux || {})[k] || 0);
    // les EXCLUS ont leur écart : un compte de trous qui baisse parce que le périmètre rétrécit doit le dire
    const xa = (avant.exclus || {}).parCause || {}, xb = (apres.exclus || {}).parCause || {}, exParCause = {};
    for (const k of new Set([...Object.keys(xa), ...Object.keys(xb)])) { const d = (xb[k] || 0) - (xa[k] || 0); if (d !== 0) exParCause[k] = d; }
    const exclus = { total: ((apres.exclus || {}).total || 0) - ((avant.exclus || {}).total || 0), parCause: exParCause };
    return { avantLe: avant.le ?? null, memeDenominateur: d1.sets === d2.sets && d1.setsPublies === d2.setsPublies, totaux, parCause, exclus, setsPassesA100, setsPassesA100ParCollecte, setsPassesA100ParExclusions, setsNouvellementTroues };
}

// ── LE MARKDOWN
const signe = n => (n > 0 ? `+${n}` : String(n));
function formaterMd(audit, ec, { lignes = 150, detail = 40, parSet = 8 } = {}) {
    const D = audit.denominateurs, T = audit.totaux, out = [];
    out.push('# AUDIT-SETS — l\'état de chaque set publié, trou par trou', '');
    out.push(`Généré le ${audit.le ?? '?'} · lecture seule · outil : audit-sets.js (module audit-catalogue/audit-sets.js).`, '');
    out.push('**Score de tri = trous × log2(2 + offres Cardmarket de l\'expansion)** : les sets les plus troués ET les plus visités d\'abord. `trous` = sans visuel + sans numéro + sans produit CM + doublons (fiches en trop) + produits CM sans fiche + numéros manquants (un même défaut peut compter dans plusieurs colonnes). `offres` = produits de l\'expansion avec une offre en cours (substitut de popularité).', '');
    out.push('## Dénominateurs', '');
    out.push(`- sets lus ${D.sets} · publiés (audités) ${D.setsPublies} · non publiés (ignorés) ${D.setsNonPublies}`);
    out.push(`- cartes ${D.cartes} (affichables ${D.cartesAffichables}) · lignes cartes_produits ${D.lignes} · produits Cardmarket (hors cartes-code) ${D.produits} (dont sans set publié : ${D.produitsSansSetPublie})`);
    out.push(`- entrées affichées dans les sets audités : ${D.entreesAffichees}`, '');
    out.push('## Totaux', '');
    out.push(`- sets à 100 % : **${T.sets100}** · sets troués : **${T.setsTroues}** · trous : **${T.trous}**`);
    out.push('- ' + TYPES.map(t => `${TITRES[t]} ${T[t]}`).join(' · '));
    out.push(`- 🔎 **exclus du compte, imprimés à part : ${T.exclus ?? 0}** (section « Exclus du compte des trous » ci-dessous — ces fiches n'ont pas disparu : elles sont comptées par cause et par set)`, '');
    out.push('### Totaux par cause', '');
    for (const t of TYPES) {
        const m = audit.parCause[t] || {};
        out.push(`- **${TITRES[t]}** (${T[t]}) : ` + (Object.entries(m).sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c} ${n}`).join(' · ') || '—'));
    }
    out.push('');
    {   // 🔑 les exclusions s'IMPRIMENT : par cause, puis par set, puis la preuve de chaque set de la table
        const X = audit.exclus || { total: 0, parCause: {}, parSet: {} };
        out.push(`## Exclus du compte des trous (${X.total}) — comptés ici, jamais disparus`, '');
        out.push('Décision du testeur (2026-11-08) : le compte des trous dit la vérité. Une fiche n\'est exclue que si une règle FERMÉE le dit (table `SANS_NUMERO_IMPRIME`, vérifiée sur scans ; règle `estAdditionals` du site) ; tout le reste reste un trou.', '');
        out.push('- par cause : ' + (Object.entries(X.parCause).sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c} ${n}`).join(' · ') || '—'));
        const ps = Object.entries(X.parSet).sort((a, b) => Object.values(b[1]).reduce((x, y) => x + y, 0) - Object.values(a[1]).reduce((x, y) => x + y, 0));
        out.push(`- par set (${ps.length}) : ` + (ps.map(([s, m]) => `${s} ${Object.entries(m).map(([c, n]) => `${n} ${c}`).join(', ')}`).join(' · ') || '—'));
        const sources = Object.keys(SANS_NUMERO_IMPRIME).filter(id => X.parSet[id]);
        if (sources.length) { out.push('', '| set exclu (sans numéro imprimé) | famille | ce que la carte imprime | cartes regardées | date |', '|---|---|---|---|---|'); for (const id of sources) { const p = SANS_NUMERO_IMPRIME[id]; out.push(`| ${id} | ${p.famille} | ${p.imprime}${p.note ? ' — ' + p.note : ''} | ${p.cartes.join(' ; ')} | ${p.date} |`); } }
        out.push('');
    }
    if (ec) {
        out.push(`## Écart avec l'audit précédent (${ec.avantLe ?? '?'})${ec.memeDenominateur ? '' : ' — ⚠️ DÉNOMINATEUR DIFFÉRENT, un écart n\'est pas un progrès'}`, '');
        out.push('- trous ' + signe(ec.totaux.trous || 0) + ' · ' + TYPES.map(t => `${TITRES[t]} ${signe(ec.totaux[t] || 0)}`).join(' · '));
        out.push(`- exclus du compte ${signe(ec.exclus ? ec.exclus.total : 0)} (${Object.entries((ec.exclus || {}).parCause || {}).map(([c, n]) => `${c} ${signe(n)}`).join(' · ') || 'aucun changement'}) — une baisse des trous qui n'est qu'une hausse des exclus n'est PAS un progrès`);
        out.push(`- sets passés à 100 % PAR UNE VRAIE COLLECTE (${(ec.setsPassesA100ParCollecte || []).length}) : ${(ec.setsPassesA100ParCollecte || []).slice(0, 60).join(', ') || '—'}`);
        out.push(`- sets passés à 100 % UNIQUEMENT PAR LES EXCLUSIONS (${(ec.setsPassesA100ParExclusions || []).length}) — pas un progrès de collecte : ${(ec.setsPassesA100ParExclusions || []).slice(0, 60).join(', ') || '—'}`);
        out.push(`- sets passés à 100 % au total (${ec.setsPassesA100.length}) : ${ec.setsPassesA100.slice(0, 60).join(', ') || '—'}`);
        out.push(`- sets nouvellement troués (${ec.setsNouvellementTroues.length}) : ${ec.setsNouvellementTroues.slice(0, 60).join(', ') || '—'}`);
        out.push('- écart par cause : ' + (Object.entries(ec.parCause).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).map(([c, n]) => `${c} ${signe(n)}`).join(' · ') || 'aucun'), '');
    } else out.push('## Écart avec l\'audit précédent', '', 'Aucune mesure précédente à comparer.', '');
    out.push('### Sets les plus touchés par « expansion-declaree-sans-impression » (le vrai suspect : décalage de nom d\'expansion ?)', '');
    for (const x of suspectsExpansion(audit)) out.push(`- **${x.set}** ${x.n} — expansion déclarée : ${JSON.stringify(x.expansionsDeclarees)} — ex. ${x.exemples.map(e => `${e.nom} → impression la plus proche ${e.plusProche ? `${e.plusProche.tirage}/« ${e.plusProche.expansion} »/${e.plusProche.numero}` : 'aucune'}`).join(' ; ')}`);
    out.push('');
    const troues = audit.sets.filter(s => s.trous > 0);
    out.push(`## Tableau (${Math.min(lignes, troues.length)} premiers sets sur ${troues.length} troués)`, '');
    out.push('| # | set | nom | tirage | offres | attendu | affichées | sans visuel | sans numéro | sans produit | doublons | prod. sans fiche | manquants | score | cause dominante |');
    out.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
    troues.slice(0, lignes).forEach((s, i) => {
        const dom = Object.entries(s.causes).sort((a, b) => b[1] - a[1])[0];
        out.push(`| ${i + 1} | ${s.set}${s.code ? ' (' + s.code + ')' : ''} | ${s.nom} | ${s.tirage ?? '?'} | ${s.offres} | ${s.attendu ?? '—'} | ${s.affichees} | ${s.sansVisuel.n} | ${s.sansNumero.n} | ${s.sansProduit.n} | ${s.doublons.n} | ${s.produitsSansFiche.n} | ${s.manquants.n} | ${s.score.toFixed(0)} | ${dom ? dom[0] + ' ' + dom[1] : '—'} |`);
    });
    out.push('', `## Détail des ${Math.min(detail, troues.length)} premiers sets (causes, ${parSet} exemples par défaut)`, '');
    for (const s of troues.slice(0, detail)) {
        out.push(`### ${s.nom} — ${s.set}${s.code ? ' (' + s.code + ')' : ''} · score ${s.score.toFixed(0)} · attendu ${s.attendu ?? '—'} · affichées ${s.affichees}`, '');
        if (s.attenduDetail && s.attenduDetail.totalImprime !== null) out.push(`_${s.attenduDetail.libelle}_`, '');
        for (const t of TYPES) {
            if (!s[t].n) continue;
            const causes = Object.entries(s.causes).filter(([k]) => k.startsWith(t + '/')).map(([k, n]) => `${k.slice(t.length + 1)} ${n}`).join(' · ');
            const items = s[t].items || s[t].groupes;
            const ex = items.slice(0, parSet).map(x => t === 'produitsSansFiche' ? `${x.idProduct} ${x.nom}` : t === 'doublons' ? `${x.nom} ${x.membres.map(m => m.numero).join('/')}` : t === 'manquants' ? `n°${x.numero ?? '?'}${x.nombre > 1 ? ' ×' + x.nombre : ''}` : `${x.nom ?? ''} ${x.numero ?? 'sans n°'}`.trim()).join(' ; ');
            out.push(`- **${TITRES[t]}** ${s[t].n} — ${causes} — ${ex}${items.length > parSet ? ' …' : ''}`);
        }
        out.push('');
    }
    return out.join('\n');
}

/** Les `n` sets les plus touchés par « expansion-declaree-sans-impression » : l'expansion déclarée et l'impression la plus proche d'une carte touchée. */
function suspectsExpansion(audit, n = 10) {
    return audit.sets.filter(s => s.diagnosticExpansion).sort((a, b) => b.diagnosticExpansion.n - a.diagnosticExpansion.n || (a.set < b.set ? -1 : 1)).slice(0, n)
        .map(s => ({ set: s.set, n: s.diagnosticExpansion.n, expansionsDeclarees: s.diagnosticExpansion.expansionsDeclarees, exemples: s.diagnosticExpansion.exemples }));
}

module.exports = { suspectsExpansion, auditer, ecart, trier, score, formaterMd, verifierCause, verifierExclusion, EXCLUSIONS, CAUSES, TYPES, TITRES, baseNumero, suffixeLettre };
