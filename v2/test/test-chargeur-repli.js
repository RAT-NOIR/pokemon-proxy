'use strict';
// REPLI-REIMPRESSIONS — le PRODUCTEUR de l'archive (v2/chargeur/decision.js) :
//   (1) une liste FERMÉE de familles qui ne reçoivent JAMAIS l'image d'un autre tirage (30th Celebration, Prize Packs, WCD, tamponnées nommées, « League Staff ») : pas d'entrée, comptée par famille ;
//   (2) imageEmprunteeTirage : jamais servie, même quand l'image est celle du set ;
//   (3) les marquages lus sur l'entrée cartes.images servie, portés par l'entrée de CHAQUE produit concerné ; basseDefinition gardée ; la variante des cartes_produits.
// Pas de base, pas de réseau : decider reçoit des tableaux fabriqués ; la règle du site est la règle EMBARQUÉE.
const H = require('./_harnais');
const { decider, FAMILLES_SANS_REPLI, EXCLURE_BASSE_DEFINITION, partageIncoherent } = require('../chargeur/decision');
const { regleEmbarquee } = require('../chargeur/regle-site');
const { lireEntree } = require('../identifier/visuels');

(async () => {
    const regle = await regleEmbarquee();
    const set = (id, exp, extra = {}) => ({ _id: id, idExpansion: exp, code: id.slice(0, 4), nomAffichage: id.replace(/-/g, ' '), tirage: 'intl', region: 'intl', bulba: { expansion: id.replace(/-/g, ' ') }, ...extra });
    const imp = (setId, numero) => ({ tirage: 'intl', expansion: setId.replace(/-/g, ' '), numero, total: '100', rarete: 'Rare' });
    const vig = n => ({ cleR2: `vignettes/${n}.webp`, w: 200, h: 279 });
    const im = (setId, numero, n, o = {}) => ({ set: setId, numero, cleR2: `cartes/${n}.webp`, w: 600, h: 838, vignette: vig(n), langue: 'en', source: 'tcgdex', ...o });
    const carte = (id, setId, numero, images = [], extraSets = []) => ({ _id: id, nomEn: `Carte ${id}`, categorie: 'pokemon', sets: [setId, ...extraSets], impressions: [imp(setId, numero)], images });
    const exps = { 'Set-A': 100, 'Set-B': 200, '30th-Celebration': 6601, 'WCD-2024': 5992, 'Play-Pokemon-Prize-Pack-Series-One': 5204, 'Play-Pokemon-Prize-Pack-Series-Five': 5849,
        'Battle-Academy-2024': 5890, 'Trick-or-Trade-2024': 5796, 'Trick-or-Trade-2023': 5405, 'WCD-2026': 7001, '30th-Foo': 7002, 'Play-Pokemon-Prize-Pack-Series-Ten': 7003 };
    const sets = Object.entries(exps).map(([id, e]) => set(id, e));
    const ligne = (id, carteId, setId, numeroFiche, o = {}) => ({ idProduct: id, carteId, idExpansion: exps[setId], numeroFiche, slug: `P${id}-X${numeroFiche}`, slugSet: setId, ...o });
    const SUBST = (o = {}) => ({ cleR2: 'cartes/orig.webp', w: 600, h: 838, set: 'Set-B', mention: 'Visuel de la carte d\'origine (Set B) — pas celui de ce produit', ...o });
    const AUTRE = n => [im('Set-B', '001', n)];                       // la carte n'a pas d'image dans son set mais une dans Set-B : « autre tirage »
    const docs = [
        { ...carte(10, 'Set-B', '001', [im('Set-B', '001', 'orig')]) },                                   // porte le fichier du substitut (vignette)
        carte(1, 'Set-A', '001', [im('Set-A', '001', 'c1')]),                                             // contrôle : du set
        { ...carte(2, 'Set-A', '002', AUTRE('c2b')), sets: ['Set-A', 'Set-B'] },                         // contrôle : AUTRE TIRAGE hors famille => servi (comme avant)
        carte(3, 'Set-A', '003', []),                                                                     // contrôle : substitut hors famille => servi
        { ...carte(20, '30th-Celebration', '004', AUTRE('c20b')), sets: ['30th-Celebration', 'Set-B'] },   // 30th : autre tirage => PAS servi
        carte(21, '30th-Celebration', '005', [im('30th-Celebration', '005', 'c21')]),                    // 30th : son propre scan => servi
        carte(22, 'WCD-2024', '006', []),                                                                 // WCD : substitut => PAS servi
        carte(23, 'Play-Pokemon-Prize-Pack-Series-One', '007', [im('Play-Pokemon-Prize-Pack-Series-One', '007', 'c23', { partageeHoloNonHolo: true, produitsPartages: [2301, 2302], basseDefinition: true })]),
        carte(24, 'Play-Pokemon-Prize-Pack-Series-Five', '008', []),                                      // Prize Pack S5 : substitut => PAS servi
        carte(25, 'Set-A', '009', [im('Set-A', '009', 'c25', { imageEmprunteeTirage: true })]),           // image du set mais EMPRUNTÉE : PAS servie
        carte(26, 'Set-A', '010', []),                                                                    // substitut EMPRUNTÉ hors famille : PAS servi
        carte(27, 'Battle-Academy-2024', '011', []),                                                      // tamponnée nommée : substitut => PAS servi
        carte(28, 'Trick-or-Trade-2024', '012', []),                                                      // tamponnée nommée
        carte(29, 'Trick-or-Trade-2023', '013', []),                                                      // NON nommée : substitut servi
        { ...carte(30, 'Set-A', '014', AUTRE('c30b')), sets: ['Set-A', 'Set-B'] },                         // slug « League-Staff » : autre tirage => PAS servi
        carte(31, 'Set-A', '015', [im('Set-A', '015', 'c31', { partageeTamponNonSepare: true, produitsPartages: [3101, 3102], tamponNonRepresente: 'Staff' })]),
        carte(32, 'Set-A', '016', [im('Set-A', '016', 'c32', { partageeTamponNonSepare: false, produitsPartages: [3201, 3202], tamponNonRepresente: 'Play! Pokémon' })]),
        { ...carte(33, 'WCD-2026', '017', AUTRE('c33b')), sets: ['WCD-2026', 'Set-B'] },                   // une famille qui RESSEMBLE à une listée mais n'y est pas : servie, et SIGNALÉE
        { ...carte(34, '30th-Foo', '018', AUTRE('c34b')), sets: ['30th-Foo', 'Set-B'] },
        { ...carte(35, 'Play-Pokemon-Prize-Pack-Series-Ten', '019', AUTRE('c35b')), sets: ['Play-Pokemon-Prize-Pack-Series-Ten', 'Set-B'] }
    ];
    const lignes = [
        ligne(1001, 1, 'Set-A', '001'), ligne(1002, 2, 'Set-A', '002'), ligne(1003, 3, 'Set-A', '003', { visuelSubstitut: SUBST() }),
        ligne(2001, 20, '30th-Celebration', '004'), ligne(2002, 21, '30th-Celebration', '005'),
        ligne(2003, 22, 'WCD-2024', '006', { visuelSubstitut: SUBST({ set: 'Pokemon-GO' }) }),
        ligne(2301, 23, 'Play-Pokemon-Prize-Pack-Series-One', '007', { variante: 'staff', variantePreuve: 'étiquette Staff Version' }), ligne(2302, 23, 'Play-Pokemon-Prize-Pack-Series-One', '007', { variante: 'zzz' }),
        ligne(2303, 23, 'Play-Pokemon-Prize-Pack-Series-One', '007'),                                    // même carte, même fiche, mais PAS dans produitsPartages
        ligne(2004, 24, 'Play-Pokemon-Prize-Pack-Series-Five', '008', { visuelSubstitut: SUBST() }),
        ligne(2005, 25, 'Set-A', '009'), ligne(2006, 26, 'Set-A', '010', { visuelSubstitut: SUBST({ imageEmprunteeTirage: true }) }),
        ligne(2007, 27, 'Battle-Academy-2024', '011', { visuelSubstitut: SUBST() }), ligne(2008, 28, 'Trick-or-Trade-2024', '012', { visuelSubstitut: SUBST() }),
        ligne(2009, 29, 'Trick-or-Trade-2023', '013', { visuelSubstitut: SUBST() }),
        ligne(3000, 30, 'Set-A', '014', { slug: 'Zapdos-League-Staff-s014' }),
        ligne(3101, 31, 'Set-A', '015', { variante: 'normale', variantePreuve: 'p' }), ligne(3102, 31, 'Set-A', '015', { variante: 'staff', variantePreuve: 'p' }),
        ligne(3201, 32, 'Set-A', '016', { variante: 'normale', variantePreuve: 'p' }), ligne(3202, 32, 'Set-A', '016', { variante: 'jumbo' }),
        ligne(4001, 33, 'WCD-2026', '017'), ligne(4002, 34, '30th-Foo', '018'), ligne(4003, 35, 'Play-Pokemon-Prize-Pack-Series-Ten', '019')
    ];
    const metacarte = new Map(lignes.map((l, i) => [l.idProduct, 9000 + i]));
    const r = await decider({ sets, docs, lignes, metacarte, regle });
    const e = id => r.entrees.find(x => x.idProduct === id);
    const d = r.denominateurs;

    // ── (1) les familles
    H.v('1a. contrôle : un autre tirage HORS famille est servi, avec sa mention (comme avant)', [e(1002).visuel, /Set B/.test(e(1002).mention || '')], ['autre-tirage', true]);
    H.v('1b. contrôle : un substitut hors famille est servi', e(1003).visuel, 'substitut');
    H.v('1c. 30th : l\'image d\'un AUTRE tirage n\'est pas servie (pas d\'entrée)', e(2001), undefined);
    H.v('1d. 30th : son propre scan reste servi', e(2002).visuel, 'du-set');
    H.v('1e. WCD : un substitut (autre tirage) n\'est pas servi', e(2003), undefined);
    H.v('1f. Prize Pack S5 : un substitut n\'est pas servi', e(2004), undefined);
    H.v('1g. tamponnées nommées (Battle Academy 2024, Trick or Trade 2024) : substitut non servi', [e(2007), e(2008)], [undefined, undefined]);
    H.v('1h. Trick or Trade 2023 (NON nommée) : le substitut reste servi', e(2009).visuel, 'substitut');
    H.v('1i. « League Staff » dans le slug Cardmarket (tamponnée par son nom) : l\'autre tirage n\'est pas servi', e(3000), undefined);
    H.v('1j. une famille qui ressemble à une listée sans l\'être (WCD-2026, 30th-Foo, Prize Pack Series Ten) : servie comme avant, mais SIGNALÉE', [e(4001).visuel, e(4002).visuel, e(4003).visuel, d.familleHorsListe.slice().sort()],
        ['autre-tirage', 'autre-tirage', 'autre-tirage', ['30th-Foo', 'Play-Pokemon-Prize-Pack-Series-Ten', 'WCD-2026']]);
    H.v('1k. compteur nommé, par famille : 30th 1, WCD 1, Prize Packs 1, tamponnées nommées 2, League Staff (staff-prerelease) 1',
        [d.repliRefuse.parFamille['30th-celebration'], d.repliRefuse.parFamille.wcd, d.repliRefuse.parFamille['prize-packs'], d.repliRefuse.parFamille['tamponnees-nommees'], d.repliRefuse.parFamille['staff-prerelease']], [1, 1, 1, 2, 1]);
    H.v('1l. les listes fermées sont gelées et nommées', [Object.isFrozen(FAMILLES_SANS_REPLI), Object.keys(FAMILLES_SANS_REPLI).sort()], [true, ['30th-celebration', 'prize-packs', 'tamponnees-nommees', 'wcd']]);
    H.v('1m. la liste fermée porte 8 sets 30th, 9 Prize Packs, 20 WCD, 4 tamponnées nommées',
        [FAMILLES_SANS_REPLI['30th-celebration'].length, FAMILLES_SANS_REPLI['prize-packs'].length, FAMILLES_SANS_REPLI.wcd.length, FAMILLES_SANS_REPLI['tamponnees-nommees'].length], [8, 9, 20, 4]);

    // ── (2) imageEmprunteeTirage : jamais servie
    H.v('2a. une image du SET marquée imageEmprunteeTirage n\'est pas servie', e(2005), undefined);
    H.v('2b. un substitut marqué imageEmprunteeTirage n\'est pas servi', e(2006), undefined);
    H.v('2c. compteur nommé : 2 empruntées', d.repliRefuse.parFamille['image-empruntee'], 2);
    H.v('2d. le total des refus = familles (5) + staff (1) + empruntées (2)', d.repliRefuse.total, 8);

    // ── (3) les marquages
    H.v('3a. Prize Pack S1 : holo/non-holo + la liste, sur le produit CONCERNÉ', [e(2301).partageeHoloNonHolo, e(2301).produitsPartages, e(2301).basseDefinition], [true, [2301, 2302], true]);
    H.v('3b. l\'autre produit de la paire porte les mêmes marquages', [e(2302).partageeHoloNonHolo, e(2302).produitsPartages], [true, [2301, 2302]]);
    H.v('3c. m2 : un produit servi par la même image mais ABSENT de la liste n\'est PAS servi (fermé par défaut), compté', [e(2303), d.partageIncoherent], [undefined, 1]);
    H.v('3d. tampon non séparé : le tampon que le scan ne montre pas est porté', [e(3101).partageeTamponNonSepare, e(3101).tamponNonRepresente, e(3101).produitsPartages], [true, 'Staff', [3101, 3102]]);
    H.v('3e. paire SÉPARÉE : false est gardé (jamais ramené à null), la liste aussi', [e(3201).partageeTamponNonSepare, e(3201).tamponNonRepresente, e(3202).produitsPartages], [false, 'Play! Pokémon', [3201, 3202]]);
    H.v('3f. la variante est portée avec sa preuve (staff, normale) ; sans variantePreuve (3202 jumbo) : null et comptée (m3) ; inconnue ("zzz") : null', [e(2301).variante, e(2302).variante, e(3101).variante, e(3102).variante, e(3202).variante, d.varianteSansPreuve], ['staff', null, 'normale', 'staff', null, 1]);
    H.v('3g. un produit ordinaire : cinq champs nuls', [e(1001).partageeHoloNonHolo, e(1001).partageeTamponNonSepare, e(1001).produitsPartages, e(1001).tamponNonRepresente, e(1001).basseDefinition, e(1001).variante], [null, null, null, null, null, null]);
    H.v('3h. compteurs nommés : 5 produits partagés, dont 2 holo/non-holo (+ 1 hors liste servi sans partage) ; 4 tampons ; 3 basse définition',
        [d.marquees.partages, d.marquees.holo, d.marquees.tampon, d.marquees.basse], [6, 2, 4, 2]);
    const lues = r.entrees.map(x => lireEntree(JSON.parse(JSON.stringify(x))));
    const motifs = {}; for (const x of lues) if (!x.ok) motifs[x.motif] = (motifs[x.motif] || 0) + 1;
    H.v('3i. toutes les entrées émises passent la validation d\'entrée (aucun refus)', motifs, {});

    // ── la règle du site n'a pas bougé pour ce qui n'est pas concerné : les entrées des produits hors familles sont celles d'avant
    const sans = await decider({ sets: sets.filter(x => ['Set-A', 'Set-B'].includes(x._id)), docs, lignes: lignes.filter(l => [1001, 1002, 1003].includes(l.idProduct)), metacarte: new Map([[1001, 1], [1002, 2], [1003, 3]]), regle });
    H.v('4a. un jeu sans aucune famille : aucune entrée refusée, aucun signalement', [sans.entrees.length, sans.denominateurs.repliRefuse.total, sans.denominateurs.familleHorsListe], [3, 0, []]);
    // ── (5) la LECTURE de `cartes` rapporte ces champs (sans eux, rien de ce qui précède n'arrive jusqu'au producteur)
    const S = require('../chargeur/source');
    const c = S.compacterCarte({ _id: 1, nomEn: 'x', sets: ['A'], impressions: [], images: [{ set: 'A', cleR2: 'k', w: 1, h: 2, partageeHoloNonHolo: true, partageeTamponNonSepare: false, produitsPartages: [1, 2], tamponNonRepresente: 'Staff', basseDefinition: true, imageEmprunteeTirage: true }] }, S.interneur());
    H.v('5a. compacterCarte garde les six champs de l\'image servie', [c.images[0].partageeHoloNonHolo, c.images[0].partageeTamponNonSepare, c.images[0].produitsPartages, c.images[0].tamponNonRepresente, c.images[0].basseDefinition, c.images[0].imageEmprunteeTirage], [true, false, [1, 2], 'Staff', true, true]);
    H.v('5b. compacterLigne garde la variante', S.compacterLigne({ carteId: 1, idProduct: 2, idExpansion: 3, numeroFiche: '1', slug: 's', slugSet: 'S', variante: 'staff' }, S.interneur()).variante, 'staff');
    H.v('5c. la projection de `cartes` nomme les six champs d\'image et celle de `cartes_produits` la variante',
        [['partageeHoloNonHolo', 'partageeTamponNonSepare', 'produitsPartages', 'tamponNonRepresente', 'basseDefinition', 'imageEmprunteeTirage'].every(k => S.PROJECTIONS.cartes[`images.${k}`] === 1), S.PROJECTIONS.cartes_produits.variante], [true, 1]);
    // ── (6) le producteur de bout en bout : le calcul de l'API écrit la colonne des marquages, même quand rien n'est marqué
    const { calculer } = require('../chargeur/calcul');
    const cal = await calculer({ sets, docs, lignes, metacarte, regle });
    H.v('6a. calculer : la version porte la colonne des marquages et ses comptes', [cal.version.colonneMarquages, cal.version.comptes.marquees, cal.comptes.repliRefuse.total], [true, { holo: 2, tampon: 4, partages: 6, basse: 2, melange: 0 }, 8]);
    const vide = await calculer({ sets: sets.filter(x => ['Set-A', 'Set-B'].includes(x._id)), docs, lignes: lignes.filter(l => l.idProduct === 1001), metacarte: new Map([[1001, 1]]), regle });
    H.v('6b. rien de marqué : la colonne est quand même là (« aucun » est une réponse, l\'absence de colonne n\'en est pas une)', [vide.version.colonneMarquages, vide.version.comptes.marquees, vide.version.partagesDe(1001)], [true, { holo: 0, tampon: 0, partages: 0, basse: 0, melange: 0 }, []]);
    // ── (7) basseDefinition : la constante nommée, les deux valeurs
    H.v('7a. la constante livrée est false (gardées) ; par défaut les entrées basseDefinition sont servies et comptées à 0 exclue', [EXCLURE_BASSE_DEFINITION, d.basseDefinitionExclue, e(2301).basseDefinition], [false, 0, true]);
    const ex = await decider({ sets, docs, lignes, metacarte, regle, exclureBasseDefinition: true });
    const f = id => ex.entrees.find(x => x.idProduct === id);
    H.v('7b. true : les trois produits dont l\'image est basseDefinition ne sont plus servis, comptés ; les autres inchangés', [f(2301), f(2302), f(2303), ex.denominateurs.basseDefinitionExclue, f(1001) !== undefined, f(3101) !== undefined], [undefined, undefined, undefined, 3, true, true]);
    H.v('7c. true : le reste des entrées est identique à false', JSON.stringify(ex.entrees) === JSON.stringify(r.entrees.filter(x => ![2301, 2302, 2303].includes(x.idProduct))), true);
    H.v('7d. m2 : cohérent / liste sans marquage / holo false avec liste / marquage sans liste / produit absent de la liste / image ordinaire',
        [partageIncoherent({ partageeHoloNonHolo: true, produitsPartages: [1, 2] }, 1), partageIncoherent({ produitsPartages: [1, 2] }, 1), partageIncoherent({ partageeHoloNonHolo: false, produitsPartages: [1, 2] }, 1), partageIncoherent({ partageeTamponNonSepare: false }, 1),
            partageIncoherent({ partageeTamponNonSepare: true, produitsPartages: [2, 3] }, 1), partageIncoherent({ basseDefinition: true }, 1)], [false, true, true, true, true, false]);
    // ── (8) « source » et « retirable » du catalogue : jamais dans l'archive, jamais lus au-delà du choix interne
    H.v('8a. aucune entrée émise ne porte source ni retirable ; la projection ne lit pas retirable', [r.entrees.some(x => 'source' in x || 'retirable' in x), 'images.retirable' in S.PROJECTIONS.cartes, 'retirable' in S.PROJECTIONS.cartes_produits], [false, false, false]);
    H.v('8b. la version relue n\'expose ni source ni retirable', [Object.keys(cal.version.entree(1001)).filter(k => /source|retirable/.test(k))], [[]]);
    H.bilan();
})().catch(e => { console.error('❌', e); process.exit(1); });
