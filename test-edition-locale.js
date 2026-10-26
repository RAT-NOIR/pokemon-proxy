// Banc de poser-edition-locale.js : purs + fausse base, aucune base réelle, aucun réseau. node test-edition-locale.js
const assert = require('assert');
const EL = require('./poser-edition-locale');
const PV = require('./collecte-cartes/preuves');
let n = 0, ko = 0;
const t = async (nom, f) => { try { await f(); n++; console.log('ok  ', nom); } catch (e) { ko++; console.log('FAIL', nom, '-', e.message); } };
const S18 = { _id: 'McDonalds-Collection-2018', idExpansion: [2361], region: 'intl', tirage: 'intl' };
const S19 = { _id: 'McDonalds-Collection-2019-2', idExpansion: [3354], region: 'intl', tirage: 'intl' };

(async () => {
    await t('la table est CELLE de preuves.js (jamais recopiée) : 2361 et 3354 → fr', () => {
        assert.strictEqual(EL.EDITIONS_LOCALES, PV.EDITIONS_LOCALES);
        assert.deepStrictEqual({ ...EL.EDITIONS_LOCALES }, { 2361: 'fr', 3354: 'fr' });
    });
    await t('plan : un set par expansion de la table, editionLocale posée seulement où elle est absente', () => {
        const p = EL.planifier({ sets: [S18, S19, { _id: 'Autre', idExpansion: [5000], tirage: 'intl' }] });
        assert.deepStrictEqual(p.ecrire.map(x => [x._id, x.editionLocale]).sort(), [['McDonalds-Collection-2018', 'fr'], ['McDonalds-Collection-2019-2', 'fr']]);
        assert.deepStrictEqual(p.refus, []); assert.deepStrictEqual(p.deja, []);
    });
    await t('plan : déjà posée à la même valeur = « déjà » ; à une AUTRE valeur = refus (on n\'écrase jamais)', () => {
        const p = EL.planifier({ sets: [{ ...S18, editionLocale: 'fr' }, { ...S19, editionLocale: 'de' }] });
        assert.deepStrictEqual(p.ecrire, []); assert.deepStrictEqual(p.deja.map(x => x._id), ['McDonalds-Collection-2018']);
        assert.strictEqual(p.refus.length, 1); assert.match(p.refus[0].raison, /déjà « de »/);
    });
    await t('plan : expansion sans set, ou portée par deux sets, ou set non occidental → refus nommé, rien posé pour elle', () => {
        const a = EL.planifier({ sets: [S19] }); assert.strictEqual(a.ecrire.length, 1); assert.match(a.refus.map(r => r.raison).join(), /2361.*aucun set/);
        const b = EL.planifier({ sets: [S18, { ...S18, _id: 'Doublon' }, S19] }); assert.deepStrictEqual(b.ecrire.map(x => x._id), ['McDonalds-Collection-2019-2']); assert.match(b.refus.map(r => r.raison).join(), /2361.*2 sets/);
        const c = EL.planifier({ sets: [{ ...S18, tirage: 'jp', region: 'jp' }, S19] }); assert.deepStrictEqual(c.ecrire.map(x => x._id), ['McDonalds-Collection-2019-2']); assert.match(c.refus.map(r => r.raison).join(), /occidental/);
        const d = EL.planifier({ sets: [{ ...S18, idExpansion: 2361 }, S19] }); assert.strictEqual(d.ecrire.length, 2, 'idExpansion scalaire accepté');
    });
    await t('verifierAttendu : obligatoire et égal au plan', () => {
        const p = EL.planifier({ sets: [S18, S19] });
        assert.strictEqual(EL.verifierAttendu(p, 2).ok, true); assert.strictEqual(EL.verifierAttendu(p, 1).ok, false); assert.strictEqual(EL.verifierAttendu(p, NaN).ok, false);
    });
    // fausse base : updateOne gardé par $exists:false, relecture
    const fausseBase = docs => { const d = docs.map(x => JSON.parse(JSON.stringify(x))); return { docs: d, collection: () => ({
        find: q => ({ toArray: async () => d.filter(x => (q._id?.$in ? q._id.$in.includes(x._id) : true)) }),
        updateOne: async (f, u) => { const x = d.find(y => y._id === f._id && (f.editionLocale?.$exists === false ? !('editionLocale' in y) : true)); if (!x) return { modifiedCount: 0 }; Object.assign(x, u.$set); return { modifiedCount: 1 }; },
    }) }; };
    await t('écriture : $set editionLocale seul, gardé par $exists:false ; relu ; aucun autre champ ne bouge', async () => {
        const db = fausseBase([S18, S19]); const p = EL.planifier({ sets: [S18, S19] });
        const r = await EL.ecrire(db, p.ecrire); assert.strictEqual(r.posees, 2);
        const rl = await EL.relire(db, p.ecrire, [S18, S19]); assert.strictEqual(rl.ok, true, JSON.stringify(rl));
        assert.deepStrictEqual(db.docs[0], { ...S18, editionLocale: 'fr' });
        const r2 = await EL.ecrire(db, p.ecrire); assert.strictEqual(r2.posees, 0, 'idempotent : déjà posée = rien');
    });
    await t('ligne de commande : --ecrire hors lot-additif refusé avant toute connexion ; --ecrire sans --attendu refusé ; argument inconnu refusé', async () => {
        let ouvert = 0; const o = async () => { ouvert++; return { cartes: { db: fausseBase([S18, S19]) }, fermer: async () => {} }; };
        const silence = () => {};
        assert.strictEqual(await EL.executer({ argv: ['--ecrire', '--attendu=2'], ouvrirLecture: o, ouvrirEcriture: o, garde: () => { throw new Error('hors lot'); }, log: silence, err: silence }).catch(() => 'leve'), 'leve');
        assert.strictEqual(await EL.executer({ argv: ['--ecrire'], ouvrirLecture: o, ouvrirEcriture: o, garde: () => {}, log: silence, err: silence }), 1);
        assert.strictEqual(await EL.executer({ argv: ['--simuler', '--x'], ouvrirLecture: o, ouvrirEcriture: o, garde: () => {}, log: silence, err: silence }), 2);
        assert.strictEqual(ouvert, 0, 'aucune connexion ouverte sur ces refus');
        assert.strictEqual(await EL.executer({ argv: ['--simuler'], ouvrirLecture: o, ouvrirEcriture: o, garde: () => {}, log: silence, err: silence }), 0);
        assert.strictEqual(await EL.executer({ argv: ['--ecrire', '--attendu=3'], ouvrirLecture: o, ouvrirEcriture: o, garde: () => {}, log: silence, err: silence }), 1, 'attendu faux : rien écrit');
        assert.strictEqual(await EL.executer({ argv: ['--ecrire', '--attendu=2'], ouvrirLecture: o, ouvrirEcriture: o, garde: () => {}, log: silence, err: silence }), 0);
    });
    console.log(`\n${n} ok, ${ko} échec(s)`); process.exit(ko ? 1 : 0);
})();
