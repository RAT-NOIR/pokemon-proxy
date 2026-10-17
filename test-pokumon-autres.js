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
    verifier('table : identifiants uniques, chaque ligne a une famille connue, 3 témoins distincts au moins, un tampon/marque lu, la date de lecture', [new Set(T.map(l => l.id)).size === T.length, T.every(l => ['mcd', 'tot', 'prof', 'bsp'].includes(l.famille) && new Set(l.temoins.map(t => `${t.nom}|${t.imprime}`)).size >= 3 && l.tampon.length > 20 && l.lu === '2026-10-17' && l.slugs.length === 1)], [true, true]);
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

    console.log(`\n${ko ? '❌' : '✅'} ${ok} passés, ${ko} en échec`);
    process.exit(ko ? 1 : 0);
})().catch(e => { console.error('❌ le banc a levé :', e.message); process.exit(1); });
