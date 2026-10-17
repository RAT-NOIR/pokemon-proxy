// Banc de collecte-cartes/detacher-entrees-images.js ET de collecte-cartes/retirer-chez-les-autres.js (lot VIGN-SUITE, point 6, 2026-10-17).
// Base EN MÉMOIRE, aucun réseau, aucune base réelle.   node test-detacher-entrees-images.js
const assert = require('assert');
const DE = require('./collecte-cartes/detacher-entrees-images');
const RA = require('./collecte-cartes/retirer-chez-les-autres');
const { correctionDe } = require('./collecte-cartes/corrections-images');

let ok = 0, ko = 0;
const t = async (nom, f) => { try { await f(); ok++; console.log('  ok  ' + nom); } catch (e) { ko++; console.log('  ECHEC ' + nom + '\n     ' + String(e.message).split('\n')[0]); } };

const en = (set, cleR2, numero, extra = {}) => ({ set, cleR2, numero, source: 'artofpkm', ...extra });
/** Monde de base : les 5 cartes de base portent leur fichier ET celui du LV.X ; chaque LV.X porte le sien. */
function monde() {
    return DE.LISTE.flatMap(x => [
        { _id: x.carteId, nomEn: 'base ' + x.carteId, images: [en(x.set, x.cleJuste, '1'), en(x.set, x.cleFausse, '2', { vignette: { cleR2: 'v/' + x.carteId } })] },
        { _id: x.carteLvx, nomEn: 'lvx ' + x.carteLvx, images: [en(x.set, x.cleFausse, '2')] }
    ]);
}
/** Faux db/Carte : find/findOne par _id, $elemMatch + $pull sur images, updateOne/updateMany. */
function faussebase(cartes) {
    const donnees = { cartes: cartes.map(x => structuredClone(x)) };
    const elem = (d, em) => (d.images || []).some(i => Object.entries(em).every(([k, v]) => i[k] === v));
    const corr = (d, f) => Object.entries(f).every(([k, v]) => k === '_id' ? (v && typeof v === 'object' && '$ne' in v ? d._id !== v.$ne : d._id === v) : k === 'images' ? elem(d, v.$elemMatch) : false);
    const pull = (d, p) => { d.images = d.images.filter(i => !Object.entries(p).every(([k, v]) => i[k] === v)); };
    const cartesCol = {
        findOne: async f => structuredClone(donnees.cartes.find(d => corr(d, f)) ?? null),
        updateOne: async (f, u) => { const d = donnees.cartes.find(x => corr(x, f)); if (!d) return { modifiedCount: 0 }; pull(d, u.$pull.images); return { modifiedCount: 1 }; },
        updateMany: async (f, u) => { const ds = donnees.cartes.filter(x => corr(x, f)); ds.forEach(d => pull(d, u.$pull.images)); return { modifiedCount: ds.length }; }
    };
    return { donnees, collection: () => cartesCol };
}

(async () => {
    await t('la liste est FERMÉE : 5 entrées, celles du brief, figée', () => {
        assert.strictEqual(DE.LISTE.length, 5); assert.ok(Object.isFrozen(DE.LISTE));
        assert.deepStrictEqual(DE.LISTE.map(x => `${x.carteId}|${x.set}|${x.cleFausse}|${x.carteLvx}`), [
            '33955|Secret-of-the-Lakes|artofpkm/150/23.webp|26230', '29819|Dawn-Dash|artofpkm/166/38.webp|28217', '39868|Dawn-Dash|artofpkm/166/19.webp|41644',
            '40037|Dawn-Dash|artofpkm/166/5.webp|41758', '34851|Moonlit-Pursuit|artofpkm/164/39.webp|36172']);
    });
    await t('la liste est COHÉRENTE avec corrections-images.js : chaque fichier est attribué par la table au LV.X nommé', () => {
        for (const x of DE.LISTE) { const c = correctionDe(x.cleFausse); assert.ok(c && c.carteId === x.carteLvx, x.cleFausse); }
    });
    await t('ROUGE-VU (état fabriqué) : le plan trouve les 5 entrées fausses, deux éléments chacune (le LV.X le porte, la carte a la sienne)', async () => {
        const p = await DE.simuler(faussebase(monde()));
        assert.strictEqual(p.aDetacher.length, 5); assert.strictEqual(p.refus.length, 0);
        assert.strictEqual(p.aDetacher.filter(x => x.avecVignette).length, 5);
    });
    await t('détacher : retire l\'entrée (carte, set, cleR2) et RIEN d\'autre ; le LV.X garde la sienne ; la carte garde la sienne', async () => {
        const db = faussebase(monde());
        const p = await DE.simuler(db);
        assert.strictEqual(await DE.detacher(db, p), 5);
        for (const x of DE.LISTE) {
            const base = db.donnees.cartes.find(c => c._id === x.carteId), lvx = db.donnees.cartes.find(c => c._id === x.carteLvx);
            assert.deepStrictEqual(base.images.map(i => i.cleR2), [x.cleJuste]);
            assert.deepStrictEqual(lvx.images.map(i => i.cleR2), [x.cleFausse]);
        }
    });
    await t('NON : la carte de base n\'a pas son propre fichier (rien ne dit que l\'autre entrée est la fausse) -> refus, rien d\'écrit', async () => {
        const m = monde(); m[0].images = m[0].images.filter(i => i.cleR2 !== DE.LISTE[0].cleJuste);
        const p = await DE.simuler(faussebase(m));
        assert.strictEqual(p.aDetacher.length, 4); assert.match(p.refus[0].raison, /sien|propre/);
    });
    await t('NON : le LV.X ne porte pas le fichier (il pourrait être le seul à le porter) -> refus', async () => {
        const m = monde(); m[1].images = [];
        const p = await DE.simuler(faussebase(m));
        assert.strictEqual(p.aDetacher.length, 4); assert.match(p.refus[0].raison, /LV\.X/);
    });
    await t('NON : l\'entrée est portée DEUX fois sur la carte de base -> refus (exactement une)', async () => {
        const m = monde(); m[0].images.push(en(DE.LISTE[0].set, DE.LISTE[0].cleFausse, '3'));
        const p = await DE.simuler(faussebase(m));
        assert.strictEqual(p.aDetacher.length, 4); assert.match(p.refus[0].raison, /exactement une/);
    });
    await t('NON : déjà détachée -> refus « rien à détacher » (rejouable sans effet)', async () => {
        const db = faussebase(monde()); await DE.detacher(db, await DE.simuler(db));
        const p = await DE.simuler(db);
        assert.strictEqual(p.aDetacher.length, 0); assert.strictEqual(p.refus.length, 5);
    });
    // --- la cause : le rejeu de jointure doit retirer, chez les AUTRES cartes, l'entrée qu'une correction attribue à une carte
    await t('ROUGE-VU : la correction (carte, set, cleR2) retire le fichier chez les autres cartes du set, pas chez la carte nommée ni dans un autre set', async () => {
        const x = DE.LISTE[0];
        const m = monde(); m.push({ _id: 999, images: [en('Autre-Set', x.cleFausse, '2')] });
        const db = faussebase(m);
        const n = await RA.retirerChezLesAutres(db.collection('cartes'), { carteId: x.carteLvx, set: x.set, cleR2: x.cleFausse });
        assert.strictEqual(n, 1);
        assert.deepStrictEqual(db.donnees.cartes.find(c => c._id === x.carteId).images.map(i => i.cleR2), [x.cleJuste]);
        assert.deepStrictEqual(db.donnees.cartes.find(c => c._id === x.carteLvx).images.map(i => i.cleR2), [x.cleFausse]);
        assert.strictEqual(db.donnees.cartes.find(c => c._id === 999).images.length, 1);
    });
    await t('refus : arguments incomplets (jamais de $pull sans set ni clé ni carte)', async () => {
        const db = faussebase(monde());
        await assert.rejects(() => RA.retirerChezLesAutres(db.collection('cartes'), { carteId: 1, set: '', cleR2: 'a' }), /requis/);
        await assert.rejects(() => RA.retirerChezLesAutres(db.collection('cartes'), { carteId: null, set: 's', cleR2: 'a' }), /requis/);
    });
    console.log(`\n${ok} ok, ${ko} echec(s)`);
    process.exit(ko ? 1 : 0);
})();
