// ============================================================
// LA CLÉ « FRÈRES DE MÉTACARTE DANS LE MÊME SET » — fiches des produits occidentaux jamais appris (lot M2, 2026-10-13)
// ============================================================
// 🔑 LE CAS (INV-INTL, cause 2) : 289 produits intl SANS fiche, ajoutés en lot par Cardmarket (2017-11-01, 2019-01-15, 2019-10-10), jamais appris : pas de numéro,
// pas de slug, le même nom et la même métacarte que des produits DÉJÀ joints. `idMetacard` + `idExpansion` désigne les frères ; leur carte est celle du produit.
// La clé s'écrit par ce qu'elle AUTORISE, et rien d'autre (CLAUDE.md, « une garde s'écrit par ce qu'elle autorise ») :
//   (1) >= 2 FRÈRES (autres produits de même idMetacard ET de même idExpansion) joints, chacun dans le set demandé, tous à des cartes À PAGE (_id > 0) ;
//   (2) tous ces frères sur la MÊME carte ;
//   (3) cette carte est dans le set, et elle est la SEULE du set à porter ce nom (clesNom(nomJointDe), les fonctions de la jointure) ;
//   (4) deux TÉMOINS hors de la clé : le nom du produit (`temoinDuNom` de joindre()) et ses attaques (`cleAttaque`/`memeAttaque` de la production) ne
//       contredisent pas la carte. La clé ne lit PAS le nom du produit : c'est ce qui en fait un témoin.
// Tout le reste refuse et dit pourquoi. La calibration (calibration-freres-metacarte.js) est rejouée sur LA MÊME fonction — une clé ne doit accepter aucun cas
// que sa calibration ne mesure pas (leçon SEA-2) : les lignes posées par cet outil (`PREUVE`) ne sont jamais des frères (pas de preuve circulaire).
const { clesNom, nomJointDe } = require('./jointure');
const { temoinDuNom } = require('./jointure');
const { temoinAttaques } = require('./cle-setlist-metacarte');

const PREUVE = 'metacarte+freres';

/**
 * @param {Array<{idProduct:number, carteId:number, slugSet:string|null, preuve?:string}>} lignes  cartes_produits
 * @param {Map<number,{idMetacard:number|null, idExpansion:number|null}>} metaDe  l'export Cardmarket
 * @returns {Map<string, Map<number, Array<{carteId:number, slugSet:string|null}>>>}  « métacarte|expansion » -> produit -> ses lignes
 */
function indexerFreres(lignes, metaDe) {
    const idx = new Map();
    for (const l of lignes) {
        if (l.preuve === PREUVE) continue;                      // pas de preuve circulaire, et la reprise rejoue le même plan
        const e = metaDe.get(l.idProduct);
        if (!e || e.idMetacard == null || e.idExpansion == null) continue;
        const k = `${e.idMetacard}|${e.idExpansion}`;
        const g = idx.get(k) || idx.set(k, new Map()).get(k);
        (g.get(l.idProduct) || g.set(l.idProduct, []).get(l.idProduct)).push({ carteId: l.carteId, slugSet: l.slugSet ?? null });
    }
    return idx;
}

/** Les cartes d'un set, préparées une fois (`sauf` : une carte RETIRÉE du monde, calibration « vraie carte retirée »). */
function preparerSet(cartes, { slugSet, sauf = null }) {
    const gardees = cartes.filter(c => c._id !== sauf && c.nomEn);
    const parCle = new Map(), parId = new Map();
    for (const c of gardees) {
        parId.set(c._id, c);
        for (const k of clesNom(nomJointDe(c))) (parCle.get(k) || parCle.set(k, []).get(k)).push(c);
    }
    // le témoin du nom ne se construit que si une désignation arrive jusqu'à lui (la calibration prépare un set par vraie carte retirée)
    let temoin = null;
    return { slugSet, sauf: sauf ?? null, cartes: gardees, parId, parCle, get temoin() { return temoin ||= temoinDuNom(gardees); } };
}

/**
 * @param {{freres: Map, set: object}} ctx  indexerFreres(...) et preparerSet(...)
 * @param {{idProduct:number, nom:string, attaques:string[], idMetacard:number|null, idExpansion:number|null}} p  le produit décomposé
 * @param {{sauf?: number|null}} [o]  la carte retirée ; DOIT être celle de preparerSet
 * @returns {{carte: object|null, raison: string|null, niveau: number, atteint: boolean, freres: number[]}}
 *   niveau : 0 refusé avant d'évaluer les frères · 1 frères évalués (désaccord, fiche simple, autre set) · 2 frères d'accord sur une carte (le nom va être jugé)
 *   · 3 le nom du set est unique : la carte est désignée, ou refusée par un témoin (nom, attaques). `atteint` : la clé a dû CHOISIR (niveau >= 2) ; une calibration sans ce compte ne dit rien (§76).
 */
function designerParFreres({ freres, set }, p, { sauf = null } = {}) {
    if ((set.sauf ?? null) !== (sauf ?? null)) throw new Error(`designerParFreres : le set est préparé avec sauf=${set.sauf} et la désignation demande sauf=${sauf} — la calibration ne peut pas mélanger deux mondes`);
    let niveau = 0, carteDesFreres = null;
    const non = (raison, ids = []) => ({ carte: null, raison, niveau, atteint: niveau >= 2, freres: ids, carteDesFreres });
    if (p.idMetacard == null || p.idExpansion == null) return non('produit sans métacarte ou sans expansion dans l\'export');
    const groupe = freres.get(`${p.idMetacard}|${p.idExpansion}`) || new Map();
    // les frères JOINTS : leurs lignes, la carte retirée (`sauf`) n'existant plus
    const joints = [];
    for (const [id, ls] of groupe) {
        if (id === p.idProduct) continue;
        const restantes = ls.filter(l => l.carteId !== sauf);
        if (restantes.length) joints.push({ id, lignes: restantes });
    }
    const ids = joints.map(j => j.id);
    if (joints.length < 2) return non(`${joints.length} frère(s) joint(s) de même métacarte et même expansion, il en faut 2 (la calibration du danger ne mesure pas moins)`, ids);
    niveau = 1;
    const toutes = joints.flatMap(j => j.lignes);
    if (toutes.some(l => !(l.carteId > 0))) return non('un frère est joint à une fiche simple (carte sans page) : la métacarte ne désigne pas une carte à page', ids);
    if (toutes.some(l => l.slugSet !== set.slugSet)) return non(`un frère est joint dans un autre set que ${set.slugSet}`, ids);
    const cartes = [...new Set(toutes.map(l => l.carteId))];
    if (cartes.length > 1) return non(`les frères sont joints à plusieurs cartes (${cartes.length} : ${cartes.slice(0, 4).join(', ')})`, ids);
    niveau = 2; carteDesFreres = cartes[0];
    const c = set.parId.get(cartes[0]);
    if (!c) return non(`la carte ${cartes[0]} des frères est hors du set ${set.slugSet}`, ids);
    const homonymes = homonymesDe(set, c);
    if (homonymes.length) return non(`la carte ${c._id} n'est pas la seule du set à ce nom (homonyme : ${homonymes.slice(0, 4).map(x => x._id).join(', ')})`, ids);
    niveau = 3;
    // les témoins, indépendants de la clé (qui n'a lu ni le nom du produit ni ses attaques)
    const autres = set.temoin(c, p);
    if (autres) return non(`le nom du produit « ${p.nom} » désigne une autre carte du set (${autres.slice(0, 3).map(x => x._id).join(', ')}) que celle des frères (${c._id})`, ids);
    if (temoinAttaques(c, p) === 'contredit') return non(`les attaques du produit contredisent celles de la carte ${c._id}`, ids);
    return { carte: c, raison: null, niveau, atteint: true, freres: ids, carteDesFreres };
}

/** Les AUTRES cartes du set qui portent le nom de `c` (mêmes clés que la désignation) — la population du danger « homonyme » de la calibration. */
function homonymesDe(set, c) {
    const h = new Map();
    for (const k of clesNom(nomJointDe(c))) for (const x of set.parCle.get(k) || []) if (x._id !== c._id) h.set(x._id, x);
    return [...h.values()];
}

module.exports = { PREUVE, indexerFreres, preparerSet, designerParFreres, homonymesDe };
