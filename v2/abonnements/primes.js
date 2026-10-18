'use strict';
// LA PRIME DU PARRAIN : « 1 mois offert » vaut UN MOIS, quelle que soit la période du parrain. Ce n'est PAS un coupon de 100 % (« la prochaine facture », donc une ANNÉE pour un parrain annuel) mais un
// AVOIR au solde du client Stripe du parrain, égal au prix MENSUEL Pro lu chez Stripe (499 centimes), que Stripe déduit de sa prochaine facture — mensuelle (499 → 0) ou annuelle (3 900 → 3 401).
// Il naît quand la première facture PAYÉE (montant > 0) de son filleul arrive. Plusieurs avoirs s'ADDITIONNENT (aucun mois perdu, plus de prime « en attente de remise »).
// Une ligne par filleul dans `abo_primes` (_id = compte du filleul) : le crédit ne se donne qu'une fois, quoi qu'il arrive (webhook rejoué, deux factures, reprise après panne) ; et AVANT de poser
// l'avoir on relit chez Stripe les transactions de solde du client (métadonnée du filleul) : la clé d'idempotence de Stripe est oubliée après 24 h, pas cette lecture.
// Refus (états terminaux, dits) : auto-parrainage · parrain-fondateurs (le parrainage est sur Pro seulement) · reciproque (A parrainé par B et B par A) · plafond-annuel (au plus 12 mois offerts par
// parrain sur 365 jours glissants, comptés à la date d'application : STRIPE-DECISIONS, 2026-10-18).
// Attentes (reprises à chaque événement du parrain) : en-attente-parrain (pas d'abonnement vivant) · en-attente-resiliation (son abonnement est en résiliation programmée : une récompense posée sur un
// abonnement qui ne refacturera pas serait perdue — posée s'il reprend, ABANDONNÉE et dite s'il finit). Jamais de remboursement ni de virement.
const { col } = require('../db');
const Pa = require('./parrainage'); const Pub = require('./prix-publics'); const O = require('./offres');
const dupliquee = e => Boolean(e) && e.code === 11000;
const VIVANTS = ['trialing', 'active', 'past_due'];
const TERMINAUX = ['canceled', 'incomplete_expired'];
const ATTENTES = ['a-appliquer', 'en-attente-parrain', 'en-attente-resiliation'];
const DESCRIPTION = 'Parrainage — 1 mois offert';
const signaler = m => console.error(`🔴 [v2 abonnements] ${m}`);

/** Pourquoi ce parrainage est refusé ? null s'il ne l'est pas. */
function raisonDeRefus(parrain, filleul) {
    if (!Pa.parrainageAdmis(parrain, filleul)) return 'auto-parrainage';
    const sp = parrain.abonnement && parrain.abonnement.stripe;
    if (sp && sp.offre === 'fondateurs') return 'parrain-fondateurs';
    if (sp && ((sp.parrain && String(sp.parrain) === String(filleul._id)) || (sp.parrainPrevu && String(sp.parrainPrevu) === String(filleul._id)))) return 'reciproque';
    return null;
}
/** Crée la prime d'un filleul si les garde-fous passent. Idempotent : la ligne existe déjà → on la REPREND seulement. */
async function ouvrir({ stripe, cfgAbo, filleul, parrainId, factureId, maintenant }) {
    const parrain = parrainId ? await col('comptes').findOne({ _id: parrainId }) : null;
    if (!parrain) return { etat: 'ignore', raison: 'parrain-inconnu' };
    const raison = raisonDeRefus(parrain, filleul);
    if (raison) {
        try { await col('abo_primes').insertOne({ _id: filleul._id, parrainId: parrain._id, etat: 'refusee', raison, creeLe: maintenant, factureId }); } catch (e) { if (!dupliquee(e)) throw e; }
        return { etat: 'ignore', raison, signal: raison };
    }
    try { await col('abo_primes').insertOne({ _id: filleul._id, parrainId: parrain._id, etat: 'a-appliquer', creeLe: maintenant, factureId }); }
    catch (e) { if (!dupliquee(e)) throw e; }                                           // déjà ouverte : une seule prime par filleul, on ne fait que la reprendre
    return appliquer({ stripe, cfgAbo, filleulId: filleul._id, maintenant });
}
async function attente(filleulId, etat) { await col('abo_primes').updateOne({ _id: filleulId, etat: { $in: ATTENTES } }, { $set: { etat, majLe: new Date() } }); return { etat: 'en-attente', raison: etat }; }
/** L'avoir de ce filleul est-il DÉJÀ au solde du client chez Stripe ? (lecture des transactions, par la métadonnée). */
async function avoirDejaPose(stripe, clientId, filleulId) {
    for (let page = 0, apres = null; page < 20; page++) {
        const r = await stripe.customers.listBalanceTransactions(clientId, { limit: 100, ...(apres ? { starting_after: apres } : {}) });
        const liste = (r && r.data) || [];
        if (liste.some(t => t && t.metadata && t.metadata.rm_prime === String(filleulId))) return true;
        if (!r || !r.has_more || !liste.length) return false;
        apres = liste[liste.length - 1].id;
    }
    return false;
}
/** Pose l'avoir de la prime d'un filleul au solde du client du parrain, si c'est possible MAINTENANT. */
async function appliquer({ stripe, cfgAbo, filleulId, maintenant = new Date() }) {
    const prime = await col('abo_primes').findOne({ _id: filleulId });
    if (!prime || !ATTENTES.includes(prime.etat)) return { etat: 'ignore', raison: prime ? prime.etat : 'absente' };
    const parrain = await col('comptes').findOne({ _id: prime.parrainId });
    if (!parrain) { await col('abo_primes').updateOne({ _id: filleulId }, { $set: { etat: 'parrain-disparu', majLe: maintenant } }); return { etat: 'ignore', raison: 'parrain-disparu' }; }
    const st = parrain.abonnement && parrain.abonnement.stripe;
    const vivant = Boolean(st && st.sid && VIVANTS.includes(st.statut) && st.jusquAu instanceof Date && st.jusquAu.getTime() > maintenant.getTime());
    if (!vivant) {
        if (prime.etat === 'en-attente-resiliation' && st && st.sid && TERMINAUX.includes(st.statut)) {
            await col('abo_primes').updateOne({ _id: filleulId, etat: 'en-attente-resiliation' }, { $set: { etat: 'abandonnee', raison: 'parrain-a-resilie', majLe: maintenant } });
            signaler(`prime abandonnee : le parrain ${String(parrain._id)} a résilié avant de la recevoir (filleul ${String(filleulId)})`);
            return { etat: 'ignore', raison: 'abandonnee' };
        }
        return attente(filleulId, 'en-attente-parrain');
    }
    if (st.resiliation === true) return attente(filleulId, 'en-attente-resiliation');
    if (!parrain.stripeClient) return attente(filleulId, 'en-attente-parrain');
    // LE PLAFOND (décision du testeur, 2026-10-18) : au plus PLAFOND_PARRAINAGE_MOIS mois offerts par parrain sur FENETRE_PARRAINAGE_JOURS jours GLISSANTS, comptés à la date d'APPLICATION.
    // « Compter puis écrire » n'est pas atomique : deux primes du même parrain appliquées en même temps verraient toutes deux 11 mois et passeraient (13 crédits). La décision et l'écriture se font
    // donc SOUS UN VERROU PAR PARRAIN (document à _id unique, expirant seul) ; la prime est relue sous le verrou. Une prime hors plafond est REFUSÉE (état terminal, raison « plafond-annuel ») :
    // le parrain n'est pas crédité. Le verrou introuvable pendant ~10 s fait ÉCHOUER l'événement (Stripe le rejoue) : jamais un crédit hors plafond.
    return sousVerrou(parrain._id, async () => {
        const fraiche = await col('abo_primes').findOne({ _id: filleulId });
        if (!fraiche || !ATTENTES.includes(fraiche.etat)) return { etat: 'ignore', raison: fraiche ? fraiche.etat : 'absente' };
        // L'HEURE DE LA DÉCISION, pas la date de l'événement : un événement en retard (reprise de Stripe après un 500) porte une date ancienne, mais il est décidé MAINTENANT ; les avoirs déjà appliqués
        // (même datés de « plus tard » que lui) comptent tous. (`maintenant` plus tardif que l'horloge : les bancs, qui fixent la date de décision.)
        const decision = new Date(Math.max(maintenant.getTime(), Date.now()));
        // L'ÉTAT RÉEL chez Stripe d'abord : un avoir DÉJÀ posé (panne entre l'avoir et l'écriture « applique », reprise) reste « applique » et compte dans le plafond — la base ne dit jamais « refusee » pour un avoir qui existe.
        const dejaPose = await avoirDejaPose(stripe, parrain.stripeClient, filleulId);
        if (!dejaPose && (await moisDansLaFenetre(parrain._id, filleulId, decision)) >= O.PLAFOND_PARRAINAGE_MOIS) {
            await col('abo_primes').updateOne({ _id: filleulId, etat: { $in: ATTENTES } }, { $set: { etat: 'refusee', raison: 'plafond-annuel', majLe: maintenant } });
            signaler(`prime refusee : plafond-annuel (le parrain ${String(parrain._id)} a déjà ${O.PLAFOND_PARRAINAGE_MOIS} mois offerts sur ${O.FENETRE_PARRAINAGE_JOURS} jours ; filleul ${String(filleulId)})`);
            return { etat: 'ignore', raison: 'plafond-annuel', signal: 'plafond-annuel' };
        }
        const montant = (await Pub.lire(stripe, cfgAbo)).pro.mois;                              // UN mois : le prix mensuel Pro (lu chez Stripe), quelle que soit la période du parrain
        if (!dejaPose) {
            await stripe.customers.createBalanceTransaction(parrain.stripeClient, { amount: -montant, currency: O.DEVISE, description: DESCRIPTION, metadata: { rm_prime: String(filleulId), rm_parrain: String(parrain._id) } }, { idempotencyKey: `prime-${String(filleulId)}` });
        }
        await col('abo_primes').updateOne({ _id: filleulId, etat: { $ne: 'applique' } }, { $set: { etat: 'applique', appliqueLe: decision, montant, sid: st.sid, majLe: maintenant } });
        return { etat: 'applique' };
    });
}
const fenetreDebut = fin => new Date(fin.getTime() - O.FENETRE_PARRAINAGE_JOURS * 86400e3);
/** Les mois déjà offerts à ce parrain dans la fenêtre glissante qui PRÉCÈDE l'heure de la décision (fenetreDebut(t), ∞) — sans borne haute : tout avoir appliqué compte, quelle que soit la date de l'événement qui l'a fait naître. */
async function moisDansLaFenetre(parrainId, filleulId, decision) {
    return col('abo_primes').countDocuments({ parrainId, _id: { $ne: filleulId }, etat: 'applique', appliqueLe: { $gt: fenetreDebut(decision) } });
}
const VERROUS = 'abo_primes_verrous', VERROU_MS = 300e3, ATTENTE_VERROU_TOURS = 200;      // 5 min : bien plus que la plus longue section (20 pages de soldes chez Stripe) — pas de renouvellement à gérer
const dormir = ms => new Promise(r => setTimeout(r, ms));
/** Exécute `f` seul pour ce parrain. Le verrou est un document à _id unique : l'insertion est atomique, un verrou périmé (processus mort) se reprend sous condition d'expiration. */
async function sousVerrou(parrainId, f) {
    const _id = `parrain:${String(parrainId)}`;
    for (let tour = 0; tour < ATTENTE_VERROU_TOURS; tour++) {
        const debut = new Date(), expireLe = new Date(debut.getTime() + VERROU_MS);
        let pris = false;
        try { await col(VERROUS).insertOne({ _id, expireLe }); pris = true; }
        catch (e) { if (!dupliquee(e)) throw e; pris = (await col(VERROUS).updateOne({ _id, expireLe: { $lte: debut } }, { $set: { expireLe } })).modifiedCount === 1; }
        if (!pris) { await dormir(20 + Math.floor(Math.random() * 30)); continue; }
        try { return await f(); } finally { await col(VERROUS).deleteOne({ _id, expireLe }).catch(() => { /* il expire seul */ }); }
    }
    throw Object.assign(new Error('primes : verrou du parrain introuvable'), { code: 'VERROU_PARRAIN' });
}
/** Les mois offerts à ce parrain sur les FENETRE_PARRAINAGE_JOURS derniers jours (primes APPLIQUÉES, comptées à leur date d'application) : ce que le statut public affiche. */
async function moisOfferts(parrainId, maintenant = new Date()) {
    return col('abo_primes').countDocuments({ parrainId, etat: 'applique', appliqueLe: { $gt: fenetreDebut(maintenant), $lte: maintenant } });
}
/** Reprend TOUTES les primes en attente d'un parrain (appelé quand son abonnement change ou qu'une de ses factures est payée) : les avoirs s'additionnent. */
async function reprendre({ stripe, cfgAbo, parrainId, maintenant = new Date() }) {
    const primes = await col('abo_primes').find({ parrainId, etat: { $in: ATTENTES } }).sort({ creeLe: 1 }).toArray();
    let faites = 0;
    for (const p of primes) { const r = await appliquer({ stripe, cfgAbo, filleulId: p._id, maintenant }); if (r.etat === 'applique') faites++; }
    return primes.length ? { etat: faites ? 'applique' : 'en-attente', faites } : { etat: 'ignore', raison: 'rien-en-attente' };
}
module.exports = { ouvrir, appliquer, reprendre, raisonDeRefus, moisOfferts, moisDansLaFenetre, sousVerrou, VERROUS, VIVANTS, ATTENTES };
