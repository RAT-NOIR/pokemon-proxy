// ============================================================================
// LA RÈGLE R — quand une fiche simple peut s'ajouter dans un set à page (DOUBLONS-FICHES.md §4, feu vert NOMMÉ du testeur, 2026-10-08)
// ============================================================================
// Décision : « 152 FICHES : FEU VERT pour la règle R (130), à une condition : aucune URL ne doit casser. » Le site a confirmé la redirection
// (DEMANDE-REDIRECTION-FICHES-R.md, « Réponse du site ») : 308 calculé depuis `nomEn` et `cartes.liens.idProduct[0]`, sans table.
//
// 🔑 ÉCRITE PAR CE QU'ELLE AUTORISE : deux issues seulement, sous R0.
//   R0  la ligne du set est VÉRIFIÉE (`verifie` = relevé daté avec sa page), le document `sets` se lit, ET le n° du produit n'est porté par AUCUNE autre carte du set
//       (impression du tirage et des expansions du site, `numeroFiche` d'une ligne, n° du produit d'une ligne) — sinon C1.
//   R1  la carte est DÉJÀ membre du set (`cartes.sets`) : rattachement, aucune fiche nouvelle (cause C2a). La Setlist ne doit pas lister sa
//       page deux fois (C2b : deux entrées pour une carte, l'effet sur le site n'est pas mesuré).
//   R2  la Setlist lue du set (`collecte_etat.pages`) porte une entrée à CE numéro ET de CE nom, TOUTES en `manquant` (cause C3a), sans page
//       réelle (`ok`) de même nom ailleurs (C3d) ni homonyme dans le set (C3f).
// Tout le reste BLOQUE et DIT sa cause : C3b (ce n° est celui d'autres noms) · C3c (l'entrée de ce n° et de ce nom est une page réelle) · C3e
// (lien rouge de même nom, autre forme de numéro) · C4a (la Setlist ne nomme ni ce n° ni cette carte) · C4b (aucune Setlist lue).
//
// 🔑 LES CONDITIONS DU SITE, EN GARDE MÉCANIQUE (`garderEcritureSite`) : l'écriture sur `cartes` ne peut être QUE `updateOne` par `_id`, sans
// upsert, avec un seul opérateur `$addToSet` sur `liens.idProduct`, `liens.idMetacards` et `sets`, chacun en `$each`. `$addToSet` AJOUTE EN FIN
// ce qui manque et ne réordonne jamais ce qui existe : `liens.idProduct[0]` et `nomEn` ne peuvent donc pas bouger. Tout autre opérateur, tout
// autre champ, `nomEn` nommé où que ce soit : l'écriture REFUSE (liste fermée, pas liste d'interdits).
// ⚠️ Une carte dont `liens.idProduct` est VIDE verrait son premier idProduct écrit devenir son repère : `cartesSansRepere` la compte, la simulation
// l'imprime.
//
// Les fonctions du site sont IMPORTÉES (rat-market-site/lib/*.ts), jamais recopiées (CLAUDE.md §76).
const path = require('path');
const { pathToFileURL } = require('url');
const { clesNom, nomJointDe, jetonsDeSetlist } = require('./jointure');

const SITE_LIB = path.join(__dirname, '..', '..', 'rat-market-site', 'lib');

/** Les trois fonctions du site dont la règle a besoin ; l'une d'elles manque → LÈVE (jamais un repli). */
async function chargerSite() {
    const lire = f => import(pathToFileURL(path.join(SITE_LIB, f)).href);
    const [e, i] = await Promise.all([lire('entreesDuSet.ts'), lire('imageDeLImpression.ts')]);
    const site = { tirageDuSet: e.tirageDuSet, expansionsDuSet: e.expansionsDuSet, normaliserNumero: i.normaliserNumero };
    for (const [k, f] of Object.entries(site)) if (typeof f !== 'function') throw new Error(`${k} absent de ${SITE_LIB}`);
    return site;
}

/** Ce que la règle lit, tel que la production le lit (poser-par-metacarte.js et le banc passent par ici). `lireMongo` = collecte-cartes/lecture-sure. */
async function lireBases(db, lireMongo) {
    const cartes = await lireMongo(db.collection('cartes'), {}, { nom: 'cartes', projection: { nomEn: 1, niveau: 1, 'attaques.nom': 1, 'impressions.tirage': 1, 'impressions.expansion': 1, 'impressions.numero': 1, 'bulba.titre': 1, sets: 1, 'liens.idProduct': 1 } });
    const lignes = await lireMongo(db.collection('cartes_produits'), {}, { nom: 'cartes_produits', projection: { idProduct: 1, carteId: 1, slugSet: 1, numeroFiche: 1 } });
    const etats = await lireMongo(db.collection('collecte_etat'), {}, { nom: 'collecte_etat', projection: { pages: 1 } });
    const sets = await lireMongo(db.collection('sets'), {}, { nom: 'sets', projection: { code: 1, region: 1, tirage: 1, bulba: 1 } });
    return { cartes, lignes, etats, sets };
}

function construireContexte({ cartes, lignes, etats, sets }, site) {
    const cartesDuSet = new Map(), lignesParSlug = new Map();
    for (const c of cartes) for (const s of c.sets || []) (cartesDuSet.get(s) || cartesDuSet.set(s, []).get(s)).push(c);
    for (const l of lignes) (lignesParSlug.get(l.slugSet) || lignesParSlug.set(l.slugSet, []).get(l.slugSet)).push(l);
    return { site, cartesDuSet, lignesParSlug, etats: new Map(etats.map(e => [e._id, e])), setsDocs: new Map(sets.map(s => [s._id, s])) };
}

const nu = n => String(n ?? '?').replace(/^0+(?=\d)/, '');
const norm = t => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const nomTitre = t => String(t).replace(/\s*\([^()]*\)\s*$/, '');
const parseTitre = t => { const m = /^(.*) \(([^()]*) ([^\s()]+)\)\s*$/.exec(String(t)); return m ? { nom: m[1], jeton: m[2], num: m[3] } : { nom: String(t), jeton: null, num: null }; };
/**
 * Les jetons que CETTE Setlist reconnaît comme SIENS — la définition de la production (`jetonsDeSetlist`, jointure.js, lue par la jointure ET la vérification) :
 * les noms d'expansion de la ligne + le jeton le plus fréquent de la Setlist ; plus les jetons des listes de la table (`bulba.prefixesParJeton`, comme
 * `numeroDeSetlist`). Tout autre jeton est une RÉIMPRESSION listée en passant (« Psyduck (Astral Radiance 28) »), dont le numéro est celui d'un autre set.
 * Les entrées de `collecte_etat.pages` n'ont que leur titre : le jeton est lu dedans (même forme « Nom (Jeton N) » que les entrées de TCG ID).
 */
function jetonsReconnus(L, entrees) {
    const jetons = jetonsDeSetlist(entrees.filter(e => e.jeton).map(e => ({ forme: 'tcg-id', a: e.jeton })), [].concat(L.bulba?.expansion ?? []));
    for (const k of Object.keys(L.bulba?.prefixesParJeton || {})) jetons.add(k);
    return jetons;
}

const CAUSES = {
    C1: 'le n° du produit est déjà porté par une AUTRE carte du set (impression, numeroFiche ou n° du produit d\'une ligne)',
    C2a: 'la carte désignée est déjà membre du set : rattachement, aucune fiche nouvelle (R1)',
    C2b: 'la carte est membre du set mais la Setlist liste sa page plusieurs fois',
    C3a: 'la Setlist lue a CE numéro ET CE nom, en lien rouge (R2)',
    C3b: 'la Setlist a ce n° mais d\'AUTRES noms',
    C3c: 'l\'entrée de ce n° et de ce nom est une page réelle (ou mêlée de pages réelles)',
    C3d: 'une page réelle de même nom existe ailleurs dans la Setlist',
    C3e: 'lien rouge de même nom mais autre forme de numéro',
    C3f: 'un homonyme est déjà dans le set',
    'C3g-jeton-etranger': 'le lien rouge au bon nom et au bon numéro porte le jeton d\'un AUTRE set (réimpression listée en passant)',
    EXCLU: 'exclu par décision nommée (--exclure)',
    C4a: 'la Setlist ne nomme ni ce n° ni cette carte',
    C4b: 'aucune Setlist lue (voie « sans page »)',
    'HORS-PERIMETRE': 'la ligne de table n\'est pas vérifiée (`verifie` : relevé avec date et page)',
    'SET-ILLISIBLE': 'le document `sets` est absent ou illisible'
};

/**
 * « Ligne vérifiée » (le `verifie: true` de DOUBLONS-FICHES.md) : dans table-sets, `verifie` est le RELEVÉ de la vérification — un objet qui porte sa date
 * (`le`) et la page résolue (`page`, `null` pour une ligne « sans page » comme UNP) —, jamais un booléen ; `null`/absent pour une ligne non vérifiée
 * (TK2, PPS1…). Écrit par ce qu'il autorise : seul un relevé daté qui déclare sa page (même nulle) passe, un `true` nu ou un objet sans date est HORS PÉRIMÈTRE.
 */
const ligneVerifiee = L => { const v = L?.verifie; return !!v && typeof v === 'object' && !!v.le && Object.hasOwn(v, 'page'); };

/**
 * Juge UN produit désigné. { L, p, X, numDe } : la ligne de table, le produit ({ idProduct, numero }), la carte désignée, et Map idProduct → numero des
 * produits de l'expansion. Rend { autorise, regle: 'R1'|'R2'|null, cause, raison }. Ne lève pas : un doute est un refus nommé.
 */
function jugerRegleR(ctx, { L, p, X, numDe }) {
    const { site } = ctx;
    const refus = (cause, detail) => ({ autorise: false, regle: null, cause, raison: `${CAUSES[cause]}${detail ? ` — ${detail}` : ''}` });
    if (!ligneVerifiee(L)) return refus('HORS-PERIMETRE');
    const slug = L.slugSet, sd = ctx.setsDocs.get(slug);
    let regionSite, expsSite;
    try { regionSite = site.tirageDuSet(sd); expsSite = site.expansionsDuSet(sd); } catch (_) { return refus('SET-ILLISIBLE'); }
    if (!sd || !Array.isArray(expsSite)) return refus('SET-ILLISIBLE');
    const docs = ctx.cartesDuSet.get(slug) || [];
    const lignes = ctx.lignesParSlug.get(slug) || [];
    const numerosDans = c => (c.impressions || []).filter(i => i && i.tirage === regionSite && expsSite.includes(i.expansion)).map(i => i.numero);
    const pNum = site.normaliserNumero(p.numero);
    // ── R0 : le n° du produit n'est porté par aucune autre carte du set
    const parImpression = docs.filter(c => c._id !== X._id && pNum != null && numerosDans(c).some(n => site.normaliserNumero(n) === pNum));
    const parProduitDeLigne = lignes.filter(l => numDe.get(l.idProduct) != null && p.numero != null && nu(numDe.get(l.idProduct)) === nu(p.numero) && l.carteId !== X._id);
    const parNumeroFiche = lignes.filter(l => l.numeroFiche != null && p.numero != null && nu(l.numeroFiche) === nu(p.numero) && l.carteId !== X._id);
    if (parImpression.length || parProduitDeLigne.length || parNumeroFiche.length) {
        return refus('C1', `n°${p.numero} porté par ${[...parImpression.map(c => `la carte ${c._id}`), ...parProduitDeLigne.map(l => `la ligne ${l.carteId}|${l.idProduct}`), ...parNumeroFiche.map(l => `numeroFiche de ${l.carteId}`)].slice(0, 3).join(', ')}`);
    }
    const E = ctx.etats.get(slug);
    const entrees = (E?.pages || []).map(pg => ({ ...parseTitre(pg.titre), titre: pg.titre, etat: pg.etat }));
    // ── R1 : la carte est déjà membre du set
    if ((X.sets || []).includes(slug)) {
        const n = entrees.filter(e => X.bulba?.titre && e.titre === X.bulba.titre).length;
        return n > 1 ? refus('C2b', `${n} entrées`) : { autorise: true, regle: 'R1', cause: 'C2a', raison: CAUSES.C2a };
    }
    // ── R2 : la Setlist lue porte CE numéro et CE nom, en lien rouge
    const memeNum = entrees.filter(e => e.num != null && nu(e.num) === nu(p.numero));
    const nomX = new Set(clesNom(nomJointDe(X)));
    const memeNom = entrees.filter(e => clesNom(e.nom).some(k => nomX.has(k)));
    if (memeNum.length) {
        const nommeTous = memeNum.filter(e => norm(nomTitre(e.titre)) === norm(X.nomEn));
        if (!nommeTous.length) return refus('C3b', `n°${p.numero} : ${memeNum.slice(0, 3).map(e => e.titre).join(' / ')}`);
        // R2 ne lit que les entrées qui désignent CE set : un lien rouge au bon nom et au bon numéro mais au jeton d'un autre set est une réimpression
        const jetons = jetonsReconnus(L, entrees);
        const nomme = nommeTous.filter(e => jetons.has(e.jeton));
        if (!nomme.length) return refus('C3g-jeton-etranger', nommeTous.slice(0, 2).map(e => `${e.titre} (jeton « ${e.jeton} » ∉ ${[...jetons].slice(0, 3).join(' / ')})`).join(' ; '));
        if (!nomme.every(e => e.etat === 'manquant')) return refus('C3c', nomme.map(e => `${e.titre} ${e.etat}`).join(' / '));
        const reelles = memeNom.filter(e => e.etat === 'ok');
        if (reelles.length) return refus('C3d', reelles.slice(0, 2).map(e => e.titre).join(' / '));
        const homonymes = docs.filter(c => c._id !== X._id && c.nomEn && clesNom(nomJointDe(c)).some(k => nomX.has(k)));
        if (homonymes.length) return refus('C3f', homonymes.slice(0, 2).map(c => c._id).join(', '));
        return { autorise: true, regle: 'R2', cause: 'C3a', raison: CAUSES.C3a };
    }
    if (memeNom.length) return refus(memeNom.some(e => e.etat === 'ok') ? 'C3d' : 'C3e', memeNom.slice(0, 2).map(e => e.titre).join(' / '));
    return refus(entrees.length ? 'C4a' : 'C4b');
}

/**
 * R0 vaut aussi ENTRE les produits d'un même lot : deux cartes DIFFÉRENTES autorisées au même n° dans le même set sont refusées toutes les deux
 * (C1). `resultats` : [{ L, p, X, j }] ; rend la liste avec `j` remplacé là où il y a collision. Les produits d'une même carte ne se heurtent pas.
 */
function refuserCollisionsDuLot(resultats) {
    const cartesParCle = new Map();
    const cle = r => `${r.L.slugSet}|${nu(r.p.numero)}`;
    for (const r of resultats) if (r.j.autorise && r.p.numero != null) (cartesParCle.get(cle(r)) || cartesParCle.set(cle(r), new Set()).get(cle(r))).add(r.X._id);
    return resultats.map(r => (r.j.autorise && r.p.numero != null && cartesParCle.get(cle(r)).size > 1)
        ? { ...r, j: { autorise: false, regle: null, cause: 'C1', raison: `${CAUSES.C1} — collision dans le lot : ${cartesParCle.get(cle(r)).size} cartes autorisées au n°${r.p.numero}` } }
        : r);
}

/**
 * L'EXCLUSION NOMMÉE (`--exclure=<idProduct,…>`) : une liste FERMÉE de produits que la décision du testeur retire du lot. Chaque idProduct doit être un
 * produit AUTORISÉ du lot ; un absent ou un déjà refusé LÈVE (une exclusion qui ne mord sur rien se confirmerait elle-même). Rend la liste, les exclus en `EXCLU`.
 */
function exclureProduits(resultats, ids) {
    const voulus = new Set(ids);
    const autorises = new Set(resultats.filter(r => r.j.autorise).map(r => r.p.idProduct));
    const faux = [...voulus].filter(id => !autorises.has(id));
    if (faux.length) throw new Error(`🔴 --exclure : ${faux.join(', ')} n'est pas un produit AUTORISÉ de ce lot (absent ou déjà refusé) — rien n'est exclu en silence.`);
    return resultats.map(r => voulus.has(r.p.idProduct) ? { ...r, j: { autorise: false, regle: null, cause: 'EXCLU', raison: CAUSES.EXCLU } } : r);
}

// ── L'ÉCRITURE SUR `cartes` ET SA GARDE
const CHAMPS_ECRITS = new Set(['liens.idProduct', 'liens.idMetacards', 'sets']);
/** parCarte : Map carteId → { ids: [idProduct…], metas: Set, sets: Set }. Rend les opérations bulkWrite (ajout pur, en fin de tableau). */
function operationsCartes(parCarte) {
    return [...parCarte].map(([id, v]) => ({ updateOne: { filter: { _id: id }, update: { $addToSet: { 'liens.idProduct': { $each: v.ids }, 'liens.idMetacards': { $each: [...v.metas] }, sets: { $each: [...v.sets] } } } } }));
}
/** Liste fermée : LÈVE pour toute opération qui n'est pas exactement un `$addToSet` `$each` sur les trois champs ci-dessus, par `_id`, sans upsert, sans `nomEn`. */
function garderEcritureSite(ops) {
    const non = (i, r) => { throw new Error(`🔴 GARDE DU SITE (opération ${i}) : ${r} — l'écriture ne change ni nomEn ni l'ordre de liens.idProduct, elle AJOUTE en fin de tableau.`); };
    if (!Array.isArray(ops)) non('-', 'pas une liste d\'opérations');
    ops.forEach((op, i) => {
        if (!op || typeof op !== 'object' || Object.keys(op).join() !== 'updateOne') non(i, 'ce n\'est pas un updateOne seul');
        const u = op.updateOne;
        if (Object.keys(u).sort().join() !== 'filter,update') non(i, 'clés autres que filter et update (un upsert est refusé)');
        if (Object.keys(u.filter).join() !== '_id') non(i, 'le filtre n\'est pas un _id seul');
        if (Object.keys(u.update).join() !== '$addToSet') non(i, 'opérateur autre que $addToSet');
        for (const [champ, val] of Object.entries(u.update.$addToSet)) {
            if (!CHAMPS_ECRITS.has(champ)) non(i, `champ « ${champ} » hors de la liste fermée`);
            if (!val || typeof val !== 'object' || Object.keys(val).join() !== '$each' || !Array.isArray(val.$each)) non(i, `« ${champ} » n'est pas un $each`);
        }
        if (/nomEn/.test(JSON.stringify(op))) non(i, 'nomEn est nommé');
    });
}
/** Les cartes (parmi `ids`) dont `liens.idProduct` est vide ou absent : leur premier idProduct écrit deviendrait leur repère d'adresse. */
function cartesSansRepere(cartes, ids) {
    const voulus = new Set(ids);
    return cartes.filter(c => voulus.has(c._id) && !(Array.isArray(c.liens?.idProduct) && c.liens.idProduct.length)).map(c => c._id);
}

/**
 * Rejoue `$addToSet` en JS sur les documents LUS (ajout en fin de ce qui manque, ordre existant conservé) et compare le repère d'adresse du site :
 * { cartes, avecRepere, repereConserve, deplaces: [ids], sansRepere: [ids] }. `deplaces` doit être VIDE (l'écriture s'arrête sinon). La preuve que MongoDB
 * se comporte ainsi est le banc en mémoire (test-regle-r-fiches.js) ; ceci est la preuve sur les documents RÉELS de la simulation.
 */
function controlerRepere(cartes, parCarte) {
    const parId = new Map(cartes.map(c => [c._id, c]));
    const r = { cartes: 0, avecRepere: 0, repereConserve: 0, deplaces: [], sansRepere: [] };
    for (const [id, v] of parCarte) {
        const avant = Array.isArray(parId.get(id)?.liens?.idProduct) ? parId.get(id).liens.idProduct : [];
        const apres = [...avant]; for (const x of v.ids) if (!apres.includes(x)) apres.push(x);
        r.cartes++;
        if (!avant.length) { r.sansRepere.push(id); continue; }
        r.avecRepere++;
        if (apres[0] === avant[0] && avant.every((x, i) => apres[i] === x)) r.repereConserve++; else r.deplaces.push(id);
    }
    return r;
}

module.exports = { exclureProduits, controlerRepere, chargerSite, lireBases, construireContexte, jugerRegleR, refuserCollisionsDuLot, operationsCartes, garderEcritureSite, cartesSansRepere, CAUSES };
