// Banc de poser-marqueurs-jumbo.js : purs + fausse base, aucune base réelle, aucun réseau. node test-marqueurs-jumbo.js
const assert = require('assert');
const M = require('./poser-marqueurs-jumbo');
let n = 0, ko = 0;
const t = async (nom, f) => { try { await f(); n++; console.log('ok  ', nom); } catch (e) { ko++; console.log('FAIL', nom, '-', e.message); } };
const ETQ = (idProduct, ocr = ['Attention:', 'Oversized Card', 'Not Tournament Legal'], classe = 'jumbo') => ({ idProduct, classe, ocr });
const L = (idProduct, extra = {}) => ({ _id: `l${idProduct}`, idProduct, carteId: idProduct * 10, slugSet: 'SWSH-Black-Star-Promos', ...extra });
const ATTENDU = [{ type: 'JUMBO', params: {} }, { type: 'NON_LEGAL', params: {} }];
const plan = (o = {}) => M.planifier({ etiquettes: [ETQ(1)], lignes: [L(1)], exportIds: new Set([1]), tcgdexJumbo: new Set(), releveLe: '2026-10-17', ...o });

(async () => {
    await t('une étiquette « Oversized Card » + « Not Tournament Legal », une ligne sans variante → JUMBO puis NON_LEGAL, dans l\'ordre du contrat, et une preuve', () => {
        const p = plan();
        assert.strictEqual(p.ecrire.length, 1);
        assert.deepStrictEqual(p.ecrire[0].marqueurs, ATTENDU);
        assert.match(p.ecrire[0].marqueursPreuve, /Oversized Card/); assert.match(p.ecrire[0].marqueursPreuve, /2026-10-17/);
        assert.strictEqual(p.ecrire[0]._id, 'l1');
    });
    await t('le témoin TCGdex, quand il désigne le MÊME idProduct, est cité dans la preuve ; son absence ne bloque pas', () => {
        assert.match(plan({ tcgdexJumbo: new Set([1]) }).ecrire[0].marqueursPreuve, /TCGdex/);
        assert.doesNotMatch(plan().ecrire[0].marqueursPreuve, /TCGdex/);
    });
    await t('une étiquette dont l\'OCR ne lit pas « Oversized Card » n\'est pas une jumbo (classe seule insuffisante) ; sans « Not Tournament Legal » : JUMBO seul', () => {
        assert.strictEqual(plan({ etiquettes: [ETQ(1, ['Attention:', 'Not Tournament Legal'])] }).ecrire.length, 0);
        assert.deepStrictEqual(plan({ etiquettes: [ETQ(1, ['Attention:', 'Oversized Card'])] }).ecrire[0].marqueurs, [{ type: 'JUMBO', params: {} }]);
        assert.strictEqual(plan({ etiquettes: [ETQ(1, ['Oversized Card', 'Not Tournament Legal'], 'staff')] }).ecrire.length, 0, 'une autre classe ne compte pas');
    });
    await t('produit absent de l\'export du jour, ou sans ligne, ou à plusieurs lignes → refus nommé, rien posé', () => {
        assert.match(plan({ exportIds: new Set() }).refus[0].raison, /export/);
        assert.match(plan({ lignes: [] }).refus[0].raison, /aucune ligne/);
        assert.match(plan({ lignes: [L(1), { ...L(1), _id: 'l1b' }] }).refus[0].raison, /2 lignes/);
        for (const o of [{ exportIds: new Set() }, { lignes: [] }]) assert.strictEqual(plan(o).ecrire.length, 0);
    });
    await t('une variante autre que « jumbo » contredit l\'étiquette → refus (0 faux) ; « jumbo » prouvée concorde', () => {
        assert.match(plan({ lignes: [L(1, { variante: 'normale' })] }).refus[0].raison, /variante « normale »/);
        assert.strictEqual(plan({ lignes: [L(1, { variante: 'jumbo', variantePreuve: 'x' })] }).ecrire.length, 1);
    });
    await t('marqueurs déjà présents : identiques → « déjà » ; différents, ou null → refus (on n\'écrase jamais, même du vide)', () => {
        assert.strictEqual(plan({ lignes: [L(1, { marqueurs: ATTENDU })] }).deja.length, 1);
        assert.match(plan({ lignes: [L(1, { marqueurs: [] })] }).refus[0].raison, /déjà/);
        assert.match(plan({ lignes: [L(1, { marqueurs: null })] }).refus[0].raison, /déjà/);
    });
    await t('verifierAttendu : obligatoire et égal au plan', () => {
        const p = plan();
        assert.strictEqual(M.verifierAttendu(p, 1).ok, true); assert.strictEqual(M.verifierAttendu(p, 2).ok, false); assert.strictEqual(M.verifierAttendu(p, NaN).ok, false);
    });
    const fausseBase = docs => { const d = docs.map(x => JSON.parse(JSON.stringify(x))); return { docs: d, collection: () => ({
        find: q => ({ toArray: async () => d.filter(x => (q?._id?.$in ? q._id.$in.includes(x._id) : q?.idProduct?.$in ? q.idProduct.$in.includes(x.idProduct) : true)) }),
        updateOne: async (f, u) => { const x = d.find(y => y._id === f._id && (f.marqueurs?.$exists === false ? !('marqueurs' in y) : true)); if (!x) return { modifiedCount: 0 }; Object.assign(x, u.$set); return { modifiedCount: 1 }; },
    }) }; };
    await t('écriture : $set marqueurs + marqueursPreuve seuls, gardés par $exists:false ; relu ; idempotent', async () => {
        const db = fausseBase([L(1)]); const p = plan();
        assert.strictEqual((await M.ecrire(db, p.ecrire)).posees, 1);
        const rl = await M.relire(db, p.ecrire, [L(1)]); assert.strictEqual(rl.ok, true, JSON.stringify(rl));
        assert.deepStrictEqual(db.docs[0], { ...L(1), marqueurs: ATTENDU, marqueursPreuve: p.ecrire[0].marqueursPreuve });
        assert.strictEqual((await M.ecrire(db, p.ecrire)).posees, 0);
    });
    await t('relecture : un AUTRE champ modifié est détecté', async () => {
        const db = fausseBase([L(1)]); const p = plan();
        await M.ecrire(db, p.ecrire); db.docs[0].slugSet = 'autre';
        const rl = await M.relire(db, p.ecrire, [L(1)]); assert.strictEqual(rl.ok, false); assert.deepStrictEqual(rl.alteres, ['l1']);
    });
    await t('ligne de commande : --ecrire hors lot refusé avant connexion ; sans --attendu refusé ; argument inconnu refusé ; refus au plan ARRÊTE l\'écriture', async () => {
        const silence = () => {}; let ouvert = 0;
        const donnees = { etiquettes: [ETQ(1), ETQ(2)], exportIds: new Set([1, 2]), tcgdexJumbo: new Set(), releveLe: '2026-10-17' };
        const db = fausseBase([L(1)]);
        const o = async () => { ouvert++; return { cartes: { db }, fermer: async () => {} }; };
        const run = (argv, garde = () => {}) => M.executer({ argv, ouvrirLecture: o, ouvrirEcriture: o, garde, donnees, log: silence, err: silence });
        assert.strictEqual(await run(['--ecrire', '--attendu=1'], () => { throw new Error('hors lot'); }).catch(() => 'leve'), 'leve');
        assert.strictEqual(await run(['--ecrire']), 1);
        assert.strictEqual(await run(['--simuler', '--x']), 2);
        assert.strictEqual(ouvert, 0, 'aucune connexion sur ces refus');
        assert.strictEqual(await run(['--simuler']), 0);
        assert.strictEqual(await run(['--ecrire', '--attendu=1']), 1, 'produit 2 sans ligne : refus au plan NON annoncé, rien écrit');
        assert.strictEqual(await run(['--ecrire', '--attendu=1', '--refus=0']), 1, 'refus annoncé faux : rien écrit');
        assert.deepStrictEqual(db.docs, [L(1)]);
        assert.strictEqual(await run(['--ecrire', '--attendu=1', '--refus=1']), 0, 'refus annoncé = refus du plan : la ligne prouvée s\'écrit');
        assert.deepStrictEqual(db.docs[0].marqueurs, ATTENDU);
    });
    console.log(`\n${n} ok, ${ko} échec(s)`); process.exit(ko ? 1 : 0);
})();
