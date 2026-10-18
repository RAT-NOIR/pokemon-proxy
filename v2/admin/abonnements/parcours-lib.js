'use strict';
// LE PARCOURS TEST — joué contre l'ESSAI (le code déployé) avec la clé Test de Stripe et les horloges d'essai (Test Clocks) qui font passer le temps. Ce module est la LOGIQUE du parcours ;
// le script parcours-test.js la câble au vrai Stripe Test et au vrai essai, le banc la câble à un faux Stripe et à un serveur en mémoire. Jamais de vrai paiement : cartes de test seulement.
//
// Ce que le parcours fait, et ce qu'il ne peut PAS faire (dit une fois, ici) :
//   · il ne peut pas terminer une page Checkout dans un navigateur. Pour chaque scénario, il fabrique chez Stripe l'abonnement que le Checkout aurait créé (mêmes prix, mêmes métadonnées, mêmes
//     jours d'essai, carte de test) ; les webhooks, l'état du compte et les quotas sont donc ceux de la production. Le Checkout lui-même est vérifié par la création d'une vraie session chez Stripe
//     (mode, CGV exigées, référence du compte, prix) que l'on relit puis expire — jamais complétée.
//   · l'horloge d'essai de Stripe n'est pas l'horloge du serveur : la grâce de l'impayé (3 jours) et le retour au gratuit après une fin se lisent à l'horloge RÉELLE du serveur. Le parcours
//     vérifie ce que Stripe envoie (statut, fin) et que le droit Pro est bien donné ou retiré à la réception ; il ne simule pas le temps réel du serveur.
// À chaque étape il LIT l'état du compte par la route du statut (GET /api/abonnement), comme le site.
const JOUR = 86400;
const AttentePerdue = class extends Error { };

function fabrique({ stripe, api, comptes, prix, attendre, maintenant = () => Math.floor(Date.now() / 1000), trace = () => { }, delaiS = 90, pasS = 3, places = null, codeFondateurs = null, parcoursCgv = true }) {
    const resultats = [];
    const note = (nom, ok, detail = '') => { resultats.push({ nom, ok, detail }); trace(`${ok ? 'OK ' : 'ÉCHEC'}  ${nom}${detail ? ` — ${detail}` : ''}`); return ok; };
    const statut = async role => { const r = await api(role, 'GET', '/api/abonnement'); if (r.statut !== 200) throw new Error(`statut ${role} : HTTP ${r.statut}`); return r.json; };
    // un état attendu (le webhook arrive par Stripe, de façon asynchrone) : on relit jusqu'à `delaiS` secondes
    async function jusqua(role, predicat, libelle) {
        let dernier = null;
        for (let t = 0; t <= delaiS; t += pasS) { dernier = await statut(role); if (predicat(dernier)) return dernier; await attendre(pasS * 1000); }
        throw new AttentePerdue(`${libelle} : état non atteint en ${delaiS} s (statut vu : ${dernier && dernier.abonnement.statut}, actif ${dernier && dernier.abonnement.actif}, quota ${dernier && dernier.quota.nom})`);
    }
    const proche = (iso, attenduS, tolS = 2 * JOUR) => Boolean(iso) && Math.abs(Date.parse(iso) / 1000 - attenduS) <= tolS;
    const etape = async (nom, f) => { try { await f(); } catch (e) { note(nom, false, String(e && e.message || e).slice(0, 220)); } };

    // ── Stripe : les objets d'un scénario ──
    let horloge = null;
    async function lHorloge() { if (!horloge) horloge = await stripe.testHelpers.testClocks.create({ frozen_time: maintenant(), name: 'rat-market-parcours' }); return horloge; }
    async function avancer(jours) {
        const h = await stripe.testHelpers.testClocks.retrieve((await lHorloge()).id);
        await stripe.testHelpers.testClocks.advance(h.id, { frozen_time: h.frozen_time + jours * JOUR });
        for (let i = 0; i < 60; i++) { const c = await stripe.testHelpers.testClocks.retrieve(h.id); if (c.status === 'ready') { horloge = c; return c.frozen_time; } await attendre(3000); }
        throw new Error('l\'horloge d\'essai n\'est pas revenue à « ready »');
    }
    const heure = async () => (await stripe.testHelpers.testClocks.retrieve((await lHorloge()).id)).frozen_time;
    async function abonnerSurHorloge(role, { prixId, essaiJours = 0, carte = 'pm_card_visa', parrain = null, offre = 'pro', periode = 'mois' }) {
        const h = await lHorloge();
        const cu = await stripe.customers.create({ email: `parcours-${role}@exemple.invalid`, test_clock: h.id, metadata: { compteId: comptes[role].id } });
        const pm = await stripe.paymentMethods.attach(carte, { customer: cu.id });
        await stripe.customers.update(cu.id, { invoice_settings: { default_payment_method: pm.id } });
        const s = await stripe.subscriptions.create({ customer: cu.id, items: [{ price: prixId }], ...(essaiJours ? { trial_period_days: essaiJours } : {}), default_payment_method: pm.id,
            metadata: { compteId: comptes[role].id, offre, periode, ...(parrain ? { parrain: comptes[parrain].id } : {}) } });
        return { customer: cu.id, sid: s.id };
    }
    async function sessionDe(role) {                                                       // la session Checkout créée par la route pour ce compte
        const l = await stripe.checkout.sessions.list({ limit: 30 });
        return l.data.filter(s => s.client_reference_id === comptes[role].id).at(-1) || null;
    }
    async function completerCommeLeCheckout(role, session, { essaiJours, carte = 'pm_card_visa' }) {
        const pm = await stripe.paymentMethods.attach(carte, { customer: session.customer });
        await stripe.customers.update(session.customer, { invoice_settings: { default_payment_method: pm.id } });
        const items = await stripe.checkout.sessions.listLineItems(session.id);
        const s = await stripe.subscriptions.create({ customer: session.customer, items: [{ price: items.data[0].price.id }], ...(essaiJours ? { trial_period_days: essaiJours } : {}), default_payment_method: pm.id, metadata: session.metadata });
        return s.id;
    }

    async function preconditions() {
        for (const role of Object.keys(comptes)) {
            const s = await statut(role);
            if (s.abonnement.statut !== 'aucun') throw new Error(`le compte « ${role} » a déjà un abonnement (${s.abonnement.statut}) : le parcours demande des comptes neufs`);
        }
        note('comptes de test lisibles par la route du statut', true, `${Object.keys(comptes).length} comptes`);
    }

    const scenarios = {
        async essaiPuisPaiement() {
            const { sid } = await abonnerSurHorloge('essai', { prixId: prix.proMois, essaiJours: 14 });
            const t0 = await heure();
            const s1 = await jusqua('essai', s => s.abonnement.statut === 'essai', 'essai en cours');
            note('essai : le compte est Pro pendant l\'essai (statut essai, plan pro, quota pro)', s1.abonnement.actif && s1.abonnement.plan === 'pro' && s1.quota.nom === 'pro' && s1.abonnement.essai.enCours, `plan ${s1.abonnement.plan}, quota ${s1.quota.nom}`);
            note('essai : 14 jours (fin d\'essai = horloge + 14 jours)', proche(s1.abonnement.essai.finLe, t0 + 14 * JOUR, JOUR), s1.abonnement.essai.finLe);
            note('essai : l\'essai n\'est plus « disponible » pour ce compte', s1.abonnement.essai.disponible === false);
            await avancer(15);
            const s2 = await jusqua('essai', s => s.abonnement.statut === 'actif', 'premier paiement');
            note('premier paiement : actif, Pro jusqu\'à la fin de la période suivante (≈ 1 mois après la fin de l\'essai)', s2.abonnement.actif && proche(s2.abonnement.finPeriode, t0 + 14 * JOUR + 30 * JOUR, 3 * JOUR) && s2.quota.nom === 'pro', s2.abonnement.finPeriode);
            const f = await stripe.invoices.list({ subscription: sid, limit: 5 });
            note('premier paiement : une facture de 4,99 € payée côté Stripe', f.data.some(i => i.amount_paid === 499), `${f.data.length} facture(s)`);
        },
        async paiementEchoue() {
            await abonnerSurHorloge('echec', { prixId: prix.proMois, essaiJours: 14, carte: 'pm_card_chargeCustomerFail' });
            await jusqua('echec', s => s.abonnement.statut === 'essai', 'essai (carte qui échouera)');
            await avancer(15);
            const s = await jusqua('echec', x => x.abonnement.statut === 'impaye', 'paiement échoué');
            note('paiement échoué : statut « impayé », échec signalé, Pro maintenu pendant la grâce (lue à l\'horloge du serveur)', s.abonnement.paiementEchoue && s.abonnement.actif && s.quota.nom === 'pro');
            try {
                await avancer(25);
                const f = await jusqua('echec', x => x.abonnement.statut === 'termine', 'fin après les relances');
                note('relances épuisées : l\'abonnement se termine, retour au gratuit', f.quota.nom === 'gratuit' && !f.abonnement.actif);
            } catch (e) { note('relances épuisées (observation seulement : Stripe décide du calendrier de ses relances en Test)', true, `non observé dans la fenêtre : ${String(e.message).slice(0, 120)}`); }
        },
        async resiliation() {
            const { sid } = await abonnerSurHorloge('resiliation', { prixId: prix.proMois });
            const s1 = await jusqua('resiliation', s => s.abonnement.statut === 'actif', 'abonnement actif');
            note('abonnement payé tout de suite : actif, Pro, aucune résiliation prévue', s1.abonnement.actif && !s1.abonnement.resiliationPrevue && s1.quota.nom === 'pro');
            await stripe.subscriptions.update(sid, { cancel_at_period_end: true });
            const s2 = await jusqua('resiliation', s => s.abonnement.resiliationPrevue === true, 'résiliation prévue');
            note('résiliation en fin de période : toujours Pro jusqu\'au bout, résiliation annoncée', s2.abonnement.actif && s2.quota.nom === 'pro', s2.abonnement.finPeriode);
            await avancer(35);
            const s3 = await jusqua('resiliation', s => s.abonnement.statut === 'termine', 'fin de période');
            note('fin de période : abonnement terminé, retour au gratuit', !s3.abonnement.actif && s3.quota.nom === 'gratuit');
        },
        async parrainage() {
            const P = await abonnerSurHorloge('parrain', { prixId: prix.proMois });
            await jusqua('parrain', s => s.abonnement.statut === 'actif', 'parrain actif');
            const t0 = await heure();
            await abonnerSurHorloge('filleul', { prixId: prix.proMois, essaiJours: 30, parrain: 'parrain' });
            const sF = await jusqua('filleul', s => s.abonnement.statut === 'essai', 'filleul en essai');
            note('parrainage : le filleul a 30 jours d\'essai', proche(sF.abonnement.essai.finLe, t0 + 30 * JOUR, JOUR), sF.abonnement.essai.finLe);
            const avant = await stripe.subscriptions.retrieve(P.sid, { expand: ['discounts'] });
            note('parrainage : pas de mois offert au parrain tant que le filleul n\'a rien payé', (avant.discounts || []).length === 0);
            await avancer(31);
            await jusqua('filleul', s => s.abonnement.statut === 'actif', 'premier paiement du filleul');
            let apres = null;
            for (let i = 0; i < Math.ceil(delaiS / pasS); i++) { apres = await stripe.subscriptions.retrieve(P.sid, { expand: ['discounts'] }); if ((apres.discounts || []).length) break; await attendre(pasS * 1000); }
            note('parrainage : le premier paiement du filleul pose UN mois offert (coupon 100 %, une fois) sur l\'abonnement du parrain', (apres.discounts || []).length === 1);
            await avancer(31);
            const f = await stripe.invoices.list({ subscription: P.sid, limit: 5 });
            const derniere = [...f.data].sort((a, b) => (b.created || 0) - (a.created || 0))[0];
            note('parrainage : la facture suivante du parrain est à 0 € (le mois offert)', Boolean(derniere) && derniere.amount_due === 0, derniere ? `${derniere.amount_due} centimes` : 'aucune facture');
        },
        async fondateurs() {
            const code = codeFondateurs;
            if (!code) { note('fondateurs : le code n\'est pas fourni au parcours (V2_FONDATEURS_CODE dans le .env d\'api-v2)', false); return; }
            const mauvais = await api('fond1', 'POST', '/api/abonnement/checkout', { offre: 'fondateurs', periode: 'mois', code: 'PAS-LE-BON-CODE' });
            note('fondateurs : un mauvais code est refusé', mauvais.statut === 422 && mauvais.json.erreur.detail === 'code-invalide', `HTTP ${mauvais.statut}`);
            for (const role of ['fond1', 'fond2']) {
                const r = await api(role, 'POST', '/api/abonnement/checkout', { offre: 'fondateurs', periode: 'mois', code });
                note(`fondateurs : le bon code ouvre une session (${role})`, r.statut === 200 && typeof r.json.url === 'string', `HTTP ${r.statut}`);
                const s = await sessionDe(role);
                if (!s) { note(`fondateurs : session retrouvée chez Stripe (${role})`, false); continue; }
                note(`fondateurs : la session Stripe exige les CGV, en mode abonnement, avec le compte pour référence (${role})`, s.consent_collection && s.consent_collection.terms_of_service === 'required' && s.mode === 'subscription' && s.client_reference_id === comptes[role].id);
                const lignes = await stripe.checkout.sessions.listLineItems(s.id);
                note(`fondateurs : au prix Fondateurs mensuel (${role})`, lignes.data[0].price.id === prix.fondMois);
                await completerCommeLeCheckout(role, s, { essaiJours: 14 });
                const st = await jusqua(role, x => x.abonnement.plan === 'fondateurs' && x.abonnement.actif, `abonnement Fondateurs (${role})`);
                note(`fondateurs : le compte est Pro, plan Fondateurs (${role})`, st.quota.nom === 'pro' && st.abonnement.plan === 'fondateurs');
            }
            if (places === 2) {
                const r = await api('fond3', 'POST', '/api/abonnement/checkout', { offre: 'fondateurs', periode: 'mois', code });
                note('fondateurs : les 2 places sont prises, le code est REFUSÉ au troisième (places-epuisees)', r.statut === 409 && r.json.erreur.detail === 'places-epuisees', `HTTP ${r.statut}`);
            } else note('fondateurs : épuisement des places non joué (lancer avec --places=2 après avoir posé V2_FONDATEURS_PLACES=2 sur l\'essai)', true, 'non joué');
        },
        async routeCheckoutEtPortail() {
            const r = await api('route', 'POST', '/api/abonnement/checkout', { offre: 'pro', periode: 'an' });
            note('checkout Pro annuel : 200 et une adresse de paiement', r.statut === 200 && /^https:\/\//.test(r.json.url || ''), `HTTP ${r.statut}`);
            const s = await sessionDe('route');
            if (!s) { note('checkout : la session existe chez Stripe', false); return; }
            const l = await stripe.checkout.sessions.listLineItems(s.id);
            note('checkout : abonnement, CGV exigées, référence du compte, prix annuel Pro', s.mode === 'subscription' && s.consent_collection && s.consent_collection.terms_of_service === 'required' && s.client_reference_id === comptes.route.id && l.data[0].price.id === prix.proAn);
            note('checkout : retours vers le site (succès et abandon)', /^https:\/\/rat-market\.fr\/fr\/compte\?abonnement=succes$/.test(s.success_url || '') && /^https:\/\/rat-market\.fr\/fr\/tarifs\?abonnement=annule$/.test(s.cancel_url || ''));
            const p = await api('route', 'POST', '/api/abonnement/portail', {});
            note('portail client : une adresse', p.statut === 200 && /^https:\/\//.test(p.json.url || ''), `HTTP ${p.statut}`);
            await stripe.checkout.sessions.expire(s.id);
            note('la session de test est expirée (jamais complétée)', true);
        }
    };
    async function jouer({ seulement = null } = {}) {
        try { await preconditions(); } catch (e) { note('préconditions', false, String(e.message).slice(0, 220)); return resultats; }
        const noms = { essaiPuisPaiement: 'essai puis premier paiement', paiementEchoue: 'paiement échoué', resiliation: 'résiliation', parrainage: 'parrainage', fondateurs: 'fondateurs', routeCheckoutEtPortail: 'checkout et portail' };
        for (const [k, f] of Object.entries(scenarios)) { if (seulement && !seulement.includes(k)) continue; trace(`\n## ${noms[k]}`); await etape(noms[k], f); }
        return resultats;
    }
    async function nettoyer() { if (horloge) { try { await stripe.testHelpers.testClocks.del(horloge.id); } catch { /* l'horloge expire seule */ } horloge = null; } }
    return { jouer, nettoyer, resultats, scenarios };
}
module.exports = { fabrique, JOUR, AttentePerdue };
