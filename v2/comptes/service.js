'use strict';
const { col } = require('../db'); const M = require('../modeles');
const J = require('./jetons'); const P = require('./mots-de-passe');

const URL_VERIFICATION = () => process.env.V2_URL_VERIFICATION || 'https://rat-market.fr/fr/verification';

/** Crée un compte neutre + son lien de vérification. Une adresse déjà prise est SILENCIEUSE (anti-énumération) :
 *  le hachage est calculé dans les deux cas pour que le temps de réponse ne dise rien. */
async function inscrire({ email, emailCle, motDePasse, cfg, courrier, maintenant = new Date() }) {
    const hash = await P.hacher(motDePasse);
    const compte = M.nouveauCompte({ email, emailCle, motDePasse: hash, now: maintenant });
    try { await col('comptes').insertOne(compte); }
    catch (e) { if (e.code === 11000) return { cree: false }; throw e; }
    const jeton = J.genererJeton();
    await col('liens_email').insertOne({ empreinte: J.empreinte(jeton), type: 'verification', compteId: compte._id, creeLe: maintenant,
        expireLe: new Date(maintenant.getTime() + cfg.comptes.lienHeures * 3600e3), utiliseLe: null });
    try { await courrier.envoyerVerification(email, `${URL_VERIFICATION()}?jeton=${jeton}`); }
    catch (e) { console.error(`❌ [v2 inscription] envoi du courrier en échec (${e.message})`); }   // jamais l'adresse dans le journal
    return { cree: true, compteId: compte._id };
}
/** Consomme un lien à usage unique (atomique). → { lien } | { echec: 'inconnu' | 'expire' }.
 *  Un lien échu ou déjà utilisé n'est jamais consommé ; « expiré » ne se dit que d'un lien encore inutilisé. */
async function consommerLien(jeton, type, maintenant) {
    if (typeof jeton !== 'string' || !jeton || jeton.length > 128) return { echec: 'inconnu' };
    const empreinte = J.empreinte(jeton);
    const lien = await col('liens_email').findOneAndUpdate({ empreinte, type, utiliseLe: null, expireLe: { $gt: maintenant } }, { $set: { utiliseLe: maintenant } }, { returnDocument: 'after' });
    if (lien) return { lien };
    const vu = await col('liens_email').findOne({ empreinte, type, utiliseLe: null });
    return { echec: vu ? 'expire' : 'inconnu' };
}

/** Vérifie l'adresse et accorde les offertes UNE fois : le filtre `offertesAccordeesLe: null` est l'unique garde, posée dans l'écriture elle-même. */
async function verifierAdresse({ jeton, cfg, maintenant = new Date() }) {
    const c = await consommerLien(jeton, 'verification', maintenant);
    if (c.echec) return { statut: c.echec === 'expire' ? 410 : 404, code: c.echec === 'expire' ? 'CODE_EXPIRE' : 'CODE_INVALIDE' };
    const compteId = c.lien.compteId;
    const r = await col('comptes').updateOne({ _id: compteId, offertesAccordeesLe: null },
        { $set: { verifie: true, verifieLe: maintenant, offertesAccordeesLe: maintenant }, $inc: { 'solde.accueil': cfg.quotas.accueil } });
    if (r.modifiedCount === 1) {
        try {
            await col('mouvements').insertOne({ compteId, le: maintenant, surface: null, type: 'octroi', delta: cfg.quotas.accueil, poche: 'accueil',
                motif: 'octroi-accueil', scanId: null, etat: 'debite', cleIdempotence: `octroi-accueil|${compteId}`, expireLe: new Date(maintenant.getTime() + 730 * 86400e3) });
        } catch (e) { if (e.code !== 11000) console.error(`❌ [v2 verification] mouvement d'octroi non écrit (${e.message}) — la réconciliation imprimera l'écart`); }
    } else {
        const e = await col('comptes').updateOne({ _id: compteId, verifie: false }, { $set: { verifie: true, verifieLe: maintenant } });   // déjà accordé : jamais d'octroi sans le filtre
        if (e.matchedCount === 0 && await col('comptes').countDocuments({ _id: compteId }) === 0) return { statut: 404, code: 'CODE_INVALIDE' };
    }
    return { statut: 200 };
}
module.exports = { inscrire, URL_VERIFICATION, consommerLien, verifierAdresse };
