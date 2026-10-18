'use strict';
// STRIPE-V2 — le parcours Test automatisé, PROUVÉ sur un faux Stripe : la logique du parcours (parcours-lib.js) est jouée contre le vrai webhook et les vraies routes en mémoire, le faux Stripe
// fournissant ses horloges d'essai. Le parcours RÉEL (vrai Stripe Test, vrai essai) reste à lancer par le coordinateur une fois le code déployé : ce banc prouve que le script sait réussir ET qu'il
// sait ÉCHOUER (un état qui n'arrive pas, un webhook cassé, un prix faux).
const H = require('./_harnais'); const M = require('../modeles');
const A = require('./_aide-abonnements'); const { creerFauxStripe } = require('./_faux-stripe');
const Cl = require('../abonnements/client'); const { fabrique } = require('../admin/abonnements/parcours-lib');
const { analyserArguments, rolesRequis, ROLES, SCENARIOS } = require('../admin/abonnements/parcours-test');
const Carte = require('../abonnements/carte');

(async () => {
    // ── les arguments du script (écrits par ce qu'ils autorisent) ──
    H.v('sans --lancer : le script décrit seulement', analyserArguments([]).lancer, false);
    H.v('--lancer --places=2 --seulement=parrainage', (({ lancer, places, seulement }) => [lancer, places, seulement])(analyserArguments(['--lancer', '--places=2', '--seulement=parrainage'])), [true, 2, ['parrainage']]);
    for (const mauvais of [['--live'], ['--lancer', '--mode=live'], ['--places=3'], ['--seulement=inconnu'], ['--essai=http://x.exemple'], ['--lancer', 'x']]) {
        let e = null; try { analyserArguments(mauvais); } catch (x) { e = x.message; }
        H.v(`   argument refusé : ${mauvais.join(' ')}`, Boolean(e), true);
    }
    H.v('onze rôles de comptes, huit scénarios (dont essaiSansCarte et essaiCarteAjoutee, avec leurs rôles sanscarte et carteajoutee)', [ROLES.length, SCENARIOS.length, ROLES.includes('sanscarte'), ROLES.includes('carteajoutee'), SCENARIOS.includes('essaiSansCarte'), SCENARIOS.includes('essaiCarteAjoutee')], [11, 8, true, true, true, true]);
    H.v('les rôles exigés suivent les scénarios joués (table fermée) : un seul scénario n\'exige que ses comptes', [rolesRequis(['essaiSansCarte']), rolesRequis(['parrainage']).sort(), rolesRequis(null).length], [['sanscarte'], ['filleul', 'parrain'], 11]);

    await H.ouvrirBac('test-abonnements-parcours.js'); await M.creerIndex();
    // `attendre` du banc : la lecture de la carte pendant l'essai est mise en cache 30 s par le serveur (carte.js) ; le banc n'attend pas pour de vrai, il VIDE donc ce cache à chaque attente
    const jouer = async ({ faux, cfgSurcharge = {}, places = 2, accompte = null, rendreCassee = null, seulement = null, roles = ROLES, completer = null, avant = null } = {}) => {
        faux = faux || creerFauxStripe({ clientsParHorloge: 3 }); Cl.brancher(faux); A.semerPrix(faux); Carte.vider();       // la limite de Stripe : 3 clients par horloge
        // un faux Stripe neuf repart de cus_000001 et evt_000001 : les clients des passages précédents ne doivent pas entrer en collision (index unique), ni leurs événements passer pour des doublons du registre (le registre de production, lui, n'est jamais purgé)
        await require('../db').col('comptes').updateMany({}, { $set: { stripeClient: null } }); for (const c of ['abo_evenements', 'abo_places', 'abo_essais', 'abo_primes']) await require('../db').col(c).deleteMany({});
        const srv = await A.serveur(A.cfgAbo({ V2_FONDATEURS_PLACES: '2', ...cfgSurcharge }));
        const file = []; faux.surEvenement = e => file.push(e);
        const livre = async () => { while (file.length) { const e = file.shift(); if (rendreCassee && rendreCassee(e)) continue; await A.livrer(srv.url, e); } };
        const comptes = {}, cookies = {};
        for (const r of roles) { const c = await A.compteConnecte(); comptes[r] = { id: String(c.id) }; cookies[r] = c.cookie; }
        const api = async (role, methode, chemin, corps) => { const x = await H.appel(srv.url, chemin, { methode, corps, entetes: { cookie: cookies[role], ...(methode === 'POST' ? A.SITE : {}) } }); return { statut: x.statut, json: x.json }; };
        const trace = []; const traces = m => trace.push(m);
        const p = fabrique({ stripe: faux, api, comptes, prix: A.PRIX, attendre: async () => { Carte.vider(); await livre(); }, trace: traces, delaiS: 6, pasS: 3, places, codeFondateurs: A.CODE_FONDATEURS });
        if (avant) await avant(comptes);
        if (completer) completer(p);
        let res; try { res = await p.jouer({ seulement }); } finally { await p.nettoyer(); await srv.fermer(); Cl.debrancher(); }
        return { res, trace, faux };
    };

    // ── 1. le parcours réussit de bout en bout ──
    const { res, trace, faux } = await jouer({});
    const ko = res.filter(r => !r.ok);
    console.log(`   ${res.length} contrôles du parcours`);
    H.v('le parcours joué sur le faux Stripe : AUCUN échec', ko.map(r => `${r.nom} — ${r.detail}`), []);
    H.vrai('   et il a réellement joué les six scénarios (plus de 30 contrôles)', res.length >= 30);
    const noms = res.map(r => r.nom).join('\n');
    for (const mot of ['essai : 14 jours', 'premier paiement', 'paiement échoué', 'résiliation en fin de période', 'fin de période : abonnement terminé', 'parrainage : le filleul a 30 jours', 'UN mois offert', 'la facture suivante du parrain est à 0', 'un mauvais code est refusé', 'places sont prises', 'CGV'])
        H.vrai(`   le parcours contrôle : ${mot}`, noms.includes(mot));
    H.v('   le horloge d\'essai est supprimée à la fin (les clients de test avec elle)', [faux.E.clocks.size], [0]);
    H.v('   aucune session Checkout n\'a été complétée : celles de la route sont expirées', [...faux.E.sessions.values()].filter(s => s.client_reference_id).every(s => s.status === 'expired' || s.status === 'open'), true);
    H.v('   la sortie du parcours ne porte aucun identifiant de clé ni de secret', trace.some(l => /sk_test_|whsec_/.test(l)), false);

    // ── 1 bis. STRIPE-DECISIONS : les deux scénarios de l'essai sans carte, une horloge par scénario, les préconditions limitées aux rôles joués ──
    for (const mot of ['essai sans carte : Pro pendant l\'essai, aucune carte enregistrée', 'essai sans carte, J+14 : abonnement terminé, retour au quota gratuit', 'essai sans carte, J+14 : aucune facture payée', 'carte ajoutée pendant l\'essai : l\'essai continue',
        'carte ajoutée, J+14 : une facture de 4,99 € payée', 'checkout : l\'essai est SANS carte'])
        H.vrai(`   le parcours contrôle : ${mot}`, noms.includes(mot));
    H.v('   UNE horloge par scénario : six scénarios à horloge, six horloges créées (jamais cinq clients sur une seule : Stripe en admet 3), toutes supprimées', [faux.E.appels.filter(a => a.nom === 'testClocks.create').length, faux.E.clocks.size], [6, 0]);
    // tous les comptes sont fournis, mais celui du rôle « parrain » est DÉJÀ abonné : un parcours qui ne joue pas le parrainage ne doit pas s'en soucier
    const salir = async comptes => { await require('../db').col('comptes').updateOne({ _id: new (require('mongoose').Types.ObjectId)(comptes.parrain.id) }, { $set: { 'abonnement.stripe': { sid: 'sub_vieux', statut: 'active', offre: 'pro', periode: 'mois', version: 1 }, 'abonnement.actif': true, 'abonnement.jusquAu': new Date(Date.now() + 86400e3) } }); };
    const partiel = await jouer({ seulement: ['essaiSansCarte'], roles: ROLES, avant: salir });
    H.v('   un parcours partiel (un scénario) ne demande que SES comptes (un autre rôle, déjà abonné, n\'y change rien) : aucun échec, une seule horloge', [partiel.res.filter(r => !r.ok).map(r => `${r.nom} — ${r.detail}`),partiel.faux.E.appels.filter(a => a.nom === 'testClocks.create').length, partiel.faux.E.clocks.size], [[], 1, 0]);
    let corpsInconnu = false;
    const inconnu = await jouer({ seulement: null, roles: ROLES, completer: p => { p.scenarios.inventeSansRoles = async () => { corpsInconnu = true; }; } });
    H.v('   un scénario ABSENT de la table des rôles est REFUSÉ (jamais joué), et le dit', [corpsInconnu, inconnu.res.filter(r => !r.ok).map(r => /REFUSÉ/.test(r.nom) && /inventeSansRoles/.test(r.nom))], [false, [true]]);
    const dirty = await jouer({ seulement: ['parrainage'], roles: ROLES, avant: salir });
    H.v('   et le MÊME compte déjà abonné, joué dans SON scénario (le parrainage), est refusé net : les préconditions existent bien pour les rôles joués', [dirty.res.length, dirty.res[0].ok, /comptes neufs/.test(dirty.res[0].detail), dirty.faux.E.appels.filter(a => a.nom === 'testClocks.create').length], [1, false, true, 0]);
    const leve = await jouer({ seulement: ['essaiSansCarte'], roles: ['sanscarte'], completer: p => { const orig = p.scenarios.essaiSansCarte; p.scenarios.essaiSansCarte = async () => { await orig(); throw new Error('boum-du-scenario'); }; } });
    H.v('   un scénario qui LÈVE : l\'échec est noté, et son horloge est tout de même supprimée', [leve.res.some(r => !r.ok && /boum-du-scenario/.test(r.detail)), leve.faux.E.clocks.size], [true, 0]);

    // ── 2. il SAIT échouer : un webhook qui n'arrive jamais ──
    const casse = await jouer({ rendreCassee: e => e.type === 'invoice.paid' || e.type === 'customer.subscription.updated' });
    const kc = casse.res.filter(r => !r.ok);
    H.vrai(`un webhook qui ne livre plus les mises à jour d'abonnement : le parcours ÉCHOUE (${kc.length} échec(s)), en nommant l'état non atteint`, kc.length >= 3 && kc.some(r => /état non atteint/.test(r.detail)));
    // ── 3. il SAIT échouer : un mauvais prix ──
    const mal = creerFauxStripe(); const p = await jouer({ faux: mal, cfgSurcharge: { V2_STRIPE_PRIX_PRO_AN: 'price_BANCautre' } });
    // (le prix MENSUEL faux ne se verrait pas ici : le webhook retrouve l'offre par la clé de recherche du prix, c'est voulu ; le Checkout annuel, lui, envoie l'identifiant configuré)
    H.vrai(`une configuration où le prix Pro annuel n'est pas celui de Stripe : le parcours ÉCHOUE (${p.res.filter(r => !r.ok).length} échec(s))`, p.res.some(r => !r.ok));
    // ── 4. des comptes déjà utilisés : refus net, sans jouer ──
    const faux2 = creerFauxStripe(); Cl.brancher(faux2); A.semerPrix(faux2);
    const srv2 = await A.serveur(A.cfgAbo());
    const usage = await A.compteConnecte(); const cp = {}; const ck = {};
    for (const r of ROLES) { cp[r] = { id: String(usage.id) }; ck[r] = usage.cookie; }
    await H.appel(srv2.url, '/api/abonnement', { entetes: { cookie: usage.cookie } });
    await require('../db').col('comptes').updateOne({ _id: usage.id }, { $set: { 'abonnement.stripe': { sid: 'sub_vieux', statut: 'active', offre: 'pro', periode: 'mois', version: 1 }, 'abonnement.actif': true, 'abonnement.jusquAu': new Date(Date.now() + 86400e3) } });
    const p2 = fabrique({ stripe: faux2, api: async (role, m, c) => { const x = await H.appel(srv2.url, c, { methode: m, entetes: { cookie: ck[role] } }); return { statut: x.statut, json: x.json }; }, comptes: cp, prix: A.PRIX, attendre: async () => { }, delaiS: 3, pasS: 3 });
    const r2 = await p2.jouer({});
    H.v('un compte qui a déjà un abonnement : le parcours refuse de jouer (comptes neufs exigés) et ne crée rien chez Stripe', [r2.length, r2[0].ok, /comptes neufs/.test(r2[0].detail), faux2.E.appels.filter(a => /create/.test(a.nom)).length], [1, false, true, 0]);
    await srv2.fermer(); Cl.debrancher();
    await H.fermerBac(); H.bilan();
})().catch(e => { console.error('❌', e); process.exit(1); });
