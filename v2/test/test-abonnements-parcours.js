'use strict';
// STRIPE-V2 — le parcours Test automatisé, PROUVÉ sur un faux Stripe : la logique du parcours (parcours-lib.js) est jouée contre le vrai webhook et les vraies routes en mémoire, le faux Stripe
// fournissant ses horloges d'essai. Le parcours RÉEL (vrai Stripe Test, vrai essai) reste à lancer par le coordinateur une fois le code déployé : ce banc prouve que le script sait réussir ET qu'il
// sait ÉCHOUER (un état qui n'arrive pas, un webhook cassé, un prix faux).
const H = require('./_harnais'); const M = require('../modeles');
const A = require('./_aide-abonnements'); const { creerFauxStripe } = require('./_faux-stripe');
const Cl = require('../abonnements/client'); const { fabrique } = require('../admin/abonnements/parcours-lib');
const { analyserArguments, rolesRequis, ROLES, SCENARIOS, extensionDeLaConfig, entetesDeLApi } = require('../admin/abonnements/parcours-test');
const Carte = require('../abonnements/carte');
const EXT_SERVEUR = A.cfgAbo().origines.extension;       // l'origine que le serveur admet sur POST /api/installation (le profil « extension » du CORS)

(async () => {
    // ── les arguments du script (écrits par ce qu'ils autorisent) ──
    H.v('sans --lancer : le script décrit seulement', analyserArguments([]).lancer, false);
    H.v('--lancer --places=2 --seulement=parrainage', (({ lancer, places, seulement }) => [lancer, places, seulement])(analyserArguments(['--lancer', '--places=2', '--seulement=parrainage'])), [true, 2, ['parrainage']]);
    for (const mauvais of [['--live'], ['--lancer', '--mode=live'], ['--places=3'], ['--seulement=inconnu'], ['--essai=http://x.exemple'], ['--lancer', 'x']]) {
        let e = null; try { analyserArguments(mauvais); } catch (x) { e = x.message; }
        H.v(`   argument refusé : ${mauvais.join(' ')}`, Boolean(e), true);
    }
    H.v('treize rôles de comptes, neuf scénarios (dont essaiSansCarte, essaiCarteAjoutee et essaiClosInstallation, avec leurs rôles sanscarte, carteajoutee, servi et clos)', [ROLES.length, SCENARIOS.length, ROLES.includes('sanscarte'), ROLES.includes('carteajoutee'), ROLES.includes('servi'), ROLES.includes('clos'), SCENARIOS.includes('essaiClosInstallation')], [13, 9, true, true, true, true, true]);
    H.v('les rôles exigés suivent les scénarios joués (table fermée) : un seul scénario n\'exige que ses comptes', [rolesRequis(['essaiSansCarte']), rolesRequis(['parrainage']).sort(), rolesRequis(null).length], [['sanscarte'], ['filleul', 'parrain'], 13]);

    await H.ouvrirBac('test-abonnements-parcours.js'); await M.creerIndex();
    // `attendre` du banc : la lecture de la carte pendant l'essai est mise en cache 30 s par le serveur (carte.js) ; le banc n'attend pas pour de vrai, il VIDE donc ce cache à chaque attente
    // `extension` : l'origine et les en-têtes de l'extension, passés au parcours (jamais en dur) ; `origineAcceptee` : celle que le faux serveur admet sur /api/installation (comme le cors() hérité : 403
    // « Origine non autorisée » pour toute autre) ; `retarder`/`apresAttentes` : des événements tenus en arrière (la livraison de Stripe en retard) jusqu'à la N-ième attente ; `attenteAvoirS` : la borne de l'attente de l'avoir.
    const jouer = async ({ faux, cfgSurcharge = {}, places = 2, accompte = null, rendreCassee = null, seulement = null, roles = ROLES, completer = null, avant = null, extension = { entetes: { origin: EXT_SERVEUR } }, origineAcceptee = EXT_SERVEUR, retarder = null, apresAttentes = 3, attenteAvoirS = 30, lenteurListeMs = 0, delEchoue = null } = {}) => {
        // l'horloge du parcours est VIRTUELLE (injectée) : chaque attente l'avance de sa durée, et `lenteurListeMs` fait durer chaque lecture des avoirs chez Stripe (les attentes en temps réel, pas en pas additionnés)
        let virt = 0;        faux = faux || creerFauxStripe({ clientsParHorloge: 3 }); Cl.brancher(faux); A.semerPrix(faux); Carte.vider();       // la limite de Stripe : 3 clients par horloge
        // un faux Stripe neuf repart de cus_000001 et evt_000001 : les clients des passages précédents ne doivent pas entrer en collision (index unique), ni leurs événements passer pour des doublons du registre (le registre de production, lui, n'est jamais purgé)
        await require('../db').col('comptes').updateMany({}, { $set: { stripeClient: null } }); for (const c of ['abo_evenements', 'abo_places', 'abo_essais', 'abo_primes']) await require('../db').col(c).deleteMany({});
        const srv = await A.serveur(A.cfgAbo({ V2_FONDATEURS_PLACES: '2', ...cfgSurcharge }), [require('../transport/monter'), require('../installations/monter'), require('../comptes/monter'), require('../argent/monter')]);       // + installations et comptes : le scénario de clôture crée et lie une installation
        const file = []; faux.surEvenement = e => file.push(e);
        const tenus = []; let livraisons = 0;
        const livre = async () => {
            while (file.length) { const e = file.shift(); if (rendreCassee && rendreCassee(e)) continue; if (retarder && retarder(e, faux)) { tenus.push(e); continue; } await A.livrer(srv.url, e); }
            if (tenus.length && ++livraisons > apresAttentes && apresAttentes >= 0) while (tenus.length) await A.livrer(srv.url, tenus.shift());
        };
        const comptes = {}, cookies = {};
        for (const r of roles) { const c = await A.compteConnecte(); comptes[r] = { id: String(c.id) }; cookies[r] = c.cookie; }
        let nIp = 0;      // une adresse par appel (le banc rejoue plusieurs parcours : la création d'installation est limitée par adresse et par jour)
        const appelsApi = [];
        const api = async (role, methode, chemin, corps, entetes = {}) => {
            appelsApi.push({ chemin, origin: entetes.origin });
            // le cors() hérité du serveur : sur /api/installation, seule l'origine de l'extension passe (le site reçoit 403 « Origine non autorisée »)
            if (chemin === '/api/installation' && (entetes.origin ?? (methode === 'POST' ? A.SITE.origin : undefined)) !== origineAcceptee) return { statut: 403, json: { success: false, error: 'Origine non autorisée' } };
            nIp++; const x = await H.appel(srv.url, chemin, { methode, corps, entetes: { ...(role ? { cookie: cookies[role] } : {}), 'x-forwarded-for': `10.${(Date.now() >> 8) & 255}.${Math.floor(nIp / 250) % 250}.${nIp % 250 + 1}`, ...(methode === 'POST' ? A.SITE : {}), ...entetes } }); return { statut: x.statut, json: x.json }; };
        const trace = []; const traces = m => trace.push(m);
        // à chaque avance d'horloge : combien d'avoirs le client du parrain porte-t-il chez Stripe, et combien de primes sont « appliquées » (c'est ce que le statut du parrain affiche) ?
        const avances = []; const avanceOrig = faux.testHelpers.testClocks.advance, delOrig = faux.testHelpers.testClocks.del;
        faux.testHelpers.testClocks.advance = async (...a) => { const parrain = [...faux.E.customers.values()].find(c => c.email === 'parcours-parrain@exemple.invalid'); avances.push({ avoirs: parrain ? (parrain.transactions || []).filter(t => t.amount < 0).length : null, appliquees: await require('../db').col('abo_primes').countDocuments({ etat: 'applique' }), apresNotes: trace.length }); return avanceOrig.apply(faux.testHelpers.testClocks, a); };
        faux.testHelpers.testClocks.del = async (...a) => { trace.push('<<horloge supprimée>>'); if (delEchoue) throw delEchoue; return delOrig.apply(faux.testHelpers.testClocks, a); };
        if (lenteurListeMs) { const liste = faux.customers.listBalanceTransactions; faux.customers.listBalanceTransactions = async (...a) => { virt += lenteurListeMs; return liste.apply(faux.customers, a); }; }
        const p = fabrique({ stripe: faux, api, comptes, prix: A.PRIX, attendre: async ms => { virt += ms || 0; Carte.vider(); await livre(); }, trace: traces, delaiS: 6, pasS: 3, places, codeFondateurs: A.CODE_FONDATEURS, extension, attenteAvoirS, maintenantMs: () => virt });
        if (avant) await avant(comptes);
        if (completer) completer(p);
        let res; try { res = await p.jouer({ seulement }); } finally { await p.nettoyer(); await srv.fermer(); Cl.debrancher(); }
        return { res, trace, faux, appelsApi, avances, tenus };
    };

    // ── 1. le parcours réussit de bout en bout ──
    const { res, trace, faux, appelsApi } = await jouer({});
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

    // ── 1 ter. STRIPE-PARCOURS-FIN : la clôture d'essai crée l'installation comme l'extension ; le parrainage attend l'avoir avant d'avancer l'horloge ──
    const parInstall = appelsApi => appelsApi.filter(a => /^\/api\/(installation|compte\/(lier|delier))$/.test(a.chemin));
    H.v('clôture d\'essai : l\'installation est créée, liée et déliée avec l\'origine et les en-têtes de l\'EXTENSION (passés au parcours), jamais ceux du site', [parInstall(appelsApi).length >= 4, parInstall(appelsApi).every(a => a.origin === EXT_SERVEUR)], [true, true]);
    const autre = 'chrome-extension://autreorigineautreorigine';
    const cloture = await jouer({ seulement: ['essaiClosInstallation'], roles: ROLES, extension: { entetes: { origin: autre } }, origineAcceptee: autre });
    H.v('   l\'origine vient de l\'ARGUMENT, pas du code : une autre origine passée est celle qui part (et le scénario réussit)', [cloture.res.filter(r => !r.ok).map(r => r.nom), parInstall(cloture.appelsApi).every(a => a.origin === autre)], [[], true]);
    const sansExt = await jouer({ seulement: ['essaiClosInstallation'], roles: ROLES, extension: null });
    H.v('   sans origine d\'extension fournie : le scénario ÉCHOUE en le disant, et n\'appelle jamais la route avec une origine devinée', [sansExt.res.some(r => !r.ok && /extension/.test(r.nom + r.detail)), parInstall(sansExt.appelsApi).length], [true, 0]);
    H.v('   l\'outil lit l\'origine de l\'extension dans la configuration réelle (par son NOM)', [extensionDeLaConfig().entetes.origin === EXT_SERVEUR, /^chrome-extension:\/\//.test(extensionDeLaConfig().entetes.origin)], [true, true]);
    const fabriquee = 'chrome-extension://origineFabriqueeDuBanc';
    const extFabriquee = extensionDeLaConfig(() => ({ origines: { extension: fabriquee } }));
    const clFab = await jouer({ seulement: ['essaiClosInstallation'], roles: ROLES, extension: extFabriquee, origineAcceptee: fabriquee });
    H.v('   la configuration est SUBSTITUÉE par une origine fabriquée : l\'outil la lit, et l\'installation part avec CETTE origine (pas avec une constante)', [extFabriquee.entetes.origin, clFab.res.filter(r => !r.ok).map(r => r.nom), parInstall(clFab.appelsApi).length >= 4 && parInstall(clFab.appelsApi).every(a => a.origin === fabriquee)], [fabriquee, [], true]);
    let illisible = null; try { extensionDeLaConfig(() => ({ origines: { extension: 'https://rat-market.fr' } })); } catch (e) { illisible = e.message; }
    H.vrai('   une origine qui n\'est pas celle d\'une extension est refusée', illisible && /illisible/.test(illisible));
    // la connexion : le fetch est substitué par le banc (statut inattendu, cookie absent, cookie présent)
    const { connecter } = require('../admin/abonnements/parcours-test');
    const faireReponse = (status, cookies = []) => async () => ({ status, headers: { getSetCookie: () => cookies, get: () => null } });
    const essaye = async f => { try { return await connecter('https://essai.exemple', { role: 'parrain', email: 'x@exemple.invalid', motDePasse: 'mdp-du-banc' }, f); } catch (e) { return `ERREUR ${e.message}`; } };
    H.v('   la connexion de l\'outil : un statut inattendu est refusé en le nommant (rôle et HTTP, ni mot de passe ni cookie), un 200 sans cookie aussi, un 200 avec cookie rend le cookie de session', [await essaye(faireReponse(403)), await essaye(faireReponse(200, [])), await essaye(faireReponse(200, ['rm_session=abcDEF123_-; Path=/; HttpOnly']))],
        ['ERREUR connexion du compte « parrain » refusée (HTTP 403)', 'ERREUR connexion du compte « parrain » : pas de cookie de session', 'rm_session=abcDEF123_-']);
    H.v('   les en-têtes de l\'outil : ceux que l\'on passe l\'emportent sur ceux du site (l\'origine du site n\'est qu\'un défaut), et sans corps le site n\'est pas annoncé',
        [entetesDeLApi({ cookie: 'rm_session=x', entetes: { origin: autre }, avecCorps: true }).origin, entetesDeLApi({ cookie: 'rm_session=x', entetes: {}, avecCorps: true }).origin, entetesDeLApi({ cookie: 'rm_session=x', entetes: {}, avecCorps: false }).origin],
        [autre, 'https://rat-market.fr', undefined]);
    const filleulTarde = (e, f) => e.type === 'invoice.paid' && e.data.object.amount_paid > 0 && (f.E.customers.get(e.data.object.customer) || {}).email === 'parcours-filleul@exemple.invalid';
    const tardif = await jouer({ seulement: ['parrainage'], roles: ROLES, retarder: filleulTarde, apresAttentes: 3, attenteAvoirS: 30 });
    H.v('parrainage, la facture du filleul arrive EN RETARD : le parcours attend l\'avoir (chez Stripe ET dans le statut) AVANT d\'avancer l\'horloge vers la facture du parrain, et ne subit aucun échec', [tardif.res.filter(r => !r.ok).map(r => r.nom), tardif.avances.length, tardif.avances[1] && [tardif.avances[1].avoirs, tardif.avances[1].appliquees]], [[], 2, [1, 1]]);
    const jamais = await jouer({ seulement: ['parrainage'], roles: ROLES, retarder: filleulTarde, apresAttentes: -1, attenteAvoirS: 6 });
    const echecAvoir = jamais.res.filter(r => !r.ok);
    H.v('   l\'avoir qui n\'arrive JAMAIS : l\'attente est bornée, la raison est imprimée (chez Stripe, dans le statut), et l\'horloge n\'est PAS avancée vers la facture du parrain', [echecAvoir.length, /avoir/.test((echecAvoir[0] || {}).nom + (echecAvoir[0] || {}).detail), /Stripe/.test((echecAvoir[0] || {}).detail || ''), /statut/.test((echecAvoir[0] || {}).detail || ''), jamais.avances.length], [1, true, true, true, 1]);
    const iFin = jamais.trace.findIndex(l => /ÉCHEC/.test(l)), iDel = jamais.trace.indexOf('<<horloge supprimée>>');
    H.vrai('   et l\'horloge n\'est supprimée qu\'APRÈS ses contrôles (le constat d\'échec est écrit avant la suppression)', iFin >= 0 && iDel > iFin);
    // B-M2 : l'attente de l'avoir se mesure en TEMPS RÉEL (horloge injectée) : chaque lecture chez Stripe dure 5 s, chaque pas 3 s ; 30 s de borne = 4 à 5 lectures, pas 11 (les pas additionnés)
    const lente = await jouer({ seulement: ['parrainage'], roles: ROLES, retarder: filleulTarde, apresAttentes: -1, attenteAvoirS: 30, lenteurListeMs: 5000 });
    const lectures = lente.faux.E.appels.filter(a => a.nom === 'customers.listBalanceTransactions').length;
    H.v('l\'attente de l\'avoir se mesure en temps RÉEL : lectures de 5 s et pas de 3 s, bornées à 30 s (peu de lectures, pas onze pas additionnés), l\'échec est dit', [lectures <= 9, lente.res.filter(r => !r.ok).length], [true, 1]);
    console.log(`   (lectures des avoirs chez Stripe pendant l'attente : ${lectures})`);
    // PARCOURS-FACTURE : le calendrier du VRAI Stripe — mois de 31 jours (octobre à novembre) et factures de renouvellement finalisées une heure après leur création (c'est là que l'avoir est appliqué).
    // Le parrain renouvelle alors à t0 + 31 jours, pile à la fin de la première avance d'horloge : sa facture naît en brouillon, l'avoir du filleul arrive, et c'est CETTE facture qui le consomme —
    // la plus récente (le renouvellement suivant) vaut 499. L'outil doit juger la première facture créée après l'avoir, pas la plus récente.
    const { JOUR } = require('./_faux-stripe');
    const calendrierReel = () => creerFauxStripe({ clientsParHorloge: 3, moisS: 31 * JOUR, finalisationS: 3600 });
    const reel = await jouer({ faux: calendrierReel(), seulement: ['parrainage'], roles: ROLES });
    const judgee = reel.res.find(r => /la facture suivante du parrain est à 0/.test(r.nom));
    H.v('parrainage au calendrier de Stripe (mois de 31 jours, finalisation différée) : aucun échec, la facture jugée porte 0 € dû, un solde de départ de -499 et un renouvellement', [reel.res.filter(r => !r.ok).map(r => `${r.nom} — ${r.detail}`), judgee && judgee.ok, judgee && judgee.detail], [[], true, 'amount_due 0, starting_balance -499, billing_reason subscription_cycle']);
    // la preuve de l'hypothèse sur le faux Stripe : au calendrier réel, l'avoir est consommé par la PREMIÈRE facture de renouvellement du parrain, et la plus récente vaut 499 (l'ancien outil jugeait celle-là)
    const parrainSub = [...reel.faux.E.subs.values()].find(s => !s.trialStart && !s.metadata.parrain);       // l'abonnement du parrain : sans essai, sans parrain (ses clients sont supprimés avec l'horloge)
    H.vrai('   (l\'abonnement du parrain est bien retrouvé)', Boolean(parrainSub));
    const sesFactures = (await reel.faux.invoices.list({ subscription: parrainSub.id })).data.sort((a, b) => a.created - b.created);
    H.v('   au calendrier réel : le parrain a au moins 3 factures (création, renouvellement qui reçoit l\'avoir, renouvellement suivant) ; seul le premier renouvellement est à 0 € et la plus récente vaut 499',
        [sesFactures.length >= 3, sesFactures.filter(i => i.billing_reason === 'subscription_cycle').map(i => i.amount_due).slice(0, 2), sesFactures.at(-1).amount_due, sesFactures.at(-1).status], [true, [0, 499], 499, 'paid']);
    // il SAIT échouer : un Stripe qui n'applique pas l'avoir ; l'échec est dit AVEC ses trois valeurs et le diagnostic (liste des factures du parrain, solde du client), écrit avant la suppression de l'horloge
    const sansSolde = await jouer({ faux: creerFauxStripe({ clientsParHorloge: 3, moisS: 31 * JOUR, finalisationS: 3600, ignorerSolde: true }), seulement: ['parrainage'], roles: ROLES });
    const koSolde = sansSolde.res.filter(r => !r.ok);
    const iDiag = sansSolde.trace.findIndex(l => /diagnostic : avoir créé/.test(l)), iSuppr = sansSolde.trace.indexOf('<<horloge supprimée>>');
    H.v('un Stripe qui n\'applique pas l\'avoir : le parcours ÉCHOUE en imprimant les trois valeurs (amount_due 499, starting_balance -499, billing_reason), puis le diagnostic AVANT la suppression de l\'horloge',
        [koSolde.length, koSolde[0] && koSolde[0].detail, iDiag >= 0 && iSuppr > iDiag], [1, 'amount_due 499, starting_balance -499, billing_reason subscription_cycle', true]);
    const lignesDiag = sansSolde.trace.filter(l => /diagnostic : facture/.test(l));
    H.v('   le diagnostic liste chaque facture du parrain (date, motif, total, solde de départ, dû, statut), marque la jugée, donne le solde du client — et ne porte ni clé ni adresse',
        [lignesDiag.length >= 3, lignesDiag.filter(l => /<= jugée/.test(l)).length, lignesDiag.every(l => /starting_balance/.test(l) && /amount_due/.test(l) && /statut/.test(l)), sansSolde.trace.some(l => /solde du client du parrain -499 centimes/.test(l)), sansSolde.trace.some(l => /sk_test_|whsec_|@|https?:/.test(l.replace(/exemple\.invalid/g, '')) && /diagnostic/.test(l))],
        [true, 1, true, true, false]);
    // une facture du parrain créée après l'avoir qui n'existe pas : l'échec le dit
    const fauxVide = calendrierReel(); const listeOrig = fauxVide.invoices.list; fauxVide.invoices.list = async (p = {}) => ({ data: (await listeOrig(p)).data.filter(i => i.billing_reason !== 'subscription_cycle') });      // Stripe ne rend aucun renouvellement
    const aucune = await jouer({ faux: fauxVide, seulement: ['parrainage'], roles: ROLES });
    const koAucune = aucune.res.filter(r => !r.ok);
    H.v('   si aucune facture du parrain n\'existe après l\'avoir : l\'échec le dit, et le diagnostic le dit aussi', [koAucune.length, koAucune[0] && /aucune facture du parrain créée après l'avoir/.test(koAucune[0].detail), aucune.trace.some(l => /diagnostic : avoir créé/.test(l))], [1, true, true]);
    // B-M4 : un échec de suppression de l'horloge est NOTÉ (type et code, jamais le message qui pourrait citer une clé).
    // Le leurre de clé est fabriqué par morceaux : la garde d'avant push ne doit voir aucune forme de clé dans le dépôt.
    const suppr = await jouer({ seulement: ['essaiSansCarte'], roles: ['sanscarte'], delEchoue: Object.assign(new Error('clé ' + ['sk', 'test', 'SECRETDUBANC'].join('_') + ' refusée'), { type: 'StripeAPIError', code: 'api_error' }) });
    const noteDel = suppr.res.filter(r => !r.ok);
    H.v('un échec de suppression de l\'horloge n\'est plus avalé : il est noté avec son type et son code, sans le message ni aucune clé', [noteDel.length, noteDel[0] && /StripeAPIError api_error/.test(noteDel[0].detail), noteDel[0] && /sk_test_|SECRETDUBANC/.test(noteDel[0].nom + noteDel[0].detail + suppr.trace.join(' '))], [1, true, false]);
    H.vrai('   et la limite du statut est écrite en clair dans le compte rendu du parrainage', tardif.trace.some(l => /statut du parrain ne compte pas encore ce mois offert \(limite connue, notée sans bloquer/.test(l) && /bloquent l'avoir chez Stripe et la facture suivante du parrain à 0/.test(l)));

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
