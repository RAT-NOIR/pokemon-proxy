'use strict';
// MOYENS-B2a, TOUR 1 — les 4 Importants et les mineurs de la relecture 1/3 (lot-MOYENS-B2a-relecture-1-report.md).
//   I-1 : l'état que la coupure laisse (« rendu-en-cours ») a une issue : la réparation le traite avec la MÊME preuve (S1 : aucun crédit ⇒ crédit + trace + rembourse ; S2 : crédit sans trace ⇒ trace + rembourse ; S3 : trace déjà là ⇒ clore).
//        `rembourser` / `rembourserLigne` sur une ligne « rendu-en-cours » ne disent plus « deja-rembourse » (faux pour le client) : « remboursement-en-cours ».
//   I-2 : le rattrapage d'O5 ne rend pas une unité de trop après une compensation suivie d'une écriture tardive du débit.
//   I-3 : `rembourserLigne` ne passe « rembourse » que si la trace est écrite.
//   M-1 garde d'âge · M-2 marque `reparation` reprenable · M-3 bancs qui tuent MR, MS, ML · M-4 le débit qui manquait réellement.
const express = require('express'); const { ObjectId } = require('mongoose').Types;
const H = require('./_harnais'); const db = require('../db'); const M = require('../modeles'); const { lireConfig } = require('../config');
const Lg = require('../argent/ledger'); const R = require('../argent/reconcilier'); const MS = require('../argent/marque-scan'); const registre = require('../registre');
const { inst, compte, lire } = require('./_aide-argent');
const cfg = lireConfig({ MONGODB_BASE: 'test_scratch', V2_HEBDO: '0' });
const t = new Date('2026-10-08T10:00:00Z'), tard = new Date(t.getTime() + 4 * 3600e3);
const Q = require('./_aide-quota');
// OFFRE-QUOTA : la « poche » d'une installation (ses 3 essais) est le compteur du jour (sans compte : 3 par jour). `essais(p)` = ce qui lui reste le 8 octobre, `prise(p, n)` = n unités prises/rendues hors grand livre.
// Les scénarios qui fabriquent à la main un débit « d'avant le tour 2 » (sans priseLe ni marqueur) n'existent que pour les ANCIENNES poches : ils passent par `ancien()` (poche `essai`, p.ancien = true), le grand livre sait toujours les rendre.
const essais = async p => (p.ancien ? (await lire(p)).essais : Q.restantDe(p, cfg, t));
const prise = (p, n = 1) => (p.ancien ? db.col('installations').updateOne({ _id: p.id }, { $inc: { essais: -n } }) : db.col('quota_jour').updateOne({ porteur: `installation:${p.id}`, jour: '2026-10-08' }, { $inc: { count: n } }));
const ancien = async (scanId, n = 1) => { const p = await inst({ essais: 3 }); await db.col('installations').updateOne({ _id: p.id }, { $set: { essaisInitiaux: 3, essais: 3 - n } }); p.ancien = true;
    for (let k = 0; k < n; k++) await db.col('mouvements').insertOne({ installationId: p.id, le: t, surface: 'extension', type: 'debit', delta: -1, poche: 'essai', credit: { poche: 'essai' }, motif: null, scanId, etat: 'debite', cleIdempotence: `k-${scanId}-${k}`, expireLe: new Date('2028-01-01') });
    return p; };
const muet = async f => { const e0 = console.error; console.error = () => { }; try { return await f(); } finally { console.error = e0; } };
function armerArret(declencheur) {
    const orig = db.col; const etat = { mort: false, au: null };
    db.col = nom => new Proxy(orig(nom), { get(c, p) { const v = c[p]; if (typeof v !== 'function') return v;
        return (...a) => { if (!etat.mort && declencheur(nom, p, a)) { etat.mort = true; etat.au = `${nom}.${p}`; } if (etat.mort) return Promise.reject(new Error('arrêt simulé')); return v.apply(c, a); }; } });
    return { etat, relever: () => { db.col = orig; } };
}
// une panne ciblée SANS arrêt : `quand(nom, methode, args)` => { rejette } | { rendu } | null
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
    await H.ouvrirBac('test-argent-tour1.js'); await M.creerIndex();
    // ═══ I-1 : S1, S2, S3 — chacun finit rendu UNE fois, net 0, réconciliation propre
    {   // S1 : arrêt après la prise, avant le crédit
        const p = await neuf('s1'); const a = armerArret((nom, m) => nom === 'quota_jour' && m === 'updateOne');
        try { await muet(() => Lg.rembourser(p, { x: 1 }, 'panne', { scanId: 's1', maintenant: t }, cfg)); } finally { a.relever(); }
        const rr = await muet(() => Lg.rembourser(p, { x: 1 }, 'panne', { scanId: 's1', maintenant: t }, cfg));
        H.v('I-1 S1a. `rembourser` sur une ligne « rendu-en-cours » ne dit PAS « deja-rembourse » (faux : le crédit n\'est pas rendu) : « remboursement-en-cours », publié au client comme `erreur` (jamais « remboursé »)', [rr.rendu, rr.raisonNonRembourse, require('../argent/facturation').raisonPublique(rr.raisonNonRembourse)], [false, 'remboursement-en-cours', 'erreur']);
        const rl = await muet(() => Lg.rembourserLigne(p, 'k-s1-0', 'panne', { maintenant: t }, cfg));
        H.v('I-1 S1b. `rembourserLigne` : idem', [rl.rendu, rl.raisonNonRembourse], [false, 'remboursement-en-cours']);
        const r = await reparer(p, 's1');
        H.v('I-1 S1c. réparée : crédit rendu UNE fois (essais 3), un mouvement +1, la ligne passe « rembourse »', [r.repare, r.creditRendu, (await essais(p)), await plus1('s1'), await etatsDe('s1')], [true, true, 3, 1, ['rembourse']]);
        H.v('I-1 S1d. net 0 et réconciliation PROPRE ; un second appel ne fait rien', [(await recon(p)).propre, (await recon(p)).ecarts.length, (await reparer(p, 's1')).raison, (await essais(p))], [true, 0, 'rien-a-reparer', 3]);
    }
    {   // S2 : arrêt après le crédit, avant la trace
        const p = await neuf('s2'); const a = armerArret((nom, m, ar) => nom === 'mouvements' && m === 'updateOne' && ar[1] && ar[1].$set && ar[1].$set.delta === 1);
        try { await muet(() => Lg.rembourser(p, { x: 1 }, 'panne', { scanId: 's2', maintenant: t }, cfg)); } finally { a.relever(); }
        const r = await reparer(p, 's2');
        H.v('I-1 S2a. crédit déjà rendu sans trace : la trace SEULE est écrite (essais 3, jamais 4), la ligne passe « rembourse »', [r.repare, r.creditRendu, (await essais(p)), await plus1('s2'), await etatsDe('s2')], [true, false, 3, 1, ['rembourse']]);
        H.v('I-1 S2b. réconciliation propre, second appel sans effet', [(await recon(p)).propre, (await reparer(p, 's2')).raison, (await essais(p))], [true, 'rien-a-reparer', 3]);
    }
    {   // S3 : arrêt après la trace, avant le dernier état
        const p = await neuf('s3'); const a = armerArret((nom, m, ar) => nom === 'mouvements' && m === 'updateOne' && ar[1] && ar[1].$set && ar[1].$set.etat === 'rembourse');
        try { await muet(() => Lg.rembourser(p, { x: 1 }, 'panne', { scanId: 's3', maintenant: t }, cfg)); } finally { a.relever(); }
        const avant = await recon(p);
        H.v('I-1 S3a. (M-3, ML) l\'état S3 n\'est PAS une claim orpheline : la claim est complète, `claimsOrphelines` à 0 ; la ligne est listée', [avant.claimsOrphelines.length, avant.rendusEchoues.length], [0, 1]);
        const r = await reparer(p, 's3');
        H.v('I-1 S3b. trace déjà là : la ligne est CLOSE en « rembourse », aucun crédit de plus, aucun mouvement de plus', [r.repare, r.creditRendu, (await essais(p)), await plus1('s3'), await etatsDe('s3')], [true, false, 3, 1, ['rembourse']]);
        H.v('I-1 S3c. réconciliation propre', (await recon(p)).propre, true);
    }
    {   // S1, S2, S3 avec la marque de livraison d'O5 et le rattrapage (la sonde du relecteur) : la marque finit en `echec`, la réparation la clôt, la réconciliation est propre
        require('../argent/monter').routes(express.Router(), cfg, {}); const argent = registre.obtenir('argent');
        for (const [nom, declencheur] of [['S1', (n, m) => n === 'quota_jour' && m === 'updateOne'], ['S2', (n, m, ar) => n === 'mouvements' && m === 'updateOne' && ar[1] && ar[1].$set && ar[1].$set.delta === 1], ['S3', (n, m, ar) => n === 'mouvements' && m === 'updateOne' && ar[1] && ar[1].$set && ar[1].$set.etat === 'rembourse']]) {
            const p = await inst({ essais: 3 }); await db.col('installations').updateOne({ _id: p.id }, { $set: { essaisInitiaux: 3 } });
            const scanId = new ObjectId(); await MS.ouvrir({ scanId, porteur: p, cleDebit: `scan|installation:${p.id}|${nom}`, maintenant: new Date(t.getTime() - 20 * 60e3) });
            await Lg.debiter(p, { scanId, cleIdempotence: `scan|installation:${p.id}|${nom}`, maintenant: t }, cfg);
            const a = armerArret(declencheur); try { await muet(() => Lg.rembourser(p, { x: 1 }, 'panne', { scanId, maintenant: t }, cfg)); } finally { a.relever(); }
            for (let k = 0; k < 2; k++) await muet(() => MS.rattraper({ argent, maintenant: new Date(Date.now() + 2 * 3600e3) }));
            const avant = await db.col('scans_en_cours').findOne({ _id: scanId });
            const r = await reparer(p, scanId);
            const apres = await db.col('scans_en_cours').findOne({ _id: scanId }); const rc = await recon(p);
            H.v(`I-1 ${nom} avec marque. rattrapage x2 : la marque est en échec ; réparée : rendu UNE fois (essais 3, net 0), la marque est close « rendu/repare », réconciliation PROPRE (aucune claim orpheline, aucun écart)`,
                [avant.etat, r.repare, (await essais(p)), apres.etat, apres.issue, rc.propre, rc.claimsOrphelines.length, rc.ecarts.length], ['echec', true, 3, 'rendu', 'repare', true, 0, 0]);
        }
    }
    // ═══ I-3 : S4 — `rembourserLigne` : la trace n'est pas écrite ⇒ la ligne reste « rendu-en-cours » (réparable)
    {
        const p = await neuf('s4'); const ouvrir = paner((nom, m, ar) => nom === 'mouvements' && m === 'insertOne' && ar[0] && ar[0].type === 'remboursement' ? { rejette: true } : null);
        let r; try { r = await muet(() => Lg.rembourserLigne(p, 'k-s4-0', 'panne', { maintenant: t }, cfg)); } finally { ouvrir(); }
        H.v('I-3 S4a. `rembourserLigne`, trace en panne : le crédit EST rendu (essais 3, rendu: true) mais la ligne reste « rendu-en-cours » (jamais « rembourse » sans trace), 0 mouvement',
            [r.rendu, (await essais(p)), await plus1('s4'), await etatsDe('s4')], [true, 3, 0, ['rendu-en-cours']]);
        const rp = await reparer(p, 's4');
        H.v('I-3 S4b. réparée (trace seule), réconciliation propre', [rp.repare, rp.creditRendu, (await essais(p)), await etatsDe('s4'), (await recon(p)).propre], [true, false, 3, ['rembourse'], true]);
    }
    // ═══ I-2 : le rattrapage d'O5 après une compensation puis l'écriture TARDIVE du débit ne rend pas une unité de trop
    {
        require('../argent/monter').routes(express.Router(), cfg, {}); const argent = registre.obtenir('argent'); const sec = { argent };
        const p = await inst({ essais: 3 }); await db.col('installations').updateOne({ _id: p.id }, { $set: { essaisInitiaux: 3 } });
        const scanId = new ObjectId(), cleDebit = `scan|installation:${p.id}|o5`;
        await MS.ouvrir({ scanId, porteur: p, cleDebit, maintenant: new Date(t.getTime() - 20 * 60e3) });
        let tardif = null;
        const ouvrir = paner((nom, m, ar) => { if (nom === 'mouvements' && m === 'insertOne' && ar[0] && ar[0].type === 'debit') { tardif = ar[0]; return { rejette: true }; } return null; });
        let echec = null; try { await muet(() => Lg.debiter(p, { scanId, cleIdempotence: cleDebit, maintenant: t }, cfg)); } catch (e) { echec = e.message; } finally { ouvrir(); }
        const apresCompensation = (await essais(p));
        await db.col('mouvements').insertOne({ ...tardif });                                                  // l'écriture d'origine arrive TARD, après la compensation
        await muet(() => MS.rattraper({ ...sec, maintenant: new Date(Date.now() + 2 * 3600e3) }));
        const m = await db.col('scans_en_cours').findOne({ _id: scanId });
        H.v('I-2. débit en panne puis compensé (essais 3), écriture tardive du débit, rattrapage O5 : AUCUNE unité de trop (essais 3, jamais 4), aucun mouvement +1, marque close avec son motif (`poche-deja-compensee`)',
            [echec, apresCompensation, (await essais(p)), await plus1(scanId), m.etat, m.issue], ['panne simulée', 3, 3, 0, 'echec', 'poche-deja-compensee']);
    }
    // ═══ M-1 : garde d'âge
    {
        const p = await ancien('m1'); await db.col('mouvements').updateOne({ scanId: 'm1', type: 'debit' }, { $set: { etat: 'rembourse' } });
        const r1 = await reparer(p, 'm1', { maintenant: new Date(t.getTime() + 60e3) });
        H.v('M-1a. un mouvement du porteur sur la même poche date de moins de N minutes : refusé (mouvement-recent), rien d\'écrit', [r1.repare, r1.raison, (await essais(p)), await plus1('m1')], [false, 'mouvement-recent', 2, 0]);
        const r2 = await reparer(p, 'm1');
        H.v('M-1b. au-delà du délai : réparé', [r2.repare, (await essais(p))], [true, 3]);
        H.v('M-1c. le délai est réglable et borné (config : 5 à 1440 minutes, défaut 15)', [cfg.lot.reparationAgeMs, lireConfig({ MONGODB_BASE: 'test_scratch', V2_HEBDO: '0', V2_REPARATION_AGE_MIN: '30' }).lot.reparationAgeMs], [15 * 60e3, 30 * 60e3]);
        let leve = 0; for (const v of ['4', '1441', 'x']) { try { lireConfig({ MONGODB_BASE: 'test_scratch', V2_HEBDO: '0', V2_REPARATION_AGE_MIN: v }); } catch (_) { leve++; } }
        H.v('   hors bornes ou non entier : configuration invalide', leve, 3);
    }
    {   // M-1d : un remboursement VIVANT (sa claim est récente) alors que le débit est ancien : la réparation attend, sinon elle rendrait le crédit en même temps que lui
        const p = await ancien('m1d'); await db.col('mouvements').updateOne({ scanId: 'm1d', type: 'debit' }, { $set: { etat: 'rendu-en-cours', le: new Date(t.getTime() - 24 * 3600e3) } });
        await db.col('mouvements').insertOne({ installationId: p.id, le: t, surface: 'extension', type: 'remboursement', delta: 0, poche: null, motif: 'vivant', scanId: 'm1d', etat: 'rembourse', cleIdempotence: 'rb|m1d' });
        const r = await reparer(p, 'm1d', { maintenant: new Date(t.getTime() + 60e3) });
        H.v('M-1d. la claim du scan date de moins de N minutes (remboursement vivant), le débit est ancien : refusé (mouvement-recent), aucun crédit', [r.repare, r.raison, (await essais(p))], [false, 'mouvement-recent', 2]);
    }
    {   // I-2b : une nouvelle tentative sous la MÊME clé, après une compensation, est un vrai débit : elle reste remboursable (la trace de compensation ne vise que le débit tardif de l'heure d'origine)
        const p = await inst({ essais: 3 }); await db.col('installations').updateOne({ _id: p.id }, { $set: { essaisInitiaux: 3 } });
        const scanId = new ObjectId(), cle = `scan|installation:${p.id}|i2b`;
        const ouvrir = paner((nom, m, ar) => nom === 'mouvements' && m === 'insertOne' && ar[0] && ar[0].type === 'debit' ? { rejette: true } : null);
        try { await muet(() => Lg.debiter(p, { scanId, cleIdempotence: cle, maintenant: t }, cfg)); } catch (_) { /* panne voulue */ } finally { ouvrir(); }
        const d2 = await muet(() => Lg.debiter(p, { scanId, cleIdempotence: cle, maintenant: new Date(t.getTime() + 3600e3) }, cfg));
        const r = await muet(() => Lg.rembourser(p, { x: 1 }, 'panne', { scanId, maintenant: new Date(t.getTime() + 3600e3) }, cfg));
        H.v('I-2b. nouvelle tentative sous la même clé après une compensation : débitée (essais 2) puis REMBOURSÉE (essais 3) — la compensation ne la vise pas', [d2.ok, r.rendu, (await essais(p))], [true, true, 3]);
    }
    // ═══ M-2 : une marque `reparation` laissée par un arrêt est reprenable quand elle est vieille ET que la preuve est refaite
    {
        const p = await ancien('m2a'); await db.col('mouvements').updateOne({ scanId: 'm2a', type: 'debit' }, { $set: { etat: 'rembourse', reparation: { le: new Date(tard.getTime() - 60e3), ecart: 0 } } });
        const r = await reparer(p, 'm2a');
        H.v('M-2a. marque RÉCENTE (une réparation peut être vivante) : refusé (reparation-en-cours), rien d\'écrit', [r.repare, r.raison, (await essais(p)), await plus1('m2a')], [false, 'reparation-en-cours', 2, 0]);
        const q = await ancien('m2b'); await db.col('mouvements').updateOne({ scanId: 'm2b', type: 'debit' }, { $set: { etat: 'rembourse', reparation: { le: t, ecart: 0 } } });
        const r2 = await reparer(q, 'm2b');
        H.v('M-2b. marque VIEILLE, aucun crédit écrit (écart 0) : reprise, crédit rendu UNE fois + trace', [r2.repare, r2.creditRendu, (await essais(q)), await plus1('m2b')], [true, true, 3, 1]);
        const s = await ancien('m2c'); await db.col('mouvements').updateOne({ scanId: 'm2c', type: 'debit' }, { $set: { etat: 'rembourse', reparation: { le: t, ecart: 0 } } });
        await prise(s, -1);                         // l'exécution interrompue avait déjà rendu le crédit
        const r3 = await reparer(s, 'm2c');
        H.v('M-2c. marque VIEILLE, crédit déjà écrit (écart +1) : la trace seule (jamais un second crédit)', [r3.repare, r3.creditRendu, (await essais(s)), await plus1('m2c')], [true, false, 3, 1]);
    }
    {   // M-2d : trois reprises SIMULTANÉES d'une même marque vieille : une seule passe, un seul crédit
        const p = await ancien('m2d'); await db.col('mouvements').updateOne({ scanId: 'm2d', type: 'debit' }, { $set: { etat: 'rembourse', reparation: { le: t, ecart: 0 } } });
        const rs = await Promise.all([reparer(p, 'm2d'), reparer(p, 'm2d'), reparer(p, 'm2d')]);
        H.v('M-2d. trois reprises simultanées de la même marque vieille : UNE seule réparée, un seul crédit (essais 3, jamais 4 ou 5), un seul mouvement', [rs.filter(r => r.repare).length, (await essais(p)), await plus1('m2d')], [1, 3, 1]);
    }
    // ═══ M-3 : MR (la trace de la claim ne reçoit rien : modifiedCount 0) et MS (le crédit est refusé : la marque est débloquée)
    {
        const p = await neuf('m3r'); const ouvrir = paner((nom, m, ar) => nom === 'mouvements' && m === 'updateOne' && ar[1] && ar[1].$set && ar[1].$set.delta === 1 ? { rendu: { modifiedCount: 0 } } : null);
        let r; try { r = await muet(() => Lg.rembourser(p, { x: 1 }, 'panne', { scanId: 'm3r', maintenant: t }, cfg)); } finally { ouvrir(); }
        H.v('M-3 MR. la claim ne reçoit pas sa trace (modifiedCount 0) : crédit rendu, la ligne reste « rendu-en-cours » (jamais « rembourse » sans trace)', [r.rendu, (await essais(p)), await etatsDe('m3r')], [true, 3, ['rendu-en-cours']]);
        // OFFRE-QUOTA : « l'accueil au plafond » est une garde de l'ANCIENNE poche accueil (le grand livre sait toujours rendre un débit d'avant la bascule) : le débit est fabriqué sur cette poche, comme le faisait le grand livre
        const c = await compte({ solde: { accueil: 24, achete: 0 } });
        await db.col('mouvements').insertOne({ compteId: c.id, le: t, surface: 'scanner', type: 'octroi', delta: 25, poche: 'accueil', motif: 'octroi', scanId: null, etat: 'debite', cleIdempotence: `octroi|${c.id}`, expireLe: new Date('2028-01-01') });
        await db.col('mouvements').insertOne({ compteId: c.id, le: t, surface: 'scanner', type: 'debit', delta: -1, poche: 'accueil', credit: { poche: 'accueil' }, motif: null, scanId: 'm3s', etat: 'rembourse', cleIdempotence: 'k-m3s', expireLe: new Date('2028-01-01') });
        const ouvre2 = paner((nom, m) => nom === 'comptes' && m === 'updateOne' ? { rendu: { modifiedCount: 0 } } : null);
        let rs; try { rs = await reparer(c, 'm3s'); } finally { ouvre2(); }
        const d = (await debitsDe('m3s'))[0];
        H.v('M-3 MS. le crédit est refusé (accueil au plafond) : réparation refusée, la marque est DÉBLOQUÉE (un nouvel appel peut passer), rien d\'écrit', [rs.repare, rs.raison, 'reparation' in d, await plus1('m3s')], [false, 'accueil-au-plafond', false, 0]);
    }
    // ═══ M-4 : une chaîne à plusieurs débits — le marqueur va sur le débit qui manquait RÉELLEMENT (choisi par l'opérateur), jamais deviné
    {
        const p = await ancien('m4', 2); const [A, B] = await debitsDe('m4');
        await Lg.rembourserLigne(p, A.cleIdempotence, 'panne', { maintenant: t }, cfg);                           // A : rendu normalement (crédit + trace)
        await db.col('mouvements').updateOne({ _id: B._id }, { $set: { etat: 'rembourse' } });                      // B : l'ancien état (rembourse, ni crédit ni trace)
        // tour 2 : A est reconnu rendu PAR SON DÉBIT (marqueur de poche + trace `debitId`) — la réparation vise B seul, sans désignation
        const avec = await reparer(p, 'm4');
        const [A2, B2] = await debitsDe('m4');
        H.v('M-4b. A rendu normalement, B ancien état : B est visé SANS désignation (A reconnu par son débit), le marqueur est sur B, pas sur A ; essais 3', [avec.repare, 'reparation' in B2, 'reparation' in A2, (await essais(p))], [true, true, false, 3]);
        // deux débits d'AVANT le tour 2, sans marqueur ni trace : rien ne les distingue, l'opérateur désigne
        const q = await ancien('m4c', 2); await db.col('mouvements').updateMany({ scanId: 'm4c', type: 'debit' }, { $set: { etat: 'rembourse' } });
        const sans = await reparer(q, 'm4c');
        H.v('M-4a. deux débits anciens sans preuve propre, sans désignation : refusé (choix-ambigu), rien d\'écrit', [sans.repare, sans.raison, (await essais(q))], [false, 'choix-ambigu', 1]);
    }
    await H.fermerBac(); H.bilan();
})().catch(e => { console.error('❌', e); process.exit(1); });
