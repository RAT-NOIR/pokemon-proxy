'use strict';
// LE PARRAINAGE — « 1 mois offert aux deux ».
//   · le FILLEUL a un essai de 30 jours au lieu de 14 (Checkout) ;
//   · le PARRAIN reçoit un mois offert (un coupon à 100 %, `duration: once`, posé sur SON abonnement) quand la PREMIÈRE facture PAYÉE du filleul arrive (invoice.paid, montant > 0).
// Garde-fous (tous écrits par ce qu'ils AUTORISENT) :
//   · un seul crédit par filleul : la ligne de `abo_primes` a pour _id le compte du filleul (clé unique) ;
//   · jamais de parrainage de soi-même : même compte, même client Stripe, ou compte du parrain = compte du filleul ;
//   · le filleul doit être un client NOUVEAU : aucun essai déjà utilisé, aucun abonnement connu — en base et chez Stripe (voir eligibleFilleul et routes.js essaiPermis) ;
//   · un coupon n'est posé que sur un abonnement VIVANT (essai, actif, impayé) et SANS autre remise en cours (un mois offert de plus ne se perd pas dans un coupon qui ne sert pas : la prime
//     attend alors la prochaine facture du parrain) ;
//   · le coupon a un identifiant déterministe (rm-parrainage-<filleul>) : le recréer après une reprise ne crée rien de plus.
const crypto = require('crypto');
const { col } = require('../db');
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';        // sans 0 O 1 I L : un code se recopie à la main
const LONGUEUR = 8;
const dupliquee = e => Boolean(e) && e.code === 11000;
const nouveauCode = () => { const o = crypto.randomBytes(LONGUEUR); let s = ''; for (let i = 0; i < LONGUEUR; i++) s += ALPHABET[o[i] % ALPHABET.length]; return s; };
const FORME_CODE = new RegExp(`^[${ALPHABET}]{${LONGUEUR}}$`);
const normaliserCodeParrainage = s => String(s).normalize('NFKC').replace(/[\s-]+/g, '').toUpperCase();

/** Le code de parrainage du compte, créé à la première demande (un seul par compte : l'index sur compteId tranche la course). */
async function codeDe(compteId) {
    const deja = await col('abo_parrainage').findOne({ compteId });
    if (deja) return deja._id;
    for (let essai = 0; essai < 5; essai++) {
        const code = nouveauCode();
        try { await col('abo_parrainage').insertOne({ _id: code, compteId, creeLe: new Date() }); return code; }
        catch (e) {
            if (!dupliquee(e)) throw e;
            const moi = await col('abo_parrainage').findOne({ compteId });      // une demande simultanée du même compte a gagné
            if (moi) return moi._id;                                           // sinon : le code tiré existait déjà chez un autre, on retire
        }
    }
    throw new Error('parrainage : aucun code libre après 5 tirages');
}
/** Le compte parrain d'un code, ou null (forme fausse, inconnu). */
async function parrainDe(codeSaisi) {
    if (typeof codeSaisi !== 'string' || codeSaisi.length > 40) return null;
    const code = normaliserCodeParrainage(codeSaisi);
    if (!FORME_CODE.test(code)) return null;
    const d = await col('abo_parrainage').findOne({ _id: code });
    if (!d) return null;
    return col('comptes').findOne({ _id: d.compteId });
}
/** Le filleul est-il un CLIENT NOUVEAU ? Jamais d'essai ni d'abonnement connus de la base (la route vérifie aussi, chez Stripe, qu'aucun abonnement n'a existé pour son client). Avoir déjà
 *  OUVERT une page de paiement (donc avoir un client Stripe, créé à la première session) n'en fait pas un ancien client. */
function eligibleFilleul(compte) {
    if (!compte) return false;
    const s = (compte.abonnement && compte.abonnement.stripe) || null;
    if (s && (s.sid || s.essaiUtilise)) return false;
    return true;
}
/** Le parrain peut-il parrainer ce filleul ? Jamais soi-même (compte ou client Stripe identique). */
function parrainageAdmis(parrain, filleul) {
    if (!parrain || !filleul) return false;
    if (String(parrain._id) === String(filleul._id)) return false;
    if (parrain.stripeClient && filleul.stripeClient && parrain.stripeClient === filleul.stripeClient) return false;
    return true;
}
module.exports = { codeDe, parrainDe, eligibleFilleul, parrainageAdmis, normaliserCodeParrainage, FORME_CODE };
