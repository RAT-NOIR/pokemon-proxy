// node test-pkmncards.js — le module PUR collecte-cartes/pkmncards.js (lot PKMNCARDS, 2026-10-17) : sitemaps, adresses, table fermée, appariement carte par carte.
// Aucune requête, aucune base : un EXTRAIT RÉEL des sitemaps (fixtures/, hôte remplacé par @@HOTE@@ pour la garde du dépôt) et des cartes FABRIQUÉES.
const fs = require('fs');
const path = require('path');
const P = require('./collecte-cartes/pkmncards');

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); }
};
const H = `https://${P.HOTE}`;
const lireFixture = f => fs.readFileSync(path.join(__dirname, 'fixtures', f), 'utf8').replace(/@@HOTE@@/g, H);
const UP = f => `${H}/wp-content/uploads/${f}`;
const card = s => `${H}/card/${s}/`;

// ── 1. LES SITEMAPS (extrait réel) ─────────────────────────────────────────────────────────────────────────────────────────
const lus = P.lireSitemapTexte(lireFixture('pkmncards-extrait-sitemap.xml'));
verifier('sitemap : l\'extrait réel donne 79 entrées (loc + image:loc), aucune écartée', [lus.entrees.length, lus.ecartees.length], [79, 0]);
verifier('sitemap : une entrée dont l\'adresse n\'est pas sur l\'hôte, ou dont l\'image est hors règle, est ÉCARTÉE et nommée',
    (() => { const x = P.lireSitemapTexte(`<urlset><url><loc>https://autre.example/card/a-b-1/</loc><image:image><image:loc>${UP('a.jpg')}</image:loc></image:image></url><url><loc>${card('a-xy-trainer-kit-latios-tk8o-1')}</loc><image:image><image:loc>https://autre.example/wp-content/uploads/a.jpg</image:loc></image:image></url><url><loc>${card('b-xy-trainer-kit-latios-tk8o-2')}</loc></url></urlset>`); return [x.entrees.length, x.ecartees.map(e => e.motif)]; })(),
    [0, ['loc-hors-hote', 'image-hors-regle', 'sans-image']]);
verifier('sitemap : un fichier illisible / vide LÈVE (un vide n\'est pas une absence)', (() => { try { P.lireSitemapTexte(''); return 'ne lève pas'; } catch (e) { return /aucune entrée/.test(e.message); } })(), true);

// ── 2. DÉCOMPOSER UNE ADRESSE DE CARTE ─────────────────────────────────────────────────────────────────────────────────────
const dec = s => P.decomposer(card(s));
verifier('adresse : kit (set, code, numéro, nom)', dec('delcatty-xy-trainer-kit-latios-tk8o-24'), { nom: 'delcatty', pkcSet: 'xy-trainer-kit-latios', code: 'tk8o', numero: '24' });
verifier('adresse : set sans code (promos)', dec('pikachu-wizards-black-star-promos-1'), { nom: 'pikachu', pkcSet: 'wizards-black-star-promos', code: null, numero: '1' });
verifier('adresse : numéro-lettre (Unown) et nom à plusieurs mots', [dec('unown-unseen-forces-uf-a'), dec('unown-j-wizards-black-star-promos-38')], [{ nom: 'unown', pkcSet: 'unseen-forces', code: 'uf', numero: 'a' }, { nom: 'unown j', pkcSet: 'wizards-black-star-promos', code: null, numero: '38' }]);
verifier('adresse : numéro préfixé (SWSH301), zéros gardés tels quels', [dec('lugia-v-sword-shield-promos-swsh301')?.numero, dec('mirage-mcdonalds-match-battle-2023-m23-012')?.numero], ['swsh301', '012']);
verifier('adresse : un set au code absent ou différent n\'est PAS lu (strict) — « uf » seul n\'est pas un numéro', [dec('unown-unseen-forces-uf'), dec('x-heartgold-soulsilver-promos-hgss01'), dec('x-unseen-forces-zz-3')], [null, null, null]);
verifier('adresse : hôte autre, chemin autre, set hors de la table → null', [P.decomposer('https://autre.example/card/a-unseen-forces-uf-3/'), P.decomposer(`${H}/set/unseen-forces/`), dec('a-base-set-bs-3')], [null, null, null]);
verifier('adresse : le set le plus LONG gagne (xy-trainer-kit-latias n\'est pas pris pour un autre)', dec('acro-bike-xy-trainer-kit-latias-tk8a-20')?.pkcSet, 'xy-trainer-kit-latias');

// ── 3. LES ADRESSES D'IMAGE ET DE ROBOTS : liste fermée ────────────────────────────────────────────────────────────────────
verifier('image : https, hôte, chemin plat sous /wp-content/uploads/, extension png|jpg|jpeg|webp', [UP('m23_en_012_std.png'), UP('a-b_c.jpg'), UP('x.jpeg'), UP('x.webp')].map(P.urlImageValide), [true, true, true, true]);
const mauvaises = [`http://${P.HOTE}/wp-content/uploads/a.jpg`, `https://www.${P.HOTE}/wp-content/uploads/a.jpg`, `${H}:8443/wp-content/uploads/a.jpg`, `${H}/wp-content/uploads/a.jpg?x=1`, `${H}/wp-content/uploads/a.jpg#f`,
    `${H}/wp-content/uploads/../a.jpg`, `${H}/wp-content/uploads/%2e%2e/a.jpg`, `${H}/wp-content/uploads/2024/03/a.jpg`, `${H}/wp-content/themes/a.jpg`, `${H}/card/a-b-1/`, `${H}/`, `${H}/a.jpg`, `${H}/wp-content/uploads/a.gif`, `${H}/wp-content/uploads/`,
    `https://u:p@${P.HOTE}/wp-content/uploads/a.jpg`, `https://${P.HOTE}.evil.example/wp-content/uploads/a.jpg`, `${H}/wp-content/uploads/a.jpg\\b`, ''];
verifier('image : tout le reste est refusé (http, www, port, requête, ancre, remontée, encodage, sous-dossier, autre chemin, une page, la racine, identifiants, hôte déguisé)', mauvaises.map(P.urlImageValide).every(v => v === false), true);
verifier('robots : l\'adresse exacte seule ; la recherche (?s=), la racine et tout autre chemin sont refusés par adressePermise', [`${H}/robots.txt`, `${H}/?s=pikachu`, `${H}/`, `${H}/robots.txt?x`, `${H}/card/a-b-1/`, UP('a.jpg')].map(P.adressePermise), [true, false, false, false, false, true]);

// ── 4. LA TABLE FERMÉE ──────────────────────────────────────────────────────────────────────────────────────────────────────
const setsReels = [...lireFixture('pkmncards-extrait-sets.xml').matchAll(/<loc>[^<]*\/set\/([^<]*?)\/<\/loc>/g)].map(m => m[1]);
verifier('table : le fichier des sets (196 sets réels) est lu', setsReels.length, 196);
verifier('table : CHAQUE set de la table existe dans les sitemaps des sets (aucun nom deviné)', Object.keys(P.TABLE).filter(s => !setsReels.includes(s)), []);
verifier('table : lots connus, chaque ligne a un lot, au moins un slugSet et un code (ou null)', Object.entries(P.TABLE).filter(([, e]) => !P.LOTS.includes(e.lot) || !Array.isArray(e.slugSets) || !e.slugSets.length || !('code' in e)).map(([k]) => k), []);
verifier('table : les cinq lots ont au moins un set', P.LOTS.map(l => Object.values(P.TABLE).some(e => e.lot === l)), [true, true, true, true, true]);
verifier('table : la table est GELÉE (une ligne ne se change pas à l\'exécution)', [Object.isFrozen(P.TABLE), Object.isFrozen(P.TABLE['xy-trainer-kit-latios'])], [true, true]);

// ── 5. L'APPARIEMENT CARTE PAR CARTE ───────────────────────────────────────────────────────────────────────────────────────
const idx = P.indexer(lus.entrees);
verifier('index : 79 entrées lues, celles dont l\'adresse ne se lit pas sont comptées à part (jamais perdues en silence)', [idx.lues.length + idx.illisibles.length, idx.illisibles.map(x => x.loc.replace(H + '/card/', ''))], [79, ['unown-unseen-forces-uf/']]);
const trou = (idProduct, carteId, slugSet, numeroFiche, slugProduit, nomEn, images = []) => ({ idProduct, carteId, slugSet, numeroFiche, slugProduit, carte: { _id: carteId, nomEn, images } });
const app = (trous, o = {}) => P.apparier({ trous, entrees: idx.lues, lot: o.lot, ...(o.refus ? { refus: o.refus } : {}) });
const motifs = r => r.restes.map(x => `${x.idProduct}:${x.motif}`);

// 5a. un kit : set, numéro et nom concordent -> AJOUT ; la demi-deck vient du slug
let r = app([trou(1, 10, 'XY-Trainer-Kit-Latias-Latios', '24', 'Delcatty-TK824O', 'Delcatty')], { lot: 'kits' });
verifier('kit : Delcatty n°24 (…TK824O = demi-deck Latios) -> l\'entrée du kit Latios n°24, en AJOUT', [r.plan.length, r.restes.length, r.plan[0]?.url, r.plan[0]?.action, r.plan[0]?.pkcSet, r.plan[0]?.voie], [1, 0, UP('en_US-TK8A-024-delcatty.png'), 'ajout', 'xy-trainer-kit-latios', 'set+numero+nom']);
verifier('kit : l\'unité porte la fiche (carte, numéro), les produits, la preuve (set, numéro, nom) et l\'adresse de la page', [r.plan[0].carteId, r.plan[0].numero, r.plan[0].produits, /n°24/.test(r.plan[0].preuve), /Delcatty/i.test(r.plan[0].preuve), r.plan[0].loc], [10, '24', [1], true, true, card('delcatty-xy-trainer-kit-latios-tk8o-24')]);
// 5b. nom qui contredit : le numéro désigne une autre carte
r = app([trou(2, 11, 'XY-Trainer-Kit-Latias-Latios', '2', 'Skitty-TK82O', 'Skitty')], { lot: 'kits' });
verifier('nom qui CONTREDIT le numéro (n°2 du kit Latios est une Énergie, la fiche est Skitty) -> SAUTÉ, jamais deviné', [r.plan.length, motifs(r)], [0, ['2:nom-contredit']]);
// 5c. numéro absent de la source
r = app([trou(3, 12, 'XY-Trainer-Kit-Latias-Latios', '99', 'Delcatty-TK899O', 'Delcatty')], { lot: 'kits' });
verifier('numéro absent de la source -> sauté (numero-absent-de-la-source)', motifs(r), ['3:numero-absent-de-la-source']);
// 5d. le demi-deck se lit au slug ; sans demi-deck lisible, deux candidats -> sauté
r = app([trou(4, 13, 'XY-Trainer-Kit-Latias-Latios', '20', 'Acro-Bike-TK820A', 'Acro Bike')], { lot: 'kits' });
verifier('demi-deck : …TK820A = Latias -> l\'Acro Bike n°20 du kit Latias (pas celle du kit Latios, même numéro, même nom)', [r.plan[0]?.pkcSet, r.plan[0]?.url], ['xy-trainer-kit-latias', UP('en_US-TK8B-020-acro_bike.png')]);
r = app([trou(5, 13, 'XY-Trainer-Kit-Latias-Latios', '20', 'Acro-Bike', 'Acro Bike')], { lot: 'kits' });
verifier('demi-deck illisible au slug : deux candidats (Latias, Latios) -> SAUTÉ (deux-candidats), aucune image devinée', [r.plan.length, motifs(r)], [0, ['5:deux-candidats']]);
r = app([trou(6, 13, 'XY-Trainer-Kit-Latias-Latios', '20', 'Acro-Bike-TK820A', 'Acro Bike'), trou(7, 13, 'XY-Trainer-Kit-Latias-Latios', '20', 'Acro-Bike-TK820O', 'Acro Bike')], { lot: 'kits' });
verifier('une FICHE (même carte, même numéro) qui recevrait DEUX images (Latias et Latios) -> les deux produits sautés (deux-images-une-fiche)', [r.plan.length, motifs(r).sort()], [0, ['6:deux-images-une-fiche', '7:deux-images-une-fiche']]);
// 5e. le préfixe de demi-deck (DP : L = Lucario, M = Manaphy) ; une fiche numérotée « L3 » ne se compare pas au « 3 » nu de l'autre moitié
r = app([trou(8, 14, 'DP-Trainer-Kit', 'L3', 'Lucario-Lv30-TK33-Gold', 'Lucario'), trou(9, 15, 'DP-Trainer-Kit', 'M4', 'Manaphy-Lv20-TK34-Blue', 'Manaphy'), trou(10, 16, 'DP-Trainer-Kit', 'M3', 'Goldeen-Lv14-TK33-Blue', 'Goldeen')], { lot: 'kits' });
verifier('DP : « L3 » = Lucario n°3 du kit Lucario, « M4 » = Manaphy n°4 du kit Manaphy ; « M3 » (Goldeen) ne prend pas le Lucario n°3', [r.plan.map(u => [u.produits[0], u.pkcSet]), motifs(r)], [[[8, 'diamond-pearl-trainer-kit-lucario'], [9, 'diamond-pearl-trainer-kit-manaphy']], ['10:numero-absent-de-la-source']]);
// 5f. fiche SANS numéro : second élément écrit (le slug) ou sauté
r = app([trou(11, 17, 'EX-Trainer-Kit-2', null, 'Plusle-TK2P6', 'Plusle'), trou(12, 18, 'EX-Trainer-Kit-2', null, 'Spoink-TK2P7', 'Spoink')], { lot: 'kits' });
verifier('fiche sans numéro : le numéro d\'origine du slug (TK2P6) + le nom -> apparié ; sans entrée à ce numéro -> sauté', [r.plan.map(u => [u.produits[0], u.voie, u.pkcSet]), motifs(r)], [[[11, 'set+numero-du-slug+nom', 'ex-trainer-kit-plusle']], ['12:numero-absent-de-la-source']]);
r = app([trou(13, 19, 'Best-of-Game-Cards-Promos', null, 'Electabuzz-Promo', 'Electabuzz')], { lot: 'promos' });
verifier('fiche sans numéro NI second élément écrit -> sauté (sans-numero), jamais appariée par le nom seul', motifs(r), ['13:sans-numero']);
// 5g. promos : numéro nu, nom à apostrophe
r = app([trou(14, 20, 'Best-of-Game-Cards-Promos', '5', 'Rockets-Sneasel-BEST5', "Rocket's Sneasel"), trou(15, 21, 'Best-of-Game-Cards-Promos', '8', 'Rockets-Mewtwo-BEST8', "Rocket's Mewtwo")], { lot: 'promos' });
verifier('promos : l\'apostrophe et le tiret ne comptent pas (Rocket\'s Sneasel = rockets-sneasel) ; le fichier « …-winner-8 » est lu', [r.plan.map(u => [u.produits[0], u.url.slice(u.url.lastIndexOf('/') + 1)])], [[[14, 'rockets-sneasel-best-of-game-5.jpg'], [15, 'rockets-mewtwo-best-of-game-winner-8.jpg']]]);
// 5h. un set hors table
r = app([trou(16, 22, 'Base-Set', '4', 'Charizard-V1-BS4', 'Charizard')], { lot: 'kits' });
verifier('set Cardmarket hors de la table du lot -> set-hors-table', motifs(r), ['16:set-hors-table']);
// 5i. deux produits (V1/V2) d'une même fiche : une seule image, les deux produits dans l'unité
r = app([trou(17, 23, 'SM-Trainer-Kit-Lycanroc-Alolan-Raichu', '21', 'Great-Ball-V1-TK10L21', 'Great Ball'), trou(18, 23, 'SM-Trainer-Kit-Lycanroc-Alolan-Raichu', '21', 'Great-Ball-V3-TK10A21', 'Great Ball')], { lot: 'kits' });
verifier('Great Ball n°21 (L = Lycanroc, A = Alolan Raichu) : une fiche, deux images différentes -> sautés', [r.plan.length, motifs(r).sort()], [0, ['17:deux-images-une-fiche', '18:deux-images-une-fiche']]);
r = app([trou(19, 23, 'SM-Trainer-Kit-Lycanroc-Alolan-Raichu', '21', 'Great-Ball-V1-TK10L21', 'Great Ball'), trou(20, 23, 'SM-Trainer-Kit-Lycanroc-Alolan-Raichu', '21', 'Great-Ball-V2-TK10L21', 'Great Ball')], { lot: 'kits' });
verifier('deux produits d\'une MÊME fiche et d\'une même demi-deck : UNE image, les deux produits dans l\'unité', [r.plan.length, r.plan[0]?.produits], [1, [19, 20]]);
// 5j. une image pour deux fiches
r = app([trou(21, 24, 'Wizards-Black-Star-Promos', '1', 'Pikachu-V1-WP1', 'Pikachu'), trou(22, 25, 'Wizards-Black-Star-Promos', '1', 'Pikachu-V2-WP1', 'Pikachu')], { lot: 'promos' });
verifier('une entrée de la source pour deux FICHES (deux cartes, même numéro, même nom) -> sautées (carte-pour-deux-fiches)', [r.plan.length, motifs(r).sort()], [0, ['21:carte-pour-deux-fiches', '22:carte-pour-deux-fiches']]);

// 5k. ajout / remplacement / déjà servi / refusée
const IM = (o = {}) => ({ set: 'McDonalds-Match-Battle-2023', source: 'pokumon', numero: '12', cleR2: 'pokumon/old.webp', langue: 'en', w: 320, ...o });
const mc = images => app([trou(30, 40, 'McDonalds-Match-Battle-2023', '012', 'Blissey-M23012', 'Blissey', images)], { lot: 'mcdo' });
r = mc([]);
verifier('McDonald\'s : aucune entrée au numéro -> AJOUT', [r.plan[0]?.action, r.plan[0]?.remplace], ['ajout', []]);
r = mc([IM({ basseDefinition: true })]);
verifier('McDonald\'s : une entrée MARQUÉE basseDefinition au même numéro, même langue -> REMPLACEMENT (l\'ancienne est nommée)', [r.plan[0]?.action, r.plan[0]?.remplace.map(e => e.cleR2), r.restes.length], ['remplacement', ['pokumon/old.webp'], 0]);
r = mc([IM()]);
verifier('McDonald\'s : une entrée de 320 px NON ENCORE marquée (la marque n\'est pas posée) est lue basse définition par sa largeur -> REMPLACEMENT', [r.plan[0]?.action, r.plan[0]?.remplace.map(e => e.cleR2)], ['remplacement', ['pokumon/old.webp']]);
r = mc([IM({ w: 600 })]);
verifier('McDonald\'s : une entrée de 600 px sert déjà -> deja-servi, rien n\'est touché', [r.plan.length, motifs(r)], [0, ['30:deja-servi']]);
r = mc([IM({ basseDefinition: true }), IM({ w: 600, cleR2: 'autre/x.webp', source: 'tcgdex' })]);
verifier('une entrée haute définition ET une basse : le visuel est servi -> deja-servi (la basse n\'est pas remplacée à l\'insu)', motifs(r), ['30:deja-servi']);
r = mc([IM({ basseDefinition: true, langue: null })]);
verifier('basse définition de langue inconnue : elle ne se remplace pas (la règle exige les deux langues connues) -> sautée, notée', motifs(r), ['30:basse-definition-non-remplacable']);
r = mc([IM({ langue: 'ja', w: 868, cleR2: 'bulbapedia/ja.webp', source: 'bulbapedia' })]);
verifier('DOCTRINE : un scan JAPONAIS refusé par la règle du site au numéro exact est une image FAUSSE -> REMPLACEMENT (ancienne nommée, motif « fausse »), plus de feu vert', [r.plan[0]?.action, r.plan[0]?.remplace.map(e => [e.cleR2, e.motif]), r.restes.length], ['remplacement', [['bulbapedia/ja.webp', 'fausse : langue:ja']], 0]);
r = mc([IM({ langue: 'ja', w: 868, cleR2: 'bulbapedia/ja.webp', source: 'bulbapedia', numero: null })]);
verifier('un scan japonais refusé SANS numéro (il couvrirait tout le set) reste sauté, noté', motifs(r), ['30:entree-refusee-au-numero']);
r = app([trou(50, 60, 'McDonalds-Match-Battle-2023', '012', 'Blissey-M23012', 'Blissey', [IM({ w: 868, source: 'tcgdex', cleR2: 'x.webp' })])], { lot: 'mcdo', refus: () => 'format:inconnu' });
verifier('un refus qui n\'est PAS une autre langue reste sauté (la doctrine ne couvre que l\'image fausse par la langue)', motifs(r), ['50:entree-refusee-au-numero']);
r = mc([IM({ numero: '13', basseDefinition: true })]);
verifier('une entrée basse d\'un AUTRE numéro ne compte pas : AJOUT', r.plan[0]?.action, 'ajout');
r = mc([IM({ numero: null, basseDefinition: true })]);
verifier('une entrée basse SANS numéro dans le set couvre le numéro mais ne s\'apparie pas au même numéro -> sautée (non remplaçable)', motifs(r), ['30:basse-definition-non-remplacable']);
r = P.apparier({ trous: [trou(31, 41, 'McDonalds-Match-Battle-2023', '012', 'Blissey-M23012', 'Blissey', [IM({ w: 600 })])], entrees: idx.lues, lot: 'mcdo', refus: () => 'regle-du-site-injectee' });
verifier('la règle du site est INJECTABLE : une entrée qu\'elle refuse ne sert pas la fiche', motifs(r), ['31:entree-refusee-au-numero']);

// 5l. le lot filtre la table : un set d'un autre lot n'est pas offert
r = app([trou(32, 42, 'McDonalds-Match-Battle-2023', '012', 'Blissey-M23012', 'Blissey')], { lot: 'kits' });
verifier('le lot « kits » n\'offre pas la table des McDonald\'s -> set-hors-table', motifs(r), ['32:set-hors-table']);
// 5m. pkmcom : les cinq sets, des fiches à lettre, sans numéro
r = app([trou(33, 43, 'EX-Unseen-Forces', 'B', 'Unown-UF2B', 'Unown'), trou(34, 44, 'HeartGold-SoulSilver', null, 'Darkness-Energy-HS121', 'Basic Darkness Energy'), trou(35, 45, 'SWSH-Black-Star-Promos', 'SWSH301', 'Lugia-V-SWSH301', 'Lugia V'), trou(36, 46, 'SV-Black-Star-Promos', '221', 'Professors-Research-SVP221', "Professor's Research"), trou(37, 47, '30th-Celebration', null, 'Genesect-ex-30C011', 'Genesect-EX')], { lot: 'pkmcom' });
verifier('pkmcom : Unown B (numéro-lettre), Énergie sans numéro (slug), SWSH301, SVP221 sont appariés ; Genesect 30th sans numéro comparable -> sauté',
    [r.plan.map(u => [u.produits[0], u.url.slice(u.url.lastIndexOf('/') + 1)]), motifs(r)],
    [[[33, 'unown-unseen-forces-uf-b.jpg'], [34, 'en_US-HGSS1-121-darkness_energy.jpg'], [35, 'en_US-Promo_SWSH-SWSH301-lugia_v.png'], [36, 'svbsp_en_221_std.png']], ['37:sans-numero']]);
verifier('pkmcom : la 30th Celebration est à REGARDER (la marque « 30 »), les autres non', [P.SETS_A_REGARDER.includes('30th-Celebration'), r.plan.every(u => u.aRegarder === false)], [true, true]);

// 5n. (correction 1) les 5 produits du plan pokemon.com dont l'entrée est un scan japonais refusé : REMPLACEMENT, appariés set + numéro + nom
const JA = (set, numero, cleR2) => ({ set, source: 'bulbapedia', numero, cleR2, langue: 'ja', w: 868 });
r = app([trou(302215, 70, 'Shining-Legends', '78', 'Mewtwo-GX-SLG78', 'Mewtwo-GX', [JA('Shining-Legends', '78', 'b/78.webp')]), trou(355637, 71, 'Forbidden-Light', '126', 'Xerneas-GX-FLI126', 'Xerneas-GX', [JA('Forbidden-Light', '126', 'b/126.webp')]),
    trou(670826, 72, 'Lost-Origin', 'TG01', 'Parasect-LOR-TG01', 'Parasect', [JA('Lost-Origin', 'TG01', 'b/tg01.webp')]), trou(682983, 73, 'SWSH-Black-Star-Promos', 'SWSH293', 'Zamazenta-V-SWSH293', 'Zamazenta V', [JA('SWSH-Black-Star-Promos', 'SWSH293', 'b/293.webp')]),
    trou(692427, 74, 'SWSH-Black-Star-Promos', 'SWSH284', 'Galarian-Moltres-SWSH284', 'Galarian Moltres', [JA('SWSH-Black-Star-Promos', 'SWSH284', 'b/284.webp')])], { lot: 'pkmcom' });
verifier('pkmcom : Mewtwo-GX 78, Xerneas-GX 126, Parasect TG01, Zamazenta V SWSH293, Galarian Moltres SWSH284 -> 5 REMPLACEMENTS de l\'entrée japonaise (set + numéro + nom)',
    [r.plan.map(u => [u.produits[0], u.action, u.remplace[0]?.cleR2, u.url.slice(u.url.lastIndexOf('/') + 1)]), r.restes.length],
    [[[302215, 'remplacement', 'b/78.webp', 'en_US-SL-078-mewtwo_gx.jpg'], [355637, 'remplacement', 'b/126.webp', 'en_US-SM6-126-xerneas_gx.png'], [670826, 'remplacement', 'b/tg01.webp', 'en_US-SWSH11-TG001-parasect.png'], [682983, 'remplacement', 'b/293.webp', 'en_US-Promo_SWSH-SWSH293-zamazenta_v.png'], [692427, 'remplacement', 'b/284.webp', 'en_US-Promo_SWSH-SWSH284-galarian_moltres.png']], 0]);
// 5o. (correction 1) une même carte vendue dans deux kits = deux fiches, deux images (la clé de fiche porte le set Cardmarket)
r = app([trou(80, 12098, 'XY-Trainer-Kit', '20', 'Potion-TK620S', 'Potion'), trou(81, 12098, 'XY-Trainer-Kit-Bisharp-Wigglytuff', '20', 'Potion-TK720W', 'Potion')], { lot: 'kits' });
verifier('Potion n°20 vendue dans deux kits : DEUX unités (une par kit), chacune avec l\'image de SON kit — pas « deux images pour une fiche »', [r.plan.map(u => [u.produits[0], u.pkcSet]), r.restes.length], [[[80, 'xy-trainer-kit-sylveon'], [81, 'xy-trainer-kit-wigglytuff']], 0]);
// 5p. (correction 1) rejugement par la règle du site IMPORTÉE : deux produits d'une même fiche chez nous, mais deux fiches distinctes chez elle -> chacun reçoit l'image de SA demi-deck, sous SON numéro
const deuxAcro = [trou(6, 13, 'XY-Trainer-Kit-Latias-Latios', '20', 'Acro-Bike-TK820A', 'Acro Bike'), trou(7, 13, 'XY-Trainer-Kit-Latias-Latios', '20', 'Acro-Bike-TK820O', 'Acro Bike')];
r = P.apparier({ trous: deuxAcro, entrees: idx.lues, lot: 'kits', ficheDuSite: id => ({ numero: id === 6 ? '20A' : '20O', rang: id }) });
verifier('règle du site : numéros de fiche DISTINCTS par demi-deck -> chaque produit reçoit l\'image de SON demi-deck, écrite sous le numéro du site', [r.plan.map(u => [u.produits[0], u.pkcSet, u.numero]), r.restes.length], [[[6, 'xy-trainer-kit-latias', '20A'], [7, 'xy-trainer-kit-latios', '20O']], 0]);
r = P.apparier({ trous: deuxAcro, entrees: idx.lues, lot: 'kits', ficheDuSite: () => ({ numero: '20', rang: 3 }) });
verifier('règle du site : la MÊME fiche pour les deux produits -> restent sautés, le motif le dit', [r.plan.length, motifs(r).sort(), /même fiche/.test(r.restes[0]?.detail || '')], [0, ['6:deux-images-une-fiche', '7:deux-images-une-fiche'], true]);
r = P.apparier({ trous: deuxAcro, entrees: idx.lues, lot: 'kits', ficheDuSite: id => (id === 6 ? { numero: '20A', rang: 1 } : null) });
verifier('règle du site : un produit que la règle ne sert nulle part -> les deux restent sautés (jamais deviné)', [r.plan.length], [0]);

// 5q. (correction 2) le témoin du nom est la règle de PRODUCTION sur le nom de NOTRE carte seul : le nom du slug Cardmarket n'est pas un témoin
r = app([trou(95, 91, 'XY-Trainer-Kit-Latias-Latios', '24', 'Delcatty-TK824O', 'Skitty')], { lot: 'kits' });
verifier('nom de la carte « Skitty » contre la source « Delcatty » : SAUTÉ même si le slug Cardmarket dit « Delcatty » (le slug n\'est pas un témoin)', [r.plan.length, motifs(r)], [0, ['95:nom-contredit']]);
r = app([trou(96, 92, 'XY-Trainer-Kit-Latias-Latios', '2', 'Fighting-Energy-TK82O', 'Basic Fighting Energy')], { lot: 'kits' });
verifier('« Basic Fighting Energy » (notre carte) = « fighting energy » (la source) : la seule tolérance écrite (préfixe Basic) passe', [r.plan.length, r.plan[0]?.pkcSet], [1, 'xy-trainer-kit-latios']);

r = app([trou(97, 93, 'XY-Trainer-Kit', '26', 'Poke-Ball-TK626S', 'Poké Ball')], { lot: 'kits' });
verifier('les accents : notre « Poké Ball » = la source « poke ball » (la source n\'écrit pas d\'accents ; ils sont repliés des DEUX côtés, en plus de normaliserNom)', [r.plan.length, r.plan[0]?.pkcSet], [1, 'xy-trainer-kit-sylveon']);

// 5r. (correction 3) le lot « autres » : les 12 trous anglais de la mesure du dépôt PTCG-database couverts EN PLUS des quatre lots
r = app([trou(582672, 100, 'Cosmic-Eclipse', '143a', 'Togepi-Cleffa-Igglybuff-GX-V2', 'Togepi & Cleffa & Igglybuff-GX', [{ set: 'Cosmic-Eclipse', source: 'pokemontcg.io', numero: '143', cleR2: 'x/143.webp', langue: 'en', w: 700 }])], { lot: 'autres' });
verifier('autres : Togepi & Cleffa & Igglybuff-GX n°143a (le n°143 est servi, le 143a est le trou) -> AJOUT de l\'entrée 143a de la source, set + numéro + nom', [r.plan.length, r.plan[0]?.action, r.plan[0]?.url.slice(r.plan[0].url.lastIndexOf('/') + 1), r.restes.length], [1, 'ajout', 'en_US-SM12-143a-togepi_cleffa_igglybuff_gx-ya.jpg', 0]);
const MEW = (id, n, slug) => trou(id, 101, '30th-Celebration', n, slug, 'Mew', [{ set: '30th-Celebration', source: 'tcgdex', numero: '065', cleR2: 't/065.webp', langue: 'en', w: 600 }]);
r = app([MEW(909509, 'R', 'Mew-V1-30CRRGB'), MEW(909510, 'G', 'Mew-V2-30CGRGB'), MEW(909511, 'B', 'Mew-V3-30CBRGB')], { lot: 'autres' });
verifier('autres : les trois Mew du 30th Celebration (R, G, B) -> trois fiches, trois images distinctes, à REGARDER (la marque « 30 »)', [r.plan.map(u => [u.produits[0], u.url.slice(u.url.lastIndexOf('/') + 1), u.aRegarder]), r.restes.length], [[[909509, 'me5-5m_en_001_std.png', true], [909510, 'me5-5m_en_002_std.png', true], [909511, 'me5-5m_en_003_std.png', true]], 0]);
r = app([trou(297255, 30360, 'SM-Trainer-Kit-Lycanroc-Alolan-Raichu', '21', 'Great-Ball-V3-TK10A21', 'Great Ball'), trou(297288, 30360, 'SM-Trainer-Kit-Lycanroc-Alolan-Raichu', '21', 'Great-Ball-V1-TK10L21', 'Great Ball')], { lot: 'autres' });
verifier('autres : les huit produits Hau / Great Ball du kit Sun & Moon, où la mesure du dépôt choisit une image sans distinguer les moitiés, restent SAUTÉS (deux images pour une fiche)', [r.plan.length, motifs(r).sort()], [0, ['297255:deux-images-une-fiche', '297288:deux-images-une-fiche']]);
r = app([MEW(909509, 'R', 'Mew-V1-30CRRGB')], { lot: 'pkmcom' });
verifier('la ligne 30th Celebration reste lue par le lot pkmcom (lots supplémentaires, pas un déplacement)', r.plan.length, 1);
r = app([trou(582672, 100, 'Cosmic-Eclipse', '143a', 'Togepi-Cleffa-Igglybuff-GX-V2', 'Togepi & Cleffa & Igglybuff-GX')], { lot: 'kits' });
verifier('un set du lot « autres » n\'est pas offert aux autres lots', motifs(r), ['582672:set-hors-table']);

// ── 6. IDENTIFIANTS PUBLICS : le nom de la source n'y est jamais ────────────────────────────────────────────────────────────
verifier('identifiants : source « pkc », lot « pkc-2026-10 », clé R2 pkc/<set>/<n°>-<carte>-en.webp, _id du document images', [P.SOURCE, P.LOT, P.cleR2('XY-Trainer-Kit', '24', 10), P.idImage('XY-Trainer-Kit', 10, '24'), P.cleNum(null)], ['pkc', 'pkc-2026-10', 'pkc/XY-Trainer-Kit/24-10-en.webp', 'pkc/XY-Trainer-Kit/10/24/en', 'sans-numero']);
verifier('identifiants : aucun ne contient le nom de la source', [P.SOURCE, P.LOT, P.cleR2('S', '1', 1), P.idImage('S', 1, '1'), P.MENTION].some(s => /pkmn|cards\.com/i.test(s)), false);

// ── 7. LE CONTRÔLE D'UNE IMAGE (décision 2 du testeur) ──────────────────────────────────────────────────────────────────────
const dos = fs.readFileSync(path.join(__dirname, 'fixtures', 'dos-de-carte-serveur-images.png'));
verifier('contrôle : un dos de carte connu (empreinte) est REFUSÉ', P.controlerImage({ octets: dos, w: 640, h: 892 }), 'dos-de-carte');
verifier('contrôle : sous le seuil de largeur (350) -> refusé ; un rapport qui n\'est pas celui d\'une carte -> refusé ; une carte 733×1024 passe', [P.controlerImage({ octets: Buffer.from('x'), w: 300, h: 419 }), P.controlerImage({ octets: Buffer.from('x'), w: 733, h: 733 }), P.controlerImage({ octets: Buffer.from('x'), w: 733, h: 1024 })], ['trop-petit', 'rapport-hors-carte', null]);
verifier('contrôle : la même empreinte sous deux adresses du plan = un dos ou un espace réservé -> tous refusés (meme-image-plusieurs-adresses)', (() => { const m = P.imagesIdentiques([{ url: 'a', sha256: 'x1' }, { url: 'b', sha256: 'x1' }, { url: 'c', sha256: 'x2' }]); return [...m.keys()].sort(); })(), ['a', 'b']);

// ── 8. LE RETRAIT ET LA LANGUE ──────────────────────────────────────────────────────────────────────────────────────────────
const retrait = P.planRetrait([{ _id: 1, images: [{ source: 'pkc', lot: 'pkc-2026-10', cleR2: 'pkc/a.webp', vignette: { cleR2: 'vignettes/pkc/a.webp' } }, { source: 'pkc', lot: 'autre', cleR2: 'pkc/b.webp' }, { source: 'tcgdex', lot: 'pkc-2026-10', cleR2: 't.webp' }] }, { _id: 2, images: [] }]);
verifier('retrait : TOUTE la source pkc (tous ses lots), jamais une autre source, vignettes comprises', [retrait.cartes, retrait.entrees, retrait.cles], [[1], 2, ['pkc/a.webp', 'vignettes/pkc/a.webp', 'pkc/b.webp']]);
const { langueDuVisuel } = require('./collecte-cartes/langue-visuel');
const lg = langueDuVisuel({ source: 'pkc', urlOriginal: UP('x.png') });
verifier('langue : « en », preuve PUBLIQUE sans le nom de la source ni l\'hôte', [lg.langue, /pkmn|cards\.com/i.test(lg.preuve)], ['en', false]);
verifier('langue : une adresse d\'origine hors règle n\'a pas de règle (null)', langueDuVisuel({ source: 'pkc', urlOriginal: 'https://autre.example/x.png' }).langue, null);
const { largeurMinDe } = require('./collecte-cartes/seuils-images');
verifier('seuil : la source « pkc » n\'est PAS officielle -> 350 px (le seuil des autres sources ne change pas)', largeurMinDe(P.SOURCE), 350);

console.log(`\n${ok} passés, ${ko} en échec`);
process.exit(ko ? 1 : 0);
