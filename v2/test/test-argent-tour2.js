'use strict';
// MOYENS-B2a, TOUR 2 — « un crédit se reconnaît PAR SON DÉBIT, pas par un agrégat » (relecture 2/3 : N-1, N-7, N-9 et les mineurs).
//   · le crédit d'un débit est écrit UNE fois par construction : l'identité du débit est posée sur le document de la poche dans la MÊME écriture atomique que le $inc (`creditsRendus`), et la trace +1 porte `debitId` sous un index unique ;
//   · la réparation lit CE débit (marqueur de poche, trace par `debitId` ou par une ancienne clé), plus l'écart agrégé de la poche (qui reste imprimé comme témoin) ;
//   · `priseLe` est posé à la prise `rendu-en-cours` par `rendreLeScan` ET `rembourserLigne` ; la réparation refuse un débit pris depuis moins de N minutes.
const express = require('express'); const { ObjectId } = require('mongoose').Types;
const H = require('./_harnais'); const db = require('../db'); const M = require('../modeles'); const { lireConfig } = require('../config');
const Lg = require('../argent/ledger'); const R = require('../argent/reconcilier'); const MS = require('../argent/marque-scan'); const registre = require('../registre');
const { inst, lire } = require('./_aide-argent');
const cfg = lireConfig({ MONGODB_BASE: 'test_scratch', V2_HEBDO: '0' });
const t = new Date('2026-10-08T10:00:00Z'), tard = new Date(t.getTime() + 4 * 3600e3);
const muet = async f => { const e0 = console.error; console.error = () => { }; try { return await f(); } finally { console.error = e0; } };
function armerArret(declencheur) {
    const orig = db.col; const etat = { mort: false, au: null };
    db.col = nom => new Proxy(orig(nom), { get(c, p) { const v = c[p]; if (typeof v !== 'function') return v;
        return (...a) => { if (!etat.mort && declencheur(nom, p, a)) { etat.mort = true; etat.au = `${nom}.${p}`; } if (etat.mort) return Promise.reject(new Error('arrêt simulé')); return v.apply(c, a); }; } });
    return { etat, relever: () => { db.col = orig; } };
}
function paner(quand) {
    const orig = db.col;
    db.col = nom => new Proxy(orig(nom), { get(c, p) { const v = c[p]; if (typeof v !== 'function') return v;
        return (...a) => { const r = quand(nom, p, a); if (r && r.rejette) return Promise.reject(new Error('panne simulée')); if (r && r.rendu !== undefined) return Promise.resolve(r.rendu); return v.apply(c, a); }; } });
    return () => { db.col = orig; };
}
const neuf = async (scanId, n = 1) => { const p = await inst({ essais: 3 }); await db.col('installations').updateOne({ _id: p.id }, { $set: { essaisInitiaux: 3 } });
    for (let k = 0; k < n; k++) await Lg.debiter(p, { scanId, cleIdempotence: `k-${scanId}-${k}`, maintenant: t }, cfg); return p; };
const debitsDe = scanId => db.col('mouvements').find({ scanId, type: 'debit' }).sort({ _id: 1 }).toArray();
const plus1 = scanId => db.col('mouvements').countDocuments({ scanId, type: 'remboursement', delta: 1 });
const recon = (p, maintenant = tard) => R.reconcilier(p, { cfg, maintenant });
const reparer = (p, scanId, o = {}) => muet(() => Lg.reparerDebitRembourseSansMouvement(p, { scanId, maintenant: tard, ...o }, cfg));
const etatsDe = async scanId => (await debitsDe(scanId)).map(d => d.etat);

(async () => {
    await H.ouvrirBac('test-argent-tour2.js'); await M.creerIndex();
    // ═══ N-1 : la réparation pendant un `rembourserLigne` VIVANT (retenu devant la porte du crédit) ne double pas le crédit
    {
        const p = await neuf('n1'); let ouvrirPorte; const porte = new Promise(r => { ouvrirPorte = r; }); let retenu = false; const orig = db.col;
        db.col = nom => new Proxy(orig(nom), { get(c, k) { const v = c[k]; if (typeof v !== 'function') return v;
            return (...a) => { if (nom === 'installations' && k === 'updateOne' && !retenu) { retenu = true; return porte.then(() => v.apply(c, a)); } return v.apply(c, a); }; } });
        let vivant, rep;
        try {
            vivant = muet(() => Lg.rembourserLigne(p, 'k-n1-0', 'panne', { maintenant: t }, cfg));
            for (let i = 0; i < 200 && !retenu; i++) await new Promise(r => setTimeout(r, 5));
            rep = await reparer(p, 'n1');                                                                      // l'opérateur répare PENDANT que le remboursement vivant tient la ligne
            ouvrirPorte();
        } finally { db.col = orig; }
        const rl = await vivant;
        H.v('N-1. réparation pendant un `rembourserLigne` vivant : UN seul crédit au total (essais 3, jamais 4), UN seul mouvement +1, la ligne finit « rembourse », réconciliation propre',
            [(await lire(p)).essais, await plus1('n1'), await etatsDe('n1'), (await recon(p)).propre, retenu], [3, 1, ['rembourse'], true, true]);
        H.v('   (témoin) la réparation OU le vivant a rendu, jamais les deux : exactement un des deux a écrit le crédit', [Number(Boolean(rep.repare && rep.creditRendu)) + Number(Boolean(rl.rendu))], [1]);
    }
    // ═══ N-9 : une anomalie de compensation sur la même poche ne fausse plus la preuve : le client ne perd rien
    {
        require('../argent/monter').routes(express.Router(), cfg, {});
        const p = await inst({ essais: 3 }); await db.col('installations').updateOne({ _id: p.id }, { $set: { essaisInitiaux: 3 } });
        const scanA = new ObjectId(), cleA = `scan|installation:${p.id}|n9a`; let tardif = null;
        const ouvrir = paner((nom, m, ar) => { if (nom === 'mouvements' && m === 'insertOne' && ar[0] && ar[0].type === 'debit') { tardif = ar[0]; return { rejette: true }; } return null; });
        try { await muet(() => Lg.debiter(p, { scanId: scanA, cleIdempotence: cleA, maintenant: t }, cfg)); } catch (_) { /* panne voulue : le débit A est compensé */ } finally { ouvrir(); }
        await db.col('mouvements').insertOne({ ...tardif });                                                    // l'écriture TARDIVE de A : l'écart de poche vaut +1 (anomalie nommée)
        const scanB = 'n9b'; await Lg.debiter(p, { scanId: scanB, cleIdempotence: 'k-n9b', maintenant: t }, cfg);        // essais 2
        const a = armerArret((nom, m) => nom === 'installations' && m === 'updateOne');                          // B : arrêt après la prise, avant le crédit
        try { await muet(() => Lg.rembourser(p, { x: 1 }, 'panne', { scanId: scanB, maintenant: t }, cfg)); } finally { a.relever(); }
        const avant = await recon(p);
        const r = await reparer(p, scanB);
        H.v('N-9. écart de poche +1 dû à A (compensation tardive) mais le débit B n\'a JAMAIS été crédité : la réparation lit B, rend SON crédit (le client ne perd rien : essais 3, jamais 2)',
            [avant.ecarts.map(e => e.ecart), r.repare, r.creditRendu, (await lire(p)).essais, await plus1(scanB), await etatsDe(scanB)], [[1], true, true, 3, 1, ['rembourse']]);
    }
    // ═══ trois chemins concurrents sur le MÊME débit : un seul crédit (net mesuré au grand livre)
    {
        const p = await neuf('n3');
        const rs = await Promise.all([muet(() => Lg.rembourser(p, { x: 1 }, 'panne', { scanId: 'n3', maintenant: t }, cfg)), muet(() => Lg.rembourserLigne(p, 'k-n3-0', 'panne', { maintenant: t }, cfg)), reparer(p, 'n3')]);
        const somme = (await db.col('mouvements').find({ installationId: p.id }).toArray()).reduce((s, m) => s + m.delta, 0);
        H.v('trois chemins (rendreLeScan, rembourserLigne, réparation) sur le même débit : UN seul crédit — essais 3, somme des deltas 0, un mouvement +1, réconciliation propre',
            [(await lire(p)).essais, somme, await plus1('n3'), (await recon(p)).propre], [3, 0, 1, true]);
    }
    // ═══ la trace +1 d'un débit est UNIQUE (index) : deux traces du même débit ne coexistent jamais
    {
        const p = await neuf('n4'); const d = (await debitsDe('n4'))[0];
        const ligne = cle => ({ installationId: p.id, le: t, surface: 'extension', type: 'remboursement', delta: 1, poche: 'essai', motif: 'banc', scanId: 'n4', etat: 'rembourse', cleIdempotence: cle, debitId: d._id });
        await db.col('mouvements').insertOne(ligne('cr-1'));
        let code = null; try { await db.col('mouvements').insertOne(ligne('cr-2')); } catch (e) { code = e.code; }
        H.v('index unique sur `debitId` des traces : une seconde trace du même débit est refusée (E11000), même sous une AUTRE clé', code, 11000);
    }
    // ═══ données EXISTANTES : un crédit écrit sous une ANCIENNE clé (`rl|<clé du débit>`, sans debitId, sans marqueur de poche) reste reconnu par son débit
    {
        const p = await neuf('n5', 2); const [A, B] = await debitsDe('n5');
        await db.col('mouvements').updateMany({ scanId: 'n5', type: 'debit' }, { $set: { etat: 'rembourse' } });
        await db.col('installations').updateOne({ _id: p.id }, { $inc: { essais: 1 } });                         // A : crédit rendu AVANT ce lot
        await db.col('mouvements').insertOne({ installationId: p.id, le: t, surface: 'extension', type: 'remboursement', delta: 1, poche: 'essai', motif: 'ancien', scanId: 'n5', etat: 'rembourse', cleIdempotence: `rl|${A.cleIdempotence}` });
        const r = await reparer(p, 'n5');
        const [A2, B2] = await debitsDe('n5');
        H.v('ancienne clé `rl|` : A est reconnu rendu, la réparation vise B SANS désignation (plus de choix-ambigu), rend SON crédit : essais 3, marqueur sur B seul',
            [r.repare, r.creditRendu, (await lire(p)).essais, 'reparation' in B2, 'reparation' in A2], [true, true, 3, true, false]);
    }
    // ═══ données EXISTANTES (2) : la claim `rb|scan` d'un remboursement fait AVANT ce tour (delta 1, sans debitId, sans clé du débit) couvre le débit unique du scan : rien à réparer, aucun second crédit
    {
        const p = await neuf('n5b'); await db.col('mouvements').updateOne({ scanId: 'n5b', type: 'debit' }, { $set: { etat: 'rembourse' } });
        await db.col('installations').updateOne({ _id: p.id }, { $inc: { essais: 1 } });
        await db.col('mouvements').insertOne({ installationId: p.id, le: t, surface: 'extension', type: 'remboursement', delta: 1, poche: 'essai', motif: 'ancien', scanId: 'n5b', etat: 'rembourse', cleIdempotence: 'rb|n5b' });
        const r = await reparer(p, 'n5b');
        H.v('ancienne claim `rb|scan` (delta 1, sans debitId) : le débit unique est reconnu rendu — rien à réparer, essais 3 (jamais 4)', [r.repare, r.raison, (await lire(p)).essais, await plus1('n5b')], [false, 'rien-a-reparer', 3, 1]);
    }
    // ═══ priseLe : posé par la prise de rendreLeScan ET de rembourserLigne ; la réparation refuse un débit pris depuis moins de N minutes
    {
        const p = await neuf('n6'); const a = armerArret((nom, m) => nom === 'installations' && m === 'updateOne');
        try { await muet(() => Lg.rembourserLigne(p, 'k-n6-0', 'panne', { maintenant: t }, cfg)); } finally { a.relever(); }
        const d = (await debitsDe('n6'))[0];
        const q = await neuf('n6b'); const a2 = armerArret((nom, m) => nom === 'installations' && m === 'updateOne');
        try { await muet(() => Lg.rembourser(q, { x: 1 }, 'panne', { scanId: 'n6b', maintenant: t }, cfg)); } finally { a2.relever(); }
        const d2 = (await debitsDe('n6b'))[0];
        H.v('`priseLe` posé à la prise par rembourserLigne ET par rendreLeScan', [d.priseLe && new Date(d.priseLe).getTime(), d2.priseLe && new Date(d2.priseLe).getTime()], [t.getTime(), t.getTime()]);
        await db.col('mouvements').updateOne({ _id: d._id }, { $set: { le: new Date(t.getTime() - 24 * 3600e3) } });
        const r = await reparer(p, 'n6', { maintenant: new Date(t.getTime() + 60e3) });
        H.v('réparation d\'un débit ANCIEN pris depuis 1 minute : refusée (prise-recente), aucun crédit', [r.repare, r.raison, (await lire(p)).essais], [false, 'prise-recente', 2]);
        const r2 = await reparer(p, 'n6');
        H.v('   passé le délai : réparée (crédit + trace), essais 3', [r2.repare, r2.creditRendu, (await lire(p)).essais], [true, true, 3]);
    }
    // ═══ N-5 : une marque `echec` / `poche-deja-compensee` (O5 M2) a un geste de clôture : la trace manquante est écrite, la marque close, la réconciliation propre ; avant, `reconcilier` dit le geste
    {
        const argent = registre.obtenir('argent');
        const p = await inst({ essais: 3 }); await db.col('installations').updateOne({ _id: p.id }, { $set: { essaisInitiaux: 3 } });
        const scanId = new ObjectId(), cle = `scan|installation:${p.id}|n5`; await MS.ouvrir({ scanId, porteur: p, cleDebit: cle, maintenant: new Date(t.getTime() - 20 * 60e3) });
        let tardif = null; const ouvrir = paner((nom, m, ar) => { if (nom === 'mouvements' && m === 'insertOne' && ar[0] && ar[0].type === 'debit') { tardif = ar[0]; return { rejette: true }; } return null; });
        try { await muet(() => Lg.debiter(p, { scanId, cleIdempotence: cle, maintenant: t }, cfg)); } catch (_) { /* panne voulue */ } finally { ouvrir(); }
        await db.col('mouvements').insertOne({ ...tardif });
        await muet(() => MS.rattraper({ argent, maintenant: new Date(Date.now() + 2 * 3600e3) }));
        const m0 = await db.col('scans_en_cours').findOne({ _id: scanId }); const rc0 = await recon(p);
        H.v('N-5a. marque en `echec`/`poche-deja-compensee` : `reconcilier` la liste AVEC son geste (outil de réparation), pas un « non propre » muet', [m0.etat, m0.issue, rc0.marquesEnSuspens.map(x => x.geste || null).map(g => /reparer-debit/.test(String(g))), rc0.propre], ['echec', 'poche-deja-compensee', [true], false]);
        const r = await reparer(p, scanId);
        const m1 = await db.col('scans_en_cours').findOne({ _id: scanId }); const rc1 = await recon(p);
        H.v('N-5b. l\'outil clôt : trace +1 écrite SANS second crédit (essais 3), débit « rembourse », marque close, réconciliation propre',
            [r.repare, r.creditRendu, (await lire(p)).essais, await plus1(scanId), await etatsDe(scanId), m1.etat, rc1.propre], [true, false, 3, 1, ['rembourse'], 'rendu', true]);
    }
    // ═══ N-8 : `rembourserLigne` sur un débit dont la poche a été compensée ne rend pas une seconde fois
    {
        const p = await inst({ essais: 3 }); await db.col('installations').updateOne({ _id: p.id }, { $set: { essaisInitiaux: 3 } });
        const scanId = new ObjectId(), cle = `scan|installation:${p.id}|n8`; let tardif = null;
        const ouvrir = paner((nom, m, ar) => { if (nom === 'mouvements' && m === 'insertOne' && ar[0] && ar[0].type === 'debit') { tardif = ar[0]; return { rejette: true }; } return null; });
        try { await muet(() => Lg.debiter(p, { scanId, cleIdempotence: cle, maintenant: t }, cfg)); } catch (_) { /* panne voulue */ } finally { ouvrir(); }
        await db.col('mouvements').insertOne({ ...tardif });
        const r = await muet(() => Lg.rembourserLigne(p, cle, 'panne', { maintenant: tard }, cfg));
        H.v('N-8. `rembourserLigne` sur un débit tardif dont la poche est compensée : refusé (poche-deja-compensee), essais 3 (jamais 4), aucune trace', [r.rendu, r.raisonNonRembourse, (await lire(p)).essais, await plus1(scanId)], [false, 'poche-deja-compensee', 3, 0]);
        const sansScan = await muet(() => Lg.rembourser(p, { x: 1 }, 'panne', { scanId, maintenant: tard }, cfg));
        H.v('   et `rendreLeScan` : idem', [sansScan.rendu, sansScan.raisonNonRembourse, (await lire(p)).essais], [false, 'poche-deja-compensee', 3]);
    }
    await H.fermerBac(); H.bilan();
})().catch(e => { console.error('❌', e); process.exit(1); });
