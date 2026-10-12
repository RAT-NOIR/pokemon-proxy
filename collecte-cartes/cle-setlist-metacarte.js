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
const { clesNom, nomJointDe, cleAttaque, cleNumero, chiffresDuNumero } = require('./jointure');
const { ALIAS_CARDMARKET_VERS_BULBAPEDIA } = require('./alias-noms');
const { compatible, memeAttaque } = require('./cle-nom-attaques');

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
    // TOUR 3 : la clé ne désigne que ce que sa calibration MESURE. La population D (le danger) exige une métacarte à >= 2 frères joints à une carte à page ;
    // à un seul frère la relecture A' a mesuré 1 264 cas dont 1 faux de carte (Poncho Pikachu SM-P) que la calibration ne voyait pas.
    let freres = 0;
    for (const [id, cs] of parMeta.get(m) || []) if (id !== p.idProduct && [...cs].some(c => c > 0 && c !== sauf)) freres++;
    if (freres < 2) return non(`métacarte : ${freres} frère(s) joint(s), il en faut 2 (la calibration du danger ne mesure pas moins)`);
    // (2) la Setlist du set
    const kp = clesDuProduit(p);
    const entrees = (setlist || []).filter(e => e.carte._id !== sauf && clesNom(nomJointDe(e.carte)).some(k => kp.includes(k)) && compatible(e.carte, p, 'incluses'));
    const cartes = [...new Set(entrees.map(e => e.carte._id))];
    atteint = cartes.length > 0;
    if (!cartes.length) return non('aucune carte de la Setlist de ce set à ce nom et ces attaques');
    if (cartes.length > 1) return non(`${cartes.length} cartes de la Setlist à ce nom et ces attaques`);
    if (entrees.length > 1) return non(`la Setlist range cette carte à plusieurs numéros (${entrees.length} entrées : ${entrees.map(e => e.numero ?? '—').join(', ')})`);
    if (entrees[0].numero == null || String(entrees[0].numero).trim() === '') return non('entrée de Setlist sans numéro');
    // LE TÉMOIN DES ATTAQUES (tour 2) : celles du produit (entre crochets) contre celles de la carte désignée, par la comparaison de la production
    // (cleAttaque, comme temoinDuNom). Un désaccord REFUSE ; un produit ou une carte sans attaque lisible n'est pas contredit.
    if (temoinAttaques(entrees[0].carte, p) === 'contredit') return non(`les attaques du produit contredisent celles de la carte ${cartes[0]}`);
    // 🔴 LE MÉCANISME DE « SM-P Vikavolt » (tour 2) : deux pages du même texte dont l'orthographe d'attaque diffère (« Electro Cannon » / « Electricannon »)
    // sont rangées sous UNE métacarte ; la page à l'autre orthographe n'est pas « compatible », donc la clé choisissait l'autre. Un homonyme de la Setlist
    // dont une attaque est à orthographe VOISINE (sans être la même) d'une attaque du produit rend le choix indécidable : refus.
    const voisin = (setlist || []).filter(e => e.carte._id !== sauf && e.carte._id !== cartes[0] && clesNom(nomJointDe(e.carte)).some(k => kp.includes(k)))
        .find(e => (e.carte.attaques || []).some(a => (p.attaques || []).some(x => !memeAttaque(a.nom, x) && orthographeVoisine(a.nom, x))));
    if (voisin) return non(`un homonyme de la Setlist (${voisin.carte._id}) porte une attaque voisine par l'orthographe d'une attaque du produit : le choix serait une chance`);
    if (cartes[0] !== [...cartesMeta][0]) return non(`désaccord métacarte (${[...cartesMeta][0]}) / Setlist (${cartes[0]})`);
    return { carte: entrees[0].carte, numero: String(entrees[0].numero).trim(), raison: null, atteint };
}

/** Deux écritures d'attaque à deux lettres près (une fois ponctuation et casse retirées) — l'orthographe, pas l'attaque. */
const compactAttaque = a => String(a || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
function distance(a, b) {
    const m = a.length, n = b.length; if (Math.abs(m - n) > 2) return 3;
    let prev = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) { const cur = [i]; for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = cur; }
    return prev[n];
}
const orthographeVoisine = (a, b) => { const x = compactAttaque(a), y = compactAttaque(b); return x.length >= 6 && y.length >= 6 && x !== y && distance(x, y) <= 2; };

/**
 * Le témoin des attaques : 'concorde' (au moins une attaque commune), 'contredit' (les deux côtés en ont, aucune en commun), 'inconnu' (un côté n'en a pas
 * de lisible). La comparaison est celle de la production (cleAttaque : les mots sans leur ordre ; memeAttaque : orthographe sans ponctuation).
 */
function temoinAttaques(carte, p) {
    const A = (carte.attaques || []).map(a => a.nom).filter(a => cleAttaque(a)), P = (p.attaques || []).filter(a => cleAttaque(a));
    if (!A.length || !P.length) return 'inconnu';
    return A.some(a => P.some(x => cleAttaque(a) === cleAttaque(x) || memeAttaque(a, x))) ? 'concorde' : 'contredit';
}

/**
 * Comparaison de deux numéros par la production (cleNumero : préfixe gardé, zéros retirés ; chiffresDuNumero) : 'egal', 'forme' (mêmes chiffres, l'un nu
 * et l'autre préfixé : « 22 » / « SWSH022 » — la MÊME carte écrite autrement, pas une erreur de la clé), ou 'different'.
 */
function comparerNumeros(a, b) {
    const ka = cleNumero(a), kb = cleNumero(b);
    if (ka != null && ka === kb) return 'egal';
    const da = chiffresDuNumero(a), db = chiffresDuNumero(b);
    if (da == null || da !== db) return 'different';
    const nu = k => /^[A-Z-]+\d/.test(String(k));
    return nu(ka) !== nu(kb) ? 'forme' : 'different';
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
    // LA FORME DU NUMÉRO : si TOUTES les lignes numérotées du set s'écrivent d'une forme (nue, ou préfixée comme « SWSH022 ») et que la Setlist écrit
    // l'autre, le numeroFiche posé ne serait pas celui que le site compare : refus du set entier, nommé (le tour 2 : 147 « faux » de ce genre en intl).
    const numerotees = lignesDuSet.map(l => l.numeroFiche).filter(n => n != null && String(n).trim() !== '');
    const prefixee = n => /^[A-Z-]+\d/.test(String(cleNumero(n)));
    const formeDuSet = numerotees.length && numerotees.every(prefixee) ? 'prefixee' : numerotees.length && numerotees.every(n => !prefixee(n)) ? 'nue' : null;
    // LE NUMÉRO PARTAGÉ (2026-10-13, relecture de SEA-2 : Pawmi 860034 et Gastly 860035, M-P/ID) : un numéro de Setlist porté par DEUX cartes ou plus
    // dans la MÊME Setlist ne désigne aucune d'elles — c'est le pendant, côté numéro, de « un nom qui désigne plusieurs cartes ne désigne rien ». Les
    // numéros se comptent par cleNumero (« 01 » = « 1 ») et par carte DISTINCTE (une carte listée deux fois n'est pas une collision : elle est déjà
    // refusée plus haut, « plusieurs numéros »). Écrit par ce qu'il autorise : la fiche passe seulement si UNE carte, la sienne, porte le numéro.
    const cartesParNumero = new Map();
    for (const e of entrees || []) { const n = e?.numero == null ? null : k(e.numero); if (n == null || !e.carte) continue; (cartesParNumero.get(n) || cartesParNumero.set(n, new Set()).get(n)).add(e.carte._id); }
    for (const x of res) {
        if (x.d.carte && k(x.d.numero) != null) {
            const cs = cartesParNumero.get(k(x.d.numero));
            if (!cs || cs.size !== 1 || !cs.has(x.d.carte._id)) { refus.push({ p: x.p, numero: x.d.numero, garde: 'numero-partage', raison: `numéro de Setlist « ${k(x.d.numero)} » porté par ${cs ? cs.size : 0} cartes (${cs ? [...cs].join(', ') : '—'}) : il ne désigne pas ${x.d.carte._id}` }); continue; }
        }
        if (x.d.carte && formeDuSet && (formeDuSet === 'prefixee') !== prefixee(x.d.numero)) { refus.push({ p: x.p, raison: `forme du numéro : la Setlist écrit « ${x.d.numero} », les lignes du set s'écrivent ${formeDuSet === 'prefixee' ? 'préfixées (ex. ' + numerotees[0] + ')' : 'nues'}` }); continue; }
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

module.exports = { designerParSetlist, indexerSetlist, lireSetlistDuSet, planDuSet, temoinAttaques, comparerNumeros };
