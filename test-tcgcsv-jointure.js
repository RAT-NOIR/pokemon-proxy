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
        const autreTotal = JT.temoinFiche(JT.lireTcg(T(4, 'Kricketune V - 006/200', '006/200')), fiche); assert.strictEqual(autreTotal.verdict, 'faux'); assert.match(autreTotal.cause, /total/);
        assert.strictEqual(JT.temoinFiche(t, { nomEn: 'Kricketune V', impressions: [{ tirage: 'intl', numero: null, total: null }] }).verdict, 'non-jugeable');
        assert.strictEqual(JT.temoinFiche(t, null).verdict, 'non-jugeable');
        assert.strictEqual(JT.temoinFiche(JT.lireTcg(T(5, 'Chespin - XY01', 'XY01')), { nomEn: 'Chespin', impressions: [{ numero: 'XY01', total: null }] }).verdict, 'juste');
        assert.strictEqual(JT.temoinFiche(JT.lireTcg(T(6, 'Yveltal EX - XY150a', 'XY150a')), { nomEn: 'Yveltal-EX', impressions: [{ numero: '150a' }] }).verdict, 'juste', 'préfixe d\'un seul côté + tiret du nom');
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
    console.log(`${ok} passés, ${ko} en échec`);
    process.exitCode = ko ? 1 : 0;
})();
