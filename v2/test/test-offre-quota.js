'use strict';
// OFFRE-QUOTA — le quota QUOTIDIEN par offre, à la place des poches de crédits (décision du testeur, 2026-10-13). Base : la base EN MÉMOIRE du banc (INT2). Aucun appel réseau, aucun Stripe.
// Sans compte 3/jour · compte gratuit (vérifié) 10/jour · Pro : plafond technique (200 par défaut), jamais montré. Jour = jour civil de Paris. Ce qui compte : une analyse RENDUE.
const H = require('./_harnais'); const db = require('../db'); const M = require('../modeles'); const { lireConfig } = require('../config');
const Lg = require('../argent/ledger'); const Of = require('../argent/offre'); const Lot = require('../argent/lot'); const S = require('../argent/solde'); const Pay = require('../argent/paiement'); const Hr = require('../argent/heritage');
const { compte, inst, lire } = require('./_aide-argent');
const cfg = lireConfig({ MONGODB_BASE: 'test_scratch' });
const cfgAvec = o => lireConfig({ MONGODB_BASE: 'test_scratch', ...o });
const t = new Date('2026-10-13T10:00:00Z');
const JOUR = '2026-10-13';
let nCle = 0; const cle = () => `oq-${++nCle}`;
const cnt = async (p, jour = JOUR) => { const d = await db.col('quota_jour').findOne({ porteur: `${p.type}:${p.id}`, jour }); return d ? d.count : null; };
const debiterN = async (p, n, maintenant = t, c = cfg) => { const r = []; for (let i = 0; i < n; i++) r.push(await Lg.debiter(p, { scanId: cle(), cleIdempotence: cle(), maintenant }, c)); return r; };
const issue = r => (r.ok ? 'ok' : r.code);
const abo = (jusquAu, actif = true) => ({ actif, quotaMensuel: 100, moisCle: '2026-10', restant: 100, jusquAu });
const futur = new Date('2027-06-01T00:00:00Z');

(async () => {
    await H.ouvrirBac('test-offre-quota.js'); await M.creerIndex();

    // ── 1. la configuration : les trois quotas, leurs bornes, et l'ordre des poches
    H.v('1. défauts : sans compte 3, gratuit 10, plafond Pro 200', [cfg.quotas.sansCompte, cfg.quotas.gratuit, cfg.quotas.proPlafond], [3, 10, 200]);
    H.v('   variables V2_QUOTA_SANS_COMPTE / GRATUIT / PRO_PLAFOND honorées', (c => [c.quotas.sansCompte, c.quotas.gratuit, c.quotas.proPlafond])(cfgAvec({ V2_QUOTA_SANS_COMPTE: '5', V2_QUOTA_GRATUIT: '12', V2_QUOTA_PRO_PLAFOND: '50' })), [5, 12, 50]);
    const leve = o => { try { cfgAvec(o); return null; } catch (e) { return e.message; } };
    H.v('   valeurs hors bornes ou illisibles : configuration invalide (0, -1, 1001, abc, 2.5, espaces)', ['0', '-1', '1001', 'abc', '2.5', '  '].map(v => /configuration invalide/.test(leve({ V2_QUOTA_GRATUIT: v }) || '')), [true, true, true, true, true, true]);
    H.v('   idem pour les deux autres variables', [leve({ V2_QUOTA_SANS_COMPTE: '0' }), leve({ V2_QUOTA_PRO_PLAFOND: '1001' })].map(m => /configuration invalide/.test(m || '')), [true, true]);
    H.v('   l\'ordre des poches est [jour]', cfg.ordrePoches, ['jour']);
    H.v('   V2_ORDRE_POCHES=jour accepté', cfgAvec({ V2_ORDRE_POCHES: 'jour' }).ordrePoches, ['jour']);
    H.v('   une ancienne poche dans l\'ordre (achete, accueil, essai, hebdo, abonnement) : configuration invalide', ['achete', 'accueil', 'essai', 'hebdo', 'abonnement', 'jour,achete'].map(v => /n'est plus débitée/.test(leve({ V2_ORDRE_POCHES: v }) || '')), [true, true, true, true, true, true]);
    H.v('   poche inconnue, doublon, ordre sans jour : configuration invalide', ['x', 'jour,jour', ','].map(v => /configuration invalide/.test(leve({ V2_ORDRE_POCHES: v }) || 'aucune erreur')), [true, true, true]);

    // ── 2. les trois offres
    {
        const p = await inst({ essais: 0, achete: 9 });        // les anciens documents ne comptent pour rien : 3 par jour quand même
        const rs = await debiterN(p, 4);
        H.v('2a. sans compte : 3 analyses puis QUOTA (essais 0 et achete 9 en base n\'y changent rien)', rs.map(issue), ['ok', 'ok', 'ok', 'QUOTA']);
        H.v('    le crédit pris porte la poche « jour », son jour de Paris et son compteur', rs[0].credit, { poche: 'jour', jour: JOUR, porteurCle: `installation:${p.id}` });
        H.v('    compteur du jour 3, jamais 4 (le jeton du refus est rendu)', await cnt(p), 3);
        const o = await Of.offre(p, cfg, t);
        H.v('    offre : sans-compte, restant 0, remise à zéro 14 octobre 00:00+02:00', o, { nom: 'sans-compte', restant: 0, remiseAZero: '2026-10-14T00:00:00+02:00' });
        const q = await inst({ essais: 3 }); const seq = [];
        for (let i = 0; i < 4; i++) { seq.push((await Of.offre(q, cfg, t)).restant); await debiterN(q, 1); }
        H.v('    restant : 3, 2, 1, 0', seq, [3, 2, 1, 0]);
        const doc = await db.col('mouvements').findOne({ installationId: p.id, type: 'debit' });
        H.v('    le mouvement de débit porte poche « jour »', [doc.poche, doc.credit.poche, doc.delta], ['jour', 'jour', -1]);
    }
    {
        const p = await compte({ solde: { accueil: 0, achete: 0 } });
        const rs = await debiterN(p, 11);
        H.v('2b. compte gratuit (vérifié) : 10 analyses puis QUOTA (accueil 0 en base)', [rs.filter(r => r.ok).length, issue(rs[10])], [10, 'QUOTA']);
        H.v('    offre : gratuit, restant 0', await Of.offre(p, cfg, t), { nom: 'gratuit', restant: 0, remiseAZero: '2026-10-14T00:00:00+02:00' });
        const q = await compte(); H.v('    offre neuve : gratuit, restant 10', (await Of.offre(q, cfg, t)).restant, 10);
    }
    {
        const p = await compte({ abonnement: abo(futur) });
        const c5 = cfgAvec({ V2_QUOTA_PRO_PLAFOND: '5' }); const rs = await debiterN(p, 6, t, c5);
        H.v('2c. Pro (abonnement actif et en cours) : le plafond technique (5 ici) puis QUOTA', [rs.filter(r => r.ok).length, issue(rs[5])], [5, 'QUOTA']);
        H.v('    offre Pro : restant null (le plafond ne se montre jamais), même plafond atteint', await Of.offre(p, c5, t), { nom: 'pro', restant: null, remiseAZero: '2026-10-14T00:00:00+02:00' });
        const q = await compte({ abonnement: abo(futur) }); const r200 = await debiterN(q, 201);
        H.v('    plafond technique par défaut : 200 analyses puis QUOTA (dénominateur 201)', [r200.filter(r => r.ok).length, issue(r200[200]), await cnt(q)], [200, 'QUOTA', 200]);
    }

    // ── 3. l'offre se relit EN BASE, et une garde s'écrit par ce qu'elle autorise
    {
        const nv = await compte({ verifie: false, solde: { accueil: 25, achete: 4 } }); nv.compte = { ...nv.compte, verifie: true };   // l'instantané ment : « vérifié »
        H.v('3a. compte NON vérifié en base (instantané « vérifié ») : VERIFICATION, aucun compteur', [issue((await debiterN(nv, 1))[0]), await cnt(nv)], ['VERIFICATION', null]);
        H.v('    offre : gratuit, restant 0 (jamais 10)', (await Of.offre(nv, cfg, t)), { nom: 'gratuit', restant: 0, remiseAZero: '2026-10-14T00:00:00+02:00' });
        const v = await compte({ verifie: true }); v.compte = { ...v.compte, verifie: false };      // l'instantané dit « non vérifié », la base dit vérifié
        H.v('    l\'inverse : vérifié en base, instantané périmé : l\'offre vient de la base (débit permis)', issue((await debiterN(v, 1))[0]), 'ok');
        const ex = await compte({ abonnement: abo(new Date('2026-10-13T09:59:59Z')) });
        const rex = await debiterN(ex, 11);
        H.v('3b. abonnement EXPIRÉ (jusquAu passé d\'une seconde) : gratuit, 10 puis QUOTA', [rex.filter(r => r.ok).length, issue(rex[10]), (await Of.offre(ex, cfg, t)).nom], [10, 'QUOTA', 'gratuit']);
        const ina = await compte({ abonnement: abo(futur, false) });
        H.v('    abonnement actif:false : gratuit', (await Of.offre(ina, cfg, t)).nom, 'gratuit');
        const pile = await compte({ abonnement: abo(t) });
        H.v('    jusquAu == maintenant : plus actif (strictement après)', (await Of.offre(pile, cfg, t)).nom, 'gratuit');
        const periph = await compte(); periph.compte = { ...periph.compte, abonnement: abo(futur) };      // instantané « Pro », base « gratuit »
        const rp = await debiterN(periph, 11);
        H.v('    instantané « Pro » mais base gratuite : gratuit (10 puis QUOTA) — l\'offre n\'est jamais lue sur l\'instantané', [rp.filter(r => r.ok).length, issue(rp[10]), (await Of.offre(periph, cfg, t)).nom], [10, 'QUOTA', 'gratuit']);
        const reel = await compte({ abonnement: abo(futur) }); reel.compte = { ...reel.compte, abonnement: null };      // base « Pro », instantané sans abonnement
        const rr = await debiterN(reel, 11, t, cfgAvec({ V2_QUOTA_PRO_PLAFOND: '12' }));
        H.v('    base « Pro » (plafond 12), instantané sans abonnement : Pro (11 permis)', [rr.filter(r => r.ok).length, (await Of.offre(reel, cfg, t)).nom], [11, 'pro']);
        const fantome = { type: 'compte', id: new (require('mongoose').Types.ObjectId)(), compte: null, installation: null, surface: 'scanner', administrateur: false };
        H.v('3c. compte introuvable : QUOTA, aucun compteur, offre « sans-compte » à 0 (jamais plus large)', [issue((await debiterN(fantome, 1))[0]), await cnt(fantome), await Of.offre(fantome, cfg, t)], ['QUOTA', null, { nom: 'sans-compte', restant: 0, remiseAZero: '2026-10-14T00:00:00+02:00' }]);
        const liee = await inst({ compteId: (await compte()).id });
        H.v('    installation LIÉE à un compte (porteur installation périmé) : QUOTA, rien n\'est pris', [issue((await debiterN(liee, 1))[0]), await cnt(liee)], ['QUOTA', null]);
        H.v('    type de porteur inconnu : QUOTA, aucun mouvement', [issue((await debiterN({ type: 'x', id: 'z', compte: null, installation: null, surface: 'scanner', administrateur: false }, 1))[0]), await db.col('mouvements').countDocuments({ installationId: 'z' })], ['QUOTA', 0]);
    }

    // ── 4. minuit de Paris : le compteur repart (hiver, été, journée de 23 h, journée de 25 h)
    {
        const p = await compte(); const avant = new Date('2026-10-13T21:59:59Z'), apres = new Date('2026-10-13T22:00:00Z');
        await debiterN(p, 10, avant);
        H.v('4a. été : 10 pris à 23:59:59 Paris ; l\'11e (même seconde) refusée', issue((await debiterN(p, 1, avant))[0]), 'QUOTA');
        H.v('    à 00:00:00 Paris (22:00:00Z) : le compteur repart (ok, restant 9 ; le compteur de la veille intact à 10)', [issue((await debiterN(p, 1, apres))[0]), (await Of.offre(p, cfg, apres)).restant, await cnt(p, '2026-10-13'), await cnt(p, '2026-10-14')], ['ok', 9, 10, 1]);
        const h = await compte(); const hAvant = new Date('2026-01-13T22:59:59Z'), hApres = new Date('2026-01-13T23:00:00Z');
        await debiterN(h, 10, hAvant);
        H.v('    hiver : refus à 23:59:59 Paris (22:59:59Z), reprise à 00:00:00 (23:00:00Z)', [issue((await debiterN(h, 1, hAvant))[0]), issue((await debiterN(h, 1, hApres))[0]), (await Of.offre(h, cfg, hApres)).remiseAZero], ['QUOTA', 'ok', '2026-01-15T00:00:00+01:00']);
        const j = await compte(); await debiterN(j, 10, new Date('2026-07-01T20:30:00Z'));
        H.v('    22:30Z en été est déjà le lendemain à Paris : le compteur du jour UTC ne compte pas (reprise permise)', issue((await debiterN(j, 1, new Date('2026-07-01T22:30:00Z')))[0]), 'ok');
        // journée de 23 h : dimanche 29 mars 2026, du 28 à 23:00Z au 29 à 22:00Z
        const m = await inst(); await debiterN(m, 3, new Date('2026-03-28T23:00:00Z'));
        H.v('4b. journée de 23 h (29 mars) : 3 pris dès 00:00 ; refus à 23:59:59 (21:59:59Z) ; reprise à 22:00:00Z', [issue((await debiterN(m, 1, new Date('2026-03-29T21:59:59Z')))[0]), issue((await debiterN(m, 1, new Date('2026-03-29T22:00:00Z')))[0])], ['QUOTA', 'ok']);
        const veille = await inst(); await debiterN(veille, 3, new Date('2026-03-28T22:59:59Z'));
        H.v('    la veille finit à 22:59:59Z : 00:00 Paris (23:00Z) repart', issue((await debiterN(veille, 1, new Date('2026-03-28T23:00:00Z')))[0]), 'ok');
        // journée de 25 h : dimanche 25 octobre 2026, du 24 à 22:00Z au 25 à 23:00Z
        const n = await inst(); await debiterN(n, 3, new Date('2026-10-24T22:00:00Z'));
        H.v('4c. journée de 25 h (25 oct.) : refus à 22:00Z et 22:59:59Z du 25 (un décalage fixe +2 aurait déjà remis à zéro) ; reprise à 23:00:00Z', [issue((await debiterN(n, 1, new Date('2026-10-25T22:00:00Z')))[0]), issue((await debiterN(n, 1, new Date('2026-10-25T22:59:59Z')))[0]), issue((await debiterN(n, 1, new Date('2026-10-25T23:00:00Z')))[0])], ['QUOTA', 'QUOTA', 'ok']);
        const n2 = await inst(); await debiterN(n2, 3, new Date('2026-10-24T21:59:59Z'));
        H.v('    la veille de la journée de 25 h finit à 21:59:59Z : 22:00Z repart', issue((await debiterN(n2, 1, new Date('2026-10-24T22:00:00Z')))[0]), 'ok');
    }

    // ── 5. rendre : un introuvable, une panne, un prix illisible définitif rendent l'unité AU JOUR OÙ ELLE A ÉTÉ PRISE
    {
        const p = await compte(); const d = await Lg.debiter(p, { scanId: 'r1', cleIdempotence: 'r1', maintenant: t }, cfg);
        H.v('5a. introuvable : l\'unité rendue au compteur du jour, trace +1 sur la poche « jour »', [d.ok, await cnt(p)], [true, 1]);
        const r = await Lg.rembourser(p, d.credit, 'introuvable', { scanId: 'r1', maintenant: t, compteur: 'panne' }, cfg);
        const tr = await db.col('mouvements').findOne({ compteId: p.id, type: 'remboursement', delta: 1 });
        H.v('    remboursée : compteur 0, restant 10, trace', [r.rendu, await cnt(p), (await Of.offre(p, cfg, t)).restant, tr && tr.poche], [true, 0, 10, 'jour']);
        const r2 = await Lg.rembourser(p, d.credit, 'introuvable', { scanId: 'r1', maintenant: t }, cfg);
        H.v('    une seconde fois : refusée (deja-rembourse), le compteur ne passe jamais sous 0', [r2.rendu, r2.raisonNonRembourse, await cnt(p)], [false, 'deja-rembourse', 0]);
        const dp = await Lg.debiter(p, { scanId: 'r2', cleIdempotence: 'r2', maintenant: t }, cfg);
        const rp = await Lg.rembourser(p, { poche: null }, 'sans-prix', { scanId: 'r2', maintenant: t, compteur: 'sans-prix' }, cfg);
        H.v('5b. prix illisible définitif (sans-prix) : rendu, compteur 0', [dp.ok, rp.rendu, await cnt(p)], [true, true, 0]);
        const dl = await Lg.debiter(p, { scanId: 'r3', cleIdempotence: 'r3', maintenant: t }, cfg);
        const rl = await Lg.rembourserLigne(p, dl.cle, 'panne-SERVEUR', { maintenant: t }, cfg);
        H.v('5c. panne rendue par la ligne (reprise unité par unité) : compteur 0', [rl.rendu, await cnt(p)], [true, 0]);
        // après minuit : l'unité de la VEILLE rendue ne crée pas de quota en plus AUJOURD'HUI
        const q = await compte(); const veille = new Date('2026-10-13T21:00:00Z'), lendemain = new Date('2026-10-13T22:30:00Z');
        const dq = await Lg.debiter(q, { scanId: 'r4', cleIdempotence: 'r4', maintenant: veille }, cfg);
        await Lg.debiter(q, { scanId: 'r5', cleIdempotence: 'r5', maintenant: lendemain }, cfg);        // une analyse prise après minuit
        const rq = await Lg.rembourser(q, dq.credit, 'introuvable', { scanId: 'r4', maintenant: new Date('2026-10-13T22:45:00Z') }, cfg);
        H.v('5d. débit à 23:00 Paris, remboursé à 00:45 Paris : rendu au jour du débit (13 : 0), le compteur du 14 reste à 1, restant du 14 = 9 (pas 10)', [rq.rendu, await cnt(q, '2026-10-13'), await cnt(q, '2026-10-14'), (await Of.offre(q, cfg, lendemain)).restant], [true, 0, 1, 9]);
        const q2 = await compte(); const dq2 = await Lg.debiter(q2, { scanId: 'r6', cleIdempotence: 'r6', maintenant: veille }, cfg);
        const rq2 = await Lg.rembourser(q2, dq2.credit, 'introuvable', { scanId: 'r6', maintenant: new Date('2026-10-13T22:45:00Z') }, cfg);
        H.v('    sans débit le lendemain : aucun compteur du 14 n\'est créé par le remboursement', [rq2.rendu, await cnt(q2, '2026-10-13'), await cnt(q2, '2026-10-14')], [true, 0, null]);
        // l'installation liée entre le débit et le remboursement : l'unité retourne là où elle a été prise
        const i = await inst(); const di = await Lg.debiter(i, { scanId: 'r7', cleIdempotence: 'r7', maintenant: t }, cfg);
        await db.col('installations').updateOne({ _id: i.id }, { $set: { compteId: (await compte()).id } });
        const ri = await Lg.rembourser(i, di.credit, 'introuvable', { scanId: 'r7', maintenant: t }, cfg);
        H.v('5e. installation liée entre-temps : l\'unité retourne au compteur de l\'INSTALLATION (pas au compte), compteur 0', [ri.rendu, await cnt(i)], [true, 0]);
        // un crédit forgé vers le compteur d'un autre porteur ne rend rien
        const a = await compte(), b = await compte(); await debiterN(b, 2);
        const forge = await Lg.rendrePoche(a, { poche: 'jour', jour: JOUR, porteurCle: `compte:${b.id}` }, cfg, t);
        H.v('5f. crédit forgé visant le compteur d\'un autre porteur : refusé, le compteur de l\'autre intact', [forge.rendu, await cnt(b)], [false, 2]);
        // le marqueur d'identité du débit empêche un second crédit du MÊME débit, par n'importe quel chemin
        const c = await compte(); const dc = await Lg.debiter(c, { scanId: 'r8', cleIdempotence: 'r8', maintenant: t }, cfg); await debiterN(c, 2);
        const mv = await db.col('mouvements').findOne({ cleIdempotence: 'r8' });
        const x1 = await Lg.rendrePoche(c, dc.credit, cfg, t, mv._id), x2 = await Lg.rendrePoche(c, dc.credit, cfg, t, mv._id);
        H.v('5g. même débit rendu deux fois par deux chemins : un seul crédit (poche-deja-compensee), compteur 2', [x1.rendu, x2.rendu, x2.raison, await cnt(c)], [true, false, 'poche-deja-compensee', 2]);
    }

    // ── 6. un lot : ceil(N/10) unités, tout ou rien
    {
        H.v('6a. coût d\'un lot de 23 cartes = 3 ; de 10 = 1 ; de 11 = 2', [Lot.coutDuLot(23, cfg), Lot.coutDuLot(10, cfg), Lot.coutDuLot(11, cfg)], [3, 1, 2]);
        const p = await compte(); const d = await Lg.debiter(p, { scanId: 'l1', cleIdempotence: 'l1', maintenant: t }, cfg);
        const s = await Lot.debiterSupplement(p, { scanId: 'l1', unites: Lot.coutDuLot(23, cfg) - 1, cleIdempotence: 'l1|supplement', maintenant: t }, cfg);
        H.v('    lot de 23 : 1 débit + 2 suppléments = 3 unités du compteur', [d.ok, s.ok, await cnt(p), (await Of.offre(p, cfg, t)).restant], [true, true, 3, 7]);
        const rl = await Lg.rembourserLot(p, [d.credit, ...s.credits], 'lot-introuvable', { scanId: 'l1', maintenant: t }, cfg);
        H.v('    le lot entièrement introuvable rend ses 3 unités', [rl.rendu, await cnt(p)], [true, 0]);
        const q = await compte(); await debiterN(q, 9);
        const dq = await Lg.debiter(q, { scanId: 'l2', cleIdempotence: 'l2', maintenant: t }, cfg);
        const sq = await Lot.debiterSupplement(q, { scanId: 'l2', unites: 2, cleIdempotence: 'l2|supplement', maintenant: t }, cfg);
        H.v('6b. lot de 23 à la 10e unité restante : le supplément manque -> QUOTA, tout ou rien (le compteur revient à 10 avec le débit initial, puis l\'appelant le rend)', [dq.ok, sq.ok, sq.code, await cnt(q)], [true, false, 'QUOTA', 10]);
        const r = await Lg.rembourser(q, dq.credit, 'lot-trop-grand', { scanId: 'l2', maintenant: t, compteur: 'lot-trop-grand' }, cfg);
        H.v('    le débit initial rendu : compteur 9', [r.rendu, await cnt(q)], [true, 9]);
    }

    // ── 7. la course : jamais plus que la limite, quelle que soit la simultanéité
    {
        const a = await compte(); await debiterN(a, 9);
        const deux = await Promise.all([0, 1].map(i => Lg.debiter(a, { scanId: cle(), cleIdempotence: cle(), maintenant: t }, cfg)));
        H.v('7a. deux analyses simultanées à la DERNIÈRE unité : une seule passe, compteur 10', [deux.filter(r => r.ok).length, deux.filter(r => !r.ok).map(r => r.code), await cnt(a)], [1, ['QUOTA'], 10]);
        const b = await compte(); const trente = await Promise.all(Array.from({ length: 30 }, () => Lg.debiter(b, { scanId: cle(), cleIdempotence: cle(), maintenant: t }, cfg)));
        H.v('7b. 30 simultanées sur un compteur NEUF (course de première insertion) : 10 passent, 20 QUOTA, compteur 10', [trente.filter(r => r.ok).length, trente.filter(r => r.code === 'QUOTA').length, await cnt(b)], [10, 20, 10]);
        H.v('    un seul document de compteur pour (porteur, jour)', await db.col('quota_jour').countDocuments({ porteur: `compte:${b.id}`, jour: JOUR }), 1);
        const c = await inst(); const dix = await Promise.all(Array.from({ length: 10 }, () => Lg.debiter(c, { scanId: cle(), cleIdempotence: cle(), maintenant: t }, cfg)));
        H.v('7c. installation : 10 simultanées, 3 passent', [dix.filter(r => r.ok).length, await cnt(c), await db.col('mouvements').countDocuments({ installationId: c.id, type: 'debit' })], [3, 3, 3]);
        const d = await compte(); const meme = await Promise.all(Array.from({ length: 10 }, () => Lg.debiter(d, { scanId: 'm', cleIdempotence: 'cle-unique-oq', maintenant: t }, cfg)));
        H.v('7d. idempotence : 10 requêtes de même clé = UNE unité prise', [meme.filter(r => r.ok).length, await cnt(d), await db.col('mouvements').countDocuments({ cleIdempotence: 'cle-unique-oq' })], [10, 1, 1]);
    }

    // ── 8. l'administrateur : inchangé (débit 0, motif administrateur), jamais de compteur
    {
        const ad = await compte({ role: 'administrateur' }); const r = await debiterN(ad, 15);
        const mv = await db.col('mouvements').findOne({ compteId: ad.id });
        H.v('8a. administrateur : 15 analyses, toutes ok, delta 0, motif administrateur, aucun compteur', [r.every(x => x.ok && x.administrateur), mv.delta, mv.motif, await cnt(ad)], [true, 0, 'administrateur', null]);
        H.v('    offre : pro, restant null', (await Of.offre(ad, cfg, t)).restant, null);
        const faux = await compte(); faux.administrateur = true;
        const rf = await debiterN(faux, 11);
        H.v('8b. administrateur FORGÉ sur un compte sans rôle : traité en gratuit (10 puis QUOTA)', [rf.filter(x => x.ok && !x.administrateur).length, issue(rf[10])], [10, 'QUOTA']);
    }

    // ── 9. les anciennes poches : jamais débitées, jamais créditées, lisibles et intactes (avant = après, document par document)
    {
        const c = await compte({ solde: { accueil: 25, achete: 50 }, abonnement: abo(futur) }), i = await inst({ essais: 3, achete: 7 });
        const avant = JSON.stringify([await lire(c), await lire(i)]);
        await debiterN(c, 12); await debiterN(i, 5);
        const dc = await Lg.debiter(c, { scanId: 'z', cleIdempotence: 'z', maintenant: new Date('2026-10-14T10:00:00Z') }, cfg);
        await Lg.rembourser(c, dc.credit, 'introuvable', { scanId: 'z', maintenant: new Date('2026-10-14T10:00:00Z') }, cfg);
        H.v('9a. 17 débits et un remboursement : les documents du compte et de l\'installation sont IDENTIQUES (soldes accueil/achete/abonnement/essais/achete)', JSON.stringify([await lire(c), await lire(i)]) === avant, true);
        H.v('    aucun mouvement ne porte une ancienne poche', await db.col('mouvements').countDocuments({ poche: { $in: ['essai', 'accueil', 'hebdo', 'abonnement', 'achete'] }, $or: [{ compteId: c.id }, { installationId: i.id }] }), 0);
        const directs = []; for (const poche of ['essai', 'accueil', 'hebdo', 'abonnement', 'achete']) directs.push(await Lg.essayerPoche(poche, c, cfg, t), await Lg.essayerPoche(poche, i, cfg, t));
        H.v('9b. essayerPoche sur une ancienne poche : null (10 appels), documents toujours intacts', [directs.every(x => x === null), JSON.stringify([await lire(c), await lire(i)]) === avant], [true, true]);
        const solde = await S.solde(c, cfg, t);
        H.v('9c. le Solde reste LISIBLE avec ses champs (accueil 25, achete 50, abonnement 100)', [solde.accueil, solde.achete, solde.abonnement && solde.abonnement.restant], [25, 50, 100]);
        const mvAvant = await db.col('mouvements').countDocuments({});
        const ach = await Pay.crediterAchat({ compteId: c.id, scans: 50, reference: 'cs_test_oq', maintenant: t }, cfg);
        H.v('9d. crediterAchat : REFUSÉ, journalisé, aucune écriture (solde achete 50, aucun mouvement de plus)', [ach.ok, ach.raison, (await lire(c)).solde.achete, await db.col('mouvements').countDocuments({}) - mvAvant], [false, 'vente-arretee', 50, 0]);
        await db.col('credits').insertOne({ _id: 'cred-oq', userId: 'u-oq', email: 'rat@x.fr', soldeScans: 40 });
        const rat = await Hr.rattacherAchats({ compteId: c.id, maintenant: t }, cfg, { emailCle: e => e });
        H.v('    rattacherAchats (achats de l\'ancien portefeuille) : refusé, ni le compte, ni `credits`, ni `mouvements` ne bougent', [rat.ok, (await lire(c)).solde.achete, (await db.col('credits').findOne({ _id: 'cred-oq' })).soldeScans, await db.col('mouvements').countDocuments({}) - mvAvant], [false, 50, 40, 0]);    }

    // ── 10. peutPayer (le contrôle SANS débit du scanner) suit la même offre
    {
        const p = await compte(), nv = await compte({ verifie: false }), pro = await compte({ abonnement: abo(futur) });
        const c3 = cfgAvec({ V2_QUOTA_GRATUIT: '2' });
        const seq = []; for (let i = 0; i < 3; i++) { seq.push((await S.peutPayer(p, c3, t)).ok); await debiterN(p, 1, t, c3); }
        H.v('10. peutPayer : vrai tant qu\'il reste une analyse (gratuit 2 : vrai, vrai, faux), QUOTA ensuite', [seq, (await S.peutPayer(p, c3, t)).code], [[true, true, false], 'QUOTA']);
        H.v('    compte non vérifié : VERIFICATION ; Pro : ok', [(await S.peutPayer(nv, cfg, t)).code, (await S.peutPayer(pro, cfg, t)).ok], ['VERIFICATION', true]);
    }

    // ── 11. l'index du compteur : unique par (porteur, jour), TTL sur expireLe
    {
        const ix = (await db.col('quota_jour').indexes()).map(i => ({ n: i.name, u: Boolean(i.unique), ttl: i.expireAfterSeconds }));
        H.v('11. index quota_jour_cle unique + TTL (expireAfterSeconds 0)', [ix.find(i => i.n === 'quota_jour_cle').u, ix.find(i => i.n === 'quota_jour_ttl').ttl], [true, 0]);
        let dup = null; try { await db.col('quota_jour').insertOne({ porteur: 'x:1', jour: JOUR, count: 1, expireLe: t }); await db.col('quota_jour').insertOne({ porteur: 'x:1', jour: JOUR, count: 1, expireLe: t }); } catch (e) { dup = e.code; }
        H.v('    un doublon (porteur, jour) est refusé (11000)', dup, 11000);
        const pp = await inst(); await Lg.debiter(pp, { scanId: cle(), cleIdempotence: cle(), maintenant: new Date('2026-10-13T10:00:00Z') }, cfg);      // un instant fourni ANTÉRIEUR à l'horloge réelle
        const doc = await db.col('quota_jour').findOne({ porteur: `installation:${pp.id}` });
        // l'instant des débits du banc (13 octobre) est ANTÉRIEUR à l'horloge réelle : le TTL se mesure sur la plus récente des deux (sinon un compteur déjà échu à sa naissance serait retiré avant son remboursement)
        H.vrai('    le compteur expire 3 jours après son premier usage, sur l\'horloge réelle quand l\'instant fourni est plus ancien', Math.abs(doc.expireLe.getTime() - (Date.now() + 3 * 86400e3)) < 10 * 60e3);
        const futurDebit = new Date(Date.now() + 5 * 86400e3), pf = await inst();
        await Lg.debiter(pf, { scanId: cle(), cleIdempotence: cle(), maintenant: futurDebit }, cfg);
        H.vrai('    …et sur l\'instant fourni quand il est plus récent (5 jours plus tard : échéance à 8 jours)', Math.abs((await db.col('quota_jour').findOne({ porteur: `installation:${pf.id}` })).expireLe.getTime() - (futurDebit.getTime() + 3 * 86400e3)) < 1000);
    }
    // relecture 3, I2 : les plafonds de rendu du jour (panne, question, sans-prix) comptent le jour de PARIS, par la même fonction que le quota
    {
        // hiver : 23:30Z le 14 janvier = 00:30 Paris le 15 ; été : 22:30Z le 14 juillet = 00:30 Paris le 15
        for (const [nom, instant, parisJour, utcJour] of [['hiver', new Date('2026-01-14T23:30:00Z'), '2026-01-15', '2026-01-14'], ['été', new Date('2026-07-14T22:30:00Z'), '2026-07-15', '2026-07-14']]) {
            const pl = await compte(); const sid = `pl-${nom}`;
            const d = await Lg.debiter(pl, { scanId: sid, cleIdempotence: sid, maintenant: instant }, cfg);
            const r = await Lg.rembourser(pl, d.credit, 'introuvable', { scanId: sid, compteur: 'question', maintenant: instant }, cfg);      // PLAFOND-DECLARE : seul le compteur des déclarations date au jour de Paris (un constaté n'en écrit pas)
            const docs = await db.col('plafonds').find({ porteur: `compte:${pl.id}` }).toArray();
            H.v(`PLAFOND ${nom} : le rendu à 00:30 Paris compte le jour de Paris (${parisJour}), jamais le jour UTC (${utcJour})`, [r.rendu, docs.map(x => x.jour)], [true, [parisJour]]);
        }
    }
    // précision de l'extension (transmise par le coordinateur) : le refus QUOTA ne porte PLUS `achat`, ni aucun lien de vente — ni dans le schéma, ni dans le corps d'erreur
    {
        const SCH = require('../openapi/openapi.v2.json'), { corpsErreur } = require('../erreurs');
        H.vrai('OFFRE-QUOTA : ReponseErreur ne déclare plus de propriété `achat`', !('achat' in SCH.components.schemas.ReponseErreur.properties));
        const c = corpsErreur('QUOTA', undefined, { facturation: null, achat: { url: 'https://rat-market.fr/fr/compte#recharge' }, offre: { nom: 'gratuit', restant: 0, remiseAZero: '2026-10-14T00:00:00+02:00' } });
        H.v('    le corps d\'un refus QUOTA n\'a pas de clé achat (même si un appelant en passe une) et joint offre', [c.achat, c.offre && c.offre.restant, c.facturation], [undefined, 0, null]);
    }
    await H.fermerBac(); H.bilan();
})().catch(e => { console.error('❌', e); process.exit(1); });
