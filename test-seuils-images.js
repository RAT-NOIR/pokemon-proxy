// node test-seuils-images.js — la règle de largeur minimale PAR SOURCE (décision 4 du testeur, 2026-10-08) :
// 300 px pour les sources OFFICIELLES (liste fermée), 350 px pour toute autre, y compris inconnue ou absente.
// Deuxième moitié : aucun collecteur ne garde sa copie du nombre (§21 bis) — chacun appelle largeurMinDe(sa source).
const fs = require('fs');
const path = require('path');
const S = require('./collecte-cartes/seuils-images');

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); }
};

verifier('largeurMinDe est exportée', typeof S.largeurMinDe, 'function');
if (typeof S.largeurMinDe === 'function') {
    const f = S.largeurMinDe;
    for (const s of ['tpc-asie', 'pokemon-card-com', 'pokemon.com']) verifier(`officielle ${s} → 257 (décision du testeur, 2026-10-12)`, f(s), 257);
    for (const s of ['bulbapedia', 'artofpkm', 'tcgdex']) verifier(`${s} → 350`, f(s), 350);
    verifier('source inconnue → 350', f('quelque-part'), 350);
    verifier('undefined → 350', f(undefined), 350);
    verifier('null → 350', f(null), 350);
    verifier('chaîne vide → 350', f(''), 350);
    verifier('casse différente (« TPC-ASIE ») → 350 : liste fermée, comparaison exacte', f('TPC-ASIE'), 350);
    verifier('propriété héritée (« constructor », « __proto__ ») → 350', [f('constructor'), f('__proto__'), f('toString')], [350, 350, 350]);
}

// ── §21 bis : la liste officielle est DÉRIVÉE de la source unique des sites TPC, pas recopiée ───────────────────────────
const TPC = require('./collecte-cartes/tpc');
verifier('chaque site de SITES (tpc.js) est à 257 : une source TPC ajoutée ne peut pas rester à 350',
    TPC.SOURCES_TPC.map(s => S.largeurMinDe(s)), TPC.SOURCES_TPC.map(() => 257));
verifier('la liste officielle = SOURCES_TPC + pokemon.com (le nom ÉCRIT dans images.source), rien d\'autre', [...(S.SOURCES_OFFICIELLES || [])].sort(), [...TPC.SOURCES_TPC, 'pokemon.com'].sort());

// ── une décision de seuil se relit (§23) : aRejuger(document trop-petit, source) ───────────────────────────────────────
verifier('aRejuger est exportée', typeof S.aRejuger, 'function');
if (typeof S.aRejuger === 'function') {
    const r = S.aRejuger;
    verifier('tpc-asie, 320 px, sans seuilApplique (jugé à 350) → à rejuger', r({ wOriginal: 320 }, 'tpc-asie'), true);
    verifier('tpc-asie, 250 px, sans seuilApplique → reste trop petit (sous 257)', r({ wOriginal: 250 }, 'tpc-asie'), false);
    verifier('artofpkm, 320 px, sans seuilApplique → reste trop petit (350)', r({ w: 320 }, 'artofpkm'), false);
    verifier('tpc-asie, 320 px, jugé à 300 → rejugé : 320 ≥ 257 alors que le verdict date de 300 (le seuil a baissé)', r({ wOriginal: 320, seuilApplique: 300 }, 'tpc-asie'), true);
    // ➕ 2026-10-12 : LES 255 — des `trop-petit` TPC jugés à 300, largeur d'origine entre 257 et 299, redevenus admissibles à 257
    verifier('tpc-asie, 280 px, jugé à 300 → à rejuger (c\'est ce qui fait retélécharger les 255)', r({ wOriginal: 280, seuilApplique: 300, etat: 'trop-petit' }, 'tpc-asie'), true);
    verifier('tpc-asie, 257 px pile, jugé à 300 → à rejuger', r({ wOriginal: 257, seuilApplique: 300 }, 'tpc-asie'), true);
    verifier('tpc-asie, 256 px, jugé à 300 → reste trop petit', r({ wOriginal: 256, seuilApplique: 300 }, 'tpc-asie'), false);
    verifier('pokemon-card-com, 270 px, jugé à 300 → à rejuger', r({ wOriginal: 270, seuilApplique: 300 }, 'pokemon-card-com'), true);
    verifier('tpc-asie, 280 px, jugé à 257 → rien à relire (déjà jugé sous la règle d\'aujourd\'hui)', r({ wOriginal: 280, seuilApplique: 257 }, 'tpc-asie'), false);
    verifier('pikaqian, 280 px, jugé à 300 → PAS rejugé : PikaQian garde 300', r({ wOriginal: 280, seuilApplique: 300 }, 'pikaqian'), false);
    verifier('tpc-asie, largeur inconnue, sans seuilApplique → à rejuger (on ne sait pas conclure)', r({}, 'tpc-asie'), true);
    verifier('source inconnue, 320 px → pas de rejugement', r({ wOriginal: 320 }, 'quelque-part'), false);
}

// ── les appelants : chacun passe par largeurMinDe avec SA source, aucun ne compare à LARGEUR_MIN ──────────────────────
const lire = f => fs.readFileSync(path.join(__dirname, f), 'utf8');
const sansCommentaires = t => t.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
const APPELANTS = {
    'collecteur-images.js': "largeurMinDe('artofpkm')",
    'collecteur-images-bulba.js': "largeurMinDe('bulbapedia')",
    'collecteur-images-tcgdex.js': 'largeurMinDe(SOURCE)',
    'collecteur-images-tpc.js': 'largeurMinDe(site)',
    'collecteur-images-pikaqian.js': 'largeurMinDe(P.SOURCE)',
    'collecte-cartes/preparer-images-auto.js': "largeurMinDe('artofpkm')",
    'remettre-en-file.js': 'largeurMinDe(',
    'reste-visuels.js': 'largeurMinDe('
};
for (const [f, appel] of Object.entries(APPELANTS)) {
    const t = sansCommentaires(lire(f));
    verifier(`${f} appelle ${appel}`, t.includes(appel), true);
    verifier(`${f} ne compare plus à LARGEUR_MIN (aucune copie du nombre)`, /\bLARGEUR_MIN\b/.test(t), false);
}

// ── la médiane est indexée par `source/slug`, pas par slug seul (deux sources, un même slug) ──────────────────────────
for (const f of ['remettre-en-file.js', 'reste-visuels.js']) {
    const t = sansCommentaires(lire(f));
    verifier(`${f} indexe les médianes par source/slug`, /\.set\(`\$\{src\}\/\$\{slug\}`/.test(t) && !/medSource/.test(t), true);
}
verifier('collecteur-images-tcgdex.js : SOURCE est la constante de la source', /const SOURCE = 'tcgdex'/.test(lire('collecteur-images-tcgdex.js')), true);

// ── la garde du commit du worker : le collecteur TPC est un fichier du critère ──────────────────────────────────────
const regles = lire('remettre-en-file.js').match(/const REGLES = \[([\s\S]*?)\];/)?.[1] ?? '';
verifier('REGLES surveille seuils-images.js ET collecteur-images-tpc.js', ['seuils-images.js', 'collecteur-images-tpc.js'].map(x => regles.includes(`'${x}`) || regles.includes(`/${x}'`)), [true, true]);

// ➕ 2026-10-11 : PIKAQIAN — 300 px par décision du testeur, SANS être une source officielle : la liste officielle ne bouge pas, celle des 300 px la contient + pikaqian
verifier('pikaqian → 300, et n\'est PAS dans SOURCES_OFFICIELLES (que ce banc garde = TPC + pokemon-com)', [S.largeurMinDe('pikaqian'), S.SOURCES_OFFICIELLES.includes('pikaqian'), S.SOURCES_A_300.includes('pikaqian')], [300, false, true]);

// ➕ 2026-10-12 — « BASSE DÉFINITION » : UNE fonction dit si une largeur d'ORIGINE est sous LARGEUR_MIN (350), toutes sources confondues
verifier('estBasseDefinition est exportée', typeof S.estBasseDefinition, 'function');
if (typeof S.estBasseDefinition === 'function') {
    const b = S.estBasseDefinition;
    verifier('257, 300, 349 → basse définition', [b(257), b(300), b(349)], [true, true, true]);
    verifier('350 pile, 700 → pas de basse définition (le seuil des autres sources ne change pas)', [b(350), b(700)], [false, false]);
    verifier('largeur inconnue (null, undefined, 0, NaN, chaîne) → false : inconnu n\'est pas « bas »', [b(null), b(undefined), b(0), b(NaN), b('300')], [false, false, false, false, false]);
    verifier('largeurOriginaleDe : wOriginal d\'abord ; à défaut `w` seulement s\'il est sous le plafond servi (700, donc non réduit)',
        [S.largeurOriginaleDe({ wOriginal: 300, w: 300 }), S.largeurOriginaleDe({ w: 300 }), S.largeurOriginaleDe({ w: 700 }), S.largeurOriginaleDe({})], [300, 300, null, null]);
}
verifier('le SEUIL des autres sources ne bouge pas : LARGEUR_MIN = 350', S.LARGEUR_MIN, 350);
verifier('aucun collecteur ne compare un nombre lui-même à 350 : aucune « < 350 » dans les collecteurs (§21 bis)',
    ['collecteur-images-tpc.js', 'collecteur-images-pikaqian.js', 'collecte-cartes/basse-definition.js'].map(f => /<\s*350\b/.test(sansCommentaires(lire(f)))), [false, false, false]);
verifier('REGLES surveille le collecteur, le client/la preuve, la table (et son JSON) de pikaqian', ['collecteur-images-pikaqian.js', 'collecte-cartes/pikaqian.js', 'collecte-cartes/pikaqian-sets.js', 'collecte-cartes/pikaqian-sets.json'].map(x => (lire('remettre-en-file.js').match(/const REGLES = \[([\s\S]*?)\];/)?.[1] ?? '').includes(`'${x}'`)), [true, true, true, true]);
verifier('REGLES surveille la table des unités TPC (tpc-sets.js : refuse-table si le commit du worker ne la porte pas)', (lire('remettre-en-file.js').match(/const REGLES = \[([\s\S]*?)\];/)?.[1] ?? '').includes("'collecte-cartes/tpc-sets.js'"), true);
verifier('sources-en-service : pikaqian est PASSIVE (2026-10-13, plus en service pour le worker), bulbapedia suspendu', [require('./collecte-cartes/sources-en-service').enService('pikaqian'), require('./collecte-cartes/sources-en-service').enService('bulbapedia')], [false, false]);

// §44 — « si la règle changeait demain, quel fichier bougerait ? » : tout fichier que seuils-images.js charge (donc dont dépend
// largeurMinDe : la liste des sites TPC vient de tpc.js) doit figurer dans REGLES, sinon la garde du commit ne le voit pas.
const chargesParSeuils = [...lire('collecte-cartes/seuils-images.js').matchAll(/require\('\.\/([^']+)'\)/g)].map(m => `collecte-cartes/${m[1]}.js`);
verifier('seuils-images.js charge bien au moins tpc.js (le test ne tourne pas à vide)', chargesParSeuils.includes('collecte-cartes/tpc.js'), true);
for (const f of chargesParSeuils) verifier(`REGLES surveille ${f} (dépendance de largeurMinDe)`, regles.includes(`'${f}'`), true);

// ── la source d'une unité de file_images : le champ `source` quand il existe, sinon le préfixe de l'_id, sinon le défaut ──
verifier('sourceDeUnite est exportée', typeof S.sourceDeUnite, 'function');
if (typeof S.sourceDeUnite === 'function') {
    const s = S.sourceDeUnite;
    verifier('champ source présent → il fait foi', s({ _id: 'PBL', source: 'bulbapedia' }, 'artofpkm'), 'bulbapedia');
    verifier('tpc-asie/<slug> sans champ source → préfixe de l\'_id', s({ _id: 'tpc-asie/Sword-Shield-Indonesian-Promos' }, 'artofpkm'), 'tpc-asie');
    verifier('pokemon-card-com/<slug> → préfixe', s({ _id: 'pokemon-card-com/M-P' }, 'bulbapedia'), 'pokemon-card-com');
    verifier('tcgdex/<code> → préfixe', s({ _id: 'tcgdex/sv1' }, 'artofpkm'), 'tcgdex');
    verifier('code nu (ancienne unité artofpkm, sans champ source) → le défaut', s({ _id: 'PBL' }, 'artofpkm'), 'artofpkm');
    verifier('aucune unité → le défaut', s(null, 'bulbapedia'), 'bulbapedia');
    // un code de set peut contenir « / » (table-sets-auto.json) : le préfixe n'est accepté que s'il est une source CONNUE
    for (const code of ['SV-P/ID', 'M-P/CT', 'SM-P/CS']) verifier(`code de set « ${code} » sans source → le défaut, pas un préfixe`, s({ _id: code }, 'artofpkm'), 'artofpkm');
    verifier('préfixe inconnu → le défaut', s({ _id: 'quelque-part/x' }, 'bulbapedia'), 'bulbapedia');
}
for (const f of ['remettre-en-file.js', 'reste-visuels.js']) verifier(`${f} déduit la source de l'unité par sourceDeUnite`, sansCommentaires(lire(f)).includes('sourceDeUnite('), true);

// ➕ 2026-10-17 (BASSE-DEF) — LE PLANCHER ABSOLU DE 200 PX : « Basse définition : accordée. Les 39 images pokemon.com (245×342) et les McDonald's en 320 px sont écrites avec le champ
// basseDefinition: true. Le seuil de 257 px reste la norme. Plancher absolu : 200 px de large. En dessous, on refuse toujours. »
// Ruling : il vaut pour DEUX familles nommées (la source pokemon.com ; les lignes McDonald's 2014, 2015, 2017, 2018-2 du collecteur Pokumon), et nulle part ailleurs.
verifier('PLANCHER_BASSE_DEFINITION = 200 (exporté, nommé)', S.PLANCHER_BASSE_DEFINITION, 200);
verifier('largeurAdmiseDe est exportée', typeof S.largeurAdmiseDe, 'function');
if (typeof S.largeurAdmiseDe === 'function') {
    const a = S.largeurAdmiseDe;
    verifier('pokemon.com → 200 (au lieu de 257)', a('pokemon.com'), 200);
    for (const l of ['mcd-2014', 'mcd-2015', 'mcd-2017', 'mcd-2018-2']) verifier(`pokumon, ligne ${l} → 200`, a('pokumon', l), 200);
    verifier('pokumon, ligne McDonald\'s 2023 (hors de la liste fermée du ruling) → 350', a('pokumon', 'mcd-match-battle-2023'), 350);
    for (const l of ['tot-2022', 'prof', 'bsp-svp', 'bk-2008', 'w-promos', 'inconnue', '', null, undefined]) verifier(`pokumon, ligne ${l === '' ? '(vide)' : l} → 350 (aucune autre famille Pokumon ne change)`, a('pokumon', l), 350);
    verifier('pokumon sans ligne (les Prize Packs) → 350', a('pokumon'), 350);
    verifier('une ligne McDonald\'s sous une AUTRE source → la règle de cette source (350 / 257 / 300)', [a('artofpkm', 'mcd-2014'), a('tpc-asie', 'mcd-2014'), a('pikaqian', 'mcd-2014')], [350, 257, 300]);
    for (const s of ['tpc-asie', 'pokemon-card-com']) verifier(`les AUTRES officielles gardent 257 (${s})`, a(s), 257);
    verifier('bulbapedia, artofpkm, tcgdex, source inconnue, absente → 350', [a('bulbapedia'), a('artofpkm'), a('tcgdex'), a('quelque-part'), a(undefined), a(null)], [350, 350, 350, 350, 350, 350]);
    verifier('casse différente (« POKEMON.COM », « Pokumon ») et propriétés héritées → 350 : liste fermée, comparaison exacte', [a('POKEMON.COM'), a('Pokumon', 'mcd-2014'), a('constructor'), a('__proto__', 'mcd-2014')], [350, 350, 350, 350]);
    verifier('largeurMinDe n\'a pas bougé pour pokemon.com et pokumon (257 / 350) : le plancher est une AUTRE fonction', [S.largeurMinDe('pokemon.com'), S.largeurMinDe('pokumon')], [257, 350]);
}
// la liste fermée se dérive du réel : les identifiants cités existent dans la table Pokumon, famille McDonald's, et la source porte ce nom
{ const PK = require('./collecte-cartes/pokumon');
  const mcd = (S.LIGNES_POKUMON_A_PLANCHER || []);
  verifier('LIGNES_POKUMON_A_PLANCHER = les quatre lignes du ruling, toutes famille « mcd » de LIGNES_AUTRES', [[...mcd].sort(), mcd.map(id => PK.LIGNES_AUTRES.find(l => l.id === id)?.famille)], [['mcd-2014', 'mcd-2015', 'mcd-2017', 'mcd-2018-2'], ['mcd', 'mcd', 'mcd', 'mcd']]);
  verifier('SOURCES_A_PLANCHER = [pokemon.com, ctr, prv] ; le nom « pokumon » écrit ici est celui que le collecteur ÉCRIT (SOURCE) ; « prv » est le code du fournisseur des preuves validées (collecte-cartes/preuves.js)', [[...(S.SOURCES_A_PLANCHER || [])], S.SOURCE_POKUMON, PK.SOURCE, require('./collecte-cartes/preuves').SOURCE], [['pokemon.com', 'ctr', 'prv'], 'pokumon', 'pokumon', 'prv']); }
// ➕ 2026-10-18 (CTR-BASSE) — CardTrader : « Les 589 images CardTrader en 255 px : OUI, en basseDefinition: true (au-dessus du plancher de 200 px). » La source est celle que le collecteur ÉCRIT (SOURCE).
{ const CTR = require('./collecte-cartes/cardtrader'), a = S.largeurAdmiseDe;
  verifier('le nom de la source CardTrader écrit dans la liste fermée est celui que le collecteur ÉCRIT (SOURCE)', [CTR.SOURCE, (S.SOURCES_A_PLANCHER || []).includes(CTR.SOURCE)], ['ctr', true]);
  verifier('ctr → 200 (plancher) ; son seuil reste 350 (largeurMinDe)', [a('ctr'), a('ctr', 'mcd-2014'), S.largeurMinDe('ctr')], [200, 200, 350]);
  verifier('les autres sources ne bougent pas : pokemon.com 200, pdt (set hors liste) 350, pdt (set McDonald\'s) 200, pokumon 350, inconnue 350, casse/prototype 350',
      [a('pokemon.com'), a('pdt', 'Trick-or-Trade-2023'), a('pdt', 'McDonalds-Collection-2014'), a('pokumon'), a('quelque-part'), a('CTR'), a('Ctr'), a('constructor')], [200, 350, 200, 350, 350, 350, 350, 350]);
  verifier('collecte-cartes/cardtrader.js passe par largeurAdmiseDe et ne compare à aucun 200 écrit en dur', [sansCommentaires(lire('collecte-cartes/cardtrader.js')).includes('largeurAdmiseDe('), /[<>]=?\s*200\b/.test(sansCommentaires(lire('collecte-cartes/cardtrader.js')))], [true, false]); }
// une décision de seuil se relit (§23) : un `trop-petit` pokemon.com jugé à 257 entre 200 et 256 px est à rejuger ; sous 200 il reste refusé ; l'ancienne règle de pokumon (non McD) ne bouge pas
if (typeof S.aRejuger === 'function') {
    const r = S.aRejuger;
    verifier('pokemon.com, 245 px, jugé à 257 → à rejuger (le plancher a baissé)', r({ wOriginal: 245, seuilApplique: 257, etat: 'trop-petit' }, 'pokemon.com'), true);
    verifier('pokemon.com, 199 px, jugé à 257 → reste refusé', r({ wOriginal: 199, seuilApplique: 257, etat: 'trop-petit' }, 'pokemon.com'), false);
    verifier('pokemon.com, 200 px pile, jugé à 257 → à rejuger', r({ wOriginal: 200, seuilApplique: 257 }, 'pokemon.com'), true);
    verifier('pokemon.com, 245 px, jugé à 200 → rien à relire', r({ wOriginal: 245, seuilApplique: 200 }, 'pokemon.com'), false);
    verifier('pokumon McDonald\'s 2014, 320 px, jugé à 350 (sans seuilApplique) → à rejuger', r({ wOriginal: 320, etat: 'trop-petit' }, 'pokumon', 'mcd-2014'), true);
    verifier('pokumon McDonald\'s 2014, 199 px → reste refusé', r({ wOriginal: 199, etat: 'trop-petit' }, 'pokumon', 'mcd-2014'), false);
    verifier('pokumon, ligne non McDonald\'s, 320 px → PAS rejugé', r({ wOriginal: 320, etat: 'trop-petit' }, 'pokumon', 'tot-2022'), false);
    verifier('pokumon sans ligne, 320 px → PAS rejugé', r({ wOriginal: 320, etat: 'trop-petit' }, 'pokumon'), false);
}
// les appelants : AUCUN collecteur ne compare une largeur à 200 lui-même (§21 bis) ; pokemon.com et pokumon passent par la fonction
for (const [f, appel] of Object.entries({ 'collecteur-images-pokemoncom.js': 'largeurAdmiseDe(', 'collecteur-images-pokumon.js': 'largeurAdmiseDe(', 'collecte-cartes/pokumon.js': 'largeurAdmiseDe(' })) {
    const t = sansCommentaires(lire(f));
    verifier(`${f} appelle ${appel}`, t.includes(appel), true);
    verifier(`${f} ne compare à aucun nombre 200 écrit en dur`, /[<>]=?\s*200\b/.test(t), false);
}

console.log(`\n${ok} passés, ${ko} en échec (sur ${ok + ko})`);
process.exit(ko ? 1 : 0);
