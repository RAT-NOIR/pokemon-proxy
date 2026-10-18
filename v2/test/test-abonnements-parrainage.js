'use strict';
// STRIPE-V2 — le parrainage de bout en bout sur le faux Stripe à horloges d'essai : le filleul a 30 jours ; quand sa PREMIÈRE facture PAYÉE (montant > 0) arrive, le parrain reçoit UN mois offert
// (coupon 100 %, once) sur SON abonnement. Un seul crédit par filleul, jamais de parrainage de soi-même (compte ou client Stripe), une prime qui attend sa fenêtre, une panne au milieu qui se reprend.
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
    const abonner = async (compte, { jours = 0, parrain = null, pm = 'pm_card_visa', prix = A.PRIX.proMois } = {}) => {
        const cu = await faux.customers.create({ email: 'x@exemple.fr', test_clock: horloge.id });
        const s = await faux.subscriptions.create({ customer: cu.id, items: [{ price: prix }], trial_period_days: jours, default_payment_method: pm, metadata: { compteId: String(compte.id), offre: 'pro', periode: 'mois', ...(parrain ? { parrain: String(parrain.id) } : {}) } });
        await vider(); return s.id;
    };
    const prime = id => db.col('abo_primes').findOne({ _id: id });
    const nbCoupons = () => faux.E.appels.filter(x => x.nom === 'coupons.create').length;
    const remisesDe = sid => faux.sub(sid).discounts.map(d => d.coupon);

    const P = await A.compteConnecte(), F = await A.compteConnecte();
    const sidP = await abonner(P);                                       // le parrain : abonné actif, premier mois payé
    H.v('le parrain est Pro (abonnement payé tout de suite)', [(await A.lireCompte(P.id)).abonnement.actif, (await A.lireCompte(P.id)).abonnement.stripe.statut], [true, 'active']);
    const sidF = await abonner(F, { jours: 30, parrain: P });
    const cF = await A.lireCompte(F.id);
    H.v('le filleul est en essai de 30 jours (fin = création + 30 jours), le parrain noté sur son compte', [cF.abonnement.stripe.statut, (cF.abonnement.stripe.finEssai.getTime() - cF.abonnement.stripe.majLe.getTime()) / 1000 / JOUR, String(cF.abonnement.stripe.parrain)], ['trialing', 30, String(P.id)]);
    H.v('   la facture de l\'essai (0 €) NE déclenche RIEN : aucune prime, aucun coupon', [await prime(F.id), nbCoupons()], [null, 0]);
    // la vraie facture d'ouverture d'un essai est une facture « payée » à 0 € : elle arrive bel et bien, et elle ne compte pas
    const zero = A.evenement('invoice.paid', { id: 'in_zero', object: 'invoice', customer: faux.sub(sidF).customer, amount_paid: 0, amount_due: 0, parent: { type: 'subscription_details', subscription_details: { subscription: sidF } } }, Math.floor(Date.now() / 1000));
    H.v('   une invoice.paid de 0 € (l\'ouverture de l\'essai) est acquittée et ne déclenche RIEN', [(await A.livrer(srv.url, zero)).statut, await prime(F.id), nbCoupons()], [200, null, 0]);
    const Pa = require('../abonnements/parrainage');
    const cx = id => ({ _id: id, stripeClient: null });
    H.v('   parrainageAdmis : jamais le même compte (même sans client Stripe), jamais le même client Stripe sous deux comptes, sinon oui', [Pa.parrainageAdmis(cx('a'), cx('a')), Pa.parrainageAdmis({ _id: 'a', stripeClient: 'cus_1' }, { _id: 'b', stripeClient: 'cus_1' }), Pa.parrainageAdmis(cx('a'), cx('b')), Pa.parrainageAdmis(null, cx('b'))], [false, false, true, false]);
    await avancer(31);
    const cF2 = await A.lireCompte(F.id);
    H.v('le premier paiement du filleul (499 > 0) : le filleul passe actif', [cF2.abonnement.stripe.statut, cF2.abonnement.actif], ['active', true]);
    const pr = await prime(F.id);
    H.v('   le parrain reçoit SON mois offert : prime « applique », un coupon à 100 % « once » posé sur SON abonnement', [pr.etat, String(pr.parrainId) === String(P.id), nbCoupons(), faux.E.coupons.get(`rm-parrainage-${F.id}`).percent_off, faux.E.coupons.get(`rm-parrainage-${F.id}`).duration, remisesDe(sidP)], ['applique', true, 1, 100, 'once', [`rm-parrainage-${F.id}`]]);
    H.v('   le coupon n\'est PAS sur l\'abonnement du filleul', remisesDe(sidF), []);
    // rejeu de la facture : rien de plus
    const factureF = faux.E.evenements.filter(e => e.type === 'invoice.paid' && e.data.object.amount_paid > 0 && e.data.object.customer === faux.sub(sidF).customer).at(-1);
    const rej = await A.livrer(srv.url, factureF);
    H.v('la même facture rejouée : acquittée en doublon, toujours UN coupon, UNE prime', [rej.json.doublon, nbCoupons(), await db.col('abo_primes').countDocuments({})], [true, 1, 1]);
    const autre = { ...factureF, id: 'evt_autreIdentifiant', data: { object: { ...factureF.data.object, id: 'in_autre' } } };
    await A.livrer(srv.url, autre);
    H.v('   une AUTRE facture payée du même filleul (autre événement) : pas de second crédit', [nbCoupons(), await db.col('abo_primes').countDocuments({}), remisesDe(sidP).length], [1, 1, 1]);
    // le parrain renouvelle : la facture est à 0 (le coupon est consommé), il reste abonné
    await avancer(31);
    const factP = faux.E.invoices.filter(i => i.sub === sidP);
    H.v('le renouvellement du parrain suivant : sa facture est à 0 € (le mois offert), puis plus aucune remise', [factP.at(-1).amount_paid, remisesDe(sidP), (await A.lireCompte(P.id)).abonnement.stripe.statut], [0, [], 'active']);

    // ── garde-fous ──
    const S = await A.compteConnecte();
    const sidS = await abonner(S, { jours: 30, parrain: S });
    await avancer(31);
    H.v('jamais de parrainage de soi-même (compte identique) : prime refusée, aucun coupon de plus', [(await prime(S.id)).etat, (await prime(S.id)).raison, nbCoupons(), remisesDe(sidS)], ['refusee', 'auto-parrainage', 1, []]);
    H.v('   et c\'est signalé dans les journaux', logs.some(l => l.includes('auto-parrainage')), true);
    const A1 = await A.compteConnecte(), B1 = await A.compteConnecte();
    const sidA1 = await abonner(A1);
    await db.col('comptes').updateOne({ _id: B1.id }, { $set: { stripeClient: (await A.lireCompte(A1.id)).stripeClient } }).catch(() => { });
    H.v('   deux comptes ne peuvent pas partager un client Stripe (l\'index unique le refuse en base)', (await A.lireCompte(B1.id)).stripeClient, null);
    const E1 = await A.compteConnecte();
    const sidE1 = await abonner(E1, { jours: 30, parrain: { id: '0123456789abcdef01234567' } });
    await avancer(31);
    H.v('un parrain qui n\'existe pas : aucune prime, aucun plantage', [await prime(E1.id), nbCoupons()], [null, 1]);

    // ── la prime attend un abonnement vivant, puis la remise consommée ──
    const Q = await A.compteConnecte(), G = await A.compteConnecte();     // Q : parrain SANS abonnement
    await abonner(G, { jours: 30, parrain: Q });
    await avancer(31);
    H.v('parrain sans abonnement : la prime ATTEND (en-attente-parrain), aucun coupon', [(await prime(G.id)).etat, nbCoupons()], ['en-attente-parrain', 1]);
    const sidQ = await abonner(Q);
    H.v('   dès que le parrain s\'abonne, la prime est posée sur SON abonnement', [(await prime(G.id)).etat, remisesDe(sidQ), nbCoupons()], ['applique', [`rm-parrainage-${G.id}`], 2]);
    // deux filleuls pour le même parrain : le second coupon n'est pas empilé (il se perdrait sur la même facture)
    const G2 = await A.compteConnecte(), G3 = await A.compteConnecte();
    await abonner(G2, { jours: 30, parrain: Q }); await abonner(G3, { jours: 30, parrain: Q });
    await avancer(1);                                                    // les deux essais finissent le même jour
    await avancer(31);
    const etats = [(await prime(G2.id)).etat, (await prime(G3.id)).etat].sort();
    H.v('deux filleuls payent alors que le premier mois offert n\'est pas consommé : une seule remise posée, l\'autre prime attend (aucun mois offert perdu)', [etats, remisesDe(sidQ).length], [['applique', 'en-attente-remise'].sort(), 1]);
    await avancer(31);                                                   // la facture du parrain consomme la remise, le webhook reprend la prime en attente
    const apres = [(await prime(G2.id)).etat, (await prime(G3.id)).etat];
    H.v('   après la facture du parrain (remise consommée), la seconde prime est posée à son tour', [apres.every(x => x === 'applique'), nbCoupons()], [true, 4]);

    // ── une panne au milieu : reprise sans doublon ──
    const R = await A.compteConnecte(), H1 = await A.compteConnecte();
    const sidR = await abonner(R);
    await abonner(H1, { jours: 30, parrain: R });
    faux.panneSur = 'subscriptions.update';
    const clock = await faux.testHelpers.testClocks.retrieve(horloge.id);
    file.length = 0;
    // l'avance qui déclenche la facture : les événements sont rassemblés, la livraison de la facture échoue (500) à cause de la panne
    await faux.testHelpers.testClocks.advance(horloge.id, { frozen_time: clock.frozen_time + 31 * JOUR });
    const statuts = []; while (file.length) { const e = file.shift(); statuts.push([e.type, (await A.livrer(srv.url, e)).statut]); }
    const enErreur = statuts.filter(s => s[1] === 500).length;
    H.v('Stripe en panne au moment de poser le coupon : la facture est refusée (500), rejouable, la prime reste « a-appliquer »', [enErreur >= 1, (await prime(H1.id)).etat], [true, 'a-appliquer']);
    faux.panneSur = null;
    const echoue = await db.col('abo_evenements').findOne({ etat: 'erreur' });
    const rejeu = await A.livrer(srv.url, faux.E.evenements.find(e => e.id === echoue._id));
    await vider();
    H.v('   Stripe revenu, le renvoi réussit : prime posée ; le coupon (deux tentatives de création, la seconde « existe déjà » tolérée) n\'existe qu\'UNE fois et n\'est posé qu\'UNE fois', [rejeu.statut, (await prime(H1.id)).etat, faux.E.appels.filter(x => x.nom === 'coupons.create' && x.params.id === `rm-parrainage-${H1.id}`).length, [...faux.E.coupons.keys()].filter(k => k === `rm-parrainage-${H1.id}`).length, remisesDe(sidR)], [200, 'applique', 2, 1, [`rm-parrainage-${H1.id}`]]);
    H.v('   la clé d\'idempotence de la pose est celle du filleul (Stripe ne la ferait pas deux fois)', faux.E.appels.filter(x => x.nom === 'subscriptions.update' && x.opts && x.opts.idempotencyKey === `prime-${H1.id}`).length >= 1, true);
    H.v('aucun secret dans les journaux', logs.some(l => /sk_test_BANC|whsec_banc/i.test(l)), false);
    await srv.fermer(); Cl.debrancher(); console.error = errOrig;
    await H.fermerBac(); H.bilan();
})().catch(e => { console.error = errOrig; console.error('❌', e); process.exit(1); });
