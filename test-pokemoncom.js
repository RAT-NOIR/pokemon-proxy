// node test-pokemoncom.js — LE MODULE PUR de l'import pokemon.com (collecte-cartes/pokemoncom.js), lot PKMCOM-IMPORT (2026-10-17).
// Aucune requête, aucune base : des relevés FABRIQUÉS + la fixture RÉELLE du dépôt (fixture-pokemoncom-reel.js, Guardians Rising, 12 cartes).
// Ce que le banc garde :
//   · la table des cases est FERMÉE ; une adresse n'est valable que sur l'hôte d'images, en https, sous le chemin des cartes ;
//   · un appariement exige DEUX éléments (set+numéro, puis nom ; pour une fiche sans numéro : le numéro du slug ou un nom unique) ;
//   · un doute est un trou, avec son motif : nom qui contredit, numéro douteux, numéro du slug contredit, deux images pour une fiche,
//     une carte relevée pour deux fiches, un nom non unique, un relevé incomplet ;
//   · le doute du relevé (numeroDoute) ne se lève que par deux lectures du HTML gardé (lien ET nom de fichier) qui s'accordent.
const PK = require('./collecte-cartes/pokemoncom');
const FIXTURE = require('./fixture-pokemoncom-reel');

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); }
};

const BASE = 'https://assets.pokemon.com/static-assets/content-assets/cms2/img/cards/web';
const img = (dossier, fichier) => `${BASE}/${dossier}/${fichier}`;
const li = (set, num, dossier, fichier, alt) => `<li>\n<a href="/us/pokemon-tcg/pokemon-cards/series/${set}/${num}/">\n<div><img src="${img(dossier, fichier)}" alt="${alt}"></div>\n</a>\n</li>`;
// une carte de relevé (forme du schéma 2) ; `doute` : la forme du userscript quand son témoin refuse (numero et set vides)
const carte = (nom, numero, set, fichier, o = {}) => ({ nom, numero: o.doute ? '' : numero, numeroDoute: !!o.doute, set: o.doute ? '' : set, img: fichier.startsWith('http') ? fichier : img(set.toUpperCase(), fichier), alt: o.alt ?? nom });
const releve = (cartes, o = {}) => ({ schema: 2, url: 'https://www.pokemon.com/us/pokemon-tcg/pokemon-cards?x=1', cartes, html: o.html ?? '', pagination: o.pagination ?? 'Previous Results 1 of 1 Next Results', diagnostic: { etat: o.etat ?? 'complet', complet: (o.etat ?? 'complet') === 'complet', pageCourante: 1, pagesTotal: o.pagesTotal ?? 1 }, _fichier: o.fichier ?? 'page--fabrique.json' });
const trou = (idProduct, carteId, nomEn, slugSet, numeroFiche, slugProduit = null, images = []) => ({ idProduct, carteId, slugSet, numeroFiche, slugProduit, carte: { _id: carteId, nomEn, images } });
const nomsDe = (...cartes) => { const m = new Map(); for (const [slugSet, nom, carteId] of cartes) { const k = PK.nomNorm(nom); if (!m.has(slugSet)) m.set(slugSet, new Map()); const s = m.get(slugSet); if (!s.has(k)) s.set(k, new Set()); s.get(k).add(carteId); } return m; };
const cartesReleve = rs => PK.cartesDesReleves(rs).cartes;
const motifs = r => r.restes.map(x => [x.idProduct, x.motif]).sort((a, b) => a[0] - b[0]);
const SOURCE_URL = img('EX10', 'EX10_EN_Unown_B.png');

(async () => {
    // ── 1. la table des cases ────────────────────────────────────────────────────────────────────────────────────────────
    verifier('la table des cases est FERMÉE : les 10 cases, exactement', PK.CASES, { '30th': '30th-Celebration', '30th-c': '30th-Celebration', svp: 'SV-Black-Star-Promos', mep: 'MEP-Black-Star-Promos', swsh11tg: 'Lost-Origin', swshp: 'SWSH-Black-Star-Promos', sm35: 'Shining-Legends', sm6: 'Forbidden-Light', ex10: 'EX-Unseen-Forces', hgss1: 'HeartGold-SoulSilver' });
    verifier('slugDeLaCase : la casse est ignorée, une case hors table (Hidden Fates, __proto__, constructor) rend null', ['SWSHP', 'sm115', '__proto__', 'constructor', '', null].map(c => PK.slugDeLaCase(c)), ['SWSH-Black-Star-Promos', null, null, null, null, null]);
    verifier('la table est gelée', [Object.isFrozen(PK.CASES), Object.isFrozen(PK.CASES_RELEVEES ?? PK.CASES)], [true, true]);

    // ── 2. l'adresse : hôte d'images seul, https, chemin des cartes ──────────────────────────────────────────────────────
    verifier('adresse : la vraie forme (relevé du testeur) est valable', PK.urlImageValide(img('SM2', 'SM2_EN_1.png')), true);
    const refusees = [['http://assets.pokemon.com/static-assets/content-assets/cms2/img/cards/web/SM2/SM2_EN_1.png', 'http clair'], ['https://www.pokemon.com/static-assets/content-assets/cms2/img/cards/web/SM2/SM2_EN_1.png', 'www'],
        [`https://assets.${'pokemon'}.com.evil.example/static-assets/content-assets/cms2/img/cards/web/SM2/SM2_EN_1.png`, 'hôte déguisé'], [`https://api.${'pokemon'}.com/static-assets/content-assets/cms2/img/cards/web/SM2/SM2_EN_1.png`, 'autre sous-domaine'],
        [`https://assets.${'pokemon'}.com/${'api'}/cards/SM2_EN_1.png`, 'hors du chemin des cartes'], ['https://assets.pokemon.com/static-assets/content-assets/cms2/img/cards/../secret.png', 'remontée'],
        [`${BASE}/SM2/SM2_EN_1.png?x=1`, 'paramètre'], [`${BASE}/SM2/SM2_EN_1.png#f`, 'ancre'], ['https://u:p@assets.pokemon.com/static-assets/content-assets/cms2/img/cards/web/SM2/SM2_EN_1.png', 'identifiants'],
        ['https://assets.pokemon.com:8443/static-assets/content-assets/cms2/img/cards/web/SM2/SM2_EN_1.png', 'port'], [`${BASE}/SM2/SM2_EN_1.html`, 'pas une image'], ['https://assets.pokemon.com/robots.txt', 'robots.txt n\'est pas une image'], ['', 'vide'], [null, 'null']];
    for (const [u, nom] of refusees) verifier(`adresse refusée : ${nom}`, PK.urlImageValide(u), false);

    // ── 3. la fixture RÉELLE : les liens du HTML gardé ───────────────────────────────────────────────────────────────────
    const liens = PK.lireLiensDuHtml(FIXTURE.html);
    verifier('fixture réelle : 12 cartes, lien et image lus ensemble', [liens.length, liens[0], liens[11].href], [12, { href: '/us/pokemon-tcg/pokemon-cards/series/sm2/1/', src: img('SM2', 'SM2_EN_1.png'), alt: 'Bellsprout' }, '/us/pokemon-tcg/pokemon-cards/series/sm2/12/']);

    // ── 4. lever le doute du relevé : deux lectures du HTML (lien ET nom de fichier) qui s'accordent ──────────────────────
    // (le userscript 1.1 compare le code du lien au code du fichier à la lettre : « swsh11tg » ≠ « SWSH11 », « 30th-c » ≠ « 30TH-C », « A » ≠ « Unown_A » — il met un doute que les deux lectures lèvent)
    const reel = releve(liens.map(l => ({ nom: l.alt, numero: '', numeroDoute: true, set: '', img: l.src, alt: l.alt })), { html: FIXTURE.html });
    const r0 = PK.relireDouteux(reel);
    verifier('fixture réelle rejouée avec un doute partout : les 12 cartes sont relues (sm2, 1 à 12) depuis le lien ET le fichier', [r0.cartes.every(c => !c.numeroDoute && c.set === 'sm2' && c.relu === true), r0.cartes.map(c => c.numero).join(',')], [true, '1,2,3,4,5,6,7,8,9,10,11,12']);
    const html = [li('ex10', 'A', 'EX10', 'EX10_EN_Unown_A.png', 'Unown A'), li('swsh11tg', 'TG01', 'SWSH11', 'SWSH11_EN_TG01.png', 'Parasect'), li('30th-c', '4', '30TH-C', '30TH-C_EN_4.png', 'Genesect-EX'),
        li('ex10', 'question', 'EX10', 'EX10_EN_Unown_Question.png', 'Unown ?'), li('sm1', '5', 'SM115', 'SM115_EN_5.png', 'Faux-set-voisin'), li('swshp', '7', 'SWSHP', 'SWSHP_EN_SWSH8.png', 'Numéro-différent'),
        li('hidden', '9', 'SM115', 'SM115_EN_9.png', 'Case-hors-table'), li('ex10', 'B', 'EX10', 'EX10_EN_Unown_C.png', 'Unown B')].join('\n');
    const doutes = [['Unown A', 'EX10', 'EX10_EN_Unown_A.png'], ['Parasect', 'SWSH11', 'SWSH11_EN_TG01.png'], ['Genesect-EX', '30TH-C', '30TH-C_EN_4.png'], ['Unown ?', 'EX10', 'EX10_EN_Unown_Question.png'], ['Faux-set-voisin', 'SM115', 'SM115_EN_5.png'],
        ['Numéro-différent', 'SWSHP', 'SWSHP_EN_SWSH8.png'], ['Case-hors-table', 'SM115', 'SM115_EN_9.png'], ['Unown B', 'EX10', 'EX10_EN_Unown_C.png']].map(([n, d, f]) => ({ nom: n, numero: '', numeroDoute: true, set: '', img: img(d, f), alt: n }));
    const r1 = PK.relireDouteux(releve(doutes, { html }));
    verifier('doute levé : Unown A (lien « A », fichier « Unown_A »), Parasect TG01 (lien swsh11tg, fichier SWSH11), Genesect-EX (30th-c / 30TH-C)', r1.cartes.slice(0, 3).map(c => [c.set, c.numero, c.numeroDoute]), [['ex10', 'A', false], ['swsh11tg', 'TG01', false], ['30th-c', '4', false]]);
    verifier('doute gardé : « question » (fichier « Unown_Question »), un suffixe hors liste (sm1 / SM115), un numéro différent, une case hors table, un nom de fichier qui contredit le lien', r1.cartes.slice(3).map(c => [c.nom, c.numeroDoute, c.numero]), [['Unown ?', true, ''], ['Faux-set-voisin', true, ''], ['Numéro-différent', true, ''], ['Case-hors-table', true, ''], ['Unown B', true, '']]);
    verifier('une carte dont l\'image n\'est pas dans le HTML gardé garde son doute', PK.relireDouteux(releve([{ nom: 'X', numero: '', numeroDoute: true, set: '', img: img('EX10', 'EX10_EN_Unown_Z.png'), alt: 'X' }], { html })).cartes[0].numeroDoute, true);
    verifier('une carte NON douteuse n\'est jamais retouchée par la relecture', PK.relireDouteux(releve([carte('Mew', '65', '30th', '30TH_EN_65.png')], { html: '' })).cartes[0], carte('Mew', '65', '30th', '30TH_EN_65.png'));

    // ── 5. l'appariement à deux éléments ────────────────────────────────────────────────────────────────────────────────
    const SET = 'EX-Unseen-Forces';
    let R = releve([carte('Unown B', 'B', 'ex10', 'EX10_EN_Unown_B.png'), carte('Unown C', 'C', 'ex10', 'EX10_EN_Unown_C.png')]);
    let r = PK.apparier({ trous: [trou(1, 11, 'Unown', SET, 'B', 'Unown-B-UFB-28'), trou(2, 12, 'Unown', SET, 'C', 'Unown-C-UFC-28')], cartes: cartesReleve([R]), noms: nomsDe([SET, 'Unown', 11], [SET, 'Unown', 12]) });
    verifier('numéro + nom : Unown B ↔ lettre B, Unown C ↔ lettre C (la lettre gardée, le nom « Unown B » se lit « Unown »)', r.plan.map(p => [p.carteId, p.numero, p.url.split('/').pop(), p.voie]), [[11, 'B', 'EX10_EN_Unown_B.png', 'set+numero+nom'], [12, 'C', 'EX10_EN_Unown_C.png', 'set+numero+nom']]);
    verifier('   la preuve nomme la case, le numéro et le nom', /ex10/.test(r.plan[0].preuve) && /B/.test(r.plan[0].preuve) && /Unown/.test(r.plan[0].preuve), true);
    r = PK.apparier({ trous: [trou(1, 11, 'Unown', SET, 'B', 'Unown-B-UFB-28')], cartes: cartesReleve([releve([carte('Gengar', 'B', 'ex10', 'EX10_EN_Unown_B.png')])]), noms: nomsDe([SET, 'Unown', 11]) });
    verifier('un NOM qui contredit le numéro → trou « nom-contredit », rien dans le plan', [r.plan.length, motifs(r)], [0, [[1, 'nom-contredit']]]);
    r = PK.apparier({ trous: [trou(1, 11, 'Unown', SET, 'B', 'Unown-B-UFB-28')], cartes: cartesReleve([releve([carte('Unown B', '', '', SOURCE_URL, { doute: true })])]), noms: nomsDe([SET, 'Unown', 11]) });
    verifier('un NUMÉRO DOUTEUX (non levé) → trou « numero-douteux », jamais une devinette par le nom', [r.plan.length, motifs(r)], [0, [[1, 'numero-douteux']]]);
    r = PK.apparier({ trous: [trou(1, 11, 'Unown', SET, 'D', 'Unown-D-UFD-28')], cartes: cartesReleve([releve([carte('Unown B', 'B', 'ex10', 'EX10_EN_Unown_B.png')])]), noms: nomsDe([SET, 'Unown', 11]) });
    verifier('un numéro absent du relevé → « numero-absent-du-releve »', motifs(r), [[1, 'numero-absent-du-releve']]);
    r = PK.apparier({ trous: [trou(1, 11, 'Unown', SET, 'B', 'Unown-B-UFB-28')], cartes: cartesReleve([releve([carte('Unown B', 'B', 'ex10', 'EX10_EN_Unown_B.png'), carte('Unown B', 'B', 'ex10', 'EX10_EN_Unown_B2.png')])]), noms: nomsDe([SET, 'Unown', 11]) });
    verifier('deux images différentes pour le même (case, numéro) → « releve-contradictoire »', motifs(r), [[1, 'releve-contradictoire']]);
    r = PK.apparier({ trous: [trou(1, 11, 'Unown', SET, 'B', 'Unown-B-UFB-28')], cartes: cartesReleve([releve([carte('Unown B', 'B', 'ex10', 'EX10_EN_Unown_B.png')], { fichier: 'a.json' }), releve([carte('Unown B', 'B', 'ex10', 'EX10_EN_Unown_B.png')], { fichier: 'b.json' })]), noms: nomsDe([SET, 'Unown', 11]) });
    verifier('la même carte relevée dans deux fichiers (même adresse) ne compte qu\'une fois', r.plan.length, 1);
    r = PK.apparier({ trous: [trou(1, 11, 'Unown', SET, 'B', 'Unown-B-UFB-28', [{ set: SET, source: 'tcgdex', numero: 'B' }])], cartes: cartesReleve([R]), noms: nomsDe([SET, 'Unown', 11]) });
    verifier('additif : un trou DÉJÀ servi à ce numéro (autre source) n\'entre pas dans le plan (« deja-servi »)', [r.plan.length, motifs(r)], [0, [[1, 'deja-servi']]]);
    r = PK.apparier({ trous: [trou(1, 11, 'Unown', SET, 'B', 'Unown-B-UFB-28', [{ set: 'Autre-Set', source: 'artofpkm', numero: 'B' }])], cartes: cartesReleve([R]), noms: nomsDe([SET, 'Unown', 11]) });
    verifier('   …mais une image d\'un AUTRE set ne sert pas ce set', r.plan.length, 1);
    r = PK.apparier({ trous: [trou(1, 11, 'Unown', SET, 'B', 'Unown-B-UFB-28')], cartes: cartesReleve([releve([carte('Unown B', 'B', 'sm115', 'SM115_EN_B.png')])]), noms: nomsDe([SET, 'Unown', 11]) });
    verifier('une carte relevée sous une case hors de la table (sm115) est ignorée : « set-non-releve »', motifs(r), [[1, 'set-non-releve']]);

    // les promos : le préfixe du numéro est GARDÉ (cleNumero de la production)
    const SW = 'SWSH-Black-Star-Promos';
    const Rsw = releve([carte('Galarian Moltres', 'SWSH125', 'swshp', 'SWSHP_EN_SWSH125.png'), carte('Galarian Moltres', 'SWSH284', 'swshp', 'SWSHP_EN_SWSH284.png'), carte('Lugia V', 'SWSH301', 'swshp', 'SWSHP_EN_SWSH301.png')]);
    r = PK.apparier({ trous: [trou(20, 200, 'Galarian Moltres', SW, 'SWSH284', 'Galarian-Moltres-SWSH284'), trou(21, 210, 'Lugia V', SW, 'SWSH301', 'Lugia-V-V1-SWSH301'), trou(22, 210, 'Lugia V', SW, 'SWSH301', 'Lugia-V-V2-SWSH301')], cartes: cartesReleve([Rsw]), noms: nomsDe([SW, 'Galarian Moltres', 200], [SW, 'Lugia V', 210]) });
    verifier('SWSH284 ↔ SWSH284 (pas SWSH125, même nom) ; Lugia V SWSH301 : deux produits, UNE fiche → une image, deux produits', r.plan.map(p => [p.carteId, p.numero, p.url.split('/').pop(), p.produits]), [[200, 'SWSH284', 'SWSHP_EN_SWSH284.png', [20]], [210, 'SWSH301', 'SWSHP_EN_SWSH301.png', [21, 22]]]);
    r = PK.apparier({ trous: [trou(20, 200, 'Galarian Moltres', SW, '284', 'Galarian-Moltres-SWSH284')], cartes: cartesReleve([Rsw]), noms: nomsDe([SW, 'Galarian Moltres', 200]) });
    verifier('un numéro sans le préfixe (« 284 ») ne désigne pas « SWSH284 »', motifs(r), [[20, 'numero-absent-du-releve']]);
    r = PK.apparier({ trous: [trou(30, 301, 'Lugia V', SW, 'SWSH301', 'x'), trou(31, 302, 'Lugia V', SW, 'SWSH301', 'x')], cartes: cartesReleve([Rsw]), noms: nomsDe([SW, 'Lugia V', 301], [SW, 'Lugia V', 302]) });
    verifier('UNE carte relevée pour deux fiches différentes → trou pour les deux (« carte-pour-deux-fiches »)', motifs(r), [[30, 'carte-pour-deux-fiches'], [31, 'carte-pour-deux-fiches']]);
    r = PK.apparier({ trous: [trou(20, 200, 'Professor\'s Research', 'SV-Black-Star-Promos', '221', 'Professors-Research-Professor-Birch-SVP221')], cartes: cartesReleve([releve([carte('Professor’s Research', '221', 'svp', 'SVP_EN_221.png')])]), noms: nomsDe(['SV-Black-Star-Promos', 'Professor\'s Research', 200]) });
    verifier('l\'apostrophe typographique (« Professor’s ») est normalisée comme la production', r.plan.length, 1);

    // fiche SANS numéro, slug qui porte le numéro d'origine : HGSS (energies), 30C (Genesect, Darkrai)
    const HG = 'HeartGold-SoulSilver';
    r = PK.apparier({ trous: [trou(40, 400, 'Basic Darkness Energy', HG, null, 'Darkness-Energy-HS121')], cartes: cartesReleve([releve([carte('Darkness Energy', '121', 'hgss1', 'HGSS1_EN_121.png')])]), noms: nomsDe([HG, 'Basic Darkness Energy', 400]) });
    verifier('fiche sans numéro : le numéro du SLUG (HS121 → 121) contre le numéro relevé, et le nom du slug (« Darkness Energy ») contre le nom relevé', r.plan.map(p => [p.numero, p.voie, p.numeroReleve]), [[null, 'set+numero-du-slug+nom', '121']]);
    r = PK.apparier({ trous: [trou(40, 400, 'Basic Darkness Energy', HG, null, 'Darkness-Energy-HS121')], cartes: cartesReleve([releve([carte('Darkness Energy', '120', 'hgss1', 'HGSS1_EN_120.png')])]), noms: nomsDe([HG, 'Basic Darkness Energy', 400]) });
    verifier('   le relevé porte un AUTRE numéro pour ce nom → « numero-du-slug-contredit » (le nom unique ne rattrape pas un numéro contredit)', motifs(r), [[40, 'numero-du-slug-contredit']]);
    const T30 = '30th-Celebration';
    r = PK.apparier({ trous: [trou(50, 500, 'Genesect-EX', T30, null, 'Genesect-EX-30CPLB-97')], cartes: cartesReleve([releve([carte('Genesect-EX', '4', '30th-c', '30TH-C_EN_4.png')])]), noms: nomsDe([T30, 'Genesect-EX', 500]) });
    verifier('Genesect-EX : pokemon.com numérote la Classic Collection 1…N (n°4), pas au numéro d\'origine (slug 97) : le numéro n\'est PAS un élément en 30th-c ; nom unique relevé ET chez nous, à regarder (marque « 30 »)', [r.plan.map(p => [p.voie, p.numeroReleve, p.aRegarder]), r.restes.length], [[['set+nom-unique', '4', true]], 0]);
    r = PK.apparier({ trous: [trou(50, 500, 'Genesect-EX', T30, null, 'Genesect-EX-30CPLB-97')], cartes: cartesReleve([releve([carte('Genesect-EX', '4', '30th-c', '30TH-C_EN_4.png'), carte('Genesect-EX', '30', '30th', '30TH_EN_30.png')])]), noms: nomsDe([T30, 'Genesect-EX', 500]) });
    verifier('   un second Genesect-EX relevé dans la case 30th → « nom-non-unique »', motifs(r), [[50, 'nom-non-unique']]);
    r = PK.apparier({ trous: [trou(60, 600, 'Darkrai & Cresselia LEGEND', T30, null, 'Darkrai-Cresselia-LEGEND-30CTM-99'), trou(61, 600, 'Darkrai & Cresselia LEGEND', T30, null, 'Darkrai-Cresselia-LEGEND-30CTM-100')],
        cartes: cartesReleve([releve([carte('Darkrai & Cresselia LEGEND', '99', '30th-c', '30TH-C_EN_99.png'), carte('Darkrai & Cresselia LEGEND', '100', '30th-c', '30TH-C_EN_100.png')])]), noms: nomsDe([T30, 'Darkrai & Cresselia LEGEND', 600]) });
    verifier('LEGEND : une fiche sans numéro, deux moitiés, deux images au même nom → trou pour les deux produits (« nom-non-unique »)', [r.plan.length, motifs(r)], [0, [[60, 'nom-non-unique'], [61, 'nom-non-unique']]]);
    // deux produits d'une fiche sans numéro dont les numéros de slug désignent deux images en HGSS (case numérotée normalement) : « deux-images-une-fiche »
    r = PK.apparier({ trous: [trou(62, 620, 'Basic Darkness Energy', HG, null, 'Darkness-Energy-HS121'), trou(63, 620, 'Basic Darkness Energy', HG, null, 'Darkness-Energy-HS122')], cartes: cartesReleve([releve([carte('Darkness Energy', '121', 'hgss1', 'HGSS1_EN_121.png'), carte('Darkness Energy', '122', 'hgss1', 'HGSS1_EN_122.png')])]), noms: nomsDe([HG, 'Basic Darkness Energy', 620]) });
    verifier('une fiche, deux produits, deux numéros de slug, deux images → « deux-images-une-fiche »', [r.plan.length, motifs(r)], [0, [[62, 'deux-images-une-fiche'], [63, 'deux-images-une-fiche']]]);
    r = PK.apparier({ trous: [trou(70, 700, 'Mew', T30, 'R', 'Mew-V1-30CRRGB'), trou(71, 700, 'Mew', T30, 'G', 'Mew-V2-30CGRGB'), trou(72, 700, 'Mew', T30, 'B', 'Mew-V3-30CBRGB')],
        cartes: cartesReleve([releve([carte('Mew', 'R', '30th', '30TH_EN_R.png'), carte('Mew', 'G', '30th', '30TH_EN_G.png'), carte('Mew', 'B', '30th', '30TH_EN_B.png'), carte('Mew', '65', '30th', '30TH_EN_65.png')])]), noms: nomsDe([T30, 'Mew', 700]) });
    verifier('Mew R, G, B : trois fiches (lettres gardées), trois images de la case 30th (numérotation comparable) ; le Mew n° 65 n\'est pas pris', r.plan.map(p => [p.numero, p.url.split('/').pop()]).sort(), [['B', '30TH_EN_B.png'], ['G', '30TH_EN_G.png'], ['R', '30TH_EN_R.png']]);
    // 🔑 « numéro non comparable » se déclare par CASE pokemon.com (30th-c), pas par set à nous (30th-Celebration)
    const rm = (fiche, cas, dossier) => PK.apparier({ trous: [trou(75, 750, 'Mewtwo ex', T30, fiche, null)], cartes: cartesReleve([releve([carte('Mewtwo ex', '64', cas, `${dossier}_EN_64.png`)])]), noms: nomsDe([T30, 'Mewtwo ex', 750]) });
    verifier('Mewtwo ex fiche 64 : appariée à la case 30th n°64 → le numéro est COMPARÉ (accord) ; fiche 65 contre le même relevé → « numero-absent-du-releve »', [rm('64', '30th', '30TH').plan.map(p => p.voie), motifs(rm('65', '30th', '30TH'))], [['set+numero+nom'], [[75, 'numero-absent-du-releve']]]);
    verifier('   la même fiche 64 contre la case 30th-c n°64 : le numéro ne sert JAMAIS (numérotation propre 1…N)', motifs(rm('64', '30th-c', '30TH-C')), [[75, 'numero-absent-du-releve']]);

    // ── 5 ter. entrée REFUSÉE par la règle du site au même numéro : jamais « deja-servi » (remplacer = modifier, feu vert du testeur) ──
    const JA = { set: SET, source: 'bulbapedia', numero: 'B', cleR2: 'bulbapedia/EX/ja-B.webp', langue: 'ja' };
    r = PK.apparier({ trous: [trou(1, 11, 'Unown', SET, 'B', 'Unown-B-UFB-28', [JA])], cartes: cartesReleve([R]), noms: nomsDe([SET, 'Unown', 11]) });
    verifier('entrée japonaise au même numéro : PAS « deja-servi » ; hors plan, listée aux remplacements avec la cleR2 refusée et l\'adresse', [r.plan.length, motifs(r), r.remplacements.map(x => [x.produits, x.url.split('/').pop(), x.refusees.map(e => [e.cleR2, e.motif])])], [0, [[1, 'entree-refusee-au-numero']], [[[1], 'EX10_EN_Unown_B.png', [['bulbapedia/EX/ja-B.webp', 'langue:ja']]]]]);
    verifier('   le motif dit pourquoi : remplacement = modification, feu vert du testeur requis', /remplacement = modification, feu vert du testeur requis/.test(r.restes[0].detail || ''), true);
    r = PK.apparier({ trous: [trou(1, 11, 'Unown', SET, 'B', 'Unown-B-UFB-28', [JA, { set: SET, source: 'tcgdex', numero: 'B', cleR2: 'tcgdex/B.webp', langue: 'en' }])], cartes: cartesReleve([R]), noms: nomsDe([SET, 'Unown', 11]) });
    verifier('   une entrée ADMISE au même numéro (tcgdex en) reste « deja-servi » : rien à remplacer', [motifs(r), r.remplacements.length], [[[1, 'deja-servi']], 0]);
    r = PK.apparier({ trous: [trou(1, 11, 'Unown', SET, 'B', 'Unown-B-UFB-28', [JA])], cartes: cartesReleve([R]), noms: nomsDe([SET, 'Unown', 11]), refus: e => (e.cleR2 === 'bulbapedia/EX/ja-B.webp' ? 'format:868×1212' : null) });
    verifier('   la règle du site est INJECTÉE (refus) : son motif est celui qui s\'écrit', r.remplacements[0].refusees[0].motif, 'format:868×1212');
    r = PK.apparier({ trous: [trou(1, 11, 'Unown', SET, 'B', 'Unown-B-UFB-28', [JA])], cartes: cartesReleve([releve([carte('Gengar', 'B', 'ex10', 'EX10_EN_Unown_B.png')])]), noms: nomsDe([SET, 'Unown', 11]) });
    verifier('   si l\'appariement échoue (nom qui contredit), le motif est celui de l\'appariement, pas un remplacement', [motifs(r), r.remplacements.length], [[[1, 'nom-contredit']], 0]);

    // fiche SANS numéro et SANS numéro de slug : un nom UNIQUE chez le relevé ET chez nous (Terapagos & Friends, Pikachu at the Museum)
    const SV = 'SV-Black-Star-Promos';
    const tera = [carte('Terapagos & Friends', '', 'svp', 'SVP_EN_9.png', { doute: false })];
    tera[0].numero = '9'; tera[0].set = 'svp';
    r = PK.apparier({ trous: [trou(80, 800, 'Terapagos & Friends', SV, null, null)], cartes: cartesReleve([releve(tera)]), noms: nomsDe([SV, 'Terapagos & Friends', 800]) });
    verifier('fiche sans numéro ni numéro de slug : un nom UNIQUE dans la case relevée ET chez nous suffit (voie « set+nom-unique »)', r.plan.map(p => [p.numero, p.voie]), [[null, 'set+nom-unique']]);
    r = PK.apparier({ trous: [trou(80, 800, 'Terapagos & Friends', SV, null, null)], cartes: cartesReleve([releve([...tera, carte('Terapagos & Friends', '10', 'svp', 'SVP_EN_10.png')])]), noms: nomsDe([SV, 'Terapagos & Friends', 800]) });
    verifier('   deux cartes relevées au même nom → « nom-non-unique »', motifs(r), [[80, 'nom-non-unique']]);
    r = PK.apparier({ trous: [trou(81, 810, 'Pikachu at the Museum', 'MEP-Black-Star-Promos', null, null)], cartes: cartesReleve([releve(tera)]), noms: nomsDe(['MEP-Black-Star-Promos', 'Pikachu at the Museum', 810]) });
    verifier('   un set dont aucune carte n\'est relevée (Pikachu at the Museum, case mep) → « set-non-releve » ; relevé du set sans le nom → « absent-du-releve »', [motifs(r), motifs(PK.apparier({ trous: [trou(81, 810, 'Pikachu at the Museum', SV, null, null)], cartes: cartesReleve([releve(tera)]), noms: nomsDe([SV, 'Pikachu at the Museum', 810]) }))], [[[81, 'set-non-releve']], [[81, 'absent-du-releve']]]);
    r = PK.apparier({ trous: [trou(80, 800, 'Terapagos & Friends', SV, null, null)], cartes: cartesReleve([releve(tera)]), noms: nomsDe([SV, 'Terapagos & Friends', 800], [SV, 'Terapagos & Friends', 801]) });
    verifier('   deux fiches chez nous au même nom dans le set → « nom-non-unique »', motifs(r), [[80, 'nom-non-unique']]);
    r = PK.apparier({ trous: [trou(80, 800, 'Terapagos & Friends', SV, null, null)], cartes: cartesReleve([releve(tera, { pagination: 'Previous Results 1 of 2 Next Results', pagesTotal: 2, etat: 'complet' })]), noms: nomsDe([SV, 'Terapagos & Friends', 800]) });
    verifier('   un relevé sur plusieurs pages ne prouve pas l\'unicité → « releve-incomplet »', motifs(r), [[80, 'releve-incomplet']]);

    // Morpeko : le nom ou le numéro doit désigner UN produit
    const Rm = releve([carte('Morpeko V-UNION Top Left', 'SWSH215', 'swshp', 'SWSHP_EN_SWSH215.png'), carte('Morpeko V-UNION', 'SWSH287', 'swshp', 'SWSHP_EN_SWSH287.png')]);
    r = PK.apparier({ trous: [trou(90, 900, 'Morpeko V-UNION', SW, 'SWSH287', 'Morpeko-V-UNION-V10-SWSH287'), trou(91, 900, 'Morpeko V-UNION', SW, 'SWSH287 (Top Left)', 'Morpeko-V-UNION-V6-SWSH287')], cartes: cartesReleve([Rm]), noms: nomsDe([SW, 'Morpeko V-UNION', 900]) });
    verifier('Morpeko : « SWSH287 » désigne SWSH287 ; « SWSH287 (Top Left) » ne désigne aucun numéro relevé (on ne devine pas la position) → trou', [r.plan.map(p => p.produits), motifs(r)], [[[90]], [[91, 'numero-absent-du-releve']]]);

    // ── 5 bis. lecture des dossiers de relevés : schéma 1 ignoré et dit, doublons par adresse ─────────────────────────────
    const os = require('os'), fs = require('fs'), path = require('path');
    const dos = fs.mkdtempSync(path.join(os.tmpdir(), 'pkmcom-banc-'));
    const ecrire = (nom, o) => fs.writeFileSync(path.join(dos, nom), JSON.stringify(o));
    ecrire('page--a.json', releve([carte('Darkness Energy', '121', 'hgss1', 'HGSS1_EN_121.png')]));
    ecrire('page--b.json', releve([carte('Darkness Energy', '121', 'hgss1', 'HGSS1_EN_121.png')]));
    ecrire('page--ancien.json', { ...releve([carte('Bellsprout', '', '', 'SM2_EN_1.png')]), schema: 1 });
    ecrire('diag--a.json', { schema: 2 });
    const lu = PK.lireReleves(dos);
    verifier('dossier : le schéma 1 est ignoré ET dit ; les diag-- ne sont pas des relevés ; deux fichiers identiques → une carte', [lu.cartes.length, lu.ignores.map(x => [x.fichier, /schema 1/.test(x.motif)]), lu.fichiers], [1, [['page--ancien.json', true]], 2]);
    fs.rmSync(dos, { recursive: true, force: true });

    // ── 6. propriétés ───────────────────────────────────────────────────────────────────────────────────────────────────
    const tout = PK.apparier({ trous: [trou(1, 11, 'Unown', SET, 'B', 'Unown-B-UFB-28'), trou(40, 400, 'Basic Darkness Energy', HG, null, 'Darkness-Energy-HS121')], cartes: cartesReleve([R, releve([carte('Darkness Energy', '121', 'hgss1', 'HGSS1_EN_121.png')])]), noms: nomsDe([SET, 'Unown', 11], [HG, 'Basic Darkness Energy', 400]) });
    verifier('toute adresse du plan est valable ET vient mot pour mot d\'un relevé', tout.plan.every(p => PK.urlImageValide(p.url) && cartesReleve([R, releve([carte('Darkness Energy', '121', 'hgss1', 'HGSS1_EN_121.png')])]).some(c => c.img === p.url)), true);
    const huit = PK.apparier({ trous: [trou(1, 11, 'Unown', SET, 'B', 'x')], cartes: [{ ...carte('Unown B', 'B', 'ex10', 'EX10_EN_Unown_B.png'), img: 'http://assets.pokemon.com/static-assets/content-assets/cms2/img/cards/web/EX10/EX10_EN_Unown_B.png' }], noms: nomsDe([SET, 'Unown', 11]) });
    verifier('une adresse de relevé hors des règles (http) n\'entre jamais dans le plan : « adresse-hors-regle »', [huit.plan.length, motifs(huit)], [0, [[1, 'adresse-hors-regle']]]);

    console.log(`\n${ok} passés, ${ko} en échec`);
    process.exit(ko ? 1 : 0);
})().catch(e => { console.error('❌', e.stack || e.message); process.exit(1); });
