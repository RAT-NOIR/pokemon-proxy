'use strict';
// STRIPE-V2 — le parrainage de bout en bout sur le faux Stripe à horloges d'essai. « 1 mois offert » vaut UN MOIS, quelle que soit la période du parrain : la prime est un AVOIR au solde du client
// Stripe (le prix MENSUEL Pro lu chez Stripe : 499 centimes), déduit de sa prochaine facture — mensuelle (499 → 0) ou annuelle (3 900 → 3 401), jamais plus. Le filleul a 30 jours d'essai ; la prime
// naît à sa PREMIÈRE facture PAYÉE (montant > 0). Un seul crédit par filleul, jamais de parrainage de soi-même, ni réciproque, ni d'un Fondateurs ; la prime attend un abonnement vivant et non résilié ;
// une panne au milieu se reprend ; jamais deux avoirs pour le même filleul (même après l'oubli de la clé d'idempotence de Stripe).
const H = require('./_harnais'); const db = require('../db'); const M = require('../modeles');
const A = require('./_aide-abonnements'); const { creerFauxStripe, JOUR } = require('./_faux-stripe');
const Cl = require('../abonnements/client');
const logs = []; const errOrig = console.error; console.error = (...a) => { logs.push(a.join(' ')); };

(async () => {
    await H.ouvrirBac('test-abonnements-parrainage.js'); await M.creerIndex();
    const faux = creerFauxStripe(); Cl.brancher(faux); A.semerPrix(faux);
    const srv = await A.serveur(A.cfgAbo());
    const file = []; faux.surEvenement = e => file.push(e);
    const vider = async () => { let n = 0; while (file.length) { const e = file.shift(); const r = await A.livrer(srv.url, e); if (r.statut !== 200) throw new Error(`livraison ${e.type} : ${r.statut} ${JSON.stringify(r.json)}`); n++; } return n; };
    const horloge = await faux.testHelpers.testClocks.create({ frozen_time: Math.floor(Date.now() / 1000) });
    const avancer = async jours => { const c = await faux.testHelpers.testClocks.retrieve(horloge.id); await faux.testHelpers.testClocks.advance(horloge.id, { frozen_time: c.frozen_time + jours * JOUR }); await vider(); };
    const abonner = async (compte, { jours = 0, parrain = null, pm = 'pm_card_visa', prix = A.PRIX.proMois, offre = 'pro', periode = 'mois' } = {}) => {
        const cu = await faux.customers.create({ email: 'x@exemple.fr', test_clock: horloge.id });
        const s = await faux.subscriptions.create({ customer: cu.id, items: [{ price: prix }], trial_period_days: jours, default_payment_method: pm, metadata: { compteId: String(compte.id), offre, periode, ...(parrain ? { parrain: String(parrain.id) } : {}) } });
        await vider(); return s.id;
    };
    const prime = id => db.col('abo_primes').findOne({ _id: id });
    const clientDe = sid => faux.sub(sid).customer;
    const avoirs = (cid, filleul = null) => (faux.E.customers.get(cid).transactions || []).filter(t => t.amount < 0 && (!filleul || t.metadata.rm_prime === String(filleul)));
    const solde = cid => faux.E.customers.get(cid).balance || 0;
    const factures = sid => faux.E.invoices.filter(i => i.sub === sid);
    const nbAvoirsTotal = () => faux.E.appels.filter(x => x.nom === 'customers.createBalanceTransaction').length;

    // ── 1. UN PARRAIN MENSUEL ──
    const P = await A.compteConnecte(), F = await A.compteConnecte();
    const sidP = await abonner(P);
    H.v('le parrain est Pro (abonnement payé tout de suite)', [(await A.lireCompte(P.id)).abonnement.actif, (await A.lireCompte(P.id)).abonnement.stripe.statut], [true, 'active']);
    const sidF = await abonner(F, { jours: 30, parrain: P });
    const cF = await A.lireCompte(F.id);
    H.v('le filleul GARDE son essai de 30 jours (fin = création + 30 jours), le parrain noté sur son compte', [cF.abonnement.stripe.statut, (cF.abonnement.stripe.finEssai.getTime() - cF.abonnement.stripe.majLe.getTime()) / 1000 / JOUR, String(cF.abonnement.stripe.parrain)], ['trialing', 30, String(P.id)]);
    H.v('   la facture de l\'essai (0 €) NE déclenche RIEN : aucune prime, aucun avoir', [await prime(F.id), nbAvoirsTotal()], [null, 0]);
    const zero = A.evenement('invoice.paid', { id: 'in_zero', object: 'invoice', customer: clientDe(sidF), amount_paid: 0, amount_due: 0, parent: { type: 'subscription_details', subscription_details: { subscription: sidF } } }, Math.floor(Date.now() / 1000));
    H.v('   une invoice.paid de 0 € (l\'ouverture de l\'essai) est acquittée et ne déclenche RIEN', [(await A.livrer(srv.url, zero)).statut, await prime(F.id), nbAvoirsTotal()], [200, null, 0]);
    const Pa = require('../abonnements/parrainage');
    const cx = id => ({ _id: id, stripeClient: null });
    H.v('   parrainageAdmis : jamais le même compte (même sans client Stripe), jamais le même client Stripe sous deux comptes, sinon oui', [Pa.parrainageAdmis(cx('a'), cx('a')), Pa.parrainageAdmis({ _id: 'a', stripeClient: 'cus_1' }, { _id: 'b', stripeClient: 'cus_1' }), Pa.parrainageAdmis(cx('a'), cx('b')), Pa.parrainageAdmis(null, cx('b'))], [false, false, true, false]);
    await avancer(31);
    H.v('le premier paiement du filleul (499 > 0) : le filleul passe actif', [(await A.lireCompte(F.id)).abonnement.stripe.statut, (await A.lireCompte(F.id)).abonnement.actif], ['active', true]);
    const pr = await prime(F.id);
    H.v('   le parrain reçoit UN MOIS : prime « applique », un AVOIR de 499 centimes (le prix mensuel Pro lu chez Stripe) au solde de SON client, marqué du filleul', [pr.etat, String(pr.parrainId) === String(P.id), pr.montant, avoirs(clientDe(sidP)).map(t => [t.amount, t.currency, t.metadata.rm_prime])], ['applique', true, 499, [[-499, 'eur', String(F.id)]]]);
    H.v('   aucun coupon n\'existe plus, et le filleul ne reçoit aucun avoir', [faux.E.coupons.size, avoirs(clientDe(sidF)).length], [0, 0]);
    const factureF = faux.E.evenements.filter(e => e.type === 'invoice.paid' && e.data.object.amount_paid > 0 && e.data.object.customer === clientDe(sidF)).at(-1);
    const rej = await A.livrer(srv.url, factureF);
    H.v('la même facture rejouée : acquittée en doublon, toujours UN avoir, UNE prime', [rej.json.doublon, avoirs(clientDe(sidP)).length, await db.col('abo_primes').countDocuments({})], [true, 1, 1]);
    await A.livrer(srv.url, { ...factureF, id: 'evt_autreIdentifiant', data: { object: { ...factureF.data.object, id: 'in_autre' } } });
    H.v('   une AUTRE facture payée du même filleul (autre événement) : pas de second crédit', [avoirs(clientDe(sidP)).length, await db.col('abo_primes').countDocuments({})], [1, 1]);
    const avantRenouv = solde(clientDe(sidP));
    await avancer(31);
    H.v('le renouvellement du parrain MENSUEL : sa facture est diminuée de 499 centimes exactement (499 → 0), le solde est consommé, il reste abonné', [avantRenouv, factures(sidP).at(-1).amount_due, solde(clientDe(sidP)), (await A.lireCompte(P.id)).abonnement.stripe.statut], [-499, 0, 0, 'active']);

    // ── 2. UN PARRAIN ANNUEL : un mois, pas un an (le défaut critique du premier jet) ──
    const PA = await A.compteConnecte(), FA = await A.compteConnecte();
    const sidPA = await abonner(PA, { prix: A.PRIX.proAn, periode: 'an' });
    H.v('un parrain ANNUEL paie 3 900 centimes à l\'ouverture', factures(sidPA)[0].amount_paid, 3900);
    await abonner(FA, { jours: 30, parrain: PA });
    await avancer(31);
    const prA = await prime(FA.id);
    H.v('   son filleul paie : l\'avoir est de 499 centimes (UN mois), PAS de 3 900', [prA.etat, prA.montant, avoirs(clientDe(sidPA)).map(t => t.amount)], ['applique', 499, [-499]]);
    await avancer(340);
    const renouvA = factures(sidPA).at(-1);
    H.v('   à son renouvellement annuel, la facture est de 3 401 centimes (3 900 − 499) : jamais offerte en entier', [renouvA.amount_due, renouvA.amount_paid, solde(clientDe(sidPA))], [3401, 3401, 0]);

    // ── 3. garde-fous ──
    const S = await A.compteConnecte();
    const sidS = await abonner(S, { jours: 30, parrain: S });
    await avancer(31);
    H.v('jamais de parrainage de soi-même (compte identique) : prime refusée, aucun avoir', [(await prime(S.id)).etat, (await prime(S.id)).raison, avoirs(clientDe(sidS)).length], ['refusee', 'auto-parrainage', 0]);
    H.v('   et c\'est signalé dans les journaux', logs.some(l => l.includes('auto-parrainage')), true);
    const E1 = await A.compteConnecte();
    await abonner(E1, { jours: 30, parrain: { id: '0123456789abcdef01234567' } });
    await avancer(31);
    H.v('un parrain qui n\'existe pas : aucune prime, aucun plantage', await prime(E1.id), null);
    // un Fondateurs n'est pas parrain
    const PF = await A.compteConnecte(), FF = await A.compteConnecte();
    await A.placePrise(PF.id);
    const sidPF = await abonner(PF, { prix: A.PRIX.fondMois, offre: 'fondateurs' });
    await abonner(FF, { jours: 30, parrain: PF });
    await avancer(31);
    H.v('un FONDATEURS n\'est pas parrain : prime refusée, aucun avoir (le parrainage est sur Pro seulement)', [(await prime(FF.id)).etat, (await prime(FF.id)).raison, avoirs(clientDe(sidPF)).length], ['refusee', 'parrain-fondateurs', 0]);
    // M1 : parrainage réciproque
    const RA = await A.compteConnecte(), RB = await A.compteConnecte();
    await abonner(RA, { jours: 30, parrain: RB }); await abonner(RB, { jours: 30, parrain: RA });
    await avancer(31);
    H.v('M1 : parrainage RÉCIPROQUE (A parrainé par B, puis B par A) : refusé des deux côtés, aucun avoir', [(await prime(RA.id)).raison, (await prime(RB.id)).raison, nbAvoirsTotal()], ['reciproque', 'reciproque', 2]);

    // ── 4. M2 : un parrain en résiliation programmée ne reçoit pas de prime (elle attend) ──
    const R = await A.compteConnecte(), RF = await A.compteConnecte();
    const sidR = await abonner(R, { prix: A.PRIX.proAn, periode: 'an' });
    await faux.subscriptions.update(sidR, { cancel_at_period_end: true }); await vider();
    await abonner(RF, { jours: 30, parrain: R }); await avancer(31);
    H.v('M2 : parrain en résiliation programmée : la prime ATTEND, aucun avoir (une récompense sur un abonnement qui ne refacturera pas serait perdue)', [(await prime(RF.id)).etat, avoirs(clientDe(sidR)).length], ['en-attente-resiliation', 0]);
    await faux.subscriptions.update(sidR, { cancel_at_period_end: false }); await vider();
    H.v('   le parrain reprend son abonnement : la prime est posée', [(await prime(RF.id)).etat, avoirs(clientDe(sidR)).map(t => t.amount)], ['applique', [-499]]);
    const R2 = await A.compteConnecte(), RF2 = await A.compteConnecte();
    const sidR2 = await abonner(R2, { prix: A.PRIX.proAn, periode: 'an' });
    await faux.subscriptions.update(sidR2, { cancel_at_period_end: true }); await vider();
    await abonner(RF2, { jours: 30, parrain: R2 }); await avancer(31);
    await avancer(340);
    H.v('   le parrain résilie pour de bon (l\'abonnement finit) : la prime est ABANDONNÉE et le dit', [(await prime(RF2.id)).etat, logs.some(l => l.includes('prime abandonnee')) || logs.some(l => l.includes('prime abandonnée'))], ['abandonnee', true]);

    // ── 5. M3 : un avoir déjà posé (clé d'idempotence oubliée par Stripe après 24 h) n'est pas reposé ──
    const X = await A.compteConnecte(), XF = await A.compteConnecte();
    const sidX = await abonner(X);
    await faux.customers.createBalanceTransaction(clientDe(sidX), { amount: -499, currency: 'eur', description: 'prime déjà posée', metadata: { rm_prime: String(XF.id) } }, { idempotencyKey: 'ancienne-cle-oubliee' });
    const avantX = nbAvoirsTotal();
    await abonner(XF, { jours: 30, parrain: X }); await avancer(31);
    H.v('M3 : la prime retrouve l\'avoir déjà posé chez Stripe (métadonnée du filleul) : « applique » SANS second avoir', [(await prime(XF.id)).etat, avoirs(clientDe(sidX), XF.id).length, nbAvoirsTotal() - avantX], ['applique', 1, 0]);

    // ── 6. la prime attend un abonnement vivant ; les avoirs s'ajoutent (plus de remise en attente) ──
    const Q = await A.compteConnecte(), G = await A.compteConnecte();
    await abonner(G, { jours: 30, parrain: Q }); await avancer(31);
    H.v('parrain sans abonnement : la prime ATTEND (en-attente-parrain), aucun avoir', [(await prime(G.id)).etat, nbAvoirsTotal() === avantX], ['en-attente-parrain', true]);
    const sidQ = await abonner(Q);
    H.v('   dès que le parrain s\'abonne, l\'avoir est posé sur SON client', [(await prime(G.id)).etat, avoirs(clientDe(sidQ)).map(t => t.amount)], ['applique', [-499]]);
    const G2 = await A.compteConnecte(), G3 = await A.compteConnecte();
    await abonner(G2, { jours: 30, parrain: Q }); await abonner(G3, { jours: 30, parrain: Q });
    await avancer(31);
    H.v('deux autres filleuls du même parrain : deux avoirs de plus, qui S\'ADDITIONNENT (aucun mois perdu, aucune prime en attente)', [(await prime(G2.id)).etat, (await prime(G3.id)).etat, solde(clientDe(sidQ)) <= -499], ['applique', 'applique', true]);

    // ── 7. une panne au milieu : reprise sans doublon ──
    const R5 = await A.compteConnecte(), H1 = await A.compteConnecte();
    const sidR5 = await abonner(R5);
    await abonner(H1, { jours: 30, parrain: R5 });
    faux.panneSur = 'customers.createBalanceTransaction';
    const clock = await faux.testHelpers.testClocks.retrieve(horloge.id);
    file.length = 0;
    await faux.testHelpers.testClocks.advance(horloge.id, { frozen_time: clock.frozen_time + 31 * JOUR });
    const statuts = []; while (file.length) { const e = file.shift(); statuts.push([e.type, (await A.livrer(srv.url, e)).statut]); }
    H.v('Stripe en panne au moment de poser l\'avoir : la facture est refusée (500), rejouable, la prime reste « a-appliquer »', [statuts.filter(s => s[1] === 500).length >= 1, (await prime(H1.id)).etat], [true, 'a-appliquer']);
    faux.panneSur = null;
    const echoue = await db.col('abo_evenements').findOne({ etat: 'erreur' });
    const rejeu = await A.livrer(srv.url, faux.E.evenements.find(e => e.id === echoue._id));
    await vider();
    H.v('   Stripe revenu, le renvoi réussit : prime posée, UN seul avoir, avec la clé d\'idempotence du filleul', [rejeu.statut, (await prime(H1.id)).etat, avoirs(clientDe(sidR5), H1.id).length, faux.E.appels.filter(x => x.nom === 'customers.createBalanceTransaction' && x.opts && x.opts.idempotencyKey === `prime-${H1.id}`).length >= 1], [200, 'applique', 1, true]);

    // ── 8. un checkout.session.completed rejoué après une panne en milieu de traitement reprend la prime en attente du parrain ──
    const Q2 = await A.compteConnecte(), G9 = await A.compteConnecte();
    await abonner(G9, { jours: 30, parrain: Q2 }); await avancer(31);
    H.v('parrain sans abonnement, la prime attend', (await prime(G9.id)).etat, 'en-attente-parrain');
    const cuQ = await faux.customers.create({ email: 'q@exemple.fr', test_clock: horloge.id });
    const sQ = await faux.subscriptions.create({ customer: cuQ.id, items: [{ price: A.PRIX.proMois }], default_payment_method: 'pm_card_visa', metadata: { compteId: String(Q2.id), offre: 'pro', periode: 'mois' } });
    file.length = 0;
    await require('../abonnements/etat').appliquer(faux.vue(sQ.id), { cfgAbo: A.cfgAbo().abonnements, version: Math.floor(Date.now() / 1000), evtDate: new Date() });
    H.v('   l\'état du parrain est appliqué mais la prime n\'est pas encore reprise (le crash est réel)', (await prime(G9.id)).etat, 'en-attente-parrain');
    await A.livrer(srv.url, A.evenement('checkout.session.completed', { id: 'cs_test_rejeu', object: 'checkout.session', mode: 'subscription', client_reference_id: String(Q2.id), customer: cuQ.id, subscription: sQ.id }, Math.floor(Date.now() / 1000)));
    H.v('   le checkout.session.completed rejoué (abonnement déjà connu) reprend la prime : avoir posé', [(await prime(G9.id)).etat, avoirs(cuQ.id).map(t => t.amount)], ['applique', [-499]]);
    H.v('aucun secret dans les journaux', logs.some(l => /sk_test_BANC|whsec_banc/i.test(l)), false);
    await srv.fermer(); Cl.debrancher(); console.error = errOrig;
    await H.fermerBac(); H.bilan();
})().catch(e => { console.error = errOrig; console.error('❌', e); process.exit(1); });
