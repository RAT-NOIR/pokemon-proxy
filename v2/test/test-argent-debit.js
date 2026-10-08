'use strict';
const H = require('./_harnais'); const db = require('../db'); const M = require('../modeles'); const { lireConfig } = require('../config'); const Lg = require('../argent/ledger');
const cfg = lireConfig({ MONGODB_BASE: 'test_scratch' });
let n = 0;
const compte = async (o = {}) => { const c = M.nouveauCompte({ email: `c${++n}@x.fr`, emailCle: `c${n}@x.fr`, motDePasse: {} }); Object.assign(c, { verifie: true }, o); await db.col('comptes').insertOne(c);
    return { type: 'compte', id: c._id, compte: c, installation: null, surface: 'scanner', administrateur: c.role === 'administrateur' }; };
const inst = async (o = {}) => { const i = Object.assign(M.nouvelleInstallation({ jetonEmpreinte: `h${++n}`, essais: 3, libelle: 'x' }), o); await db.col('installations').insertOne(i);
    return { type: 'installation', id: i._id, compte: null, installation: i, surface: 'extension', administrateur: false }; };
const lire = async p => p.type === 'compte' ? db.col('comptes').findOne({ _id: p.id }) : db.col('installations').findOne({ _id: p.id });
(async () => {
    await H.ouvrirBac('test-argent-debit.js'); await M.creerIndex();
    const t = new Date('2026-10-08T10:00:00Z');
    // 1. installation non liée : 3 essais puis QUOTA
    const pi = await inst(); const rs = []; for (let i = 0; i < 4; i++) rs.push(await Lg.debiter(pi, { cleIdempotence: `i${i}`, maintenant: t }, cfg));
    H.v('3 essais débités puis QUOTA', rs.map(r => r.ok ? r.credit.poche : r.code), ['essai', 'essai', 'essai', 'QUOTA']);
    H.v('essais à 0, jamais négatif', (await lire(pi)).essais, 0);
    // 2. ORDRE des poches d'un compte : accueil → hebdo → abonnement → achete
    const pc = await compte({ solde: { accueil: 2, achete: 1 }, abonnement: { actif: true, quotaMensuel: 1, moisCle: '2026-10', restant: 1, jusquAu: new Date('2026-12-01') } });
    const c2 = lireConfig({ MONGODB_BASE: 'test_scratch', V2_HEBDO: '1' }); const ordre = [];
    for (let i = 0; i < 6; i++) { const r = await Lg.debiter(pc, { cleIdempotence: `o${i}`, maintenant: t }, c2); ordre.push(r.ok ? r.credit.poche : r.code); }
    H.v('ordre accueil, accueil, hebdo, abonnement, achete, QUOTA', ordre, ['accueil', 'accueil', 'hebdo', 'abonnement', 'achete', 'QUOTA']);
    // 3. compte NON vérifié : jamais d'accueil ni d'hebdo ; l'erreur est VERIFICATION, pas QUOTA
    const pn = await compte({ verifie: false });
    H.v('non vérifié => VERIFICATION', (await Lg.debiter(pn, { cleIdempotence: 'nv', maintenant: t }, cfg)).code, 'VERIFICATION');
    const pn2 = await compte({ verifie: false, solde: { accueil: 25, achete: 0 } });   // un solde d'accueil en base ne suffit PAS : la garde s'écrit par ce qu'elle autorise
    H.v('non vérifié avec 25 d\'accueil en base => refusé, solde intact', [(await Lg.debiter(pn2, { cleIdempotence: 'nv2', maintenant: t }, cfg)).code, (await lire(pn2)).solde.accueil], ['VERIFICATION', 25]);
    // 4. CONCURRENCE : 30 débits simultanés sur 25 crédits d'accueil
    const pk = await compte({ solde: { accueil: 25, achete: 0 } }); const c0 = lireConfig({ MONGODB_BASE: 'test_scratch', V2_HEBDO: '0' });
    const res = await Promise.all(Array.from({ length: 30 }, (_, i) => Lg.debiter(pk, { cleIdempotence: `k${i}`, maintenant: t }, c0)));
    H.v('30 requêtes, 25 crédits : succès', res.filter(r => r.ok).length, 25);
    H.v('   refus QUOTA', res.filter(r => !r.ok && r.code === 'QUOTA').length, 5);
    H.v('   solde final 0, jamais négatif', (await lire(pk)).solde.accueil, 0);
    H.v('   25 mouvements écrits', await db.col('mouvements').countDocuments({ compteId: pk.id, type: 'debit' }), 25);
    H.v('   conservation : somme(delta) = -25 = solde final - solde initial', (await db.col('mouvements').aggregate([{ $match: { compteId: pk.id } }, { $group: { _id: null, s: { $sum: '$delta' } } }]).toArray())[0].s, -25);
    // 5. hebdo : 10 simultanés, plafond 2, compteur remis à 2 (rollback)
    const ph = await compte({ solde: { accueil: 0, achete: 0 } });
    const rh = await Promise.all(Array.from({ length: 10 }, (_, i) => Lg.debiter(ph, { cleIdempotence: `h${i}`, maintenant: t }, cfg)));
    H.v('hebdo : 10 requêtes, 2 permises', rh.filter(r => r.ok).length, 2);
    H.v('   compteur hebdo = 2 après rollback', (await db.col('hebdo').findOne({ compteId: ph.id })).count, 2);
    // 6. hebdo : semaine suivante = compteur neuf (non cumulable)
    const rn = await Lg.debiter(ph, { cleIdempotence: 'h-suiv', maintenant: new Date('2026-10-13T10:00:00Z') }, cfg);
    H.v('semaine suivante : de nouveau permis', rn.ok && rn.credit.poche === 'hebdo', true);
    // 7. abonnement : renouvellement mensuel, expiré, inactif
    const pa = await compte({ solde: { accueil: 0, achete: 0 }, abonnement: { actif: true, quotaMensuel: 3, moisCle: '2026-09', restant: 0, jusquAu: new Date('2027-01-01') } });
    const c3 = lireConfig({ MONGODB_BASE: 'test_scratch', V2_HEBDO: '0' });
    const ra = await Lg.debiter(pa, { cleIdempotence: 'a1', maintenant: t }, c3);
    H.v('1er débit du mois : le quota est rechargé puis débité', [ra.ok, (await lire(pa)).abonnement.restant, (await lire(pa)).abonnement.moisCle], [true, 2, '2026-10']);
    const ra2 = await Lg.debiter(pa, { cleIdempotence: 'a2', maintenant: t }, c3);
    H.v('2e débit du même mois : PAS de second rechargement', (await lire(pa)).abonnement.restant, 1);
    const pe = await compte({ solde: { accueil: 0, achete: 0 }, abonnement: { actif: true, quotaMensuel: 3, moisCle: '2026-10', restant: 3, jusquAu: new Date('2026-10-01') } });
    H.v('abonnement échu : refusé', (await Lg.debiter(pe, { cleIdempotence: 'e1', maintenant: t }, c3)).code, 'QUOTA');
    const pz = await compte({ solde: { accueil: 0, achete: 0 }, abonnement: { actif: false, quotaMensuel: 3, moisCle: '2026-10', restant: 3, jusquAu: new Date('2027-01-01') } });
    H.v('abonnement inactif : refusé', (await Lg.debiter(pz, { cleIdempotence: 'z1', maintenant: t }, c3)).code, 'QUOTA');
    // 7 bis. rechargement concurrent : 10 débits simultanés au 1er du mois, quota 3 => 3 succès exactement (jamais de double rechargement)
    const pr = await compte({ solde: { accueil: 0, achete: 0 }, abonnement: { actif: true, quotaMensuel: 3, moisCle: '2026-09', restant: 0, jusquAu: new Date('2027-01-01') } });
    const rr = await Promise.all(Array.from({ length: 10 }, (_, i) => Lg.debiter(pr, { cleIdempotence: `r${i}`, maintenant: t }, c3)));
    H.v('abonnement : 10 débits simultanés au changement de mois, quota 3 : succès', rr.filter(r => r.ok).length, 3);
    H.v('   restant final 0', (await lire(pr)).abonnement.restant, 0);
    // 8. IDEMPOTENCE : même clé = même résultat, un seul décrément (séquentiel puis 10 simultanés)
    const pd = await compte({ solde: { accueil: 5, achete: 0 } });
    const d1 = await Lg.debiter(pd, { cleIdempotence: 'meme', maintenant: t }, c0), d2 = await Lg.debiter(pd, { cleIdempotence: 'meme', maintenant: t }, c0);
    H.v('rejeu : rejoue=true et un seul décrément', [d1.rejoue ?? false, d2.rejoue, (await lire(pd)).solde.accueil], [false, true, 4]);
    await Promise.all(Array.from({ length: 10 }, () => Lg.debiter(pd, { cleIdempotence: 'meme2', maintenant: t }, c0)));
    H.v('10 requêtes de même clé : UN décrément de plus', (await lire(pd)).solde.accueil, 3);
    H.v('   et un seul mouvement pour cette clé', await db.col('mouvements').countDocuments({ cleIdempotence: 'meme2' }), 1);
    // 9. administrateur : rien n'est décrémenté, le mouvement dit delta 0
    const pad = await compte({ solde: { accueil: 5, achete: 5 }, role: 'administrateur' });
    const ad = await Lg.debiter(pad, { cleIdempotence: 'adm', maintenant: t }, c0);
    H.v('administrateur : ok, soldes intacts', [ad.ok, ad.administrateur, (await lire(pad)).solde], [true, true, { accueil: 5, achete: 5 }]);
    const mv = await db.col('mouvements').findOne({ cleIdempotence: 'adm' });
    H.v('   mouvement delta 0, motif administrateur', [mv.delta, mv.motif], [0, 'administrateur']);
    // 10. un ordre configuré consomme dans CET ordre
    const po = await compte({ solde: { accueil: 1, achete: 1 } });
    H.v('V2_ORDRE_POCHES=achete,accueil', (await Lg.debiter(po, { cleIdempotence: 'or', maintenant: t }, lireConfig({ MONGODB_BASE: 'test_scratch', V2_ORDRE_POCHES: 'achete,accueil' }))).credit.poche, 'achete');
    // 11. garde : un porteur de type inconnu ne débite rien (refus, pas d'invention)
    H.v('porteur de type inconnu : QUOTA, aucun mouvement', [(await Lg.debiter({ type: 'x', id: 'z', compte: null, installation: null, surface: 'scanner', administrateur: false }, { cleIdempotence: 'inconnu', maintenant: t }, cfg)).code,
        await db.col('mouvements').countDocuments({ cleIdempotence: 'inconnu' })], ['QUOTA', 0]);
    // 12. une clé d'idempotence appartient à UN porteur : la rejouer sous un autre porteur ne rend pas son crédit et ne passe pas pour un succès
    const pa1 = await compte({ solde: { accueil: 3, achete: 0 } }), pa2 = await compte({ solde: { accueil: 3, achete: 0 } });
    await Lg.debiter(pa1, { cleIdempotence: 'cle-partagee', maintenant: t }, c0);
    let leve = null; try { await Lg.debiter(pa2, { cleIdempotence: 'cle-partagee', maintenant: t }, c0); } catch (e) { leve = e.message; }
    H.v('clé d\'un autre porteur : refusée (lève), aucun débit pour le second', [typeof leve, (await lire(pa2)).solde.accueil], ['string', 3]);
    // 13. une installation DÉJÀ LIÉE à un compte ne débite plus ses poches propres (le porteur est le compte)
    const pl = await inst({ essais: 3, achete: 2, compteId: pa1.id });
    H.v('installation liée : ni essai ni acheté, QUOTA', [(await Lg.debiter(pl, { cleIdempotence: 'liee', maintenant: t }, cfg)).code, (await lire(pl)).essais, (await lire(pl)).achete], ['QUOTA', 3, 2]);
    // 14. I2 — rejeu d'une clé APRÈS remboursement : une NOUVELLE tentative, débitée à nouveau (sinon une panne retentée serait une analyse gratuite)
    {
    const pr = await compte({ solde: { accueil: 0, achete: 5 } });
    const x1 = await Lg.debiter(pr, { scanId: 'rj', cleIdempotence: 'cle-rj', maintenant: t }, c0);
    await Lg.rembourser(pr, x1.credit, 'ia-echec', { scanId: 'rj', maintenant: t }, c0);
    H.v('débit, remboursement : solde revenu à 5', (await lire(pr)).solde.achete, 5);
    const x2 = await Lg.debiter(pr, { scanId: 'rj', cleIdempotence: 'cle-rj', maintenant: t }, c0);
    H.v('même clé après remboursement : NOUVEAU débit (ok, reessaye, pas rejoue), solde 4', [x2.ok, x2.reessaye, x2.rejoue ?? false, x2.credit && x2.credit.poche, (await lire(pr)).solde.achete], [true, true, false, 'achete', 4]);
    const x3 = await Lg.debiter(pr, { scanId: 'rj', cleIdempotence: 'cle-rj', maintenant: t }, c0);
    H.v('   la même clé encore (tentative non remboursée) : rejoue, AUCUN débit de plus', [x3.rejoue, (await lire(pr)).solde.achete], [true, 4]);
    await Lg.rembourser(pr, x2.credit, 'ia-echec', { scanId: 'rj', maintenant: t }, c0);
    const x4 = await Lg.debiter(pr, { scanId: 'rj', cleIdempotence: 'cle-rj', maintenant: t }, c0);
    H.v('   remboursée une 2e fois puis rejouée : encore une nouvelle tentative (chaîne), solde 4', [x4.reessaye, (await lire(pr)).solde.achete], [true, 4]);
    await Lg.rembourser(pr, x4.credit, 'ia-echec', { scanId: 'rj', maintenant: new Date(t.getTime() + 86400e3) }, c0);
    const rs2 = await Promise.all(Array.from({ length: 10 }, () => Lg.debiter(pr, { scanId: 'rj', cleIdempotence: 'cle-rj', maintenant: t }, c0)));
    H.v('   10 rejeux simultanés après remboursement : UN seul nouveau débit (solde 4), dénominateur 10', [rs2.filter(r => r.ok).length, (await lire(pr)).solde.achete, await db.col('mouvements').countDocuments({ compteId: pr.id, type: 'debit', etat: 'debite' })], [10, 4, 1]);
    }
    // 15. M3 — l'administrateur se relit en BASE : un objet porteur forgé ne suffit pas
    const pf = await compte({ solde: { accueil: 2, achete: 0 } }); pf.administrateur = true;
    const fg = await Lg.debiter(pf, { scanId: 'forge', cleIdempotence: 'forge', maintenant: t }, c0);
    H.v('porteur.administrateur forgé sur un compte sans rôle : débité normalement', [fg.administrateur ?? false, fg.credit && fg.credit.poche, (await lire(pf)).solde.accueil], [false, 'accueil', 1]);
    await H.fermerBac(); H.bilan();
})().catch(e => { console.error('❌', e); process.exit(1); });
