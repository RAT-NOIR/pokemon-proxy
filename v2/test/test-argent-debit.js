'use strict';
// Le DÉBIT du grand livre. Réécrit pour OFFRE-QUOTA (2026-10-13, décision du testeur) : le quota quotidien remplace les poches (essai, accueil, hebdo, abonnement, achete). Les parties du banc qui n'avaient de
// sens que pour ces poches (l'ordre de consommation, le rechargement mensuel de l'abonnement, l'hebdomadaire, l'ordre configurable) sont retirées ; leur place est tenue par test-offre-quota.js (offres, jour de Paris,
// plafond Pro, anciennes poches intactes). Ce qui reste est ce qui valait pour tout compteur : la conservation, la concurrence, l'idempotence, le rejeu après remboursement, l'administrateur relu en base.
const H = require('./_harnais'); const db = require('../db'); const M = require('../modeles'); const { lireConfig } = require('../config'); const Lg = require('../argent/ledger');
const Of = require('../argent/offre');
const cfg = lireConfig({ MONGODB_BASE: 'test_scratch' });
let n = 0;
const compte = async (o = {}) => { const c = M.nouveauCompte({ email: `c${++n}@x.fr`, emailCle: `c${n}@x.fr`, motDePasse: {} }); Object.assign(c, { verifie: true }, o); await db.col('comptes').insertOne(c);
    return { type: 'compte', id: c._id, compte: c, installation: null, surface: 'scanner', administrateur: c.role === 'administrateur' }; };
const inst = async (o = {}) => { const i = Object.assign(M.nouvelleInstallation({ jetonEmpreinte: `h${++n}`, essais: 3, libelle: 'x' }), o); await db.col('installations').insertOne(i);
    return { type: 'installation', id: i._id, compte: null, installation: i, surface: 'extension', administrateur: false }; };
const lire = async p => p.type === 'compte' ? db.col('comptes').findOne({ _id: p.id }) : db.col('installations').findOne({ _id: p.id });
const cnt = async (p, jour) => { const d = await db.col('quota_jour').findOne({ porteur: `${p.type}:${p.id}`, jour }); return d ? d.count : null; };
(async () => {
    await H.ouvrirBac('test-argent-debit.js'); await M.creerIndex();
    const t = new Date('2026-10-08T10:00:00Z'), JOUR = '2026-10-08';
    // 1. installation non liée : 3 analyses par jour puis QUOTA
    const pi = await inst(); const rs = []; for (let i = 0; i < 4; i++) rs.push(await Lg.debiter(pi, { cleIdempotence: `i${i}`, maintenant: t }, cfg));
    H.v('3 analyses (poche « jour ») puis QUOTA', rs.map(r => r.ok ? r.credit.poche : r.code), ['jour', 'jour', 'jour', 'QUOTA']);
    H.v('compteur du jour à 3, jamais 4 ; les essais en base (3) ne bougent plus', [await cnt(pi, JOUR), (await lire(pi)).essais], [3, 3]);
    // 2. un compte vérifié : 10 par jour, quels que soient ses anciens soldes (jamais débités)
    const pc = await compte({ solde: { accueil: 2, achete: 0 }, abonnement: { actif: true, quotaMensuel: 1, moisCle: '2026-10', restant: 1, jusquAu: new Date('2026-09-01') } });   // abonnement ÉCHU : gratuit
    const ordre = []; for (let i = 0; i < 12; i++) { const r = await Lg.debiter(pc, { cleIdempotence: `o${i}`, maintenant: t }, cfg); ordre.push(r.ok ? r.credit.poche : r.code); }
    H.v('compte gratuit : 10 fois « jour » puis QUOTA, QUOTA (accueil 2 jamais touché ; achete 0 : la poche achete a son banc, test-achete-avant-jour.js)', ordre, [...Array(10).fill('jour'), 'QUOTA', 'QUOTA']);
    H.v('   anciens soldes intacts', (await lire(pc)).solde, { accueil: 2, achete: 0 });
    // 3. compte NON vérifié : jamais de quota ; l'erreur est VERIFICATION, pas QUOTA
    const pn = await compte({ verifie: false });
    H.v('non vérifié => VERIFICATION', (await Lg.debiter(pn, { cleIdempotence: 'nv', maintenant: t }, cfg)).code, 'VERIFICATION');
    const pn2 = await compte({ verifie: false, solde: { accueil: 25, achete: 0 } });   // un solde d'accueil en base ne suffit PAS : la garde s'écrit par ce qu'elle autorise
    H.v('non vérifié avec 25 d\'accueil en base => refusé, solde intact, aucun compteur', [(await Lg.debiter(pn2, { cleIdempotence: 'nv2', maintenant: t }, cfg)).code, (await lire(pn2)).solde.accueil, await cnt(pn2, JOUR)], ['VERIFICATION', 25, null]);
    // 4. CONCURRENCE : 30 débits simultanés sur un quota de 25 (Pro, plafond technique 25)
    const c25 = lireConfig({ MONGODB_BASE: 'test_scratch', V2_QUOTA_PRO_PLAFOND: '25' });
    const pk = await compte({ abonnement: { actif: true, quotaMensuel: 100, moisCle: '2026-10', restant: 100, jusquAu: new Date('2027-01-01') } });
    const res = await Promise.all(Array.from({ length: 30 }, (_, i) => Lg.debiter(pk, { cleIdempotence: `k${i}`, maintenant: t }, c25)));
    H.v('30 requêtes, 25 unités : succès', res.filter(r => r.ok).length, 25);
    H.v('   refus QUOTA', res.filter(r => !r.ok && r.code === 'QUOTA').length, 5);
    H.v('   compteur 25, jamais au-dessus', await cnt(pk, JOUR), 25);
    H.v('   25 mouvements écrits', await db.col('mouvements').countDocuments({ compteId: pk.id, type: 'debit' }), 25);
    H.v('   conservation : somme(delta) = -25 = -(compteur)', (await db.col('mouvements').aggregate([{ $match: { compteId: pk.id } }, { $group: { _id: null, s: { $sum: '$delta' } } }]).toArray())[0].s, -25);
    // 5. un quota de 2 par jour : 10 simultanés, 2 passent, le compteur est remis à 2 (jeton du refus rendu)
    const c2 = lireConfig({ MONGODB_BASE: 'test_scratch', V2_QUOTA_GRATUIT: '2' });
    const ph = await compte();
    const rh = await Promise.all(Array.from({ length: 10 }, (_, i) => Lg.debiter(ph, { cleIdempotence: `h${i}`, maintenant: t }, c2)));
    H.v('quota 2 : 10 requêtes, 2 permises', rh.filter(r => r.ok).length, 2);
    H.v('   compteur = 2 après rollback des 8 refus', await cnt(ph, JOUR), 2);
    // 6. le jour de Paris suivant = compteur neuf (non cumulable, non reportable)
    const rn = await Lg.debiter(ph, { cleIdempotence: 'h-suiv', maintenant: new Date('2026-10-09T10:00:00Z') }, c2);
    H.v('jour suivant : de nouveau permis, compteur du jour précédent intact', [rn.ok && rn.credit.poche === 'jour', rn.credit && rn.credit.jour, await cnt(ph, JOUR), await cnt(ph, '2026-10-09')], [true, '2026-10-09', 2, 1]);
    // 8. IDEMPOTENCE : même clé = même résultat, un seul décrément (séquentiel puis 10 simultanés)
    const pd = await compte({ solde: { accueil: 5, achete: 0 } });
    const d1 = await Lg.debiter(pd, { cleIdempotence: 'meme', maintenant: t }, cfg), d2 = await Lg.debiter(pd, { cleIdempotence: 'meme', maintenant: t }, cfg);
    H.v('rejeu : rejoue=true et un seul décrément', [d1.rejoue ?? false, d2.rejoue, await cnt(pd, JOUR)], [false, true, 1]);
    await Promise.all(Array.from({ length: 10 }, () => Lg.debiter(pd, { cleIdempotence: 'meme2', maintenant: t }, cfg)));
    H.v('10 requêtes de même clé : UN décrément de plus', await cnt(pd, JOUR), 2);
    H.v('   et un seul mouvement pour cette clé', await db.col('mouvements').countDocuments({ cleIdempotence: 'meme2' }), 1);
    // 9. administrateur : rien n'est décrémenté, le mouvement dit delta 0
    const pad = await compte({ solde: { accueil: 5, achete: 5 }, role: 'administrateur' });
    const ad = await Lg.debiter(pad, { cleIdempotence: 'adm', maintenant: t }, cfg);
    H.v('administrateur : ok, soldes intacts, aucun compteur', [ad.ok, ad.administrateur, (await lire(pad)).solde, await cnt(pad, JOUR)], [true, true, { accueil: 5, achete: 5 }, null]);
    const mv = await db.col('mouvements').findOne({ cleIdempotence: 'adm' });
    H.v('   mouvement delta 0, motif administrateur', [mv.delta, mv.motif], [0, 'administrateur']);
    // 11. garde : un porteur de type inconnu ne débite rien (refus, pas d'invention)
    H.v('porteur de type inconnu : QUOTA, aucun mouvement', [(await Lg.debiter({ type: 'x', id: 'z', compte: null, installation: null, surface: 'scanner', administrateur: false }, { cleIdempotence: 'inconnu', maintenant: t }, cfg)).code,
        await db.col('mouvements').countDocuments({ cleIdempotence: 'inconnu' })], ['QUOTA', 0]);
    // 12. une clé d'idempotence appartient à UN porteur : la rejouer sous un autre porteur ne rend pas son crédit et ne passe pas pour un succès
    const pa1 = await compte(), pa2 = await compte();
    await Lg.debiter(pa1, { cleIdempotence: 'cle-partagee', maintenant: t }, cfg);
    let leve = null; try { await Lg.debiter(pa2, { cleIdempotence: 'cle-partagee', maintenant: t }, cfg); } catch (e) { leve = e.message; }
    H.v('clé d\'un autre porteur : refusée (lève), aucun débit pour le second', [typeof leve, await cnt(pa2, JOUR)], ['string', null]);
    // 13. une installation DÉJÀ LIÉE à un compte ne débite plus rien en son nom (le porteur est le compte)
    const pl = await inst({ essais: 3, achete: 2, compteId: pa1.id });
    H.v('installation liée : QUOTA, rien n\'est pris, essais/achete intacts', [(await Lg.debiter(pl, { cleIdempotence: 'liee', maintenant: t }, cfg)).code, await cnt(pl, JOUR), (await lire(pl)).essais, (await lire(pl)).achete], ['QUOTA', null, 3, 2]);
    // 14. I2 — rejeu d'une clé APRÈS remboursement : une NOUVELLE tentative, débitée à nouveau (sinon une panne retentée serait une analyse gratuite)
    {
    const pr = await compte();
    const x1 = await Lg.debiter(pr, { scanId: 'rj', cleIdempotence: 'cle-rj', maintenant: t }, cfg);
    await Lg.rembourser(pr, x1.credit, 'ia-echec', { scanId: 'rj', maintenant: t }, cfg);
    H.v('débit, remboursement : compteur revenu à 0', await cnt(pr, JOUR), 0);
    const x2 = await Lg.debiter(pr, { scanId: 'rj', cleIdempotence: 'cle-rj', maintenant: t }, cfg);
    H.v('même clé après remboursement : NOUVEAU débit (ok, reessaye, pas rejoue), compteur 1', [x2.ok, x2.reessaye, x2.rejoue ?? false, x2.credit && x2.credit.poche, await cnt(pr, JOUR)], [true, true, false, 'jour', 1]);
    const x3 = await Lg.debiter(pr, { scanId: 'rj', cleIdempotence: 'cle-rj', maintenant: t }, cfg);
    H.v('   la même clé encore (tentative non remboursée) : rejoue, AUCUN débit de plus', [x3.rejoue, await cnt(pr, JOUR)], [true, 1]);
    await Lg.rembourser(pr, x2.credit, 'ia-echec', { scanId: 'rj', maintenant: t }, cfg);
    const x4 = await Lg.debiter(pr, { scanId: 'rj', cleIdempotence: 'cle-rj', maintenant: t }, cfg);
    H.v('   remboursée une 2e fois puis rejouée : encore une nouvelle tentative (chaîne), compteur 1', [x4.reessaye, await cnt(pr, JOUR)], [true, 1]);
    await Lg.rembourser(pr, x4.credit, 'ia-echec', { scanId: 'rj', maintenant: new Date(t.getTime() + 86400e3) }, cfg);
    H.v('   remboursée le LENDEMAIN : l\'unité retourne au compteur du jour du débit (0), pas à celui du jour courant', [await cnt(pr, JOUR), await cnt(pr, '2026-10-09')], [0, null]);
    const rs2 = await Promise.all(Array.from({ length: 10 }, () => Lg.debiter(pr, { scanId: 'rj', cleIdempotence: 'cle-rj', maintenant: t }, cfg)));
    H.v('   10 rejeux simultanés après remboursement : UN seul nouveau débit (compteur 1), dénominateur 10', [rs2.filter(r => r.ok).length, await cnt(pr, JOUR), await db.col('mouvements').countDocuments({ compteId: pr.id, type: 'debit', etat: 'debite' })], [10, 1, 1]);
    }
    // 15. M3 — l'administrateur se relit en BASE : un objet porteur forgé ne suffit pas
    const pf = await compte({ solde: { accueil: 2, achete: 0 } }); pf.administrateur = true;
    const fg = await Lg.debiter(pf, { scanId: 'forge', cleIdempotence: 'forge', maintenant: t }, cfg);
    H.v('porteur.administrateur forgé sur un compte sans rôle : débité normalement (quota du jour)', [fg.administrateur ?? false, fg.credit && fg.credit.poche, await cnt(pf, JOUR), (await lire(pf)).solde.accueil], [false, 'jour', 1, 2]);
    H.v('l\'offre relue est celle d\'un compte gratuit', (await Of.offre(pf, cfg, t)).nom, 'gratuit');
    await H.fermerBac(); H.bilan();
})().catch(e => { console.error('❌', e); process.exit(1); });
