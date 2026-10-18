'use strict';
// L'ÉTAT DU COMPTE suit l'abonnement Stripe. Ce module est le SEUL à écrire `abonnement.actif` / `abonnement.jusquAu` depuis un événement Stripe.
//
// Les règles (décisions écrites) :
//   · trialing ou active          → Pro jusqu'à la fin de la période (ou de la coupure programmée si elle est plus tôt) ;
//   · past_due (paiement échoué)  → Pro maintenu `GRACE_IMPAYE_JOURS` (3) jours au plus après le PREMIER événement past_due, et jamais au-delà de la fin de période. La grâce se
//                                    compte depuis l'entrée en impayé et n'est JAMAIS prolongée par un nouvel échec ni un nouvel événement : c'est la règle la plus prudente pour le
//                                    client (un incident de carte ne le coupe pas la minute même) SANS offrir un mois gratuit (Stripe relance pendant des semaines) ;
//   · canceled, deleted, unpaid, paused, incomplete, incomplete_expired → plus de Pro ;
//   · un abonnement dont le prix n'est PAS l'un des quatre prix Rat-Market n'ouvre RIEN (offre inconnue : signalé, jamais deviné) ;
//   · un événement DANS LE DÉSORDRE ne fait jamais régresser l'état : chaque écriture porte la date de l'événement (`version`, secondes Stripe) ; un événement plus ancien que celui
//     déjà appliqué pour le même abonnement est ignoré (égalité : le statut le plus avancé gagne). L'écriture est une comparaison-et-échange sur cette version.
const { ObjectId } = require('mongoose').Types;
const { col } = require('../db');
const { DEPUIS_LOOKUP, GRACE_IMPAYE_JOURS } = require('./offres');
const Fo = require('./fondateurs');

const STATUTS = Object.freeze(['incomplete', 'incomplete_expired', 'trialing', 'active', 'past_due', 'canceled', 'unpaid', 'paused']);
const TERMINAUX = Object.freeze(['canceled', 'incomplete_expired']);
const RANG = Object.freeze({ incomplete: 1, trialing: 2, active: 2, past_due: 2, unpaid: 2, paused: 2, canceled: 4, incomplete_expired: 4 });
const dupliquee = e => Boolean(e) && e.code === 11000;
const nombre = x => (typeof x === 'number' && Number.isFinite(x) ? x : null);
const dateDe = s => (nombre(s) === null ? null : new Date(s * 1000));
const idDe = x => (typeof x === 'string' ? x : x && typeof x.id === 'string' ? x.id : null);
const objetId = s => (typeof s === 'string' && /^[0-9a-f]{24}$/.test(s) ? new ObjectId(s) : null);

/** Lit les champs dont on a besoin dans un objet Subscription, quelle que soit la forme (champ au niveau de l'abonnement, ou sur ses lignes depuis les versions récentes de l'API). */
function lireSubscription(sub, cfgAbo) {
    const id = idDe(sub), items = (sub && sub.items && Array.isArray(sub.items.data)) ? sub.items.data : [];
    const fins = [nombre(sub && sub.current_period_end), ...items.map(i => nombre(i && i.current_period_end))].filter(x => x !== null);
    const finPeriode = fins.length ? Math.max(...fins) : null;
    const prix = items.length && items[0].price ? items[0].price : null;
    const prixId = prix ? idDe(prix) : null;
    const lue = (prixId && cfgAbo && cfgAbo.prixParId && cfgAbo.prixParId[prixId]) || (prix && typeof prix === 'object' && prix.lookup_key && DEPUIS_LOOKUP[prix.lookup_key]) || null;
    const meta = (sub && sub.metadata && typeof sub.metadata === 'object') ? sub.metadata : {};
    return {
        sid: id, statut: sub && sub.status, offre: lue ? lue.offre : null, periode: lue ? lue.periode : null, finPeriode, coupeLe: nombre(sub && sub.cancel_at),
        finEssai: nombre(sub && sub.trial_end), aEuEssai: nombre(sub && sub.trial_end) !== null || nombre(sub && sub.trial_start) !== null,
        resiliation: Boolean(sub && (sub.cancel_at_period_end === true || nombre(sub.cancel_at) !== null)), termineLe: nombre(sub && sub.ended_at),
        creeSub: nombre(sub && sub.created), client: idDe(sub && sub.customer), compteMeta: objetId(meta.compteId), parrain: objetId(meta.parrain),
        remises: Array.isArray(sub && sub.discounts) ? sub.discounts.length : (sub && sub.discount ? 1 : 0), nbLignes: items.length
    };
}
/** Pure : ce que l'abonnement vaut pour le compte. { actif, jusquAu: Date } — `stocke` est l'état déjà écrit (pour la grâce de l'impayé). */
function valeurs(s, evtDate, stocke) {
    const fin = s.finPeriode !== null ? dateDe(s.finPeriode) : null;
    const coupe = s.coupeLe !== null ? dateDe(s.coupeLe) : null;
    const bornee = fin && coupe ? new Date(Math.min(fin.getTime(), coupe.getTime())) : (fin || coupe);
    if ((s.statut === 'trialing' || s.statut === 'active') && s.offre && bornee) return { actif: true, jusquAu: bornee };
    if (s.statut === 'past_due' && s.offre && bornee) {
        const ancre = stocke && stocke.sid === s.sid && stocke.statut === 'past_due' && stocke.jusquAu instanceof Date ? stocke.jusquAu : new Date(evtDate.getTime() + GRACE_IMPAYE_JOURS * 86400e3);
        const j = new Date(Math.min(ancre.getTime(), bornee.getTime()));
        return { actif: j.getTime() > evtDate.getTime(), jusquAu: j };
    }
    if (s.statut === 'canceled') {
        const arret = s.termineLe !== null ? dateDe(s.termineLe) : evtDate;
        return { actif: false, jusquAu: bornee ? new Date(Math.min(arret.getTime(), bornee.getTime())) : arret };
    }
    return { actif: false, jusquAu: evtDate };
}
/** Pure : appliquer, ou ignorer ? `stocke` = abonnement.stripe déjà écrit (ou null). */
function decider(stocke, s, version) {
    if (!stocke || !stocke.sid) return { appliquer: true };
    if (stocke.sid === s.sid) {
        if (version > stocke.version) return { appliquer: true };
        if (version === stocke.version && (RANG[s.statut] ?? 0) >= (RANG[stocke.statut] ?? 0)) return { appliquer: true };
        return { appliquer: false, raison: 'desordre' };
    }
    const stockeTerminal = TERMINAUX.includes(stocke.statut), entrantTerminal = TERMINAUX.includes(s.statut);
    if (!stocke.offre) return { appliquer: true };                    // l'état stocké ne donnait aucun droit (prix inconnu) : il ne bloque pas un abonnement reconnu
    if (stockeTerminal) return entrantTerminal && (s.creeSub ?? 0) < (stocke.creeSub ?? 0) ? { appliquer: false, raison: 'ancien-abonnement' } : { appliquer: true };
    if (!entrantTerminal && (s.creeSub ?? 0) > (stocke.creeSub ?? 0)) return { appliquer: true, signal: 'deuxieme-abonnement' };
    return { appliquer: false, raison: 'autre-abonnement' };
}
/** Retrouve le compte d'un abonnement. { compte } ou { raison }. Lie le client Stripe au compte (une seule fois ; jamais un client déjà lié à un autre). */
async function resoudreCompte(s, { client = null, compteIdIndique = null } = {}) {
    const clientId = s.client || client;
    const parMeta = compteIdIndique || s.compteMeta ? await col('comptes').findOne({ _id: compteIdIndique || s.compteMeta }) : null;
    const parClient = clientId ? await col('comptes').findOne({ stripeClient: clientId }) : null;
    if (parMeta && parClient && String(parMeta._id) !== String(parClient._id)) return { raison: 'client-et-compte-divergent' };
    let compte = parMeta || parClient;
    if (!compte) return { raison: 'compte-inconnu' };
    if (compte.stripeClient && clientId && compte.stripeClient !== clientId) return { raison: 'client-different' };
    if (!compte.stripeClient && clientId) {
        try { const r = await col('comptes').updateOne({ _id: compte._id, stripeClient: null }, { $set: { stripeClient: clientId } }); if (r.matchedCount === 1) compte = { ...compte, stripeClient: clientId }; else compte = await col('comptes').findOne({ _id: compte._id }); }
        catch (e) { if (dupliquee(e)) return { raison: 'client-deja-lie-a-un-autre-compte' }; throw e; }
        if (compte.stripeClient !== clientId) return { raison: 'client-different' };
    }
    return { compte };
}
/**
 * Applique un objet Subscription au compte. `version` : la date de l'événement (secondes Stripe). `siAbsent` : n'écrire que si cet abonnement est INCONNU du compte
 * (le chemin « checkout.session.completed », dont l'objet est relu et ne doit jamais écraser un événement plus récent).
 * @returns {{ etat: 'applique'|'ignore'|'rejete', raison?: string, compte?: object, signal?: string }}
 */
async function appliquer(sub, { cfgAbo, version, evtDate, siAbsent = false, compteIdIndique = null }) {
    const s = lireSubscription(sub, cfgAbo);
    if (!s.sid || !STATUTS.includes(s.statut)) return { etat: 'rejete', raison: 'abonnement-illisible' };
    if (compteIdIndique && s.compteMeta && String(compteIdIndique) !== String(s.compteMeta)) return { etat: 'rejete', raison: 'reference-divergente' };
    const r = await resoudreCompte(s, { compteIdIndique });
    if (!r.compte) return { etat: 'rejete', raison: r.raison };
    let compte = r.compte;
    const signaux = [];
    if (!s.offre) signaux.push('prix-inconnu');
    for (let tour = 0; tour < 4; tour++) {
        const stocke = (compte.abonnement && compte.abonnement.stripe) || null;
        if (siAbsent && stocke && stocke.sid === s.sid) return { etat: 'ignore', raison: 'deja-connu', compte };
        const d = decider(stocke, s, version);
        if (!d.appliquer) return { etat: 'ignore', raison: d.raison, compte };
        if (d.signal) signaux.push(d.signal);
        const v = valeurs(s, evtDate, stocke);
        const pose = {
            'abonnement.actif': v.actif, 'abonnement.jusquAu': v.jusquAu, 'abonnement.stripe.sid': s.sid, 'abonnement.stripe.offre': s.offre, 'abonnement.stripe.periode': s.periode,
            'abonnement.stripe.statut': s.statut, 'abonnement.stripe.finPeriode': dateDe(s.finPeriode), 'abonnement.stripe.finEssai': dateDe(s.finEssai),
            'abonnement.stripe.resiliation': s.resiliation, 'abonnement.stripe.version': version, 'abonnement.stripe.creeSub': s.creeSub, 'abonnement.stripe.jusquAu': v.jusquAu,
            'abonnement.stripe.majLe': evtDate
        };
        if (s.aEuEssai) pose['abonnement.stripe.essaiUtilise'] = true;
        if (s.parrain && !(stocke && stocke.parrain)) pose['abonnement.stripe.parrain'] = s.parrain;
        const filtre = { _id: compte._id, 'abonnement.stripe.version': stocke && stocke.version !== undefined ? stocke.version : null, 'abonnement.stripe.sid': stocke && stocke.sid ? stocke.sid : null };
        const res = await col('comptes').updateOne(filtre, { $set: pose });
        if (res.matchedCount === 1) {
            // une place Fondateurs se CONFIRME dès que l'abonnement Fondateurs vit (essai, actif ou impayé en grâce)
            if (s.offre === 'fondateurs' && ['trialing', 'active', 'past_due'].includes(s.statut)) await Fo.confirmer(compte._id, cfgAbo.fondateurs.places, evtDate);
            return { etat: 'applique', compte: await col('comptes').findOne({ _id: compte._id }), signaux, parrain: s.parrain, offre: s.offre, statut: s.statut };
        }
        compte = await col('comptes').findOne({ _id: compte._id });                 // quelqu'un a écrit entre-temps : on relit et on recommence
        if (!compte) return { etat: 'rejete', raison: 'compte-disparu' };
    }
    throw Object.assign(new Error('etat : écriture concurrente persistante'), { code: 'CONCURRENCE' });
}
module.exports = { lireSubscription, valeurs, decider, resoudreCompte, appliquer, STATUTS, TERMINAUX, RANG, idDe, objetId, dateDe };
