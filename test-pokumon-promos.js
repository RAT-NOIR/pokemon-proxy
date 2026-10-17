// node test-pokumon-promos.js — le lot PK-PROMOS (2026-10-17) : Burger King (DP 2008, Platinum 2009), Professor Program « Reverse Holo Professor promo », W Promos (magazines), et la GARDE « ligne non regardée ».
// Aucune requête, aucune base : des entrées RÉELLES de l'index lu le 2026-10-17 (titre, image, largeur et événement recopiés, jamais inventés). TOOL_DIR=<dossier> rejoue le banc contre une copie MUTÉE du module.
const path = require('path');
const DIR = process.env.TOOL_DIR || __dirname;
const P = require(path.join(DIR, 'collecte-cartes', 'pokumon.js'));
const { CDN, wp } = require('./test-pokumon-donnees');

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); }
};
const IMG = (an, f) => `${CDN}/${an}/${f}`;
const e = (...a) => P.lireEntree(wp(...a));
const imp = (expansion, numero, total) => ({ tirage: 'intl', expansion, numero, total });
const prod = (idProduct, unite, nomCm, slugProduit, impressions, numero = null) => ({ idProduct, unite, nomCm, slugProduit, impressions, numero });
const ligne = id => P.LIGNES_AUTRES.find(l => l.id === id);
const BK08 = 'Burger-King-DP-Promos-2008', BK09 = 'Burger-King-Platinum-Promos-2009';

// ── 1. la TABLE : quatre lignes neuves, à regarder, avec leur échantillon ─────────────────────────────────────────────────────────────────
const NEUVES = ['bk-2008', 'bk-2009', 'prof-reverse', 'w-promos'].map(ligne);
verifier('table : les quatre lignes neuves existent (bk-2008, bk-2009, prof-reverse, w-promos)', NEUVES.map(l => l?.id), ['bk-2008', 'bk-2009', 'prof-reverse', 'w-promos']);
verifier('table : familles bk, bk, prof, w ; chacune porte un set, le jeu « speciale » et une marque lue', NEUVES.map(l => [l.famille, l.slugs.length, l.jeu, l.tampon.length > 20]), [['bk', 1, 'speciale', true], ['bk', 1, 'speciale', true], ['prof', 1, 'speciale', true], ['w', 1, 'speciale', true]]);
verifier('table : une ligne NEUVE n\'est pas encore regardée (lu = null) et prépare 3 images à regarder, adresses admises par la liste fermée du client', NEUVES.map(l => [l.lu, (l.echantillon || []).length >= 3 && l.echantillon.every(x => P.urlImageValide(x.url) && x.id && x.nom)]), [[null, true], [null, true], [null, true], [null, true]]);

// ── 2. BURGER KING : la clé (nom sans niveau + numéro du slug) et ses vetos ──────────────────────────────────────────────────────────────────
const PRIN = e(35491, 'Burger King Prinplup (58/130 Burger King Special Print)', IMG('2021/07', 'EN_S156Burger-KingSpecial-Print.jpg'), 400, 555, [5237]);
const PACH = e(35484, 'Burger King Pachirisu (35/130 Burger King Special Print)', IMG('2021/07', 'EN_S152Burger-KingSpecial-Print.jpg'), 398, 558, [5237]);
const TURT = e(35509, 'Burger King Turtwig (103/130 Burger King Special Print)', IMG('2021/07', 'EN_S164Burger-KingSpecial-Print.jpg'), 321, 450, [5237]);
const CHIM09 = e(35563, 'Chimchar (56/100 Burger King Special Print)', IMG('2021/07', 'EN_S204Special-Print.jpg'), 397, 558, [5237]);
const CHIM08 = e(35495, 'Burger King Chimchar (76/130 Burger King Special Print)', IMG('2021/07', 'EN_S158Burger-KingSpecial-Print.jpg'), 1078, 1503, [5237]);
const P_PRIN = prod(275625, BK08, 'Prinplup Lv.20 [Aqua Shower | Brine]', 'Prinplup-Lv20-BKPR58', [imp('Diamond & Pearl', '58', '130'), imp('Burger King DP Promos 2008', null, null)]);
const P_PACH = prod(275621, BK08, 'Pachirisu Lv.23 [Minor Errand-Running | Thunder Fang]', 'Pachirisu-Lv23-BKPR35', [imp('Burger King DP Promos 2008', null, null)]);
const P_CHIM09 = prod(651135, BK09, 'Chimchar Lv.6 [Flare | Lunge]', 'Chimchar-Lv6-BKPPR56', [imp('Burger King Platinum Promos 2009', null, null)]);
const LB = ['bk-2008', 'bk-2009'].map(ligne);
let A = P.apparierFamille({ lignes: LB, produits: [P_PRIN], index: [PRIN] });
verifier('BK 2008 : « Prinplup Lv.20 » (slug BKPR58) est PROUVÉ par l\'entrée « Burger King Prinplup 58/130 » — niveau et préfixe de la marque retirés, témoin = l\'impression DP 58/130 de la carte', [A.resultats[0].verdict, A.resultats[0].entree?.id, A.resultats[0].temoin], ['prouve', 35491, 'impression de la carte : n° 58 imprimé sur 130']);
A = P.apparierFamille({ lignes: LB, produits: [P_PACH], index: [PACH] });
verifier('BK 2008 : une carte dont SEULE l\'impression Burger King est connue (sans numéro) est admise PAR LA LIGNE, et le témoin le dit en toutes lettres', [A.resultats[0].verdict, /Burger King/.test(A.resultats[0].temoin || ''), /sans numéro|sans impression/.test(A.resultats[0].temoin || '')], ['prouve', true, true]);
A = P.apparierFamille({ lignes: [{ ...ligne('bk-2008'), absentAdmis: undefined }], produits: [P_PACH], index: [PACH] });
verifier('sans l\'admission explicite de la ligne, l\'absence de témoin reste un TROU « impression-absent » (un doute est un trou)', A.resultats[0].motif, 'impression-absent');
A = P.apparierFamille({ lignes: LB, produits: [{ ...P_PRIN, impressions: [imp('Diamond & Pearl', '58', '132')] }], index: [PRIN] });
verifier('CONTREDIT : une impression de la carte au même numéro mais à un AUTRE total (58/132) n\'est jamais admise, même avec l\'admission d\'absence', A.resultats[0].motif, 'impression-contredit');
A = P.apparierFamille({ lignes: LB, produits: [P_CHIM09], index: [CHIM09, CHIM08] });
verifier('BK 2009 / 2008 : le Chimchar Platinum 56 reçoit l\'entrée 56/100 (bloc 2009) et jamais le Chimchar 76/130 (bloc 2008) — même événement chez Pokumon, le numéro et le bloc séparent', [A.resultats[0].verdict, A.resultats[0].entree?.id], ['prouve', 35563]);
A = P.apparierFamille({ lignes: LB, produits: [P_CHIM09], index: [e(35563, 'Chimchar (56/100 Burger King Special Print)', IMG('2021/07', 'EN_S300Special-Print.jpg'), 397, 558, [5237])] });
verifier('BLOC : la même entrée téléversée hors du bloc 2009 (S300) n\'est pas admise', A.resultats[0].motif, 'non-couvert');
A = P.apparierFamille({ lignes: LB, produits: [P_CHIM09], index: [e(35563, 'Chimchar (56/99 Burger King Special Print)', IMG('2021/07', 'EN_S204Special-Print.jpg'), 397, 558, [5237])] });
verifier('TOTAL : un dénominateur hors de la liste de la ligne (99) n\'est pas admis', A.resultats[0].motif, 'non-couvert');
A = P.apparierFamille({ lignes: LB, produits: [P_PRIN], index: [e(35491, 'Prinplup (58/130 Pokemon League Special Print)', IMG('2021/07', 'EN_S156Burger-KingSpecial-Print.jpg'), 400, 555, [2056])] });
verifier('MARQUE ABSENTE : une entrée qui n\'est pas « Burger King » (même nom, même numéro, même total, même bloc) n\'est jamais admise', A.resultats[0].motif, 'non-couvert');
A = P.apparierFamille({ lignes: LB, produits: [P_PRIN, { ...P_PRIN, idProduct: 275626, slugProduit: 'Prinplup-Lv20-V2-BKPR58' }], index: [PRIN] });
verifier('deux produits pour UNE entrée : trou « multiplicité » pour les deux', A.resultats.map(r => r.motif), ['douteux-multiplicite', 'douteux-multiplicite']);
verifier('un slug sans numéro Burger King n\'a pas de clé : « sans-numero-origine »', P.apparierFamille({ lignes: LB, produits: [{ ...P_PRIN, slugProduit: 'Prinplup-Lv20' }], index: [PRIN] }).resultats[0].motif, 'sans-numero-origine');
verifier('nomPokumon : « Burger King Prinplup » → « prinplup » (le préfixe de la marque tombe), « Chimchar » reste', [P.nomPokumon(PRIN), P.nomPokumon(CHIM09)], ['prinplup', 'chimchar']);

// ── 3. PROFESSOR PROGRAM : la reverse « Reverse Holo Professor promo » est une ligne à part ─────────────────────────────────────────────────
const ROX = e(110271, 'Professor Program Roxanne (150/189 Reverse Holo Professor promo Special Print)', IMG('2026/07', 'EN_S1853Professor-ProgramSpecial-Print.png'), 737, 1031, [9528]);
const GYM = e(110078, 'Professor Program Gym Trainer (059/072 Reverse Holo Professor Program promo Special Print)', IMG('2026/07', 'EN_S1665Professor-ProgramSpecial-Print.png'), 990, 1385, [9528]);
const P_ROX = prod(724618, 'Professor-Program', 'Roxanne', 'Roxanne-PPPASR-150', [imp('Astral Radiance', '150', '189')]);
const P_GYM = prod(674249, 'Professor-Program', 'Gym Trainer', 'Gym-Trainer-PPPSHF-59', [imp('Shining Fates', '059', '072')]);
A = P.apparierFamille({ lignes: [ligne('prof')], produits: [P_ROX], index: [ROX] });
verifier('AVANT : la seule ligne « prof » ne connaît pas « Reverse Holo Professor promo » — Roxanne reste un trou', A.resultats[0].motif, 'non-couvert');
A = P.apparierFamille({ lignes: [ligne('prof'), ligne('prof-reverse')], produits: [P_ROX], index: [ROX] });
verifier('Roxanne ASR 150/189 est PROUVÉE avec la ligne « prof-reverse » (nom, numéro, impression Astral Radiance 150/189)', [A.resultats[0].verdict, A.resultats[0].entree?.id, A.resultats[0].ligne], ['prouve', 110271, 'prof-reverse']);
A = P.apparierFamille({ lignes: [ligne('prof'), ligne('prof-reverse')], produits: [P_GYM], index: [GYM] });
verifier('« Reverse Holo Professor Program promo » (Gym Trainer) reste admise par la ligne « prof » et n\'est PAS comptée deux fois par la nouvelle', [A.resultats[0].verdict, A.resultats[0].ligne], ['prouve', 'prof']);
A = P.apparierFamille({ lignes: [ligne('prof'), ligne('prof-reverse')], produits: [P_ROX], index: [e(110999, 'Professor Cup Roxanne (150/189 Reverse Holo Professor Cup Promo Special Print)', IMG('2026/07', 'EN_S1999Professor-CupSpecial-Print.png'), 737, 1031, [9528])] });
verifier('TAMPON AUTRE : « Professor Cup » n\'est ni la ligne « prof » ni « prof-reverse »', A.resultats[0].motif, 'non-couvert');
A = P.apparierFamille({ lignes: [ligne('prof'), ligne('prof-reverse')], produits: [P_ROX], index: [ROX, e(110998, 'Professor Program Roxanne (150/189 Professor Stamp Promo Special Print)', IMG('2026/07', 'EN_S1998Professor-ProgramSpecial-Print.png'), 737, 1031, [9436])] });
verifier('deux entrées admises (reverse + stamp) pour un produit : TROU « multiplicité » (jamais la première)', A.resultats[0].motif, 'douteux-multiplicite');

// ── 4. W PROMOS : une table de numéros énumérée, et le témoin de la carte ─────────────────────────────────────────────────────────────────────
const KAB = e(34844, 'Kabuto (50/62 Top Deck Magazine Special Print)', IMG('2021/07', 'EN_S044Special-Print.jpg'), 400, 553, [2332]);
const WAR = e(34847, 'Wartortle (63/130 Top Deck Magazine Special Print)', IMG('2021/07', 'EN_S047Special-Print.jpg'), 1296, 1802, [2332]);
const PIK = e(34841, 'Pikachu (60/64 Duelist Magazine Special Print)', IMG('2021/07', 'EN_S041Special-Print.jpg'), 323, 450, [5055]);
const P_KAB = prod(275590, 'W-Promos', 'Kabuto [Kabuto Armor | Scratch]', 'Kabuto-FO50', [imp('Fossil', '50', '62'), imp('W Promotional cards', null, null)]);
const P_WAR = prod(275593, 'W-Promos', 'Wartortle [Withdraw | Bite]', 'Wartortle-B263', [imp('Base Set', '42', '102'), imp('Base Set 2', '63', '130')]);
const P_ARB = prod(275587, 'W-Promos', 'Dark Arbok [Stare | Poison Vapor]', 'Dark-Arbok-TR19', [imp('Team Rocket', '2', '82'), imp('Team Rocket', '19', '82')]);
const LW = [ligne('w-promos')];
A = P.apparierFamille({ lignes: LW, produits: [P_KAB, P_WAR], index: [KAB, WAR] });
verifier('W Promos : Kabuto (Fossil 50/62) et Wartortle (Base Set 2 63/130, et non le 42/102 de Base Set) sont prouvés par leur numéro d\'origine ÉNUMÉRÉ et l\'impression de la carte', A.resultats.map(r => [r.idProduct, r.verdict, r.entree?.id]), [[275590, 'prouve', 34844], [275593, 'prouve', 34847]]);
verifier('W Promos : un produit hors de la table énumérée (Dark Arbok) n\'a pas de clé — « sans-numero-origine »', P.apparierFamille({ lignes: LW, produits: [P_ARB], index: [KAB] }).resultats[0].motif, 'sans-numero-origine');
A = P.apparierFamille({ lignes: LW, produits: [P_KAB], index: [e(34844, 'Kabuto (50/62 State Championships Special Print)', IMG('2021/07', 'EN_S044Special-Print.jpg'), 400, 553, [5091])] });
verifier('W Promos : un autre événement (State Championships), même nom, même numéro, même total, n\'est jamais admis', A.resultats[0].motif, 'non-couvert');
A = P.apparierFamille({ lignes: LW, produits: [{ ...P_KAB, impressions: [imp('Fossil', '50', '60')] }], index: [KAB] });
verifier('W Promos : le total de l\'impression (/60) contredit celui de l\'entrée (/62) — « impression-contredit »', A.resultats[0].motif, 'impression-contredit');

// ── 5. le PLAN : la GARDE « ligne non regardée », puis le seuil de largeur, COMPTÉ ───────────────────────────────────────────────────────────
const carte = (id, nomEn, images = []) => ({ _id: id, nomEn, images });
const cartes = new Map([[1, carte(1, 'Prinplup')], [2, carte(2, 'Turtwig')], [3, carte(3, 'Kabuto')], [4, carte(4, 'Pikachu')]]);
const P_TURT = prod(275630, BK08, 'Turtwig Lv.10 [Tackle | Razor Leaf]', 'Turtwig-Lv10-BKPR103', [imp('Diamond & Pearl', '103', '130')]);
const base = [{ ...P_PRIN, carteId: 1 }, { ...P_TURT, carteId: 2 }];
let plan = P.planifierFamilles({ lignes: LB, produits: base, cartes, index: [PRIN, TURT] });
verifier('GARDE : une ligne dont l\'image n\'a pas été REGARDÉE (lu = null) ne pose RIEN, ses produits sont des restes « ligne-non-regardee »', [plan.plan.length, plan.restes.map(r => r.motif).sort()], [0, ['ligne-non-regardee', 'ligne-non-regardee']]);
const REGARDEES = LB.map(l => ({ ...l, lu: '2026-10-17' }));
plan = P.planifierFamilles({ lignes: REGARDEES, produits: base, cartes, index: [PRIN, TURT] });
verifier('une fois la ligne regardée, Prinplup (400 px) est posé ; Turtwig (321 px, sous le seuil de 350) est écarté et COMPTÉ, jamais téléchargé', [plan.plan.map(p => [p.idProduct, p.ligne, p.numero, p.voie]), plan.restes.map(r => [r.motif, r.w]), plan.comptes.sousSeuil], [[[275625, 'bk-2008', '58', 'pokumon+nom+numero+bk']], [['sous-le-seuil', 321]], 1]);
verifier('la preuve du plan nomme l\'entrée, le produit, la ligne et sa marque', [/35491/.test(plan.plan[0].preuve), /Prinplup/.test(plan.plan[0].preuve), /bk-2008/.test(plan.plan[0].preuve), plan.plan[0].marque.startsWith('bk-2008')], [true, true, true, true]);
plan = P.planifierFamilles({ lignes: [ligne('w-promos'), ligne('prof'), ligne('prof-reverse'), ligne('tot-2022')], produits: [{ ...P_KAB, carteId: 3 }], cartes, index: [KAB] });
verifier('GARDE : la ligne « w-promos » non regardée ne pose rien non plus ; les lignes DÉJÀ regardées (prof, tot-2022) restent valides', [plan.plan.length, plan.restes.map(r => r.motif)], [0, ['ligne-non-regardee']]);
verifier('les lignes déjà posées restent regardées (lu = date) : mcd, tot, prof, bsp', P.LIGNES_AUTRES.filter(l => ['mcd', 'tot', 'prof', 'bsp'].includes(l.famille) && l.id !== 'prof-reverse').every(l => l.lu === '2026-10-17'), true);

console.log(`\n${ok} réussis, ${ko} échecs`);
process.exit(ko ? 1 : 0);
