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
const cleM = p => (p.type === 'compte' ? { compteId: p.id } : { installationId: p.id });
const mouv = (p, scanId) => db.col('mouvements').findOne({ ...cleM(p), type: 'debit', scanId });
const nDebits = (p, scanId) => db.col('mouvements').countDocuments({ ...cleM(p), type: 'debit', scanId, delta: -1 });
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
    H.v('   un débit, un remboursement ; compteur probable-aucune = 1, ni declare ni constate', [await nDebits(p1, b.scanId), await nRendus(b.scanId), (await db.col('plafonds').findOne({ porteur: `compte:${p1.id}`, type: 'probable-aucune' })).count, await db.col('plafonds').countDocuments({ porteur: `compte:${p1.id}`, type: { $in: ['declare', 'constate'] } })], [1, 1, 1, 0]);
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
    // 6. (décision de l'éditeur, 31/10) « aucune » sur un probable a son PROPRE compteur `probable-aucune` (1 sans compte, 3 gratuit, 30 Pro, cfg.plafonds.probables), séparé des constats et des déclarations
    const {  inst: instP } = require('./_aide-argent');
    const cleP = p => (p.type === 'compte' ? { compteId: p.id } : { installationId: p.id });
    const grand = async p => { await Q2.poserRestant(`${p.type}:${p.id}`, 500, { jour: '2026-10-08' }); return p; };
    const PRO = { abonnement: { actif: true, quotaMensuel: 100, moisCle: '2026-10', restant: 100, jusquAu: new Date('2027-01-01') } };
    const OFFRES = [['sans compte', async () => grand(await instP()), cfg.plafonds.probables.sansCompte, 1], ['gratuit', async () => grand(await compte()), cfg.plafonds.probables.gratuit, 3], ['Pro', async () => grand(await compte(PRO)), cfg.plafonds.probables.pro, 30]];
    for (const [nom, fab, attendu, vise] of OFFRES) {
        const p6 = await fab(); const out = [], sc6 = [];
        for (let i = 0; i < attendu + 2; i++) { const s = await poser(p6); sc6.push(s.scanId); out.push(await rep(p6, s.scanId, 'aucune')); }
        const rendus6 = out.filter(o => o.etat === 'remboursee').length;
        H.v(`« aucune » en rafale, offre ${nom} : le plafond est ${vise} (configuré ${attendu}), EXACTEMENT ${vise} rendus puis tout est refusé`, [attendu, rendus6, out.slice(rendus6).every(o => o.etat === 'non-remboursee' && o.question.raisonNonRembourse === 'plafond-jour')], [vise, vise, true]);
        const refus = out[rendus6];
        H.v('   un refus laisse le débit (debite 1, rien rendu), jamais deux débits, ET le MESSAGE est dans la réponse (declaration { rendue:false, raison:plafond-probable, plafondJour })', [refus.facturation.debite, refus.facturation.rembourse, await nRendus(sc6[rendus6]), await db.col('mouvements').countDocuments({ ...cleP(p6), type: 'debit', scanId: sc6[rendus6], delta: -1 }), refus.declaration], [1, false, 0, 1, { rendue: false, raison: 'plafond-probable', plafondJour: vise }]);
        H.v('   un remboursement accordé dit aussi son plafond (declaration rendue true)', out[0].declaration, { rendue: true, raison: null, plafondJour: vise });
        const rejeu = await rep(p6, sc6[rendus6], 'aucune', h(2));
        H.v('   le rejeu du refus redit le MÊME message', rejeu.declaration, refus.declaration);
        const pl = await db.col('plafonds').find({ porteur: `${p6.type}:${p6.id}` }).toArray();
        H.v('   le compteur utilisé est `probable-aucune` (attendu + 1 jetons moins le rollback = attendu) et ni `constate` ni `declare` ni `panne` ne bougent', [pl.filter(x => x.type === 'probable-aucune').map(x => x.count), pl.filter(x => ['constate', 'declare', 'panne'].includes(x.type)).length], [[attendu], 0]);
    }
    // le compteur n'est PAS partagé avec les introuvables ni les pannes : un porteur sans compte dont le compteur des constats est plein est quand même remboursé par « aucune » d'un probable
    const pn = await grand(await compte()); const nb = cfg.plafonds.constates.gratuit;
    for (let i = 0; i < nb; i++) { const sx = `intr${++nScan}`; const dx = await Lg.debiter(pn, { scanId: sx, cleIdempotence: `d|${sx}`, maintenant: t }, cfg); await Lg.rembourser(pn, dx.credit, 'introuvable', { scanId: sx, compteur: 'introuvable', maintenant: t }, cfg); }
    const sxx = `intr${++nScan}`, dxx = await Lg.debiter(pn, { scanId: sxx, cleIdempotence: `d|${sxx}`, maintenant: t }, cfg); const plein = await Lg.rembourser(pn, dxx.credit, 'introuvable', { scanId: sxx, compteur: 'introuvable', maintenant: t }, cfg);
    const sp1 = await poser(pn), ra = await rep(pn, sp1.scanId, 'aucune');
    H.v('compteur NON partagé : les constats sont PLEINS (le suivant est refusé), et « aucune » sur un probable est pourtant remboursée', [plein.rendu, ra.etat], [false, 'remboursee']);
    const pq = await grand(await compte());
    for (let i = 0; i < cfg.plafonds.probables.gratuit; i++) { const s = await poser(pq); await rep(pq, s.scanId, 'aucune'); }
    const sy = `intr${++nScan}`, dy = await Lg.debiter(pq, { scanId: sy, cleIdempotence: `d|${sy}`, maintenant: t }, cfg); const ry = await Lg.rembourser(pq, dy.credit, 'introuvable', { scanId: sy, compteur: 'introuvable', maintenant: t }, cfg);
    H.v('   et l\'inverse : le compteur des probables PLEIN ne bloque pas le remboursement d\'un introuvable', ry.rendu, true);
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
    // 9. I1 : le passage n'est PAS atomique si un write lève — après la panne, le grand livre et la question disent la même chose (une question ordinaire, crédit réservé)
    const realCol = db.col; let casse = null, quand = null;
    db.col = nom => { const c = realCol(nom); if (nom !== casse) return c; return new Proxy(c, { get: (t, k) => (k === 'updateOne' ? async (...a) => { if (!quand || quand(a[0])) throw Object.assign(new Error('panne'), { code: 'BANC' }); return t.updateOne(...a); } : (typeof t[k] === 'function' ? t[k].bind(t) : t[k])) }); };
    const p9 = await compteN(20);
    for (const [nom, q] of [['mouvements', null], ['questions_v2', null]]) {
        quand = q;
        const s = await poser(p9, { sansProbable: true });
        casse = nom;
        const r = await Q.passerEnProbable(p9, { scanId: s.scanId, carte: 0 }, cfg);
        casse = null;
        const ql = await db.col('questions_v2').findOne({ _id: `${s.scanId}:0` }), mv = await mouv(p9, s.scanId);
        H.v(`I1 : le write sur « ${nom} » lève : ok false, la question n'est PAS probable, le mouvement reste reserve, la facturation dit reserve`, [r.ok, ql.probable === true, mv.etat, Q.facturationDe(ql).reserve], [false, false, 'reserve', 1]);
        const nsp = await rep(p9, s.scanId, 'ne-sait-pas');
        H.v('   « ne-sait-pas » rembourse comme une question ordinaire (le client n\'a jamais vu de probable)', [nsp.etat, await nRendus(s.scanId)], ['remboursee', 1]);
    }
    // le second write (le marqueur) lève APRÈS que le mouvement est passé debite : le mouvement est remis à reserve
    const t9 = await poser(p9, { sansProbable: true }); casse = 'questions_v2'; quand = () => false;      // (aucune écriture ne lève : témoin que le proxy ne casse rien)
    const rt = await Q.passerEnProbable(p9, { scanId: t9.scanId, carte: 0 }, cfg); casse = null; quand = null;
    H.v('témoin : un proxy qui ne lève pas laisse le passage réussir', [rt.ok, (await mouv(p9, t9.scanId)).etat], [true, 'debite']);
    const u9 = await poser(p9, { sansProbable: true }); casse = 'questions_v2'; quand = f => f && typeof f === 'object' && f.etat === 'en-attente' && f.probable && f.probable.$ne === true;     // seule l'écriture du marqueur lève
    const ru = await Q.passerEnProbable(p9, { scanId: u9.scanId, carte: 0 }, cfg); casse = null; quand = null;
    const qu = await db.col('questions_v2').findOne({ _id: `${u9.scanId}:0` });
    H.v('I1 : le marqueur ne s\'écrit pas APRÈS le mouvement : ok false, le mouvement est REMIS à reserve (compensation), question ordinaire', [ru.ok, qu.probable === true, (await mouv(p9, u9.scanId)).etat], [false, false, 'reserve']);
    db.col = realCol;
    await H.fermerBac(); H.bilan();
})().catch(e => { console.error('❌', e); process.exit(1); });
