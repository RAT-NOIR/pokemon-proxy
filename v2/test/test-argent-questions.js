'use strict';
const H = require('./_harnais'); const db = require('../db'); const M = require('../modeles'); const { lireConfig } = require('../config'); const Lg = require('../argent/ledger'); const Q = require('../argent/questions');
const { compte, inst, lire } = require('./_aide-argent');
const Q2 = require('./_aide-quota');
// OFFRE-QUOTA : un « solde » de N crédits devient un quota du jour de 1000 dont 1000 - N sont déjà pris (voir _aide-quota.js) ; l'arithmétique des questions n'en change pas.
const cfg = Q2.cfgGrand({ V2_HEBDO: '0' });
const t = new Date('2026-10-08T10:00:00Z'), h = n => new Date(t.getTime() + n * 3600e3);
const restant = p => Q2.restantDe(p, cfg, t);
const compteN = async n => { const p = await compte(); await Q2.poserRestant(`compte:${p.id}`, n, { jour: '2026-10-08' }); return p; };
let nScan = 0;
const choix = [{ id: 'c1', idProduct: 111 }, { id: 'c2', idProduct: 222 }];
// un scan débité PUIS sa question réservée : rend { p, credit, scanId }
const poser = async (p, o = {}) => { const scanId = o.scanId || `sc${++nScan}`; const d = await Lg.debiter(p, { scanId, cleIdempotence: `d|${scanId}`, maintenant: o.le || t }, cfg);
    const r = await Q.reserverQuestion(p, d.credit, { scanId, carte: 0, raison: 'egalite', candidats: [111, 222], choix, lot: o.lot || false }, cfg, o.le || t); return { scanId, credit: d.credit, r }; };
const rep = (p, scanId, ch, now = h(1), carte = 0) => Q.repondreQuestion(p, { scanId, carte, choix: ch }, cfg, now);
const mouv = (p, scanId) => db.col('mouvements').findOne({ ...(p.type === 'compte' ? { compteId: p.id } : { installationId: p.id }), type: 'debit', scanId });
(async () => {
    await H.ouvrirBac('test-argent-questions.js'); await M.creerIndex();
    // 1. réservée : le débit passe 'reserve', RIEN n'est débité de plus à la réponse
    const p1 = await compteN(5); const a = await poser(p1);
    H.v('réservée : en-attente', a.r.etat, 'en-attente');
    H.v('   mouvement de débit etat reserve', (await mouv(p1, a.scanId)).etat, 'reserve');
    H.v('   solde déjà en moins', (await restant(p1)), 4);
    const nMv = await db.col('mouvements').countDocuments({});
    const r1 = await rep(p1, a.scanId, 'c1');
    H.v('réponse par un candidat : 200 repondue', [r1.statut, r1.etat], [200, 'repondue']);
    H.v('   mouvement debite, solde inchangé, aucun mouvement de plus', [(await mouv(p1, a.scanId)).etat, (await restant(p1)), await db.col('mouvements').countDocuments({})], ['debite', 4, nMv]);
    // 2. rejeu de la MÊME réponse : même corps, rien de plus
    const r1b = await rep(p1, a.scanId, 'c1', h(2));
    H.v('rejeu de la même réponse : 200, même corps', [r1b.statut, r1b.etat, r1b.question.reponse.idProduct], [200, 'repondue', 111]);
    H.v('   aucun mouvement de plus', await db.col('mouvements').countDocuments({}), nMv);
    // 3. réponse DIFFÉRENTE sur une question tranchée : 409 (repondue ET remboursee)
    const r1c = await rep(p1, a.scanId, 'c2', h(2));
    H.v('autre réponse sur une question repondue : 409 CONFLIT', [r1c.statut, r1c.code], [409, 'CONFLIT']);
    const b = await poser(p1); await rep(p1, b.scanId, 'aucune');
    H.v('autre réponse sur une question remboursee : 409', (await rep(p1, b.scanId, 'c1', h(2))).statut, 409);
    H.v('   la même réponse « aucune » rejouée : 200 sans second remboursement', [(await rep(p1, b.scanId, 'aucune', h(2))).statut, (await restant(p1))], [200, 4]);
    // 4. aucune / ne-sait-pas : crédit rendu au compteur QUESTION ; 30/jour
    const p4 = await compteN(40); const s4 = [];
    for (let i = 0; i < 31; i++) s4.push(await poser(p4));
    const out = []; for (let i = 0; i < 31; i++) out.push(await rep(p4, s4[i].scanId, i % 2 ? 'ne-sait-pas' : 'aucune'));
    H.v('31 abandons (dénominateur 31) : 30 remboursées', out.filter(r => r.etat === 'remboursee').length, 30);
    H.v('   la 31e : non-remboursee, cause plafond-jour', [out[30].etat, out[30].question.raisonNonRembourse], ['non-remboursee', 'plafond-jour']);
    H.v('   solde : 40 - 31 + 30', (await restant(p4)), 39);
    H.v('   compteur question = 30, compteur panne absent', [(await db.col('plafonds').findOne({ porteur: `compte:${p4.id}`, type: 'question' })).count, await db.col('plafonds').countDocuments({ porteur: `compte:${p4.id}`, type: 'panne' })], [30, 0]);
    // 5. choix hors liste => 400 ENTREE ; question d'un AUTRE porteur => 404
    const p5 = await compteN(3), p5b = await compteN(3); const c5 = await poser(p5);
    const bad = await rep(p5, c5.scanId, 'zzz');
    H.v('choix hors question.choix : 400 ENTREE', [bad.statut, bad.code], [400, 'ENTREE']);
    H.v('question d\'un autre porteur : 404', (await rep(p5b, c5.scanId, 'c1')).statut, 404);
    H.v('   et elle reste en-attente', (await db.col('questions_v2').findOne({ _id: `${c5.scanId}:0` })).etat, 'en-attente');
    H.v('question inconnue : 404', (await rep(p5, 'nexistepas', 'c1')).statut, 404);
    // 6. après 24 h : 410, réglée comme abandonnée (crédit rendu)
    const p6 = await compteN(3); const c6 = await poser(p6);
    const r6 = await rep(p6, c6.scanId, 'c1', h(25));
    H.v('réponse après 24 h : 410', r6.statut, 410);
    H.v('   réglée comme abandonnée : remboursee, solde rendu', [(await db.col('questions_v2').findOne({ _id: `${c6.scanId}:0` })).etat, (await restant(p6))], ['remboursee', 3]);
    // 7. réponse ET balayage simultanés : le crédit n'est rendu qu'au plus une fois
    const p7 = await compteN(3); const c7 = await poser(p7);
    const mix = await Promise.all([...Array.from({ length: 10 }, () => rep(p7, c7.scanId, 'aucune', h(25))), ...Array.from({ length: 10 }, () => Q.balayerQuestions({ maintenant: h(25), max: 50 }, cfg))]);
    const q7 = await db.col('questions_v2').findOne({ _id: `${c7.scanId}:0` });
    H.v('20 requêtes mixtes sur une question échue : état final unique remboursee', q7.etat, 'remboursee');
    H.v('   crédit rendu UNE fois (solde 3, un seul mouvement rb)', [(await restant(p7)), await db.col('mouvements').countDocuments({ cleIdempotence: `rb|${c7.scanId}` })], [3, 1]);
    const p7b = await compteN(3); const c7b = await poser(p7b); const rs = await Promise.all([rep(p7b, c7b.scanId, 'c1'), rep(p7b, c7b.scanId, 'aucune')]);
    const q7b = await db.col('questions_v2').findOne({ _id: `${c7b.scanId}:0` }), s7b = (await restant(p7b));
    H.v('réponse candidat vs abandon simultanés : un seul gagne, argent cohérent', [rs.filter(r => r.statut === 200).length, q7b.etat === 'repondue' ? s7b === 2 : s7b === 3], [1, true]);
    // 8. balayage
    await db.col('questions_v2').deleteMany({});
    const p8 = await compteN(9); const o1 = await poser(p8), o2 = await poser(p8, { le: new Date(t.getTime() + 60e3) });
    const fin = new Date(t.getTime() + 24 * 3600e3 + 1000);                         // o1 a 24 h et 1 s, o2 23 h 59 min 1 s
    await db.col('questions_v2').insertOne({ _id: 'bloc:0', scanId: 'bloc', carte: 0, porteur: { type: 'compte', id: p8.id }, surface: 'scanner', credit: { poche: 'achete' }, choix, candidats: [111], poseeLe: new Date(t.getTime() - 3600e3), etat: 'en-reglement', priseLe: new Date(fin.getTime() - 20 * 60e3), lot: false });
    const bl = await Q.balayerQuestions({ maintenant: fin, max: 50 }, cfg);
    H.v('balayage : 1 remboursée (24 h 1 s), 1 intacte (23 h 59), 1 bloquée comptée', [bl.reglees, bl.remboursees, bl.nonRemboursees, bl.erreurs, bl.bloquees], [1, 1, 0, 0, 1]);
    H.v('   la jeune est intacte et la bloquée jamais reprise', [(await db.col('questions_v2').findOne({ _id: `${o2.scanId}:0` })).etat, (await db.col('questions_v2').findOne({ _id: 'bloc:0' })).etat], ['en-attente', 'en-reglement']);
    H.v('   solde : 9 - 2 + 1', (await restant(p8)), 8);
    const bl2 = await Q.balayerQuestions({ maintenant: fin, max: 50 }, cfg);
    H.v('   second balayage : rien de plus, la bloquée toujours comptée', [bl2.reglees, bl2.bloquees], [0, 1]);
    // 9. lot : la réponse n'écrit aucun mouvement, ne rembourse rien
    const p9 = await compteN(5); const l1 = await poser(p9, { lot: true });
    H.v('lot : le débit n\'est PAS passé en reserve', (await mouv(p9, l1.scanId)).etat, 'debite');
    const nm9 = await db.col('mouvements').countDocuments({});
    const rl = await rep(p9, l1.scanId, 'c2'); const l2 = await poser(p9, { lot: true }); const nm9b = await db.col('mouvements').countDocuments({}); const rl2 = await rep(p9, l2.scanId, 'aucune');
    H.v('   réponses de lot : 200 repondue, la vérité enregistrée', [rl.statut, rl.etat, (await db.col('questions_v2').findOne({ _id: `${l1.scanId}:0` })).reponse.idProduct], [200, 'repondue', 222]);
    H.v('   « aucune » sur un lot : ni mouvement ni remboursement', [rl2.etat, await db.col('mouvements').countDocuments({}), (await restant(p9))], ['repondue', nm9b, 3]);
    H.v('   et la réponse de lot n\'a écrit aucun mouvement', nm9 + 1, nm9b);   // seul le débit du second poser() a été ajouté entre les deux comptes
    // 10. repli : l'écriture de la question échoue (clé déjà prise) => remboursée tout de suite
    const p10 = await compteN(4); const sid = 'repli1';
    await db.col('questions_v2').insertOne({ _id: `${sid}:0`, etat: 'repondue' });
    const rp = await poser(p10, { scanId: sid });
    H.v('repli : remboursée à l\'émission, cause renseignée', [rp.r.etat, typeof rp.r.repli, (await restant(p10))], ['remboursee', 'string', 4]);
    // 11. credit null (administrateur) : rien à régler
    H.v('credit null : etat null, rien d\'écrit', [(await Q.reserverQuestion(p10, null, { scanId: 'adm', carte: 0, raison: 'x', candidats: [], choix: [] }, cfg, t)).etat, await db.col('questions_v2').countDocuments({ _id: 'adm:0' })], [null, 0]);
    // 12. la facturation rendue avec la réponse (forme CONTRAT-2, via argent/facturation.js)
    H.v('facturation d\'une réponse par un candidat : débitée', r1.facturation, { debite: 1, reserve: 0, rembourse: false, motif: 'question', raisonNonRembourse: null });   // rembourse : BOOLÉEN (contrat, B1b.5)
    H.v('   d\'un abandon remboursé', out[0].facturation, { debite: 0, reserve: 0, rembourse: true, motif: 'question', raisonNonRembourse: null });
    H.v('   d\'un abandon au plafond : reste débité, la cause est dite', out[30].facturation, { debite: 1, reserve: 0, rembourse: false, motif: 'plafond-jour', raisonNonRembourse: 'plafond-jour' });
    H.v('   d\'un lot : rien de plus facturé', rl.facturation, { debite: 0, reserve: 0, rembourse: false, motif: 'lot', raisonNonRembourse: null });
    // 13. I3 — réserver DEUX FOIS la même (scanId, carte) est idempotent : ni crédit rendu, ni question touchée
    const p13 = await compteN(3); const d13 = await Lg.debiter(p13, { scanId: 'dup', cleIdempotence: 'd|dup', maintenant: t }, cfg);
    const res13 = { scanId: 'dup', carte: 0, raison: 'x', candidats: [111, 222], choix };
    const a13 = await Q.reserverQuestion(p13, d13.credit, res13, cfg, t), b13 = await Q.reserverQuestion(p13, d13.credit, res13, cfg, t);
    H.v('réservation rejouée : l\'état existant, SANS repli ni remboursement', [a13.etat, b13.etat, b13.repli ?? null, b13.rejoue, (await restant(p13))], ['en-attente', 'en-attente', null, true, 2]);
    H.v('   le débit reste en reserve, une seule question', [(await mouv(p13, 'dup')).etat, await db.col('questions_v2').countDocuments({ scanId: 'dup' })], ['reserve', 1]);
    const c13 = await Promise.all(Array.from({ length: 10 }, () => Q.reserverQuestion(p13, d13.credit, res13, cfg, t)));
    H.v('   10 réservations simultanées : aucune ne rembourse (dénominateur 10)', [c13.filter(r => r.etat === 'en-attente').length, (await restant(p13))], [10, 2]);
    const r13 = await rep(p13, 'dup', 'c1');
    H.v('   puis la réponse par un candidat est facturée sur un crédit TOUJOURS pris', [r13.statut, r13.facturation.debite, (await restant(p13)), (await mouv(p13, 'dup')).etat], [200, 1, 2, 'debite']);
    const e13 = await Q.reserverQuestion(p13, d13.credit, res13, cfg, t);
    H.v('   rejouée APRÈS la réponse : l\'état repondue, le débit n\'est pas remis en reserve', [e13.etat, (await mouv(p13, 'dup')).etat, (await restant(p13))], ['repondue', 'debite', 2]);
    // 14. N2 — une question REMBOURSÉE dont la clé est rejouée : I2 redébite, la réservation retombe sur la question remboursée : le débit neuf est rendu dans le même geste
    const p14 = await compteN(3); const q14 = await poser(p14, { scanId: 'rj' });
    await rep(p14, 'rj', 'aucune');
    H.v('N2 préalable : question remboursee, solde 3', [(await db.col('questions_v2').findOne({ _id: 'rj:0' })).etat, (await restant(p14))], ['remboursee', 3]);
    const d14 = await Lg.debiter(p14, { scanId: 'rj', cleIdempotence: 'd|rj', maintenant: h(2) }, cfg);
    H.v('   la clé rejouée redébite (I2)', [d14.ok, d14.reessaye, (await restant(p14))], [true, true, 2]);
    const x14 = await Q.reserverQuestion(p14, d14.credit, { scanId: 'rj', carte: 0, raison: 'egalite', candidats: [111, 222], choix, cleDebit: d14.cle }, cfg, h(2));
    H.v('   réservation rejouée sur une remboursee : la réponse dit remboursee', [x14.etat, x14.rejoue], ['remboursee', true]);
    H.v('   AUCUN débit sans livraison : solde revenu à 3, aucun débit ouvert', [(await restant(p14)), await db.col('mouvements').countDocuments({ compteId: p14.id, type: 'debit', scanId: 'rj', etat: { $ne: 'rembourse' } })], [3, 0]);
    // 15. N2 (a) — le rendu du débit neuf vise SA ligne seulement : un AUTRE débit ouvert du même scan (autre carte, livré) reste intact, aucun crédit n'est créé
    const p15 = await compteN(5);
    const dA = await Lg.debiter(p15, { scanId: 'mc', cleIdempotence: 'd|mc', maintenant: t }, cfg);
    await Q.reserverQuestion(p15, dA.credit, { scanId: 'mc', carte: 0, raison: 'egalite', candidats: [111, 222], choix }, cfg, t);
    await rep(p15, 'mc', 'aucune');
    await Lg.debiter(p15, { scanId: 'mc', cleIdempotence: 'd|mc|carte1', maintenant: t }, cfg);          // l'autre carte du scan, débitée APRÈS : débit ouvert, livré
    H.v('N2(a) préalable : carte 0 remboursee, la carte 1 reste débitée (solde 4)', [(await db.col('questions_v2').findOne({ _id: 'mc:0' })).etat, (await restant(p15))], ['remboursee', 4]);
    const dR = await Lg.debiter(p15, { scanId: 'mc', cleIdempotence: 'd|mc', maintenant: h(2) }, cfg);
    const x15 = await Q.reserverQuestion(p15, dR.credit, { scanId: 'mc', carte: 0, raison: 'egalite', candidats: [111, 222], choix, cleDebit: dR.cle }, cfg, h(2));
    H.v('   rejeu : remboursee, effectivement', [x15.etat, x15.remboursee], ['remboursee', true]);
    H.v('   la ligne de la carte 1 est INTACTE (debite) et le solde = 4 : aucun crédit créé', [(await db.col('mouvements').findOne({ compteId: p15.id, cleIdempotence: 'd|mc|carte1' })).etat, (await restant(p15))], ['debite', 4]);
    // 16. N2 (b) — si rendre la ligne exacte ÉCHOUE : jamais « remboursee », la ligne est lisible (rendu-echoue), l'échec journalisé en erreur
    const p16 = await compteN(3); await poser(p16, { scanId: 'ech' }); await rep(p16, 'ech', 'aucune');
    const dE = await Lg.debiter(p16, { scanId: 'ech', cleIdempotence: 'd|ech', maintenant: h(2) }, cfg);
    const colReel = db.col, erreurs = []; const err0 = console.error; console.error = (...a) => { erreurs.push(a.join(' ')); };
    db.col = n => (n === 'quota_jour' ? { updateOne: async () => { throw new Error('panne simulée'); } } : colReel(n));
    let x16; try { x16 = await Q.reserverQuestion(p16, dE.credit, { scanId: 'ech', carte: 0, raison: 'egalite', candidats: [111, 222], choix, cleDebit: dE.cle }, cfg, h(2)); } finally { db.col = colReel; console.error = err0; }
    H.v('N2(b) rendu en échec : jamais « remboursee », cause dite', [x16.etat !== 'remboursee', x16.remboursee, typeof x16.raisonNonRembourse], [true, false, 'string']);
    H.v('   la ligne du débit neuf est lisible : rendu-echoue (et reste remboursable plus tard), échec journalisé', [(await db.col('mouvements').findOne({ cleIdempotence: dE.cle })).etat, erreurs.some(e => e.includes('🔴')), (await restant(p16))], ['rendu-echoue', true, 2]);
    const apres = await Lg.rembourser(p16, dE.credit, 'reprise', { scanId: 'ech', compteur: 'question', sansPlafond: true, maintenant: h(3) }, cfg);
    H.v('   une reprise ultérieure rend ce crédit (solde 3)', [apres.rendu, (await restant(p16))], [true, 3]);
    // 17. (1) cleDebit OBLIGATOIRE : sans elle on ne devine JAMAIS une ligne (une unité de lot ré-essayée et livrée porte aussi un cleOrigine) — rien n'est rendu
    const p17 = await compteN(4); await poser(p17, { scanId: 'cd17' }); await rep(p17, 'cd17', 'aucune');
    const d17 = await Lg.debiter(p17, { scanId: 'cd17', cleIdempotence: 'd|cd17', maintenant: h(2) }, cfg);
    const x17 = await Q.reserverQuestion(p17, d17.credit, { scanId: 'cd17', carte: 0, raison: 'egalite', candidats: [111, 222], choix }, cfg, h(2));
    H.v('sans cleDebit : non-remboursee, cle-debit-absente, remboursee:false', [x17.etat, x17.remboursee, x17.raisonNonRembourse], ['non-remboursee', false, 'cle-debit-absente']);
    H.v('   rien n\'est rendu : la ligne neuve reste debite, solde 3 (le débit est visible, pas deviné)', [(await db.col('mouvements').findOne({ cleIdempotence: d17.cle })).etat, (await restant(p17))], ['debite', 3]);
    // 18. (3) l'écriture d'état « rendu-echoue » échoue ELLE-MÊME : la ligne ne doit pas rester « rembourse » (sans crédit ni trace) — elle reste « rendu-en-cours », visible, jamais reprise seule
    const p18 = await compteN(3); await poser(p18, { scanId: 'dbl' }); await rep(p18, 'dbl', 'aucune');
    const d18 = await Lg.debiter(p18, { scanId: 'dbl', cleIdempotence: 'd|dbl', maintenant: h(2) }, cfg);
    const col18 = db.col, err18 = console.error; console.error = () => { };
    db.col = n => (n === 'quota_jour' ? { updateOne: async () => { throw new Error('panne simulée'); } } : n === 'mouvements' ? new Proxy(col18(n), { get: (c, k) => k === 'updateOne' ? async () => { throw new Error('panne simulée 2'); } : c[k].bind(c) }) : col18(n));
    let x18; try { x18 = await Q.reserverQuestion(p18, d18.credit, { scanId: 'dbl', carte: 0, raison: 'egalite', candidats: [111, 222], choix, cleDebit: d18.cle }, cfg, h(2)); } finally { db.col = col18; console.error = err18; }
    H.v('double panne : jamais remboursee, la ligne n\'est PAS « rembourse » mais « rendu-en-cours » (visible)', [x18.etat !== 'remboursee', x18.remboursee, (await db.col('mouvements').findOne({ cleIdempotence: d18.cle })).etat], [true, false, 'rendu-en-cours']);
    H.v('   et un rembourser du scan ne la reprend pas seul (pas de double rendu possible)', [(await Lg.rembourser(p18, d18.credit, 'x', { scanId: 'dbl', compteur: 'question', sansPlafond: true, maintenant: h(3) }, cfg)).rendu, (await restant(p18))], [false, 2]);
    await H.fermerBac(); H.bilan();
})().catch(e => { console.error('❌', e); process.exit(1); });
