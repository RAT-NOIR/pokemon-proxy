// ============================================================
// LA CLÉ NOM + ATTAQUES SUR TOUTE LA BASE — une définition, pour la calibration et pour l'écriture (§21 bis)
// ============================================================
// 🔑 POURQUOI (testeur, 2026-09-26, Gem Pack Vol. 3 à 6) : leurs Setlists sont des LIENS ROUGES (§43, §65 : 40 pages
// échantillonnées, 0 existe), TCGdex déclare les sets sans un fichier de carte, et aucune carte ne déclare leur tirage. Mais
// ce sont des réimpressions chinoises de cartes dont le TEXTE est déjà chez nous, et Cardmarket écrit le nom ET les attaques
// de chaque produit (« Clefable [Follow Me | More Moon] »). La clé cherche, dans la base ENTIÈRE, la carte de ce nom dont les
// attaques sont celles du produit.
// ⚠️ LE NOM EST DANS LA CLÉ, DONC IL NE PEUT PLUS RIEN TÉMOIGNER (en tête de CLAUDE.md) : la seule parade est de CALIBRER la
// clé sur une population dont on connaît la vérité (produits joints par le numéro), numéro caché — et de la rejouer VRAIE CARTE
// RETIRÉE, parce qu'un produit dont le texte n'est pas chez nous est exactement le cas où une clé souple désigne la voisine.
// Deux formes, mesurées côte à côte (calibrer-nom-attaques.js) :
//   · « egales »  : les attaques de la carte sont EXACTEMENT les crochets du produit (même ensemble de mots, sans leur ordre) ;
//   · « incluses » : toutes les attaques de la carte sont dans les crochets, qui peuvent nommer EN PLUS un talent (Bulbapedia ne
//     range pas les talents dans `attaques`, Cardmarket les met entre crochets — jointure.js, temoinDuNom).
// Une carte sans attaque n'est candidate que pour un produit sans crochets (Dresseurs, Énergies) — et le nom seul désigne
// alors souvent plusieurs cartes : elles se refusent d'elles-mêmes, un nom qui désigne plusieurs cartes ne désigne rien.
const { clesNom, nomJointDe, cleAttaque } = require('./jointure');
const { ALIAS_CARDMARKET_VERS_BULBAPEDIA } = require('./alias-noms');

/** @param {object[]} cartes documents `cartes` (nomEn, attaques.nom, niveau) @returns {Map<string, object[]>} */
function indexer(cartes) {
    const parCle = new Map();
    for (const c of cartes) {
        if (!c.nomEn) continue;
        for (const k of clesNom(nomJointDe(c))) (parCle.get(k) || parCle.set(k, []).get(k)).push(c);
    }
    return parCle;
}

// 🔴 CALIBRATION DU 2026-09-26, première version (mots triés seuls) : 66 faux sur 45 794, et 42 venaient de l'ORTHOGRAPHE — nos
// cartes écrivent « Bubble Beam » sur un texte et « Bubblebeam » sur l'autre, « Thunder Shock » / « Thundershock », « Sand
// Attack » / « Sand-attack » : la clé ne voyait pas la vraie carte et retombait sur l'autre texte du même nom. Deux attaques
// sont donc les mêmes si leurs mots triés le sont (« Gather Snow » / « Snow Gather », jointure.js) OU si elles s'écrivent pareil
// sans espace ni ponctuation.
const compact = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const formes = a => { const k = cleAttaque(a); return k ? [k, compact(a), compact(k)] : []; };
const memeAttaque = (x, y) => { const fy = formes(y); return formes(x).some(f => f && fy.includes(f)); };
const attaquesDe = c => (c.attaques || []).map(a => a.nom).filter(a => cleAttaque(a));
const crochetsDe = p => (p.attaques || []).filter(a => cleAttaque(a));

function compatible(carte, p, forme) {
    const A = attaquesDe(carte), P = crochetsDe(p);
    if (!A.length) return !P.length;
    if (!A.every(a => P.some(x => memeAttaque(a, x)))) return false;
    return forme === 'incluses' ? true : P.every(x => A.some(a => memeAttaque(a, x)));
}

const clesDuProduit = p => { const alias = ALIAS_CARDMARKET_VERS_BULBAPEDIA[p.nom]; return [...new Set([...clesNom(p.nom), ...(alias ? clesNom(alias) : [])])]; };
const memeNom = (index, p, sauf) => { const vus = new Map(); for (const k of clesDuProduit(p)) for (const c of index.get(k) || []) if (c._id !== sauf) vus.set(c._id, c); return [...vus.values()]; };

/**
 * @param {Map} index  indexer(cartes)
 * @param {{nom: string, attaques: string[]}} p  le produit décomposé (decomposerNomCardmarket)
 * @param {{forme?: 'egales'|'incluses', sauf?: number}} [o]  `sauf` : un _id de carte à ignorer (la calibration « vraie carte retirée »)
 * @returns {object[]} les cartes candidates, distinctes
 */
function candidats(index, p, { forme = 'egales', sauf = null } = {}) {
    return memeNom(index, p, sauf).filter(c => compatible(c, p, forme));
}

/**
 * LA DÉSIGNATION, avec sa garde : UNE candidate, et AUCUNE autre carte du même nom ne partage une attaque avec le produit — une
 * voisine qui en partage une est un texte proche dont les attaques ont pu être écrites autrement (Rapidash : [Overrun | Flame
 * Tail] contre [Overrun | Fire Tail | Flame Tail]). Elle ne départage pas : elle REFUSE.
 * @returns {{ carte: object|null, raison: string|null }}
 */
function designer(index, p, { forme = 'egales', sauf = null } = {}) {
    const cs = candidats(index, p, { forme, sauf });
    if (!cs.length) return { carte: null, raison: 'aucune carte de ce nom à ces attaques' };
    if (cs.length > 1) return { carte: null, raison: `${cs.length} cartes de ce nom à ces attaques` };
    const P = crochetsDe(p);
    const voisines = memeNom(index, p, sauf).filter(c => c._id !== cs[0]._id && attaquesDe(c).some(a => P.some(x => memeAttaque(a, x))));
    if (voisines.length) return { carte: null, raison: `une autre carte du même nom partage une attaque (${voisines.slice(0, 2).map(c => `${c._id} [${attaquesDe(c).join(' | ')}]`).join(' ; ')})` };
    return { carte: cs[0], raison: null };
}

// ════ LA DÉSIGNATION CROISÉE — métacarte Cardmarket ∧ nom + attaques ∧ tirage déjà imprimé (2026-09-26, Gem Packs) ════════════
// 🔴 CALIBRÉE (calibrer-nom-attaques.js), et la calibration a dit deux choses qu'il faut garder ensemble :
//   · nom + attaques SEULE, vraie carte RETIRÉE : 1,3 % des produits désignent un AUTRE texte du même nom aux mêmes attaques
//     (Koffing [Foul Gas] a deux pages). C'est le cas d'un Gem Pack dont le texte n'est pas chez nous : insuffisante seule ;
//   · la MÉTACARTE de l'export Cardmarket (`idMetacard`) — les cartes auxquelles les AUTRES produits de la métacarte sont déjà
//     joints — est une clé que le nom n'a pas écrite, mais Cardmarket l'a construite sur le nom et les attaques : croisée avec
//     elle, et avec « la carte a déjà été imprimée dans le tirage du set », le risque tombe à 21 sur 9 391 chinois ;
//   · les « faux » restants, vraie carte PRÉSENTE, OUVERTS UN PAR UN : 17 sur 19 sont des jointures par le NUMÉRO fausses chez nous
//     (Umbreon ex → Energy Sticker, Lumineon V → Mareep, Switch → Rare Candy…) que la clé contredit à raison ; les 2 vrais faux
//     sont des Dresseurs sans attaque (« Honey » = Sweet Honey, « Spikemuth » = Spikemuth Gym) : un produit SANS crochets ne se
//     désigne pas.
function indexerMetacartes(lignes, metacarteDe) {
    const parMeta = new Map();   // idMetacard → Map(idProduct → Set(carteId))
    for (const l of lignes) {
        const m = metacarteDe(l.idProduct); if (m == null) continue;
        const pm = parMeta.get(m) || parMeta.set(m, new Map()).get(m);
        (pm.get(l.idProduct) || pm.set(l.idProduct, new Set()).get(l.idProduct)).add(l.carteId);
    }
    return parMeta;
}

/**
 * @param {{index: Map, parMeta: Map, metacarteDe: (id: number) => number|null}} ctx
 * @param {{idProduct: number, nom: string, attaques: string[]}} p
 * @param {{tirage: string, sauf?: number}} o  `tirage` : celui du set (la carte doit y avoir déjà été imprimée) ; `sauf` : calibration
 * @returns {{ carte: object|null, raison: string|null }}
 */
function designerCroise({ index, parMeta, metacarteDe }, p, { tirage, sauf = null }) {
    if (!(p.attaques || []).length) return { carte: null, raison: 'produit sans attaque : le nom seul ne désigne pas (« Honey » est Sweet Honey)' };
    const m = metacarteDe(p.idProduct);
    const cartesMeta = new Set();
    for (const [id, cs] of parMeta.get(m) || []) if (id !== p.idProduct) for (const c of cs) if (c !== sauf) cartesMeta.add(c);
    if (!cartesMeta.size) return { carte: null, raison: 'métacarte : aucun autre produit joint' };
    if (cartesMeta.size > 1) return { carte: null, raison: `métacarte : ${cartesMeta.size} cartes` };
    const d = designer(index, p, { forme: 'incluses', sauf });
    if (!d.carte) return d;
    if (d.carte._id !== [...cartesMeta][0]) return { carte: null, raison: 'désaccord métacarte / nom + attaques' };
    if (tirage && !(d.carte.impressions || []).some(i => i && i.tirage === tirage)) return { carte: null, raison: `la carte n'a jamais été imprimée en ${tirage}` };
    return { carte: d.carte, raison: null };
}

module.exports = { indexer, candidats, designer, compatible, memeAttaque, indexerMetacartes, designerCroise };
