'use strict';
const H = require('./_harnais'); const db = require('../db'); const M = require('../modeles'); const { lireConfig } = require('../config'); const Lg = require('../argent/ledger');
const { compte, inst, lire } = require('./_aide-argent');
const cfg = lireConfig({ MONGODB_BASE: 'test_scratch', V2_HEBDO: '0' });          // hebdo coupé : les poches utilisées sont celles que le test nomme
const cfgH = lireConfig({ MONGODB_BASE: 'test_scratch', V2_HEBDO: '2' });
const t = new Date('2026-10-08T10:00:00Z');                                          // jeudi, semaine ISO 2026-W41, mois 2026-10
const prendre = async (p, scanId, c = cfg, maintenant = t) => { const r = await Lg.debiter(p, { scanId, cleIdempotence: `d|${scanId}`, maintenant }, c); if (!r.ok) throw new Error(`débit refusé ${scanId} : ${r.code}`); return r.credit; };
const plaf = async (p, jour, type) => (await db.col('plafonds').findOne({ porteur: `${p.type}:${p.id}`, jour, type }));
(async () => {
    await H.ouvrirBac('test-argent-remboursement.js'); await M.creerIndex();
    // 1. débit puis remboursement
    const p1 = await compte({ solde: { accueil: 3, achete: 0 } }); const cr1 = await prendre(p1, 's1');
    const r1 = await Lg.rembourser(p1, cr1, 'ia-echec', { scanId: 's1', maintenant: t }, cfg);
    H.v('rembourser : rendu', r1, { rendu: true, raisonNonRembourse: null });
    H.v('   solde revenu', (await lire(p1)).solde.accueil, 3);
    H.v('   le mouvement de débit passe rembourse', (await db.col('mouvements').findOne({ compteId: p1.id, type: 'debit', scanId: 's1' })).etat, 'rembourse');
    const mr = await db.col('mouvements').findOne({ cleIdempotence: 'rb|s1' });
    H.v('   mouvement remboursement delta +1', [mr.type, mr.delta, mr.poche], ['remboursement', 1, 'accueil']);
    // 2. une seule fois par scan : séquentiel puis 10 simultanés
    const r1b = await Lg.rembourser(p1, cr1, 'ia-echec', { scanId: 's1', maintenant: t }, cfg);
    H.v('2e remboursement du même scan : deja-rembourse', r1b, { rendu: false, raisonNonRembourse: 'deja-rembourse' });
    const p2 = await compte({ solde: { accueil: 0, achete: 5 } }); const cr2 = await prendre(p2, 's2');
    const rr = await Promise.all(Array.from({ length: 10 }, () => Lg.rembourser(p2, cr2, 'ia-echec', { scanId: 's2', maintenant: t }, cfg)));
    H.v('10 requêtes, 1 rendu', rr.filter(r => r.rendu).length, 1);
    H.v('   les 9 autres : deja-rembourse', rr.filter(r => r.raisonNonRembourse === 'deja-rembourse').length, 9);
    H.v('   solde final = initial', (await lire(p2)).solde.achete, 5);
    // 3. plafond des pannes : 5 passent, la 6e non ; le compteur question est indépendant
    const p3 = await compte({ solde: { accueil: 0, achete: 40 } }); const crs = [];
    for (let i = 0; i < 7; i++) crs.push(await prendre(p3, `p${i}`));
    const pan = []; for (let i = 0; i < 6; i++) pan.push(await Lg.rembourser(p3, crs[i], 'ia-echec', { scanId: `p${i}`, maintenant: t }, cfg));
    H.v('pannes : 5 rendues puis plafond-jour', pan.map(r => r.rendu ? 'rendu' : r.raisonNonRembourse), ['rendu', 'rendu', 'rendu', 'rendu', 'rendu', 'plafond-jour']);
    H.v('   la 6e : le crédit RESTE débité (40 - 7 + 5)', (await lire(p3)).solde.achete, 38);
    H.v('   compteur de pannes resté à 5 (rollback)', (await plaf(p3, '2026-10-08', 'panne')).count, 5);
    H.v('   le claim de la 6e est libéré', await db.col('mouvements').countDocuments({ cleIdempotence: 'rb|p5' }), 0);
    const q1 = await Lg.rembourser(p3, crs[6], 'question:x', { scanId: 'p6', compteur: 'question', maintenant: t }, cfg);
    H.v('   après 5 pannes, une question est encore remboursée (compteur indépendant)', q1.rendu, true);
    const p3q = await compte({ solde: { accueil: 0, achete: 40 } }); const cq = [];
    for (let i = 0; i < 31; i++) cq.push(await prendre(p3q, `q${i}`));
    const rq = []; for (let i = 0; i < 31; i++) rq.push(await Lg.rembourser(p3q, cq[i], 'question:x', { scanId: `q${i}`, compteur: 'question', maintenant: t }, cfg));
    H.v('questions : 30 passent, la 31e plafond-jour (dénominateur 31)', [rq.filter(r => r.rendu).length, rq[30].raisonNonRembourse], [30, 'plafond-jour']);
    // 4. plafond PAR PORTEUR, jour UTC
    const p4 = await compte({ solde: { accueil: 0, achete: 3 } }); const c4 = await prendre(p4, 'a4');
    H.v('un autre compte n\'est pas touché par le plafond atteint de p3', (await Lg.rembourser(p4, c4, 'ia-echec', { scanId: 'a4', maintenant: t }, cfg)).rendu, true);
    const i4 = await inst({ essais: 0, achete: 3 }); const ci4 = await prendre(i4, 'i4');
    H.v('une installation non liée a son propre compteur', (await Lg.rembourser(i4, ci4, 'ia-echec', { scanId: 'i4', maintenant: t }, cfg)).rendu, true);
    H.v('   et son solde acheté est revenu', (await lire(i4)).achete, 3);
    const lendemain = new Date('2026-10-09T00:00:01Z');
    const cL = await prendre(p3, 'lendemain', cfg, lendemain);
    H.v('le lendemain (UTC) p3 repart à 0 : une panne est rendue', (await Lg.rembourser(p3, cL, 'ia-echec', { scanId: 'lendemain', maintenant: lendemain }, cfg)).rendu, true);
    // 5. jourDe : une question posée à 23 h 50, abandonnée à 00 h 10, compte au jour où elle a été posée
    const p5 = await compte({ solde: { accueil: 0, achete: 10 } }); const c5 = await prendre(p5, 'j1'), c5b = await prendre(p5, 'j2');
    await db.col('plafonds').insertOne({ porteur: `compte:${p5.id}`, jour: '2026-10-08', type: 'question', count: 30, expireLe: new Date('2026-10-12') });
    const posee = new Date('2026-10-08T23:50:00Z'), abandon = new Date('2026-10-09T00:10:00Z');
    const j1 = await Lg.rembourser(p5, c5, 'question:x', { scanId: 'j1', compteur: 'question', jourDe: posee, maintenant: abandon }, cfg);
    H.v('jourDe = jour de pose (plafond de CE jour atteint) : refusé', j1, { rendu: false, raisonNonRembourse: 'plafond-jour' });
    H.v('   le compteur du jour de pose est resté à 30', (await plaf(p5, '2026-10-08', 'question')).count, 30);
    H.v('   celui du jour d\'abandon n\'a pas été touché (0 ou absent)', (await plaf(p5, '2026-10-09', 'question'))?.count ?? 0, 0);
    H.v('   sans jourDe, le même abandon compte au jour d\'abandon : rendu', (await Lg.rembourser(p5, c5b, 'question:x', { scanId: 'j2', compteur: 'question', maintenant: abandon }, cfg)).rendu, true);
    // 6. hebdo : même semaine ISO rendu ; semaine suivante non rendu et plafond NON consommé
    const p6 = await compte({ solde: { accueil: 0, achete: 0 } }); const c6 = await prendre(p6, 'h1', cfgH);
    H.v('hebdo débité', c6.poche, 'hebdo');
    H.v('hebdo remboursé dans la même semaine ISO : rendu', (await Lg.rembourser(p6, c6, 'ia-echec', { scanId: 'h1', maintenant: new Date('2026-10-11T22:00:00Z') }, cfgH)).rendu, true);
    H.v('   compteur hebdo revenu à 0', (await db.col('hebdo').findOne({ compteId: p6.id, semaine: c6.semaineIso })).count, 0);
    const c6b = await prendre(p6, 'h2', cfgH);
    const nx = new Date('2026-10-12T00:00:01Z');
    H.v('hebdo remboursé la semaine suivante : hebdo-semaine-changee', await Lg.rembourser(p6, c6b, 'ia-echec', { scanId: 'h2', maintenant: nx }, cfgH), { rendu: false, raisonNonRembourse: 'hebdo-semaine-changee' });
    H.v('   et le compteur de plafond n\'est PAS consommé (rollback)', (await plaf(p6, '2026-10-12', 'panne'))?.count ?? 0, 0);
    // 7. accueil au plafond ; abonnement même mois / mois suivant
    const p7 = await compte({ solde: { accueil: 25, achete: 0 } });
    H.v('accueil déjà à 25 : accueil-au-plafond, solde inchangé', [await Lg.rembourser(p7, { poche: 'accueil' }, 'ia-echec', { scanId: 'ac1', maintenant: t }, cfg), (await lire(p7)).solde.accueil],
        [{ rendu: false, raisonNonRembourse: 'accueil-au-plafond' }, 25]);
    const p7a = await compte({ solde: { accueil: 0, achete: 0 }, abonnement: { actif: true, quotaMensuel: 3, moisCle: '2026-10', restant: 3, jusquAu: new Date('2027-01-01') } });
    const c7 = await prendre(p7a, 'ab1');
    H.v('abonnement : même mois, rendu', [(await Lg.rembourser(p7a, c7, 'ia-echec', { scanId: 'ab1', maintenant: t }, cfg)).rendu, (await lire(p7a)).abonnement.restant], [true, 3]);
    const c7b = await prendre(p7a, 'ab2');
    const r7 = await Lg.rembourser(p7a, c7b, 'ia-echec', { scanId: 'ab2', maintenant: new Date('2026-11-02T10:00:00Z') }, cfg);
    H.v('abonnement : mois suivant, non rendu', [r7.rendu, r7.raisonNonRembourse, (await lire(p7a)).abonnement.restant], [false, 'abonnement-mois-change', 2]);
    H.v('   restant 2 < quota 3 : le rendu direct (même mois) est permis', (await Lg.rendrePoche(p7a, { poche: 'abonnement', moisCle: '2026-10' }, cfg, t)).rendu, true);
    await db.col('comptes').updateOne({ _id: p7a.id }, { $set: { 'abonnement.restant': 3 } });
    H.v('   restant = quota : rien à rendre (jamais plus que ce qui a été pris)', (await Lg.rendrePoche(p7a, { poche: 'abonnement', moisCle: '2026-10' }, cfg, t)).rendu, false);
    // 8. credit null (administrateur) : aucun-debit, rien n'est écrit
    const avant = [await db.col('mouvements').countDocuments({}), await db.col('plafonds').countDocuments({})];
    H.v('credit null : aucun-debit', await Lg.rembourser(p7, null, 'ia-echec', { scanId: 'adm1', maintenant: t }, cfg), { rendu: false, raisonNonRembourse: 'aucun-debit' });
    H.v('   aucun mouvement ni compteur touché', [await db.col('mouvements').countDocuments({}), await db.col('plafonds').countDocuments({})], avant);
    // 9. sansPlafond ignore le plafond mais PAS l'unicité par scan
    const p9 = await compte({ solde: { accueil: 0, achete: 10 } }); const c9 = await prendre(p9, 'sp1');
    await db.col('plafonds').insertOne({ porteur: `compte:${p9.id}`, jour: '2026-10-08', type: 'panne', count: 5, expireLe: new Date('2026-10-12') });
    H.v('plafond atteint + sansPlafond : rendu', (await Lg.rembourser(p9, c9, 'ia-echec', { scanId: 'sp1', sansPlafond: true, maintenant: t }, cfg)).rendu, true);
    H.v('   le compteur n\'a pas bougé', (await plaf(p9, '2026-10-08', 'panne')).count, 5);
    H.v('   sansPlafond ne contourne pas l\'unicité par scan', (await Lg.rembourser(p9, c9, 'ia-echec', { scanId: 'sp1', sansPlafond: true, maintenant: t }, cfg)).raisonNonRembourse, 'deja-rembourse');
    // 10. panne de Mongo pendant l'incrément / le rendu : claim supprimé, compteur rendu, 'erreur', et un nouvel essai fonctionne
    const p10 = await compte({ solde: { accueil: 0, achete: 5 } }); const c10 = await prendre(p10, 'e1');
    const colReel = db.col; const casse = nom => { db.col = n => (n === nom ? { findOneAndUpdate: async () => { throw new Error('panne simulée'); }, updateOne: async () => { throw new Error('panne simulée'); }, insertOne: async () => { throw new Error('panne simulée'); } } : colReel(n)); };
    casse('plafonds'); const e1 = await Lg.rembourser(p10, c10, 'ia-echec', { scanId: 'e1', maintenant: t }, cfg); db.col = colReel;
    H.v('panne pendant l\'incrément : erreur', e1, { rendu: false, raisonNonRembourse: 'erreur' });
    H.v('   le claim rb|e1 est supprimé', await db.col('mouvements').countDocuments({ cleIdempotence: 'rb|e1' }), 0);
    H.v('   le crédit reste débité (rien de rendu)', (await lire(p10)).solde.achete, 4);
    H.v('   un nouvel essai aboutit', (await Lg.rembourser(p10, c10, 'ia-echec', { scanId: 'e1', maintenant: t }, cfg)).rendu, true);
    const p10h = await compte({ solde: { accueil: 0, achete: 0 } }); const c10h = await prendre(p10h, 'e2', cfgH);
    casse('hebdo'); const e2 = await Lg.rembourser(p10h, c10h, 'ia-echec', { scanId: 'e2', maintenant: t }, cfgH); db.col = colReel;
    H.v('panne pendant le rendu (hebdo) : erreur, compteur de plafond rendu, claim libéré', [e2.raisonNonRembourse, (await plaf(p10h, '2026-10-08', 'panne')).count, await db.col('mouvements').countDocuments({ cleIdempotence: 'rb|e2' })], ['erreur', 0, 0]);
    // 11. garde : un scan sans identifiant ne peut pas servir de clé (rb|undefined serait commun à tous)
    const c11 = await prendre(p10, 'z1');
    H.v('scanId absent : refusé (erreur), rien d\'écrit', [(await Lg.rembourser(p10, c11, 'ia-echec', { maintenant: t }, cfg)).raisonNonRembourse, await db.col('mouvements').countDocuments({ cleIdempotence: 'rb|undefined' })], ['erreur', 0]);
    await H.fermerBac(); H.bilan();
})().catch(e => { console.error('❌', e); process.exit(1); });
