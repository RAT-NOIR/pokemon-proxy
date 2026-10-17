// node test-pokumon.js — collecte-cartes/pokumon.js (le client de pokumon.com, la TABLE des séries, la CLÉ, le plan) et la RÈGLE DU SITE qui choisit entre l'image
// propre et le substitut. Aucune requête, aucune base, rien sur R2 : un transport simulé et des cas RÉELS de la mesure du 2026-10-17 (S7/MESURE-OCC).
// TOOL_DIR=<dossier> rejoue le banc contre une copie MUTÉE du module (le rouge se voit en cassant le code).
// RACINE_SITE=<dossier> : le dossier dont le VOISIN `rat-market-site` porte la règle du site (défaut : le dépôt principal).
const path = require('path');
const DIR = process.env.TOOL_DIR || __dirname;
const P = require(path.join(DIR, 'collecte-cartes', 'pokumon.js'));

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); }
};

// ── les données : le titre, l'image et les identifiants viennent de l'index réel lu le 2026-10-17 (une valeur est recopiée, jamais inventée) ──
const { CDN, RAW, wp } = require('./test-pokumon-donnees');
const wpUrshifu = () => wp(75669, 'Holofoil Play Pokemon Single Strike Urshifu VMAX (086/163 Play Pokemon Prize Pack Series 1,Play Pokemon Prize Pack Series 2 Special Print)', `${CDN}/2024/11/EN_S1088Holofoil-Play-PokemonSpecial-Print.png`, 523, 732, [7720, 7721]);
const E = Object.fromEntries(Object.entries(RAW).map(([k, v]) => [k, P.lireEntree(v)]));
const indexComplet = Object.values(E);
// les produits : idProduct, nom Cardmarket (catalogue_produits.name), slug (numeros_cartes.slug) — réels
const prod = (idProduct, serie, nomCm, slugProduit) => ({ idProduct, serie, nomCm, slugProduit });

(async () => {
    // ── 1. la TABLE : une ligne par série, prouvée à l'œil ───────────────────────────────────────────────────────────────
    verifier('une ligne par série S1 à S4, rien d\'autre', P.TABLE_POKUMON.map(l => l.serie), [1, 2, 3, 4]);
    verifier('chaque ligne : 3 témoins au moins, numéros distincts, tampon lu, date de lecture', P.TABLE_POKUMON.every(l => new Set(l.temoins.map(t => t.n)).size >= 3 && /Play! Pokémon/.test(l.tampon) && /^2026-10-17$/.test(l.lu)), true);
    verifier('chaque ligne : le slug du set Cardmarket de sa série', P.TABLE_POKUMON.map(l => l.slug), ['Play-Pokemon-Prize-Pack-Series-One', 'Play-Pokemon-Prize-Pack-Series-Two', 'Play-Pokemon-Prize-Pack-Series-Three', 'Play-Pokemon-Prize-Pack-Series-Four']);
    // une paire commune n'est admise que si elle est PROUVÉE : des témoins partagés ET un témoin de chaque série seule (le tampon est le même des deux côtés)
    const paires = [...new Set(P.TABLE_POKUMON.flatMap(l => l.communes))].sort();
    verifier('les paires communes déclarées : 1,2 · 2,3 · 3,4', paires, ['1,2', '2,3', '3,4']);
    const toutes = P.TABLE_POKUMON.flatMap(l => l.temoins.map(t => ({ ...t, serie: l.serie })));
    verifier('chaque paire commune : 2 témoins partagés au moins, et un témoin SEUL de chacune de ses deux séries',
        paires.every(p => { const [a, b] = p.split(',').map(Number); const partages = toutes.filter(t => t.portee === p); const dist = new Set(partages.map(t => t.nom)); return dist.size >= 2 && toutes.some(t => t.portee === String(a)) && toutes.some(t => t.portee === String(b)); }), true);
    verifier('une paire non prouvée n\'existe pas : 1,3 et 2,4 sont refusées', [P.seriesAdmises([1, 3]), P.seriesAdmises([2, 4]), P.seriesAdmises([1, 2]), P.seriesAdmises([3]), P.seriesAdmises([5])], [null, null, [1, 2], [3], null]);

    // ── 2. l'index : une entrée lue comme la mesure la lit ───────────────────────────────────────────────────────────────
    verifier('lireEntree : nom, holo, numéro, total, séries, événements, langue, image, largeur', [E.kricketune.nom, E.kricketune.holo, E.kricketune.numero, E.kricketune.total, E.kricketune.series, E.kricketune.evenements, E.kricketune.anglais, E.kricketune.img, E.kricketune.w],
        ['Play Pokemon Kricketune V', true, '006', '163', [1, 2], [7720, 7721], true, `${CDN}/2024/11/EN_S1080Holofoil-Play-PokemonSpecial-Print.png`, 947]);
    verifier('lireEntree : l\'apostrophe typographique et les entités sont décodées (Cheren\'s Care)', E.cheren.nom, 'Play Pokemon Cheren\'s Care');
    verifier('placeholder : « PlaceholderCard » est rejeté, une vraie image non, une entrée sans image non plus', [P.estPlaceholder(E.placeholder), P.estPlaceholder(E.kricketune), P.estPlaceholder({ img: null })], [true, false, true]);
    verifier('construireIndex : les entrées vues sous deux événements (S1 et S2) ne comptent qu\'une fois', P.construireIndex([RAW.kricketune, RAW.kricketune, RAW.cherrim]).length, 2);

    // ── 3. la CLÉ : nom + numéro d\'origine + série, avec ses témoins ──────────────────────────────────────────────────────
    verifier('numeroOrigine : le dernier élément du slug Cardmarket, zéros de tête retirés, code d\'origine lu', [P.numeroOrigine('Kricketune-V-PPS1BST-006'), P.numeroOrigine('Cherens-Care-V1-PPS2BRS-134'), P.numeroOrigine('Fighting-Energy-PPS1')], [{ n: '6', code: 'PPS1BST', prefixe: '' }, { n: '134', code: 'PPS2BRS', prefixe: '' }, null]);
    verifier('numeroOrigine : une numérotation à préfixe garde son préfixe (le numéro seul fait 15 faux sur 253)', P.numeroOrigine('Pikachu-VMAX-PPS3SIT-TG29'), { n: '29', code: 'TG', prefixe: 'TG' });
    const produitsA = [prod(697064, 1, 'Kricketune V [Exciting Stage | X-Scissor]', 'Kricketune-V-PPS1BST-006'), prod(705125, 2, 'Kricketune V [Exciting Stage | X-Scissor]', 'Kricketune-V-PPS2BST-006')];
    let A = P.apparier({ produits: produitsA, index: indexComplet });
    verifier('un seul produit, une seule entrée : PROUVÉ (Kricketune V S1 et S2 → la même entrée commune S1/S2)', A.resultats.map(r => [r.idProduct, r.verdict, r.entree?.id]), [[697064, 'prouve', 75661], [705125, 'prouve', 75661]]);
    verifier('le témoin porte le dénominateur du set d\'origine', A.resultats[0].temoin, 'dénominateur /163 : 2 appariements du code BST, tous à /163');
    A = P.apparier({ produits: [prod(697089, 1, 'Drizzile [Shady Dealings | Water Drip]', 'Drizzile-V1-PPS1SSH-056'), prod(835825, 1, 'Drizzile [Shady Dealings | Water Drip]', 'Drizzile-V2-PPS1SSH-056')], index: indexComplet });
    verifier('holo et non-holo (V1/V2 contre deux entrées) sans carte commune PROUVÉE (aucun carteId fourni) : TROU, nommé — la décision PP-HOLO ne vaut que pour une même carte', A.resultats.map(r => [r.verdict, r.motif]), [['reste', 'holo-carte-non-prouvee'], ['reste', 'holo-carte-non-prouvee']]);
    A = P.apparier({ produits: [prod(705184, 2, 'Escape Rope', 'Escape-Rope-PPS2BST-125')], index: indexComplet });
    verifier('un produit, deux entrées (holo et non-holo) : TROU « multiplicité »', A.resultats.map(r => [r.verdict, r.motif]), [['reste', 'douteux-multiplicite']]);
    const GROTLE3 = prod(728159, 3, 'Grotle [Sun-Drenched Shell | Razor Leaf]', 'Grotle-PPS3BRS-007');
    A = P.apparier({ produits: [prod(705199, 2, 'Cheren\'s Care', 'Cherens-Care-V1-PPS2BRS-134'), prod(835786, 2, 'Cheren\'s Care', 'Cherens-Care-V2-PPS2BRS-134'), prod(728167, 3, 'Cheren\'s Care', 'Cherens-Care-PPS3BRS-134'), GROTLE3], index: indexComplet });
    verifier('deux produits (V1, V2) pour une entrée : TROU en S2 ; les produits uniques de S3 sont prouvés (les entrées sont communes S2/S3)', A.resultats.map(r => [r.idProduct, r.verdict, r.motif ?? r.entree.id]), [[705199, 'reste', 'douteux-multiplicite'], [835786, 'reste', 'douteux-multiplicite'], [728167, 'prouve', 75856], [728159, 'prouve', 75820]]);
    A = P.apparier({ produits: [prod(1, 3, 'Cheren\'s Care', 'Cherens-Care-PPS3BRS-134'), GROTLE3], index: [E.cheren, E.grotle, E.cherrim] });
    verifier('la série compte : une entrée S2/S3 sert un produit S3, jamais un produit S4', [A.resultats[0].verdict, P.apparier({ produits: [prod(2, 4, 'Cheren\'s Care', 'Cherens-Care-PPS4BRS-134')], index: [E.cheren] }).resultats[0].motif], ['prouve', 'non-couvert']);
    A = P.apparier({ produits: [prod(1, 3, 'Cheren\'s Care', 'Cherens-Care-PPS3BRS-134')], index: [E.cheren] });
    verifier('un code d\'origine qui n\'a QU\'UN produit apparié n\'a pas de second témoin : trou (le dénominateur ne se vérifie pas)', A.resultats[0].motif, 'code-sans-second-temoin');
    A = P.apparier({ produits: [prod(697065, 1, 'Cherrim [Spring Bloom | Seed Bomb]', 'Cherrim-PPS1BST-008')], index: [{ ...E.cherrim, img: `${CDN}/2021/03/PlaceholderCard.jpg` }] });
    verifier('PLACEHOLDER : un produit « couvert » dont l\'image est « PlaceholderCard » est un trou, et il est COMPTÉ', [A.resultats[0].motif, A.comptes.placeholders], ['placeholder', 1]);
    const CHERRIM = prod(5, 1, 'Cherrim [Spring Bloom | Seed Bomb]', 'Cherrim-PPS1BST-008');
    A = P.apparier({ produits: [CHERRIM], index: [{ ...E.cherrim, anglais: false }] });
    verifier('une entrée qui n\'est pas ANGLAISE est un trou (langue)', A.resultats[0].motif, 'langue');
    A = P.apparier({ produits: [prod(5, 1, 'Cherrim [Spring Bloom | Seed Bomb]', 'Cherrim-PPS1BST-008')], index: [{ ...E.cherrim, evenements: [7720] }] });
    verifier('une entrée qui se dit S1/S2 mais ne porte pas l\'événement S2 : trou (le titre et l\'événement se contredisent)', A.resultats[0].motif, 'evenement-contredit');
    A = P.apparier({ produits: [prod(5, 1, 'Cherrim [Spring Bloom | Seed Bomb]', 'Cherrim-PPS1BST-TG08')], index: [E.cherrim] });
    verifier('le numéro d\'origine à préfixe (TG08) ne reçoit pas l\'entrée « 008 » : le préfixe est un veto', A.resultats[0].motif, 'prefixe-contredit');
    A = P.apparier({ produits: [prod(6, 1, 'Cherrim', 'Cherrim-PPS1BST-008')], index: [{ ...E.cherrim, series: [1, 3], evenements: [7720, 7838] }] });
    verifier('une entrée S1/S3 (paire non prouvée) est un trou « série non prouvée »', A.resultats[0].motif, 'serie-non-prouvee');
    A = P.apparier({ produits: [prod(7, 1, 'Cherrim', 'Cherrim-PPS1BST-009')], index: [E.cherrim] });
    verifier('le numéro d\'origine différent (009 contre 008) ne s\'apparie pas', A.resultats[0].motif, 'non-couvert');
    // TÉMOIN INDÉPENDANT : le dénominateur du set d\'origine. Gengar de Trick or Trade (CRE 057/198 en 2022) réclamé aussi par le produit de 2024 (PAF) : une entrée, deux origines → les deux sont écartés
    const gen = [{ idProduct: 671576, serie: 'x', nomCm: 'Gengar [Last Gift | Pain Burst]', slugProduit: 'Gengar-BOOCRE-057' }, { idProduct: 785620, serie: 'x', nomCm: 'Gengar [Night Gate | Nightmare]', slugProduit: 'Gengar-BOO24PAF-057' }];
    const tg = P.temoinsDeLEntree(gen.map(g => ({ ...g, entree: E.gengar22, code: P.codeOrigine(P.numeroOrigine(g.slugProduit).code) })));
    verifier('Gengar 2022 / 2024 : la même entrée réclamée par deux origines (CRE, PAF) — les deux produits sont écartés', tg.map(t => [t.idProduct, t.motif]), [[671576, 'entree-revendiquee-par-deux-origines'], [785620, 'entree-revendiquee-par-deux-origines']]);
    verifier('codeOrigine retire le préfixe de série et celui de l\'année (PPS1BST → BST, BOO24PAF → PAF)', [P.codeOrigine('PPS1BST'), P.codeOrigine('BOO24PAF'), P.codeOrigine('BOOCRE'), P.codeOrigine('TG')], ['BST', 'PAF', 'CRE', 'TG']);
    // Cardmarket écrit « BTS » en S1 et « BST » en S2 pour Battle Styles : la même entrée Pokumon (Single Strike Urshifu VMAX 086/163) sert les deux, et ne doit pas être prise pour deux origines
    const urshifu = P.lireEntree(wpUrshifu());
    const U1 = prod(697126, 1, 'Single Strike Urshifu VMAX [Beatdown | G-Max One Blow]', 'Single-Strike-Urshifu-VMAX-PPS1BTS-086'), U2 = prod(713835, 2, 'Single Strike Urshifu VMAX [Beatdown | G-Max One Blow]', 'Single-Strike-Urshifu-VMAX-PPS2BST-086');
    verifier('alias BTS → BST (table énumérée) ; un code hors table reste lui-même', [P.codeOrigine('PPS1BTS'), P.codeOrigine('PPS2BST'), P.codeOrigine('PPS1XYZ')], ['BST', 'BST', 'XYZ']);
    A = P.apparier({ produits: [U1, U2], index: [urshifu] });
    verifier('Urshifu VMAX 086/163 : le produit S1 (BTS) et le produit S2 (BST) partagent l\'entrée commune — les deux sont prouvés, le dénominateur /163 compte les deux', [A.resultats.map(r => [r.idProduct, r.verdict]), A.resultats[0].temoin], [[[697126, 'prouve'], [713835, 'prouve']], 'dénominateur /163 : 2 appariements du code BST, tous à /163']);
    const dn = P.denominateurDuCode([{ idProduct: 1, code: 'BST', entree: { total: '163' } }, { idProduct: 2, code: 'BST', entree: { total: '163' } }, { idProduct: 3, code: 'BST', entree: { total: '198' } }, { idProduct: 4, code: 'CRE', entree: { total: '198' } }]);
    verifier('dénominateur du code : le produit qui contredit la majorité est écarté, le code à un seul témoin aussi (non vérifiable)', dn.map(t => [t.idProduct, t.motif ?? 'ok']), [[1, 'ok'], [2, 'ok'], [3, 'denominateur-contredit'], [4, 'code-sans-second-temoin']]);

    // ── 3 ter. PP-HOLO (2026-10-17) : le scan tamponné sert les DEUX produits holo et non-holo, marqué « partagée holo/non-holo » ─────────────────────────────
    // DÉCISION DU TESTEUR : même carte, même tampon, seul le brillant diffère. Un groupe n'est résolu que si TOUT le prouve : deux produits d'une MÊME carte dont le slug ne diffère que par V1/V2 ;
    // deux entrées de MÊME titre dont l'une seulement est « Holofoil », mêmes séries, mêmes événements ; l'entrée choisie est la NON-holo (aucun brillant cuit dans le scan) ; tous les vetos et témoins s'appliquent.
    const SLUGS = { 1: 'Play-Pokemon-Prize-Pack-Series-One', 2: 'Play-Pokemon-Prize-Pack-Series-Two' };
    const pc = (idProduct, carteId, serie, nomCm, slugProduit) => ({ idProduct, carteId, slugSet: SLUGS[serie], serie, nomCm, slugProduit });
    const DRZ1 = pc(697089, 244998, 1, 'Drizzile [Shady Dealings | Water Drip]', 'Drizzile-V1-PPS1SSH-056'), DRZ2 = pc(835825, 244998, 1, 'Drizzile [Shady Dealings | Water Drip]', 'Drizzile-V2-PPS1SSH-056');
    const GB1 = pc(697187, 30360, 1, 'Great Ball', 'Great-Ball-PPS1SSH-164');
    const idxH = [E.drizzileHolo, E.drizzile, E.greatBall];
    const parId = (A, id) => A.resultats.find(r => r.idProduct === id);
    A = P.apparier({ produits: [DRZ1, DRZ2, GB1], index: idxH });
    verifier('PP-HOLO : deux produits V1/V2 d\'une même carte, deux entrées Holofoil / non-Holofoil de même titre → les DEUX prouvés, sur la même entrée : la NON-holo (75588), pas la holo (75587)',
        [parId(A, 697089).verdict, parId(A, 835825).verdict, parId(A, 697089).entree.id, parId(A, 835825).entree.id, parId(A, 697089).entree.holo], ['prouve', 'prouve', 75588, 75588, false]);
    verifier('PP-HOLO : le champ explicite sur les deux résultats — partagée, et la liste EXACTE des produits du groupe (ids triés)',
        [parId(A, 697089).partageeHoloNonHolo, parId(A, 835825).partageeHoloNonHolo, parId(A, 697089).produitsPartages, parId(A, 835825).produitsPartages], [true, true, [697089, 835825], [697089, 835825]]);
    verifier('PP-HOLO : une carte ordinaire (Great Ball) du même lot n\'a NI le champ NI la liste', ['partageeHoloNonHolo' in parId(A, 697187), 'produitsPartages' in parId(A, 697187), parId(A, 697187).verdict], [false, false, 'prouve']);
    verifier('PP-HOLO : le témoin du dénominateur s\'applique au groupe (SSH /202 : le groupe compte UNE fois, avec Great Ball)', [parId(A, 697089).temoin, parId(A, 835825).temoin], ['dénominateur /202 : 2 appariements du code SSH, tous à /202', 'dénominateur /202 : 2 appariements du code SSH, tous à /202']);
    // la règle est déterministe : l'ordre des produits et des entrées n'y change rien
    const A2 = P.apparier({ produits: [GB1, DRZ2, DRZ1], index: [...idxH].reverse() });
    verifier('PP-HOLO : déterminisme — produits et entrées dans l\'ordre inverse : même entrée, même liste', [parId(A2, 697089).entree.id, parId(A2, 835825).entree.id, parId(A2, 835825).produitsPartages], [75588, 75588, [697089, 835825]]);
    // un témoin qui se confirme lui-même ne prouve rien : le groupe ne peut pas faire à lui seul les « deux appariements » du code
    A = P.apparier({ produits: [DRZ1, DRZ2], index: idxH });
    verifier('PP-HOLO : le groupe SEUL ne se sert pas de témoin (ses deux produits ne font pas deux appariements du code) : trou « code-sans-second-temoin »', A.resultats.map(r => [r.verdict, r.motif]), [['reste', 'code-sans-second-temoin'], ['reste', 'code-sans-second-temoin']]);
    // les causes de refus, chacune nommée
    const REVERSE = P.lireEntree(wp(75588, 'Reverse Holo Play Pokemon Drizzile (056/202 Play Pokemon Prize Pack Series 1 Special Print)', `${CDN}/2024/11/EN_S1007Play-PokemonSpecial-Print.png`, 785, 1099, [7720]));
    A = P.apparier({ produits: [DRZ1, DRZ2, GB1], index: [E.drizzileHolo, REVERSE, E.greatBall] });
    verifier('PP-HOLO : « Reverse » n\'est pas « non-holo » — une autre question, NON tranchée : trou « holo-reverse », ni l\'un ni l\'autre prouvé', [parId(A, 697089).motif, parId(A, 835825).motif], ['holo-reverse', 'holo-reverse']);
    A = P.apparier({ produits: [DRZ1, DRZ2, GB1], index: [E.drizzileHolo, { ...E.drizzileHolo, id: 99999 }, E.greatBall] });
    verifier('PP-HOLO : deux entrées toutes deux « Holofoil » — ce n\'est pas holo / non-holo : trou « holo-forme-non-prouvee »', [parId(A, 697089).motif, parId(A, 835825).motif], ['holo-forme-non-prouvee', 'holo-forme-non-prouvee']);
    A = P.apparier({ produits: [DRZ1, DRZ2, GB1], index: [E.drizzile, { ...E.drizzile, id: 99998 }, E.greatBall] });
    verifier('PP-HOLO : deux entrées toutes deux sans « Holofoil » : trou « holo-forme-non-prouvee »', [parId(A, 697089).motif, parId(A, 835825).motif], ['holo-forme-non-prouvee', 'holo-forme-non-prouvee']);
    A = P.apparier({ produits: [DRZ1, { ...DRZ2, carteId: 244999 }, GB1], index: idxH });
    verifier('PP-HOLO : deux produits de deux CARTES différentes : trou « holo-carte-non-prouvee »', [parId(A, 697089).motif, parId(A, 835825).motif], ['holo-carte-non-prouvee', 'holo-carte-non-prouvee']);
    A = P.apparier({ produits: [{ ...DRZ1, carteId: undefined }, { ...DRZ2, carteId: undefined }, GB1], index: idxH });
    verifier('PP-HOLO : sans carteId connu (même set), la carte commune n\'est pas prouvée : trou « holo-carte-non-prouvee » (jamais « undefined = undefined »)', [parId(A, 697089).motif, parId(A, 835825).motif], ['holo-carte-non-prouvee', 'holo-carte-non-prouvee']);
    A = P.apparier({ produits: [DRZ1, { ...DRZ2, nomCm: 'Drizzile [Shady Dealings | Water Drip]' , slugProduit: 'Drizzile-V3-PPS1SSH-056' }, GB1], index: idxH });
    verifier('PP-HOLO : deux produits dont les slugs ne sont pas exactement V1 et V2 (ici V1 et V3) : trou « holo-forme-non-prouvee »', [parId(A, 697089).motif, parId(A, 835825).motif], ['holo-forme-non-prouvee', 'holo-forme-non-prouvee']);
    A = P.apparier({ produits: [DRZ1, DRZ2, GB1], index: [E.drizzileHolo, { ...E.drizzile, nom: 'Play Pokemon Drizzile Autre' , titre: E.drizzile.titre.replace('Drizzile', 'Drizzile Autre') }, E.greatBall] });
    verifier('PP-HOLO : deux entrées de titres différents ne sont pas deux impressions d\'une même carte (le nom lu ne s\'apparie plus) : le groupe reste un trou, pas un gain', [parId(A, 697089).verdict, parId(A, 835825).verdict], ['reste', 'reste']);
    A = P.apparier({ produits: [DRZ1, DRZ2, GB1], index: [E.drizzileHolo, P.lireEntree(wp(75588, 'Play Pokemon Drizzile (056/203 Play Pokemon Prize Pack Series 1 Special Print)', E.drizzile.img, 785, 1099, [7720]))] });
    verifier('PP-HOLO : deux entrées au dénominateur imprimé différent (056/202 contre 056/203) : trou « holo-forme-non-prouvee »', [parId(A, 697089).motif, parId(A, 835825).motif], ['holo-forme-non-prouvee', 'holo-forme-non-prouvee']);
    A = P.apparier({ produits: [DRZ1, DRZ2, GB1], index: [E.drizzileHolo, P.lireEntree(wp(75588, 'Play Pokemon Drizzile (056/202 Play Pokemon Prize Pack Series 1 Special Print Autre)', E.drizzile.img, 785, 1099, [7720]))] });
    verifier('PP-HOLO : deux entrées au texte de set différent hors séries (« … Autre ») : trou « holo-forme-non-prouvee »', [parId(A, 697089).motif, parId(A, 835825).motif], ['holo-forme-non-prouvee', 'holo-forme-non-prouvee']);
    A = P.apparier({ produits: [DRZ1, DRZ2, GB1], index: [E.drizzileHolo, { ...E.drizzile, evenements: [] }, E.greatBall] });
    verifier('PP-HOLO : mêmes séries lues mais événements différents (la holo porte l\'événement S1, la non-holo aucun) : trou « holo-series-differentes »', [parId(A, 697089).motif, parId(A, 835825).motif], ['holo-series-differentes', 'holo-series-differentes']);
    A = P.apparier({ produits: [DRZ1, { ...DRZ2, nomCm: 'Drizzile [Shady Dealings | Autre]' }, GB1], index: idxH });
    verifier('PP-HOLO : deux produits au nom Cardmarket différent (les attaques diffèrent) ne sont pas un couple holo / non-holo : trou « holo-forme-non-prouvee »', [parId(A, 697089).motif, parId(A, 835825).motif], ['holo-forme-non-prouvee', 'holo-forme-non-prouvee']);
    // séries : la décision vaut pour des entrées aux MÊMES séries ; un couple aux séries différentes (Houndoom : S1+S2 / S2 seule) reste un trou
    const HD = (id, v) => pc(id, 259245, 2, 'Houndoom [Single Strike Roar | Darkness Fang]', `Houndoom-${v}-PPS2BST-096`);
    const KRIC1 = pc(697064, 100, 1, 'Kricketune V [Exciting Stage | X-Scissor]', 'Kricketune-V-PPS1BST-006');
    A = P.apparier({ produits: [HD(705155, 'V1'), HD(835797, 'V2'), KRIC1], index: [E.houndoomN, E.houndoomHolo, E.kricketune] });
    verifier('PP-HOLO : holo S2 seule et non-holo S1+S2 (Houndoom 096/163) — les deux entrées contiennent la série S2 du produit : PROUVÉS, sur la non-holo (75673), le tampon étant identique d\'une série à l\'autre', [parId(A, 705155).verdict, parId(A, 835797).verdict, parId(A, 705155).entree.id, parId(A, 835797).produitsPartages], ['prouve', 'prouve', 75673, [705155, 835797]]);
    A = P.apparier({ produits: [HD(705155, 'V1'), HD(835797, 'V2'), KRIC1], index: [E.houndoomN, { ...E.houndoomHolo, series: [3], evenements: [7838] }, E.kricketune] });
    verifier('PP-HOLO : une entrée qui ne contient PAS la série du produit (holo S3 pour des produits S2) n\'est pas candidate : un seul candidat pour deux produits, trou « multiplicité »', [parId(A, 705155).motif, parId(A, 835797).motif], ['douteux-multiplicite', 'douteux-multiplicite']);
    A = P.apparier({ produits: [HD(705155, 'V1'), HD(835797, 'V2'), KRIC1], index: [E.houndoomN, { ...E.houndoomHolo, series: [1, 2], evenements: [7720] }, E.kricketune] });
    verifier('PP-HOLO : une entrée dont les événements ne portent pas la série du produit (S2 dite, seul l\'événement S1 posé) : trou « holo-series-differentes »', [parId(A, 705155).motif, parId(A, 835797).motif], ['holo-series-differentes', 'holo-series-differentes']);
    // la décision ne contourne AUCUN veto : l'entrée choisie les passe tous
    const sous = (modN, modH = {}) => P.apparier({ produits: [DRZ1, DRZ2, GB1], index: [{ ...E.drizzileHolo, ...modH }, { ...E.drizzile, ...modN }, E.greatBall] });
    verifier('PP-HOLO vetos : placeholder · langue · événement contredit · série non prouvée — chacun garde le groupe en trou, avec son motif habituel',
        [sous({ img: `${CDN}/2021/03/PlaceholderCard.jpg` }), sous({ anglais: false }), sous({ series: [1, 2], evenements: [7720] }, { series: [1, 2], evenements: [7720] }), sous({ series: [1, 3], evenements: [7720, 7838] }, { series: [1, 3], evenements: [7720, 7838] })].map(r => [parId(r, 697089).motif, parId(r, 835825).motif]),
        [['placeholder', 'placeholder'], ['langue', 'langue'], ['evenement-contredit', 'evenement-contredit'], ['serie-non-prouvee', 'serie-non-prouvee']]);
    A = P.apparier({ produits: [{ ...DRZ1, slugProduit: 'Drizzile-V1-PPS1SSH-TG056' }, { ...DRZ2, slugProduit: 'Drizzile-V2-PPS1SSH-TG056' }, GB1], index: idxH });
    verifier('PP-HOLO vetos : un numéro d\'origine à préfixe (TG056) ne reçoit pas l\'entrée « 056 » (le groupe lui-même reste un trou)', [parId(A, 697089).verdict, parId(A, 835825).verdict], ['reste', 'reste']);
    // deux cartes ordinaires du même code d'origine (SSH) dont le dénominateur imprimé est /198 (forme dérivée de Great Ball : seul le total change) : la majorité du code est /198, le groupe est à /202
    const QB = (id, n, nom) => ({ produit: pc(id, 5000 + id, 1, nom, `${nom.replace(/ /g, '-')}-PPS1SSH-${n}`), entree: { ...E.greatBall, id: 80000 + id, nom: `Play Pokemon ${nom}`, numero: n, total: '198' } });
    const [QB1, QB2] = [QB(1, '179', 'Quick Ball'), QB(2, '180', 'Ultra Ball')];
    A = P.apparier({ produits: [DRZ1, DRZ2, QB1.produit, QB2.produit], index: [E.drizzileHolo, E.drizzile, QB1.entree, QB2.entree] });
    verifier('PP-HOLO témoins : un dénominateur (/202) qui contredit la majorité du code (/198) écarte le groupe ENTIER — les deux produits, jamais un seul', [parId(A, 697089).motif, parId(A, 835825).motif], ['denominateur-contredit', 'denominateur-contredit']);
    verifier('PP-HOLO témoins : les deux cartes ordinaires /198 du même code restent prouvées (la décision ne les touche pas)', [parId(A, 1).verdict, parId(A, 2).verdict], ['prouve', 'prouve']);
    // les autres produits du lot ne changent pas : Kricketune V (une seule entrée) reste prouvé exactement comme avant, et un produit seul avec deux entrées reste « multiplicité »
    A = P.apparier({ produits: [prod(705184, 2, 'Escape Rope', 'Escape-Rope-PPS2BST-125')], index: [E.escapeHolo, E.escape] });
    verifier('PP-HOLO : UN produit pour deux entrées (holo et non-holo) reste un trou « multiplicité » — la décision ne vaut que pour deux produits', A.resultats.map(r => [r.verdict, r.motif]), [['reste', 'douteux-multiplicite']]);
    // ── les AUTRES FAMILLES ne changent PAS (128 Black Star, McDonald's, Trick or Trade, Professor Program) : même cas holo / non-holo, même verdict qu'avant ──
    const PRO1 = { idProduct: 450688, unite: 'Professor-Program', nomCm: 'Judge', slugProduit: 'Judge-V1-PPPFLI-108', carteId: 7, impressions: [{ tirage: 'intl', expansion: 'Flashfire', numero: '108', total: '131' }] };
    const PRO2 = { ...PRO1, idProduct: 450689, slugProduit: 'Judge-V2-PPPFLI-108' };
    const JUDGE_N = P.lireEntree(wp(51219, 'Professor Program Judge (108/131 Professor Program Special Print)', `${CDN}/2022/01/EN_S830Professor-ProgramSpecial-Print.jpg`, 732, 1019, [5077]));
    const JUDGE_H = P.lireEntree(wp(51218, 'Holofoil Professor Program Judge (108/131 Professor Program Special Print)', `${CDN}/2022/01/EN_S829Holofoil-Professor-ProgramSpecial-Print.png`, 732, 1019, [5077]));
    A = P.apparierFamille({ lignes: [{ id: 'prof', famille: 'prof', slugs: ['Professor-Program'] }], produits: [PRO1, PRO2], index: [JUDGE_H, JUDGE_N] });
    verifier('AUTRES FAMILLES inchangées : deux produits V1/V2 d\'une même carte pour une entrée holo et une non-holo restent « douteux-variantes-non-separables » (la décision PP-HOLO ne vaut que pour les Prize Packs S1-S4)',
        A.resultats.map(r => [r.verdict, r.motif, 'partageeHoloNonHolo' in r]), [['reste', 'douteux-variantes-non-separables', false], ['reste', 'douteux-variantes-non-separables', false]]);

    // ── 4. le PLAN : la fiche reçoit UN visuel, jamais deux, jamais un autre produit que le sien ─────────────────────────
    const carte = (id, nomEn, images = []) => ({ _id: id, nomEn, images });
    const ligne = (idProduct, carteId, slugSet) => ({ idProduct, carteId, slugSet });
    const SLUG1 = 'Play-Pokemon-Prize-Pack-Series-One', SLUG2 = 'Play-Pokemon-Prize-Pack-Series-Two';
    let plan = P.planifierPokumon({ produits: produitsA.map((p, i) => ({ ...p, carteId: 100 + i, slugSet: i ? SLUG2 : SLUG1 })), cartes: new Map([[100, carte(100, 'Kricketune V')], [101, carte(101, 'Kricketune V')]]), index: indexComplet });
    verifier('plan : deux produits, deux fiches (une par set), l\'adresse est celle de l\'entrée', plan.plan.map(p => [p.carteId, p.slugSet, p.url, p.numero, p.serie]), [[100, SLUG1, E.kricketune.img, '006', 1], [101, SLUG2, E.kricketune.img, '006', 2]]);
    verifier('plan : la preuve nomme le numéro, le nom, la série, l\'entrée et le dénominateur', /006/.test(plan.plan[0].preuve) && /Kricketune V/.test(plan.plan[0].preuve) && /Series 1/.test(plan.plan[0].preuve) && /75661/.test(plan.plan[0].preuve) && /163/.test(plan.plan[0].preuve), true);
    const dd = [{ ...produitsA[0], carteId: 100, slugSet: SLUG1 }, { ...produitsA[1], carteId: 101, slugSet: SLUG2 }];
    plan = P.planifierPokumon({ produits: dd, cartes: new Map([[100, carte(100, 'Kricketune V', [{ set: SLUG1, source: 'tcgdex', numero: '006', cleR2: 'x.webp' }])], [101, carte(101, 'Kricketune V')]]), index: indexComplet });
    verifier('plan : une fiche qui a déjà un visuel dans CE set n\'est jamais touchée (additif)', [plan.plan.map(p => p.carteId), plan.restes.map(r => [r.carteId, r.motif])], [[101], [[100, 'deja-servi']]]);
    plan = P.planifierPokumon({ produits: dd, cartes: new Map([[100, carte(100, 'Kricketune V', [{ set: 'Battle-Styles', source: 'tcgdex', numero: '006', cleR2: 'x.webp' }])], [101, carte(101, 'Kricketune V')]]), index: indexComplet });
    verifier('plan : le visuel d\'un AUTRE set (la carte d\'origine) ne compte pas comme servi', plan.plan.length, 2);
    plan = P.planifierPokumon({ produits: [...dd, { carteId: 100, slugSet: SLUG1, ...prod(999, 1, 'Autre produit de la même carte', 'Autre-PPS1BST-007') }], cartes: new Map([[100, carte(100, 'Kricketune V')], [101, carte(101, 'Kricketune V')]]), index: indexComplet });
    verifier('plan : deux produits sur UNE fiche (carte, set), dont un non prouvé : la fiche affiche un seul visuel — TROU « fiche-partagee », rien n\'est posé sur cette fiche', [plan.plan.map(p => p.carteId), plan.restes.map(r => [r.carteId, r.motif]).sort()], [[101], [[100, 'fiche-partagee'], [100, 'non-couvert']]]);
    plan = P.planifierPokumon({ produits: dd, cartes: new Map([[101, carte(101, 'Kricketune V')]]), index: indexComplet });
    verifier('plan : une carte absente de la base est un reste nommé', [plan.plan.length, plan.restes.map(r => r.motif)], [1, ['carte-absente']]);
    // PP-HOLO au plan : UNE image par fiche (carte, set), le champ explicite, la preuve qui le dit
    const cartesH = () => new Map([[244998, carte(244998, 'Drizzile')], [30360, carte(30360, 'Great Ball')]]);
    plan = P.planifierPokumon({ produits: [DRZ1, DRZ2, GB1], cartes: cartesH(), index: idxH });
    const pH = plan.plan.find(p => p.carteId === 244998), pG = plan.plan.find(p => p.carteId === 30360);
    verifier('plan PP-HOLO : UNE image pour la fiche Drizzile (les deux produits y sont), l\'adresse est celle de la non-holo, le numéro imprimé 056', [plan.plan.length, pH.url, pH.entreeId, pH.numero], [2, E.drizzile.img, 75588, '056']);
    verifier('plan PP-HOLO : le champ explicite « partagée holo/non-holo » et la liste EXACTE des produits ; Great Ball (ordinaire) n\'a ni l\'un ni l\'autre', [pH.partageeHoloNonHolo, pH.produitsPartages, 'partageeHoloNonHolo' in pG, 'produitsPartages' in pG], [true, [697089, 835825], false, false]);
    verifier('plan PP-HOLO : la preuve dit « partagée holo/non-holo », nomme les deux produits, l\'entrée choisie (75588) et la holo laissée de côté (75587)', [/partagée holo\/non-holo/.test(pH.preuve), /697089/.test(pH.preuve) && /835825/.test(pH.preuve), /75588/.test(pH.preuve), /75587/.test(pH.preuve)], [true, true, true, true]);
    plan = P.planifierPokumon({ produits: [DRZ1, DRZ2, GB1], cartes: new Map([[244998, carte(244998, 'Drizzile', [{ set: SLUGS[1], source: 'tcgdex', numero: '056', cleR2: 'x.webp' }])], [30360, carte(30360, 'Great Ball')]]), index: idxH });
    verifier('plan PP-HOLO ADDITIF : une fiche qui a déjà un visuel dans CE set n\'est jamais touchée — les deux produits restent « deja-servi »', [plan.plan.map(p => p.carteId), plan.restes.map(r => [r.idProduct, r.motif]).sort()], [[30360], [[697089, 'deja-servi'], [835825, 'deja-servi']]]);
    plan = P.planifierPokumon({ produits: [DRZ1, DRZ2, GB1, pc(999001, 244998, 1, 'Drizzile Autre', 'Drizzile-Autre-PPS1SSH-057')], cartes: cartesH(), index: idxH });
    verifier('plan PP-HOLO : la garde « fiche-partagee » s\'applique telle quelle — un troisième produit non prouvé sur la même fiche garde les DEUX en trou', [plan.plan.map(p => p.carteId), plan.restes.map(r => [r.idProduct, r.motif]).sort()], [[30360], [[697089, 'fiche-partagee'], [835825, 'fiche-partagee'], [999001, 'non-couvert']]]);
    plan = P.planifierPokumon({ produits: [{ ...DRZ1, carteId: 244998 }, { ...DRZ2, slugSet: SLUGS[2] }, GB1], cartes: cartesH(), index: idxH });
    verifier('plan PP-HOLO : deux produits sur deux FICHES (deux sets) ne sont pas un groupe de la décision : rien n\'est posé pour eux', [plan.plan.filter(p => p.carteId === 244998).length, plan.restes.filter(r => r.carteId === 244998).map(r => r.motif)], [0, ['holo-carte-non-prouvee', 'holo-carte-non-prouvee']]);

    // ── 5. le CLIENT : garde fermée, hôtes et chemins énumérés, cadence, réessai, plafond, arrêt au premier blocage ───────────────
    const reseau = repondre => { const appels = []; return { appels, async get(url, o) { appels.push(url); return repondre(url, o); } }; };
    // REPONSE-HOTE : la règle commune exige les OCTETS d'une image (« PNG » en clair n'en est pas une) ; les pauses persistantes du banc vont dans un dossier temporaire
    const PNG_BANC = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(24)]);
    const DOSSIER_PAUSES_BANC = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'pk-pauses-'));
    const ROBOTS ='User-agent: *\nDisallow: /wp-admin/\nAllow: /wp-admin/admin-ajax.php\n';
    const JSON_INDEX = JSON.stringify([RAW.kricketune, RAW.cherrim]);
    const normal = (url, o) => /\/robots\.txt$/.test(url) ? { status: 200, texte: ROBOTS }
        : /wp-json\/wp\/v2\/card/.test(url) ? { status: 200, type: 'application/json; charset=UTF-8', texte: JSON_INDEX, pages: 1 }
            : /\.(png|jpg)$/.test(url) ? { status: 200, type: 'image/png', octets: PNG_BANC } : { status: 404, type: 'text/html' };
    const verrou = { tenu: true, perdu: false };
    const attentes = [];
    let maintenant = 1e12;                                          // l'horloge du banc ne bouge que par les pauses : la cadence se mesure exactement
    const pause = async ms => { attentes.push(ms); maintenant += ms; };
    const client = (tr, v = verrou, o = {}) => (o.processus || require('./collecte-cartes/reponse-hote').reinitialiserSuiviProcessus(), P.fabriquerClientPokumon({ transport: tr, verrou: v, pause, horloge: () => maintenant, dossierPauses: DOSSIER_PAUSES_BANC, ...o }));
    const essayer = async f => { try { await f(); return null; } catch (e) { return e; } };

    let tr = reseau(normal), c = client(tr, null);
    let err = await essayer(() => c.index(1, 1));
    verifier('garde fermée : sans verrou global lié, aucune requête', [/verrou/.test(err?.message || ''), tr.appels.length], [true, 0]);
    tr = reseau(normal); c = client(tr, { tenu: false, perdu: false });
    err = await essayer(() => c.index(1, 1));
    verifier('garde fermée : un verrou non tenu ne suffit pas', [/verrou/.test(err?.message || ''), tr.appels.length], [true, 0]);
    tr = reseau(normal); c = client(tr, { tenu: true, perdu: true });
    err = await essayer(() => c.image(E.kricketune.img));
    verifier('garde fermée : un verrou PERDU en cours de route arrête tout', [/PERDU/.test(err?.message || ''), tr.appels.length], [true, 0]);
    tr = reseau(normal); c = client(tr);
    for (const u of ['https://autre.example/wp-content/uploads/2024/11/a.png', 'http://cdn6966.templcdn.com/wp-content/uploads/2024/11/a.png', 'https://cdn6966.templcdn.com.evil.example/wp-content/uploads/2024/11/a.png', 'https://cdn6966.templcdn.com/wp-content/uploads/../../etc/passwd', 'https://cdn6966.templcdn.com/wp-content/uploads/2024/11/a.png?x=1', 'https://cdn6966.templcdn.com/wp-content/uploads/2024/11/a.svg', 'https://cdn6966.templcdn.com/wp-admin/x.png', 'https://user:pw@cdn6966.templcdn.com/wp-content/uploads/2024/11/a.png']) {
        err = await essayer(() => c.image(u));
        verifier(`image : hôte et chemin énumérés — refusé sans requête (${u.slice(8, 60)})`, [!!err, tr.appels.length], [true, 0]);
    }
    for (const u of ['https://pokumon.com/wp-json/wp/v2/users', 'https://pokumon.com/wp-admin/admin-ajax.php', 'https://pokumon.com/wp-json/wp/v2/card/75661', 'https://pokumon.com/wp-json/wp/v2/card?search=x', 'https://pokumon.com/wp-json/wp/v2/card?release_event=1&per_page=100&page=1&_embed=wp:featuredmedia&_fields=id']) {
        err = await essayer(() => c.brut(u));
        verifier(`index : un chemin ou des paramètres hors liste sont refusés sans requête (${u.slice(20, 80)})`, [!!err, tr.appels.length], [true, 0]);
    }
    verifier('urlIndex : l\'adresse exacte, par série (événement 7720 pour S1), 100 par page, ordre TOTAL par identifiant (un ordre par date saute des entrées d\'une page à l\'autre), l\'image à la une incluse', P.urlIndex(1, 2),
        'https://pokumon.com/wp-json/wp/v2/card?release_event=7720&per_page=100&page=2&orderby=id&order=asc&_embed=wp:featuredmedia&_fields=id,title,slug,link,release_event,promo_set,language,_links,_embedded');
    err = await essayer(() => P.urlIndex(5, 1));
    verifier('urlIndex : une série hors S1-S4 ne se construit pas', !!err, true);
    const r1 = await c.index(1, 1);
    verifier('index : robots.txt de pokumon.com lu avant la première requête, puis la liste (entrées lues, pages annoncées)', [tr.appels.map(u => u.replace('https://pokumon.com', '')).map(u => u.slice(0, 30)), r1.entrees.length, r1.pages], [['/robots.txt', '/wp-json/wp/v2/card?release_ev'], 2, 1]);
    const b1 = await c.image(E.kricketune.img);
    verifier('image : robots.txt de l\'hôte d\'images lu à son tour (deux hôtes, deux robots), puis l\'image', [tr.appels.filter(u => /robots/.test(u)).length, tr.appels.filter(u => /robots/.test(u)).map(u => new URL(u).host), Buffer.isBuffer(b1)], [2, ['pokumon.com', 'cdn6966.templcdn.com'], true]);
    tr = reseau((u, o) => /robots/.test(u) ? { status: 200, texte: ROBOTS } : { status: 404, type: 'text/html' }); c = client(tr);
    verifier('image : un 404 rend null', await c.image(`${CDN}/2024/11/introuvable.png`), null);
    tr = reseau(normal); c = client(tr);
    attentes.length = 0; await c.index(1, 1); await c.index(2, 1); await c.image(E.kricketune.img);
    verifier('cadence : jamais moins de 5 s entre deux requêtes, 5 s par défaut', [attentes.length > 0 && attentes.every(ms => ms >= 5000 || ms === 0), P.CADENCE_MS, P.CADENCE_MIN_MS], [true, 5000, 5000]);
    verifier('cadence : un réglage plus rapide est relevé à 5 s', client(reseau(normal), verrou, { cadenceMs: 0 }).cadence(), 5000);
    tr = reseau(url => /robots/.test(url) ? { status: 200, texte: 'User-agent: *\nCrawl-delay: 12\n' } : normal(url)); c = client(tr);
    await c.index(1, 1);
    verifier('un Crawl-delay de robots.txt relève la cadence', c.cadence(), 12000);
    tr = reseau(url => /robots/.test(url) ? { status: 200, texte: 'User-agent: *\nCrawl-delay: 600\n' } : normal(url)); c = client(tr);
    err = await essayer(() => c.index(1, 1));
    verifier('un Crawl-delay déraisonnable arrête le client', [!!err?.bloque, tr.appels.length], [true, 1]);

    for (const [nom, rep] of [['403', () => ({ status: 403, type: 'text/html', texte: 'non' })], ['429', () => ({ status: 429, type: 'text/html', texte: 'non' })], ['cf-mitigated', () => ({ status: 200, type: 'text/html', texte: 'x', cfMitigated: 'challenge' })], ['page de défi', () => ({ status: 200, type: 'text/html', texte: '<title>Just a moment...</title>' })]]) {
        tr = reseau(url => /robots/.test(url) ? { status: 200, texte: '' } : rep()); c = client(tr);
        const e1 = await essayer(() => c.index(1, 1)), avant = tr.appels.length;
        const e2 = await essayer(() => c.image(E.kricketune.img));
        verifier(`défi (${nom}) : le client est BLOQUÉ, et plus aucune requête ne part (ni index, ni image)`, [!!e1?.bloque, !!e2?.bloque, tr.appels.length === avant], [true, true, true]);
    }
    tr = reseau(url => /robots/.test(url) ? { status: 200, texte: '' } : { status: 302, location: 'https://autre.example/x.png' }); c = client(tr);
    err = await essayer(() => c.image(E.kricketune.img));
    verifier('redirection vers un autre hôte : JAMAIS suivie (une seule requête d\'image)', [/redirection/.test(err?.message || ''), tr.appels.filter(u => !/robots/.test(u)).length], [true, 1]);
    tr = reseau(url => /robots/.test(url) ? { status: 200, texte: '' } : { status: 301, location: `${CDN}/2024/11/ailleurs.png` }); c = client(tr);
    err = await essayer(() => c.image(E.kricketune.img));
    verifier('redirection vers le MÊME hôte : non suivie non plus (une seule requête d\'image, aucune seconde adresse)', [/redirection/.test(err?.message || ''), tr.appels.filter(u => !/robots/.test(u)).length], [true, 1]);
    // ── REPONSE-HOTE : la règle commune de réponse, au niveau du client ────────────────────────────────────────────────────────────
    const PAGE_INTROUVABLE = { status: 200, type: 'text/html; charset=utf-8', texte: '<html><body>Page introuvable</body></html>' };
    tr = reseau(url => /robots/.test(url) ? { status: 200, texte: '' } : PAGE_INTROUVABLE); c = client(tr);
    verifier('REPONSE-HOTE : 200 text/html sans marqueur = fausse page introuvable → image absente (null), le client n\'est NI bloqué NI en pause', [await c.image(E.kricketune.img), !!c.bloque(), !!c.pause(), c.suivi().rapport('cdn6966.templcdn.com').fausses], [null, false, false, 1]);
    tr = reseau(url => /robots/.test(url) ? { status: 200, texte: '' } : PAGE_INTROUVABLE); c = client(tr, verrou, { plafond: 400 });
    let nul = 0; for (let i = 0; i < 20; i++) if ((await c.image(`${CDN}/2024/11/a${i}.png`)) === null) nul++;
    verifier('REPONSE-HOTE : 20 fausses absences d\'affilée → on continue (20 null, pas de pause)', [nul, !!c.pause()], [20, false]);
    err = await essayer(() => c.image(`${CDN}/2024/11/a21.png`));
    const avant21 = tr.appels.length;
    const err2 = await essayer(() => c.image(`${CDN}/2024/11/a22.png`));
    verifier('REPONSE-HOTE : la 21e → PAUSE (pas un arrêt définitif : bloque() reste nul), et plus aucune requête ensuite', [!!err?.pauseHote, !!err?.bloque, c.bloque(), !!err2?.pauseHote, tr.appels.length === avant21, c.suivi().rapport('cdn6966.templcdn.com').pause, err?.issue], [true, false, null, true, true, true, 'fausse-absente']);
    tr = reseau(url => /robots/.test(url) ? { status: 200, texte: '' } : (new URL(url).pathname.endsWith('/image.png') ? { status: 200, type: 'image/png', octets: PNG_BANC } : PAGE_INTROUVABLE)); c = client(tr, verrou, { plafond: 400 });
    for (let i = 0; i < 20; i++) await c.image(`${CDN}/2024/11/a${i}.png`);
    await c.image(`${CDN}/2024/11/image.png`);
    verifier('REPONSE-HOTE : une image remet le compteur à zéro (20 fausses + image + 20 fausses → pas de pause)', await (async () => { for (let i = 0; i < 20; i++) await c.image(`${CDN}/2024/11/b${i}.png`); return !!c.pause(); })(), false);
    tr = reseau(url => /robots/.test(url) ? { status: 200, texte: '' } : (/introuvable/.test(url) ? { status: 404, type: 'text/html' } : PAGE_INTROUVABLE)); c = client(tr, verrou, { plafond: 400 });
    for (let i = 0; i < 20; i++) await c.image(`${CDN}/2024/11/a${i}.png`);
    for (let i = 0; i < 5; i++) await c.image(`${CDN}/2024/11/introuvable${i}.png`);
    err = await essayer(() => c.image(`${CDN}/2024/11/z.png`));
    verifier('REPONSE-HOTE : un vrai 404 ne remet pas le compteur à zéro (la 21e fausse, 404 entre-temps, met en pause)', [!!err?.pauseHote], [true]);
    const menuGym = '<html><nav>Gym Heroes · Gym Challenge</nav><p>Page introuvable</p></html>';
    const pGym = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'pk-pauses-gym-'));      // la pause persistante du scénario ne déborde pas sur les suivants
    tr = reseau(url => /robots/.test(url) ? { status: 200, texte: '' } : { status: 200, type: 'text/html', texte: menuGym }); c = client(tr, verrou, { dossierPauses: pGym });
    err = await essayer(() => c.image(E.kricketune.img));
    const nAvant = tr.appels.length;
    const cPasse2 = client(tr, verrou, { dossierPauses: pGym });
    const err3 = await essayer(() => cPasse2.image(E.kricketune.img));
    verifier('REPONSE-HOTE : « Gym Challenge » dans une page introuvable = ambiguë → PAUSE PERSISTANTE (fichier daté qui nomme l\'empreinte), PAS un blocage', [!!err?.pauseHote, !!err?.pausePersistante, !!err?.bloque, c.bloque(), require('fs').existsSync(err?.fichier || ''), /^[0-9a-f]{64}$/.test(err?.empreinte || '')], [true, true, false, null, true, true]);
    verifier('REPONSE-HOTE : …et un AUTRE client (une autre passe) ne part pas non plus tant que la pause tient : aucune requête', [!!err3?.pauseHote, tr.appels.length === nAvant], [true, true]);
    const pDossier = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'pk-pauses2-'));
    tr = reseau(url => /robots/.test(url) ? { status: 200, texte: '' } : { status: 200, type: 'text/html', texte: menuGym }); c = client(tr, verrou, { dossierPauses: pDossier, connues: [require('crypto').createHash('sha256').update(menuGym).digest('hex')] });
    verifier('REPONSE-HOTE : l\'empreinte déclarée « page introuvable connue » vaut fausse absence (null), plus de pause', [await c.image(E.kricketune.img), !!c.pause()], [null, false]);
    for (const [nom, rep] of [['410 (image)', { status: 410, type: 'text/html', texte: 'gone' }], ['401', { status: 401, type: 'text/html', texte: 'login' }]]) {
        tr = reseau(url => /robots/.test(url) ? { status: 200, texte: '' } : rep); c = client(tr);
        err = await essayer(() => c.image(E.kricketune.img));
        verifier(`REPONSE-HOTE : ${nom} = défi → client BLOQUÉ (arrêt définitif), plus aucune requête`, [!!err?.bloque, !!c.bloque()], [true, true]);
    }
    tr = reseau(url => /robots/.test(url) ? { status: 200, texte: '' } : { status: 200, type: 'application/json', texte: '{}' }); c = client(tr);
    err = await essayer(() => c.image(E.kricketune.img));
    verifier('REPONSE-HOTE : 200 JSON pour une image = inattendue → PAUSE de la passe (pas de blocage)', [!!err?.pauseHote, !!err?.bloque, err?.issue], [true, false, 'inattendue']);
    // I3 (correction 1) : le suivi vit pour le PROCESSUS — une SECONDE unité (un second client, le registre par défaut) ne fait AUCUNE requête après la pause de la première
    tr = reseau(url => /robots/.test(url) ? { status: 200, texte: '' } : { status: 200, type: 'application/json', texte: '{}' }); c = client(tr);
    err = await essayer(() => c.image(E.kricketune.img));
    { const tr2 = reseau(normal), c2 = client(tr2, verrou, { processus: true }); const e2 = await essayer(() => c2.image(E.kricketune.img));
      verifier('I3 pokumon : deux unités de suite — la seconde, après la pause de la première, ne fait AUCUNE requête', [!!err?.pauseHote, !!e2?.pauseHote, tr2.appels.length], [true, true, 0]); }
    tr = reseau(url => /robots/.test(url) ? { status: 200, texte: '' } : { status: 200, type: 'image/png', octets: Buffer.from('ceci n\'est pas une image') }); c = client(tr);
    err = await essayer(() => c.image(E.kricketune.img));
    verifier('REPONSE-HOTE : 200 image/png aux octets faux = inattendue → pause', [!!err?.pauseHote, err?.issue], [true, 'inattendue']);
    tr = reseau(url => /robots/.test(url) ? { status: 200, texte: '' } : { status: 200, type: 'image/png', octets: PNG_BANC, cfMitigated: 'challenge' }); c = client(tr);
    err = await essayer(() => c.image(E.kricketune.img));
    verifier('REPONSE-HOTE : cf-mitigated sur une image = défi → BLOQUÉ', [!!err?.bloque], [true]);
    tr = reseau(url => /robots/.test(url) ? { status: 200, texte: '' } : { status: 200, type: 'text/html', texte: '<div class="g-recaptcha"></div>' }); c = client(tr);
    err = await essayer(() => c.image(E.kricketune.img));
    verifier('REPONSE-HOTE : un captcha dans une page à la place de l\'image = défi → BLOQUÉ', [!!err?.bloque], [true]);

    tr = reseau(url => /robots/.test(url) ? { status: 200, texte: 'User-agent: *\nDisallow: /wp-content/\n' } : normal(url)); c = client(tr);
    err = await essayer(() => c.image(E.kricketune.img));
    verifier('robots.txt respecté : un chemin interdit ne part pas', [/robots/.test(err?.message || ''), tr.appels.filter(u => !/robots/.test(u)).length], [true, 0]);
    // le robots.txt de l'HÔTE D'IMAGES se lit et se respecte à part : pokumon.com autorise, le CDN interdit tout (cas relevé chez malie.io le 2026-10-17)
    tr = reseau(url => /robots/.test(url) ? { status: 200, texte: new URL(url).host === 'cdn6966.templcdn.com' ? 'User-agent: *\nDisallow: /\n' : ROBOTS } : normal(url)); c = client(tr);
    const li = await c.index(1, 1);
    err = await essayer(() => c.image(E.kricketune.img));
    verifier('robots.txt de l\'hôte d\'images interdit tout (pokumon.com autorise) : la liste passe, AUCUNE image ne part, le client n\'est pas bloqué', [li.entrees.length, /robots/.test(err?.message || ''), tr.appels.filter(u => /\.(png|jpg)$/.test(u)).length, tr.appels.filter(u => /robots/.test(u)).map(u => new URL(u).host)], [2, true, 0, ['pokumon.com', 'cdn6966.templcdn.com']]);
    tr = reseau(url => /robots/.test(url) ? { status: 200, texte: new URL(url).host === 'pokumon.com' ? 'User-agent: *\nDisallow: /wp-json/\n' : '' } : normal(url)); c = client(tr);
    err = await essayer(() => c.index(1, 1));
    verifier('robots.txt de pokumon.com interdit wp-json : aucune liste ne part', [/robots/.test(err?.message || ''), tr.appels.filter(u => /wp-json/.test(u)).length], [true, 0]);
    tr = reseau(url => /robots/.test(url) ? { status: 500, type: 'text/html', texte: '' } : normal(url)); c = client(tr);
    err = await essayer(() => c.image(E.kricketune.img));
    verifier('robots.txt illisible (500 deux fois) : on ne peut pas conclure, aucune image', [!!err, tr.appels.filter(u => !/robots/.test(u)).length], [true, 0]);
    let n5 = 0;
    tr = reseau(url => /robots/.test(url) ? { status: 200, texte: '' } : (n5++ === 0 ? { status: 503, type: 'text/html', texte: 'surcharge' } : normal(url))); c = client(tr);
    attentes.length = 0; const b5 = await c.image(E.kricketune.img);
    verifier('un 503 : UN réessai après la pause de reprise, puis l\'image', [Buffer.isBuffer(b5), tr.appels.filter(u => !/robots/.test(u)).length, attentes.includes(P.REESSAI_MS)], [true, 2, true]);
    tr = reseau(url => /robots/.test(url) ? { status: 200, texte: '' } : { status: 503, type: 'text/html', texte: 'surcharge' }); c = client(tr);
    err = await essayer(() => c.image(E.kricketune.img));
    verifier('deux 503 : l\'échec LÈVE (jamais une boucle), exactement deux requêtes d\'image, le client n\'est pas bloqué', [!!err, !!err?.bloque, tr.appels.filter(u => !/robots/.test(u)).length], [true, false, 2]);
    let nr = 0;
    tr = reseau(url => /robots/.test(url) ? { status: 200, texte: '' } : (nr++ === 0 ? (() => { throw Object.assign(new Error('ECONNRESET'), { reseau: true }); })() : normal(url))); c = client(tr);
    verifier('une coupure réseau : UN réessai, puis l\'image', [Buffer.isBuffer(await c.image(E.kricketune.img))], [true]);
    tr = reseau(normal); c = client(tr, verrou, { plafond: 4 });
    await c.index(1, 1); await c.image(E.kricketune.img);
    err = await essayer(() => c.index(2, 1));
    verifier('plafond de requêtes : robots ×2 + une liste + une image = 4 requêtes, la cinquième au-delà du plafond de 4 LÈVE', [/plafond/.test(err?.message || ''), c.compteRequetes(), tr.appels.length], [true, 4, 4]);
    verifier('plafond par défaut : 120', P.PLAFOND_REQUETES, 120);
    // le cache de l'index : la reprise ne redemande rien
    const stock = new Map();
    const cache = { lire: k => stock.get(k) ?? null, ecrire: (k, v) => stock.set(k, v) };
    tr = reseau(normal); c = client(tr, verrou, { cache });
    await c.index(1, 1); const nApres1 = tr.appels.length;
    const c2 = client(tr, verrou, { cache });
    const rr = await c2.index(1, 1);
    verifier('cache de l\'index : la seconde lecture de la même page ne fait AUCUNE requête (reprise)', [tr.appels.length === nApres1, rr.entrees.length, rr.depuisCache], [true, 2, true]);

    // ── 6. LA RÈGLE DU SITE : l'image propre l'emporte sur le substitut, et le substitut ne la masque jamais ─────────────────
    const SITE = await P.chargerRegleDuSite(process.env.RACINE_SITE || 'C:/Users/Yung/Desktop/pokemon-proxy');
    const SUBST = { visuelSubstitut: { cleR2: 'tcgdex/Battle-Styles/006-261000.webp', w: 600, h: 825, mention: 'Visuel de la carte d\'origine, sans le tampon Prize Pack' } };
    const entreePropre = { set: SLUG1, source: 'pokumon', cleR2: 'pokumon/Play-Pokemon-Prize-Pack-Series-One/006-100-en.webp', w: 700, h: 980, numero: '006', langue: 'en', languePreuve: 'x', lot: P.LOT, mention: P.MENTION };
    const BASE = 'https://img.example';
    const sans = P.visuelServi(SITE, { set: SLUG1,images: [], numeroFiche: null, region: 'intl', produits: [SUBST], baseUrlImages: BASE });
    verifier('règle du site : une fiche sans image propre sert le SUBSTITUT, avec sa mention', [sans.genre, sans.substitut?.url, /sans le tampon/.test(sans.substitut?.mention)], ['substitut', `${BASE}/tcgdex/Battle-Styles/006-261000.webp`, true]);
    const avec = P.visuelServi(SITE, { set: SLUG1,images: [entreePropre], numeroFiche: null, region: 'intl', produits: [SUBST], baseUrlImages: BASE });
    verifier('règle du site : dès que l\'image propre est posée, elle est servie et le substitut CESSE d\'être affiché (sans détacher quoi que ce soit)', [avec.genre, avec.propre?.cleR2, avec.substitut], ['propre', entreePropre.cleR2, null]);
    const retire = P.visuelServi(SITE, { set: SLUG1,images: [], numeroFiche: null, region: 'intl', produits: [SUBST], baseUrlImages: BASE });
    verifier('retrait du lot : sans l\'image propre le substitut REVIENT (le retrait est réversible, parce que le substitut n\'a pas été détaché)', retire.genre, 'substitut');
    const autreSet = P.visuelServi(SITE, { set: SLUG1,images: [{ ...entreePropre, set: 'Battle-Styles' }], numeroFiche: null, region: 'intl', produits: [SUBST], baseUrlImages: BASE });
    verifier('l\'image d\'un autre set n\'est pas celle de la fiche : le substitut reste', autreSet.genre, 'substitut');
    const sansLangue = P.visuelServi(SITE, { set: SLUG1,images: [{ ...entreePropre, langue: null, languePreuve: null }], numeroFiche: null, region: 'intl', produits: [SUBST], baseUrlImages: BASE });
    verifier('la garde de langue du site s\'applique : une entrée sans langue écrite ne passe pas pour propre (le substitut reste)', sansLangue.genre, 'substitut');
    const faux = P.visuelServi(SITE, { set: SLUG1,images: [{ ...entreePropre, numero: '099' }], numeroFiche: '006', region: 'intl', produits: [SUBST], baseUrlImages: BASE });
    verifier('une fiche NUMÉROTÉE ne reçoit pas l\'image d\'un autre numéro : le substitut reste (le visuel absent est honnête)', faux.genre, 'substitut');
    const rien = P.visuelServi(SITE, { set: SLUG1,images: [], numeroFiche: null, region: 'intl', produits: [{}], baseUrlImages: BASE });
    verifier('ni image ni substitut : rien', rien.genre, null);

    // ── 7. la langue du visuel : la règle de pokumon est écrite par ce qu'elle autorise ─────────────────────────────────────────────────────────────
    const { langueDuVisuel } = require(path.join(DIR, 'collecte-cartes', 'langue-visuel.js'));
    verifier('langue du visuel : « pokumon » + langueSource « en » = anglais avec sa preuve ; sans langueSource, ou une autre, aucune règle (null)',
        [langueDuVisuel({ source: 'pokumon', langueSource: 'en' }), langueDuVisuel({ source: 'pokumon' }).langue, langueDuVisuel({ source: 'pokumon', langueSource: 'ja' }).langue].map((x, i) => i ? x : [x.langue, /English/.test(x.preuve)]), [['en', true], null, null]);
    verifier('le plafond d\'une collecte écrite se relève dans les bornes (jamais sous ce qui est parti, jamais au-delà de 400)', await (async () => { const c = P.fabriquerClientPokumon({ transport: reseau(normal), verrou, pause, horloge: () => maintenant }); await c.index(1, 1); const r = []; for (const n of [150, 400, 401, 1]) { try { c.fixerPlafond(n); r.push(c.plafond()); } catch { r.push('refusé'); } } return r; })(), [150, 400, 'refusé', 'refusé']);

    console.log(`\n${ko ? '❌' : '✅'} ${ok} passés, ${ko} en échec`);
    process.exit(ko ? 1 : 0);
})().catch(e => { console.error('❌ le banc a levé :', e.message); process.exit(1); });
