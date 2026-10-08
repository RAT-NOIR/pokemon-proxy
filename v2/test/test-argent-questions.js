'use strict';
const H = require('./_harnais'); const db = require('../db'); const M = require('../modeles'); const { lireConfig } = require('../config'); const Lg = require('../argent/ledger'); const Q = require('../argent/questions');
const { compte, inst, lire } = require('./_aide-argent');
const cfg = lireConfig({ MONGODB_BASE: 'test_scratch', V2_HEBDO: '0' });
const t = new Date('2026-10-08T10:00:00Z'), h = n => new Date(t.getTime() + n * 3600e3);
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
    const p1 = await compte({ solde: { accueil: 0, achete: 5 } }); const a = await poser(p1);
    H.v('réservée : en-attente', a.r.etat, 'en-attente');
    H.v('   mouvement de débit etat reserve', (await mouv(p1, a.scanId)).etat, 'reserve');
    H.v('   solde déjà en moins', (await lire(p1)).solde.achete, 4);
    const nMv = await db.col('mouvements').countDocuments({});
    const r1 = await rep(p1, a.scanId, 'c1');
    H.v('réponse par un candidat : 200 repondue', [r1.statut, r1.etat], [200, 'repondue']);
    H.v('   mouvement debite, solde inchangé, aucun mouvement de plus', [(await mouv(p1, a.scanId)).etat, (await lire(p1)).solde.achete, await db.col('mouvements').countDocuments({})], ['debite', 4, nMv]);
    // 2. rejeu de la MÊME réponse : même corps, rien de plus
    const r1b = await rep(p1, a.scanId, 'c1', h(2));
    H.v('rejeu de la même réponse : 200, même corps', [r1b.statut, r1b.etat, r1b.question.reponse.idProduct], [200, 'repondue', 111]);
    H.v('   aucun mouvement de plus', await db.col('mouvements').countDocuments({}), nMv);
    // 3. réponse DIFFÉRENTE sur une question tranchée : 409 (repondue ET remboursee)
    const r1c = await rep(p1, a.scanId, 'c2', h(2));
    H.v('autre réponse sur une question repondue : 409 CONFLIT', [r1c.statut, r1c.code], [409, 'CONFLIT']);
    const b = await poser(p1); await rep(p1, b.scanId, 'aucune');
    H.v('autre réponse sur une question remboursee : 409', (await rep(p1, b.scanId, 'c1', h(2))).statut, 409);
    H.v('   la même réponse « aucune » rejouée : 200 sans second remboursement', [(await rep(p1, b.scanId, 'aucune', h(2))).statut, (await lire(p1)).solde.achete], [200, 4]);
    // 4. aucune / ne-sait-pas : crédit rendu au compteur QUESTION ; 30/jour
    const p4 = await compte({ solde: { accueil: 0, achete: 40 } }); const s4 = [];
    for (let i = 0; i < 31; i++) s4.push(await poser(p4));
    const out = []; for (let i = 0; i < 31; i++) out.push(await rep(p4, s4[i].scanId, i % 2 ? 'ne-sait-pas' : 'aucune'));
    H.v('31 abandons (dénominateur 31) : 30 remboursées', out.filter(r => r.etat === 'remboursee').length, 30);
    H.v('   la 31e : non-remboursee, cause plafond-jour', [out[30].etat, out[30].question.raisonNonRembourse], ['non-remboursee', 'plafond-jour']);
    H.v('   solde : 40 - 31 + 30', (await lire(p4)).solde.achete, 39);
    H.v('   compteur question = 30, compteur panne absent', [(await db.col('plafonds').findOne({ porteur: `compte:${p4.id}`, type: 'question' })).count, await db.col('plafonds').countDocuments({ porteur: `compte:${p4.id}`, type: 'panne' })], [30, 0]);
    // 5. choix hors liste => 400 ENTREE ; question d'un AUTRE porteur => 404
    const p5 = await compte({ solde: { accueil: 0, achete: 3 } }), p5b = await compte({ solde: { accueil: 0, achete: 3 } }); const c5 = await poser(p5);
    const bad = await rep(p5, c5.scanId, 'zzz');
    H.v('choix hors question.choix : 400 ENTREE', [bad.statut, bad.code], [400, 'ENTREE']);
    H.v('question d\'un autre porteur : 404', (await rep(p5b, c5.scanId, 'c1')).statut, 404);
    H.v('   et elle reste en-attente', (await db.col('questions').findOne({ _id: `${c5.scanId}:0` })).etat, 'en-attente');
    H.v('question inconnue : 404', (await rep(p5, 'nexistepas', 'c1')).statut, 404);
    // 6. après 24 h : 410, réglée comme abandonnée (crédit rendu)
    const p6 = await compte({ solde: { accueil: 0, achete: 3 } }); const c6 = await poser(p6);
    const r6 = await rep(p6, c6.scanId, 'c1', h(25));
    H.v('réponse après 24 h : 410', r6.statut, 410);
    H.v('   réglée comme abandonnée : remboursee, solde rendu', [(await db.col('questions').findOne({ _id: `${c6.scanId}:0` })).etat, (await lire(p6)).solde.achete], ['remboursee', 3]);
    // 7. réponse ET balayage simultanés : le crédit n'est rendu qu'au plus une fois
    const p7 = await compte({ solde: { accueil: 0, achete: 3 } }); const c7 = await poser(p7);
    const mix = await Promise.all([...Array.from({ length: 10 }, () => rep(p7, c7.scanId, 'aucune', h(25))), ...Array.from({ length: 10 }, () => Q.balayerQuestions({ maintenant: h(25), max: 50 }, cfg))]);
    const q7 = await db.col('questions').findOne({ _id: `${c7.scanId}:0` });
    H.v('20 requêtes mixtes sur une question échue : état final unique remboursee', q7.etat, 'remboursee');
    H.v('   crédit rendu UNE fois (solde 3, un seul mouvement rb)', [(await lire(p7)).solde.achete, await db.col('mouvements').countDocuments({ cleIdempotence: `rb|${c7.scanId}` })], [3, 1]);
    const p7b = await compte({ solde: { accueil: 0, achete: 3 } }); const c7b = await poser(p7b); const rs = await Promise.all([rep(p7b, c7b.scanId, 'c1'), rep(p7b, c7b.scanId, 'aucune')]);
    const q7b = await db.col('questions').findOne({ _id: `${c7b.scanId}:0` }), s7b = (await lire(p7b)).solde.achete;
    H.v('réponse candidat vs abandon simultanés : un seul gagne, argent cohérent', [rs.filter(r => r.statut === 200).length, q7b.etat === 'repondue' ? s7b === 2 : s7b === 3], [1, true]);
    // 8. balayage
    await db.col('questions').deleteMany({});
    const p8 = await compte({ solde: { accueil: 0, achete: 9 } }); const o1 = await poser(p8), o2 = await poser(p8, { le: new Date(t.getTime() + 60e3) });
    const fin = new Date(t.getTime() + 24 * 3600e3 + 1000);                         // o1 a 24 h et 1 s, o2 23 h 59 min 1 s
    await db.col('questions').insertOne({ _id: 'bloc:0', scanId: 'bloc', carte: 0, porteur: { type: 'compte', id: p8.id }, surface: 'scanner', credit: { poche: 'achete' }, choix, candidats: [111], poseeLe: new Date(t.getTime() - 3600e3), etat: 'en-reglement', priseLe: new Date(fin.getTime() - 20 * 60e3), lot: false });
    const bl = await Q.balayerQuestions({ maintenant: fin, max: 50 }, cfg);
    H.v('balayage : 1 remboursée (24 h 1 s), 1 intacte (23 h 59), 1 bloquée comptée', [bl.reglees, bl.remboursees, bl.nonRemboursees, bl.erreurs, bl.bloquees], [1, 1, 0, 0, 1]);
    H.v('   la jeune est intacte et la bloquée jamais reprise', [(await db.col('questions').findOne({ _id: `${o2.scanId}:0` })).etat, (await db.col('questions').findOne({ _id: 'bloc:0' })).etat], ['en-attente', 'en-reglement']);
    H.v('   solde : 9 - 2 + 1', (await lire(p8)).solde.achete, 8);
    const bl2 = await Q.balayerQuestions({ maintenant: fin, max: 50 }, cfg);
    H.v('   second balayage : rien de plus, la bloquée toujours comptée', [bl2.reglees, bl2.bloquees], [0, 1]);
    // 9. lot : la réponse n'écrit aucun mouvement, ne rembourse rien
    const p9 = await compte({ solde: { accueil: 0, achete: 5 } }); const l1 = await poser(p9, { lot: true });
    H.v('lot : le débit n\'est PAS passé en reserve', (await mouv(p9, l1.scanId)).etat, 'debite');
    const nm9 = await db.col('mouvements').countDocuments({});
    const rl = await rep(p9, l1.scanId, 'c2'); const l2 = await poser(p9, { lot: true }); const nm9b = await db.col('mouvements').countDocuments({}); const rl2 = await rep(p9, l2.scanId, 'aucune');
    H.v('   réponses de lot : 200 repondue, la vérité enregistrée', [rl.statut, rl.etat, (await db.col('questions').findOne({ _id: `${l1.scanId}:0` })).reponse.idProduct], [200, 'repondue', 222]);
    H.v('   « aucune » sur un lot : ni mouvement ni remboursement', [rl2.etat, await db.col('mouvements').countDocuments({}), (await lire(p9)).solde.achete], ['repondue', nm9b, 3]);
    H.v('   et la réponse de lot n\'a écrit aucun mouvement', nm9 + 1, nm9b);   // seul le débit du second poser() a été ajouté entre les deux comptes
    // 10. repli : l'écriture de la question échoue (clé déjà prise) => remboursée tout de suite
    const p10 = await compte({ solde: { accueil: 0, achete: 4 } }); const sid = 'repli1';
    await db.col('questions').insertOne({ _id: `${sid}:0`, etat: 'repondue' });
    const rp = await poser(p10, { scanId: sid });
    H.v('repli : remboursée à l\'émission, cause renseignée', [rp.r.etat, typeof rp.r.repli, (await lire(p10)).solde.achete], ['remboursee', 'string', 4]);
    // 11. credit null (administrateur) : rien à régler
    H.v('credit null : etat null, rien d\'écrit', [(await Q.reserverQuestion(p10, null, { scanId: 'adm', carte: 0, raison: 'x', candidats: [], choix: [] }, cfg, t)).etat, await db.col('questions').countDocuments({ _id: 'adm:0' })], [null, 0]);
    // 12. la facturation rendue avec la réponse (forme CONTRAT-2, via argent/facturation.js)
    H.v('facturation d\'une réponse par un candidat : débitée', r1.facturation, { debite: 1, reserve: 0, rembourse: 0, motif: 'question', raisonNonRembourse: null });
    H.v('   d\'un abandon remboursé', out[0].facturation, { debite: 0, reserve: 0, rembourse: 1, motif: 'question', raisonNonRembourse: null });
    H.v('   d\'un abandon au plafond : reste débité, la cause est dite', out[30].facturation, { debite: 1, reserve: 0, rembourse: 0, motif: 'plafond-jour', raisonNonRembourse: 'plafond-jour' });
    H.v('   d\'un lot : rien de plus facturé', rl.facturation, { debite: 0, reserve: 0, rembourse: 0, motif: 'lot', raisonNonRembourse: null });
    await H.fermerBac(); H.bilan();
})().catch(e => { console.error('❌', e); process.exit(1); });
