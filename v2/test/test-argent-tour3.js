'use strict';
// MOYENS-B2a, TOUR 3 (le dernier) — relecture 3/3 : la limite exacte du marqueur, l'atomicité du crédit tenue par un banc, et les mineurs.
//   I-1 : le marqueur ne garde que les 200 DERNIÈRES identités par document de poche ; au-delà, un débit pris dont l'identité en est sortie n'a plus de preuve d'absence de crédit : la réparation REFUSE (`marqueur-sature`).
//   I-2 : UNE SEULE écriture sur le document de poche porte à la fois le crédit et l'identité du débit (espion sur la collection).
// OFFRE-QUOTA (2026-10-13) : la poche débitée est désormais le compteur du jour (`quota_jour`) ; les scénarios qui portent sur les ANCIENNES poches (accueil, achete, essai, hebdo) fabriquent leur débit à la main,
// comme le grand livre d'avant la bascule l'écrivait (le grand livre sait toujours les RENDRE) ; ceux qui portent sur le protocole de rendu le jouent sur la poche « jour » avec un vrai débit.
const { ObjectId } = require('mongoose').Types;
const H = require('./_harnais'); const db = require('../db'); const M = require('../modeles'); const { lireConfig } = require('../config');
const Lg = require('../argent/ledger'); const R = require('../argent/reconcilier'); const L = require('../argent/lot');
const { inst, compte, lire } = require('./_aide-argent'); const Q = require('./_aide-quota');
const cfg = Q.cfgGrand({ V2_HEBDO: '0' });                       // 1000 par jour : assez pour les 201 remboursements du marqueur (I-1)
const cfgOrdinaire = lireConfig({ MONGODB_BASE: 'test_scratch', V2_HEBDO: '0' });
const t = new Date('2026-10-08T10:00:00Z'), tard = new Date(t.getTime() + 4 * 3600e3);
const JOUR = '2026-10-08';
const restant = (p, c = cfg) => Q.restantDe(p, c, t);
const muet = async f => { const e0 = console.error; console.error = () => { }; try { return await f(); } finally { console.error = e0; } };
function paner(quand) {
    const orig = db.col;
    db.col = nom => new Proxy(orig(nom), { get(c, p) { const v = c[p]; if (typeof v !== 'function') return v;
        return (...a) => { const r = quand(nom, p, a); if (r && r.rejette) return Promise.reject(new Error('panne simulée')); if (r && r.apres) return v.apply(c, a).then(() => Promise.reject(new Error('réponse perdue'))); return v.apply(c, a); }; } });
    return () => { db.col = orig; };
}
const debitsDe = scanId => db.col('mouvements').find({ scanId, type: 'debit' }).sort({ _id: 1 }).toArray();
const plus1 = scanId => db.col('mouvements').countDocuments({ scanId, type: 'remboursement', delta: 1 });
const recon = (p, maintenant = tard, c = cfg) => R.reconcilier(p, { cfg: c, maintenant });
const reparer = (p, scanId, o = {}, c = cfg) => muet(() => Lg.reparerDebitRembourseSansMouvement(p, { scanId, maintenant: tard, ...o }, c));
const etatsDe = async scanId => (await debitsDe(scanId)).map(d => d.etat);
// une installation sans compte (3 par jour) et UN vrai débit « jour »
const neuf = async scanId => { const p = await inst({ essais: 3 }); await Lg.debiter(p, { scanId, cleIdempotence: `k-${scanId}`, maintenant: t }, cfgOrdinaire); return p; };
// un débit d'une ANCIENNE poche tel que le grand livre d'avant la bascule l'écrivait (avec priseLe quand on le demande : le protocole de rendu du tour 2)
const debitAncien = (base, poche, scanId, o = {}) => db.col('mouvements').insertOne({ ...base, le: t, surface: 'extension', type: 'debit', delta: -1, poche, credit: { poche }, motif: null, scanId, etat: 'debite', ...(o.sansCle ? {} : { cleIdempotence: `k-${scanId}` }), expireLe: new Date('2028-01-01'), ...(o.plus || {}) });
// un D0 crédité SANS trace (la trace est en panne), puis `n` autres remboursements sur le MÊME document de poche (le compteur du jour d'un compte gratuit à 1000)
async function saturer(n) {
    const p = await compte();
    await Lg.debiter(p, { scanId: `sat0-${n}`, cleIdempotence: `k-sat0-${n}`, maintenant: t }, cfg);
    const ouvrir = paner((nom, m, ar) => nom === 'mouvements' && m === 'insertOne' && ar[0] && ar[0].type === 'remboursement' ? { rejette: true } : null);
    try { await muet(() => Lg.rembourserLigne(p, `k-sat0-${n}`, 'panne', { maintenant: t }, cfg)); } finally { ouvrir(); }
    for (let i = 0; i < n; i++) { await Lg.debiter(p, { scanId: `sat-${n}-${i}`, cleIdempotence: `k-sat-${n}-${i}`, maintenant: t }, cfg); await Lg.rembourserLigne(p, `k-sat-${n}-${i}`, 'panne', { maintenant: t }, cfg); }
    return p;
}
const docJour = p => db.col('quota_jour').findOne({ porteur: `${p.type}:${p.id}`, jour: JOUR });

(async () => {
    await H.ouvrirBac('test-argent-tour3.js'); await M.creerIndex();
    // ═══ I-1 : la borne de 200 identités
    {
        const p = await saturer(200); const doc = await docJour(p); const d0 = (await debitsDe('sat0-200'))[0];
        const dernier = (await debitsDe('sat-200-199'))[0];
        H.v('I-1a. 201 remboursements sur le même document : le 201e réussit (compteur à 0, restant 1000), le marqueur garde les 200 DERNIÈRES identités (D0, la plus ancienne, en est sortie ; la dernière y est)',
            [await restant(p), doc.creditsRendus.length, doc.creditsRendus.some(x => String(x) === String(d0._id)), doc.creditsRendus.some(x => String(x) === String(dernier._id))], [1000, 200, false, true]);
        const r = await reparer(p, 'sat0-200');
        H.v('I-1b. D0 (crédit ÉCRIT, trace perdue) dont l\'identité est sortie du marqueur plein : la réparation REFUSE (`marqueur-sature`), AUCUN second crédit (restant 1000, jamais 1001), aucune trace',
            [r.repare, r.raison, await restant(p), await plus1('sat0-200'), await etatsDe('sat0-200')], [false, 'marqueur-sature', 1000, 0, ['rendu-en-cours']]);
        const rc = await recon(p);
        H.v('I-1c. `reconcilier` liste la ligne AVEC son geste (vérification à la main du grand livre quand la simulation refuse « marqueur-sature »)', [rc.rendusEchoues.length, rc.rendusEchoues.every(x => /marqueur-sature/.test(String(x.geste || '')))], [1, true]);
        const q = await saturer(199); const rq = await reparer(q, 'sat0-199');
        H.v('I-1d. contrôle : à 199 autres remboursements D0 est encore dans le marqueur : trace SEULE (restant 1000), ligne « rembourse »', [rq.repare, rq.creditRendu, await restant(q), await plus1('sat0-199'), await etatsDe('sat0-199')], [true, false, 1000, 1, ['rembourse']]);
    }
    // ═══ I-2 : UNE SEULE écriture sur le document de poche porte à la fois le crédit ET l'identité du débit
    {
        const ecritures = (cas, quand) => { const orig = db.col, v = [];
            db.col = nom => new Proxy(orig(nom), { get(c, k) { const f = c[k]; if (typeof f !== 'function') return f; return (...a) => { if (quand(nom) && ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne'].includes(k)) v.push({ nom, k, maj: a[1] }); return f.apply(c, a); }; } });
            return { v, fin: () => { db.col = orig; } }; };
        for (const [nom, fabrique, collection, champ] of [
            ['installation, poche jour', async () => neuf('i2a'), 'quota_jour', 'count'],
            ['compte, ancienne poche accueil', async () => { const c = await compte({ solde: { accueil: 4, achete: 0 } }); await debitAncien({ compteId: c.id }, 'accueil', 'i2b'); return c; }, 'comptes', 'solde.accueil'],
            ['installation, ancienne poche achete', async () => { const p = await inst({ essais: 0, achete: 2 }); await debitAncien({ installationId: p.id }, 'achete', 'i2c'); return p; }, 'installations', 'achete']]) {
            const p = await fabrique(); const scan = (await db.col('mouvements').findOne({ ...(p.type === 'compte' ? { compteId: p.id } : { installationId: p.id }), type: 'debit' })).scanId;
            const esp = ecritures(nom, c => c === collection);
            try { await muet(() => Lg.rembourserLigne(p, `k-${scan}`, 'panne', { maintenant: t }, cfgOrdinaire)); } finally { esp.fin(); }
            const sur = esp.v.filter(x => x.nom === collection);
            H.v(`I-2. ${nom} : UNE seule écriture sur le document de poche pendant le remboursement, et elle porte le $inc du crédit ET le $push de l'identité du débit`,
                [sur.length, sur.length === 1 && Boolean(sur[0].maj.$inc) && champ in sur[0].maj.$inc, sur.length === 1 && Boolean(sur[0].maj.$push && sur[0].maj.$push.creditsRendus)], [1, true, true]);
        }
    }
    // ═══ M-2 : `rendu-echoue` dont le crédit EST écrit (réponse perdue après le $inc) : même preuve, trace + « rembourse » ; sans preuve il reste listé
    {
        const p = await neuf('r1'); const ouvrir = paner((nom, m) => nom === 'quota_jour' && m === 'updateOne' ? { apres: true } : null);
        let rl; try { rl = await muet(() => Lg.rembourserLigne(p, 'k-r1', 'panne', { maintenant: t }, cfgOrdinaire)); } finally { ouvrir(); }
        const avant = await recon(p, tard, cfgOrdinaire);
        H.v('M-2a. réponse du crédit perdue : le crédit EST écrit (restant 3), la ligne est « rendu-echoue » (le quota du jour n\'a pas de témoin d\'écart agrégé : aucun écart listé)', [rl.rendu, await restant(p, cfgOrdinaire), await etatsDe('r1'), avant.ecarts.map(e => e.ecart)], [false, 3, ['rendu-echoue'], []]);
        const r = await reparer(p, 'r1', {}, cfgOrdinaire);
        H.v('M-2b. la réparation prouve le crédit par le marqueur de CE débit : trace seule (restant 3, jamais 4), ligne « rembourse », réconciliation propre', [r.repare, r.creditRendu, await restant(p, cfgOrdinaire), await plus1('r1'), await etatsDe('r1'), (await recon(p, tard, cfgOrdinaire)).propre], [true, false, 3, 1, ['rembourse'], true]);
        const q = await neuf('r2'); const ouvre2 = paner((nom, m) => nom === 'quota_jour' && m === 'updateOne' ? { rejette: true } : null);
        try { await muet(() => Lg.rembourserLigne(q, 'k-r2', 'panne', { maintenant: t }, cfgOrdinaire)); } finally { ouvre2(); }
        const rq = await reparer(q, 'r2', {}, cfgOrdinaire); const rcq = await recon(q, tard, cfgOrdinaire);
        H.v('M-2c. `rendu-echoue` SANS preuve de crédit (le crédit a échoué avant d\'écrire) : jamais réparé (restant 2), reste listé AVEC son geste', [rq.repare, rq.raison, await restant(q, cfgOrdinaire), rcq.rendusEchoues.length, rcq.rendusEchoues.every(x => Boolean(x.geste))], [false, 'rien-a-reparer', 2, 1, true]);
    }
    // ═══ M-3 : poche hebdo (ANCIENNE) dont le document a disparu : la ligne se CLÔT (`semaine-expiree`), sans crédit
    {
        const c = await compte({ solde: { accueil: 0, achete: 0 } });
        const d = { compteId: c.id, le: t, surface: 'scanner', type: 'debit', delta: -1, poche: 'hebdo', credit: { poche: 'hebdo', semaineIso: '2026-W41' }, motif: null, scanId: 'h1', etat: 'rendu-en-cours', priseLe: t, cleIdempotence: 'k-h1', expireLe: new Date('2028-01-01') };
        await db.col('mouvements').insertOne(d);
        const r = await reparer(c, 'h1');
        const ligne = await db.col('mouvements').findOne({ scanId: 'h1', type: 'debit' });
        H.v('M-3. débit hebdo `rendu-en-cours` dont le document hebdo a disparu : clos sans crédit (`semaine-expiree`), ligne « rembourse », réconciliation propre', [r.repare, r.creditRendu, r.motif, ligne.etat, ligne.clotureSansCredit, (await recon(c)).propre], [true, false, 'semaine-expiree', 'rembourse', 'semaine-expiree', true]);
    }
    // ═══ M-4 : `annulerUnite` suit le protocole (priseLe, marqueur de poche, trace par debitId)
    {
        const p = await compte(); await Q.poserRestant(`compte:${p.id}`, 1, { limite: 10, jour: JOUR });      // une seule unité devant soi : le supplément de 2 unités manque
        await muet(() => L.debiterSupplement(p, { scanId: 'a1', unites: 2, cleIdempotence: 'sup-a1', maintenant: t }, cfgOrdinaire));
        const u = await db.col('mouvements').findOne({ compteId: p.id, scanId: 'a1', type: 'debit' }); const doc = await docJour(p); const tr = await db.col('mouvements').findOne({ compteId: p.id, motif: 'supplement-annule' });
        H.v('M-4. unité annulée : `priseLe` posé, son identité est dans le marqueur de la poche, sa trace porte `debitId`, unité rendue (restant 1)',
            [Boolean(u && u.priseLe), Boolean(doc.creditsRendus && doc.creditsRendus.some(x => String(x) === String(u._id))), Boolean(tr && String(tr.debitId) === String(u._id)), await restant(p, cfgOrdinaire)], [true, true, true, 1]);
    }
    // ═══ M-6 (i) : un débit SANS clé d'idempotence portant une trace anonyme d'ancien protocole ne fait pas ignorer un AUTRE débit sans trace (ANCIENNE poche essai)
    {
        const p = await inst({ essais: 2 }); await db.col('installations').updateOne({ _id: p.id }, { $set: { essaisInitiaux: 3 } });
        await debitAncien({ installationId: p.id }, 'essai', 'm6', { plus: { cleIdempotence: 'k-m6y', etat: 'rembourse' } });                  // Y : ancien état, rembourse, ni crédit ni trace
        await debitAncien({ installationId: p.id }, 'essai', 'm6', { sansCle: true, plus: { etat: 'rembourse' } });                              // X : sans clé
        await db.col('mouvements').insertOne({ installationId: p.id, le: t, surface: 'extension', type: 'remboursement', delta: 1, poche: 'essai', motif: 'ancien', scanId: 'm6', etat: 'rembourse', cleIdempotence: 'rb|m6' });
        const r = await reparer(p, 'm6');
        H.v('M-6 (i). débit sans clé (hors candidats) + trace anonyme : le débit Y sans trace est QUAND MÊME réparé (essais 3), la trace anonyme ne lui est pas attribuée', [r.repare, r.creditRendu, (await lire(p)).essais], [true, true, 3]);
    }
    // ═══ M-6 (ii) : installation liée au moment du remboursement, déliée ensuite : le crédit est sur le document du COMPTE — la réparation ne le recrédite pas sur l'installation (ANCIENNE poche essai → accueil)
    {
        const c = await compte({ solde: { accueil: 5, achete: 0 } }); const p = await inst({ essais: 2 }); await db.col('installations').updateOne({ _id: p.id }, { $set: { essaisInitiaux: 3 } });
        await debitAncien({ installationId: p.id }, 'essai', 'm6b', { plus: { priseLe: new Date(t.getTime() - 3600e3) } });
        await db.col('installations').updateOne({ _id: p.id }, { $set: { compteId: c.id } });                       // liée juste avant le remboursement : le crédit ira au compte
        const ouvrir = paner((nom, m, ar) => nom === 'mouvements' && m === 'insertOne' && ar[0] && ar[0].type === 'remboursement' ? { rejette: true } : null);
        try { await muet(() => Lg.rembourserLigne(p, 'k-m6b', 'panne', { maintenant: t }, cfg)); } finally { ouvrir(); }
        const accueil = (await lire(c)).solde.accueil;
        await db.col('installations').updateOne({ _id: p.id }, { $set: { compteId: null } });                       // puis déliée (O3)
        const r = await reparer(p, 'm6b');
        H.v('M-6 (ii). crédit écrit sur le COMPTE (accueil 6), installation déliée ensuite : la réparation REFUSE (`credit-sur-compte-lie`), l\'installation n\'est pas créditée une seconde fois (essais 2)',
            [accueil, r.repare, r.raison, (await lire(p)).essais, (await lire(c)).solde.accueil], [6, false, 'credit-sur-compte-lie', 2, 6]);
    }
    await H.fermerBac(); H.bilan();
})().catch(e => { console.error('❌', e); process.exit(1); });
