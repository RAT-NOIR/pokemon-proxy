'use strict';
const H = require('./_harnais'); const M = require('../modeles'); const L = require('../transport/limites');
(async () => {
    await H.ouvrirBac('test-limites.js'); await M.creerIndex();
    const t0 = new Date('2026-10-08T10:00:00Z');
    let r; for (let i = 1; i <= 3; i++) r = await L.consommer('a', { max: 2, fenetreMs: 3600e3, maintenant: t0 });
    H.v('3e appel sur max 2 : refusé', [r.permis, r.n, r.max], [false, 3, 2]);
    H.v('   reessayerDans = secondes restantes de la fenêtre', r.reessayerDans, 3600);
    const autre = await L.consommer('b', { max: 2, fenetreMs: 3600e3, maintenant: t0 });
    H.v('une autre clé a son propre compteur', autre.permis, true);
    const suiv = await L.consommer('a', { max: 2, fenetreMs: 3600e3, maintenant: new Date('2026-10-08T11:00:01Z') });
    H.v('fenêtre suivante : repart à 1', [suiv.permis, suiv.n], [true, 1]);
    // concurrence : 50 appels simultanés sur max 20 => exactement 20 permis
    const rs = await Promise.all(Array.from({ length: 50 }, () => L.consommer('conc', { max: 20, fenetreMs: 3600e3, maintenant: t0 })));
    H.v('50 appels simultanés, max 20 : permis', rs.filter(x => x.permis).length, 20);
    // middleware
    const req = { ip: '203.0.113.9' }, res = { s: null, j: null, h: {}, setHeader(k, v) { this.h[k] = v; }, status(x) { this.s = x; return this; }, json(o) { this.j = o; return this; } };
    const mw = L.limiteur({ nom: 'x', max: 1, fenetreMs: 60e3, cle: q => `x:${L.empreinteIp(q.ip)}` });
    let passe = 0; await mw(req, res, () => passe++); await mw(req, res, () => passe++);
    H.v('middleware : un passage, puis 429 DEBIT', [passe, res.s, res.j && res.j.erreur.code], [1, 429, 'DEBIT']);
    H.vrai('   Retry-After posé', Number(res.h['Retry-After']) > 0);
    H.vrai('   l\'IP n\'est jamais stockée en clair', !JSON.stringify(await require('../db').col('limites').find().toArray()).includes('203.0.113.9'));
    // fail-closed : une clé null (non identifiable) est REFUSÉE, pas laissée passer
    const res2 = { s: null, j: null, status(x) { this.s = x; return this; }, json(o) { this.j = o; return this; }, setHeader() {} };
    let p2 = 0; await L.limiteur({ nom: 'y', max: 5, fenetreMs: 60e3, cle: () => null })({ ip: '1.1.1.1' }, res2, () => p2++);
    H.v('clé non calculable => refus fermé (pas de passage)', [p2, res2.s], [0, 503]);
    await H.fermerBac(); H.bilan();
})().catch(e => { console.error('❌', e); process.exit(1); });
