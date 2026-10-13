// ============================================================
// LA GARDE BIDIRECTIONNELLE D'UNE JOINTURE PAR LE NOM SEUL — une définition, pour la calibration et pour la collecte
// ============================================================
// Extraite de rejouer-nom-seul.js le 2026-09-24, au moment où un second appelant est apparu : la collecte « sans page »
// d'une expansion SANS AUCUN numéro (Unnumbered Promos, 4170), où le nom est la seule clé (§21 bis : deux copies d'une
// règle divergent toujours).
// La règle, énoncée avant d'avoir vu le résultat (2026-09-23) : une ligne jointe par le nom n'est gardée que si son produit
// est le SEUL produit de l'expansion à porter ce nom, ET sa carte la SEULE carte du set à le porter, ET le produit ne
// désigne qu'une carte. Multiplicités COMPTÉES, jamais un `Set` (§34).
// 🔑 CALIBRÉE SUR CE QUI MARCHE (rejouer-nom-seul.js, numéros masqués sur 55 413 jointures par le numéro) : 21 925 justes,
// 0 faux. Et DANS LES 178 SETS DE RÉIMPRESSIONS, garde passée : 9 031 justes, 0 faux — l'exclusion des réimpressions ne
// protège rien de plus une fois cette garde appliquée (mesuré le 2026-09-24).
// Une ligne jointe par un NUMÉRO (preuve contenant « numero ») n'est jamais touchée : ce n'est pas le nom qui l'a faite.
//
// 🔑 DEUX CLÉS DE PLUS, POUR QUE CE QUI A UN NOM EN DOUBLE NE SOIT PAS PERDU (lot CEL, 2026-10-13). La Classic Collection de Celebrations
// réimprime des cartes dont les noms existent déjà dans le set (Reshiram, Zekrom, Mew, Pikachu : deux, trois cartes) ; le nom seul les
// refusait toutes, à raison, et plus rien ne les désignait. Chacune des deux clés n'ajoute QUE ce qu'une donnée INDÉPENDANTE du nom
// désigne, par ce qu'elle AUTORISE :
//   · le NUMÉRO EXACT (chaîne, zéros de tête gardés) : « 002 » (tirage principal) n'est pas « 2 » (Classic Collection, Blastoise). La ligne
//     par le nom doit déjà viser la carte ; son numéro exact doit être une impression de CETTE carte dans le set cible, être porté par
//     UN seul produit et UNE seule carte du set. Le numéro peut venir de `numeros_cartes.numero`, à défaut de l'origine que le slug
//     Cardmarket écrit (`…-CELBS-4` : Base Set n°4) — jamais d'un autre champ. Il n'est fourni que par l'appelant (`exact`) : sans lui, rien ne change
//     — et il ouvre AUSSI la clé suivante : les deux rattrapages sont opt-in, la calibration de rejouer-nom-seul.js (qui n'en passe pas) reste celle d'avant.
//   · le NOM + les ATTAQUES EXACTES : deux produits de même nom dont les attaques diffèrent (Reshiram « Scorching Wind | Black Flame » et
//     « Outrage | Blue Flare »). L'ensemble des attaques du produit doit être EXACTEMENT celui de la carte, et la paire (nom, attaques)
//     doit être unique parmi les produits ET parmi les cartes. Des attaques incomplètes d'un côté ne gardent rien.
// Les deux ne s'appliquent qu'à une ligne que la garde du nom aurait REFUSÉE pour homonymie (produit ou carte) : elles ne retirent jamais
// rien, elles ne peuvent que rattraper.
const { normaliserNom, cleAttaque } = require('./jointure');

const cleNom = n => normaliserNom(String(n || '').replace(/^Basic\s+/i, ''));
const attaquesDe = as => [...new Set((as || []).map(a => cleAttaque(typeof a === 'string' ? a : a?.nom)).filter(Boolean))].sort().join('|');

/**
 * Les numéros EXACTS de l'expansion cible — fournis à la garde, jamais lus par elle ailleurs.
 * @param {{ produits: object[], cartes: object[], tirage: string, expansions: string[], deck?: string|null, code?: string|null }} x
 *        `produits` : les produits avec leurs numéros ORIGINAUX (avant tout masque) ; `code` : le code du set (« CEL »), pour lire l'origine du slug
 * @returns {{ numeroDuProduit: Map<number,string>, numerosDeCarte: Map<number,string[]>, viaSlug: Set<number> }}  `viaSlug` : les produits dont le numéro vient du slug
 */
function numerosExacts({ produits, cartes, tirage, expansions, deck = null, code = null }) {
    const slugApres = code ? new RegExp(`-${String(code).replace(/[^A-Za-z0-9]/g, '')}[A-Za-z0-9]+-(\\d{1,3})$`) : null;
    const numeroDuProduit = new Map(), viaSlug = new Set();
    for (const p of produits) {
        const propre = p.numero != null && String(p.numero).trim() !== '' ? String(p.numero).trim() : null;
        const n = propre ?? (slugApres && p.slug ? (slugApres.exec(String(p.slug)) || [])[1] : null);
        if (n) { numeroDuProduit.set(p.idProduct, n); if (!propre) viaSlug.add(p.idProduct); }
    }
    const numerosDeCarte = new Map();
    for (const c of cartes) {
        const ns = (c.impressions || []).filter(i => i.tirage === tirage && expansions.includes(i.expansion) && (!deck || i.deck === deck) && i.numero != null && String(i.numero).trim() !== '').map(i => String(i.numero).trim());
        numerosDeCarte.set(c._id, [...new Set(ns)]);
    }
    return { numeroDuProduit, numerosDeCarte, viaSlug };
}

/**
 * @param {{ lignes: object[], produits: object[], cartes: object[], exact?: { numeroDuProduit: Map, numerosDeCarte: Map }, attaquesExactes?: boolean }} x
 *        les lignes de `joindre()`, les produits de l'expansion, les cartes du set (la population entière, pas seulement les jointes) ;
 *        `exact` (facultatif) : voir `numerosExacts` — ouvre la clé du numéro exact ; `attaquesExactes` (facultatif) : ouvre la clé nom + attaques exactes
 * @returns {{ gardees: object[], refusees: { idProduct: number, raison: string }[] }}
 */
function gardeNomSeul({ lignes, produits, cartes, exact = null, attaquesExactes = false }) {
    const nProd = new Map(); for (const p of produits) { const k = cleNom(p.nom); nProd.set(k, (nProd.get(k) || 0) + 1); }
    const nCarte = new Map(); for (const c of cartes) { const k = cleNom(c.nomEn); nCarte.set(k, (nCarte.get(k) || 0) + 1); }
    const produitDe = new Map(produits.map(p => [p.idProduct, p]));
    const carteDe = new Map(cartes.map(c => [c._id, c]));
    // (nom + attaques exactes), multiplicités comptées des DEUX côtés ; une clé sans attaque n'existe pas (rien ne départage)
    const clePA = (nom, as) => { const a = attaquesDe(as); return a ? `${cleNom(nom)}#${a}` : null; };
    const nProdPA = new Map(); for (const p of produits) { const k = clePA(p.nom, p.attaques); if (k) nProdPA.set(k, (nProdPA.get(k) || 0) + 1); }
    const nCartePA = new Map(); for (const c of cartes) { const k = clePA(c.nomEn, (c.attaques || []).map(a => a.nom)); if (k) nCartePA.set(k, (nCartePA.get(k) || 0) + 1); }
    // le numéro exact : combien de produits, combien de cartes
    const nProdNum = new Map(), nCarteNum = new Map();
    if (exact) {
        for (const p of produits) { const n = exact.numeroDuProduit.get(p.idProduct); if (n) nProdNum.set(n, (nProdNum.get(n) || 0) + 1); }
        for (const c of cartes) for (const n of exact.numerosDeCarte.get(c._id) || []) nCarteNum.set(n, (nCarteNum.get(n) || 0) + 1);
    }
    const parProduit = new Map();
    for (const l of lignes) (parProduit.get(l.idProduct) || parProduit.set(l.idProduct, []).get(l.idProduct)).push(l);
    const gardees = [], refusees = [];
    for (const [idProduct, ls] of parProduit) {
        if (ls.every(l => /numero/.test(l.preuve || ''))) { gardees.push(...ls); continue; }
        const cartesDuProduit = new Set(ls.map(l => l.carteId));
        const np = nProd.get(cleNom(produitDe.get(idProduct)?.nom)) || 0;
        const nc = nCarte.get(cleNom(carteDe.get(ls[0].carteId)?.nomEn)) || 0;
        const raison = cartesDuProduit.size > 1 ? `produit joint à ${cartesDuProduit.size} cartes`
            : np !== 1 ? `nom de produit porté par ${np} produits`
            : nc !== 1 ? `nom de carte porté par ${nc} cartes` : null;
        if (!raison) { gardees.push(...ls); continue; }
        // ── le rattrapage : seulement une homonymie, seulement une ligne vers UNE carte
        // (les deux clés sont OPT-IN, UNE PAR UNE : sans `exact` ni `attaquesExactes`, la garde est exactement celle que rejouer-nom-seul.js a calibrée — 21 925 justes, 0 faux.
        //  Mesuré le 2026-10-13 sur les 16 lignes `nomSeul` : le numéro exact ne change que CEL ; nom + attaques exactes rattrape AUSSI 47 lignes d'UNP et des six Gym chinois
        //  (UNP 21, CGN 4, CGH 4, CGT 3, GTG 5, CGK 6, CGY 4) — hors du périmètre du lot, donc non activée ailleurs : c'est la table (`bulba.cles`) qui l'ouvre, ligne par ligne.)
        if ((exact || attaquesExactes) && cartesDuProduit.size === 1 && (np !== 1 || nc !== 1)) {
            const p = produitDe.get(idProduct), c = carteDe.get(ls[0].carteId);
            // (1) le NUMÉRO EXACT : une impression de cette carte, un seul produit et une seule carte du set à le porter
            const N = exact ? exact.numeroDuProduit.get(idProduct) : null;
            if (N && (exact.numerosDeCarte.get(c._id) || []).includes(N) && nProdNum.get(N) === 1 && nCarteNum.get(N) === 1) {
                gardees.push(...ls.map(l => ({ ...l, preuve: `${l.preuve}+numero-exact`, numeroFiche: N, detail: `${l.detail ?? ''} · numéro exact « ${N} »${exact.viaSlug?.has(idProduct) ? ' (origine lue dans le slug Cardmarket)' : ''} : impression de cette carte, porté par un seul produit et une seule carte du set`.trim() })));
                continue;
            }
            // (2) le NOM + les ATTAQUES EXACTES : même ensemble d'attaques des deux côtés, paire (nom, attaques) unique des deux côtés
            const kp = p ? clePA(p.nom, p.attaques) : null, kc = c ? clePA(c.nomEn, (c.attaques || []).map(a => a.nom)) : null;
            if (attaquesExactes && kp && kp === kc && nProdPA.get(kp) === 1 && nCartePA.get(kc) === 1) {
                gardees.push(...ls.map(l => ({ ...l, preuve: `${l.preuve}+attaques-exactes`, detail: `${l.detail ?? ''} · nom + attaques exactes (« ${attaquesDe(p.attaques).replace(/\|/g, ' | ')} ») uniques parmi les produits et parmi les cartes du set`.trim() })));
                continue;
            }
        }
        refusees.push({ idProduct, raison });
    }
    return { gardees, refusees };
}

module.exports = { gardeNomSeul, numerosExacts, cleNom };
