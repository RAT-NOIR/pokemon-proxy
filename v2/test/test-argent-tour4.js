'use strict';
// B3 tour 4/5 : (1) une clé rejouée dont la ligne est rendu-en-cours / rendu-echoue n'est NI rejouée NI redébitée ; (2) ces états n'expirent pas ; (3) annulerUnite prend la ligne atomiquement.
const H = require('./_harnais'); const db = require('../db'); const M = require('../modeles'); const { lireConfig } = require('../config'); const Lg = require('../argent/ledger'); const L = require('../argent/lot');
const { compte, lire } = require('./_aide-argent');
const cfg = lireConfig({ MONGODB_BASE: 'test_scratch', V2_HEBDO: '0' });
const t = new Date('2026-10-08T10:00:00Z');
const ligne = cle => db.col('mouvements').findOne({ cleIdempotence: cle });
const muet = async f => { const e0 = console.error; console.error = () => { }; try { return await f(); } finally { console.error = e0; } };
(async () => {
    await H.ouvrirBac('test-argent-tour4.js'); await M.creerIndex();
    // 1. rejeu d'une clé dont la ligne est rendu-en-cours / rendu-echoue : refusé, ni rejoué (scan gratuit) ni redébité
    for (const etat of ['rendu-en-cours', 'rendu-echoue']) {
        const p = await compte({ solde: { accueil: 0, achete: 3 } });
        await Lg.debiter(p, { scanId: 's1', cleIdempotence: `k1${etat}`, maintenant: t }, cfg);                       // solde 2
        await db.col('mouvements').updateOne({ cleIdempotence: `k1${etat}` }, { $set: { etat } });
        await db.col('comptes').updateOne({ _id: p.id }, { $inc: { 'solde.achete': 1 } });                      // le crédit a été rendu, l'état n'a pas suivi
        const nMv = await db.col('mouvements').countDocuments({ compteId: p.id });
        const r = await muet(() => Lg.debiter(p, { scanId: 's1', cleIdempotence: `k1${etat}`, maintenant: t }, cfg));
        H.v(`(1) rejeu d'une ligne « ${etat} » : refusé EN_RECONCILIATION, pas de scan gratuit`, [r.ok, r.code, r.rejoue ?? null], [false, 'EN_RECONCILIATION', null]);
        H.v('   aucun crédit touché, aucun mouvement de plus, la ligne garde son état', [(await lire(p)).solde.achete, await db.col('mouvements').countDocuments({ compteId: p.id }), (await ligne(`k1${etat}`)).etat], [3, nMv, etat]);
    }
    // 1 bis. la même garde sur la chaîne de ré-essai (la dernière ligne du maillon est rendu-en-cours)
    const pb = await compte({ solde: { accueil: 0, achete: 3 } });
    const d0 = await Lg.debiter(pb, { scanId: 's2', cleIdempotence: 'k2', maintenant: t }, cfg);
    await Lg.rembourserLigne(pb, d0.cle, 'panne', { maintenant: t }, cfg);
    const d1 = await Lg.debiter(pb, { scanId: 's2', cleIdempotence: 'k2', maintenant: t }, cfg);
    await db.col('mouvements').updateOne({ cleIdempotence: d1.cle }, { $set: { etat: 'rendu-en-cours' } });
    const soldeB = (await lire(pb)).solde.achete;
    const rb = await muet(() => Lg.debiter(pb, { scanId: 's2', cleIdempotence: 'k2', maintenant: t }, cfg));
    H.v('(1 bis) chaîne de ré-essai dont le dernier maillon est rendu-en-cours : refusé, solde intact', [d1.reessaye, rb.ok, rb.code, (await lire(pb)).solde.achete], [true, false, 'EN_RECONCILIATION', soldeB]);
    // 2. rendu-en-cours / rendu-echoue n'expirent pas
    const p2 = await compte({ solde: { accueil: 0, achete: 3 } });
    const d2 = await Lg.debiter(p2, { scanId: 's3', cleIdempotence: 'k3', maintenant: t }, cfg);
    H.v('(2) préalable : la ligne de débit porte expireLe', (await ligne(d2.cle)).expireLe instanceof Date, true);
    const col0 = db.col; db.col = n => (n === 'comptes' ? { updateOne: async () => { throw new Error('panne simulée'); } } : col0(n));
    try { await muet(() => Lg.rembourserLigne(p2, d2.cle, 'panne', { maintenant: t }, cfg)); } finally { db.col = col0; }
    let l2 = await ligne(d2.cle);
    H.v('   rendu échoué : état rendu-echoue et PLUS d\'expireLe', [l2.etat, 'expireLe' in l2], ['rendu-echoue', false]);
    const p2b = await compte({ solde: { accueil: 0, achete: 3 } });
    const d2b = await Lg.debiter(p2b, { scanId: 's3b', cleIdempotence: 'k3b', maintenant: t }, cfg);
    const col1 = db.col; db.col = n => (n === 'comptes' ? { updateOne: async () => { throw new Error('panne simulée'); } } : n === 'mouvements' ? new Proxy(col1(n), { get: (c, k) => k === 'updateOne' ? async () => { throw new Error('panne 2'); } : c[k].bind(c) }) : col1(n));
    try { await muet(() => Lg.rembourserLigne(p2b, d2b.cle, 'panne', { maintenant: t }, cfg)); } finally { db.col = col1; }
    const l2b = await ligne(d2b.cle);
    H.v('   double panne : rendu-en-cours et PLUS d\'expireLe', [l2b.etat, 'expireLe' in l2b], ['rendu-en-cours', false]);
    // la reprise d'une ligne rendu-echoue (rendreLeScan) la clôt ET lui redonne une expiration
    const rr = await Lg.rembourser(p2, d2.credit, 'reprise', { scanId: 's3', sansPlafond: true, maintenant: t }, cfg);
    l2 = await ligne(d2.cle);
    H.v('   reprise d\'un rendu-echoue : rendue, ligne rembourse, expireLe rétabli', [rr.rendu, l2.etat, l2.expireLe instanceof Date], [true, 'rembourse', true]);
    const p2c = await compte({ solde: { accueil: 0, achete: 3 } });
    const d2c = await Lg.debiter(p2c, { scanId: 's3c', cleIdempotence: 'k3c', maintenant: t }, cfg);
    await Lg.rembourserLigne(p2c, d2c.cle, 'panne', { maintenant: t }, cfg);
    H.v('   chemin normal rembourserLigne : rembourse avec expireLe', [(await ligne(d2c.cle)).etat, (await ligne(d2c.cle)).expireLe instanceof Date], ['rembourse', true]);
    // 3. annulerUnite : prise atomique — une unité passée en rendu-en-cours entre-temps n'est pas rendue une 2e fois
    const p3 = await compte({ solde: { accueil: 0, achete: 1 } });
    const col3 = db.col; let appels = 0;
    db.col = n => n !== 'comptes' ? col3(n) : new Proxy(col3(n), { get: (c, k) => k === 'findOneAndUpdate' ? async (...a) => {
        const r = await c.findOneAndUpdate(...a);
        if (!r && await col3('mouvements').countDocuments({ cleIdempotence: 'sup#0' })) await col3('mouvements').updateOne({ cleIdempotence: 'sup#0' }, { $set: { etat: 'rendu-en-cours' } });   // le 2e essai (unité 1) échoue : juste avant l'annulation, un autre chemin prend l'unité 0
        return r; } : c[k].bind(c) });
    let r3; try { r3 = await muet(() => L.debiterSupplement(p3, { scanId: 's4', unites: 2, cleIdempotence: 'sup', maintenant: t }, cfg)); } finally { db.col = col3; }
    H.v('(3) supplément refusé (QUOTA) alors que l\'unité 0 est déjà prise par un autre chemin', [r3.ok, r3.code], [false, 'QUOTA']);
    H.v('   unité 0 NON rendue une 2e fois : solde 0, aucune trace supplement-annule, ligne rendu-en-cours', [(await lire(p3)).solde.achete, await db.col('mouvements').countDocuments({ compteId: p3.id, motif: 'supplement-annule' }), (await db.col('mouvements').findOne({ compteId: p3.id, scanId: 's4', type: 'debit' })).etat], [0, 0, 'rendu-en-cours']);
    // 3 bis. chemin normal conservé : annulation propre, expireLe sans objet (clé libérée)
    const p3b = await compte({ solde: { accueil: 0, achete: 1 } });
    const r3b = await L.debiterSupplement(p3b, { scanId: 's5', unites: 2, cleIdempotence: 'sup2', maintenant: t }, cfg);
    H.v('(3 bis) annulation normale : crédit rendu une fois, trace +1, clé libérée', [r3b.ok, (await lire(p3b)).solde.achete, await db.col('mouvements').countDocuments({ compteId: p3b.id, motif: 'supplement-annule' }), await ligne('sup2#0')], [false, 1, 1, null]);
    await H.fermerBac(); H.bilan();
})().catch(e => { console.error('❌', e); process.exit(1); });
