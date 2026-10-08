// node test-tcgdex-appariement-lvx.js — BANC PUR (aucune base, aucun réseau). Trois défauts de l'appariement TCGdex, trouvés par
// la piste A4 du 2026-10-08, sur des fragments RÉELS (ids TCGdex et noms relevés dans le cache `tcgdex_sets` et la base `cartes`).
//  1. LV.X : TCGdex nomme « Gliscor » (dp6-141, rareté « Rare Holo LV.X ») la carte que nous appelons « Gliscor LV.X » ; le
//     témoin du nom y voyait une contradiction avec les autres « Gliscor » du set (28/28 `contredite-par-le-nom` étaient des LV.X).
//  2. Celebrations : « 015 » (Lunala, tirage principal) et « 15 » (Venusaur, Classic Collection) ont la même cleNumero ; le nom
//     TCGdex (cel25-15 = Lunala) départage quand EXACTEMENT UNE de nos porteuses lui est compatible.
//  3. V-UNION : nos numéros s'écrivent « SWSH160 (Top Right) » ; TCGdex swshp porte « SWSH160 » avec image.
//  Et ce qui doit RESTER refusé : la Classic Collection (cel25cc, sans image chez TCGdex), un vrai homonyme contredit, une
//  rareté LV.X seule (dp7-SH1 « Drifloon » est étiquetée LV.X par TCGdex sans l'être), les deux faux visuels Blastoise / Pikachu.
const { apparierExpansion } = require('./collecte-cartes/tcgdex-appariement');

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); }
};
const carte = (id, nomEn, expansion, ...numeros) => ({ _id: id, nomEn, attaques: [], impressions: numeros.map(numero => ({ tirage: 'intl', expansion, numero })) });
const tcg = (set, localId, name, rarity) => ({ id: `${set}-${localId}`, localId, name, rarity, illustrator: 'X', image: `u/${set}/${localId}` });
const rep = (R, id) => { const r = R.find(x => String(x.carte._id) === String(id)); return r ? (r.tcg ? r.tcg.id : r.motif) : 'aucune réponse'; };

// ── 1. LV.X ────────────────────────────────────────────────────────────────────────────────────────────────────────
const LA = 'Legends Awakened';
{
    const cartes = [carte(50892, 'Gliscor', LA, '30'), carte(50980, 'Gliscor', LA, '50'), carte(51001, 'Gliscor LV.X', LA, '141'), carte(51002, 'Mesprit LV.X', LA, '143'), carte(51003, 'Mewtwo LV.X', LA, '144'), carte(51004, 'Mesprit', LA, '60')];
    const T = [tcg('dp6', '30', 'Gliscor', 'Rare'), tcg('dp6', '50', 'Gliscor', 'Uncommon'), tcg('dp6', '141', 'Gliscor', 'Rare Holo LV.X'), tcg('dp6', '143', 'Mesprit', 'Rare Holo LV.X'), tcg('dp6', '144', 'Mewtwo', 'Rare Holo LV.X'), tcg('dp6', '60', 'Mesprit', 'Rare')];
    const R = apparierExpansion(LA, cartes, T);
    verifier('LV.X : Gliscor LV.X n°141 reçoit dp6-141 (TCGdex le nomme « Gliscor »)', rep(R, 51001), 'dp6-141');
    verifier('LV.X : Mesprit LV.X n°143 reçoit dp6-143', rep(R, 51002), 'dp6-143');
    verifier('LV.X : Mewtwo LV.X n°144 reçoit dp6-144', rep(R, 51003), 'dp6-144');
    verifier('LV.X : les cartes de base gardent leur scan', [rep(R, 50892), rep(R, 50980), rep(R, 51004)], ['dp6-30', 'dp6-50', 'dp6-60']);
    // un vrai homonyme croisé : le n°144 de TCGdex s'appelle « Mesprit » (rareté LV.X) mais notre n°144 est Mewtwo LV.X -> « Mesprit LV.X » existe chez nous
    const croise = apparierExpansion(LA, cartes, T.map(t => t.localId === '144' ? { ...t, name: 'Mesprit' } : t));
    verifier('LV.X : un nom TCGdex qui désigne une AUTRE LV.X du set reste refusé', rep(croise, 51003), 'contredite-par-le-nom');
    // rareté non LV.X : le suffixe n'est pas repris, « Gliscor » contredit toujours « Gliscor LV.X » (conjonction de deux témoins)
    const sansRarete = apparierExpansion(LA, cartes, T.map(t => t.localId === '141' ? { ...t, rarity: 'Rare Holo' } : t));
    verifier('LV.X : sans rareté LV.X chez TCGdex, le refus reste', rep(sansRarete, 51001), 'contredite-par-le-nom');
    // dp7-SH1 « Drifloon » est étiquetée « Rare Holo LV.X » par TCGdex sans être un LV.X : notre Drifloon (base) ne change pas de verdict
    const dr = apparierExpansion(LA, [carte(1, 'Drifloon', LA, 'SH1'), carte(2, 'Drifloon LV.X', LA, 'SH2')], [tcg('dp7', 'SH1', 'Drifloon', 'Rare Holo LV.X'), tcg('dp7', 'SH2', 'Drifloon', 'Rare Holo LV.X')]);
    verifier('LV.X : un Drifloon de base reçoit le Drifloon de base, la LV.X la sienne', [rep(dr, 1), rep(dr, 2)], ['dp7-SH1', 'dp7-SH2']);
}

// ── 2. Celebrations : zéros de tête, Classic Collection ────────────────────────────────────────────────────────────
const C = 'Celebrations';
{
    const cartes = [
        carte(1, 'Lunala', C, '015'), carte(2, 'Venusaur', C, '15'), carte(3, "Rocket's Zapdos", C, '15'), carte(4, 'Claydol', C, '15'), carte(5, 'Here Comes Team Rocket!', C, '15'),
        carte(6, 'Dialga', C, '020'), carte(7, 'Cleffa', C, '20'),
        carte(8, 'Surfing Pikachu V', C, '008'), carte(9, 'Dark Gyarados', C, '8'),
        carte(10, 'Surfing Pikachu VMAX', C, '009'), carte(11, "Team Magma's Groudon", C, '9'),
        // les deux FAUX VISUELS servis depuis le 2026-10-05 : Blastoise CC n°2 (cel25-2 = Reshiram), « _____'s Pikachu » CC n°24 (cel25-24 = Professor's Research)
        carte(12, 'Reshiram', C, '002'), carte(13, 'Blastoise', C, '2'),
        carte(14, "Professor's Research", C, '023', '024'), carte(15, "_____'s Pikachu", C, '24'),
    ];
    const T = [tcg('cel25', '15', 'Lunala'), tcg('cel25', '20', 'Dialga'), tcg('cel25', '8', 'Surfing Pikachu V'), tcg('cel25', '9', 'Surfing Pikachu VMAX'), tcg('cel25', '2', 'Reshiram'), tcg('cel25', '23', "Professor's Research (Professor Oak)"), tcg('cel25', '24', "Professor's Research (Professor Oak)")];
    const R = apparierExpansion(C, cartes, T);
    verifier('Celebrations : Lunala 015 -> cel25-15, Dialga 020 -> cel25-20, Pikachu V 008 -> cel25-8, VMAX 009 -> cel25-9', [rep(R, 1), rep(R, 6), rep(R, 8), rep(R, 10)], ['cel25-15', 'cel25-20', 'cel25-8', 'cel25-9']);
    verifier('Celebrations : Reshiram 002 -> cel25-2 et Professor\'s Research 023 -> cel25-23 (écart de forme)', [rep(R, 12), R.find(r => r.carte._id === 14 && r.numero === '023').tcg?.id], ['cel25-2', 'cel25-23']);
    // n°24 : « Professor's Research (…) » ne désigne aucune autre carte, « _____'s Pikachu » non plus -> deux compatibles, le nom ne départage pas
    verifier('Celebrations : n°24, deux porteuses que le nom ne départage pas -> ambigu, aucun scan', R.filter(r => String(r.numero) === '24' || r.numero === '024').map(r => r.motif), ['numero-ambigu-chez-nous', 'numero-ambigu-chez-nous']);
    verifier('Celebrations : les 7 cartes de la Classic Collection ne reçoivent PAS le scan du tirage principal', [2, 3, 4, 5, 7, 9, 11].map(i => rep(R, i).startsWith('cel25-')), [false, false, false, false, false, false, false]);
    verifier('Celebrations : Blastoise n°2 et « _____\'s Pikachu » n°24 (faux visuels) ne reçoivent aucun scan', [rep(R, 13), rep(R, 15)].map(m => m.startsWith('cel25-')), [false, false]);
    // si le nom TCGdex ne désigne aucune de nos porteuses (écart de forme), plusieurs porteuses : on ne choisit pas
    const forme = apparierExpansion(C, cartes, [tcg('cel25', '15', 'Nom qui ne désigne personne')]);
    verifier('Celebrations : nom TCGdex qui ne départage rien -> numero-ambigu-chez-nous comme avant', [rep(forme, 1), rep(forme, 2)], ['numero-ambigu-chez-nous', 'numero-ambigu-chez-nous']);
    // deux porteuses compatibles avec le nom : ambigu
    const deux = apparierExpansion(C, [carte(1, 'Lunala', C, '015'), carte(2, 'Lunala', C, '15')], [tcg('cel25', '15', 'Lunala')]);
    verifier('Celebrations : deux porteuses compatibles avec le nom -> ambigu', [rep(deux, 1), rep(deux, 2)], ['numero-ambigu-chez-nous', 'numero-ambigu-chez-nous']);
    // Classic Collection seule (aucune porteuse du nom) : refus, jamais un scan par défaut
    const cc = apparierExpansion(C, [carte(2, 'Venusaur', C, '15'), carte(4, 'Claydol', C, '15')], [tcg('cel25', '15', 'Lunala')]);
    verifier('Celebrations : numéro porté par 2 cartes CC, scan principal d\'une carte absente -> ambigu, rien posé', [rep(cc, 2), rep(cc, 4)], ['numero-ambigu-chez-nous', 'numero-ambigu-chez-nous']);
}

// ── 3. V-UNION ─────────────────────────────────────────────────────────────────────────────────────────────────────
const S = 'SWSH Black Star Promos';
{
    const cartes = [carte(70, 'Mewtwo V-UNION', S, 'SWSH159 (Top Left)', 'SWSH160 (Top Right)', 'SWSH161 (Bottom Left)', 'SWSH162 (Bottom Right)'), carte(71, 'Morpeko V-UNION', S, 'SWSH215 (Top Left)', 'SWSH218 (Bottom Right)'), carte(72, 'Pikachu', S, 'SWSH040')];
    const T = [tcg('swshp', 'SWSH159', 'Mewtwo V-UNION'), tcg('swshp', 'SWSH160', 'Mewtwo V-UNION'), tcg('swshp', 'SWSH161', 'Mewtwo V-UNION'), tcg('swshp', 'SWSH162', 'Mewtwo V-UNION'), tcg('swshp', 'SWSH215', 'Morpeko V-UNION'), tcg('swshp', 'SWSH218', 'Morpeko V-UNION'), tcg('swshp', 'SWSH040', 'Pikachu')];
    const R = apparierExpansion(S, cartes, T);
    verifier('V-UNION : « SWSH159…162 (quart) » -> swshp-SWSH159…162, une réponse par impression, jamais deux quarts sur la même clé',
        R.filter(r => r.carte._id === 70).map(r => r.tcg ? r.tcg.id : r.motif), ['swshp-SWSH159', 'swshp-SWSH160', 'swshp-SWSH161', 'swshp-SWSH162']);
    verifier('V-UNION : Morpeko 215 et 218', R.filter(r => r.carte._id === 71).map(r => r.tcg ? r.tcg.id : r.motif), ['swshp-SWSH215', 'swshp-SWSH218']);
    verifier('V-UNION : un numéro sans parenthèse ne change pas', rep(R, 72), 'swshp-SWSH040');
    // une parenthèse n'ouvre pas une porte : un quart dont TCGdex n'a pas le numéro reste « absente-de-tcgdex » (Morpeko 287-290)
    const absent = apparierExpansion(S, [carte(71, 'Morpeko V-UNION', S, 'SWSH287 (Top Left)')], T);
    verifier('V-UNION : numéro absent chez TCGdex -> absente-de-tcgdex', rep(absent, 71), 'absente-de-tcgdex');
    // deux CARTES distinctes qui tomberaient sur la même clé une fois la parenthèse retirée : ambigu, jamais deviné
    const double = apparierExpansion(S, [carte(80, 'Mewtwo V-UNION', S, 'SWSH160 (Top Right)'), carte(81, 'Zacian V-UNION', S, 'SWSH160 (Bottom Left)')], [tcg('swshp', 'SWSH160', 'Mewtwo V-UNION')]);
    verifier('V-UNION : deux cartes sur la même clé après la parenthèse -> ambigu (le nom ne départage pas seul ici : refus ou une seule porteuse compatible)',
        [rep(double, 80), rep(double, 81)], ['swshp-SWSH160', 'contredite-par-le-nom']);
}

// ── 3 bis. I1 de la relecture : une carte vue HORS slug (Additionals qui déclarent la même expansion) sert de TÉMOIN, jamais de RÉCIPIENDAIRE ──
{
    const { recevantsDuSet } = require('./collecte-cartes/tcgdex-appariement');
    const X = 'Ascended Heroes';
    const prin = { ...carte(500, 'Bulbasaur', X, '001'), sets: ['Ascended-Heroes'] };
    const addi = { ...carte(501, 'Bulbasaur', X, '001'), sets: ['Ascended-Heroes-Additionals'] };   // même nom, même numéro, autre slug (xASC)
    const autre = { ...carte(502, 'Ivysaur', X, '002'), sets: ['Ascended-Heroes-Additionals'] };
    const T = [tcg('me2pt5', '001', 'Bulbasaur'), tcg('me2pt5', '002', 'Ivysaur')];
    const R = apparierExpansion(X, [prin, addi, autre], T, 'intl', recevantsDuSet('Ascended-Heroes'));
    verifier('Additionals : la carte du slug de l\'unité reçoit son scan (pas d\'ambiguïté fabriquée par l\'Additional)', rep(R, 500), 'me2pt5-001');
    verifier('Additionals : aucune réponse pour les cartes hors slug (jamais de scan posé sous le slug de l\'unité)', R.filter(r => r.carte._id !== 500).length, 0);
    // le témoin voit quand même la carte hors slug : Blastoise (slug) au n°2 ne prend pas le scan de « Reshiram » (hors slug)
    const bl = { ...carte(13, 'Blastoise', C, '2'), sets: ['Celebrations'] }, re = { ...carte(12, 'Reshiram', C, '002'), sets: ['25th-Anniversary-Collection'] };
    const R2 = apparierExpansion(C, [bl, re], [tcg('cel25', '2', 'Reshiram')], 'intl', recevantsDuSet('Celebrations'));
    verifier('Hors slug : Reshiram (hors slug) contredit encore Blastoise (slug) ; Reshiram ne reçoit rien', R2.map(r => `${r.carte._id}:${r.motif || r.tcg.id}`), ['13:contredite-par-le-nom']);
    // le 2e faux visuel : « _____'s Pikachu » n°24 (slug) face à Professor's Research 024 (hors slug), nom TCGdex en écart de forme -> ambigu, aucun scan
    const pk = { ...carte(15, "_____'s Pikachu", C, '24'), sets: ['Celebrations'] }, pr = { ...carte(14, "Professor's Research", C, '024'), sets: ['Journey-Together'] };
    verifier('Hors slug : une porteuse hors slug de nom différent garde l\'ambiguïté (2e faux visuel)', apparierExpansion(C, [pk, pr], [tcg('cel25', '24', "Professor's Research (Professor Oak)")], 'intl', recevantsDuSet('Celebrations')).map(r => `${r.carte._id}:${r.motif || r.tcg.id}`), ['15:numero-ambigu-chez-nous']);
    verifier('sans prédicat : toutes les cartes reçoivent (illustrateurs, comme avant)', apparierExpansion(C, [bl, re], [tcg('cel25', '2', 'Reshiram')]).length, 2);
}

// ── 4. la lecture des cartes : le slug OU la déclaration de l'impression (sans quoi le témoin ne voit pas Reshiram) ───────
{
    const { filtreCartesDuSet } = require('./collecte-cartes/tcgdex-appariement');
    verifier('lecture : slug du set OU impression déclarée, sur toutes les expansions de la ligne', filtreCartesDuSet('Celebrations', ['Celebrations', 'X']),
        { $or: [{ sets: 'Celebrations' }, { impressions: { $elemMatch: { tirage: 'intl', expansion: { $in: ['Celebrations', 'X'] } } } }] });
    verifier('lecture : une expansion seule est une liste', filtreCartesDuSet('S', 'E').$or[1].impressions.$elemMatch.expansion, { $in: ['E'] });
    const src = require('fs').readFileSync(require('path').join(__dirname, 'collecteur-images-tcgdex.js'), 'utf8');
    verifier('lecture : le collecteur lit les cartes par filtreCartesDuSet (branche anglaise)', /M\.Carte\.find\(filtreCartesDuSet\(L\.slugSet, L\.bulba\.expansion\)\)/.test(src) && /apparierExpansion\(nom, cartes, tcg, 'intl', recevantsDuSet\(L\.slugSet\)\)/.test(src), true);
}

console.log(`\n${ok} passés, ${ko} en échec`);
process.exit(ko ? 1 : 0);
