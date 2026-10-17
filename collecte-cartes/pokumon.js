// ============================================================
// POKUMON (pokumon.com) — LES IMAGES RÉELLES DES PRIZE PACKS S1-S4, TAMPON VISIBLE (2026-10-17)
// ============================================================
// 🔑 DEMANDE DU TESTEUR (2026-10-17) : « Pokumon : base de promos, images. Cible : nos trous de promos ET de tamponnées. Appariement prouvé par deux éléments,
// un doute reste un trou, cadence lente, réessai borné, arrêt au premier blocage, rien de payant, aucune demande d'accord à personne. »
//
// POURQUOI LES PRIZE PACKS : une réimpression tamponnée n'a pas de visuel de SON tirage ; le substitut (`cartes_produits.visuelSubstitut`, l'image de l'impression d'origine,
// SANS tampon, avec mention) est ce que le site sert aujourd'hui. Pokumon publie des scans RÉELS de la carte tamponnée : sur les 1 286 produits S1-S4, 406 s'apparient sans doute.
// Les 213 douteux (holo et non-holo non séparables) restent des trous et gardent leur substitut. S5 à S9 sont absents de Pokumon : aucun n'entre ici.
//
// CE QUE LA SOURCE EST, MESURÉ le 2026-10-17 (S7/MESURE-OCC) : robots.txt n'interdit que /wp-admin/ (wp-json est permis) ; la page de confidentialité n'a aucune clause de copie ;
// copyright The Pokémon Company affiché, aucune condition d'usage — « aucune condition trouvée » n'est pas « autorisé » : tout visuel porte sa source, la mention et un lot
// retirable d'un geste (retirer-visuels-pokumon.js). L'index vient de l'API REST publique (≈ 9 requêtes), les images de cdn6966.templcdn.com. Ce sont des images de contributeurs :
// largeurs de 359 à 1 145 px, 129 entrées « PlaceholderCard » (rejetées et comptées).
//
// 🔑 LA CLÉ EST CELLE QUE LA MESURE A CALIBRÉE (pk-match.js, pk-final.js, pk-totaux.js), RECOPIÉE ICI EN MODULE TESTÉ : nom + numéro d'origine (lu dans le slug Cardmarket) + série ;
// UN produit et UNE entrée, sinon c'est un trou ; le dénominateur du set d'origine comme témoin indépendant (452 appariements, 0 contredit). Le numéro seul fait 15 faux sur 253 :
// le nom est indispensable. Ce module n'ajoute que des VETOS (il ne retire jamais un doute, il n'en crée aucun gain) : préfixe de numéro, langue, événement, série, une entrée réclamée
// par deux origines (Gengar de Trick or Trade 2024 contre 2022), image absente ou « placeholder ».
const T = require('./tpc');

const SOURCE = 'pokumon';
const HOTE_API = 'https://pokumon.com';
const HOTE_IMG = 'https://cdn6966.templcdn.com';
const HOTES = Object.freeze([HOTE_API, HOTE_IMG]);
const LOT = 'pokumon-2026-10';
const MENTION = T.MENTION;                                   // une seule mention pour toutes nos sources de scans (§75)
const CADENCE_MS = 5000;
const CADENCE_MIN_MS = 5000;                                 // consigne du brief : jamais moins de 5 s
const REESSAI_MS = 30000;
const PLAFOND_REQUETES = 120;                                // le plafond par défaut d'un client : l'index (≈ 11 requêtes) tient dedans
const PLAFOND_MAX = 400;                                     // ce qu'une collecte écrite peut se fixer (un fichier distinct = une requête), jamais plus
const UA = 'pokemon-proxy-catalogue/1.0 (mesure, cadence lente)';
const VERROU_GLOBAL = 'pokumon/__collecteur__';
const VERROU_GLOBAL_MS = 3 * 60 * 1000;
const ID_ALERTE = 'alerte/source-bloquee/pokumon';
const CRAWL_DELAY_MAX_S = 60;
const LANGUE_ANGLAIS = 1260;                                 // taxonomie « language » de Pokumon : English (lue le 2026-10-17)
const EVENEMENTS = Object.freeze({ 1: 7720, 2: 7721, 3: 7838, 4: 8187 });   // taxonomie « release_event » : Play Pokemon Prize Pack Series 1 à 4 (lue le 2026-10-17)

// ── LA TABLE : une ligne par série, prouvée par des images OUVERTES à l'œil (2026-10-17, 17 fichiers lus dans S7/PK-PP/img/) ────────────────────────────────────────────────
// Sur chaque image : le tampon « Play! Pokémon » est VISIBLE, le numéro imprimé et le NOM sont ceux de notre produit (slug Cardmarket). `portee` : les séries que l'entrée Pokumon nomme.
// 🔑 LES ENTRÉES COMMUNES À DEUX SÉRIES : Pokumon n'a qu'une entrée quand la carte est sortie dans deux séries. Le tampon se lit identique d'une série à l'autre — position (bas de
// l'illustration), pokéball rouge, silhouette et cadre noir — sur les images de série seule comme sur les communes, pour chacune des trois paires (1,2 · 2,3 · 3,4). Ce qu'on ne
// peut pas lire sur une image (le motif de la feuille holo d'une série à l'autre) n'est pas prouvé : c'est la réserve nommée du rapport. Une paire non écrite ici (1,3 · 2,4…) est un trou.
const t = (nom, imprime, portee) => ({ n: imprime.split('/')[0], nom, imprime, portee });
const TAMPON = 'logo « Play! Pokémon » (pokéball rouge et silhouette d\'un dresseur, cadre noir) imprimé dans le bas de l\'illustration, visible sur chaque image';
const TABLE_POKUMON = Object.freeze([
    { serie: 1, slug: 'Play-Pokemon-Prize-Pack-Series-One', evenement: 7720, communes: ['1,2'], tampon: TAMPON, lu: '2026-10-17',
      temoins: [t('Decidueye', '013/189', '1'), t('Galarian Weezing', '113/192', '1'), t('Cherrim', '008/163', '1,2'), t('Great Ball', '164/202', '1,2')] },
    { serie: 2, slug: 'Play-Pokemon-Prize-Pack-Series-Two', evenement: 7721, communes: ['1,2', '2,3'], tampon: TAMPON, lu: '2026-10-17',
      temoins: [t('Ludicolo', '034/203', '2'), t('Whimsicott VSTAR', '065/172', '2'), t('Cresselia', '064/198', '1,2'), t('Single Strike Urshifu VMAX', '086/163', '1,2'), t('Grotle', '007/172', '2,3'), t('Arceus VSTAR', '123/172', '2,3')] },
    { serie: 3, slug: 'Play-Pokemon-Prize-Pack-Series-Three', evenement: 7838, communes: ['2,3', '3,4'], tampon: TAMPON, lu: '2026-10-17',
      temoins: [t('Lance', '159/195', '3'), t('Radiant Charjabug', '051/159', '3'), t('Grotle', '007/172', '2,3'), t('Arceus VSTAR', '123/172', '2,3'), t('Sky Seal Stone', '143/159', '3,4'), t('Regieleki VMAX', '058/195', '3,4')] },
    { serie: 4, slug: 'Play-Pokemon-Prize-Pack-Series-Four', evenement: 8187, communes: ['3,4'], tampon: TAMPON, lu: '2026-10-17',
      temoins: [t('Baxcalibur', '060/193', '4'), t('Emergency Jelly', '155/195', '4'), t('Arezu', '153/196', '3,4'), t('Sky Seal Stone', '143/159', '3,4'), t('Regieleki VMAX', '058/195', '3,4')] }
].map(l => Object.freeze(l)));
const PAIRES = new Set(TABLE_POKUMON.flatMap(l => l.communes));
const ligneDe = serie => TABLE_POKUMON.find(l => l.serie === serie) ?? null;

/** Les séries d'une entrée que la table ADMET : une seule série de S1-S4, ou une paire PROUVÉE ; sinon null. Écrit par ce qu'il autorise. */
function seriesAdmises(series) {
    if (!Array.isArray(series) || !series.length || series.length > 2) return null;
    const s = [...new Set(series)].sort((a, b) => a - b);
    if (s.length !== series.length || !s.every(x => ligneDe(x))) return null;
    return s.length === 1 || PAIRES.has(s.join(',')) ? s : null;
}

// ── LA LECTURE DE L'INDEX : recopiée de pk-index.js ─────────────────────────────────────────────────────────────────────────────────────────────
const dec = s => String(s ?? '').replace(/&#8217;/g, "'").replace(/&#038;|&amp;/g, '&').replace(/&#8211;/g, '-').replace(/&#8220;|&#8221;/g, '"').replace(/&nbsp;/g, ' ').replace(/&#039;/g, "'").replace(/&eacute;/g, 'é').replace(/\s+/g, ' ').trim();
/** Une entrée brute de l'API WordPress → l'entrée que la clé lit. Ne lève pas : une forme inattendue donne des champs `null` (jamais un appariement). */
function lireEntree(c) {
    const m = ((c?._embedded || {})['wp:featuredmedia'] || [])[0] || {};
    const titre = dec(c?.title?.rendered);
    const mm = /^(.*?)\s*\(([^()]*(?:\([^()]*\)[^()]*)*)\)\s*$/.exec(titre);
    let nom = mm ? mm[1] : titre;
    const desc = mm ? mm[2] : '';
    const holo = /^Holofoil\s/.test(nom);
    nom = nom.replace(/^Holofoil\s+/, '');
    const num = /^([A-Za-z]*\d+[A-Za-z]*)(?:\/(\S+))?\s*(.*)$/.exec(desc);
    const set = num ? num[3] : desc;
    return {
        id: c?.id ?? null, titre, nom, holo, numero: num ? num[1] : null, total: num ? num[2] || null : null, set, link: c?.link ?? null,
        series: [...set.matchAll(/Prize Pack Series (\d)\b/g)].map(x => Number(x[1])),
        evenements: Array.isArray(c?.release_event) ? c.release_event : [], anglais: Array.isArray(c?.language) && c.language.includes(LANGUE_ANGLAIS),
        img: m.source_url ?? null, w: m.media_details?.width ?? null, h: m.media_details?.height ?? null
    };
}
const estPlaceholder = e => !e?.img || /placeholder/i.test(e.img);
/** L'index : une entrée par identifiant (une carte S1/S2 est listée sous les deux événements). */
function construireIndex(brutes) {
    const vues = new Map();
    for (const c of brutes) { const e = lireEntree(c); if (e.id != null && !vues.has(e.id)) vues.set(e.id, e); }
    return [...vues.values()];
}

// ── LA CLÉ : recopiée de pk-match.js / pk-final.js / pk-totaux.js ───────────────────────────────────────────────────────────────────────────────
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[’']/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
const nomNu = s => String(s || '').replace(/\s*\[.*$/, '');
/** Le numéro sans préfixe de lettres ni zéros de tête, suffixe d'une lettre gardé en minuscule (la fonction de la mesure). */
function cleMesure(n) { const m = /^([A-Za-z]*)0*(\d+)([a-zA-Z]?)$/.exec(String(n || '').trim()); return m ? m[2] + m[3].toLowerCase() : null; }
/** Le nom côté Pokumon : sans le préfixe du programme, sans « Holofoil », normalisé. */
function nomPokumon(e) {
    let n = e.nom;
    n = n.replace(/^(Play Pokemon|Trick or Trade|Professor Program|Staff|Non-holo|Non Holo|Reverse Holo|Holofoil)\s+/gi, '').replace(/^(Play Pokemon|Staff)\s+/gi, '');
    n = n.replace(/\s+\d+\s+Stamp\s+/i, ' Stamp ').replace(/^(Pikachu|Charizard|Mewtwo)\s+(\d+\s+)?Stamp\s+/i, '');
    return norm(n);
}
/**
 * Le numéro d'ORIGINE d'un produit, lu dans le slug Cardmarket (« Kricketune-V-PPS1BST-006 » : set d'origine BST, n° 006). `code` : le code d'origine (l'élément qui précède le numéro, ou le
 * préfixe de lettres collé au numéro) ; `prefixe` : les lettres collées au numéro (TG29, SWSH041). Un dernier élément qui est un CODE de série (« …-PPS1 ») n'est pas un numéro : null.
 */
function numeroOrigine(slugProduit) {
    const t = String(slugProduit || '').split('-'), last = t[t.length - 1] || '';
    if (/^PPS\d+$/.test(last)) return null;
    const m = /^([A-Za-z]*?)0*(\d+)([a-z]?)$/.exec(last);
    return m && t.length > 2 ? { n: m[2] + m[3], code: m[1] || (t[t.length - 2] || ''), prefixe: m[1] } : null;
}
// 🔑 Cardmarket écrit « BTS » (S1 seulement : Orbeetle 065, les quatre Urshifu 085-088) là où il écrit « BST » (58 produits) pour Battle Styles. Preuves, lues le 2026-10-17 : notre table des codes
// (`codes_set`) ne connaît que BST pour Battle Styles (idExpansion 3675) ; les cinq produits BTS portent des numéros imprimés /163, comme les BST ; les mêmes quatre Urshifu sont écrits BST
// en S2 et s'apparient à la MÊME entrée Pokumon que leur version BTS de S1 (image ouverte à l'œil : Single Strike Urshifu VMAX 086/163). Sans cet alias, le témoin « une entrée, une origine » écarterait
// ces neuf produits à tort. La table est ÉNUMÉRÉE : un code qui n'y est pas reste lui-même.
const ALIAS_CODES = Object.freeze({ BTS: 'BST' });
const codeOrigine = code => { const c = String(code || '').replace(/^PPS\d/, '').replace(/^BOO\d*/, ''); return Object.hasOwn(ALIAS_CODES, c) ? ALIAS_CODES[c] : c; };
const prefixeDuNumero = n => (/^([A-Za-z]*)/.exec(String(n ?? '')) || [])[1] || '';

/**
 * TÉMOIN 1 : une entrée Pokumon désigne UN tirage d'origine. Si deux produits d'origines différentes (codes différents) la réclament, aucun des deux n'est prouvé — c'est ce qui sépare
 * Gengar de Trick or Trade 2022 (CRE 057/198) de celui de 2024 (PAF 057/198). `items` : { idProduct, entree, code }. Rend { idProduct, motif? } pour chacun.
 */
function temoinsDeLEntree(items) {
    const codes = new Map();
    for (const x of items) (codes.get(x.entree.id) || codes.set(x.entree.id, new Set()).get(x.entree.id)).add(x.code);
    return items.map(x => (codes.get(x.entree.id).size > 1 ? { idProduct: x.idProduct, motif: 'entree-revendiquee-par-deux-origines' } : { idProduct: x.idProduct }));
}
/**
 * TÉMOIN 2 : le DÉNOMINATEUR du set d'origine (« /163 »). Pour un même code d'origine, les entrées appariées doivent porter le même dénominateur ; celui qui contredit la majorité est écarté, un
 * code avec UN seul apparié n'a pas de second témoin (non vérifiable : trou), une égalité de majorités ne tranche pas. `items` : { idProduct, code, entree: { total } }.
 */
function denominateurDuCode(items) {
    const parCode = new Map();
    for (const x of items) { const m = parCode.get(x.code) || parCode.set(x.code, new Map()).get(x.code); m.set(x.entree.total, (m.get(x.entree.total) || 0) + 1); }
    return items.map(x => {
        const m = parCode.get(x.code), n = [...m.values()].reduce((a, b) => a + b, 0);
        if (n < 2) return { idProduct: x.idProduct, motif: 'code-sans-second-temoin' };
        const tri = [...m].sort((a, b) => b[1] - a[1]);
        if (tri.length > 1 && tri[0][1] === tri[1][1]) return { idProduct: x.idProduct, motif: 'denominateur-ambigu' };
        return x.entree.total === tri[0][0] ? { idProduct: x.idProduct, temoin: `dénominateur /${tri[0][0]} : ${n} appariements du code ${x.code}, tous à /${tri[0][0]}` } : { idProduct: x.idProduct, motif: 'denominateur-contredit' };
    });
}

// ── PP-HOLO (2026-10-17) : le scan tamponné sert les DEUX produits holo et non-holo d'une carte Prize Pack ─────────────────────────────────────────────────────────────────────────────
// 🔑 DÉCISION DU TESTEUR : « le scan tamponné de Pokumon sert les DEUX produits (holo et non-holo). Ce n'est pas l'image d'une autre impression : même carte, même tampon, seul le brillant
// diffère et aucun scan ne le montre. Marque ces images « partagée holo/non-holo » (champ explicite), pour que l'API ne tente jamais de trancher le brillant par l'image. »
// 🔴 La décision couvre UNE différence — holo / non-holo — et rien d'autre : un groupe n'est résolu que si TOUT ceci est vrai (écrit par ce qu'il AUTORISE ; le reste est un trou NOMMÉ) :
//   · EXACTEMENT deux produits (une carte, un set : `carteId` et `slugSet` fournis et identiques), même nom Cardmarket, slugs identiques à V1 / V2 près ;
//   · EXACTEMENT deux entrées Pokumon : l'une « Holofoil », l'autre non, même nom, même numéro, même total, même texte de set, la série du produit dans les DEUX entrées et dans leurs événements ; aucun « Reverse » ;
//   · l'entrée choisie passe ensuite tous les vetos et témoins habituels (placeholder, langue, préfixe, séries, événements, une origine, dénominateur).
// RÈGLE DE CHOIX, écrite et déterministe : la NON-holo. Le scan holo porte le brillant CUIT dans l'image (visible sur Drizzile) : servi au produit non-holo il affirmerait un brillant qui n'y est
// pas ; le scan plat servi au produit holo omet seulement le brillant, ce que la décision accepte. (Contrepartie nommée au rapport : la non-holo est souvent plus étroite, 576 px en médiane.)
const MOTIF_HOLO = Object.freeze({ carte: 'holo-carte-non-prouvee', forme: 'holo-forme-non-prouvee', reverse: 'holo-reverse', series: 'holo-series-differentes', evenements: 'holo-evenements-differents', mot: 'holo-mot-autre' });
const sansSeries = s => String(s ?? '').replace(/Play Pokemon Prize Pack Series \d/g, '').replace(/[,\s]+/g, ' ').trim();
/**
 * Le CŒUR de la règle, commun aux Prize Packs et aux promos Black Star (BS-HOLO, 2026-10-17) : UN couple holo / non-holo, et rien d'autre. `regle` dit ce qui change d'une famille à l'autre :
 *   · `setDe(p)` : le set Cardmarket du produit ; `lireSlug(p)` : { base, v } — le slug sans son jeton V1 / V2 — ou null ; `portee(a, h, e)` : la preuve que les deux entrées sont de la MÊME impression
 *     (les séries du Prize Pack ; les événements des promos) ; `motsAutres` : les mots de tampon / d'événement qui font d'un groupe autre chose qu'un brillant (aucun pour les Prize Packs : inchangés).
 * Écrit par ce qu'il AUTORISE : tout ce qui n'est pas exactement un couple pur sort avec son motif nommé.
 */
function coupleHoloNonHolo(g, c, regle) {
    if (g.length !== 2 || c.length !== 2) return { motif: 'douteux-variantes-non-separables' };
    const [a, b] = g.map(r => r.p);
    if (a.carteId == null || a.carteId !== b.carteId || regle.setDe(a) == null || regle.setDe(a) !== regle.setDe(b)) return { motif: MOTIF_HOLO.carte };
    const reverse = c.some(e => /reverse/i.test(e.titre));
    // les promos : le MOT de tampon se cherche d'abord (le motif nomme la vraie différence, même quand le slug est aussi de forme inattendue) ; les Prize Packs gardent leur ordre
    if (regle.motsAutres) {
        if (reverse) return { motif: MOTIF_HOLO.reverse };
        if (c.some(e => regle.motsAutres.test(`${e.titre} ${e.set}`)) || g.some(r => regle.motsAutres.test(`${nomNu(r.p.nomCm)} ${String(r.p.slugProduit ?? '').replace(/-/g, ' ')}`))) return { motif: MOTIF_HOLO.mot };
    }
    const [ma, mb] = [regle.lireSlug(a), regle.lireSlug(b)];
    if (!ma || !mb || ma.base !== mb.base || a.nomCm !== b.nomCm || [ma.v, mb.v].sort().join() !== 'V1,V2') return { motif: MOTIF_HOLO.forme };
    if (reverse) return { motif: MOTIF_HOLO.reverse };
    const hs = c.filter(e => e.holo), ps = c.filter(e => !e.holo);
    if (hs.length !== 1 || ps.length !== 1) return { motif: MOTIF_HOLO.forme };
    const [h, e] = [hs[0], ps[0]];
    if (h.nom !== e.nom || h.numero !== e.numero || h.total !== e.total || sansSeries(h.set) !== sansSeries(e.set)) return { motif: MOTIF_HOLO.forme };
    const p = regle.portee(a, h, e);
    if (p) return { motif: p };
    return { entree: e, holo: h, produits: [a.idProduct, b.idProduct].sort((x, y) => x - y) };
}
// PRIZE PACKS : 🔑 décision du coordinateur (tour 1) : le tampon est identique d'une série à l'autre (PK-PP, paires 1-2, 2-3, 3-4) ; deux ensembles de séries différents ne font donc pas une autre impression.
// La condition : les DEUX entrées contiennent la série du produit ET leurs événements portent cette série.
const REGLE_PRIZE_PACK = Object.freeze({
    setDe: p => p.slugSet,
    lireSlug: p => { const m = /^(.*)-(V\d+)-([^-]+-[^-]+)$/.exec(String(p.slugProduit ?? '')); return m ? { base: `${m[1]}-${m[3]}`, v: m[2] } : null; },
    portee: (a, h, e) => ([h, e].every(x => x.series.includes(a.serie) && x.evenements.includes(EVENEMENTS[a.serie])) ? null : MOTIF_HOLO.series),
    motsAutres: null
});
/**
 * Un groupe (série, nom, numéro d'origine) qui a autant de produits que d'entrées : est-ce UN couple holo / non-holo ? `g` : les enregistrements de l'apparieur ({ p, nm }) ; `c` : ses entrées.
 * @returns {{ entree: object, holo: object, produits: number[] } | { motif: string }}
 */
const groupeHoloNonHolo = (g, c) => coupleHoloNonHolo(g, c, REGLE_PRIZE_PACK);

// BS-HOLO (2026-10-17) : MÊME décision du testeur, étendue aux lignes Black Star SWSH, SVP, MEP — et à elles seules. 🔴 Les promos ont d'autres variantes que le brillant : le tampon Staff, le tampon Play! Pokémon,
// Cosmos, Prerelease, un événement… Un couple n'est donc admis que si TOUT le reste est identique : les mêmes mots (aucun mot de tampon d'aucun côté, `motsAutres`), le même texte de set, et EXACTEMENT les mêmes
// événements. Le jeton V1 / V2 du slug peut se trouver n'importe où (« Mimikyu-ex-V1-SVPen004 », « Galarian-Rapidash-V-V1 ») ; un seul jeton par slug, sinon rien n'est prouvé.
const MOTS_AUTRES_BSP = /\b(staff|cosmos|stamp(?:ed)?|pre-?release|winner|champions?|championships?|worlds?|play!? ?pok[eé]mon|pok[eé]mon center|league|regionals?|nationals?|event|exclusive|jumbo|oversize|cracked ice|gamestop|build ?& ?battle|reverse)\b/i;
const REGLE_BLACK_STAR = Object.freeze({
    setDe: p => p.unite,
    lireSlug: p => { const s = String(p.slugProduit ?? ''), m = [...s.matchAll(/-(V\d+)(?=-|$)/g)]; return m.length === 1 ? { base: s.replace(m[0][0], ''), v: m[0][1] } : null; },
    portee: (a, h, e) => { const k = x => [...x.evenements].sort((p, q) => p - q).join(); return h.evenements.length && k(h) === k(e) ? null : MOTIF_HOLO.evenements; },
    motsAutres: MOTS_AUTRES_BSP
});
const groupeHoloNonHoloBlackStar = (g, c) => coupleHoloNonHolo(g, c, REGLE_BLACK_STAR);

/**
 * L'APPARIEMENT, pur. `produits` : { idProduct, serie (1-4), nomCm (catalogue_produits.name), slugProduit (numeros_cartes.slug), carteId, slugSet (seulement pour la décision PP-HOLO) } ; `index` : des entrées lues (lireEntree).
 * Rend un verdict par produit (« prouve » + l'entrée, ou « reste » + son MOTIF) et des comptes. Un produit n'est prouvé que si TOUT ceci est vrai : un seul produit et une seule entrée de
 * son groupe (nom, numéro d'origine, série) ; l'image n'est pas un placeholder ; l'entrée est anglaise ; son numéro a le même préfixe ; ses séries sont admises par la table ET portées par ses
 * événements ; aucune autre origine ne la réclame ; le dénominateur du set d'origine concorde (au moins deux appariés).
 */
function apparier({ produits, index }) {
    const idx = new Map();
    for (const e of index) { const k = `${nomPokumon(e)}|${cleMesure(e.numero)}`; (idx.get(k) || idx.set(k, []).get(k)).push(e); }
    const recs = produits.map(p => {
        const nm = numeroOrigine(p.slugProduit);
        const cands = nm ? (idx.get(`${norm(nomNu(p.nomCm))}|${cleMesure(nm.n)}`) || []).filter(e => e.series.includes(p.serie)) : [];
        return { p, nm, cands, motif: nm ? null : 'sans-numero-origine' };
    });
    const groupes = new Map();
    for (const r of recs) if (r.nm) { const k = [r.p.serie, nomNu(r.p.nomCm).toLowerCase(), r.nm.n].join('|'); (groupes.get(k) || groupes.set(k, []).get(k)).push(r); }
    let placeholders = 0;
    for (const g of groupes.values()) {
        const c = g[0].cands;
        let statut = !c.length ? 'non-couvert' : g.length === 1 && c.length === 1 ? 'couvert' : g.length === c.length ? 'douteux-variantes-non-separables' : 'douteux-multiplicite';
        let entree = c[0], holo = null;
        // PP-HOLO : deux produits V1/V2 et deux entrées Holofoil / non-Holofoil d'une MÊME carte — la seule différence que la décision du testeur couvre
        if (statut === 'douteux-variantes-non-separables') {
            holo = groupeHoloNonHolo(g, c);
            if (holo.entree) { statut = 'couvert'; entree = holo.entree; for (const r of g) { r.groupe = g; r.partagee = holo.produits; r.holoIgnoree = holo.holo; } }
            else statut = holo.motif;
        }
        for (const r of g) {
            if (statut !== 'couvert') { r.motif = statut; continue; }
            const e = entree;
            r.entree = e;
            if (estPlaceholder(e)) { r.motif = 'placeholder'; placeholders++; }
            else if (!e.anglais) r.motif = 'langue';
            else if (prefixeDuNumero(e.numero).toLowerCase() !== String(r.nm.prefixe || '').toLowerCase()) r.motif = 'prefixe-contredit';
            else if (!seriesAdmises(e.series)) r.motif = 'serie-non-prouvee';
            else if (!e.series.every(s => e.evenements.includes(EVENEMENTS[s]))) r.motif = 'evenement-contredit';
        }
    }
    // les témoins indépendants, sur ce qui a passé les vetos
    let vivants = recs.filter(r => r.entree && !r.motif).map(r => ({ idProduct: r.p.idProduct, entree: r.entree, code: codeOrigine(r.nm.code), r }));
    for (const w of temoinsDeLEntree(vivants)) if (w.motif) { const x = recs.find(r => r.p.idProduct === w.idProduct); x.motif = w.motif; }
    vivants = vivants.filter(x => !x.r.motif);
    // 🔑 un groupe holo / non-holo COMPTE UNE FOIS pour le dénominateur du code : ses deux produits sont une seule entrée, et deux appariements fabriqués par le groupe lui-même seraient un témoin qui se
    // confirme lui-même. Le verdict (motif ou témoin) s'applique ensuite aux DEUX produits.
    const deja = new Set();
    const pourDenominateur = vivants.filter(x => { if (!x.r.groupe) return true; if (deja.has(x.r.groupe)) return false; deja.add(x.r.groupe); return true; });
    for (const w of denominateurDuCode(pourDenominateur)) {
        const x = recs.find(r => r.p.idProduct === w.idProduct);
        for (const m of x.groupe || [x]) { if (w.motif) m.motif = w.motif; else m.temoin = w.temoin; }
    }
    const placeholdersIndex = index.filter(estPlaceholder).length;
    const resultats = recs.map(r => (r.motif || !r.entree
        ? { idProduct: r.p.idProduct, verdict: 'reste', motif: r.motif ?? 'non-couvert' }
        : { idProduct: r.p.idProduct, verdict: 'prouve', entree: r.entree, serie: r.p.serie, numeroOrigine: r.nm, temoin: r.temoin,
            ...(r.partagee ? { partageeHoloNonHolo: true, produitsPartages: r.partagee, entreeHoloIgnoree: r.holoIgnoree } : {}) }));
    const parMotif = {};
    for (const r of resultats) if (r.verdict === 'reste') parMotif[r.motif] = (parMotif[r.motif] || 0) + 1;
    return { resultats, comptes: { produits: produits.length, prouves: resultats.filter(r => r.verdict === 'prouve').length, placeholders, placeholdersIndex, parMotif } };
}

// ============================================================
// LES AUTRES FAMILLES (lot PK-AUTRES, 2026-10-17) — McDonald's, Trick or Trade, Professor Program, Black Star, variantes « a »
// ============================================================
// 🔑 MÊME CLÉ QUE LES PRIZE PACKS (nom + numéro d'origine + UN produit / UNE entrée), MÊMES VETOS, et un TÉMOIN INDÉPENDANT qu'on avait déjà en base : les IMPRESSIONS de la carte du produit
// (cartes.impressions : numéro et total imprimés, lus chez TCGdex/Bulbapedia, jamais chez Pokumon). C'est lui qui sépare le Gengar de Trick or Trade 2022 (Chilling Reign 057/198) de celui de
// 2024 (Paldean Fates 057/091), même nom, même numéro. Une ligne de table = UNE famille et UNE année ou série, prouvée par des images OUVERTES à l'œil.
const sDuFichier = e => { const m = /\/EN_S(\d+)[A-Za-z]/.exec(e?.img || ''); return m ? Number(m[1]) : null; };
const dansPlage = (n, plage) => Array.isArray(plage) && n != null && n >= plage[0] && n <= plage[1];
const total0 = t => String(t ?? '').replace(/^0+(?=\d)/, '');
const lettres = n => (/^([A-Za-z]*)/.exec(String(n ?? '')) || [])[1] || '';
/** Trick or Trade : l'année que l'entrée dit d'elle-même (« BOOster Bundle 2023 exclusive » = 2023 ; « BOOster Bundle exclusive » seul = 2022) ; null quand elle n'en dit aucune. */
const anneeToT = e => { const m = /BOOster Bundle (\d{4}) exclusive/.exec(e.set); return m ? Number(m[1]) : /BOOster Bundle exclusive/.test(e.set) ? 2022 : null; };
const code0 = code => String(code || '').replace(/^PPP/, '').replace(/^BOO\d*/, '').replace(/^PPS\d/, '');
/** Les règles de famille : ce que la famille lit du produit (`produit`), ce qui peut le désigner (`entree`), et le témoin de la carte (`impression`). Écrites par ce qu'elles AUTORISENT. */
const REGLES = Object.freeze({
    mcd: {
        produit: p => { const n = cleMesure(p.numero); return n ? { n, code: '', prefixe: lettres(p.numero).toLowerCase() } : null; },
        entree: (e, l) => /McDonald/.test(e.set) && e.total === l.total && dansPlage(sDuFichier(e), l.plageS),
        placeholder: (e, l) => /McDonald/.test(e.set) && e.total === l.total && estPlaceholder(e),
        impression: 'mcd'
    },
    tot: {
        produit: p => numeroOrigine(p.slugProduit),
        entree: (e, l) => /Trick or Trade/.test(`${e.set} ${e.titre}`) && [null, l.annee].includes(anneeToT(e)),
        anneeProduit: p => (/-BOO(\d\d)[A-Z]/.exec(p.slugProduit || '') ? 2000 + Number(/-BOO(\d\d)[A-Z]/.exec(p.slugProduit)[1]) : 2022),
        impression: true
    },
    prof: {
        produit: p => numeroOrigine(p.slugProduit),
        entree: e => /Professor (Program|Stamp)|Professor University|"Professor Program" stamp/.test(e.set) && !/Excellence Award|Professor Cup/.test(e.set),
        impression: true
    },
    bsp: {
        produit: (p, l) => { const n = cleMesure(p.numero ?? (/-[A-Z]*?(\d+[a-z]?)$/.exec(p.slugProduit || '') || [])[1]); return n ? { n, code: '', prefixe: (lettres(p.numero) || l.prefixe).toUpperCase() } : null; },
        entree: (e, l) => /English Promo/.test(e.set) && lettres(e.numero).toUpperCase() === l.prefixe,
        impression: 'bsp'
    }
    // ⛔ « a » (variantes de promotion à numéro à lettre : 124a, 152b…) N'EST PAS UNE FAMILLE DE CETTE TABLE : mesuré le 2026-10-17, le site n'a AUCUNE fiche pour ces produits (l'impression « 124a/145 » vit sous
    // « Yellow A Alternate cards », pas sous le set Cardmarket) ; poser une image ne servirait aucun produit. Voir le rapport PK-AUTRES.
});
/**
 * Le témoin de la carte : une de ses impressions porte ce numéro (et ce total) imprimés — lus chez TCGdex/Bulbapedia, jamais chez Pokumon. Rend { etat: 'concorde' | 'contredit' | 'absent', numero }
 * où `numero` est le numéro de l'impression telle qu'écrite chez nous (celui de la FICHE : « 033 » pour MEP033, « 009 » pour 9/15).
 * mode 'mcd' : l'impression est celle du millésime de la ligne (`l.expansionImpression`, « McDonald's Collection 2017 »), numéro ET total ; 'bsp' : une impression « … Black Star Promos » au même numéro ;
 * true : numéro ET total, n'importe quelle impression.
 */
function temoinImpression(mode, p, e, l = {}) {
    const imps = Array.isArray(p.impressions) ? p.impressions : [];
    const memeNumero = imps.filter(i => cleMesure(i.numero) === cleMesure(e.numero) && (mode === 'mcd' ? (l.expansionsImpression || []).includes(i.expansion) : mode !== 'bsp' || String(i.expansion || '').startsWith(`${l.prefixe} Black Star`)));
    if (!memeNumero.length) return { etat: 'absent', numero: null };
    if (mode === 'bsp') return { etat: 'concorde', numero: memeNumero[0].numero };
    // McDonald's : certaines impressions n'ont pas de total (« McDonald s Collection 2018 2 ») ; l'absence d'un total ne contredit pas, un AUTRE total contredit
    const bonne = memeNumero.find(i => (mode === 'mcd' && (i.total == null || i.total === '')) || total0(i.total) === total0(e.total));
    return bonne ? { etat: 'concorde', numero: bonne.numero } : { etat: 'contredit', numero: null };
}
/** Les lignes d'un set Cardmarket. Deux FAMILLES sur un même set sont une erreur de table (on ne choisit pas entre deux règles). */
function lignesDuSet(lignes, unite) {
    const ls = lignes.filter(l => l.slugs.includes(unite));
    if (new Set(ls.map(l => l.famille)).size > 1) throw new Error(`${SOURCE} : le set « ${unite} » est revendiqué par deux familles (${[...new Set(ls.map(l => l.famille))].join(', ')}) — erreur de table`);
    return ls;
}

/**
 * L'APPARIEMENT des autres familles, pur. `lignes` : la table (une par famille et année/série) ; `produits` : { idProduct, unite (slug du set Cardmarket), nomCm, slugProduit, numero, impressions } ;
 * `index` : des entrées lues. Rend un verdict par produit (« prouve » + l'entrée, ou « reste » + son MOTIF) et des comptes. Un produit n'est prouvé que si : sa ligne existe ; un seul produit et
 * une seule entrée dans son groupe (nom, numéro, set) ; l'entrée est admise par la ligne (année, plage, descripteur, total) ; l'image n'est pas un placeholder ; elle est anglaise ; son préfixe
 * de numéro concorde ; aucune autre origine ne la réclame ; et la carte du produit porte, dans ses impressions, ce numéro et ce total (le témoin indépendant de la clé).
 */
function apparierFamille({ lignes, produits, index }) {
    const recs = produits.map(p => {
        const ls = lignesDuSet(lignes, p.unite);
        if (!ls.length) return { p, motif: 'ligne-absente' };
        const R = REGLES[ls[0].famille];
        const nm = R.produit(p, ls[0]);
        if (!nm) return { p, l: ls[0], motif: 'sans-numero-origine' };
        const nom = norm(nomNu(p.nomCm));
        const memes = index.filter(e => e.numero && cleMesure(e.numero) === cleMesure(nm.n) && nomPokumon(e) === nom);
        const reels = ls.flatMap(l => memes.filter(e => !estPlaceholder(e) && R.entree(e, l)).map(e => ({ e, l })));
        const phs = reels.length ? [] : ls.flatMap(l => memes.filter(e => R.placeholder?.(e, l)).map(e => ({ e, l })));
        return { p, l: ls[0], R, nm, cands: reels.length ? reels : phs, nom };
    });
    const groupes = new Map();
    for (const r of recs) if (r.nm) { const k = [r.p.unite, r.nom, r.nm.n].join('|'); (groupes.get(k) || groupes.set(k, []).get(k)).push(r); }
    let placeholders = 0;
    for (const g of groupes.values()) {
        const c = g[0].cands;
        let statut = !c.length ? 'non-couvert' : g.length === 1 && c.length === 1 ? 'couvert' : g.length === c.length ? 'douteux-variantes-non-separables' : 'douteux-multiplicite';
        let choisi = c[0], holo = null;
        // BS-HOLO : les SEULES lignes Black Star (famille « bsp ») résolvent un couple holo / non-holo, par le même cœur que les Prize Packs ; les autres familles gardent leur doute
        if (statut === 'douteux-variantes-non-separables' && g.every(r => r.l?.famille === 'bsp') && c.every(x => x.l?.famille === 'bsp')) {
            holo = groupeHoloNonHoloBlackStar(g, c.map(x => x.e));
            if (holo.entree) { statut = 'couvert'; choisi = c.find(x => x.e === holo.entree); for (const r of g) { r.groupe = g; r.partagee = holo.produits; r.holoIgnoree = holo.holo; } }
            else statut = holo.motif;
        }
        for (const r of g) {
            if (statut !== 'couvert') { r.motif = statut; continue; }
            const e = choisi.e;
            r.l = choisi.l;
            r.entree = e;
            if (estPlaceholder(e)) { r.motif = 'placeholder'; placeholders++; }
            else if (!e.anglais) r.motif = 'langue';
            else if (r.l.famille !== 'mcd' && prefixeDuNumero(e.numero).toLowerCase() !== (r.nm.prefixe ?? '').toLowerCase()) r.motif = 'prefixe-contredit';
            else if (r.l.famille === 'tot' && REGLES.tot.anneeProduit(r.p) !== r.l.annee) r.motif = 'annee-contredite';
            else {
                const t = temoinImpression(r.R.impression, r.p, e, r.l);
                if (t.etat !== 'concorde') r.motif = `impression-${t.etat}`;
                else { r.temoin = `impression de la carte : n° ${t.numero} imprimé${e.total ? ` sur ${e.total}` : ''}`; r.numeroFiche = t.numero; }
            }
        }
    }
    // une entrée réclamée par deux ORIGINES (codes différents) ne désigne aucun des deux (Gengar 2022 / 2024)
    const vivants = recs.filter(r => r.entree && !r.motif).map(r => ({ idProduct: r.p.idProduct, entree: r.entree, code: code0(r.nm.code), r }));
    for (const w of temoinsDeLEntree(vivants)) if (w.motif) recs.find(r => r.p.idProduct === w.idProduct).motif = w.motif;
    const placeholdersIndex = index.filter(estPlaceholder).length;
    const resultats = recs.map(r => (r.motif || !r.entree
        ? { idProduct: r.p.idProduct, verdict: 'reste', motif: r.motif ?? 'non-couvert' }
        : { idProduct: r.p.idProduct, verdict: 'prouve', entree: r.entree, ligne: r.l.id, famille: r.l.famille, numeroOrigine: r.nm, temoin: r.temoin, numeroFiche: r.numeroFiche,
            ...(r.partagee ? { partageeHoloNonHolo: true, produitsPartages: r.partagee, entreeHoloIgnoree: r.holoIgnoree } : {}) }));
    const parMotif = {};
    for (const r of resultats) if (r.verdict === 'reste') parMotif[r.motif] = (parMotif[r.motif] || 0) + 1;
    return { resultats, comptes: { produits: produits.length, prouves: resultats.filter(r => r.verdict === 'prouve').length, placeholders, placeholdersIndex, parMotif } };
}

// ── LA TABLE DES AUTRES FAMILLES : une ligne par famille ET par année ou série, prouvée par des images OUVERTES à l'œil le 2026-10-17 (planches S7/PK-AUTRES/planches/) ─────────────────────
// Sur chaque image témoin : le nom et le numéro imprimés sont ceux de NOTRE produit ; pour une famille TAMPONNÉE (Trick or Trade : citrouille, Professor Program : « PROFESSOR PROGRAM ») le tampon
// est VISIBLE sur chaque témoin ; pour McDonald's le millésime se lit dans le copyright de la carte et dans le numéro (x/12, x/15), et la plage `plageS` est le bloc de téléversement de ce millésime
// chez Pokumon (numéros imprimés consécutifs, couverts à 12/12 ou 7/7 par les produits de l'année). Une famille non écrite ici est un trou, et le rapport dit pourquoi.
const tm = (nom, imprime) => ({ n: imprime.split('/')[0], nom, imprime });
const MC = an => `carte McDonald's du millésime ${an} : copyright et numéro imprimés lus sur l'image`;
const TOT_TAMPON = 'citrouille (tête de Pikachu en citrouille) imprimée en bas à droite de l\'illustration, visible sur chaque image';
const PROF_TAMPON = 'logo « PROFESSOR PROGRAM » imprimé dans le bas de l\'illustration, visible sur chaque image';
const BSP_MARQUE = 'étoile noire « PROMO » et code du set imprimés en bas de la carte';
const LIGNES_AUTRES = Object.freeze([
    { id: 'mcd-2014', famille: 'mcd', slugs: ['McDonalds-Collection-2014'], total: '12', plageS: [37, 48], expansionsImpression: ["McDonald's Collection 2014"], jeu: 'mcd', tampon: MC(2014), lu: '2026-10-17', temoins: [tm('Weedle', '1/12'), tm('Pikachu', '5/12'), tm('Furfrou', '12/12')] },
    { id: 'mcd-2015', famille: 'mcd', slugs: ['McDonalds-Collection-2015'], total: '12', plageS: [49, 60], expansionsImpression: ["McDonald's Collection 2015"], jeu: 'mcd', tampon: MC(2015), lu: '2026-10-17', temoins: [tm('Treecko', '1/12'), tm('Pikachu', '6/12'), tm('Skitty', '12/12')] },
    { id: 'mcd-2017', famille: 'mcd', slugs: ['McDonalds-Collection-2017'], total: '12', plageS: [73, 84], expansionsImpression: ["McDonald's Collection 2017"], jeu: 'mcd', tampon: MC(2017), lu: '2026-10-17', temoins: [tm('Rowlet', '1/12'), tm('Pikachu', '5/12'), tm('Yungoos', '12/12')] },
    { id: 'mcd-2018-2', famille: 'mcd', slugs: ['McDonald-s-Collection-2018-2'], total: '12', plageS: [85, 96], expansionsImpression: ["McDonald's Collection 2018", 'McDonald s Collection 2018 2'], jeu: 'mcd', tampon: MC(2018), lu: '2026-10-17', temoins: [tm('Growlithe', '1/12'), tm('Machop', '6/12'), tm('Porygon', '12/12')] },
    { id: 'mcd-match-battle-2023', famille: 'mcd', slugs: ['McDonalds-Match-Battle-2023'], total: '15', plageS: [237, 243], expansionsImpression: ["McDonald's Collection 2023"], jeu: 'mcd', tampon: MC(2023), lu: '2026-10-17', temoins: [tm('Flittle', '009/015'), tm('Blissey', '012/015'), tm('Kirlia', '015/015')] },
    { id: 'tot-2022', famille: 'tot', annee: 2022, slugs: ['Trick-or-Trade'], jeu: 'speciale', tampon: TOT_TAMPON, lu: '2026-10-17', temoins: [tm('Pikachu', '049/203'), tm('Gastly', '055/198'), tm('Gengar', '057/198'), tm('Dusknoir', '062/172'), tm('Trevenant', '015/192'), tm('Mimikyu', '081/189')] },
    { id: 'tot-2023', famille: 'tot', annee: 2023, slugs: ['Trick-or-Trade-2023'], jeu: 'speciale', tampon: TOT_TAMPON, lu: '2026-10-17', temoins: [tm('Sinistea', '089/202'), tm('Dusknoir', '071/185'), tm('Marshadow', '080/203'), tm('Gastly', '064/196'), tm('Gengar', '066/196'), tm('Zubat', '103/195')] },
    { id: 'prof', famille: 'prof', slugs: ['Professor-Program'], jeu: 'speciale', tampon: PROF_TAMPON, lu: '2026-10-17', temoins: [tm('Judge', '108/131'), tm('Gym Trainer', '059/072'), tm('League Staff', '153/185'), tm('Roseanne\'s Backup', '148/172'), tm('Professor Laventon', '162/195'), tm('Judge', '235/264')] },
    { id: 'bsp-swsh', famille: 'bsp', prefixe: 'SWSH', slugs: ['SWSH-Black-Star-Promos'], jeu: 'swsh', tampon: BSP_MARQUE, lu: '2026-10-17', temoins: [tm('Unown V', 'SWSH300'), tm('Zamazenta V', 'SWSH293'), tm('Moltres', 'SWSH185')] },
    { id: 'bsp-svp', famille: 'bsp', prefixe: 'SVP', slugs: ['SV-Black-Star-Promos'], jeu: 'svp', tampon: BSP_MARQUE, lu: '2026-10-17', temoins: [tm('Black Belt\'s Training', 'SVP219'), tm('Black Belt\'s Training', 'SVP220'), tm('Mewtwo', 'SVP052')] },
    { id: 'bsp-mep', famille: 'bsp', prefixe: 'MEP', slugs: ['MEP-Black-Star-Promos'], jeu: 'mep', tampon: BSP_MARQUE, lu: '2026-10-17', temoins: [tm('Mega Charizard X ex', 'MEP023'), tm('Mega Gardevoir ex', 'MEP032'), tm('Mega Lucario ex', 'MEP033')] }
].map(l => Object.freeze(l)));
const LOT_FAMILLES = LIGNES_AUTRES.map(l => l.id);
const { largeurMinDe } = require('./seuils-images');
const nImage = n => { const s = String(n ?? '').trim().toUpperCase().replace(/^0+(?=\d)/, ''); return s === '' ? null : s; };   // la même normalisation que le site (normaliserNumero)

/**
 * LE PLAN des autres familles (pur). `produits` : TOUS les produits des sets des lignes (servis ou non : un groupe se compte sur tous) ; `cartes` : Map(carteId → { nomEn, images }).
 * 🔑 Le numéro posé sur l'image est celui de la FICHE (l'impression de la carte : « 033 » pour MEP033, « 009 » pour 9/15) — le site compare ce numéro à celui de la fiche — ; Trick or Trade et
 * Professor Program n'ont pas de fiche numérotée, l'image garde le numéro imprimé de l'entrée. Une image sous le seuil de largeur est un reste COMPTÉ (« sous-le-seuil »), jamais téléchargée.
 */
function planifierFamilles({ lignes = LIGNES_AUTRES, produits, cartes, index }) {
    const { resultats, comptes } = apparierFamille({ lignes, produits, index });
    const parId = new Map(produits.map(p => [p.idProduct, p]));
    const cleFiche = p => `${p.carteId}|${p.unite}|${cleMesure(p.numero) ?? ''}`;
    const parFiche = new Map();
    for (const r of resultats) { const k = cleFiche(parId.get(r.idProduct)); (parFiche.get(k) || parFiche.set(k, []).get(k)).push(r); }
    const plan = [], restes = [];
    const seuil = largeurMinDe(SOURCE);
    for (const r of resultats) {
        const p = parId.get(r.idProduct);
        const base = { idProduct: p.idProduct, carteId: p.carteId, slugSet: p.unite, nomCm: p.nomCm };
        if (r.verdict !== 'prouve') { restes.push({ ...base, motif: r.motif }); continue; }
        const carte = cartes.get(p.carteId);
        if (!carte) { restes.push({ ...base, motif: 'carte-absente' }); continue; }
        const e = r.entree, l = lignes.find(x => x.id === r.ligne);
        const numero = ['mcd', 'bsp'].includes(r.famille) ? r.numeroFiche : e.numero;
        if ((carte.images || []).some(m => m && m.set === p.unite && m.cleR2 && (nImage(m.numero) === null || nImage(m.numero) === nImage(numero)))) { restes.push({ ...base, motif: 'deja-servi' }); continue; }
        const fiche = parFiche.get(cleFiche(p));
        if (fiche.length > 1 && !fiche.every(x => x.verdict === 'prouve' && x.entree.id === e.id)) { restes.push({ ...base, motif: 'fiche-partagee' }); continue; }
        if (!urlImageValide(e.img)) { restes.push({ ...base, motif: 'url-hors-liste' }); continue; }
        if (!(e.w >= seuil)) { restes.push({ ...base, motif: 'sous-le-seuil', w: e.w }); continue; }
        if (plan.some(x => x.carteId === p.carteId && x.slugSet === p.unite && nImage(x.numero) === nImage(numero))) continue;
        // BS-HOLO : l'image est celle de TOUT le couple ; le champ explicite et la liste exacte des produits suivent l'image (document `images` ET entrée `cartes.images`), et la preuve dit pourquoi
        const partage = r.partageeHoloNonHolo ? { partageeHoloNonHolo: true, produitsPartages: [...r.produitsPartages] } : {};
        const choix = r.partageeHoloNonHolo
            ? `partagée holo/non-holo : produits ${r.produitsPartages.join(' + ')} (slugs V1 / V2 d'une même carte), entrée ${e.id} (non-holo) choisie, entrée ${r.entreeHoloIgnoree.id} (Holofoil) laissée de côté — même nom, même numéro, mêmes événements, aucun mot de tampon, seul le brillant diffère ; `
            : 'une seule entrée candidate pour ce produit ; ';
        plan.push({ ...base, nomEn: carte.nomEn ?? null, famille: r.famille, ligne: l.id, marque: `${l.id} : ${l.tampon}`, numero, entreeId: e.id, lien: e.link, titre: e.titre, url: e.img, w: e.w, h: e.h, holo: e.holo, voie: `pokumon+nom+numero+${r.famille}`, ...partage,
            preuve: `pokumon.com entrée ${e.id} « ${e.titre} » ; nom « ${nomNu(p.nomCm)} » = celui de l'entrée ; numéro ${e.numero} (produit ${p.slugProduit ?? ''}, n° ${p.numero ?? ''}) ; ${r.temoin} ; ${choix}ligne ${l.id} prouvée à l'œil le ${l.lu} sur ${l.temoins.map(w => `${w.nom} ${w.imprime}`).join(', ')} ; marque : ${l.tampon}` });
    }
    return { plan, restes, comptes: { ...comptes, trous: restes.length, plan: plan.length, sousSeuil: restes.filter(x => x.motif === 'sous-le-seuil').length } };
}

// ── L'ADRESSE D'UNE IMAGE ET D'UNE LISTE : écrites par ce qu'elles AUTORISENT ───────────────────────────────────────────────────────────────────
const CHAMPS_INDEX = 'id,title,slug,link,release_event,promo_set,language,_links,_embedded';
const RE_INDEX = new RegExp(`^\\?release_event=(${Object.values(EVENEMENTS).join('|')})&per_page=100&page=([1-9])&orderby=id&order=asc&_embed=wp:featuredmedia&_fields=${CHAMPS_INDEX}$`);
// ── LES AUTRES FAMILLES (2026-10-17, lot PK-AUTRES) : la liste d'un JEU DE PROMOS (taxonomie « promo_set »), anglais seulement. Identifiants lus le 2026-10-17 (promo_set?per_page=100, MESURE-OCC). ──
const PROMO_SETS = Object.freeze({ speciale: 2346, mcd: 9231, sm: 4625, xy: 4285, swsh: 6678, svp: 7826, mep: 9606 });
const PAGES_PROMO_MAX = 30;
const RE_INDEX_PS = new RegExp(`^\\?promo_set=(${Object.values(PROMO_SETS).join('|')})&language=${LANGUE_ANGLAIS}&per_page=100&page=([1-9]|[12][0-9]|30)&orderby=id&order=asc&_embed=wp:featuredmedia&_fields=${CHAMPS_INDEX}$`);
const RE_IMAGE = /^\/wp-content\/uploads\/\d{4}\/\d{2}\/[A-Za-z0-9_.-]{1,120}\.(png|jpe?g|webp)$/;
/**
 * L'adresse de la page `page` (1-9) de la liste des cartes d'une série (1-4).
 * 🔴 `orderby=id&order=asc` : sans lui WordPress trie par date, et des entrées de même date changent de page d'une requête à l'autre — 6 entrées Prize Pack (Blaziken V, Zacian V, Zamazenta V,
 * Boltund V, Radiant Steelix, Cinccino) manquaient à la première lecture de l'index (2026-10-17) alors que l'ancienne les avait. Un ordre total ne saute rien ; le total annoncé (`x-wp-total`) est
 * comparé au nombre d'entrées lues (chargerIndex).
 */
function urlIndex(serie, page) {
    if (!EVENEMENTS[serie]) throw new Error(`${SOURCE} : la série ${serie} n'est pas S1-S4`);
    if (!Number.isInteger(page) || page < 1 || page > 9) throw new Error(`${SOURCE} : page ${page} hors de 1-9`);
    return `${HOTE_API}/wp-json/wp/v2/card?release_event=${EVENEMENTS[serie]}&per_page=100&page=${page}&orderby=id&order=asc&_embed=wp:featuredmedia&_fields=${CHAMPS_INDEX}`;
}
/** L'adresse de la page `page` (1-30) de la liste d'un jeu de promos ANGLAIS (`PROMO_SETS`). Même ordre total que urlIndex (`orderby=id`). */
function urlIndexPromoSet(jeu, page) {
    if (!Object.hasOwn(PROMO_SETS, jeu)) throw new Error(`${SOURCE} : le jeu de promos « ${jeu} » n'est pas dans la liste (${Object.keys(PROMO_SETS).join(', ')})`);
    if (!Number.isInteger(page) || page < 1 || page > PAGES_PROMO_MAX) throw new Error(`${SOURCE} : page ${page} hors de 1-${PAGES_PROMO_MAX}`);
    return `${HOTE_API}/wp-json/wp/v2/card?promo_set=${PROMO_SETS[jeu]}&language=${LANGUE_ANGLAIS}&per_page=100&page=${page}&orderby=id&order=asc&_embed=wp:featuredmedia&_fields=${CHAMPS_INDEX}`;
}
function cheminAutorise(url) {
    let u; try { u = new URL(url); } catch { throw new Error(`${SOURCE} : adresse illisible`); }
    const refus = () => new Error(`${SOURCE} : « ${u.origin}${u.pathname}${u.search} » hors de ce que le client autorise (${HOTES.join(', ')} ; robots.txt, la liste des cartes d'une série S1-S4, /wp-content/uploads/…)`);
    if (u.username || u.password || u.hash || !HOTES.includes(u.origin)) throw refus();
    if (u.pathname === '/robots.txt' && !u.search) return { hote: u.origin, chemin: u.pathname, url: u.href, genre: 'robots' };
    if (u.origin === HOTE_API && u.pathname === '/wp-json/wp/v2/card' && (RE_INDEX.test(u.search) || RE_INDEX_PS.test(u.search))) return { hote: u.origin, chemin: u.pathname, url: u.href, genre: 'index' };
    if (u.origin === HOTE_IMG && !u.search && RE_IMAGE.test(u.pathname)) return { hote: u.origin, chemin: u.pathname, url: u.href, genre: 'image' };
    throw refus();
}
const urlIndexAutorisee = url => { try { return cheminAutorise(url).genre === 'index'; } catch { return false; } };
const urlImageValide = url => { try { return cheminAutorise(url).genre === 'image'; } catch { return false; } };

// ── LE PLAN, pur ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * `produits` : { idProduct, carteId, slugSet, serie, nomCm, slugProduit } ; `cartes` : Map(carteId → { nomEn, images }) ; `index` : les entrées lues.
 * 🔑 LE SITE AFFICHE UN SEUL VISUEL PAR FICHE (carte, set) : une fiche sans numéro (les Prize Packs) montre la première image du set. Une fiche qui porte plusieurs produits dont un n'est pas
 * prouvé du même visuel montrerait notre image sur le produit d'à côté : TROU « fiche-partagee ». Une carte qui a déjà un visuel dans CE set n'est jamais touchée (additif).
 */
function planifierPokumon({ produits, cartes, index }) {
    const { resultats, comptes } = apparier({ produits, index });
    const parId = new Map(produits.map(p => [p.idProduct, p]));
    const parFiche = new Map();
    for (const p of produits) (parFiche.get(`${p.carteId}|${p.slugSet}`) || parFiche.set(`${p.carteId}|${p.slugSet}`, []).get(`${p.carteId}|${p.slugSet}`)).push(resultats.find(r => r.idProduct === p.idProduct));
    const plan = [], restes = [];
    for (const r of resultats) {
        const p = parId.get(r.idProduct);
        const base = { idProduct: p.idProduct, carteId: p.carteId, slugSet: p.slugSet, nomCm: p.nomCm };
        if (r.verdict !== 'prouve') { restes.push({ ...base, motif: r.motif }); continue; }
        const carte = cartes.get(p.carteId);
        if (!carte) { restes.push({ ...base, motif: 'carte-absente' }); continue; }
        if ((carte.images || []).some(e => e && e.set === p.slugSet && e.cleR2)) { restes.push({ ...base, motif: 'deja-servi' }); continue; }
        const fiche = parFiche.get(`${p.carteId}|${p.slugSet}`);
        if (fiche.length > 1 && !fiche.every(x => x.verdict === 'prouve' && x.entree.id === r.entree.id)) { restes.push({ ...base, motif: 'fiche-partagee' }); continue; }
        if (!urlImageValide(r.entree.img)) { restes.push({ ...base, motif: 'url-hors-liste' }); continue; }
        if (plan.some(x => x.carteId === p.carteId && x.slugSet === p.slugSet)) continue;
        const l = ligneDe(p.serie), e = r.entree;
        // PP-HOLO : l'image est celle de TOUT le groupe ; le champ explicite et la liste exacte des produits suivent l'image (document `images` ET entrée `cartes.images`), et la preuve dit pourquoi
        const partage = r.partageeHoloNonHolo ? { partageeHoloNonHolo: true, produitsPartages: [...r.produitsPartages] } : {};
        const choix = r.partageeHoloNonHolo
            ? `partagée holo/non-holo : produits ${r.produitsPartages.join(' + ')} (slugs V1 / V2 d'une même carte), entrée ${e.id} (non-holo) choisie, entrée ${r.entreeHoloIgnoree.id} (Holofoil) laissée de côté — même nom, même numéro, la série du produit dans les deux entrées, seul le brillant diffère ; `
            : 'une seule entrée candidate pour ce produit ; ';
        plan.push({ ...base, nomEn: carte.nomEn ?? null, serie: p.serie, numero: e.numero, entreeId: e.id, lien: e.link, titre: e.titre, url: e.img, w: e.w, h: e.h, holo: e.holo, voie: 'pokumon+nom+numero+serie', ...partage,
            preuve: `pokumon.com entrée ${e.id} « ${e.titre} » ; nom « ${nomNu(p.nomCm)} » = celui de l'entrée ; numéro d'origine ${r.numeroOrigine.n} (slug Cardmarket ${p.slugProduit ?? ''}) = n° imprimé ${e.numero} ; Prize Pack Series ${p.serie} (entrée ${e.series.map(s => `Series ${s}`).join(' + ')}) ; ${r.temoin} ; ${choix}série prouvée à l'œil le ${l.lu} sur ${l.temoins.map(w => `${w.nom} ${w.imprime}`).join(', ')} ; tampon : ${l.tampon}` });
    }
    return { plan, restes, comptes: { ...comptes, trous: restes.length, plan: plan.length } };
}

// ── LE CLIENT ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const transportFetch = {
    async get(url, { binaire = false } = {}) {
        let r;
        // `manual` : une redirection n'est JAMAIS suivie
        try { r = await fetch(url, { headers: { 'User-Agent': UA, Accept: binaire ? 'image/*' : 'application/json, text/plain' }, redirect: 'manual', signal: AbortSignal.timeout(45000) }); }
        catch (e) { throw Object.assign(new Error(`${e.name === 'TimeoutError' ? 'ETIMEDOUT' : e.cause?.code || 'ERR_NETWORK'} ${url}`), { reseau: true }); }
        const cfMitigated = r.headers.get('cf-mitigated');
        if (r.status >= 300 && r.status < 400) return { status: r.status, location: r.headers.get('location'), cfMitigated };
        const type = r.headers.get('content-type') || '';
        if (r.status === 404 || r.status === 410) return { status: r.status, type, cfMitigated };
        if (binaire && r.ok && /^image\//.test(type)) return { status: r.status, type, octets: Buffer.from(await r.arrayBuffer()), cfMitigated };
        return { status: r.status, type, texte: await r.text(), pages: Number(r.headers.get('x-wp-totalpages')) || null, total: Number(r.headers.get('x-wp-total')) || null, cfMitigated };
    }
};
const DEFI = /Just a moment|cf-chl|challenge-platform|g-recaptcha|h-captcha|hcaptcha|captcha|Attention Required/i;

/**
 * Les SEULS chemins vers pokumon.com et son hôte d'images. Garde FERMÉE : aucune requête sans verrou global lié et tenu ; deux hôtes ÉNUMÉRÉS, chemins ÉNUMÉRÉS (robots.txt, la liste d'une
 * série, /wp-content/uploads/…) ; robots.txt de CHAQUE hôte lu avant sa première requête et respecté ; cadence tenue dans une file (jamais sous 5 s) ; un SEUL réessai sur une coupure ou un
 * 5xx, puis l'échec LÈVE ; 403, 429, `cf-mitigated`, défi : BLOQUÉ, plus aucune requête ; une redirection n'est JAMAIS suivie ; plafond de requêtes ; la liste d'une série se rejoue
 * depuis le CACHE (`cache` : { lire(cle) → texte|null, ecrire(cle, texte) }) sans requête.
 */
function fabriquerClientPokumon({ transport = transportFetch, cadenceMs = CADENCE_MS, reessaiMs = REESSAI_MS, verrou = null, plafond = PLAFOND_REQUETES, cache = null, pause = ms => new Promise(r => setTimeout(r, ms)), horloge = Date.now } = {}) {
    let lie = verrou, file = Promise.resolve(), dernier = 0, compte = 0, bloque = null;
    const robots = new Map();                                 // hôte → texte | null (404) ; absent = pas encore lu
    let cadenceEff = Math.max(CADENCE_MIN_MS, Number(cadenceMs) || 0);
    function garde() {
        if (bloque) throw bloque;
        if (!lie) throw new Error(`${SOURCE} : aucun verrou global lié (${VERROU_GLOBAL}) — pas de requête sans verrou`);
        if (lie.perdu || !lie.tenu) throw new Error(`${SOURCE} : verrou global ${lie.perdu ? 'PERDU' : 'non tenu'} — pas de requête sans verrou`);
    }
    async function une(url, o) {
        garde();
        if (compte >= plafond) throw new Error(`${SOURCE} : plafond de ${plafond} requêtes atteint — aucune requête de plus`);
        const attente = dernier + cadenceEff - horloge();
        if (attente > 0) await pause(attente);
        garde();
        dernier = horloge(); compte++;
        return transport.get(url, o);
    }
    const bloquer = (r, url) => { bloque = Object.assign(new Error(`${SOURCE} BLOQUÉ (HTTP ${r.status}${r.cfMitigated ? `, cf-mitigated ${r.cfMitigated}` : ''}) sur ${url} — on s'arrête, plus aucune requête`), { bloque: true, status: r.status }); throw bloque; };
    const defi = r => r.status === 403 || r.status === 429 || !!r.cfMitigated || (typeof r.texte === 'string' && /html/i.test(r.type || '') && DEFI.test(r.texte.slice(0, 5000)));
    /** une requête, UN réessai au plus (coupure ou 5xx), jamais une boucle */
    async function essayer(url, o) {
        let r;
        try { r = await une(url, o); }
        catch (e) { if (!e.reseau) throw e; await pause(reessaiMs); return une(url, o); }
        if (r.status >= 500 && !defi(r)) { await pause(reessaiMs); r = await une(url, o); }
        return r;
    }
    async function assurerRobots(hote) {
        if (robots.has(hote)) return;
        const url = `${hote}/robots.txt`;
        const r = await essayer(url, {});
        if (defi(r)) bloquer(r, url);
        if (r.status === 404 || r.status === 410) { robots.set(hote, null); return; }
        if (r.status !== 200) throw Object.assign(new Error(`${r.status} ${url} : robots.txt illisible — on ne peut pas conclure, aucune requête`), { robots: true, status: r.status });
        const texte = r.texte ?? '';
        const d = T.delaiDesRobots(texte, UA);
        if (d && d > CRAWL_DELAY_MAX_S) { bloque = Object.assign(new Error(`${SOURCE} : robots.txt de ${hote} demande un Crawl-delay de ${d} s — on s'arrête`), { bloque: true, robots: true }); throw bloque; }
        if (d) cadenceEff = Math.max(cadenceEff, d * 1000);
        robots.set(hote, texte);
    }
    const enFile = fn => { const p = file.then(fn); file = p.catch(() => { }); return p; };
    async function requete(url, binaire) {
        garde();
        const c = cheminAutorise(url);
        return enFile(async () => {
            await assurerRobots(c.hote);
            if (!T.autoriseParRobots(robots.get(c.hote), c.chemin, UA)) throw Object.assign(new Error(`${SOURCE} : robots.txt interdit ${c.chemin} — aucune requête`), { robots: true });
            const r = await essayer(c.url, { binaire });
            if (defi(r)) bloquer(r, c.url);
            if (r.status >= 300 && r.status < 400) throw new Error(`${SOURCE} : redirection ${r.status} non suivie sur ${c.url}`);
            return r;
        });
    }
    /** Une page de la liste (adresse déjà validée), brute. */
    async function brut(url) {
        const r = await requete(url, false);
        if (r.status !== 200) throw Object.assign(new Error(`${r.status} ${url}`), { status: r.status });
        if (!/json/i.test(r.type || '')) throw new Error(`${SOURCE} : « ${r.type} » n'est pas du JSON (${url})`);
        return r;
    }
    /** La page `page` de la liste de la série `serie` : { entrees (brutes), pages, total (annoncé par la source), depuisCache }. */
    const index = (serie, page) => lirePage(urlIndex(serie, page), `s${serie}-p${page}`);
    /** La page `page` de la liste d'un jeu de promos anglais (PROMO_SETS) : même forme, même cache (clé `ps-<jeu>-p<page>`). */
    const indexPromoSet = (jeu, page) => lirePage(urlIndexPromoSet(jeu, page), `ps-${jeu}-p${page}`);
    async function lirePage(url, cle) {
        const garde0 = cache?.lire(cle);
        if (garde0) { const v = JSON.parse(garde0); return { entrees: v.entrees, pages: v.pages, total: v.total ?? null, depuisCache: true }; }
        const r = await brut(url);
        let entrees;
        try { entrees = JSON.parse(r.texte); } catch { throw new Error(`${SOURCE} : liste illisible (${url})`); }
        if (!Array.isArray(entrees)) throw new Error(`${SOURCE} : la liste n'est pas un tableau (${url})`);
        cache?.ecrire(cle, JSON.stringify({ entrees, pages: r.pages ?? 1, total: r.total ?? null }));
        return { entrees, pages: r.pages ?? 1, total: r.total ?? null, depuisCache: false };
    }
    /** Une image : les octets, ou null (404). */
    async function image(url) {
        const r = await requete(url, true);
        if (r.status === 404 || r.status === 410) return null;
        if (r.status >= 400) throw Object.assign(new Error(`${r.status} ${url}`), { status: r.status });
        if (!r.octets) throw new Error(`${SOURCE} : « ${r.type} » n'est pas une image (${url})`);
        return r.octets;
    }
    /** Relève le plafond d'une collecte dont le plan est connu (un fichier = une requête) ; jamais au-delà de PLAFOND_MAX, jamais sous ce qui est déjà parti. */
    function fixerPlafond(n) {
        if (!Number.isInteger(n) || n < compte || n > PLAFOND_MAX) throw new Error(`${SOURCE} : plafond ${n} refusé (déjà ${compte} requêtes, maximum ${PLAFOND_MAX})`);
        plafond = n;
    }
    return { index, indexPromoSet, image, brut, lier(v) { lie = v; }, fixerPlafond, plafond: () => plafond, compteRequetes: () => compte, cadence: () => cadenceEff, bloque: () => bloque };
}

// ── LA RÈGLE DU SITE : l'image propre l'emporte sur le substitut ───────────────────────────────────────────────────────────────────────────────
/**
 * La règle du site, IMPORTÉE (jamais recopiée, §21 bis) : `imageDeLImpression` (quelle image montre la fiche), `visuelAdmisPourLaRegion` (la garde de langue) et `visuelSubstitut`
 * (« il ne s'affiche que si la fiche n'a AUCUN visuel de son tirage »). `racine` : le dossier dont le VOISIN `rat-market-site` porte la règle. Une fonction absente lève.
 */
async function chargerRegleDuSite(racine) {
    const path = require('path'), { pathToFileURL } = require('url');
    const SITE_LIB = path.join(racine, '..', 'rat-market-site', 'lib');
    const lire = f => import(pathToFileURL(path.join(SITE_LIB, f)).href);
    const [I, L, S] = await Promise.all([lire('imageDeLImpression.ts'), lire('langueDuVisuel.ts'), lire('visuelSubstitut.ts')]);
    const r = { imageDeLImpression: I.imageDeLImpression, visuelAdmisPourLaRegion: L.visuelAdmisPourLaRegion, visuelSubstitut: S.visuelSubstitut };
    for (const [k, f] of Object.entries(r)) if (typeof f !== 'function') throw new Error(`${k} absent de ${SITE_LIB}`);
    return r;
}
/**
 * Ce que le site SERT pour une fiche : son image propre (celle de son numéro, parmi les images du set admises par la garde de langue) ; à défaut seulement, le substitut de ses produits.
 * 🔑 C'est pourquoi poser l'image propre n'exige AUCUN détachement : le substitut cesse d'être affiché de lui-même (règle 1 du site), et revient si le lot est retiré.
 * @returns {{genre: 'propre'|'substitut'|null, propre: object|null, substitut: object|null}}
 */
function visuelServi(site, { set, images, numeroFiche, region, produits, baseUrlImages }) {
    const imgs = (images || []).filter(m => m && m.set === set && m.cleR2).filter(m => site.visuelAdmisPourLaRegion(m, region));
    const propre = site.imageDeLImpression(imgs, numeroFiche ?? null);
    if (propre) return { genre: 'propre', propre, substitut: null };
    const substitut = site.visuelSubstitut(produits || [], false, baseUrlImages);
    return { genre: substitut ? 'substitut' : null, propre: null, substitut };
}

// ── L'IDENTIFIANT ET LE RETRAIT EN UN LOT ────────────────────────────────────────────────────────────────────────────────────────────────────
const idImagePokumon = (slug, carteId, numero) => `${SOURCE}/${slug}/${carteId}/${String(numero ?? '').replace(/[^0-9A-Za-z]/g, '') || 'sans-numero'}/en`;
/** BS-HOLO : les slugs des sets de lignes de la table des autres familles (`--lignes=`) ; une ligne inconnue LÈVE (jamais un retrait sur un périmètre deviné). */
function setsDesLignes(ids) {
    const inconnues = (ids || []).filter(i => !LIGNES_AUTRES.some(l => l.id === i));
    if (inconnues.length) throw new Error(`ligne(s) inconnue(s) : ${inconnues.join(', ')} — la table dit : ${LIGNES_AUTRES.map(l => l.id).join(', ')}`);
    return new Set(LIGNES_AUTRES.filter(l => ids.includes(l.id)).flatMap(l => l.slugs));
}
/** Ce qu'un retrait en un lot retire : les entrées `cartes.images` de CETTE source ET de CE lot — rien d'autre — et leurs clés R2 (vignette comprise). Les substituts ne bougent pas. */
function planRetraitPokumon(cartes, { seulementPartagees = false, sets = null } = {}) {
    const touchees = [], cles = [];
    let entrees = 0;
    for (const c of cartes) {
        // PP-HOLO : `seulementPartagees` ne retire que les images portant le champ explicite « partagée holo/non-holo » — rien d'autre du lot (un champ absent n'est pas `true`)
        // BS-HOLO : `sets` (les slugs des lignes demandées) restreint encore le retrait à ces sets — les promos Black Star seules, sans les Prize Packs
        const es = (c.images || []).filter(e => e && e.source === SOURCE && e.lot === LOT && (!seulementPartagees || e.partageeHoloNonHolo === true) && (!sets || sets.has(e.set)));
        if (!es.length) continue;
        touchees.push(c._id); entrees += es.length; cles.push(...es.flatMap(e => [e.cleR2, e.vignette?.cleR2].filter(Boolean)));
    }
    return { cartes: touchees, entrees, cles };
}

module.exports = {
    SOURCE, HOTE_API, HOTE_IMG, HOTES, LOT, MENTION, CADENCE_MS, CADENCE_MIN_MS, REESSAI_MS, PLAFOND_REQUETES, PLAFOND_MAX, UA, VERROU_GLOBAL, VERROU_GLOBAL_MS, ID_ALERTE, EVENEMENTS,
    TABLE_POKUMON, ligneDe, seriesAdmises, lireEntree, estPlaceholder, construireIndex, cleMesure, nomPokumon, numeroOrigine, codeOrigine, temoinsDeLEntree, denominateurDuCode,
    LIGNES_AUTRES, nImage, groupeHoloNonHolo, groupeHoloNonHoloBlackStar, planifierFamilles, apparierFamille, temoinImpression, sDuFichier, anneeToT, REGLES, apparier, planifierPokumon, urlIndex, urlIndexPromoSet, urlIndexAutorisee, PROMO_SETS, urlImageValide, fabriquerClientPokumon, chargerRegleDuSite, visuelServi, idImagePokumon, planRetraitPokumon, setsDesLignes
};
