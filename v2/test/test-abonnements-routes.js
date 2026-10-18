'use strict';
// STRIPE-V2 — les trois routes du site : checkout, portail, statut. Identité, origine, plafonds, erreurs au format du contrat, aucun identifiant Stripe brut dans les réponses,
// CGV TOUJOURS exigées, l'essai UNE fois, le code Fondateurs et ses places (atomiques), le parrainage. Faux Stripe en mémoire.
const H = require('./_harnais'); const db = require('../db'); const M = require('../modeles');
const A = require('./_aide-abonnements'); const { creerFauxStripe } = require('./_faux-stripe');
const Cl = require('../abonnements/client');
const logs = []; const errOrig = console.error; console.error = (...a) => { logs.push(a.join(' ')); };

// chaque appel du banc est consigné « MÉTHODE chemin statut » : le bilan final exige que chaque statut documenté pour ces routes ait été JOUÉ (ou soit déclaré non joué avec sa raison)
const joues = new Set(); const appelOrigine = H.appel;
H.appel = async (url, chemin, o = {}) => { const r = await appelOrigine(url, chemin, o); joues.add(`${o.methode || 'GET'} ${chemin} ${r.statut}`); return r; };

(async () => {
    await H.ouvrirBac('test-abonnements-routes.js'); await M.creerIndex();
    const faux = creerFauxStripe(); Cl.brancher(faux);
    const cfg = A.cfgAbo();
    const srv = await A.serveur(cfg);
    const post = (chemin, u, corps, entetes = {}) => H.appel(srv.url, chemin, { methode: 'POST', corps, entetes: { ...A.SITE, ...(u ? { cookie: u.cookie } : {}), ...entetes } });
    const checkout = (u, corps, entetes) => post('/api/abonnement/checkout', u, corps, entetes);
    const dernier = () => faux.E.appels.filter(x => x.nom === 'checkout.sessions.create').at(-1);
    const FORME_ERREUR = r => r.json && r.json.success === false && typeof r.json.erreur.code === 'string' && r.json.facturation === null;
    const IDENTIFIANT_STRIPE = /\b(sub|cus|price|cs_test|cs_live|bpc|evt|in|pi|pm|prod|whsec|sk_test|sk_live|rk_live)_[A-Za-z0-9]/;

    // ── 1. IDENTITÉ : session, origine, compte vérifié ──
    const u = await A.compteConnecte();
    const sansCookie = await H.appel(srv.url, '/api/abonnement/checkout', { methode: 'POST', corps: { offre: 'pro', periode: 'mois' }, entetes: A.SITE });
    H.v('sans cookie de session : 401 SESSION, au format du contrat', [sansCookie.statut, sansCookie.json.erreur.code, FORME_ERREUR(sansCookie)], [401, 'SESSION', true]);
    H.v('   le refus porte les en-têtes CORS du site (origine exacte) et ceux de sécurité', [sansCookie.entetes['access-control-allow-origin'], sansCookie.entetes['access-control-allow-credentials'], sansCookie.entetes['x-content-type-options']], ['https://rat-market.fr', 'true', 'nosniff']);
    const pre = await H.appel(srv.url, '/api/abonnement/checkout', { methode: 'OPTIONS', entetes: { origin: 'https://rat-market.fr', 'access-control-request-method': 'POST' } });
    H.v('   le préflight du site sur /api/abonnement/checkout : 204, origine exacte, cookies permis, X-Rat-Market permis', [pre.statut, pre.entetes['access-control-allow-origin'], pre.entetes['access-control-allow-credentials'], (pre.entetes['access-control-allow-headers'] || '').includes('X-Rat-Market')], [204, 'https://rat-market.fr', 'true', true]);
    const preAutre = await H.appel(srv.url, '/api/abonnement', { methode: 'OPTIONS', entetes: { origin: 'https://autre.exemple', 'access-control-request-method': 'GET' } });
    H.v('   une autre origine : aucun en-tête CORS du site', preAutre.entetes['access-control-allow-origin'], undefined);
    const sansOrigine = await H.appel(srv.url, '/api/abonnement/checkout', { methode: 'POST', corps: { offre: 'pro', periode: 'mois' }, entetes: { cookie: u.cookie } });
    H.v('avec le cookie mais sans l\'origine du site : 403 ORIGINE', [sansOrigine.statut, sansOrigine.json.erreur.code], [403, 'ORIGINE']);
    const mauvaiseOrigine = await H.appel(srv.url, '/api/abonnement/checkout', { methode: 'POST', corps: { offre: 'pro', periode: 'mois' }, entetes: { cookie: u.cookie, origin: 'https://autre.exemple', 'x-rat-market': '1' } });
    H.v('   depuis une autre origine : 403 ORIGINE', mauvaiseOrigine.statut, 403);
    const nonVerifie = await A.compteConnecte({ verifie: false });
    H.v('compte NON vérifié (même avec une session) : 401, aucune session de paiement', [(await checkout(nonVerifie, { offre: 'pro', periode: 'mois' })).statut, faux.E.sessions.size], [401, 0]);
    for (const [chemin, m] of [['/api/abonnement', 'GET'], ['/api/abonnement/portail', 'POST']]) {
        const r = await H.appel(srv.url, chemin, { methode: m, corps: m === 'POST' ? {} : undefined, entetes: A.SITE });
        H.v(`${m} ${chemin} sans session : 401`, r.statut, 401);
    }

    // ── 2. LE CHECKOUT PRO : ce que Stripe reçoit ──
    const tranche0 = Math.floor(Date.now() / 600000);
    const r1 = await checkout(u, { offre: 'pro', periode: 'mois' });
    const p1 = dernier().params;
    const r1bis = await checkout(u, { offre: 'pro', periode: 'mois' });
    H.v('un second clic dans la même tranche de 10 minutes : 200 et la MÊME session (mêmes paramètres : Stripe accepte la clé d\'idempotence rejouée)', [r1bis.statut, tranche0 !== Math.floor(Date.now() / 600000) || r1bis.json.url === r1.json.url], [200, true]);
    H.v('   la fin de session est calée sur la tranche : entre 60 et 70 minutes', [p1.expires_at - Math.floor(Date.now() / 1000) >= 3590, p1.expires_at - Math.floor(Date.now() / 1000) <= 4200], [true, true]);
    H.v('Pro mensuel : 200 et une adresse de paiement (rien d\'autre)', [r1.statut, Object.keys(r1.json).sort(), /^https:\/\/checkout\.stripe\.test\//.test(r1.json.url)], [200, ['success', 'url'], true]);
    H.v('   mode subscription, le prix de la configuration, une quantité, le compte pour référence', [p1.mode, p1.line_items, p1.client_reference_id], ['subscription', [{ price: A.PRIX.proMois, quantity: 1 }], String(u.id)]);
    H.v('   les CGV exigées (consent_collection[terms_of_service]=required)', p1.consent_collection, { terms_of_service: 'required' });
    H.v('   essai de 14 jours, carte exigée, aucun code promotionnel libre', [p1.subscription_data.trial_period_days, p1.payment_method_collection, p1.allow_promotion_codes, p1.subscription_data.trial_settings.end_behavior.missing_payment_method], [14, 'always', false, 'cancel']);
    H.v('   retours : le site, succès et abandon', [p1.success_url, p1.cancel_url], ['https://rat-market.fr/fr/compte?abonnement=succes', 'https://rat-market.fr/fr/tarifs?abonnement=annule']);
    H.v('   métadonnées sur la session ET l\'abonnement (le webhook s\'en sert)', [p1.metadata, p1.subscription_data.metadata], [{ compteId: String(u.id), offre: 'pro', periode: 'mois' }, { compteId: String(u.id), offre: 'pro', periode: 'mois' }]);
    const c1 = await A.lireCompte(u.id);
    const clientDe = faux.E.appels.filter(x => x.nom === 'customers.create');
    H.v('un client Stripe créé et lié au compte, avec une clé d\'idempotence', [clientDe.length, c1.stripeClient === p1.customer, clientDe[0].opts.idempotencyKey], [1, true, `cust-${u.id}`]);
    await checkout(u, { offre: 'pro', periode: 'an' });
    H.v('   une seconde session (annuelle) réutilise le MÊME client : toujours un seul client créé', [faux.E.appels.filter(x => x.nom === 'customers.create').length, dernier().params.customer === c1.stripeClient, dernier().params.line_items[0].price], [1, true, A.PRIX.proAn]);
    for (const [offre, periode] of [['pro', 'mois'], ['pro', 'an']]) { const x = await A.compteConnecte(); await checkout(x, { offre, periode }); H.v(`   CGV exigées aussi pour ${offre}/${periode}`, dernier().params.consent_collection.terms_of_service, 'required'); }
    H.v('   aucun identifiant Stripe brut dans la réponse (l\'adresse de paiement elle-même mise à part : c\'est ce que le site ouvre)', IDENTIFIANT_STRIPE.test(JSON.stringify({ ...r1.json, url: null })), false);

    // ── 3. ENTRÉES REFUSÉES ──
    const refus = async (nom, corps, statut, detail) => { const avant = faux.E.sessions.size; const r = await checkout(u, corps); H.v(`refus : ${nom}`, [r.statut, r.json && r.json.erreur && r.json.erreur.detail, FORME_ERREUR(r), faux.E.sessions.size - avant], [statut, detail, true, 0]); };
    await refus('offre inconnue', { offre: 'gratuit', periode: 'mois' }, 400, 'offre-inconnue');
    await refus('période inconnue', { offre: 'pro', periode: 'semaine' }, 400, 'periode-inconnue');
    await refus('champ inconnu (un prix imposé par le client)', { offre: 'pro', periode: 'mois', prix: 'price_x' }, 400, 'champ-inconnu');
    await refus('retour vers un autre site', { offre: 'pro', periode: 'mois', retour: 'https://evil.exemple/' }, 400, 'retour-invalide');
    await refus('retour protocole-relatif', { offre: 'pro', periode: 'mois', retour: '//evil.exemple' }, 400, 'retour-invalide');
    await refus('retour avec des points', { offre: 'pro', periode: 'mois', retour: '/fr/../admin' }, 400, 'retour-invalide');
    await refus('code trop long', { offre: 'pro', periode: 'mois', code: 'x'.repeat(65) }, 422, 'code-invalide');
    const tab = await checkout(u, [1, 2]);
    H.v('   corps tableau : 400', tab.statut, 400);
    const retourOk = await checkout(await A.compteConnecte(), { offre: 'pro', periode: 'mois', retour: '/fr/tarifs' });
    H.v('un retour du site (/fr/…) est accepté', [retourOk.statut, dernier().params.success_url, dernier().params.cancel_url], [200, 'https://rat-market.fr/fr/tarifs?abonnement=succes', 'https://rat-market.fr/fr/tarifs?abonnement=annule']);

    // ── 4. L'ESSAI UNE SEULE FOIS PAR COMPTE ──
    const dejaEssai = await A.compteConnecte({ 'abonnement': { actif: false, quotaMensuel: 0, moisCle: null, restant: 0, jusquAu: null, stripe: { essaiUtilise: true, sid: 'sub_vieux', statut: 'canceled', version: 1 } } });
    await checkout(dejaEssai, { offre: 'pro', periode: 'mois' });
    H.v('un compte qui a déjà eu un essai : AUCUN essai (pas de trial_period_days)', [dernier().params.subscription_data.trial_period_days, Object.keys(dernier().params.subscription_data).sort()], [undefined, ['metadata']]);
    const histo = await A.compteConnecte();
    const clH = await faux.customers.create({ email: 'h@exemple.fr' }); await db.col('comptes').updateOne({ _id: histo.id }, { $set: { stripeClient: clH.id } });
    await faux.subscriptions.create({ customer: clH.id, items: [{ price: A.PRIX.proMois }], trial_period_days: 14, metadata: { compteId: String(histo.id) } });
    faux.sub([...faux.E.subs.keys()].at(-1)).status = 'canceled';
    await checkout(histo, { offre: 'pro', periode: 'mois' });
    H.v('un compte dont le client Stripe a un abonnement passé (la base ne le sait pas) : aucun essai non plus', dernier().params.subscription_data.trial_period_days, undefined);

    // ── 5. DÉJÀ ABONNÉ : pas de second abonnement ──
    const abonne = await A.compteConnecte({ 'abonnement': { actif: true, quotaMensuel: 0, moisCle: null, restant: 0, jusquAu: new Date(Date.now() + 86400e3), stripe: { sid: 'sub_vivant', statut: 'active', version: 1, offre: 'pro', periode: 'mois' } } });
    const avantS = faux.E.sessions.size;
    const rAb = await checkout(abonne, { offre: 'pro', periode: 'an' });
    H.v('un compte déjà abonné : 409 CONFLIT « deja-abonne », aucune session', [rAb.statut, rAb.json.erreur.code, rAb.json.erreur.detail, faux.E.sessions.size - avantS], [409, 'CONFLIT', 'deja-abonne', 0]);
    const chezStripe = await A.compteConnecte(); const clS = await faux.customers.create({}); await db.col('comptes').updateOne({ _id: chezStripe.id }, { $set: { stripeClient: clS.id } });
    await faux.subscriptions.create({ customer: clS.id, items: [{ price: A.PRIX.proMois }], metadata: {}, default_payment_method: 'pm_card_visa' });
    H.v('   abonnement vivant connu de Stripe seulement (webhook pas encore reçu) : refusé aussi', (await checkout(chezStripe, { offre: 'pro', periode: 'mois' })).json.erreur.detail, 'deja-abonne');

    // ── 6. FONDATEURS : le code, les places atomiques ──
    const f1 = await A.compteConnecte();
    const mauvais = await checkout(f1, { offre: 'fondateurs', periode: 'mois', code: 'PAS-LE-BON' });
    H.v('Fondateurs avec un mauvais code : 422, aucune place prise', [mauvais.statut, mauvais.json.erreur.detail, await db.col('abo_places').countDocuments({})], [422, 'code-invalide', 0]);
    const sansCode = await checkout(f1, { offre: 'fondateurs', periode: 'mois' });
    H.v('   sans code : 422 aussi', [sansCode.statut, sansCode.json.erreur.detail], [422, 'code-invalide']);
    const bon = await checkout(f1, { offre: 'fondateurs', periode: 'an', code: ` ${A.CODE_FONDATEURS.toLowerCase()} ` });
    H.v('   le bon code (casse et espaces tolérés) : session au prix Fondateurs annuel, 14 jours d\'essai, une place RÉSERVÉE', [bon.statut, dernier().params.line_items[0].price, dernier().params.subscription_data.trial_period_days, (await db.col('abo_places').findOne({ compteId: f1.id })).etat], [200, A.PRIX.fondAn, 14, 'reservee']);
    await checkout(f1, { offre: 'fondateurs', periode: 'mois', code: A.CODE_FONDATEURS });
    H.v('   le même compte qui recommence ne prend pas une seconde place', await db.col('abo_places').countDocuments({}), 1);
    // 10 comptes en même temps pour 3 places (2 restantes après f1) : exactement 2 de plus réussissent
    const dix = await Promise.all(Array.from({ length: 10 }, () => A.compteConnecte()));
    const rafale = await Promise.all(dix.map(x => checkout(x, { offre: 'fondateurs', periode: 'mois', code: A.CODE_FONDATEURS })));
    const places = await db.col('abo_places').find({}).toArray();
    H.v('10 acheteurs simultanés pour les 2 places restantes : exactement 2 réussissent, 8 reçoivent « places-epuisees »', [rafale.filter(r => r.statut === 200).length, rafale.filter(r => r.statut === 409 && r.json.erreur.detail === 'places-epuisees').length], [2, 8]);
    H.v('   3 places en base au total, toutes à des comptes différents, aucune au-delà', [places.length, new Set(places.map(p => String(p.compteId))).size, places.map(p => p._id).sort()], [3, 3, ['place:0', 'place:1', 'place:2']]);
    const refuse = await A.compteConnecte();
    H.v('   un code valide ne rouvre pas une place épuisée', (await checkout(refuse, { offre: 'fondateurs', periode: 'mois', code: A.CODE_FONDATEURS })).json.erreur.detail, 'places-epuisees');
    // une réservation EXPIRÉE se reprend
    const perimee = places.find(p => String(p.compteId) === String(f1.id));
    await db.col('abo_places').updateOne({ _id: perimee._id }, { $set: { expireLe: new Date(Date.now() - 1000) } });
    const reprise = await checkout(refuse, { offre: 'fondateurs', periode: 'mois', code: A.CODE_FONDATEURS });
    H.v('une réservation expirée libère sa place : le suivant la reprend, atomiquement', [reprise.statut, String((await db.col('abo_places').findOne({ _id: perimee._id })).compteId) === String(refuse.id)], [200, true]);
    // une place PRISE ne se reprend jamais
    await db.col('abo_places').updateOne({ compteId: refuse.id }, { $set: { etat: 'prise' }, $unset: { expireLe: '' } });
    const encore = await A.compteConnecte();
    H.v('   une place prise (abonnement confirmé) ne se reprend jamais', (await checkout(encore, { offre: 'fondateurs', periode: 'mois', code: A.CODE_FONDATEURS })).json.erreur.detail, 'places-epuisees');
    // panne de Stripe : la réservation est rendue
    await db.col('abo_places').deleteMany({}); faux.panneSur = 'checkout.sessions.create';
    const pan = await A.compteConnecte();
    const rPanne = await checkout(pan, { offre: 'fondateurs', periode: 'mois', code: A.CODE_FONDATEURS });
    H.v('Stripe en panne à la création de la session : 503 propre, la place réservée est RENDUE', [rPanne.statut, rPanne.json.erreur.code, await db.col('abo_places').countDocuments({})], [503, 'INDISPONIBLE', 0]);
    faux.panneSur = null;
    // l'offre fermée (pas de code configuré) est indiscernable d'un mauvais code
    const srvFerme = await A.serveur(A.cfgAbo({ V2_FONDATEURS_CODE: '' }));
    const ferme = await H.appel(srvFerme.url, '/api/abonnement/checkout', { methode: 'POST', corps: { offre: 'fondateurs', periode: 'mois', code: A.CODE_FONDATEURS }, entetes: { ...A.SITE, cookie: pan.cookie } });
    H.v('offre Fondateurs fermée (aucun code configuré) : 422 « code-invalide », comme un mauvais code', [ferme.statut, ferme.json.erreur.detail], [422, 'code-invalide']);
    await srvFerme.fermer();
    // le code ne se devine pas à la rafale : 10 essais par heure et par compte
    const brute = await A.compteConnecte(); const codes = [];
    for (let i = 0; i < 12; i++) codes.push((await checkout(brute, { offre: 'fondateurs', periode: 'mois', code: `ESSAI-${i}` })).statut);
    H.v('essais de code : 10 par heure et par compte, puis 429', [codes.slice(0, 10).every(s => s === 422), codes.slice(10)], [true, [429, 429]]);

    // ── 7. PARRAINAGE ──
    const parrain = await A.compteConnecte();
    const st = await H.appel(srv.url, '/api/abonnement', { entetes: { cookie: parrain.cookie } });
    const code = st.json.parrainage.code;
    H.v('le parrain lit son code (8 caractères sans ambiguïté), stable d\'un appel à l\'autre', [/^[A-HJKMNP-Z2-9]{8}$/.test(code), (await H.appel(srv.url, '/api/abonnement', { entetes: { cookie: parrain.cookie } })).json.parrainage.code === code, st.json.parrainage.essaiFilleulJours], [true, true, 30]);
    const filleul = await A.compteConnecte();
    const rF = await checkout(filleul, { offre: 'pro', periode: 'mois', code: code.toLowerCase() });
    H.v('un filleul NEUF avec le code : essai de 30 jours, le parrain dans les métadonnées', [rF.statut, dernier().params.subscription_data.trial_period_days, dernier().params.subscription_data.metadata.parrain], [200, 30, String(parrain.id)]);
    const soi = await checkout(parrain, { offre: 'pro', periode: 'mois', code });
    H.v('jamais de parrainage de soi-même', [soi.statut, soi.json.erreur.detail], [422, 'parrainage-non-eligible']);
    const avecClient = async (histoire) => { const x = await A.compteConnecte(); const cl = await faux.customers.create({}); await db.col('comptes').updateOne({ _id: x.id }, { $set: { stripeClient: cl.id } }); if (histoire) { const s = await faux.subscriptions.create({ customer: cl.id, items: [{ price: A.PRIX.proMois }], trial_period_days: 14, metadata: {} }); faux.sub(s.id).status = 'canceled'; } return x; };
    const clientSansHistoire = await checkout(await avecClient(false), { offre: 'pro', periode: 'mois', code });
    H.v('le filleul doit être un client NOUVEAU : avoir seulement OUVERT une page de paiement (un client Stripe, aucun abonnement) n\'est pas être un ancien client — 30 jours', [clientSansHistoire.statut, dernier().params.subscription_data.trial_period_days], [200, 30]);
    const clientAvecHistoire = await checkout(await avecClient(true), { offre: 'pro', periode: 'mois', code });
    H.v('   un client dont Stripe connaît un abonnement passé est refusé (la base ne le savait pas)', [clientAvecHistoire.statut, clientAvecHistoire.json.erreur.detail], [422, 'parrainage-non-eligible']);
    const inconnu = await checkout(await A.compteConnecte(), { offre: 'pro', periode: 'mois', code: 'ZZZZZZZZ' });
    H.v('un code inconnu : 422 « code-invalide »', [inconnu.statut, inconnu.json.erreur.detail], [422, 'code-invalide']);
    const avecEssai = await A.compteConnecte({ 'abonnement': { actif: false, quotaMensuel: 0, moisCle: null, restant: 0, jusquAu: null, stripe: { essaiUtilise: true } } });
    H.v('   un compte qui a déjà eu un essai : pas de parrainage non plus', (await checkout(avecEssai, { offre: 'pro', periode: 'mois', code })).json.erreur.detail, 'parrainage-non-eligible');

    // ── 8. LE PORTAIL ──
    const sansClient = await A.compteConnecte();
    const rP0 = await post('/api/abonnement/portail', sansClient, {});
    H.v('portail sans client Stripe : 409 « aucun-abonnement »', [rP0.statut, rP0.json.erreur.detail], [409, 'aucun-abonnement']);
    const rP = await post('/api/abonnement/portail', u, {});
    const pp = faux.E.appels.filter(x => x.nom === 'billingPortal.sessions.create').at(-1).params;
    H.v('portail d\'un client : une adresse, la configuration du portail de la configuration, retour au compte', [rP.statut, Object.keys(rP.json).sort(), pp.configuration, pp.return_url, pp.customer === (await A.lireCompte(u.id)).stripeClient], [200, ['success', 'url'], 'bpc_BANC', 'https://rat-market.fr/fr/compte', true]);
    H.v('   sans l\'origine du site : 403', (await H.appel(srv.url, '/api/abonnement/portail', { methode: 'POST', corps: {}, entetes: { cookie: u.cookie } })).statut, 403);

    // ── 9. LE STATUT : des états, jamais d'identifiant Stripe ──
    const s0 = await H.appel(srv.url, '/api/abonnement', { entetes: { cookie: sansClient.cookie } });
    H.v('statut d\'un compte sans abonnement', [s0.statut, s0.json.abonnement, s0.json.quota.nom, s0.entetes['cache-control']], [200, { actif: false, plan: null, periode: null, statut: 'aucun', finPeriode: null, resiliationPrevue: false, essai: { enCours: false, finLe: null, disponible: true }, paiementEchoue: false }, 'gratuit', 'no-store']);
    const fin = Math.floor(Date.now() / 1000) + 10 * 86400;
    const suivre = async (statut, extra = {}) => {
        const x = await A.compteConnecte(); const meta = { compteId: String(x.id), offre: 'fondateurs', periode: 'an' };
        const e = A.evenement('customer.subscription.updated', A.sub({ id: `sub_${x.id}`, client: `cus_${x.id}`, statut, prixId: A.PRIX.fondAn, fin, trialEnd: statut === 'trialing' ? fin : null, metadata: meta, ...extra }), Math.floor(Date.now() / 1000));
        const r = await A.livrer(srv.url, e); if (r.statut !== 200) throw new Error(`livraison ${r.statut}`);
        return { x, s: (await H.appel(srv.url, '/api/abonnement', { entetes: { cookie: x.cookie } })).json };
    };
    const tr = await suivre('trialing');
    H.v('en essai : plan Fondateurs annuel, essai en cours avec sa fin, quota pro', [tr.s.abonnement.statut, tr.s.abonnement.plan, tr.s.abonnement.periode, tr.s.abonnement.actif, tr.s.abonnement.essai.enCours, tr.s.abonnement.essai.finLe === new Date(fin * 1000).toISOString(), tr.s.abonnement.essai.disponible, tr.s.quota.nom, tr.s.quota.restant], ['essai', 'fondateurs', 'an', true, true, true, false, 'pro', null]);
    const ac = await suivre('active', { cancelAtPeriodEnd: true });
    H.v('actif avec résiliation prévue', [ac.s.abonnement.statut, ac.s.abonnement.resiliationPrevue, ac.s.abonnement.finPeriode === new Date(fin * 1000).toISOString()], ['actif', true, true]);
    const im = await suivre('past_due');
    H.v('impayé (grâce en cours) : Pro maintenu, paiementEchoue vrai', [im.s.abonnement.statut, im.s.abonnement.actif, im.s.abonnement.paiementEchoue, im.s.quota.nom], ['impaye', true, true, 'pro']);
    const te = await suivre('canceled', { endedAt: Math.floor(Date.now() / 1000) - 5 });
    H.v('terminé : plus de Pro, quota gratuit', [te.s.abonnement.statut, te.s.abonnement.actif, te.s.quota.nom], ['termine', false, 'gratuit']);
    for (const s of [tr.s, ac.s, im.s, te.s, s0.json]) if (IDENTIFIANT_STRIPE.test(JSON.stringify(s))) H.vrai('un identifiant Stripe a fuité dans le statut : ' + JSON.stringify(s).slice(0, 80), false);
    H.vrai('aucun des statuts ne porte d\'identifiant Stripe brut (sub_, cus_, price_, evt_…)', true);

    // ── 9 bis. LES RÉPONSES RÉELLES VALIDENT CONTRE LE SCHÉMA PUBLIÉ (et le schéma sait refuser) ──
    const { valider } = require('../openapi/valider'); const doc = require('../openapi/openapi.v2.json');
    const ref = n => ({ $ref: `#/components/schemas/${n}` });
    const vs = (nom, corps, schema) => { const r = valider(corps, ref(schema), doc); H.vrai(`${nom} valide contre ${schema}${r.ok ? '' : ' : ' + JSON.stringify(r.erreurs.slice(0, 2))}`, r.ok); };
    vs('statut sans abonnement', s0.json, 'ReponseAbonnement'); vs('statut en essai', tr.s, 'ReponseAbonnement'); vs('statut actif résiliation', ac.s, 'ReponseAbonnement'); vs('statut impayé', im.s, 'ReponseAbonnement'); vs('statut terminé', te.s, 'ReponseAbonnement');
    vs('checkout 200', r1.json, 'ReponseUrlPaiement'); vs('portail 200', rP.json, 'ReponseUrlPaiement'); vs('refus 409 déjà abonné', rAb.json, 'ReponseErreur'); vs('refus 422 mauvais code', mauvais.json, 'ReponseErreur');    H.vrai('le schéma refuse un identifiant Stripe brut ajouté au statut', !valider({ ...s0.json, abonnement: { ...s0.json.abonnement, subscriptionId: 'sub_x' } }, ref('ReponseAbonnement'), doc).ok);
    H.vrai('   et un statut hors liste', !valider({ ...s0.json, abonnement: { ...s0.json.abonnement, statut: 'peut-etre' } }, ref('ReponseAbonnement'), doc).ok);

    // ── 9 ter. SUPPRIMER UN COMPTE NE LAISSE PAS UN ABONNEMENT FACTURER DANS LE VIDE ──
    const P = require('../comptes/mots-de-passe');
    const mdp = 'Un-mot-de-passe-solide-42';
    const lotsCompte = () => [require('../comptes/monter'), require('../argent/monter')];
    const srvC = await A.serveur(cfg, lotsCompte());
    const sup = async (u0, port = srvC) => H.appel(port.url, '/api/compte', { methode: 'DELETE', corps: { motDePasse: mdp }, entetes: { ...A.SITE, cookie: u0.cookie } });
    const compteMdp = async stripe => { const x = await A.compteConnecte({ motDePasse: await P.hacher(mdp), ...(stripe ? { abonnement: { actif: true, quotaMensuel: 0, moisCle: null, restant: 0, jusquAu: new Date(Date.now() + 86400e3), stripe } } : {}) }); return x; };
    const vivantS = await compteMdp({ sid: 'sub_v', statut: 'active', offre: 'pro', periode: 'mois', version: 1, resiliation: false });
    const rS = await sup(vivantS);
    H.v('compte avec un abonnement vivant : suppression refusée 409 CONFLIT « abonnement-actif », le compte est intact', [rS.statut, rS.json.erreur.code, rS.json.erreur.detail, Boolean(await A.lireCompte(vivantS.id))], [409, 'CONFLIT', 'abonnement-actif', true]);
    const resiliS = await compteMdp({ sid: 'sub_r', statut: 'active', offre: 'pro', periode: 'mois', version: 1, resiliation: true });
    H.v('   abonnement dont la résiliation est prévue (rien ne sera plus facturé) : la suppression passe', [(await sup(resiliS)).statut, Boolean(await A.lireCompte(resiliS.id))], [200, false]);
    const finiS = await compteMdp({ sid: 'sub_f', statut: 'canceled', offre: 'pro', periode: 'mois', version: 1, resiliation: false });
    H.v('   abonnement terminé : la suppression passe', (await sup(finiS)).statut, 200);
    const mauvaisMdp = await H.appel(srvC.url, '/api/compte', { methode: 'DELETE', corps: { motDePasse: 'faux' }, entetes: { ...A.SITE, cookie: (await compteMdp({ sid: 'sub_v2', statut: 'trialing', version: 1 })).cookie } });
    H.v('   le mot de passe reste vérifié AVANT : un mauvais mot de passe est 401, jamais l\'état de l\'abonnement', mauvaisMdp.statut, 401);
    const srvEteint = await A.serveur(A.cfgAbo({ V2_ABONNEMENTS: '' }), lotsCompte());
    const horsFlag = await compteMdp({ sid: 'sub_o', statut: 'active', offre: 'pro', periode: 'mois', version: 1 });
    H.v('   drapeau éteint : la suppression est celle d\'avant (aucun changement de comportement)', [(await sup(horsFlag, srvEteint)).statut, Boolean(await A.lireCompte(horsFlag.id))], [200, false]);
    await srvEteint.fermer(); await srvC.fermer();

    // ── 9 quater. LES INDEX : créés partout, exigés seulement quand les abonnements sont allumés ──
    H.v('rien ne manque quand tout est créé, avec ou sans les abonnements', [(await M.verifierIndex()).manquants, (await M.verifierIndex(true)).manquants], [[], []]);
    await db.col('comptes').dropIndex('comptes_stripeClient');
    H.v('index « stripeClient unique » absent : exigé (abonnements allumés), pas exigé sinon — déployer sans allumer ne ferme aucune route v2', [(await M.verifierIndex(true)).manquants, (await M.verifierIndex()).manquants], [['comptes.comptes_stripeClient'], []]);
    await M.creerIndex(['comptes']);
    H.v('   recréé par creerIndex', (await M.verifierIndex(true)).manquants, []);
    await db.col('comptes').updateOne({ _id: sansClient.id }, { $set: { stripeClient: 'cus_unique_1' } });
    let doublon = null; try { await db.col('comptes').updateOne({ _id: u.id }, { $set: { stripeClient: 'cus_unique_1' } }); } catch (e) { doublon = e.code; }
    H.v('   un client Stripe ne peut pas appartenir à deux comptes (index unique)', doublon, 11000);

    // ── 10. TOUT EST ÉTEINT SANS LE DRAPEAU ──
    const srvOff = await A.serveur(A.cfgAbo({ V2_ABONNEMENTS: '' }));
    const off = await H.appel(srvOff.url, '/api/abonnement', { entetes: { cookie: u.cookie } });
    H.v('V2_ABONNEMENTS absent : les routes n\'existent pas (404 natif)', [off.statut, (await H.appel(srvOff.url, '/api/abonnement/checkout', { methode: 'POST', corps: {}, entetes: { ...A.SITE, cookie: u.cookie } })).statut], [404, 404]);
    await srvOff.fermer();
    const srvInc = await A.serveur(A.cfgAbo({ V2_STRIPE_PRIX_PRO_AN: '' }));
    const inc = await H.appel(srvInc.url, '/api/abonnement/checkout', { methode: 'POST', corps: { offre: 'pro', periode: 'mois' }, entetes: { ...A.SITE, cookie: u.cookie } });
    H.v('configuration incomplète : 503 INDISPONIBLE propre, rien chez Stripe', [inc.statut, inc.json.erreur.code, inc.json.erreur.detail], [503, 'INDISPONIBLE', 'abonnements-indisponibles']);
    const incP = await H.appel(srvInc.url, '/api/abonnement/portail', { methode: 'POST', corps: {}, entetes: { ...A.SITE, cookie: u.cookie } });
    H.v('   le portail aussi : 503 propre', [incP.statut, incP.json.erreur.detail], [503, 'abonnements-indisponibles']);
    await srvInc.fermer();
    // les plafonds horaires : le statut (réglable, V2_COMPTE_HEURE) et le portail (20 par heure et par compte)
    const srvLim = await A.serveur(A.cfgAbo({ V2_COMPTE_HEURE: '2' }));
    const lim = await A.compteConnecte(), g = [];
    for (let i = 0; i < 3; i++) g.push((await H.appel(srvLim.url, '/api/abonnement', { entetes: { cookie: lim.cookie } })).statut);
    H.v('statut : le plafond horaire par compte (2 en banc) puis 429 DEBIT avec Retry-After', [g, (await H.appel(srvLim.url, '/api/abonnement', { entetes: { cookie: lim.cookie } })).entetes['retry-after'] > 0], [[200, 200, 429], true]);
    await srvLim.fermer();
    const lim2 = await A.compteConnecte(), pl = [];
    for (let i = 0; i < 21; i++) pl.push((await post('/api/abonnement/portail', lim2, {})).statut);
    H.v('portail : 20 par heure et par compte (409 « aucun-abonnement » tant qu\'il n\'y a pas de client), puis 429', [pl.slice(0, 20).every(s => s === 409), pl[20]], [true, 429]);
    H.v('une clé Live sur un service « test » n\'allume rien (mode et clé doivent concorder)', [A.cfgAbo({ V2_STRIPE_CLE: 'sk_live_BANCfaux' }).abonnements.pret, A.cfgAbo({ V2_STRIPE_CLE: 'sk_live_BANCfaux' }).abonnements.invalides], [false, ['V2_STRIPE_CLE']]);
    H.v('aucune clé, aucun secret ni code dans les journaux du banc', logs.some(l => /sk_test_BANC|whsec_banc|FONDATEURS-BANC/i.test(l)), false);
    // ── COUVERTURE : chaque statut documenté pour les trois routes est joué par ce banc, ou déclaré non joué (test-contrat-reel.js ne juge pas ces routes : _contrat-reel-aide.js) ──
    const doc2 = require('../openapi/openapi.v2.json'), documentes = [];
    for (const [ch, ops] of Object.entries(doc2.paths)) for (const [m, op] of Object.entries(ops)) if ((op.tags || []).includes('abonnements')) for (const s of Object.keys(op.responses)) documentes.push(`${m.toUpperCase()} ${ch} ${s}`);
    const NON_JOUES = { 'GET /api/abonnement 503': 'ne naît que d\'une base injoignable en cours de requête (la route lit la base) : aucune panne de base n\'est fabriquée par ce banc' };
    console.log(`   statuts documentés pour les abonnements : ${documentes.length} ; joués ${documentes.filter(k => joues.has(k)).length} ; déclarés non joués ${Object.keys(NON_JOUES).length}`);
    H.v('chaque statut documenté pour /api/abonnement* est joué ou déclaré non joué', documentes.filter(k => !joues.has(k) && !(k in NON_JOUES)), []);
    H.v('   aucune déclaration « non joué » périmée', Object.keys(NON_JOUES).filter(k => joues.has(k)), []);
    H.vrai('   et le dénominateur est lu (3 routes, 18 statuts documentés ou plus)', documentes.length >= 18);
    await srv.fermer(); Cl.debrancher(); console.error = errOrig; H.appel = appelOrigine;
    await H.fermerBac(); H.bilan();
})().catch(e => { console.error = errOrig; console.error('❌', e); process.exit(1); });
