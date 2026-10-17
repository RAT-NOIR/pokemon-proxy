// Banc de collecte-cartes/retrait-substituts.js (lot VIGN-SUITE, 2026-10-17) : retirer une image retire AUSSI les visuelSubstitut qui la servent.
// Base EN MÉMOIRE (faux `db`), aucun réseau, aucune base réelle.   node test-retrait-substituts.js
const assert = require('assert');
const RS = require('./collecte-cartes/retrait-substituts');
const { visuelDuProduit } = require('./exporter-donnees-logos-site');

let ok = 0, ko = 0;
const t = async (nom, f) => { try { await f(); ok++; console.log('  ok  ' + nom); } catch (e) { ko++; console.log('  ECHEC ' + nom + '\n     ' + String(e.message).split('\n')[0]); } };

const FAUX = 'tcgdex/Roaring-Skies/92-203164.webp';
const AUTRE = 'tcgdex/Roaring-Skies/93-203165.webp';
const sub = (cleR2, extra = {}) => ({ cleR2, source: 'tcgdex', set: 'Roaring-Skies', numero: '92', langue: 'en', mention: 'Visuel de la carte d\'origine', preuve: 'p', lot: 'wcd-2026', ...extra });
const LIGNES = () => [
    { _id: 'a', idProduct: 865714, carteId: 1, slugSet: 'WCD-2016', visuelSubstitut: sub(FAUX) },
    { _id: 'b', idProduct: 865715, carteId: 1, slugSet: 'WCD-2016', visuelSubstitut: sub(FAUX) },
    { _id: 'c', idProduct: 867385, carteId: 1, slugSet: 'WCD-2015', visuelSubstitut: sub(FAUX) },
    { _id: 'd', idProduct: 1, carteId: 2, slugSet: 'X', visuelSubstitut: sub(AUTRE) },          // vise une AUTRE clé : intouchable
    { _id: 'e', idProduct: 2, carteId: 3, slugSet: 'X', visuelSubstitut: sub(FAUX + '.bak') },  // clé qui CONTIENT la clé retirée : intouchable
    { _id: 'f', idProduct: 3, carteId: 4, slugSet: 'X' }                                        // sans substitut
];
const IMAGES = () => [{ _id: 1, cleR2: FAUX, etat: 'retire' }, { _id: 2, cleR2: AUTRE, etat: 'ok' }, { _id: 3, cleR2: 'x/y.webp', etat: 'retire' }];

/** Faux db : find (égalité, chemins pointés, $in), updateOne (filtre + $set/$unset), countDocuments. */
function faussebase(init) {
    const donnees = {}; for (const [k, v] of Object.entries(init)) donnees[k] = v.map(x => structuredClone(x));
    const lire = (o, chemin) => chemin.split('.').reduce((a, k) => (a == null ? undefined : a[k]), o);
    const ok1 = (val, cond) => (cond && typeof cond === 'object' && '$in' in cond) ? cond.$in.includes(val) : (cond && typeof cond === 'object' && '$exists' in cond) ? ((val !== undefined) === cond.$exists) : val === cond;
    const corr = (d, f) => Object.entries(f).every(([k, v]) => ok1(lire(d, k), v));
    const col = nom => ({
        find: f => ({ toArray: async () => donnees[nom].filter(d => corr(d, f)).map(d => structuredClone(d)) }),
        countDocuments: async f => donnees[nom].filter(d => corr(d, f)).length,
        updateOne: async (f, u) => {
            const d = donnees[nom].find(x => corr(x, f)); if (!d) return { matchedCount: 0, modifiedCount: 0 };
            for (const [k, v] of Object.entries(u.$set || {})) d[k] = structuredClone(v);
            for (const k of Object.keys(u.$unset || {})) delete d[k];
            return { matchedCount: 1, modifiedCount: 1 };
        }
    });
    return { donnees, collection: col };
}
const LE = new Date('2026-10-17T12:00:00Z');

(async () => {
    await t('ROUGE-VU : une clé retirée est visée par 3 substituts : le plan les nomme (et seulement ceux dont la clé est EXACTEMENT la clé)', async () => {
        const db = faussebase({ cartes_produits: LIGNES(), images: IMAGES() });
        const p = await RS.planPourCles(db, [FAUX]);
        assert.deepStrictEqual(p.map(x => x.idProduct).sort(), [865714, 865715, 867385]);
    });
    await t('détacher : retire visuelSubstitut (mention comprise), pose une trace datée (clé, motif, ancien substitut), ne touche pas aux autres lignes', async () => {
        const db = faussebase({ cartes_produits: LIGNES(), images: IMAGES() });
        const p = await RS.planPourCles(db, [FAUX]);
        const n = await RS.detacher(db, p, { motif: 'image fausse lue : 92a imprimé', le: LE });
        assert.strictEqual(n, 3);
        for (const id of ['a', 'b', 'c']) {
            const l = db.donnees.cartes_produits.find(x => x._id === id);
            assert.strictEqual(l.visuelSubstitut, undefined);
            assert.strictEqual(l.visuelSubstitutRetrait.cleR2, FAUX); assert.strictEqual(l.visuelSubstitutRetrait.motif, 'image fausse lue : 92a imprimé');
            assert.strictEqual(l.visuelSubstitutRetrait.le.getTime(), LE.getTime()); assert.strictEqual(l.visuelSubstitutRetrait.avant.mention, 'Visuel de la carte d\'origine');
        }
        assert.strictEqual(db.donnees.cartes_produits.find(x => x._id === 'd').visuelSubstitut.cleR2, AUTRE);
        assert.strictEqual(db.donnees.cartes_produits.find(x => x._id === 'e').visuelSubstitut.cleR2, FAUX + '.bak');
        assert.strictEqual(db.donnees.cartes_produits.find(x => x._id === 'f').visuelSubstitutRetrait, undefined);
    });
    await t('le filtre d\'écriture reprend la clé : une ligne dont le substitut a changé depuis la simulation n\'est pas touchée', async () => {
        const db = faussebase({ cartes_produits: LIGNES(), images: IMAGES() });
        const p = await RS.planPourCles(db, [FAUX]);
        db.donnees.cartes_produits.find(x => x._id === 'a').visuelSubstitut.cleR2 = AUTRE;
        assert.strictEqual(await RS.detacher(db, p, { motif: 'm'.repeat(12), le: LE }), 2);
        assert.strictEqual(db.donnees.cartes_produits.find(x => x._id === 'a').visuelSubstitut.cleR2, AUTRE);
    });
    await t('mode « déjà retirées » : les clés viennent des documents images à l\'état retire, seulement ; ici 3 lignes', async () => {
        const db = faussebase({ cartes_produits: LIGNES(), images: IMAGES() });
        const cles = await RS.clesDejaRetirees(db);
        assert.deepStrictEqual(cles.sort(), [FAUX, 'x/y.webp'].sort());
        const p = await RS.planPourCles(db, cles);
        assert.strictEqual(p.length, 3);
    });
    await t('une clé qui n\'est visée par personne ne produit rien', async () => {
        const db = faussebase({ cartes_produits: LIGNES(), images: IMAGES() });
        assert.deepStrictEqual(await RS.planPourCles(db, ['nulle/part.webp']), []);
    });
    await t('refus : liste de clés vide ou clé non-chaîne (une garde par ce qu\'elle autorise)', async () => {
        const db = faussebase({ cartes_produits: LIGNES(), images: IMAGES() });
        await assert.rejects(() => RS.planPourCles(db, []), /clé/);
        await assert.rejects(() => RS.planPourCles(db, [null]), /clé/);
    });
    await t('exporteur : sans substitut ni entrée, visuelDuProduit rend null (jamais une autre image du set)', () => {
        const images = [{ set: 'Roaring-Skies', numero: '93', cleR2: AUTRE }];
        assert.strictEqual(visuelDuProduit(images, 'Roaring-Skies', '92'), null);
    });

    console.log(`\n${ok} ok, ${ko} echec(s)`);
    process.exit(ko ? 1 : 0);
})();
