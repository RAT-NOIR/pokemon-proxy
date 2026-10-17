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
verifier('sitemap : l\'extrait réel donne 67 entrées (loc + image:loc), aucune écartée', [lus.entrees.length, lus.ecartees.length], [67, 0]);
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
verifier('table : les quatre lots ont au moins un set', P.LOTS.map(l => Object.values(P.TABLE).some(e => e.lot === l)), [true, true, true, true]);
verifier('table : la table est GELÉE (une ligne ne se change pas à l\'exécution)', [Object.isFrozen(P.TABLE), Object.isFrozen(P.TABLE['xy-trainer-kit-latios'])], [true, true]);

// ── 5. L'APPARIEMENT CARTE PAR CARTE ───────────────────────────────────────────────────────────────────────────────────────
const idx = P.indexer(lus.entrees);
verifier('index : 67 entrées lues, celles dont l\'adresse ne se lit pas sont comptées à part (jamais perdues en silence)', [idx.lues.length + idx.illisibles.length, idx.illisibles.map(x => x.loc.replace(H + '/card/', ''))], [67, ['unown-unseen-forces-uf/']]);
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
verifier('entrée refusée par la règle du site (scan japonais) : modification qui attend le testeur -> entree-refusee-au-numero, rien ne part', [r.plan.length, motifs(r)], [0, ['30:entree-refusee-au-numero']]);
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
