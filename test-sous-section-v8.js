'use strict';
// Lot V8, tour 1 (2026-10-12) — une ligne de source qui DÉCLARE une sous-section (`sousSection`) : (1) ses mesures se prennent dans cette sous-section,
// (2) elle ne joint que les entrées de cette sous-section, (3) une clé (carte, set, numéro) que deux images partagent n'en désigne aucune.
// Les lignes qui ne déclarent rien se comportent comme avant (cas témoins). Sans réseau, sans base : faux objet en mémoire.
const assert = require('assert');
const { entreesDeMesure } = require('./collecte-cartes/echantillon-mesure');
const { jointureSousSection } = require('./collecte-cartes/sous-section-image');
const { clesPartagees } = require('./collecte-cartes/images-cle-partagee');
const { joindreImages } = require('./collecteur-images.js');   // ne lance rien : require.main !== module

let ok = 0, ko = 0;
const t = async (nom, f) => { try { await f(); ok++; console.log('  ✅', nom); } catch (e) { ko++; console.log('  ❌', nom, '—', e.message); } };
const e = (sid, n) => ({ sourceSetId: sid, n, titre: `x${n}` });

(async () => {
    // ── 1. l'échantillon de mesure ──
    await t('sans déclaration : les 3 premières entrées de la liste (comme avant)', () => {
        const l = [e(1, 1), e(2, 1), e(2, 2), e(2, 3)];
        assert.deepStrictEqual(entreesDeMesure(l, { ids: [9] }).map(x => `${x.sourceSetId}/${x.n}`), ['1/1', '2/1', '2/2']);
    });
    await t('sous-section déclarée : les 3 premières DE CETTE sous-section', () => {
        const l = [e(1, 1), e(1, 2), e(2, 1), e(2, 2), e(2, 3), e(2, 4)];
        assert.deepStrictEqual(entreesDeMesure(l, { sousSection: 2 }).map(x => `${x.sourceSetId}/${x.n}`), ['2/1', '2/2', '2/3']);
    });
    await t('sous-section déclarée de moins de 3 entrées : toutes ses entrées, jamais celles d\'une autre', () => {
        const l = [e(1, 1), e(1, 2), e(1, 3), e(2, 1), e(2, 2)];
        assert.deepStrictEqual(entreesDeMesure(l, { sousSection: '2' }).map(x => `${x.sourceSetId}/${x.n}`), ['2/1', '2/2']);
    });
    await t('sous-section déclarée mais absente de la liste : rien (l\'appelant refuse, il ne mesure pas un autre deck)', () => {
        assert.deepStrictEqual(entreesDeMesure([e(1, 1), e(1, 2)], { sousSection: 7 }), []);
    });
    await t('entreesDeLaLigne : sans déclaration la liste entière ; déclarée, seulement la sous-section (téléchargement et complétude)', () => {
        const { entreesDeLaLigne } = require('./collecte-cartes/echantillon-mesure');
        const l = [e(1, 1), e(2, 1), e(2, 2)];
        assert.strictEqual(entreesDeLaLigne(l, { ids: [9] }).length, 3);
        assert.deepStrictEqual(entreesDeLaLigne(l, { sousSection: 2 }).map(x => x.n), [1, 2]);
    });
    // ── 2. la jointure ──
    await t('jointureSousSection : une image d\'une AUTRE sous-section que la déclarée est refusée, même au numéro ET au nom', () => {
        const r = jointureSousSection({ sourceSetId: 649, nomEn: 'Alpha' }, [{ nomEn: 'Alpha' }], 'numero', [176], x => x, { sousSection: 648 });
        assert.deepStrictEqual(r.cands, []); assert.ok(/autre sous-section/.test(r.raison), r.raison);
    });
    await t('jointureSousSection : sans déclaration, comportement d\'avant (numéro ET nom suffisent)', () => {
        const r = jointureSousSection({ sourceSetId: 649, nomEn: 'Alpha' }, [{ nomEn: 'Alpha' }], 'numero', [176], x => x);
        assert.strictEqual(r.cands.length, 1);
    });
    // ── 3. la clé partagée ──
    await t('clesPartagees : un numéro CHIFFRÉ porté par deux images différentes n\'est refusé que si la portée « numérotés » est demandée', () => {
        const rs = [{ carteId: 5, im: { numero: '005', sha256: 'a' } }, { carteId: 5, im: { numero: '005', sha256: 'b' } }, { carteId: 6, im: { numero: '006', sha256: 'c' } }];
        assert.strictEqual(clesPartagees(rs).size, 0, 'avant : inchangé');
        assert.deepStrictEqual([...clesPartagees(rs, { numerotes: true })], ['5|005']);
    });
    await t('(tour 2) image SANS sourceSetId pour une ligne à sous-section : refusée (une garde qui ne peut pas conclure bloque) ; sans déclaration, comme avant', () => {
        const r = jointureSousSection({ sourceSetId: null, nomEn: 'Alpha' }, [{ nomEn: 'Alpha' }], 'numero', [176], x => x, { sousSection: 648 });
        assert.deepStrictEqual(r.cands, []); assert.ok(/ne peut pas conclure/.test(r.raison), r.raison);
        assert.strictEqual(jointureSousSection({ sourceSetId: null, nomEn: 'Alpha' }, [{ nomEn: 'Alpha' }], 'numero', [176], x => x).cands.length, 1);
    });
    await t('(tour 2) le prédicat « même sous-section » est UN : memeSousSection (null refusé, nombre/chaîne égaux), partagé par la sélection et la jointure', () => {
        const { memeSousSection } = require('./collecte-cartes/echantillon-mesure');
        assert.ok(memeSousSection('649', 649)); assert.ok(!memeSousSection(null, 649)); assert.ok(!memeSousSection(648, 649)); assert.ok(memeSousSection(1, null));
        assert.deepStrictEqual(entreesDeMesure([{ sourceSetId: null, n: 1 }, e(649, 2)], { sousSection: 649 }).map(x => x.n), [2]);
    });
    await t('(tour 2) clesPartagees numerotes : un numéro absent ne forme jamais de clé « null »', () => {
        const rs = [{ carteId: 5, im: { numero: null, sha256: 'a' } }, { carteId: 5, im: { numero: '', sha256: 'b' } }, { carteId: 5, im: { numero: undefined, sha256: 'c' } }];
        assert.strictEqual(clesPartagees(rs, { numerotes: true }).size, 0);
    });
    // ── 4. de bout en bout, par la fonction de production ──
    const cartes = [
        { _id: 1, nomEn: 'Alpha', nomJa: null, sets: ['S1'], images: [], impressions: [{ tirage: 'jp', expansion: 'X', deck: 'D1', numero: '001' }] },
        { _id: 2, nomEn: 'Beta', nomJa: null, sets: ['S1'], images: [], impressions: [{ tirage: 'jp', expansion: 'X', deck: 'D1', numero: '002' }] },
        { _id: 3, nomEn: 'Gamma', nomJa: null, sets: ['S1'], images: [], impressions: [{ tirage: 'jp', expansion: 'X', deck: 'D1', numero: '003' }] }
    ];
    const im = (sid, n, numero, nomEn) => ({ _id: `artofpkm/${sid}/${n}`, source: 'artofpkm', sourceSetId: sid, n, titre: nomEn, cleR2: `artofpkm/${sid}/${n}.webp`, sha256: `s${sid}-${n}`, w: 500, h: 700, numero, nomEn, nomJa: null, etat: 'ok' });
    const images = [im(10, 1, '001', 'Alpha'), im(10, 2, '002', 'Beta'), im(10, 3, '002', 'Beta'), im(10, 4, '003', 'Gamma'), im(11, 1, '001', 'Alpha'), im(11, 2, '003', 'Gamma')];
    const lean = v => ({ lean: async () => v, select() { return this; } });
    const M = { Carte: { find: () => lean(JSON.parse(JSON.stringify(cartes))) }, Image: { find: () => lean(images) } };
    const L = { code: 'T', slugSet: 'S1', bulba: { tirage: 'jp', expansion: 'X', deck: 'D1' } };
    const lancer = S => joindreImages(M, L, 'S1', S, { 1: images.map(i => ({ sourceSetId: i.sourceSetId, n: i.n })) }, {}, require('os').tmpdir(), { silencieux: true, simuler: true });
    const cles = r => r.nouvelles.map(n => n.cleR2).sort();
    await t('ligne qui déclare la sous-section 10 : seules ses images, la clé partagée (002 ×2) refusée, rien venu de la 11', async () => {
        const r = await lancer({ ids: [1], noms: ['X'], setDeBase: 'T', sousSection: 10 });
        assert.deepStrictEqual(cles(r), ['artofpkm/10/1.webp', 'artofpkm/10/4.webp']);
    });
    await t('même liste SANS déclaration : comportement d\'avant (les deux sous-sections, la dernière image d\'une clé partagée)', async () => {
        const r = await lancer({ ids: [1], noms: ['X'], setDeBase: 'T' });
        assert.ok(cles(r).some(c => c.startsWith('artofpkm/11/')), 'la sous-section 11 joint comme avant');
        assert.ok(cles(r).includes('artofpkm/10/3.webp') || cles(r).includes('artofpkm/10/2.webp'), 'Beta est servie comme avant');
    });
    console.log(`\n${ok} réussi(s), ${ko} en échec`);
    process.exit(ko ? 1 : 0);
})();
