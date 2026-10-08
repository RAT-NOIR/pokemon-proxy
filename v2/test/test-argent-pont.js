'use strict';
const H = require('./_harnais'); const db = require('../db'); const M = require('../modeles'); const { lireConfig } = require('../config'); const registre = require('../registre');
delete process.env.CODE_ILLIMITE;
const acces = require('../../acces'); const { dansUnScan, raisonNonRemboursement } = require('../../sources');
const Lg = require('../argent/ledger'); const Pont = require('../argent/pont-acces'); const monter = require('../argent/monter');
const { compte, inst, lire } = require('./_aide-argent');
const cfg = lireConfig({ MONGODB_BASE: 'test_scratch', V2_HEBDO: '0' });
const t = new Date('2026-10-08T10:00:00Z');
const brut = nom => require('mongoose').connection.db.collection(nom);                    // les collections HÉRITÉES (noms nus), jamais préfixées
const HERITEES = ['credits', 'quotas_semaine', 'remboursements', 'remboursements_questions', 'questions'];
const nbV2 = async () => { const o = {}; for (const n of HERITEES) o[n] = await brut(n).countDocuments({ $or: [{ userId: /^v2:/ }, { _id: /^pont/ }] }); return o; };
// une requête comme la fabriquera B1 : le crédit débité + le pont
async function requete(p, scanId, { le = t } = {}) {
    const d = await Lg.debiter(p, { scanId, cleIdempotence: `d|${scanId}`, maintenant: le }, cfg);
    const req = { body: {}, scanId }; req.credit = Pont.creditPourReq(p, d.credit, cfg, { scanId, maintenant: le }); return req;
}
(async () => {
    await H.ouvrirBac('test-argent-pont.js'); await M.creerIndex();
    const avant = await nbV2();
    // 1. rembourserScan d'acces.js sur une req portant credit.v2
    const p1 = await compte({ solde: { accueil: 0, achete: 3 } }); const q1 = await requete(p1, 'pont-s1');
    H.v('la req porte le crédit v2 et un userId préfixé', [typeof q1.credit.v2.rembourser, q1.credit.userId.startsWith('v2:'), q1.credit.poche], ['function', true, 'achete']);
    const r1 = await dansUnScan(async () => ({ rendu: await acces.rembourserScan(q1, 'ia-echec'), cause: raisonNonRemboursement() }));
    H.v('rembourserScan(req, ia-echec) => true, le solde revient', [r1.rendu, r1.cause, (await lire(p1)).solde.achete], [true, null, 3]);
    H.v('   req.scanRembourse et req.scanRendu posés', [q1.scanRembourse, q1.scanRendu], [true, true]);
    // 2. un second appel : false, cause deja-rembourse
    const r2 = await dansUnScan(async () => ({ rendu: await acces.rembourserScan(q1, 'ia-echec'), cause: raisonNonRemboursement() }));
    H.v('second appel : false, cause deja-rembourse, solde inchangé', [r2.rendu, r2.cause, (await lire(p1)).solde.achete], [false, 'deja-rembourse', 3]);
    // administrateur : aucun débit
    const pad = await compte({ solde: { accueil: 5, achete: 5 }, role: 'administrateur' }); const qa = await requete(pad, 'pont-adm');
    const ra = await dansUnScan(async () => ({ rendu: await acces.rembourserScan(qa, 'ia-echec'), cause: raisonNonRemboursement() }));
    H.v('administrateur : false, cause aucun-debit, soldes intacts', [ra.rendu, ra.cause, (await lire(pad)).solde], [false, 'aucun-debit', { accueil: 5, achete: 5 }]);
    // le plafond des pannes remonte avec SA cause (celle où l'utilisateur paie)
    const p3 = await compte({ solde: { accueil: 0, achete: 20 } }); const res = [];
    for (let i = 0; i < 6; i++) { const q = await requete(p3, `pont-p${i}`); res.push(await dansUnScan(async () => ({ rendu: await acces.rembourserScan(q, 'ia-echec'), cause: raisonNonRemboursement() }))); }
    H.v('6 pannes : 5 rendues puis plafond-jour, la cause est celle de sources.js', res.map(r => r.rendu ? 'rendu' : r.cause), ['rendu', 'rendu', 'rendu', 'rendu', 'rendu', 'plafond-jour']);
    // une cause que v2 connaît seule se dit avec la liste fermée de sources.js (jamais une valeur refusée)
    const p4 = await compte({ solde: { accueil: 0, achete: 0 }, abonnement: { actif: true, quotaMensuel: 3, moisCle: '2026-10', restant: 3, jusquAu: new Date('2027-01-01') } });
    const q4 = await requete(p4, 'pont-ab', { le: t }); q4.credit.v2 = Pont.creditV2(p4, { poche: 'abonnement', moisCle: '2026-10' }, cfg, { scanId: 'pont-ab', maintenant: new Date('2026-11-02T10:00:00Z') });
    const r4 = await dansUnScan(async () => ({ rendu: await acces.rembourserScan(q4, 'ia-echec'), cause: raisonNonRemboursement() }));
    H.v('abonnement remboursé le mois suivant : false, cause publique poche-introuvable', [r4.rendu, r4.cause], [false, 'poche-introuvable']);
    // 3. signalerIncertain => compteur QUESTION
    const p5 = await compte({ solde: { accueil: 0, achete: 3 } }); const q5 = await requete(p5, 'pont-s5');
    const r5 = await dansUnScan(async () => await acces.signalerIncertain(q5, 'egalite'));
    H.v('signalerIncertain : rendu, au compteur QUESTION (jamais celui des pannes)', [r5, (await db.col('plafonds').findOne({ porteur: `compte:${p5.id}`, type: 'question' }))?.count, await db.col('plafonds').countDocuments({ porteur: `compte:${p5.id}`, type: 'panne' })], [true, 1, 0]);
    // 4. poserQuestion d'acces.js => ligne dans questions v2, req.questionId posé
    const p6 = await compte({ solde: { accueil: 0, achete: 3 } }); const q6 = await requete(p6, 'pont-s6');
    const pq = await acces.poserQuestion(q6, { scanId: 'pont-s6', raison: 'egalite', candidats: [111, 222] });
    const ligne = await db.col('questions').findOne({ _id: 'pont-s6:0' });
    H.v('poserQuestion : en-attente, ligne dans questions v2, req.questionId posé', [pq.etat, ligne && ligne.etat, ligne && ligne.candidats, q6.questionId], ['en-attente', 'en-attente', [111, 222], 'pont-s6']);
    H.v('   le débit est passé en reserve (rendu à l\'abandon, débité à la réponse)', (await db.col('mouvements').findOne({ compteId: p6.id, type: 'debit', scanId: 'pont-s6' })).etat, 'reserve');
    // une panne APRÈS la question, dans la même requête : la question est annulée D'ABORD, le crédit n'est rendu qu'une fois
    const r6 = await dansUnScan(async () => await acces.rembourserScan(q6, 'exception-apres-question'));
    H.v('panne après la question : remboursé une fois, la question n\'attend plus de réponse', [r6, (await db.col('questions').findOne({ _id: 'pont-s6:0' })).etat, (await lire(p6)).solde.achete, await db.col('mouvements').countDocuments({ cleIdempotence: 'rb|pont-s6' })], [true, 'non-remboursee', 3, 1]);
    const bal = await require('../argent/questions').balayerQuestions({ maintenant: new Date(t.getTime() + 30 * 3600e3), max: 20 }, cfg);
    H.v('   le balayage ne rend rien de plus (24 h plus tard)', [bal.reglees, (await lire(p6)).solde.achete], [0, 3]);
    // la question qui ne peut pas s'écrire : repli, remboursée tout de suite
    const p7 = await compte({ solde: { accueil: 0, achete: 3 } }); const q7 = await requete(p7, 'pont-s7'); await db.col('questions').insertOne({ _id: 'pont-s7:0', etat: 'x' });
    const pr = await acces.poserQuestion(q7, { scanId: 'pont-s7', raison: 'egalite', candidats: [1] });
    H.v('écriture refusée : repli remboursée, req.scanRembourse posé, solde rendu', [pr.etat, typeof pr.repli, q7.scanRembourse, (await lire(p7)).solde.achete], ['remboursee', 'string', true, 3]);
    const pcn = await acces.poserQuestion({ body: {}, credit: Pont.creditPourReq(pad, null, cfg, { scanId: 'x' }) }, { scanId: 'pont-adm2', raison: 'x', candidats: [] });
    H.v('administrateur (credit null) : etat null, rien à régler', pcn.etat, null);
    // 5. AUCUNE écriture dans les collections héritées — et la sonde SAIT dire non (un document v2:* planté est vu, puis retiré)
    const plante = await brut('credits').insertOne({ userId: 'v2:plante', soldeGratuit: 0, soldeScans: 0 });
    H.v('   la sonde voit un document v2:* planté dans credits', (await nbV2()).credits, 1);
    await brut('credits').deleteOne({ _id: plante.insertedId });
    const apres = await nbV2();
    H.v(`aucune écriture v2 dans les ${HERITEES.length} collections héritées (documents v2:* / pont*)`, [avant, apres], [Object.fromEntries(HERITEES.map(n => [n, 0])), Object.fromEntries(HERITEES.map(n => [n, 0]))]);
    // 6. le registre : monter.routes() fournit « argent » avec la config liée
    registre.vider(); monter.routes({ post() { } }, cfg, {});
    const A = registre.obtenir('argent');
    H.v('registre : argent fourni avec les fonctions du contrat §3.3', ['solde', 'historique', 'debiter', 'rembourser', 'reserverQuestion', 'repondreQuestion', 'fusionnerALaLiaison', 'reprendreHeritage', 'rattacherAchats'].map(k => typeof A[k]), Array(9).fill('function'));
    const pr8 = await compte({ solde: { accueil: 0, achete: 2 } });
    const s8 = await A.solde(pr8); const d8 = await A.debiter(pr8, { scanId: 'pont-s8', cleIdempotence: 'pont-d8' });
    H.v('   solde() et debiter() appelés SANS cfg (liée au montage)', [s8.total, d8.ok, d8.credit.poche, (await A.solde(pr8)).total], [2, true, 'achete', 1]);
    registre.vider();
    await H.fermerBac(); H.bilan();
})().catch(e => { console.error('❌', e); process.exit(1); });
