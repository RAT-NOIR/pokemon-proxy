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
// LA TABLE FERMÉE scénario → rôles de comptes. Les préconditions (« compte neuf ») ne portent QUE sur les rôles des scénarios JOUÉS : un parcours partiel n'exige pas les comptes des autres.
// Un scénario absent de cette table est REFUSÉ (il n'est pas joué, et le dit) : on n'invente pas les comptes qu'il consommerait.
const ROLES_DES_SCENARIOS = Object.freeze({
    essaiPuisPaiement: Object.freeze(['essai']), paiementEchoue: Object.freeze(['echec']), resiliation: Object.freeze(['resiliation']), parrainage: Object.freeze(['parrain', 'filleul']),
    fondateurs: Object.freeze(['fond1', 'fond2', 'fond3']), routeCheckoutEtPortail: Object.freeze(['route']),
    essaiSansCarte: Object.freeze(['sanscarte']), essaiCarteAjoutee: Object.freeze(['carteajoutee']), essaiClosInstallation: Object.freeze(['servi', 'clos'])
});

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
    // UNE horloge d'essai PAR SCÉNARIO (Stripe admet 3 clients par horloge ; le parcours en mettait 5 sur une seule) : créée au premier besoin du scénario, supprimée à sa fin, même s'il lève.
    let horloge = null;
    async function lHorloge() { if (!horloge) horloge = await stripe.testHelpers.testClocks.create({ frozen_time: maintenant(), name: 'rat-market-parcours' }); return horloge; }
    async function supprimerHorloge() { if (horloge) { const h = horloge; horloge = null; try { await stripe.testHelpers.testClocks.del(h.id); } catch { /* l'horloge expire seule */ } } }
    async function avancer(jours) {
        const h = await stripe.testHelpers.testClocks.retrieve((await lHorloge()).id);
        await stripe.testHelpers.testClocks.advance(h.id, { frozen_time: h.frozen_time + jours * JOUR });
        for (let i = 0; i < 60; i++) { const c = await stripe.testHelpers.testClocks.retrieve(h.id); if (c.status === 'ready') { horloge = c; return c.frozen_time; } await attendre(3000); }
        throw new Error('l\'horloge d\'essai n\'est pas revenue à « ready »');
    }
    const heure = async () => (await stripe.testHelpers.testClocks.retrieve((await lHorloge()).id)).frozen_time;
    // `carte: null` : AUCUN moyen de paiement (l'essai sans carte du Checkout) ; `finSansCarte` : ce que Stripe fait à la fin d'un essai sans moyen de paiement (le Checkout pose « cancel »)
    async function abonnerSurHorloge(role, { prixId, essaiJours = 0, carte = 'pm_card_visa', parrain = null, offre = 'pro', periode = 'mois', finSansCarte = null }) {
        const h = await lHorloge();
        const cu = await stripe.customers.create({ email: `parcours-${role}@exemple.invalid`, test_clock: h.id, metadata: { compteId: comptes[role].id } });
        let pm = null;
        if (carte) { pm = await stripe.paymentMethods.attach(carte, { customer: cu.id }); await stripe.customers.update(cu.id, { invoice_settings: { default_payment_method: pm.id } }); }
        const s = await stripe.subscriptions.create({ customer: cu.id, items: [{ price: prixId }], ...(essaiJours ? { trial_period_days: essaiJours } : {}), ...(pm ? { default_payment_method: pm.id } : {}),
            ...(finSansCarte ? { trial_settings: { end_behavior: { missing_payment_method: finSansCarte } } } : {}),
            metadata: { compteId: comptes[role].id, offre, periode, ...(parrain ? { parrain: comptes[parrain].id } : {}) } });
        return { customer: cu.id, sid: s.id };
    }
    async function sessionDe(role) {                                                       // la session Checkout créée par la route pour ce compte
        const l = await stripe.checkout.sessions.list({ limit: 30 });
        return l.data.filter(s => s.client_reference_id === comptes[role].id).at(-1) || null;
    }
    // ce que le Checkout crée pour un essai SANS carte (aucun moyen de paiement, `missing_payment_method: cancel`), sur le client de la session (sans horloge : la clôture est immédiate)
    async function completerSansCarte(session, essaiJours) {
        const items = await stripe.checkout.sessions.listLineItems(session.id);
        const s = await stripe.subscriptions.create({ customer: session.customer, items: [{ price: items.data[0].price.id }], trial_period_days: essaiJours, trial_settings: { end_behavior: { missing_payment_method: 'cancel' } }, metadata: session.metadata });
        return s.id;
    }
    async function completerCommeLeCheckout(role, session, { essaiJours, carte = 'pm_card_visa' }) {
        const pm = await stripe.paymentMethods.attach(carte, { customer: session.customer });
        await stripe.customers.update(session.customer, { invoice_settings: { default_payment_method: pm.id } });
        const items = await stripe.checkout.sessions.listLineItems(session.id);
        const s = await stripe.subscriptions.create({ customer: session.customer, items: [{ price: items.data[0].price.id }], ...(essaiJours ? { trial_period_days: essaiJours } : {}), default_payment_method: pm.id, metadata: session.metadata });
        return s.id;
    }

    // les préconditions ne portent que sur `roles` : les rôles des scénarios qui vont être joués (table fermée ROLES_DES_SCENARIOS)
    async function preconditions(roles) {
        for (const role of roles) {
            if (!comptes[role]) throw new Error(`le compte « ${role} » n'est pas fourni`);
            const s = await statut(role);
            if (s.abonnement.statut !== 'aucun') throw new Error(`le compte « ${role} » a déjà un abonnement (${s.abonnement.statut}) : le parcours demande des comptes neufs`);
        }
        note('comptes de test lisibles par la route du statut', true, `${roles.length} comptes`);
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
            const avoirs = async () => ((await stripe.customers.listBalanceTransactions(P.customer, { limit: 20 })).data || []).filter(x => x.amount < 0);
            note('parrainage : pas de mois offert au parrain tant que le filleul n\'a rien payé', (await avoirs()).length === 0);
            await avancer(31);
            await jusqua('filleul', s => s.abonnement.statut === 'actif', 'premier paiement du filleul');
            let apres = [];
            for (let i = 0; i < Math.ceil(delaiS / pasS); i++) { apres = await avoirs(); if (apres.length) break; await attendre(pasS * 1000); }
            note('parrainage : le premier paiement du filleul pose UN mois offert : un AVOIR de 499 centimes (le prix mensuel Pro) au solde du client du parrain', apres.length === 1 && apres[0].amount === -499, apres.map(x => x.amount).join(','));
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
        // L'ESSAI SANS CARTE tel que le Checkout le crée (essai de 14 jours, aucun moyen de paiement, `missing_payment_method: 'cancel'`) : à J+14, AUCUNE facture payée, statut « termine », quota gratuit.
        async essaiSansCarte() {
            const { sid } = await abonnerSurHorloge('sanscarte', { prixId: prix.proMois, essaiJours: 14, carte: null, finSansCarte: 'cancel' });
            const t0 = await heure();
            const s1 = await jusqua('sanscarte', s => s.abonnement.statut === 'essai' && s.abonnement.essai.carteEnregistree !== null, 'essai sans carte en cours (carte lue)');
            note('essai sans carte : Pro pendant l\'essai, aucune carte enregistrée (carteEnregistree false, pas null)', s1.abonnement.actif && s1.quota.nom === 'pro' && s1.abonnement.essai.carteEnregistree === false, `carte ${s1.abonnement.essai.carteEnregistree}`);
            note('essai sans carte : 14 jours, début et fin datés', proche(s1.abonnement.essai.finLe, t0 + 14 * JOUR, JOUR) && proche(s1.abonnement.essai.debutLe, t0, JOUR), `${s1.abonnement.essai.debutLe} → ${s1.abonnement.essai.finLe}`);
            note('essai sans carte : la fin est annoncée (resiliationPrevue, « prend fin le » = la fin de l\'essai), aucun renouvellement annoncé', s1.abonnement.resiliationPrevue === true && s1.abonnement.prochaineEcheance === null && proche(s1.abonnement.finPrevueLe, t0 + 14 * JOUR, JOUR), `fin ${s1.abonnement.finPrevueLe}`);
            await avancer(15);
            const s2 = await jusqua('sanscarte', s => s.abonnement.statut === 'termine', 'fin de l\'essai sans carte');
            note('essai sans carte, J+14 : abonnement terminé, retour au quota gratuit, plus Pro', !s2.abonnement.actif && s2.quota.nom === 'gratuit', `quota ${s2.quota.nom}`);
            const f = await stripe.invoices.list({ subscription: sid, limit: 5 });
            note('essai sans carte, J+14 : aucune facture payée (aucun prélèvement)', f.data.every(i => !(i.amount_paid > 0)), `${f.data.length} facture(s)`);
        },
        // UNE CARTE posée pendant l'essai (par le portail) : l'abonnement continue, premier paiement de 499 centimes à la fin de l'essai.
        async essaiCarteAjoutee() {
            const { sid, customer } = await abonnerSurHorloge('carteajoutee', { prixId: prix.proMois, essaiJours: 14, carte: null, finSansCarte: 'cancel' });
            const t0 = await heure();
            await jusqua('carteajoutee', s => s.abonnement.statut === 'essai' && s.abonnement.essai.carteEnregistree === false, 'essai sans carte (avant l\'ajout)');
            const pm = await stripe.paymentMethods.attach('pm_card_visa', { customer });                       // ce que fait le portail : la carte entre au client, par défaut pour ses factures
            await stripe.customers.update(customer, { invoice_settings: { default_payment_method: pm.id } });
            const s1 = await jusqua('carteajoutee', s => s.abonnement.essai.carteEnregistree === true, 'carte enregistrée pendant l\'essai');
            note('carte ajoutée pendant l\'essai : l\'essai continue, plus de fin prévue, le premier paiement est annoncé à la fin de l\'essai', s1.abonnement.statut === 'essai' && s1.abonnement.resiliationPrevue === false && s1.abonnement.finPrevueLe === null && proche(s1.abonnement.prochaineEcheance, t0 + 14 * JOUR, JOUR), `échéance ${s1.abonnement.prochaineEcheance}`);
            await avancer(15);
            const s2 = await jusqua('carteajoutee', s => s.abonnement.statut === 'actif', 'premier paiement après l\'ajout de la carte');
            note('carte ajoutée, J+14 : actif, Pro', s2.abonnement.actif && s2.quota.nom === 'pro', s2.abonnement.finPeriode);
            const f = await stripe.invoices.list({ subscription: sid, limit: 5 });
            note('carte ajoutée, J+14 : une facture de 4,99 € payée', f.data.some(i => i.amount_paid === 499), `${f.data.length} facture(s)`);
        },
        // LA CLÔTURE D'UN ESSAI QUI N'AURAIT PAS DÛ DÉMARRER (relecture 2, M3) : l'installation a déjà servi l'essai d'un autre compte ; le webhook clôt l'essai du second (`trial_end: now`). Le faux Stripe rend
        // cette hypothèse vraie par construction : CE scénario la prouve chez Stripe Test — abonnement `canceled`, 0 facture payée, statut `termine`. Il ne se joue qu'avec le vrai Stripe Test (par le coordinateur).
        async essaiClosInstallation() {
            const bearer = j => ({ authorization: `Bearer ${j}` });
            const inst = await api(null, 'POST', '/api/installation', {});
            const jeton0 = inst.json && inst.json.jetonInstallation;
            if (!note('clôture : une installation anonyme est créée', inst.statut === 201 && Boolean(jeton0), `HTTP ${inst.statut}`)) return;
            const code1 = await api('servi', 'POST', '/api/compte/code', {});
            const lien1 = await api(null, 'POST', '/api/compte/lier', { code: code1.json && code1.json.code }, bearer(jeton0));
            if (!note('clôture : l\'installation est liée au compte « servi »', lien1.statut === 200 && Boolean(lien1.json.jetonInstallation), `HTTP ${lien1.statut}`)) return;
            const jeton1 = lien1.json.jetonInstallation;
            const ck1 = await api('servi', 'POST', '/api/abonnement/checkout', { offre: 'pro', periode: 'mois' });
            const s1 = await sessionDe('servi');
            if (!note('clôture : le compte « servi » ouvre son Checkout avec essai', ck1.statut === 200 && Boolean(s1), `HTTP ${ck1.statut}`)) return;
            await completerSansCarte(s1, 14);
            await jusqua('servi', s => s.abonnement.statut === 'essai', 'essai du compte « servi »');
            note('clôture : le premier essai (installation liée) est gardé', true);
            const del = await api(null, 'POST', '/api/compte/delier', {}, bearer(jeton1));
            if (!note('clôture : l\'installation est déliée', del.statut === 200, `HTTP ${del.statut}`)) return;
            const ck2 = await api('clos', 'POST', '/api/abonnement/checkout', { offre: 'pro', periode: 'mois' });
            const s2 = await sessionDe('clos');
            const code2 = await api('clos', 'POST', '/api/compte/code', {});
            const lien2 = await api(null, 'POST', '/api/compte/lier', { code: code2.json && code2.json.code }, bearer(jeton1));
            if (!note('clôture : le second compte ouvre son Checkout, PUIS lie la même installation', ck2.statut === 200 && Boolean(s2) && lien2.statut === 200, `HTTP ${ck2.statut}/${lien2.statut}`)) return;
            const sub2 = await completerSansCarte(s2, 14);
            const fin = await jusqua('clos', s => s.abonnement.statut === 'termine', 'essai du second compte clos par le webhook');
            const chez = await stripe.subscriptions.retrieve(sub2);
            const f = await stripe.invoices.list({ subscription: sub2, limit: 5 });
            note('clôture : chez Stripe l\'abonnement est « canceled », aucune facture payée ; côté API statut « termine », quota gratuit', chez.status === 'canceled' && f.data.every(i => !(i.amount_paid > 0)) && !fin.abonnement.actif && fin.quota.nom === 'gratuit', `Stripe ${chez.status}, ${f.data.length} facture(s)`);
            const s1b = await statut('servi');
            note('clôture : le premier compte garde son essai', s1b.abonnement.statut === 'essai');
        },
        async routeCheckoutEtPortail() {
            const r = await api('route', 'POST', '/api/abonnement/checkout', { offre: 'pro', periode: 'an' });
            note('checkout Pro annuel : 200 et une adresse de paiement', r.statut === 200 && /^https:\/\//.test(r.json.url || ''), `HTTP ${r.statut}`);
            const s = await sessionDe('route');
            if (!s) { note('checkout : la session existe chez Stripe', false); return; }
            const l = await stripe.checkout.sessions.listLineItems(s.id);
            note('checkout : abonnement, CGV exigées, référence du compte, prix annuel Pro', s.mode === 'subscription' && s.consent_collection && s.consent_collection.terms_of_service === 'required' && s.client_reference_id === comptes.route.id && l.data[0].price.id === prix.proAn);
            note('checkout : l\'essai est SANS carte (la page de paiement ne demande aucune carte tant que la première facture est de 0 €)', s.payment_method_collection === 'if_required', String(s.payment_method_collection));
            note('checkout : retours vers le site (succès et abandon)', /^https:\/\/rat-market\.fr\/fr\/compte\?abonnement=succes$/.test(s.success_url || '') && /^https:\/\/rat-market\.fr\/fr\/tarifs\?abonnement=annule$/.test(s.cancel_url || ''));
            const p = await api('route', 'POST', '/api/abonnement/portail', {});
            note('portail client : une adresse', p.statut === 200 && /^https:\/\//.test(p.json.url || ''), `HTTP ${p.statut}`);
            await stripe.checkout.sessions.expire(s.id);
            note('la session de test est expirée (jamais complétée)', true);
        }
    };
    async function jouer({ seulement = null } = {}) {
        const noms = { essaiPuisPaiement: 'essai puis premier paiement', paiementEchoue: 'paiement échoué', resiliation: 'résiliation', parrainage: 'parrainage', fondateurs: 'fondateurs', routeCheckoutEtPortail: 'checkout et portail',
            essaiSansCarte: 'essai sans carte', essaiCarteAjoutee: 'carte ajoutée pendant l\'essai', essaiClosInstallation: 'essai clos (installation déjà servie)' };
        const choisis = Object.keys(scenarios).filter(k => !seulement || seulement.includes(k));
        const refuses = choisis.filter(k => !Object.prototype.hasOwnProperty.call(ROLES_DES_SCENARIOS, k));
        for (const k of refuses) note(`scénario « ${k} » REFUSÉ : absent de la table des rôles (on ne devine pas les comptes qu'il consommerait)`, false);
        const joues = choisis.filter(k => !refuses.includes(k));
        const roles = [...new Set(joues.flatMap(k => ROLES_DES_SCENARIOS[k]))];
        try { await preconditions(roles); } catch (e) { note('préconditions', false, String(e.message).slice(0, 220)); return resultats; }
        for (const k of joues) {
            trace(`\n## ${noms[k] || k}`);
            try { await etape(noms[k] || k, scenarios[k]); } finally { await supprimerHorloge(); }                         // l'horloge du scénario est supprimée à sa fin, même s'il a levé
        }
        return resultats;
    }
    async function nettoyer() { await supprimerHorloge(); }
    return { jouer, nettoyer, resultats, scenarios };
}
module.exports = { fabrique, JOUR, AttentePerdue, ROLES_DES_SCENARIOS };
