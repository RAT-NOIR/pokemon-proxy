'use strict';
// BREVO — l'avertissement des comptes INACTIFS, envoyé 30 jours avant leur suppression.
// LA RÈGLE (politique de confidentialité v2, décision de l'éditeur du 26/10 ; DEMANDE-SERVEUR-SITE.md) : un compte resté sans connexion 3 ans est supprimé, après UN avertissement par courriel un mois avant.
// Ce module porte la moitié « avertir » et le PRÉDICAT que la passe de suppression (qui n'existe pas encore) devra lire : `suppressionPermise`. Il ne supprime rien.
//  · référence d'inactivité = la plus récente de `derniereConnexionLe` et `verifieLe` (un compte confirmé qui ne s'est jamais connecté compte depuis sa confirmation) ; sans référence lisible : rien (jamais deviner) ;
//  · l'avertissement part dès que l'échéance (référence + 3 ans) est à 30 jours ou moins ; la suppression prévue est `max(échéance, maintenant + 30 j)` : le mois d'avis est TOUJOURS dû, même pour un compte
//    déjà au-delà de l'échéance le jour où la passe est allumée ;
//  · il est écrit dans le compte (`avertissementSuppression: { le, prevuLe }`) APRÈS l'envoi : un échec d'envoi ne marque rien et la passe suivante le retente ; un verrou de compte (`avertissementEnCoursLe`, bail
//    d'une heure) écrit AVANT l'envoi empêche deux processus d'envoyer deux courriels ; la limite assumée est « au moins une fois » : si l'écriture de la marque échoue APRÈS un envoi réussi, le bail expire et le courriel repart ;
//  · un avertissement n'est valable que pour le cycle où il est parti : si le compte se reconnecte ensuite (référence > `le`), il n'est plus supprimable, et un nouveau cycle s'ouvre trois ans plus tard ;
//  · jamais averti ni supprimable : un compte de banc (`banc: true` ou adresse en `.invalid`), un compte non confirmé (la purge de 48 h s'en charge), un compte à abonnement actif (sa suppression est refusée tant que
//    l'abonnement vit : promettre une suppression qui ne peut pas avoir lieu serait mentir) ;
//  · la passe refuse un pilote qui n'envoie pas pour de vrai (`courrier.reel`), borne le nombre d'envois (`max`), s'arrête au premier plafond du jour atteint, et ne journalise jamais une adresse.
const mongoose = require('mongoose');
const { col } = require('../db');

const JOUR = 86400e3, HEURE = 3600e3;
const DIFFERE_MS = 10 * 60 * 1000, INTERVALLE_MS = 24 * HEURE, BAIL_MS = HEURE, MAX_PAR_PASSE = 100;

const estDate = d => d instanceof Date && !Number.isNaN(d.getTime());
const plusAns = (d, k) => { const x = new Date(d.getTime()); x.setUTCFullYear(x.getUTCFullYear() + k); return x; };
const plusJours = (d, k) => new Date(d.getTime() + k * JOUR);

/** Un compte de banc : le drapeau, ou une adresse du domaine réservé `.invalid`. */
const estBanc = c => Boolean(c) && (c.banc === true || (typeof c.email === 'string' && /\.invalid$/i.test(c.email.trim())));
/** La référence d'inactivité : la plus récente de la dernière connexion et de la confirmation de l'adresse ; `null` si aucune n'est lisible. */
function reference(c) {
    const l = [c && c.derniereConnexionLe, c && c.verifieLe].filter(estDate);
    return l.length ? new Date(Math.max(...l.map(d => d.getTime()))) : null;
}
/** La date à laquelle le compte devient supprimable par INACTIVITÉ (référence + `inactiviteAns`), ou `null`. */
function echeance(c, cfg) { const r = reference(c); return r ? plusAns(r, cfg.comptes.inactiviteAns) : null; }
/** Un compte est-il concerné par la règle d'inactivité ? Écrit par ce qu'il AUTORISE : confirmé, hors banc, sans abonnement vivant. */
const concerne = c => Boolean(c) && c.verifie === true && !estBanc(c) && !(c.abonnement && c.abonnement.actif === true) && sansCreditsAchetes(c);
/**
 * R2 (tour 1) : un compte qui porte des crédits ACHETÉS (poche `solde.achete`) n'est jamais supprimé pour inactivité : ils ont été payés. Écrit par ce qu'on AUTORISE : poche absente ou exactement 0.
 * Toute autre valeur — positive, négative, NaN, texte, objet — est « illisible » et ferme (on ne supprime pas ce qu'on ne sait pas lire).
 */
function sansCreditsAchetes(c) {
    const s = c.solde;
    if (s === undefined || s === null) return true;                  // aucune poche : jamais d'achat
    if (typeof s !== 'object') return false;
    const a = s.achete;
    return a === undefined || a === null || (typeof a === 'number' && a === 0);
}
/** L'avertissement du compte est-il valable pour son cycle actuel (envoyé APRÈS la dernière référence) ? */
function avertissementValable(c) {
    const a = c && c.avertissementSuppression, r = reference(c);
    return Boolean(a) && estDate(a.le) && estDate(a.prevuLe) && r !== null && a.le.getTime() >= r.getTime();
}
/** Faut-il avertir ce compte maintenant ? → la date de suppression prévue (Date) ou `null`. */
function aAvertir(c, cfg, maintenant) {
    if (!concerne(c)) return null;
    const e = echeance(c, cfg); if (!e) return null;
    if (avertissementValable(c)) return null;
    if (maintenant.getTime() < plusJours(e, -cfg.comptes.avertissementJours).getTime()) return null;
    const mini = plusJours(maintenant, cfg.comptes.avertissementJours);
    return e.getTime() > mini.getTime() ? e : mini;
}
/**
 * LE PRÉDICAT DE LA FUTURE PASSE DE SUPPRESSION. Vrai SEULEMENT si : le compte est concerné, il a reçu un avertissement valable pour son cycle (donc il ne s'est pas reconnecté depuis), la date de suppression
 * annoncée dans cet avertissement est atteinte, ET son échéance d'inactivité aussi. Tout autre cas — jamais averti, reconnecté, date annoncée pas encore atteinte, données illisibles — est faux.
 */
function suppressionPermise(c, cfg, maintenant = new Date()) {
    if (!concerne(c) || !avertissementValable(c)) return false;
    const e = echeance(c, cfg);
    return e !== null && maintenant.getTime() >= c.avertissementSuppression.prevuLe.getTime() && maintenant.getTime() >= e.getTime();
}

/**
 * Une passe. → { examines, avertis, echecs, plafond, aBlanc } ou { refuse }. `aBlanc` : compte sans rien envoyer ni écrire. Ne journalise jamais une adresse.
 */
async function avertirInactifs({ cfg, courrier, maintenant = new Date(), aBlanc = false, max = MAX_PAR_PASSE, exigerReel = true } = {}) {
    if (exigerReel && !(courrier && courrier.reel === true)) {
        console.warn('⚠️ [v2 inactifs] passe refusée : le pilote de courrier n\'envoie pas pour de vrai (aucun compte marqué)');
        return { refuse: 'courrier-non-reel', examines: 0, avertis: 0, echecs: 0, plafond: false, aBlanc };
    }
    const sortie = { examines: 0, avertis: 0, echecs: 0, plafond: false, aBlanc };
    // Sélection LARGE (un sur-ensemble de ce que la règle retient, jamais moins) : la décision exacte est `aAvertir`, calendrier compris.
    const seuil = plusJours(plusAns(maintenant, -cfg.comptes.inactiviteAns), cfg.comptes.avertissementJours + 2);
    const curseur = col('comptes').find({
        verifie: true, banc: { $ne: true }, 'abonnement.actif': { $ne: true },
        $or: [{ derniereConnexionLe: { $lte: seuil } }, { derniereConnexionLe: null, verifieLe: { $lte: seuil } }]
    });
    for await (const compte of curseur) {
        if (sortie.avertis >= max) break;
        sortie.examines++;
        const prevue = aAvertir(compte, cfg, maintenant);
        if (!prevue) continue;
        if (aBlanc) { sortie.avertis++; continue; }
        // le BAIL : écrit avant l'envoi, sur l'état exact qu'on vient de lire (une reconnexion ou un autre processus entre la lecture et ici le fait échouer)
        const bail = await col('comptes').updateOne({
            _id: compte._id, verifie: true,
            derniereConnexionLe: compte.derniereConnexionLe === undefined ? null : compte.derniereConnexionLe, verifieLe: compte.verifieLe === undefined ? null : compte.verifieLe,
            'avertissementSuppression.le': compte.avertissementSuppression && compte.avertissementSuppression.le ? compte.avertissementSuppression.le : null,
            $or: [{ avertissementEnCoursLe: null }, { avertissementEnCoursLe: { $lt: new Date(maintenant.getTime() - BAIL_MS) } }]
        }, { $set: { avertissementEnCoursLe: maintenant } });
        if (bail.modifiedCount !== 1) continue;
        try {
            await courrier.envoyerAvertissement(compte.email, { derniereConnexionLe: reference(compte), suppressionLe: prevue });
        } catch (e) {
            await col('comptes').updateOne({ _id: compte._id, avertissementEnCoursLe: maintenant }, { $unset: { avertissementEnCoursLe: '' } }).catch(() => { /* le bail expire seul */ });
            if (e && e.name === 'BrevoPlafond') { sortie.plafond = true; break; }
            if (e && e.name === 'BrevoStatut429') { sortie.arret = 'BrevoStatut429'; sortie.echecs++; console.error('❌ [v2 inactifs] Brevo répond « trop de requêtes » (BrevoStatut429) — la passe s\'arrête, le reste attend la suivante'); break; }   // insister auprès d'un serveur qui dit « trop » aggrave
            sortie.echecs++;
            console.error(`❌ [v2 inactifs] avertissement non envoyé (${(e && e.name) || 'Error'})`);      // le nom de l'erreur seul : jamais l'adresse ni le message du pilote
            continue;
        }
        try {
            await col('comptes').updateOne({ _id: compte._id }, { $set: { avertissementSuppression: { le: maintenant, prevuLe: prevue } }, $unset: { avertissementEnCoursLe: '' } });
            sortie.avertis++;
        } catch (e) { sortie.echecs++; console.error(`❌ [v2 inactifs] avertissement envoyé mais NON marqué (${(e && e.name) || 'Error'}) — il repartira à l'expiration du bail`); }
    }
    if (sortie.avertis || sortie.echecs || sortie.plafond) console.log(`📧 [v2 inactifs] ${aBlanc ? 'à blanc : ' : ''}${sortie.avertis} avertissement(s), ${sortie.echecs} échec(s)${sortie.plafond ? ', plafond du jour atteint' : ''} sur ${sortie.examines} compte(s) examiné(s)`);
    return sortie;
}

async function avertirUneFois({ cfg, courrier, etatMongo = () => mongoose.connection.readyState, passe = avertirInactifs } = {}) {
    try {
        if (etatMongo() !== 1) return false;
        await passe({ cfg, courrier: typeof courrier === 'function' ? courrier() : courrier, maintenant: new Date() });
        return true;
    } catch (e) { console.error(`❌ [v2 inactifs] passe échouée (${(e && (e.code || e.name)) || 'erreur'})`); return false; }   // jamais e.message
}
let minuteur = null, differe = null, minuteursEnCours = null;
function arreterAvertissements() {
    const m = minuteursEnCours || global;
    if (minuteur) { m.clearInterval(minuteur); minuteur = null; }
    if (differe) { m.clearTimeout(differe); differe = null; }
    minuteursEnCours = null;
}
/** UN différé et UN intervalle par processus (patron de purge.js), sans retenir le processus. `courrier` : un pilote ou une fonction qui le rend (lu à chaque passe). */
function demarrerAvertissements({ cfg, courrier, minuteurs = global, differeMs = DIFFERE_MS, intervalleMs = INTERVALLE_MS, etatMongo, passe } = {}) {
    arreterAvertissements();
    minuteursEnCours = minuteurs;
    const lancer = () => avertirUneFois({ cfg, courrier, ...(etatMongo ? { etatMongo } : {}), ...(passe ? { passe } : {}) });
    differe = minuteurs.setTimeout(lancer, differeMs); differe.unref();
    minuteur = minuteurs.setInterval(lancer, intervalleMs); minuteur.unref();
    return minuteur;
}
module.exports = { estBanc, reference, echeance, concerne, avertissementValable, aAvertir, suppressionPermise, avertirInactifs, avertirUneFois, demarrerAvertissements, arreterAvertissements, DIFFERE_MS, INTERVALLE_MS, BAIL_MS, MAX_PAR_PASSE };
