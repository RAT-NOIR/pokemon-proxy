// ============================================================
// LOT ENERGIES-SP : les 8 Énergies de base de Sword-Shield-Promos — une impression par numéro, numeroFiche, numéro des images (2026-10-17)
// ============================================================
// LE DÉFAUT : chaque Énergie de base de S-P (Grass 60754, Fire 13682, Water 13683, Lightning 13684, Psychic 13685, Fighting 13686, Darkness 23485,
// Metal 23488) n'a AUCUNE impression numérotée dans « S-P Promotional cards » : une seule fiche sans numéro sert l'image 009/010… à ses 5 à 6
// produits (numéros 9 à 336). Cardmarket en vend un par impression (V2 n°9, V3 n°60, V4 n°90, V5/sans version n°246…, V6 n°329…).
// LA CORRECTION, additive (seule exception listée à part : le numéro d'une entrée d'image à numéro nul) :
//   · une impression numérotée par numéro prouvé — tirage jp (le set est jp), expansion « S-P Promotional cards », numéro sur trois chiffres
//     et total « S-P » comme les autres impressions S-P, source `numero-cardmarket` (conservée par impressions-posees.js) ;
//   · `numeroFiche` sur la ligne de jointure du produit (le site ne lit pas le numéro d'un slug absent) ;
//   · le numéro des 8 images artofpkm/397/316…323 (numéro nul à la source), REGARDÉ sur chaque image (« 329/S-P »… « 336/S-P »).
// DEUX ÉLÉMENTS INDÉPENDANTS PAR DONNÉE, sinon rien (un doute est un trou) :
//   (1) le numéro final du slug Cardmarket (« …-S-P329 ») — celui de la ligne, à défaut celui de numeros_cartes.slug ;
//   (2) le numéro de numeros_cartes (le champ numero, appris de la page, pas de l'URL). Ils doivent s'accorder ; un seul des deux : refus.
// 605830 / 605831 (Darkness, Metal « sans version ») : le slug dit 251 / 252, numeros_cartes 252 / 253 — d'un cran. Pas la règle ordinaire :
// DOUTEUX, posés seulement si deux éléments AUTRES que le slug concordent (numeros_cartes + le RANG dans le lot de même jour 605824…605831,
// dont les six frères sont prouvés 246…251 par deux éléments chacun) ET que le slug contredit s'explique (il porte le numéro d'un frère).
const { SOURCES_POSEES_APRES } = require('./impressions-posees');

const SET = 'Sword-Shield-Promos', EXPANSION = 'S-P Promotional cards', TIRAGE = 'jp', TOTAL = 'S-P';
const SOURCE = 'numero-cardmarket';
const MARQUE = 'ENERGIES-SP 2026-10-17';
if (!SOURCES_POSEES_APRES.includes(SOURCE)) throw new Error(`${SOURCE} n'est plus conservée par impressions-posees.js : une recollecte effacerait ces impressions`);

const CARTES = Object.freeze([
    { id: 60754, nom: 'Basic Grass Energy' }, { id: 13682, nom: 'Basic Fire Energy' }, { id: 13683, nom: 'Basic Water Energy' }, { id: 13684, nom: 'Basic Lightning Energy' },
    { id: 13685, nom: 'Basic Psychic Energy' }, { id: 13686, nom: 'Basic Fighting Energy' }, { id: 23485, nom: 'Basic Darkness Energy' }, { id: 23488, nom: 'Basic Metal Energy' },
].map(Object.freeze));

// Les 8 entrées d'image à numéro nul : le numéro imprimé a été REGARDÉ (bande basse de chaque original R2, montage lu à l'œil le 2026-10-17 : « 329/S-P »…).
const vu = (n, num) => `artofpkm/397/${n}.webp : ${num}/S-P imprimé sur la carte (bande basse regardée 2026-10-17)`;
const IMAGES_SANS_NUMERO = Object.freeze([
    [60754, 316, '329'], [13682, 317, '330'], [13683, 318, '331'], [13684, 319, '332'], [13685, 320, '333'], [13686, 321, '334'], [23485, 322, '335'], [23488, 323, '336'],
].map(([carteId, n, numero]) => Object.freeze({ carteId, cleR2: `artofpkm/397/${n}.webp`, numero, vu: vu(n, numero) })));

const LOT_2022 = Object.freeze([605824, 605825, 605826, 605827, 605828, 605829, 605830, 605831]);
const DOUTEUX = Object.freeze({ 605830: Object.freeze({ carteId: 23485, lot: LOT_2022 }), 605831: Object.freeze({ carteId: 23488, lot: LOT_2022 }) });

const k = n => String(n ?? '').trim().toUpperCase().replace(/^0+(?=\d)/, '');
const pad3 = n => (/^\d+$/.test(String(n ?? '').trim()) ? String(Number(n)).padStart(3, '0') : null);
/** Le numéro final d'un slug « …-S-P329 », sur trois chiffres ; « …-V1-S-P » (nu) ou slug nul : null. */
const numeroDuSlug = slug => { const m = /-S-P(\d+)$/.exec(String(slug ?? '')); return m ? pad3(m[1]) : null; };
const jour = d => String(d instanceof Date ? d.toISOString() : d ?? '').slice(0, 10);
const copie = v => JSON.parse(JSON.stringify(v));

/**
 * @param {{cartes: Map<number, object>, lignes: object[], nc: Map<number, object>, cat?: Map<number, object>, imagesDocs?: Map<string, object>}} etat
 * @param {{carteIds?: number[], douteuxDef?: object, douteux?: boolean, listeImages?: object[]}} [o]
 * @returns {{impressions, numerosFiche, images, deja, refus, sansNumero, douteuxRefuses}}  le plan, sans connexion
 */
function planifier(etat, { carteIds = CARTES.map(c => c.id), douteuxDef = DOUTEUX, douteux = true, listeImages = IMAGES_SANS_NUMERO } = {}) {
    const ids = new Set(carteIds);
    const { cartes, lignes, nc, cat = new Map(), imagesDocs = new Map() } = etat;
    const plan = { impressions: [], numerosFiche: [], images: [], deja: [], refus: [], sansNumero: [], douteuxRefuses: [] };
    const cibles = lignes.filter(l => l.slugSet === SET && ids.has(l.carteId));
    const prouves = new Map();   // idProduct -> numero (deux éléments)
    const duo = new Map();       // idProduct -> { slugN, ncN }
    for (const l of cibles) {
        const n = nc.get(l.idProduct);
        const slugN = numeroDuSlug(l.slug ?? n?.slug), ncN = pad3(n?.numero);
        duo.set(l.idProduct, { slugN, ncN });
        if (douteuxDef[l.idProduct]) continue;   // évalué à part, plus bas
        if (!slugN && !ncN) { plan.sansNumero.push(l.idProduct); continue; }
        if (slugN && ncN && slugN === ncN) { prouves.set(l.idProduct, slugN); continue; }
        if (slugN && ncN) { plan.refus.push({ idProduct: l.idProduct, carteId: l.carteId, raison: `le slug (${slugN}) et numeros_cartes (${ncN}) se contredisent` }); continue; }
        plan.refus.push({ idProduct: l.idProduct, carteId: l.carteId, raison: `un seul élément : ${slugN ? `le slug (${slugN})` : `numeros_cartes (${ncN})`}, l'autre muet` });
    }

    // ── 605830 / 605831 : jamais par la règle ordinaire
    const dpreuves = new Map();
    for (const [sid, def] of Object.entries(douteuxDef)) {
        const id = Number(sid), l = cibles.find(x => x.idProduct === id && x.carteId === def.carteId);
        if (!l) continue;
        const refuse = raison => plan.douteuxRefuses.push({ idProduct: id, carteId: def.carteId, raison });
        const { slugN, ncN } = duo.get(id);
        if (!douteux) { refuse('exclu (--sans-douteux)'); continue; }
        if (!ncN) { refuse('numeros_cartes ne donne aucun numéro : le slug seul ne prouve rien'); continue; }
        const lot = [...def.lot].sort((a, b) => a - b), i = lot.indexOf(id);
        if (i < 0 || lot.some((x, j) => j && x !== lot[j - 1] + 1)) { refuse('le lot n\'est pas une suite d\'identifiants consécutifs'); continue; }
        const jours = new Set(lot.map(x => jour(cat.get(x)?.dateAdded)));
        if (jours.has('') || jours.size !== 1) { refuse('le lot n\'a pas une seule date d\'ajout (catalogue_produits) : le rang ne prouve rien'); continue; }
        const cartesDuLot = lot.map(x => cibles.find(y => y.idProduct === x)?.carteId);
        if (cartesDuLot.some(c => c == null) || new Set(cartesDuLot).size !== lot.length) { refuse('le lot ne montre pas un produit par carte distincte'); continue; }
        const freres = lot.map((x, j) => [x, j, prouves.get(x)]).filter(([, , p]) => p);
        if (freres.length < 3) { refuse(`seulement ${freres.length} frère(s) prouvé(s) par deux éléments dans le lot (3 exigés)`); continue; }
        const bases = new Set(freres.map(([, j, p]) => Number(p) - j));
        if (bases.size !== 1) { refuse('les frères prouvés ne forment pas une suite au rang du lot'); continue; }
        const base0 = [...bases][0], predit = pad3(base0 + i);
        if (predit !== ncN) { refuse(`numeros_cartes (${ncN}) ≠ rang dans le lot (${predit})`); continue; }
        if (slugN && slugN !== predit) {
            const autre = lot.findIndex((x, j) => j !== i && pad3(base0 + j) === slugN);
            if (autre < 0) { refuse(`le slug dit ${slugN}, qui n'est le numéro d'aucun frère : contradiction non expliquée`); continue; }
        }
        const img = [...imagesDocs.values()].find(d => d.carteId === def.carteId && pad3(d.numero) === predit);
        const preuve = `numeros_cartes n°${ncN} ; rang ${i + 1}/${lot.length} dans le lot ${lot[0]}–${lot[lot.length - 1]} ajouté le ${[...jours][0]} (frères prouvés ${freres.map(([, , p]) => p).join(', ')})`
            + `${slugN && slugN !== predit ? ` ; le slug « …S-P${Number(slugN)} » contredit : ${Number(slugN)} est le numéro d'un frère du lot` : ''}${img ? ` ; image ${img._id} n°${predit} (numéro de la source)` : ''}`;
        dpreuves.set(id, { numero: predit, preuve });
    }
    const tous = new Map([...prouves].map(([id, n]) => [id, { numero: n, preuve: 'slug Cardmarket et numeros_cartes concordent' }]));
    for (const [id, d] of dpreuves) tous.set(id, { ...d, douteux: true });

    // ── numeroFiche et impressions
    const parCarte = new Map();   // carteId -> Map(numero -> { produits, preuves })
    for (const l of cibles) {
        const p = tous.get(l.idProduct); if (!p) continue;
        const m = parCarte.get(l.carteId) || new Map(); parCarte.set(l.carteId, m);
        const e = m.get(p.numero) || { produits: [], preuves: [], douteux: true }; m.set(p.numero, e);
        e.produits.push(l.idProduct); e.preuves.push(`${l.idProduct} : ${p.preuve}`); if (!p.douteux) e.douteux = false;
        if (l.numeroFiche == null) plan.numerosFiche.push({ _id: l._id, idProduct: l.idProduct, carteId: l.carteId, numero: p.numero, preuve: p.preuve, ...(p.douteux ? { douteux: true } : {}) });
        else if (k(l.numeroFiche) === k(p.numero)) plan.deja.push({ nature: 'numeroFiche', idProduct: l.idProduct, numero: p.numero });
        else plan.refus.push({ idProduct: l.idProduct, carteId: l.carteId, raison: `numeroFiche déjà posé « ${l.numeroFiche} » ≠ ${p.numero} : jamais écrasé` });
    }
    for (const [carteId, m] of parCarte) {
        const c = cartes.get(carteId); if (!c) { plan.refus.push({ carteId, raison: 'carte introuvable' }); continue; }
        for (const [numero, e] of m) {
            if ((c.impressions || []).some(i => i && i.tirage === TIRAGE && i.expansion === EXPANSION && k(i.numero) === k(numero))) { plan.deja.push({ nature: 'impression', carteId, numero }); continue; }
            plan.impressions.push({ carteId, produits: e.produits, ...(e.douteux ? { douteux: true } : {}),
                impression: { tirage: TIRAGE, expansion: EXPANSION, numero, total: TOTAL, deck: null, rarete: null, source: SOURCE, preuveNumero: `${MARQUE} : ${e.preuves.join(' ; ')}` } });
        }
    }

    // ── images à numéro nul : seulement celles de la liste REGARDÉE, quand un produit prouvé de la carte porte ce numéro
    for (const it of listeImages) {
        if (!ids.has(it.carteId)) continue;
        const c = cartes.get(it.carteId); if (!c) continue;
        const entrees = (c.images || []).filter(m => m && m.set === SET && m.cleR2 === it.cleR2);
        if (!entrees.length) continue;
        const refus = raison => plan.refus.push({ carteId: it.carteId, cleR2: it.cleR2, raison });
        if (entrees.every(m => m.numero != null && k(m.numero) === k(it.numero))) { plan.deja.push({ nature: 'image', cleR2: it.cleR2, numero: it.numero }); continue; }
        if (entrees.length !== 1 || entrees[0].numero != null) { refus(`l'entrée d'image n'est pas unique ou porte déjà un numéro (${entrees.map(m => m.numero).join(', ')})`); continue; }
        if (!it.vu) { refus('numéro imprimé non regardé'); continue; }
        const produit = [...(parCarte.get(it.carteId)?.get(it.numero)?.produits || [])];
        if (!produit.length) { refus(`aucun produit de la carte prouvé au n°${it.numero} : l'image n'a pas de produit qui la nomme`); continue; }
        if ((c.images || []).some(m => m && m.set === SET && m.cleR2 !== it.cleR2 && m.numero != null && k(m.numero) === k(it.numero))) { refus(`le n°${it.numero} est déjà porté par une autre image de la carte`); continue; }
        const doc = imagesDocs.get(it.cleR2);
        if (!doc || doc.numero != null) { refus(`le document images ${it.cleR2} est ${doc ? `déjà numéroté (${doc.numero})` : 'introuvable'}`); continue; }
        plan.images.push({ carteId: it.carteId, cleR2: it.cleR2, numero: it.numero, vu: it.vu, produits: produit });
    }
    return plan;
}

/** L'état après le plan (copie : l'entrée n'est pas modifiée). */
function appliquer(etat, plan) {
    const cartes = new Map([...etat.cartes].map(([id, c]) => [id, copie(c)]));
    const lignes = etat.lignes.map(copie);
    const imagesDocs = new Map([...(etat.imagesDocs || new Map())].map(([id, d]) => [id, copie(d)]));
    for (const o of plan.impressions) { const c = cartes.get(o.carteId); c.impressions = [...(c.impressions || []), copie(o.impression)]; }
    for (const o of plan.numerosFiche) { const l = lignes.find(x => x._id === o._id); if (l && l.numeroFiche == null) l.numeroFiche = o.numero; }
    for (const o of plan.images) {
        const e = (cartes.get(o.carteId).images || []).find(m => m.set === SET && m.cleR2 === o.cleR2 && m.numero == null); if (e) e.numero = o.numero;
        const d = imagesDocs.get(o.cleR2); if (d && d.numero == null) d.numero = o.numero;
    }
    return { cartes, lignes, imagesDocs };
}

/** Ce que le lot a posé, pour le retirer exactement (le plan est vide une fois écrit). */
const manifeste = plan => ({
    marque: MARQUE,
    impressions: plan.impressions.map(o => ({ carteId: o.carteId, numero: o.impression.numero })),
    numerosFiche: plan.numerosFiche.map(o => ({ _id: o._id, idProduct: o.idProduct, carteId: o.carteId, numero: o.numero })),
    images: plan.images.map(o => ({ carteId: o.carteId, cleR2: o.cleR2, numero: o.numero })),
});

/** Le retrait en mémoire : seulement ce que le manifeste a posé, à la valeur posée. */
function retirer(etat, m) {
    const cartes = new Map([...etat.cartes].map(([id, c]) => [id, copie(c)]));
    const lignes = etat.lignes.map(copie);
    const imagesDocs = new Map([...(etat.imagesDocs || new Map())].map(([id, d]) => [id, copie(d)]));
    for (const o of m.impressions) {
        const c = cartes.get(o.carteId); if (!c) continue;
        c.impressions = (c.impressions || []).filter(i => !(i && i.tirage === TIRAGE && i.expansion === EXPANSION && k(i.numero) === k(o.numero) && i.source === SOURCE && String(i.preuveNumero || '').startsWith(MARQUE)));
    }
    for (const o of m.numerosFiche) { const l = lignes.find(x => x._id === o._id); if (l && l.numeroFiche === o.numero) delete l.numeroFiche; }
    for (const o of m.images) {
        const e = (cartes.get(o.carteId)?.images || []).find(x => x.set === SET && x.cleR2 === o.cleR2 && x.numero === o.numero); if (e) e.numero = null;
        const d = imagesDocs.get(o.cleR2); if (d && d.numero === o.numero) d.numero = null;
    }
    return { cartes, lignes, imagesDocs };
}

const filtreImpression = o => ({ _id: o.carteId, impressions: { $not: { $elemMatch: { tirage: TIRAGE, expansion: EXPANSION, numero: o.impression.numero } } } });
/** Les écritures : un $push gardé, un $set de numeroFiche gardé par un champ nul, un $set positionnel gardé par un numéro nul. Jamais le $set d'un tableau. */
function operationsVersMongo(plan) {
    const ops = [];
    for (const o of plan.impressions) ops.push({ coll: 'cartes', filter: filtreImpression(o), update: { $push: { impressions: o.impression } } });
    for (const o of plan.numerosFiche) ops.push({ coll: 'cartes_produits', filter: { _id: o._id, numeroFiche: null }, update: { $set: { numeroFiche: o.numero } } });
    for (const o of plan.images) {
        ops.push({ coll: 'images', filter: { cleR2: o.cleR2, numero: null }, update: { $set: { numero: o.numero } } });
        ops.push({ coll: 'cartes', filter: { _id: o.carteId, images: { $elemMatch: { set: SET, cleR2: o.cleR2, numero: null } } }, update: { $set: { 'images.$[e].numero': o.numero } }, options: { arrayFilters: [{ 'e.set': SET, 'e.cleR2': o.cleR2, 'e.numero': null }] } });
    }
    return ops;
}
function operationsDeRetrait(m) {
    const ops = [];
    for (const o of m.impressions) ops.push({ coll: 'cartes', filter: { _id: o.carteId }, update: { $pull: { impressions: { tirage: TIRAGE, expansion: EXPANSION, numero: o.numero, source: SOURCE, preuveNumero: { $regex: `^${MARQUE}` } } } } });
    for (const o of m.numerosFiche) ops.push({ coll: 'cartes_produits', filter: { _id: o._id, numeroFiche: o.numero }, update: { $unset: { numeroFiche: '' } } });
    for (const o of m.images) {
        ops.push({ coll: 'images', filter: { cleR2: o.cleR2, numero: o.numero }, update: { $set: { numero: null } } });
        ops.push({ coll: 'cartes', filter: { _id: o.carteId, images: { $elemMatch: { set: SET, cleR2: o.cleR2, numero: o.numero } } }, update: { $set: { 'images.$[e].numero': null } }, options: { arrayFilters: [{ 'e.set': SET, 'e.cleR2': o.cleR2, 'e.numero': o.numero }] } });
    }
    return ops;
}

/** Le retrait baisse le compteur d'impressions du tirage et de l'expansion (le seul que la garde de lot voie) : annonce pour `lot-additif.js --annonce=`. */
const annonceDeRetrait = m => (m.impressions.length ? { [`impressions imp:${TIRAGE}|${EXPANSION}`]: m.impressions.length } : {});

/** Le résumé lisible du diff (diff.md) : les comptes, le plan, les douteux, puis une ligne par produit des 8 cartes. */
function diffEnMarkdown({ resume, plan, produits }, { annonce = {}, garde = {}, douteux = true } = {}) {
    const img = x => (x && x.image ? `${String(x.image.cleR2).replace(/^artofpkm\/397\//, '')} (n°${x.image.numeroImage ?? '∅'})` : '∅');
    const fiche = x => (!x || !x.fiche ? 'AUCUNE FICHE' : `rang ${x.rang} · n° ${x.numeroAffiche ?? '∅'}`);
    const L = [];
    L.push('# ENERGIES-SP — diff produit par produit (règle du site importée)', '');
    L.push(`- produits rejoués (set ${SET}) : ${resume.produitsRejoues} · différences : ${resume.differences} · produits des 8 cartes listés : ${resume.produitsDesHuitCartes}`);
    L.push(`- gagnés : ${resume.gagnes} · perdus : ${resume.perdus} · visuels changés : ${resume.visuelsChanges} · fiches changées à visuel identique : ${resume.fichesChangeesVisuelIdentique} · hors des 8 cartes : ${resume.horsDesHuitCartes}`);
    L.push(`- plan : ${plan.impressions.length} impressions · ${plan.numerosFiche.length} numeroFiche · ${plan.images.length} numéros d'image · refus ${plan.refus.length} · sans numéro (V1 nus) ${plan.sansNumero.length}${douteux ? '' : ' · 605830/605831 exclus (--sans-douteux)'}`);
    L.push(`- garde de lot (simulée) : ${garde.baisses ?? '?'} baisse(s), ${garde.nonAutorisees ?? '?'} non autorisée(s) · annonce : ${Object.keys(annonce).length ? JSON.stringify(annonce) : 'aucune'}`, '');
    L.push('## 605830 et 605831', '');
    for (const d of plan.numerosFiche.filter(x => x.douteux)) L.push(`- POSÉ ${d.idProduct} → n° ${d.numero} : ${d.preuve}`);
    for (const d of plan.douteuxRefuses) L.push(`- NON POSÉ ${d.idProduct} : ${d.raison}`);
    L.push('', '## Les produits des 8 cartes', '', '| produit | carte | slug / numéro appris | avant : fiche · image | après : fiche · image | numeroFiche | nature |', '|---|---|---|---|---|---|---|');
    for (const p of produits) L.push(`| ${p.idProduct} | ${p.nom ?? p.carteId} | ${p.slug ?? p.slugNc ?? '∅'} / ${p.numeroNc ?? '∅'} | ${fiche(p.avant)} · ${img(p.avant)} | ${fiche(p.apres)} · ${img(p.apres)} | ${p.numeroFicheApres ?? '—'} | ${p.nature}${p.sansNumeroSite ? ' (site : « numéro non renseigné »)' : ''} |`);
    return `${L.join('\n')}\n`;
}

module.exports = { SET, EXPANSION, TIRAGE_ATTENDU: TIRAGE, SOURCE, MARQUE, CARTES, diffEnMarkdown, annonceDeRetrait, IMAGES_SANS_NUMERO, DOUTEUX, SOURCES_POSEES_APRES_OK: true, numeroDuSlug, pad3, k,
    planifier, appliquer, manifeste, retirer, operationsVersMongo, operationsDeRetrait };
