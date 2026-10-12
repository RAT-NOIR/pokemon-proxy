// ============================================================
// LES SCANS JAPONAIS DU JUMEAU, REMPLACÉS PAR L'ANGLAIS PROUVÉ — la règle, pure (R5, 2026-10-12)
// ============================================================
// 🔑 DÉCISION DU TESTEUR (2026-10-12) : « Les 89 scans japonais du jumeau : remplace-les par l'anglais quand la source anglaise est prouvée (même
// impression), sous la garde. » Bulbapedia publie le scan JAPONAIS sous le nom de fichier ANGLAIS (§53-§55) ; la garde de langue du site refuse un
// scan `ja` sous un set occidental, donc le produit n'a AUCUN visuel servi (cause 5 de la mesure finale). Le remplacer par le scan anglais de la
// même impression, c'est servir le visuel du bon tirage (§19) ; le laisser, c'est un trou honnête ; servir l'autre, un mensonge.
//
// 🔑 UN REMPLACEMENT SE PROUVE PAR DEUX ÉLÉMENTS INDÉPENDANTS, JAMAIS PAR LA SEULE POSITION :
//   1. le NUMÉRO et le SET : l'adresse que fait le numéro Cardmarket du produit dans la ligne de `collecte-cartes/ptcgio.js` (set prouvé à l'œil par
//      ses témoins et sa marque, segment de numérotation couvert) — `planifierPtcgio`, la fonction de production ;
//   2. le NOM : TCGdex, au même numéro, désigne la même carte (`apparierExpansion`, qui appelle `temoinDuNom`, la fonction de `joindre()`).
//      TCGdex n'a pas l'IMAGE de ces sets (motif `tcgdex-sans-image`) mais il a le nom : c'est un témoin, pas une source de visuel.
// Ce qui ne passe pas l'un des deux reste TEL QUEL (le scan japonais, refusé par le site : un trou honnête) et le dit.
const { cleNumero: cleNumeroTcgdex } = require('./tcgdex-appariement');
// ptcgio.js (la table, le client) ne se charge qu'à l'usage : le worker lit CE module pour la préséance de Bulbapedia, et n'a pas à charger la source d'images
const ptcgio = () => require('./ptcgio');

const LOT_JUMEAU = 'ptcgio-jumeau-en-2026-10';

/** Un scan JAPONAIS sous un set occidental (tirage « intl »), fichier présent. Écrit par ce qu'il AUTORISE : `langue` doit valoir « ja » (null = inconnue : pas un jumeau prouvé). */
const scanJumeau = (entree, tirageDuSet) => tirageDuSet === 'intl' && !!entree && entree.langue === 'ja' && !!entree.cleR2;

/** La clé (carte, numéro) du témoin du nom — la MÊME normalisation que l'appariement TCGdex (zéros retirés, préfixe gardé, parenthèse finale retirée). */
const cleNom = (carteId, numero) => `${carteId}|${cleNumeroTcgdex(numero)}`;

/**
 * 🔑 LA PRÉSÉANCE DU REMPLAÇANT : les numéros d'un set servis par un scan que le rejeu de Bulbapedia ne doit pas défaire — TCGdex (anglais prouvé) et le
 * lot de remplacement (anglais prouvé de pokemontcg.io). Le lot ADDITIF n'en est pas : il ne remplace rien et n'existe que là où Bulbapedia n'a rien.
 * Une seule définition, lue par collecteur-images-bulba.js (§21 bis) : sans elle, le premier rejeu referait le scan japonais à côté de l'anglais.
 */
function numerosServisParRemplacement(entrees, slug) {
    return new Set((entrees || []).filter(e => e && e.set === slug && (e.source === 'tcgdex' || (e.source === ptcgio().SOURCE && e.lot === LOT_JUMEAU))).map(e => e.numero));
}

/**
 * Les TROUS DE REMPLACEMENT d'un set : les produits dont la carte porte, à CE numéro, un scan jumeau et AUCUN autre visuel. Chaque trou porte une copie de
 * la carte SANS son jumeau — c'est ce qui laisse `planifierPtcgio` voir un trou (son `dejaServi` ne regarde que les entrées restantes).
 * @param {{tirage: string, slug: string, lignes: Array<{carteId, idProduct, numeroFiche, numeroCm}>, cartes: Map<any, object>}} o
 */
function trousDeRemplacement({ tirage, slug, lignes, cartes }) {
    const trous = [], ecartes = [], jumeaux = new Map(), vusEcartes = new Set();
    if (tirage !== 'intl') return { trous, ecartes, jumeaux };
    // un produit sans numéro Cardmarket prend celui d'un frère de la MÊME carte et de la MÊME fiche — jamais d'une autre
    const cmDuFrere = new Map();
    for (const l of lignes) { const c = l.numeroFiche ?? l.numeroCm; if (c != null && l.numeroCm != null && !cmDuFrere.has(`${l.carteId}|${cleNumeroTcgdex(c)}`)) cmDuFrere.set(`${l.carteId}|${cleNumeroTcgdex(c)}`, l.numeroCm); }
    for (const l of lignes) {
        const carte = cartes.get(l.carteId);
        const candidat = l.numeroFiche ?? l.numeroCm;
        if (!carte || candidat == null) continue;
        const cle = cleNumeroTcgdex(candidat);
        const duSet = (carte.images || []).filter(e => e && e.set === slug);
        const aCeNumero = duSet.filter(e => e.numero == null || cleNumeroTcgdex(e.numero) === cle);
        const jum = aCeNumero.filter(e => e.numero != null && scanJumeau(e, tirage));
        if (!jum.length) continue;
        if (aCeNumero.some(e => !jum.includes(e))) {
            const k = `${carte._id}|${cle}`;
            if (!vusEcartes.has(k)) { vusEcartes.add(k); ecartes.push({ carteId: carte._id, numero: String(candidat), motif: 'deja-servi-hors-jumeau' }); }
            continue;
        }
        const numero = String(jum[0].numero);
        jumeaux.set(cleNom(carte._id, numero), jum[0]);
        trous.push({ carte: { ...carte, images: (carte.images || []).filter(e => !jum.includes(e)) }, numero, numeroFiche: l.numeroFiche ?? null,
            numeroCm: l.numeroCm ?? cmDuFrere.get(`${l.carteId}|${cle}`) ?? null, idProduct: l.idProduct, jumeaux: jum });
    }
    return { trous, ecartes, jumeaux };
}

/** Le NOM, deuxième élément : ne reste dans le plan que ce que le témoin a prouvé ; le reste devient un reste « nom-non-prouve ». Sans témoin, rien ne passe. */
function exigerLeNom(plan, prouves) {
    const gardes = [], restes = [];
    for (const p of plan) {
        if (prouves instanceof Set && prouves.has(cleNom(p.carteId, p.numero))) gardes.push(p);
        else restes.push({ carteId: p.carteId, nomEn: p.nomEn ?? null, numero: p.numero, idProduct: p.idProduct, motif: 'nom-non-prouve' });
    }
    return { plan: gardes, restes };
}

/**
 * LE PLAN DE REMPLACEMENT, pur : trous de remplacement -> adresse (numéro + set, table) -> nom (TCGdex). Chaque élément du plan porte `jumeau` (l'entrée
 * japonaise qu'il remplace, entière : un retour arrière est un rejeu) et un `numero` qui est CELUI du jumeau (le site compare les numéros de la fiche).
 */
function planifierRemplacement({ slug, tirage, lignes, cartes, numerosCm, nomsProuves }) {
    const L = lignes.map(l => ({ ...l, numeroCm: numerosCm.get(l.idProduct) ?? null }));
    const T = trousDeRemplacement({ tirage, slug, lignes: L, cartes });
    const adr = ptcgio().planifierPtcgio({ slug, trous: T.trous, tousNumerosCm: [...numerosCm.values()] });
    const N = exigerLeNom(adr.plan, nomsProuves);
    const plan = N.plan.map(p => {
        const jumeau = T.jumeaux.get(cleNom(p.carteId, p.numero));
        const numero = jumeau ? String(jumeau.numero) : p.numero;
        return { ...p, numero, jumeau, preuve: `${p.preuve} ; le NOM est confirmé au même numéro par TCGdex (témoin du nom de la jointure) ; remplace le scan japonais du jumeau (${jumeau?.source ?? '?'}, fichier ${jumeau?.cleR2 ?? '?'})` };
    });
    // les produits dont le visuel serait remplacé (plusieurs produits partagent une carte et un numéro : V1/V2, reverse) — le décompte du gain attendu
    const cles = new Set(plan.map(p => cleNom(p.carteId, p.numero)));
    const produitsRemplaces = T.trous.filter(x => cles.has(cleNom(x.carte._id, x.numero))).map(x => x.idProduct);
    return { produits: lignes.length, trous: T.trous.length, jumeaux: T.jumeaux.size, plan, restes: [...adr.restes, ...N.restes], ecartes: T.ecartes, produitsRemplaces };
}

module.exports = { LOT_JUMEAU, scanJumeau, cleNom, numerosServisParRemplacement, trousDeRemplacement, exigerLeNom, planifierRemplacement };
