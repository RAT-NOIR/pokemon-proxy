// node test-deduire-produit.js — banc de collecte-cartes/deduire-produit.js (l'idProduct d'une vignette sans image), sans base.
// Les cas viennent du journal 1.8 du 2026-09-26 (Shiinotic-V2-SUM17, Muk & Alolan Muk GX V4, Frozen City PLF12/100, Feraligatr PHF17P)
// et de la relecture par sous-agent du même soir (A, B, C : une déduction qui VOLERAIT le slug d'un autre produit — tous refusés).
// 🔑 La règle de numéro est la VRAIE (scoring.js, par le module) : la copie du premier banc rendait « 17P » là où la production rend
// « 17 », et le refus de PHF17P ne se voyait pas.
// ⚠️ SECONDE RELECTURE (2026-09-26, nuit, « revue propre : non ») : cas I à Q. Chacun a été vu ÉCHOUER sur le module d'avant.
// `slugsPortes` et `horsCatalogue` sont désormais OBLIGATOIRES dans le contexte : une garde qu'on oublie de passer ne doit pas se taire.
const { lireVignette, teteDuSlug, deduireProduit, deduireLot, varianteDuSlug } = require('./collecte-cartes/deduire-produit');
let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => { const a = JSON.stringify(obtenu), b = JSON.stringify(attendu); if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); } };
const vig = (slugSet, slug, titre) => lireVignette({ href: `/fr/Pokemon/Products/Singles/${slugSet}/${slug}`, titre });
const famille = (nom, ids) => ids.map(idProduct => ({ idProduct, name: nom }));
// Le contexte d'une déduction : les deux gardes globales (slug déjà porté ailleurs, catalogue en retard) à vide par défaut.
const ctx = o => ({ slugsPortes: new Set(), horsCatalogue: [], ...o });

(async () => {
    verifier('1. lireVignette : slug, slugSet, variante, nom, code et numéro du titre', lireVignette({ href: '/fr/Pokemon/Products/Singles/Sun-Moon/Shiinotic-V2-SUM17', titre: 'Lampignon  (SUM 17)' }),
        { href: '/fr/Pokemon/Products/Singles/Sun-Moon/Shiinotic-V2-SUM17', slugSet: 'Sun-Moon', slug: 'Shiinotic-V2-SUM17', variante: 'V2', nomFr: 'Lampignon', code: 'SUM', numero: '17' });
    const shiinotic = famille('Shiinotic [Calming Light | Spiral Rush]', [1, 2]);
    verifier('2. frère V1 appris au même numéro, lien V2, un seul non appris → déduit',
        deduireProduit(vig('Sun-Moon', 'Shiinotic-V2-SUM17', 'Lampignon (SUM 17)'), ctx({ produits: shiinotic, appris: new Map([[1, { slug: 'Shiinotic-V1-SUM17', numero: '17' }]]) })), { idProduct: 2, raison: null, exhaustion: false });
    verifier('3. deux produits non appris au même nom → rien', deduireProduit(vig('Sun-Moon', 'Shiinotic-V2-SUM17', 'Lampignon (SUM 17)'), ctx({ produits: shiinotic, appris: new Map() })).idProduct, null);
    verifier('4. titre et slug en désaccord (Frozen City PLF12, titre 100) → rien',
        deduireProduit(vig('Plasma-Freeze', 'Frozen-City-PLF12', 'Ville Gelée (PLF 100)'), ctx({ produits: famille('Frozen City', [9]), appris: new Map() })).idProduct, null);
    verifier('5. numéro à suffixe (PHF 17P, slug PHF17P) : la règle de scoring.js rend « 17 », les chiffres concordent → déduit',
        deduireProduit(vig('Phantom-Forces', 'Feraligatr-Theme-Deck-PHF17P', 'Aligatueur (Theme Deck) (PHF 17P)'), ctx({ produits: famille('Feraligatr (Theme Deck)', [281821]), appris: new Map() })).idProduct, 281821);
    const muk = famille('Muk & Alolan Muk GX [Nasty Goo Mix | Severe Poison | Nasty Goo Mix GX]', [11, 12, 13, 14]);
    const apprisMuk = () => new Map([[11, { slug: 'Muk-Alolan-Muk-GX-V1-AC3a052', numero: 'a052' }], [12, { slug: 'Muk-Alolan-Muk-GX-V2-AC3a226', numero: 'a226' }], [13, { slug: 'Muk-Alolan-Muk-GX-V3-AC3a227', numero: 'a227' }]]);
    const vMuk = vig('Tag-Team-Collection', 'Muk-Alolan-Muk-GX-V4-AC3a276', 'Muk & Alolan Muk GX (AC3 a276)');
    verifier('6. frères à d’autres numéros, variantes épuisées (V1-V3 appris, lien V4) → déduit par exhaustion', deduireProduit(vMuk, ctx({ produits: muk, appris: apprisMuk() })), { idProduct: 14, raison: null, exhaustion: true });
    const sansVariante = apprisMuk(); sansVariante.set(13, { slug: 'Muk-Alolan-Muk-GX-AC3a227', numero: 'a227' });
    verifier('7. frères à d’autres numéros, une variante illisible → rien', deduireProduit(vMuk, ctx({ produits: muk, appris: sansVariante })).idProduct, null);
    verifier('8. la ligne existante (sans slug) dit un autre numéro → rien, on ne corrige pas',
        deduireProduit(vig('Sun-Moon', 'Shiinotic-V2-SUM17', 'Lampignon (SUM 17)'), ctx({ produits: shiinotic, appris: new Map([[1, { slug: 'Shiinotic-V1-SUM17', numero: '17' }], [2, { numero: '18' }]]) })).idProduct, null);
    // ── LA RELECTURE : trois façons de VOLER un slug, toutes refusées
    const pika = famille('Pikachu [Thunder Shock]', [101, 102]);
    const apprisPika = new Map([[101, { slug: 'Pikachu-V1-SMP081', numero: '81' }]]);
    verifier('A. lien V1 dont le frère APPRIS porte déjà V1 (et ce slug) → refusé', deduireProduit(vig('SM-Promos', 'Pikachu-V1-SMP081', 'Pikachu (SMP 081)'), ctx({ produits: pika, appris: apprisPika })).idProduct, null);
    verifier('B. lien V3 pour une famille de 2 produits (produit neuf, absent de l\'export) → refusé', deduireProduit(vig('SM-Promos', 'Pikachu-V3-SMP081', 'Pikachu (SMP 081)'), ctx({ produits: pika, appris: apprisPika })).idProduct, null);
    verifier('C. lien V2 pour un seul Pikachu au catalogue → refusé', deduireProduit(vig('SM-Promos', 'Pikachu-V2-SMP081', 'Pikachu (SMP 081)'), ctx({ produits: famille('Pikachu [Thunder Shock]', [101]), appris: new Map() })).idProduct, null);
    verifier('D. lien SANS variante, deux produits du même nom (un appris au même numéro) → refusé', deduireProduit(vig('SM-Promos', 'Pikachu-SMP081', 'Pikachu (SMP 081)'), ctx({ produits: pika, appris: apprisPika })).idProduct, null);
    verifier('E. le slug est déjà celui d\'un produit appris de l\'expansion → refusé',
        deduireProduit(vig('Sun-Moon', 'Rowlet-SUM9', 'Brindibou (SUM 9)'), ctx({ produits: [{ idProduct: 5, name: 'Rowlet [Tackle]' }, { idProduct: 6, name: 'Rowlet Alt [Tackle]' }], appris: new Map([[6, { slug: 'Rowlet-SUM9', numero: '9' }]]) })).idProduct, null);
    verifier('F. un produit du LOT (lu avec son image, pas encore écrit) n\'est jamais candidat — sans l\'exclusion, il aurait été pris',
        [deduireProduit(vig('Sun-Moon', 'Shiinotic-V2-SUM17', 'Lampignon (SUM 17)'), ctx({ produits: shiinotic, appris: new Map([[1, { slug: 'Shiinotic-V1-SUM17', numero: '17' }]]), exclus: new Set([2]) })).idProduct,
         deduireProduit(vig('Sun-Moon', 'Shiinotic-V2-SUM17', 'Lampignon (SUM 17)'), ctx({ produits: shiinotic, appris: new Map([[1, { slug: 'Shiinotic-V1-SUM17', numero: '17' }]]) })).idProduct], [null, 2]);
    verifier('G. teteDuSlug : code + chiffre, ou code + numéro du titre ; « Professor-Shoji » sous sH reste « professor-shoji »',
        [teteDuSlug('Professor-Shoji', 'sH', '12'), teteDuSlug('Shiinotic-V2-SUM17', 'SUM', '17'), teteDuSlug('Muk-Alolan-Muk-GX-V4-AC3a276', 'AC3', 'a276'), teteDuSlug('Basic-Fighting-Energy-CSVH3CFIG', 'CSVH3C', 'FIG')],
        ['professor-shoji', 'shiinotic', 'muk-alolan-muk-gx', 'basic-fighting-energy']);
    verifier('H. une Énergie de base (« CSVH3C FIG ») seule de son nom → déduite',
        deduireProduit(vig('Happy-Set', 'Basic-Fighting-Energy-CSVH3CFIG', 'Énergie Combat de base (CSVH3C FIG)'), ctx({ produits: famille('Basic Fighting Energy', [852132]), appris: new Map() })).idProduct, 852132);

    // ── SECONDE RELECTURE (2026-09-26, nuit)
    // Point 1 : « Mewtwo-V-UNION-V3 » — la variante est en FIN de slug, et `-(V\d+)-` exigeait un tiret après : variante null, et
    // une famille d'un produit rendait la vignette déduite.
    verifier('I. variante en FIN de slug (« Mewtwo-V-UNION-V3 ») lue V3 ; famille d\'un seul produit → refusé',
        [varianteDuSlug('Mewtwo-V-UNION-V3'), varianteDuSlug('Pikachu-V-SWSH061'), varianteDuSlug('Shiinotic-V2-SUM17'),
         deduireProduit(vig('SWSH-Black-Star-Promos', 'Mewtwo-V-UNION-V3', 'Mewtwo V-UNION'), ctx({ produits: famille('Mewtwo V-UNION', [700]), appris: new Map() })).idProduct],
        ['V3', null, 'V2', null]);
    // Point 1 : la variante se RECALCULE depuis le slug — celle qu'un appelant passe ne compte pas (une seule source de la règle).
    verifier('J. la variante passée par l\'appelant (V1) est ignorée : le slug dit V2 → déduit',
        deduireProduit({ ...vig('Sun-Moon', 'Shiinotic-V2-SUM17', 'Lampignon (SUM 17)'), variante: 'V1' }, ctx({ produits: shiinotic, appris: new Map([[1, { slug: 'Shiinotic-V1-SUM17', numero: '17' }]]) })).idProduct, 2);
    // Point 4 : la garde GLOBALE de slug — un produit appris HORS de l'expansion (idExpansion null, absent du catalogue) porte ce slug.
    verifier('K. le slugSet|slug est porté par un produit appris HORS de la famille (garde globale) → refusé, raison écrite',
        (d => [d.idProduct, /déjà porté/.test(d.raison)])(deduireProduit(vig('Sun-Moon', 'Rowlet-SUM9', 'Brindibou (SUM 9)'), ctx({ produits: [{ idProduct: 5, name: 'Rowlet [Tackle]' }], appris: new Map(), slugsPortes: new Set(['Sun-Moon|Rowlet-SUM9']) }))),
        [null, true]);
    // Point 5 (a) : le catalogue est PROUVÉ en retard pour l'expansion — une ligne apprise porte un idProduct qu'il n'a pas. Le vrai
    // « Pikachu SVI 200 » peut y manquer, et le seul homonyme non appris (le n°25) serait pris.
    verifier('L. catalogue en retard (une ligne apprise de l\'expansion absente du catalogue) → refusé, raison écrite',
        (d => [d.idProduct, /catalogue en retard/.test(d.raison)])(deduireProduit(vig('Scarlet-Violet', 'Pikachu-SVI200', 'Pikachu (SVI 200)'), ctx({ produits: famille('Pikachu [Gnaw | Thunder Jolt]', [25]), appris: new Map(), horsCatalogue: [999001] }))),
        [null, true]);
    // Point 5 (b) : le numéro connu du candidat (sa ligne numeros_cartes sans slug : tcgdex, cardmarket d'avant le slug) contredit.
    verifier('M. le candidat porte déjà un numéro (ligne tcgdex n°025) que le lien contredit (SVI 200) → refusé',
        deduireProduit(vig('Scarlet-Violet', 'Pikachu-SVI200', 'Pikachu (SVI 200)'), ctx({ produits: famille('Pikachu [Gnaw | Thunder Jolt]', [25]), appris: new Map([[25, { numero: '025' }]]) })).idProduct, null);
    // Relecture par sous-agent : les deux témoins du numéro du candidat se couvraient l'un l'autre sur M et 8 — chacun a désormais un cas
    // où il est SEUL à refuser (retirer l'un des deux fait échouer son cas).
    verifier('M2. témoin par le TITRE seul : la ligne dit n°17, le titre « PHF 17P » (pas exact) — le slug, lui, concorde par ses chiffres → refusé',
        deduireProduit(vig('Phantom-Forces', 'Feraligatr-Theme-Deck-PHF17P', 'Aligatueur (Theme Deck) (PHF 17P)'), ctx({ produits: famille('Feraligatr (Theme Deck)', [281821]), appris: new Map([[281821, { numero: '17' }]]) })).idProduct, null);
    verifier('M3. témoin par le SLUG seul (titre sans numéro, slug « …-25 ») : la ligne dit n°26 → refusé ; n°25 → déduit',
        [deduireProduit(vig('Promos', 'Pikachu-25', 'Pikachu'), ctx({ produits: famille('Pikachu 25', [77]), appris: new Map([[77, { numero: '26' }]]) })).idProduct,
         deduireProduit(vig('Promos', 'Pikachu-25', 'Pikachu'), ctx({ produits: famille('Pikachu 25', [77]), appris: new Map([[77, { numero: '25' }]]) })).idProduct], [null, 77]);
    // Relecture par sous-agent : la route AGRÈGE les raisons en masquant «…» et les chiffres ; un numéro à lettres (« TG05 », « a052 »)
    // ou une liste d'ids de longueur variable faisait une clé par cas.
    const cle = r => String(r).replace(/«[^»]*»/g, '«…»').replace(/\d+/g, '#');
    const raison = (numLigne, numTitre) => deduireProduit(vig('Lost-Origin', `Pikachu-LOR${numTitre}`, `Pikachu (LOR ${numTitre})`), ctx({ produits: famille('Pikachu [Gnaw]', [9]), appris: new Map([[9, { numero: numLigne }]]) })).raison;
    const retard = ids => deduireProduit(vig('Lost-Origin', 'Pikachu-LOR5', 'Pikachu (LOR 5)'), ctx({ produits: famille('Pikachu [Gnaw]', [9]), appris: new Map(), horsCatalogue: ids })).raison;
    verifier('R2. les raisons s\'agrègent en UNE clé : numéros à lettres (TG05 / a052) et listes d\'ids de toute longueur',
        [cle(raison('TG05', 'TG06')) === cle(raison('a052', 'a053')), cle(retard([1])) === cle(retard([1, 2, 3, 4]))], [true, true]);
    // Point 5 : le RISQUE RÉSIDUEL, écrit tel quel — ni ligne du candidat, ni ligne hors catalogue : AUCUN témoin, la vignette est déduite.
    // Ce cas ne décrit pas un comportement voulu : il rend visible ce qu'aucune source en base ne peut empêcher (décision au testeur).
    verifier('N. RISQUE RÉSIDUEL (aucun témoin du numéro du candidat, catalogue non prouvé en retard) : le n°25 est pris pour SVI 200',
        deduireProduit(vig('Scarlet-Violet', 'Pikachu-SVI200', 'Pikachu (SVI 200)'), ctx({ produits: famille('Pikachu [Gnaw | Thunder Jolt]', [25]), appris: new Map() })).idProduct, 25);
    // Point 10 : un frère appris SANS variante (« Pikachu-SMP081 », appris quand il était seul) et un lien V1 : c'est lui, renommé —
    // la vignette partait vers l'AUTRE produit.
    verifier('O. la famille mélange un slug appris SANS variante et un lien V1 → refusé',
        (d => [d.idProduct, /mélange/.test(d.raison)])(deduireProduit(vig('SM-Promos', 'Pikachu-V1-SMP081', 'Pikachu (SMP 081)'), ctx({ produits: pika, appris: new Map([[101, { slug: 'Pikachu-SMP081', numero: '081' }]]) }))),
        [null, true]);
    // Une garde qu'on oublie de passer ne se tait pas : elle lève (§51, une garde s'écrit par ce qu'elle autorise).
    let leve = null; try { deduireProduit(vig('Sun-Moon', 'Rowlet-SUM9', 'Brindibou (SUM 9)'), { produits: [], appris: new Map() }); } catch (e) { leve = e.message; }
    verifier('P. deduireProduit sans `slugsPortes` ni `horsCatalogue` → lève', /slugsPortes/.test(leve || '') && /horsCatalogue/.test(leve || ''), true);

    // ── TROISIÈME RELECTURE (2026-09-26, nuit) — GRAVE, point 2 : le rang n'était confronté à la famille que pour le LIEN. En base,
    // « Vk ⇒ au moins k produits du nom au catalogue » est FAUX (505 slugs à variante dans une famille d'un produit, 487 rangs au-delà
    // de leur famille : le catalogue n'a pas toutes les variantes). Une famille qui ne peut pas porter ses variantes ne désigne rien.
    verifier('S1. un frère appris porte V3 dans une famille de 2, lien V1 au même numéro → refusé (famille incomplète)',
        (d => [d.idProduct, /famille/.test(d.raison || '')])(deduireProduit(vig('SM-Promos', 'Pikachu-V1-SMP081', 'Pikachu (SMP 081)'), ctx({ produits: pika, appris: new Map([[101, { slug: 'Pikachu-V3-SMP081', numero: '81' }]]) }))),
        [null, true]);
    verifier('S2. lien V1 et un seul produit du nom au catalogue → refusé (une variante suppose au moins deux produits)',
        deduireProduit(vig('SM-Promos', 'Pikachu-V1-SMP081', 'Pikachu (SMP 081)'), ctx({ produits: famille('Pikachu [Thunder Shock]', [101]), appris: new Map() })).idProduct, null);
    // Trois gardes que retirer ne faisait échouer AUCUN cas (mutations de la relecture) : chacune a désormais le sien, où elle refuse SEULE.
    verifier('T1. variante déjà portée par un frère appris sous un AUTRE slug (même numéro) → refusé par cette garde seule',
        (d => [d.idProduct, /déjà portée/.test(d.raison || '')])(deduireProduit(vig('SM-Promos', 'Pikachu-V1-SMP081', 'Pikachu (SMP 081)'), ctx({ produits: pika, appris: new Map([[101, { slug: 'Pikachu-V1-SMP81', numero: '81' }]]) }))),
        [null, true]);
    // IMPORTANT (troisième relecture) : une vraie lecture du produit DÉDUIT lui-même réécrivait la ligne en silence (« améliorée ») — la
    // précision de la déduction ne se mesurait nulle part. La réécriture dit maintenant, sur la ligne, ce que la déduction avait mis.
    const { majLectureExacte } = require('./collecte-cartes/deduire-produit');
    const exDed = { source: 'cardmarket-deduit', certitude: 'deduite', slug: 'Aaa-SUM5', slugSet: 'Sun-Moon', numero: '5' };
    const relue = c => majLectureExacte(c, { idExpansion: 1745, codeSet: 'SUM', existant: exDed }).$set.deductionRelue;
    verifier('U. relecture d\'une ligne déduite : concorde (même slug, même numéro) / contredite (autre slug) / numéro seul lu (/api/apprendre) / ligne non déduite : rien',
        [relue({ idProduct: 9, slug: 'Aaa-SUM5', slugSet: 'Sun-Moon', numero: '5' })?.concorde, relue({ idProduct: 9, slug: 'Bbb-SUM6', slugSet: 'Sun-Moon', numero: '6' })?.concorde,
         relue({ idProduct: 9, numero: '005' })?.concorde, relue({ idProduct: 9, numero: '7' })?.concorde,
         majLectureExacte({ idProduct: 9, numero: '5' }, { idExpansion: 1, codeSet: 'SUM', existant: { source: 'tcgdex', numero: '5' } }).$set.deductionRelue,
         relue({ idProduct: 9, slug: null, numero: '5' })?.concorde],
        [true, false, true, false, undefined, true]);
    verifier('T2. frère appris à un autre numéro, variantes non épuisées (famille de 3, un seul V1 appris, le 3e du lot) → refusé par l\'exhaustion seule',
        (d => [d.idProduct, /ne s'épuisent pas/.test(d.raison || '')])(deduireProduit(vig('SM-Promos', 'Pikachu-V2-SMP082', 'Pikachu (SMP 082)'), ctx({ produits: famille('Pikachu [Thunder Shock]', [101, 102, 103]), appris: new Map([[101, { slug: 'Pikachu-V1-SMP081', numero: '81' }]]), exclus: new Set([103]) }))),
        [null, true]);

    // deduireLot : lecteurs injectés, un lot de vignettes
    const deps = {
        expansionsDuSlugSet: async s => (s === 'Sun-Moon' ? [1745] : s === 'Double' ? [1, 2] : []),
        produitsDe: async () => famille('Shiinotic [Calming Light | Spiral Rush]', [1, 2, 3]),
        apprisDe: async () => new Map([[1, { slug: 'Shiinotic-V1-SUM17', numero: '17' }]]),
        slugsPortes: async () => new Set(),
        idsApprisDeLExpansion: async () => [1],
        idsAuCatalogue: async ids => new Set(ids)
    };
    const lot = [{ idProduct: null, slug: 'Shiinotic-V2-SUM17', slugSet: 'Sun-Moon', codeSet: 'SUM', numero: '17', variante: 'V2', sansImage: true },
        { idProduct: null, slug: 'Shiinotic-V3-SUM17', slugSet: 'Sun-Moon', codeSet: 'SUM', numero: '17', variante: 'V3', sansImage: true },
        { idProduct: null, slug: 'Aaa-X1', slugSet: 'Double', codeSet: 'X', numero: '1', sansImage: true }];
    const r = await deduireLot(lot, deps);
    verifier('9. deduireLot : deux candidats non appris → rien ; slugSet de deux expansions → refusé', [r.deduites.length, r.refus.map(x => x.raison.replace(/«[^»]*»/g, '«…»')).sort()],
        [0, ['2 produits non appris au nom «…»', '2 produits non appris au nom «…»', 'slugSet «…» porté par 2 expansions apprises']]);
    const r2 = await deduireLot(lot.slice(0, 1), { ...deps, produitsDe: async () => famille('Shiinotic [Calming Light | Spiral Rush]', [1, 2]) });
    verifier('10. deduireLot : une vignette seule → déduite, avec son expansion et le numéro du slug par scoring.js', r2.deduites.map(x => [x.idProduct, x.idExpansion, x.carte.slug, x.numeroUrl]), [[2, 1745, 'Shiinotic-V2-SUM17', '17']]);
    const r3 = await deduireLot(lot.slice(0, 1), { ...deps, produitsDe: async () => famille('Shiinotic [Calming Light | Spiral Rush]', [1, 2]), exclus: new Set([2]) });
    verifier('11. deduireLot : le produit restant est dans le lot (exclus) → rien', r3.deduites.length, 0);
    // Point 4 et 5 (a) par deduireLot : les lecteurs globaux sont appelés et leurs refus écrits.
    const r4 = await deduireLot(lot.slice(0, 1), { ...deps, produitsDe: async () => famille('Shiinotic [Calming Light | Spiral Rush]', [1, 2]), slugsPortes: async () => new Set(['Sun-Moon|Shiinotic-V2-SUM17']) });
    verifier('Q1. deduireLot : slugSet|slug déjà porté en base (lecteur global) → refusé', [r4.deduites.length, /déjà porté/.test(r4.refus[0]?.raison || '')], [0, true]);
    const r5 = await deduireLot(lot.slice(0, 1), { ...deps, produitsDe: async () => famille('Shiinotic [Calming Light | Spiral Rush]', [1, 2]), idsApprisDeLExpansion: async () => [1, 555555], idsAuCatalogue: async () => new Set([1]) });
    verifier('Q2. deduireLot : une ligne apprise de l\'expansion (555555) absente du catalogue → refusé « catalogue en retard »', [r5.deduites.length, /catalogue en retard/.test(r5.refus[0]?.raison || '')], [0, true]);
    // Les cartes-code sont retirées par le module (estCarteCode, une définition) : l'appelant peut passer le catalogue brut.
    const r6 = await deduireLot(lot.slice(0, 1), { ...deps, produitsDe: async () => [...famille('Shiinotic [Calming Light | Spiral Rush]', [1, 2]), { idProduct: 8, name: 'Shiinotic [Online Code Card]' }] });
    verifier('Q3. deduireLot : une carte-code du catalogue brut ne compte pas dans la famille → déduit', r6.deduites.map(x => x.idProduct), [2]);
    let leveLot = null; try { await deduireLot(lot.slice(0, 1), { expansionsDuSlugSet: deps.expansionsDuSlugSet, produitsDe: deps.produitsDe, apprisDe: deps.apprisDe }); } catch (e) { leveLot = e.message; }
    verifier('Q4. deduireLot sans les lecteurs des gardes globales → lève en les nommant', ['slugsPortes', 'idsApprisDeLExpansion', 'idsAuCatalogue'].every(k => (leveLot || '').includes(k)), true);
    const r7 = await deduireLot([lot[0], { ...lot[0] }], { ...deps, produitsDe: async () => famille('Shiinotic [Calming Light | Spiral Rush]', [1, 2]) });
    verifier('T3. deduireLot : deux vignettes désignent le même produit → aucune ne le prend (garde du doublon, seule)',
        [r7.deduites.length, r7.refus.filter(x => /vignettes désignent le produit/.test(x.raison)).length], [0, 2]);
    // Point 10 : apprendre-journal.js ne lisait que `detailEcartees` (1.8) ; un journal 1.9 porte ses sans-image dans `detailSansImage`.
    const { vignettesDuJournal } = require('./collecte-cartes/deduire-produit');
    const IND = 'src=//static.cardmarket.com/img/x/cardImageNotAvailable.png';
    const jr = typeof vignettesDuJournal === 'function' ? vignettesDuJournal({ journal: [
        { v: '1.8', detailEcartees: [{ href: '/fr/Pokemon/Products/Singles/Sun-Moon/Shiinotic-V2-SUM17', titre: 'Lampignon (SUM 17)', image: [IND] }, { href: '/fr/Pokemon/Products/Singles/Sun-Moon/Eee-SUM5', titre: 'Eee (SUM 5)', image: ['src=https://static.cardmarket.com/img/noimage.png'] }] },
        { v: '1.9', detailEcartees: [], detailSansImage: [{ href: '/fr/Pokemon/Products/Singles/Sun-Moon/Rowlet-SUM9', titre: 'Brindibou (SUM 9)' }, { href: '/fr/Pokemon/Products/Singles/Sun-Moon/Shiinotic-V2-SUM17', titre: 'Lampignon (SUM 17)' }] }] }) : null;
    verifier('R. vignettesDuJournal : les sans-image de detailEcartees (1.8, « cardImageNotAvailable ») ET de detailSansImage (1.9), comptées chacune, dédoublonnées par lien',
        jr && [jr.vignettes.map(x => x.slug), jr.comptes], [['Shiinotic-V2-SUM17', 'Rowlet-SUM9'], { detailEcartees: 1, detailSansImage: 1, autresImages: 1, doublons: 1, sansLien: 0 }]);
    const jr2 = vignettesDuJournal({ journal: [{ v: '1.8', detailEcartees: [{ href: '', titre: 'Zzz (DRI 099)', image: [IND] }] }] });
    verifier('R3. une entrée de journal SANS lien est comptée (sansLien), pas ignorée en silence', [jr2.vignettes.length, jr2.comptes.sansLien], [0, 1]);
    console.log(`\n${ok} passés, ${ko} en échec`);
    process.exit(ko ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
