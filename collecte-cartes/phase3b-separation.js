// ============================================================
// PHASE 3b, T3 — SÉPARER PAR VARIANTE LES 5 PRODUITS DU SCÉNARIO « JETON » (accordé : « 2 Toys R Us, 3 Oversized ») — module PUR + écritures bornées
// ============================================================
// CE QUI S'ÉCRIT (le scénario « jeton » de la mesure, mesure-variantes-phase2.js, et rien de plus) :
//   · `cartes.images[].partageeTamponNonSepare: false` sur les 9 entrées des 9 groupes (une entrée par groupe) ;
//   · `cartes_produits.variante: 'normale'` + `variantePreuve` sur les 9 lignes des produits JUSTES ;
//   · `cartes_produits.variante: <jeton>` (toys-r-us, jumbo) + `variantePreuve` sur les 5 cibles qui ont un jeton ;
//   · RIEN sur les 8 autres cibles (aucun jeton dans le vocabulaire de l'API) : elles restent refusées par l'API (fail-closed, partageIncoherent).
// L'API (decision.js / partage-variante.js, importée, jamais recopiée) ne sert une entrée `partageeTamponNonSepare: false` sans liste `produitsPartages` qu'aux produits dont la ligne porte une variante de la liste
// fermée AVEC une `variantePreuve` non vide : c'est cette preuve que ce module écrit, lisible (ce qui a été vu, par qui, quand).
//
// UNE GARDE S'ÉCRIT PAR CE QU'ELLE AUTORISE : un groupe n'est écrit que si TOUT est prouvé sur l'état réel — une seule entrée, une clé que personne d'autre ne porte, l'API sert par cette clé EXACTEMENT les justes et les
// cibles, l'entrée est dans l'état d'avant (champ ABSENT) ou déjà dans l'état final, chaque ligne a sa variante absente ou déjà égale, aucune cible sans jeton ne porte déjà une variante. Le reste est un REFUS NOMMÉ ;
// un groupe refusé n'est écrit NULLE PART (déclarer une entrée séparée sans les variantes de ses lignes ferait perdre leur visuel aux produits justes).
// ORDRE D'ÉCRITURE : les lignes d'abord, les entrées ensuite — une écriture interrompue entre les deux laisse des variantes sans effet (l'entrée sert encore tout le monde), jamais une entrée « séparée » dont les produits
// n'ont pas leur variante. Relancée, elle s'achève (idempotente : une cible déjà dans l'état final est comptée « deja », pas réécrite).
'use strict';
const { num } = require('./phase2-visuels');

const LOT = 'phase3b-separation-2026-10-24';
const VU = 'lu à l\'oeil sur les planches de l\'audit S8 (phase 2, lots B et C) par le coordinateur, séparation par variante accordée par le testeur le 2026-10-24';
const vide = v => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
const texte = v => typeof v === 'string' && v.trim() !== '';

/** Ce que la table fermée doit donner : 9 entrées, 9 justes, 5 jetons, 8 cibles sans jeton. Un autre compte = une table qui n'est plus celle qui a été accordée : rien n'est écrit. */
const ATTENDU_TABLE = Object.freeze({ entrees: 9, justes: 9, jetons: 5, sansJeton: 8 });

/** La preuve écrite sur la ligne d'une CIBLE à jeton : ce qui a été vu sur le produit, où, par qui, quand. `lu` : la table LU (quoi). */
function preuveCible(g, c, lu) {
    return `${lu.get(c.idProduct).quoi} ; jeton « ${c.jeton} » de la liste de l'API ; entrée ${g.set} n°${g.numero ?? '-'} (${g.cleR2}) : le scan de l'entrée est celui de la version sans ce marquage (produit(s) juste(s) ${g.justes.join(', ')}) ; ${VU}`;
}
/** La preuve écrite sur la ligne d'un produit JUSTE : il est la version « normale » de l'entrée, les cibles voisines portent autre chose (ce qu'on a vu sur elles). */
function preuveJuste(g, lu) {
    const voisins = g.cibles.map(c => `${c.idProduct} (${lu.get(c.idProduct).quoi})`).join(' ; ');
    return `version normale : le scan de l'entrée ${g.set} n°${g.numero ?? '-'} (${g.cleR2}) est le sien ; les produits voisins de la même entrée portent un autre marquage : ${voisins} ; ${VU}`;
}

/**
 * LE PLAN (pur, ne lit rien, n'écrit rien). Chaque groupe est PROUVÉ (toutes ses lignes et son entrée sont dans l'état d'avant ou déjà dans l'état final) ou REFUSÉ avec son motif.
 * @param {{cartes: object[], cartesProduits: object[], entreesApi: object[], groupes: object[], lu: Map}} o  entreesApi : la sortie de `decider` sur l'état ACTUEL
 * @returns {{entrees: object[], lignes: object[], refus: object[], comptes: object}}
 */
function planifier({ cartes, cartesProduits, entreesApi, groupes, lu }) {
    if (!Array.isArray(cartes) || !cartes.length || !Array.isArray(cartesProduits) || !cartesProduits.length) throw new Error('planifier : aucune carte ou aucune ligne lue — base fausse (un vide parfait n\'est pas « rien à faire »)');
    const parId = new Map(cartes.map(c => [c._id, c]));
    const portees = new Map();
    for (const c of cartes) for (const m of c.images || []) if (m?.cleR2) portees.set(m.cleR2, (portees.get(m.cleR2) || 0) + 1);
    const servisParCle = new Map();
    for (const e of entreesApi) { const k = e.grande?.cle; if (!k) continue; (servisParCle.get(k) || servisParCle.set(k, new Set()).get(k)).add(e.idProduct); }
    const entrees = [], lignes = [], refus = [];
    for (const g of groupes) {
        const non = (motif, detail = '') => refus.push({ carteId: g.carteId, set: g.set, numero: g.numero, cleR2: g.cleR2, motif, detail });
        const c = parId.get(g.carteId);
        if (!c) { non('carte-absente'); continue; }
        const memes = (c.images || []).filter(m => m && m.set === g.set && m.cleR2 === g.cleR2 && num(m.numero) === num(g.numero));
        if (memes.length !== 1) { non(memes.length ? 'entree-ambigue' : 'entree-absente', `${memes.length} entrée(s)`); continue; }
        if (portees.get(g.cleR2) !== 1) { non('cle-partagee', `la clé est portée par ${portees.get(g.cleR2)} entrées`); continue; }
        const attendus = [...g.justes, ...g.cibles.map(x => x.idProduct)].sort((a, b) => a - b), servis = [...(servisParCle.get(g.cleR2) || [])].sort((a, b) => a - b);
        // l'API sert-elle, par cette clé, EXACTEMENT les justes et les cibles ? Après une écriture partielle ou achevée, elle sert les justes et les cibles à jeton : la clé reste la même, mais les cibles sans jeton sortent
        const servisFinal = [...g.justes, ...g.cibles.filter(x => x.jeton).map(x => x.idProduct)].sort((a, b) => a - b);
        const e = memes[0];
        const deja = e.partageeTamponNonSepare === false;
        if (JSON.stringify(servis) !== JSON.stringify(attendus) && !(deja && JSON.stringify(servis) === JSON.stringify(servisFinal))) { non('servis-inattendus', `l'API sert ${servis.join(',') || 'aucun'} ; attendu ${attendus.join(',')}${deja ? ` ou ${servisFinal.join(',')}` : ''}`); continue; }
        if (e.partageeTamponNonSepare === true) { non('entree-tampon-non-separable', 'l\'entrée porte partageeTamponNonSepare: true (autre décision) — pas touchée'); continue; }
        if (e.partageeTamponNonSepare !== undefined && e.partageeTamponNonSepare !== false) { non('entree-etat-inattendu', `partageeTamponNonSepare = ${JSON.stringify(e.partageeTamponNonSepare)}`); continue; }
        if (e.partageeHoloNonHolo === true) { non('entree-holo-non-holo', 'partageeHoloNonHolo: true : l\'API ne la tient pas pour séparée par la variante'); continue; }
        if (Array.isArray(e.produitsPartages) ? e.produitsPartages.length : e.produitsPartages !== undefined && e.produitsPartages !== null) { non('entree-avec-liste', 'une liste produitsPartages existe : l\'API suit la liste, pas la variante'); continue; }
        // les lignes : justes -> normale, cibles à jeton -> jeton, cibles sans jeton -> RIEN (et elles ne doivent porter aucune variante)
        const lg = [];
        let motif = null, detail = '';
        for (const w of tableDesEcritures([g], lu).lignes) {
            const ls = cartesProduits.filter(l => l.carteId === g.carteId && l.idProduct === w.idProduct);
            if (ls.length !== 1) { motif = ls.length ? 'ligne-ambigue' : 'produit-sans-ligne'; detail = `produit ${w.idProduct} : ${ls.length} ligne(s)`; break; }
            const l = ls[0];
            if (vide(l.variante) && vide(l.variantePreuve)) lg.push({ _id: l._id, carteId: g.carteId, idProduct: w.idProduct, role: w.role, cible: w.cible, preuve: w.preuve, deja: false });
            else if (l.variante === w.cible && l.variantePreuve === w.preuve) lg.push({ _id: l._id, carteId: g.carteId, idProduct: w.idProduct, role: w.role, cible: w.cible, preuve: w.preuve, deja: true });
            else { motif = 'variante-contraire'; detail = `produit ${w.idProduct} : variante ${JSON.stringify(l.variante ?? null)}, preuve ${l.variantePreuve ? 'présente' : 'absente'} (attendu : absente, ou « ${w.cible} » avec la preuve de ce lot)`; break; }
        }
        if (!motif) for (const x of g.cibles.filter(y => !y.jeton)) {
            const ls = cartesProduits.filter(l => l.carteId === g.carteId && l.idProduct === x.idProduct);
            if (ls.some(l => !vide(l.variante))) { motif = 'cible-sans-jeton-avec-variante'; detail = `produit ${x.idProduct} porte déjà une variante : la tenir fail-closed n'est plus vrai`; break; }
        }
        if (motif) { non(motif, detail); continue; }
        entrees.push({ carteId: g.carteId, set: g.set, numero: e.numero ?? null, cleR2: g.cleR2, deja });
        lignes.push(...lg);
    }
    const sansJeton = groupes.flatMap(g => g.cibles).filter(x => !x.jeton).length;
    return { entrees, lignes, refus, comptes: { groupes: groupes.length, entrees: entrees.length, entreesDeja: entrees.filter(x => x.deja).length, lignes: lignes.length, lignesDeja: lignes.filter(l => l.deja).length,
        justes: lignes.filter(l => l.role === 'juste').length, jetons: lignes.filter(l => l.role === 'cible').length, sansJeton, refus: refus.length } };
}

/** Le plan est-il exactement celui qui a été accordé ? Rend le motif d'arrêt, ou null. */
function motifDArret(plan, { attendu, attenduTable = ATTENDU_TABLE }) {
    const k = plan.comptes;
    if (k.refus) return `${k.refus} groupe(s) refusé(s) — rien n'est écrit`;
    if (k.entrees !== attenduTable.entrees || k.justes !== attenduTable.justes || k.jetons !== attenduTable.jetons || k.sansJeton !== attenduTable.sansJeton)
        return `le plan donne ${k.entrees} entrées / ${k.justes} justes / ${k.jetons} jetons / ${k.sansJeton} cibles sans jeton au lieu de ${attenduTable.entrees} / ${attenduTable.justes} / ${attenduTable.jetons} / ${attenduTable.sansJeton} — la table n'est plus celle qui a été accordée, rien n'est écrit`;
    if (!Number.isInteger(attendu) || attendu !== k.lignes) return `--attendu=${attendu ?? 'absent'} mais ${k.lignes} ligne(s) au plan (${k.justes} justes + ${k.jetons} cibles à jeton) — rien n'est écrit`;
    return null;
}

/** L'état APRÈS écriture, en mémoire : ne modifie JAMAIS l'état reçu. */
function appliquerPlan({ cartes, cartesProduits }, plan) {
    const parCarte = new Map();
    for (const x of plan.entrees) (parCarte.get(x.carteId) || parCarte.set(x.carteId, []).get(x.carteId)).push(x);
    const ecrit = new Map(plan.lignes.map(l => [l._id, l]));
    return {
        cartes: cartes.map(c => { const xs = parCarte.get(c._id); return xs ? { ...c, images: c.images.map(m => (xs.some(x => m.set === x.set && m.cleR2 === x.cleR2 && num(m.numero) === num(x.numero)) ? { ...m, partageeTamponNonSepare: false } : m)) } : c; }),
        cartesProduits: cartesProduits.map(l => { const w = ecrit.get(l._id); return w ? { ...l, variante: w.cible, variantePreuve: w.preuve } : l; })
    };
}

const filtreEntree = (x, etat) => ({ _id: x.carteId, images: { $elemMatch: { set: x.set, cleR2: x.cleR2, numero: x.numero, ...etat } } });

/** Les écritures du plan, LIGNES D'ABORD : chaque filtre porte l'état d'avant (champ ABSENT), donc une cible déjà écrite ou modifiée par un autre ne correspond plus. Les cibles `deja` ne sont pas réécrites. */
function operationsEcriture(plan) {
    const lignes = plan.lignes.filter(l => !l.deja).map(l => ({ coll: 'cartes_produits', filter: { _id: l._id, carteId: l.carteId, idProduct: l.idProduct, variante: { $exists: false }, variantePreuve: { $exists: false } }, update: { $set: { variante: l.cible, variantePreuve: l.preuve } } }));
    const entrees = plan.entrees.filter(x => !x.deja).map(x => ({ coll: 'cartes', filter: filtreEntree(x, { partageeTamponNonSepare: { $exists: false }, produitsPartages: { $exists: false } }), update: { $set: { 'images.$.partageeTamponNonSepare': false } } }));
    return [...lignes, ...entrees];
}

/** LE MANIFESTE : exactement ce que l'écriture pose, avec l'état d'avant — c'est ce que `--retirer` relit. */
function manifeste(plan, { quoi = null, le = new Date() } = {}) {
    return { lot: LOT, quoi, le: le.toISOString(), comptes: plan.comptes,
        entrees: plan.entrees.map(x => ({ carteId: x.carteId, set: x.set, numero: x.numero, cleR2: x.cleR2, avant: 'absent', ecrit: { partageeTamponNonSepare: false }, deja: x.deja })),
        lignes: plan.lignes.map(l => ({ _id: l._id, carteId: l.carteId, idProduct: l.idProduct, role: l.role, avant: 'absent', ecrit: { variante: l.cible, variantePreuve: l.preuve }, deja: l.deja })) };
}

/** La TABLE FERMÉE des écritures, sans regarder la base : ce que ce lot pose, ligne par ligne et entrée par entrée (la source unique du plan ET du contrôle d'un manifeste). */
function tableDesEcritures(groupes, lu) {
    return {
        lignes: groupes.flatMap(g => [...g.justes.map(id => ({ carteId: g.carteId, idProduct: id, role: 'juste', cible: 'normale', preuve: preuveJuste(g, lu) })),
            ...g.cibles.filter(x => x.jeton).map(x => ({ carteId: g.carteId, idProduct: x.idProduct, role: 'cible', cible: x.jeton, preuve: preuveCible(g, x, lu) }))]),
        entrees: groupes.map(g => ({ carteId: g.carteId, set: g.set, numero: g.numero ?? null, cleR2: g.cleR2 }))
    };
}

/** Un manifeste lu sur disque est-il ce que CET outil a écrit ? (jamais une liste arbitraire à défaire : chaque ligne, sa variante ET sa preuve, chaque entrée, doivent être ceux de la table fermée). LÈVE sinon. */
function verifierManifeste(m, table) {
    if (!m || m.lot !== LOT) throw new Error(`manifeste : lot « ${m?.lot} » au lieu de « ${LOT} » — rien n'est retiré`);
    const attendus = new Map(table.lignes.map(l => [`${l.carteId}|${l.idProduct}`, l])), entreesTable = new Set(table.entrees.map(x => `${x.carteId}|${x.set}|${x.cleR2}`));
    for (const l of m.lignes || []) {
        const t = attendus.get(`${l.carteId}|${l.idProduct}`);
        if (!t || l.ecrit?.variante !== t.cible || l.ecrit?.variantePreuve !== t.preuve) throw new Error(`manifeste : la ligne ${l.carteId}|${l.idProduct} n'est pas dans la table fermée de ce lot (ou sa variante ou sa preuve diffèrent) — rien n'est retiré`);
    }
    for (const x of m.entrees || []) if (!entreesTable.has(`${x.carteId}|${x.set}|${x.cleR2}`) || x.ecrit?.partageeTamponNonSepare !== false) throw new Error(`manifeste : l'entrée ${x.carteId}|${x.set}|${x.cleR2} n'est pas dans la table fermée de ce lot — rien n'est retiré`);
    if (new Set((m.lignes || []).map(l => `${l.carteId}|${l.idProduct}`)).size !== table.lignes.length || new Set((m.entrees || []).map(x => `${x.carteId}|${x.set}|${x.cleR2}`)).size !== table.entrees.length)
        throw new Error(`manifeste : ${(m.lignes || []).length} lignes / ${(m.entrees || []).length} entrées au lieu de ${table.lignes.length} / ${table.entrees.length} (distinctes) — rien n'est retiré`);
}

/** L'état courant porte-t-il ce que le manifeste a posé ? (simulation du retrait, en mémoire). Rend la liste des écarts. */
function ecartsDuRetrait(m, { cartes, cartesProduits }) {
    const ecarts = [];
    for (const l of m.lignes) {
        const c = cartesProduits.filter(x => x.carteId === l.carteId && x.idProduct === l.idProduct);
        if (c.length !== 1 || c[0].variante !== l.ecrit.variante || c[0].variantePreuve !== l.ecrit.variantePreuve) ecarts.push(`ligne ${l.carteId}|${l.idProduct} : n'est pas dans l'état écrit par ce lot`);
    }
    for (const x of m.entrees) {
        const e = (cartes.find(c => c._id === x.carteId)?.images || []).filter(i => i && i.set === x.set && i.cleR2 === x.cleR2 && num(i.numero) === num(x.numero));
        if (e.length !== 1 || e[0].partageeTamponNonSepare !== false || (Array.isArray(e[0].produitsPartages) ? e[0].produitsPartages.length : e[0].produitsPartages != null)) ecarts.push(`entrée ${x.carteId}|${x.set}|${x.cleR2} : n'est pas dans l'état écrit par ce lot`);
    }
    return ecarts;
}

/** LE RETRAIT EXACT : ce que le manifeste a posé, rien d'autre — chaque filtre exige la valeur ÉCRITE (variante ET preuve identiques ; entrée à false, sans liste). Entrées d'abord, lignes ensuite (l'ordre inverse de l'écriture). */
function operationsRetrait(m) {
    const entrees = m.entrees.map(x => ({ coll: 'cartes', filter: filtreEntree(x, { partageeTamponNonSepare: false, produitsPartages: { $exists: false } }), update: { $unset: { 'images.$.partageeTamponNonSepare': '' } } }));
    const lignes = m.lignes.map(l => ({ coll: 'cartes_produits', filter: { _id: l._id, carteId: l.carteId, idProduct: l.idProduct, variante: l.ecrit.variante, variantePreuve: l.ecrit.variantePreuve }, update: { $unset: { variante: '', variantePreuve: '' } } }));
    return [...entrees, ...lignes];
}

/** Exécute des opérations : CHAQUE cible doit correspondre à UN document AVANT la première écriture ; le nombre modifié est relu. LÈVE sur toute divergence. */
async function executerOperations(db, ops, { attendu, quoi }) {
    if (!Number.isInteger(attendu) || attendu !== ops.length) throw new Error(`${quoi} : ${ops.length} écriture(s), attendu ${attendu} — rien n'est écrit`);
    for (const o of ops) { const n = await db.collection(o.coll).countDocuments(o.filter); if (n !== 1) throw new Error(`${quoi} : une cible est absente ou n'est pas dans l'état attendu (${n} document(s) correspondent au lieu de 1) — rien n'est écrit`); }
    let modifiees = 0;
    for (const o of ops) modifiees += (await db.collection(o.coll).updateOne(o.filter, o.update)).modifiedCount;
    if (modifiees !== ops.length) throw new Error(`${quoi} : ${modifiees} modifiée(s) sur ${ops.length} — écriture PARTIELLE, relancer (idempotent) ou --retirer`);
    return { modifiees };
}

module.exports = { LOT, VU, ATTENDU_TABLE, preuveCible, preuveJuste, tableDesEcritures, planifier, motifDArret, appliquerPlan, operationsEcriture, manifeste, verifierManifeste, ecartsDuRetrait, operationsRetrait, executerOperations };
