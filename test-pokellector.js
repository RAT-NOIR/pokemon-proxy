// node test-pokellector.js — LE MODULE PUR de la source POKELLECTOR (collecte-cartes/pokellector.js), lot POKELLECTOR (2026-10-17).
// Aucune requête, aucune base : les FIXTURES RÉELLES de la sonde du 2026-10-17 (fixtures/pokellector/ : liste des sets, page de set Twilight Masquerade, deux pages de carte,
// la collection Trick or Trade 2024, un panneau de détail, trois images dont les dimensions ont été lues sur les fichiers) + des relevés fabriqués.
// Ce que le banc garde :
//   · une adresse d'image n'est valable que sur l'hôte d'images, en https, sous la forme pleine taille (« .png » sans « .thumb ») ou « .mobile.jpg » du panneau de détail ;
//     une vignette (« .thumb »), un autre hôte, un paramètre, une remontée, sont REFUSÉS ; une adresse CONSTRUITE (absente de toute page lue) est refusée par le plan ;
//   · l'appariement exige set + numéro + nom (ou, pour une collection, code d'origine + numéro + nom) ; un doute est un trou avec son motif ;
//   · un produit déjà couvert par une source plus grande est sauté ; la langue et la traçabilité ne nomment pas la source dans un champ public.
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const P = require('./collecte-cartes/pokellector');

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); }
};
const FX = path.join(__dirname, 'fixtures', 'pokellector');
const lire = f => fs.readFileSync(path.join(FX, f), 'utf8');
const IMG = 'https://den-cards.pokellector.com/392';
const ID = (n, c, num, id, f = '.png') => `${IMG}/${n}.${c}.${num}.${id}${f}`;

(async () => {
    // ── 1. l'adresse d'image ────────────────────────────────────────────────────────────────────────────────────────────
    verifier('adresse : la forme pleine taille de la sonde (570×792) est valable et se lit', [P.urlImageValide(ID('Fezandipiti', 'TWM', 96, 53249)), P.analyserNomImage('Fezandipiti.TWM.96.53249.png')],
        [true, { nom: 'Fezandipiti', code: 'TWM', numero: '96', cardId: '53249', forme: 'plein' }]);
    verifier('adresse : la forme « .mobile.jpg » du panneau de détail (570×797) est valable', P.urlImageValide(ID('Fezandipiti', 'TWM', 96, 54075, '.mobile.jpg')), true);
    verifier('adresse : un nom à plusieurs mots et à point se lit (Scream-Tail-ex, Mr.-Mime)', [P.analyserNomImage('Scream-Tail-ex.TWM.94.53247.png')?.nom, P.analyserNomImage('Mr.-Mime.TWM.12.5.png')?.nom], ['Scream Tail ex', 'Mr. Mime']);
    const refusees = [[ID('Tangela', 'TWM', 1, 53158, '.thumb.png'), 'vignette « .thumb »'], [ID('Tangela', 'TWM', 1, 53158, '.thumb.jpg'), 'vignette jpg'], [ID('Fezandipiti', 'TWM', 96, 54075, '.jpg'), 'jpg sans .mobile'],
        [ID('Fezandipiti', 'TWM', 96, 53249, '.mobile.png'), 'mobile en png'], [`http://den-cards.pokellector.com/392/Fezandipiti.TWM.96.53249.png`, 'http clair'], [`https://www.pokellector.com/392/Fezandipiti.TWM.96.53249.png`, 'hôte des pages'],
        [`https://den-media.pokellector.com/logos/Twilight-Masquerade.logo.392.png`, 'hôte des logos'], [`https://den-cards.pokellector.com.evil.example/392/Fezandipiti.TWM.96.53249.png`, 'hôte déguisé'],
        [`${ID('Fezandipiti', 'TWM', 96, 53249)}?x=1`, 'paramètre'], [`${ID('Fezandipiti', 'TWM', 96, 53249)}#f`, 'ancre'], [`https://u:p@den-cards.pokellector.com/392/Fezandipiti.TWM.96.53249.png`, 'identifiants'],
        [`https://den-cards.pokellector.com:8443/392/Fezandipiti.TWM.96.53249.png`, 'port'], [`${IMG}/../x/Fezandipiti.TWM.96.53249.png`, 'remontée'], [`${IMG}/%2e%2e/Fezandipiti.TWM.96.53249.png`, 'encodage'],
        [`${IMG}/Fezandipiti.png`, 'sans numéro ni identifiant'], [`${IMG}/Fezandipiti.TWM.96.abc.png`, 'identifiant non numérique'], [`https://den-cards.pokellector.com/robots.txt`, 'robots.txt n\'est pas une image'], ['', 'vide'], [null, 'null']];
    for (const [u, nom] of refusees) verifier(`adresse refusée : ${nom}`, P.urlImageValide(u), false);
    verifier('la liste des hôtes est FERMÉE et gelée : pages et images, rien d\'autre', [P.HOTE_PAGES, P.HOTE_IMAGES, Object.isFrozen(P.HOTES)], ['www.pokellector.com', 'den-cards.pokellector.com', true]);

    // ── 2. l'adresse d'une page ─────────────────────────────────────────────────────────────────────────────────────────
    const pagesOk = ['https://www.pokellector.com/sets', 'https://www.pokellector.com/Twilight-Masquerade-Expansion/', 'https://www.pokellector.com/Trick-or-Trade-2024-Collection/',
        'https://www.pokellector.com/Twilight-Masquerade-Expansion/Fezandipiti-Card-96', 'https://www.pokellector.com/ajax/views/card-overlay?cardid=54075'];
    for (const u of pagesOk) verifier(`page valable : ${u.replace('https://www.pokellector.com', '')}`, P.urlPageValide(u), true);
    const pagesKo = ['http://www.pokellector.com/sets', 'https://jp.pokellector.com/Twilight-Masquerade-Expansion/', 'https://www.pokellector.com/ajax/views/card-price-history.php?history=1.2', 'https://www.pokellector.com/ajax/views/card-overlay?cardid=abc',
        'https://www.pokellector.com/ajax/views/card-overlay?cardid=1&x=2', 'https://www.pokellector.com/user/login', 'https://www.pokellector.com/search?criteria=x', 'https://www.pokellector.com/Twilight-Masquerade-Expansion/../x', 'https://u:p@www.pokellector.com/sets',
        'https://www.pokellector.com:444/sets', 'https://www.pokellector.com.evil.example/sets', 'https://den-cards.pokellector.com/sets'];
    for (const u of pagesKo) verifier(`page refusée : ${u.replace('https://', '')}`, P.urlPageValide(u), false);

    // ── 3. la fixture RÉELLE : la liste des sets ────────────────────────────────────────────────────────────────────────
    const liste = P.lireListeSets(lire('liste-sets.html'));
    const twm = liste.find(s => s.code === 'TWM');
    verifier('liste des sets : Twilight Masquerade se lit (code, lien, nom)', twm && [twm.code, twm.href, twm.nom, twm.collection], ['TWM', '/Twilight-Masquerade-Expansion/', 'Twilight Masquerade', false]);
    const tott = liste.find(s => s.href === '/Trick-or-Trade-2024-Collection/');
    verifier('liste des sets : la collection Trick or Trade 2024 est une COLLECTION', tott && [tott.nom, tott.collection], ['Trick or Trade 2024', true]);
    verifier('liste des sets : rien d\'absolu ni d\'un autre hôte (les liens japonais sont écartés)', liste.every(s => s.href.startsWith('/')) && liste.length > 100, true);

    // ── 4. la page de set (vignettes seulement) ─────────────────────────────────────────────────────────────────────────
    const set = P.lirePageSet(lire('set-twilight-masquerade.html'));
    verifier('page de set : 226 cartes lues (167 + 59 secrètes), toutes en vignette', [set.cartes.length, set.cartes.every(c => /\.thumb\.png$/.test(c.thumb)), set.collection, set.total], [226, true, false, 167]);
    const fez = set.cartes.find(c => c.numero === '96');
    verifier('page de set : Fezandipiti n°96 — identifiant, page de carte, panneau de détail, code', fez && [fez.cardId, fez.nom, fez.pageCarte, fez.overlay, fez.code], ['53249', 'Fezandipiti', '/Twilight-Masquerade-Expansion/Fezandipiti-Card-96', '/ajax/views/card-overlay?cardid=53249', 'TWM']);
    verifier('page de set : AUCUNE adresse pleine taille (la page ne montre que des vignettes)', set.cartes.some(c => c.img), false);
    verifier('page de set : la vignette n\'est jamais une adresse valable', set.cartes.some(c => P.urlImageValide(c.thumb)), false);

    // ── 5. la page de carte : la pleine taille ──────────────────────────────────────────────────────────────────────────
    const cf = P.lirePageCarte(lire('carte-fezandipiti-96.html'));
    verifier('page de carte : l\'image principale est la pleine taille (og:image = img), sans « .thumb »', cf && [cf.img, cf.cardId, cf.numero, cf.total, P.urlImageValide(cf.img)], [ID('Fezandipiti', 'TWM', 96, 53249), '53249', '96', '167', true]);
    verifier('page de carte : le catalogue est l\'anglais (fil d\'Ariane « English Sets »)', cf.anglais, true);
    verifier('page de carte : les variantes (Reverse Holo, Trick or Trade 2024) sont lues, en vignette seulement', cf.variantes.map(v => [v.cardId, v.titre, v.thumb ? P.urlImageValide(v.thumb) : null]), [['53452', 'Fezandipiti (Reverse Holo)', false], ['54075', 'Fezandipiti (Trick or Trade 2024)', false]]);
    const ci = P.lirePageCarte(lire('carte-infernape-173.html'));
    verifier('page de carte : Infernape n°173 (secrète)', ci && [ci.img, ci.numero], [ID('Infernape', 'TWM', 173, 53319), '173']);
    verifier('page de carte : og:image ≠ image principale => illisible (null), jamais un choix', P.lirePageCarte(lire('carte-fezandipiti-96.html').replace('content="https://den-cards.pokellector.com/392/Fezandipiti.TWM.96.53249.png"', 'content="https://den-cards.pokellector.com/392/Fezandipiti.TWM.96.99999.png"')), null);
    verifier('page de carte : une page sans image principale => null', P.lirePageCarte('<html><body>rien</body></html>'), null);
    verifier('page de carte : une image principale en vignette => null (jamais une vignette prise pour la pleine taille)', P.lirePageCarte(lire('carte-fezandipiti-96.html').replace(/Fezandipiti\.TWM\.96\.53249\.png/g, 'Fezandipiti.TWM.96.53249.thumb.png')), null);

    // ── 6. le panneau de détail et la collection ────────────────────────────────────────────────────────────────────────
    const ov = P.lireOverlay(lire('overlay-54075-tott.html'));
    verifier('panneau de détail : l\'image « .mobile.jpg » de la variante Trick or Trade 2024, valable', ov && [ov.img, ov.cardId, ov.titre, P.urlImageValide(ov.img)], [ID('Fezandipiti', 'TWM', 96, 54075, '.mobile.jpg'), '54075', 'Fezandipiti (Trick or Trade 2024)', true]);
    verifier('panneau de détail : sans image => null', P.lireOverlay('<div class="card-detail"></div>'), null);
    const col = P.lirePageSet(lire('set-trick-or-trade-2024.html'));
    verifier('collection : 30 cartes, d\'AUTRES sets, la page de chacune renvoie vers son set d\'origine', [col.cartes.length, col.collection, col.cartes[0].nom, col.cartes[0].code, col.cartes[0].numero, col.cartes[0].pageCarte], [30, true, 'Phantump', 'TWM', '12', '/Twilight-Masquerade-Expansion/Phantump-Card-12']);

    // ── 7. les images de la sonde : la largeur se lit sur le fichier ───────────────────────────────────────────────────
    const dims = {};
    for (const f of ['Fezandipiti.TWM.96.53249.png', 'Infernape.TWM.173.53319.png', 'Fezandipiti.TWM.96.54075.mobile.jpg']) { const m = await sharp(path.join(FX, f)).metadata(); dims[f] = [m.width, m.height]; }
    verifier('sonde : 570×792 (carte 96), 570×792 (carte 173), 570×797 (.mobile.jpg) — la pleine taille est ≥ 570 sur les trois', [dims['Fezandipiti.TWM.96.53249.png'], dims['Infernape.TWM.173.53319.png'], dims['Fezandipiti.TWM.96.54075.mobile.jpg']], [[570, 792], [570, 792], [570, 797]]);
    verifier('LARGEUR_PLEINE_TAILLE = 570 ; une largeur < 570 n\'est pas une pleine taille', [P.LARGEUR_PLEINE_TAILLE, P.estPleineTaille(570), P.estPleineTaille(569), P.estPleineTaille(null)], [570, true, false, false]);

    // ── 8. la table des sets (fermée) ───────────────────────────────────────────────────────────────────────────────────
    const T = P.tableDesSets(liste, ['Twilight-Masquerade', 'Trick-or-Trade-2024', 'Ensemble-Inconnu', 'Paldean-Fates']);
    verifier('table : Twilight Masquerade et la collection Trick or Trade 2024 sont appariés par le NOM (la ponctuation et la casse ne comptent pas)', [T.get('Twilight-Masquerade'), T.get('Trick-or-Trade-2024')],
        [{ href: '/Twilight-Masquerade-Expansion/', collection: false }, { href: '/Trick-or-Trade-2024-Collection/', collection: true }]);
    verifier('table : un set sans homonyme n\'est pas apparié (jamais une devinette)', T.has('Ensemble-Inconnu'), false);
    const doublon = [{ code: 'A', href: '/A-Expansion/', titre: 'Foo Set', nom: 'Foo', collection: false }, { code: 'B', href: '/B-Expansion/', titre: 'Foo Set', nom: 'Foo', collection: false }];
    verifier('table : deux sets homonymes => aucun des deux n\'est apparié (ambigu)', P.tableDesSets(doublon, ['Foo']).has('Foo'), false);

    // ── 9. l'appariement ──────────────────────────────────────────────────────────────────────────────────────────────
    const nomsDe = (...l) => { const m = new Map(); for (const [slugSet, nom, carteId] of l) { const k = P.nomNorm(nom); if (!m.has(slugSet)) m.set(slugSet, new Map()); const s = m.get(slugSet); if (!s.has(k)) s.set(k, new Set()); s.get(k).add(carteId); } return m; };
    const trou = (idProduct, carteId, nomEn, slugSet, numeroFiche, slugProduit = null, images = [], extra = {}) => ({ idProduct, carteId, slugSet, numeroFiche, slugProduit, carte: { _id: carteId, nomEn, images }, ...extra });
    const SET = 'Twilight-Masquerade';
    const tableSets = new Map([['/Twilight-Masquerade-Expansion/', { slugSet: SET, collection: false }], ['/Trick-or-Trade-2024-Collection/', { slugSet: 'Trick-or-Trade-2024', collection: true }]]);
    const rel = (nom, numero, o = {}) => ({ setHref: '/Twilight-Masquerade-Expansion/', code: 'TWM', numero, nom, cardId: o.cardId ?? String(53000 + Number(numero)), pageCarte: `/Twilight-Masquerade-Expansion/${nom}-Card-${numero}`, overlay: null, img: o.img === undefined ? ID(nom.replace(/ /g, '-'), 'TWM', numero, o.cardId ?? String(53000 + Number(numero))) : o.img, forme: 'plein', ...o });
    const motifs = r => r.restes.map(x => [x.idProduct, x.motif]).sort((a, b) => a[0] - b[0]);
    let r = P.apparier({ trous: [trou(1, 11, 'Fezandipiti', SET, '096', 'Fezandipiti-TWM096'), trou(2, 11, 'Fezandipiti', SET, '096', 'Fezandipiti-V2-TWM096')], cartes: [rel('Fezandipiti', '96')], tableSets, noms: nomsDe([SET, 'Fezandipiti', 11]) });
    verifier('appariement : set + numéro (096 = 96) + nom => une unité pour les deux produits (V1, V2)', r.plan.map(p => [p.carteId, p.numero, p.produits, p.voie, p.url.split('/').pop()]), [[11, '096', [1, 2], 'set+numero+nom', 'Fezandipiti.TWM.96.53096.png']]);
    verifier('   la preuve nomme le set, le numéro et le nom', /Twilight/.test(r.plan[0].preuve) && /96/.test(r.plan[0].preuve) && /Fezandipiti/.test(r.plan[0].preuve), true);
    r = P.apparier({ trous: [trou(1, 11, 'Fezandipiti', SET, '096')], cartes: [rel('Munkidori', '96')], tableSets, noms: nomsDe([SET, 'Fezandipiti', 11]) });
    verifier('un NOM qui contredit le numéro => « nom-contredit », rien au plan', [r.plan.length, motifs(r)], [0, [[1, 'nom-contredit']]]);
    r = P.apparier({ trous: [trou(1, 11, 'Fezandipiti', SET, '097')], cartes: [rel('Fezandipiti', '96')], tableSets, noms: nomsDe([SET, 'Fezandipiti', 11]) });
    verifier('un numéro absent du relevé => « numero-absent-du-releve »', motifs(r), [[1, 'numero-absent-du-releve']]);
    r = P.apparier({ trous: [trou(1, 11, 'Fezandipiti', SET, '096')], cartes: [], tableSets, noms: nomsDe([SET, 'Fezandipiti', 11]) });
    verifier('aucun relevé du set => « set-non-releve »', motifs(r), [[1, 'set-non-releve']]);
    r = P.apparier({ trous: [trou(1, 11, 'Fezandipiti', 'Set-Hors-Table', '096')], cartes: [rel('Fezandipiti', '96')], tableSets, noms: new Map() });
    verifier('un set absent de la table => « set-non-releve » (la table est fermée)', motifs(r), [[1, 'set-non-releve']]);
    r = P.apparier({ trous: [trou(1, 11, 'Fezandipiti', SET, '096')], cartes: [rel('Fezandipiti', '96'), rel('Fezandipiti', '96', { cardId: '99999' })], tableSets, noms: nomsDe([SET, 'Fezandipiti', 11]) });
    verifier('deux cartes relevées différentes pour le même numéro => « releve-contradictoire »', motifs(r), [[1, 'releve-contradictoire']]);
    r = P.apparier({ trous: [trou(1, 11, 'Fezandipiti', SET, '096')], cartes: [rel('Fezandipiti', '96', { img: null })], tableSets, noms: nomsDe([SET, 'Fezandipiti', 11]) });
    verifier('carte appariée mais pleine taille PAS ENCORE relevée => « page-de-carte-a-relever », la page à relever est nommée, rien au plan', [r.plan.length, motifs(r), r.aReleve.map(a => [a.cardId, a.url])], [0, [[1, 'page-de-carte-a-relever']], [['53096', '/Twilight-Masquerade-Expansion/Fezandipiti-Card-96']]]);
    const construite = ID('Fezandipiti', 'TWM', 96, 53249);
    r = P.apparier({ trous: [trou(1, 11, 'Fezandipiti', SET, '096')], cartes: [rel('Fezandipiti', '96', { img: construite.replace('.png', '.thumb.png') })], tableSets, noms: nomsDe([SET, 'Fezandipiti', 11]) });
    verifier('une vignette prise pour la pleine taille => « adresse-hors-regle », rien au plan', [r.plan.length, motifs(r)], [0, [[1, 'adresse-hors-regle']]]);
    r = P.apparier({ trous: [trou(1, 11, 'Fezandipiti', SET, '096')], cartes: [rel('Fezandipiti', '96', { img: 'https://autre.example/x.png' })], tableSets, noms: nomsDe([SET, 'Fezandipiti', 11]) });
    verifier('un autre hôte => « adresse-hors-regle »', motifs(r), [[1, 'adresse-hors-regle']]);
    // déjà servi / couvert
    r = P.apparier({ trous: [trou(1, 11, 'Fezandipiti', SET, '096', null, [{ set: SET, numero: '096', source: 'tcgdex', cleR2: 'x', langue: 'en' }])], cartes: [rel('Fezandipiti', '96')], tableSets, noms: nomsDe([SET, 'Fezandipiti', 11]) });
    verifier('un visuel déjà servi au même numéro => « deja-servi »', motifs(r), [[1, 'deja-servi']]);
    r = P.apparier({ trous: [trou(1, 11, 'Fezandipiti', SET, '096', null, [{ set: SET, numero: '096', source: 'pokemon.com', cleR2: 'x', langue: 'ja' }])], cartes: [rel('Fezandipiti', '96')], tableSets, noms: nomsDe([SET, 'Fezandipiti', 11]) });
    verifier('une entrée REFUSÉE par la règle (scan japonais) => remplacement PRÉPARÉ (modification : feu vert du testeur), jamais au plan', [r.plan.length, r.remplacements.length, motifs(r)], [0, 1, [[1, 'entree-refusee-au-numero']]]);
    r = P.apparier({ trous: [trou(1, 11, 'Fezandipiti', SET, '096'), trou(2, 12, 'Munkidori', SET, '095')], cartes: [rel('Fezandipiti', '96'), rel('Munkidori', '95')], tableSets, noms: nomsDe([SET, 'Fezandipiti', 11], [SET, 'Munkidori', 12]), couverts: new Set([1]) });
    verifier('un produit COUVERT par une source plus grande (pkmncards, pokedata) est sauté => « couvert-par-une-source-plus-grande » ; l\'autre reste au plan', [motifs(r), r.plan.map(p => p.produits)], [[[1, 'couvert-par-une-source-plus-grande']], [[2]]]);
    // numéro du slug quand la fiche n'a pas de numéro
    r = P.apparier({ trous: [trou(1, 11, 'Fezandipiti', SET, null, 'Fezandipiti-TWM096')], cartes: [rel('Fezandipiti', '96')], tableSets, noms: nomsDe([SET, 'Fezandipiti', 11]) });
    verifier('fiche sans numéro : le numéro d\'origine du slug (TWM096) sert, et la voie le dit', r.plan.map(p => p.voie), ['set+numero-du-slug+nom']);
    // deux fiches, une image
    r = P.apparier({ trous: [trou(1, 11, 'Fezandipiti', SET, '096'), trou(2, 12, 'Fezandipiti', SET, '096')], cartes: [rel('Fezandipiti', '96')], tableSets, noms: nomsDe([SET, 'Fezandipiti', 11], [SET, 'Fezandipiti', 12]) });
    verifier('une image pour DEUX fiches différentes (cartes 11 et 12 au même numéro) => « carte-pour-deux-fiches », rien au plan', [r.plan.length, motifs(r)], [0, [[1, 'carte-pour-deux-fiches'], [2, 'carte-pour-deux-fiches']]]);
    // collection (Trick or Trade)
    const relC = (nom, code, numero, o = {}) => ({ setHref: '/Trick-or-Trade-2024-Collection/', code, numero, nom, cardId: o.cardId ?? '54075', pageCarte: `/X/${nom}-Card-${numero}`, overlay: `/ajax/views/card-overlay?cardid=${o.cardId ?? '54075'}`, img: o.img === undefined ? ID(nom, code, numero, o.cardId ?? '54075', '.mobile.jpg') : o.img, forme: 'mobile', ...o });
    const TT = 'Trick-or-Trade-2024';
    r = P.apparier({ trous: [trou(7, 21, 'Fezandipiti', TT, null, 'Fezandipiti-BOO24TWM-096')], cartes: [relC('Fezandipiti', 'TWM', '96')], tableSets, noms: nomsDe([TT, 'Fezandipiti', 21]) });
    verifier('collection : code d\'origine (TWM) + numéro (96) du slug + nom => une unité, la voie le dit', r.plan.map(p => [p.voie, p.url.endsWith('.mobile.jpg'), p.numero]), [['collection+origine+numero+nom', true, null]]);
    r = P.apparier({ trous: [trou(7, 21, 'Fezandipiti', TT, null, 'Fezandipiti-BOO24PAF-096')], cartes: [relC('Fezandipiti', 'TWM', '96')], tableSets, noms: nomsDe([TT, 'Fezandipiti', 21]) });
    verifier('collection : un AUTRE code d\'origine (PAF ≠ TWM) => trou « absent-du-releve »', motifs(r), [[7, 'absent-du-releve']]);
    r = P.apparier({ trous: [trou(7, 21, 'Fezandipiti', TT, null, 'Fezandipiti-sans-origine')], cartes: [relC('Fezandipiti', 'TWM', '96')], tableSets, noms: nomsDe([TT, 'Fezandipiti', 21]) });
    verifier('collection : un slug sans code d\'origine => « origine-introuvable »', motifs(r), [[7, 'origine-introuvable']]);
    r = P.apparier({ trous: [trou(7, 21, 'Fezandipiti', TT, null, 'Fezandipiti-BOO24TWM-096')], cartes: [relC('Munkidori', 'TWM', '96')], tableSets, noms: nomsDe([TT, 'Fezandipiti', 21]) });
    verifier('collection : le nom contredit => « nom-contredit »', motifs(r), [[7, 'nom-contredit']]);
    r = P.apparier({ trous: [trou(7, 21, 'Fezandipiti', TT, null, 'Fezandipiti-BOO24TWM-096')], cartes: [relC('Fezandipiti', 'TWM', '96', { img: null })], tableSets, noms: nomsDe([TT, 'Fezandipiti', 21]) });
    verifier('collection : image pas encore relevée => la page à relever est le PANNEAU DE DÉTAIL (relevé sur la page du set, jamais construit ici)', r.aReleve.map(a => a.url), ['/ajax/views/card-overlay?cardid=54075']);
    r = P.apparier({ trous: [trou(7, 21, 'Fezandipiti', TT, null, 'Fezandipiti-BOO24TWM-096', [], { empruntee: true })], cartes: [relC('Fezandipiti', 'TWM', '96')], tableSets, noms: nomsDe([TT, 'Fezandipiti', 21]) });
    verifier('un produit servi avec l\'image EMPRUNTÉE au tirage normal reste un trou : la source montre le tirage tamponné => au plan, marqué', r.plan.map(p => [p.empruntee, p.aRegarder]), [[true, true]]);
    verifier('origine du slug : BOO24TWM-096 => TWM 096 ; sans la forme => null', [P.origineDuSlug('Fezandipiti-BOO24TWM-096'), P.origineDuSlug('Gengar-BOO24PAF-057'), P.origineDuSlug('Fezandipiti-TWM096'), P.origineDuSlug(null)], [{ code: 'TWM', numero: '96' }, { code: 'PAF', numero: '57' }, null, null]);

    // ── 10. cache de pages : adresses relevées ───────────────────────────────────────────────────────────────────────────
    const H = lire('carte-fezandipiti-96.html');
    const rel2 = P.adressesDeLaPage(H);
    verifier('adresses relevées d\'une page : celles qui y figurent mot pour mot (cartes voisines, panneau de détail, variantes) — et seulement des adresses valables', [rel2.has('https://www.pokellector.com/ajax/views/card-overlay?cardid=54075'), rel2.has('https://www.pokellector.com/Twilight-Masquerade-Expansion/Sandshrew-Card-97'), [...rel2].every(u => P.urlPageValide(u))], [true, true, true]);
    verifier('une page jamais lue ne relève rien (aucune adresse construite)', P.adressesDeLaPage('<html></html>').size, 0);

    // ── 11. langue, traçabilité, identifiants ───────────────────────────────────────────────────────────────────────────
    const lg = P.langueDe({ anglais: true, img: ID('Fezandipiti', 'TWM', 96, 53249) });
    verifier('langue : « en » quand la page est du catalogue anglais ; la preuve ne nomme pas la source', [lg.langue, /pokellector/i.test(lg.preuve)], ['en', false]);
    verifier('langue : sans preuve (page non anglaise ou adresse hors règle) => null', [P.langueDe({ anglais: false, img: ID('F', 'TWM', 96, 1) }).langue, P.langueDe({ anglais: true, img: 'https://autre.example/x.png' }).langue], [null, null]);
    const tr = P.tracer({ url: construite, collecteLe: new Date('2026-10-17T20:00:00Z') });
    verifier('traçabilité : tracer() porte source, adresse d\'origine, date, retirable:true et le lot', [tr.source, tr.urlOriginal, tr.collecteLe.toISOString(), tr.retirable, tr.lot], ['pokellector', construite, '2026-10-17T20:00:00.000Z', true, 'pokellector-2026-10']);
    verifier('clé R2 NEUTRE : pkl/<slugSet>/<n°>-<carteId>-en.webp (aucun nom de source)', [P.cleR2('Twilight-Masquerade', 11, '096'), P.cleR2('Trick-or-Trade-2024', 21, null), /pokellector/i.test(P.cleR2('Twilight-Masquerade', 11, '096'))], ['pkl/Twilight-Masquerade/096-11-en.webp', 'pkl/Trick-or-Trade-2024/sans-numero-21-en.webp', false]);
    verifier('les parties PUBLIQUES de l\'entrée (mention, attribution, clé) ne nomment pas la source', /pokellector/i.test(JSON.stringify([P.MENTION, P.cleR2('S', 1, '1')])), false);

    // ── 12. jugement des réponses (arrêt définitif) ─────────────────────────────────────────────────────────────────────
    const j = P.jugerReponse;
    const arrets = [[401, 'html'], [403, 'html'], [410, 'html'], [429, 'html']];
    for (const [s] of arrets) verifier(`réponse ${s} => ARRÊT DÉFINITIF`, j({ status: s, type: 'text/html', texte: 'non' }).etat, 'arret');
    verifier('réponse 301/302/307 (redirection non suivie) => ARRÊT DÉFINITIF', [301, 302, 307, 308].map(s => j({ status: s, location: 'https://autre.example/' }).etat), ['arret', 'arret', 'arret', 'arret']);
    verifier('réponse cf-mitigated ou défi dans le corps (Just a moment, captcha, Incapsula) => ARRÊT', [j({ status: 200, type: 'text/html', texte: 'x', cfMitigated: 'challenge' }).etat, j({ status: 200, type: 'text/html', texte: '<title>Just a moment...</title>' }).etat, j({ status: 200, type: 'text/html', texte: 'captcha' }).etat, j({ status: 200, type: 'text/html', texte: '_Incapsula_Resource' }).etat], ['arret', 'arret', 'arret', 'arret']);
    verifier('une IMAGE attendue qui arrive en HTML => ARRÊT (page de défi probable)', j({ status: 200, type: 'text/html', texte: '<html>ok</html>' }, { image: true }).etat, 'arret');
    verifier('une PAGE attendue qui arrive en image => interrompu, pas un arrêt', j({ status: 200, type: 'image/png', octets: Buffer.from('x') }, { image: false }).etat, 'interrompu');
    verifier('404 => absent (on continue) ; 5xx => interrompu (pas d\'arrêt) ; 200 page / image => ok', [j({ status: 404, type: 'text/html', texte: 'Not found' }).etat, j({ status: 503, type: 'text/html', texte: 'x' }).etat, j({ status: 200, type: 'text/html', texte: '<html>vrai</html>' }).etat, j({ status: 200, type: 'image/png', octets: Buffer.from('x') }, { image: true }).etat], ['absent', 'interrompu', 'ok', 'ok']);
    verifier('404 qui cache un défi => ARRÊT', j({ status: 404, type: 'text/html', texte: 'Just a moment' }).etat, 'arret');
    verifier('les 6 pages RÉELLES de la sonde ne sont PAS prises pour un défi (aucun faux arrêt sur du légitime)', ['liste-sets.html', 'set-twilight-masquerade.html', 'set-trick-or-trade-2024.html', 'carte-fezandipiti-96.html', 'carte-infernape-173.html', 'overlay-54075-tott.html'].map(f => j({ status: 200, type: 'text/html; charset=UTF-8', texte: lire(f) }).etat), Array(6).fill('ok'));
    const dos = fs.readFileSync(path.join(__dirname, 'fixtures', 'dos-de-carte-serveur-images.png'));
    verifier('un DOS de carte (empreinte connue) n\'est pas une carte', [P.estUnDos(dos), P.estUnDos(fs.readFileSync(path.join(FX, 'Fezandipiti.TWM.96.53249.png')))], [true, false]);

    // ── 13. retrait ──────────────────────────────────────────────────────────────────────────────────────────────────────
    const cartes = [{ _id: 1, images: [{ source: 'pokellector', lot: P.LOT, cleR2: 'pkl/A/1-1-en.webp', vignette: { cleR2: 'vignettes/pkl/A/1-1-en.webp' } }, { source: 'tcgdex', cleR2: 'z' }] }, { _id: 2, images: [{ source: 'pokellector', lot: 'autre-lot', cleR2: 'k' }] }, { _id: 3, images: [] }];
    verifier('planRetrait : exactement la source ET le lot, vignettes comprises', P.planRetrait(cartes), { cartes: [1], entrees: 1, cles: ['pkl/A/1-1-en.webp', 'vignettes/pkl/A/1-1-en.webp'] });

    console.log(`\n${ok} réussis, ${ko} en échec`);
    process.exitCode = ko ? 1 : 0;
})().catch(e => { console.error(e); process.exitCode = 1; });
