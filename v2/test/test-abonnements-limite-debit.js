'use strict';
// STRIPE-PARCOURS-FIN — le webhook face à la limite de débit de Stripe (HTTP 429, « StripeRateLimitError »). Un faux Stripe qui COMPTE chaque appel (par type d'événement) et qui rend 429 au-delà de N appels
// par seconde (horloge VIRTUELLE : seule l'attente du réessai la fait avancer, le banc ne dort pas). Ce banc imprime le nombre d'appels par événement, et prouve que :
//   · une rafale d'événements aboutit SANS échec (réessai DANS le traitement, attente croissante, bornée en tout) et sans un avoir de trop ;
//   · une limite qui ne cède pas laisse l'événement REJOUABLE (500), et le rejeu ne pose qu'un seul avoir ;
//   · les lectures redondantes d'un même traitement ont disparu (un abonnement lu une fois ; les soldes d'un parrain lus une fois pour toutes ses primes en attente ; rien à lire sans prime).
const H = require('./_harnais'); const db = require('../db'); const M = require('../modeles');
const A = require('./_aide-abonnements'); const { creerFauxStripe, JOUR } = require('./_faux-stripe');
const Cl = require('../abonnements/client'); const W = require('../abonnements/webhook'); const Pub = require('../abonnements/prix-publics');
const logs = []; const errOrig = console.error; console.error = (...a) => { logs.push(a.join(' ')); };
const RESSOURCES = ['customers', 'subscriptions', 'prices', 'checkout', 'billingPortal', 'invoices', 'coupons', 'paymentMethods', 'webhookEndpoints', 'products'];

/** Enveloppe le faux Stripe : compte chaque appel (par événement en cours), et rend 429 au-delà de `parSeconde` appels sur la dernière seconde VIRTUELLE tant que `limite.actif`. */
function instrumenter(faux, etat) {
    const habiller = (cible, chemin) => new Proxy(cible, {
        get(t, p) {
            const v = t[p];
            if (typeof p !== 'string') return v;
            const nom = chemin ? `${chemin}.${p}` : p;
            if (!chemin && !RESSOURCES.includes(p)) return v;
            if (typeof v === 'function') return async (...args) => {
                etat.appels.push(nom); etat.parType[etat.courant] = etat.parType[etat.courant] || { evenements: 0, appels: 0 }; etat.parType[etat.courant].appels++;
                etat.virtuel += etat.coutAppelMs;
                if (etat.limite.actif) {
                    etat.fenetre = etat.fenetre.filter(x => x > etat.virtuel - 1000);
                    if (etat.fenetre.length >= etat.limite.parSeconde) { etat.refus++; throw Object.assign(new Error('Too many requests'), { type: 'StripeRateLimitError', statusCode: 429, code: 'rate_limit' }); }
                    etat.fenetre.push(etat.virtuel);
                }
                return v.apply(t, args);
            };
            return v && typeof v === 'object' ? habiller(v, nom) : v;
        }
    });
    return habiller(faux, '');
}

(async () => {
    await H.ouvrirBac('test-abonnements-limite-debit.js'); await M.creerIndex();
    const etat = { appels: [], parType: {}, courant: '-', virtuel: 0, coutAppelMs: 40, fenetre: [], refus: 0, limite: { actif: false, parSeconde: 6 } };
    const LIMITE_RAFALE = /^\d+$/.test(process.env.RM_BANC_LIMITE || '') ? Number(process.env.RM_BANC_LIMITE) : 6;     // 6 par seconde ; RM_BANC_LIMITE=100000 mesure les appels SANS limite (le tableau « avant »)
    const attentes = [];
    let attenteEvt = 0, attenteMax = 0;       // l'attente cumulée de l'événement en cours, et la plus longue vue
    const dormir = async ms => { attentes.push(ms); attenteEvt += ms; attenteMax = Math.max(attenteMax, attenteEvt); etat.virtuel += ms; };
    const faux = creerFauxStripe(); A.semerPrix(faux); Cl.brancher(instrumenter(faux, etat));
    require('../abonnements/essai').armer(A.cfgAbo());      // comme le montage de la route : le secret d'empreinte pour la confirmation de l'essai par le webhook
    const cfg = A.cfgAbo().abonnements;
    const file = []; faux.surEvenement = e => file.push(e);
    const traiter = async evt => { attenteEvt = 0; etat.courant = evt.type; (etat.parType[evt.type] = etat.parType[evt.type] || { evenements: 0, appels: 0 }).evenements++; return W.traiterEvenement(evt, cfg, new Date(), { reessai: { dormir } }); };
    const vider = async () => { const sorties = []; while (file.length) { const e = file.shift(); sorties.push([e.type, (await traiter(e)).statut, e.id]); } return sorties; };
    const horloge = await faux.testHelpers.testClocks.create({ frozen_time: Math.floor(Date.now() / 1000) });
    const avancer = async jours => { const c = await faux.testHelpers.testClocks.retrieve(horloge.id); await faux.testHelpers.testClocks.advance(horloge.id, { frozen_time: c.frozen_time + jours * JOUR }); };
    const abonner = async (compte, { jours = 0, parrain = null } = {}) => {
        const cu = await faux.customers.create({ email: 'x@exemple.fr', test_clock: horloge.id });
        const s = await faux.subscriptions.create({ customer: cu.id, items: [{ price: A.PRIX.proMois }], trial_period_days: jours, default_payment_method: 'pm_card_visa', metadata: { compteId: String(compte.id), offre: 'pro', periode: 'mois', ...(parrain ? { parrain: String(parrain.id) } : {}) } });
        await vider(); return s.id;
    };
    const prime = id => db.col('abo_primes').findOne({ _id: id });
    const clientDe = sid => faux.sub(sid).customer;
    const avoirs = cid => (faux.E.customers.get(cid).transactions || []).filter(t => t.amount < 0);
    const nb = nom => etat.appels.filter(x => x === nom).length;
    const tableau = (titre) => { console.log(`\n   ── appels à Stripe par événement : ${titre} ──`); for (const [t, x] of Object.entries(etat.parType).filter(([t]) => t !== '-' && t !== '(bancs)')) console.log(`   ${t.padEnd(34)} ${String(x.evenements).padStart(3)} événement(s)  ${String(x.appels).padStart(3)} appel(s)  ${(x.appels / Math.max(1, x.evenements)).toFixed(1)} par événement`); };

    // ── 0. le réessai en lui-même (module neuf) ──
    const Reessai = (() => { try { return require('../abonnements/reessai'); } catch { return null; } })();
    H.vrai('le module du réessai existe', Reessai);
    if (Reessai) {
        const limite429 = () => Object.assign(new Error('x'), { type: 'StripeRateLimitError', statusCode: 429 });
        let n = 0; const dort = []; const dormirU = async ms => { dort.push(ms); };
        const ressource = { async lire(x) { n++; if (n <= 2) throw limite429(); return `lu:${x}`; }, async toujours() { n++; throw limite429(); }, async autre() { n++; throw Object.assign(new Error('x'), { type: 'StripeAPIError', code: 'api_error' }); }, drapeau: 'visible' };
        const neuf = () => Reessai.envelopper({ customers: ressource }, { dormir: dormirU, delaisMs: [100, 200, 400, 800], budgetMs: 1000 });      // un budget neuf par traitement
        const env = neuf();
        H.v('une limite de débit passagère : l\'appel aboutit, avec une attente CROISSANTE', [await env.customers.lire('a'), n, dort], ['lu:a', 3, [100, 200]]);
        n = 0; dort.length = 0; let err = null; try { await neuf().customers.toujours(); } catch (e) { err = e; }
        H.v('   une limite qui ne cède pas : l\'erreur d\'origine est rendue, l\'attente totale ne dépasse JAMAIS le budget', [err && err.type, dort.reduce((a, b) => a + b, 0) <= 1000, n >= 2], ['StripeRateLimitError', true, true]);
        n = 0; dort.length = 0; err = null; try { await neuf().customers.autre(); } catch (e) { err = e; }
        H.v('   une autre erreur n\'est PAS réessayée (aucune attente, un seul appel)', [err && err.code, n, dort], ['api_error', 1, []]);
        H.v('   le reste de l\'objet passe tel quel', env.customers.drapeau, 'visible');
        const e2 = Reessai.envelopper({ customers: ressource }, { dormir: dormirU, delaisMs: [600, 600], budgetMs: 1000 });
        n = 0; dort.length = 0; err = null; try { await e2.customers.toujours(); } catch (e) { err = e; }
        H.v('   le budget est partagé par tout le traitement : le second appel d\'un même traitement trouve le budget entamé', [dort, n], [[600], 2]);
        // le budget borne aussi la durée RÉELLE : chaque appel dure 400 ms (horloge injectée), le budget est de 1 000 ms — les attentes planifiées seules (100 + 200 + 400 = 700) y tiendraient
        let horloge = 0; n = 0; dort.length = 0; err = null;
        const lente = { async toujours() { n++; horloge += 400; throw limite429(); } };
        const e3 = Reessai.envelopper({ customers: lente }, { dormir: async ms => { dort.push(ms); horloge += ms; }, delaisMs: [100, 200, 400, 800], budgetMs: 1000, maintenantMs: () => horloge });
        try { await e3.customers.toujours(); } catch (e) { err = e; }
        H.v('   le budget compte le temps RÉEL des appels : après 400 ms d\'appel + 100 ms d\'attente + 400 ms d\'appel (900), un essai de plus (900 + 200 > 1 000) n\'a pas lieu', [err && err.type, n, dort, horloge <= 1000], ['StripeRateLimitError', 2, [100], true]);
    }

    // ── 1. la rafale : dix filleuls du même parrain paient ensemble, la limite est de 6 appels par seconde ──
    const P = await A.compteConnecte();
    const sidP = await abonner(P);
    const filleuls = []; for (let i = 0; i < 10; i++) { const f = await A.compteConnecte(); filleuls.push(f); await abonner(f, { jours: 30, parrain: P }); }
    H.v('avant la rafale : dix filleuls en essai, aucune prime, aucun avoir', [await db.col('abo_primes').countDocuments({}), avoirs(clientDe(sidP)).length], [0, 0]);
    etat.parType = {}; etat.appels.length = 0; Pub.vider();
    await avancer(31);
    etat.limite = { actif: true, parSeconde: LIMITE_RAFALE }; etat.refus = 0; attentes.length = 0;
    const sorties = await vider();
    etat.limite = { actif: false, parSeconde: 6 };
    tableau(`rafale du paiement des dix filleuls (limite de ${LIMITE_RAFALE} appels par seconde)`);
    console.log(`   ${sorties.length} événements, ${etat.appels.length} appels au total, ${etat.refus} réponse(s) 429 reçue(s), ${attentes.length} attente(s) de réessai`);
    H.v('la rafale aboutit SANS échec : aucun événement refusé (500)', sorties.filter(s => s[1] !== 200).map(s => s[0]), []);
    H.v('   les dix primes sont appliquées, UN avoir de 499 chacun, jamais deux', [(await db.col('abo_primes').find({ etat: 'applique' }).toArray()).length, avoirs(clientDe(sidP)).length, avoirs(clientDe(sidP)).every(t => t.amount === -499)], [10, 10, true]);
    H.vrai('   la limite a bien mordu (le banc ne prouve rien sans elle ; RM_BANC_LIMITE=100000 la lève exprès, pour mesurer les appels seuls)', etat.refus > 0 || LIMITE_RAFALE >= 1000);
    console.log(`   attente de réessai la plus longue pour UN événement : ${attenteMax} ms (virtuelles)`);
    H.vrai('   l\'attente cumulée d\'un événement reste bornée (au plus 6 s en tout)', attenteMax <= 6000);
    const erreurs = logs.filter(l => /échec de traitement/.test(l));
    H.v('   et rien n\'a été journalisé comme échec de traitement', erreurs, []);

    // ── 2. une limite qui ne cède pas : l'événement reste rejouable, le rejeu ne pose qu'un avoir ──
    const Q = await A.compteConnecte(), G = await A.compteConnecte();
    const sidQ = await abonner(Q);
    const sidG = await abonner(G, { jours: 30, parrain: Q });
    await avancer(31);
    etat.limite = { actif: true, parSeconde: 0 }; attentes.length = 0; logs.length = 0; attenteMax = 0;
    const dur = await vider();
    etat.limite = { actif: false, parSeconde: 6 };
    const payeG = dur.find(s => s[0] === 'invoice.paid' && faux.E.evenements.find(e => e.id === s[2]).data.object.customer === clientDe(sidG) && faux.E.evenements.find(e => e.id === s[2]).data.object.amount_paid > 0);
    H.v('une limite qui ne cède pas : la facture du filleul est refusée (500), donc rejouable par Stripe', payeG && payeG[1], 500);
    H.vrai(`   l'attente cumulée d'un événement reste bornée (au plus 6 s en tout ; vue : ${attenteMax} ms)`, attenteMax <= 6000);
    H.v('   aucun avoir n\'a été posé pendant ce temps, la prime attend', [avoirs(clientDe(sidQ)).length, (await prime(G.id)).etat], [0, 'a-appliquer']);
    const rejeu = await traiter(faux.E.evenements.find(e => e.id === payeG[2]));
    H.v('   Stripe revenu, le rejeu réussit : UN seul avoir, prime appliquée', [rejeu.statut, avoirs(clientDe(sidQ)).length, (await prime(G.id)).etat], [200, 1, 'applique']);

    // ── 3. les lectures redondantes ──
    // 3a. un parrain SANS prime en attente : son événement ne lit aucun solde chez Stripe
    const Z = await A.compteConnecte(); const sidZ = await abonner(Z);
    etat.appels.length = 0;
    await faux.subscriptions.update(sidZ, { cancel_at_period_end: true });
    await vider();
    H.v('un parrain sans prime en attente : sa mise à jour d\'abonnement ne lit AUCUN solde chez Stripe', nb('customers.listBalanceTransactions'), 0);
    // 3b. trois primes en attente d'un parrain qui s'abonne : les soldes sont lus UNE fois pour les trois
    const Q3 = await A.compteConnecte(), F1 = await A.compteConnecte(), F2 = await A.compteConnecte(), F3 = await A.compteConnecte();
    for (const f of [F1, F2, F3]) await abonner(f, { jours: 30, parrain: Q3 });
    await avancer(31); await vider();
    H.v('trois primes en attente (le parrain n\'a pas encore d\'abonnement)', (await db.col('abo_primes').find({ parrainId: Q3.id, etat: 'en-attente-parrain' }).toArray()).length, 3);
    etat.appels.length = 0;
    const sidQ3 = await abonner(Q3);
    H.v('   le parrain s\'abonne : les trois avoirs sont posés', [avoirs(clientDe(sidQ3)).length, (await db.col('abo_primes').countDocuments({ parrainId: Q3.id, etat: 'applique' }))], [3, 3]);
    H.v('   et les soldes de son client n\'ont été lus qu\'UNE fois pour les trois primes', nb('customers.listBalanceTransactions'), 1);
    // 3c. une facture d'un abonnement encore inconnu du compte : l'abonnement n'est lu qu'une fois
    const R = await A.compteConnecte(), RF = await A.compteConnecte();
    await abonner(R);
    const cuR = await faux.customers.create({ email: 'r@exemple.fr', test_clock: horloge.id });
    const sR = await faux.subscriptions.create({ customer: cuR.id, items: [{ price: A.PRIX.proMois }], default_payment_method: 'pm_card_visa', metadata: { compteId: String(RF.id), offre: 'pro', periode: 'mois', parrain: String(R.id) } });
    file.length = 0;
    await db.col('comptes').updateOne({ _id: RF.id }, { $set: { stripeClient: cuR.id } });
    const inv = A.evenement('invoice.paid', { id: 'in_banc_redondance', object: 'invoice', customer: cuR.id, amount_paid: 499, amount_due: 499, parent: { type: 'subscription_details', subscription_details: { subscription: sR.id } } }, Math.floor(Date.now() / 1000));
    etat.appels.length = 0;
    const rinv = await traiter(inv);
    H.v('une facture payée d\'un abonnement inconnu du compte : traitée, et l\'abonnement n\'est lu chez Stripe qu\'UNE fois', [rinv.statut, nb('subscriptions.retrieve')], [200, 1]);
    tableau('bilan de tout le banc');
    await H.fermerBac(); Cl.debrancher(); H.bilan();
})().catch(e => { errOrig('❌', e); process.exit(1); });
