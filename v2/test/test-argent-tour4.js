'use strict';
// B3 tour 4/5 : (1) une clé rejouée dont la ligne est rendu-en-cours / rendu-echoue n'est NI rejouée NI redébitée ; (2) ces états n'expirent pas ; (3) annulerUnite prend la ligne atomiquement.
// OFFRE-QUOTA (2026-10-13) : la poche débitée est le compteur du jour (`quota_jour`) ; un « solde de N » est un quota du jour de 1000 dont 1000 - N sont déjà pris (voir _aide-quota.js).
const H = require('./_harnais'); const db = require('../db'); const M = require('../modeles'); const Lg = require('../argent/ledger'); const L = require('../argent/lot');
const { compte } = require('./_aide-argent'); const Q = require('./_aide-quota');
const cfg = Q.cfgGrand({ V2_HEBDO: '0' });
const t = new Date('2026-10-08T10:00:00Z'), JOUR = '2026-10-08';
const restant = p => Q.restantDe(p, cfg, t);
const compteN = async n => { const p = await compte(); await Q.poserRestant(`compte:${p.id}`, n, { jour: JOUR }); return p; };
const prise = (p, n = 1) => db.col('quota_jour').updateOne({ porteur: `compte:${p.id}`, jour: JOUR }, { $inc: { count: n } });
const ligne = cle => db.col('mouvements').findOne({ cleIdempotence: cle });
const muet = async f => { const e0 = console.error; console.error = () => { }; try { return await f(); } finally { console.error = e0; } };
(async () => {
    await H.ouvrirBac('test-argent-tour4.js'); await M.creerIndex();
    // 1. rejeu d'une clé dont la ligne est rendu-en-cours / rendu-echoue : refusé, ni rejoué (scan gratuit) ni redébité
    for (const etat of ['rendu-en-cours', 'rendu-echoue']) {
        const p = await compteN(3);
        await Lg.debiter(p, { scanId: 's1', cleIdempotence: `k1${etat}`, maintenant: t }, cfg);                       // restant 2
        await db.col('mouvements').updateOne({ cleIdempotence: `k1${etat}` }, { $set: { etat } });
        await prise(p, -1);                                                                                         // le crédit a été rendu, l'état n'a pas suivi
        const nMv = await db.col('mouvements').countDocuments({ compteId: p.id });
        const r = await muet(() => Lg.debiter(p, { scanId: 's1', cleIdempotence: `k1${etat}`, maintenant: t }, cfg));
        H.v(`(1) rejeu d'une ligne « ${etat} » : refusé EN_RECONCILIATION, pas de scan gratuit`, [r.ok, r.code, r.rejoue ?? null], [false, 'EN_RECONCILIATION', null]);
        H.v('   aucun crédit touché, aucun mouvement de plus, la ligne garde son état', [await restant(p), await db.col('mouvements').countDocuments({ compteId: p.id }), (await ligne(`k1${etat}`)).etat], [3, nMv, etat]);
    }
    // 1 bis. la même garde sur la chaîne de ré-essai (la dernière ligne du maillon est rendu-en-cours)
    const pb = await compteN(3);
    const d0 = await Lg.debiter(pb, { scanId: 's2', cleIdempotence: 'k2', maintenant: t }, cfg);
    await Lg.rembourserLigne(pb, d0.cle, 'panne', { maintenant: t }, cfg);
    const d1 = await Lg.debiter(pb, { scanId: 's2', cleIdempotence: 'k2', maintenant: t }, cfg);
    await db.col('mouvements').updateOne({ cleIdempotence: d1.cle }, { $set: { etat: 'rendu-en-cours' } });
    const soldeB = await restant(pb);
    const rb = await muet(() => Lg.debiter(pb, { scanId: 's2', cleIdempotence: 'k2', maintenant: t }, cfg));
    H.v('(1 bis) chaîne de ré-essai dont le dernier maillon est rendu-en-cours : refusé, restant intact', [d1.reessaye, rb.ok, rb.code, await restant(pb)], [true, false, 'EN_RECONCILIATION', soldeB]);
    // 2. rendu-en-cours / rendu-echoue n'expirent pas
    const p2 = await compteN(3);
    const d2 = await Lg.debiter(p2, { scanId: 's3', cleIdempotence: 'k3', maintenant: t }, cfg);
    H.v('(2) préalable : la ligne de débit porte expireLe', (await ligne(d2.cle)).expireLe instanceof Date, true);
    const col0 = db.col; db.col = n => (n === 'quota_jour' ? { updateOne: async () => { throw new Error('panne simulée'); } } : col0(n));
    try { await muet(() => Lg.rembourserLigne(p2, d2.cle, 'panne', { maintenant: t }, cfg)); } finally { db.col = col0; }
    let l2 = await ligne(d2.cle);
    H.v('   rendu échoué : état rendu-echoue et PLUS d\'expireLe', [l2.etat, 'expireLe' in l2], ['rendu-echoue', false]);
    const p2b = await compteN(3);
    const d2b = await Lg.debiter(p2b, { scanId: 's3b', cleIdempotence: 'k3b', maintenant: t }, cfg);
    const col1 = db.col; db.col = n => (n === 'quota_jour' ? { updateOne: async () => { throw new Error('panne simulée'); } } : n === 'mouvements' ? new Proxy(col1(n), { get: (c, k) => k === 'updateOne' ? async () => { throw new Error('panne 2'); } : c[k].bind(c) }) : col1(n));
    try { await muet(() => Lg.rembourserLigne(p2b, d2b.cle, 'panne', { maintenant: t }, cfg)); } finally { db.col = col1; }
    const l2b = await ligne(d2b.cle);
    H.v('   double panne : rendu-en-cours et PLUS d\'expireLe', [l2b.etat, 'expireLe' in l2b], ['rendu-en-cours', false]);
    // la reprise d'une ligne rendu-echoue (rendreLeScan) la clôt ET lui redonne une expiration
    const rr = await Lg.rembourser(p2, d2.credit, 'reprise', { scanId: 's3', sansPlafond: true, maintenant: t }, cfg);
    l2 = await ligne(d2.cle);
    H.v('   reprise d\'un rendu-echoue : rendue, ligne rembourse, expireLe rétabli', [rr.rendu, l2.etat, l2.expireLe instanceof Date], [true, 'rembourse', true]);
    const p2c = await compteN(3);
    const d2c = await Lg.debiter(p2c, { scanId: 's3c', cleIdempotence: 'k3c', maintenant: t }, cfg);
    await Lg.rembourserLigne(p2c, d2c.cle, 'panne', { maintenant: t }, cfg);
    H.v('   chemin normal rembourserLigne : rembourse avec expireLe', [(await ligne(d2c.cle)).etat, (await ligne(d2c.cle)).expireLe instanceof Date], ['rembourse', true]);
    // 3. annulerUnite : prise atomique — une unité passée en rendu-en-cours entre-temps n'est pas rendue une 2e fois
    // (le compteur du jour ne refuse pas par un résultat nul : le débit prend d'abord le jeton, puis le rend s'il dépasse — le crochet reconnaît donc le dépassement à la valeur rendue)
    const p3 = await compteN(1);
    const col3 = db.col; let appels = 0;
    db.col = n => n !== 'quota_jour' ? col3(n) : new Proxy(col3(n), { get: (c, k) => k === 'findOneAndUpdate' ? async (...a) => {
        const r = await c.findOneAndUpdate(...a);
        if (r && r.count > Q.GRAND && await col3('mouvements').countDocuments({ cleIdempotence: 'sup#0' })) await col3('mouvements').updateOne({ cleIdempotence: 'sup#0' }, { $set: { etat: 'rendu-en-cours' } });   // le 2e essai (unité 1) dépasse : juste avant l'annulation, un autre chemin prend l'unité 0
        return r; } : c[k].bind(c) });
    let r3; try { r3 = await muet(() => L.debiterSupplement(p3, { scanId: 's4', unites: 2, cleIdempotence: 'sup', maintenant: t }, cfg)); } finally { db.col = col3; }
    H.v('(3) supplément refusé (QUOTA) alors que l\'unité 0 est déjà prise par un autre chemin', [r3.ok, r3.code], [false, 'QUOTA']);
    H.v('   unité 0 NON rendue une 2e fois : restant 0, aucune trace supplement-annule, ligne rendu-en-cours', [await restant(p3), await db.col('mouvements').countDocuments({ compteId: p3.id, motif: 'supplement-annule' }), (await db.col('mouvements').findOne({ compteId: p3.id, scanId: 's4', type: 'debit' })).etat], [0, 0, 'rendu-en-cours']);
    // 3 bis. chemin normal conservé : annulation propre, expireLe sans objet (clé libérée)
    const p3b = await compteN(1);
    const r3b = await L.debiterSupplement(p3b, { scanId: 's5', unites: 2, cleIdempotence: 'sup2', maintenant: t }, cfg);
    H.v('(3 bis) annulation normale : crédit rendu une fois, trace +1, clé libérée', [r3b.ok, await restant(p3b), await db.col('mouvements').countDocuments({ compteId: p3b.id, motif: 'supplement-annule' }), await ligne('sup2#0')], [false, 1, 1, null]);
    // 3 ter. annulerUnite dont le rendu échoue : rendu-echoue AVEC raisonRendu (comme rembourserLigne)
    const p3c = await compteN(1);
    const col4 = db.col;
    db.col = n => n !== 'quota_jour' ? col4(n) : new Proxy(col4(n), { get: (c, k) => k === 'findOneAndUpdate' ? async (...a) => {
        const r = await c.findOneAndUpdate(...a);
        if (r && r.count > Q.GRAND && await col4('mouvements').countDocuments({ cleIdempotence: 'sup3#0' })) await col4('quota_jour').updateOne({ porteur: `compte:${p3c.id}`, jour: JOUR }, { $set: { count: 0 } });   // le compteur est remis à zéro avant le rendu : il n'y a plus rien à rendre
        return r; } : c[k].bind(c) });
    try { await muet(() => L.debiterSupplement(p3c, { scanId: 's6', unites: 2, cleIdempotence: 'sup3', maintenant: t }, cfg)); } finally { db.col = col4; }
    const l3c = await db.col('mouvements').findOne({ compteId: p3c.id, scanId: 's6', type: 'debit' });
    H.v('(3 ter) annulerUnite non rendue : rendu-echoue + raisonRendu, sans expireLe', [l3c.etat, l3c.raisonRendu, 'expireLe' in l3c], ['rendu-echoue', 'poche-introuvable', false]);
    // 4. EN_RECONCILIATION dans le registre : 409, message stable, ni 500 ni QUOTA, aucun crédit ni remboursement associé
    const { CODES, MESSAGES, repondreErreur } = require('../erreurs');
    const p4 = await compteN(3);
    await Lg.debiter(p4, { scanId: 's7', cleIdempotence: 'k7', maintenant: t }, cfg);
    await db.col('mouvements').updateOne({ cleIdempotence: 'k7' }, { $set: { etat: 'rendu-en-cours' } });
    const r4 = await muet(() => Lg.debiter(p4, { scanId: 's7', cleIdempotence: 'k7', maintenant: t }, cfg));
    let statut4 = null, corps4 = null;
    const res4 = { status(s) { statut4 = s; return this; }, json(c) { corps4 = c; return this; }, setHeader() { } };
    let leve4 = null; try { repondreErreur(res4, r4.code, (MESSAGES || {})[r4.code], {}); } catch (e) { leve4 = e.message; }
    H.v('(4) registre : EN_RECONCILIATION -> 409, accepté par repondreErreur', [CODES.EN_RECONCILIATION, leve4], [409, null]);
    H.v('   message stable, success:false, code EN_RECONCILIATION, ni solde ni achat ni offre ni facturation', [statut4, corps4 && corps4.erreur.code, corps4 && corps4.erreur.message, corps4 && corps4.success, corps4 && corps4.facturation, corps4 && ('solde' in corps4 || 'achat' in corps4 || 'offre' in corps4)],
        [409, 'EN_RECONCILIATION', 'paiement en cours de réconciliation, réessayer plus tard', false, null, false]);
    H.v('   ni 500 ni QUOTA (429)', [statut4 !== null && statut4 !== 500, statut4 !== 429, r4.code !== 'QUOTA'], [true, true, true]);
    await H.fermerBac(); H.bilan();
})().catch(e => { console.error('❌', e); process.exit(1); });
