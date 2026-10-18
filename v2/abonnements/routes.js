'use strict';
// LES TROIS ROUTES DU SITE — POST /api/abonnement/checkout · POST /api/abonnement/portail · GET /api/abonnement.
// Identité : le cookie de session, compte VÉRIFIÉ (resoudrePorteur ne rend un porteur que pour un compte confirmé), origine du site + X-Rat-Market sur les écritures, plafonds horaires.
// Les erreurs ont la forme du contrat (success:false, erreur:{code,message,detail}, facturation:null) ; aucun identifiant Stripe brut ne sort jamais d'une réponse (une URL de paiement ou
// de portail, c'est tout).
const { col } = require('../db');
const registre = require('../registre'); const L = require('../transport/limites');
const { repondreErreur } = require('../erreurs'); const S = require('../comptes/sessions');
const { resoudrePorteur, exigerSession } = require('../porteur');
const crypto = require('crypto'); const Pub = require('./prix-publics');
const Cl = require('./client'); const Fo = require('./fondateurs'); const Pa = require('./parrainage'); const Cfg = require('./config');
const O = require('./offres'); const Essai = require('./essai'); const Carte = require('./carte'); const Primes = require('./primes'); const Offre = require('../argent/offre');

const HEURE = 3600e3;
const FORME_RETOUR = /^\/fr(?:\/[a-z0-9_-]{1,40}){0,3}$/;     // un chemin du site seulement, jamais une adresse (aucune redirection ouverte)
const CHAMPS = Object.freeze(['offre', 'periode', 'code', 'retour']);
const objet = b => b && typeof b === 'object' && !Array.isArray(b);
const nomErreur = e => (e && (e.code || e.type || e.name)) || 'Error';
const indispo = (res, detail) => repondreErreur(res, 'INDISPONIBLE', 'Service momentanément indisponible', detail ? { detail } : {});
const entree = (res, detail, statut) => repondreErreur(res, 'ENTREE', 'Requête invalide', { detail }, statut);
const conflit = (res, detail) => repondreErreur(res, 'CONFLIT', 'Opération impossible dans l\'état actuel du compte', { detail });
const STATUTS_VIVANTS = Object.freeze(['trialing', 'active', 'past_due', 'unpaid', 'paused']);   // un abonnement dans l'un de ces états interdit d'en ouvrir un second

const dateIso = d => (d instanceof Date && !Number.isNaN(d.getTime()) ? d.toISOString() : null);
/**
 * Ce que le site affiche. Aucune clé Stripe, aucun identifiant Stripe : seulement des états et des dates (ISO 8601 UTC).
 * `extras.carte` : une carte est-elle enregistrée pendant l'essai ? (true | false | null = on ne sait pas — voir carte.js) ; `extras.essai` : { permis, detail } de essai.verifier.
 * Les NOMS du site (lot L2) sont adoptés ; les anciens (`finPeriode`, `essai.finLe`) sont gardés en plus pendant la transition (retrait : voir CONTRAT-STRIPE-V2.md §2).
 */
function statutPublic(compte, maintenant, extras = {}) {
    const a = compte.abonnement || {}, s = a.stripe || null;
    const vivant = Boolean(s && ['trialing', 'active', 'past_due'].includes(s.statut) && a.actif === true && a.jusquAu instanceof Date && a.jusquAu.getTime() > maintenant.getTime());
    const statut = !s || !s.sid ? 'aucun'
        : vivant ? ({ trialing: 'essai', active: 'actif', past_due: 'impaye' })[s.statut]
            : ({ incomplete: 'en-attente', unpaid: 'suspendu', paused: 'suspendu' })[s.statut] || 'termine';
    const essaiEnCours = vivant && s.statut === 'trialing';
    // JAMAIS une affirmation fausse : « sans carte » ne se dit que de `false` ; null (inconnu) ne dit rien
    const carte = essaiEnCours && (extras.carte === true || extras.carte === false) ? extras.carte : null;
    const sid = Boolean(s && s.sid), grace = Boolean(vivant && s.statut === 'past_due');
    const resiliationExplicite = Boolean(vivant && s.resiliation), essaiSansCarte = essaiEnCours && carte === false;
    const finPeriode = sid ? dateIso(s.finPeriode) : null;
    const disponible = extras.essai ? extras.essai.permis === true : !(s && (s.essaiUtilise || s.sid));
    return {
        actif: vivant, plan: sid ? s.offre || null : null, periode: sid ? s.periode || null : null, statut,
        finPeriode, finDePeriode: finPeriode,                                                                                // finDePeriode : le nom du site ; finPeriode : l'ancien nom (transition)
        // un essai sans carte prend fin tout seul à sa fin (retour au gratuit, aucun prélèvement) : c'est une fin PRÉVUE, comme une résiliation
        resiliationPrevue: resiliationExplicite || essaiSansCarte,
        // « prend fin le… » (résiliation prévue, ou essai sans carte) ; « se renouvelle le… » seulement quand un prélèvement est sûr (abonnement actif, ou essai AVEC carte) ; jamais pendant un impayé
        finPrevueLe: resiliationExplicite ? dateIso(s.jusquAu) : essaiSansCarte ? dateIso(s.finEssai) : null,
        prochaineEcheance: vivant && !grace && !resiliationExplicite && (statut === 'actif' || (essaiEnCours && carte === true)) ? finPeriode : null,
        essaiFinLe: essaiEnCours ? dateIso(s.finEssai) : null,                                                               // le nom du site : null hors essai
        debutEssai: sid ? dateIso(s.debutEssai) : null, finEssai: sid ? dateIso(s.finEssai) : null,                           // les dates de l'essai de ce compte, aussi après sa fin (courriels)
        maintienJusqua: grace ? dateIso(s.jusquAu) : null,                                                                   // la fin de la grâce d'un impayé, donnée par l'API
        essai: { enCours: essaiEnCours, debutLe: essaiEnCours ? dateIso(s.debutEssai) : null, finLe: essaiEnCours ? dateIso(s.finEssai) : null, carteEnregistree: carte, disponible, refus: extras.essai && !extras.essai.permis ? extras.essai.detail || null : null },
        paiementEchoue: grace
    };
}
/** Le quota du site : l'objet `offre` commun (nom, restant, remiseAZero) PLUS les noms du site — offre (= nom), limite (null pour Pro), utilisees (analyses du jour de Paris). */
async function quotaPublic(quota, porteur, cfg, maintenant) {
    const e = await Offre.etatDe(porteur, cfg, maintenant);
    return { ...quota, offre: quota.nom, limite: e && e.nom !== 'pro' ? e.limite : null, utilisees: await Offre.prisAuJour(porteur, Offre.jourDeParis(maintenant)) };
}
async function assurerClient(stripe, compte) {
    if (compte.stripeClient) return compte.stripeClient;
    // M3 : un client déjà créé pour ce compte (la pose en base a pu échouer après la création, et l'idempotence de Stripe ne dure que 24 h) est RETROUVÉ par ses métadonnées avant d'en créer un autre
    let c = null;
    try { const r = await stripe.customers.search({ query: `metadata['compteId']:'${String(compte._id)}'`, limit: 1 }); c = r && Array.isArray(r.data) && r.data[0] && !r.data[0].deleted ? r.data[0] : null; } catch (e) { console.error(`🔴 [v2 abonnement] recherche du client impossible (${nomErreur(e)}) — création`); }
    // un client Stripe par compte : l'identifiant d'idempotence rend le client DÉTERMINISTE (deux requêtes simultanées reçoivent le même), la pose en base est conditionnelle
    if (!c) c = await stripe.customers.create({ email: compte.email, metadata: { compteId: String(compte._id) } }, { idempotencyKey: `cust-${String(compte._id)}` });
    const r = await col('comptes').updateOne({ _id: compte._id, stripeClient: null }, { $set: { stripeClient: c.id } });
    if (r.matchedCount === 1) return c.id;
    const relu = await col('comptes').findOne({ _id: compte._id }, { projection: { stripeClient: 1 } });
    if (relu && relu.stripeClient) return relu.stripeClient;
    throw new Error('client Stripe : pose impossible');
}
/** L'essai est accordé UNE fois par compte : jamais si le compte a eu un essai ou un abonnement (en base, ou chez Stripe pour son client). */
async function essaiPermis(stripe, compte) {
    const s = compte.abonnement && compte.abonnement.stripe;
    if (s && (s.essaiUtilise || s.sid)) return false;
    if (compte.stripeClient) { const l = await stripe.subscriptions.list({ customer: compte.stripeClient, status: 'all', limit: 1 }); if (l && Array.isArray(l.data) && l.data.length) return false; }
    return true;
}
async function dejaAbonne(stripe, compte) {
    const s = compte.abonnement && compte.abonnement.stripe;
    if (s && s.sid && STATUTS_VIVANTS.includes(s.statut)) return true;
    if (compte.stripeClient) { const l = await stripe.subscriptions.list({ customer: compte.stripeClient, status: 'all', limit: 10 }); if (l && Array.isArray(l.data) && l.data.some(x => STATUTS_VIVANTS.includes(x.status))) return true; }
    return false;
}

function routesAbonnements(router, cfg) {
    const site = cfg.origines.site;
    const parSession = [resoudrePorteur(cfg), S.exigerOrigineSite(cfg), exigerSession];
    const parCompte = (nom, max) => L.limiteur({ nom, max, fenetreMs: HEURE, cle: q => (q.v2 && q.v2.porteur ? String(q.v2.porteur.id) : null) });
    const parIp = (nom, max) => L.limiteur({ nom, max, fenetreMs: HEURE, cle: q => L.empreinteIp(q.ip) });
    const abo = () => cfg.abonnements;
    const pret = () => abo() && abo().actif && abo().pret;

    router.post('/api/abonnement/checkout', ...parSession, parCompte('abo-checkout', 20), parIp('abo-checkout-ip', 60), async (req, res) => {
        let reserveePour = null, essaiReserve = [], compteEssai = null;
        try {
            if (!pret()) return indispo(res, 'abonnements-indisponibles');
            const b = req.body;
            if (!objet(b)) return entree(res, 'corps');
            if (Object.keys(b).some(k => !CHAMPS.includes(k))) return entree(res, 'champ-inconnu');
            if (!O.OFFRES.includes(b.offre)) return entree(res, 'offre-inconnue');
            if (!O.PERIODES.includes(b.periode)) return entree(res, 'periode-inconnue');
            if (b.code !== undefined && !(typeof b.code === 'string' && b.code.length >= 1 && b.code.length <= 64)) return entree(res, 'code-invalide', 422);
            if (b.retour !== undefined && !(typeof b.retour === 'string' && FORME_RETOUR.test(b.retour))) return entree(res, 'retour-invalide');
            const porteur = req.v2.porteur, compte = porteur.compte;
            const prix = abo().prix[b.offre][b.periode];
            if (b.offre === 'fondateurs' && !abo().fondateurs.ouvert) return entree(res, 'code-invalide', 422);   // l'offre est fermée : indiscernable d'un mauvais code (on ne révèle pas qu'elle existe)
            if (!prix) return indispo(res, 'prix-non-configure');
            const stripe = Cl.obtenir(abo());
            if (await dejaAbonne(stripe, compte)) return conflit(res, 'abonnement-actif');
            // le code (Fondateurs ou parrainage) : au plus 10 essais par heure et par compte, comptés AVANT de le lire
            let parrain = null;
            if (b.code !== undefined) {
                const essais = await L.consommer(`abo-code:${String(compte._id)}`, { max: 10, fenetreMs: HEURE });
                if (!essais.permis) return repondreErreur(res, 'DEBIT', 'Trop de requêtes, réessayez plus tard.', { reessayerDans: essais.reessayerDans });
            }
            if (b.offre === 'fondateurs') {
                if (typeof b.code !== 'string' || !Cfg.codeFondateursValide(b.code, abo().fondateurs.empreinteCode)) return entree(res, 'code-invalide', 422);
                const place = await Fo.reserver(compte._id, abo().fondateurs.places, new Date());
                if (!place.ok) return conflit(res, 'places-epuisees');
                reserveePour = place.deja ? null : compte._id;       // I1 : seule une réservation CRÉÉE par cet appel est rendue si la suite échoue (jamais celle d'une session déjà ouverte)
            } else if (b.code !== undefined) {
                parrain = await Pa.parrainDe(b.code);
                if (!parrain) return entree(res, 'code-invalide', 422);
                if (!Pa.parrainUtilisable(parrain, compte) || !Pa.eligibleFilleul(compte)) return entree(res, 'parrainage-non-eligible', 422);
            }
            // L'ESSAI SANS CARTE n'est donné que si TOUTES les conditions de la garde tiennent (essai.js : compte neuf, domaine non jetable REVÉRIFIÉ ici, une boîte, une installation).
            // Un refus de l'essai ne refuse pas l'abonnement : la session part SANS essai, donc avec la carte, et le statut dit `essai.disponible: false`.
            let essai = await essaiPermis(stripe, compte);
            if (essai) {
                const g = await Essai.reserver(compte, cfg, new Date());
                if (g.permis) { essaiReserve = g.cree; compteEssai = compte._id; } else essai = false;
            }
            if (parrain && !essai) return entree(res, 'parrainage-non-eligible', 422);
            const jours = !essai ? 0 : parrain ? O.ESSAI_PARRAINAGE_JOURS : O.ESSAI_JOURS;
            const client = await assurerClient(stripe, compte);
            const tranche = Math.floor(Date.now() / 600000), retour = b.retour || null, ok = `${site}${retour || '/fr/compte'}?abonnement=succes`, ko = `${site}${retour || '/fr/tarifs'}?abonnement=annule`;
            const metadata = { compteId: String(compte._id), offre: b.offre, periode: b.periode, ...(parrain ? { parrain: String(parrain._id) } : {}) };
            const session = await stripe.checkout.sessions.create({
                mode: 'subscription', customer: client, client_reference_id: String(compte._id), line_items: [{ price: prix, quantity: 1 }], success_url: ok, cancel_url: ko,
                consent_collection: { terms_of_service: 'required' },        // TOUJOURS exigé, sans réglage pour l'éteindre (les CGV du site : l'URL est posée dans le compte Stripe)
                // « if_required » : avec un essai la première facture est de 0 € donc AUCUNE carte n'est demandée (l'essai est sans carte) ; sans essai la première facture est due et Stripe demande la carte
                payment_method_collection: 'if_required', allow_promotion_codes: false, billing_address_collection: 'auto',
                // la fin de la session est calée sur la tranche de 10 minutes de la clé d'idempotence : deux clics dans la même tranche envoient EXACTEMENT les mêmes paramètres (Stripe refuse une clé
                // rejouée avec des paramètres différents) ; la session vit entre 60 et 70 minutes, la réservation d'une place Fondateurs la couvre (MARGE_RESERVATION_MINUTES)
                expires_at: (tranche + 1) * 600 + O.SESSION_MINUTES * 60, metadata,
                subscription_data: { metadata, ...(jours > 0 ? { trial_period_days: jours, trial_settings: { end_behavior: { missing_payment_method: 'cancel' } } } : {}) }
            }, { idempotencyKey: `ckt-${String(compte._id)}-${b.offre}-${b.periode}-${parrain ? 'p' + crypto.createHash('sha256').update(Pa.normaliserCodeParrainage(b.code)).digest('hex').slice(0, 12) : '_'}-${tranche}-j${jours}` });
            if (!session || typeof session.url !== 'string') throw new Error('checkout : pas d\'adresse de paiement');
            // I1 : UN seul abonnement par compte — les autres sessions Checkout OUVERTES de ce client sont expirées (deux pages ouvertes ne peuvent plus donner deux paiements)
            try { const ouvertes = await stripe.checkout.sessions.list({ customer: client, status: 'open', limit: 20 }); for (const o of (ouvertes && ouvertes.data) || []) if (o.id !== session.id) await stripe.checkout.sessions.expire(o.id).catch(() => { /* déjà expirée ou complétée */ }); }
            catch (e) { console.error(`🔴 [v2 abonnement checkout] sessions ouvertes non expirées (${nomErreur(e)})`); }
            reserveePour = null; essaiReserve = [];                     // la session existe : les réservations restent (elles expirent seules si la page est abandonnée)
            if (b.offre === 'fondateurs') await Fo.attacher(compte._id, session.id);          // la réservation est portée par CETTE session : elle n'est rendue que si Stripe dit qu'elle a expiré
            if (parrain) await col('comptes').updateOne({ _id: compte._id }, { $set: { 'abonnement.stripe.parrainPrevu': parrain._id } });   // M1 : le parrainage annoncé (refuse le réciproque avant tout abonnement)
            res.setHeader('Cache-Control', 'no-store');
            return res.status(200).json({ success: true, url: session.url });
        } catch (e) {
            console.error(`❌ [v2 abonnement checkout] ${nomErreur(e)}`);            if (reserveePour) await Fo.liberer(reserveePour).catch(() => { /* la réservation expire seule */ });
            if (compteEssai) await Essai.rendre(compteEssai, essaiReserve).catch(() => { /* la réservation expire seule */ });
            return indispo(res, 'paiement-indisponible');
        }
    });

    // L'OFFRE FONDATEURS SUR CODE (lien réservé, jamais public). La page réservée du site (noindex, hors sitemap) appelle cette route avec le code de son adresse ; l'API rend le prix et les places
    // restantes à qui présente un code VALIDE, et RIEN d'autre. Un mauvais code et une offre fermée donnent la MÊME réponse (422 code-invalide, mêmes en-têtes), sous la même limite d'essais que le
    // Checkout (le même compteur : 10 par heure et par compte, comptés AVANT de lire le code). Le code voyage dans le corps (POST), jamais dans une adresse que les journaux garderaient.
    router.post('/api/abonnement/fondateurs', ...parSession, parCompte('abo-fondateurs', 20), parIp('abo-fondateurs-ip', 60), async (req, res) => {
        try {
            if (!pret()) return indispo(res, 'abonnements-indisponibles');
            const b = req.body;
            if (!objet(b)) return entree(res, 'corps');
            if (Object.keys(b).some(k => k !== 'code')) return entree(res, 'champ-inconnu');
            if (!(typeof b.code === 'string' && b.code.length >= 1 && b.code.length <= 64)) return entree(res, 'code-invalide', 422);
            const compte = req.v2.porteur.compte;
            const essais = await L.consommer(`abo-code:${String(compte._id)}`, { max: 10, fenetreMs: HEURE });
            if (!essais.permis) return repondreErreur(res, 'DEBIT', 'Trop de requêtes, réessayez plus tard.', { reessayerDans: essais.reessayerDans });
            if (!abo().fondateurs.ouvert || !Cfg.codeFondateursValide(b.code, abo().fondateurs.empreinteCode)) return entree(res, 'code-invalide', 422);   // offre fermée = mauvais code
            const total = abo().fondateurs.places, occupees = await Fo.occupees(new Date());
            res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Robots-Tag', 'noindex, nofollow');
            return res.status(200).json({ success: true, offre: { nom: 'fondateurs', devise: 'EUR', prix: { mois: O.CATALOGUE.fondateurs.prix.mois, an: O.CATALOGUE.fondateurs.prix.an }, places: { total, restantes: Math.max(0, total - occupees) }, essaiJours: O.ESSAI_JOURS } });
        } catch (e) { console.error(`❌ [v2 abonnement fondateurs] ${nomErreur(e)}`); return indispo(res, 'paiement-indisponible'); }
    });

    router.post('/api/abonnement/portail', ...parSession, parCompte('abo-portail', 20), parIp('abo-portail-ip', 60), async (req, res) => {
        try {
            if (!pret()) return indispo(res, 'abonnements-indisponibles');
            const compte = req.v2.porteur.compte;
            if (!compte.stripeClient) return conflit(res, 'aucun-abonnement');
            const stripe = Cl.obtenir(abo());
            // C1 : UNE configuration de portail PAR OFFRE — celle de l'abonnement EN COURS (Pro à défaut) ; jamais l'autre en repli (elle laisserait passer d'une offre à l'autre sans code ni place)
            const st = compte.abonnement && compte.abonnement.stripe, offre = st && st.sid && st.offre === 'fondateurs' ? 'fondateurs' : 'pro', configuration = abo().portail[offre];
            if (!configuration) return indispo(res, 'portail-indisponible');
            const p = await stripe.billingPortal.sessions.create({ customer: compte.stripeClient, configuration, return_url: `${site}/fr/compte` });
            if (!p || typeof p.url !== 'string') throw new Error('portail : pas d\'adresse');
            res.setHeader('Cache-Control', 'no-store');
            return res.status(200).json({ success: true, url: p.url });
        } catch (e) { console.error(`❌ [v2 abonnement portail] ${nomErreur(e)}`); return indispo(res, 'paiement-indisponible'); }
    });

    const lecture = L.limiteur({ nom: 'abo-lecture', max: cfg.limites.compteParPorteurHeure, fenetreMs: HEURE, cle: q => (q.v2 && q.v2.porteur ? `${q.v2.porteur.type}:${q.v2.porteur.id}` : null) });
    router.get('/api/abonnement', resoudrePorteur(cfg), exigerSession, lecture, async (req, res) => {
        try {
            const porteur = req.v2.porteur, maintenant = new Date();
            const compte = await col('comptes').findOne({ _id: porteur.id });
            if (!compte) return repondreErreur(res, 'SESSION', 'Connexion requise');
            const quota = await quotaPublic(await registre.obtenir('argent').offre(porteur, maintenant), porteur, cfg, maintenant);
            const code = await Pa.codeDe(compte._id);
            const prixPublics = pret() ? await Pub.lire(Cl.obtenir(abo()), abo()) : Pub.constantes();
            // la carte pendant l'essai : une lecture Stripe bornée et en cache (carte.js), seulement tant qu'un essai est en cours ; inconnue (null) si Stripe ne répond pas
            const s0 = compte.abonnement && compte.abonnement.stripe;
            const carte = pret() && s0 && s0.sid && statutPublic(compte, maintenant).essai.enCours ? await Carte.enregistree(Cl.obtenir(abo()), s0.sid) : null;
            let verifEssai; try { verifEssai = await Essai.verifier(compte, cfg, maintenant); } catch (e) { console.error(`🔴 [v2 abonnement statut] garde de l'essai illisible (${nomErreur(e)}) — essai non annoncé`); verifEssai = { permis: false, detail: null }; }
            const moisOfferts = await Primes.moisOfferts(compte._id, maintenant);
            res.setHeader('Cache-Control', 'no-store');
            return res.status(200).json({ success: true, abonnement: statutPublic(compte, maintenant, { carte, essai: verifEssai }), quota,
                parrainage: { code, essaiFilleulJours: O.ESSAI_PARRAINAGE_JOURS, moisOfferts, plafondMois: O.PLAFOND_PARRAINAGE_MOIS, fenetreJours: O.FENETRE_PARRAINAGE_JOURS },
                offres: { pro: prixPublics.pro, source: prixPublics.source, devise: 'EUR', essaiJours: O.ESSAI_JOURS } });   // en centimes ; l'offre Fondateurs (sur code) n'est jamais annoncée ici
        } catch (e) { console.error(`❌ [v2 abonnement statut] ${nomErreur(e)}`); return indispo(res); }
    });
}
module.exports = { routesAbonnements, statutPublic, essaiPermis, dejaAbonne, assurerClient, FORME_RETOUR };
