// Banc de collecte-cartes/image-du-parent.js (lot EEVEE, décision 4 du testeur, 2026-10-13). Base EN MÉMOIRE (faux `db`), aucun réseau, aucune base réelle.
//   node test-image-du-parent.js
const assert = require('assert');
const IP = require('./collecte-cartes/image-du-parent');

let ok = 0, ko = 0;
const t = async (nom, f) => { try { await f(); ok++; console.log('  ✅ ' + nom); } catch (e) { ko++; console.log('  ❌ ' + nom + '\n     ' + String(e.message).split('\n')[0]); } };

const E = IP.ENTREES[0];
const LIGNE = { _id: '358473|909374', carteId: 358473, idProduct: 909374, slug: 'Eevee-x30C116', slugSet: '30th-Celebration-Additionals', numeroFiche: '116' };
const IMG = { set: '30th-Celebration', source: 'tcgdex', cleR2: 'tcgdex/30th-Celebration/116-358473.webp', numero: '116', langue: 'en', w: 600, h: 825 };
const JP = { set: '30th-Celebration-JP', source: 'artofpkm', cleR2: 'artofpkm/592/94.webp', numero: '094', langue: 'ja', w: 868, h: 1212 };
const CARTE = { _id: 358473, nomEn: 'Eevee', images: [IMG, JP] };
const admet = () => true;                                  // la règle du site, injectée (le banc ne l'importe pas)
const MAINTENANT = new Date('2026-10-14T10:00:00Z');

/** Une base en mémoire : deux collections, findOne / updateOne / countDocuments sur égalité simple, $exists:false, chemins pointés, $set / $unset. */
function faussebase(lignes, cartes) {
    const donnees = { cartes_produits: lignes.map(x => structuredClone(x)), cartes: cartes.map(x => structuredClone(x)) };
    const lire = (o, chemin) => chemin.split('.').reduce((a, k) => (a == null ? undefined : a[k]), o);
    const correspond = (d, f) => Object.entries(f).every(([k, v]) => (v && typeof v === 'object' && '$exists' in v) ? ((lire(d, k) !== undefined) === v.$exists) : lire(d, k) === v);
    const col = nom => ({
        findOne: async f => donnees[nom].find(d => correspond(d, f)) ?? null,
        countDocuments: async f => donnees[nom].filter(d => correspond(d, f)).length,
        updateOne: async (f, u) => {
            const d = donnees[nom].find(x => correspond(x, f)); if (!d) return { matchedCount: 0, modifiedCount: 0 };
            for (const [k, v] of Object.entries(u.$set || {})) d[k] = structuredClone(v);
            for (const k of Object.keys(u.$unset || {})) delete d[k];
            return { matchedCount: 1, modifiedCount: 1 };
        }
    });
    return { donnees, collection: col };
}
const plan = async (lignes, cartes, regle = admet) => IP.simuler(faussebase(lignes, cartes), regle, { maintenant: MAINTENANT });

(async () => {
    await t('la liste est FERMÉE : une seule entrée, Eevee x30C116 → 30th Celebration n°116', () => {
        assert.strictEqual(IP.ENTREES.length, 1);
        assert.deepStrictEqual([E._id, E.carteId, E.idProduct, E.slugSet, E.setParent, E.numero], ['358473|909374', 358473, 909374, '30th-Celebration-Additionals', '30th-Celebration', '116']);
        assert.ok(Object.isFrozen(IP.ENTREES) && Object.isFrozen(E));
    });

    await t('cas nominal : le plan pose le scan du parent, champ explicite imageDuParent:true, mention, lot, décision datée', async () => {
        const r = await plan([LIGNE], [CARTE]);
        assert.strictEqual(r.refus.length, 0); assert.strictEqual(r.aPoser.length, 1);
        const v = r.aPoser[0].visuelSubstitut;
        assert.strictEqual(v.imageDuParent, true);
        assert.strictEqual(v.cleR2, IMG.cleR2); assert.strictEqual(v.source, 'tcgdex'); assert.strictEqual(v.set, '30th-Celebration');
        assert.strictEqual(v.numero, '116'); assert.strictEqual(v.langue, 'en'); assert.strictEqual(v.w, 600); assert.strictEqual(v.h, 825);
        assert.ok(/Image du parent/.test(v.mention) && /30th Celebration/.test(v.mention) && /116/.test(v.mention) && /coffret/.test(v.mention));
        assert.strictEqual(v.lot, IP.LOT); assert.ok(/2026-10-13/.test(v.decision) && /image du parent/i.test(v.decision));
        assert.ok(typeof v.preuve === 'string' && v.preuve.includes(IMG.cleR2));
        assert.strictEqual(v.le.getTime(), MAINTENANT.getTime());
    });

    await t('NON : ligne absente', async () => {
        const r = await plan([], [CARTE]);
        assert.strictEqual(r.aPoser.length, 0); assert.match(r.refus[0].raison, /ligne absente/);
    });
    await t('NON : la ligne est celle d\'un AUTRE produit (même _id, idProduct différent)', async () => {
        const r = await plan([{ ...LIGNE, idProduct: 907723 }], [CARTE]);
        assert.strictEqual(r.aPoser.length, 0); assert.match(r.refus[0].raison, /idProduct/);
    });
    await t('NON : la ligne n\'est pas dans le set de la liste (slugSet différent)', async () => {
        const r = await plan([{ ...LIGNE, slugSet: '30th-Celebration' }], [CARTE]);
        assert.strictEqual(r.aPoser.length, 0); assert.match(r.refus[0].raison, /slugSet/);
    });
    await t('NON : la ligne désigne une autre carte', async () => {
        const r = await plan([{ ...LIGNE, carteId: 1 }], [CARTE]);
        assert.strictEqual(r.aPoser.length, 0); assert.match(r.refus[0].raison, /carteId/);
    });
    await t('NON : un visuelSubstitut est déjà posé (jamais réécrit), même d\'un autre lot', async () => {
        const r = await plan([{ ...LIGNE, visuelSubstitut: { cleR2: 'x.webp', mention: 'autre' } }], [CARTE]);
        assert.strictEqual(r.aPoser.length, 0); assert.match(r.refus[0].raison, /déjà posé/);
    });
    await t('NON : carte absente', async () => {
        const r = await plan([LIGNE], []);
        assert.strictEqual(r.aPoser.length, 0); assert.match(r.refus[0].raison, /carte absente/);
    });
    await t('NON : image du parent absente (aucune entrée dans le set parent au n°116)', async () => {
        const r = await plan([LIGNE], [{ ...CARTE, images: [JP] }]);
        assert.strictEqual(r.aPoser.length, 0); assert.match(r.refus[0].raison, /image du parent absente/);
    });
    await t('NON : l\'entrée du parent est à un autre numéro (cleNumero)', async () => {
        const r = await plan([LIGNE], [{ ...CARTE, images: [{ ...IMG, numero: '117' }] }]);
        assert.strictEqual(r.aPoser.length, 0); assert.match(r.refus[0].raison, /image du parent absente/);
    });
    await t('NON : deux fichiers différents au n°116 du parent', async () => {
        const r = await plan([LIGNE], [{ ...CARTE, images: [IMG, { ...IMG, cleR2: 'autre/116.webp' }] }]);
        assert.strictEqual(r.aPoser.length, 0); assert.match(r.refus[0].raison, /deux fichiers/);
    });
    await t('OUI : deux entrées du MÊME fichier ne sont pas deux fichiers', async () => {
        const r = await plan([LIGNE], [{ ...CARTE, images: [IMG, { ...IMG }] }]);
        assert.strictEqual(r.aPoser.length, 1);
    });
    await t('NON : image refusée par la règle du site (admission intl)', async () => {
        const r = await plan([LIGNE], [CARTE], () => false);
        assert.strictEqual(r.aPoser.length, 0); assert.match(r.refus[0].raison, /refusée par la règle du site/);
    });
    await t('la règle du site est appelée avec le tirage intl', async () => {
        let vu = null; await plan([LIGNE], [CARTE], (i, region) => { vu = region; return true; });
        assert.strictEqual(vu, 'intl');
    });
    await t('une règle absente (non fonction) arrête : jamais de repli permissif', async () => {
        await assert.rejects(() => plan([LIGNE], [CARTE], null), /règle du site/);
    });

    await t('poser écrit sur la seule ligne, sans toucher cartes ni les autres lignes', async () => {
        const autre = { _id: '358473|907723', carteId: 358473, idProduct: 907723, slugSet: '30th-Celebration' };
        const base = faussebase([LIGNE, autre], [CARTE]);
        const avant = JSON.stringify(base.donnees.cartes);
        const r = await IP.simuler(base, admet, { maintenant: MAINTENANT });
        const n = await IP.poser(base, r);
        assert.strictEqual(n, 1);
        assert.strictEqual(base.donnees.cartes_produits[0].visuelSubstitut.imageDuParent, true);
        assert.strictEqual(base.donnees.cartes_produits[1].visuelSubstitut, undefined);
        assert.strictEqual(JSON.stringify(base.donnees.cartes), avant);
    });
    await t('poser est idempotent : un second passage ne réécrit rien (garde $exists:false)', async () => {
        const base = faussebase([LIGNE], [CARTE]);
        const r = await IP.simuler(base, admet, { maintenant: MAINTENANT });
        await IP.poser(base, r);
        const avant = JSON.stringify(base.donnees.cartes_produits);
        assert.strictEqual(await IP.poser(base, r), 0);
        assert.strictEqual(JSON.stringify(base.donnees.cartes_produits), avant);
    });

    // ── le retrait ──
    await t('retirer : retire ce que CE lot a posé (même lot, imageDuParent:true)', async () => {
        const base = faussebase([LIGNE], [CARTE]);
        await IP.poser(base, await IP.simuler(base, admet, { maintenant: MAINTENANT }));
        const r = await IP.simulerRetrait(base);
        assert.strictEqual(r.aRetirer.length, 1);
        assert.strictEqual(await IP.retirer(base, r), 1);
        assert.strictEqual(base.donnees.cartes_produits[0].visuelSubstitut, undefined);
    });
    await t('NON retirer : un substitut d\'un AUTRE lot (Prize Pack, sans lot) n\'est jamais retiré', async () => {
        const base = faussebase([{ ...LIGNE, visuelSubstitut: { cleR2: 'x.webp', mention: 'sans le tampon Prize Pack' } }], [CARTE]);
        const r = await IP.simulerRetrait(base);
        assert.strictEqual(r.aRetirer.length, 0); assert.match(r.refus[0].raison, /autre lot/);
        assert.strictEqual(await IP.retirer(base, r), 0);
        assert.ok(base.donnees.cartes_produits[0].visuelSubstitut);
    });
    await t('NON retirer : même lot mais sans imageDuParent:true', async () => {
        const base = faussebase([{ ...LIGNE, visuelSubstitut: { cleR2: 'x.webp', mention: 'm', lot: IP.LOT } }], [CARTE]);
        const r = await IP.simulerRetrait(base);
        assert.strictEqual(r.aRetirer.length, 0); assert.match(r.refus[0].raison, /autre lot|imageDuParent/);
    });
    await t('NON retirer : rien de posé → rien à retirer (compte 0, dit)', async () => {
        const r = await IP.simulerRetrait(faussebase([LIGNE], [CARTE]));
        assert.strictEqual(r.aRetirer.length, 0); assert.match(r.refus[0].raison, /rien à retirer/);
    });
    await t('retirer garde la condition au moment d\'écrire : un lot étranger posé entre la simulation et l\'écriture n\'est pas retiré', async () => {
        const base = faussebase([{ ...LIGNE, visuelSubstitut: { cleR2: 'x.webp', mention: 'm', lot: IP.LOT, imageDuParent: true } }], [CARTE]);
        const r = await IP.simulerRetrait(base);
        base.donnees.cartes_produits[0].visuelSubstitut = { cleR2: 'y.webp', mention: 'étranger', lot: 'autre' };
        assert.strictEqual(await IP.retirer(base, r), 0);
        assert.ok(base.donnees.cartes_produits[0].visuelSubstitut);
    });

    console.log(`\n${ok} passés, ${ko} en échec`);
    process.exit(ko ? 1 : 0);
})();
