// Banc de collecte-cartes/tcgcsv-jointure.js (source « tcs », catalogue complet) — lecture des produits des deux côtés, jointure par numéro + nom + marqueurs, table groupe -> expansion MESURÉE, témoin de la fiche,
// calibration, plan. Fonctions pures : aucune requête, aucune base.
'use strict';
const assert = require('assert');
const JT = require('./collecte-cartes/tcgcsv-jointure');

let ok = 0, ko = 0;
const test = async (nom, f) => { try { await f(); ok++; } catch (e) { ko++; console.log(`ECHEC ${nom}\n   ${(e.stack || e.message).split('\n').slice(0, 5).join('\n   ')}`); } };
const T = (productId, name, number, o = {}) => ({ productId, name, number, groupId: o.groupId ?? 1, imageUrl: `https://tcgplayer-cdn.tcgplayer.com/product/${productId}_200w.jpg`, rarity: o.rarity ?? 'Rare' });
const C = (idProduct, name, numero, o = {}) => ({ idProduct, name, numero, slug: o.slug ?? null, slugSet: o.slugSet ?? 'X', codeSet: o.codeSet ?? 'XX', idExpansion: o.idExpansion ?? 10 });

(async () => {
    // ───────── la lecture d'un produit du marché ─────────
    await test('lireTcg : « nom - n/t » -> nom, numéro fort et faible, total ; zéros de tête sans effet', () => {
        const t = JT.lireTcg(T(1, 'Kricketune V - 006/163', '006/163'));
        assert.deepStrictEqual([t.nomBase, t.fort, t.faible, t.total, t.marqueurs, t.desamb], ['Kricketune V', '6', '6', 163, [], null]);
        const u = JT.lireTcg(T(2, 'Beedrill', '5/146'));
        assert.deepStrictEqual([u.nomBase, u.fort, u.total], ['Beedrill', '5', 146]);
        const v = JT.lireTcg(T(3, 'Chespin - XY01', 'XY01'));
        assert.deepStrictEqual([v.nomBase, v.fort, v.faible, v.total], ['Chespin', 'XY1', '1', null]);
    });
    await test('lireTcg : parenthèses non numériques et crochets = MARQUEURS ; « (85) » = désambiguïsation, « (142 Full Art) » = désambiguïsation + marqueur ; un numéro absent = aucune clé', () => {
        const a = JT.lireTcg(T(1, 'Dragalge - XY10 (Prerelease) [Staff]', 'XY10'));
        assert.deepStrictEqual([a.nomBase, a.marqueurs, a.fort], ['Dragalge', ['prerelease', 'staff'], 'XY10']);
        const b = JT.lireTcg(T(2, 'Aegislash (85)', '85/146')); assert.deepStrictEqual([b.nomBase, b.desamb, b.marqueurs], ['Aegislash', 85, []]);
        const c = JT.lireTcg(T(3, 'Blastoise EX (142 Full Art)', '142/146')); assert.deepStrictEqual([c.nomBase, c.desamb, c.marqueurs], ['Blastoise EX', 142, ['full art']]);
        assert.deepStrictEqual(JT.lireTcg(T(4, 'Ho-Oh ex (Non-Holo)', '017/017')).marqueurs, ['non-holo']);
        const d = JT.lireTcg(T(5, 'Booster Box', null)); assert.deepStrictEqual([d.fort, d.faible, d.total], [null, null, null]);
    });
    await test('cleNom : les accents tombent des DEUX côtés, puis la normalisation de production (Pokémon = Pokemon, Mr. Mime = Mr-Mime, apostrophes)', () => {
        assert.deepStrictEqual(JT.cleNom('Pokémon Breeder'), JT.cleNom('Pokemon Breeder'));
        assert.deepStrictEqual(JT.cleNom("Farfetch’d"), JT.cleNom("Farfetch'd")); assert.deepStrictEqual(JT.cleNom('Mr. Mime'), JT.cleNom('Mr-Mime'));
        assert.notDeepStrictEqual(JT.cleNom('Pikachu'), JT.cleNom('Pikachu V'));
    });
    await test('lireCm : nom de catalogue sans les attaques (crochets), numéro de la base, ou à défaut celui du slug (marqué « slug »)', () => {
        const a = JT.lireCm(C(1, 'Pikachu [Quick Attack | Electro Ball | MFB]', '006', { slug: 'Pikachu-V1-MFB' }));
        assert.deepStrictEqual([a.nomBase, a.fort, a.numeroSource, a.marqueurs], ['Pikachu', '6', 'numero', []]);
        const b = JT.lireCm(C(2, 'Pikachu [Random Spark]', null, { slug: 'Pikachu-SV-P153', codeSet: 'PKMTCH' })); assert.deepStrictEqual([b.fort, b.numeroSource], ['P153', 'slug']);
        const c = JT.lireCm(C(3, 'Nidoran [M] [Horn Hazard]', '029')); assert.ok(c.nomCles.includes(JT.cleNom('Nidoran♂')));
        const d = JT.lireCm(C(4, 'Charizard', '150a')); assert.deepStrictEqual([d.fort, d.faible], ['150A', '150A']);
        const e = JT.lireCm(C(5, 'Pikachu (Staff)', '1')); assert.deepStrictEqual(e.marqueurs, ['staff']);
        const f = JT.lireCm(C(6, 'Machin', null, { slug: 'Machin' })); assert.deepStrictEqual([f.fort, f.numeroSource], [null, null]);
    });

    // ───────── la jointure ─────────
    const joindre = (tcg, cm, o) => JT.joindre({ tcg: tcg.map(JT.lireTcg), cm: cm.map(JT.lireCm), ...o });
    await test('joindre : numéro + nom identiques et UN seul produit de chaque côté = joint', () => {
        const r = joindre([T(10, 'Pikachu - 025/185', '025/185'), T(11, 'Raichu - 026/185', '026/185')], [C(1, 'Pikachu [Thunder Shock]', '025'), C(2, 'Raichu [x]', '026')]);
        assert.deepStrictEqual(r.joints.map(j => [j.idProduct, j.productId, j.niveau]), [[1, 10, 'fort'], [2, 11, 'fort']]); assert.deepStrictEqual(r.non, []);
    });
    await test('joindre : le numéro seul ne suffit pas (un autre nom au même numéro = absent), le nom seul non plus (un autre numéro)', () => {
        const r = joindre([T(10, 'Pikachu - 025/185', '025/185')], [C(1, 'Raichu', '025'), C(2, 'Pikachu', '099')]);
        assert.deepStrictEqual(r.joints, []); assert.deepStrictEqual(r.non.map(x => x.motif), ['absent-de-la-source', 'absent-de-la-source']);
    });
    await test('joindre : un préfixe de numéro d\'un seul côté se rattrape par la clé FAIBLE (XY150a / 150a), et le niveau est dit', () => {
        const r = joindre([T(10, 'Yveltal EX - XY150a', 'XY150a')], [C(1, 'Yveltal EX [Evil Ball]', '150a')]);
        assert.deepStrictEqual(r.joints.map(j => j.niveau), ['faible']);
    });
    await test('joindre : MARQUEUR — (Staff) / (Prerelease) / (Jumbo)… d\'un seul côté = pas de jointure ; le même des deux côtés = joint ; deux marqueurs différents = pas de jointure', () => {
        const tcg = [T(10, 'Pikachu (Staff)', '025/185')];
        const seul = joindre(tcg, [C(1, 'Pikachu', '025')]); assert.deepStrictEqual(seul.joints, []); assert.strictEqual(seul.non[0].motif, 'marqueur-tcg-seul');
        const cmSeul = joindre([T(11, 'Pikachu', '025/185')], [C(2, 'Pikachu (Staff)', '025')]); assert.deepStrictEqual(cmSeul.joints, []); assert.strictEqual(cmSeul.non[0].motif, 'marqueur-cm-seul');
        const meme = joindre(tcg, [C(3, 'Pikachu (Staff)', '025')]); assert.deepStrictEqual(meme.joints.map(j => [j.idProduct, j.productId]), [[3, 10]]);
        const diff = joindre(tcg, [C(4, 'Pikachu (Prerelease)', '025')]); assert.deepStrictEqual(diff.joints, []); assert.strictEqual(diff.non[0].motif, 'marqueurs-differents');
        // le produit sans marqueur ET le produit à marqueur au même numéro : chacun va à son semblable
        const deux = joindre([T(10, 'Pikachu (Staff)', '025/185'), T(11, 'Pikachu', '025/185')], [C(3, 'Pikachu (Staff)', '025'), C(5, 'Pikachu', '025')]);
        assert.deepStrictEqual(deux.joints.map(j => [j.idProduct, j.productId]).sort(), [[3, 10], [5, 11]]);
    });
    await test('joindre : deux produits Cardmarket (V1/V2) pour UN produit du marché = ambigus, AUCUN joint ; un produit Cardmarket pour deux produits du marché = ambigu', () => {
        const r = joindre([T(10, 'Pikachu - 025/185', '025/185')], [C(1, 'Pikachu', '025', { slug: 'Pikachu-V1-X25' }), C(2, 'Pikachu', '025', { slug: 'Pikachu-V2-X25' })]);
        assert.deepStrictEqual(r.joints, []); assert.deepStrictEqual(r.non.map(x => x.motif), ['ambigu-cm', 'ambigu-cm']);
        const s = joindre([T(10, 'Pikachu - 025/185', '025/185'), T(11, 'Pikachu - 025/185 ', '025/185')], [C(1, 'Pikachu', '025')]);
        assert.deepStrictEqual(s.joints, []); assert.strictEqual(s.non[0].motif, 'ambigu-tcg');
    });
    await test('joindre : un produit Cardmarket sans numéro (ni base ni slug) ne se joint jamais ; le numéro du slug ne sert que si on l\'accepte', () => {
        const cm = [C(1, 'Pikachu [Random Spark]', null, { slug: 'Pikachu-SV-P153' })], tcg = [T(10, 'Pikachu - SVP153', 'SVP153')];
        assert.strictEqual(joindre(tcg, [C(2, 'Pikachu', null, { slug: 'Pikachu' })]).non[0].motif, 'sans-numero');
        assert.deepStrictEqual(joindre(tcg, cm).joints, [], 'par défaut le numéro du slug n\'est pas admis');
        assert.strictEqual(joindre(tcg, cm).non[0].motif, 'numero-du-slug-non-admis');
        assert.strictEqual(joindre(tcg, cm, { accepterSlug: true }).joints.length, 1);
    });
    await test('joindre : une désambiguïsation « (85) » qui contredit le numéro n\'est pas jointe ; sans contradiction elle ne gêne pas', () => {
        const ok2 = joindre([T(10, 'Aegislash (85)', '85/146')], [C(1, 'Aegislash [x]', '85')]); assert.strictEqual(ok2.joints.length, 1);
        const mauvais = joindre([T(11, 'Aegislash (86)', '85/146')], [C(2, 'Aegislash [x]', '85')]); assert.deepStrictEqual(mauvais.joints, []); assert.strictEqual(mauvais.non[0].motif, 'desambiguisation-contredit');
    });

    // ───────── la table groupe -> expansion, MESURÉE ─────────
    const mk = (n, f) => Array.from({ length: n }, (_, i) => f(i + 1));
    const nom = i => `Carte${String.fromCharCode(64 + (i % 26) + 1)}${i}`;
    const tcgG = (groupId, n, categoryId = 3, pre = '') => ({ groupId, name: `G${groupId}`, categoryId, produits: mk(n, i => T(groupId * 1000 + i, `${pre}${nom(i)} - ${i}/${n}`, `${i}/${n}`, { groupId })) });
    const cmE = (idExpansion, n, tirage = 'intl', pre = '', deb = 1) => ({ idExpansion, slugSet: `E${idExpansion}`, codeSet: `C${idExpansion}`, tirage, produits: mk(n, i => JT.lireCm(C(idExpansion * 1000 + i, `${pre}${nom(i + deb - 1)}`, String(i + deb - 1), { idExpansion }))) });
    await test('table : le groupe est apparié à l\'expansion qui porte ses (numéro, nom) — recouvrement dit des deux côtés — et les groupes sans correspondance sont NOMMÉS', () => {
        const t = JT.construireTable({ groupes: [tcgG(1, 40), tcgG(2, 30, 3, 'Q'), tcgG(3, 30, 3, 'R')], expansions: [cmE(100, 40), cmE(200, 5), cmE(300, 30, 'intl', 'Z')], langueDeCategorie: { 3: 'en' } });
        const l1 = t.lignes.find(x => x.groupId === 1); assert.strictEqual(l1.statut, 'apparie'); assert.deepStrictEqual(l1.expansions.map(e => e.idExpansion), [100]); assert.strictEqual(l1.expansions[0].communs, 40); assert.strictEqual(l1.expansions[0].partGroupe, 1);
        assert.strictEqual(t.lignes.find(x => x.groupId === 2).statut, 'non-apparie'); assert.strictEqual(t.lignes.find(x => x.groupId === 3).statut, 'non-apparie');
        assert.deepStrictEqual(t.resume.nonAppariees.map(g => g.groupId).sort(), [2, 3]);
    });
    await test('table : une catégorie anglaise ne s\'apparie jamais à un tirage japonais (et inversement) — même recouvrement parfait', () => {
        const t = JT.construireTable({ groupes: [tcgG(1, 20, 3), tcgG(2, 20, 85)], expansions: [cmE(100, 20, 'jp')], langueDeCategorie: { 3: 'en', 85: 'ja' } });
        assert.strictEqual(t.lignes.find(x => x.groupId === 1).statut, 'tirage-incompatible'); assert.strictEqual(t.lignes.find(x => x.groupId === 2).statut, 'apparie');
    });
    await test('table : un groupe à cheval sur DEUX expansions (chacune ≥ 25 % du groupe, union ≥ 50 %) les prend toutes les deux ; un recouvrement sous le minimum absolu n\'apparie rien', () => {
        const g = tcgG(1, 20), moitieA = cmE(100, 10), moitieB = cmE(200, 10, 'intl', '', 11);
        const t = JT.construireTable({ groupes: [g, tcgG(2, 2)], expansions: [moitieA, moitieB, cmE(300, 2)], langueDeCategorie: { 3: 'en' } });
        assert.deepStrictEqual(t.lignes.find(x => x.groupId === 1).expansions.map(e => e.idExpansion).sort(), [100, 200]);
        assert.strictEqual(t.lignes.find(x => x.groupId === 2).statut, 'non-apparie', 'MIN_COMMUNS');
    });

    // ───────── le témoin de la fiche (indépendant de la clé) ─────────
    await test('témoin : le nom ET un numéro imprimé de la fiche concordent = juste ; un autre nom ou un autre numéro = faux ; une fiche sans numéro = non jugeable', () => {
        const fiche = { nomEn: 'Kricketune V', impressions: [{ tirage: 'intl', numero: '006', total: '163' }] };
        const t = JT.lireTcg(T(1, 'Kricketune V - 006/163', '006/163'));
        assert.strictEqual(JT.temoinFiche(t, fiche).verdict, 'juste');
        assert.strictEqual(JT.temoinFiche(JT.lireTcg(T(2, 'Kricketune - 006/163', '006/163')), fiche).verdict, 'faux'); assert.match(JT.temoinFiche(JT.lireTcg(T(2, 'Kricketune - 006/163', '006/163')), fiche).cause, /nom/);
        const autreNumero = JT.temoinFiche(JT.lireTcg(T(3, 'Kricketune V - 007/163', '007/163')), fiche); assert.strictEqual(autreNumero.verdict, 'faux'); assert.match(autreNumero.cause, /numéro/);
        const autreTotal = JT.temoinFiche(JT.lireTcg(T(4, 'Kricketune V - 006/200', '006/200')), fiche); assert.strictEqual(autreTotal.verdict, 'lache'); assert.match(autreTotal.cause, /total/);
        const forme = JT.temoinFiche(JT.lireTcg(T(10, 'Burmy Trash Cloak - 56/99', '56/99')), { nomEn: 'Burmy', impressions: [{ numero: '56', total: '99' }] }); assert.strictEqual(forme.verdict, 'lache'); assert.match(forme.cause, /nom-forme/);
        assert.strictEqual(JT.temoinFiche(JT.lireTcg(T(11, 'Miracle Sphere Alpha - 129/144', '129/144')), { nomEn: 'Miracle Sphere α', impressions: [{ numero: '129', total: '144' }] }).verdict, 'juste', 'lettre grecque');
        assert.strictEqual(JT.temoinFiche(t, { nomEn: 'Kricketune V', impressions: [{ tirage: 'intl', numero: null, total: null }] }).verdict, 'non-jugeable');
        assert.strictEqual(JT.temoinFiche(t, null).verdict, 'non-jugeable');
        assert.strictEqual(JT.temoinFiche(JT.lireTcg(T(5, 'Chespin - XY01', 'XY01')), { nomEn: 'Chespin', impressions: [{ numero: 'XY01', total: null }] }).verdict, 'juste');
        assert.strictEqual(JT.temoinFiche(JT.lireTcg(T(6, 'Yveltal EX - XY150a', 'XY150a')), { nomEn: 'Yveltal-EX', impressions: [{ numero: '150a' }] }).verdict, 'juste', 'préfixe d\'un seul côté + tiret du nom');
        assert.strictEqual(JT.temoinFiche(JT.lireTcg(T(7, 'Morpeko V-Union - SWSH287', 'SWSH287')), { nomEn: 'Morpeko V-UNION', impressions: [{ numero: 'SWSH287 (Top Left)' }, { numero: '226' }] }).verdict, 'juste', 'le commentaire du numéro imprimé se lit à part');
        assert.strictEqual(JT.temoinFiche(JT.lireTcg(T(8, 'Fairy Charm G - 174/214', '174/214')), { nomEn: 'Fairy Charm Grass', impressions: [{ numero: '174', total: '214' }] }).verdict, 'juste', 'le type d\'une Énergie : lettre chez Cardmarket, mot sur la fiche');
        assert.strictEqual(JT.temoinFiche(JT.lireTcg(T(9, 'Fairy Charm G - 174/214', '174/214')), { nomEn: 'Fairy Charm Fire', impressions: [{ numero: '174', total: '214' }] }).verdict, 'faux');
    });

    // ───────── la calibration ─────────
    await test('calibration : justes / faux / muets / non jugeables sont comptés séparément, avec le détail des faux ; une clé qui rend un faux n\'est PAS retenue', () => {
        const tcg = [T(10, 'Pikachu - 025/185', '025/185'), T(11, 'Raichu - 026/185', '026/185'), T(12, 'Mew - 030/185', '030/185')].map(JT.lireTcg);
        const cm = [
            { cm: JT.lireCm(C(1, 'Pikachu [x]', '025')), fiche: { nomEn: 'Pikachu', impressions: [{ numero: '025', total: '185' }] } },
            { cm: JT.lireCm(C(2, 'Raichu [x]', '026')), fiche: { nomEn: 'Raichu', impressions: [{ numero: '999', total: '185' }] } },
            { cm: JT.lireCm(C(3, 'Mew [x]', '030')), fiche: { nomEn: 'Mew', impressions: [{ numero: null }] } },
            { cm: JT.lireCm(C(4, 'Absent [x]', '031')), fiche: { nomEn: 'Absent', impressions: [{ numero: '031' }] } }];
        const r = JT.calibrer({ tcg, cm });
        assert.deepStrictEqual([r.justes, r.faux, r.muets, r.nonJugeables, r.total], [1, 1, 1, 1, 4]); assert.strictEqual(r.fauxDetail.length, 1); assert.strictEqual(r.fauxDetail[0].idProduct, 2);
        assert.strictEqual(r.retenue, false); assert.strictEqual(JT.calibrer({ tcg: tcg.slice(0, 1), cm: cm.slice(0, 1) }).retenue, true);
        assert.strictEqual(JT.calibrer({ tcg: [], cm: [] }).retenue, false, 'un échantillon vide ne retient rien (§41)');
    });

    // ───────── le plan : des unités au format commun ─────────
    await test('plan : un produit joint devient une unité du format commun (carte, set, numéro de fiche, image pleine, id, preuve neutre) ; la langue vient de la catégorie ; le japonais n\'est pas écrivable', () => {
        const cm = JT.lireCm(C(1, 'Pikachu [x]', '025', { slugSet: 'Set-A' }));
        const ligne = { idProduct: 1, lignes: [{ carteId: 7, slugSet: 'Set-A', numeroFiche: '025' }], carteNom: 'Pikachu' };
        const u = JT.uniteDe({ joint: { idProduct: 1, productId: 10, niveau: 'fort' }, tcg: JT.lireTcg(T(10, 'Pikachu - 025/185', '025/185')), ligne, cm, categoryId: 3, langueDeCategorie: { 3: 'en', 85: 'ja' }, groupe: 'DIVERS', nomGroupe: 'Set A' });
        assert.deepStrictEqual([u.carteId, u.slugSet, u.numero, u.produits, u.idSource, u.groupe, u.langue, u.url, u.numeroSource, u.ecrivable], [7, 'Set-A', '025', [1], '10', 'DIVERS', 'en', 'https://tcgplayer-cdn.tcgplayer.com/product/10_in_1000x1000.jpg', '25/185', true]);
        assert.ok(!/tcgplayer|tcgcsv/i.test(u.preuveNeutre));
        const j = JT.uniteDe({ joint: { idProduct: 1, productId: 10, niveau: 'fort' }, tcg: JT.lireTcg(T(10, 'Pikachu - 025/185', '025/185')), ligne, cm, categoryId: 85, langueDeCategorie: { 3: 'en', 85: 'ja' }, groupe: 'ASIE-jp', nomGroupe: 'x' });
        assert.deepStrictEqual([j.langue, j.ecrivable], ['ja', false]);
        assert.strictEqual(JT.uniteDe({ joint: { idProduct: 1, productId: 10 }, tcg: { ...JT.lireTcg(T(10, 'x', '1/1')), url: null }, ligne, cm, categoryId: 3, langueDeCategorie: { 3: 'en' }, groupe: 'G', nomGroupe: 'x' }), null, 'sans adresse d\'image : aucune unité');
        // une fiche à plusieurs lignes (un produit sur plusieurs cartes) ne désigne aucune carte
        assert.strictEqual(JT.uniteDe({ joint: { idProduct: 1, productId: 10 }, tcg: JT.lireTcg(T(10, 'Pikachu - 025/185', '025/185')), ligne: { ...ligne, lignes: [...ligne.lignes, { carteId: 8, slugSet: 'Set-A', numeroFiche: '025' }] }, cm, categoryId: 3, langueDeCategorie: { 3: 'en' }, groupe: 'G', nomGroupe: 'x' }), null);
    });
    await test('joindreTable : l\'unicité compte TOUS les produits de l\'expansion ; deux groupes qui désignent deux produits différents = ambigu ; une expansion non appariée = pas de jointure', () => {
        const D = require('./collecte-cartes/tcgcsv-donnees');
        const mkP = (id, name, numero, idExpansion) => ({ idProduct: id, name, numero, slug: null, slugSet: `E${idExpansion}`, codeSet: 'X', idExpansion });
        const cm = D.assemblerCm({ sets: [{ _id: 'E10', tirage: 'intl' }, { _id: 'E20', tirage: 'intl' }], cartes: [], cp: [],
            nc: [mkP(1, 'Alpha', '1', 10), mkP(2, 'Beta', '2', 10), mkP(3, 'Gamma', '3', 10), mkP(4, 'Beta', '2', 10), mkP(5, 'Delta', '1', 20)], cat: [1, 2, 3, 4, 5].map(i => ({ idProduct: i, name: ['Alpha', 'Beta', 'Gamma', 'Beta', 'Delta'][i - 1] })) });
        const g = (groupId, ps) => ({ categoryId: 3, name: `G${groupId}`, produits: ps.map(JT.lireTcg) });
        const gs = new Map([[1, g(1, [T(101, 'Alpha - 1/3', '1/3'), T(102, 'Beta - 2/3', '2/3'), T(103, 'Gamma - 3/3', '3/3')])]]);
        const table = { lignes: [{ groupId: 1, statut: 'apparie', expansions: [{ idExpansion: 10 }] }, { groupId: 9, statut: 'non-apparie', expansions: [] }] };
        const r = JT.joindreTable({ table, groupes: gs, cm });
        assert.deepStrictEqual([r.get(1).joint.productId, r.get(3).joint.productId], [101, 103]);
        assert.deepStrictEqual([r.get(2).motif, r.get(4).motif], ['ambigu-cm', 'ambigu-cm'], 'deux produits Cardmarket Beta (n° 2) : AUCUN joint');
        assert.strictEqual(r.get(5).motif, 'expansion-non-appariee');
        // deux groupes, deux produits du marché différents pour le même produit Cardmarket
        const g2 = new Map([[1, g(1, [T(101, 'Alpha - 1/3', '1/3')])], [2, g(2, [T(201, 'Alpha - 1/3', '1/3')])]]);
        const t2 = { lignes: [{ groupId: 1, statut: 'apparie', expansions: [{ idExpansion: 10 }] }, { groupId: 2, statut: 'apparie', expansions: [{ idExpansion: 10 }] }] };
        assert.strictEqual(JT.joindreTable({ table: t2, groupes: g2, cm }).get(1).motif, 'ambigu-groupes');
    });

    await test('planifierCatalogue : un produit joint SANS visuel dans son set devient une unité (famille, langue de la catégorie) ; déjà imagé, plusieurs lignes, groupe traité à part : comptés, pas d\'unité ; le japonais est une unité non écrivable', () => {
        const D = require('./collecte-cartes/tcgcsv-donnees');
        const mkP = (id, name, numero, idExpansion, slugSet) => ({ idProduct: id, name, numero, slug: `${name.replace(/ /g, '-')}-X${numero}`, slugSet, codeSet: 'X', idExpansion });
        const cm = D.assemblerCm({ sets: [{ _id: 'Set-A', tirage: 'intl' }, { _id: 'Set-J', tirage: 'jp' }],
            cartes: [{ _id: 7, nomEn: 'Alpha', impressions: [{ numero: '1', total: '3' }], images: [] }, { _id: 8, nomEn: 'Beta', impressions: [{ numero: '2', total: '3' }], images: [{ set: 'Set-A', source: 'x' }] }, { _id: 9, nomEn: 'Gamma', impressions: [], images: [] }, { _id: 10, nomEn: 'Aj', impressions: [{ numero: '1' }], images: [] }],
            cp: [{ idProduct: 1, carteId: 7, slugSet: 'Set-A', numeroFiche: '1' }, { idProduct: 2, carteId: 8, slugSet: 'Set-A', numeroFiche: '2' }, { idProduct: 3, carteId: 9, slugSet: 'Set-A', numeroFiche: '3' }, { idProduct: 3, carteId: 99, slugSet: 'Set-A', numeroFiche: '3' }, { idProduct: 4, carteId: 10, slugSet: 'Set-J', numeroFiche: '1' }],
            nc: [mkP(1, 'Alpha', '1', 10, 'Set-A'), mkP(2, 'Beta', '2', 10, 'Set-A'), mkP(3, 'Gamma', '3', 10, 'Set-A'), mkP(4, 'Aj', '1', 20, 'Set-J')], cat: [[1, 'Alpha'], [2, 'Beta'], [3, 'Gamma'], [4, 'Aj']].map(([idProduct, name]) => ({ idProduct, name })) });
        const rel = { categories: { pokemon: 3, japon: 85 }, listes: { 3: [{ groupId: 1, name: 'Set A' }], 85: [{ groupId: 2, name: 'Set J' }] },
            1: { categoryId: 3, produits: [T(101, 'Alpha - 1/3', '1/3', { groupId: 1 }), T(102, 'Beta - 2/3', '2/3', { groupId: 1 }), T(103, 'Gamma - 3/3', '3/3', { groupId: 1 })] }, 2: { categoryId: 85, produits: [T(201, 'Aj - 1/1', '1/1', { groupId: 2 })] } };
        const r = JT.planifierCatalogue({ rel, cm, minCommuns: 1 });
        const u = Object.fromEntries(r.unites.map(x => [x.produits[0], x]));
        assert.deepStrictEqual(Object.keys(u).sort(), ['1', '4']);
        assert.deepStrictEqual([u[1].langue, u[1].ecrivable, u[1].groupe, u[1].carteId, u[1].idSource], ['en', true, 'OCCIDENTAL', 7, '101']);
        assert.deepStrictEqual([u[4].langue, u[4].ecrivable, u[4].groupe], ['ja', false, 'JP']);
        assert.deepStrictEqual(Object.fromEntries(r.restes.map(x => [x.idProduct, x.motif])), { 2: 'deja-image', 3: 'plusieurs-lignes' });
        const exclu = JT.planifierCatalogue({ rel, cm, minCommuns: 1, exclureGroupes: new Set([1]) });
        assert.deepStrictEqual(exclu.unites.map(x => x.produits[0]), [4]); assert.ok(exclu.restes.some(x => x.motif === 'groupe-traite-a-part'));
        assert.strictEqual(JT.familleDe('WCD-2019', 'intl'), 'WCD'); assert.strictEqual(JT.familleDe('Play-Pokemon-Prize-Pack-Series-Two', 'intl'), 'PRIZE'); assert.strictEqual(JT.familleDe('Truc', 'zh-hans'), 'zh-hans');
    });

    // ───────── les données Cardmarket ─────────
    await test('assemblerCm : produits par expansion, tirage lu sur le set, fiche seulement si UNE ligne ; les dénominateurs sont imprimés ; une population vide LÈVE', () => {
        const D = require('./collecte-cartes/tcgcsv-donnees');
        const d = D.assemblerCm({ sets: [{ _id: 'Set-A', tirage: 'intl' }, { _id: 'Set-J', region: 'jp' }], cartes: [{ _id: 7, nomEn: 'Pikachu', impressions: [{ numero: '025', total: '185' }], images: [{ source: 'x' }] }],
            cp: [{ idProduct: 1, carteId: 7, slugSet: 'Set-A', numeroFiche: '025' }, { idProduct: 2, carteId: 7, slugSet: 'Set-A' }, { idProduct: 2, carteId: 8, slugSet: 'Set-A' }],
            nc: [{ idProduct: 1, idExpansion: 10, slugSet: 'Set-A', codeSet: 'A', numero: '025', slug: 'Pikachu-A25' }, { idProduct: 2, idExpansion: 10, slugSet: 'Set-A', codeSet: 'A', numero: '026', slug: 'Raichu-A26' }, { idProduct: 3, idExpansion: 20, slugSet: 'Set-J', codeSet: 'J', numero: '1', slug: 'X-J1' }, { idProduct: 4, idExpansion: 20, slugSet: 'Set-J', numero: '2' }],
            cat: [{ idProduct: 1, name: 'Pikachu [Thunder Shock]' }, { idProduct: 2, name: 'Raichu' }, { idProduct: 3, name: 'X' }] });
        assert.deepStrictEqual([d.expansions.get(10).tirage, d.expansions.get(20).tirage, d.expansions.get(10).produits.length], ['intl', 'jp', 2]);
        assert.deepStrictEqual([d.produits.get(1).carteNom, d.produits.get(1).fiche.impressions[0].numero, d.produits.get(1).nImages], ['Pikachu', '025', 1]);
        assert.strictEqual(d.produits.get(2).fiche, null, 'deux lignes : aucune fiche');
        assert.deepStrictEqual([d.denominateurs.produits, d.denominateurs.sansCatalogue, d.denominateurs.produitsAvecLigne], [3, 1, 2]);
        assert.throws(() => D.assemblerCm({ sets: [], cp: [], cartes: [], nc: [], cat: [] }), /vide/);
        assert.strictEqual(D.expansionsPourTable(d)[0].produits[0].fort, '25');
    });
    console.log(`${ok} passés, ${ko} en échec`);
    process.exitCode = ko ? 1 : 0;
})();
