'use strict';
// LA PRIME DU PARRAIN : « 1 mois offert » vaut UN MOIS, quelle que soit la période du parrain. Ce n'est PAS un coupon de 100 % (« la prochaine facture », donc une ANNÉE pour un parrain annuel) mais un
// AVOIR au solde du client Stripe du parrain, égal au prix MENSUEL Pro lu chez Stripe (499 centimes), que Stripe déduit de sa prochaine facture — mensuelle (499 → 0) ou annuelle (3 900 → 3 401).
// Il naît quand la première facture PAYÉE (montant > 0) de son filleul arrive. Plusieurs avoirs s'ADDITIONNENT (aucun mois perdu, plus de prime « en attente de remise »).
// Une ligne par filleul dans `abo_primes` (_id = compte du filleul) : le crédit ne se donne qu'une fois, quoi qu'il arrive (webhook rejoué, deux factures, reprise après panne) ; et AVANT de poser
// l'avoir on relit chez Stripe les transactions de solde du client (métadonnée du filleul) : la clé d'idempotence de Stripe est oubliée après 24 h, pas cette lecture.
// Refus (états terminaux, dits) : auto-parrainage · parrain-fondateurs (le parrainage est sur Pro seulement) · reciproque (A parrainé par B et B par A).
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
    const montant = (await Pub.lire(stripe, cfgAbo)).pro.mois;                                  // UN mois : le prix mensuel Pro (lu chez Stripe), quelle que soit la période du parrain
    if (!(await avoirDejaPose(stripe, parrain.stripeClient, filleulId))) {
        await stripe.customers.createBalanceTransaction(parrain.stripeClient, { amount: -montant, currency: O.DEVISE, description: DESCRIPTION, metadata: { rm_prime: String(filleulId), rm_parrain: String(parrain._id) } }, { idempotencyKey: `prime-${String(filleulId)}` });
    }
    await col('abo_primes').updateOne({ _id: filleulId, etat: { $ne: 'applique' } }, { $set: { etat: 'applique', appliqueLe: maintenant, montant, sid: st.sid, majLe: maintenant } });
    return { etat: 'applique' };
}
/** Reprend TOUTES les primes en attente d'un parrain (appelé quand son abonnement change ou qu'une de ses factures est payée) : les avoirs s'additionnent. */
async function reprendre({ stripe, cfgAbo, parrainId, maintenant = new Date() }) {
    const primes = await col('abo_primes').find({ parrainId, etat: { $in: ATTENTES } }).sort({ creeLe: 1 }).toArray();
    let faites = 0;
    for (const p of primes) { const r = await appliquer({ stripe, cfgAbo, filleulId: p._id, maintenant }); if (r.etat === 'applique') faites++; }
    return primes.length ? { etat: faites ? 'applique' : 'en-attente', faites } : { etat: 'ignore', raison: 'rien-en-attente' };
}
module.exports = { ouvrir, appliquer, reprendre, raisonDeRefus, VIVANTS, ATTENTES };
