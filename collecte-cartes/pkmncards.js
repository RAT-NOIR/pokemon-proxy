// ============================================================
// SCANS ANGLAIS 733×1024 d'une source de cartes — IMPORT depuis les sitemaps EN CACHE (lot PKMNCARDS, 2026-10-17)
// ============================================================
// 🔑 DÉCISION DU TESTEUR (2026-10-17 soir) : « le téléchargement est accordé. Seulement les images, dont les adresses viennent du sitemap. Aucune page de recherche, aucune page ouverte en série
// si le sitemap suffit. 5 s ou plus entre deux requêtes, identité honnête, sans cookie, arrêt au premier 403, 429 ou défi. Le nom de la source n'apparaît jamais en public.
// Contrôle de chaque image : aucun filigrane, aucune étiquette incrustée, aucun dos de carte. L'appariement se fait carte par carte (set, numéro et nom concordants). Les cas douteux sont sautés
// et notés, jamais devinés. Ordre : a. Kits Dresseur (ajouts) · b. McDonald's (remplacement des basses définitions) · c. promos (W, Best of Game) · d. les images pokemon.com en 245 px, si c'est la même impression. »
//
// Ce module est PUR : aucune requête, aucune base, aucune écriture. Il lit les sitemaps (texte), décompose les adresses de CARTE, apparie des trous et dit pourquoi il refuse. Chaque règle s'écrit
// par ce qu'elle AUTORISE :
//   · la TABLE des sets est FERMÉE (un set de la source -> les slugSets Cardmarket qu'il peut servir) ; un set hors table ne sert à rien ;
//   · une adresse d'image n'est valable que sur l'hôte de la source, en https, sans port ni identifiants ni paramètres, à plat sous /wp-content/uploads/ ; robots.txt est la seule autre adresse ;
//   · TROIS ÉLÉMENTS : le set (la table), le numéro (la règle de production `cleNumero`, lettres et préfixes de demi-deck compris), le nom (la normalisation du témoin de la production) ;
//     une fiche sans numéro n'a un numéro que par un SECOND élément écrit (le numéro d'origine du slug Cardmarket) ; sinon elle est sautée ;
//   · un doute est un trou, avec son motif : nom qui contredit, numéro absent, deux candidats, deux images pour une fiche, une image pour deux fiches ;
//   · le nom de la source n'est JAMAIS un champ public : `SOURCE = 'pkc'`, `LOT = 'pkc-2026-10'`, clé R2 `pkc/…`.
const { cleNumero, normaliserNom } = require('./jointure');
const PK = require('./pokemoncom');
const T = require('./tpc');
const { estDosDeCarte } = require('./hotes-images-ptcgio');
const { largeurMinDe, largeurOriginaleDe } = require('./seuils-images');
const { entreesARemplacer, RATIO_NETTEMENT_PLUS_GRANDE } = require('./basse-definition');

const SOURCE = 'pkc';
const LOT = 'pkc-2026-10';
const HOTE = 'pkmncards.com';
const PREFIXE_CHEMIN = '/wp-content/uploads/';
const PREFIXE_CARTE = '/card/';
const UA = PK.UA;                                   // l'agent honnête du dépôt
const CADENCE_MS = PK.CADENCE_MS;                   // 5 s
const MENTION = T.MENTION;
const DOSSIER_SITEMAPS = 'C:\\Users\\Yung\\rat-market-travail\\catalogue\\pkmncards-cache\\sitemaps';
const DOSSIER_CACHE = 'C:\\Users\\Yung\\rat-market-travail\\catalogue\\pkmncards-cache\\images';
const DOSSIER_LOT = 'C:\\Users\\Yung\\rat-market-travail\\catalogue\\couverture\\S7\\PKMNCARDS';
const ROBOTS = `https://${HOTE}/robots.txt`;
const LOTS = Object.freeze(['kits', 'mcdo', 'promos', 'pkmcom', 'autres']);
// Largeur et rapport d'une carte servie par cette source (733×1024 lu sur une page : 0,716).
const RAPPORT_MIN = 0.69, RAPPORT_MAX = 0.74;
const LARGEUR_ATTENDUE = 733;
// Les dos de carte propres à la source : vide tant qu'un dos n'a pas été VU (collecte-cartes/hotes-images-ptcgio.js porte celui du serveur d'images). La parade mécanique, elle, est `imagesIdentiques`.
const EMPREINTES_DOS_SOURCE = Object.freeze([]);

// ── LA TABLE FERMÉE : set de la source -> slugSets Cardmarket ──────────────────────────────────────────────────────────────────
// `code` : le code que la source met entre le set et le numéro (lu sur les sitemaps réels) ; `demi` : l'expression que le SLUG Cardmarket d'un produit doit porter pour être de cette moitié de kit ;
// `prefixe` : la lettre que Cardmarket met devant le numéro de cette moitié (DP : L, M) ; `numeroDuSlug` : où lire le numéro d'une fiche sans numéro.
// Les équivalences se PROUVENT carte par carte (numéro ET nom) à chaque plan : la table dit seulement où chercher.
// `lots` : les lots SUPPLÉMENTAIRES qui lisent aussi cette ligne (le lot « autres » reprend des sets déjà à la table : 30th Celebration, les kits Sun & Moon)
const ligne = o => Object.freeze({ ...o, slugSets: Object.freeze([...o.slugSets]), ...(o.lots ? { lots: Object.freeze([...o.lots]) } : {}) });
const duLot = (l, lot) => l.lot === lot || !!l.lots?.includes(lot);
const TABLE = Object.freeze({
    // a. Kits Dresseur
    'xy-trainer-kit-sylveon': ligne({ lot: 'kits', slugSets: ['XY-Trainer-Kit'], code: 'tk6s', demi: /TK6\d+S$/ }),
    'xy-trainer-kit-noivern': ligne({ lot: 'kits', slugSets: ['XY-Trainer-Kit'], code: 'tk6n', demi: /TK6\d+N$/ }),
    'xy-trainer-kit-bisharp': ligne({ lot: 'kits', slugSets: ['XY-Trainer-Kit-Bisharp-Wigglytuff'], code: 'tk7a', demi: /TK7\d+B$/ }),
    'xy-trainer-kit-wigglytuff': ligne({ lot: 'kits', slugSets: ['XY-Trainer-Kit-Bisharp-Wigglytuff'], code: 'tk7b', demi: /TK7\d+W$/ }),
    'xy-trainer-kit-latias': ligne({ lot: 'kits', slugSets: ['XY-Trainer-Kit-Latias-Latios'], code: 'tk8a', demi: /TK8\d+A$/ }),
    'xy-trainer-kit-latios': ligne({ lot: 'kits', slugSets: ['XY-Trainer-Kit-Latias-Latios'], code: 'tk8o', demi: /TK8\d+O$/ }),
    'xy-trainer-kit-pikachu-libre': ligne({ lot: 'kits', slugSets: ['XY-Trainer-Kit-Pikachu-Libre-Suicune'], code: 'tk9p', demi: /TK9P/ }),
    'xy-trainer-kit-suicune': ligne({ lot: 'kits', slugSets: ['XY-Trainer-Kit-Pikachu-Libre-Suicune'], code: 'tk9s', demi: /TK9S/ }),
    'sun-moon-trainer-kit-lycanroc': ligne({ lot: 'kits', slugSets: ['SM-Trainer-Kit-Lycanroc-Alolan-Raichu'], code: 'tk10l', demi: /TK10L\d+$/, lots: ['autres'] }),
    'sun-moon-trainer-kit-alolan-raichu': ligne({ lot: 'kits', slugSets: ['SM-Trainer-Kit-Lycanroc-Alolan-Raichu'], code: 'tk10a', demi: /TK10A\d+$/, lots: ['autres'] }),
    'black-white-trainer-kit-excadrill': ligne({ lot: 'kits', slugSets: ['BW-Trainer-Kit'], code: 'tk5e', demi: /TK5\d+E$/ }),
    'black-white-trainer-kit-zoroark': ligne({ lot: 'kits', slugSets: ['BW-Trainer-Kit'], code: 'tk5z', demi: /TK5\d+Z$/ }),
    'hs-trainer-kit-gyarados': ligne({ lot: 'kits', slugSets: ['HS-Trainer-Kit'], code: 'tk4g' }),
    'hs-trainer-kit-raichu': ligne({ lot: 'kits', slugSets: ['HS-Trainer-Kit'], code: 'tk4r' }),
    'diamond-pearl-trainer-kit-lucario': ligne({ lot: 'kits', slugSets: ['DP-Trainer-Kit'], code: 'tk3l', prefixe: 'L' }),
    'diamond-pearl-trainer-kit-manaphy': ligne({ lot: 'kits', slugSets: ['DP-Trainer-Kit'], code: 'tk3m', prefixe: 'M' }),
    'ex-trainer-kit-latias': ligne({ lot: 'kits', slugSets: ['EX-Trainer-Kit'], code: 'tk1a', demi: /TK1Latias/ }),
    'ex-trainer-kit-latios': ligne({ lot: 'kits', slugSets: ['EX-Trainer-Kit'], code: 'tk1o', demi: /TK1Latios/ }),
    'ex-trainer-kit-plusle': ligne({ lot: 'kits', slugSets: ['EX-Trainer-Kit-2'], code: 'tk2p', demi: /TK2P\d+$/, numeroDuSlug: /TK2P(\d+)$/ }),
    'ex-trainer-kit-minun': ligne({ lot: 'kits', slugSets: ['EX-Trainer-Kit-2'], code: 'tk2m', demi: /TK2M\d+$/, numeroDuSlug: /TK2M(\d+)$/ }),
    // b. McDonald's
    'mcdonalds-collection-2011': ligne({ lot: 'mcdo', slugSets: ['McDonalds-Collection-2011'], code: 'mcd11' }),
    'mcdonalds-collection-2012': ligne({ lot: 'mcdo', slugSets: ['McDonalds-Collection-2012'], code: 'mcd12' }),
    'mcdonalds-collection-2016': ligne({ lot: 'mcdo', slugSets: ['McDonalds-Collection-2016'], code: 'mcd16' }),
    'mcdonalds-collection-2019': ligne({ lot: 'mcdo', slugSets: ['McDonalds-Collection-2019'], code: 'mcd19' }),
    'mcdonalds-collection-2021': ligne({ lot: 'mcdo', slugSets: ['McDonalds-Collection-25th-Anniversary'], code: 'mcd21' }),
    'mcdonalds-collection-2022': ligne({ lot: 'mcdo', slugSets: ['McDonalds-Collection-2022'], code: 'mcd22' }),
    'mcdonalds-match-battle-2023': ligne({ lot: 'mcdo', slugSets: ['McDonalds-Match-Battle-2023'], code: 'm23' }),
    // c. promos
    'wizards-black-star-promos': ligne({ lot: 'promos', slugSets: ['Wizards-Black-Star-Promos', 'W-Promos'], code: null }),
    'best-of-game': ligne({ lot: 'promos', slugSets: ['Best-of-Game-Cards-Promos'], code: null }),
    // d. les sets des images pokemon.com en 245 px (seules les cibles du plan pokemon.com sont offertes à cette table)
    'unseen-forces': ligne({ lot: 'pkmcom', slugSets: ['EX-Unseen-Forces'], code: 'uf' }),
    'heartgold-soulsilver': ligne({ lot: 'pkmcom', slugSets: ['HeartGold-SoulSilver'], code: 'hs' }),
    'sword-shield-promos': ligne({ lot: 'pkmcom', slugSets: ['SWSH-Black-Star-Promos'], code: null }),
    'scarlet-violet-promos': ligne({ lot: 'pkmcom', slugSets: ['SV-Black-Star-Promos'], code: 'svp' }),
    '30th-celebration': ligne({ lot: 'pkmcom', slugSets: ['30th-Celebration'], code: '30c', lots: ['autres'] }),
    // (correction 1) les sets des 5 remplacements du plan pokemon.com (entrée japonaise refusée au numéro d'un produit anglais)
    // lot « autres » (décision du testeur, 17/10 soir : « type-null : on prend quand même les petits gains ») : les trous anglais que la mesure du dépôt PTCG-database a trouvés EN PLUS des quatre lots
    'cosmic-eclipse': ligne({ lot: 'autres', slugSets: ['Cosmic-Eclipse'], code: 'cec' }),
    // API-52 L4 (25/10) : les vrais scans « a » (marque « Yellow A ») de 4 produits ; chaque set existe dans les sitemaps des sets, chaque code est lu sur l'adresse réelle du sitemap en cache
    'burning-shadows': ligne({ lot: 'autres', slugSets: ['Burning-Shadows'], code: 'bus' }),
    'xy-promos': ligne({ lot: 'autres', slugSets: ['XY-Black-Star-Promos'], code: 'xyp' }),
    'ultra-prism': ligne({ lot: 'autres', slugSets: ['Ultra-Prism'], code: 'upr' }),
    'shining-legends': ligne({ lot: 'pkmcom', slugSets: ['Shining-Legends'], code: 'slg' }),
    'forbidden-light': ligne({ lot: 'pkmcom', slugSets: ['Forbidden-Light'], code: 'fli' }),
    'lost-origin': ligne({ lot: 'pkmcom', slugSets: ['Lost-Origin'], code: 'lor' })
});
const SETS_PAR_LONGUEUR = Object.keys(TABLE).sort((a, b) => b.length - a.length);
// Les sets dont chaque image se REGARDE avant l'écriture (la Classic Collection de 30th Celebration : une marque « 30 » dans le coin) — et dont le numéro d'origine du slug n'est pas celui de la source.
const SETS_A_REGARDER = PK.SETS_A_REGARDER;
const SETS_SANS_NUMERO_DE_SLUG = PK.SETS_SANS_NUMERO_DE_SLUG;

// ── les adresses ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Une adresse d'image valable : https, hôte seul, sans port/identifiants/requête/ancre, À PLAT sous /wp-content/uploads/, fichier png|jpg|jpeg|webp sans remontée ni encodage. */
function urlImageValide(url) {
    if (typeof url !== 'string' || !url || /\.\.|%|\\/.test(url)) return false;
    let u; try { u = new URL(url); } catch { return false; }
    if (u.protocol !== 'https:' || u.hostname !== HOTE || u.port || u.username || u.password || u.search || u.hash) return false;
    if (!u.pathname.startsWith(PREFIXE_CHEMIN)) return false;
    return /^[A-Za-z0-9_.-]+\.(png|jpg|jpeg|webp)$/.test(u.pathname.slice(PREFIXE_CHEMIN.length));
}
const urlRobotsValide = url => url === ROBOTS;
/** Les deux seules adresses que le collecteur peut demander. */
const adressePermise = url => urlRobotsValide(url) || urlImageValide(url);

// ── les sitemaps ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Les entrées {loc, img} d'un texte de sitemap ; une entrée hors règle est ÉCARTÉE et nommée. Lève si le texte ne porte aucune entrée (un vide n'est pas une absence). */
function lireSitemapTexte(texte) {
    const entrees = [], ecartees = [];
    const blocs = [...String(texte ?? '').matchAll(/<url>([\s\S]*?)<\/url>/g)].map(m => m[1]);
    if (!blocs.length) throw new Error('sitemap : aucune entrée <url> lue — un fichier illisible ou vide, pas une absence');
    for (const b of blocs) {
        const loc = (/<loc>([^<]*)<\/loc>/.exec(b) || [])[1] ?? null;
        const imgs = [...b.matchAll(/<image:loc>([^<]*)<\/image:loc>/g)].map(m => m[1]);
        if (!loc || !loc.startsWith(`https://${HOTE}/`)) { ecartees.push({ loc, motif: 'loc-hors-hote' }); continue; }
        if (!imgs.length) { ecartees.push({ loc, motif: 'sans-image' }); continue; }
        if (imgs.length > 1) { ecartees.push({ loc, motif: 'plusieurs-images' }); continue; }
        if (!urlImageValide(imgs[0])) { ecartees.push({ loc, motif: 'image-hors-regle' }); continue; }
        entrees.push({ loc, img: imgs[0] });
    }
    return { entrees, ecartees };
}
/** Lit les pkmn_card-sitemap*.xml d'un dossier (le cache : aucune requête). */
function lireSitemaps(dossier = DOSSIER_SITEMAPS) {
    const fs = require('fs'), path = require('path');
    const fichiers = fs.readdirSync(dossier).filter(f => /^pkmn_card-sitemap\d*\.xml$/.test(f)).sort();
    if (!fichiers.length) throw new Error(`sitemaps : aucun pkmn_card-sitemap*.xml dans ${dossier}`);
    const entrees = [], ecartees = [];
    for (const f of fichiers) { const r = lireSitemapTexte(fs.readFileSync(path.join(dossier, f), 'utf8')); entrees.push(...r.entrees); ecartees.push(...r.ecartees.map(e => ({ ...e, fichier: f }))); }
    return { entrees, ecartees, fichiers: fichiers.length };
}

// ── décomposer l'adresse d'une CARTE : <nom>-<set>-[<code>-]<numéro> ──────────────────────────────────────────────────────────
/** @returns {{nom: string, pkcSet: string, code: string|null, numero: string}|null} null si l'adresse n'est pas celle d'une carte d'un set de la table, STRICTEMENT (code attendu, un seul numéro). */
function decomposer(loc) {
    const debut = `https://${HOTE}${PREFIXE_CARTE}`;
    if (typeof loc !== 'string' || !loc.startsWith(debut) || !loc.endsWith('/')) return null;
    const s = loc.slice(debut.length, -1);
    if (!/^[a-z0-9_-]+$/.test(s)) return null;
    for (const pkcSet of SETS_PAR_LONGUEUR) {
        const marque = `-${pkcSet}-`, i = s.lastIndexOf(marque);
        if (i <= 0) continue;
        const reste = s.slice(i + marque.length), code = TABLE[pkcSet].code;
        const m = code ? new RegExp(`^${code}-([a-z0-9]+)$`).exec(reste) : /^([a-z0-9]+)$/.exec(reste);
        if (m) return { nom: s.slice(0, i).replace(/-/g, ' '), pkcSet, code: code ?? null, numero: m[1] };
    }
    return null;
}
/** Les entrées lisibles d'un sitemap (celles d'un set de la table), les illisibles (le set y figure mais l'adresse ne se lit pas) et le nombre d'entrées hors table. */
function indexer(entrees) {
    const lues = [], illisibles = [];
    let horsTable = 0;
    for (const e of entrees) {
        const d = decomposer(e.loc);
        if (d) { lues.push({ ...d, loc: e.loc, url: e.img }); continue; }
        const s = e.loc.slice(`https://${HOTE}${PREFIXE_CARTE}`.length).replace(/\/$/, '');
        if (SETS_PAR_LONGUEUR.some(p => s.includes(`-${p}-`) || s.endsWith(`-${p}`))) illisibles.push({ loc: e.loc, motif: 'adresse-illisible' }); else horsTable++;
    }
    return { lues, illisibles, horsTable };
}

// ── l'appariement ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const nomNorm = normaliserNom;
// 🔑 (correction 2) le témoin du nom est la règle de PRODUCTION (`normaliserNom`, jointure.js) appliquée au nom de NOTRE carte, et à lui seul : le nom lu dans le slug Cardmarket n'est plus un témoin (il laissait
// passer un nom qui contredit la carte mais suit le slug). Seule tolérance, écrite : la source écrit « Fighting Energy » là où notre carte s'appelle « Basic Fighting Energy » (préfixe « Basic » retiré des DEUX côtés).
// et les ACCENTS repliés des deux côtés (la source écrit « poke ball » là où notre carte s'appelle « Poké Ball » ; normaliserNom ne les plie pas) — le pli s'ajoute à la règle de production, il ne la remplace pas.
const plier = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '');
const sansBasic = n => nomNorm(plier(n)).replace(/^basic/, '');
const nomsDeLaFiche = t => new Set([t.carte?.nomEn].filter(Boolean).flatMap(n => [nomNorm(n), nomNorm(plier(n)), sansBasic(n)]));
// (BASSE-DEF) « nettement plus grande » : au moins RATIO_NETTEMENT_PLUS_GRANDE fois la largeur de l'ORIGINAL de l'entrée actuelle ; notre image nominale fait LARGEUR_ATTENDUE (733) de large
const sortiraitPeutEtre = e => estBasse(e) || (largeurOriginaleDe(e) != null && LARGEUR_ATTENDUE >= RATIO_NETTEMENT_PLUS_GRANDE * largeurOriginaleDe(e));
const estBasse = e => e?.basseDefinition === true || (typeof e?.w === 'number' && e.w > 0 && e.w < 350 && !(e.wOriginal > 0)) || (typeof e?.wOriginal === 'number' && e.wOriginal > 0 && e.wOriginal < 350);
const cleR2 = (slugSet, numero, carteId) => `${SOURCE}/${slugSet}/${cleNum(numero)}-${carteId}-en.webp`;
const cleNum = n => String(n ?? '').replace(/[^0-9A-Za-z]/g, '') || 'sans-numero';
const idImage = (slugSet, carteId, numero) => `${SOURCE}/${slugSet}/${carteId}/${cleNum(numero)}/en`;

/**
 * @param {{trous: object[], entrees: object[], lot?: string|null, refus?: Function}} o
 *   trous : { idProduct, carteId, slugSet, numeroFiche, slugProduit, carte:{_id, nomEn, images} } ; entrees : indexer().lues ; refus(entrée, slugSet) -> motif|null : la règle du site.
 * @returns {{plan: object[], restes: object[]}} plan : une unité par FICHE (carte, numéro) avec son action `ajout` | `remplacement`.
 */
function apparier({ trous, entrees, lot = null, refus = PK.REFUS_PAR_DEFAUT, ficheDuSite = null, documents = new Map() }) {
    const restes = [];
    const reste = (t, motif, detail) => restes.push({ idProduct: t.idProduct, carteId: t.carte._id, nomEn: t.carte.nomEn ?? null, numero: t.numeroFiche ?? null, slugSet: t.slugSet, motif, ...(detail ? { detail } : {}) });
    const parSet = new Map();
    for (const e of entrees) (parSet.get(e.pkcSet) || parSet.set(e.pkcSet, []).get(e.pkcSet)).push(e);
    const resolus = [];
    for (const t of trous) {
        const lignes = Object.entries(TABLE).filter(([, l]) => (lot == null || duLot(l, lot)) && l.slugSets.includes(t.slugSet));
        if (!lignes.length) { reste(t, 'set-hors-table'); continue; }
        // la moitié du kit se lit au slug ; si aucune moitié ne se reconnaît, toutes restent candidates (et le départage échoue honnêtement)
        const slug = String(t.slugProduit ?? '');
        const reconnues = lignes.filter(([, l]) => l.demi && l.demi.test(slug));
        const choisies = reconnues.length ? reconnues : lignes;
        const numFiche = t.numeroFiche != null && String(t.numeroFiche).trim() !== '' ? String(t.numeroFiche).trim() : null;
        let numero = numFiche, depuisSlug = false;
        if (numero == null) {
            for (const [, l] of choisies) { const m = l.numeroDuSlug ? l.numeroDuSlug.exec(slug) : null; if (m) { numero = m[1]; depuisSlug = true; break; } }
            if (numero == null && !SETS_SANS_NUMERO_DE_SLUG.includes(t.slugSet)) { const n = PK.numeroDuSlug(slug); if (n != null) { numero = n; depuisSlug = true; } }
        }
        // ── déjà servi ? (la règle du site décide ; une entrée refusée n'est jamais « servie ») ─────────────────────────────────────
        const clef = numero == null ? null : cleNumero(numero);
        const auNumero = (t.carte.images || []).filter(e => e && e.set === t.slugSet && (e.numero == null || (clef != null && cleNumero(e.numero) === clef)));
        const jugees = auNumero.map(e => ({ e, motif: refus(e, t.slugSet) }));
        const admises = jugees.filter(x => x.motif === null).map(x => x.e);
        const refusees = jugees.filter(x => x.motif !== null);
        // une entrée admise qui ne peut JAMAIS sortir (ni basse définition, ni nettement plus petite que notre image nominale) sert la fiche ; celles qui pourraient sortir sont jugées par la règle commune plus bas
        if (admises.some(e => !sortiraitPeutEtre(e))) { reste(t, 'deja-servi'); continue; }
        // 🔑 DOCTRINE DU TESTEUR (17/10, soir) : « un remplacement est permis si l'image actuelle est fausse, en basse définition ou empruntée ». Un scan d'une AUTRE LANGUE refusé par la règle du site
        // (motif « langue:… ») au numéro exact d'un produit anglais est une image FAUSSE pour ce produit : il est remplacé (l'ancienne est gardée, état « remplace »). Tout autre refus, ou une entrée refusée
        // sans numéro (elle couvrirait tout le set), reste sauté et noté.
        let aRetirerFausses = [];
        if (!admises.length && refusees.length) {
            const fausses = refusees.every(x => String(x.motif).startsWith('langue') && x.e.numero != null && clef != null && cleNumero(x.e.numero) === clef);
            if (!fausses) { reste(t, 'entree-refusee-au-numero', `entrée(s) refusée(s) par la règle du site au même numéro (${refusees.map(x => `${x.e.cleR2} [${x.e.source}, ${x.motif}]`).join(' ; ')}) : ni une autre langue au numéro exact, ni une entrée numérotée — modification qui attend le testeur`); continue; }
            aRetirerFausses = refusees.map(x => ({ ...x.e, motifRemplacement: `fausse : ${x.motif}` }));
        }
        if (numero == null) { reste(t, 'sans-numero', 'fiche sans numéro et sans second élément écrit (numéro d\'origine du slug) : jamais appariée par le nom seul'); continue; }
        // ── les candidats : set, numéro, nom ───────────────────────────────────────────────────────────────────────────────────────
        const candidats = [];
        for (const [pkcSet, l] of choisies) for (const e of parSet.get(pkcSet) || []) {
            const cle = cleNumero(l.prefixe ? `${l.prefixe}${e.numero}` : e.numero);
            if (cle === clef) candidats.push(e);
        }
        if (!candidats.length) { reste(t, 'numero-absent-de-la-source', `n°${numero} dans ${choisies.map(([k]) => k).join(', ')}`); continue; }
        const miens = nomsDeLaFiche(t);
        const nomOk = e => miens.has(nomNorm(e.nom)) || miens.has(nomNorm(plier(e.nom))) || miens.has(sansBasic(e.nom));
        const concordants = candidats.filter(nomOk);
        if (!concordants.length) { reste(t, 'nom-contredit', `source « ${candidats.map(e => e.nom).join(' / ')} », fiche « ${t.carte.nomEn} »`); continue; }
        if (new Set(concordants.map(e => e.url)).size > 1) { reste(t, 'deux-candidats', `${concordants.map(e => `${e.pkcSet} n°${e.numero}`).join(' ; ')}${reconnues.length ? '' : ' (moitié du kit illisible au slug)'}`); continue; }
        const choisie = concordants[0];
        if (!urlImageValide(choisie.url)) { reste(t, 'adresse-hors-regle', 'adresse du sitemap hors des règles'); continue; }
        // ── ajout ou remplacement ───────────────────────────────────────────────────────────────────────────────────────────────────
        // LA RÈGLE COMMUNE (basse-definition.js, fusionnée) : elle exige le DOCUMENT `images` de chaque entrée actuelle (identité d'impression = marqueurs de l'entrée ET du document ; document absent -> rien ne sort) et
        // une largeur de candidate connue — au plan, notre largeur nominale (733 px, lue sur une page de la source) ; à l'écriture, celle de l'image en cache
        let remplace = [...aRetirerFausses];
        const candidat = { set: t.slugSet, numero: t.numeroFiche ?? null, langue: 'en', source: SOURCE, cleR2: cleR2(t.slugSet, t.numeroFiche ?? null, t.carte._id), wOriginal: LARGEUR_ATTENDUE };
        if (aRetirerFausses.length) {
            // l'image FAUSSE (autre langue refusée) sort par SA branche, mais l'IDENTITÉ d'impression se juge par la règle commune : entrée + document concordants, sinon rien ne sort
            const identite = entreesARemplacer(aRetirerFausses.map(e => ({ ...e, langue: 'en', basseDefinition: true })), candidat, { documents });
            if (identite.length !== aRetirerFausses.length) { reste(t, 'entree-refusee-au-numero', `entrée(s) refusée(s) dont le document \`images\` manque ou ne concorde pas (la règle commune exige le document) : ${aRetirerFausses.map(e => e.cleR2).join(' ; ')}`); continue; }
        }
        if (admises.length) {
            remplace = [...aRetirerFausses, ...entreesARemplacer((t.carte.images || []).filter(e => e && admises.includes(e)), candidat, { documents }).map(e => ({ ...e, motifRemplacement: 'basse définition ou nettement plus petite' }))];
            const ids = new Set(remplace.map(e => `${e.source}|${e.cleR2}`));
            if (admises.some(e => !ids.has(`${e.source}|${e.cleR2}`))) { reste(t, 'basse-definition-non-remplacable', `entrée(s) non remplaçable(s) par la règle commune (langue, numéro ou marqueur différents, ou document absent) : ${admises.map(e => `${e.source} ${e.cleR2} n°${e.numero ?? '∅'} langue ${e.langue ?? '?'}`).join(' ; ')}`); continue; }
        }
        resolus.push({ t, e: choisie, voie: depuisSlug ? 'set+numero-du-slug+nom' : 'set+numero+nom', numero,
            preuve: `set ${choisie.pkcSet} n°${choisie.numero} = ${depuisSlug ? `le numéro d'origine du slug (${numero})` : 'le numéro de la fiche'} ; nom « ${choisie.nom} » = « ${t.carte.nomEn} »`,
            remplace: remplace.map(e => ({ source: e.source, cleR2: e.cleR2, numero: e.numero ?? null, w: e.w ?? null, langue: e.langue ?? null, motif: e.motifRemplacement })), demiInconnu: !reconnues.length && lignes.length > 1 });
    }
    // ── les groupes : une FICHE = (carte, numéro) ; une seule image par fiche ; une image pour une seule fiche ──────────────────────
    // (correction 1) la clé porte AUSSI le set Cardmarket : une même carte (Potion, Énergie de base) est vendue dans dix kits, chacun a sa fiche — sans le set, 46 produits se prenaient pour une seule fiche
    const cleGroupe = t => `${t.slugSet}|${t.carte._id}|${t.numeroFiche == null ? '∅' : cleNumero(t.numeroFiche)}`;
    const groupes = new Map();
    for (const r of resolus) { const k = cleGroupe(r.t); (groupes.get(k) || groupes.set(k, []).get(k)).push(r); }
    for (const [k, g] of [...groupes]) if (new Set(g.map(r => r.e.url)).size > 1) {
        // 🔑 la règle du site IMPORTÉE rejuge : si elle donne à chaque produit SON numéro de fiche (distincts), chaque produit reçoit l'image de SA demi-deck, écrite sous ce numéro ;
        // si elle donne la même fiche aux deux (ou ne dit rien), ils restent sautés
        const fiches = ficheDuSite ? g.map(r => ficheDuSite(r.t.idProduct)) : [];
        const numeros = fiches.map(f => (f && f.numero != null ? cleNumero(f.numero) : null));
        if (ficheDuSite && numeros.every(n => n != null) && new Set(numeros).size === g.length) {
            groupes.delete(k);
            g.forEach((r, i) => { r.numeroSite = fiches[i].numero; groupes.set(`${k}#${r.t.idProduct}`, [r]); });
            continue;
        }
        for (const r of g) reste(r.t, 'deux-images-une-fiche', `${g.map(x => `${x.e.pkcSet} n°${x.e.numero}`).join(' ; ')}${ficheDuSite ? ' ; la règle du site donne la même fiche aux deux produits' : ''}`);
        groupes.delete(k);
    }
    const parImg = new Map();
    for (const [k, g] of groupes) { const u = g[0].e.url; (parImg.get(u) || parImg.set(u, new Set()).get(u)).add(k); }
    for (const [, ks] of parImg) if (ks.size > 1) for (const k of ks) { for (const r of groupes.get(k) || []) reste(r.t, 'carte-pour-deux-fiches'); groupes.delete(k); }
    const plan = [];
    for (const g of groupes.values()) {
        const { t, e, voie, preuve, remplace, demiInconnu } = g[0];
        plan.push({ carteId: t.carte._id, nomEn: t.carte.nomEn ?? null, slugSet: t.slugSet, numero: g[0].numeroSite ?? t.numeroFiche ?? null, produits: g.map(r => r.t.idProduct), pkcSet: e.pkcSet, numeroPkc: e.numero, nomPkc: e.nom,
            url: e.url, loc: e.loc, voie, preuve, action: remplace.length ? 'remplacement' : 'ajout', remplace, aRegarder: SETS_A_REGARDER.includes(t.slugSet), ...(demiInconnu ? { demiInconnu: true } : {}) });
    }
    return { plan, restes };
}

// ── le contrôle d'une image (décision 2 du testeur) ─────────────────────────────────────────────────────────────────────────────
/** Le motif de refus d'une image téléchargée (octets, largeur, hauteur), ou null. Le dos d'abord (empreinte), puis la taille, puis le rapport d'une carte. */
function controlerImage({ octets, w, h }) {
    if (estDosDeCarte(octets) || (Buffer.isBuffer(octets) && EMPREINTES_DOS_SOURCE.includes(require('crypto').createHash('sha256').update(octets).digest('hex')))) return 'dos-de-carte';
    if (!(w > 0) || !(h > 0)) return 'dimensions-inconnues';
    if (w < largeurMinDe(SOURCE)) return 'trop-petit';
    const r = w / h;
    if (r < RAPPORT_MIN || r > RAPPORT_MAX) return 'rapport-hors-carte';
    return null;
}
/** Les adresses dont l'empreinte est partagée avec une AUTRE adresse (un dos, un espace réservé : deux cartes ne sont jamais deux fois le même fichier). @returns {Map<url, sha256>} */
function imagesIdentiques(liste) {
    const parSha = new Map();
    for (const x of liste) if (x.sha256) (parSha.get(x.sha256) || parSha.set(x.sha256, []).get(x.sha256)).push(x.url);
    const m = new Map();
    for (const [sha, urls] of parSha) if (new Set(urls).size > 1) for (const u of new Set(urls)) m.set(u, sha);
    return m;
}

// ── retrait ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Ce qu'un retrait en un lot retire : les entrées `cartes.images` de CETTE source ET de CE lot, et leurs clés R2 (vignettes comprises). */
function planRetrait(cartes) {
    const touchees = [], cles = [];
    let entrees = 0;
    for (const c of cartes) {
        const es = (c.images || []).filter(e => e?.source === SOURCE);         // TOUTE la source (doctrine du 2026-10-17 : une commande retire tout ce qui vient d'elle)
        if (!es.length) continue;
        touchees.push(c._id); entrees += es.length; cles.push(...es.flatMap(e => [e.cleR2, e.vignette?.cleR2].filter(Boolean)));
    }
    return { cartes: touchees, entrees, cles };
}

// API-52 L4 : le numéro d'UNE ligne qui n'en porte pas ni slug (449623 Guzma, Burning-Shadows, numeroFiche null, slug null) — « 115a », lu par le testeur sur le produit (relevé API) ; liste FERMÉE d'un produit,
// jamais déduite du nom. Il ne sert qu'à CHERCHER la page de la source ; set + numéro + nom s'y prouvent comme toujours.
const NUMEROS_EXPLICITES = Object.freeze({ 449623: '115a' });
const numeroExplicite = idProduct => (Object.prototype.hasOwnProperty.call(NUMEROS_EXPLICITES, idProduct) ? NUMEROS_EXPLICITES[idProduct] : null);
module.exports = { NUMEROS_EXPLICITES, numeroExplicite, duLot, SOURCE, LOT, HOTE, ROBOTS, PREFIXE_CHEMIN, UA, CADENCE_MS, MENTION, DOSSIER_SITEMAPS, DOSSIER_CACHE, DOSSIER_LOT, LOTS, TABLE, SETS_A_REGARDER, SETS_SANS_NUMERO_DE_SLUG, LARGEUR_ATTENDUE,
    urlImageValide, urlRobotsValide, adressePermise, lireSitemapTexte, lireSitemaps, decomposer, indexer, nomNorm, estBasse, cleR2, cleNum, idImage, apparier, controlerImage, imagesIdentiques, planRetrait };
