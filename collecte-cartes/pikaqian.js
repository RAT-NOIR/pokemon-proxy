// ============================================================
// PIKAQIAN (pikaqian.com, images.pikaqian.com) — visuels zh-hans MANQUANTS, tirage exact (2026-10-11)
// ============================================================
// 🔑 DÉCISION DU TESTEUR (2026-10-11) : « PikaQian : FEU VERT, en basse priorité. Mêmes conditions que les bases TPC (à mes risques, retrait
// possible en un seul lot) : provenance enregistrée, seuil de 300 px pour cette source officielle (usage : vignette de 157 px), arrêt au
// premier défi ou à la première erreur répétée. » Pages publiques seulement, jamais `/api/`, aucun compte, robots.txt respecté, rien de payant.
//
// CE QUE LA SOURCE EST, MESURÉ le 2026-10-10 (MESURE-PIKAQIAN.md) : un site de prix d'un tiers, sans condition publiée (« aucune condition
// trouvée » n'est pas « autorisé » : c'est pour cela que tout part en un lot), Cloudflare en simple CDN, aucun défi. Une page de SET
// (`/sets/<code minuscule>`) est du HTML rendu serveur qui porte toutes les tuiles : nom, code de set, numéro, adresse de l'image
// (`images.pikaqian.com/<code>/<uuid>.webp`, WebP 300 × 419). Les images sont des COPIES des visuels officiels de pokemon.cn (champ
// `native_image_url` = cdn.pokemon-tcg.cn) : c'est la réserve que le §78 range sous des conditions « copie interdite sans accord écrit »,
// et c'est la raison de la PROVENANCE écrite sur chaque visuel et du retrait en un geste.
//
// 🔑 L'APPARIEMENT SE PROUVE PAR PRODUIT : code de set (les tuiles de la page sont toutes au code du set) + numéro + la tuile SANS suffixe de
// foil, UNIQUE à ce numéro + nom anglais concordant (la normalisation de la production, `nomCompare`). Une variante de foil du même
// numéro est un AUTRE produit ; deux tuiles sans foil au même numéro ne désignent rien ; un nom qui diverge est un trou. Un doute est un trou.
const T = require('./tpc');
const { cleNumero } = require('./jointure');
const { estPassive, motifPassif } = require('./source-passive');
const { TABLE_PIKAQIAN, declarationsDeCode, CODE_PK, codeDesTuilesPromo } = require('./pikaqian-sets');   // les fonctions UNIQUES (déclarations d'une ligne, code des tuiles d'une page promo) et le motif de code : jamais recopiés

const SOURCE = 'pikaqian';
const HOTE_PAGES = 'pikaqian.com';
const HOTE_IMAGES = 'images.pikaqian.com';
const LOT = 'pikaqian-2026-10';
const MENTION = T.MENTION;                                  // une seule mention pour toutes nos sources de scans (§75)
const CADENCE_MS = 10000;                                   // la cadence des sources officielles (tpc.js) : jamais en dessous
const UA = T.UA;                                            // l'agent du dépôt
const VERROU_GLOBAL = 'pikaqian/__collecteur__';
const VERROU_GLOBAL_MS = 3 * 60 * 1000;
const ID_ALERTE = 'alerte/source-bloquee/pikaqian';
const ID_SUITE = 'etat/echecs-de-suite/pikaqian';          // le compteur d'échecs de suite, persisté entre deux unités (collecte_images_etat)
const CRAWL_DELAY_MAX_S = 60;
const LANGUE = 'zh-hans';
const ECHECS_DE_SUITE_MAX = 2;                              // « deux échecs de suite » : la première erreur RÉPÉTÉE arrête
const PROVENANCE_PAR_DEFAUT = 'origine non déclarée par la page (la mesure du 2026-10-10 relève que pikaqian reprend le canal officiel chinois)';
const PAGE_MAX_OCTETS = 8 * 1024 * 1024, IMAGE_MAX_OCTETS = 2 * 1024 * 1024;   // une page de 700 tuiles pèse 1,5 Mo, une image 35 Ko

// ── LA LECTURE DE LA PAGE DE SET ─────────────────────────────────────────────────────────────────────────────────────
// Une tuile : `<a … href="/cards/<uuid>"> … <img alt="Nom" src="https://images.pikaqian.com/<code>/<uuid>.webp"> … <h2>Nom</h2><p>csv10c<!-- --> · 007</p>`.
// La page est découpée aux ancres de cartes : chaque corps est borné (aucun retour arrière quadratique sur 1,5 Mo), et une ancre sans
// image, sans titre ou sans « code · numéro » n'est pas une tuile (elle ne sert à rien : comptée par l'appelant).
const CORPS_MAX = 6000;
/**
 * LE découpage unique d'une page en ancres de cartes (§21 bis) : lireTuiles (la production) ET decrireAncresSansTuile (la sonde) le lisent — jamais deux copies. Rend, pour chaque ancre
 * `<a … href="/cards/<uuid>">`, { id, corps, img, titre, ref, tuile } où `tuile` est la tuile lue ou null (l'ancre n'en est pas une).
 */
function lireAncres(html) {
    const parts = String(html ?? '').split(/<a\s[^>]*?href="\/cards\//);
    const ancres = [];
    for (const part of parts.slice(1)) {
        const id = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"/.exec(part)?.[1];
        if (!id) continue;
        const fin = part.indexOf('</a>');
        const corps = part.slice(0, fin < 0 || fin > CORPS_MAX ? CORPS_MAX : fin);
        const img = /<img\s[^>]*?src="([^"]+)"/.exec(corps)?.[1] ?? null;
        const titre = /<h2[^>]*>([^<]*)<\/h2>/.exec(corps)?.[1] ?? null;
        const ref = /<p[^>]*>\s*([^<·]*?)\s*(?:<!--\s*-->)?\s*·\s*([^<]*?)\s*<\/p>/.exec(corps);
        let tuile = null;
        if (img && titre != null && ref && ref[1] && ref[2]) {
            const nom = T.entites(titre).replace(/\s+/g, ' ').trim();
            if (nom) tuile = { id, nom, code: ref[1].trim().toLowerCase(), numero: T.entites(ref[2]).trim(), img: T.entites(img) };
        }
        ancres.push({ id, corps, img, titre, ref, tuile });
    }
    return ancres;
}
function lireTuiles(html) {
    return lireAncres(html).filter(a => a.tuile).map(a => a.tuile);
}
/**
 * Les adresses d'ORIGINE que la page DÉCLARE, pour les cartes dont elle embarque les données : Map(uuid → { native, officielle }). Vide sinon.
 * 🔑 MESURÉ le 2026-10-11 sur /sets/cs1bc : la page de set n'embarque (dans son flux Remix) les données que d'UNE carte sur 315, et pour elle
 * `native_image_url` pointe pokipair.com (un site tiers), PAS cdn.pokemon-tcg.cn ; l'adresse officielle est `we_chat_image_url`
 * (cdn.pokemon-tcg.cn/cards/…). `officielle` ne vaut donc que si elle est chez cdn.pokemon-tcg.cn ; `native` est rapportée telle que déclarée.
 * Le flux est du JSON échappé dans un <script> : on le lit à plat, par blocs « "id","<uuid>" … » (jamais deviné pour une carte absente).
 */
function lireOrigines(html) {
    const plat = String(html ?? '').replace(/\\+"/g, '"');
    const sorties = new Map();
    const ids = [...plat.matchAll(/"id","([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"/g)];
    for (const [i, m] of ids.entries()) {
        const fin = Math.min(ids[i + 1]?.index ?? Infinity, m.index + 6000);
        const bloc = plat.slice(m.index, fin);
        const native = /"native_image_url","(https?:\/\/[^"]+)"/.exec(bloc)?.[1] ?? null;
        const weChat = /"we_chat_image_url","(https?:\/\/[^"]+)"/.exec(bloc)?.[1] ?? null;
        if (!native && !weChat) continue;
        sorties.set(m[1], { native, officielle: weChat && /^https:\/\/cdn\.pokemon-tcg\.cn\//.test(weChat) ? weChat : null });
    }
    return sorties;
}
/** Le nombre d'ANCRES de cartes que la page porte (`<a … href="/cards/<uuid>">`), tuiles lisibles ou non : le dénominateur de `lireTuiles` (même découpage). */
function compterAncresCartes(html) {
    return String(html ?? '').split(/<a\s[^>]*?href="\/cards\//).slice(1).filter(p => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"/.test(p)).length;
}
/** Une tuile de VARIANTE de foil (le même numéro, un autre produit) : le nom se termine par « … Holo » (Reverse Holo, Pokeball Holo, Master Ball Holo…). */
const estFoil = nom => /\sHolo$/i.test(String(nom ?? '').trim());

/**
 * LA FORME PROMO, écrite par ce qu'elle AUTORISE (décision du testeur, 2026-10-13) : la page `promo-<x>` (collecte-cartes/pikaqian-sets.js `codeDesTuilesPromo`, la fonction unique) est de
 * cette forme si elle a au moins une tuile et que CHAQUE tuile porte le code <x> ET a son image exactement à `images.pikaqian.com/promo-<x>/<id de la tuile>.webp`. Rien d'autre.
 */
function tuilesDePagePromo(code, tuiles) {
    const x = codeDesTuilesPromo(code);
    if (x === null || !tuiles.length) return false;
    for (const t of tuiles) {
        if (t.code !== x) return false;   // GARDE:pk-promo-code
        if (t.img !== urlImage(code, t.id)) return false;   // GARDE:pk-promo-dossier
    }
    return true;
}

/**
 * Cette page désigne-t-elle ce set ? La MAJORITÉ STRICTE des tuiles porte un code que la ligne du set AUTORISE — son propre code, plus ceux qu'elle a déclarés (`codesTuiles`,
 * collecte-cartes/pikaqian-sets.js `declarationsDeCode`, la fonction unique) — sinon la page n'est pas celle qu'on croit. Une ligne qui déclare un titre exige en plus que la page
 * porte CE titre (`titre`, lu par `titreLu`) ; une déclaration incomplète refuse. `table` : les bancs seuls la passent.
 */
function verdictDePage({ tuiles, code, titre, table = TABLE_PIKAQIAN }) {
    const d = declarationsDeCode(code, table);
    // LA FORME PROMO (PQ-PROMO2) : la page `promo-<x>` dont TOUTES les tuiles portent <x> et ont leur image dans `promo-<x>/` désigne ce set — 100 %, jamais une majorité
    const promo = tuilesDePagePromo(code, tuiles || []);
    const n = (tuiles || []).length, bonnes = promo ? n : (tuiles || []).filter(t => d.codes.includes(t.code)).length;
    if (d.declare && !d.valide) return { ok: false, motif: d.motif, tuiles: n, bonnes, declaration: 'incomplete' };   // GARDE:pk-declaration
    if (!n) return { ok: false, motif: `aucune tuile lisible sur la page de ${code} : la page n'a plus la forme mesurée le 2026-10-10`, tuiles: 0, bonnes: 0 };   // GARDE:pk-aucune-tuile
    if (bonnes * 2 <= n) return { ok: false, motif: `${bonnes} tuiles sur ${n} portent ${d.codes.length > 1 ? `un des codes ${d.codes.join(', ')}` : `le code ${code}`} : la page ne désigne pas ce set`, tuiles: n, bonnes };   // GARDE:pk-majorite
    if (d.titre !== null && titre !== d.titre) return { ok: false, motif: `la page porte le titre ${titre == null ? '(aucun lu)' : `« ${String(titre).slice(0, 120)} »`}, la mesure du set déclare « ${d.titre.slice(0, 120)} » : la page ne désigne pas ce set`, tuiles: n, bonnes, titre: 'different' };   // GARDE:pk-titre
    return { ok: true, tuiles: n, bonnes };
}

// ── LE TITRE ET LE DIAGNOSTIC D'UNE PAGE (lot PQ-PROMO) : ce que la page porte, sans HTML ni tuile complète ───────────────────────────────
const TITRE_MAX = 120;
const sansBalises = s => T.entites(String(s ?? '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
/** Le texte du premier `<h1>` et du premier `<title>` de la page (balises retirées, espaces normalisés), ou null. */
function lireTitre(html) {
    const h = String(html ?? '');
    const h1 = /<h1[^>]*>([\s\S]{0,2000}?)<\/h1>/i.exec(h)?.[1], title = /<title[^>]*>([\s\S]{0,2000}?)<\/title>/i.exec(h)?.[1];
    return { h1: h1 == null ? null : sansBalises(h1) || null, title: title == null ? null : sansBalises(title) || null };
}
/** LE titre de la page, celui que `titrePk` doit égaler : le `<h1>`, à défaut le `<title>` (jamais l'un OU l'autre au choix de l'appelant). */
function titreLu(html) { const t = lireTitre(html); return t.h1 ?? t.title ?? null; }
const coupe = (s, n = TITRE_MAX) => (s == null ? null : String(s).length > n ? `${String(s).slice(0, n)}…` : String(s));
const REPARTITION_MAX = 10;
const repartir = (valeurs, cle) => {
    const m = new Map(); for (const v of valeurs) m.set(v, (m.get(v) || 0) + 1);
    const tri = [...m].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
    return { liste: tri.slice(0, REPARTITION_MAX).map(([v, n]) => ({ [cle]: coupe(v, 60), n })), autres: tri.slice(REPARTITION_MAX).reduce((s, [, n]) => s + n, 0) };
};
const DOSSIER_IMAGE = new RegExp(`^https://${HOTE_IMAGES.replace(/\./g, '\\.')}/([^/?#]+)/[^/?#]+$`);
/** Les annonces d'un nombre de cartes que le TEXTE visible de la page porte (« 701 cartes », « 701 cards », « 共701 »…), hors scripts : 3 au plus, avec leur voisinage. */
function annoncesDeNombre(html) {
    const texte = String(html ?? '').replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
    const vus = [];
    for (const re of [/\d[\d,.]{0,6}\s*(?:cards?|cartes?|张|張|枚)/gi, /共\s*\d[\d,.]{0,6}/g, /(?:total|cards?|cartes?)\s*[:：]\s*\d[\d,.]{0,6}/gi]) {
        for (const m of texte.matchAll(re)) { const a = coupe(texte.slice(Math.max(0, m.index - 20), m.index + m[0].length + 20).trim(), 80); if (!vus.includes(a)) vus.push(a); if (vus.length >= 3) return vus; }
    }
    return vus;
}
// ── LES ANCRES QUI NE SONT PAS DES TUILES (lot PQ-PROMO2) : une MESURE, jamais une garde ───────────────────────────────────────────────────────────
// Le refus « ancres > tuiles » du récepteur (recepteur-pikaqian.js) ne disait pas ce que sont les ancres qui n'ont pas donné de tuile. Cette fonction le dit, avec le MÊME découpage que
// `lireTuiles` (`lireAncres` : la sonde lit la même chose que la production) : combien n'ont pas d'<img>, pas de <h2>, pas de « code · numéro », combien ont une <img> sans src ou un src hors
// de images.pikaqian.com, et au plus EXEMPLES_ANCRES_MAX exemples réduits à quatre champs (h2, p, img oui/non, dossier de l'image) de TEXTE_ANCRE_MAX caractères — jamais de HTML brut.
const EXEMPLES_ANCRES_MAX = 5, TEXTE_ANCRE_MAX = 60;
const CONTROLE_OU_BALISE = /[\u0000-\u001f\u007f-\u009f<>]/g;
/** Un texte d'exemple : sans balises, sans caractères de contrôle, sans chevrons, espaces normalisés, tronqué (null s'il ne reste rien). */
const texteAncre = s => { const t = sansBalises(s).replace(CONTROLE_OU_BALISE, ' ').replace(/\s+/g, ' ').trim().slice(0, TEXTE_ANCRE_MAX).trim(); return t || null; };
/**
 * LA lecture du `<p>` d'une ancre (lot PQ-SANSNUM2, §21 bis : le diagnostic ET la garde `ancresSansNumero` la lisent, jamais deux copies) : le texte du PREMIER `<p>` du corps, normalisé comme
 * `texteAncre` (balises retirées, contrôles et espaces réduits, rogné), ou null (aucun `<p>`, ou rien de lisible).
 */
function codeDeAncre(corps) {
    const p = /<p[^>]*>([\s\S]{0,400}?)<\/p>/.exec(corps)?.[1];
    return p == null ? null : texteAncre(p);
}
/** LA définition de « référence complète » d'une ancre (PQ-SANSNUM2 tour 1, §21 bis) : `lireAncres` y a lu un « code · numéro » dont le code ET le numéro sont non vides. Le compteur `sansRef` du diagnostic et la garde `ancresSansNumero` la partagent. */
const refComplete = a => !!(a.ref && a.ref[1] && a.ref[2]);
function decrireAncresSansTuile(html) {
    const r = { n: 0, sansImg: 0, sansH2: 0, sansRef: 0, imgSansSrc: 0, srcHorsHote: 0, exemples: [] };
    for (const a of lireAncres(html)) {
        if (a.tuile) continue;
        r.n++;
        const aUneImg = /<img[\s/>]/i.test(a.corps);
        if (!aUneImg) r.sansImg++;
        if (a.titre == null || !T.entites(a.titre).trim()) r.sansH2++;
        if (!refComplete(a)) r.sansRef++;
        const src = a.img == null ? null : T.entites(a.img);
        if (aUneImg && src == null) r.imgSansSrc++;
        if (src != null && !src.startsWith(`https://${HOTE_IMAGES}/`)) r.srcHorsHote++;
        if (r.exemples.length < EXEMPLES_ANCRES_MAX) {
            const dossier = src == null ? null : DOSSIER_IMAGE.exec(src)?.[1] ?? null;
            r.exemples.push({ h2: a.titre == null ? null : texteAncre(a.titre), p: codeDeAncre(a.corps), img: aUneImg, dossier: dossier == null ? null : texteAncre(dossier) });
        }
    }
    return r;
}

// ── LES ANCRES SANS NUMÉRO (lot PQ-SANSNUM, 2026-10-13) — LA définition fermée et LA règle de complétude, définies ICI et nulle part ailleurs (§21 bis) ────────────────────
// 🔑 DÉCISION DU TESTEUR (2026-10-13 ~19:10 UTC), mot pour mot : « Oui pour la garde des ancres, à cette condition stricte : la page reste complète si tuiles = ancres AVEC numéro, à l'unité
// près. Les ancres sans numéro sont listées une par une dans le diagnostic (nom, lien), comptées dans le panneau, et jamais importées : un doute est un trou. Aucun autre assouplissement. »
// Mesuré (récepteur, 18:20 UTC, promo-sv-p) : 758 ancres, 701 tuiles, 57 ancres qui ont une image du dossier de la page, un nom, le code des tuiles, et AUCUN numéro (« 758 of 758 cards »).
/**
 * Les ancres SANS NUMÉRO d'une page, par ce que la définition AUTORISE (rien de plus large) : une ancre `/cards/<uuid>` du découpage UNIQUE (`lireAncres`) qui n'est pas une tuile, qui a un
 * `<h2>` non vide (le nom), sans référence « code · numéro » complète (`refComplete`, la définition du compteur `sansRef` du diagnostic), et dont le `<p>` — lu par `codeDeAncre`, la MÊME lecture que le diagnostic — est EXACTEMENT le code que portent les tuiles de la page (le code de la page, ou
 * `codeDesTuilesPromo(code)`, la fonction unique, pour une page promo), SANS « · numéro ». (PQ-SANSNUM2, ruling du coordinateur : le nombre de h2/img/p et l'adresse exacte de l'image ne
 * font plus partie de la définition — le testeur définit la carte sans numéro par son code et l'absence de numéro ; la page reste protégée par le total annoncé, obligatoire, et ces
 * cartes ne sont jamais importées.) Toute autre ancre qui n'est pas une tuile n'en est PAS une : elle compte comme une ancre AVEC numéro manquante, et la page est refusée.
 * Rend [{ nom, lien }] dans l'ordre de la page (nom tronqué comme le diagnostic, lien `/cards/<uuid>`).
 */
function ancresSansNumero(html, code) {
    if (typeof code !== 'string' || !CODE_PK.test(code)) return [];
    const codeTuiles = codeDesTuilesPromo(code) ?? code, sortie = [];
    for (const a of lireAncres(html)) {
        if (a.tuile !== null) continue;   // une tuile n'est jamais « sans numéro »
        if (refComplete(a)) continue;   // GARDE:pk-sn-ref — une référence « code · numéro » complète (même dans un second <p>) est un numéro : carte numérotée dont il manque l'image, pas une carte sans numéro
        const nom = a.titre == null || !T.entites(a.titre).trim() ? null : texteAncre(a.titre);
        if (nom === null) continue;   // GARDE:pk-sn-nom
        if (codeDeAncre(a.corps) !== codeTuiles) continue;   // GARDE:pk-sn-code
        sortie.push({ nom, lien: `/cards/${a.id}` });
    }
    return sortie;
}
const LIEN_CARTE = /^\/cards\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** Le nombre d'ancres sans numéro qu'une liste écrite (fiche, fichier de page) DÉCLARE valablement : des entrées { nom, lien } de lien `/cards/<uuid>`, distinctes, qui ne sont pas des tuiles. Absente ou mal formée = 0. */
function compterSansNumero(sansNumero, tuiles) {
    if (!Array.isArray(sansNumero)) return 0;
    const idsTuiles = new Set((tuiles || []).map(t => `/cards/${t?.id}`)), vus = new Set();
    for (const s of sansNumero) if (s && typeof s === 'object' && typeof s.nom === 'string' && typeof s.lien === 'string' && LIEN_CARTE.test(s.lien) && !idsTuiles.has(s.lien)) vus.add(s.lien);
    return vus.size;
}
// ── LE TOTAL ANNONCÉ (lot PQ-ANNONCE, 2026-10-14) — LA fonction unique qui lit « N of N cards » ─────────────────────────────────────────────────────────────────────────────
// 🔑 DÉCISION DU TESTEUR (2026-10-13), mot pour mot : « Une page n'est complète que si cartes numérotées + cartes sans numéro = total annoncé par la page (« N of N cards »). Total illisible ou absent =
// page refusée, avec ce motif dans le diagnostic. » 🔑 PRÉCISION (2026-10-14), qui PRIME : « le total est OBLIGATOIRE seulement si la page porte au moins une carte sans numéro. Sans carte sans numéro :
// règle d'avant (numérotées = ancres), et si un total est affiché, il doit concorder (sinon refus) ; s'il est absent, pas de refus. »
// Formes réelles lues (refus du 13/10) : « High to Low 758 of 758 cards Mew ex … », « 74 of 74 cards ». ⚠️ NON MESURÉ : la forme sur une page de set ORDINAIRE — une forme autre que « A of B cards » n'est pas lue, donc « absente ».
const OCCURRENCE_TOTAL = /(?<![\d,.])(\d[\d,.]*)\s+of\s+(\d[\d,.]*)\s+cards?\b/gi;
const ENTIER_LISIBLE = /^[1-9]\d{0,6}$/;
/**
 * Le total annoncé par le TEXTE visible de la page (même nettoyage que `annoncesDeNombre`, hors scripts et styles), par ce que la forme AUTORISE : les occurrences de `<A> of <B> cards`.
 * Trois issues : `{ ok: true, total }` (au moins une occurrence, TOUTES identiques, A = B, entier lisible > 0) ; `{ absent: true }` (aucune occurrence de la forme) ;
 * `{ ok: false, motif }` (un total AFFICHÉ mais inexploitable : valeurs différentes, A ≠ B = vue filtrée ou partielle, nombre illisible ou nul).
 */
function totalAnnonce(html) {
    const texte = String(html ?? '').replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
    const vues = [...texte.matchAll(OCCURRENCE_TOTAL)].map(m => ({ a: m[1], b: m[2] }));
    if (!vues.length) return { absent: true };
    const illisible = vues.find(v => !ENTIER_LISIBLE.test(v.a) || !ENTIER_LISIBLE.test(v.b));
    if (illisible) return { ok: false, motif: `total annoncé illisible ou nul : « ${coupe(illisible.a, 20)} of ${coupe(illisible.b, 20)} cards »` };
    const filtree = vues.find(v => v.a !== v.b);
    if (filtree) return { ok: false, motif: `vue filtrée : ${filtree.a} of ${filtree.b} cards` };
    const valeurs = [...new Set(vues.map(v => Number(v.b)))];
    if (valeurs.length !== 1) return { ok: false, motif: `totaux annoncés contradictoires : ${valeurs.join(', ')}` };   // GARDE:pk-total-unique
    return { ok: true, total: valeurs[0] };
}
/** Le total qu'une fiche ou un fichier de page ARCHIVÉ déclare (`totalAnnonce`) sous la forme de `totalAnnonce(html)` : null/absent = { absent: true } ; entier > 0 = ok ; toute autre chose = inexploitable. */
function totalDeFichier(valeur) {
    if (valeur === null || valeur === undefined) return { absent: true };
    if (Number.isInteger(valeur) && valeur > 0) return { ok: true, total: valeur };
    return { ok: false, motif: `totalAnnonce illisible dans le fichier : ${coupe(JSON.stringify(valeur) ?? String(valeur), 30)}` };
}
/**
 * LA règle de complétude d'une page (§21 bis : le récepteur, l'import et la mesure passive la lisent, jamais une copie) : la page est complète si et seulement si
 * `tuiles = ancres − ancres sans numéro`, à l'unité près. `ancres` : le nombre d'ancres de cartes de la page ; `tuiles` : les tuiles lues ; `sansNumero` : la liste écrite des ancres sans numéro
 * (absente = 0, jamais « inconnu = accepté »). Un fichier sans compte d'ancres lisible n'est pas jugé ici (comme avant). Rend { complete, sansNumero (le nombre), motif }.
 * Lot PQ-ANNONCE : `total` (issue de `totalAnnonce(html)` ou de `totalDeFichier(fiche.totalAnnonce)` ; non transmis = absent, jamais « inconnu = accepté »).
 *   · au moins une ancre sans numéro : le total est OBLIGATOIRE, exploitable, et tuiles + sans numéro = total ;
 *   · aucune ancre sans numéro : la règle d'avant ; un total absent ne refuse pas ; un total affiché doit valoir le nombre de tuiles.
 */
function jugerCompletude({ ancres, tuiles, sansNumero, total }) {
    const ts = tuiles || [], sans = compterSansNumero(sansNumero, ts);
    if (!Number.isInteger(ancres)) return { complete: true, sansNumero: sans, motif: null };
    if (ts.length !== ancres - sans) return { complete: false, sansNumero: sans, motif: `page partielle ou forme changée : ${ancres} ancres, ${ts.length} tuiles, ${sans} sans numéro` };   // GARDE:pk-completude
    const t = total && typeof total === 'object' ? total : { absent: true };
    if (t.ok === false) return { complete: false, sansNumero: sans, motif: String(t.motif ?? 'total annoncé inexploitable') };   // GARDE:pk-total-inexploitable
    if (sans > 0) {
        if (t.ok !== true) return { complete: false, sansNumero: sans, motif: 'total annoncé absent : obligatoire quand la page porte des cartes sans numéro' };   // GARDE:pk-total-obligatoire
        if (ts.length + sans !== t.total) return { complete: false, sansNumero: sans, motif: `total annoncé ${t.total} ≠ ${ts.length} tuiles + ${sans} sans numéro` };   // GARDE:pk-total-somme
    } else if (t.ok === true && t.total !== ts.length) return { complete: false, sansNumero: sans, motif: `total annoncé ${t.total} ≠ ${ts.length} tuiles` };   // GARDE:pk-total-concorde
    return { complete: true, sansNumero: sans, motif: null };
}

/**
 * Ce que la page porte et que la garde n'a pas reconnu — pour que le refus SOIT la mesure : la répartition des codes lus sur les tuiles et des dossiers de leurs images (10 au plus
 * chacune, le reste compté), le titre (h1, title), les annonces d'un nombre de cartes, les ancres qui ne sont pas des tuiles, et — si `code` est donné — les ancres SANS NUMÉRO, listées une par
 * une (nom, lien). Ni HTML ni tuile complète : des comptes et des textes tronqués.
 */
function diagnostiquerPage({ html, tuiles, code }) {
    const ts = tuiles || [];
    const c = repartir(ts.map(t => t.code), 'code'), dd = repartir(ts.map(t => DOSSIER_IMAGE.exec(String(t.img ?? ''))?.[1] ?? '(hors forme)'), 'dossier');
    const { h1, title } = lireTitre(html);
    const annonces = annoncesDeNombre(html);
    const r = { codes: c.liste, autresCodes: c.autres, dossiers: dd.liste, autresDossiers: dd.autres, h1: coupe(h1), title: coupe(title), annonces, totalAnnonce: totalAnnonce(html), ancresSansTuile: decrireAncresSansTuile(html), sansNumero: ancresSansNumero(html, code) };
    return { ...r, lignes: lignesDeDiagnostic(r) };
}
/** Les lignes d'affichage d'un diagnostic (récepteur, journal, userscript : UN formatage). */
function lignesDeDiagnostic(r) {
    const liste = (xs, k, autres) => xs.length ? `${xs.map(x => `${x[k]}×${x.n}`).join(', ')}${autres ? `, +${autres} autre(s)` : ''}` : '(aucun)';
    const lignes = [`codes lus sur les tuiles : ${liste(r.codes, 'code', r.autresCodes)}`, `dossiers des images : ${liste(r.dossiers, 'dossier', r.autresDossiers)}`,
        `titre de la page : h1 ${r.h1 == null ? '(aucun)' : `« ${r.h1} »`}, title ${r.title == null ? '(aucun)' : `« ${r.title} »`}`, `nombre de cartes annoncé : ${r.annonces.length ? r.annonces.map(a => `« ${a} »`).join(' ; ') : '(aucune annonce lisible)'}`];
    const ta = r.totalAnnonce;
    if (ta && typeof ta === 'object') lignes.push(`total annoncé (« A of B cards ») : ${ta.ok === true ? ta.total : ta.ok === false ? `inexploitable — ${ta.motif}` : 'absent'}`);
    const a = r.ancresSansTuile;
    if (a && a.n > 0) {
        const ex = a.exemples.map(e => `« ${e.h2 ?? '(sans h2)'} » / « ${e.p ?? '(sans p)'} » / ${e.img ? `img ${e.dossier ?? '(hors forme)'}` : 'sans img'}`).join(' ; ');
        lignes.push(`ancres sans tuile : ${a.n} (sans img ${a.sansImg}, sans h2 ${a.sansH2}, sans « code · numéro » ${a.sansRef}, img sans src ${a.imgSansSrc}, src hors ${HOTE_IMAGES} ${a.srcHorsHote}) ; exemples : ${ex}`);
    }
    const s = r.sansNumero;
    if (Array.isArray(s) && s.length > 0) lignes.push(`ancres sans numéro (comptées à part, listées une par une dans le diagnostic, jamais importées) : ${s.length} ; premières : ${s.slice(0, 3).map(x => `« ${x.nom} » ${x.lien}`).join(' ; ')}`);
    return lignes;
}

/**
 * Cette tuile peut-elle servir une image POUR ce set ? Son code est l'un de ceux que la ligne autorise, et son image est à `images.pikaqian.com/<dossier>/<id de la tuile>.webp` dans l'un
 * des dossiers que la ligne autorise (son propre code, plus `dossiersImages`). Définition unique : le plan, la garde d'image du récepteur et l'import la lisent.
 */
function imageAcceptee(code, tuile, table = TABLE_PIKAQIAN) {
    const d = declarationsDeCode(code, table);
    if (d.declare && !d.valide) return false;   // GARDE:pk-declaration-image
    // page `promo-<x>`, tuile au code <x> : acceptée SEULEMENT avec son image exactement à `promo-<x>/<id>.webp` (la même règle que la forme promo du verdict)
    const x = codeDesTuilesPromo(code);
    if (x !== null && tuile?.code === x) return tuile.img === urlImage(code, tuile.id);   // GARDE:pk-promo-image
    const m = DOSSIER_IMAGE.exec(String(tuile?.img ?? ''));
    if (!m) return false;   // GARDE:pk-image-forme
    if (!d.dossiers.includes(m[1])) return false;   // GARDE:pk-dossier
    if (tuile.img !== urlImage(m[1], tuile.id)) return false;   // GARDE:pk-image-id
    if (!d.codes.includes(tuile.code)) return false;   // GARDE:pk-image-code
    return true;
}

// ── LA PREUVE ET LE PLAN : numéro + tuile sans foil unique + nom — un doute est un trou ──────────────────────────────────
/**
 * @param {{trous: Array<{carte: object, numeroFiche: string|null, idProduct: number}>, tuiles: object[], code: string, slug: string}} o
 * Un trou déjà servi (au même numéro, ou sans numéro dans le set) n'y figure jamais — ADDITIF.
 */
function planifierPikaqian({ trous, tuiles, code, slug, table = TABLE_PIKAQIAN }) {
    // le code <x> d'une page `promo-<x>` compte comme code du set (la fonction unique) ; l'image, elle, reste jugée par imageAcceptee
    const parNumero = new Map(), codePromo = codeDesTuilesPromo(code), codesDuSet = [...declarationsDeCode(code, table).codes, ...(codePromo === null ? [] : [codePromo])];
    for (const t of tuiles || []) { if (!codesDuSet.includes(t.code)) continue; const k = cleNumero(t.numero); if (!k) continue; (parNumero.get(k) || parNumero.set(k, []).get(k)).push(t); }
    const vus = new Set(), plan = [], restes = [], suffixesInconnus = new Map();
    for (const x of trous) {
        const numero = x.numeroFiche ?? null;
        if (T.dejaServi(x.carte, slug, numero)) continue;
        const k = numero ? cleNumero(numero) : null;
        const cle = `${x.carte._id}|${k ?? `sans-numero:${x.idProduct}`}`;
        if (vus.has(cle)) continue;
        vus.add(cle);
        const base = { carteId: x.carte._id, nomEn: x.carte.nomEn ?? null, numero, idProduct: x.idProduct };
        if (!k) { restes.push({ ...base, motif: 'sans-numero' }); continue; }
        if (!x.carte.nomEn) { restes.push({ ...base, motif: 'sans-nom' }); continue; }
        const c = parNumero.get(k) || [];
        if (!c.length) { restes.push({ ...base, motif: 'absente-de-la-source' }); continue; }
        // 🔑 LA TUILE DE BASE SE DÉFINIT PAR CE QU'ELLE AUTORISE : son nom, comparé au nom du produit par la normalisation de production, ne laisse AUCUN
        // suffixe — connu (« Holo ») ou inconnu (« Rainbow Foil »). Toute tuile dont le nom prolonge le nôtre est une variante, pas la base ; les suffixes que
        // `estFoil` ne connaît pas sont COMPTÉS (suffixesInconnus) pour qu'un set non mesuré le dise à sa première lecture.
        const nomNotre = T.nomCompare(x.carte.nomEn);
        const prolonge = t => { const n = T.nomCompare(t.nom); return n.length > nomNotre.length && n.startsWith(nomNotre); };
        for (const t of c) if (prolonge(t) && !estFoil(t.nom)) suffixesInconnus.set(t.id, t.nom);
        const exactes = c.filter(t => T.nomCompare(t.nom) === nomNotre);
        if (exactes.length > 1) { restes.push({ ...base, motif: 'tuile-ambigue', detail: exactes.map(t => t.id).join(', ') }); continue; }
        if (!exactes.length) { restes.push({ ...base, motif: c.some(prolonge) ? 'tuile-a-suffixe' : 'nom-different', detail: `${c.map(t => `« ${t.nom} »`).join(' | ')} à la source, « ${x.carte.nomEn} » chez nous` }); continue; }
        const t = exactes[0];
        // l'adresse de l'image est celle DE CETTE tuile, dans le dossier de CE set : sinon la page se contredit
        if (!imageAcceptee(code, t, table)) { restes.push({ ...base, motif: 'image-incoherente', detail: `${t.img} pour la tuile ${t.id} du set ${code}` }); continue; }
        plan.push({ ...base, tuile: t, url: t.img, voie: 'set+numero+tuile-sans-foil+nom',
            preuve: `pikaqian.com set ${code} : tuile ${t.id} n° ${t.numero}, nom « ${t.nom} » = « ${x.carte.nomEn} » ; numéro identique au nôtre (fiche ${numero}) ; seule tuile dont le nom ne laisse aucun suffixe à ce numéro (${c.length} tuile${c.length > 1 ? 's' : ''} au numéro)` });
    }
    return { plan, restes, suffixesInconnus: [...suffixesInconnus].map(([id, nom]) => ({ id, nom })) };
}

// ── LES ADRESSES ─────────────────────────────────────────────────────────────────────────────────────────────────────
const urlSet = code => { if (!CODE_PK.test(String(code))) throw new Error(`${SOURCE} : code de set « ${code} » hors du motif autorisé`); return `https://${HOTE_PAGES}/sets/${code}`; };
const urlImage = (code, id) => `https://${HOTE_IMAGES}/${code}/${id}.webp`;
const INTERDITS = /^\/(api|admin|auth|login|logout|currency)(\/|$)/i;
const CHEMINS = {
    [HOTE_PAGES]: /^\/(robots\.txt|sets\/[a-z0-9][a-z0-9.-]{0,30})$/,
    [HOTE_IMAGES]: /^\/(robots\.txt|[a-z0-9][a-z0-9.-]{0,30}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp)$/
};

// ── LE CLIENT ───────────────────────────────────────────────────────────────────────────────────────────────────────
const transportFetch = {
    async get(url, { binaire = false } = {}) {
        // ➖ 2026-10-13 : le SEUL appel réseau réel vers PikaQian est fermé — la source est passive (source-passive.js). Les bancs injectent leur propre transport.
        if (estPassive(SOURCE)) throw Object.assign(new Error(`${SOURCE} : ${motifPassif(SOURCE)} — aucune requête partie (${url})`), { passive: true, arret: true });
        let r;
        // `manual` : une redirection n'est JAMAIS suivie par fetch — le client la juge (même hôte, robots.txt, trois sauts au plus)
        try { r = await fetch(url, { headers: { 'User-Agent': UA, Accept: binaire ? 'image/webp,image/*;q=0.8' : 'text/html,*/*;q=0.5' }, redirect: 'manual', signal: AbortSignal.timeout(45000) }); }
        catch (e) { throw Object.assign(new Error(`${e.name === 'TimeoutError' ? 'ETIMEDOUT' : e.cause?.code || 'ERR_NETWORK'} ${url}`), { reseau: true }); }
        const entetes = { cfMitigated: r.headers.get('cf-mitigated'), server: r.headers.get('server'), via: r.headers.get('via') };
        if (r.status >= 300 && r.status < 400) return { status: r.status, location: r.headers.get('location'), ...entetes };
        const type = r.headers.get('content-type') || '';
        // le type exigé est celui que la mesure a vu (image/webp) ; le corps est lu BORNÉ, avec ou sans content-length
        if (binaire && r.ok && /^image\/webp\b/i.test(type)) return { status: r.status, type, octets: await lireBorne(r, IMAGE_MAX_OCTETS, url), ...entetes };
        return { status: r.status, type, texte: (await lireBorne(r, PAGE_MAX_OCTETS, url)).toString('utf8'), ...entetes };
    }
};
/** Le corps d'une réponse, lu par morceaux et ARRÊTÉ au plafond (un content-length absent ou menteur ne protège de rien). Un dépassement compte comme un échec. */
async function lireBorne(reponse, max, url = '') {
    const depasse = () => Object.assign(new Error(`ERR_CORPS_TROP_GROS plus de ${max} octets ${url}`), { reseau: true });
    if (Number(reponse.headers?.get?.('content-length')) > max) throw depasse();
    const lecteur = reponse.body?.getReader?.();
    if (!lecteur) { const b = Buffer.from(await reponse.arrayBuffer()); if (b.length > max) throw depasse(); return b; }
    const morceaux = []; let total = 0;
    for (;;) {
        const { done, value } = await lecteur.read();
        if (done) break;
        total += value.length;
        if (total > max) { await lecteur.cancel().catch(() => { }); throw depasse(); }
        morceaux.push(Buffer.from(value));
    }
    return Buffer.concat(morceaux);
}
// 🔑 LA RÈGLE COMMUNE DE RÉPONSE (2026-10-18) : le défi, la fausse page introuvable, la pause et le compteur par hôte vivent dans reponse-hote.js — ce client les APPELLE, il n'en garde aucune copie.
const RH = require('./reponse-hote');
/** Une réponse est-elle un BLOCAGE (401, 403, 410, 429, `cf-mitigated`, marqueur technique de défi) ? `r` = { status, cfMitigated, texte }. Définition unique : celle du module commun, pour le client ET le réessai espacé. */
const defi = r => RH.detecterDefi(RH.entreeDepuisClient(r, { borne: 5000 })) !== null;
// robots.txt d'un hôte de fichiers (S3) : « AccessDenied » d'un S3 sans cette clé veut dire « pas de robots.txt » — pas un défi (aucune marque Cloudflare)
const robotsAbsentS3 = r => r.status === 403 && !r.cfMitigated && !/cloudflare/i.test(`${r.server ?? ''} ${r.via ?? ''}`) && /AmazonS3|CloudFront/i.test(`${r.server ?? ''} ${r.via ?? ''}`) && /<Code>AccessDenied<\/Code>/.test(String(r.texte ?? '').slice(0, 2000));

/**
 * Le SEUL chemin vers pikaqian.com / images.pikaqian.com. Garde FERMÉE : aucune requête sans verrou global lié, tenu et non perdu ; hôtes
 * ÉNUMÉRÉS, https, chemins ÉNUMÉRÉS (robots.txt, /sets/<code>, /<code>/<uuid>.webp — jamais /api/, /admin/, /auth/…) ; le robots.txt de CHAQUE
 * hôte lu avant sa première page et respecté (illisible : aucune page) ; cadence ≥ 10 s tenue dans une FILE, hôtes confondus (un Crawl-delay plus
 * lent la relève) ; redirections suivies dans l'hôte seulement, trois sauts, robots relu ; 403, 429, `cf-mitigated`, page de défi : BLOQUÉ ;
 * DEUX échecs de suite (5xx, coupure, réponse illisible) : ARRÊT — un arrêt, dans les deux cas, ne se lève pas tout seul.
 */
function fabriquerClientPikaqian({ transport = transportFetch, cadenceMs = CADENCE_MS, verrou = null, pause = ms => new Promise(r => setTimeout(r, ms)), horloge = Date.now, agent = UA, suivi = RH.suiviHote(), dossierPauses = RH.DOSSIER_PAUSES, connues = null } = {}) {
    let lie = verrou, file = Promise.resolve(), dernier = -Infinity, compte = 0, bloque = null, arret = null, suite = 0, plafond = Infinity, pauseHote = null;
    const parHote = {}, robots = new Map();
    let cadenceEff = Math.max(CADENCE_MS, Number(cadenceMs) || 0);        // relevée par un Crawl-delay plus lent, jamais abaissée sous 10 s
    function garde() {
        if (arret) throw arret;
        if (pauseHote) throw pauseHote;                       // la pause de la passe : plus aucune requête vers cet hôte (pas un arrêt définitif)
        if (!lie) throw new Error(`${SOURCE} : aucun verrou global lié (${VERROU_GLOBAL}) — pas de requête sans verrou`);
        if (lie.perdu || !lie.tenu) throw new Error(`${SOURCE} : verrou global ${lie.perdu ? 'PERDU' : 'non tenu'} — pas de requête sans verrou`);
    }
    /** L'adresse, jugée AVANT toute file : hôte énuméré, https, rien d'autre que le chemin. Rend { url, hote, chemin }. */
    function cible(url, hoteVoulu) {
        let u; try { u = new URL(url); } catch { throw new Error(`${SOURCE} : adresse illisible`); }
        if (u.protocol !== 'https:' || u.username || u.password || u.port || u.search || u.hash || !CHEMINS[u.hostname]) throw new Error(`${SOURCE} : « ${u.origin}${u.pathname} » hors de ce que le client autorise (https, ${HOTE_PAGES} et ${HOTE_IMAGES}, sans identifiant, port ni requête)`);
        if (INTERDITS.test(u.pathname)) throw new Error(`${SOURCE} : « ${u.pathname} » est interdit (api, admin, auth, login, logout, currency)`);
        if (!CHEMINS[u.hostname].test(u.pathname)) throw new Error(`${SOURCE} : « ${u.hostname}${u.pathname} » hors des chemins autorisés (robots.txt, /sets/<code>, /<code>/<uuid>.webp)`);
        if (hoteVoulu && u.hostname !== hoteVoulu) throw new Error(`${SOURCE} : « ${u.pathname} » demandé sur ${u.hostname} au lieu de ${hoteVoulu}`);
        return { url: u.href, hote: u.hostname, chemin: u.pathname };
    }
    function echec(erreur) {
        suite++;
        if (suite >= ECHECS_DE_SUITE_MAX) {
            arret = Object.assign(new Error(`${SOURCE} : ${suite} échecs de suite (dernier : ${erreur.message}) — erreur répétée, on s'arrête, plus aucune requête`), { arret: true, repetee: true, status: erreur.status });
            throw arret;
        }
        throw erreur;
    }
    const bloquer = (r, url) => {
        bloque = arret = Object.assign(new Error(`${SOURCE} BLOQUÉ (HTTP ${r.status}${r.cfMitigated ? `, cf-mitigated ${r.cfMitigated}` : ''}) sur ${url} — on s'arrête, plus aucune requête`), { bloque: true, arret: true, status: r.status });
        throw arret;
    };
    /** Une requête de la FILE : cadence, comptes, transport. Une coupure réseau compte comme un échec. */
    async function une(url, o) {
        garde();
        const attente = dernier + cadenceEff - horloge();
        if (attente > 0) await pause(attente);
        garde();
        // le PLAFOND de requêtes de l'unité (taille du plan + marge) : une boucle ou une page démesurée ne peut pas frapper la source sans fin
        if (compte >= plafond) throw Object.assign(new Error(`${SOURCE} : plafond de ${plafond} requêtes atteint pour cette unité — aucune requête de plus`), { arret: true, plafond: true });
        dernier = horloge(); compte++;
        const h = new URL(url).hostname; parHote[h] = (parHote[h] || 0) + 1;
        try { return await transport.get(url, o); }
        catch (e) { if (!e.reseau) throw e; return echec(e); }
    }
    async function assurerRobots(hote) {
        if (robots.has(hote)) return;
        let url = `https://${hote}/robots.txt`, r;
        for (let saut = 0; ; saut++) {
            r = await une(url, {});
            if (!(r.status >= 300 && r.status < 400 && r.location && saut < 3)) break;
            const u = new URL(r.location, url);
            if (u.hostname !== hote || u.pathname !== '/robots.txt') break;      // un robots.txt redirigé ailleurs : on ne peut pas conclure
            url = u.href;
        }
        if (r.status === 404 || r.status === 410 || robotsAbsentS3(r)) { robots.set(hote, null); return; }   // (robots.txt réussi ne remet PAS le compteur d'échecs à zéro : seul un contenu le fait)
        if (defi(r)) bloquer(r, url);
        if (r.status !== 200) { try { echec(Object.assign(new Error(`${r.status} ${url} : robots.txt illisible — on ne peut pas conclure, aucune page`), { robots: true, status: r.status })); } catch (e) { e.robots = true; throw e; } }
        const texte = r.texte ?? '';
        const d = T.delaiDesRobots(texte, agent);
        if (d && d > CRAWL_DELAY_MAX_S) { bloque = arret = Object.assign(new Error(`${SOURCE} : robots.txt de ${hote} demande un Crawl-delay de ${d} s (au-delà de ${CRAWL_DELAY_MAX_S} s) — on s'arrête`), { bloque: true, arret: true, robots: true }); throw arret; }
        if (d) cadenceEff = Math.max(cadenceEff, d * 1000);
        robots.set(hote, texte);
    }
    const enFile = fn => { const p = file.then(fn); file = p.catch(() => { }); return p; };
    async function obtenir(c, o) {
        return enFile(async () => {
            let courant = c;
            for (let saut = 0; ; saut++) {
                RH.garderHote(courant.hote, dossierPauses);       // une pause persistante tient : aucune requête
                await assurerRobots(courant.hote);
                if (!T.autoriseParRobots(robots.get(courant.hote), courant.chemin, agent)) throw Object.assign(new Error(`${SOURCE} : robots.txt de ${courant.hote} interdit ${courant.chemin} — aucune requête`), { robots: true });
                const r = await une(courant.url, o);
                if (defi(r)) bloquer(r, courant.url);
                if (r.status >= 300 && r.status < 400) {
                    suite = 0;
                    if (saut >= 3) throw new Error(`${SOURCE} : plus de 3 redirections depuis ${c.url} — on ne suit pas une boucle`);
                    if (!r.location) throw new Error(`${SOURCE} : redirection ${r.status} sans adresse sur ${courant.url}`);
                    courant = cible(new URL(r.location, courant.url).href, c.hote);          // lève hors de l'hôte de départ, hors des chemins autorisés, sur /api/
                    continue;
                }
                if (o?.binaire) {
                    // UNE IMAGE se CLASSE : image · absente (404) · fausse page introuvable (200 text/html sans marqueur → absente, et le compteur) · défi · ambiguë · transitoire · inattendue
                    const x = RH.traiterImage(r, { suivi, hote: courant.hote, url: courant.url, dossierPauses, connues });
                    if (x.action === 'arret-definitif') bloquer(r, courant.url);
                    if (x.action === 'pause' || x.action === 'pause-persistante') { suite = 0; pauseHote = RH.erreurPause(x, courant.hote, courant.url, x.fichier ? { fichier: x.fichier } : {}); throw pauseHote; }
                    if (x.action === 'transitoire') return echec(Object.assign(new Error(`${r.status} ${courant.url}`), { status: r.status }));
                    if (x.action === 'absente') { suite = 0; return null; }
                } else {
                    if (r.status === 404) { suite = 0; return null; }
                    if (r.status >= 400) return echec(Object.assign(new Error(`${r.status} ${courant.url}`), { status: r.status }));
                }
                if (o?.binaire && !r.octets) return echec(new Error(`${SOURCE} : « ${r.type} » n'est pas une image webp (${courant.url})`));
                // un fichier que l'appelant ne sait pas lire (sharp) est un échec, pas un succès : il compte dans les « deux de suite »
                if (o?.verifier) { try { await o.verifier(r.octets); } catch (e) { return echec(Object.assign(new Error(`${SOURCE} : image illisible (${e.message}) ${courant.url}`), { illisible: true })); } }
                suite = 0;
                return r;
            }
        });
    }
    return {
        lier(v) { lie = v; },
        page: async url => { const c = cible(url, HOTE_PAGES); if (!/^\/sets\//.test(c.chemin)) throw new Error(`${SOURCE} : une page se demande sous /sets/ (${c.chemin})`); garde(); return (await obtenir(c))?.texte ?? null; },
        image: async (url, verifier = null) => { const c = cible(url, HOTE_IMAGES); if (c.chemin === '/robots.txt') throw new Error(`${SOURCE} : une image se demande sous /<code>/<uuid>.webp`); garde(); return (await obtenir(c, { binaire: true, verifier }))?.octets ?? null; },
        /** Le compteur d'échecs de suite, PERSISTÉ par l'appelant entre deux unités (le client est neuf à chaque unité) : relu ici, écrit à la fin. */
        fixerSuite(n) { suite = Math.max(0, Number(n) || 0); },
        suiteEchecs: () => suite,
        plafonner(n) { plafond = compte + n; },
        compteRequetes: () => compte,
        requetesParHote: () => ({ ...parHote }),
        cadence: () => cadenceEff,
        bloque: () => bloque,
        arret: () => arret,
        pause: () => pauseHote,
        suivi: () => suivi
    };
}

// ── L'IDENTIFIANT ET LE RETRAIT EN UN LOT ───────────────────────────────────────────────────────────────────────────────
const idImagePikaqian = (slug, carteId, numero) => `${SOURCE}/${slug}/${carteId}/${String(numero ?? '').replace(/[^0-9A-Za-z]/g, '') || 'sans-numero'}/${LANGUE}`;
/** Ce qu'un retrait en un lot retire : les entrées `cartes.images` de CETTE source ET de CE lot — rien d'autre — et leurs clés R2 (vignette comprise). */
function planRetraitPikaqian(cartes) {
    const touchees = [], cles = [];
    let entrees = 0;
    for (const c of cartes) {
        const es = (c.images || []).filter(e => e.source === SOURCE && e.lot === LOT);
        if (!es.length) continue;
        touchees.push(c._id); entrees += es.length; cles.push(...es.flatMap(e => [e.cleR2, e.vignette?.cleR2].filter(Boolean)));
    }
    return { cartes: touchees, entrees, cles };
}

module.exports = {
    SOURCE, HOTE_PAGES, HOTE_IMAGES, LOT, MENTION, CADENCE_MS, UA, VERROU_GLOBAL, VERROU_GLOBAL_MS, ID_ALERTE, LANGUE, PROVENANCE_PAR_DEFAUT, ECHECS_DE_SUITE_MAX, ID_SUITE, lireBorne, PAGE_MAX_OCTETS, IMAGE_MAX_OCTETS, CODE_PK, compterAncresCartes,
    lireTitre, titreLu, diagnostiquerPage, lignesDeDiagnostic, imageAcceptee, decrireAncresSansTuile, lireAncres, ancresSansNumero, compterSansNumero, jugerCompletude, totalAnnonce, totalDeFichier,
    lireTuiles, lireOrigines, estFoil, verdictDePage, planifierPikaqian, urlSet, urlImage, fabriquerClientPikaqian, idImagePikaqian, planRetraitPikaqian,
    // le jugement « défi / blocage » d'une réponse : UNE définition, relue par le réessai espacé (collecte-cartes/reessai-pikaqian.js), jamais recopiée
    defi
};
