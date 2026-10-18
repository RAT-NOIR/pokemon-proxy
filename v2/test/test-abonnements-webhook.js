'use strict';
// STRIPE-V2 — le webhook : signature, registre par événement, idempotence, désordre, impayé, résiliation, compte inconnu, et l'effet sur les quotas. Faux Stripe en mémoire, base de banc, aucun réseau.
const H = require('./_harnais'); const db = require('../db'); const M = require('../modeles');
const A = require('./_aide-abonnements'); const { creerFauxStripe, JOUR } = require('./_faux-stripe');
const Cl = require('../abonnements/client'); const Of = require('../argent/offre'); const Lg = require('../argent/ledger');
const { lireSubscription } = require('../abonnements/etat');
const logs = []; const errOrig = console.error; console.error = (...a) => { logs.push(a.join(' ')); };

(async () => {
    await H.ouvrirBac('test-abonnements-webhook.js'); await M.creerIndex();
    const faux = creerFauxStripe(); Cl.brancher(faux);
    const cfg = A.cfgAbo(), cfgBanc = A.cfgAbo({ V2_QUOTA_PRO_PLAFOND: '3', V2_QUOTA_GRATUIT: '2' });
    const srv = await A.serveur(cfg);
    const now = A.maintenantS(), T = now;                       // les dates des événements sont celles de maintenant : offre.js lit l'horloge réelle
    const fin = T + 20 * JOUR;
    const reg = () => db.col('abo_evenements');

    // ── 1. SIGNATURE : sans signature valide, rien n'est lu ni écrit ──
    const u = await A.compteConnecte();
    const metaU = { compteId: String(u.id), offre: 'pro', periode: 'mois' };
    const e0 = A.evenement('customer.subscription.created', A.sub({ id: 'sub_u', client: 'cus_u', statut: 'trialing', fin, trialEnd: fin, metadata: metaU }), T);
    H.v('sans en-tête de signature : 400', (await A.livrer(srv.url, e0, { signature: null })).statut, 400);
    H.v('signature d\'un AUTRE secret : 400', (await A.livrer(srv.url, e0, { secret: 'whsec_autreautreautre' })).statut, 400);
    H.v('signature valide mais corps modifié après coup : 400', (await A.livrer(srv.url, e0, { corps: JSON.stringify(e0) + ' ', signature: A.signer(JSON.stringify(e0)) })).statut, 400);
    H.v('horodatage de la signature trop ancien (hors tolérance de 300 s) : 400', (await A.livrer(srv.url, e0, { timestamp: now - 3600 })).statut, 400);
    H.v('signature « v1 » devinée (zéros) : 400', (await A.livrer(srv.url, e0, { signature: `t=${now},v1=${'0'.repeat(64)}` })).statut, 400);
    H.v('   les cinq refus n\'ont écrit NI registre NI état', [await reg().countDocuments({}), (await A.lireCompte(u.id)).abonnement.actif], [0, false]);
    H.v('   et aucune valeur de secret dans les journaux', logs.some(l => l.includes(A.SECRET) || l.includes('sk_test_BANC')), false);

    // ── 2. UN ABONNEMENT QUI COMMENCE : le compte passe Pro, le client Stripe est lié, le registre garde l'événement ──
    const r1 = await A.livrer(srv.url, e0);
    const c1 = await A.lireCompte(u.id);
    H.v('essai (trialing) : 200', r1.statut, 200);
    H.v('   Pro jusqu\'à la fin de la période, offre pro/mois, client lié, essai utilisé', [c1.abonnement.actif, c1.abonnement.jusquAu.getTime() / 1000, c1.abonnement.stripe.offre, c1.abonnement.stripe.periode, c1.abonnement.stripe.statut, c1.stripeClient, c1.abonnement.stripe.essaiUtilise], [true, fin + A.MARGE_S, 'pro', 'mois', 'trialing', 'cus_u', true]);
    const l1 = await reg().findOne({ _id: e0.id });
    H.v('   le registre : une ligne par identifiant d\'événement, traitée, sans le contenu de l\'événement', [l1.etat, l1.type, l1.tentatives, Object.keys(l1).sort()], ['traite', 'customer.subscription.created', 1, ['_id', 'compteId', 'creeLe', 'etat', 'raison', 'recuLe', 'signaux', 'tentatives', 'traiteLe', 'type']]);

    // ── 3. IDEMPOTENCE : le même événement, une seconde fois, puis cinq fois en parallèle ──
    const r2 = await A.livrer(srv.url, e0);
    H.v('le même événement rejoué : 200 « doublon », rien refait', [r2.statut, r2.json.doublon, (await reg().findOne({ _id: e0.id })).tentatives, await reg().countDocuments({ _id: e0.id })], [200, true, 1, 1]);
    const e0b = A.evenement('customer.subscription.updated', A.sub({ id: 'sub_u', client: 'cus_u', statut: 'active', fin: fin + 10 * JOUR, metadata: metaU }), T + 5);
    const rafale = await Promise.all(Array.from({ length: 5 }, () => A.livrer(srv.url, e0b)));
    H.v('cinq livraisons simultanées du même événement : aucune erreur 5xx, une seule ligne de registre', [rafale.every(r => r.statut === 200 || r.statut === 409), await reg().countDocuments({ _id: e0b.id })], [true, 1]);
    const apresRafale = await Promise.all([A.livrer(srv.url, e0b)]);
    H.v('   puis l\'événement est acquitté et l\'état est l\'abonnement actif', [apresRafale[0].statut, (await A.lireCompte(u.id)).abonnement.stripe.statut, (await A.lireCompte(u.id)).abonnement.jusquAu.getTime() / 1000], [200, 'active', fin + 10 * JOUR + A.MARGE_S]);

    // ── 4. DÉSORDRE : un événement plus ancien ne fait JAMAIS régresser l'état ──
    const ancien = A.evenement('customer.subscription.updated', A.sub({ id: 'sub_u', client: 'cus_u', statut: 'trialing', fin, trialEnd: fin, metadata: metaU }), T + 1);
    const rA = await A.livrer(srv.url, ancien);
    const c4 = await A.lireCompte(u.id);
    H.v('un « updated » plus ancien (essai) arrive après l\'actif : acquitté, IGNORÉ, l\'état reste actif jusqu\'à la fin plus tardive', [rA.statut, (await reg().findOne({ _id: ancien.id })).raison, c4.abonnement.stripe.statut, c4.abonnement.jusquAu.getTime() / 1000], [200, 'desordre', 'active', fin + 10 * JOUR + A.MARGE_S]);
    const dernier = A.evenement('customer.subscription.deleted', A.sub({ id: 'sub_u', client: 'cus_u', statut: 'canceled', fin: fin + 10 * JOUR, endedAt: T + 10, metadata: metaU }), T + 10);
    await A.livrer(srv.url, dernier);
    H.v('« deleted » : fin de l\'abonnement, plus de Pro', [(await A.lireCompte(u.id)).abonnement.actif, (await A.lireCompte(u.id)).abonnement.stripe.statut], [false, 'canceled']);
    const tardif = A.evenement('customer.subscription.updated', A.sub({ id: 'sub_u', client: 'cus_u', statut: 'active', fin: fin + 10 * JOUR, metadata: metaU }), T + 8);
    await A.livrer(srv.url, tardif);
    H.v('   un « updated » actif arrivé APRÈS le deleted mais daté AVANT lui : ignoré, le compte reste sans Pro', [(await A.lireCompte(u.id)).abonnement.actif, (await A.lireCompte(u.id)).abonnement.stripe.statut], [false, 'canceled']);

    // ── 5. IMPAYÉ : Pro maintenu 3 jours après le PREMIER past_due, jamais prolongé ──
    const p = await A.compteConnecte(); const metaP = { compteId: String(p.id), offre: 'pro', periode: 'mois' };
    const finP = T + 25 * JOUR;
    await A.livrer(srv.url, A.evenement('customer.subscription.created', A.sub({ id: 'sub_p', client: 'cus_p', statut: 'active', fin: finP, metadata: metaP }), T));
    const pd1 = A.evenement('customer.subscription.updated', A.sub({ id: 'sub_p', client: 'cus_p', statut: 'past_due', fin: finP + 30 * JOUR, metadata: metaP }), T + 100);
    await A.livrer(srv.url, pd1);
    const cp1 = await A.lireCompte(p.id);
    H.v('past_due : Pro maintenu 3 jours après l\'événement (pas jusqu\'à la fin de la période suivante)', [cp1.abonnement.actif, cp1.abonnement.jusquAu.getTime() / 1000], [true, T + 100 + 3 * JOUR]);
    await A.livrer(srv.url, A.evenement('customer.subscription.updated', A.sub({ id: 'sub_p', client: 'cus_p', statut: 'past_due', fin: finP + 30 * JOUR, metadata: metaP }), T + 2 * JOUR));
    H.v('   un nouvel événement past_due, deux jours plus tard, NE prolonge PAS la grâce', (await A.lireCompte(p.id)).abonnement.jusquAu.getTime() / 1000, T + 100 + 3 * JOUR);
    const echec = A.evenement('invoice.payment_failed', { id: 'in_p1', object: 'invoice', customer: 'cus_p', amount_due: 499, amount_paid: 0, parent: { subscription_details: { subscription: 'sub_p' } } }, T + 3 * JOUR);
    await A.livrer(srv.url, echec);
    const cp2 = await A.lireCompte(p.id);
    H.v('invoice.payment_failed : l\'échec est daté, le droit ne bouge pas', [cp2.abonnement.stripe.paiementEchoueLe.getTime() / 1000, cp2.abonnement.jusquAu.getTime() / 1000], [T + 3 * JOUR, T + 100 + 3 * JOUR]);
    const grace = (cp1.abonnement.jusquAu.getTime() / 1000);
    H.v('   la grâce finie (4 jours après), le compte est « gratuit » par la fonction des quotas', (await Of.etatDe({ type: 'compte', id: p.id }, cfg, new Date((grace + 60) * 1000))).nom, 'gratuit');
    await A.livrer(srv.url, A.evenement('customer.subscription.updated', A.sub({ id: 'sub_p', client: 'cus_p', statut: 'active', fin: finP + 30 * JOUR, metadata: metaP }), T + 4 * JOUR));
    H.v('   le paiement repris (active) : Pro jusqu\'à la fin de la nouvelle période', [(await A.lireCompte(p.id)).abonnement.actif, (await A.lireCompte(p.id)).abonnement.jusquAu.getTime() / 1000], [true, finP + 30 * JOUR + A.MARGE_S]);

    // ── 6. RÉSILIATION EN FIN DE PÉRIODE : Pro jusqu'au bout, puis gratuit ──
    const r = await A.compteConnecte(); const metaR = { compteId: String(r.id), offre: 'pro', periode: 'an' };
    const finR = T + 40 * JOUR;
    await A.livrer(srv.url, A.evenement('customer.subscription.updated', A.sub({ id: 'sub_r', client: 'cus_r', statut: 'active', prixId: A.PRIX.proAn, fin: finR, cancelAtPeriodEnd: true, metadata: metaR }), T));
    const cr = await A.lireCompte(r.id);
    H.v('résiliation programmée : toujours Pro, jusqu\'à la fin de la période, résiliation notée, période annuelle lue du PRIX', [cr.abonnement.actif, cr.abonnement.jusquAu.getTime() / 1000, cr.abonnement.stripe.resiliation, cr.abonnement.stripe.periode], [true, finR, true, 'an']);
    H.v('   après la fin de la période : gratuit', (await Of.etatDe({ type: 'compte', id: r.id }, cfg, new Date((finR + 1) * 1000))).nom, 'gratuit');
    H.v('   avant : pro', (await Of.etatDe({ type: 'compte', id: r.id }, cfg, new Date())).nom, 'pro');

    // ── 7. COMPTE INCONNU : enregistré, signalé, jamais un plantage ──
    logs.length = 0;
    const inconnu = A.evenement('customer.subscription.created', A.sub({ id: 'sub_x', client: 'cus_inconnu', statut: 'active', fin, metadata: { compteId: '0123456789abcdef01234567' } }), T);
    const rI = await A.livrer(srv.url, inconnu);
    const lI = await reg().findOne({ _id: inconnu.id });
    H.v('abonnement d\'un compte qui n\'existe pas : 200, ligne « rejete / compte-inconnu », signalé', [rI.statut, lI.etat, lI.raison, logs.some(l => l.includes('compte-inconnu'))], [200, 'rejete', 'compte-inconnu', true]);
    const rI2 = await A.livrer(srv.url, A.evenement('invoice.paid', { id: 'in_x', object: 'invoice', customer: 'cus_inconnu', amount_paid: 499 }, T));
    H.v('   une facture d\'un client inconnu : 200 aussi', rI2.statut, 200);
    // le renvoi à la main (tableau de bord) d'un événement mis de côté le RETRAITE (« rejete » n'est pas final)
    const rI3 = await A.livrer(srv.url, inconnu);
    H.v('   renvoyé à la main : retraité (tentatives 2), toujours 200', [rI3.statut, (await reg().findOne({ _id: inconnu.id })).tentatives], [200, 2]);

    // ── 8. LIAISONS : un client Stripe n'appartient qu'à un seul compte ──
    const a = await A.compteConnecte(), b = await A.compteConnecte();
    await A.livrer(srv.url, A.evenement('customer.subscription.created', A.sub({ id: 'sub_a', client: 'cus_ab', statut: 'active', fin, metadata: { compteId: String(a.id), offre: 'pro', periode: 'mois' } }), T));
    logs.length = 0;
    const croise = A.evenement('customer.subscription.created', A.sub({ id: 'sub_b', client: 'cus_ab', statut: 'active', fin, metadata: { compteId: String(b.id), offre: 'pro', periode: 'mois' } }), T);
    await A.livrer(srv.url, croise);
    H.v('le même client Stripe désigné par un second compte : refusé (raison nommée), le second compte n\'est pas Pro', [(await reg().findOne({ _id: croise.id })).raison, (await A.lireCompte(b.id)).abonnement.actif, (await A.lireCompte(b.id)).stripeClient], ['client-et-compte-divergent', false, null]);
    const sansMeta = A.evenement('customer.subscription.updated', A.sub({ id: 'sub_a', client: 'cus_ab', statut: 'active', fin: fin + JOUR, metadata: {} }), T + 20);
    await A.livrer(srv.url, sansMeta);
    H.v('un événement sans métadonnée retrouve le compte par son client Stripe lié', (await A.lireCompte(a.id)).abonnement.jusquAu.getTime() / 1000, fin + JOUR + A.MARGE_S);

    // ── 9. PRIX INCONNU et MODE : jamais de Pro deviné ──
    const g = await A.compteConnecte();
    logs.length = 0;
    const etrange = A.evenement('customer.subscription.created', A.sub({ id: 'sub_g', client: 'cus_g', statut: 'active', prixId: 'price_AUTRE', fin, metadata: { compteId: String(g.id) } }), T);
    await A.livrer(srv.url, etrange);
    H.v('un abonnement à un prix qui n\'est pas l\'un des quatre : aucun Pro, signalé', [(await A.lireCompte(g.id)).abonnement.actif, logs.some(l => l.includes('prix-inconnu'))], [false, true]);
    const live = A.evenement('customer.subscription.created', A.sub({ id: 'sub_g2', client: 'cus_g', statut: 'active', fin, metadata: { compteId: String(g.id), offre: 'pro' } }), T, { livemode: true });
    await A.livrer(srv.url, live);
    H.v('un événement « live » reçu par un service en mode test : mis de côté, aucun effet', [(await reg().findOne({ _id: live.id })).raison, (await A.lireCompte(g.id)).abonnement.actif], ['mode-different', false]);
    await A.placePrise(g.id);
    const lookupSeul = A.evenement('customer.subscription.created', A.sub({ id: 'sub_g3', client: 'cus_g', statut: 'active', prixId: 'price_FERMEE', lookup: 'rm_v2_fondateurs_an', fin, metadata: { compteId: String(g.id) } }), T + 1);
    await A.livrer(srv.url, lookupSeul);
    H.v('un prix hors configuration mais portant la clé de recherche Rat-Market (offre fermée depuis) reste servi à son abonné', [(await A.lireCompte(g.id)).abonnement.actif, (await A.lireCompte(g.id)).abonnement.stripe.offre, (await A.lireCompte(g.id)).abonnement.stripe.periode], [true, 'fondateurs', 'an']);

    // ── 10. checkout.session.completed ──
    const k = await A.compteConnecte();
    const cl = await faux.customers.create({ email: 'x@exemple.fr' });
    const sRel = await faux.subscriptions.create({ customer: cl.id, items: [{ price: A.PRIX.proMois }], trial_period_days: 14, metadata: { compteId: String(k.id), offre: 'pro', periode: 'mois' }, default_payment_method: 'pm_card_visa' });
    const sess = { id: 'cs_test_1', object: 'checkout.session', mode: 'subscription', client_reference_id: String(k.id), customer: cl.id, subscription: sRel.id, consent: { terms_of_service: 'accepted' } };
    const eS = A.evenement('checkout.session.completed', sess, T);
    H.v('checkout.session.completed : 200, l\'abonnement relu chez Stripe est appliqué', [(await A.livrer(srv.url, eS)).statut, (await A.lireCompte(k.id)).abonnement.actif, (await A.lireCompte(k.id)).stripeClient === cl.id], [200, true, true]);
    H.v('   l\'acceptation des CGV est datée', (await A.lireCompte(k.id)).abonnement.stripe.cgvAccepteesLe instanceof Date, true);
    const eS2 = A.evenement('checkout.session.completed', { ...sess, id: 'cs_test_2', client_reference_id: String(a.id) }, T);
    await A.livrer(srv.url, eS2);
    H.v('   une session dont la référence de compte contredit la métadonnée de l\'abonnement : rejetée, aucun effet', (await reg().findOne({ _id: eS2.id })).raison, 'reference-divergente');
    const ePaiement = A.evenement('checkout.session.completed', { id: 'cs_test_3', mode: 'payment', client_reference_id: String(a.id) }, T);
    H.v('   une session d\'un autre mode (les packs de la v1) : acquittée, ignorée', [(await A.livrer(srv.url, ePaiement)).statut, (await reg().findOne({ _id: ePaiement.id })).raison], [200, 'pas-un-abonnement']);
    // panne de Stripe pendant le traitement : 500, rejouable, puis repris
    faux.panneSur = 'subscriptions.retrieve';
    const m = await A.compteConnecte(); const sM = await faux.subscriptions.create({ customer: (await faux.customers.create({})).id, items: [{ price: A.PRIX.proMois }], trial_period_days: 14, metadata: { compteId: String(m.id) } });
    const eM = A.evenement('checkout.session.completed', { id: 'cs_test_4', mode: 'subscription', client_reference_id: String(m.id), customer: faux.sub(sM.id).customer, subscription: sM.id }, T);
    const rM = await A.livrer(srv.url, eM);
    H.v('Stripe en panne pendant le traitement : 500, ligne « erreur » (rejouable)', [rM.statut, (await reg().findOne({ _id: eM.id })).etat], [500, 'erreur']);
    faux.panneSur = null;
    const rM2 = await A.livrer(srv.url, eM);
    H.v('   Stripe revenu, le renvoi réussit : 200, tentatives 2, compte Pro', [rM2.statut, (await reg().findOne({ _id: eM.id })).tentatives, (await A.lireCompte(m.id)).abonnement.actif], [200, 2, true]);

    // ── 11. LES FORMES DE L'OBJET : date de période sur l'abonnement (ancienne) ou sur la ligne (récente) ──
    const ancienne = lireSubscription(A.sub({ fin: 1800000000, formeRecente: false }), cfg.abonnements), recente = lireSubscription(A.sub({ fin: 1800000000, formeRecente: true }), cfg.abonnements);
    H.v('la fin de période est lue sur les deux formes', [ancienne.finPeriode, recente.finPeriode, ancienne.offre, recente.periode], [1800000000, 1800000000, 'pro', 'mois']);

    // ── 12. LES QUOTAS : un compte passé Pro par webhook a le plafond invisible (200 par défaut) et la remise à zéro au minuit de Paris ──
    H.v('le plafond technique Pro vaut 200 par défaut (V2_QUOTA_PRO_PLAFOND)', cfg.quotas.proPlafond, 200);
    const q = await A.compteConnecte(); const metaQ = { compteId: String(q.id), offre: 'pro', periode: 'mois' };
    const gratuit = await Of.offre(q.porteur, cfgBanc);
    H.v('avant le webhook : offre gratuite, 2 par jour (config de banc)', [gratuit.nom, gratuit.restant], ['gratuit', 2]);
    await A.livrer(srv.url, A.evenement('customer.subscription.created', A.sub({ id: 'sub_q', client: 'cus_q', statut: 'active', fin, metadata: metaQ }), T));
    const pro = await Of.offre(q.porteur, cfgBanc);
    H.v('après le webhook : offre pro, restant jamais montré (null), remise à zéro = prochain minuit de Paris', [pro.nom, pro.restant, pro.remiseAZero], ['pro', null, Of.prochainMinuitParis(new Date()).iso]);
    const jours = [];
    for (let i = 0; i < 5; i++) jours.push((await Lg.debiter(q.porteur, { scanId: `q${i}`, cleIdempotence: `q${i}`, maintenant: new Date() }, cfgBanc)).ok ? 'ok' : 'QUOTA');
    H.v('le plafond technique (3 en banc) s\'applique : 3 analyses passent, les suivantes sont refusées — PLAFOND, pas un quota gratuit de 2', jours, ['ok', 'ok', 'ok', 'QUOTA', 'QUOTA']);
    const demain = new Date(Of.prochainMinuitParis(new Date()).instant.getTime() + 3600e3);
    H.v('   après minuit de Paris le compteur repart : l\'analyse passe', (await Lg.debiter(q.porteur, { scanId: 'q-demain', cleIdempotence: 'q-demain', maintenant: demain }, cfgBanc)).ok, true);
    await A.livrer(srv.url, A.evenement('customer.subscription.deleted', A.sub({ id: 'sub_q', client: 'cus_q', statut: 'canceled', fin, endedAt: T + 50, metadata: metaQ }), T + 50));
    H.v('abonnement résilié : retour au gratuit (2 par jour en banc), restant recalculé', [(await Of.offre(q.porteur, cfgBanc)).nom], ['gratuit']);

    // ── 12 bis. I2 : UNE MARGE AU RENOUVELLEMENT (48 h) — jamais pour une résiliation, ni pour un impayé ──
    const mg = await A.compteConnecte(); const metaM = { compteId: String(mg.id), offre: 'pro', periode: 'mois' }, finM = T + 3 * JOUR;
    await A.livrer(srv.url, A.evenement('customer.subscription.updated', A.sub({ id: 'sub_m', client: 'cus_m', statut: 'active', fin: finM, metadata: metaM }), T));
    H.v('actif non résilié : jusquAu = fin de période + 48 h (une constante nommée)', (await A.lireCompte(mg.id)).abonnement.jusquAu.getTime() / 1000, finM + 48 * 3600);
    H.v('   une heure APRÈS la fin de période, avant le webhook de renouvellement : toujours Pro ; 49 h après : gratuit', [(await Of.etatDe({ type: 'compte', id: mg.id }, cfg, new Date((finM + 3600) * 1000))).nom, (await Of.etatDe({ type: 'compte', id: mg.id }, cfg, new Date((finM + 49 * 3600) * 1000))).nom], ['pro', 'gratuit']);
    const mg2 = await A.compteConnecte(); const metaM2 = { compteId: String(mg2.id), offre: 'pro', periode: 'mois' };
    await A.livrer(srv.url, A.evenement('customer.subscription.updated', A.sub({ id: 'sub_m2', client: 'cus_m2', statut: 'active', fin: finM, cancelAtPeriodEnd: true, metadata: metaM2 }), T));
    H.v('   résiliation programmée : AUCUNE marge (fin exacte de la période)', [(await A.lireCompte(mg2.id)).abonnement.jusquAu.getTime() / 1000, (await Of.etatDe({ type: 'compte', id: mg2.id }, cfg, new Date((finM + 3600) * 1000))).nom], [finM, 'gratuit']);
    await A.livrer(srv.url, A.evenement('customer.subscription.deleted', A.sub({ id: 'sub_m', client: 'cus_m', statut: 'canceled', fin: finM, endedAt: T + 60, metadata: metaM }), T + 60));
    H.v('   abonnement supprimé : aucune marge (plus de Pro dès la suppression)', [(await A.lireCompte(mg.id)).abonnement.actif, (await A.lireCompte(mg.id)).abonnement.jusquAu.getTime() / 1000 <= T + 60], [false, true]);
    const mg3 = await A.compteConnecte(); const metaM3 = { compteId: String(mg3.id), offre: 'pro', periode: 'mois' };
    await A.livrer(srv.url, A.evenement('customer.subscription.updated', A.sub({ id: 'sub_m3', client: 'cus_m3', statut: 'past_due', fin: finM, metadata: metaM3 }), T));
    H.v('   impayé : la grâce reste de 3 jours, sans la marge', (await A.lireCompte(mg3.id)).abonnement.jusquAu.getTime() / 1000, Math.min(finM, T + 3 * JOUR));

    // ── 12 ter. I1 : DEUX ABONNEMENTS VIVANTS — le Pro tient tant qu'AU MOINS UN est vivant ──
    logs.length = 0;
    const d = await A.compteConnecte(); const metaD = { compteId: String(d.id), offre: 'pro', periode: 'mois' };
    const finD1 = T + 10 * JOUR, finD2 = T + 20 * JOUR;
    await A.livrer(srv.url, A.evenement('customer.subscription.created', A.sub({ id: 'sub_d1', client: 'cus_d', statut: 'active', fin: finD1, created: T - 100, metadata: metaD }), T));
    await A.livrer(srv.url, A.evenement('customer.subscription.created', A.sub({ id: 'sub_d2', client: 'cus_d', statut: 'active', fin: finD2, created: T - 50, metadata: metaD }), T + 1));
    H.v('deux abonnements vivants pour un compte : Pro jusqu\'au plus tardif, DOUBLON signalé', [(await A.lireCompte(d.id)).abonnement.actif, (await A.lireCompte(d.id)).abonnement.jusquAu.getTime() / 1000, logs.some(l => l.includes('double-abonnement'))], [true, finD2 + A.MARGE_S, true]);
    await A.livrer(srv.url, A.evenement('customer.subscription.deleted', A.sub({ id: 'sub_d2', client: 'cus_d', statut: 'canceled', fin: finD2, endedAt: T + 5, created: T - 50, metadata: metaD }), T + 5));
    const cd = await A.lireCompte(d.id);
    H.v('   résilier le plus récent NE coupe PAS le Pro que l\'autre paie (jusquAu = celui du premier)', [cd.abonnement.actif, cd.abonnement.jusquAu.getTime() / 1000, cd.abonnement.stripe.sid], [true, finD1 + A.MARGE_S, 'sub_d1']);
    await A.livrer(srv.url, A.evenement('customer.subscription.deleted', A.sub({ id: 'sub_d1', client: 'cus_d', statut: 'canceled', fin: finD1, endedAt: T + 9, created: T - 100, metadata: metaD }), T + 9));
    H.v('   les deux résiliés : plus de Pro', (await A.lireCompte(d.id)).abonnement.actif, false);
    // l'ordre d'arrivée ne change rien : le plus récent d'abord, le plus ancien ensuite
    const d3 = await A.compteConnecte(); const metaD3 = { compteId: String(d3.id), offre: 'pro', periode: 'mois' };
    await A.livrer(srv.url, A.evenement('customer.subscription.created', A.sub({ id: 'sub_e2', client: 'cus_e', statut: 'active', fin: finD2, created: T - 50, metadata: metaD3 }), T));
    await A.livrer(srv.url, A.evenement('customer.subscription.created', A.sub({ id: 'sub_e1', client: 'cus_e', statut: 'active', fin: finD1, created: T - 100, metadata: metaD3 }), T + 1));
    await A.livrer(srv.url, A.evenement('customer.subscription.deleted', A.sub({ id: 'sub_e2', client: 'cus_e', statut: 'canceled', fin: finD2, endedAt: T + 5, created: T - 50, metadata: metaD3 }), T + 5));
    H.v('   dans l\'autre ordre d\'arrivée : même résultat (Pro porté par le survivant)', [(await A.lireCompte(d3.id)).abonnement.actif, (await A.lireCompte(d3.id)).abonnement.jusquAu.getTime() / 1000], [true, finD1 + A.MARGE_S]);

    // ── 12 quater. C1 (défense en profondeur) : un abonnement qui passe au prix Fondateurs SANS place prise n'accorde rien de plus ──
    logs.length = 0;
    const c = await A.compteConnecte(); const metaC = { compteId: String(c.id), offre: 'pro', periode: 'mois' };
    await A.livrer(srv.url, A.evenement('customer.subscription.created', A.sub({ id: 'sub_c', client: 'cus_c', statut: 'active', fin, metadata: metaC }), T));
    const passage = A.evenement('customer.subscription.updated', A.sub({ id: 'sub_c', client: 'cus_c', statut: 'active', prixId: A.PRIX.fondMois, fin, metadata: metaC }), T + 10);
    await A.livrer(srv.url, passage);
    const cc = await A.lireCompte(c.id);
    H.v('Pro qui passe au prix Fondateurs sans place : il reste sur ce que sa place permet (offre pro), AUCUNE place prise, signalé', [cc.abonnement.stripe.offre, cc.abonnement.actif, await db.col('abo_places').countDocuments({ compteId: c.id }), logs.some(l => l.includes('fondateurs-sans-place'))], ['pro', true, 0, true]);
    const c2 = await A.compteConnecte(); const metaC2 = { compteId: String(c2.id), offre: 'fondateurs', periode: 'mois' };
    await A.livrer(srv.url, A.evenement('customer.subscription.created', A.sub({ id: 'sub_c2', client: 'cus_c2', statut: 'active', prixId: A.PRIX.fondMois, fin, metadata: metaC2 }), T));
    H.v('   un NOUVEL abonnement au prix Fondateurs sans place : aucun droit, aucune place', [(await A.lireCompte(c2.id)).abonnement.actif, await db.col('abo_places').countDocuments({ compteId: c2.id })], [false, 0]);
    const c3 = await A.compteConnecte(); const metaC3 = { compteId: String(c3.id), offre: 'fondateurs', periode: 'mois' };
    await A.placePrise(c3.id);
    await A.livrer(srv.url, A.evenement('customer.subscription.created', A.sub({ id: 'sub_c3', client: 'cus_c3', statut: 'active', prixId: A.PRIX.fondMois, fin, metadata: metaC3 }), T));
    H.v('   avec une place prise par ce compte : l\'abonnement Fondateurs est reconnu', [(await A.lireCompte(c3.id)).abonnement.actif, (await A.lireCompte(c3.id)).abonnement.stripe.offre], [true, 'fondateurs']);

    // ── 13. LA ROUTE EST ÉTEINTE sans le drapeau, et le webhook refuse quand la configuration est incomplète ──
    const cfgEteint = A.cfgAbo({ V2_ABONNEMENTS: '' });
    const srvOff = await A.serveur(cfgEteint);
    H.v('V2_ABONNEMENTS absent : la route de webhook n\'existe pas (404)', (await A.livrer(srvOff.url, e0)).statut, 404);
    const cfgIncomplet = A.cfgAbo({ V2_STRIPE_WEBHOOK_SECRET: '' });
    H.v('   configuration incomplète : pret false, secret et clé nommés par leurs variables seulement', [cfgIncomplet.abonnements.pret, cfgIncomplet.abonnements.manquantes], [false, ['V2_STRIPE_WEBHOOK_SECRET']]);
    const srvInc = await A.serveur(cfgIncomplet);
    H.v('   le webhook d\'une configuration incomplète répond 503 (Stripe réessaiera), sans rien écrire', [(await A.livrer(srvInc.url, A.evenement('invoice.paid', { id: 'in_z', customer: 'cus_u', amount_paid: 1 }, T))).statut, await reg().countDocuments({ type: 'invoice.paid' })], [503, 1]);
    await srvOff.fermer(); await srvInc.fermer(); await srv.fermer();
    H.v('dans tous les journaux du banc : aucune valeur de clé ni de secret', logs.some(l => l.includes('sk_test_BANC') || l.includes('whsec_')), false);
    Cl.debrancher(); console.error = errOrig;
    await H.fermerBac(); H.bilan();
})().catch(e => { console.error = errOrig; console.error('❌', e); process.exit(1); });
