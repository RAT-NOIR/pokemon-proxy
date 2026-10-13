'use strict';
// Le REMBOURSEMENT du grand livre. OFFRE-QUOTA (2026-10-13) : la poche débitée est le compteur du jour (`quota_jour`) ; un « solde de N crédits » est un quota du jour de 1000 dont 1000 - N sont déjà
// pris (voir _aide-quota.js) — l'arithmétique des plafonds de remboursement n'en change pas. Les scénarios qui n'avaient de sens que pour une poche à PÉRIODE (hebdo : semaine ISO ; abonnement : mois ;
// accueil : plafond de dotation) sont soit réécrits pour le jour de Paris (un remboursement tardif rend l'unité au jour du débit), soit gardés sur l'ANCIENNE poche avec un débit fabriqué à la main
// (le grand livre sait toujours RENDRE un débit d'avant la bascule).
const H = require('./_harnais'); const db = require('../db'); const M = require('../modeles'); const { lireConfig } = require('../config'); const Lg = require('../argent/ledger');
const { compte, inst, lire } = require('./_aide-argent'); const QJ = require('./_aide-quota');
const cfg = QJ.cfgGrand({ V2_HEBDO: '0' });
const t = new Date('2026-10-08T10:00:00Z'), JOUR = '2026-10-08';
const restant = p => QJ.restantDe(p, cfg, t);
const compteN = async n => { const p = await compte(); await QJ.poserRestant(`compte:${p.id}`, n, { jour: JOUR }); return p; };
const instN = async (n, o = {}) => { const p = await inst({ essais: 0, achete: 0, ...o }); await QJ.poserRestant(`installation:${p.id}`, n, { jour: JOUR }); return p; };
const prendre = async (p, scanId, c = cfg, maintenant = t) => { const r = await Lg.debiter(p, { scanId, cleIdempotence: `d|${scanId}`, maintenant }, c); if (!r.ok) throw new Error(`débit refusé ${scanId} : ${r.code}`); return r.credit; };
const mouvDebit = (p, scanId) => db.col('mouvements').findOne({ ...(p.type === 'compte' ? { compteId: p.id } : { installationId: p.id }), type: 'debit', scanId });
const plaf = async(p, jour, type) => (await db.col('plafonds').findOne({ porteur: `${p.type}:${p.id}`, jour, type }));
const cnt = async (p, jour = JOUR) => QJ.prisAujourdhui(`${p.type}:${p.id}`, jour);
// un débit d'une ANCIENNE poche, tel que le grand livre d'avant la bascule l'écrivait
const debitAncien = async (base, credit, scanId) => { await db.col('mouvements').insertOne({ ...base, le: t, surface: 'scanner', type: 'debit', delta: -1, poche: credit.poche, credit, motif: null, scanId, etat: 'debite', cleIdempotence: `d|${scanId}`, expireLe: new Date('2028-01-01') }); return credit; };
(async () => {
    await H.ouvrirBac('test-argent-remboursement.js'); await M.creerIndex();
    // 1. débit puis remboursement
    const p1 = await compteN(3); const cr1 = await prendre(p1, 's1');
    const r1 = await Lg.rembourser(p1, cr1, 'ia-echec', { scanId: 's1', maintenant: t }, cfg);
    H.v('rembourser : rendu', r1, { rendu: true, raisonNonRembourse: null });
    H.v('   le restant revient (3)', await restant(p1), 3);
    H.v('   le mouvement de débit passe rembourse', (await db.col('mouvements').findOne({ compteId: p1.id, type: 'debit', scanId: 's1' })).etat, 'rembourse');
    const mr = await db.col('mouvements').findOne({ cleIdempotence: 'rb|s1' });
    H.v('   mouvement remboursement delta +1 sur la poche « jour »', [mr.type, mr.delta, mr.poche], ['remboursement', 1, 'jour']);
    // 2. une seule fois par scan : séquentiel puis 10 simultanés
    const r1b = await Lg.rembourser(p1, cr1, 'ia-echec', { scanId: 's1', maintenant: t }, cfg);
    H.v('2e remboursement du même scan : deja-rembourse', r1b, { rendu: false, raisonNonRembourse: 'deja-rembourse' });
    const p2 = await compteN(5); const cr2 = await prendre(p2, 's2');
    const rr = await Promise.all(Array.from({ length: 10 }, () => Lg.rembourser(p2, cr2, 'ia-echec', { scanId: 's2', maintenant: t }, cfg)));
    H.v('10 requêtes, 1 rendu', rr.filter(r => r.rendu).length, 1);
    H.v('   les 9 autres : deja-rembourse', rr.filter(r => r.raisonNonRembourse === 'deja-rembourse').length, 9);
    H.v('   restant final = initial', await restant(p2), 5);
    // 3. plafond des pannes : 5 passent, la 6e non ; le compteur question est indépendant
    const p3 = await compteN(40); const crs = [];
    for (let i = 0; i < 7; i++) crs.push(await prendre(p3, `p${i}`));
    const pan = []; for (let i = 0; i < 6; i++) pan.push(await Lg.rembourser(p3, crs[i], 'ia-echec', { scanId: `p${i}`, maintenant: t }, cfg));
    H.v('pannes : 5 rendues puis plafond-jour', pan.map(r => r.rendu ? 'rendu' : r.raisonNonRembourse), ['rendu', 'rendu', 'rendu', 'rendu', 'rendu', 'plafond-jour']);
    H.v('   la 6e : le crédit RESTE débité (40 - 7 + 5)', await restant(p3), 38);
    H.v('   compteur de pannes resté à 5 (rollback)', (await plaf(p3, '2026-10-08', 'panne')).count, 5);
    H.v('   le claim de la 6e est libéré', await db.col('mouvements').countDocuments({ cleIdempotence: 'rb|p5' }), 0);
    const q1 = await Lg.rembourser(p3, crs[6], 'question:x', { scanId: 'p6', compteur: 'question', maintenant: t }, cfg);
    H.v('   après 5 pannes, une question est encore remboursée (compteur indépendant)', q1.rendu, true);
    const p3q = await compteN(40); const cq = [];
    for (let i = 0; i < 31; i++) cq.push(await prendre(p3q, `q${i}`));
    const rq = []; for (let i = 0; i < 31; i++) rq.push(await Lg.rembourser(p3q, cq[i], 'question:x', { scanId: `q${i}`, compteur: 'question', maintenant: t }, cfg));
    H.v('questions : 30 passent, la 31e plafond-jour (dénominateur 31)', [rq.filter(r => r.rendu).length, rq[30].raisonNonRembourse], [30, 'plafond-jour']);
    // 4. plafond PAR PORTEUR, jour UTC
    const p4 = await compteN(3); const c4 = await prendre(p4, 'a4');
    H.v('un autre compte n\'est pas touché par le plafond atteint de p3', (await Lg.rembourser(p4, c4, 'ia-echec', { scanId: 'a4', maintenant: t }, cfg)).rendu, true);
    const i4 = await instN(3, { achete: 3 }); const ci4 = await prendre(i4, 'i4');
    H.v('une installation non liée a son propre compteur', (await Lg.rembourser(i4, ci4, 'ia-echec', { scanId: 'i4', maintenant: t }, cfg)).rendu, true);
    H.v('   et son quota est revenu (3) ; son solde acheté ancien n\'a jamais bougé (3)', [await restant(i4), (await lire(i4)).achete], [3, 3]);
    const lendemain = new Date('2026-10-09T00:00:01Z');
    const cL = await prendre(p3, 'lendemain', cfg, lendemain);
    H.v('le lendemain (UTC) p3 repart à 0 : une panne est rendue', (await Lg.rembourser(p3, cL, 'ia-echec', { scanId: 'lendemain', maintenant: lendemain }, cfg)).rendu, true);
    // 5. jourDe : une question posée à 23 h 50, abandonnée à 00 h 10, compte au jour où elle a été posée
    const p5 = await compteN(10); const c5 = await prendre(p5, 'j1'), c5b = await prendre(p5, 'j2');
    await db.col('plafonds').insertOne({ porteur: `compte:${p5.id}`, jour: '2026-10-08', type: 'question', count: 30, expireLe: new Date('2026-10-12') });
    const posee = new Date('2026-10-08T21:50:00Z'), abandon = new Date('2026-10-08T22:10:00Z');       // 23 h 50 puis 00 h 10 HEURE DE PARIS (les plafonds du jour comptent le jour de Paris : relecture 3, I2)
    const j1 = await Lg.rembourser(p5, c5, 'question:x', { scanId: 'j1', compteur: 'question', jourDe: posee, maintenant: abandon }, cfg);
    H.v('jourDe = jour de pose (plafond de CE jour atteint) : refusé', j1, { rendu: false, raisonNonRembourse: 'plafond-jour' });
    H.v('   le compteur du jour de pose est resté à 30', (await plaf(p5, '2026-10-08', 'question')).count, 30);
    H.v('   celui du jour d\'abandon n\'a pas été touché (0 ou absent)', (await plaf(p5, '2026-10-09', 'question'))?.count ?? 0, 0);
    H.v('   sans jourDe, le même abandon compte au jour d\'abandon : rendu', (await Lg.rembourser(p5, c5b, 'question:x', { scanId: 'j2', compteur: 'question', maintenant: abandon }, cfg)).rendu, true);
    // 6. le quota du jour : un remboursement TARDIF (jour de Paris suivant) rend l'unité au compteur du JOUR DU DÉBIT, jamais au jour courant (l'ancien hebdo refusait « semaine changée »)
    const p6 = await compteN(5); const c6 = await prendre(p6, 'h1');
    H.v('débit sur la poche « jour » du 8 octobre', [c6.poche, c6.jour, await cnt(p6)], ['jour', JOUR, 996 + 0]);
    const apresMinuit = new Date('2026-10-08T22:30:00Z');       // 00 h 30 à Paris, le 9
    const r6 = await Lg.rembourser(p6, c6, 'ia-echec', { scanId: 'h1', maintenant: apresMinuit }, cfg);
    H.v('remboursé après minuit de Paris : rendu, au compteur du 8 (995 -> restant 5), aucun compteur du 9 créé', [r6.rendu, await restant(p6), await cnt(p6, '2026-10-09')], [true, 5, null]);
    H.v('   le plafond de pannes se compte au jour de PARIS du remboursement (le 9 octobre à 00:30 Paris, 22:30Z), pas au jour UTC (le 8) : 1', [(await plaf(p6, '2026-10-09', 'panne')).count, await plaf(p6, '2026-10-08', 'panne')], [1, null]);
    // 7. ANCIENNES poches : accueil au plafond ; abonnement même mois / mois suivant (le grand livre sait toujours rendre un débit d'avant la bascule)
    const p7 = await compte({ solde: { accueil: 24, achete: 0 } }); const c7a = await debitAncien({ compteId: p7.id }, { poche: 'accueil' }, 'ac1');
    await db.col('comptes').updateOne({ _id: p7.id }, { $set: { 'solde.accueil': 25 } });          // le solde est remonté à la dotation (autre chemin) : rendre un de plus dépasserait 25
    H.v('accueil déjà à 25 : accueil-au-plafond, solde inchangé', [await Lg.rembourser(p7, c7a, 'ia-echec', { scanId: 'ac1', maintenant: t }, cfg), (await lire(p7)).solde.accueil],
        [{ rendu: false, raisonNonRembourse: 'accueil-au-plafond' }, 25]);
    const p7a = await compte({ solde: { accueil: 0, achete: 0 }, abonnement: { actif: true, quotaMensuel: 3, moisCle: '2026-10', restant: 2, jusquAu: new Date('2027-01-01') } });
    const c7 = await debitAncien({ compteId: p7a.id }, { poche: 'abonnement', moisCle: '2026-10' }, 'ab1');
    H.v('abonnement : même mois, rendu', [(await Lg.rembourser(p7a, c7, 'ia-echec', { scanId: 'ab1', maintenant: t }, cfg)).rendu, (await lire(p7a)).abonnement.restant], [true, 3]);
    await db.col('comptes').updateOne({ _id: p7a.id }, { $set: { 'abonnement.restant': 2 } });
    await debitAncien({ compteId: p7a.id }, { poche: 'abonnement', moisCle: '2026-10' }, 'ab2');
    const r7 = await Lg.rembourser(p7a, { poche: 'abonnement', moisCle: '2026-10' }, 'ia-echec', { scanId: 'ab2', maintenant: new Date('2026-11-02T10:00:00Z') }, cfg);
    H.v('abonnement : mois suivant, non rendu', [r7.rendu, r7.raisonNonRembourse, (await lire(p7a)).abonnement.restant], [false, 'abonnement-mois-change', 2]);
    H.v('   restant 2 < quota 3 : le rendu direct (même mois) est permis', (await Lg.rendrePoche(p7a, { poche: 'abonnement', moisCle: '2026-10' }, cfg, t)).rendu, true);
    await db.col('comptes').updateOne({ _id: p7a.id }, { $set: { 'abonnement.restant': 3 } });
    H.v('   restant = quota : rien à rendre (jamais plus que ce qui a été pris)', (await Lg.rendrePoche(p7a, { poche: 'abonnement', moisCle: '2026-10' }, cfg, t)).rendu, false);
    // 8. credit null (administrateur) : aucun-debit, rien n'est écrit
    const avant = [await db.col('mouvements').countDocuments({}), await db.col('plafonds').countDocuments({})];
    H.v('credit null : aucun-debit', await Lg.rembourser(p7, null, 'ia-echec', { scanId: 'adm1', maintenant: t }, cfg), { rendu: false, raisonNonRembourse: 'aucun-debit' });
    H.v('   aucun mouvement ni compteur touché', [await db.col('mouvements').countDocuments({}), await db.col('plafonds').countDocuments({})], avant);
    // 9. sansPlafond ignore le plafond mais PAS l'unicité par scan
    const p9 = await compteN(10); const c9 = await prendre(p9, 'sp1');
    await db.col('plafonds').insertOne({ porteur: `compte:${p9.id}`, jour: '2026-10-08', type: 'panne', count: 5, expireLe: new Date('2026-10-12') });
    H.v('plafond atteint + sansPlafond : rendu', (await Lg.rembourser(p9, c9, 'ia-echec', { scanId: 'sp1', sansPlafond: true, maintenant: t }, cfg)).rendu, true);
    H.v('   le compteur n\'a pas bougé', (await plaf(p9, '2026-10-08', 'panne')).count, 5);
    H.v('   sansPlafond ne contourne pas l\'unicité par scan', (await Lg.rembourser(p9, c9, 'ia-echec', { scanId: 'sp1', sansPlafond: true, maintenant: t }, cfg)).raisonNonRembourse, 'deja-rembourse');
    // 10. panne de Mongo pendant l'incrément / le rendu : claim supprimé, compteur rendu, 'erreur', et un nouvel essai fonctionne
    const p10 = await compteN(5); const c10 = await prendre(p10, 'e1');
    const colReel = db.col; const casse = nom => { db.col = n => (n === nom ? { findOneAndUpdate: async () => { throw new Error('panne simulée'); }, updateOne: async () => { throw new Error('panne simulée'); }, insertOne: async () => { throw new Error('panne simulée'); } } : colReel(n)); };
    casse('plafonds'); const e1 = await Lg.rembourser(p10, c10, 'ia-echec', { scanId: 'e1', maintenant: t }, cfg); db.col = colReel;
    H.v('panne pendant l\'incrément : erreur', e1, { rendu: false, raisonNonRembourse: 'erreur' });
    H.v('   le claim rb|e1 est supprimé', await db.col('mouvements').countDocuments({ cleIdempotence: 'rb|e1' }), 0);
    H.v('   le crédit reste débité (rien de rendu)', await restant(p10), 4);
    H.v('   un nouvel essai aboutit', (await Lg.rembourser(p10, c10, 'ia-echec', { scanId: 'e1', maintenant: t }, cfg)).rendu, true);
    const p10h = await compteN(5); const c10h = await prendre(p10h, 'e2');
    casse('quota_jour'); const e2 = await Lg.rembourser(p10h, c10h, 'ia-echec', { scanId: 'e2', maintenant: t }, cfg); db.col = colReel;
    H.v('panne pendant le rendu (compteur du jour) : erreur, compteur de plafond rendu, claim libéré', [e2.raisonNonRembourse, (await plaf(p10h, '2026-10-08', 'panne')).count, await db.col('mouvements').countDocuments({ cleIdempotence: 'rb|e2' })], ['erreur', 0, 0]);
    // 11. garde : un scan sans identifiant ne peut pas servir de clé (rb|undefined serait commun à tous)
    const c11 = await prendre(p10, 'z1');
    H.v('scanId absent : refusé (erreur), rien d\'écrit', [(await Lg.rembourser(p10, c11, 'ia-echec', { maintenant: t }, cfg)).raisonNonRembourse, await db.col('mouvements').countDocuments({ cleIdempotence: 'rb|undefined' })], ['erreur', 0]);
    // 12. « ne rend jamais plus que ce qui a été pris » : le remboursement se juge sur le DÉBIT enregistré, pas sur l'objet que l'appelant présente
    const p12 = await compteN(5);
    const av12 = [await db.col('mouvements').countDocuments({}), await restant(p12)];
    H.v('remboursement d\'un scan jamais débité : aucun-debit, rien rendu, rien écrit', [await Lg.rembourser(p12, { poche: 'jour' }, 'ia-echec', { scanId: 'jamais-debite', maintenant: t }, cfg), await db.col('mouvements').countDocuments({}), await restant(p12), await db.col('mouvements').countDocuments({ cleIdempotence: 'rb|jamais-debite' })],
        [{ rendu: false, raisonNonRembourse: 'aucun-debit' }, av12[0], av12[1], 0]);
    const pi12 = await instN(1, { essais: 1, achete: 4 }); const ci12 = await prendre(pi12, 'menteur');
    H.v('   installation : débit sur « jour »', ci12.poche, 'jour');
    const rm = await Lg.rembourser(pi12, { poche: 'achete' }, 'ia-echec', { scanId: 'menteur', maintenant: t }, cfg);   // l'appelant prétend que c'était un crédit acheté
    H.v('   l\'appelant présente la poche « achete » : c\'est la poche DÉBITÉE (jour) qui est rendue, les anciens soldes (essais 1, achete 4) ne bougent pas', [rm.rendu, await restant(pi12), (await lire(pi12)).essais, (await lire(pi12)).achete], [true, 1, 1, 4]);
    // le plafond ne se contourne pas en rejouant sous un autre scanId : chaque remboursement exige SON débit
    const pj = await compteN(9); const cj = await prendre(pj, 'unique');
    await Lg.rembourser(pj, cj, 'ia-echec', { scanId: 'unique', maintenant: t }, cfg);
    const bis = []; for (let i = 0; i < 4; i++) bis.push((await Lg.rembourser(pj, cj, 'ia-echec', { scanId: `fantome${i}`, maintenant: t }, cfg)).raisonNonRembourse);
    H.v('   le même crédit présenté sous 4 scanId fantômes : jamais rendu', [bis, await restant(pj)], [Array(4).fill('aucun-debit'), 9]);
    // 13. I1 — un LOT à plusieurs unités : CHAQUE unité débitée pour le scan est rendue, une fois chacune, et le lot compte pour UN remboursement au plafond
    const Lot = require('../argent/lot');
    const lotDe = async (p, scanId, unites, c = cfg) => { const u0 = await Lg.debiter(p, { scanId, cleIdempotence: scanId, maintenant: t }, c); const s = await Lot.debiterSupplement(p, { scanId, unites: unites - 1, cleIdempotence: `${scanId}s`, maintenant: t }, c); return [u0.credit, ...s.credits]; };
    const somme = async (p, poche, type) => (await db.col('mouvements').aggregate([{ $match: { compteId: p.id, poche, ...(type ? { type } : {}) } }, { $group: { _id: null, s: { $sum: '$delta' } } }]).toArray())[0]?.s ?? 0;
    const p13 = await compteN(6); const cr13 = await lotDe(p13, 'lotA', 3);
    H.v('lot de 3 unités débité sur la poche « jour » (3 unités du compteur)', [cr13.map(c => c.poche), await restant(p13)], [['jour', 'jour', 'jour'], 3]);
    const l13 = await Lg.rembourserLot(p13, cr13, 'introuvable', { scanId: 'lotA', maintenant: t }, cfg);
    H.v('   rembourserLot : TOUTES les unités rendues', [l13.rendu, l13.unites, await restant(p13)], [true, 3, 6]);
    H.v('   le lot compte pour UN remboursement au plafond du jour', (await plaf(p13, '2026-10-08', 'panne')).count, 1);
    H.v('   journal : +3 jour (remboursements), 3 débits marqués rembourse', [await somme(p13, 'jour', 'remboursement'), await db.col('mouvements').countDocuments({ compteId: p13.id, type: 'debit', etat: 'rembourse' })], [3, 3]);
    const l13b = await Lg.rembourserLot(p13, cr13, 'introuvable', { scanId: 'lotA', maintenant: t }, cfg);
    H.v('   rejoué : deja-rembourse, rien de plus', [l13b, await restant(p13)], [{ rendu: false, raisonNonRembourse: 'deja-rembourse' }, 6]);
    const p13b = await compteN(9); const cr13b = await lotDe(p13b, 'lotB', 3);
    const rr13 = await Promise.all(Array.from({ length: 10 }, () => Lg.rembourserLot(p13b, cr13b, 'introuvable', { scanId: 'lotB', maintenant: t }, cfg)));
    H.v('   10 remboursements simultanés du même lot : un seul rend, 3 unités une fois (dénominateur 10)', [rr13.filter(r => r.rendu).length, await restant(p13b)], [1, 9]);
    const p13c = await compteN(9); const cr13c = await lotDe(p13c, 'lotC', 3);
    const ru13 = await Lg.rembourser(p13c, cr13c[0], 'ia-echec', { scanId: 'lotC', maintenant: t }, cfg);
    H.v('   rembourser (panne sur la requête d\'un lot) rend aussi TOUTES les unités du scan', [ru13.rendu, await restant(p13c)], [true, 9]);
    const p13d = await compteN(60); const rl = [];
    for (let i = 0; i < 6; i++) { const c = await lotDe(p13d, `lotD${i}`, 3); rl.push((await Lg.rembourserLot(p13d, c, 'introuvable', { scanId: `lotD${i}`, maintenant: t }, cfg)).raisonNonRembourse ?? 'rendu'); }
    H.v('   6 lots de 3 unités : 5 passent (un lot = un compteur), le 6e plafond-jour, ses 3 unités restent débitées', [rl, await restant(p13d)], [['rendu', 'rendu', 'rendu', 'rendu', 'rendu', 'plafond-jour'], 60 - 18 + 15]);
    H.v('   rembourserLot sans crédit (administrateur) : aucun-debit', (await Lg.rembourserLot(p13d, [null], 'introuvable', { scanId: 'x', maintenant: t }, cfg)).raisonNonRembourse, 'aucun-debit');
    // 14. M2 — une panne ne rembourse pas une question DÉJÀ répondue par un candidat
    const Q = require('../argent/questions');
    const p14 = await compteN(3); const c14 = await prendre(p14, 'qrep');
    await Q.reserverQuestion(p14, c14, { scanId: 'qrep', carte: 0, raison: 'x', candidats: [1, 2], choix: [{ id: 'a', idProduct: 1 }] }, cfg, t);
    await Q.repondreQuestion(p14, { scanId: 'qrep', carte: 0, choix: 'a' }, cfg, t);
    H.v('panne après réponse par un candidat : refusée (deja-livre), le débit reste, rien rendu', [(await Lg.rembourser(p14, c14, 'ia-echec', { scanId: 'qrep', maintenant: t }, cfg)).raisonNonRembourse, await restant(p14), (await mouvDebit(p14, 'qrep')).etat], ['deja-livre', 2, 'debite']);
    // 15. OFFRE-QUOTA — remboursement après liaison : l'unité retourne au compteur de l'INSTALLATION, là où elle a été prise (le compteur du jour porte la clé du porteur du débit ; M6 ne s'applique plus au quota)
    const cpt = await compte({ solde: { accueil: 5, achete: 0 } }); const i15 = await instN(3);
    const e15 = await prendre(i15, 'lie-essai');
    await db.col('installations').updateOne({ _id: i15.id }, { $set: { compteId: cpt.id } });
    const r15 = await Lg.rembourser(i15, e15, 'ia-echec', { scanId: 'lie-essai', maintenant: t }, cfg);
    H.v('installation liée entre-temps : l\'unité est rendue au compteur de l\'INSTALLATION (997 = son niveau de départ), le compte lié n\'est pas touché (accueil 5, aucun compteur)', [r15.rendu, await cnt(i15), (await lire(cpt)).solde.accueil, await cnt(cpt)], [true, 997, 5, null]);
    // 16. une panne PENDANT le rendu restitue l'état du débit (jamais un débit « rembourse » sans crédit rendu)
    const p16 = await compteN(5); const c16 = await prendre(p16, 'e16');
    casse('quota_jour'); await Lg.rembourser(p16, c16, 'ia-echec', { scanId: 'e16', maintenant: t }, cfg); db.col = colReel;
    H.v('panne pendant le rendu : le débit est RESTITUÉ à « debite » et le scan peut être remboursé ensuite', [(await mouvDebit(p16, 'e16')).etat, (await Lg.rembourser(p16, c16, 'ia-echec', { scanId: 'e16', maintenant: t }, cfg)).rendu], ['debite', true]);
    // 17. N1 — l'annulation d'une unité de supplément RÉ-ESSAYÉE (clé dérivée |retry|) vise la ligne effectivement débitée : aucun crédit n'est créé
    const p17 = await compteN(2);
    await Lot.debiterSupplement(p17, { scanId: 'n1', unites: 2, cleIdempotence: 'n1s', maintenant: t }, cfg);
    await Lg.rembourserLot(p17, [{ poche: 'jour' }], 'introuvable', { scanId: 'n1', maintenant: t }, cfg);
    H.v('N1 préalable : lot remboursé, restant revenu', await restant(p17), 2);
    await QJ.poserRestant(`compte:${p17.id}`, 1, { jour: JOUR });           // un autre scan a pris une unité : la 2e unité manquera
    const rj17 = await Lot.debiterSupplement(p17, { scanId: 'n1', unites: 2, cleIdempotence: 'n1s', maintenant: t }, cfg);
    H.v('N1 rejeu après remboursement : la 2e unité manque (QUOTA), la 1re annulée', [rj17.ok, rj17.code, await restant(p17)], [false, 'QUOTA', 1]);
    H.v('   aucune ligne de débit ne reste ouverte (la ligne retry est annulée)', await db.col('mouvements').countDocuments({ compteId: p17.id, type: 'debit', scanId: 'n1', etat: 'debite' }), 0);
    const rl17 = await Lg.rembourserLot(p17, [{ poche: 'jour' }], 'introuvable', { scanId: 'n1', maintenant: t }, cfg);
    H.v('   un rembourserLot ultérieur ne crée AUCUN crédit', [rl17.rendu, await restant(p17)], [false, 1]);
    H.v('   journal : somme des deltas = 0 (-2 débits, +2 rendus, -1 retry, +1 annulé ; le décrément extérieur n\'y est pas)', await somme(p17, 'jour'), 0);
    // 18. P — une unité non rendue (partiel) reste remboursable plus tard : son claim est libéré. OFFRE-QUOTA : l'unité qui ne se rend pas est celle dont le compteur du JOUR a disparu (TTL) ;
    //     elle se rend dès que son compteur existe de nouveau.
    const p18 = await compteN(10);
    const veille = new Date('2026-10-07T10:00:00Z'); await QJ.poserRestant(`compte:${p18.id}`, 10, { jour: '2026-10-07' });
    const u18a = await Lg.debiter(p18, { scanId: 'pp', cleIdempotence: 'pp', maintenant: t }, cfg), u18b = await Lg.debiter(p18, { scanId: 'pp', cleIdempotence: 'pp#1', maintenant: veille }, cfg);
    H.v('P préalable : deux unités débitées sur deux JOURS différents', [u18a.credit.jour, u18b.credit.jour], ['2026-10-08', '2026-10-07']);
    await db.col('quota_jour').deleteOne({ porteur: `compte:${p18.id}`, jour: '2026-10-07' });          // le compteur de la veille a expiré
    const pa = await Lg.rembourserLot(p18, [u18a.credit], 'introuvable', { scanId: 'pp', maintenant: t }, cfg);
    H.v('   le compteur de la veille a disparu : partiel (1 unité rendue)', [pa.rendu, pa.unites, pa.partiel === true], [true, 1, true]);
    await db.col('quota_jour').insertOne({ porteur: `compte:${p18.id}`, jour: '2026-10-07', count: 1, expireLe: new Date('2026-12-01') });
    const pb = await Lg.rembourserLot(p18, [u18a.credit], 'introuvable', { scanId: 'pp', maintenant: t }, cfg);
    H.v('   le compteur existe de nouveau : l\'unité restée débitée est rendue (pas deja-rembourse)', [pb.rendu, pb.unites, pb.raisonNonRembourse], [true, 1, null]);
    H.v('   plus aucun débit ouvert', await db.col('mouvements').countDocuments({ compteId: p18.id, type: 'debit', scanId: 'pp', etat: { $ne: 'rembourse' } }), 0);
    // 19. une garde s'écrit par ce qu'elle AUTORISE : un compteur inconnu est REFUSÉ (jamais rabattu sur « panne »), le crédit reste débité, aucun compteur n'est touché
    const p19 = await compteN(5); const cr19 = await prendre(p19, 'cinc');
    const e19 = await Lg.rembourser(p19, cr19, 'ia-echec', { scanId: 'cinc', compteur: 'sans_prix', maintenant: t }, cfg);
    H.v('19. compteur inconnu (« sans_prix », faute de frappe) : refusé { rendu:false, erreur }, crédit resté débité (4), aucun compteur de plafond créé, aucun claim',
        [e19, await restant(p19), await db.col('plafonds').countDocuments({ porteur: `compte:${p19.id}` }), await db.col('mouvements').countDocuments({ cleIdempotence: 'rb|cinc' })], [{ rendu: false, raisonNonRembourse: 'erreur' }, 4, 0, 0]);
    // noms hérités du prototype : ils ne sont PAS des compteurs (propriété propre exigée, pas `in`) — sinon plafond = une fonction/un objet, donc jamais atteint
    const h19 = [];
    for (const nom of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) h19.push(await Lg.rembourser(p19, cr19, 'ia-echec', { scanId: 'cinc', compteur: nom, maintenant: t }, cfg));
    H.v('    noms hérités du prototype (constructor, __proto__, toString, hasOwnProperty) : tous refusés, crédit resté débité (4), aucun compteur ni claim',
        [h19.map(r => [r.rendu, r.raisonNonRembourse]), await restant(p19), await db.col('plafonds').countDocuments({ porteur: `compte:${p19.id}` }), await db.col('mouvements').countDocuments({ cleIdempotence: 'rb|cinc' })],
        [Array(4).fill([false, 'erreur']), 4, 0, 0]);
    const n19 = await Lg.rembourser(p19, cr19, 'ia-echec', { scanId: 'cinc', compteur: null, maintenant: t }, cfg);
    H.v('    compteur null : refusé aussi ; le défaut (sans compteur) reste « panne »', [n19.rendu, (await Lg.rembourser(p19, cr19, 'ia-echec', { scanId: 'cinc', maintenant: t }, cfg)).rendu, (await plaf(p19, '2026-10-08', 'panne')).count], [false, true, 1]);
    // 20. JUMEAU-V2 (C1 de la passe 2) : les refus de la garde des jumeaux ont un compteur DÉDIÉ `jumeaux` (20 par jour et par porteur, V2_JUMEAUX_REMBOURSES_JOUR), UNE unité par carte ;
    //     au-delà, le refus retombe sur le plafond de pannes ORDINAIRE (mêmes règles de facturation) : jamais gratuit sans limite.
    H.v('20. plafond par défaut du compteur jumeaux : 20 ; variable V2_JUMEAUX_REMBOURSES_JOUR', [cfg.plafonds.jumeaux, lireConfig({ MONGODB_BASE: 'test_scratch', V2_JUMEAUX_REMBOURSES_JOUR: '3' }).plafonds.jumeaux], [20, 3]);
    const p20 = await compteN(100); const c20 = [];
    for (let i = 0; i < 22; i++) c20.push(await prendre(p20, `jm${i}`));
    const r20 = []; for (let i = 0; i < 20; i++) r20.push((await Lg.rembourser(p20, c20[i], 'introuvable', { scanId: `jm${i}`, compteur: 'jumeaux', maintenant: t }, cfg)).rendu);
    H.v('   20 refus de la garde : 20 rendus, compteur jumeaux à 20, compteur de pannes INTACT', [r20.every(Boolean), (await plaf(p20, '2026-10-08', 'jumeaux')).count, (await plaf(p20, '2026-10-08', 'panne'))?.count ?? 0], [true, 20, 0]);
    const r21 = await Lg.rembourser(p20, c20[20], 'introuvable', { scanId: 'jm20', compteur: 'jumeaux', maintenant: t }, cfg);
    H.v('   le 21e : le compteur dédié est plein, il retombe sur le plafond de pannes ordinaire (rendu, pannes à 1, jumeaux resté à 20)', [r21.rendu, (await plaf(p20, '2026-10-08', 'panne')).count, (await plaf(p20, '2026-10-08', 'jumeaux')).count], [true, 1, 20]);
    await db.col('plafonds').updateOne({ porteur: `compte:${p20.id}`, jour: '2026-10-08', type: 'panne' }, { $set: { count: cfg.plafonds.panne } });
    const r22 = await Lg.rembourser(p20, c20[21], 'introuvable', { scanId: 'jm21', compteur: 'jumeaux', maintenant: t }, cfg);
    H.v('   pannes aussi pleines : le refus n\'est PAS remboursé (plafond-jour), le crédit reste débité, le claim est libéré, les deux compteurs inchangés',
        [r22, (await plaf(p20, '2026-10-08', 'panne')).count, (await plaf(p20, '2026-10-08', 'jumeaux')).count, await db.col('mouvements').countDocuments({ cleIdempotence: 'rb|jm21' }), (await mouvDebit(p20, 'jm21')).etat],
        [{ rendu: false, raisonNonRembourse: 'plafond-jour' }, cfg.plafonds.panne, 20, 0, 'debite']);
    // une unité PAR CARTE : un lot de 3 cartes refusées consomme 3 unités du compteur dédié
    const p20b = await compteN(20); const l20 = await lotDe(p20b, 'lotJ', 3);
    const rl20 = await Lg.rembourser(p20b, l20[0], 'introuvable', { scanId: 'lotJ', compteur: 'jumeaux', unites: 3, maintenant: t }, cfg);
    H.v('   un lot de 3 cartes refusées : rendu en entier, 3 unités du compteur dédié (pas 1), pannes intact', [rl20.rendu, (await plaf(p20b, '2026-10-08', 'jumeaux')).count, (await plaf(p20b, '2026-10-08', 'panne'))?.count ?? 0], [true, 3, 0]);
    // 19 + 3 unités dépasse 20 : le compteur dédié est rendu à 19 et c'est le plafond de pannes ordinaire qui juge (une unité)
    await db.col('plafonds').updateOne({ porteur: `compte:${p20b.id}`, jour: '2026-10-08', type: 'jumeaux' }, { $set: { count: 19 } });
    const l20b = await lotDe(p20b, 'lotK', 3);
    const rk = await Lg.rembourser(p20b, l20b[0], 'introuvable', { scanId: 'lotK', compteur: 'jumeaux', unites: 3, maintenant: t }, cfg);
    H.v('   19 déjà pris + 3 unités > 20 : le compteur dédié reste à 19 (rollback complet), le plafond de pannes ordinaire juge (rendu, pannes 1)', [rk.rendu, (await plaf(p20b, '2026-10-08', 'jumeaux')).count, (await plaf(p20b, '2026-10-08', 'panne')).count], [true, 19, 1]);
    // des unités mal formées sont refusées (jamais 0, négatif ou fractionnaire : un compteur qui ne monte pas serait gratuit sans limite)
    const p20c = await compteN(9); const c20c = await prendre(p20c, 'u0');
    const mal = []; for (const u of [0, -1, 1.5, '2', NaN]) mal.push((await Lg.rembourser(p20c, c20c, 'introuvable', { scanId: 'u0', compteur: 'jumeaux', unites: u, maintenant: t }, cfg)).raisonNonRembourse);
    H.v('   unites 0, -1, 1.5, « 2 », NaN : toutes refusées (erreur), rien d\'écrit, crédit resté débité', [mal, await db.col('plafonds').countDocuments({ porteur: `compte:${p20c.id}` }), await restant(p20c)], [Array(5).fill('erreur'), 0, 8]);
    await H.fermerBac(); H.bilan();
})().catch(e => { console.error('❌', e); process.exit(1); });
