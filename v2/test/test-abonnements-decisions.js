'use strict';
// STRIPE-DECISIONS — l'essai de 14 jours SANS carte et sa garde contre les comptes multiples, le plafond du parrainage, l'offre Fondateurs réservée (jamais publique), les dates du statut.
// Faux Stripe en mémoire (aucun appel réseau), vrai webhook, vraies routes. Les mutations qui vérifient chaque garde sont dans v2/mesures/mutations-abonnements.js.
const fs = require('fs'), path = require('path');
const H = require('./_harnais'); const db = require('../db'); const M = require('../modeles');
const A = require('./_aide-abonnements'); const { creerFauxStripe, JOUR } = require('./_faux-stripe');
const Cl = require('../abonnements/client'); const Carte = require('../abonnements/carte'); const Essai = require('../abonnements/essai'); const Pr = require('../abonnements/primes'); const Pa = require('../abonnements/parrainage');
const Li = require('../installations/liaison'); const { emailCle, cleBoite } = require('../comptes/email-cle'); const { ObjectId } = require('mongoose').Types;
const logs = []; const errOrig = console.error; console.error = (...a) => { logs.push(a.join(' ')); };

(async () => {
    await H.ouvrirBac('test-abonnements-decisions.js'); await M.creerIndex();
    H.fixerHorlogeMilieu();
    const faux = creerFauxStripe({ clientsParHorloge: 3 }); Cl.brancher(faux); A.semerPrix(faux);
    const cfg = A.cfgAbo();
    const srv = await A.serveur(cfg);
    let nIp = 0; const ipN = () => { nIp++; return { 'x-forwarded-for': `10.7.${Math.floor(nIp / 250)}.${nIp % 250 + 1}` }; };
    const post = (chemin, u, corps, entetes = {}, url = srv.url) => H.appel(url, chemin, { methode: 'POST', corps, entetes: { ...A.SITE, ...ipN(), ...(u ? { cookie: u.cookie } : {}), ...entetes } });
    const checkout = (u, corps) => post('/api/abonnement/checkout', u, corps);
    const dernier = () => faux.E.appels.filter(x => x.nom === 'checkout.sessions.create').at(-1);
    const reponsesStatut = [];                       // toutes les réponses RÉELLES du statut : elles doivent toutes valider contre le schéma publié (fin du banc)
    const statut = async u => { const j = (await H.appel(srv.url, '/api/abonnement', { entetes: { cookie: u.cookie, ...ipN() } })).json; reponsesStatut.push(j); return j; };
    const file = []; faux.surEvenement = e => file.push(e);
    const vider = async () => { while (file.length) { const e = file.shift(); const r = await A.livrer(srv.url, e); if (r.statut !== 200) throw new Error(`livraison ${e.type} : ${r.statut} ${JSON.stringify(r.json)}`); } };
    const nouvelleHorloge = () => faux.testHelpers.testClocks.create({ frozen_time: Math.floor(Date.now() / 1000) });
    const avancer = async (h, jours) => { const c = await faux.testHelpers.testClocks.retrieve(h.id); await faux.testHelpers.testClocks.advance(h.id, { frozen_time: c.frozen_time + jours * JOUR }); await vider(); };
    const n = () => Math.random().toString(36).slice(2, 9);
    const compteMail = (email, extra = {}) => A.compteConnecte({ email, emailCle: emailCle(email), ...extra });
    // ce que fait le Checkout une fois la page remplie : un abonnement en essai, ici SANS moyen de paiement (ou avec, si `carte`)
    const abonner = async (compte, { jours = 14, prix = A.PRIX.proMois, offre = 'pro', periode = 'mois', carte = null, finSansCarte = 'cancel', parrain = null } = {}) => {
        const h = await nouvelleHorloge();
        // un compte passé par le Checkout a DÉJÀ son client Stripe (créé par la route) : c'est lui qui s'abonne, rattaché à l'horloge du scénario
        const deja = (await A.lireCompte(compte.id) || {}).stripeClient;
        const cu = deja ? faux.E.customers.get(deja) : await faux.customers.create({ email: 'x@exemple.fr', test_clock: h.id, metadata: { compteId: String(compte.id) } });
        if (deja) cu.test_clock = h.id;
        if (carte) await faux.customers.update(cu.id, { invoice_settings: { default_payment_method: carte } });
        const s = await faux.subscriptions.create({ customer: cu.id, items: [{ price: prix }], ...(jours ? { trial_period_days: jours } : {}), ...(finSansCarte && jours ? { trial_settings: { end_behavior: { missing_payment_method: finSansCarte } } } : {}),
            ...(carte ? { default_payment_method: carte } : {}), metadata: { compteId: String(compte.id), offre, periode, ...(parrain ? { parrain: String(parrain.id) } : {}) } });
        await vider(); return { h, cu, sid: s.id };
    };
    const essaisDocs = () => db.col('abo_essais').find({}).toArray();
    const essaiDe = async (id, ids) => (await db.col('abo_essais').find({ compteId: id }).toArray()).filter(d => !ids || ids.includes(d.genre));

    // ═══ 1. LE CHECKOUT : essai sans carte ═══
    const u1 = await compteMail(`jean${n()}@exemple.fr`);
    const r1 = await checkout(u1, { offre: 'pro', periode: 'mois' });
    const p1 = dernier().params;
    H.v('Checkout avec essai : la page de paiement ne demande AUCUNE carte (if_required), 14 jours, et la fin d\'essai sans moyen de paiement RÉSILIE (cancel)', [r1.statut, p1.payment_method_collection, p1.subscription_data.trial_period_days, p1.subscription_data.trial_settings.end_behavior.missing_payment_method], [200, 'if_required', 14, 'cancel']);
    const pasEssai = await compteMail(`dejavu${n()}@exemple.fr`, { abonnement: { actif: false, quotaMensuel: 0, moisCle: null, restant: 0, jusquAu: null, stripe: { essaiUtilise: true, sid: 'sub_vieux', statut: 'canceled', version: 1 } } });
    await checkout(pasEssai, { offre: 'pro', periode: 'an' });
    H.v('Checkout SANS essai : la carte est demandée (la première facture est due), pas de trial_settings', [dernier().params.payment_method_collection, dernier().params.subscription_data.trial_period_days, dernier().params.subscription_data.trial_settings], ['if_required', undefined, undefined]);
    const st0 = await statut(pasEssai);
    H.v('   le statut dit essai.disponible false et NOMME le refus (essai-deja-utilise)', [st0.abonnement.essai.disponible, st0.abonnement.essai.refus], [false, 'essai-deja-utilise']);
    H.v('un compte neuf : essai.disponible true, aucun refus', [(await statut(await compteMail(`neuf${n()}@exemple.fr`))).abonnement.essai.disponible, (await statut(u1)).abonnement.essai.refus], [true, null]);

    // ═══ 2. LA GARDE : UNE BOÎTE, UN ESSAI ═══
    H.v('la clé de boîte : a+x@ et a@ sont une boîte ; les points et le + de Gmail aussi ; deux boîtes différentes restent deux', [cleBoite(emailCle('Jean+x@exemple.fr')) === cleBoite(emailCle('jean@exemple.fr')), cleBoite(emailCle('a.b+c@gmail.com')) === cleBoite(emailCle('ab@googlemail.com')), cleBoite(emailCle('jean@exemple.fr')) === cleBoite(emailCle('jeanne@exemple.fr'))], [true, true, false]);
    const local = `boite${n()}`;
    const A1 = await compteMail(`${local}@exemple.fr`), A2 = await compteMail(`${local}+promo@exemple.fr`);
    await checkout(A1, { offre: 'pro', periode: 'mois' });
    H.v('premier compte de la boîte : essai de 14 jours, réservation posée (boîte seulement : aucune installation)', [dernier().params.subscription_data.trial_period_days, (await essaiDe(A1.id)).map(d => [d.genre, d.etat])], [14, [['boite', 'reserve']]]);
    const r2 = await checkout(A2, { offre: 'pro', periode: 'an' });
    H.v('   un AUTRE compte de la MÊME boîte (+promo) : l\'abonnement n\'est PAS refusé (200), mais part SANS essai', [r2.statut, dernier().params.subscription_data.trial_period_days, dernier().params.line_items[0].price], [200, undefined, A.PRIX.proAn]);
    const sA2 = await statut(A2);
    H.v('   son statut : essai.disponible false, refus « boite-deja-utilisee »', [sA2.abonnement.essai.disponible, sA2.abonnement.essai.refus], [false, 'boite-deja-utilisee']);
    await checkout(A1, { offre: 'pro', periode: 'mois' });
    H.v('   le premier compte qui recommence (même tranche, ou un autre clic) garde SON essai', [dernier().params.subscription_data.trial_period_days, (await essaiDe(A1.id)).length], [14, 1]);
    // le webhook confirme l'essai : la réservation devient définitive (rétention = cfg.empreinte.jours)
    await abonner(A1);
    const dB = (await essaiDe(A1.id))[0];
    H.v('   le webhook (l\'essai existe) : la ligne devient « pris », avec une expiration à la durée de rétention', [dB.etat, Math.round((dB.expireLe.getTime() - Date.now()) / JOUR / 1000)], ['pris', cfg.empreinte.jours]);
    await db.col('comptes').deleteOne({ _id: A1.id });
    await checkout(A2, { offre: 'pro', periode: 'mois' });
    H.v('   le compte du premier est SUPPRIMÉ : le registre survit, la boîte reste prise (pas de nouvel essai pour A+promo)', dernier().params.subscription_data.trial_period_days, undefined);
    await db.col('abo_essais').updateOne({ _id: dB._id }, { $set: { expireLe: new Date(Date.now() - 1000) } });
    await checkout(A2, { offre: 'pro', periode: 'mois' });
    H.v('   passée la rétention (ligne expirée), la boîte est de nouveau libre : l\'essai est accordé', [dernier().params.subscription_data.trial_period_days, (await db.col('abo_essais').findOne({ _id: dB._id })).compteId.equals(A2.id)], [14, true]);
    const contenu = JSON.stringify(await essaisDocs());
    H.v('le registre ne porte AUCUNE adresse ni identifiant d\'installation en clair : seulement des HMAC de 64 caractères hexadécimaux', [(await essaisDocs()).every(d => /^(boite|installation):[0-9a-f]{64}$/.test(d._id)), contenu.includes('exemple.fr'), contenu.includes(local)], [true, false, false]);

    // ═══ 3. LA GARDE : UN ESSAI PAR INSTALLATION ═══
    const cA = A.cfgAbo();
    const argentFaux = { fusionnerALaLiaison: async () => ({ ok: true }) };
    const nouvelleInstallation = async () => { const i = M.nouvelleInstallation({ jetonEmpreinte: `e${n()}${n()}`, essais: 0, libelle: 'banc' }); await db.col('installations').insertOne(i); return i; };
    const lier = async (compte, installation) => { const code = await Li.creerCode(compte.id, cA); const r = await Li.lier({ installation: await db.col('installations').findOne({ _id: installation._id }), code: code.code, argent: argentFaux, cfg: cA }); if (!r.ok) throw new Error(`liaison : ${r.code}`); };
    const inst = await nouvelleInstallation();
    const C = await compteMail(`inst${n()}@exemple.fr`), D = await compteMail(`autre${n()}@exemple.fr`), E = await compteMail(`sans${n()}@exemple.fr`);
    await lier(C, inst);
    H.v('la liaison laisse une trace durable (comptesLies) : l\'installation a été liée à C', ((await db.col('installations').findOne({ _id: inst._id })).comptesLies || []).map(String), [String(C.id)]);
    await checkout(C, { offre: 'pro', periode: 'mois' });
    H.v('C (installation liée) : essai accordé, réservations de la boîte ET de l\'installation', [dernier().params.subscription_data.trial_period_days, (await essaiDe(C.id)).map(d => d.genre).sort()], [14, ['boite', 'installation']]);
    await abonner(C);
    H.v('   l\'essai de C existe (webhook) : les deux lignes sont « pris »', (await essaiDe(C.id)).map(d => d.etat), ['pris', 'pris']);
    await Li.delier(await db.col('installations').findOne({ _id: inst._id }));
    await lier(D, inst);
    H.v('   l\'installation est déliée de C puis liée à D : elle garde la trace des DEUX', ((await db.col('installations').findOne({ _id: inst._id })).comptesLies || []).map(String).sort(), [String(C.id), String(D.id)].sort());
    await checkout(D, { offre: 'pro', periode: 'mois' });
    H.v('D (autre boîte, MÊME installation qui a déjà servi un essai) : l\'abonnement n\'est pas refusé, mais sans essai', [dernier().params.subscription_data.trial_period_days, dernier().params.payment_method_collection], [undefined, 'if_required']);
    H.v('   statut de D : refus « installation-deja-utilisee »', (await statut(D)).abonnement.essai.refus, 'installation-deja-utilisee');
    await Li.delier(await db.col('installations').findOne({ _id: inst._id }));
    await checkout(D, { offre: 'pro', periode: 'an' });
    H.v('   même si l\'installation n\'est plus liée à personne : D l\'a été, elle reste comptée', dernier().params.subscription_data.trial_period_days, undefined);
    await checkout(E, { offre: 'pro', periode: 'mois' });
    H.v('E (aucune installation) : la condition ne s\'applique pas, l\'essai est accordé', [dernier().params.subscription_data.trial_period_days, (await essaiDe(E.id)).map(d => d.genre)], [14, ['boite']]);
    // une liaison DÉFAITE (fusion en échec) ne laisse aucune trace
    const inst2 = await nouvelleInstallation(); const G0 = await compteMail(`defait${n()}@exemple.fr`);
    const codeG = await Li.creerCode(G0.id, cA);
    const rDefait = await Li.lier({ installation: inst2, code: codeG.code, argent: { fusionnerALaLiaison: async () => ({ ok: false, raison: 'x' }) } });
    H.v('une liaison défaite (fusion refusée) ne laisse AUCUNE trace dans comptesLies', [rDefait.statut, ((await db.col('installations').findOne({ _id: inst2._id })).comptesLies || []).length], [503, 0]);

    // ═══ 4. LA GARDE : LE DOMAINE JETABLE, REVÉRIFIÉ AU CHECKOUT ═══
    const dom = fs.readFileSync(path.join(__dirname, '..', 'comptes', 'domaines-jetables.txt'), 'utf8').split(/\r?\n/).find(l => l && !l.startsWith('#'));
    const J = await compteMail(`jetable${n()}@${dom}`);
    const rJ = await checkout(J, { offre: 'pro', periode: 'mois' });
    H.v('un compte créé AVANT une mise à jour de la liste (domaine devenu jetable) : l\'abonnement n\'est pas refusé, mais sans essai', [rJ.statut, dernier().params.subscription_data.trial_period_days], [200, undefined]);
    H.v('   statut : refus « domaine-jetable », et AUCUNE réservation écrite', [(await statut(J)).abonnement.essai.refus, (await essaiDe(J.id)).length], ['domaine-jetable', 0]);
    // un code de parrainage ne contourne pas la garde
    const parrainG = await compteMail(`parrain${n()}@exemple.fr`); const codeP = await Pa.codeDe(parrainG.id);
    const K = await compteMail(`${local}+bis@exemple.fr`);
    await db.col('abo_essais').updateOne({ compteId: A2.id, genre: 'boite' }, { $set: { expireLe: new Date(Date.now() + 3600e3), etat: 'pris' } });
    const rK = await checkout(K, { offre: 'pro', periode: 'mois', code: codeP });
    H.v('un code de parrainage ne contourne pas la garde : la boîte est prise → 422 parrainage-non-eligible, aucune session', [rK.statut, rK.json.erreur.detail], [422, 'parrainage-non-eligible']);
    const L = await compteMail(`filleul${n()}@exemple.fr`);
    await checkout(L, { offre: 'pro', periode: 'mois', code: codeP });
    H.v('   un filleul neuf : 30 jours d\'essai, toujours sans carte', [dernier().params.subscription_data.trial_period_days, dernier().params.payment_method_collection], [30, 'if_required']);
    // Stripe en panne à la création : les réservations sont rendues
    faux.panneSur = 'checkout.sessions.create';
    const P0 = await compteMail(`panne${n()}@exemple.fr`);
    const rP = await checkout(P0, { offre: 'pro', periode: 'mois' });
    faux.panneSur = null;
    H.v('Stripe en panne à la création de la session : 503, les réservations de l\'essai sont RENDUES (rien ne reste verrouillé)', [rP.statut, (await essaiDe(P0.id)).length], [503, 0]);
    H.v('une réservation abandonnée expire seule (TTL sur expireLe) : l\'index existe', (await db.col('abo_essais').indexes()).some(i => i.name === 'abo_essais_ttl' && i.expireAfterSeconds === 0), true);
    // la concurrence : deux comptes de la même boîte au même instant — un seul essai
    const loc2 = `course${n()}`; const [X1, X2] = [await compteMail(`${loc2}@exemple.fr`), await compteMail(`${loc2}+b@exemple.fr`)];
    const course = await Promise.all([checkout(X1, { offre: 'pro', periode: 'mois' }), checkout(X2, { offre: 'pro', periode: 'mois' })]);
    const essaisCourse = faux.E.appels.filter(x => x.nom === 'checkout.sessions.create').slice(-2).map(x => x.params.subscription_data.trial_period_days);
    H.v('deux comptes de la même boîte au MÊME instant : exactement un essai (réservation atomique)', [course.map(r => r.statut), essaisCourse.filter(j => j === 14).length, essaisCourse.filter(j => j === undefined).length], [[200, 200], 1, 1]);

    // ═══ 5. LA FIN D'UN ESSAI SANS CARTE : RÉSILIATION, AUCUN PRÉLÈVEMENT ═══
    const S1 = await compteMail(`sanscarte${n()}@exemple.fr`);
    const ab1 = await abonner(S1);
    const e1 = await statut(S1);
    const sub1 = faux.sub(ab1.sid);
    H.v('essai sans carte en cours : Pro, statut essai, carte lue = false (jamais null quand Stripe répond)', [e1.abonnement.actif, e1.abonnement.statut, e1.abonnement.essai.enCours, e1.abonnement.essai.carteEnregistree], [true, 'essai', true, false]);
    H.v('   dates ISO UTC : début et fin de l\'essai (14 jours exacts), sous les anciens ET les nouveaux noms', [e1.abonnement.essai.debutLe === new Date(sub1.trialStart * 1000).toISOString(), e1.abonnement.essai.finLe === new Date(sub1.trialEnd * 1000).toISOString(), sub1.trialEnd - sub1.trialStart, e1.abonnement.debutEssai === e1.abonnement.essai.debutLe, e1.abonnement.finEssai === e1.abonnement.essai.finLe, e1.abonnement.essaiFinLe === e1.abonnement.essai.finLe], [true, true, 14 * JOUR, true, true, true]);
    H.v('   la fin est ANNONCÉE : resiliationPrevue, finPrevueLe = la fin de l\'essai ; aucun renouvellement (prochaineEcheance null)', [e1.abonnement.resiliationPrevue, e1.abonnement.finPrevueLe === e1.abonnement.essai.finLe, e1.abonnement.prochaineEcheance], [true, true, null]);
    H.v('   finDePeriode = finPeriode (ancien nom gardé en transition)', [e1.abonnement.finDePeriode === e1.abonnement.finPeriode, e1.abonnement.finPeriode === e1.abonnement.essai.finLe], [true, true]);
    await avancer(ab1.h, 15);
    const e1b = await statut(S1), cS1 = await A.lireCompte(S1.id);
    H.v('J+14 : l\'abonnement est RÉSILIÉ (customer.subscription.deleted) — statut « termine », plus Pro, quota gratuit', [e1b.abonnement.statut, e1b.abonnement.actif, e1b.quota.offre, e1b.quota.nom, cS1.abonnement.actif, cS1.abonnement.stripe.statut], ['termine', false, 'gratuit', 'gratuit', false, 'canceled']);
    H.v('   AUCUN prélèvement : aucune facture payée, aucune tentative de paiement', [faux.E.invoices.filter(i => i.sub === ab1.sid && i.amount_paid > 0).length, faux.E.invoices.filter(i => i.sub === ab1.sid).length], [0, 0]);
    H.v('   les dates de l\'essai restent lisibles après sa fin (courriels), mais « en cours » est faux et essaiFinLe est null', [e1b.abonnement.debutEssai !== null, e1b.abonnement.finEssai !== null, e1b.abonnement.essai.enCours, e1b.abonnement.essaiFinLe, e1b.abonnement.essai.carteEnregistree, e1b.abonnement.prochaineEcheance, e1b.abonnement.resiliationPrevue], [true, true, false, null, null, null, false]);
    H.v('   l\'essai a servi : plus jamais d\'essai pour ce compte', [e1b.abonnement.essai.disponible, e1b.abonnement.essai.refus], [false, 'essai-deja-utilise']);
    // une place Fondateurs tenue par un essai qui ne paiera pas : tenue pendant l'essai, RENDUE à sa résiliation
    const FD = await compteMail(`fond${n()}@exemple.fr`);
    const rFD = await checkout(FD, { offre: 'fondateurs', periode: 'mois', code: A.CODE_FONDATEURS });
    H.v('Fondateurs : le Checkout réserve une place et propose le même essai sans carte', [rFD.statut, dernier().params.payment_method_collection, dernier().params.subscription_data.trial_period_days, (await db.col('abo_places').findOne({ compteId: FD.id })).etat], [200, 'if_required', 14, 'reservee']);
    const abFD = await abonner(FD, { prix: A.PRIX.fondMois, offre: 'fondateurs' });
    const placeFD = await db.col('abo_places').findOne({ compteId: FD.id });
    H.v('   l\'essai Fondateurs sans carte TIENT la place (réservée) jusqu\'à la fin de l\'essai + 3 jours', [placeFD.etat, Math.round((placeFD.expireLe.getTime() - faux.sub(abFD.sid).trialEnd * 1000) / JOUR / 1000)], ['reservee', 3]);
    await avancer(abFD.h, 15);
    H.v('   la fin de l\'essai sans carte RÉSILIE l\'abonnement et RENDT la place (aucune place prise par un essai qui ne paie pas) ; statut termine, quota gratuit', [await db.col('abo_places').countDocuments({ compteId: FD.id }), (await statut(FD)).abonnement.statut, (await statut(FD)).quota.offre], [0, 'termine', 'gratuit']);

    // ═══ 6. UNE CARTE AJOUTÉE PENDANT L'ESSAI : l'abonnement continue, premier paiement à la fin de l'essai ═══
    const S2 = await compteMail(`carte${n()}@exemple.fr`);
    const ab2 = await abonner(S2);
    const avantLect = faux.E.appels.filter(x => x.nom === 'subscriptions.retrieve').length;
    Carte.vider(); await statut(S2); await statut(S2); await statut(S2);
    const lectures = faux.E.appels.filter(x => x.nom === 'subscriptions.retrieve').length - avantLect;
    H.v('la carte pendant l\'essai se lit chez Stripe UNE fois pour trois lectures du statut (cache de 30 s) : un appel borné, avec le client déplié', [lectures, faux.E.appels.filter(x => x.nom === 'subscriptions.retrieve').at(-1).params.expand], [1, ['customer']]);
    await faux.paymentMethods.attach('pm_card_visa', { customer: ab2.cu.id }); await faux.customers.update(ab2.cu.id, { invoice_settings: { default_payment_method: 'pm_card_visa' } });   // ce que fait le portail
    Carte.vider();
    const e2 = await statut(S2);
    H.v('une carte posée par le portail : carteEnregistree true, plus de fin prévue, la prochaine échéance (premier paiement) est la fin de l\'essai', [e2.abonnement.essai.carteEnregistree, e2.abonnement.resiliationPrevue, e2.abonnement.finPrevueLe, e2.abonnement.prochaineEcheance === e2.abonnement.essai.finLe, e2.abonnement.statut], [true, false, null, true, 'essai']);
    await avancer(ab2.h, 15);
    const e2b = await statut(S2);
    H.v('J+14 : une facture de 4,99 € PAYÉE, l\'abonnement est actif (Pro), il se renouvelle (prochaineEcheance = finDePeriode)', [faux.E.invoices.filter(i => i.sub === ab2.sid && i.amount_paid === 499).length, e2b.abonnement.statut, e2b.abonnement.actif, e2b.abonnement.prochaineEcheance === e2b.abonnement.finDePeriode && e2b.abonnement.prochaineEcheance !== null, e2b.abonnement.resiliationPrevue, e2b.abonnement.finPrevueLe], [1, 'actif', true, true, false, null]);
    H.v('   une résiliation en fin de période : finPrevueLe = la fin, plus de prochaineEcheance', [await (async () => { await faux.subscriptions.update(ab2.sid, { cancel_at_period_end: true }); await vider(); const x = (await statut(S2)).abonnement; return [x.resiliationPrevue, x.finPrevueLe === x.finDePeriode, x.prochaineEcheance]; })()], [[true, true, null]]);
    // JAMAIS une affirmation fausse : Stripe qui ne répond pas → null, pas false
    const S3 = await compteMail(`inconnue${n()}@exemple.fr`); const ab3 = await abonner(S3);
    faux.panneSur = 'subscriptions.retrieve'; Carte.vider();
    const e3 = (await statut(S3)).abonnement;
    faux.panneSur = null;
    H.v('Stripe injoignable : carteEnregistree = null (on ne sait pas), et AUCUNE affirmation de fin ni de renouvellement', [e3.essai.carteEnregistree, e3.resiliationPrevue, e3.finPrevueLe, e3.prochaineEcheance, e3.statut], [null, false, null, null, 'essai']);
    Carte.vider();
    H.v('   Stripe revenu : la lecture suivante redonne la vraie valeur (false : aucune carte)', [(await statut(S3)).abonnement.essai.carteEnregistree], [false]);
    H.v('carteDe (pure) : forme illisible = null, jamais false', [Carte.carteDe(null), Carte.carteDe({ customer: 'cus_x' }), Carte.carteDe({ customer: { invoice_settings: {} } }), Carte.carteDe({ default_payment_method: null, customer: { invoice_settings: { default_payment_method: null }, default_source: null } }), Carte.carteDe({ default_payment_method: 'pm_x', customer: { invoice_settings: { default_payment_method: null } } })], [null, null, null, false, true]);

    // ═══ 7. LES DATES DU STATUT : actif, impayé, parrainage ═══
    const S4 = await compteMail(`impaye${n()}@exemple.fr`);
    const ab4 = await abonner(S4, { carte: 'pm_card_chargeCustomerFail', finSansCarte: null });
    await avancer(ab4.h, 15);
    const e4 = (await statut(S4)).abonnement, fin4 = faux.sub(ab4.sid).trialEnd;
    H.v('un impayé : statut impaye, Pro maintenu, et la FIN DE LA GRÂCE est donnée par l\'API (premier échec + 3 jours), pas calculée par le site', [e4.statut, e4.actif, e4.paiementEchoue, e4.maintienJusqua === new Date((fin4 + 3 * JOUR) * 1000).toISOString(), e4.prochaineEcheance], ['impaye', true, true, true, null]);
    H.v('   hors impayé, maintienJusqua est null', [(await statut(S2)).abonnement.maintienJusqua, (await statut(S1)).abonnement.maintienJusqua], [null, null]);
    const q = (await statut(S2)).quota;
    H.v('le quota porte les noms du site (offre, limite, utilisees) ET les anciens (nom, restant, remiseAZero) ; Pro : limite null', [q.offre, q.nom, q.limite, q.utilisees, q.restant], ['pro', 'pro', null, 0, null]);
    const qg = (await statut(await compteMail(`gratuit${n()}@exemple.fr`))).quota;
    H.v('   un compte gratuit : limite = le quota du jour, utilisees = les analyses du jour, restant = limite − utilisees', [qg.offre, qg.limite, qg.utilisees, qg.restant], ['gratuit', cfg.quotas.gratuit, 0, cfg.quotas.gratuit]);
    const gQ = await compteMail(`gratuit${n()}@exemple.fr`);
    await db.col('quota_jour').insertOne({ porteur: `compte:${gQ.id}`, jour: require('../argent/offre').jourDeParis(new Date()), count: 4, expireLe: new Date(Date.now() + 3 * 86400e3) });
    const qg2 = (await statut(gQ)).quota;
    H.v('   4 analyses prises aujourd\'hui : utilisees 4, restant limite − 4', [qg2.utilisees, qg2.restant, qg2.limite - qg2.utilisees], [4, cfg.quotas.gratuit - 4, cfg.quotas.gratuit - 4]);

    // ═══ 8. LE PLAFOND DU PARRAINAGE : 12 mois offerts par parrain sur 365 jours glissants ═══
    const PARRAIN = await compteMail(`parrain12${n()}@exemple.fr`);
    const abP = await abonner(PARRAIN, { jours: 0, carte: 'pm_card_visa', finSansCarte: null });
    const filleuls = [];
    for (let i = 0; i < 13; i++) { const f = await compteMail(`filleul${i}${n()}@exemple.fr`); filleuls.push(f); await abonner(f, { jours: 0, carte: 'pm_card_visa', finSansCarte: null, parrain: PARRAIN }); }
    const primes = await db.col('abo_primes').find({ parrainId: PARRAIN.id }).sort({ creeLe: 1, _id: 1 }).toArray();
    const avoirsP = (faux.E.customers.get(abP.cu.id).transactions || []).filter(t => t.amount < 0);
    H.v('13 filleuls payants : 12 primes APPLIQUÉES (12 avoirs de 499) et 1 REFUSÉE', [primes.filter(p => p.etat === 'applique').length, primes.filter(p => p.etat === 'refusee').length, avoirsP.length, avoirsP.every(t => t.amount === -499)], [12, 1, 12, true]);
    const refusee = primes.find(p => p.etat === 'refusee');
    H.v('   la refusée porte la raison « plafond-annuel » et n\'a ni avoir ni montant ; c\'est la DERNIÈRE arrivée', [refusee.raison, avoirsP.some(t => t.metadata.rm_prime === String(refusee._id)), refusee.montant, String(refusee._id) === String(filleuls[12].id)], ['plafond-annuel', false, undefined, true]);
    H.v('   le parrain n\'est crédité que de 12 mois (solde −5 988 centimes) ; la refusée est signalée dans le journal', [faux.E.customers.get(abP.cu.id).balance, logs.some(l => l.includes('plafond-annuel'))], [-12 * 499, true]);
    const eP = (await statut(PARRAIN)).parrainage;
    H.v('   le statut du parrain dit les mois offerts sur 365 jours et le plafond', [eP.moisOfferts, eP.plafondMois, eP.fenetreJours, eP.essaiFilleulJours], [12, 12, 365, 30]);
    // la concurrence : 13 primes réclamées en même temps — exactement 12 passent
    const cfgAbo = srv && cfg.abonnements;
    const creerParrainManuel = async (jusquAu = new Date(Date.now() + 900 * JOUR * 1000)) => {
        const cu = await faux.customers.create({ email: 'p@exemple.fr' });
        return compteMail(`manuel${n()}@exemple.fr`, { stripeClient: cu.id, abonnement: { actif: true, quotaMensuel: 0, moisCle: null, restant: 0, jusquAu, stripe: { sid: `sub_${n()}`, statut: 'active', offre: 'pro', periode: 'mois', version: 1, jusquAu, resiliation: false } } });
    };
    const insererPrimes = async (parrain, k, etat = 'a-appliquer') => { const ids = []; for (let i = 0; i < k; i++) { const id = new ObjectId(); ids.push(id); await db.col('abo_primes').insertOne({ _id: id, parrainId: parrain.id, etat, creeLe: new Date() }); } return ids; };
    const R = await creerParrainManuel(), T0 = new Date('2027-03-10T12:00:00Z');
    const idsR = await insererPrimes(R, 13);
    const resR = await Promise.all(idsR.map(id => Pr.appliquer({ stripe: faux, cfgAbo, filleulId: id, maintenant: T0 })));
    const apresR = await db.col('abo_primes').find({ parrainId: R.id }).toArray();
    H.v('13 primes appliquées EN MÊME TEMPS : exactement 12 appliquées, 1 refusée (plafond-annuel), 12 avoirs', [apresR.filter(p => p.etat === 'applique').length, apresR.filter(p => p.etat === 'refusee' && p.raison === 'plafond-annuel').length, (faux.E.customers.get(R.compte.stripeClient).transactions || []).length], [12, 1, 12]);
    // la fenêtre glissante, à la seconde : 12 primes appliquées à T0 (insérées telles quelles), puis des filleuls plus tard
    const Q = await creerParrainManuel();
    for (let i = 0; i < 12; i++) await db.col('abo_primes').insertOne({ _id: new ObjectId(), parrainId: Q.id, etat: 'applique', creeLe: T0, appliqueLe: T0, montant: 499 });
    const tard = async (jours, s = 0) => { const [id] = await insererPrimes(Q, 1); const r = await Pr.appliquer({ stripe: faux, cfgAbo, filleulId: id, maintenant: new Date(T0.getTime() + jours * JOUR * 1000 + s * 1000) }); return [r.etat, (await db.col('abo_primes').findOne({ _id: id })).etat]; };
    H.v('à T0 + 364 jours : toujours 12 mois dans la fenêtre → refusée', await tard(364), ['ignore', 'refusee']);
    H.v('   à T0 + 365 jours − 1 s : encore refusée', await tard(365, -1), ['ignore', 'refusee']);
    H.v('   à T0 + 365 jours : les 12 premiers sortent de la fenêtre, la place se LIBÈRE → appliquée', await tard(365), ['applique', 'applique']);
    H.v('   les suivantes (il y a de nouveau de la place pour 11 de plus, puis le plafond)', [await (async () => { let ok = 0; for (let i = 0; i < 11; i++) if ((await tard(365, 10 + i))[1] === 'applique') ok++; return ok; })(), (await tard(365, 60))[1]], [11, 'refusee']);
    H.v('   le compte des mois offerts ne compte QUE la fenêtre : à T0 + 364 j les 12 premiers y sont ; à T0 + 365 j ils en sortent (reste la prime appliquée à cet instant)', [await Pr.moisOfferts(Q.id, new Date(T0.getTime() + 364 * JOUR * 1000)), await Pr.moisOfferts(Q.id, new Date(T0.getTime() + 365 * JOUR * 1000))], [12, 1]);

    // ═══ 9. L'OFFRE FONDATEURS RÉSERVÉE : servie par l'API sur code valide, rien d'autre ═══
    const O1 = await compteMail(`res${n()}@exemple.fr`);
    const bon = await post('/api/abonnement/fondateurs', O1, { code: ` ${A.CODE_FONDATEURS.toLowerCase()} ` });
    H.v('code valide (casse et espaces tolérés) : l\'offre — prix mensuel et annuel en centimes, places restantes, durée de l\'essai', [bon.statut, bon.json], [200, { success: true, offre: { nom: 'fondateurs', devise: 'EUR', prix: { mois: 299, an: 2900 }, places: { total: 3, restantes: 3 }, essaiJours: 14 } }]);
    H.v('   jamais en cache, jamais indexée', [bon.entetes['cache-control'], bon.entetes['x-robots-tag']], ['no-store', 'noindex, nofollow']);
    const PL = await compteMail(`place${n()}@exemple.fr`); await checkout(PL, { offre: 'fondateurs', periode: 'mois', code: A.CODE_FONDATEURS });
    H.v('   une place réservée de plus : une restante de moins', (await post('/api/abonnement/fondateurs', O1, { code: A.CODE_FONDATEURS })).json.offre.places.restantes, 2);
    const mauvais = await post('/api/abonnement/fondateurs', O1, { code: 'PAS-LE-BON' });
    const srvFerme = await A.serveur(A.cfgAbo({ V2_FONDATEURS_CODE: '' }));
    const ferme = await post('/api/abonnement/fondateurs', O1, { code: A.CODE_FONDATEURS }, {}, srvFerme.url);
    const fermeMauvais = await post('/api/abonnement/fondateurs', O1, { code: 'PAS-LE-BON' }, {}, srvFerme.url);
    const sansDate = r => ({ statut: r.statut, json: r.json, entetes: Object.fromEntries(Object.entries(r.entetes).filter(([k]) => !['date', 'etag', 'x-request-id'].includes(k))) });
    H.v('un mauvais code : 422 code-invalide, rien d\'autre', [mauvais.statut, mauvais.json.erreur.detail, JSON.stringify(mauvais.json).includes('299')], [422, 'code-invalide', false]);
    H.v('   l\'offre FERMÉE (code bon ou mauvais) donne une réponse IDENTIQUE à celle d\'un mauvais code : statut, corps et en-têtes', [JSON.stringify(sansDate(ferme)) === JSON.stringify(sansDate(mauvais)), JSON.stringify(sansDate(fermeMauvais)) === JSON.stringify(sansDate(mauvais))], [true, true]);
    await srvFerme.fermer();
    const sansSession = await H.appel(srv.url, '/api/abonnement/fondateurs', { methode: 'POST', corps: { code: A.CODE_FONDATEURS }, entetes: { ...A.SITE, ...ipN() } });
    H.v('sans session : 401, aucune offre', [sansSession.statut, JSON.stringify(sansSession.json).includes('299')], [401, false]);
    const sansOrigine = await H.appel(srv.url, '/api/abonnement/fondateurs', { methode: 'POST', corps: { code: A.CODE_FONDATEURS }, entetes: { cookie: O1.cookie, ...ipN() } });
    H.v('   sans l\'origine du site : 403', sansOrigine.statut, 403);
    H.v('   un champ en trop : 400 ; un corps sans code ou mal typé : 422 code-invalide (indiscernable)', [(await post('/api/abonnement/fondateurs', O1, { code: A.CODE_FONDATEURS, offre: 'x' })).statut, (await post('/api/abonnement/fondateurs', O1, {})).json.erreur.detail, (await post('/api/abonnement/fondateurs', O1, { code: 42 })).json.erreur.detail], [400, 'code-invalide', 'code-invalide']);
    // la MÊME limite d'essais que le Checkout : 10 par heure et par compte, partagés
    const brute = await compteMail(`brute${n()}@exemple.fr`); const codes = [];
    for (let i = 0; i < 5; i++) codes.push((await post('/api/abonnement/fondateurs', brute, { code: `ESSAI-${i}` })).statut);
    for (let i = 0; i < 5; i++) codes.push((await checkout(brute, { offre: 'fondateurs', periode: 'mois', code: `ESSAI-${i}` })).statut);
    const onze = await post('/api/abonnement/fondateurs', brute, { code: A.CODE_FONDATEURS });
    const onzeCk = await checkout(brute, { offre: 'fondateurs', periode: 'mois', code: A.CODE_FONDATEURS });
    H.v('la limite d\'essais est PARTAGÉE avec le Checkout : 5 + 5 essais, puis le 11e (même avec le BON code) est refusé 429 des deux côtés', [codes, onze.statut, onze.json.erreur.code, onzeCk.statut, JSON.stringify(onze.json).includes('299')], [[422, 422, 422, 422, 422, 422, 422, 422, 422, 422], 429, 'DEBIT', 429, false]);

    // ═══ 10. AUCUNE RÉPONSE PUBLIQUE NE DONNE LE PRIX NI LE LIEN FONDATEURS ═══
    const doc = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'openapi', 'openapi.v2.json'), 'utf8'));
    const express = require('express'); const pret = require('../pret'); const registre = require('../registre'); const { dansUnScan } = require('../../sources'); const { assembler, LOTS } = require('../index');
    registre.fournir('courrier', require('../comptes/courrier').creerCourrierMemoire()); registre.fournir('turnstile', { verifier: async () => true });
    const app = express(); app.set('trust proxy', true);
    for (const l of LOTS) l.enTete(app, cfg);
    app.use(express.json()); app.use((q, s, nx) => dansUnScan(nx)); pret.armer(M.verifierIndex);
    const routeur = assembler(LOTS, cfg, { jumeaux: () => ({ conclu: true, ids: [] }), gererIdentifier: async (q, s) => s.json({ success: true }), gererRetourLive: async (q, s) => s.json({ success: true }) });
    app.use(routeur);
    app.use((err, q, s, nx) => { if (s.headersSent) return nx(err); return s.status(Number(err && (err.status || err.statusCode)) || 500).json({ success: false }); });
    const pub = await H.serveur(app);
    const code = A.CODE_FONDATEURS;
    const INTERDITS = [[/\b299\b/, '299'], [/\b2 ?900\b/, '2900'], [/2[,.]99\b/, '2,99'], [/\b29 ?€/, '29 €'], [new RegExp(code.replace(/[-]/g, '[- ]?'), 'i'), 'le code'], [/fondateurs\?code=/i, 'fondateurs?code=']];
    const trouve = r => INTERDITS.filter(([re]) => re.test(r.texte) || re.test(JSON.stringify(r.entetes))).map(x => x[1]);
    H.v('le contrôle SAIT voir : la réponse de la route réservée (code valide) contient bien le prix', trouve({ texte: bon.texte, entetes: bon.entetes }), ['299', '2900']);
    // les routes de l'OpenAPI, PUIS toutes les routes réellement montées (router.stack) que l'OpenAPI ne décrit pas : « toutes » ne s'arrête pas à ce qui est documenté
    const ops = []; for (const [chemin, item] of Object.entries(doc.paths)) for (const m of ['get', 'post', 'put', 'patch', 'delete']) if (item[m]) ops.push({ chemin: chemin.replace(/\{[^}]+\}/g, 'x'), methode: m.toUpperCase(), cle: `${m.toUpperCase()} ${chemin}`, openapi: true });
    for (const couche of routeur.stack) if (couche.route) for (const m of Object.keys(couche.route.methods)) {
        const cle = `${m.toUpperCase()} ${couche.route.path}`;
        if (!['get', 'post', 'put', 'patch', 'delete'].includes(m) || typeof couche.route.path !== 'string') continue;
        if (!ops.some(o => o.methode === m.toUpperCase() && o.chemin === couche.route.path.replace(/:[A-Za-z]+/g, 'x'))) ops.push({ chemin: couche.route.path.replace(/:[A-Za-z]+/g, 'x'), methode: m.toUpperCase(), cle, openapi: false });
    }
    const nbOpenapi = ops.filter(o => o.openapi).length;
    const fuites = [], vus = { sans: 0, ordinaire: 0 };
    for (const o of ops) for (const pass of ['sans', 'ordinaire']) {
        const u = pass === 'ordinaire' ? await A.compteConnecte() : null;
        const r = await H.appel(pub.url, o.chemin, { methode: o.methode, corps: ['POST', 'PUT', 'PATCH'].includes(o.methode) ? {} : undefined, entetes: { ...A.SITE, ...ipN(), ...(u ? { cookie: u.cookie } : {}) } }).catch(e => ({ statut: 0, texte: String(e), entetes: {} }));
        vus[pass]++;
        const t = trouve(r); if (t.length) fuites.push(`${pass} ${o.cle} → ${r.statut} : ${t.join(', ')}`);
    }
    console.log(`   ${nbOpenapi} opérations de l'OpenAPI + ${ops.length - nbOpenapi} routes montées non décrites, parcourues sans session puis avec un compte ordinaire (${vus.sans + vus.ordinaire} requêtes)`);
    H.v('toutes les routes (OpenAPI et montées), sans session puis avec un compte ordinaire : AUCUNE ne donne le prix Fondateurs, le code ni « fondateurs?code= »', fuites, []);
    H.vrai('   le parcours a réellement couvert les routes (au moins 30 opérations de l\'OpenAPI, les deux passes complètes)', nbOpenapi >= 30 && vus.sans === ops.length && vus.ordinaire === ops.length);
    H.vrai('   la route réservée et le statut de l\'abonnement en font partie', ops.some(o => o.cle === 'POST /api/abonnement/fondateurs') && ops.some(o => o.cle === 'GET /api/abonnement'));
    await pub.fermer();
    const st = await statut(O1);
    H.v('le statut public annonce l\'essai et les offres Pro seulement (jamais Fondateurs)', [Object.keys(st.offres).sort(), JSON.stringify(st).includes('fondateurs')], [['devise', 'essaiJours', 'pro', 'source'], false]);
    // ═══ 11. TOUR DE CORRECTION 1 — les contournements de la relecture 1 (chacun tombait sur le code d'avant) ═══
    // R1 : lier l'installation APRÈS l'essai
    const IX = await nouvelleInstallation();
    const C1 = await compteMail(`apres${n()}@exemple.fr`), D1 = await compteMail(`autre${n()}@exemple.fr`);
    await checkout(C1, { offre: 'pro', periode: 'mois' }); await abonner(C1);
    await lier(C1, IX); await Li.delier(await db.col('installations').findOne({ _id: IX._id }));
    await lier(D1, IX);
    await checkout(D1, { offre: 'pro', periode: 'mois' });
    H.v('R1 : une installation liée APRÈS l\'essai du compte entre au registre : un autre compte qui la lie ensuite n\'a PAS d\'essai', [dernier().params.subscription_data.trial_period_days, (await statut(D1)).abonnement.essai.refus], [undefined, 'installation-deja-utilisee']);
    // R1b : liée entre le Checkout et le webhook
    const IX2 = await nouvelleInstallation(); const C2 = await compteMail(`entre${n()}@exemple.fr`), D2 = await compteMail(`autre${n()}@exemple.fr`);
    await checkout(C2, { offre: 'pro', periode: 'mois' }); await lier(C2, IX2); await abonner(C2);
    H.v('R1b : liée entre le Checkout et le webhook : la ligne de l\'installation est CONFIRMÉE avec l\'essai', (await essaiDe(C2.id)).map(d => `${d.genre}:${d.etat}`).sort(), ['boite:pris', 'installation:pris']);
    await Li.delier(await db.col('installations').findOne({ _id: IX2._id })); await lier(D2, IX2); await checkout(D2, { offre: 'pro', periode: 'mois' });
    H.v('   un autre compte qui la lie ensuite : pas d\'essai', dernier().params.subscription_data.trial_period_days, undefined);
    // un essai qui n'aurait pas dû démarrer (installation déjà servie, liée trop tard) est CLOS : fin d'essai maintenant, résiliation sans carte
    const IX3 = await nouvelleInstallation(); const G1 = await compteMail(`premier${n()}@exemple.fr`), G2 = await compteMail(`tard${n()}@exemple.fr`), G3 = await compteMail(`tard${n()}@exemple.fr`);
    await lier(G1, IX3); await checkout(G1, { offre: 'pro', periode: 'mois' }); await abonner(G1);
    await Li.delier(await db.col('installations').findOne({ _id: IX3._id }));
    await checkout(G2, { offre: 'pro', periode: 'mois' }); await lier(G2, IX3); logs.length = 0;
    const abG2 = await abonner(G2);
    H.v('ESSAI CLOS : le second compte (installation déjà servie, liée après son Checkout) démarre son essai, le webhook le CLÔT : fin d\'essai maintenant, SANS carte → résilié, statut termine, aucune facture payée', [(await statut(G2)).abonnement.statut, faux.sub(abG2.sid).status, faux.E.invoices.filter(i => i.sub === abG2.sid && i.amount_paid > 0).length, logs.some(l => l.includes('essai-clos:installation-deja-utilisee'))], ['termine', 'canceled', 0, true]);
    H.v('   le premier compte garde son essai et ses lignes', (await essaiDe(G1.id)).map(d => `${d.genre}:${d.etat}`).sort(), ['boite:pris', 'installation:pris']);
    await Li.delier(await db.col('installations').findOne({ _id: IX3._id }));
    await checkout(G3, { offre: 'pro', periode: 'mois' }); await lier(G3, IX3);
    const abG3 = await abonner(G3, { carte: 'pm_card_visa', finSansCarte: null });
    H.v('   avec une carte, la clôture de l\'essai lance le premier paiement (499), l\'abonnement est actif', [faux.sub(abG3.sid).status, faux.E.invoices.filter(i => i.sub === abG3.sid && i.amount_paid === 499).length], ['active', 1]);
    // R2 : la réservation de la boîte expire avant la confirmation
    const loc3 = `lapse${n()}`; const L1 = await compteMail(`${loc3}@exemple.fr`), L2 = await compteMail(`${loc3}+b@exemple.fr`);
    await checkout(L1, { offre: 'pro', periode: 'mois' });
    await db.col('abo_essais').updateOne({ compteId: L1.id, genre: 'boite' }, { $set: { expireLe: new Date(Date.now() - 1000) } });
    await checkout(L2, { offre: 'pro', periode: 'mois' });
    const dureeRes = (await db.col('abo_essais').findOne({ compteId: L2.id, genre: 'boite' })).expireLe.getTime() - Date.now();
    await abonner(L2); await abonner(L1);
    H.v('R2 : réservation expirée puis reprise par un autre compte de la boîte : le second à CONFIRMER est clos (statut termine), la boîte reste au premier confirmé', [(await statut(L1)).abonnement.statut, (await statut(L2)).abonnement.statut, String((await db.col('abo_essais').findOne({ genre: 'boite', compteId: L2.id })).etat)], ['termine', 'essai', 'pris']);
    H.v('   la réservation couvre au moins la vie d\'une session Checkout (70 min) et sa marge', dureeRes >= 100 * 60e3, true);
    const L3 = await compteMail(`libre${n()}@exemple.fr`); await checkout(L3, { offre: 'pro', periode: 'mois' });
    await db.col('abo_essais').deleteMany({ compteId: L3.id });
    await abonner(L3);
    H.v('   la boîte LIBRE au webhook (ligne disparue) : l\'essai est gardé et la ligne est confirmée', [(await statut(L3)).abonnement.statut, (await essaiDe(L3.id)).map(d => d.etat)], ['essai', ['pris']]);
    // R4 : plafond et événement en désordre
    const maintenantR = Date.now();
    const Q4 = await creerParrainManuel();
    for (let i = 1; i <= 12; i++) await db.col('abo_primes').insertOne({ _id: new ObjectId(), parrainId: Q4.id, etat: 'applique', creeLe: new Date(), appliqueLe: new Date(maintenantR + i * 60e3), montant: 499 });
    const [idTard] = await insererPrimes(Q4, 1);
    const rTard = await Pr.appliquer({ stripe: faux, cfgAbo, filleulId: idTard, maintenant: new Date(maintenantR - 3600e3) });
    H.v('R4 : 12 avoirs appliqués à des dates plus tardives, un événement EN RETARD (date ancienne) : la 13e est refusée, pas de 13e avoir', [rTard.etat, (await db.col('abo_primes').findOne({ _id: idTard })).etat, (faux.E.customers.get(Q4.compte.stripeClient).transactions || []).length], ['ignore', 'refusee', 0]);
    // la décision se juge à l'heure RÉELLE : 12 avoirs vieux de 366 jours sont sortis de la fenêtre, même si l'événement en retard porte une date plus ancienne qui les y garderait
    const Q6 = await creerParrainManuel();
    for (let i = 0; i < 12; i++) await db.col('abo_primes').insertOne({ _id: new ObjectId(), parrainId: Q6.id, etat: 'applique', creeLe: new Date(), appliqueLe: new Date(maintenantR - 366 * JOUR * 1000), montant: 499 });
    const [id6] = await insererPrimes(Q6, 1);
    H.v('   la fenêtre se juge à l\'heure de la décision, pas à la date de l\'événement : 12 avoirs de 366 jours ne comptent plus, la nouvelle prime est appliquée', (await Pr.appliquer({ stripe: faux, cfgAbo, filleulId: id6, maintenant: new Date(maintenantR - 2 * JOUR * 1000) })).etat, 'applique');
    // R5 : un avoir déjà posé chez Stripe ne devient jamais « refusee »
    const Q5 = await creerParrainManuel();
    for (let i = 0; i < 12; i++) await db.col('abo_primes').insertOne({ _id: new ObjectId(), parrainId: Q5.id, etat: 'applique', creeLe: new Date(), appliqueLe: new Date(), montant: 499 });
    const [id13] = await insererPrimes(Q5, 1);
    await faux.customers.createBalanceTransaction(Q5.compte.stripeClient, { amount: -499, currency: 'eur', description: 'x', metadata: { rm_prime: String(id13), rm_parrain: String(Q5.id) } });
    const r13 = await Pr.appliquer({ stripe: faux, cfgAbo, filleulId: id13, maintenant: new Date() });
    H.v('R5 : l\'avoir de la 13e prime existe DÉJÀ chez Stripe (reprise après panne) : la base dit « applique », jamais « refusee », et il n\'y a toujours qu\'UN avoir', [r13.etat, (await db.col('abo_primes').findOne({ _id: id13 })).etat, (faux.E.customers.get(Q5.compte.stripeClient).transactions || []).length], ['applique', 'applique', 1]);
    const [id14] = await insererPrimes(Q5, 1);
    H.v('   et cet avoir compte dans le plafond : la 14e est refusée', [(await Pr.appliquer({ stripe: faux, cfgAbo, filleulId: id14, maintenant: new Date() })).etat, (await db.col('abo_primes').findOne({ _id: id14 })).etat], ['ignore', 'refusee']);
    // les mutants de la relecture : carteDe sur une clé absente, le verrou d'un autre, un compte sans emailCle
    H.v('carteDe : la clé default_payment_method ABSENTE de l\'abonnement = on ne sait pas (null), jamais « sans carte »', Carte.carteDe({ customer: { invoice_settings: { default_payment_method: null } } }), null);
    {
        const idP = new ObjectId(); let libereA, libereB; const porteA = new Promise(r => { libereA = r; }), porteB = new Promise(r => { libereB = r; });
        const A1 = Pr.sousVerrou(idP, () => porteA);
        await new Promise(r => setTimeout(r, 150));
        await db.col(Pr.VERROUS).updateOne({ _id: `parrain:${String(idP)}` }, { $set: { expireLe: new Date(Date.now() - 1000) } });          // le verrou de A est périmé
        const B1 = Pr.sousVerrou(idP, () => porteB);
        await new Promise(r => setTimeout(r, 300));
        libereA(); await A1;
        H.v('verrou du parrain : A (périmé) finit APRÈS que B l\'a repris — il ne retire PAS le verrou de B', await db.col(Pr.VERROUS).countDocuments({ _id: `parrain:${String(idP)}` }), 1);
        libereB(); await B1;
        H.v('   B finit : le verrou est retiré', await db.col(Pr.VERROUS).countDocuments({ _id: `parrain:${String(idP)}` }), 0);
    }
    let leve = null, rSans = null;
    try { rSans = await Essai.verifier({ _id: new ObjectId(), abonnement: {} }, cfg, new Date()); } catch (e) { leve = e.name; }
    H.v('un compte sans emailCle : la garde REFUSE (domaine-jetable), elle ne lève pas', [leve, rSans], [null, { permis: false, detail: 'domaine-jetable' }]);
    // L'oracle de l'offre Fondateurs dans le Checkout : offre ouverte ou fermée, un code faux reçoit la MÊME réponse
    const srvFerme2 = await A.serveur(A.cfgAbo({ V2_FONDATEURS_CODE: '' }));
    const abonneEtat = { actif: true, quotaMensuel: 0, moisCle: null, restant: 0, jusquAu: new Date(Date.now() + 86400e3), stripe: { sid: 'sub_vivant', statut: 'active', version: 1, offre: 'pro', periode: 'mois', jusquAu: new Date(Date.now() + 86400e3) } };
    // (le délai avant réessai d'un 429 dépend de la seconde : exclu, comme les dates)
    const sd = r => JSON.stringify({ s: r.statut, j: JSON.parse(JSON.stringify(r.json), (k, v) => (k === 'reessayerDans' ? undefined : v)), e: Object.fromEntries(Object.entries(r.entetes).filter(([k]) => !['date', 'etag', 'x-request-id', 'content-length', 'retry-after'].includes(k))) });
    const suite = async (url, corpsDe) => { const u = await compteMail(`oracle${n()}@exemple.fr`, { abonnement: abonneEtat }); const out = []; for (let i = 0; i < 12; i++) out.push(sd(await H.appel(url, '/api/abonnement/checkout', { methode: 'POST', corps: corpsDe(i), entetes: { ...A.SITE, ...ipN(), cookie: u.cookie } }))); return out; };
    const ouvertSans = await suite(srv.url, () => ({ offre: 'fondateurs', periode: 'mois' })), fermeSans = await suite(srvFerme2.url, () => ({ offre: 'fondateurs', periode: 'mois' }));
    const ouvertFaux = await suite(srv.url, i => ({ offre: 'fondateurs', periode: 'mois', code: `FAUX-${i}` })), fermeFaux = await suite(srvFerme2.url, i => ({ offre: 'fondateurs', periode: 'mois', code: `FAUX-${i}` }));
    H.v('ORACLE : un compte déjà abonné, offre Fondateurs SANS code puis avec 12 codes faux : offre ouverte et offre fermée donnent les MÊMES réponses (statut, corps, en-têtes), le 429 au 11e essai aux deux', [JSON.stringify(ouvertSans) === JSON.stringify(fermeSans), JSON.stringify(ouvertFaux) === JSON.stringify(fermeFaux), JSON.parse(ouvertFaux[10]).s, JSON.parse(fermeFaux[10]).s, JSON.parse(ouvertFaux[0]).s, JSON.parse(ouvertSans[0]).s], [true, true, 429, 429, 422, 422]);
    await srvFerme2.fermer();
    // 8. LA MENTION LÉGALE DES FACTURES : TVA non applicable, art. 293 B du CGI — posée à la création du client, rattrapée sur un client ancien, jamais d'automatic_tax
    const O2 = require('../abonnements/offres');
    H.v('la mention est UNE constante, exactement la phrase de l\'éditeur', O2.MENTION_FACTURE, 'TVA non applicable, art. 293 B du CGI');
    const M1 = await compteMail(`pied${n()}@exemple.fr`); await checkout(M1, { offre: 'pro', periode: 'mois' });
    const clM1 = (await A.lireCompte(M1.id)).stripeClient;
    H.v('un client créé par le Checkout porte le pied de facture dès sa création', [faux.E.appels.filter(a => a.nom === 'customers.create').at(-1).params.invoice_settings, faux.E.customers.get(clM1).invoice_settings.footer], [{ footer: O2.MENTION_FACTURE }, O2.MENTION_FACTURE]);
    const vieux = await faux.customers.create({ email: 'v@exemple.fr', metadata: { compteId: 'x' } });
    const M2 = await compteMail(`ancien${n()}@exemple.fr`, { stripeClient: vieux.id });
    H.v('   un client plus ancien, sans pied : le contrôle de départ le voit absent', faux.E.customers.get(vieux.id).invoice_settings.footer, null);
    await checkout(M2, { offre: 'pro', periode: 'mois' });
    H.v('   il reçoit le pied au passage suivant par le Checkout (et un client déjà à jour n\'est pas réécrit)', [faux.E.customers.get(vieux.id).invoice_settings.footer, faux.E.appels.filter(a => a.nom === 'customers.update' && a.params.invoice_settings && a.params.invoice_settings.footer).length], [O2.MENTION_FACTURE, 1]);
    await checkout(M2, { offre: 'pro', periode: 'an' });
    H.v('   un second passage ne réécrit rien', faux.E.appels.filter(a => a.nom === 'customers.update' && a.params.invoice_settings && a.params.invoice_settings.footer).length, 1);
    H.v('le Checkout ne demande JAMAIS automatic_tax (aucune session créée dans ce banc n\'en porte)', [faux.E.appels.filter(a => a.nom === 'checkout.sessions.create').length > 20, faux.E.appels.filter(a => a.nom === 'checkout.sessions.create').some(a => JSON.stringify(a.params).includes('automatic_tax'))], [true, false]);
    // les index de CONFORT de l'essai sont créés avec les autres mais jamais EXIGÉS : déployer avant de les créer ne ferme aucune route
    const nomsConfort = ['abo_essais_ttl', 'abo_essais_compte', 'installations_comptes_lies'];
    const presentsAvant = [...(await db.col('abo_essais').indexes()), ...(await db.col('installations').indexes())].map(i => i.name);
    await db.col('abo_essais').dropIndex('abo_essais_ttl'); await db.col('abo_essais').dropIndex('abo_essais_compte'); await db.col('installations').dropIndex('installations_comptes_lies');
    H.v('les trois index de confort sont créés par creerIndex ; absents, verifierIndex (même avec les abonnements allumés) n\'en réclame aucun', [nomsConfort.every(x => presentsAvant.includes(x)), (await M.verifierIndex(true)).manquants], [true, []]);
    await M.creerIndex();
    H.v('   et creerIndex les recrée', [...(await db.col('abo_essais').indexes()), ...(await db.col('installations').indexes())].filter(i => nomsConfort.includes(i.name)).length, 3);
    // les réponses RÉELLES valident contre le schéma publié (et le schéma sait refuser)
    const { valider } = require('../openapi/valider'); const ref = nom => ({ $ref: `#/components/schemas/${nom}` });
    const invalides = reponsesStatut.map((j, i) => [i, valider(j, ref('ReponseAbonnement'), doc)]).filter(([, r]) => !r.ok).map(([i, r]) => `${i}: ${JSON.stringify(r.erreurs.slice(0, 2))}`);
    H.v(`les ${reponsesStatut.length} réponses réelles du statut valident toutes contre ReponseAbonnement`, invalides, []);
    H.v('   l\'offre Fondateurs réelle valide contre ReponseOffreFondateurs, le refus contre ReponseErreur', [valider(bon.json, ref('ReponseOffreFondateurs'), doc).ok, valider(mauvais.json, ref('ReponseErreur'), doc).ok], [true, true]);
    const abimee = JSON.parse(JSON.stringify(reponsesStatut[0])); abimee.abonnement.essai.carteEnregistree = 'oui';
    H.v('   le schéma SAIT refuser : carteEnregistree = « oui » (ni vrai, ni faux, ni null)', valider(abimee, ref('ReponseAbonnement'), doc).ok, false);
    const abimee2 = JSON.parse(JSON.stringify(bon.json)); abimee2.offre.codeFondateurs = 'x';
    H.v('   et un champ en plus dans l\'offre Fondateurs', valider(abimee2, ref('ReponseOffreFondateurs'), doc).ok, false);
    console.error = errOrig;
    await srv.fermer(); Cl.debrancher();
    await H.fermerBac(); H.bilan();
})().catch(e => { console.error = errOrig; console.error('❌', e); process.exit(1); });
