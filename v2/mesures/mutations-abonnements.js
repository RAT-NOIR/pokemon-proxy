'use strict';
// LE JEU DE MUTATIONS DES GARDES D'ARGENT (STRIPE-V2). Rejouable : `node v2/mesures/mutations-abonnements.js` (tout) ou `... --seulement=<fragment du nom>`.
// Principe : on CASSE une garde à la fois, dans une COPIE du fichier faite dans le dossier temporaire (le dépôt n'est jamais touché : accroche-mutant.js fait compiler la copie à la place du
// fichier), on lance le banc qui la protège, et il DOIT devenir rouge. Un mutant qui reste vert est « survivant » : une garde que rien ne vérifie. Les équivalents (changement sans effet
// observable) sont déclarés avec leur raison. N'est JAMAIS lancé par lancer-tout.js (qui ne lit que v2/test) ; chaque ancre doit exister EXACTEMENT UNE fois (test-abonnements-config.js le vérifie).
// Besoin : la base de banc en mémoire (MONGOMS_DOWNLOAD_DIR vers le cache de mongod, comme pour les bancs).
const fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process');
const V = path.join(__dirname, '..');
const BANCS = 'test';

// [nom, fichier (relatif à v2/), ancre, remplacement, banc, équivalent? (raison)]
const MUTANTS = [
    // — webhook : signature, registre, mode —
    ['signature non vérifiée', 'abonnements/webhook.js', "evt = Cl.obtenir(cfgAbo).webhooks.constructEvent(req.body, sig, cfgAbo.webhookSecret, SIGNATURE_TOLERANCE_S);", "evt = JSON.parse(req.body.toString('utf8'));", 'test-abonnements-webhook.js'],
    ['signature : mauvais secret', 'abonnements/webhook.js', "constructEvent(req.body, sig, cfgAbo.webhookSecret, SIGNATURE_TOLERANCE_S)", "constructEvent(req.body, sig, 'whsec_unautresecret', SIGNATURE_TOLERANCE_S)", 'test-abonnements-webhook.js'],
    ['signature : tolérance de plusieurs jours', 'abonnements/webhook.js', "const SIGNATURE_TOLERANCE_S = 300;", "const SIGNATURE_TOLERANCE_S = 900000;", 'test-abonnements-webhook.js'],
    ['registre : un événement déjà traité est retraité', 'abonnements/webhook.js', "if (FINAUX.has(doc.etat)) return { fait: true };", "", 'test-abonnements-webhook.js'],
    ['mode live accepté sur un service test', 'abonnements/webhook.js', "if ((cfgAbo.mode === 'live') !== (evt.livemode === true))", "if (false)", 'test-abonnements-webhook.js'],
    // — état du compte —
    ['désordre : toujours appliquer', 'abonnements/etat.js', "    if (version > entree.version) return { appliquer: true };\n    if (version === entree.version && (RANG[statut] ?? 0) >= (RANG[entree.statut] ?? 0)) return { appliquer: true };\n    return { appliquer: false, raison: 'desordre' };", "    return { appliquer: true };", 'test-abonnements-webhook.js'],
    ['impayé : la grâce se prolonge', 'abonnements/etat.js', "entree && entree.statut === 'past_due' && entree.jusquAu instanceof Date ? entree.jusquAu : ", "", 'test-abonnements-webhook.js'],
    ['prix inconnu : Pro quand même', 'abonnements/etat.js', "(s.statut === 'trialing' || s.statut === 'active') && s.offre && bornee) {", "(s.statut === 'trialing' || s.statut === 'active') && bornee) {", 'test-abonnements-webhook.js'],
    ['marge de renouvellement : supprimée', 'abonnements/offres.js', "const MARGE_RENOUVELLEMENT_HEURES = 48;", "const MARGE_RENOUVELLEMENT_HEURES = 0;", 'test-abonnements-webhook.js'],
    ['marge de renouvellement : aussi pour une résiliation', 'abonnements/etat.js', "jusquAu: s.resiliation ? bornee : new Date(", "jusquAu: false ? bornee : new Date(", 'test-abonnements-webhook.js'],
    ['grâce d\'impayé : 30 jours', 'abonnements/offres.js', "GRACE_IMPAYE_JOURS = 3;", "GRACE_IMPAYE_JOURS = 30;", 'test-abonnements-webhook.js'],
    ['plusieurs abonnements : le dernier écrase (le Pro tombe avec lui)', 'abonnements/etat.js', "return { actif: vivants.length > 0, jusquAu: principal.jusquAu, principal, double: vivants.length > 1 };", "return { actif: principal.actif === true, jusquAu: principal.jusquAu, principal: liste.sort((a, b) => (b.creeSub ?? 0) - (a.creeSub ?? 0))[0], double: vivants.length > 1 };", 'test-abonnements-webhook.js'],
    ['plusieurs abonnements : le doublon n\'est pas signalé', 'abonnements/etat.js', "if (ag.double) signaux.push('double-abonnement');", "", 'test-abonnements-webhook.js'],
    ['prix Fondateurs sans place : accordé', 'abonnements/etat.js', "&& !(await aUnePlace(compte._id, evtDate))) {", "&& false) {", 'test-abonnements-webhook.js'],
    ['checkout.session.completed rejoué : la prime n\'est pas reprise', 'abonnements/webhook.js', " || (res.etat === 'ignore' && res.raison === 'deja-connu')", "", 'test-abonnements-parrainage.js'],
    // — routes : Checkout, portail, essai, places, codes —
    ['CGV non exigées', 'abonnements/routes.js', "consent_collection: { terms_of_service: 'required' },", "", 'test-abonnements-routes.js'],
    ['essai accordé à chaque fois', 'abonnements/routes.js', "if (s && (s.essaiUtilise || s.sid)) return false;", "", 'test-abonnements-routes.js', 'depuis STRIPE-DECISIONS la même condition est relue par la garde de l\'essai (essai.js, « essai-deja-utilise ») : retirer cette copie ne change rien d\'observable ; la copie de essai.js a son propre mutant ci-dessous'],
    ['garde : un compte qui a déjà eu un essai ou un abonnement en reçoit un autre (essai.js)', 'abonnements/essai.js', "if (s && (s.essaiUtilise || s.sid)) return { permis: false, detail: 'essai-deja-utilise' };", "", 'test-abonnements-decisions.js'],
    ['code Fondateurs non vérifié', 'abonnements/routes.js', "reessayerDans: essaisF.reessayerDans });\n                if (!abo().fondateurs.ouvert || !Cfg.codeFondateursValide(b.code, abo().fondateurs.empreinteCode)) return entree(res, 'code-invalide', 422);", "reessayerDans: essaisF.reessayerDans });", 'test-abonnements-routes.js'],
    ['places : plus de plafond', 'abonnements/fondateurs.js', "for (let k = 0; k < max; k++) {", "for (let k = 0; k < max + 7; k++) {", 'test-abonnements-routes.js'],
    ['places : la vérification du reste est retirée', 'abonnements/fondateurs.js', "if ((await occupees(maintenant)) >= max) return { ok: false, raison: 'epuisees' };", "", 'test-abonnements-routes.js', 'pré-contrôle d\'optimisation : la boucle d\'insertion refuse déjà au-delà du plafond'],
    ['un seul abonnement : un second Checkout est permis', 'abonnements/routes.js', "if (await dejaAbonne(stripe, compte)) return conflit(res, 'abonnement-actif');", "", 'test-abonnements-routes.js'],
    ['un seul abonnement : les sessions ouvertes ne sont pas expirées', 'abonnements/routes.js', "if (o.id !== session.id) await stripe.checkout.sessions.expire(o.id)", "if (false) await stripe.checkout.sessions.expire(o.id)", 'test-abonnements-routes.js'],
    ['un seul abonnement : la session en cours est elle-même expirée', 'abonnements/routes.js', "if (o.id !== session.id) await", "if (true) await", 'test-abonnements-routes.js'],
    ['portail : toujours la configuration Pro', 'abonnements/routes.js', "configuration = abo().portail[offre];", "configuration = abo().portail.pro;", 'test-abonnements-routes.js'],
    ['portail : repli sur la configuration Pro quand celle des Fondateurs manque', 'abonnements/routes.js', "configuration = abo().portail[offre];", "configuration = abo().portail[offre] || abo().portail.pro;", 'test-abonnements-routes.js'],
    ['clé d\'idempotence du Checkout sans le code de parrainage', 'abonnements/routes.js', "'p' + crypto.createHash('sha256').update(Pa.normaliserCodeParrainage(b.code)).digest('hex').slice(0, 12)", "'p'", 'test-abonnements-routes.js'],
    ['client Stripe : jamais retrouvé, toujours créé', 'abonnements/routes.js', "c = r && Array.isArray(r.data) && r.data[0] && !r.data[0].deleted ? r.data[0] : null;", "c = null;", 'test-abonnements-routes.js'],
    ['montants publics : toujours les constantes', 'abonnements/prix-publics.js', "if (montant(m) && montant(a) && m.recurring.interval === 'month' && a.recurring.interval === 'year') valeur =", "if (false) valeur =", 'test-abonnements-routes.js'],
    ['CORS du site : /api/abonnement retiré', 'transport/cors.js', ", /^\\/api\\/abonnement(\\/.*)?$/]", "]", 'test-abonnements-routes.js'],
    ['index des abonnements : jamais exigés', 'modeles.js', "(avecAbonnements === true ? TOUS : INDEX)", "INDEX", 'test-abonnements-routes.js'],
    ['index des abonnements : toujours exigés', 'modeles.js', "(avecAbonnements === true ? TOUS : INDEX)", "TOUS", 'test-abonnements-routes.js'],
    // — parrainage —
    ['parrainage de soi-même permis', 'abonnements/parrainage.js', "if (String(parrain._id) === String(filleul._id)) return false;", "", 'test-abonnements-parrainage.js'],
    ['prime : plusieurs par filleul', 'abonnements/primes.js', "await col('abo_primes').insertOne({ _id: filleul._id, parrainId: parrain._id, etat: 'a-appliquer', creeLe: maintenant, factureId });", "await col('abo_primes').insertOne({ parrainId: parrain._id, filleulId: filleul._id, etat: 'a-appliquer', creeLe: maintenant, factureId });", 'test-abonnements-parrainage.js'],
    ['première facture à 0 € déclenche la prime', 'abonnements/webhook.js', "if (montant > 0) {", "if (true) {", 'test-abonnements-parrainage.js'],
    // — tour 2 : avoir du parrain, I1/I2/I3, M1 à M4 —
    ["C1 avoir : un parrain annuel reçoit une année (le montant suit la période)","abonnements/primes.js","{ amount: -montant, currency: O.DEVISE,","{ amount: -(st.periode === 'an' ? 3900 : montant), currency: O.DEVISE,","test-abonnements-parrainage.js"],
    ["M3 avoir : la relecture des transactions de solde est supprimée","abonnements/primes.js","const dejaPose = poses.has(String(filleulId));","const dejaPose = false;","test-abonnements-parrainage.js"],
    ["M2 prime : posée sur un abonnement en résiliation programmée","abonnements/primes.js","if (st.resiliation === true) return attente(filleulId, 'en-attente-resiliation');","","test-abonnements-parrainage.js"],
    ["M2 prime : jamais abandonnée quand le parrain finit","abonnements/primes.js","if (prime.etat === 'en-attente-resiliation' && st && st.sid && TERMINAUX.includes(st.statut)) {","if (false) {","test-abonnements-parrainage.js"],
    ["prime : un Fondateurs peut être parrain","abonnements/primes.js","if (sp && sp.offre === 'fondateurs') return 'parrain-fondateurs';","","test-abonnements-parrainage.js"],
    ["M1 prime : le parrainage réciproque est payé","abonnements/primes.js","return 'reciproque';","return null;","test-abonnements-parrainage.js"],
    ["M1 Checkout : le parrainage réciproque est accepté","abonnements/parrainage.js","if (sp && ((sp.parrain && String(sp.parrain) === String(filleul._id)) || (sp.parrainPrevu && String(sp.parrainPrevu) === String(filleul._id)))) return false;","","test-abonnements-routes.js"],
    ["Checkout : le code d'un Fondateurs est accepté","abonnements/parrainage.js","if (sp && sp.offre === 'fondateurs') return false;","","test-abonnements-routes.js"],
    ["M1 Checkout : le parrainage annoncé n'est pas noté","abonnements/routes.js","if (parrain) await col('comptes').updateOne({ _id: compte._id }, { $set: { 'abonnement.stripe.parrainPrevu': parrain._id } });","","test-abonnements-routes.js"],
    ["I1 : l'échec d'une autre session rend la réservation de la première","abonnements/routes.js","reserveePour = place.deja ? null : compte._id;","reserveePour = compte._id;","test-abonnements-routes.js"],
    ["I1 : la réservation n'est pas attachée à sa session","abonnements/routes.js","if (b.offre === 'fondateurs') await Fo.attacher(compte._id, session.id);","","test-abonnements-routes.js"],
    ["I1 : la session expirée rend n'importe quelle réservation du compte","abonnements/fondateurs.js","col(COL).deleteOne({ compteId, etat: 'reservee', sessionId })","col(COL).deleteOne({ compteId, etat: 'reservee' })","test-abonnements-webhook.js"],
    ["I1 : checkout.session.expired ne rend rien","abonnements/webhook.js","const r = await Fo.libererSession(compteId, s.id);","const r = { deletedCount: 0 };","test-abonnements-webhook.js"],
    ["I1 : un payeur sans place est privé de son Pro","abonnements/etat.js","const repris = await Fo.reserver(compte._id, cfgAbo.fondateurs.places, evtDate);","const repris = { ok: false }; effectif.offre = null;","test-abonnements-webhook.js"],
    ["I1 : le dépassement n'est ni compté ni signalé","abonnements/etat.js","await Fo.marquerDepassement(compte._id, evtDate); signaux.push('fondateurs-depassement');","","test-abonnements-webhook.js"],
    ["I3 : la place est confirmée pendant l'essai","abonnements/etat.js","if (s.statut === 'active' && effectif.offre === 'fondateurs') await Fo.confirmer(","if (effectif.offre === 'fondateurs') await Fo.confirmer(","test-abonnements-webhook.js"],
    ["I3 : la réservation de l'essai n'est pas prolongée","abonnements/etat.js","await Fo.prolonger(compte._id, new Date(s.finEssai * 1000 + MARGE_ESSAI_PLACE_JOURS * 86400e3));","","test-abonnements-webhook.js"],
    ["I3 : l'essai qui meurt ne rend pas sa place","abonnements/etat.js","else if (TERMINAUX.includes(s.statut) || s.statut === 'unpaid') await Fo.liberer(compte._id);","","test-abonnements-webhook.js"],
    ["I3 : la première facture payée ne confirme pas la place","abonnements/webhook.js","if (offre === 'fondateurs') await Fo.confirmer(","if (false) await Fo.confirmer(","test-abonnements-webhook.js"],
    ["I2 : l'orphelin n'est pas résilié","abonnements/webhook.js","if (res.etat === 'rejete' && res.raison === 'compte-inconnu') await resilierOrphelin(","if (false) await resilierOrphelin(","test-abonnements-webhook.js"],
    ["I2 : l'orphelin est résilié avec prorata et facture finale","abonnements/webhook.js","{ prorate: false, invoice_now: false }","{ prorate: true, invoice_now: true }","test-abonnements-webhook.js"],
    ["I2 : un abonnement qui n'est pas le nôtre (sans compteId) est résilié","abonnements/webhook.js"," || !s.compteMeta) return;",") return;","test-abonnements-webhook.js"],
    ["I2 : la suppression laisse les sessions de paiement ouvertes","abonnements/suppression.js","for (const o of (ouvertes && ouvertes.data) || []) await stripe.checkout.sessions.expire(o.id);","","test-abonnements-routes.js"],
    ["M4 : le client Stripe n'est pas anonymisé","abonnements/suppression.js","finaliser: async () => { await stripe.customers.update(client, {","finaliser: async () => { await (async () => ({}))({","test-abonnements-routes.js"],
    ["M4 : Stripe en panne ne refuse pas la suppression","abonnements/suppression.js","return { ok: false, statut: 503, code: 'INDISPONIBLE', detail: 'paiement-indisponible' };","return { ok: true, finaliser: local };","test-abonnements-routes.js"],
    ["suppression de compte : un abonnement vivant est toléré (drapeau éteint compris)","abonnements/suppression.js","BLOQUANTS.includes(e.statut) && !e.resiliation)) return { ok: false","false)) return { ok: false","test-abonnements-routes.js"],
    // — outils —
    ['provisionnement : le prix existant au mauvais montant est toléré', 'admin/abonnements/provisionner-lib.js', "if (ecartDe.length) throw", "if (false) throw", 'test-abonnements-provisionnement.js'],
    ['provisionnement : le produit est retrouvé par son nom', 'admin/abonnements/provisionner-lib.js', "p.metadata && p.metadata.rm_cle === cle", "p.name === O.CATALOGUE[offre].nom || (p.metadata && p.metadata.rm_cle === cle)", 'test-abonnements-provisionnement.js'],
    ['provisionnement : l\'endpoint reste si la pose du secret échoue', 'admin/abonnements/provisionner-lib.js', "try { if (typeof stripe.webhookEndpoints.del === 'function') await stripe.webhookEndpoints.del(e.id);", "try { if (false) await stripe.webhookEndpoints.del(e.id);", 'test-abonnements-provisionnement.js'],
    ['portails : un seul produit par configuration → les deux produits', 'admin/abonnements/provisionner-lib.js', "products: [{ product: rapport.ids.produits[offre], prices: O.PERIODES.map(p => prix(O.lookupKey(offre, p))) }] }", "products: O.OFFRES.map(o => ({ product: rapport.ids.produits[o], prices: O.PERIODES.map(p => prix(O.lookupKey(o, p))) })) }", 'test-abonnements-provisionnement.js'],
    ['portails : l\'ancienne configuration à deux produits garde son changement de plan', 'admin/abonnements/provisionner-lib.js', "await stripe.billingPortal.configurations.update(ancienne.id, { features: { subscription_update: { enabled: false } } });", "", 'test-abonnements-provisionnement.js'],
    ['poserSurRender : le diff trop large n\'arrête pas', 'admin/abonnements/poser-sur-render.js', "if (autres.length || d.retires.length) throw", "if (false) throw", 'test-abonnements-provisionnement.js'],
    ['poserSurRender : variable quelconque permise', 'admin/abonnements/poser-sur-render.js', "if (!VARIABLES_PERMISES.includes(nom)) throw", "if (false) throw", 'test-abonnements-provisionnement.js'],
    ['poserSurRender : pas de relecture', 'admin/abonnements/poser-sur-render.js', "if (ecarts.length) throw", "if (false) throw", 'test-abonnements-provisionnement.js'],
    ['poserSurRender : le nombre de variables n\'est pas comparé', 'admin/abonnements/poser-sur-render.js', "if (!Array.isArray(verif) || verif.length !== avant.length) throw", "if (false) throw", 'test-abonnements-provisionnement.js'],
    ['parcours : un état jamais atteint passe pour réussi', 'admin/abonnements/parcours-lib.js', "throw new AttentePerdue(", "return dernier; throw new AttentePerdue(", 'test-abonnements-parcours.js'],
    // — configuration —
    ['configuration : la clé s\'énumère', 'abonnements/config.js', "for (const k of ['cle', 'webhookSecret']) Object.defineProperty(base, k, { value: base[k], enumerable: false,", "for (const k of ['cle', 'webhookSecret']) Object.defineProperty(base, k, { value: base[k], enumerable: true,", 'test-abonnements-config.js'],
    ['configuration : les deux portails peuvent être le même', 'abonnements/config.js', "if (base.portail.pro && base.portail.pro === base.portail.fondateurs) {", "if (false) {", 'test-abonnements-config.js'],
    // — STRIPE-DECISIONS : l'essai sans carte et sa garde —
    ['essai : la carte est exigée dès le Checkout (always)', 'abonnements/routes.js', "payment_method_collection: 'if_required', allow_promotion_codes", "payment_method_collection: 'always', allow_promotion_codes", 'test-abonnements-decisions.js'],
    ['essai : la fin sans moyen de paiement ne résilie plus (une facture serait tentée)', 'abonnements/routes.js', "trial_settings: { end_behavior: { missing_payment_method: 'cancel' } }", "trial_settings: { end_behavior: { missing_payment_method: 'create_invoice' } }", 'test-abonnements-decisions.js'],
    ['garde : la clé est l\'adresse du compte, pas sa BOÎTE (a+x@ et a@ ont chacun leur essai)', 'abonnements/essai.js', "cleBoite(compte.emailCle)", "compte.emailCle", 'test-abonnements-decisions.js'],
    ['garde : les installations du compte ne sont pas lues', 'abonnements/essai.js', "for (const inst of await installationsDuCompte(compte._id)) cles.push(", "for (const inst of []) cles.push(", 'test-abonnements-decisions.js'],
    ['garde : une installation DÉLIÉE n\'est plus comptée (comptesLies ignoré)', 'abonnements/essai.js', "{ $or: [{ compteId }, { comptesLies: compteId }] }", "{ compteId }", 'test-abonnements-decisions.js'],
    ['garde : la liaison ne laisse aucune trace durable (comptesLies)', 'installations/liaison.js', "$addToSet: { comptesLies: compte._id } }", "}", 'test-abonnements-decisions.js'],
    ['garde : le domaine jetable est toléré', 'abonnements/essai.js', "estJetable(compte.emailCle.split('@')[1] || '')", "false", 'test-abonnements-decisions.js'],
    ['garde : la ligne d\'un AUTRE compte ne bloque pas', 'abonnements/essai.js', "String(d.compteId) !== String(compteId) &&", "false &&", 'test-abonnements-decisions.js'],
    ['garde : la réservation n\'est pas atomique (aucune ligne écrite au Checkout)', 'abonnements/essai.js', "const r = await prendre(c, compte._id, jours, maintenant);", "const r = { ok: true, cree: false };", 'test-abonnements-decisions.js'],
    ['garde : le webhook ne confirme pas l\'essai (la ligne reste une réservation qui expire)', 'abonnements/etat.js', "const g = await Essai.confirmer(compte, evtDate);", "const g = { clore: false };", 'test-abonnements-decisions.js'],
    ['garde : un refus de l\'essai refuse aussi l\'abonnement', 'abonnements/routes.js', "else essai = false;", "else return indispo(res, 'essai-refuse');", 'test-abonnements-decisions.js'],
    ['garde : la réservation n\'est pas rendue quand Stripe échoue', 'abonnements/routes.js', "if (compteEssai) await Essai.rendre(compteEssai, essaiReserve).catch(() => { /* la réservation expire seule */ });", "", 'test-abonnements-decisions.js'],
    ['index de confort de l\'essai : exigés (déployer avant de les créer fermerait les routes)', 'modeles.js', "(avecAbonnements === true ? TOUS : INDEX)", "(avecAbonnements === true ? CREES : INDEX)", 'test-abonnements-decisions.js'],
    // — la carte pendant l'essai, les dates du statut —
    ['carte : Stripe injoignable est lu comme « sans carte » (une affirmation fausse)', 'abonnements/carte.js', "catch (e) { console.error(`🔴 [v2 abonnements] carte pendant l'essai", "catch (e) { valeur = false; console.error(`🔴 [v2 abonnements] carte pendant l'essai", 'test-abonnements-decisions.js'],
    ['carte : une carte inconnue (null) est annoncée sans carte', 'abonnements/routes.js', "(extras.carte === true || extras.carte === false) ? extras.carte : null;", "extras.carte === true;", 'test-abonnements-decisions.js'],
    ['statut : un essai sans carte n\'annonce pas sa fin', 'abonnements/routes.js', "resiliationPrevue: resiliationExplicite || essaiSansCarte,", "resiliationPrevue: resiliationExplicite,", 'test-abonnements-decisions.js'],
    ['statut : un essai sans carte annonce un renouvellement', 'abonnements/routes.js', "(statut === 'actif' || (essaiEnCours && carte === true))", "(statut === 'actif' || essaiEnCours)", 'test-abonnements-decisions.js'],
    ['statut : la fin de la grâce de l\'impayé n\'est pas donnée', 'abonnements/routes.js', "maintienJusqua: grace ? dateIso(s.jusquAu) : null,", "maintienJusqua: null,", 'test-abonnements-decisions.js'],
    ['statut : le début de l\'essai n\'est pas lu chez Stripe', 'abonnements/etat.js', "debutEssai: nombre(sub && sub.trial_start),", "debutEssai: null,", 'test-abonnements-decisions.js'],
    ['statut : le quota ne dit pas les analyses du jour', 'abonnements/routes.js', "utilisees: await Offre.prisAuJour(porteur, Offre.jourDeParis(maintenant)) };", "utilisees: 0 };", 'test-abonnements-decisions.js'],
    // — le plafond du parrainage —
    ['plafond : aucun (tous les filleuls sont crédités)', 'abonnements/primes.js', "if (!dejaPose && (await moisDansLaFenetre(parrain._id, filleulId, decision)) >= O.PLAFOND_PARRAINAGE_MOIS) {", "if (false) {", 'test-abonnements-decisions.js'],
    ['plafond : 13 mois au lieu de 12', 'abonnements/offres.js', "const PLAFOND_PARRAINAGE_MOIS = 12;", "const PLAFOND_PARRAINAGE_MOIS = 13;", 'test-abonnements-decisions.js'],
    ['plafond : la fenêtre ne glisse jamais (3 650 jours)', 'abonnements/offres.js', "const FENETRE_PARRAINAGE_JOURS = 365;", "const FENETRE_PARRAINAGE_JOURS = 3650;", 'test-abonnements-decisions.js'],
    ['plafond : compté sans verrou (deux primes simultanées se croisent)', 'abonnements/primes.js', "return (tenue ? (_, f) => f() : sousVerrou)(parrain._id, async () => {", "return ((p, f) => f())(parrain._id, async () => {", 'test-abonnements-decisions.js'],
    ['plafond : les mois offerts du statut ne sont pas bornés à la fenêtre', 'abonnements/primes.js', "etat: 'applique', appliqueLe: { $gt: fenetreDebut(maintenant), $lte: maintenant } });", "etat: 'applique' });", 'test-abonnements-decisions.js'],
    // — l'offre Fondateurs réservée —
    ['Fondateurs : la route rend l\'offre sans vérifier le code', 'abonnements/routes.js', "if (!abo().fondateurs.ouvert || !Cfg.codeFondateursValide(b.code, abo().fondateurs.empreinteCode)) return entree(res, 'code-invalide', 422);   // offre fermée = mauvais code", "", 'test-abonnements-decisions.js'],
    ['Fondateurs : l\'offre fermée se distingue d\'un mauvais code', 'abonnements/routes.js', "if (!abo().fondateurs.ouvert || !Cfg.codeFondateursValide(b.code, abo().fondateurs.empreinteCode)) return entree(res, 'code-invalide', 422);   // offre fermée = mauvais code", "if (!abo().fondateurs.ouvert) return entree(res, 'offre-fermee', 422); if (!Cfg.codeFondateursValide(b.code, abo().fondateurs.empreinteCode)) return entree(res, 'code-invalide', 422);", 'test-abonnements-decisions.js'],
    // — tour de correction 1 (relecture 1) —
    ['R1 : une installation liée APRÈS l\'essai n\'entre pas au registre', 'installations/liaison.js', "if (cfg) { try { await require('../abonnements/essai').noterLiaison(", "if (false) { try { await require('../abonnements/essai').noterLiaison(", 'test-abonnements-decisions.js'],
    ['R1b : la confirmation de l\'essai ne confirme que la boîte (pas les installations)', 'abonnements/essai.js', "for (const c of await clesDe(compte, cfgApp)) {", "for (const c of (await clesDe(compte, cfgApp)).slice(0, 1)) {", 'test-abonnements-decisions.js'],
    ['R1c : un essai qui n\'aurait pas dû démarrer n\'est pas clos', 'abonnements/etat.js', "if (g.clore && s.statut === 'trialing') {", "if (false) {", 'test-abonnements-decisions.js'],
    ['R2 : la confirmation d\'un essai ignore une boîte déjà confirmée par un autre compte', 'abonnements/essai.js', "if (d.etat === 'pris' && d.expireLe instanceof Date && d.expireLe.getTime() > evtDate.getTime()) return false;", "", 'test-abonnements-decisions.js'],
    ['R2 : la réservation de l\'essai ne couvre plus la session Checkout (75 min)', 'abonnements/offres.js', "const ESSAI_RESERVATION_MINUTES = 180;", "const ESSAI_RESERVATION_MINUTES = 75;", 'test-abonnements-decisions.js'],
    ['R4 : le plafond ne compte que les avoirs antérieurs à la date de l\'événement', 'abonnements/primes.js', "etat: 'applique', appliqueLe: { $gt: fenetreDebut(decision) } });", "etat: 'applique', appliqueLe: { $gt: fenetreDebut(decision), $lte: decision } });", 'test-abonnements-decisions.js'],
    ['R4 : la décision prend la date de l\'événement, pas l\'heure réelle', 'abonnements/primes.js', "const decision = new Date(Math.max(maintenant.getTime(), heure.getTime()));", "const decision = maintenant;", 'test-abonnements-decisions.js'],
    // — tour de correction 2 (relecture 2) —
    ['I1 : les primes voisines dont l\'avoir est déjà chez Stripe ne sont pas relues avant de compter', 'abonnements/primes.js', "for (const v of voisines) if (poses.has(String(v._id)))", "for (const v of []) if (poses.has(String(v._id)))", 'test-abonnements-decisions.js'],
    ['I1 : lecture Stripe en panne — les voisines ne comptent pas comme consommées', 'abonnements/primes.js', "moisDansLaFenetre(parrain._id, filleulId, decision)) + voisines.length + 1 >", "moisDansLaFenetre(parrain._id, filleulId, decision)) + 0 >", 'test-abonnements-decisions.js'],
    ['M2a : sans configuration armée la confirmation de l\'essai ne lève plus', 'abonnements/essai.js', "if (!cfgApp || !cfgApp.empreinte || !cfgApp.empreinte.secret) throw", "if (false) throw", 'test-abonnements-decisions.js'],
    ['M5 : le code Fondateurs redescend à 6 caractères (configuration)', 'abonnements/config.js', "if (n.length < CODE_FONDATEURS_MIN) faux(NOMS.code);", "if (n.length < 6) faux(NOMS.code);", 'test-abonnements-decisions.js'],
    ['M5 : le code Fondateurs redescend à 6 caractères (outil du lien)', 'admin/abonnements/lien-fondateurs-lib.js', "canonique.length < CODE_FONDATEURS_MIN ||", "canonique.length < 6 ||", 'test-abonnements-lien-fondateurs.js'],
    ['R5 : le plafond est décidé avant de lire l\'avoir déjà posé chez Stripe', 'abonnements/primes.js', "if (!dejaPose && (await moisDansLaFenetre(", "if ((await moisDansLaFenetre(", 'test-abonnements-decisions.js'],
    ['carte : une clé absente de l\'abonnement est lue comme « sans carte »', 'abonnements/carte.js', "if (!('default_payment_method' in sub)) return null;", "", 'test-abonnements-decisions.js'],
    ['verrou du parrain : la libération retire le verrou d\'un autre (sans expireLe)', 'abonnements/primes.js', "finally { await col(VERROUS).deleteOne({ _id, expireLe }).catch(", "finally { await col(VERROUS).deleteOne({ _id }).catch(", 'test-abonnements-decisions.js'],
    ['garde : un compte sans emailCle fait lever la garde', 'abonnements/essai.js', "typeof compte.emailCle !== 'string' || ", "", 'test-abonnements-decisions.js'],
    ['oracle : l\'offre fermée répond avant le compteur d\'essais du Checkout', 'abonnements/routes.js', "if (typeof b.code !== 'string') return entree(res, 'code-invalide', 422);\n                const essaisF", "if (typeof b.code !== 'string') return entree(res, 'code-invalide', 422);\n                if (!abo().fondateurs.ouvert) return entree(res, 'code-invalide', 422);\n                const essaisF", 'test-abonnements-decisions.js'],
    ['facture : le client est créé sans la mention légale', 'abonnements/routes.js', "metadata: { compteId: String(compte._id) }, invoice_settings: { footer: O.MENTION_FACTURE } }", "metadata: { compteId: String(compte._id) } }", 'test-abonnements-decisions.js'],
    ['facture : un client ancien ne reçoit pas la mention au Checkout', 'abonnements/routes.js', "await assurerPied(stripe, client);", "", 'test-abonnements-decisions.js'],
    ['facture : la mention n\'est pas la phrase de l\'éditeur', 'abonnements/offres.js', "const MENTION_FACTURE = 'TVA non applicable, art. 293 B du CGI';", "const MENTION_FACTURE = 'TVA non applicable';", 'test-abonnements-decisions.js'],
    ['facture : le Checkout demande automatic_tax', 'abonnements/routes.js', "payment_method_collection: 'if_required', allow_promotion_codes", "automatic_tax: { enabled: true }, payment_method_collection: 'if_required', allow_promotion_codes", 'test-abonnements-decisions.js'],
    ['Fondateurs : la route ne compte pas les essais de code (limite partagée)', 'abonnements/routes.js', "const compte = req.v2.porteur.compte;\n            const essais = await L.consommer(`abo-code:${String(compte._id)}`, { max: 10,", "const compte = req.v2.porteur.compte;\n            const essais = await L.consommer(`abo-code:${String(compte._id)}`, { max: 1000000,", 'test-abonnements-decisions.js'],
    ['Fondateurs : le prix fuit dans le statut public', 'abonnements/routes.js', "offres: { pro: prixPublics.pro, source: prixPublics.source,", "offres: { pro: prixPublics.pro, fondateurs: { mois: 299, an: 2900 }, source: prixPublics.source,", 'test-abonnements-decisions.js'],
    ['Fondateurs : la route est ouverte sans session', 'abonnements/routes.js', "router.post('/api/abonnement/fondateurs', ...parSession,", "router.post('/api/abonnement/fondateurs', resoudrePorteur(cfg),", 'test-abonnements-decisions.js'],
    ['Fondateurs : le portail ne permet plus d\'ajouter une carte', 'admin/abonnements/provisionner-lib.js', "payment_method_update: { enabled: true },", "payment_method_update: { enabled: false },", 'test-abonnements-provisionnement.js'],
    // — le parcours —
    // — STRIPE-PARCOURS-FIN : la limite de débit de Stripe, les lectures redondantes, le parcours —
    ['limite de débit : le webhook ne réessaie pas (le client du traitement n\'est pas enveloppé)', 'abonnements/webhook.js', "stripe: Reessai.envelopper(Cl.obtenir(cfgAbo), options.reessai)", "stripe: Cl.obtenir(cfgAbo)", 'test-abonnements-limite-debit.js'],
    ['limite de débit : l\'attente ne croît pas', 'abonnements/reessai.js', "const delai = delaisMs[Math.min(essai, delaisMs.length - 1)];", "const delai = delaisMs[0];", 'test-abonnements-limite-debit.js'],
    ['limite de débit : le budget d\'attente n\'est jamais entamé (attente sans borne par traitement)', 'abonnements/reessai.js', "etat.attenduMs += delai;", "", 'test-abonnements-limite-debit.js'],
    ['limite de débit : toute erreur est réessayée, pas seulement la limite', 'abonnements/reessai.js', "if (!estLimite(e) || essai >= delaisMs.length", "if (essai >= delaisMs.length", 'test-abonnements-limite-debit.js'],
    ['limite de débit : le nombre d\'essais n\'est pas borné par la liste des délais', 'abonnements/reessai.js', "if (!estLimite(e) || essai >= delaisMs.length || etat.attenduMs + delai > budgetMs) throw e;", "if (!estLimite(e) || etat.attenduMs + delai > budgetMs) throw e;", 'test-abonnements-limite-debit.js', 'le budget d\'attente borne déjà le nombre d\'essais (chaque délai est strictement positif) : retirer la borne du nombre d\'essais ne change rien d\'observable'],
    ['lectures : l\'abonnement d\'une facture est lu chez Stripe à chaque besoin (deux fois)', 'abonnements/webhook.js', "if (!luesChezStripe.has(sid)) luesChezStripe.set(sid, await ctx.stripe.subscriptions.retrieve(sid));", "luesChezStripe.set(sid, await ctx.stripe.subscriptions.retrieve(sid));", 'test-abonnements-limite-debit.js'],
    ['lectures : les soldes du parrain sont relus pour chaque prime en attente', 'abonnements/primes.js', "const soldes = new Map();", "const soldes = null;", 'test-abonnements-limite-debit.js'],
    ['parcours : l\'installation est créée avec l\'origine du site', 'admin/abonnements/parcours-lib.js', "const inst = await api(null, 'POST', '/api/installation', {}, { ...extension.entetes });", "const inst = await api(null, 'POST', '/api/installation', {});", 'test-abonnements-parcours.js'],
    ['parcours : la liaison et la déliaison partent avec l\'origine du site', 'admin/abonnements/parcours-lib.js', "const bearer = j => ({ ...extension.entetes, authorization: `Bearer ${j}` });", "const bearer = j => ({ authorization: `Bearer ${j}` });", 'test-abonnements-parcours.js'],
    ['parcours : une extension non fournie ne fait pas échouer le scénario', 'admin/abonnements/parcours-lib.js', "if (!extension || !extension.entetes || typeof extension.entetes.origin !== 'string' || !extension.entetes.origin) {", "if (false) {", 'test-abonnements-parcours.js'],
    ['parcours : l\'horloge avance sans attendre l\'avoir du parrain', 'admin/abonnements/parcours-lib.js', "if (apres.length >= 1) break;", "break;", 'test-abonnements-parcours.js'],
    ['outil : les en-têtes du site l\'emportent sur ceux que l\'on passe', 'admin/abonnements/parcours-test.js', "return { ...(cookie ? { cookie } : {}), ...(avecCorps ? { 'content-type': 'application/json', origin: 'https://rat-market.fr', 'x-rat-market': '1' } : {}), ...entetes };", "return { ...(cookie ? { cookie } : {}), ...entetes, ...(avecCorps ? { 'content-type': 'application/json', origin: 'https://rat-market.fr', 'x-rat-market': '1' } : {}) };", 'test-abonnements-parcours.js'],
    ['outil : l\'origine de l\'extension est écrite en dur', 'admin/abonnements/parcours-test.js', "const origin = lire({}).origines.extension;", "const origin = 'chrome-extension://fgibgdgmadfejkaapeohbhaoolhgpkhb';", 'test-abonnements-parcours.js'],
    // — tour de correction 1 —
    ['A-M2 : la lecture des soldes survit à la tenue du verrou (cache global entre les reprises)', 'abonnements/primes.js', "const soldes = tenue ? tenue.soldes : null;", "const soldes = tenue ? (globalThis.__rmSoldes = globalThis.__rmSoldes || new Map()) : null;", 'test-abonnements-soldes-verrou.js'],
    ['A-M2 : une prime est décidée sous une tenue qui ne tient pas le verrou (reprise sans verrou)', 'abonnements/primes.js', "return sousVerrou(parrainId, async () => {\n        const primes = await lister();", "return ((_, f) => f())(parrainId, async () => {\n        const primes = await lister();", 'test-abonnements-soldes-verrou.js'],
    ['A-M1 : le budget ne compte pas le temps réel des appels', 'abonnements/reessai.js', "if ((maintenantMs() - debut) + delai > budgetMs) throw e;", "", 'test-abonnements-limite-debit.js'],
    ['B-M2 : l\'attente de l\'avoir additionne les pas au lieu de mesurer le temps réel', 'admin/abonnements/parcours-lib.js', "if (maintenantMs() - debutAvoir >= attenteAvoirS * 1000) {", "if ((statut.pas = (statut.pas || 0) + pasS * 1000) >= attenteAvoirS * 1000) {", 'test-abonnements-parcours.js'],
    ['B-M4 : l\'échec de suppression de l\'horloge est avalé', 'admin/abonnements/parcours-lib.js', "note('horloge d\\'essai : suppression impossible (elle expirera seule chez Stripe)', false,", "((...x) => x)('', false,", 'test-abonnements-parcours.js'],
    ['B-M4 : la connexion accepte un statut inattendu', 'admin/abonnements/parcours-test.js', "if (r.status !== 200) throw new Error(", "if (false) throw new Error(", 'test-abonnements-parcours.js'],
    ['statut : les mois offerts du parrain sont toujours 0 (régression gardée par les bancs du statut, pas par le parcours)', 'abonnements/routes.js', "const moisOfferts = await Primes.moisOfferts(compte._id, maintenant);", "const moisOfferts = 0;", 'test-abonnements-decisions.js'],
    ['parcours : une horloge d\'essai partagée par tous les scénarios', 'admin/abonnements/parcours-lib.js', "finally { await supprimerHorloge(); }", "finally { /* horloge gardée */ }", 'test-abonnements-parcours.js'],
    ['parcours : un scénario absent de la table des rôles est joué', 'admin/abonnements/parcours-lib.js', "const refuses = choisis.filter(k => !Object.prototype.hasOwnProperty.call(ROLES_DES_SCENARIOS, k));", "const refuses = [];", 'test-abonnements-parcours.js'],
    ['parcours : les préconditions portent sur tous les comptes fournis', 'admin/abonnements/parcours-lib.js', "const roles = [...new Set(joues.flatMap(k => ROLES_DES_SCENARIOS[k]))];", "const roles = Object.keys(comptes);", 'test-abonnements-parcours.js']
];

function rejouer({ seulement = null, journal = console.log } = {}) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rm-mutants-'));
    const resultats = [];
    try {
        MUTANTS.forEach(([nom, fichier, ancre, neuf, banc, equivalent], i) => {
            if (seulement && !nom.includes(seulement)) return;
            const cible = path.join(V, fichier), texte = fs.readFileSync(cible, 'utf8').replace(/\r\n/g, '\n');
            const n = texte.split(ancre).length - 1;
            if (n !== 1) { resultats.push({ nom, verdict: 'ANCRE', detail: `${n} occurrence(s)` }); journal(`?? ANCRE (${n} occurrence(s))  ${nom}`); return; }
            const copie = path.join(tmp, `m${i}.js`); fs.writeFileSync(copie, texte.replace(ancre, () => neuf));
            const r = spawnSync(process.execPath, ['-r', path.join(V, BANCS, '_espion-fs-armer.js'), '-r', path.join(__dirname, 'accroche-mutant.js'), path.join(V, BANCS, banc)], {
                cwd: path.join(V, '..'), encoding: 'utf8', timeout: 400000, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, RM_MUTANT_CIBLE: cible, RM_MUTANT_SOURCE: copie } });
            const m = /(\d+) réussis, (\d+) échoués/.exec(r.stdout || '');
            const rouge = r.status !== 0 || (m && Number(m[2]) > 0);
            const verdict = rouge ? 'TUÉ' : equivalent ? 'ÉQUIVALENT' : 'SURVIVANT';
            resultats.push({ nom, verdict, banc, bilan: m ? `${m[1]}/${m[2]}` : 'pas de bilan' });
            journal(`${verdict.padEnd(10)} ${nom}  [${banc}] ${m ? `${m[1]} réussis, ${m[2]} échoués` : 'pas de bilan'}${equivalent && !rouge ? ` — ${equivalent}` : ''}`);
        });
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
    return resultats;
}
/** Les mutants dont l'ancre n'existe plus EXACTEMENT une fois dans le code actuel (le jeu a pourri). */
function ancresCassees() { return MUTANTS.filter(([, fichier, ancre]) => fs.readFileSync(path.join(V, fichier), 'utf8').replace(/\r\n/g, '\n').split(ancre).length - 1 !== 1).map(m => m[0]); }
module.exports = { MUTANTS, rejouer, ancresCassees };

if (require.main === module) {
    const arg = process.argv.slice(2);
    if (arg.some(a => !/^--seulement=.{1,60}$/.test(a)) || arg.length > 1) { console.error('ARRÊT : seul --seulement=<fragment du nom> est admis'); process.exit(1); }
    if (!process.env.MONGOMS_DOWNLOAD_DIR) console.log('⚠️ MONGOMS_DOWNLOAD_DIR n\'est pas posée : la base de banc en mémoire peut vouloir télécharger mongod');
    const res = rejouer({ seulement: arg[0] ? arg[0].slice(12) : null });
    const compte = v => res.filter(r => r.verdict === v).length;
    console.log(`\n${res.length} mutants : ${compte('TUÉ')} tués, ${compte('ÉQUIVALENT')} équivalent(s) déclaré(s), ${compte('SURVIVANT')} survivant(s), ${compte('ANCRE')} ancre(s) cassée(s)`);
    process.exit(compte('SURVIVANT') + compte('ANCRE') ? 1 : 0);
}
