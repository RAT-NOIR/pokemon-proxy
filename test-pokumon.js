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
    verifier('holo et non-holo non séparables (V1/V2 contre deux entrées) : TROU, nommé', A.resultats.map(r => [r.verdict, r.motif]), [['reste', 'douteux-variantes-non-separables'], ['reste', 'douteux-variantes-non-separables']]);
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

    // ── 5. le CLIENT : garde fermée, hôtes et chemins énumérés, cadence, réessai, plafond, arrêt au premier blocage ───────────────
    const reseau = repondre => { const appels = []; return { appels, async get(url, o) { appels.push(url); return repondre(url, o); } }; };
    const ROBOTS = 'User-agent: *\nDisallow: /wp-admin/\nAllow: /wp-admin/admin-ajax.php\n';
    const JSON_INDEX = JSON.stringify([RAW.kricketune, RAW.cherrim]);
    const normal = (url, o) => /\/robots\.txt$/.test(url) ? { status: 200, texte: ROBOTS }
        : /wp-json\/wp\/v2\/card/.test(url) ? { status: 200, type: 'application/json; charset=UTF-8', texte: JSON_INDEX, pages: 1 }
            : /\.(png|jpg)$/.test(url) ? { status: 200, type: 'image/png', octets: Buffer.from('PNG') } : { status: 404, type: 'text/html' };
    const verrou = { tenu: true, perdu: false };
    const attentes = [];
    let maintenant = 1e12;                                          // l'horloge du banc ne bouge que par les pauses : la cadence se mesure exactement
    const pause = async ms => { attentes.push(ms); maintenant += ms; };
    const client = (tr, v = verrou, o = {}) => P.fabriquerClientPokumon({ transport: tr, verrou: v, pause, horloge: () => maintenant, ...o });
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
