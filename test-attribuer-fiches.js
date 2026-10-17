// BANC — attribuer-fiches.js : l'attribution des produits sans fiche par set + numéro + nom (lot FICHES, 2026-10-17).
//   node test-attribuer-fiches.js
// Chaque condition (a) set, (b) numéro, (c) nom, (d) unicité fait dire NON sur un cas FABRIQUÉ ; idempotence ; retrait exact ; --attendu.
// Aucun réseau, aucune vraie base : les cartes sont fabriquées, la base d'écriture est celle du banc (mémoire).
const { preparerSet, calibrer, MOTIFS } = require('./collecte-cartes/regle-attribution-fiches');
const A = require('./attribuer-fiches');
const { ouvrirBanc } = require('./collecte-cartes/base-banc');
let ok = 0, ko = 0;
const verifier = (quoi, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`  ✅ ${quoi}`); } else { ko++; console.log(`  ❌ ${quoi}\n     obtenu  ${a}\n     attendu ${b}`); }
};
const { decomposerNomCardmarket } = require('./collecte-cartes/jointure');

const SET = { _id: 'Le-Set', idExpansion: 9, tirage: 'intl', code: 'LS', bulba: { expansion: 'Le Set' } };
const imp = (numero, expansion = 'Le Set') => ({ tirage: 'intl', expansion, numero, total: null });
const carte = (id, nomEn, numeros, extra = {}) => ({ _id: id, nomEn, niveau: null, attaques: [{ nom: 'Tackle' }], impressions: numeros.map(n => imp(n)), sets: ['Le-Set'], liens: { idProduct: [1], idMetacards: [500] }, ...extra });
const produit = (idProduct, name, numero, slug = null, extra = {}) => ({ idProduct, idExpansion: 9, idMetacard: 700 + idProduct, name, numero, slug, slugSet: 'Le-Set', ...extra });
const ligne = (carteId, idProduct, numeroFiche = null, extra = {}) => ({ _id: `${carteId}|${idProduct}`, carteId, idProduct, idExpansion: 9, slugSet: 'Le-Set', tirage: 'intl', numeroFiche, preuve: 'set+numero', ...extra });
const plan = (cartes, produits, lignes, ids, extra = {}) => preparerSet({ set: SET, cartes, produits, lignes, segmentDuSlug: extra.segmentDuSlug, estAdditionals: extra.estAdditionals }).evaluerCibles(ids);
const motifs = r => r.doutes.map(d => d.motif);

// ── le cas de base : set + numéro + nom concordants, une seule candidate → SÛR, ligne neuve au numéro de l'impression
const pika = carte(10, 'Pikachu', ['5', '60']);
const rai = carte(11, 'Raichu', ['6']);
const base = plan([pika, rai], [produit(100, 'Pikachu [Tackle]', '5')], [], [100]);
verifier('base : numéro 5 + nom Pikachu → un cas sûr, ligne neuve, numeroFiche = le numéro de l\'impression', base.surs.map(s => [s.idProduct, s.carteId, s.action, s.numeroFiche, s.preuve]), [[100, 10, 'ligne-neuve', '5', 'set+numero+nom']]);
verifier('base : le motif est vide, aucun doute', base.doutes.length, 0);

// ── (a) LE SET
verifier('(a) l\'idExpansion du produit n\'est pas celle du set → doute « set-inconnu »', motifs(plan([pika], [produit(101, 'Pikachu', '5', null, { idExpansion: 99 })], [], [101])), ['set-inconnu']);
verifier('(a) le slugSet appris du produit nomme un AUTRE set → doute « set-inconnu »', motifs(plan([pika], [produit(102, 'Pikachu', '5', null, { slugSet: 'Un-Autre-Set' })], [], [102])), ['set-inconnu']);
verifier('(a) la carte n\'a une impression qu\'AILLEURS (autre expansion) → le set n\'a aucune carte à impression : « set-sans-impression »', motifs(plan([{ ...pika, impressions: [imp('5', 'Autre Extension')] }], [produit(103, 'Pikachu', '5')], [], [103])), ['set-sans-impression']);
verifier('(a) un set Additionals n\'est pas attribué (le site ne l\'affiche pas) → « set-additionals »', motifs(plan([pika], [produit(104, 'Pikachu', '5')], [], [104], { estAdditionals: id => id === 'Le-Set' })), ['set-additionals']);

// ── (b) LE NUMÉRO
verifier('(b) produit sans numéro et slug sans segment → « produit-sans-numero »', motifs(plan([pika], [produit(110, 'Pikachu', null)], [], [110])), ['produit-sans-numero']);
verifier('(b) le numéro du produit n\'est celui d\'aucune impression du set → « numero-absent »', motifs(plan([pika, rai], [produit(111, 'Pikachu', '7')], [], [111])), ['numero-absent']);
verifier('(b) le numéro absent mais le NOM est connu sous un autre numéro : le détail le dit (pas de ligne)', plan([pika], [produit(112, 'Pikachu', '7')], [], [112]).doutes[0].detail.includes('Pikachu') , true);
verifier('(b) numéro lu par le slug (fonction du SITE injectée) quand numeros_cartes n\'en porte pas → sûr', plan([pika], [produit(113, 'Pikachu', null, 'Pikachu-LS5')], [], [113], { segmentDuSlug: (slug, code) => (slug === 'Pikachu-LS5' && code === 'LS' ? '5' : null) }).surs.map(s => s.numeroFiche), ['5']);
verifier('(b) numéro suffixé « 5a » absent des impressions : variante tamponnée possible, pas de numeroFiche (M2) → « variante-suffixee »', motifs(plan([pika], [produit(114, 'Pikachu', '5a')], [], [114])), ['variante-suffixee']);
verifier('(b) deux impressions de la carte portent la même clé sous deux écritures (« 005 » et « 5 ») → numéro ambigu', motifs(plan([carte(12, 'Pichu', ['005', '5'])], [produit(115, 'Pichu', '5')], [], [115])), ['numero-ambigu']);
verifier('(b) le préfixe COMMUN à toutes les impressions du set se retire (« SM18 » ↔ « 18 »), comme joindre()', plan([carte(13, 'Alolan Sandslash', ['SM18', 'SM19'])], [produit(116, 'Alolan Sandslash [Tackle]', '18')], [], [116]).surs.map(s => s.numeroFiche), ['SM18']);
verifier('(b) un préfixe NON commun (« SM18 » et « 19 ») ne se retire pas → « numero-absent »', motifs(plan([carte(13, 'Alolan Sandslash', ['SM18', '19'])], [produit(116, 'Alolan Sandslash', '18')], [], [116])), ['numero-absent']);

// ── (c) LE NOM — le témoin de joindre() et une concordance POSITIVE
verifier('(c) le nom du produit est celui d\'une AUTRE carte du set (Raichu au n°5) → « nom-contredit » (témoin de joindre())', motifs(plan([pika, rai], [produit(120, 'Raichu [Tackle]', '5')], [], [120])), ['nom-contredit']);
verifier('(c) un nom qui ne désigne AUCUNE carte du set : le témoin se tait mais rien ne confirme → « nom-non-confirme »', motifs(plan([pika], [produit(121, 'Mystery Plate alpha', '5')], [], [121])), ['nom-non-confirme']);
verifier('(c) « Basic Fire Energy » (Bulbapedia) ↔ « Fire Energy » (Cardmarket) concordent par les clés de la production', plan([carte(14, 'Basic Fire Energy', ['9'])], [produit(122, 'Fire Energy', '9')], [], [122]).surs.length, 1);
verifier('(c) les attaques départagent comme dans joindre() : « Vulpix [Gather Snow] » désigne Alolan Vulpix au n°10, le nom étant celui d\'une autre carte', (() => {
    const alo = carte(15, 'Alolan Vulpix', ['10'], { attaques: [{ nom: 'Snow Gather' }] }), vul = carte(16, 'Vulpix', ['11'], { attaques: [{ nom: 'Confuse Ray' }] });
    return plan([alo, vul], [produit(123, 'Vulpix [Gather Snow]', '10')], [], [123]).surs.length + plan([alo, vul], [produit(123, 'Vulpix [Gather Snow]', '10')], [], [123]).doutes.length;
})(), 1);
verifier('(c) l\'alias de la PRODUCTION compte (aliasDe) : le nom Cardmarket « EXP. ALL » ↔ « Exp. Share »', plan([carte(17, 'Exp. Share', ['3'])], [produit(124, 'EXP. ALL', '3')], [], [124]).surs.length, 1);

// ── (d) L'UNICITÉ
verifier('(d) deux cartes du set portent le même numéro ET le même nom → « deux-candidates »', motifs(plan([carte(20, 'Eevee', ['8']), carte(21, 'Eevee', ['8'])], [produit(130, 'Eevee', '8')], [], [130])), ['deux-candidates']);
verifier('(d) deux cartes au même numéro mais de noms différents : le NOM départage → un seul cas sûr (EC1 n°059)', plan([carte(22, 'Energy Restore', ['59']), carte(23, 'Pokemon Reversal', ['59'])], [produit(131, 'Energy Restore', '59')], [], [131]).surs.map(s => s.carteId), [22]);
verifier('(d) un AUTRE produit, déjà attaché à la même carte au même numéro, sans être sa version V → « deux-produits-revendiquent »', motifs(plan([pika], [produit(132, 'Pikachu', '5', 'Pikachu-LS5'), produit(133, 'Pikachu', '5', 'Pikachu-Promo-LS5')], [ligne(10, 133, '5')], [132])), ['deux-produits-revendiquent']);
verifier('(d) la V2 d\'une fiche dont la V1 est déjà reconnue (même carte, même base de slug) → SÛR', plan([pika], [produit(134, 'Pikachu', '5', 'Pikachu-V1-LS5'), produit(135, 'Pikachu', '5', 'Pikachu-V2-LS5')], [ligne(10, 134, '5')], [135]).surs.map(s => s.idProduct), [135]);
verifier('(d) la V1 écrite « Pikachu-LS5 » et la V2 « Pikachu-V2-LS05 » (graphie des zéros changée) restent deux versions d\'une même fiche → SÛR', plan([pika], [produit(190, 'Pikachu', '5', 'Pikachu-LS5'), produit(191, 'Pikachu', '5', 'Pikachu-V2-LS05')], [ligne(10, 190, '5')], [191]).surs.map(s => s.idProduct), [191]);
verifier('un doute porte les cartes dont le NOM concorde (indice de relecture, jamais une attribution)', plan([pika], [produit(192, 'Pikachu', '9')], [], [192]).doutes[0].candidats, [{ carteId: 10, nomEn: 'Pikachu', numeros: ['5', '60'] }]);
verifier('(d) deux produits NON attachés qui revendiquent la même (carte, numéro) → les DEUX en doute (aucune fiche déjà reconnue)', plan([pika], [produit(136, 'Pikachu', '5', 'Pikachu-V1-LS5'), produit(137, 'Pikachu', '5', 'Pikachu-V2-LS5')], [], [136, 137]).doutes.map(d => d.motif), ['deux-produits-revendiquent', 'deux-produits-revendiquent']);
verifier('(d) un produit au même numéro mais à un AUTRE nom ne revendique pas la carte (Hop et Potion, tous deux « C42 »)', plan([carte(24, 'Hop', ['C42'])], [produit(138, 'Hop', 'C42', 'Hop-V2-BA-C42'), produit(139, 'Potion', 'C42', 'Potion-BA-C42')], [], [138]).surs.length, 1);
verifier('(d) le produit a déjà une ligne sur une AUTRE carte que celle du numéro → « ligne-sur-une-autre-carte » (rien n\'est modifié)', motifs(plan([pika, rai], [produit(140, 'Pikachu', '5')], [ligne(11, 140, null)], [140])), ['ligne-sur-une-autre-carte']);
verifier('(d) un produit à DEUX lignes n\'est jamais touché → « plusieurs-lignes »', motifs(plan([pika, rai], [produit(141, 'Pikachu', '5')], [ligne(10, 141, null), ligne(11, 141, null)], [141])), ['plusieurs-lignes']);

// ── CORRECTION 1 (relecture) : « SM18 » et « 18 » sont DEUX ÉCRITURES du même numéro (cleNumero + préfixe commun du set, comme la jointure)
(function () {
    const SMS = { _id: 'SM-Black-Star-Promos', idExpansion: 1757, tirage: 'intl', code: 'SM', bulba: { expansion: 'SM Black Star Promos' } };
    const impS = n => ({ tirage: 'intl', expansion: 'SM Black Star Promos', numero: n, total: null });
    const c18 = { _id: 221206, nomEn: 'Alolan Sandslash', niveau: null, attaques: [{ nom: 'Smash Turn' }], impressions: [impS('SM18')], sets: [SMS._id], liens: {} };
    const c127 = { _id: 228226, nomEn: 'Alolan Sandslash', niveau: null, attaques: [{ nom: 'Metal Claw' }, { nom: 'Tumbling Attack' }], impressions: [impS('SM127')], sets: [SMS._id], liens: {} };
    const pS = (idProduct, name, numero, slug, slugSet) => ({ idProduct, idExpansion: 1757, idMetacard: 700 + idProduct, name, numero, slug, slugSet });
    const p297 = pS(297618, 'Alolan Sandslash [Slush Rush | Smash Turn]', '18', 'Alolan-Sandslash-SM18', SMS._id);
    const p358 = pS(358427, 'Alolan Sandslash [Metal Claw | Tumbling Attack]', 'SM18', null, null);
    const l297 = [{ _id: '221206|297618', carteId: 221206, idProduct: 297618, idExpansion: 1757, numeroFiche: 'SM18' }];
    const ev = (produits, lignes, id) => preparerSet({ set: SMS, cartes: [c18, c127], produits, lignes }).evaluer(id);
    // le revendiquant « SM18 » a ICI les attaques de la carte (sinon le témoin des attaques le refuserait avant la condition d) : seule la condition (d) peut dire non
    const pR = pS(358428, 'Alolan Sandslash [Slush Rush | Smash Turn]', 'SM18', null, null);
    verifier('(d) un produit écrit « SM18 » revendique la même (carte, numéro) que « 18 » (297618, attaché) : deux écritures du même numéro → « deux-produits-revendiquent »', ev([p297, pR], l297, 358428).motif, 'deux-produits-revendiquent');
    verifier('(d) symétrie : le produit « 18 » en cible, le revendiquant écrit « SM18 » → « deux-produits-revendiquent » aussi', ev([p297, pR], [], 297618).motif, 'deux-produits-revendiquent');
    verifier('(d) symétrie : les deux produits en cible, sans ligne → les DEUX en doute', preparerSet({ set: SMS, cartes: [c18, c127], produits: [p297, pR], lignes: [] }).evaluerCibles([297618, 358428]).doutes.map(d => d.motif), ['deux-produits-revendiquent', 'deux-produits-revendiquent']);
    verifier('LE CAS RÉEL : 358427 (numéro SM18, attaques de la SM127) avec 297618 attaché à 221206 → doute (jamais une fiche)', ev([p297, p358], l297, 358427).verdict, 'doute');
    verifier('(b) le produit écrit « SM127 » trouve l\'impression « SM127 » ; écrit « 127 », la même (préfixe commun) → même carte', [ev([pS(1, 'Alolan Sandslash [Metal Claw]', 'SM127', null, null)], [], 1).carteId, ev([pS(2, 'Alolan Sandslash [Metal Claw]', '127', null, null)], [], 2).carteId], [228226, 228226]);
    verifier('(d) sans revendiquant, un produit « SM18 » dont les attaques sont celles de la carte reste SÛR (la correction ne ferme pas tout)', ev([pS(300, 'Alolan Sandslash [Slush Rush | Smash Turn]', 'SM18', null, null)], [], 300).carteId, 221206);
    // TÉMOIN POSITIF DES ATTAQUES (défense en profondeur) : 358427 porte les attaques de la carte SM127 mais le numéro SM18 — le numéro ment, les attaques le disent
    verifier('(c) les attaques du produit (Metal Claw | Tumbling Attack) ne sont celles d\'AUCUNE attaque de la carte désignée par le numéro (Smash Turn) → « attaques-contredites »', ev([p358], [], 358427).motif, 'attaques-contredites');
    verifier('(c) « Gather Snow » / « Snow Gather » : l\'ordre des mots ne contredit pas (Cardmarket ≠ Bulbapedia) → SÛR', preparerSet({ set: SMS, cartes: [{ ...c18, attaques: [{ nom: 'Snow Gather' }] }], produits: [pS(301, 'Alolan Sandslash [Gather Snow]', 'SM18', null, null)], lignes: [] }).evaluer(301).verdict, 'sur');
})();

// ── le mode « numeroFiche » : la ligne existe (bonne carte), son numeroFiche est nul → il se POSE, rien d'autre
const mn = plan([pika], [produit(150, 'Pikachu', '5')], [ligne(10, 150, null)], [150]);
verifier('numeroFiche : ligne existante sur la bonne carte, numeroFiche nul → action « numeroFiche » au numéro de l\'impression', mn.surs.map(s => [s.action, s.carteId, s.numeroFiche]), [['numeroFiche', 10, '5']]);
verifier('numeroFiche : déjà posé → « numero-fiche-deja-pose », jamais réécrit', motifs(plan([pika], [produit(151, 'Pikachu', '5')], [ligne(10, 151, '5')], [151])), ['numero-fiche-deja-pose']);
verifier('une carte-code n\'est pas une carte → doute « carte-code »', motifs(plan([pika], [produit(152, 'Pikachu Online Code Card', '5')], [], [152])), ['carte-code']);

// ── l'appartenance au set (cartes.sets) : le cas sûr le dit, la ligne ne sera pas SERVIE sans elle
const horsSet = plan([{ ...pika, sets: [] }], [produit(160, 'Pikachu', '5')], [], [160]);
verifier('la carte déclare l\'impression mais n\'est pas membre du set : sûr, marqué « horsSet » (ligne écrite, non servie)', horsSet.surs.map(s => s.horsSet), [true]);

// ── idempotence : après application du plan, un second passage ne propose RIEN
const apres = [ligne(10, 100, '5')];
verifier('idempotence : le produit qui vient d\'être attribué n\'est plus un cas sûr (il a sa ligne et son numeroFiche)', plan([pika, rai], [produit(100, 'Pikachu [Tackle]', '5')], apres, [100]).surs.length, 0);

// ── la liste fermée des motifs : un motif émis qui n'y est pas = bogue
verifier('chaque doute émis porte un motif de la liste fermée', (() => {
    const rs = [plan([pika], [produit(1, 'X', null)], [], [1]), plan([pika], [produit(2, 'Pikachu', '9')], [], [2])];
    return rs.flatMap(r => r.doutes).every(d => MOTIFS.includes(d.motif));
})(), true);

// ── CALIBRATION : on cache la ligne juste, on rejoue, on compte justes / faux / muets
(function () {
    const cartes = [pika, rai, carte(25, 'Meowth', ['7'])];
    const produits = [produit(200, 'Pikachu', '5'), produit(201, 'Raichu', '6'), produit(202, 'Meowth', '7'), produit(203, 'Pikachu', '60')];
    const lignes = [ligne(10, 200, '5'), ligne(11, 201, '6'), ligne(25, 202, '7'), ligne(10, 203, '60')];
    const verite = new Map(lignes.map(l => [l.idProduct, [{ carteId: l.carteId, numeroFiche: l.numeroFiche }]]));
    const r = calibrer(preparerSet({ set: SET, cartes, produits, lignes }), [200, 201, 202, 203], verite);
    verifier('calibration : 4 lignes justes cachées puis rejouées → 4 justes, 0 faux, 0 muet', [r.justes, r.faux.length, r.muets], [4, 0, 0]);
    const faux = new Map(verite); faux.set(201, [{ carteId: 10, numeroFiche: '6' }]);
    const r2 = calibrer(preparerSet({ set: SET, cartes, produits, lignes }), [200, 201, 202, 203], faux);
    verifier('calibration : une vérité qui contredit la règle est comptée FAUSSE (la calibration sait dire non)', [r2.justes, r2.faux.length], [3, 1]);
    const r3 = calibrer(preparerSet({ set: SET, cartes: [pika], produits, lignes }), [200, 201, 202, 203], verite);
    verifier('calibration : sans la carte, le produit est MUET (jamais faux)', [r3.faux.length, r3.muets], [0, 2]);
    verifier('calibration : « X1 (Top Left) » et « X1 » sont le même numéro (la position n\'est pas le numéro)', (() => { const c2 = carte(26, 'Pieza', ['X1 (Top Left)']); const l2 = ligne(26, 204, 'X1'); return calibrer(preparerSet({ set: SET, cartes: [c2], produits: [produit(204, 'Pieza', 'X1')], lignes: [l2] }), [204], new Map([[204, [{ carteId: 26, numeroFiche: 'X1' }]]])).numeroFicheDifferent.length; })(), 0);
    verifier('calibration : le numeroFiche rejoué diffère de celui de la ligne → compté à part (numeroFicheDifferent)', (() => { const v = new Map(verite); v.set(200, [{ carteId: 10, numeroFiche: '60' }]); return calibrer(preparerSet({ set: SET, cartes, produits, lignes }), [200], v).numeroFicheDifferent.length; })(), 1);
})();

// ── CALIBRATION « VRAIE CARTE RETIRÉE » (§67) : sait-elle dire NON ? Une affirmation sans la vraie carte est un FAUX.
(function () {
    const { calibrerCarteRetiree } = require('./collecte-cartes/regle-attribution-fiches');
    const produits = [produit(300, 'Pikachu', '5'), produit(301, 'Raichu', '6')];
    const verite = new Map([[300, [{ carteId: 10 }]], [301, [{ carteId: 11 }]]]);
    const construireSur = cartesBase => (cs, ls) => preparerSet({ set: SET, cartes: cs, produits, lignes: ls });
    const sain = calibrerCarteRetiree({ construire: construireSur(), cartes: [pika, rai], lignes: [], ids: [300, 301], verite });
    verifier('retirée : sans leur vraie carte, 2 produits sur 2 sont MUETS, 0 faux', [sain.total, sain.faux.length, sain.muets], [2, 0, 2]);
    const homonyme = carte(31, 'Pikachu', ['5']);   // une AUTRE carte au même numéro et au même nom : la règle affirmerait la mauvaise
    const piege = calibrerCarteRetiree({ construire: construireSur(), cartes: [pika, rai, homonyme], lignes: [], ids: [300, 301], verite });
    verifier('retirée : une homonyme au même numéro fait AFFIRMER la mauvaise carte → comptée FAUSSE (la calibration sait dire non)', [piege.faux.map(f => [f.idProduct, f.rendu]), piege.muets], [[[300, 31]], 1]);
})();

// ── ÉCRITURE / RETRAIT sur la base du banc (mémoire) — additif, idempotent, retrait EXACT, --attendu
(async () => {
    const banc = await ouvrirBanc();
    const { MongoClient } = require('mongodb');
    const client = new MongoClient(banc.uri);
    try {
        await client.connect();
        const db = client.db('banc_attribuer_fiches');
        await db.collection('cartes').insertMany([{ _id: 10, nomEn: 'Pikachu', sets: ['Le-Set'], liens: { idProduct: [1, 2], idMetacards: [500] } }, { _id: 11, nomEn: 'Raichu', sets: ['Le-Set'], liens: { idProduct: [3], idMetacards: [501] } }]);
        await db.collection('cartes_produits').insertMany([{ _id: '11|300', carteId: 11, idProduct: 300, idExpansion: 9, slugSet: 'Le-Set', tirage: 'intl', numeroFiche: null, preuve: 'metacarte+freres' }, { _id: '10|1', carteId: 10, idProduct: 1, idExpansion: 9, slugSet: 'Le-Set', tirage: 'intl', numeroFiche: '5', preuve: 'set+numero' }]);
        const surs = [
            { idProduct: 100, carteId: 10, action: 'ligne-neuve', numeroFiche: '5', preuve: 'set+numero+nom', detail: 'banc', idExpansion: 9, slugSet: 'Le-Set', tirage: 'intl', slug: 'p-100', idMetacard: 700 },
            { idProduct: 300, carteId: 11, action: 'numeroFiche', numeroFiche: '6', preuve: 'set+numero+nom', detail: 'banc', idExpansion: 9, slugSet: 'Le-Set', tirage: 'intl', slug: 'p-300', idMetacard: 701 },
        ];
        const avant = { cartes: await db.collection('cartes').find({}).sort({ _id: 1 }).toArray(), lignes: await db.collection('cartes_produits').find({}).sort({ _id: 1 }).toArray() };
        verifier('--attendu : le bon nombre passe, un autre ou l\'absence refuse', [A.verifierAttendu({ surs }, 2).ok, A.verifierAttendu({ surs }, 3).ok, A.verifierAttendu({ surs }, undefined).ok], [true, false, false]);
        const manifeste = A.construireManifeste({ surs, lignesAvant: avant.lignes, cartesAvant: avant.cartes, le: new Date('2026-10-17T00:00:00Z') });
        verifier('le manifeste est figé AVANT l\'écriture : il porte la valeur d\'avant de chaque numeroFiche et les liens déjà là', [manifeste.lignesNeuves.map(l => l._id), manifeste.numerosFiche.map(n => [n._id, n.avant]), manifeste.cartes.map(c => [c.carteId, c.idProductsAjoutes])], [['10|100'], [['11|300', null]], [[10, [100]]]]);
        const r = await A.ecrire(db, surs, manifeste);
        verifier('écriture : 1 ligne neuve, 1 numeroFiche posé', [r.lignes, r.numerosFiche], [1, 1]);
        verifier('la ligne neuve porte sa preuve nommée, sa route et son numeroFiche', (({ preuve, route, numeroFiche, carteId }) => ({ preuve, route, numeroFiche, carteId }))(await db.collection('cartes_produits').findOne({ _id: '10|100' })), { preuve: 'set+numero+nom', route: A.ROUTE, numeroFiche: '5', carteId: 10 });
        verifier('le numeroFiche nul de la ligne existante est posé, RIEN d\'autre ne change sur cette ligne', (await db.collection('cartes_produits').findOne({ _id: '11|300' })), { _id: '11|300', carteId: 11, idProduct: 300, idExpansion: 9, slugSet: 'Le-Set', tirage: 'intl', numeroFiche: '6', preuve: 'metacarte+freres' });
        verifier('la carte reçoit l\'idProduct EN FIN (le repère liens.idProduct[0] ne bouge pas)', (await db.collection('cartes').findOne({ _id: 10 })).liens.idProduct, [1, 2, 100]);
        const r2 = await A.ecrire(db, surs, manifeste);
        verifier('idempotente : un second passage n\'écrit rien', [r2.lignes, r2.numerosFiche], [0, 0]);
        await db.collection('cartes_produits').updateOne({ _id: '11|300' }, { $set: { numeroFiche: '99' } });
        const r3 = await A.ecrire(db, surs, manifeste);
        verifier('un numeroFiche posé entre-temps par un autre outil n\'est JAMAIS réécrit', [r3.numerosFiche, (await db.collection('cartes_produits').findOne({ _id: '11|300' })).numeroFiche], [0, '99']);
        await db.collection('cartes_produits').updateOne({ _id: '11|300' }, { $set: { numeroFiche: '6' } });
        const rl = await A.relire(db, manifeste);
        verifier('relecture après écriture : lignes, numeroFiche, liens concordent', [rl.ok, rl.lignes, rl.numerosFiche, rl.cartes], [true, '1/1', '1/1', '1/1']);
        const ret = await A.retirer(db, manifeste);
        verifier('retrait exact : la ligne neuve disparaît, le numeroFiche revient à nul, l\'idProduct est retiré de la carte', [ret.lignes, ret.numerosFiche, await db.collection('cartes_produits').countDocuments({ _id: '10|100' }), (await db.collection('cartes_produits').findOne({ _id: '11|300' })).numeroFiche, (await db.collection('cartes').findOne({ _id: 10 })).liens.idProduct], [1, 1, 0, null, [1, 2]]);
        const apresRetrait = { cartes: await db.collection('cartes').find({}).sort({ _id: 1 }).toArray(), lignes: await db.collection('cartes_produits').find({}).sort({ _id: 1 }).toArray() };
        verifier('après retrait la base est IDENTIQUE à celle d\'avant (cartes et lignes, document par document)', JSON.stringify(apresRetrait), JSON.stringify(avant));
        await A.ecrire(db, surs, manifeste);
        await db.collection('cartes_produits').updateOne({ _id: '10|1' }, { $set: { numeroFiche: '5' } });
        const ret2 = await A.retirer(db, manifeste);
        verifier('le retrait ne touche JAMAIS une ligne qui n\'est pas à notre route (une ligne ordinaire survit)', [await db.collection('cartes_produits').countDocuments({ _id: '10|1' }), ret2.lignes], [1, 1]);
        const idemRet = await A.retirer(db, manifeste);
        verifier('retrait idempotent', [idemRet.lignes, idemRet.numerosFiche], [0, 0]);
        // CORRECTION 1 : l'écriture REVÉRIFIE, ligne par ligne, qu'aucune ligne n'existe déjà pour ce produit sur une AUTRE carte
        await db.collection('cartes_produits').insertOne({ _id: '11|500', carteId: 11, idProduct: 500, idExpansion: 9, slugSet: 'Le-Set', tirage: 'intl', numeroFiche: '6', preuve: 'set+numero' });
        const surs2 = [
            { idProduct: 500, carteId: 10, action: 'ligne-neuve', numeroFiche: '5', preuve: 'set+numero+nom', detail: 'banc', idExpansion: 9, slugSet: 'Le-Set', tirage: 'intl', slug: 'p-500', idMetacard: 702 },
            { idProduct: 501, carteId: 10, action: 'ligne-neuve', numeroFiche: '60', preuve: 'set+numero+nom', detail: 'banc', idExpansion: 9, slugSet: 'Le-Set', tirage: 'intl', slug: 'p-501', idMetacard: 703 },
        ];
        const m2 = A.construireManifeste({ surs: surs2, lignesAvant: await db.collection('cartes_produits').find({}).toArray(), cartesAvant: await db.collection('cartes').find({}).toArray() });
        const avant2 = JSON.stringify([await db.collection('cartes_produits').find({}).sort({ _id: 1 }).toArray(), await db.collection('cartes').find({}).sort({ _id: 1 }).toArray()]);
        const r4 = await A.ecrire(db, surs2, m2);
        verifier('écriture : un produit déjà lié à une AUTRE carte est REFUSÉ et listé, et RIEN n\'est écrit (même pas le produit voisin sain)', [r4.refus.map(x => [x.idProduct, x.surCartes]), r4.lignes, r4.numerosFiche, r4.cartes], [[[500, [11]]], 0, 0, 0]);
        verifier('refus : la base est identique à celle d\'avant la tentative', JSON.stringify([await db.collection('cartes_produits').find({}).sort({ _id: 1 }).toArray(), await db.collection('cartes').find({}).sort({ _id: 1 }).toArray()]), avant2);
        verifier('la même vérification, appelée seule, rend la liste sans rien écrire', (await A.produitsDejaSurAutreCarte(db, surs2)).map(x => x.idProduct), [500]);
    } finally { await client.close(); await banc.arreter(); }
    console.log(`\n${ok} passés, ${ko} en échec`);
    process.exitCode = ko ? 1 : 0;
})().catch(e => { console.error(e); process.exitCode = 1; });
