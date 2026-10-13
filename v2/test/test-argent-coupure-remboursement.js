'use strict';
// MOYENS-B2a — L'ORDRE DU REMBOURSEMENT DANS LE GRAND LIVRE. Banc de COUPURE : un arrêt du processus simulé ENTRE deux écritures de `rendreLeScan`.
// Avant ce lot, la prise atomique d'un débit l'écrivait « rembourse » AVANT de rendre le crédit : un arrêt juste après laissait un débit « rembourse » sans crédit rendu, que rien ne listait
// avant 60 min (et que `creditsManquants` / la réconciliation lisaient comme « rendu »). Désormais la prise écrit « rendu-en-cours » (état que la réconciliation LISTE aussitôt), le crédit est rendu,
// la trace (delta +1) est écrite, PUIS seulement la ligne passe « rembourse ».
// « Arrêt » = dès que le déclencheur est atteint, TOUTE opération suivante sur la base échoue (le processus est mort : ni compensation, ni libération, ni état restitué).
const H = require('./_harnais'); const db = require('../db'); const M = require('../modeles'); const { lireConfig } = require('../config');
const Lg = require('../argent/ledger'); const R = require('../argent/reconcilier');
const { inst, lire } = require('./_aide-argent');
const cfg = lireConfig({ MONGODB_BASE: 'test_scratch', V2_HEBDO: '0' });
const t = new Date('2026-10-08T10:00:00Z');
const muet = async f => { const e0 = console.error; console.error = () => { }; try { return await f(); } finally { console.error = e0; } };
// installe l'arrêt : `declencheur(nom, methode, args)` vrai => le processus « meurt » sur CET appel (il échoue) et tout appel ultérieur échoue aussi
function armerArret(declencheur) {
    const orig = db.col; const etat = { mort: false, au: null };
    db.col = nom => new Proxy(orig(nom), { get(c, p) {
        const v = c[p]; if (typeof v !== 'function') return v;
        return (...a) => {   // synchrone : `find()` rend un curseur, pas une promesse
            if (!etat.mort && declencheur(nom, p, a)) { etat.mort = true; etat.au = `${nom}.${p}`; }
            if (etat.mort) return Promise.reject(new Error('arrêt simulé'));
            return v.apply(c, a);
        };
    } });
    return { etat, relever: () => { db.col = orig; } };
}
const neuf = async scanId => { const p = await inst({ essais: 3 }); await db.col('installations').updateOne({ _id: p.id }, { $set: { essaisInitiaux: 3 } });
    const d = await Lg.debiter(p, { scanId, cleIdempotence: `k-${scanId}`, maintenant: t }, cfg); return { p, d }; };
const debitDe = async scanId => db.col('mouvements').findOne({ scanId, type: 'debit' });
const mouvementsPlus = async scanId => db.col('mouvements').countDocuments({ scanId, type: 'remboursement', delta: 1 });

(async () => {
    await H.ouvrirBac('test-argent-coupure-remboursement.js'); await M.creerIndex();
    const recon = p => R.reconcilier(p, { cfg, maintenant: t });

    // 0. chemin normal (inchangé) : ligne « rembourse » avec expiration, un mouvement +1, réconciliation propre
    {
        const { p } = await neuf('c0'); const r = await muet(() => Lg.rembourser(p, { x: 1 }, 'panne', { scanId: 'c0', maintenant: t }, cfg));
        const d = await debitDe('c0'), rc = await recon(p);
        H.v('0. chemin normal : rendu, ligne « rembourse » avec expireLe, un mouvement +1, essais rendus, réconciliation propre',
            [r.rendu, d.etat, d.expireLe instanceof Date, await mouvementsPlus('c0'), (await lire(p)).essais, rc.propre], [true, 'rembourse', true, 1, 3, true]);
    }

    // 1. ARRÊT AVANT LE CRÉDIT (juste après la prise du débit) : le crédit n'a pas été rendu
    {
        const { p } = await neuf('c1');
        const a = armerArret((nom, m) => nom === 'installations' && m === 'updateOne');          // le crédit d'une poche « essai » = updateOne sur `installations`
        try { await muet(() => Lg.rembourser(p, { x: 1 }, 'panne', { scanId: 'c1', maintenant: t }, cfg)); } finally { a.relever(); }
        const d = await debitDe('c1'), rc = await recon(p);
        H.v('1a. arrêt avant le crédit : le déclencheur a bien été atteint (un banc de coupure qui ne coupe rien ne dit rien)', a.etat.au, 'installations.updateOne');
        H.v('1b. la ligne de débit n\'est PAS « rembourse » (le crédit n\'a pas été rendu) : « rendu-en-cours »', d.etat, 'rendu-en-cours');
        H.v('1c. le crédit n\'est pas rendu (essais 2) et aucun mouvement +1', [(await lire(p)).essais, await mouvementsPlus('c1')], [2, 0]);
        H.v('1d. la réconciliation LISTE aussitôt la ligne (pas d\'attente de 60 min) et n\'est pas propre', [rc.rendusEchoues.map(l => l.etat), rc.propre], [['rendu-en-cours'], false]);
        // le redémarrage : un second remboursement ne rend RIEN seul (le crédit a pu être rendu : jamais de double rendu) ; le crédit reste dû, listé
        const r2 = await muet(() => Lg.rembourser(p, { x: 1 }, 'panne', { scanId: 'c1', maintenant: t }, cfg));
        H.v('1e. après redémarrage : un second remboursement ne rend rien seul, le solde ne bouge pas (essais 2)', [r2.rendu, (await lire(p)).essais], [false, 2]);
    }

    // 2. ARRÊT ENTRE LE CRÉDIT ET SA TRACE : le crédit est rendu, le mouvement +1 n'est pas écrit
    {
        const { p } = await neuf('c2');
        const a = armerArret((nom, m, ar) => nom === 'mouvements' && m === 'updateOne' && ar[1] && ar[1].$set && ar[1].$set.delta === 1);   // la trace de la 1re unité = la claim passe à delta 1
        try { await muet(() => Lg.rembourser(p, { x: 1 }, 'panne', { scanId: 'c2', maintenant: t }, cfg)); } finally { a.relever(); }
        const d = await debitDe('c2'), rc = await recon(p);
        H.v('2a. déclencheur atteint', a.etat.au, 'mouvements.updateOne');
        H.v('2b. crédit rendu (essais 3) sans mouvement ; la ligne n\'est PAS « rembourse » : « rendu-en-cours »', [(await lire(p)).essais, await mouvementsPlus('c2'), d.etat], [3, 0, 'rendu-en-cours']);
        H.v('2c. la réconciliation liste la ligne, imprime l\'écart de poche +1 (crédit rendu sans sa trace), n\'est pas propre',
            [rc.rendusEchoues.map(l => l.etat), rc.ecarts.map(e => [e.poche, e.ecart]), rc.propre], [['rendu-en-cours'], [['essai', 1]], false]);
        const r2 = await muet(() => Lg.rembourser(p, { x: 1 }, 'panne', { scanId: 'c2', maintenant: t }, cfg));
        H.v('2d. après redémarrage : pas de second crédit (essais 3)', [r2.rendu, (await lire(p)).essais], [false, 3]);
    }

    // 3. ARRÊT ENTRE LA TRACE ET LE DERNIER ÉTAT : crédit rendu ET tracé ; la ligne reste « rendu-en-cours » (listée), jamais rendue deux fois
    {
        const { p } = await neuf('c3');
        const a = armerArret((nom, m, ar) => nom === 'mouvements' && m === 'updateOne' && ar[1] && ar[1].$set && ar[1].$set.etat === 'rembourse');
        try { await muet(() => Lg.rembourser(p, { x: 1 }, 'panne', { scanId: 'c3', maintenant: t }, cfg)); } finally { a.relever(); }
        const d = await debitDe('c3'), rc = await recon(p);
        H.v('3a. déclencheur atteint', a.etat.au, 'mouvements.updateOne');
        H.v('3b. crédit rendu (essais 3), un mouvement +1, ligne « rendu-en-cours » ; aucun écart de solde ; listée, pas propre',
            [(await lire(p)).essais, await mouvementsPlus('c3'), d.etat, rc.ecarts.length, rc.rendusEchoues.length, rc.propre], [3, 1, 'rendu-en-cours', 0, 1, false]);
    }

    // 4. un débit encore OUVERT n'est pas touché par un arrêt survenu sur un autre scan ; et une écriture d'état qui échoue SANS arrêt (2 essais) laisse la ligne listée, crédit rendu et tracé
    {
        const { p } = await neuf('c4'); const orig = db.col;
        db.col = nom => new Proxy(orig(nom), { get(c, k) { const v = c[k]; if (typeof v !== 'function') return v;
            return (...a) => { if (nom === 'mouvements' && k === 'updateOne' && a[1] && a[1].$set && a[1].$set.etat === 'rembourse') return Promise.reject(new Error('panne simulée')); return v.apply(c, a); }; } });
        let r; try { r = await muet(() => Lg.rembourser(p, { x: 1 }, 'panne', { scanId: 'c4', maintenant: t }, cfg)); } finally { db.col = orig; }
        const d = await debitDe('c4');
        H.v('4. l\'écriture de l\'état final échoue : le client EST rendu (rendu: true), ligne « rendu-en-cours » listée, un seul crédit', [r.rendu, d.etat, (await lire(p)).essais, await mouvementsPlus('c4')], [true, 'rendu-en-cours', 3, 1]);
    }
    // 5. la TRACE échoue SANS arrêt du processus (le crédit est rendu) : le client est rendu, mais la ligne ne passe PAS « rembourse » (aucune trace +1) — elle reste « rendu-en-cours », listée
    {
        const { p } = await neuf('c5'); const orig = db.col;
        db.col = nom => new Proxy(orig(nom), { get(c, k) { const v = c[k]; if (typeof v !== 'function') return v;
            return (...a) => { if (nom === 'mouvements' && k === 'updateOne' && a[1] && a[1].$set && a[1].$set.delta === 1) return Promise.reject(new Error('panne simulée')); return v.apply(c, a); }; } });
        let r; try { r = await muet(() => Lg.rembourser(p, { x: 1 }, 'panne', { scanId: 'c5', maintenant: t }, cfg)); } finally { db.col = orig; }
        const d = await debitDe('c5'), rc = await recon(p);
        H.v('5. la trace +1 échoue (sans arrêt) : crédit rendu (essais 3), aucun mouvement, la ligne reste « rendu-en-cours » (jamais « rembourse » sans trace), listée, écart +1 dit',
            [r.rendu, (await lire(p)).essais, await mouvementsPlus('c5'), d.etat, rc.rendusEchoues.length, rc.ecarts.map(e => e.ecart)], [true, 3, 0, 'rendu-en-cours', 1, [1]]);
    }
    // 6. O5 M1 (constat, pas un correctif) : la poche est PRISE, puis l'écriture du mouvement ET la vérification de son existence échouent (`ecrit === null`) — le crédit est perdu SANS mouvement.
    //    Ce que dit la réconciliation : l'écart de poche −1 (jamais le scan : aucun mouvement ne porte son identité). La marque de livraison d'O5 ne change pas ce constat (voir l'audit §5, O5).
    {
        const p = await inst({ essais: 3 }); await db.col('installations').updateOne({ _id: p.id }, { $set: { essaisInitiaux: 3 } }); const orig = db.col; let lectures = 0;
        db.col = nom => new Proxy(orig(nom), { get(c, k) { const v = c[k]; if (typeof v !== 'function') return v;
            return (...a) => { if (nom === 'mouvements' && k === 'insertOne') return Promise.reject(new Error('panne simulée'));
                if (nom === 'mouvements' && k === 'findOne' && ++lectures >= 2) return Promise.reject(new Error('panne simulée')); return v.apply(c, a); }; } });
        let echec = null; try { await muet(() => Lg.debiter(p, { scanId: 'c6', cleIdempotence: 'k-c6', maintenant: t }, cfg)); } catch (e) { echec = e.message; } finally { db.col = orig; }
        const rc = await recon(p);
        H.v('6. M1 : poche prise, mouvement et vérification en panne : le débit lève, essais 2 (perdu), AUCUN mouvement, la réconciliation dit l\'écart de poche −1 et n\'est pas propre',
            [echec, (await lire(p)).essais, await db.col('mouvements').countDocuments({ installationId: p.id }), rc.ecarts.map(e => [e.poche, e.ecart]), rc.propre], ['panne simulée', 2, 0, [['essai', -1]], false]);
    }
    // 7. UN-CANDIDAT-2 M4 : la limite de la procédure manuelle (audit §15, étape 2) vaut pour TOUTE continuation après un partiel, pas pour le seul `cleOrigine`.
    //    Scan SANS cleOrigine, 2 unités : la 1re est rendue (partiel, claim renommée « fait »), puis la continuation s'arrête après avoir posé sa claim `rb|scan` (delta 0) et avant sa prise.
    {
        const p = await inst({ essais: 3 }); await db.col('installations').updateOne({ _id: p.id }, { $set: { essaisInitiaux: 3 } });
        await Lg.debiter(p, { scanId: 'c7', cleIdempotence: 'k-c7a', maintenant: t }, cfg); await Lg.debiter(p, { scanId: 'c7', cleIdempotence: 'k-c7b', maintenant: t }, cfg);
        const d2 = (await db.col('mouvements').find({ scanId: 'c7', type: 'debit' }).sort({ _id: 1 }).toArray())[1];
        await db.col('mouvements').updateOne({ _id: d2._id }, { $set: { credit: { poche: 'accueil' } } });           // la 2e unité ne peut pas être rendue : partiel
        const r1 = await muet(() => Lg.rembourser(p, { x: 1 }, 'panne', { scanId: 'c7', maintenant: t }, cfg));
        await db.col('mouvements').updateOne({ _id: d2._id }, { $set: { credit: { poche: 'essai' } } });
        const a = armerArret((nom, m) => nom === 'mouvements' && m === 'findOneAndUpdate');
        try { await muet(() => Lg.rembourser(p, { x: 1 }, 'panne', { scanId: 'c7', maintenant: t }, cfg)); } finally { a.relever(); }
        const rc = await R.reconcilier(p, { cfg, maintenant: new Date(t.getTime() + 2 * 3600e3) });
        const preuve = { debitsPris: await db.col('mouvements').countDocuments({ scanId: 'c7', type: 'debit', etat: { $in: ['rembourse', 'rendu-en-cours'] } }), mouvementsNonNuls: await db.col('mouvements').countDocuments({ scanId: 'c7', type: 'remboursement', delta: { $ne: 0 } }) };
        H.v('7. continuation arrêtée après un partiel : partiel (1 unité), claim orpheline listée (delta 0), ET la preuve de l\'étape (2) trouve un débit pris et un mouvement non nul : STOP, la claim n\'est PAS libérable par la procédure',
            [r1.rendu, a.etat.au, rc.claimsOrphelines.map(c => c.unitesRendues), preuve.debitsPris >= 1 && preuve.mouvementsNonNuls >= 1], [true, 'mouvements.findOneAndUpdate', [false], true]);
    }
    await H.fermerBac(); H.bilan();
})().catch(e => { console.error('❌', e); process.exit(1); });
