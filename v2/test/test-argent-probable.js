'use strict';
// PROBABLE (31/10) — la facturation d'une question PROBABLE, décision de l'éditeur (25/10) : un probable affiché avec un prix est DÉBITÉ À L'AFFICHAGE (debite 1, reserve 0), un seul débit par scan ;
// « aucune » REMBOURSE (compteur des constats, plafonné par l'offre) ; « ne-sait-pas » et l'abandon (24 h) NE remboursent PAS ; jamais deux débits pour un scan, un remboursement au plus.
const H = require('./_harnais'); const db = require('../db'); const M = require('../modeles'); const Lg = require('../argent/ledger'); const Q = require('../argent/questions');
const { compte } = require('./_aide-argent');
const Q2 = require('./_aide-quota');
const cfg = Q2.cfgGrand({ V2_HEBDO: '0' });
const t = new Date('2026-10-08T10:00:00Z'), h = n => new Date(t.getTime() + n * 3600e3);
const restant = p => Q2.restantDe(p, cfg, t);
const choix = [{ id: 'c1', idProduct: 111 }, { id: 'c2', idProduct: 222 }];
let nScan = 0;
const compteN = async n => { const p = await compte(); await Q2.poserRestant(`compte:${p.id}`, n, { jour: '2026-10-08' }); return p; };
// un scan débité, sa question réservée comme d'habitude, PUIS passée en probable (la route décide après la chaîne)
const poser = async (p, o = {}) => { const scanId = `pb${++nScan}`; const d = await Lg.debiter(p, { scanId, cleIdempotence: `d|${scanId}`, maintenant: t }, cfg);
    const r = await Q.reserverQuestion(p, d.credit, { scanId, carte: 0, raison: 'egalite', candidats: [111, 222], choix, lot: o.lot || false }, cfg, t);
    const pr = o.sansProbable ? null : await Q.passerEnProbable(p, { scanId, carte: 0 }, cfg); return { scanId, r, pr }; };
const rep = (p, scanId, ch, now = h(1)) => Q.repondreQuestion(p, { scanId, carte: 0, choix: ch }, cfg, now);
const mouv = (p, scanId) => db.col('mouvements').findOne({ compteId: p.id, type: 'debit', scanId });
const nDebits = (p, scanId) => db.col('mouvements').countDocuments({ compteId: p.id, type: 'debit', scanId, delta: -1 });
const nRendus = scanId => db.col('mouvements').countDocuments({ type: 'remboursement', scanId, delta: 1 });
(async () => {
    await H.ouvrirBac('test-argent-probable.js'); await M.creerIndex();
    // 1. passage en probable : le débit reste DÉBITÉ (jamais « reserve »), le solde est déjà pris, la question porte le marqueur
    const p1 = await compteN(10); const a = await poser(p1);
    H.v('passerEnProbable : ok', a.pr && a.pr.ok, true);
    H.v('   mouvement de débit etat debite (pas reserve), solde 9', [(await mouv(p1, a.scanId)).etat, await restant(p1)], ['debite', 9]);
    H.v('   la question est en-attente et marquée probable', (await db.col('questions_v2').findOne({ _id: `${a.scanId}:0` })).probable, true);
    H.v('   rejeu du passage : idempotent', (await Q.passerEnProbable(p1, { scanId: a.scanId, carte: 0 }, cfg)).ok, true);
    // 2. réponse par un candidat : debite 1, rien de plus
    const r1 = await rep(p1, a.scanId, 'c1');
    H.v('réponse par un candidat : repondue, debite 1 reserve 0', [r1.statut, r1.etat, r1.facturation.debite, r1.facturation.reserve, r1.facturation.rembourse], [200, 'repondue', 1, 0, false]);
    H.v('   un seul débit, aucun remboursement, solde 9', [await nDebits(p1, a.scanId), await nRendus(a.scanId), await restant(p1)], [1, 0, 9]);
    // 3. « aucune » : REMBOURSE, par le compteur des constats (pas des déclarations)
    const b = await poser(p1);
    H.v('probable en attente : facturation debite 1 reserve 0', Q.facturationDe(await db.col('questions_v2').findOne({ _id: `${b.scanId}:0` })).debite, 1);
    const r3 = await rep(p1, b.scanId, 'aucune');
    H.v('« aucune » : remboursee, rembourse true', [r3.etat, r3.facturation.rembourse, r3.facturation.debite], ['remboursee', true, 0]);
    H.v('   un débit, un remboursement ; compteur constate = 1, compteur declare absent', [await nDebits(p1, b.scanId), await nRendus(b.scanId), (await db.col('plafonds').findOne({ porteur: `compte:${p1.id}`, type: 'constate' })).count, await db.col('plafonds').countDocuments({ porteur: `compte:${p1.id}`, type: 'declare' })], [1, 1, 1, 0]);
    const r3b = await rep(p1, b.scanId, 'aucune', h(2));
    H.v('   rejeu de « aucune » : même corps, pas de second remboursement', [r3b.etat, await nRendus(b.scanId)], ['remboursee', 1]);
    H.v('   une autre réponse après : 409', (await rep(p1, b.scanId, 'c1', h(2))).statut, 409);
    // 4. « ne-sait-pas » : NE rembourse PAS
    const c = await poser(p1); const sold = await restant(p1);
    const r4 = await rep(p1, c.scanId, 'ne-sait-pas');
    H.v('« ne-sait-pas » : debite 1, pas de remboursement', [r4.statut, r4.facturation.debite, r4.facturation.rembourse, await nRendus(c.scanId), await restant(p1)], [200, 1, false, 0, sold]);
    H.v('   rejeu : même corps', [(await rep(p1, c.scanId, 'ne-sait-pas', h(2))).facturation.debite, await nRendus(c.scanId)], [1, 0]);
    // 5. abandon 24 h : NE rembourse PAS
    const d = await poser(p1); const sold5 = await restant(p1);
    const bal = await Q.balayerQuestions({ maintenant: h(25), max: 50 }, cfg);
    H.v('abandon sous 24 h (balayage) : réglée, aucun crédit rendu', [bal.reglees >= 1, await nRendus(d.scanId), await restant(p1)], [true, 0, sold5]);
    const l5 = await db.col('questions_v2').findOne({ _id: `${d.scanId}:0` });
    H.v('   la question n\'est ni remboursee ni bloquée', ['remboursee', 'en-reglement', 'en-attente'].includes(l5.etat), false);
    const r5 = await rep(p1, d.scanId, 'c1', h(26));
    H.v('   répondre après coup : pas de remboursement, jamais deux débits', [await nRendus(d.scanId), await nDebits(p1, d.scanId)], [0, 1]);
    // 6. « aucune » au-delà du plafond des constats : refusé (plafond-jour), le débit reste
    const p6 = await compteN(100); const out = [];
    for (let i = 0; i < 21; i++) { const s = await poser(p6); out.push(await rep(p6, s.scanId, 'aucune')); }
    H.v('21 « aucune » d\'un compte sans offre (plafond 20 ou 50 selon l\'offre) : au moins un refus au plafond ou tous rendus, jamais plus d\'un rendu par scan', out.every(o => o.etat === 'remboursee' || o.question.raisonNonRembourse === 'plafond-jour'), true);
    // 7. une question ORDINAIRE n'est pas touchée : reserve puis « ne-sait-pas » rembourse (déclaration)
    const p7 = await compteN(10); const e = await poser(p7, { sansProbable: true });
    H.v('sans passage en probable : toujours reserve', (await mouv(p7, e.scanId)).etat, 'reserve');
    H.v('   « ne-sait-pas » : remboursee comme avant', (await rep(p7, e.scanId, 'ne-sait-pas')).etat, 'remboursee');
    // 8. jamais pour un lot, ni pour une question déjà répondue
    const p8 = await compteN(10); const f = await poser(p8, { lot: true });
    H.v('une question de LOT ne passe pas en probable', f.pr && f.pr.ok, false);
    const g = await poser(p8, { sansProbable: true }); await rep(p8, g.scanId, 'c1');
    H.v('une question déjà répondue ne passe pas en probable', (await Q.passerEnProbable(p8, { scanId: g.scanId, carte: 0 }, cfg)).ok, false);
    H.v('une question inconnue : ok false', (await Q.passerEnProbable(p8, { scanId: 'zz', carte: 0 }, cfg)).ok, false);
    await H.fermerBac(); H.bilan();
})().catch(e => { console.error('❌', e); process.exit(1); });
