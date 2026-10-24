'use strict';
// UN FAUX STRIPE EN MÉMOIRE pour les bancs des abonnements : aucune requête réseau, jamais. Il implémente le SOUS-ENSEMBLE du SDK que le code de v2/abonnements et ses deux outils appellent,
// avec les formes de réponse de la version d'API épinglée par le SDK. La signature des webhooks est celle du SDK (webhooks.constructEvent / generateTestHeaderString : de la cryptographie locale,
// sans réseau). Un mini-Stripe de CYCLE DE VIE y est ajouté pour jouer le parcours de test : horloges d'essai (testClocks), essai, renouvellement, échec de carte, résiliation en fin de période,
// coupon de parrainage consommé par la facture suivante. Les événements sont émis dans l'ordre à `surEvenement` (le banc les livre au VRAI gestionnaire de webhook, signés).
const Stripe = require('../../node_modules/stripe');
const JOUR = 86400, MOIS = 30 * JOUR, AN = 365 * JOUR;
const erreur = (code, message) => Object.assign(new Error(message || code), { type: 'StripeInvalidRequestError', code, raw: { code } });
// `clientsParHorloge` : la limite de Stripe est de 3 clients par horloge d'essai ; les bancs qui la tiennent la passent (parcours, décisions), les plus anciens, écrits avec une horloge commune, ne la posent pas.
// `moisS` : la durée d'un mois d'abonnement (30 jours par défaut ; Stripe compte en mois de calendrier, donc 31 jours d'octobre à novembre).
// `finalisationS` : si fourni, les factures de RENOUVELLEMENT naissent en brouillon et ne sont finalisées (solde du client appliqué, paiement tenté) que `finalisationS` secondes plus tard, quand l'horloge
// d'essai passe ce seuil — comme Stripe, qui finalise une facture d'abonnement environ une heure après sa création (3600). Sans cette option, tout est immédiat (comportement historique des bancs).
// `ignorerSolde` : un Stripe fautif qui n'applique jamais l'avoir du client à une facture (pour prouver que le parcours sait échouer là-dessus).
function creerFauxStripe({ maintenant = () => Math.floor(Date.now() / 1000), formeRecente = true, clientsParHorloge = Infinity, moisS = MOIS, finalisationS = null, ignorerSolde = false } = {}) {
    const E = { customers: new Map(), subs: new Map(), coupons: new Map(), sessions: new Map(), invoices: [], produits: [], prix: [], endpoints: [], configs: [], clocks: new Map(), idem: new Map(), appels: [], evenements: [] };
    let n = 0; const nid = pre => `${pre}_${String(++n).padStart(6, '0')}`;
    const note = (nom, params, opts) => E.appels.push({ nom, params: params === undefined ? undefined : JSON.parse(JSON.stringify(params)), opts: opts ? JSON.parse(JSON.stringify(opts)) : undefined });
    // comme Stripe : une clé d'idempotence rejouée avec d'AUTRES paramètres est une ERREUR (pas une réponse rejouée) — un code qui change un paramètre à chaque appel est vu ici, pas en production
    const avecCle = (opts, fabrique, params) => {
        const k = opts && opts.idempotencyKey, empreinte = JSON.stringify(params === undefined ? null : params);
        if (k && E.idem.has(k)) { const d = E.idem.get(k); if (d.empreinte !== empreinte) throw erreur('idempotency_error', 'Keys for idempotent requests can only be used with the same parameters they were first used with.'); return d.reponse; }
        const r = fabrique(); if (k) E.idem.set(k, { empreinte, reponse: r }); return r;
    };
    const f = { E, surEvenement: null, modeLive: false, panneSur: null };
    const panne = nom => { if (f.panneSur === nom) throw Object.assign(new Error('panne simulée'), { type: 'StripeAPIError', code: 'api_error' }); };
    const horloge = clientId => { const c = E.customers.get(clientId); return c && c.test_clock ? E.clocks.get(c.test_clock).frozen_time : maintenant(); };

    // ── l'abonnement tel que Stripe le sert ──
    const prixDe = id => E.prix.find(p => p.id === id) || { id, unit_amount: 0, recurring: { interval: 'month' }, lookup_key: null };
    function vue(s) {
        const item = { id: `si_${s.id}`, price: prixDe(s.prixId), ...(formeRecente ? { current_period_start: s.debut, current_period_end: s.fin } : {}) };
        const o = { id: s.id, object: 'subscription', customer: s.customer, status: s.status, created: s.created, trial_start: s.trialStart, trial_end: s.trialEnd, cancel_at_period_end: s.cancelAtPeriodEnd, cancel_at: null,
            ended_at: s.endedAt, metadata: { ...s.metadata }, items: { object: 'list', data: [item] }, discounts: s.discounts.map(d => d.id), livemode: f.modeLive, default_payment_method: s.defaultPm || null, default_source: null,
            trial_settings: s.finSansCarte ? { end_behavior: { missing_payment_method: s.finSansCarte } } : { end_behavior: { missing_payment_method: 'create_invoice' } } };
        if (!formeRecente) { o.current_period_start = s.debut; o.current_period_end = s.fin; }
        return o;
    }
    const emit = (type, objet, created) => { const evt = { id: nid('evt'), object: 'event', type, created, livemode: f.modeLive, data: { object: objet }, api_version: Stripe.API_VERSION }; E.evenements.push(evt); if (f.surEvenement) f.surEvenement(evt); return evt; };
    // comme Stripe : `total` (après remise), `starting_balance` (solde du client avant la facture, négatif = avoir), `ending_balance`, et `amount_due` = max(0, total + solde de départ)
    const factureVue = (inv) => ({ id: inv.id, object: 'invoice', created: inv.t, customer: inv.customer, amount_paid: inv.amount_paid, amount_due: inv.amount_due, status: inv.status, billing_reason: inv.raison, attempt_count: inv.essais || 1,
        total: inv.total, subtotal: inv.total, starting_balance: inv.starting_balance, ending_balance: inv.ending_balance,
        ...(formeRecente ? { parent: { type: 'subscription_details', subscription_details: { subscription: inv.sub } } } : { subscription: inv.sub }) });

    // ── cycle de vie (horloges d'essai) ──
    // règle une facture : le total (remise consommée), puis l'avoir du client (solde négatif) qui le réduit, jamais plus que lui
    function regler(s, inv) {
        const c = E.customers.get(s.customer), prix = prixDe(s.prixId);
        let total = prix.unit_amount || 0;
        if (s.discounts.length) { const d = s.discounts[0]; const cp = E.coupons.get(d.coupon); if (cp && !d.consomme) { total = Math.round(total * (100 - cp.percent_off) / 100); d.consomme = true; } }
        s.discounts = s.discounts.filter(d => !d.consomme);
        inv.total = total; inv.starting_balance = c.balance || 0;
        const utilise = !ignorerSolde && total > 0 && inv.starting_balance < 0 ?Math.min(total, -inv.starting_balance) : 0;
        c.balance = inv.starting_balance + utilise; inv.ending_balance = c.balance; inv.amount_due = total - utilise;
    }
    // tente le paiement d'une facture réglée, puis dit l'abonnement
    function encaisser(s, inv, t) {
        const c = E.customers.get(s.customer);
        const ok = inv.amount_due === 0 || (c.pm !== 'pm_card_chargeCustomerFail' && c.pm);
        if (ok) { inv.amount_paid = inv.amount_due; inv.status = 'paid'; s.status = 'active'; s.impayeDepuis = null; emit('invoice.paid', factureVue(inv), t); }
        else { inv.status = 'open'; s.status = 'past_due'; s.impayeDepuis = t; emit('invoice.payment_failed', factureVue(inv), t); }
        emit('customer.subscription.updated', vue(s), t);
    }
    // une facture en brouillon (renouvellement) se finalise `finalisationS` après sa création : c'est là que l'avoir du client lui est appliqué
    function finaliser(inv) { const s = E.subs.get(inv.sub); inv.status = 'open'; regler(s, inv); encaisser(s, inv, inv.finaliseA); }
    function facturer(s, t, raison) {
        const c = E.customers.get(s.customer), prix = prixDe(s.prixId);
        const inv = { id: nid('in'), customer: s.customer, sub: s.id, amount_due: 0, amount_paid: 0, status: 'open', raison, essais: 1, t };
        E.invoices.push(inv);
        const dur = (prix.recurring && prix.recurring.interval === 'year') ? AN : moisS;
        s.debut = t; s.fin = t + dur;
        if (finalisationS !== null && raison !== 'subscription_create') {
            inv.status = 'draft'; inv.finaliseA = t + finalisationS; inv.total = prix.unit_amount || 0; inv.amount_due = inv.total; inv.starting_balance = c.balance || 0; inv.ending_balance = c.balance || 0;
            if (s.status === 'trialing') s.status = 'active';          // la fin de l'essai passe l'abonnement à « active » dès la facture créée, comme Stripe
            emit('customer.subscription.updated', vue(s), t);
            return;
        }
        regler(s, inv); encaisser(s, inv, t);
    }
    function avancerSub(s, cible) {
        for (let garde = 0; garde < 50; garde++) {
            const t = s.status === 'trialing' ? s.trialEnd : s.status === 'active' ? s.fin : s.status === 'past_due' ? s.impayeDepuis + 14 * JOUR : Infinity;
            if (!(t <= cible)) return;
            // comme Stripe : à la fin d'un essai SANS moyen de paiement, `trial_settings.end_behavior.missing_payment_method: 'cancel'` résilie l'abonnement — aucune facture n'est tentée
            if (s.status === 'trialing' && s.finSansCarte === 'cancel' && !s.defaultPm && !E.customers.get(s.customer).pm) { s.status = 'canceled'; s.endedAt = t; emit('customer.subscription.deleted', vue(s), t); }
            else if (s.status === 'trialing') facturer(s, t, 'subscription_cycle');
            else if (s.status === 'active') {
                if (s.cancelAtPeriodEnd) { s.status = 'canceled'; s.endedAt = t; emit('customer.subscription.deleted', vue(s), t); }
                else facturer(s, t, 'subscription_cycle');
            } else if (s.status === 'past_due') { s.status = 'canceled'; s.endedAt = t; emit('customer.subscription.deleted', vue(s), t); }
        }
    }

    // ── les ressources ──
    f.customers = {
        async create(p, o) { panne('customers.create'); note('customers.create', p, o); return avecCle(o, () => {
            // comme Stripe : une horloge d'essai porte au plus 3 clients (quand le banc demande cette fidélité)
            if (p.test_clock && [...E.customers.values()].filter(c => c.test_clock === p.test_clock).length >= clientsParHorloge) throw erreur('test_clock_customer_limit', 'A test clock can have at most 3 customers.');
            const id = nid('cus'); const c = { id, object: 'customer', email: p.email, metadata: p.metadata || {}, test_clock: p.test_clock || null, pm: null, invoice_settings: { footer: (p.invoice_settings && p.invoice_settings.footer) || null } }; E.customers.set(id, c); return { ...c }; }, p); },
        async retrieve(id) { const c = E.customers.get(id); if (!c) throw erreur('resource_missing'); return { ...c }; },
        async createBalanceTransaction(id, p, o) { panne('customers.createBalanceTransaction'); note('customers.createBalanceTransaction', { id, ...p }, o); return avecCle(o, () => { const c = E.customers.get(id); if (!c) throw erreur('resource_missing'); c.balance = (c.balance || 0) + p.amount; (c.transactions = c.transactions || []).push({ id: nid('cbtxn'), object: 'customer_balance_transaction', amount: p.amount, currency: p.currency, description: p.description, metadata: { ...(p.metadata || {}) }, created: horloge(id) }); return { ...c.transactions.at(-1) }; }, { id, ...p }); },
        async listBalanceTransactions(id, p = {}) { panne('customers.listBalanceTransactions'); note('customers.listBalanceTransactions', { id, ...p }); const c = E.customers.get(id); if (!c) throw erreur('resource_missing'); return { data: [...(c.transactions || [])].reverse().map(x => ({ ...x })), has_more: false }; },
        async search(p) { panne('customers.search'); note('customers.search', p); const m = /metadata\['compteId'\]:'([0-9a-f]+)'/.exec(p.query || ''); return { data: [...E.customers.values()].filter(c => m && c.metadata && c.metadata.compteId === m[1]).map(c => ({ ...c })) }; },
        async update(id, p) { note('customers.update', p); const c = E.customers.get(id); if (!c) throw erreur('resource_missing'); if (p.invoice_settings && p.invoice_settings.default_payment_method) c.pm = p.invoice_settings.default_payment_method; if (p.invoice_settings && 'footer' in p.invoice_settings) c.invoice_settings = { ...(c.invoice_settings || {}), footer: p.invoice_settings.footer || null }; for (const k of ['email', 'name', 'phone', 'description']) if (k in p) c[k] = p[k] === '' ? null : p[k]; if ('address' in p) c.address = p.address === '' ? null : p.address; if (p.metadata) c.metadata = Object.fromEntries(Object.entries({ ...c.metadata, ...p.metadata }).filter(([, v]) => v !== '')); return { ...c }; },
        async del(id) { E.customers.delete(id); return { id, deleted: true }; }
    };
    f.paymentMethods = { async attach(pm, p) { note('paymentMethods.attach', { pm, ...p }); const c = E.customers.get(p.customer); if (!c) throw erreur('resource_missing'); c.pm = pm; return { id: pm, customer: p.customer }; } };
    f.checkout = { sessions: {
        async create(p, o) {
            panne('checkout.sessions.create'); note('checkout.sessions.create', p, o);
            return avecCle(o, () => {
                if (p.mode !== 'subscription') throw erreur('parameter_invalid_enum');
                const id = nid('cs_test'); const s = { id, object: 'checkout.session', url: `https://checkout.stripe.test/c/pay/${id}`, status: 'open', ...JSON.parse(JSON.stringify(p)) };
                E.sessions.set(id, s); return { ...s };
            }, p);
        },
        async retrieve(id) { const s = E.sessions.get(id); if (!s) throw erreur('resource_missing'); return { ...s }; },
        async list(p = {}) { panne('checkout.sessions.list'); return { data: [...E.sessions.values()].filter(s => (!p.customer || s.customer === p.customer) && (!p.status || s.status === p.status)).map(s => ({ ...s })) }; },
        async expire(id) { const s = E.sessions.get(id); if (!s) throw erreur('resource_missing'); s.status = 'expired'; return { ...s }; },
        async listLineItems(id) { const s = E.sessions.get(id); if (!s) throw erreur('resource_missing'); return { data: (s.line_items || []).map(l => ({ price: { id: l.price }, quantity: l.quantity })) }; }
    } };
    f.billingPortal = {
        sessions: { async create(p, o) { panne('billingPortal.sessions.create'); note('billingPortal.sessions.create', p, o); return { id: nid('bps'), url: `https://billing.stripe.test/p/session/${nid('s')}`, customer: p.customer }; } },
        configurations: {
            async list(p = {}) { return { data: E.configs.filter(c => p.is_default === undefined && (p.active === undefined || c.active === p.active)).map(c => JSON.parse(JSON.stringify(c))) }; },
            async create(p) { note('billingPortal.configurations.create', p); const c = { id: nid('bpc'), object: 'billing_portal.configuration', active: true, ...JSON.parse(JSON.stringify(p)) }; E.configs.push(c); return JSON.parse(JSON.stringify(c)); },
            async update(id, p) { note('billingPortal.configurations.update', p); const c = E.configs.find(x => x.id === id); if (!c) throw erreur('resource_missing'); Object.assign(c, JSON.parse(JSON.stringify(p))); return JSON.parse(JSON.stringify(c)); }
        }
    };
    f.subscriptions = {
        async create(p, o) {
            panne('subscriptions.create'); note('subscriptions.create', p, o);
            return avecCle(o, () => {
                const c = E.customers.get(p.customer); if (!c) throw erreur('resource_missing');
                const prixId = p.items[0].price, t = horloge(p.customer), jours = p.trial_period_days || 0, id = nid('sub');
                const prix = prixDe(prixId), dur = (prix.recurring && prix.recurring.interval === 'year') ? AN : moisS;
                if (p.default_payment_method) c.pm = p.default_payment_method;
                const finSansCarte = p.trial_settings && p.trial_settings.end_behavior ? p.trial_settings.end_behavior.missing_payment_method : null;
                const s = { id, customer: p.customer, prixId, defaultPm: p.default_payment_method || null, finSansCarte, status: jours ? 'trialing' : 'incomplete', created: t, trialStart: jours ? t : null, trialEnd: jours ? t + jours * JOUR : null, debut: t, fin: jours ? t + jours * JOUR : t + dur,
                    cancelAtPeriodEnd: false, endedAt: null, metadata: { ...(p.metadata || {}) }, discounts: [], impayeDepuis: null };
                E.subs.set(id, s);
                emit('customer.subscription.created', vue(s), t);
                if (!jours) facturer(s, t, 'subscription_create');            // paiement immédiat : invoice.paid (ou payment_failed) puis customer.subscription.updated
                return vue(s);
            }, p);
        },
        async retrieve(id, p) {
            panne('subscriptions.retrieve'); note('subscriptions.retrieve', { id, ...p }); const s = E.subs.get(id); if (!s) throw erreur('resource_missing');
            const o = vue(s);
            if (p && Array.isArray(p.expand) && p.expand.includes('customer')) { const c = E.customers.get(s.customer); o.customer = { id: c.id, object: 'customer', default_source: null, invoice_settings: { default_payment_method: c.pm || null } }; }
            if (p && Array.isArray(p.expand) && p.expand.includes('discounts')) o.discounts = s.discounts.map(d => ({ id: d.id, object: 'discount', source: { type: 'coupon', coupon: d.coupon } }));   // forme récente : source.coupon
            return o;
        },
        async list(p = {}) { note('subscriptions.list', p); return { data: [...E.subs.values()].filter(s => (!p.customer || s.customer === p.customer) && (p.status === 'all' || !p.status ? true : s.status === p.status)).map(vue) }; },
        async cancel(id, p = {}, o) {
            panne('subscriptions.cancel'); note('subscriptions.cancel', { id, ...p }, o);
            const s = E.subs.get(id); if (!s) throw erreur('resource_missing');
            if (s.status !== 'canceled') { s.status = 'canceled'; s.endedAt = horloge(s.customer); emit('customer.subscription.deleted', vue(s), s.endedAt); }
            return vue(s);
        },
        async update(id, p, o) {
            panne('subscriptions.update'); note('subscriptions.update', { id, ...p }, o);
            return avecCle(o, () => {
                const s = E.subs.get(id); if (!s) throw erreur('resource_missing');
                if (p.trial_end === 'now' && s.status === 'trialing') { s.trialEnd = horloge(s.customer); avancerSub(s, s.trialEnd); }       // fin d'essai immédiate : sans moyen de paiement et « cancel », l'abonnement est résilié ; sinon la première facture
                if (p.cancel_at_period_end !== undefined) { s.cancelAtPeriodEnd = Boolean(p.cancel_at_period_end); emit('customer.subscription.updated', vue(s), horloge(s.customer)); }
                if (p.discounts) for (const d of p.discounts) { if (d.coupon) { if (!E.coupons.has(d.coupon)) throw erreur('resource_missing'); s.discounts.push({ id: nid('di'), coupon: d.coupon, consomme: false }); } }
                if (p.discounts) emit('customer.subscription.updated', vue(s), horloge(s.customer));
                return vue(s);
            }, p);
        }
    };
    f.coupons = { async create(p) { panne('coupons.create'); note('coupons.create', p); if (E.coupons.has(p.id)) throw erreur('resource_already_exists'); E.coupons.set(p.id, { ...p }); return { ...p }; }, async retrieve(id) { if (!E.coupons.has(id)) throw erreur('resource_missing'); return { ...E.coupons.get(id) }; } };
    f.invoices = { async list(p = {}) { return { data: E.invoices.filter(i => !p.subscription || i.sub === p.subscription).map(factureVue).reverse() }; } };
    f.testHelpers = { testClocks: {
        async create(p) { note('testClocks.create', p); const id = nid('clock'); E.clocks.set(id, { id, frozen_time: p.frozen_time, status: 'ready' }); return { ...E.clocks.get(id) }; },
        async advance(id, p) {
            note('testClocks.advance', p); const c = E.clocks.get(id); if (!c) throw erreur('resource_missing');
            if (p.frozen_time < c.frozen_time) throw erreur('parameter_invalid');
            const subs = [...E.subs.values()].filter(s => (E.customers.get(s.customer) || {}).test_clock === id);
            // jalon par jalon, dans l'ordre du temps : la date de l'horloge suit le jalon que l'on joue
            for (let garde = 0; garde < 200; garde++) {
                const brouillons = E.invoices.filter(i => i.status === 'draft' && subs.some(s => s.id === i.sub));       // les finalisations en attente sont des jalons comme les autres
                const jalons = [...subs.map(s => (s.status === 'trialing' ? s.trialEnd : s.status === 'active' ? s.fin : s.status === 'past_due' ? s.impayeDepuis + 14 * JOUR : Infinity)), ...brouillons.map(i => i.finaliseA)].filter(t => t <= p.frozen_time);
                if (!jalons.length) break;
                const t = Math.min(...jalons); c.frozen_time = Math.max(c.frozen_time, t);
                for (const s of subs) avancerSub(s, t);
                for (const i of brouillons.filter(i => i.finaliseA <= t)) finaliser(i);
            }
            c.frozen_time = p.frozen_time; return { ...c };
        },
        async retrieve(id) { const c = E.clocks.get(id); if (!c) throw erreur('resource_missing'); return { ...c }; },
        async del(id) { for (const [cid, cu] of E.customers) if (cu.test_clock === id) E.customers.delete(cid); E.clocks.delete(id); return { id, deleted: true }; }
    } };
    // ── le provisionnement ──
    const liste = (tab, p = {}, champCle) => ({ data: tab.filter(x => (p.active === undefined || x.active === p.active) && (!p.lookup_keys || p.lookup_keys.includes(x.lookup_key)) && (!champCle || true)).map(x => JSON.parse(JSON.stringify(x))), has_more: false });
    f.products = {
        async list(p = {}) { return liste(E.produits, p); },
        async create(p, o) { note('products.create', p, o); const x = { id: nid('prod'), object: 'product', active: true, ...JSON.parse(JSON.stringify(p)) }; E.produits.push(x); return JSON.parse(JSON.stringify(x)); },
        async update(id, p) { note('products.update', p); const x = E.produits.find(y => y.id === id); if (!x) throw erreur('resource_missing'); Object.assign(x, JSON.parse(JSON.stringify(p))); return JSON.parse(JSON.stringify(x)); }
    };
    f.prices = {
        async list(p = {}) { return liste(E.prix, p); },
        async retrieve(id) { panne('prices.retrieve'); note('prices.retrieve', { id }); const x = E.prix.find(y => y.id === id); if (!x) throw erreur('resource_missing'); return JSON.parse(JSON.stringify(x)); },
        async create(p, o) { note('prices.create', p, o); if (p.lookup_key && E.prix.some(x => x.lookup_key === p.lookup_key && x.active)) throw erreur('lookup_key_already_used'); const x = { id: nid('price'), object: 'price', active: true, ...JSON.parse(JSON.stringify(p)) }; E.prix.push(x); return JSON.parse(JSON.stringify(x)); },
        async update(id, p) { note('prices.update', p); const x = E.prix.find(y => y.id === id); if (!x) throw erreur('resource_missing'); Object.assign(x, JSON.parse(JSON.stringify(p))); return JSON.parse(JSON.stringify(x)); }
    };
    f.webhookEndpoints = {
        async list() { return { data: E.endpoints.map(e => JSON.parse(JSON.stringify({ ...e, secret: undefined }))), has_more: false }; },
        async create(p) { note('webhookEndpoints.create', p); const e = { id: nid('we'), object: 'webhook_endpoint', status: 'enabled', secret: `whsec_${nid('secret')}`.replace(/_/g, ''), ...JSON.parse(JSON.stringify(p)) }; E.endpoints.push(e); return JSON.parse(JSON.stringify(e)); },
        async update(id, p) { note('webhookEndpoints.update', p); const e = E.endpoints.find(x => x.id === id); if (!e) throw erreur('resource_missing'); Object.assign(e, JSON.parse(JSON.stringify(p))); return JSON.parse(JSON.stringify({ ...e, secret: undefined })); },
        async del(id) { note('webhookEndpoints.del', { id }); const i = E.endpoints.findIndex(x => x.id === id); if (i < 0) throw erreur('resource_missing'); E.endpoints.splice(i, 1); return { id, deleted: true }; }
    };
    f.webhooks = Stripe.webhooks;
    // une facture « paid » ou « failed » jouée à la main, par un banc qui veut un événement précis
    f.emettre = (type, objet, created) => emit(type, objet, created);
    f.vue = id => vue(E.subs.get(id));
    f.sub = id => E.subs.get(id);
    return f;
}
module.exports = { creerFauxStripe, JOUR, MOIS, AN };
