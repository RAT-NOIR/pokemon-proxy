// BANC — ping-guide.js : la fraîcheur du guide des prix dans /ping. Pure : lecture injectée, horloge injectée. Jamais d'exception, jamais plus
// de `delaiMs` d'attente, repli explicite « inconnue ».
//   node test-ping-guide.js
const assert = require('assert');
const PG = require('./ping-guide');
let ok = 0, ko = 0;
const t = async (nom, f) => { try { await f(); ok++; console.log(`✅ ${nom}`); } catch (e) { ko++; console.log(`🔴 ${nom} : ${e.message}`); } };
const a = iso => new Date(iso);
const maintenant = () => a('2026-10-18T12:00:00Z');

(async () => {
    await t('guide de 10 h : à jour, date ISO et âge', async () => {
        const r = await PG.etatGuide({ lire: async () => a('2026-10-18T02:00:00Z'), maintenant, cache: null });
        assert.deepEqual(r, { guideDu: '2026-10-18T02:00:00.000Z', guideAgeHeures: 10, guideAJour: true });
    });
    await t('guide de 36 h pile : encore à jour ; de 36,5 h : guideAJour false', async () => {
        assert.equal((await PG.etatGuide({ lire: async () => a('2026-10-17T00:00:00Z'), maintenant, cache: null })).guideAJour, true);
        const r = await PG.etatGuide({ lire: async () => a('2026-10-16T23:30:00Z'), maintenant, cache: null });
        assert.equal(r.guideAJour, false); assert.equal(r.guideAgeHeures, 36.5);
    });
    await t('lecture qui lève : repli inconnue, jamais d\'exception', async () => {
        const r = await PG.etatGuide({ lire: async () => { throw new Error('boum mongodb://u:p@h'); }, maintenant, cache: null });
        assert.deepEqual(r, { guideDu: null, guideAgeHeures: null, guideAJour: null });
    });
    await t('lecture qui ne répond pas : abandonnée au délai', async () => {
        const t0 = Date.now();
        const r = await PG.etatGuide({ lire: () => new Promise(() => { }), maintenant, delaiMs: 50, cache: null });
        assert.equal(r.guideAJour, null); assert.ok(Date.now() - t0 < 1000);
    });
    await t('pas de méta, ou date illisible : inconnue', async () => {
        for (const v of [null, undefined, 'n\'importe quoi', new Date('x')]) assert.equal((await PG.etatGuide({ lire: async () => v, maintenant, cache: null })).guideAJour, null);
    });
    await t('cache : deux appels rapprochés = une seule lecture ; une erreur n\'est pas gardée longtemps', async () => {
        const cache = {}; let n = 0;
        const lire = async () => { n++; return a('2026-10-18T02:00:00Z'); };
        await PG.etatGuide({ lire, maintenant, cache }); await PG.etatGuide({ lire, maintenant, cache });
        assert.equal(n, 1);
        const c2 = {}; let m = 0;
        const bad = async () => { m++; throw new Error('x'); };
        await PG.etatGuide({ lire: bad, maintenant, cache: c2 }); await PG.etatGuide({ lire: bad, maintenant, cache: c2 });
        assert.equal(m, 1, 'l\'échec est mémorisé brièvement : pas de martèlement de la base par le keep-alive');
    });
    await t('lectures simultanées : une seule lecture en vol', async () => {
        const cache = {}; let n = 0;
        const lire = () => new Promise(r => { n++; setTimeout(() => r(a('2026-10-18T02:00:00Z')), 30); });
        await Promise.all([1, 2, 3].map(() => PG.etatGuide({ lire, maintenant, cache })));
        assert.equal(n, 1);
    });
    console.log(`\n${ok} passés, ${ko} en échec`);
    process.exit(ko ? 1 : 0);
})();
