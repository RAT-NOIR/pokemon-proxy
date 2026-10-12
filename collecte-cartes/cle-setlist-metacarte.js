// ============================================================
// LA CLÉ « MÉTACARTE ∧ SETLIST DU SET » — pour les produits SANS NUMÉRO Cardmarket d'un set dont la Setlist est lue (lot SEA-2, 2026-10-12)
// ============================================================
// 🔑 LE CAS : S-P/ID, M-P/TH… ont des produits que Cardmarket ne numérote pas (« Charizard V [Claw Slash | Fire Spin] »). `joindre()` ne les
// joint pas (un nom seul désigne plusieurs pages), et `designerCroise` (cle-nom-attaques.js) les refuse : « la carte n'a jamais été imprimée
// en id » — elle ne l'est QUE dans la Setlist de Bulbapedia (§42, §61 : l'impression chinoise/asiatique vit dans la mémoire de joindre(),
// jamais sur la carte). Ici la Setlist du set DEVIENT le second élément :
//   (1) la MÉTACARTE : les autres produits de même idMetacard, déjà joints, ne désignent qu'UNE carte à page (_id > 0) ;
//   (2) la SETLIST du set (lue par entreesDeLaSetlist, numéro par numeroDeSetlist — les fonctions de production) : UNE seule carte porte ce
//       nom ET ces attaques (forme « incluses » de cle-nom-attaques.js), à UN seul numéro ;
//   (1) et (2) désignent la MÊME carte. Le numéro (numeroFiche) vient de la Setlist, jamais de Cardmarket ni du titre de la page.
// Refus (liste fermée, chacun nommé) : produit sans attaque · métacarte muette ou à plusieurs cartes · aucune carte de la Setlist à ce nom
// et ces attaques · plusieurs cartes · plusieurs numéros · entrée sans numéro · désaccord métacarte / Setlist.
// ⚠️ Le nom entre dans la clé (2) : il ne peut plus rien témoigner. La parade est la calibration du lot (calibrer-cle-setlist-metacarte.js) :
// vérité connue (produits id/th joints par le numéro), numéro caché, puis VRAIE CARTE RETIRÉE (`sauf`).
const { clesNom, nomJointDe } = require('./jointure');
const { ALIAS_CARDMARKET_VERS_BULBAPEDIA } = require('./alias-noms');
const { compatible } = require('./cle-nom-attaques');

/** @param {Array<{carte: object, numero: string|null}>} entrees les entrées de la Setlist du set, résolues en cartes à page */
const indexerSetlist = entrees => entrees.filter(e => e && e.carte && e.carte.nomEn);

const clesDuProduit = p => { const alias = ALIAS_CARDMARKET_VERS_BULBAPEDIA[p.nom]; return [...new Set([...clesNom(p.nom), ...(alias ? clesNom(alias) : [])])]; };

/**
 * @param {{parMeta: Map, metacarteDe: (id:number)=>number|null, setlist: Array}} ctx  parMeta : indexerMetacartes(lignes, metacarteDe)
 * @param {{idProduct:number, nom:string, attaques:string[]}} p  le produit décomposé
 * @param {{sauf?: number}} [o]  `sauf` : une carte à IGNORER partout (calibration « vraie carte retirée »)
 * @returns {{carte: object|null, numero: string|null, raison: string|null}}
 */
function designerParSetlist({ parMeta, metacarteDe, setlist }, p, { sauf = null } = {}) {
    // `atteint` : la clé a dû CHOISIR — la métacarte a passé (une seule carte) ET la Setlist a au moins une candidate. Une calibration qui ne compte
    // pas ses cas atteints peut afficher « 0 faux » sur des cas où la clé n'a jamais eu de choix à faire (§76, relecture A de SEA-2).
    let atteint = false;
    const non = raison => ({ carte: null, numero: null, raison, atteint });
    if (!(p.attaques || []).length) return non('produit sans attaque : le nom seul ne désigne pas (« Honey » est Sweet Honey)');
    // (1) la métacarte
    const m = metacarteDe(p.idProduct);
    const cartesMeta = new Set();
    for (const [id, cs] of parMeta.get(m) || []) if (id !== p.idProduct) for (const c of cs) if (c > 0 && c !== sauf) cartesMeta.add(c);
    if (!cartesMeta.size) return non('métacarte : aucun autre produit joint à une carte à page');
    if (cartesMeta.size > 1) return non(`métacarte : ${cartesMeta.size} cartes`);
    // (2) la Setlist du set
    const kp = clesDuProduit(p);
    const entrees = (setlist || []).filter(e => e.carte._id !== sauf && clesNom(nomJointDe(e.carte)).some(k => kp.includes(k)) && compatible(e.carte, p, 'incluses'));
    const cartes = [...new Set(entrees.map(e => e.carte._id))];
    atteint = cartes.length > 0;
    if (!cartes.length) return non('aucune carte de la Setlist de ce set à ce nom et ces attaques');
    if (cartes.length > 1) return non(`${cartes.length} cartes de la Setlist à ce nom et ces attaques`);
    if (entrees.length > 1) return non(`la Setlist range cette carte à plusieurs numéros (${entrees.length} entrées : ${entrees.map(e => e.numero ?? '—').join(', ')})`);
    if (entrees[0].numero == null || String(entrees[0].numero).trim() === '') return non('entrée de Setlist sans numéro');
    if (cartes[0] !== [...cartesMeta][0]) return non(`désaccord métacarte (${[...cartesMeta][0]}) / Setlist (${cartes[0]})`);
    return { carte: entrees[0].carte, numero: String(entrees[0].numero).trim(), raison: null, atteint };
}

/**
 * LA SETLIST DU SET, résolue en cartes : l'archive R2 de la page du set (zéro requête Bulbapedia), les entrées par `entreesDeLaSetlist`, le numéro
 * par `numeroDeSetlist` (les fonctions que la jointure et la vérification lisent), la page de chaque entrée par `collecte_etat.pages`.
 * ⚠️ le numéro vient de l'ENTRÉE (jeton + numéro), PAS du titre de la page : « Scovillain ex (Surging Sparks 37) » est la page d'une carte que la
 * Setlist de SV-P range à un autre numéro — le titre de la page est celui de son premier tirage.
 * @param {{db: object, r2: object, bucket: string, L: object}} o  `L` : la ligne de la table (slugSet, bulba) ; `r2` : collecte-cartes/r2.js
 */
async function lireSetlistDuSet({ db, r2, bucket, L }) {
    const { entreesDeLaSetlist } = require('./wikitext');
    const { jetonsDeSetlist, numeroDeSetlist } = require('./jointure');
    const set = await db.collection('sets').findOne({ _id: L.slugSet }, { projection: { 'bulba.cleR2': 1 } });
    if (!set?.bulba?.cleR2) throw new Error(`${L.slugSet} : la page du set n'est pas archivée sur R2 — la Setlist ne se lit pas`);
    const content = await r2.lireTexte(bucket, set.bulba.cleR2);
    const lec = entreesDeLaSetlist(content, L.bulba);
    const jetons = jetonsDeSetlist(lec.entrees, [].concat(L.bulba.expansion));
    const etat = await db.collection('collecte_etat').findOne({ _id: L.slugSet }, { projection: { pages: 1 } });
    const pageDe = new Map((etat?.pages || []).filter(p => p.pageid != null).map(p => [p.titre, p.pageid]));
    const ent = lec.entrees.map(e => ({ titre: e.titre, numero: numeroDeSetlist(e, jetons, L.bulba.prefixesParJeton, L.bulba.prefixesParSection), carteId: pageDe.get(e.titre) ?? null }));
    const ids = [...new Set(ent.map(e => e.carteId).filter(Boolean))];
    const cartes = new Map((await db.collection('cartes').find({ _id: { $in: ids } }, { projection: { nomEn: 1, niveau: 1, attaques: 1, impressions: 1, sets: 1 } }).toArray()).map(c => [c._id, c]));
    return {
        entrees: ent.filter(e => e.carteId && cartes.get(e.carteId)).map(e => ({ carte: cartes.get(e.carteId), numero: e.numero, titre: e.titre })),
        lues: ent.length, sansPage: ent.filter(e => !e.carteId).length, sansNumero: ent.filter(e => e.numero == null).length
    };
}

/**
 * LE PLAN D'UN SET (pur) : chaque produit non joint reçoit une carte et un numéro, ou un motif. UNE définition pour la simulation et l'écriture (§21 bis).
 * Fiche mélangée écartée : la carte montrerait deux numéros dans ce set (déjà jointe à un autre numéro, ou impression de l'expansion à un autre numéro).
 * @returns {{retenus: Array<{p, d}>, ecartes: Array<{p, d}>, refus: Array<{p, raison}>, impressions: Map<string, {p, d}>}}
 */
function planDuSet({ base, entrees, produits, lignesDuSet, jointsIds, tirage, expansion }) {
    const { cleNumero: k } = require('./jointure');
    const res = produits.filter(p => !jointsIds.has(p.idProduct)).map(p => ({ p, d: designerParSetlist({ ...base, setlist: entrees }, p) }));
    const retenus = [], ecartes = [], refus = [];
    for (const x of res) {
        if (!x.d.carte) { refus.push({ p: x.p, raison: x.d.raison }); continue; }
        const deja = lignesDuSet.filter(l => l.carteId === x.d.carte._id && l.numeroFiche != null).map(l => k(l.numeroFiche));
        const imps = (x.d.carte.impressions || []).filter(i => i && i.tirage === tirage && i.expansion === expansion);
        // une impression de l'expansion SANS numéro (posée par le parseur) : y ajouter la nôtre ferait deux impressions du même set, dont une sans numéro —
        // la fiche sans numéro et la fiche numérotée se mélangent (relecture B de SEA-2). Écarté, nommé.
        if (deja.some(n => n !== k(x.d.numero)) || imps.some(i => i.numero == null || String(i.numero).trim() === '' || k(i.numero) !== k(x.d.numero))) ecartes.push(x); else retenus.push(x);
    }
    const impressions = new Map();
    for (const x of retenus) if (!(x.d.carte.impressions || []).some(i => i && i.tirage === tirage && i.expansion === expansion && k(i.numero) === k(x.d.numero))) impressions.set(`${x.d.carte._id}|${k(x.d.numero)}`, x);
    return { retenus, ecartes, refus, impressions };
}

module.exports = { designerParSetlist, indexerSetlist, lireSetlistDuSet, planDuSet };
