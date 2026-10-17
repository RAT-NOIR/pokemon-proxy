// node test-pokumon-autres.js — les AUTRES familles de pokumon.com (McDonald's, Trick or Trade, Professor Program, Black Star, variantes « a ») : l'index par jeu de promos, les lignes de table,
// les clés par famille et leurs vetos. Aucune requête, aucune base : des entrées RÉELLES de l'index lu le 2026-10-17 (une valeur est recopiée, jamais inventée).
// TOOL_DIR=<dossier> rejoue le banc contre une copie MUTÉE du module.
const path = require('path');
const DIR = process.env.TOOL_DIR || __dirname;
const P = require(path.join(DIR, 'collecte-cartes', 'pokumon.js'));

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); }
};
const essayer = async f => { try { return await f(); } catch (e) { return e; } };

(async () => {
    // ── 1. l'index par JEU DE PROMOS : adresses énumérées, ordre total ──────────────────────────────────────────────────────
    const CH = 'per_page=100&page=2&orderby=id&order=asc&_embed=wp:featuredmedia&_fields=id,title,slug,link,release_event,promo_set,language,_links,_embedded';
    verifier('jeux de promos énumérés : Special Print, McDonald\'s, Black Star SM/XY/SWSH/SV/MEP', P.PROMO_SETS, { speciale: 2346, mcd: 9231, sm: 4625, xy: 4285, swsh: 6678, svp: 7826, mep: 9606 });
    verifier('urlIndexPromoSet : l\'adresse exacte (anglais seulement, 100 par page, ordre total par identifiant)', P.urlIndexPromoSet('mcd', 2), `https://pokumon.com/wp-json/wp/v2/card?promo_set=9231&language=1260&${CH}`);
    verifier('urlIndexPromoSet : un jeu inconnu ou une page hors 1-30 ne se construit pas', [await essayer(() => P.urlIndexPromoSet('wcd', 1)) instanceof Error, await essayer(() => P.urlIndexPromoSet('mcd', 0)) instanceof Error, await essayer(() => P.urlIndexPromoSet('speciale', 31)) instanceof Error], [true, true, true]);
    verifier('les adresses d\'un jeu de promos sont admises par la liste fermée du client (genre « index »)', P.urlIndexAutorisee(P.urlIndexPromoSet('speciale', 24)), true);
    verifier('une adresse voisine est refusée : autre jeu (9999), français (1261), sans ordre total, page 0, champs en plus', [
        P.urlIndexAutorisee(P.urlIndexPromoSet('mcd', 1).replace('9231', '9999')),
        P.urlIndexAutorisee(P.urlIndexPromoSet('mcd', 1).replace('1260', '1261')),
        P.urlIndexAutorisee(P.urlIndexPromoSet('mcd', 1).replace('&orderby=id&order=asc', '')),
        P.urlIndexAutorisee(P.urlIndexPromoSet('mcd', 1).replace('page=1', 'page=0')),
        P.urlIndexAutorisee(P.urlIndexPromoSet('mcd', 1) + '&search=x')], [false, false, false, false, false]);

    // ── 2. la TABLE : une ligne par famille et année/série, prouvée à l'œil ────────────────────────────────────────────────
    const T = P.LIGNES_AUTRES;
    verifier('table : identifiants uniques, chaque ligne a une famille connue, 3 témoins distincts au moins, un tampon/marque lu, la date de lecture', [new Set(T.map(l => l.id)).size === T.length, T.every(l => ['mcd', 'tot', 'prof', 'bsp', 'bk', 'w'].includes(l.famille) && l.tampon.length > 20 && l.slugs.length === 1
        // une ligne REGARDÉE porte ses témoins vus ; une ligne du lot PK-PROMOS (lu = null) porte l'échantillon à regarder et ne pose rien (test-pokumon-promos.js)
        && (l.lu === '2026-10-17' ? new Set(l.temoins.map(t => `${t.nom}|${t.imprime}`)).size >= 3 : l.lu === null && l.echantillon.length >= 3))], [true, true]);
    verifier('table : une ligne McDonald\'s a un total, un bloc de téléversement et des impressions de millésime ; trick or trade une année ; black star un préfixe', [
        T.filter(l => l.famille === 'mcd').every(l => l.total && l.plageS[0] <= l.plageS[1] && l.expansionsImpression.length), T.filter(l => l.famille === 'tot').map(l => l.annee), T.filter(l => l.famille === 'bsp').map(l => l.prefixe)], [true, [2022, 2023], ['SWSH', 'SVP', 'MEP']]);
    verifier('table : les années McDonald\'s non prouvées n\'ont PAS de ligne (2013 : aucun bloc ; 2019/2022/2024 : placeholders ; 25th : holo et non-holo)', T.filter(l => l.famille === 'mcd').map(l => l.slugs[0]).sort(), ['McDonald-s-Collection-2018-2', 'McDonalds-Collection-2014', 'McDonalds-Collection-2015', 'McDonalds-Collection-2017', 'McDonalds-Match-Battle-2023']);
    verifier('une table qui donne un même set à deux familles LÈVE (on ne choisit pas entre deux règles)', !!(await essayer(() => P.apparierFamille({ lignes: [{ id: 'a', famille: 'tot', slugs: ['X'], annee: 2022 }, { id: 'b', famille: 'prof', slugs: ['X'] }], produits: [{ idProduct: 1, unite: 'X', nomCm: 'N', slugProduit: 'N-BOOCRE-001' }], index: [] }))).message, true);

    // ── 3. les clés : des entrées RÉELLES de l'index du 2026-10-17 ────────────────────────────────────────────────────────
    const { CDN, wp } = require('./test-pokumon-donnees');
    const IMG = (an, f) => `${CDN}/${an}/${f}`;
    const e = (...a) => P.lireEntree(wp(...a));
    const GENGAR22 = e(110108, 'Trick or Trade Gengar (057/198 Line Holo Pikachu jack-o’-lantern stamp Trick or Trade BOOster Bundle exclusive Special Print)', IMG('2026/07', 'EN_S1695Trick-or-TradeSpecial-Print.png'), 740, 1027, [9342]);
    const GENGAR23 = e(110288, 'Trick or Trade Gengar (066/196 Mirage Holo Pikachu jack-o\'-lantern stamp Trick or Trade BOOster Bundle 2023 exclusive Special Print)', IMG('2026/07', 'EN_S1871Trick-or-TradeSpecial-Print.png'), 693, 970, [9372]);
    const MIMIKYU = e(110028, 'Trick or Trade Mimikyu (081/189 Trick or Trade Special Print)', IMG('2026/07', 'EN_S1616Trick-or-TradeSpecial-Print.png'), 659, 917, [9252]);
    const imp = (expansion, numero, total) => ({ tirage: 'intl', expansion, numero, total });
    const lt = (annee, slug) => ({ id: `tot-${annee}`, famille: 'tot', annee, slugs: [slug] });
    const prod = (idProduct, unite, nomCm, slugProduit, impressions, numero = null) => ({ idProduct, unite, nomCm, slugProduit, impressions, numero });
    const G22 = prod(671576, 'Trick-or-Trade', 'Gengar [Last Gift | Pain Burst]', 'Gengar-BOOCRE-057', [imp('Chilling Reign', '057', '198')]);
    const G24 = prod(785620, 'Trick-or-Trade-2024', 'Gengar [Night Gate | Nightmare]', 'Gengar-BOO24PAF-057', [imp('Paldean Fates', '057', '091')]);
    let A = P.apparierFamille({ lignes: [lt(2022, 'Trick-or-Trade'), lt(2024, 'Trick-or-Trade-2024')], produits: [G22, G24], index: [GENGAR22] });
    verifier('Gengar 2022 / 2024 : le produit de 2022 est PROUVÉ (année dite par l\'entrée, impression CRE 057/198), celui de 2024 est un trou — même nom, même numéro', A.resultats.map(r => [r.idProduct, r.verdict, r.motif ?? r.temoin]), [[671576, 'prouve', 'impression de la carte : n° 057 imprimé sur 198'], [785620, 'reste', 'non-couvert']]);
    // l'entrée sans année (« Trick or Trade Special Print ») : seul le TÉMOIN de la carte sépare les deux Mimikyu
    const MIM_SANS_ANNEE = e(110999, 'Trick or Trade Gengar (057/198 Trick or Trade Special Print)', IMG('2026/07', 'EN_S1695Trick-or-TradeSpecial-Print.png'), 740, 1027, [9252]);
    A = P.apparierFamille({ lignes: [lt(2024, 'Trick-or-Trade-2024')], produits: [G24], index: [MIM_SANS_ANNEE] });
    verifier('entrée SANS année : la carte du produit 2024 (Paldean Fates 057/091) contredit le 057/198 de l\'entrée — trou « impression-contredit »', A.resultats[0].motif, 'impression-contredit');
    A = P.apparierFamille({ lignes: [lt(2022, 'Trick-or-Trade')], produits: [{ ...G22, impressions: [] }], index: [GENGAR22] });
    verifier('une carte qui ne porte AUCUNE impression à ce numéro : pas de témoin, donc trou « impression-absent » (un doute est un trou)', A.resultats[0].motif, 'impression-absent');
    A = P.apparierFamille({ lignes: [lt(2023, 'Trick-or-Trade-2023')], produits: [prod(731928, 'Trick-or-Trade-2023', 'Gengar [Netherworld Gate | Screaming Circle]', 'Gengar-BOO23LOR-066', [imp('Lost Origin', '066', '196')])], index: [GENGAR23, GENGAR22] });
    verifier('année : l\'entrée « 2023 exclusive » sert le produit 2023 ; l\'entrée sans mention (2022) ne sert jamais un produit 2023', [A.resultats[0].verdict, A.resultats[0].entree.id], ['prouve', 110288]);
    A = P.apparierFamille({ lignes: [lt(2023, 'Trick-or-Trade-2023')], produits: [prod(5, 'Trick-or-Trade-2023', 'Gengar [Last Gift | Pain Burst]', 'Gengar-BOO23CRE-057', [imp('Chilling Reign', '057', '198')])], index: [GENGAR22] });
    verifier('année : un produit 2023 ne reçoit PAS l\'entrée « BOOster Bundle exclusive » (2022), même nom, même numéro, même impression', A.resultats[0].motif, 'non-couvert');
    // tampon : une entrée qui n'est pas de la famille n'est jamais admise
    const PRO = prod(450688, 'Professor-Program', 'Judge', 'Judge-PPPFLI-108', [imp('Flashfire', '108', '131')]);
    const JUDGE = e(51219, 'Professor Program Judge (108/131 Professor Program Special Print)', IMG('2022/01', 'EN_S830Professor-ProgramSpecial-Print.jpg'), 732, 1019, [5077]);
    const JUDGE_LIGUE = e(51220, 'Judge (108/131 Pokemon League Special Print)', IMG('2022/01', 'EN_S831Special-Print.jpg'), 400, 558, [2056]);
    const PL = [{ id: 'prof', famille: 'prof', slugs: ['Professor-Program'] }];
    A = P.apparierFamille({ lignes: PL, produits: [PRO], index: [JUDGE] });
    verifier('Professor Program : « Professor Program Judge 108/131 » est prouvé par le nom, le numéro et l\'impression de la carte', [A.resultats[0].verdict, A.resultats[0].entree.id], ['prouve', 51219]);
    A = P.apparierFamille({ lignes: PL, produits: [PRO], index: [JUDGE_LIGUE] });
    verifier('TAMPON ABSENT : une entrée « Pokemon League » (même nom, même numéro) n\'est pas un Professor Program — jamais admise', A.resultats[0].motif, 'non-couvert');
    A = P.apparierFamille({ lignes: PL, produits: [PRO], index: [e(51221, 'Professor Program Judge (108/131 Professor Program Excellence Award Special Print)', IMG('2022/01', 'EN_S832Professor-ProgramSpecial-Print.jpg'), 732, 1019, [9268])] });
    verifier('« Excellence Award » et « Professor Cup » ne sont pas la ligne Professor Program', A.resultats[0].motif, 'non-couvert');
    A = P.apparierFamille({ lignes: PL, produits: [PRO], index: [JUDGE, e(51222, 'Professor Program Judge (108/131 Professor Stamp Promo Special Print)', IMG('2022/01', 'EN_S833Professor-ProgramSpecial-Print.png'), 732, 1019, [9436])] });
    verifier('deux entrées admises pour un produit : TROU « multiplicité » (jamais la première)', A.resultats[0].motif, 'douteux-multiplicite');
    A = P.apparierFamille({ lignes: PL, produits: [PRO, { ...PRO, idProduct: 450689, slugProduit: 'Judge-V2-PPPFLI-108' }], index: [JUDGE] });
    verifier('deux produits (V1/V2) pour UNE entrée : trou « multiplicité » pour les deux', A.resultats.map(r => r.motif), ['douteux-multiplicite', 'douteux-multiplicite']);

    // McDonald's : l'année du produit doit concorder avec celle de l'image (bloc de téléversement + impression du millésime)
    const MCD = (id, nom, n, tot, s, w = 322) => e(id, `${nom} (${n}/${tot} McDonald's McDonalds Collection)`, IMG('2025/07', `EN_S${String(s).padStart(3, '0')}McDonalds-Collection.png`), w, 449, [777]);
    const PIKA14 = MCD(107429, 'Pikachu', 5, 12, 41), PIKA17 = MCD(107465, 'Pikachu', 5, 12, 77, 496);
    const L14 = { id: 'mcd-2014', famille: 'mcd', slugs: ['McDonalds-Collection-2014'], total: '12', plageS: [37, 48], expansionsImpression: ["McDonald's Collection 2014"] };
    const L17 = { id: 'mcd-2017', famille: 'mcd', slugs: ['McDonalds-Collection-2017'], total: '12', plageS: [73, 84], expansionsImpression: ["McDonald's Collection 2017"] };
    const P14 = prod(281657, 'McDonalds-Collection-2014', 'Pikachu [Nuzzle | Quick Attack]', 'Pikachu-MCD145', [imp("McDonald's Collection 2014", '5', '12'), imp("McDonald's Collection 2017", '5', '12')], '5');
    const P17 = prod(301847, 'McDonalds-Collection-2017', 'Pikachu [Thunder Wave | Electro Ball]', 'Pikachu-MCD175', [imp("McDonald's Collection 2017", '5', '12')], '5');
    A = P.apparierFamille({ lignes: [L14, L17], produits: [P14, P17], index: [PIKA14, PIKA17] });
    verifier('McDonald\'s : le Pikachu 5/12 de 2014 reçoit S041, celui de 2017 reçoit S077 (deux entrées de même nom, même numéro, même total : le bloc d\'année sépare)', A.resultats.map(r => [r.idProduct, r.entree?.id]), [[281657, 107429], [301847, 107465]]);
    A = P.apparierFamille({ lignes: [L14, L17], produits: [P17], index: [PIKA14] });
    verifier('ANNÉE FAUSSE : le produit 2017 ne reçoit pas l\'image de 2014 quand l\'entrée de 2017 manque chez Pokumon (S041 n\'est pas dans le bloc 73-84)', A.resultats[0].motif, 'non-couvert');
    A = P.apparierFamille({ lignes: [L17], produits: [{ ...P17, impressions: [imp("McDonald's Collection 2014", '5', '12')] }], index: [PIKA17] });
    verifier('le témoin du millésime : une carte dont l\'impression est de 2014 ne reçoit pas le bloc 2017 (trou « impression-absent »)', A.resultats[0].motif, 'impression-absent');
    A = P.apparierFamille({ lignes: [L17], produits: [P17], index: [{ ...PIKA17, total: '15' }] });
    verifier('le total de l\'entrée (15) ne vaut pas celui de la ligne (12) : jamais admise', A.resultats[0].motif, 'non-couvert');
    verifier('un produit sans numéro (ni 1 ni 5…) n\'a pas de clé : « sans-numero-origine »', P.apparierFamille({ lignes: [L17], produits: [{ ...P17, numero: null }], index: [PIKA17] }).resultats[0].motif, 'sans-numero-origine');
    const PH = e(107729, 'Kilowattrel (8/15 McDonald\'s McDonalds Collection)', IMG('2021/03', 'PlaceholderCard.jpg'), 474, 659, [777]);
    const LMB = { id: 'mcd-match-battle-2023', famille: 'mcd', slugs: ['McDonalds-Match-Battle-2023'], total: '15', plageS: [237, 243], expansionsImpression: ["McDonald's Collection 2023"] };
    A = P.apparierFamille({ lignes: [LMB], produits: [prod(725425, 'McDonalds-Match-Battle-2023', 'Kilowattrel [Skill Dive | Thunder Blast]', 'Kilowattrel-M23008', [imp("McDonald's Collection 2023", '008', '015')], '008')], index: [PH] });
    verifier('PLACEHOLDER : rejeté et COMPTÉ (« PlaceholderCard » n\'est pas une image), jamais posé', [A.resultats[0].motif, A.comptes.placeholders], ['placeholder', 1]);

    // Black Star : le préfixe de la ligne, le témoin « Black Star » de la carte, et le numéro de la FICHE posé sur l'image
    const LUC = e(113100, 'Mega Lucario ex (MEP033 English Promo)', IMG('2026/08', 'EN_033MEP.jpg'), 717, 1000, [9606]);
    const LMEP = { id: 'bsp-mep', famille: 'bsp', prefixe: 'MEP', slugs: ['MEP-Black-Star-Promos'], tampon: 'étoile noire « PROMO » et code du set imprimés', lu: '2026-10-17', temoins: [{ nom: 'Mega Charizard X ex', imprime: 'MEP023' }, { nom: 'Mega Gardevoir ex', imprime: 'MEP032' }, { nom: 'Mega Lucario ex', imprime: 'MEP033' }] };
    const PLUC = prod(873710, 'MEP-Black-Star-Promos', 'Mega Lucario ex [Aura Jab | Mega Brave]', 'Mega-Lucario-ex-MEP033', [imp('MEP Black Star Promos', '012', null), imp('MEP Black Star Promos', '033', null)], '033');
    A = P.apparierFamille({ lignes: [LMEP], produits: [PLUC], index: [LUC] });
    verifier('Black Star MEP033 : prouvé, et le numéro retenu pour l\'image est celui de l\'impression de la carte (« 033 », celui de la fiche)', [A.resultats[0].verdict, A.resultats[0].numeroFiche], ['prouve', '033']);
    A = P.apparierFamille({ lignes: [{ ...LMEP, prefixe: 'SVP' }], produits: [PLUC], index: [LUC] });
    verifier('préfixe : une entrée MEP033 ne sert pas une ligne SVP', A.resultats[0].motif, 'non-couvert');
    A = P.apparierFamille({ lignes: [LMEP], produits: [{ ...PLUC, impressions: [imp('SWSH Black Star Promos', '033', null)] }], index: [LUC] });
    verifier('une impression d\'un autre jeu de promos au même numéro ne vaut pas témoin Black Star', A.resultats[0].motif, 'impression-absent');

    // ── 4. le PLAN : numéro de la fiche, seuil de largeur COMPTÉ, additif, fiche partagée ───────────────────────────────────────
    const carte = (id, nomEn, images = []) => ({ _id: id, nomEn, images });
    const LARGE = e(113101, 'Mega Gardevoir ex (MEP032 English Promo)', IMG('2026/08', 'EN_032MEP.jpg'), 717, 1000, [9606]);
    const PGAR = prod(873708, 'MEP-Black-Star-Promos', 'Mega Gardevoir ex [Overflowing Wishes | Mega Symphonia]', 'Mega-Gardevoir-ex-MEP032', [imp('MEP Black Star Promos', '032', null)], '032');
    const cartes = new Map([[7, carte(7, 'Mega Lucario ex', [{ set: 'MEP-Black-Star-Promos', source: 'bulbapedia', numero: '012', cleR2: 'b.webp' }])], [8, carte(8, 'Mega Gardevoir ex')]]);
    let plan = P.planifierFamilles({ lignes: [LMEP], produits: [{ ...PLUC, carteId: 7 }, { ...PGAR, carteId: 8 }], cartes, index: [LUC, LARGE] });
    verifier('plan : l\'image d\'un AUTRE numéro de la même carte (012) ne compte pas comme servie ; le numéro posé est celui de la fiche (033)', plan.plan.map(p => [p.carteId, p.numero, p.ligne, p.voie]), [[7, '033', 'bsp-mep', 'pokumon+nom+numero+bsp'], [8, '032', 'bsp-mep', 'pokumon+nom+numero+bsp']]);
    verifier('plan : la preuve nomme l\'entrée, le nom, le numéro, la ligne, ses témoins et sa marque', /113100/.test(plan.plan[0].preuve) && /Mega Lucario ex/.test(plan.plan[0].preuve) && /bsp-mep/.test(plan.plan[0].preuve) && /MEP023/.test(plan.plan[0].preuve) && /étoile noire/.test(plan.plan[0].marque), true);
    plan = P.planifierFamilles({ lignes: [LMEP], produits: [{ ...PLUC, carteId: 7 }], cartes: new Map([[7, carte(7, 'Mega Lucario ex', [{ set: 'MEP-Black-Star-Promos', source: 'tcgdex', numero: '033', cleR2: 'x.webp' }])]]), index: [LUC] });
    verifier('plan : une fiche qui a déjà SON image (même numéro) n\'est jamais touchée (additif)', [plan.plan.length, plan.restes.map(r => r.motif)], [0, ['deja-servi']]);
    plan = P.planifierFamilles({ lignes: [LMEP], produits: [{ ...PLUC, carteId: 7 }], cartes: new Map([[7, carte(7, 'Mega Lucario ex', [{ set: 'MEP-Black-Star-Promos', source: 'tcgdex', numero: null, cleR2: 'x.webp' }])]]), index: [LUC] });
    verifier('plan : une image SANS numéro dans le set sert déjà la fiche (règle du site) : rien à poser', plan.restes.map(r => r.motif), ['deja-servi']);
    plan = P.planifierFamilles({ lignes: [LMEP], produits: [{ ...PLUC, carteId: 7 }], cartes, index: [{ ...LUC, w: 322, h: 449 }] });
    verifier('SEUIL DE LARGEUR (350, inchangé) : une image de 322 px est écartée et COMPTÉE, jamais téléchargée', [plan.plan.length, plan.restes.map(r => [r.motif, r.w]), plan.comptes.sousSeuil], [0, [['sous-le-seuil', 322]], 1]);
    verifier('le seuil est celui de la source, pas une valeur recopiée', require('./collecte-cartes/seuils-images.js').largeurMinDe('pokumon'), 350);
    plan = P.planifierFamilles({ lignes: [LMEP], produits: [{ ...PLUC, carteId: 7 }, { ...PLUC, idProduct: 873711, slugProduit: 'Mega-Lucario-ex-V2-MEP033', carteId: 7 }], cartes: new Map([[7, carte(7, 'Mega Lucario ex')]]), index: [LUC] });
    verifier('plan : deux produits sur la MÊME fiche pour une entrée : trou, rien n\'est posé', [plan.plan.length, plan.restes.map(r => r.motif)], [0, ['douteux-multiplicite', 'douteux-multiplicite']]);
    const PH2 = P.planifierFamilles({ lignes: [LMEP], produits: [{ ...PLUC, carteId: 7 }], cartes: new Map(), index: [LUC] });
    verifier('plan : une carte absente de la base est un reste nommé', PH2.restes.map(r => r.motif), ['carte-absente']);

    // ── 5. BS-HOLO (2026-10-17) : le scan partagé holo / non-holo des promos Black Star SWSH, SVP, MEP ───────────────────────────────────────────────
    // 🔴 MESURÉ le 2026-10-17 sur les 64 groupes (128 produits) « douteux-variantes-non-separables » des trois lignes Black Star : AUCUN n'est un couple holo / non-holo seul.
    //    59 sont « X » contre « Staff X » (tampon Staff, aucune entrée holo) ; 5 sont « X » contre « Holofoil Play Pokemon X » (tampon Play! Pokémon, autre événement). Ces entrées sont RECOPIÉES de
    //    l'index ci-dessous : elles doivent rester des trous. Le seul couple pur du banc est CONSTRUIT (une entrée réelle dont on ne change que « Holofoil » et l'identifiant) : aucun n'existe encore.
    const BSP = (id, prefixe, slug) => ({ id, famille: 'bsp', prefixe, slugs: [slug], tampon: 'étoile noire « PROMO » et code du set imprimés', lu: '2026-10-17', temoins: [{ nom: 'a', imprime: 'x' }, { nom: 'b', imprime: 'y' }, { nom: 'c', imprime: 'z' }] });
    const LSVP = BSP('bsp-svp', 'SVP', 'SV-Black-Star-Promos'), LSWSH = BSP('bsp-swsh', 'SWSH', 'SWSH-Black-Star-Promos'), LMEP2 = BSP('bsp-mep', 'MEP', 'MEP-Black-Star-Promos');
    const IM = (expansion, numero) => ({ tirage: 'intl', expansion, numero, total: null });
    const MIM1 = prod(701130, 'SV-Black-Star-Promos', 'Mimikyu ex [Void Return | Energy Burst]', 'Mimikyu-ex-V1-SVPen004', [IM('SVP Black Star Promos', '004')], 'SVP004');
    const MIM2 = { ...MIM1, idProduct: 701131, slugProduit: 'Mimikyu-ex-V2-SVPen004' };
    const [MC1, MC2] = [{ ...MIM1, carteId: 278879 }, { ...MIM2, carteId: 278879 }];
    const MIM_PLAIN = e(80570, 'Mimikyu ex (SVP004 English Promo)', IMG('2024/03', 'EN_S0570Mimikyu.png'), 1114, 1556, [7836]);
    const MIM_PLAY = e(80571, 'Holofoil Play Pokemon Mimikyu ex (SVP004 English Promo)', IMG('2024/03', 'EN_S0571Mimikyu.png'), 754, 1052, [7838]);
    const MIM_HOLO_PUR = e(99571, 'Holofoil Mimikyu ex (SVP004 English Promo)', IMG('2024/03', 'EN_S9571Mimikyu.png'), 754, 1052, [7836]);   // CONSTRUIT : la même entrée, « Holofoil » en plus, le même événement
    const res = (A) => A.resultats.map(r => [r.idProduct, r.verdict, r.motif ?? null, r.partageeHoloNonHolo ?? null, r.produitsPartages ?? null]);
    A = P.apparierFamille({ lignes: [LSVP], produits: [MC1, MC2], index: [MIM_PLAIN, MIM_HOLO_PUR] });
    verifier('BS-HOLO : un couple PUR (deux produits V1/V2 d\'une même carte, « X » et « Holofoil X », même numéro, même texte, même événement) est prouvé, l\'entrée NON-holo est choisie, les deux produits partagent le scan',
        [A.resultats.map(r => [r.idProduct, r.verdict, r.entree?.id, r.partageeHoloNonHolo, r.produitsPartages, r.numeroFiche, r.entreeHoloIgnoree?.id])],
        [[[701130, 'prouve', 80570, true, [701130, 701131], '004', 99571], [701131, 'prouve', 80570, true, [701130, 701131], '004', 99571]]]);
    A = P.apparierFamille({ lignes: [LSVP], produits: [MC1, MC2], index: [MIM_PLAIN, MIM_PLAY] });
    verifier('BS-HOLO : le Mimikyu ex SVP004 RÉEL — « X » (autre événement) contre « Holofoil Play Pokemon X » — est un TROU : la différence est le tampon Play! Pokémon, pas le brillant', res(A).map(r => r.slice(1, 3)), [['reste', 'holo-mot-autre'], ['reste', 'holo-mot-autre']]);
    const SLOW1 = prod(894262, 'MEP-Black-Star-Promos', 'Slowbro [All Out | Zen Headbutt]', 'Slowbro-MEP083', [IM('MEP Black Star Promos', '083')], 'MEP083'), SLOW2 = { ...SLOW1, idProduct: 903006, slugProduit: 'Slowbro-V2-MEP083' };
    const SB = e(113195, 'Slowbro (MEP083 English Promo)', IMG('2026/08', 'EN_083MEP.jpg'), 320, 447, [9698]), SBS = e(113196, 'Staff Slowbro (MEP083 English Promo)', IMG('2026/08', 'EN_083MEPS.jpg'), 746, 1040, [9698]);
    A = P.apparierFamille({ lignes: [LMEP2], produits: [{ ...SLOW1, carteId: 355012 }, { ...SLOW2, carteId: 355012 }], index: [SB, SBS] });
    verifier('BS-HOLO : le Slowbro MEP083 RÉEL — « X » contre « Staff X » — est un TROU : le tampon Staff n\'est pas un brillant (59 des 64 groupes réels sont de cette forme)', res(A).map(r => r.slice(1, 3)), [['reste', 'holo-mot-autre'], ['reste', 'holo-mot-autre']]);
    const motifSVP = (index, produits = [MC1, MC2]) => P.apparierFamille({ lignes: [LSVP], produits, index }).resultats.map(r => r.motif ?? r.verdict);
    verifier('BS-HOLO : deux entrées qui portent les MÊMES mots mais pas le même événement : trou « événements différents » (un événement est une autre impression)', motifSVP([MIM_PLAIN, { ...MIM_HOLO_PUR, evenements: [7838] }]), ['holo-evenements-differents', 'holo-evenements-differents']);
    verifier('BS-HOLO : des événements qui se CHEVAUCHENT sans être les mêmes ([7836] contre [7836, 7838]) : trou « événements différents » ; aucun événement du tout : le même trou (rien ne prouve la même impression)', [
        motifSVP([MIM_PLAIN, { ...MIM_HOLO_PUR, evenements: [7836, 7838] }])[0], motifSVP([{ ...MIM_PLAIN, evenements: [] }, { ...MIM_HOLO_PUR, evenements: [] }])[0]], ['holo-evenements-differents', 'holo-evenements-differents']);
    verifier('BS-HOLO : l\'ordre de l\'index ne change rien — la non-holo est choisie même listée après la holo ; les événements sont comparés sans tenir compte de leur ordre', [
        P.apparierFamille({ lignes: [LSVP], produits: [MC1, MC2], index: [MIM_HOLO_PUR, MIM_PLAIN] }).resultats.map(r => r.entree?.id), motifSVP([{ ...MIM_PLAIN, evenements: [7836, 7838] }, { ...MIM_HOLO_PUR, evenements: [7838, 7836] }])], [[80570, 80570], ['prouve', 'prouve']]);
    verifier('BS-HOLO : un total différent (004/198 contre rien) : trou « forme »', motifSVP([MIM_PLAIN, { ...MIM_HOLO_PUR, total: '198' }]), ['holo-forme-non-prouvee', 'holo-forme-non-prouvee']);
    verifier('BS-HOLO : un texte de set différent : trou « forme » ; avec un mot de tampon (Cosmos) : trou « mot autre »', [motifSVP([MIM_PLAIN, { ...MIM_HOLO_PUR, set: 'English Promo Autre' }])[0], motifSVP([MIM_PLAIN, { ...MIM_HOLO_PUR, set: 'English Promo Cosmos' }])[0]], ['holo-forme-non-prouvee', 'holo-mot-autre']);
    verifier('BS-HOLO : un « Reverse Holo » parmi les entrées : trou « reverse »', motifSVP([MIM_PLAIN, e(99574, 'Reverse Holo Mimikyu ex (SVP004 English Promo)', IMG('2024/03', 'EN_S9574Mimikyu.png'), 754, 1052, [7836])]), ['holo-reverse', 'holo-reverse']);
    verifier('BS-HOLO : un tampon Staff porté par LES DEUX entrées (« Staff X » et « Holofoil Staff X ») est encore un tampon : trou « mot autre »', motifSVP([e(99575, 'Staff Mimikyu ex (SVP004 English Promo)', IMG('2024/03', 'EN_S9575Mimikyu.png'), 746, 1040, [7836]), e(99576, 'Holofoil Staff Mimikyu ex (SVP004 English Promo)', IMG('2024/03', 'EN_S9576Mimikyu.png'), 746, 1040, [7836])]), ['holo-mot-autre', 'holo-mot-autre']);
    verifier('BS-HOLO : deux entrées non-holo (aucune Holofoil) ne font pas un couple : trou « forme »', motifSVP([MIM_PLAIN, { ...MIM_PLAIN, id: 99572 }]), ['holo-forme-non-prouvee', 'holo-forme-non-prouvee']);
    verifier('BS-HOLO : TROIS entrées (le couple pur et un tampon Staff) : multiplicité, jamais un couple', motifSVP([MIM_PLAIN, MIM_HOLO_PUR, e(99573, 'Staff Mimikyu ex (SVP004 English Promo)', IMG('2024/03', 'EN_S9573Mimikyu.png'), 746, 1040, [7836])]), ['douteux-multiplicite', 'douteux-multiplicite']);
    verifier('BS-HOLO : deux produits de CARTES différentes : trou « carte » (jamais un couple)', motifSVP([MIM_PLAIN, MIM_HOLO_PUR], [MC1, { ...MC2, carteId: 5 }]), ['holo-carte-non-prouvee', 'holo-carte-non-prouvee']);
    verifier('BS-HOLO : deux produits dont les slugs ne sont pas V1 / V2 (V1 et V4, comme Iron Bundle SVP058) : trou « forme »', motifSVP([MIM_PLAIN, MIM_HOLO_PUR], [MC1, { ...MC2, slugProduit: 'Mimikyu-ex-V4-SVPen004' }]), ['holo-forme-non-prouvee', 'holo-forme-non-prouvee']);
    verifier('BS-HOLO : un slug qui porte DEUX jetons de variante (V1 puis V9) n\'est pas lisible : trou « forme »', motifSVP([MIM_PLAIN, MIM_HOLO_PUR], [{ ...MC1, slugProduit: 'Mimikyu-ex-V1-V9-SVPen004' }, { ...MC2, slugProduit: 'Mimikyu-ex-V2-V9-SVPen004' }]), ['holo-forme-non-prouvee', 'holo-forme-non-prouvee']);
    verifier('BS-HOLO : le jeton V1 / V2 peut se trouver n\'importe où dans le slug, sans numéro (Galarian-Rapidash-V-V1 / -V2, SWSH111 réel)', P.groupeHoloNonHoloBlackStar([{ p: { idProduct: 561771, carteId: 1, unite: 'S', nomCm: 'N', slugProduit: 'Galarian-Rapidash-V-V1' } }, { p: { idProduct: 561772, carteId: 1, unite: 'S', nomCm: 'N', slugProduit: 'Galarian-Rapidash-V-V2' } }], [e(1, 'N (SWSH111 English Promo)', IMG('2021/04', 'EN_S1.png'), 600, 800, [1]), e(2, 'Holofoil N (SWSH111 English Promo)', IMG('2021/04', 'EN_S2.png'), 600, 800, [1])]).produits, [561771, 561772]);
    verifier('BS-HOLO : deux produits au nom Cardmarket différent : trou « forme »', motifSVP([MIM_PLAIN, MIM_HOLO_PUR], [MC1, { ...MC2, nomCm: 'Mimikyu ex [Void Return | Energy Burst] Cosmos' }]), ['holo-forme-non-prouvee', 'holo-forme-non-prouvee']);
    verifier('BS-HOLO : un mot de tampon ou d\'événement dans le slug du PRODUIT (Staff, Cosmos) : trou « mot autre »', [
        motifSVP([MIM_PLAIN, MIM_HOLO_PUR], [{ ...MC1, slugProduit: 'Mimikyu-ex-Staff-V1-SVPen004' }, { ...MC2, slugProduit: 'Mimikyu-ex-Staff-V2-SVPen004' }])[0],
        motifSVP([MIM_PLAIN, MIM_HOLO_PUR], [{ ...MC1, slugProduit: 'Mimikyu-ex-Cosmos-V1-SVPen004' }, { ...MC2, slugProduit: 'Mimikyu-ex-Cosmos-V2-SVPen004' }])[0]], ['holo-mot-autre', 'holo-mot-autre']);
    verifier('BS-HOLO : la ligne SWSH se comporte de même (couple pur prouvé ; « Holofoil Play Pokemon » du Galarian Rapidash V SWSH111 réel : trou)', [
        P.apparierFamille({ lignes: [LSWSH], produits: [prod(1, 'SWSH-Black-Star-Promos', 'Eevee V [Max Hug]', 'Eevee-V-V1-SWSH104', [IM('SWSH Black Star Promos', 'SWSH104')], 'SWSH104'), prod(2, 'SWSH-Black-Star-Promos', 'Eevee V [Max Hug]', 'Eevee-V-V2-SWSH104', [IM('SWSH Black Star Promos', 'SWSH104')], 'SWSH104')].map(p => ({ ...p, carteId: 9 })),
            index: [e(70001, 'Eevee V (SWSH104 English Promo)', IMG('2021/04', 'EN_S0001.png'), 600, 837, [6798]), e(70002, 'Holofoil Eevee V (SWSH104 English Promo)', IMG('2021/04', 'EN_S0002.png'), 600, 837, [6798])] }).resultats.map(r => r.verdict),
        P.apparierFamille({ lignes: [LSWSH], produits: [prod(561771, 'SWSH-Black-Star-Promos', 'Galarian Rapidash V [Libra Horn | Psychic]', 'Galarian-Rapidash-V-V1', [IM('SWSH Black Star Promos', 'SWSH111')], 'SWSH111'), prod(561772, 'SWSH-Black-Star-Promos', 'Galarian Rapidash V [Libra Horn | Psychic]', 'Galarian-Rapidash-V-V2', [IM('SWSH Black Star Promos', 'SWSH111')], 'SWSH111')].map(p => ({ ...p, carteId: 261508 })),
            index: [e(80338, 'Galarian Rapidash V (SWSH111 English Promo)', IMG('2021/04', 'EN_S0338.png'), 325, 454, [6798]), e(80339, 'Holofoil Play Pokemon Galarian Rapidash V (SWSH111 English Promo)', IMG('2021/04', 'EN_S0339.png'), 862, 1203, [7720, 7721])] }).resultats.map(r => r.motif)],
        [['prouve', 'prouve'], ['holo-mot-autre', 'holo-mot-autre']]);
    // les AUTRES familles ne changent pas : le même couple pur (V1 / V2, « X » et « Holofoil X ») reste un doute là où la décision du testeur ne s'applique pas
    {
        const base = { carteId: 7, nomCm: 'Pikachu [Nuzzle]', numero: '5' };
        const mcdL = { id: 'mcd-2014', famille: 'mcd', slugs: ['McDonalds-Collection-2014'], total: '12', plageS: [37, 48], expansionsImpression: ["McDonald's Collection 2014"] };
        const pm = (id, v) => ({ ...base, idProduct: id, unite: 'McDonalds-Collection-2014', slugProduit: `Pikachu-${v}-MCD145`, impressions: [IM("McDonald's Collection 2014", '5')].map(i => ({ ...i, total: '12' })) });
        const mc = (id, titre, s) => e(id, `${titre} (5/12 McDonald's McDonalds Collection)`, IMG('2025/07', `EN_S0${s}McDonalds-Collection.png`), 496, 693, [777]);
        const Am = P.apparierFamille({ lignes: [mcdL], produits: [pm(1, 'V1'), pm(2, 'V2')], index: [mc(107429, 'Pikachu', 40), mc(107430, 'Holofoil Pikachu', 41)] });
        verifier('BS-HOLO : McDonald\'s — le couple V1/V2 « X » et « Holofoil X » reste « douteux-variantes-non-separables » (la décision ne couvre que les lignes Black Star)', Am.resultats.map(r => r.motif), ['douteux-variantes-non-separables', 'douteux-variantes-non-separables']);
        const tL = { id: 'tot-2022', famille: 'tot', annee: 2022, slugs: ['Trick-or-Trade'] }, ptt = (id, v) => ({ idProduct: id, carteId: 8, unite: 'Trick-or-Trade', nomCm: 'Gengar [Last Gift | Pain Burst]', slugProduit: `Gengar-${v}-BOOCRE-057`, impressions: [{ tirage: 'intl', expansion: 'Chilling Reign', numero: '057', total: '198' }] });
        const g1 = e(110108, 'Trick or Trade Gengar (057/198 Trick or Trade BOOster Bundle exclusive Special Print)', IMG('2026/07', 'EN_S1695A.png'), 740, 1027, [9342]), g2 = e(110109, 'Holofoil Trick or Trade Gengar (057/198 Trick or Trade BOOster Bundle exclusive Special Print)', IMG('2026/07', 'EN_S1696A.png'), 740, 1027, [9342]);
        verifier('BS-HOLO : Trick or Trade — même couple, toujours un doute (jamais une preuve)', P.apparierFamille({ lignes: [tL], produits: [ptt(1, 'V1'), ptt(2, 'V2')], index: [g1, g2] }).resultats.map(r => [r.verdict, /^douteux-/.test(r.motif), 'partageeHoloNonHolo' in r]), [['reste', true, false], ['reste', true, false]]);
        const pL = { id: 'prof', famille: 'prof', slugs: ['Professor-Program'] }, ppr = (id, v) => ({ idProduct: id, carteId: 9, unite: 'Professor-Program', nomCm: 'Judge', slugProduit: `Judge-${v}-PPPFLI-108`, impressions: [{ tirage: 'intl', expansion: 'Flashfire', numero: '108', total: '131' }] });
        verifier('BS-HOLO : Professor Program — même couple, toujours un doute (jamais une preuve)', P.apparierFamille({ lignes: [pL], produits: [ppr(1, 'V1'), ppr(2, 'V2')], index: [e(51219, 'Professor Program Judge (108/131 Professor Program Special Print)', IMG('2022/01', 'EN_S830A.jpg'), 732, 1019, [5077]), e(51299, 'Holofoil Professor Program Judge (108/131 Professor Program Special Print)', IMG('2022/01', 'EN_S831A.jpg'), 732, 1019, [5077])] }).resultats.map(r => [r.verdict, /^douteux-/.test(r.motif), 'partageeHoloNonHolo' in r]), [['reste', true, false], ['reste', true, false]]);
    }
    // le PLAN : l'image, les champs, la preuve ; l'additif ; la fiche partagée ; le seuil
    const cMim = (images = []) => new Map([[278879, carte(278879, 'Mimikyu ex', images)]]);
    plan = P.planifierFamilles({ lignes: [LSVP], produits: [MC1, MC2], cartes: cMim(), index: [MIM_PLAIN, MIM_HOLO_PUR] });
    verifier('BS-HOLO plan : UNE image pour la fiche (la non-holo), le champ explicite et la liste EXACTE des deux produits, le numéro de la fiche, la voie de la famille',
        [plan.plan.length, plan.plan[0]?.entreeId, plan.plan[0]?.url, plan.plan[0]?.partageeHoloNonHolo, plan.plan[0]?.produitsPartages, plan.plan[0]?.numero, plan.plan[0]?.voie, plan.plan[0]?.holo, plan.restes.length], [1, 80570, MIM_PLAIN.img, true, [701130, 701131], '004', 'pokumon+nom+numero+bsp', false, 0]);
    verifier('BS-HOLO plan : la preuve DIT que l\'image est partagée holo / non-holo, nomme les deux entrées et la règle de choix', [/partagée holo\/non-holo/.test(plan.plan[0].preuve), /80570/.test(plan.plan[0].preuve), /99571/.test(plan.plan[0].preuve), /non-holo/.test(plan.plan[0].preuve)], [true, true, true, true]);
    plan = P.planifierFamilles({ lignes: [LMEP], produits: [{ ...PLUC, carteId: 7 }], cartes: new Map([[7, carte(7, 'Mega Lucario ex')]]), index: [LUC] });
    verifier('BS-HOLO plan : une carte Black Star ORDINAIRE n\'a NI le champ NI la liste', ['partageeHoloNonHolo' in plan.plan[0], 'produitsPartages' in plan.plan[0]], [false, false]);
    plan = P.planifierFamilles({ lignes: [LSVP], produits: [MC1, MC2], cartes: cMim([{ set: 'SV-Black-Star-Promos', source: 'tcgdex', numero: '004', cleR2: 'x.webp' }]), index: [MIM_PLAIN, MIM_HOLO_PUR] });
    verifier('BS-HOLO plan : additif — une fiche qui a déjà SON image dans ce set n\'est pas touchée (« deja-servi » pour les deux produits)', [plan.plan.length, plan.restes.map(r => r.motif)], [0, ['deja-servi', 'deja-servi']]);
    plan = P.planifierFamilles({ lignes: [LSVP], produits: [MC1, MC2, { ...MC1, idProduct: 701132, slugProduit: 'Mimikyu-ex-V3-SVPen004' }], cartes: cMim(), index: [MIM_PLAIN, MIM_HOLO_PUR] });
    verifier('BS-HOLO plan : un TROISIÈME produit sur la même fiche (V3) : le couple devient un groupe de trois, trou — rien n\'est posé', [plan.plan.length, plan.restes.map(r => r.motif)], [0, ['douteux-multiplicite', 'douteux-multiplicite', 'douteux-multiplicite']]);
    const AUTRE = e(99580, 'Autre Nom (SVP004 English Promo)', IMG('2024/03', 'EN_S9580Autre.png'), 800, 1100, [7836]);
    plan = P.planifierFamilles({ lignes: [LSVP], produits: [MC1, MC2, { ...MC1, idProduct: 701140, nomCm: 'Autre Nom [Attaque]', slugProduit: 'Autre-Nom-SVPen004' }], cartes: cMim(), index: [MIM_PLAIN, MIM_HOLO_PUR, AUTRE] });
    verifier('BS-HOLO plan : un autre produit prouvé sur la MÊME fiche (même carte, même set, même numéro) mais d\'une autre entrée : « fiche-partagee » pour les trois, rien n\'est posé', [plan.plan.length, plan.restes.map(r => r.motif)], [0, ['fiche-partagee', 'fiche-partagee', 'fiche-partagee']]);
    plan = P.planifierFamilles({ lignes: [LSVP], produits: [MC1, MC2], cartes: cMim(), index: [{ ...MIM_PLAIN, w: 322, h: 449 }, MIM_HOLO_PUR] });
    verifier('BS-HOLO plan : l\'image choisie (non-holo) sous le seuil de 350 px est écartée et COMPTÉE pour les deux produits, jamais remplacée par le scan holo', [plan.plan.length, plan.restes.map(r => [r.motif, r.w]), plan.comptes.sousSeuil], [0, [['sous-le-seuil', 322], ['sous-le-seuil', 322]], 2]);
    plan = P.planifierFamilles({ lignes: [LSVP], produits: [MC1, MC2], cartes: cMim(), index: [{ ...MIM_PLAIN, anglais: false }, MIM_HOLO_PUR] });
    verifier('BS-HOLO plan : les vetos habituels s\'appliquent à l\'entrée choisie (langue)', plan.restes.map(r => r.motif), ['langue', 'langue']);
    plan = P.planifierFamilles({ lignes: [LSVP], produits: [MC1, MC2], cartes: cMim(), index: [{ ...MIM_PLAIN, img: MIM_PLAIN.img.replace(/EN_S0570Mimikyu/, 'PlaceholderCard') }, MIM_HOLO_PUR] });
    plan = P.planifierFamilles({ lignes: [LSVP], produits: [MC1, MC2], cartes: cMim(), index: [{ ...MIM_PLAIN, img: IMG('2021/03', 'PlaceholderCard.jpg') }, MIM_HOLO_PUR] });
    verifier('BS-HOLO plan : si la non-holo n\'est qu\'un placeholder, le scan holo NE la remplace PAS : rien n\'est posé (multiplicité)', [plan.plan.length, plan.restes.map(r => r.motif)], [0, ['douteux-multiplicite', 'douteux-multiplicite']]);

    console.log(`\n${ko ? '❌' : '✅'} ${ok} passés, ${ko} en échec`);
    process.exit(ko ? 1 : 0);
})().catch(e => { console.error('❌ le banc a levé :', e.message); process.exit(1); });
