// node test-celebrations.js — LOT CEL (2026-10-13) : Celebrations et sa Classic Collection.
//   1. les alias de nom LIMITÉS À UNE EXPANSION (collecte-cartes/alias-noms.js) : « Luxray [GL] LV.X » ne devient « Luxray GL LV.X » que dans CEL ;
//   2. la garde du nom seul, étendue (collecte-cartes/garde-nom-seul.js) : le numéro EXACT (zéros de tête gardés) qui sépare le tirage principal « 002 »
//      de la Classic Collection « 2 », et la clé NOM + ATTAQUES EXACTES quand deux produits partagent un nom mais pas leurs attaques ;
//   3. la ligne ptcgio « cel25c » (collecte-cartes/ptcgio.js) : adresse /cel25c/<n°>_A_hires.png, numéro de FICHE sans zéros, nom du témoin exigé.
// Aucune requête, aucune base : des faux objets.
const { aliasDe, ALIAS_CARDMARKET_VERS_BULBAPEDIA } = require('./collecte-cartes/alias-noms');
const { joindre } = require('./collecte-cartes/jointure');
const { gardeNomSeul, numerosExacts } = require('./collecte-cartes/garde-nom-seul');
const P = require('./collecte-cartes/ptcgio');

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); }
};
const silencieux = f => { const l = console.log; console.log = () => { }; try { return f(); } finally { console.log = l; } };

// ── 1. LES ALIAS, PAR EXPANSION ─────────────────────────────────────────────────────────────────────────────────────
verifier('alias : les quatre noms de CEL (4347) et Professor Oak', ['Gardevoir ex δ Delta Species', 'Umbreon Gold Star', 'Luxray LV.X', 'Garchomp LV.X C', 'Professor\'s Research - Professor Oak'].map(n => aliasDe(n, 4347)),
    ['Gardevoir ex δ', 'Umbreon', 'Luxray GL LV.X', 'Garchomp C LV.X', 'Professor\'s Research']);
verifier('alias : ailleurs que dans CEL, ces noms ne reçoivent AUCUN alias (Luxray LV.X de Platinum reste Luxray LV.X)', ['Luxray LV.X', 'Umbreon Gold Star', 'Garchomp LV.X C'].map(n => aliasDe(n, 1234)), [undefined, undefined, undefined]);
verifier('alias : sans expansion, aucun alias de CEL non plus ; l\'alias GLOBAL (EXP. ALL) reste partout', [aliasDe('Luxray LV.X'), aliasDe('EXP. ALL', 1234), aliasDe('EXP. ALL', 4347), ALIAS_CARDMARKET_VERS_BULBAPEDIA['EXP. ALL']], [undefined, 'Exp. Share', 'Exp. Share', 'Exp. Share']);
{
    const carte = { _id: 74533, nomEn: 'Luxray GL LV.X', niveau: 'X', attaques: [{ nom: 'Flash Impact' }], impressions: [{ tirage: 'intl', expansion: 'Celebrations', numero: '109' }] };
    const produit = { idProduct: 576787, nom: 'Luxray LV.X', name: 'Luxray [GL] LV.X [Bright Look | Flash Impact]', attaques: ['Bright Look', 'Flash Impact'], numero: null };
    const dans = silencieux(() => joindre([carte], [produit], { idExpansion: 4347, expansionBulba: 'Celebrations', tirage: 'intl', slugSet: 'Celebrations' }));
    const hors = silencieux(() => joindre([carte], [produit], { idExpansion: 1234, expansionBulba: 'Celebrations', tirage: 'intl', slugSet: 'Autre' }));
    verifier('joindre : « Luxray LV.X » rejoint « Luxray GL LV.X » dans l\'expansion 4347 seulement', [dans.lignes.map(l => [l.carteId, l.idProduct]), hors.lignes.length], [[[74533, 576787]], 0]);
}

// ── 2. LA GARDE DU NOM SEUL, ÉTENDUE ─────────────────────────────────────────────────────────────────────────────────
// Le décor de CEL en petit : Reshiram principal (002) et Reshiram de la Classic (113, attaques différentes) ; un Blastoise Classic « 2 » ;
// trois Pikachu (un numéroté 005, deux sans numéro) ; deux Mew (011 / 025) ; un Charizard dont le slug porte l'origine « 4 » et un second sans rien.
const cartes = [
    { _id: 1, nomEn: 'Reshiram', attaques: [{ nom: 'Scorching Wind' }, { nom: 'Black Flame' }], impressions: [{ tirage: 'intl', expansion: 'Celebrations', numero: '002' }] },
    { _id: 2, nomEn: 'Reshiram', attaques: [{ nom: 'Outrage' }, { nom: 'Blue Flare' }], impressions: [{ tirage: 'intl', expansion: 'Celebrations', numero: '113' }, { tirage: 'intl', expansion: 'Autre', numero: '9' }] },
    { _id: 3, nomEn: 'Blastoise', attaques: [{ nom: 'Hydro Pump' }], impressions: [{ tirage: 'intl', expansion: 'Celebrations', numero: '2' }] },
    { _id: 4, nomEn: 'Pikachu', attaques: [{ nom: 'Gnaw' }, { nom: 'Thunder Jolt' }], impressions: [{ tirage: 'intl', expansion: 'Celebrations', numero: '005' }] },
    { _id: 5, nomEn: 'Mew', attaques: [{ nom: 'Psyshot' }], impressions: [{ tirage: 'intl', expansion: 'Celebrations', numero: '011' }, { tirage: 'intl', expansion: 'Celebrations', numero: '025' }] },
    { _id: 6, nomEn: 'Charizard', attaques: [{ nom: 'Fire Spin' }], impressions: [{ tirage: 'intl', expansion: 'Celebrations', numero: '4' }] },
    { _id: 7, nomEn: 'Palkia', attaques: [{ nom: 'Overdrive Smash' }], impressions: [{ tirage: 'intl', expansion: 'Celebrations', numero: '004' }] },
    { _id: 8, nomEn: 'Zekrom', attaques: [{ nom: 'Field Crush' }, { nom: 'White Thunder' }], impressions: [{ tirage: 'intl', expansion: 'Celebrations', numero: '10' }] }   // « 10 » sans zéro : N'EST PAS « 010 »
];
const produitsLus = [
    { idProduct: 11, nom: 'Reshiram', attaques: ['Scorching Wind', 'Black Flame'], numero: '002', slug: 'Reshiram-V1-CEL002' },
    { idProduct: 12, nom: 'Reshiram', attaques: ['Outrage', 'Blue Flare'], numero: null, slug: 'Reshiram-V2' },
    { idProduct: 13, nom: 'Blastoise', attaques: ['Hydro Pump'], numero: null, slug: 'Blastoise' },
    { idProduct: 14, nom: 'Pikachu', attaques: ['Gnaw', 'Thunder Jolt'], numero: '005', slug: 'Pikachu-V1-CEL005' },
    { idProduct: 15, nom: 'Pikachu', attaques: ['Gnaw', 'Thunder Jolt'], numero: null, slug: 'Pikachu-V2-CELBS-58' },
    { idProduct: 16, nom: 'Pikachu', attaques: ['Gnaw', 'Thunder Jolt'], numero: null, slug: 'Pikachu-V3-CELBS-58' },
    { idProduct: 17, nom: 'Mew', attaques: ['Mysterious Tail', 'Psyshot'], numero: '011', slug: 'Mew-V1' },
    { idProduct: 18, nom: 'Mew', attaques: ['Mysterious Tail', 'Psyshot'], numero: '025', slug: 'Mew-V2' },
    { idProduct: 19, nom: 'Charizard', attaques: ['Energy Burn', 'Fire Spin'], numero: null, slug: 'Charizard-V1-CELBS-4' },
    { idProduct: 20, nom: 'Charizard', attaques: ['Energy Burn', 'Fire Spin'], numero: null, slug: 'Charizard-V2' },
    { idProduct: 21, nom: 'Palkia', attaques: ['Overdrive Smash'], numero: '004', slug: 'Palkia' },
    { idProduct: 22, nom: 'Zekrom', attaques: ['Field Crush', 'White Thunder'], numero: '010', slug: 'Zekrom-V1-CEL010' }
];
const masques = produitsLus.map(p => ({ ...p, numero: null }));
const ligne = (carteId, idProduct, preuve = 'set+nom') => ({ _id: `${carteId}|${idProduct}`, carteId, idProduct, preuve, detail: 'x', numeroFiche: null });
// ce que la jointure par le nom (numéros masqués) rend en tête : chaque produit vers les cartes de son nom, départagé par les attaques
const lignes = [ligne(1, 11, 'set+nom+attaques'), ligne(2, 12, 'set+nom+attaques'), ligne(3, 13), ligne(4, 14, 'set+nom+attaques'), ligne(4, 15, 'set+nom+attaques'), ligne(4, 16, 'set+nom+attaques'),
    ligne(5, 17), ligne(5, 18), ligne(6, 19, 'set+nom+attaques'), ligne(6, 20, 'set+nom+attaques'), ligne(7, 21), ligne(8, 22, 'set+nom+attaques')];
const cible = { tirage: 'intl', expansions: ['Celebrations'], code: 'CEL' };

// l'ancien comportement (sans `exact`) : rien n'est rattrapé
const avant = gardeNomSeul({ lignes, produits: masques, cartes });
verifier('sans `exact` : la garde est celle d\'avant — Blastoise, Palkia, Zekrom gardés (noms uniques), tout homonyme refusé (Reshiram ×2, Pikachu ×3, Mew ×2, Charizard ×2)',avant.gardees.map(l => l.idProduct).sort((a, b) => a - b), [13, 21, 22]);

const exact = numerosExacts({ produits: produitsLus, cartes, ...cible });
verifier('numerosExacts : le numéro du produit (chaîne exacte, zéros gardés) ; à défaut, l\'origine portée par le slug « CEL<origine>-<n> » ; sinon rien', [11, 12, 14, 15, 17, 19, 20, 22].map(id => exact.numeroDuProduit.get(id) ?? null), ['002', null, '005', '58', '011', '4', null, '010']);
verifier('numerosExacts : les numéros d\'impression de la carte DANS le set cible seulement (« 9 » d\'une autre expansion exclu)', [exact.numerosDeCarte.get(2), exact.numerosDeCarte.get(5)], [['113'], ['011', '025']]);

const ids = r => r.gardees.map(l => l.idProduct).sort((a, b) => a - b);
verifier('les deux clés s\'ouvrent UNE PAR UNE : le numéro exact seul rattrape Reshiram V1, Pikachu V1, Mew ×2, Charizard V1 — pas Reshiram V2 ; nom + attaques exactes seul rattrape les deux Reshiram — pas Mew ni Pikachu ni Charizard',
    [ids(gardeNomSeul({ lignes, produits: masques, cartes, exact })), ids(gardeNomSeul({ lignes, produits: masques, cartes, attaquesExactes: true }))], [[11, 13, 14, 17, 18, 19, 21, 22], [11, 12, 13, 21, 22]]);
const G = gardeNomSeul({ lignes, produits: masques, cartes, exact, attaquesExactes: true });
const gardes = G.gardees.map(l => l.idProduct).sort((a, b) => a - b);
verifier('gardées : + Reshiram V1/V2 (nom + attaques exactes), Pikachu V1 (005), Mew V1/V2 (011/025), Charizard V1 (origine 4) ; Pikachu V2/V3 et Charizard V2 restent refusés', gardes, [11, 12, 13, 14, 17, 18, 19, 21, 22]);
verifier('refusées, avec leur raison : celles qu\'aucune clé ne départage', G.refusees.map(r => [r.idProduct, r.raison]).sort((a, b) => a[0] - b[0]),
    [[15, 'nom de produit porté par 3 produits'], [16, 'nom de produit porté par 3 produits'], [20, 'nom de produit porté par 2 produits']]);
const L = id => G.gardees.find(l => l.idProduct === id);
verifier('le numéro de fiche d\'une ligne rattrapée par le numéro exact est CE numéro (Mew a deux impressions : jamais deviné)', [L(14).numeroFiche, L(17).numeroFiche, L(18).numeroFiche, L(19).numeroFiche, L(11).numeroFiche], ['005', '011', '025', '4', '002']);
verifier('la preuve dit comment la ligne a été gardée', [L(14).preuve, L(11).preuve, L(12).preuve, L(13).preuve], ['set+nom+attaques+numero-exact', 'set+nom+attaques+numero-exact', 'set+nom+attaques+attaques-exactes', 'set+nom']);
verifier('« 10 » n\'est pas « 010 » : le Zekrom numéroté « 010 » face à la carte « 10 » n\'est PAS rattrapé par le numéro (il l\'est ici par son nom seul, unique)', [L(22).numeroFiche, L(22).preuve], [null, 'set+nom+attaques']);
{   // deux cartes qui portent le MÊME numéro exact : le numéro ne désigne plus personne
    const c2 = [...cartes, { _id: 9, nomEn: 'Reshiram', attaques: [{ nom: 'Scorching Wind' }, { nom: 'Black Flame' }], impressions: [{ tirage: 'intl', expansion: 'Celebrations', numero: '002' }] }];
    const ex2 = numerosExacts({ produits: produitsLus, cartes: c2, ...cible });
    const G2 = gardeNomSeul({ lignes: [ligne(1, 11, 'set+nom+attaques'), ligne(9, 11, 'set+nom+attaques')], produits: masques, cartes: c2, exact: ex2, attaquesExactes: true });
    verifier('le numéro exact porté par DEUX cartes du set ne garde rien (un produit vers deux cartes reste refusé)', [G2.gardees.length, G2.refusees.map(r => r.raison)], [0, ['produit joint à 2 cartes']]);
}
{   // un second produit au MÊME numéro exact : pas d'unicité
    const ps = [...produitsLus, { idProduct: 30, nom: 'Pikachu', attaques: ['Gnaw', 'Thunder Jolt'], numero: '005', slug: 'Pikachu-bis' }];
    const ex3 = numerosExacts({ produits: ps, cartes, ...cible });
    const G3 = gardeNomSeul({ lignes: [...lignes, ligne(4, 30, 'set+nom+attaques')], produits: ps.map(p => ({ ...p, numero: null })), cartes, exact: ex3, attaquesExactes: true });
    verifier('deux produits au même numéro exact : aucun n\'est rattrapé par le numéro', [G3.gardees.some(l => l.idProduct === 14), G3.gardees.some(l => l.idProduct === 30)], [false, false]);
}
{   // une carte dont les attaques ne sont PAS exactement celles du produit n'est pas rattrapée par la clé nom + attaques
    const c4 = cartes.map(c => c._id === 2 ? { ...c, attaques: [{ nom: 'Outrage' }] } : c);
    const G4 = gardeNomSeul({ lignes, produits: masques, cartes: c4, exact: numerosExacts({ produits: produitsLus, cartes: c4, ...cible }), attaquesExactes: true });
    verifier('attaques incomplètes côté carte : Reshiram V2 reste refusé (la clé exige l\'égalité des deux ensembles)', G4.gardees.some(l => l.idProduct === 12), false);
}
{   // la garde n'écrit rien dans les lignes qu'on lui donne (elle copie)
    const copie = JSON.stringify(lignes);
    gardeNomSeul({ lignes, produits: masques, cartes, exact, attaquesExactes: true });
    verifier('les lignes d\'entrée ne sont pas modifiées', JSON.stringify(lignes) === copie, true);
}

{   // le PLAN complet d'une collecte sans page (jointure par le nom, numéros masqués, puis la garde) : la même fonction que la collecte
    const { planSansPage } = require('./collecte-cartes/plan-sans-page');
    const LC = { code: 'CEL', exp: 4347, bulba: { sansPage: true, nomSeul: true, tirage: 'intl', expansion: 'Celebrations', cles: ['numero-exact', 'attaques-exactes'] } };
    const { ligne: ligneTable } = require('./collecte-cartes/table-sets');
    verifier('la table : CEL ouvre les deux clés ; AUCUNE autre ligne nomSeul (UNP, six Gym, DP1, Master Kit…) n\'en ouvre une', [ligneTable('CEL').bulba.cles, require('./collecte-cartes/table-sets').TABLE_SANS_PAGE.filter(l => l.bulba?.cles && l.code !== 'CEL').map(l => l.code)], [['numero-exact', 'attaques-exactes'], []]);
    const cartesC = cartes.map(c => ({ ...c, impressions: c.impressions.map(i => ({ ...i })) }));
    const pl = silencieux(() => planSansPage({ cartesDuSet: cartesC, produitsLus: produitsLus.map(p => ({ ...p, name: p.nom })), L: LC, slugCardmarket: 'Celebrations' }));
    const par = new Map(pl.J.lignes.map(l => [l.idProduct, l]));
    verifier('planSansPage : les produits gardés de bout en bout (jointure masquée + garde + numéros exacts) et leur numéro de fiche',
        [...par.keys()].sort((a, b) => a - b).map(id => [id, par.get(id).carteId, par.get(id).numeroFiche]),
        [[11, 1, '002'], [12, 2, '113'], [13, 3, '2'], [14, 4, '005'], [17, 5, '011'], [18, 5, '025'], [19, 6, '4'], [21, 7, '004'], [22, 8, '10']]);
    verifier('planSansPage : Pikachu V2/V3 et Charizard V2 restent des restes nommés, sans fiche', pl.J.restes.filter(r => /nom seul refusé/.test(r.detail)).map(r => r.detail.split(' ')[0]).sort(), ['15', '16', '20']);
    const sansCles = silencieux(() => planSansPage({ cartesDuSet: cartesC, produitsLus: produitsLus.map(p => ({ ...p, name: p.nom })), L: { ...LC, bulba: { ...LC.bulba, cles: undefined } }, slugCardmarket: 'Celebrations' }));
    verifier('planSansPage : sans `cles`, la ligne joint EXACTEMENT comme avant le lot (Blastoise, Palkia, Zekrom seuls gardés)', sansCles.J.lignes.map(l => l.idProduct).sort((a, b) => a - b), [13, 21, 22]);
    const hors = silencieux(() => planSansPage({ cartesDuSet: cartesC, produitsLus: produitsLus.map(p => ({ ...p, name: p.nom })), L: { ...LC, bulba: { ...LC.bulba, nomSeul: false } }, slugCardmarket: 'Celebrations' }));
    verifier('planSansPage : hors `nomSeul`, ni masque ni garde (G nul) — les numéros restent ceux de la jointure', [hors.G, hors.produits.some(p => p.numero != null)], [null, true]);
}

// ── 3. LA LIGNE ptcgio « cel25c » ────────────────────────────────────────────────────────────────────────────────────
const C25C = P.TABLE_PTCGIO.find(l => l.slug === 'Celebrations' && l.id === 'cel25c');
verifier('la ligne existe, 22 témoins lus à l\'œil, numéros distincts', [!!C25C, C25C?.temoins.length, new Set((C25C?.temoins || []).map(w => w.n)).size, C25C?.lu], [true, 22, 22, '2026-10-13']);
verifier('l\'adresse : /cel25c/<n>_A_hires.png (suffixe _A) — la ligne cel25 garde son adresse nue', [P.urlHires('cel25c', 4, null, '_A'), P.urlHires('cel25', 4)], ['https://images.pokemontcg.io/cel25c/4_A_hires.png', 'https://images.pokemontcg.io/cel25/4_hires.png']);
verifier('un suffixe hors de la liste énumérée LÈVE', (() => { try { P.urlHires('cel25c', 4, null, '_B'); return 'passe'; } catch { return 'leve'; } })(), 'leve');
verifier('adresseDe cel25c : numéro de FICHE sans zéros ET nom du témoin ; « 002 », « 15 » (autre carte), « 3 » (sans témoin), null → rien',
    [['2', 'Blastoise'], ['002', 'Blastoise'], ['15', 'Venusaur'], ['15', 'Claydol'], ['3', 'Blastoise'], [null, 'Blastoise'], ['109', 'Luxray GL LV.X'], ['93', 'Gardevoir ex δ']].map(([n, nom]) => P.adresseDe(C25C, n, nom)),
    [2, null, 15, null, null, null, 109, 93]);
verifier('adresseDe cel25c : sans le nom de la carte, rien ne se construit', P.adresseDe(C25C, '2'), null);
const carte = (id, nom, images = []) => ({ _id: id, nomEn: nom, images });
const t = (c, numeroCm, idProduct, fiche) => ({ carte: c, numeroCm, numeroFiche: fiche, idProduct });
const plan = P.planifierPtcgio({ slug: 'Celebrations', trous: [
    t(carte(101, 'Blastoise'), null, 1, '2'), t(carte(102, 'Charizard'), null, 2, '4'), t(carte(103, 'Venusaur'), 'BS 15', 3, '15'),
    t(carte(104, 'Here Comes Team Rocket!'), null, 4, '15'), t(carte(105, 'Claydol'), null, 5, '15'), t(carte(106, 'Rocket\'s Zapdos'), null, 6, '15'),
    t(carte(107, 'Reshiram'), '002', 7, '002'), t(carte(108, 'Mew'), '025', 8, '025'), t(carte(109, 'Luxray GL LV.X'), null, 9, '109'),
    t(carte(110, 'Gardevoir ex δ'), null, 10, '93'), t(carte(111, 'Reshiram'), null, 11, '113'), t(carte(112, 'Blastoise'), null, 12, '3')
] });
verifier('plan CEL : la Classic reçoit SON adresse _A (2, 4, 15, 109, 93, 113), le tirage principal la sienne (cel25/2, cel25/25) — jamais l\'autre',
    plan.plan.map(p => [p.carteId, p.url.replace('https://images.pokemontcg.io', '')]),
    [[101, '/cel25c/2_A_hires.png'], [102, '/cel25c/4_A_hires.png'], [103, '/cel25c/15_A_hires.png'], [107, '/cel25/2_hires.png'], [108, '/cel25/25_hires.png'], [109, '/cel25c/109_A_hires.png'], [110, '/cel25c/93_A_hires.png'], [111, '/cel25c/113_A_hires.png']]);
verifier('plan CEL : les trois autres cartes « 15 » ne reçoivent PAS la Venusaur ; un numéro sans témoin (3) reste un trou nommé',
    plan.restes.map(r => [r.carteId, r.motif]), [[104, 'numero-nom-contredit'], [105, 'numero-nom-contredit'], [106, 'numero-nom-contredit'], [112, 'non-couvert-par-un-temoin']]);
verifier('plan CEL : l\'entrée porte le numéro de FICHE (celui que le site compare) et une preuve qui nomme le set pokemontcg.io cel25c et son témoin', [plan.plan[0].numero, /cel25c n°2/.test(plan.plan[0].preuve), /Blastoise/.test(plan.plan[0].preuve), plan.plan[0].noteVariante ?? null], ['2', true, true, null]);
verifier('plan CEL : un trou DÉJÀ servi au même numéro n\'est jamais dans le plan (additif)', P.planifierPtcgio({ slug: 'Celebrations', trous: [t(carte(120, 'Blastoise', [{ set: 'Celebrations', source: 'bulbapedia', numero: '2' }]), null, 40, '2')] }).plan.length, 0);

// le client : le suffixe _A n'est accepté QUE sur cel25c, une seule fois
const png = Buffer.from('x');
const appels = [];
const transport = { async get(url) { appels.push(url); return url.endsWith('/robots.txt') ? { status: 200, texte: '' } : { status: 200, type: 'image/png', octets: png }; } };
const client = P.fabriquerClientPtcgio({ transport, verrou: { tenu: true, perdu: false }, pause: async () => { } });
(async () => {
    await client.image('https://images.pokemontcg.io/cel25c/4_A_hires.png');
    verifier('client : /cel25c/4_A_hires.png est accepté', appels.map(u => u.replace('https://images.pokemontcg.io', '')), ['/robots.txt', '/cel25c/4_A_hires.png']);
    for (const u of ['https://images.pokemontcg.io/cel25/4_A_hires.png', 'https://images.pokemontcg.io/cel25c/4_B_hires.png', 'https://images.pokemontcg.io/cel25c/4_A_A_hires.png', 'https://images.pokemontcg.io/smp/SM01_A_hires.png', 'https://images.pokemontcg.io/cel25c/_A_hires.png', 'https://images.pokemontcg.io/cel25c/1234_A_hires.png', 'https://images.pokemontcg.io/cel25c/4_a_hires.png']) {
        const avantN = appels.length; let err = null; try { await client.image(u); } catch (e) { err = e.message; }
        verifier(`client : ${u.slice(26)} est refusé sans requête`, [!!err, appels.length - avantN], [true, 0]);
    }
    console.log(`\n${ok} passés, ${ko} en échec`);
    process.exit(ko ? 1 : 0);
})();
