// Banc PUR (aucune base, aucun réseau) de la promotion des 41 « À REGARDER » regardés à l'œil par le coordinateur le 2026-10-11.
//   node test-logos-regardes.js
const M = require('./collecter-logos-officiels');
const table = require('./collecte-cartes/logos-officiels-table.json');
let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => { const a = JSON.stringify(obtenu), b = JSON.stringify(attendu); if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); } };

const reg = table.lignes.filter(l => l.verdict === 'À REGARDER');
const ligne = code => reg.find(l => l.fichier.endsWith(`/${code}.png`));
// la base de lecture : tous les sets de la table en jp / intl ; nomJa posé seulement là où la base le porte (M4 et SV10, mesuré le 2026-10-11)
const sets = new Map();
for (const l of table.lignes) if (l.set) sets.set(l.set, { _id: l.set, tirage: l.cible === 'fr' ? 'intl' : 'jp', nomJa: null });
sets.get('Ninja-Spinner').nomJa = 'ニンジャスピナー';
sets.get('The-Glory-of-Team-Rocket').nomJa = 'ロケット団の栄光';
sets.set('Ultra-Force', { _id: 'Ultra-Force', tirage: 'jp', nomJa: null, code: 'sm5+' });   // aucune ligne de la table ne le nomme (SM5P n'a pas de set) : il existe en base, nomJa null
const plan = l => { const p = M.promouvoir(l, sets); return p.ligne ? M.planifier(p.ligne, sets) : { action: 'ecartee', raison: p.raison }; };

(async () => {
    verifier('la liste fermée existe : 41 entrées, toutes À REGARDER dans la table', [Array.isArray(M.REGARDES_2026_10_11), M.REGARDES_2026_10_11?.length, M.REGARDES_2026_10_11?.every(e => reg.some(l => l.part === e.part && l.fichier === e.fichier))], [true, 41, true]);
    verifier('chaque entrée porte planche, raison et le sha256 du candidat regardé', M.REGARDES_2026_10_11.every(e => [1, 2, 3].includes(e.planche) && e.raison && /^[0-9a-f]{64}$/.test(e.candidatSha256)), true);

    // 1. une ligne promue passe le verdict
    const a = M.promouvoir(ligne('ADV3'), sets);
    verifier('ADV3 : promue OFFICIEL', [a.ligne?.verdict, a.ligne?.regardePar], ['OFFICIEL', 'coordinateur 2026-10-11, planche 1']);
    verifier('ADV3 : planifier → collecter', plan(ligne('ADV3')).action, 'collecter');
    verifier('HeartGold (FR, TCGdex) : collecter', plan(reg[0]).action, 'collecter');

    // 2. une ligne non listée reste refusée
    const inconnue = { ...ligne('ADV3'), fichier: 'Logo JP/ZZZ9.png' };
    verifier('ligne À REGARDER non listée : jamais promue', M.promouvoir(inconnue, sets).ligne, undefined);
    verifier('ligne non listée : planifier refuse', M.planifier(inconnue, sets).action, 'refus');
    // la promotion ne s'applique qu'aux « À REGARDER » : une ligne d'un autre verdict n'est pas promue
    verifier('un REFUSÉ homonyme n\'est pas promu', M.promouvoir({ ...ligne('ADV3'), verdict: 'AUTRE' }, sets).ligne, undefined);
    // le candidat n'est plus celui qu'on a regardé → pas de promotion
    verifier('candidat différent de celui regardé (sha256) : pas promue', M.promouvoir({ ...ligne('ADV3'), cache: { ...ligne('ADV3').cache, sha256: 'f'.repeat(64) } }, sets).ligne, undefined);
    // le set de la ligne a changé → pas promue
    verifier('set différent de celui regardé : pas promue', M.promouvoir({ ...ligne('ADV3'), set: 'Autre-Set' }, sets).ligne, undefined);

    // 3. LES TROIS HÉSITATIONS (décision du 2026-10-12) et SM5P sont PROMUES, chacune sous les mêmes gardes que les autres
    verifier('plus aucune ligne exclue : EXCLUS_2026_10_11 est vide', M.EXCLUS_2026_10_11, []);
    const o = M.promouvoir(ligne('OR4'), sets);
    verifier('OR4 (Rocket-Gang) : promue, raison de l\'arbitrage du coordinateur écrite telle quelle', [o.ligne?.verdict, /seule la couleur du rendu diffère \(contour \/ teinte\) — tranché par le coordinateur sur délégation du testeur, 2026-10-12$/.test(o.ligne?.raisonRegarde ?? ''), /2026-10-12/.test(o.ligne?.regardePar ?? '')], ['OFFICIEL', true, true]);
    verifier('OR4 : set sûr (la base porte déjà ce fichier), Bill\'s ja → collecter', plan(ligne('OR4')).action, 'collecter');
    verifier('OR4 : sha256 du candidat changé → pas promue', M.promouvoir({ ...ligne('OR4'), cache: { ...ligne('OR4').cache, sha256: 'f'.repeat(64) } }, sets).ligne, undefined);
    verifier('OR4 : set changé → pas promue', M.promouvoir({ ...ligne('OR4'), set: 'Autre-Set' }, sets).ligne, undefined);
    verifier('SM11B : sha256 changé → pas promue', M.promouvoir({ ...ligne('SM11B'), cache: { ...ligne('SM11B').cache, sha256: 'f'.repeat(64) } }, sets).ligne, undefined);
    verifier('SV11W : set changé → pas promue', M.promouvoir({ ...ligne('SV11W'), set: 'Autre-Set' }, sets).ligne, undefined);
    // SM11B et SV11W sont des sets « ? » : promus, mais écrits seulement si leur nomJa est confirmé EN BASE (aucune garde contournée)
    verifier('SM11B (nomJa null en base) : écartée, la raison dit nomJa', [plan(ligne('SM11B')).action, /nomJa/.test(plan(ligne('SM11B')).raison)], ['ecartee', true]);
    verifier('SV11W (nomJa null en base) : écartée', plan(ligne('SV11W')).action, 'ecartee');
    verifier('SM5P (fichier sans set, Ultra-Force sans nomJa) : écartée, la raison dit nomJa', [plan(ligne('SM5P')).action, /nomJa/.test(plan(ligne('SM5P')).raison)], ['ecartee', true]);
    // la base APRÈS poser-nomja-sets.js (6 sets) et telle qu'elle est pour White-Flare-JP (4 sets au même nomJa combiné)
    const apres = new Map(sets);
    const NOMJA = { 'Dark-Phantasma': 'ダークファンタズマ', 'Incandescent-Arcana': '白熱のアルカナ', 'VMAX-Rising': 'VMAXライジング', 'Champion-Road': 'チャンピオンロード', 'Dream-League': 'ドリームリーグ' };
    for (const [id, nj] of Object.entries(NOMJA)) apres.set(id, { ...sets.get(id), nomJa: nj });
    apres.set('Ultra-Force', { _id: 'Ultra-Force', tirage: 'jp', nomJa: 'ウルトラフォース', code: 'sm5+' });
    const combine = 'ブラックボルト•ホワイトフレア';
    for (const id of ['White-Flare-JP', 'Black-Bolt-JP', 'White-Flare-JP-Additionals', 'Black-Bolt-JP-Additionals']) apres.set(id, { _id: id, tirage: 'jp', nomJa: combine });
    apres.set('White-Flare-JP', { _id: 'White-Flare-JP', tirage: 'jp', nomJa: combine, code: 'sv11W' });   // la base réelle : code « sv11W »
    // le cache TCGdex ja tel qu'en base (ja/__liste__, lu le 2026-10-12) : SV11W « ホワイトフレア », SV11B « ブラックボルト »
    const LISTE_JA = [{ id: 'SV11B', name: 'ブラックボルト' }, { id: 'SV11W', name: 'ホワイトフレア' }, { id: 'SM11b', name: 'ドリームリーグ' }];
    const planB = (l, s, opts) => { const p = M.promouvoir(l, s, opts); return p.ligne ? M.planifier(p.ligne, s) : { action: 'ecartee', raison: p.raison }; };
    const planA = l => planB(l, apres, { tcgdexJa: LISTE_JA });
    const sv = ligne('SV11W');
    verifier('SV11W + cache TCGdex ja réel (code sv11W = SV11W, « ホワイトフレア » = texte du logo) : collecter', [planA(sv).action, M.promouvoir(sv, apres, { tcgdexJa: LISTE_JA }).ligne?.confirmationSet?.voie], ['collecter', 'tcgdex-ja']);
    verifier('SV11W SANS cache TCGdex : écartée, la raison le dit', [planB(sv, apres).action, /cache TCGdex/.test(planB(sv, apres).raison)], ['ecartee', true]);
    verifier('SV11W : cache TCGdex vide → écartée', planB(sv, apres, { tcgdexJa: [] }).action, 'ecartee');
    verifier('SV11W : TCGdex SV11W porte un autre nom → écartée', planB(sv, apres, { tcgdexJa: LISTE_JA.map(x => x.id === 'SV11W' ? { ...x, name: 'ブラックボルト' } : x) }).action, 'ecartee');
    verifier('SV11W : aucun set TCGdex SV11W (le code désigne autre chose) → écartée', planB(sv, apres, { tcgdexJa: LISTE_JA.filter(x => x.id !== 'SV11W') }).action, 'ecartee');
    verifier('SV11W : deux sets TCGdex au code sv11W → écartée', planB(sv, apres, { tcgdexJa: [...LISTE_JA, { id: 'sv11w', name: 'ホワイトフレア' }] }).action, 'ecartee');
    const autreCode = new Map(apres); autreCode.set('White-Flare-JP', { _id: 'White-Flare-JP', tirage: 'jp', nomJa: combine, code: 'sv11B' });
    verifier('SV11W : notre set porte le code sv11B (le code TCGdex désigne un autre set) → écartée', planB(sv, autreCode, { tcgdexJa: LISTE_JA }).action, 'ecartee');
    const sansCodeW = new Map(apres); sansCodeW.set('White-Flare-JP', { _id: 'White-Flare-JP', tirage: 'jp', nomJa: combine });
    verifier('SV11W : notre set n\'a pas de code → écartée', planB(sv, sansCodeW, { tcgdexJa: LISTE_JA }).action, 'ecartee');
    const intlW = new Map(apres); intlW.set('White-Flare-JP', { _id: 'White-Flare-JP', tirage: 'intl', nomJa: combine, code: 'sv11W' });
    verifier('SV11W : set de tirage intl → écartée', planB(sv, intlW, { tcgdexJa: LISTE_JA }).action, 'ecartee');
    verifier('la seconde voie ne s\'applique à aucune autre ligne : S10A (nomJa null) avec cache → écartée', planB(ligne('S10A'), sets, { tcgdexJa: [{ id: 'S10a', name: 'ダークファンタズマ' }] }).action, 'ecartee');
    verifier('… ni SM11B', planB(ligne('SM11B'), sets, { tcgdexJa: LISTE_JA }).action, 'ecartee');
    verifier('seule SV11W porte confirmeTcgdexJa', M.REGARDES_2026_10_11.filter(e => e.confirmeTcgdexJa).map(e => e.fichier), ['Logo JP/SV11W.png']);
    for (const c of ['S10A', 'S11A', 'S1A', 'SM11B']) verifier(`${c} : nomJa posé en base → collecter`, planA(ligne(c)).action, 'collecter');
    verifier('SM6B : nomJa posé → promue, mais Bulbapedia reportée', planA(ligne('SM6B')).action, 'reportee');
    verifier('SM5P : set ÉTABLI par le code ET le nomJa → promue sous Ultra-Force, Bulbapedia reportée', [M.promouvoir(ligne('SM5P'), apres).ligne?.set, planA(ligne('SM5P')).action], ['Ultra-Force', 'reportee']);
    verifier('SV11W : le nomJa de la base (4 sets) ne confirme rien ; seule la voie TCGdex ja la promeut (collecter)', planA(ligne('SV11W')).action, 'collecter');
    const deuxUltra = new Map(apres); deuxUltra.set('Ultra-Force-bis', { _id: 'Ultra-Force-bis', tirage: 'jp', nomJa: 'ウルトラフォース', code: 'sm5p' });
    verifier('SM5P : deux sets portent le nomJa → pas établi', M.promouvoir(ligne('SM5P'), deuxUltra).ligne, undefined);
    const mauvaisCode = new Map(apres); mauvaisCode.set('Ultra-Force', { _id: 'Ultra-Force', tirage: 'jp', nomJa: 'ウルトラフォース', code: 'sm6' });
    verifier('SM5P : le fichier du candidat ne porte pas le code du set → pas établi', M.promouvoir(ligne('SM5P'), mauvaisCode).ligne, undefined);
    const sansCode = new Map(apres); sansCode.set('Ultra-Force', { _id: 'Ultra-Force', tirage: 'jp', nomJa: 'ウルトラフォース' });
    verifier('SM5P : le set n\'a pas de code → pas établi', M.promouvoir(ligne('SM5P'), sansCode).ligne, undefined);
    const intlUltra = new Map(apres); intlUltra.set('Ultra-Force', { _id: 'Ultra-Force', tirage: 'intl', nomJa: 'ウルトラフォース', code: 'sm5+' });
    verifier('SM5P : set de tirage intl → pas établi', M.promouvoir(ligne('SM5P'), intlUltra).ligne, undefined);
    verifier('SM5P : sha256 changé → pas promue', M.promouvoir({ ...ligne('SM5P'), cache: { ...ligne('SM5P').cache, sha256: 'f'.repeat(64) } }, apres).ligne, undefined);
    verifier('SM5P : une ligne qui a maintenant un autre set n\'est pas promue', M.promouvoir({ ...ligne('SM5P'), set: 'Ultra-Moon', setSur: false }, apres).ligne, undefined);

    // 4. un set « ? » sans nomJa confirmé reste écarté ; avec nomJa ÉGAL (un seul set), il passe
    verifier('S10A (nomJa null en base) : écartée', plan(ligne('S10A')).action, 'ecartee');
    verifier('S10A : la raison dit nomJa', /nomJa/.test(plan(ligne('S10A')).raison), true);
    for (const c of ['S11A', 'S1A']) verifier(`${c} (nomJa null) : écartée`, plan(ligne(c)).action, 'ecartee');
    verifier('M4 (nomJa égal au texte du logo, un seul set) : collecter', plan(ligne('M4')).action, 'collecter');
    const deux = new Map(sets); deux.set('Ninja-Spinner-bis', { _id: 'Ninja-Spinner-bis', tirage: 'jp', nomJa: 'ニンジャスピナー' });
    verifier('M4 : deux sets portent le même nomJa → écartée', M.promouvoir(ligne('M4'), deux).ligne, undefined);
    const faux = new Map(sets); faux.set('Ninja-Spinner', { _id: 'Ninja-Spinner', tirage: 'jp', nomJa: 'ニンジャスピナー2' });
    verifier('M4 : nomJa différent (pas égal) → écartée', M.promouvoir(ligne('M4'), faux).ligne, undefined);
    const intl = new Map(sets); intl.set('Ninja-Spinner', { _id: 'Ninja-Spinner', tirage: 'intl', nomJa: 'ニンジャスピナー' });
    verifier('M4 : set de tirage intl → écartée (le tirage du set reste gardé)', plan2(ligne('M4'), intl), 'ecartee');
    function plan2(l, s) { const p = M.promouvoir(l, s); return p.ligne ? M.planifier(p.ligne, s).action : 'ecartee'; }

    // 5. Bulbapedia : promues mais REPORTÉES (jamais collectées maintenant)
    for (const c of ['NEO4', 'SM8', 'SV6A', 'SV10']) verifier(`${c} (Bulbapedia) : reportée`, plan(ligne(c)).action, 'reportee');
    verifier('SM6B (Bulbapedia, nomJa null) : écartée ou reportée, jamais collectée', ['ecartee', 'reportee'].includes(plan(ligne('SM6B')).action), true);

    // 6. la promotion ne lève AUCUNE autre garde
    verifier('URL non écrite sur la ligne : refus', plan2b({ ...ligne('ADV3'), urlChoisie: 'https://billsarchive.com/autre.webp' }), 'refus');
    verifier('hôte hors liste : refus', plan2b({ ...ligne('ADV3'), urls: ['https://exemple.org/x.webp'], urlChoisie: 'https://exemple.org/x.webp' }), 'refus');
    verifier('langue non prouvée par l\'adresse : écartée', plan2b({ ...ligne('ADV3'), urls: ['https://billsarchive.com/assets/logos/japanese/sans-prefixe.webp'], urlChoisie: 'https://billsarchive.com/assets/logos/japanese/sans-prefixe.webp' }), 'ecartee');
    verifier('set de tirage intl pour un logo ja : écartée', M.planifier(M.promouvoir(ligne('ADV3'), sets).ligne, new Map([...sets, ['Rulers-of-the-Heavens', { _id: 'Rulers-of-the-Heavens', tirage: 'intl' }]])).action, 'ecartee');
    function plan2b(l) { const p = M.promouvoir(l, sets); return p.ligne ? M.planifier(p.ligne, sets).action : 'non-promue'; }
    verifier('(note) une URL modifiée garde le candidat regardé : la ligne promue la refuse', plan2b({ ...ligne('ADV3'), urlChoisie: 'https://billsarchive.com/autre.webp' }) !== 'collecter', true);
    // le juge de fichier est inchangé : un fichier différent sans Pokécardex lisible ne passe pas
    const sharp = require('sharp');
    const buf = await sharp({ create: { width: 300, height: 80, channels: 4, background: '#fff' } }).png().toBuffer();
    const pj = M.promouvoir(ligne('ADV3'), sets).ligne;
    const j = await M.juger(pj, buf, { pokecardexBuf: null });
    verifier('juger : fichier différent du comparé, sans re-mesure possible : refus', j.ok, false);

    // 7. la table entière : combien se collectent, combien se reportent
    const tous = table.lignes.filter(l => l.verdict === 'À REGARDER').map(l => plan(l));
    const compte = {}; tous.forEach(p => compte[p.action] = (compte[p.action] || 0) + 1);
    verifier('les 41 À REGARDER, base actuelle (4 sets sans nomJa) : 30 collecter (les 29 écrits + OR4) · 4 reportée · 7 écartée', compte, { collecter: 30, reportee: 4, ecartee: 7 });
    const comptA = {}; table.lignes.filter(l => l.verdict === 'À REGARDER').map(l => planA(l)).forEach(p => comptA[p.action] = (comptA[p.action] || 0) + 1);
    verifier('les 41, nomJa des 6 sets posé + cache TCGdex ja : 35 collecter · 6 reportée · 0 écartée', comptA, { collecter: 35, reportee: 6 });

    console.log(`\n${ok} passés, ${ko} en échec`);
    process.exit(ko ? 1 : 0);
})();
