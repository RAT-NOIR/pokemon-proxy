'use strict';
// L'ÉTAT DU COMPTE suit les abonnements Stripe. Ce module est le SEUL à écrire `abonnement.actif` / `abonnement.jusquAu` depuis un événement Stripe.
//
// Les règles (décisions écrites) :
//   · trialing ou active          → Pro jusqu'à la fin de la période PLUS une marge de renouvellement (MARGE_RENOUVELLEMENT_HEURES, 48 h) : un client qui PAIE ne perd jamais le Pro parce
//                                    que le webhook du renouvellement arrive tard (livraison retardée, redéploiement, reprise). Jamais de marge pour une résiliation programmée (fin exacte
//                                    de la période), ni pour un abonnement supprimé, ni pour l'impayé ;
//   · past_due (paiement échoué)  → Pro maintenu `GRACE_IMPAYE_JOURS` (3) jours au plus après le PREMIER événement past_due, jamais au-delà de la fin de période, JAMAIS prolongé par un nouvel
//                                    échec ni un nouvel événement (la règle la plus prudente pour le client SANS offrir un mois gratuit pendant les relances de Stripe) ;
//   · canceled, deleted, unpaid, paused, incomplete, incomplete_expired → plus de Pro ;
//   · un abonnement dont le prix n'est PAS l'un des quatre prix Rat-Market n'ouvre RIEN (offre inconnue : signalé, jamais deviné) ;
//   · un abonnement au prix FONDATEURS sans place Fondateurs prise (ou réservée) par ce compte n'accorde rien de plus : un abonné Pro qui y passerait (par le portail, par un autre
//     chemin) reste sur l'offre Pro, un nouvel abonnement n'ouvre aucun droit ; dans les deux cas c'est signalé et AUCUNE place n'est prise (le plafond de places ne se franchit pas) ;
//   · PLUSIEURS abonnements : l'état de CHACUN est gardé (`abonnement.stripe.subs`), le Pro tient tant qu'AU MOINS UN est vivant (résilier l'un ne coupe jamais le Pro que l'autre
//     paie), le doublon est signalé (`double-abonnement`). Rien n'est annulé ni remboursé automatiquement ;
//   · un événement DANS LE DÉSORDRE ne fait jamais régresser l'état : chaque abonnement porte la date de son dernier événement (`version`, secondes Stripe) ; un événement plus ancien
//     que celui déjà appliqué pour CET abonnement est ignoré (égalité : le statut le plus avancé gagne). L'écriture est une comparaison-et-échange sur `rev`.
const { ObjectId } = require('mongoose').Types;
const { col } = require('../db');
const { DEPUIS_LOOKUP, GRACE_IMPAYE_JOURS, MARGE_RENOUVELLEMENT_HEURES, MARGE_ESSAI_PLACE_JOURS } = require('./offres');
const Fo = require('./fondateurs'); const Essai = require('./essai'); const Cl = require('./client');

const STATUTS = Object.freeze(['incomplete', 'incomplete_expired', 'trialing', 'active', 'past_due', 'canceled', 'unpaid', 'paused']);
const TERMINAUX = Object.freeze(['canceled', 'incomplete_expired']);
const VIVANTS = Object.freeze(['trialing', 'active', 'past_due']);
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
        finEssai: nombre(sub && sub.trial_end), debutEssai: nombre(sub && sub.trial_start), aEuEssai: nombre(sub && sub.trial_end) !== null || nombre(sub && sub.trial_start) !== null,
        resiliation: Boolean(sub && (sub.cancel_at_period_end === true || nombre(sub.cancel_at) !== null)), termineLe: nombre(sub && sub.ended_at),
        creeSub: nombre(sub && sub.created), client: idDe(sub && sub.customer), compteMeta: objetId(meta.compteId), parrain: objetId(meta.parrain),
        remises: Array.isArray(sub && sub.discounts) ? sub.discounts.length : (sub && sub.discount ? 1 : 0), nbLignes: items.length
    };
}
/** Pure : ce que l'abonnement vaut pour le compte. { actif, jusquAu: Date } — `entree` est l'état déjà écrit POUR CET ABONNEMENT (pour la grâce de l'impayé). */
function valeurs(s, evtDate, entree) {
    const fin = s.finPeriode !== null ? dateDe(s.finPeriode) : null;
    const coupe = s.coupeLe !== null ? dateDe(s.coupeLe) : null;
    const bornee = fin && coupe ? new Date(Math.min(fin.getTime(), coupe.getTime())) : (fin || coupe);
    if ((s.statut === 'trialing' || s.statut === 'active') && s.offre && bornee) {
        // la marge de renouvellement : seulement pour un abonnement qui doit se RENOUVELER (jamais une résiliation programmée)
        return { actif: true, jusquAu: s.resiliation ? bornee : new Date(bornee.getTime() + MARGE_RENOUVELLEMENT_HEURES * 3600e3) };
    }
    if (s.statut === 'past_due' && s.offre && bornee) {
        const ancre = entree && entree.statut === 'past_due' && entree.jusquAu instanceof Date ? entree.jusquAu : new Date(evtDate.getTime() + GRACE_IMPAYE_JOURS * 86400e3);
        const j = new Date(Math.min(ancre.getTime(), bornee.getTime()));
        return { actif: j.getTime() > evtDate.getTime(), jusquAu: j };
    }
    if (s.statut === 'canceled') {
        const arret = s.termineLe !== null ? dateDe(s.termineLe) : evtDate;
        return { actif: false, jusquAu: bornee ? new Date(Math.min(arret.getTime(), bornee.getTime())) : arret };
    }
    return { actif: false, jusquAu: evtDate };
}
/** Pure : appliquer, ou ignorer ? `entree` = l'état déjà écrit pour CET abonnement (ou null : un abonnement inconnu s'applique toujours). */
function decider(entree, statut, version) {
    if (!entree) return { appliquer: true };
    if (version > entree.version) return { appliquer: true };
    if (version === entree.version && (RANG[statut] ?? 0) >= (RANG[entree.statut] ?? 0)) return { appliquer: true };
    return { appliquer: false, raison: 'desordre' };
}
/** Les abonnements connus du compte : `subs` (un par identifiant) ; un compte écrit avant ce tour porte un seul abonnement à plat, relu comme une entrée. */
function subsDe(st) {
    if (!st) return {};
    if (st.subs && typeof st.subs === 'object') return st.subs;
    if (st.sid) return { [st.sid]: { statut: st.statut, version: st.version ?? 0, offre: st.offre ?? null, periode: st.periode ?? null, creeSub: st.creeSub ?? null, jusquAu: st.jusquAu ?? null, actif: VIVANTS.includes(st.statut), finPeriode: st.finPeriode ?? null, finEssai: st.finEssai ?? null, debutEssai: st.debutEssai ?? null, resiliation: Boolean(st.resiliation) } };
    return {};
}
/** Pure : le droit du compte, déduit de TOUS ses abonnements. Pro tant qu'au moins un est vivant ; l'abonnement « principal » (celui qui va plus loin, sinon le plus récent) est ce que le site affiche. */
function agreger(subs) {
    const liste = Object.entries(subs).map(([sid, e]) => ({ sid, ...e }));
    const t = d => (d instanceof Date ? d.getTime() : 0);
    const vivants = liste.filter(e => e.actif === true);
    const principal = vivants.length ? [...vivants].sort((a, b) => t(b.jusquAu) - t(a.jusquAu))[0] : [...liste].sort((a, b) => (b.creeSub ?? 0) - (a.creeSub ?? 0))[0];
    return { actif: vivants.length > 0, jusquAu: principal.jusquAu, principal, double: vivants.length > 1 };
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
/** Ce compte détient-il une place Fondateurs (prise, ou réservée et encore vivante) ? */
async function aUnePlace(compteId, evtDate) {
    return Boolean(await col(Fo.COL).findOne({ compteId, $or: [{ etat: 'prise' }, { etat: 'reservee', expireLe: { $gt: evtDate } }] }));
}
/**
 * Applique un objet Subscription au compte. `version` : la date de l'événement (secondes Stripe). `siAbsent` : n'écrire que si cet abonnement est INCONNU du compte
 * (le chemin « checkout.session.completed », dont l'objet est relu et ne doit jamais écraser un événement plus récent). `stripe` : le client du traitement en cours (le webhook y a mis son réessai sur la limite de débit) ; à défaut, le client de la configuration.
 * @returns {{ etat: 'applique'|'ignore'|'rejete', raison?: string, compte?: object, signaux?: string[] }}
 */
async function appliquer(sub, { cfgAbo, version, evtDate, siAbsent = false, compteIdIndique = null, stripe = null }) {
    const s = lireSubscription(sub, cfgAbo);
    if (!s.sid || !STATUTS.includes(s.statut)) return { etat: 'rejete', raison: 'abonnement-illisible' };
    if (compteIdIndique && s.compteMeta && String(compteIdIndique) !== String(s.compteMeta)) return { etat: 'rejete', raison: 'reference-divergente' };
    const r = await resoudreCompte(s, { compteIdIndique });
    if (!r.compte) return { etat: 'rejete', raison: r.raison };
    let compte = r.compte;
    for (let tour = 0; tour < 4; tour++) {
        const signaux = [];
        const st = (compte.abonnement && compte.abonnement.stripe) || null;
        const subs = subsDe(st), entree = subs[s.sid] || null;
        if (siAbsent && entree) return { etat: 'ignore', raison: 'deja-connu', compte };
        const d = decider(entree, s.statut, version);
        if (!d.appliquer) return { etat: 'ignore', raison: d.raison, compte };
        // la défense en profondeur : le prix Fondateurs sans place n'ouvre rien de plus que ce que l'abonnement avait déjà
        const effectif = { ...s };
        if (!effectif.offre) signaux.push('prix-inconnu');
        if (effectif.offre === 'fondateurs' && VIVANTS.includes(effectif.statut) && !(await aUnePlace(compte._id, evtDate))) {
            if (entree && entree.offre === 'pro') { effectif.offre = 'pro'; signaux.push('fondateurs-sans-place'); }       // un abonné Pro qui passe au prix Fondateurs reste Pro, aucune place prise
            else {                                                                                                         // un NOUVEL abonnement : on ne prive jamais un client qui paie (ou paiera)
                const repris = await Fo.reserver(compte._id, cfgAbo.fondateurs.places, evtDate);                           // une place LIBRE est reprise ; sinon le dépassement est compté et signalé
                if (!repris.ok) { await Fo.marquerDepassement(compte._id, evtDate); signaux.push('fondateurs-depassement'); } else signaux.push('fondateurs-place-reprise');
            }
        }
        const v = valeurs(effectif, evtDate, entree);
        const nouvelle = { statut: s.statut, version, offre: effectif.offre, periode: s.periode, creeSub: s.creeSub, jusquAu: v.jusquAu, actif: v.actif, finPeriode: dateDe(s.finPeriode), finEssai: dateDe(s.finEssai), debutEssai: dateDe(s.debutEssai), resiliation: s.resiliation };
        const tous = { ...subs, [s.sid]: nouvelle };
        const ag = agreger(tous), p = ag.principal;
        if (ag.double) signaux.push('double-abonnement');
        const pose = {
            'abonnement.actif': ag.actif, 'abonnement.jusquAu': ag.jusquAu, 'abonnement.stripe.subs': tous, 'abonnement.stripe.double': ag.double,
            'abonnement.stripe.sid': p.sid, 'abonnement.stripe.offre': p.offre, 'abonnement.stripe.periode': p.periode, 'abonnement.stripe.statut': p.statut, 'abonnement.stripe.finPeriode': p.finPeriode,
            'abonnement.stripe.finEssai': p.finEssai, 'abonnement.stripe.debutEssai': p.debutEssai ?? null, 'abonnement.stripe.resiliation': p.resiliation, 'abonnement.stripe.version': p.version, 'abonnement.stripe.creeSub': p.creeSub,
            'abonnement.stripe.jusquAu': p.jusquAu, 'abonnement.stripe.majLe': evtDate, 'abonnement.stripe.rev': (st && Number.isInteger(st.rev) ? st.rev : 0) + 1
        };
        if (s.aEuEssai) pose['abonnement.stripe.essaiUtilise'] = true;
        if (s.parrain && !(st && st.parrain)) pose['abonnement.stripe.parrain'] = s.parrain;
        const res = await col('comptes').updateOne({ _id: compte._id, 'abonnement.stripe.rev': st && Number.isInteger(st.rev) ? st.rev : null }, { $set: pose });
        if (res.matchedCount === 1) {
            // STRIPE-DECISIONS : l'essai existe vraiment — la réservation de la boîte et des installations du compte (faite au Checkout) devient définitive (essai.js ; idempotent, sans effet hors essai)
            // Un essai qui n'aurait pas dû démarrer (la boîte ou une installation du compte a DÉJÀ servi un autre essai confirmé : réservation expirée, installation liée entre le Checkout et ce
            // webhook) est CLOS tout de suite : fin de l'essai maintenant — résiliation s'il n'y a pas de carte (missing_payment_method=cancel), premier paiement s'il y en a une. Un échec de Stripe fait rejouer l'événement.
            if (s.aEuEssai) {
                const g = await Essai.confirmer(compte, evtDate);
                if (g.clore && s.statut === 'trialing') { await (stripe || Cl.obtenir(cfgAbo)).subscriptions.update(s.sid, { trial_end: 'now' }); signaux.push(`essai-clos:${g.detail}`); }
            }
            // La place Fondateurs : réservée pendant l'ESSAI (elle compte contre le plafond, jusqu'à la fin de l'essai + marge), CONFIRMÉE à la première facture payée (webhook invoice.paid, ou ici un
            // abonnement déjà `active` : il a payé), RENDUE si l'abonnement meurt avant tout paiement (une place prise ne se rend jamais).
            if (effectif.offre === 'fondateurs' || (entree && entree.offre === 'fondateurs')) {
                if (s.statut === 'active' && effectif.offre === 'fondateurs') await Fo.confirmer(compte._id, cfgAbo.fondateurs.places, evtDate);
                else if (s.statut === 'trialing' && effectif.offre === 'fondateurs' && s.finEssai !== null) await Fo.prolonger(compte._id, new Date(s.finEssai * 1000 + MARGE_ESSAI_PLACE_JOURS * 86400e3));
                else if (TERMINAUX.includes(s.statut) || s.statut === 'unpaid') await Fo.liberer(compte._id);
            }
            return { etat: 'applique', compte: await col('comptes').findOne({ _id: compte._id }), signaux, parrain: s.parrain, offre: effectif.offre, statut: s.statut };
        }
        compte = await col('comptes').findOne({ _id: compte._id });                 // quelqu'un a écrit entre-temps : on relit et on recommence
        if (!compte) return { etat: 'rejete', raison: 'compte-disparu' };
    }
    throw Object.assign(new Error('etat : écriture concurrente persistante'), { code: 'CONCURRENCE' });
}
module.exports = { lireSubscription, valeurs, decider, subsDe, agreger, resoudreCompte, appliquer, STATUTS, TERMINAUX, VIVANTS, RANG, idDe, objetId, dateDe };
